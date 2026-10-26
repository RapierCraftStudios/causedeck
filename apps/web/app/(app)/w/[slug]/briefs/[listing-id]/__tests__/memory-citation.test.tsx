// @vitest-environment jsdom
// The memory citation chip (#74): visible reason text and an accessible name.
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it } from 'vitest';

import { catalogs } from '../../../../../../../__tests__/helpers/intl.ts';
import { MemoryCitation } from '../_sheet/memory-citation.tsx';

afterEach(cleanup);

describe('MemoryCitation', () => {
  it('says why the item is suggested and has an accessible name', () => {
    render(
      <NextIntlClientProvider locale="en" messages={catalogs.en}>
        <MemoryCitation reason="carryRule" />
      </NextIntlClientProvider>,
    );
    const chip = screen.getByRole('note', { name: /because you usually carry this/i });
    expect(chip.textContent).toBe('because you usually carry this');
  });
});
