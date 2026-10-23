import type { AiGateway } from '@causedeck/ai';
import { describe, expect, it, vi } from 'vitest';

import { extractIssueTags, normaliseSection, normaliseStatute, statuteSpellings } from './index.ts';

const scope = { workspaceId: 'w1', matterId: 'm1', userId: 'u1' };

function gatewayReturning(output: unknown): { gateway: AiGateway; run: ReturnType<typeof vi.fn> } {
  const run = vi.fn().mockResolvedValue({ output });
  return { gateway: { run }, run };
}

describe('normaliseStatute', () => {
  it('drops punctuation, the leading "the" and the year', () => {
    expect(normaliseStatute('The Arbitration & Conciliation Act, 1996')).toBe(
      'arbitration and conciliation act',
    );
  });

  it('expands short forms', () => {
    expect(normaliseStatute('CPC')).toBe('code of civil procedure');
    expect(statuteSpellings('code of civil procedure')).toContain('cpc');
  });

  it('is empty for an empty name', () => {
    expect(normaliseStatute(' . ')).toBe('');
  });
});

describe('normaliseSection', () => {
  it('reads every spelling of a section the same way', () => {
    for (const raw of ['Section 11 (6)', 's.11(6)', 'Sec. 11(6)', '11 ( 6 )']) {
      expect(normaliseSection(raw)).toBe('11(6)');
    }
    expect(normaliseSection('S. 34')).toBe('34');
  });
});

describe('extractIssueTags', () => {
  it('returns normalised proposals, never confirmed', async () => {
    const { gateway, run } = gatewayReturning({
      tags: [
        {
          statute: 'The Arbitration and Conciliation Act, 1996',
          section: 'Section 34',
          issue: ' Setting aside ',
          confidence: 0.9,
        },
        { statute: 'Limitation Act', section: null, issue: null, confidence: 0.7 },
      ],
    });
    const tags = await extractIssueTags(gateway, scope, 'pleading text');
    expect(tags).toEqual([
      {
        statute: 'arbitration and conciliation act',
        section: '34',
        issue: 'Setting aside',
        confidence: 0.9,
        status: 'proposed',
        source: 'ai',
      },
      {
        statute: 'limitation act',
        section: '',
        issue: null,
        confidence: 0.7,
        status: 'proposed',
        source: 'ai',
      },
    ]);
    expect(run).toHaveBeenCalledWith(
      'extract_issue_tags',
      { text: 'pleading text' },
      expect.objectContaining({ matterId: 'm1', purpose: 'research.issue_tags' }),
    );
  });

  it('drops low-confidence tags and merges duplicates keeping the most confident', async () => {
    const { gateway } = gatewayReturning({
      tags: [
        { statute: 'CPC', section: 'Order 7', issue: null, confidence: 0.2 },
        { statute: 'Arbitration Act', section: 's. 34', issue: null, confidence: 0.6 },
        {
          statute: 'Arbitration and Conciliation Act, 1996',
          section: '34',
          issue: 'x',
          confidence: 0.8,
        },
      ],
    });
    const tags = await extractIssueTags(gateway, scope, 'text');
    expect(tags).toHaveLength(1);
    expect(tags[0]).toMatchObject({ section: '34', confidence: 0.8, issue: 'x' });
  });

  it('rejects output that does not match the schema', async () => {
    const { gateway } = gatewayReturning({ tags: [{ statute: 'X', confidence: 3 }] });
    await expect(extractIssueTags(gateway, scope, 'text')).rejects.toThrow();
  });

  it('needs a matter in scope so the gateway can refuse a sensitive one', async () => {
    const { gateway, run } = gatewayReturning({ tags: [] });
    await expect(extractIssueTags(gateway, { workspaceId: 'w1' }, 'text')).rejects.toThrow(
      /matterId/,
    );
    expect(run).not.toHaveBeenCalled();
  });

  it('lets a sensitive-matter refusal from the gateway through, with no tags', async () => {
    const run = vi.fn().mockRejectedValue(new Error('sensitive'));
    await expect(extractIssueTags({ run }, scope, 'text')).rejects.toThrow('sensitive');
  });
});
