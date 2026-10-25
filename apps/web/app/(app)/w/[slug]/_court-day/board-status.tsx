'use client';
// Offline banner and the polite live region of the board (#59), loaded in their own chunk.
import dynamic from 'next/dynamic';

const View = dynamic(() => import('./board-status-view.tsx').then((m) => m.BoardStatusView));

export function BoardStatus(props: { changes: number; readAt: Date | null }) {
  return <View {...props} />;
}
