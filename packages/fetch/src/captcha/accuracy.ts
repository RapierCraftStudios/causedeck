// First-try accuracy over a labelled captcha set (#492). A set is a directory of image files, each
// with a sibling `<stem>.txt` holding the expected answer. First try means one `solve` call per
// sample, no retry and no paid tier. The 500+ real labelled set is a human deliverable; the repo
// only ships a tiny synthetic sample under `fixtures/synthetic-captchas`.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import type { CaptchaSolver } from './solver.ts';

export const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.captcha'] as const;

export interface LabelledSample {
  name: string;
  image: Uint8Array;
  label: string;
}

export function loadLabelledSet(dir: string): LabelledSample[] {
  const files = readdirSync(dir).sort();
  const samples: LabelledSample[] = [];
  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    if (!(IMAGE_EXTENSIONS as readonly string[]).includes(ext)) continue;
    const stem = path.basename(file, path.extname(file));
    const labelFile = `${stem}.txt`;
    if (!files.includes(labelFile)) throw new Error(`No label file ${labelFile} for ${file}`);
    const label = readFileSync(path.join(dir, labelFile), 'utf8').trim();
    if (label === '') throw new Error(`Empty label in ${labelFile}`);
    samples.push({ name: file, image: new Uint8Array(readFileSync(path.join(dir, file))), label });
  }
  return samples;
}

export interface AccuracyReport {
  total: number;
  correct: number;
  /** The solver returned nothing (low confidence, unreadable, failed the shape check). */
  unreadable: number;
  wrong: { name: string; expected: string; got: string }[];
  /** correct / total, 0 for an empty set. */
  firstTryAccuracy: number;
}

export async function measureAccuracy(
  samples: readonly LabelledSample[],
  solver: CaptchaSolver,
  options: { caseSensitive?: boolean; host?: string; validate?: (text: string) => boolean } = {},
): Promise<AccuracyReport> {
  const norm = (text: string): string =>
    options.caseSensitive === true ? text : text.toLowerCase();
  let correct = 0;
  let unreadable = 0;
  const wrong: AccuracyReport['wrong'] = [];
  for (const sample of samples) {
    const attempt = await solver
      .solve({
        image: sample.image,
        host: options.host ?? 'accuracy-harness.invalid',
        ...(options.validate === undefined ? {} : { validate: options.validate }),
      })
      .catch(() => null);
    if (attempt === null) unreadable += 1;
    else if (norm(attempt.text) === norm(sample.label)) correct += 1;
    else wrong.push({ name: sample.name, expected: sample.label, got: attempt.text });
  }
  return {
    total: samples.length,
    correct,
    unreadable,
    wrong,
    firstTryAccuracy: samples.length === 0 ? 0 : correct / samples.length,
  };
}
