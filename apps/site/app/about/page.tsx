import path from 'node:path';

import { mdxComponents, Prose } from '../../components/prose.tsx';
import { CONTENT_DIR, loadMdxFile } from '../../lib/mdx.ts';
import { pageMetadata } from '../../lib/seo.ts';

const SOURCE = path.join(CONTENT_DIR, 'about.mdx');

export async function generateMetadata() {
  const page = await loadMdxFile(SOURCE);
  return pageMetadata({
    title: page.frontmatter.title,
    description: page.frontmatter.description,
    path: 'about',
  });
}

export default async function AboutPage() {
  const page = await loadMdxFile(SOURCE, mdxComponents);
  return <Prose>{page.content}</Prose>;
}
