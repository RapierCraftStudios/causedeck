// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { Tabs, TabsContent, TabsList, TabsTrigger, fadeMask } from './tabs';

function Example() {
  return (
    <Tabs defaultValue="hearings">
      <TabsList aria-label="Matter sections">
        <TabsTrigger value="hearings">Hearings</TabsTrigger>
        <TabsTrigger value="documents">Documents</TabsTrigger>
        <TabsTrigger value="tasks" disabled>
          Tasks
        </TabsTrigger>
      </TabsList>
      <TabsContent value="hearings">Next hearing on 14 Nov</TabsContent>
      <TabsContent value="documents">Vakalatnama</TabsContent>
      <TabsContent value="tasks">File reply</TabsContent>
    </Tabs>
  );
}

describe('Tabs', () => {
  it('renders an accessible tablist with data slots', () => {
    render(<Example />);
    const list = screen.getByRole('tablist', { name: 'Matter sections' });
    expect(list).toHaveAttribute('data-slot', 'tabs-list');
    expect(screen.getByRole('tab', { name: 'Hearings' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Next hearing on 14 Nov');
    expect(screen.getByRole('tab', { name: 'Tasks' })).toBeDisabled();
  });

  it('moves and activates with arrow keys, skipping disabled tabs', async () => {
    render(<Example />);
    await userEvent.tab();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Documents' })).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Hearings' })).toHaveFocus();
  });

  it('scrolls horizontally with token-styled triggers (44 px on coarse pointers)', () => {
    render(<Example />);
    expect(screen.getByRole('tablist').className).toContain('overflow-x-auto');
    const trigger = screen.getByRole('tab', { name: 'Hearings' });
    expect(trigger.className).toContain('pointer-coarse:h-11');
    expect(trigger.className).toContain('data-[state=active]:after:bg-accent');
    expect(trigger.className).not.toMatch(/shadow/);
  });

  it('fades only the overflowing edges, direction-aware', () => {
    expect(fadeMask({ start: false, end: false, rtl: false })).toBeUndefined();
    expect(fadeMask({ start: false, end: true, rtl: false })).toBe(
      'linear-gradient(to right, black, black calc(100% - 24px), transparent)',
    );
    expect(fadeMask({ start: true, end: true, rtl: true })).toBe(
      'linear-gradient(to left, transparent, black 24px, black calc(100% - 24px), transparent)',
    );
  });
});
