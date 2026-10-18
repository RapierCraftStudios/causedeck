// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SHEET_LABELS,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
  sheetContentVariants,
  type SheetSide,
} from './sheet';

function Example({ side, labels }: { side?: SheetSide; labels?: { close: string } }) {
  return (
    <Sheet>
      <SheetTrigger>Filters</SheetTrigger>
      <SheetContent side={side} labels={labels}>
        <SheetTitle>Filter matters</SheetTitle>
        <SheetDescription>Narrow the list by court and stage.</SheetDescription>
      </SheetContent>
    </Sheet>
  );
}

describe('Sheet', () => {
  it('opens a titled dialog on the inline end side by default', async () => {
    render(<Example />);
    await userEvent.click(screen.getByRole('button', { name: 'Filters' }));
    const sheet = screen.getByRole('dialog', { name: 'Filter matters' });
    expect(sheet).toHaveAttribute('data-side', 'end');
    expect(screen.getByRole('button', { name: DEFAULT_SHEET_LABELS.close })).toBeInTheDocument();
  });

  it('gives bottom sheets a drag handle, 16 px top radius and safe-area padding', async () => {
    render(<Example side="bottom" labels={{ close: 'ಮುಚ್ಚಿ' }} />);
    await userEvent.click(screen.getByRole('button', { name: 'Filters' }));
    const sheet = screen.getByRole('dialog');
    expect(sheet.querySelector('[data-slot="sheet-handle"]')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
    expect(sheet.className).toContain('rounded-t-xl');
    expect(sheet.className).toContain('env(safe-area-inset-bottom)');
    expect(screen.getByRole('button', { name: 'ಮುಚ್ಚಿ' })).toBeInTheDocument();
  });

  it('slides over 250 ms --ease-emphasized and uses logical sides', () => {
    for (const side of ['end', 'start', 'bottom'] as const) {
      const classes = sheetContentVariants({ side });
      expect(classes).toContain('data-[state=open]:duration-(--dur-slow)');
      expect(classes).toContain('data-[state=open]:ease-emphasized');
      expect(classes).toContain('z-modal');
    }
    expect(sheetContentVariants({ side: 'end' })).toContain('end-0');
    expect(sheetContentVariants({ side: 'start' })).toContain('start-0');
  });

  it('closes on Escape and returns focus', async () => {
    render(<Example />);
    const trigger = screen.getByRole('button', { name: 'Filters' });
    await userEvent.click(trigger);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(trigger).toHaveFocus();
  });
});
