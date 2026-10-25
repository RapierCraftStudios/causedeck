// MDX pipeline: `content/**/*.mdx` only (the plain `.md` learn and developer docs have their own
// loaders in src/). Runs at build time; invalid frontmatter or a duplicate title fails the build.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { compileMDX } from 'next-mdx-remote/rsc';
import type { ReactElement } from 'react';

import { parseFrontmatter, type Frontmatter } from './frontmatter.ts';

export const CONTENT_DIR = path.join(process.cwd(), 'content');

export interface MdxPage {
  /** Path segments below `content/`, e.g. `['legal', 'draft-notice']`. */
  slug: string[];
  frontmatter: Frontmatter;
  content: ReactElement;
}

async function mdxFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return mdxFiles(full);
      return entry.name.endsWith('.mdx') ? [full] : [];
    }),
  );
  return nested.flat().sort();
}

export async function loadMdxFile(
  file: string,
  components: Record<string, unknown> = {},
  contentDir: string = CONTENT_DIR,
): Promise<MdxPage> {
  const source = await readFile(file, 'utf8');
  const { content, frontmatter } = await compileMDX({
    source,
    options: { parseFrontmatter: true },
    components: components as never,
  });
  const slug = path
    .relative(contentDir, file)
    .replace(/\.mdx$/, '')
    .split(path.sep);
  return {
    slug,
    frontmatter: parseFrontmatter(frontmatter, path.relative(process.cwd(), file)),
    content,
  };
}

function assertUnique(pages: MdxPage[], key: 'title' | 'description'): void {
  const seen = new Map<string, string>();
  for (const page of pages) {
    const value = page.frontmatter[key].toLowerCase();
    const where = page.slug.join('/');
    const other = seen.get(value);
    if (other !== undefined) {
      throw new Error(`Duplicate ${key} on content/${other}.mdx and content/${where}.mdx`);
    }
    seen.set(value, where);
  }
}

export async function loadAllMdx(
  components: Record<string, unknown> = {},
  contentDir: string = CONTENT_DIR,
): Promise<MdxPage[]> {
  const files = await mdxFiles(contentDir);
  const pages = await Promise.all(files.map((file) => loadMdxFile(file, components, contentDir)));
  assertUnique(pages, 'title');
  assertUnique(pages, 'description');
  return pages;
}

export async function loadMdxPage(
  slug: string[],
  components: Record<string, unknown> = {},
): Promise<MdxPage | undefined> {
  const pages = await loadAllMdx(components);
  return pages.find((page) => page.slug.join('/') === slug.join('/'));
}
