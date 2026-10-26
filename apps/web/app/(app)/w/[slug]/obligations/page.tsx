import { SurfaceHelp } from '../../../../../components/help/surface-help.tsx';
import {
  placeholderPage,
  type WorkspacePageProps,
} from '../../../../../components/shell/placeholder-page.tsx';

const Placeholder = placeholderPage('obligations');

export default async function Page(props: WorkspacePageProps) {
  const base = await Placeholder(props);
  const { slug } = await props.params;
  return (
    <div className="flex flex-col gap-4">
      <SurfaceHelp slug={slug} surface="obligations" />
      {base}
    </div>
  );
}
