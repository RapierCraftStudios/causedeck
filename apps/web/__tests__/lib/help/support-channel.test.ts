// Support channel (#94): WhatsApp from NEXT_PUBLIC_SUPPORT_WHATSAPP, email when it is unset or invalid.
import { describe, expect, it } from 'vitest';

import { SUPPORT_EMAIL, supportChannel } from '../../../components/help/support-contact.tsx';

describe('supportChannel', () => {
  it('uses the WhatsApp number when set', () => {
    expect(supportChannel('+91 98765 43210')).toEqual({
      kind: 'whatsapp',
      number: '+919876543210',
      href: 'https://wa.me/919876543210',
    });
  });

  it('falls back to email when unset or not a number', () => {
    for (const value of [undefined, '', 'abc', '123']) {
      expect(supportChannel(value)).toMatchObject({ kind: 'email', email: SUPPORT_EMAIL });
    }
  });
});
