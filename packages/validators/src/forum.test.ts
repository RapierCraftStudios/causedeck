import { describe, expect, it } from 'vitest';

import {
  DeepLinkTemplateSchema,
  ForumConfigSchema,
  ForumSeedSchema,
  LanguageProfileSchema,
  templateHost,
} from './forum';

const config = {
  hosts: ['primary.example.test', 'second.example.test'],
  deepLinks: { cause_list: 'cause_list.php', orders: 'https://second.example.test/orders/' },
};

const seed = {
  code: 'in.xx.example-court.principal',
  court: 'Example High Court',
  establishment: 'Principal Seat',
  seat: 'Example City',
  side: 'appellate',
  jurisdictionKind: 'high_court',
  languageProfile: { primary: 'en' },
  adapterId: 'in.xx.example-court.principal',
  adapterLevel: 'A1',
  enabled: true,
  config,
} as const;

describe('forum schemas (#34)', () => {
  it('accepts ISO 639-1 language profiles only', () => {
    expect(
      LanguageProfileSchema.safeParse({ primary: 'ta', secondary: ['en'], ocr: ['ta', 'en'] })
        .success,
    ).toBe(true);
    expect(LanguageProfileSchema.safeParse({ primary: 'tamil' }).success).toBe(false);
    expect(LanguageProfileSchema.safeParse({ primary: 'en', rating: 5 }).success).toBe(false);
  });

  it('keeps hosts as a non-empty ordered list of bare hostnames', () => {
    expect(ForumConfigSchema.parse(config).hosts).toEqual(config.hosts);
    expect(ForumConfigSchema.safeParse({ ...config, hosts: [] }).success).toBe(false);
    expect(
      ForumConfigSchema.safeParse({ ...config, hosts: ['https://x.example.test'] }).success,
    ).toBe(false);
  });

  it('rejects an embed flag or any other unknown config key', () => {
    expect(ForumConfigSchema.safeParse({ ...config, embed: true }).success).toBe(false);
    expect(ForumConfigSchema.safeParse({ ...config, iframe: 'x' }).success).toBe(false);
  });

  it('accepts path and https templates with {name} placeholders, on a listed host only', () => {
    expect(DeepLinkTemplateSchema.safeParse('status/{caseType}/{number}').success).toBe(true);
    expect(DeepLinkTemplateSchema.safeParse('cause-list-%E2%81%84-daily-board/').success).toBe(
      true,
    );
    expect(DeepLinkTemplateSchema.safeParse('http://x.example.test/').success).toBe(false);
    expect(DeepLinkTemplateSchema.safeParse('//x.example.test/a').success).toBe(false);
    expect(DeepLinkTemplateSchema.safeParse('javascript:alert(1)').success).toBe(false);
    expect(templateHost('https://x.example.test/a')).toBe('x.example.test');
    expect(templateHost('a/b')).toBeUndefined();
    expect(
      ForumConfigSchema.safeParse({
        ...config,
        deepLinks: { orders: 'https://other.example.test/' },
      }).success,
    ).toBe(false);
  });

  it('accepts an AIMS portal template (#395)', () => {
    expect(
      ForumConfigSchema.safeParse({
        ...config,
        deepLinks: { ...config.deepLinks, aims: 'https://primary.example.test/aims/' },
      }).success,
    ).toBe(true);
  });

  it('needs a disabled reason on a disabled forum, and A0 or A1', () => {
    expect(ForumSeedSchema.safeParse(seed).success).toBe(true);
    expect(ForumSeedSchema.safeParse({ ...seed, enabled: false }).success).toBe(false);
    expect(
      ForumSeedSchema.safeParse({
        ...seed,
        enabled: false,
        config: { ...config, disabledReason: 'Planned in v2.' },
      }).success,
    ).toBe(true);
    expect(ForumSeedSchema.safeParse({ ...seed, adapterLevel: 'A2' }).success).toBe(false);
    expect(ForumSeedSchema.safeParse({ ...seed, code: 'Not A Code' }).success).toBe(false);
  });
});
