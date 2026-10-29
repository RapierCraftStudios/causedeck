// India-only embeddings (#901, ADR 0046): the mock is the default, an India provider is allowed,
// anything else is refused and audited, and no fine-tuning or training client exists in this package.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import { ResidencyViolationError } from '../errors.ts';
import {
  createMockEmbedder,
  createProviderEmbedder,
  EMBEDDING_DIMENSIONS,
  guardEmbedder,
  requireIndiaRoute,
  type EmbeddingRefusal,
} from '../embeddings.ts';

const vectorOf = (n: number): Promise<number[]> =>
  Promise.resolve(new Array<number>(EMBEDDING_DIMENSIONS).fill(n));

describe('embeddings', () => {
  it('the mock embedder is deterministic, unit length and local', async () => {
    const mock = createMockEmbedder();
    const a = await mock.embed('prayer for a writ of mandamus');
    expect(mock.region).toBe('local');
    expect(a).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(Math.hypot(...a)).toBeCloseTo(1, 6);
    expect(await mock.embed('prayer for a writ of mandamus')).toEqual(a);
  });

  it('accepts an India-region provider and returns its vector', async () => {
    const audit = vi.fn();
    const provider = createProviderEmbedder({
      id: 'bedrock-titan',
      region: 'ap-south-1',
      embed: () => vectorOf(1),
    });
    expect(provider.region).toBe('india');
    const guarded = guardEmbedder(provider, audit);
    expect(await guarded.embed('x')).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(audit).not.toHaveBeenCalled();
  });

  it('refuses and audits a non-India provider without calling it', async () => {
    const events: EmbeddingRefusal[] = [];
    const embed = vi.fn(() => vectorOf(1));
    const provider = createProviderEmbedder({ id: 'us-embedder', region: 'us-east-1', embed });
    expect(provider.region).toBe('other');
    await expect(
      guardEmbedder(provider, (e) => void events.push(e)).embed('secret'),
    ).rejects.toBeInstanceOf(ResidencyViolationError);
    expect(embed).not.toHaveBeenCalled();
    expect(events).toEqual([
      {
        kind: 'embedding.refused',
        embedderId: 'us-embedder',
        region: 'us-east-1',
        reason: 'outside_india',
      },
    ]);
    expect(JSON.stringify(events)).not.toContain('secret');
  });

  it('requireIndiaRoute lets local and India embedders through unaudited', async () => {
    const audit = vi.fn();
    const mock = createMockEmbedder();
    expect(await requireIndiaRoute(mock, audit)).toBe(mock);
    expect(audit).not.toHaveBeenCalled();
  });

  it('rejects a vector of the wrong size', async () => {
    const bad = createProviderEmbedder({
      id: 'p',
      region: 'ap-south-2',
      embed: () => Promise.resolve([1, 2]),
    });
    await expect(guardEmbedder(bad, vi.fn()).embed('x')).rejects.toBeInstanceOf(RangeError);
  });
});

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === '__fixtures__' ? [] : sourceFiles(full);
    return full.endsWith('.ts') && !full.endsWith('.test.ts') ? [full] : [];
  });
}

const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// Identifiers and endpoints of model training: OpenAI /fine_tuning, Bedrock model customization,
// Vertex tuning jobs, generic "train"/"finetune" clients.
const TRAINING =
  /fine[-_ ]?tun|finetun|model[-_ ]?customi[sz]ation|CreateModelCustomizationJob|tuningJobs?|trainingJobs?|StartTraining|\.train\s*\(|createTrain/i;

describe('no training client (ADR 0046)', () => {
  const files = sourceFiles(srcDir);

  it('scans the package sources', () => {
    expect(files.map((f) => path.basename(f))).toEqual(
      expect.arrayContaining(['embeddings.ts', 'gateway.ts', 'bedrock.ts']),
    );
  });

  it.each(files.map((f) => [path.relative(srcDir, f), f]))(
    '%s has no fine-tuning or training client',
    (_name, file) => {
      expect(TRAINING.exec(stripComments(readFileSync(file, 'utf8')))?.[0]).toBeUndefined();
    },
  );
});
