// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithIntl } from '../../shell/__tests__/helpers.tsx';
import { AckDialog } from '../ack-dialog.tsx';
import { ConsistencyPanel } from '../consistency-panel.tsx';
import { DraftExportDialog } from '../export-dialog.tsx';

afterEach(cleanup);

const finding = {
  id: 'f1',
  severity: 'error',
  found: '12 March',
  expected: '14 March',
  span: { blockKey: 'b1', start: 0, end: 8 },
  provenance: { fact: 'hearing.date' },
  fix: { replacement: '14 March' },
} as never;

describe('AckDialog', () => {
  it('keeps Confirm off until the box is ticked, then calls the action', async () => {
    const onConfirm = vi.fn().mockResolvedValue(true);
    renderWithIntl(<AckDialog open onOpenChange={vi.fn()} count={2} onConfirm={onConfirm} />);
    const confirm = screen.getByRole('button', { name: 'Confirm' });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('I have verified these authorities myself'));
    expect((confirm as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(confirm);
    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledTimes(1);
    });
  });
});

describe('DraftExportDialog', () => {
  const props = {
    open: true,
    onOpenChange: vi.fn(),
    courtPreset: 'madras_hc',
    aiAssisted: true,
    onAcknowledge: vi.fn(),
    onExport: vi.fn().mockResolvedValue({ url: 'https://x.test/f', filename: 'memo.docx' }),
  };

  it('is blocked while a not-found citation is unacknowledged', () => {
    renderWithIntl(<DraftExportDialog {...props} unacknowledged={1} />);
    const action = screen.getByRole('button', { name: 'Export' });
    expect((action as HTMLButtonElement).disabled).toBe(true);
  });

  it('offers DOCX and PDF, downloads, and has no send, share or file button', async () => {
    renderWithIntl(<DraftExportDialog {...props} unacknowledged={0} />);
    expect(screen.getByRole('button', { name: 'Word document' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'PDF' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /send|share|file/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    expect(await screen.findByRole('link', { name: /memo\.docx/ })).toBeTruthy();
  });
});

describe('ConsistencyPanel', () => {
  it('needs the confirm step before a fix is applied', async () => {
    const onFix = vi.fn().mockResolvedValue(true);
    renderWithIntl(
      <ConsistencyPanel findings={[finding]} onJump={vi.fn()} onFix={onFix} onUndo={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Fix to graph value' }));
    expect(onFix).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Replace and save' }));
    await waitFor(() => {
      expect(onFix).toHaveBeenCalledWith(finding);
    });
  });
});
