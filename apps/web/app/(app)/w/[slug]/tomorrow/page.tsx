// `/w/[slug]/tomorrow` (#59): the court-day board for the next IST day.
import {
  placeholderPage,
  type WorkspacePageProps,
} from '../../../../../components/shell/placeholder-page.tsx';
import { renderBoard } from '../_court-day/render-board.tsx';

const Placeholder = placeholderPage('tomorrow');

export default async function TomorrowPage(props: WorkspacePageProps) {
  const { base, board } = await renderBoard(props, 'tomorrow', Placeholder);
  return board ?? base;
}
