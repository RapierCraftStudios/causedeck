import { describe, expect, it } from 'vitest';

import {
  SCORE,
  normaliseText,
  parseQuery,
  rankCommands,
  scoreText,
} from '../lib/commands/search.ts';
import type { Command, CommandGroupId } from '../lib/commands/types.ts';

// Tamil கொ: precomposed vowel sign O (U+0BCA) vs E + AA (U+0BC6 U+0BBE).
const TA_KO_COMPOSED = 'கொ';
const TA_KO_DECOMPOSED = 'கொ';
// Kannada ಕೀ: precomposed II (U+0CC0) vs I + length mark (U+0CBF U+0CD5).
const KN_KII_COMPOSED = 'ಕೀ';
const KN_KII_DECOMPOSED = 'ಕೀ';

describe('palette fuzzy search', () => {
  it('matches Latin text case-insensitively, including subsequences', () => {
    expect(scoreText('Matters', 'mat')).toBe(SCORE.prefix);
    expect(scoreText('Matters', 'mtrs')).toBe(SCORE.subsequence);
    expect(scoreText('Matters', 'xyz')).toBe(SCORE.none);
  });

  it('ranks exact prefix over word prefix over substring over subsequence', () => {
    expect(scoreText('Court fees', 'court')).toBe(SCORE.prefix);
    expect(scoreText('High court', 'court')).toBe(SCORE.wordPrefix);
    expect(scoreText('Highcourt', 'court')).toBe(SCORE.substring);
    expect(scoreText('Cash outstanding report', 'court')).toBe(SCORE.subsequence);
  });

  it('normalises to NFC so composed and decomposed Tamil match both ways', () => {
    expect(TA_KO_COMPOSED).not.toBe(TA_KO_DECOMPOSED);
    expect(normaliseText(TA_KO_DECOMPOSED)).toBe(TA_KO_COMPOSED);
    const word = `${TA_KO_DECOMPOSED}ச்சி`;
    expect(scoreText(word, TA_KO_COMPOSED)).toBe(SCORE.prefix);
    expect(scoreText(`${TA_KO_COMPOSED}ச்சி`, TA_KO_DECOMPOSED)).toBe(SCORE.prefix);
  });

  it('normalises to NFC so composed and decomposed Kannada match both ways', () => {
    expect(normaliseText(KN_KII_DECOMPOSED)).toBe(KN_KII_COMPOSED);
    expect(scoreText(`ಮಾ${KN_KII_DECOMPOSED}`, KN_KII_COMPOSED)).toBe(SCORE.substring);
    expect(scoreText(`${KN_KII_COMPOSED}ಲಿ`, KN_KII_DECOMPOSED)).toBe(SCORE.prefix);
  });

  it('matches Tamil and Kannada by grapheme subsequence and ranks their prefix first', () => {
    // வழக்குகள் (matters): வக skips the zha cluster.
    expect(scoreText('வழக்குகள்', 'வக்')).toBe(SCORE.subsequence);
    expect(scoreText('வழக்குகள்', 'வழ')).toBe(SCORE.prefix);
    // ಪ್ರಕರಣಗಳು (matters)
    expect(scoreText('ಪ್ರಕರಣಗಳು', 'ಪ್ರ')).toBe(SCORE.prefix);
    expect(scoreText('ಹೊಸ ಪ್ರಕರಣ', 'ಪ್ರ')).toBe(SCORE.wordPrefix);
    expect(scoreText('ಪ್ರಕರಣಗಳು', 'ಕಳು')).toBe(SCORE.subsequence);
    expect(scoreText('ಪ್ರಕರಣಗಳು', 'ಸಹಾ')).toBe(SCORE.none);
  });
});

describe('palette query prefixes', () => {
  it('parses > as commands and / as navigation, stripping the prefix', () => {
    expect(parseQuery('>')).toEqual({ mode: 'commands', query: '' });
    expect(parseQuery('> new matter')).toEqual({ mode: 'commands', query: 'new matter' });
    expect(parseQuery('/today')).toEqual({ mode: 'navigation', query: 'today' });
    expect(parseQuery(' today ')).toEqual({ mode: 'all', query: 'today' });
  });
});

describe('rankCommands', () => {
  const command = (id: string, group: CommandGroupId, keywords?: string[]): Command => ({
    id,
    labelKey: id,
    group,
    ...(keywords ? { keywords } : {}),
    perform: () => undefined,
  });
  const labels: Record<string, string> = {
    a: 'Open matters',
    b: 'Matters',
    c: 'New matter',
    d: 'Settings',
    e: 'Help',
  };
  const list = [
    command('a', 'goTo'),
    command('b', 'goTo'),
    command('c', 'create'),
    command('d', 'settings'),
    command('e', 'help', ['shortcuts']),
  ];
  const rank = (raw: string) =>
    rankCommands(list, raw, (entry) => labels[entry.id] ?? '').map((entry) => entry.command.id);

  it('puts the exact prefix first and keeps ties in registry order', () => {
    expect(rank('matter')).toEqual(['b', 'a', 'c']);
    expect(rank('')).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('searches keywords', () => {
    expect(rank('short')).toEqual(['e']);
  });

  it('limits > to commands and / to navigation', () => {
    expect(rank('>')).toEqual(['c', 'd', 'e']);
    expect(rank('> matter')).toEqual(['c']);
    expect(rank('/')).toEqual(['a', 'b']);
    expect(rank('/ new')).toEqual([]);
  });
});
