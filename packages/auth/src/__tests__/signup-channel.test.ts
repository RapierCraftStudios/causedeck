import { ACTIVATION_CHANNELS } from '@causedeck/db/schema';
import { describe, expect, it } from 'vitest';

import {
  parseSignupChannel,
  SIGNUP_CHANNEL_COOKIE,
  signupChannelFromCookieHeader,
} from '../signup-channel';

describe('signup channel carrier', () => {
  it('accepts every closed-list channel and nothing else', () => {
    for (const channel of ACTIVATION_CHANNELS) expect(parseSignupChannel(channel)).toBe(channel);
    for (const bad of ['', 'Education', ' education', 'edu', 'direct;x', null, undefined]) {
      expect(parseSignupChannel(bad)).toBeNull();
    }
  });

  it('reads the cookie out of a Cookie header', () => {
    expect(signupChannelFromCookieHeader(`a=1; ${SIGNUP_CHANNEL_COOKIE}=education; b=2`)).toBe(
      'education',
    );
    expect(signupChannelFromCookieHeader(`${SIGNUP_CHANNEL_COOKIE}=bogus`)).toBeNull();
    expect(signupChannelFromCookieHeader('x_cd_channel=education')).toBeNull();
    expect(signupChannelFromCookieHeader(null)).toBeNull();
  });
});
