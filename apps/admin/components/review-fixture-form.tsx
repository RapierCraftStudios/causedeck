'use client';
// Send a fixed review item to the fixture workbench in one action (#518): the reviewer supplies the
// document the parser misread (never stored), and the redacted bundle comes back for download.
import { Button } from '@causedeck/ui/button';
import { Input } from '@causedeck/ui/input';
import { Label } from '@causedeck/ui/label';
import { Textarea } from '@causedeck/ui/textarea';
import { useActionState } from 'react';

import { sendToWorkbenchAction, type ReviewActionState } from '../app/(console)/review/actions.ts';

const INITIAL: ReviewActionState = {};

export function ReviewFixtureForm({
  id,
  adapterIds,
}: {
  id: string;
  adapterIds: readonly string[];
}) {
  const [state, send, sending] = useActionState(sendToWorkbenchAction, INITIAL);
  const built = state.built;
  return (
    <form action={send} className="grid max-w-xl gap-3">
      <input type="hidden" name="id" value={id} />
      <div className="grid gap-1">
        <Label htmlFor="adapterId">Adapter</Label>
        <select id="adapterId" name="adapterId" className="border-line rounded border p-2 text-sm">
          {adapterIds.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </div>
      <div className="grid gap-1">
        <Label htmlFor="format">Format</Label>
        <select id="format" name="format" className="border-line rounded border p-2 text-sm">
          <option value="text">Text</option>
          <option value="html">HTML</option>
          <option value="email">Email (.eml)</option>
        </select>
      </div>
      <div className="grid gap-1">
        <Label htmlFor="name">Fixture name</Label>
        <Input id="name" name="name" required maxLength={100} />
      </div>
      <div className="grid gap-1">
        <Label htmlFor="document">Document</Label>
        <Textarea id="document" name="document" rows={8} required />
      </div>
      <Button type="submit" disabled={sending}>
        Send to workbench
      </Button>
      {state.error === undefined ? null : (
        <p role="alert" className="text-danger text-sm">
          {state.error}
        </p>
      )}
      {built === undefined ? null : (
        <a
          className="underline"
          download={`${built.bundle.inputFile.replace(/\.input\.\w+$/, '')}.bundle.json`}
          href={`data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(built.bundle, null, 2))}`}
        >
          Download {built.bundle.inputFile} bundle
        </a>
      )}
    </form>
  );
}
