import { packageName as adaptersName } from '@causedeck/adapters';
import { packageName as aiName } from '@causedeck/ai';
import { packageName as authName } from '@causedeck/auth';
import { packageName as billingName } from '@causedeck/billing';
import { packageName as captureName } from '@causedeck/capture';
import { packageName as configName } from '@causedeck/config';
import { packageName as coreName } from '@causedeck/core';
import { isUuid } from '@causedeck/db';
import { packageName as draftingName } from '@causedeck/drafting';
import { packageName as flagsName } from '@causedeck/flags';
import { packageName as i18nName } from '@causedeck/i18n';
import { packageName as intelligenceName } from '@causedeck/intelligence';
import { packageName as notificationsName } from '@causedeck/notifications';
import { packageName as observabilityName } from '@causedeck/observability';
import { packageName as storageName } from '@causedeck/storage';
import { packageName as uiName } from '@causedeck/ui';
import { packageName as validatorsName } from '@causedeck/validators';
import { describe, expect, it } from 'vitest';

// @causedeck/db dropped its `packageName` placeholder in #15; a real export proves the import.
const dbName = typeof isUuid === 'function' ? '@causedeck/db' : 'missing';

const packages: [string, string][] = [
  ['adapters', adaptersName],
  ['ai', aiName],
  ['auth', authName],
  ['billing', billingName],
  ['capture', captureName],
  ['config', configName],
  ['core', coreName],
  ['db', dbName],
  ['drafting', draftingName],
  ['flags', flagsName],
  ['i18n', i18nName],
  ['intelligence', intelligenceName],
  ['notifications', notificationsName],
  ['observability', observabilityName],
  ['storage', storageName],
  ['ui', uiName],
  ['validators', validatorsName],
];

describe('workspace packages are importable from apps/web by name', () => {
  it('covers every package in spike §2', () => {
    expect(packages).toHaveLength(17);
  });

  it.each(packages)('@causedeck/%s', (dir, name) => {
    expect(name).toBe(`@causedeck/${dir}`);
  });
});
