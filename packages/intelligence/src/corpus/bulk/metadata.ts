// The dataset's metadata Parquet, mapped to `judgment` fields (#890). Column names are matched
// leniently: the datasets are third-party and a missing or renamed column costs that one field
// (the header extracted from the PDF text fills it), never the import.
import { canonicalNeutralCitation } from '../header.ts';

export interface BulkMetadata {
  court: string | null;
  neutralCitation: string | null;
  caseNumbers: string[];
  bench: string[];
  judgmentDate: string | null;
}

export type MetadataRow = Record<string, unknown>;

const str = (row: MetadataRow, ...names: string[]): string | null => {
  for (const name of names) {
    const value = row[name];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
  }
  return null;
};

/** The archive entry a row describes: the last path segment of its PDF path or link. */
export function rowEntryName(row: MetadataRow): string | null {
  const path = str(row, 'path', 'pdf_path', 'pdf_link', 'filename', 'file_name');
  if (path === null) return null;
  return path.split(/[\\/]/).pop()?.split('?')[0] ?? null;
}

function isoDate(value: string | null): string | null {
  if (value === null) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (iso !== null) return `${iso[1] ?? ''}-${iso[2] ?? ''}-${iso[3] ?? ''}`;
  const dmy = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(value);
  if (dmy !== null) return `${dmy[3] ?? ''}-${(dmy[2] ?? '').padStart(2, '0')}-${(dmy[1] ?? '').padStart(2, '0')}`;
  return null;
}

const list = (value: string | null, splitter: RegExp): string[] =>
  value === null
    ? []
    : value
        .split(splitter)
        .map((part) => part.trim())
        .filter((part) => part !== '');

export function mapMetadataRow(row: MetadataRow): BulkMetadata {
  const citation = str(row, 'nc_display', 'neutral_citation', 'citation');
  const caseNumber = str(row, 'case_no', 'case_number', 'case_id', 'cnr');
  return {
    court: str(row, 'court_code', 'court'),
    neutralCitation: citation === null ? null : canonicalNeutralCitation(citation),
    caseNumbers: caseNumber === null ? [] : [caseNumber],
    bench: list(str(row, 'judge', 'judges', 'bench'), /\s*[,;|]\s*/),
    judgmentDate: isoDate(str(row, 'decision_date', 'judgment_date', 'date')),
  };
}

/** Rows keyed by archive entry name; rows without a PDF path are dropped. */
export function indexMetadata(rows: readonly MetadataRow[]): Map<string, BulkMetadata> {
  const index = new Map<string, BulkMetadata>();
  for (const row of rows) {
    const name = rowEntryName(row);
    if (name !== null) index.set(name, mapMetadataRow(row));
  }
  return index;
}
