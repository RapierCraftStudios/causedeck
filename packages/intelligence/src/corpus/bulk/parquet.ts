// Parquet decoding for the dataset metadata (#890): the one place `hyparquet` is imported.
import { parquetReadObjects } from 'hyparquet';
import { compressors } from 'hyparquet-compressors';

import type { MetadataRow } from './metadata.ts';

export async function readParquetRows(bytes: Uint8Array): Promise<MetadataRow[]> {
  const file = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return (await parquetReadObjects({ file: file as ArrayBuffer, compressors })) as MetadataRow[];
}
