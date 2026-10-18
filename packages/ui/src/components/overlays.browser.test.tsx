// Overlays and navigation in a real browser: motion timing from the tokens, prefers-reduced-motion
// (instant, no transform or fade), and the phone layouts (dialog as a bottom sheet, scrolling
// tabs with an edge fade, dropdown as a bottom sheet list).
import '../styles/globals.css';

import { render, screen } from '@testing-library/react';
import { commands, page } from '@vitest/browser/context';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from './accordion';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from './popover';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from './sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs';

/** Wait `n` animation frames (Radix positions popper content a frame or two after mount). */
const frames = async (n: number) => {
  for (let i = 0; i < n; i += 1) await new Promise(requestAnimationFrame);
};

/** Radix popper content has `animation: none` inline until it is positioned. */
const positioned = (element: HTMLElement) =>
  expect.poll(() => getComputedStyle(element).animationName).not.toBe('none');

const seconds = (value: string) => Number.parseFloat(value) * (value.endsWith('ms') ? 0.001 : 1);

function DialogOpen() {
  return (
    <Dialog defaultOpen>
      <DialogContent>
        <DialogTitle>Reschedule hearing</DialogTitle>
        <DialogDescription>Pick the next date.</DialogDescription>
      </DialogContent>
    </Dialog>
  );
}

function SheetOpen() {
  return (
    <Sheet defaultOpen>
      <SheetContent side="bottom">
        <SheetTitle>Filter matters</SheetTitle>
        <SheetDescription>Narrow the list.</SheetDescription>
      </SheetContent>
    </Sheet>
  );
}

function PopoverExample({ open }: { open: boolean }) {
  return (
    <Popover open={open}>
      <PopoverTrigger>Next hearing</PopoverTrigger>
      <PopoverContent data-testid="popover">14 Nov 2026, Court 12</PopoverContent>
    </Popover>
  );
}

function MenuOpen() {
  return (
    <DropdownMenu defaultOpen>
      <DropdownMenuTrigger>Actions</DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem>Open matter</DropdownMenuItem>
        <DropdownMenuItem>Archive matter</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AccordionExample() {
  return (
    <Accordion type="single" collapsible>
      <AccordionItem value="a">
        <AccordionTrigger>Hearings</AccordionTrigger>
        <AccordionContent data-testid="accordion">Next hearing on 14 Nov 2026.</AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

/** Open by click: Radix skips the animation for items that start open. */
async function openAccordion() {
  render(<AccordionExample />);
  screen.getByRole('button', { name: 'Hearings' }).click();
  return screen.findByTestId('accordion');
}

const TAB_NAMES = ['Hearings', 'Documents', 'Tasks', 'Notes', 'Billing', 'Parties', 'History'];

function ManyTabs() {
  return (
    <Tabs defaultValue="Hearings">
      <TabsList data-testid="tabs">
        {TAB_NAMES.map((name) => (
          <TabsTrigger key={name} value={name}>
            {name}
          </TabsTrigger>
        ))}
      </TabsList>
      {TAB_NAMES.map((name) => (
        <TabsContent key={name} value={name}>
          {name}
        </TabsContent>
      ))}
    </Tabs>
  );
}

/** The element Radix marks open, found by role or test id. */
const OPEN: [string, () => ReactElement, () => HTMLElement][] = [
  ['dialog', DialogOpen, () => screen.getByRole('dialog')],
  ['sheet', SheetOpen, () => screen.getByRole('dialog')],
  ['popover', () => <PopoverExample open />, () => screen.getByTestId('popover')],
  ['dropdown-menu', MenuOpen, () => screen.getByRole('menu')],
];

afterEach(async () => {
  await commands.emulateReducedMotion('no-preference');
  await page.viewport(1280, 900);
});

describe('motion timing', () => {
  it('menus and popovers open over 150 ms --ease-enter and close over 100 ms --ease-exit', async () => {
    const { rerender } = render(<PopoverExample open />);
    const popover = screen.getByTestId('popover');
    await positioned(popover);
    const opening = getComputedStyle(popover);
    expect(seconds(opening.animationDuration)).toBeCloseTo(0.15);
    expect(opening.animationTimingFunction).toBe('cubic-bezier(0, 0, 0.2, 1)');

    rerender(<PopoverExample open={false} />);
    // Radix keeps the content mounted while the exit animation runs.
    expect(popover).toHaveAttribute('data-state', 'closed');
    const closing = getComputedStyle(popover);
    expect(seconds(closing.animationDuration)).toBeCloseTo(0.1);
    expect(closing.animationTimingFunction).toBe('cubic-bezier(0.4, 0, 1, 1)');
  });

  it('dialogs open over 200 ms and sheets slide over 250 ms --ease-emphasized', () => {
    const { unmount } = render(<DialogOpen />);
    expect(seconds(getComputedStyle(screen.getByRole('dialog')).animationDuration)).toBeCloseTo(
      0.2,
    );
    unmount();
    render(<SheetOpen />);
    const sheet = getComputedStyle(screen.getByRole('dialog'));
    expect(seconds(sheet.animationDuration)).toBeCloseTo(0.25);
    expect(sheet.animationTimingFunction).toBe('cubic-bezier(0.3, 0, 0, 1)');
  });

  it('accordion content animates its height over 200 ms', async () => {
    const content = getComputedStyle(await openAccordion());
    expect(content.animationName).toBe('accordion-down');
    expect(seconds(content.animationDuration)).toBeCloseTo(0.2);
  });
});

describe('prefers-reduced-motion: reduce', () => {
  it.each(OPEN)('%s opens instantly: no transform, no fade', async (name, Example, find) => {
    await commands.emulateReducedMotion('reduce');
    render(<Example />);
    const element = find();
    if (name === 'popover' || name === 'dropdown-menu') await positioned(element);
    const style = getComputedStyle(element);
    expect(seconds(style.animationDuration)).toBeLessThanOrEqual(0.00001);
    expect(style.transform).toBe('none');
    // Instant: two frames later the final state is already showing.
    await frames(2);
    expect(getComputedStyle(element).opacity).toBe('1');
  });

  it('accordion content opens instantly', async () => {
    await commands.emulateReducedMotion('reduce');
    const content = getComputedStyle(await openAccordion());
    expect(seconds(content.animationDuration)).toBeLessThanOrEqual(0.00001);
  });
});

describe('phone layouts (360 px)', () => {
  it('a dialog becomes a bottom sheet under 768 px and is centred above it', async () => {
    await page.viewport(360, 800);
    const { unmount } = render(<DialogOpen />);
    const sheet = screen.getByRole('dialog');
    expect(sheet).toHaveAttribute('data-layout', 'sheet');
    expect(sheet.querySelector('[data-slot="sheet-handle"]')).not.toBeNull();
    await Promise.all(sheet.getAnimations().map((animation) => animation.finished));
    expect(Math.round(sheet.getBoundingClientRect().bottom)).toBe(800);
    expect(Math.round(sheet.getBoundingClientRect().width)).toBe(360);
    unmount();

    await page.viewport(1280, 900);
    render(<DialogOpen />);
    expect(screen.getByRole('dialog')).toHaveAttribute('data-layout', 'dialog');
  });

  it('tabs scroll horizontally with an edge fade when they overflow', async () => {
    await page.viewport(360, 800);
    render(<ManyTabs />);
    const list = screen.getByTestId('tabs');
    await expect.poll(() => list.hasAttribute('data-fade-end')).toBe(true);
    expect(list.scrollWidth).toBeGreaterThan(list.clientWidth);
    expect(getComputedStyle(list).overflowX).toBe('auto');
    expect(getComputedStyle(list).maskImage).toContain('linear-gradient');
  });
});
