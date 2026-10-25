'use client';
// The drop zone of the bootstrap import (#552): drag-drop, a file picker and a folder picker
// (`webkitdirectory`). It only collects `File`s; the cap, allow-list and de-duplication are in
// `lib/import/file-rules.ts`.
import { Button } from '@causedeck/ui/button';
import { Upload } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, useState, type ChangeEvent, type DragEvent } from 'react';

import { IMPORT_ACCEPT, MAX_IMPORT_FILES } from '../../lib/import/file-rules.ts';

export interface DropZoneProps {
  disabled: boolean;
  onFiles: (files: File[]) => void;
}

interface DirectoryEntry {
  isFile: boolean;
  isDirectory: boolean;
  file?: (done: (file: File) => void, fail: () => void) => void;
  createReader?: () => { readEntries: (done: (entries: DirectoryEntry[]) => void) => void };
}

async function readEntry(entry: DirectoryEntry, out: File[]): Promise<void> {
  if (out.length > MAX_IMPORT_FILES * 5) return;
  if (entry.isFile && entry.file) {
    const read = entry.file;
    const file = await new Promise<File | null>((resolve) => {
      read.call(entry, resolve, () => {
        resolve(null);
      });
    });
    if (file !== null) out.push(file);
    return;
  }
  if (!entry.isDirectory || !entry.createReader) return;
  const reader = entry.createReader();
  for (;;) {
    const batch = await new Promise<DirectoryEntry[]>((resolve) => {
      reader.readEntries(resolve);
    });
    if (batch.length === 0) break;
    for (const child of batch) await readEntry(child, out);
  }
}

/** The files of a drop, folders included. */
async function filesOfDrop(event: DragEvent): Promise<File[]> {
  const items = Array.from(event.dataTransfer.items);
  const entries = items.flatMap((item) => {
    const entry = (
      item as unknown as { webkitGetAsEntry?: () => DirectoryEntry | null }
    ).webkitGetAsEntry?.();
    return entry ? [entry] : [];
  });
  if (entries.length === 0) return Array.from(event.dataTransfer.files);
  const out: File[] = [];
  for (const entry of entries) await readEntry(entry, out);
  return out;
}

export function DropZone({ disabled, onFiles }: DropZoneProps) {
  const t = useTranslations('bootstrapImport');
  const [over, setOver] = useState(false);
  const files = useRef<HTMLInputElement>(null);
  const folder = useRef<HTMLInputElement | null>(null);

  function picked(event: ChangeEvent<HTMLInputElement>) {
    const list = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (list.length > 0) onFiles(list);
  }

  return (
    <div
      data-slot="import-drop-zone"
      data-over={over ? 'true' : undefined}
      aria-disabled={disabled}
      onDragOver={(event) => {
        event.preventDefault();
        if (!disabled) setOver(true);
      }}
      onDragLeave={() => {
        setOver(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        if (disabled) return;
        void filesOfDrop(event).then((dropped) => {
          if (dropped.length > 0) onFiles(dropped);
        });
      }}
      className="data-[over=true]:border-primary flex flex-col items-center gap-3 rounded-lg border-2 border-dashed p-8 text-center"
    >
      <Upload aria-hidden="true" className="text-muted-foreground size-6" />
      <p className="font-medium">{t('drop.label')}</p>
      <p className="text-muted-foreground text-sm">{t('drop.hint', { max: MAX_IMPORT_FILES })}</p>
      <div className="flex flex-wrap justify-center gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          onClick={() => files.current?.click()}
        >
          {t('drop.choose')}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          onClick={() => folder.current?.click()}
        >
          {t('drop.folder')}
        </Button>
      </div>
      <input
        ref={files}
        type="file"
        multiple
        accept={IMPORT_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-label={t('drop.choose')}
        data-testid="import-file-input"
        onChange={picked}
      />
      <input
        ref={(element) => {
          folder.current = element;
          // Not in the React input attribute types: set on the element.
          element?.setAttribute('webkitdirectory', '');
        }}
        type="file"
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-label={t('drop.folder')}
        data-testid="import-folder-input"
        onChange={picked}
      />
    </div>
  );
}
