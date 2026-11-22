// Statute section journey (#1126, part 4 of #1116), CI only (post-deploy check
// `statutes-section-journey`): with the demo statute rows and one masked demo judgment citing CrPC 439
// seeded (the `e2e` seed profile has no statute or corpus rows), BNSS 483 shows its text with the
// synthetic label, its history, the CrPC 439 counterpart and a top authority linking the court PDF at
// the cited page. Axe is clean in every viewport and theme project.
import { createHash, randomUUID } from 'node:crypto';

import { demoStatuteRows } from '@causedeck/db/seed/demo';

import { expect, test } from '../../fixtures/index.ts';
import { MATTERS_WORKSPACE } from '../../fixtures/matters-data.ts';
import { withSql } from '../lifecycle/helpers.ts';

const CITED_PAGE = 2;

test.describe('statute section', { tag: '@a11y' }, () => {
  test('BNSS 483 shows text, history, counterpart and an authority link; axe is clean', async ({
    page,
    asUser,
    db,
  }) => {
    const judgmentId = randomUUID();
    const sha256 = createHash('sha256').update(`e2e-statutes:${judgmentId}`).digest('hex');
    const sourceUrl = `https://demo.causedeck.test/corpus/${judgmentId}`;
    await withSql(db.name, async (sql) => {
      const { acts, sections, versions } = demoStatuteRows();
      for (const a of acts) {
        await sql`
          insert into statute_act (id, key, title, short_name, year, in_force_from, source_note, synthetic)
          values (${a.id}, ${a.key}, ${a.title}, ${a.shortName ?? null}, ${a.year ?? null},
            ${a.inForceFrom}, ${a.sourceNote}, ${a.synthetic})
          on conflict do nothing`;
      }
      for (const s of sections) {
        await sql`
          insert into statute_section (id, act_id, section, heading)
          values (${s.id}, ${s.actId}, ${s.section}, ${s.heading})
          on conflict do nothing`;
      }
      for (const v of versions) {
        await sql`
          insert into statute_section_version
            (id, section_id, text, valid_from, valid_to, amended_by, source_note, synthetic)
          values (${v.id}, ${v.sectionId}, ${v.text}, ${v.validFrom}, ${v.validTo ?? null},
            ${v.amendedBy ?? null}, ${v.sourceNote}, ${v.synthetic})
          on conflict do nothing`;
      }
      const provenance = {
        url: sourceUrl,
        fetchedAt: '2026-01-01T00:00:00.000Z',
        sha256,
        sourceId: 'demo.corpus',
        sourceVersion: 'v1',
        tierUsed: 'http',
        costDollars: 0,
      };
      await sql`
        insert into judgment (id, source_id, court, neutral_citation, judgment_date, sha256,
          provenance, page_text, redaction_version, case_title, title_masked, court_level)
        values (${judgmentId}, 'demo.corpus', 'MHC', ${`2025:MHC:${sha256.slice(0, 6)}`},
          '2025-02-03', ${sha256}, ${sql.json(provenance)},
          ${sql.json([{ pageNo: 1, text: 'Demo page.' }, { pageNo: 2, text: 'Section 439 CrPC.' }])},
          1, 'A (fictional) v. State of Tamil Nadu', true, 'high_court')`;
      await sql`
        insert into judgment_statute_ref (judgment_id, statute, section, page, ruleset_version)
        values (${judgmentId}, 'code of criminal procedure', '439', ${CITED_PAGE}, 'e2e')`;
    });
    try {
      await asUser('owner', {
        workspace: MATTERS_WORKSPACE,
        path: 'research/statutes/bnss/483',
      });
      await expect(page.locator('main').getByRole('heading', { level: 1 })).toContainText(
        'BNSS s. 483',
      );
      await expect(page.locator('[data-slot="section-text"]')).toBeVisible();
      await expect(page.locator('[data-slot="section-label"]')).toContainText(
        'Synthetic paraphrase',
      );
      await expect(page.locator('[data-slot="section-history"] li')).not.toHaveCount(0);
      await expect(page.locator('[data-slot="section-counterpart"] a')).toHaveAttribute(
        'href',
        /\/research\/statutes\/code%20of%20criminal%20procedure\/439$/,
      );
      const authority = page
        .locator('[data-slot="section-authority"]')
        .filter({ has: page.locator(`a[href="${sourceUrl}#page=${String(CITED_PAGE)}"]`) });
      await expect(authority).toHaveCount(1);
      await expect(authority.locator('a')).toHaveAttribute('target', '_blank');
    } finally {
      await withSql(db.name, async (sql) => {
        await sql`delete from judgment_statute_ref where judgment_id = ${judgmentId}`;
        await sql`delete from judgment where id = ${judgmentId}`;
      });
    }
  });
});
