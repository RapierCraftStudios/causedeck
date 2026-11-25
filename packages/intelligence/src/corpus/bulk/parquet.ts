// Parquet decoding for the dataset metadata (#890): the one place `hyparquet` is imported.
import { parquetMetadata, parquetReadObjects, parquetSchema } from 'hyparquet';
import { compressors } from 'hyparquet-compressors';

import type { MetadataRow } from './metadata.ts';

/**
 * The rows of a metadata Parquet. With `columns`, only those present in the file's schema are
 * decoded (a missing one costs only its field); none present gives no rows. Without, every column.
 */
export async function readParquetRows(
  bytes: Uint8Array,
  columns?: readonly string[],
): Promise<MetadataRow[]> {
  const file = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  if (columns === undefined) {
    return (await parquetReadObjects({ file, compressors })) as MetadataRow[];
  }
  const metadata = parquetMetadata(file);
  const present = new Set(parquetSchema(metadata).children.map((child) => child.element.name));
  const wanted = columns.filter((name) => present.has(name));
  if (wanted.length === 0) return [];
  return (await parquetReadObjects({
    file,
    metadata,
    columns: wanted,
    compressors,
  })) as MetadataRow[];
}
