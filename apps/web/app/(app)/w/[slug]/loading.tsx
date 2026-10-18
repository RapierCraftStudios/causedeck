import { RouteSkeleton } from '../../../../components/shell/route-skeleton.tsx';

/** Workspace route loading: skeleton blocks matching the page, never a spinner-only screen. */
export default function WorkspaceLoading() {
  return <RouteSkeleton />;
}
