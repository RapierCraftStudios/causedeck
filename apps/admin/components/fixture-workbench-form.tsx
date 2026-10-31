'use client';
// The fixture workbench form (#516): step one sends a contributed document through an adapter's
// parser; step two shows the rows for correction (hall, bench, item, case number, case type, year,
// parties, stage, and the list date) and builds the redacted fixture bundle for download.
import { Button } from '@causedeck/ui/button';
import { Input } from '@causedeck/ui/input';
import { Label } from '@causedeck/ui/label';
import { Textarea } from '@causedeck/ui/textarea';
import { useActionState } from 'react';

import {
  buildFixtureAction,
  previewFixtureAction,
  type WorkbenchState,
} from '../app/(console)/fixtures/actions.ts';

const INITIAL: WorkbenchState = {};
const FORMATS = [
  ['text', 'Text'],
  ['html', 'HTML'],
  ['email', 'Email (.eml)'],
] as const;

function Alert({ message }: { message: string | undefined }) {
  return message === undefined ? null : (
    <p role="alert" className="text-danger text-sm">
      {message}
    </p>
  );
}

export function FixtureWorkbenchForm({
  adapterIds,
  fetchEnabled = false,
}: {
  adapterIds: readonly string[];
  /** The governed one-off fetch input (#598), offered while `adapters.workbench-fetch` is on. */
  fetchEnabled?: boolean;
}) {
  const [previewState, preview, previewing] = useActionState(previewFixtureAction, INITIAL);
  const [buildState, build, building] = useActionState(buildFixtureAction, INITIAL);
  const rows = previewState.preview;
  const built = buildState.built;
  return (
    <div className="grid gap-6">
      <form action={preview} className="grid gap-3">
        <div className="grid gap-1">
          <Label htmlFor="adapterId">Adapter</Label>
          <select
            id="adapterId"
            name="adapterId"
            className="border-line rounded border p-2 text-sm"
          >
            {adapterIds.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-1">
          <Label htmlFor="format">Format</Label>
          <select id="format" name="format" className="border-line rounded border p-2 text-sm">
            {FORMATS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-1">
          <Label htmlFor="name">Fixture name</Label>
          <Input id="name" name="name" placeholder="list-13-shorthand" required />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="document">Document (paste text, or choose a file)</Label>
          <Textarea id="document" name="document" rows={10} />
          <Input id="file" name="file" type="file" aria-label="Document file" />
        </div>
        {fetchEnabled ? (
          <fieldset className="border-line grid gap-2 rounded border p-3">
            <legend className="text-ink-muted text-xs">
              Or fetch a public document (only when the box above and the file are empty)
            </legend>
            <div className="grid gap-1">
              <Label htmlFor="fetchSourceId">Registered source id</Label>
              <Input
                id="fetchSourceId"
                name="fetchSourceId"
                placeholder="in.ka.karnataka-hc.bengaluru:cause_list"
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="fetchUrl">URL on that source</Label>
              <Input id="fetchUrl" name="fetchUrl" type="url" placeholder="https://" />
            </div>
          </fieldset>
        ) : null}
        <div className="grid gap-1">
          <Label htmlFor="extraNames">Other names to replace (one per line)</Label>
          <Textarea id="extraNames" name="extraNames" rows={3} />
        </div>
        <Alert message={previewState.error} />
        <div>
          <Button type="submit" disabled={previewing}>
            Run parser
          </Button>
        </div>
      </form>

      {rows === undefined ? null : (
        <form action={build} className="grid gap-3">
          <input type="hidden" name="adapterId" value={rows.adapterId} />
          <input type="hidden" name="format" value={rows.format} />
          <input type="hidden" name="name" value={rows.name} />
          <input type="hidden" name="document" value={rows.document} />
          <input type="hidden" name="extraNames" value={rows.extraNames} />
          <h2 className="text-base font-semibold">Parser output</h2>
          <div className="grid gap-1">
            <Label htmlFor="listDate">List date</Label>
            <Input
              id="listDate"
              name="listDate"
              defaultValue={rows.listDate}
              placeholder="YYYY-MM-DD"
            />
          </div>
          {rows.rows.length === 0 ? <p className="text-sm">The parser found no rows.</p> : null}
          {rows.rows.map((row, index) => (
            <fieldset key={row.quote} className="border-line grid gap-2 rounded border p-3">
              <legend className="text-ink-muted text-xs">Row {index + 1}</legend>
              <p className="text-xs">{row.quote}</p>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                {Object.entries(row.cells).map(([field, value]) => (
                  <div key={field} className="grid gap-1">
                    <Label htmlFor={`row-${String(index)}-${field}`}>{field}</Label>
                    <Input
                      id={`row-${String(index)}-${field}`}
                      name={`row.${String(index)}.${field}`}
                      defaultValue={value}
                    />
                  </div>
                ))}
              </div>
            </fieldset>
          ))}
          <Alert message={buildState.error} />
          <div>
            <Button type="submit" disabled={building}>
              Redact and build fixture
            </Button>
          </div>
        </form>
      )}

      {built === undefined ? null : (
        <div className="grid gap-2">
          <h2 className="text-base font-semibold">Redacted fixture</h2>
          <p className="text-sm">
            {built.redactions.names} name replacements, {built.redactions.pii} personal-data
            replacements.
            {built.reparseMatches
              ? ''
              : ' The parser output on the redacted input differs from the expected file; review it.'}
          </p>
          <a
            className="text-sm underline"
            download={`${built.bundle.inputFile.replace(/\.input\.\w+$/, '')}.bundle.json`}
            href={`data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(built.bundle, null, 2))}`}
          >
            Download {built.bundle.inputFile} bundle
          </a>
        </div>
      )}
    </div>
  );
}
