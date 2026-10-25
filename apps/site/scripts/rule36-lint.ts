// Rule 36 copy lint (issue #89): CauseDeck is software for advocates, not legal services, so public
// copy never advertises lawyers, ranks them, or shows testimonials or outcomes. Scans MDX content
// and the TSX that renders public copy; the build fails on any finding.
//   tsx scripts/rule36-lint.ts
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const DENYLIST: readonly RegExp[] = [
  /best\s+(lawyer|advocate|attorney)s?/i,
  /top\s+(lawyer|advocate|attorney)s?/i,
  /win\s+rates?/i,
  /guaranteed?\s+(outcome|result)s?/i,
  /find\s+an?\s+(lawyer|advocate|attorney)/i,
  /hire\s+an?\s+(lawyer|advocate|attorney)/i,
  /client\s+reviews?/i,
  /testimonials?/i,
  /(lawyer|advocate)\s+directory/i,
  /case\s+outcomes?/i,
];

/** A component, function, class or file named `Testimonial*` or `Directory*`. */
const FORBIDDEN_NAME = /\b(?:Testimonial|Directory)[A-Za-z0-9_]*/;
const DECLARATION = new RegExp(
  `(?:function|const|let|class|interface|type)\\s+${FORBIDDEN_NAME.source}|<${FORBIDDEN_NAME.source}|import\\s+(?:\\{[^}]*)?${FORBIDDEN_NAME.source}`,
);

export interface Finding {
  file: string;
  line: number;
  message: string;
}

export function scanText(file: string, text: string): Finding[] {
  const findings: Finding[] = [];
  const isCode = /\.(tsx?|jsx?)$/.test(file);
  text.split('\n').forEach((content, index) => {
    for (const pattern of DENYLIST) {
      const match = pattern.exec(content);
      if (match) {
        findings.push({ file, line: index + 1, message: `denylisted term "${match[0]}"` });
      }
    }
    if (isCode) {
      const declared = DECLARATION.exec(content);
      if (declared) {
        findings.push({ file, line: index + 1, message: `forbidden component name in "${declared[0]}"` });
      }
    }
  });
  if (/^(Testimonial|Directory)/i.test(path.basename(file))) {
    findings.push({ file, line: 1, message: 'forbidden file name (Testimonial* or Directory*)' });
  }
  return findings;
}

const SCANNED_DIRS = ['content', 'app', 'components'];
const SCANNED_EXT = /\.(mdx|tsx?)$/;

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return SCANNED_EXT.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

export function scanSite(root: string): Finding[] {
  return SCANNED_DIRS.flatMap((dir) => {
    try {
      return walk(path.join(root, dir));
    } catch {
      return [];
    }
  }).flatMap((file) =>
    scanText(path.relative(root, file), readFileSync(file, 'utf8')),
  );
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const findings = scanSite(process.cwd());
  for (const finding of findings) {
    console.error(`${finding.file}:${finding.line}: Rule 36: ${finding.message}`);
  }
  if (findings.length > 0) {
    console.error(`Rule 36 lint failed with ${findings.length} finding(s).`);
    process.exit(1);
  }
  console.log('Rule 36 lint passed.');
}
