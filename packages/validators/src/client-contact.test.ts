// Client contact inputs (#82): E.164 phones, emails, one channel at least, strict objects.
import { describe, expect, it } from 'vitest';

import {
  ArchiveClientContactInput,
  ClientContactInput,
  LinkContactToMatterInput,
  UpdateClientContactInput,
} from './client-contact';

const personId = '8c5ab3c2-6a7e-4a43-8c4d-3f1b2d9b7a10';

describe('ClientContactInput', () => {
  it('accepts an E.164 phone and defaults the kind, language and relation', () => {
    const parsed = ClientContactInput.parse({ personId, phone: ' +919876543210 ' });
    expect(parsed).toMatchObject({
      phone: '+919876543210',
      kind: 'primary',
      languagePref: 'en',
      relation: 'represents',
    });
  });

  it.each(['9876543210', '+0123456789', '+91 98765 43210', '+12', '+1234567890123456'])(
    'rejects the phone %s',
    (phone) => {
      expect(ClientContactInput.safeParse({ personId, phone }).success).toBe(false);
    },
  );

  it('needs a phone or an email', () => {
    expect(ClientContactInput.safeParse({ personId }).success).toBe(false);
    expect(ClientContactInput.safeParse({ personId, email: 'a@example.in' }).success).toBe(true);
    expect(ClientContactInput.safeParse({ personId, email: 'not-an-email' }).success).toBe(false);
  });

  it('refuses unknown keys, kinds and languages', () => {
    expect(ClientContactInput.safeParse({ personId, phone: '+919876543210', lead: true }).success).toBe(false);
    expect(ClientContactInput.safeParse({ personId, email: 'a@example.in', kind: 'lead' }).success).toBe(false);
    expect(ClientContactInput.safeParse({ personId, email: 'a@example.in', languagePref: 'xx' }).success).toBe(false);
  });
});

describe('contact change inputs', () => {
  it('lets an update clear one channel but not be empty', () => {
    expect(UpdateClientContactInput.safeParse({ contactId: personId, phone: null }).success).toBe(true);
    expect(UpdateClientContactInput.safeParse({ contactId: personId }).success).toBe(false);
  });

  it('links with represents or instructed_by only', () => {
    const base = { contactId: personId, matterId: personId };
    expect(LinkContactToMatterInput.safeParse({ ...base, relation: 'instructed_by' }).success).toBe(true);
    expect(LinkContactToMatterInput.safeParse({ ...base, relation: 'opposes' }).success).toBe(false);
  });

  it('archives without purge by default', () => {
    expect(ArchiveClientContactInput.parse({ contactId: personId }).purge).toBe(false);
  });
});
