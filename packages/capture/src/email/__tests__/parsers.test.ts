// Intake parsers on synthetic .eml fixtures (#528): AIMS, registry memo, e-filing ack, briefing
// counsel and generic; each fixture parses in under a second.
import { describe, expect, it } from 'vitest';

import { CONTEXT, MATTER_ID, parsed } from './helpers.ts';

const kinds = (drafts: { kind: string }[]) => drafts.map((draft) => draft.kind);

async function timed<T>(run: () => Promise<T>): Promise<T> {
  const start = performance.now();
  const value = await run();
  expect(performance.now() - start).toBeLessThan(1000);
  return value;
}

describe('aims-cause-list parser', () => {
  it('turns an exact case match into listing_update and own unmatched rows into new_matter', async () => {
    const outcome = await timed(() => parsed('aims-plain'));
    expect(outcome.parserId).toBe('aims-cause-list');
    expect(outcome.sender).toMatchObject({ verdict: 'allowed', kind: 'court' });
    const { drafts, diagnostics } = outcome.result;
    expect(drafts[0]).toMatchObject({
      kind: 'listing_update',
      matterId: MATTER_ID,
      match: { score: 1, exact: 'case_number' },
      payload: { matchKey: 'WP/12345/2026', hallNo: '12', itemNo: '5', stage: 'admission' },
    });
    expect(kinds(drafts)).toEqual(['listing_update', 'new_matter', 'new_matter']);
    expect(diagnostics.map((d) => d.code)).not.toContain('rows_discarded');
  });

  it('reads an HTML table email', async () => {
    const outcome = await timed(() => parsed('aims-html'));
    expect(outcome.parserId).toBe('aims-cause-list');
    expect(kinds(outcome.result.drafts)).toContain('listing_update');
  });

  it.each(['forward-gmail', 'forward-outlook', 'forward-apple', 'forward-rfc822'])(
    'unwraps %s: the court is the sender, the forwarding user the submitter',
    async (name) => {
      const outcome = await timed(() => parsed(name));
      expect(outcome.intake.forwarded).toBe(true);
      expect(outcome.intake.sender.address).toBe('aims-registry@example.test');
      expect(outcome.intake.submitter.address).not.toBe('aims-registry@example.test');
      expect(outcome.sender).toMatchObject({ kind: 'self', matchedAs: 'envelope' });
      expect(outcome.parserId).toBe('aims-cause-list');
    },
  );

  it('discards rows that match neither a matter nor the lawyer, keeping only a count', async () => {
    const outcome = await parsed('forward-gmail');
    expect(outcome.result.drafts).toEqual([]);
    expect(outcome.result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'rows_discarded', severity: 'info' }),
    );
    expect(JSON.stringify(outcome.result)).not.toContain('Example Textiles');
  });

  it('flags a matter expected on the list that is not on it', async () => {
    const outcome = await parsed('aims-plain', {
      matters: [
        ...CONTEXT.matters,
        { matterId: '22222222-2222-4222-8222-222222222222', matchKey: 'WP/1/2020', expectedOn: '2026-10-23' },
      ],
    });
    expect(outcome.result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'matter_not_listed', severity: 'needs_you' }),
    );
  });

  it('returns the attachment of a PDF-only message for the capture pipeline', async () => {
    const outcome = await timed(() => parsed('pdf-only'));
    expect(outcome.parserId).toBe('aims-cause-list');
    expect(outcome.result.drafts).toEqual([]);
    expect(outcome.result.captures).toMatchObject([
      { source: 'attachment', fileName: 'cause-list-23.10.2026.pdf', mime: 'application/pdf' },
    ]);
    expect(outcome.result.diagnostics.map((d) => d.code)).toContain('pdf_only');
  });
});

describe('registry-memo parser', () => {
  it('proposes an obligation with the derived cure deadline', async () => {
    const outcome = await timed(() => parsed('defect-memo'));
    expect(outcome.parserId).toBe('registry-memo');
    expect(outcome.result.drafts).toMatchObject([
      {
        kind: 'obligation_from_direction',
        payload: { dueOn: '2026-10-22', relativeDeadline: false },
      },
    ]);
    expect(outcome.result.diagnostics.map((d) => d.code)).not.toContain('relative_deadline');
  });

  it('flags a relative deadline that has no printed date to count from', async () => {
    const outcome = await parsed('defect-memo-relative');
    expect(outcome.result.drafts).toMatchObject([
      { kind: 'obligation_from_direction', payload: { dueOn: null, relativeDeadline: true } },
    ]);
    expect(outcome.result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'relative_deadline', severity: 'needs_you' }),
    );
  });
});

describe('efiling-ack parser', () => {
  it('proposes a new_proceeding in the filed state', async () => {
    const outcome = await timed(() => parsed('efiling-ack'));
    expect(outcome.parserId).toBe('efiling-ack');
    expect(outcome.result.drafts).toMatchObject([
      {
        kind: 'new_proceeding',
        payload: { state: 'filed', filingNo: 'EF/2026/004455', filedOn: '15.10.2026' },
      },
    ]);
  });
});

describe('briefing-counsel parser', () => {
  it('captures the brief as text and proposes a review task', async () => {
    const outcome = await timed(() => parsed('briefing-counsel'));
    expect(outcome.parserId).toBe('briefing-counsel');
    expect(kinds(outcome.result.drafts)).toEqual(['task']);
    expect(outcome.result.captures).toMatchObject([{ source: 'body', mime: 'text/plain' }]);
  });
});

describe('generic parser', () => {
  it('captures the body and an allowed attachment', async () => {
    const outcome = await parsed('huge-attachment');
    expect(outcome.result.captures.map((c) => [c.source, c.fileName])).toEqual([
      ['body', 'Bundle-of-papers.txt'],
      ['attachment', 'bundle.txt'],
    ]);
  });

  it('refuses an attachment over the size cap with a diagnostic', async () => {
    const outcome = await parsed('huge-attachment', { sizeCapOverrides: { txt: 1000 } });
    expect(outcome.result.captures.map((c) => c.source)).toEqual(['body']);
    expect(outcome.result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'attachment_rejected' }),
    );
  });

  it('is the fallback for a message no parser claims', async () => {
    const outcome = await parsed('injection');
    expect(outcome.parserId).toBe('generic');
    expect(outcome.score).toBe(0.1);
  });
});
