'use client';
// The invoice editor (#871, #83): a draft invoice for a matter, its lines, the GST treatment per
// line and a live-on-demand preview beside it. Shortcuts: `Cmd/Ctrl+S` saves the draft,
// `Cmd/Ctrl+Enter` marks it final (the server numbers it and freezes it); both fire while typing
// and are off while offline or once the invoice is final. While GST is unreviewed only an owner
// can mark an invoice final, and only after acknowledging it. Nothing is sent to the client.
import { Alert } from '@causedeck/ui/alert';
import { Button } from '@causedeck/ui/button';
import { Field } from '@causedeck/ui/field';
import { useHotkey } from '@causedeck/ui/hooks';
import { Input } from '@causedeck/ui/input';
import { GST_TREATMENTS, type GstTreatment } from '@causedeck/validators/fees';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { useOnline } from '../../../../../../components/matters/matters-offline-banner.tsx';
import { rupeesToPaise } from '../../../../../../lib/fees/money.ts';

import { feesErrorKey, type FeesActions } from './fees-actions.ts';
import { InvoicePreview, type PreviewLine, type PreviewTotals } from './invoice-preview.tsx';

export interface EditorLine {
  description: string;
  quantity: number;
  unitPricePaise: number;
  gstTreatment: string;
}

export interface EditorInitial {
  invoiceId?: string;
  matterId: string;
  personId: string;
  feeAgreementId?: string | null;
  placeOfSupplyStateCode: string;
  recipientGstin?: string | null;
  dueDate?: string | null;
  lines: readonly EditorLine[];
  supplierName: string;
}

export interface InvoiceEditorProps {
  workspaceId: string;
  basePath: string;
  initial: EditorInitial;
  /** Owners and advocates write; the editor is read-only otherwise. */
  canWrite: boolean;
  /** Only an owner may mark an invoice final while GST is unreviewed. */
  isOwner: boolean;
  actions: Pick<FeesActions, 'preview' | 'saveDraft' | 'discardDraft' | 'issue'>;
  /** Dev preview of the offline state. */
  forceOffline?: boolean;
}

interface FormLine {
  id: number;
  description: string;
  quantity: string;
  unitPrice: string;
  gstTreatment: GstTreatment;
}

const SELECT_CLASS = 'border-line-control bg-surface h-9 w-full rounded-md border px-2 text-sm';
const asTreatment = (value: string): GstTreatment =>
  (GST_TREATMENTS as readonly string[]).includes(value)
    ? (value as GstTreatment)
    : 'forward_charge';

export function InvoiceEditor({
  workspaceId,
  basePath,
  initial,
  canWrite,
  isOwner,
  actions,
  forceOffline = false,
}: InvoiceEditorProps) {
  const t = useTranslations('fees');
  const router = useRouter();
  const online = useOnline();
  const editable = canWrite && online && !forceOffline;
  const [invoiceId, setInvoiceId] = useState(initial.invoiceId);
  const [matterId, setMatterId] = useState(initial.matterId);
  const [personId, setPersonId] = useState(initial.personId);
  const [agreementId, setAgreementId] = useState(initial.feeAgreementId ?? '');
  const [placeOfSupply, setPlaceOfSupply] = useState(initial.placeOfSupplyStateCode);
  const [recipientGstin, setRecipientGstin] = useState(initial.recipientGstin ?? '');
  const [dueDate, setDueDate] = useState(initial.dueDate ?? '');
  const [supplierName, setSupplierName] = useState(initial.supplierName);
  const [supplierState, setSupplierState] = useState('');
  const [supplierGstin, setSupplierGstin] = useState('');
  const [counter, setCounter] = useState(initial.lines.length + 1);
  const [lines, setLines] = useState<FormLine[]>(() =>
    (initial.lines.length > 0
      ? initial.lines
      : [{ description: '', quantity: 1, unitPricePaise: 0, gstTreatment: 'forward_charge' }]
    ).map((line, index) => ({
      id: index,
      description: line.description,
      quantity: String(line.quantity),
      unitPrice: (line.unitPricePaise / 100).toFixed(2),
      gstTreatment: asTreatment(line.gstTreatment),
    })),
  );
  const [preview, setPreview] = useState<{
    lines: PreviewLine[];
    totals: PreviewTotals;
    gstUnreviewed: boolean;
  } | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const updateLine = (id: number, patch: Partial<FormLine>) => {
    setLines((current) => current.map((line) => (line.id === id ? { ...line, ...patch } : line)));
  };

  /** The invoice and supplier as the actions take them, or null while a number is malformed. */
  const build = () => {
    const priced = lines.map((line) => {
      const unitPricePaise = rupeesToPaise(line.unitPrice);
      const quantity = Number(line.quantity);
      if (unitPricePaise === null || !Number.isInteger(quantity) || quantity < 1) return null;
      return {
        description: line.description.trim(),
        quantity,
        unitPricePaise,
        amountPaise: quantity * unitPricePaise,
        gstTreatment: line.gstTreatment,
      };
    });
    if (priced.some((line) => line === null)) return null;
    return {
      invoice: {
        matterId: matterId.trim(),
        personId: personId.trim(),
        ...(agreementId.trim() === '' ? {} : { feeAgreementId: agreementId.trim() }),
        placeOfSupplyStateCode: placeOfSupply.trim(),
        ...(recipientGstin.trim() === '' ? {} : { recipientGstin: recipientGstin.trim() }),
        ...(dueDate === '' ? {} : { dueDate }),
        lines: priced,
      },
      supplier: {
        name: supplierName.trim(),
        stateCode: supplierState.trim(),
        ...(supplierGstin.trim() === '' ? {} : { gstin: supplierGstin.trim() }),
      },
    };
  };

  // While GST is unreviewed (or not yet previewed) the owner's acknowledgement gates "final".
  const gstGate = preview === null || preview.gstUnreviewed;
  const canIssue = isOwner ? !gstGate || acknowledged : !gstGate;

  const fail = (code: string) => {
    setError(t(`error.${feesErrorKey(code)}`));
  };

  const runPreview = async () => {
    const body = build();
    if (body === null) {
      fail('VALIDATION');
      return;
    }
    setBusy(true);
    setError(null);
    const result = await actions.preview({ workspaceId, ...body });
    setBusy(false);
    if (!result.ok) {
      fail(result.error.code);
      return;
    }
    const { invoice, gstUnreviewed } = result.data;
    setPreview({
      lines: invoice.lines,
      gstUnreviewed,
      totals: {
        taxablePaise: invoice.taxablePaise,
        cgst: invoice.cgst,
        sgst: invoice.sgst,
        igst: invoice.igst,
        rcmPaise: invoice.rcmPaise,
        totalPaise: invoice.totalPaise,
      },
    });
  };

  /** Saves the draft and returns its id, or undefined after showing the error. */
  const persist = async (): Promise<string | undefined> => {
    const body = build();
    if (body === null) {
      fail('VALIDATION');
      return undefined;
    }
    const result = await actions.saveDraft({
      workspaceId,
      ...(invoiceId === undefined ? {} : { invoiceId }),
      ...body,
    });
    if (!result.ok) {
      fail(result.error.code);
      return undefined;
    }
    setInvoiceId(result.data.id);
    return result.data.id;
  };

  const save = async () => {
    if (!editable || busy) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    const id = await persist();
    setBusy(false);
    if (id === undefined) return;
    setMessage(t('editor.saved'));
    if (invoiceId === undefined) router.replace(`${basePath}/${id}`);
    else router.refresh();
  };

  const issue = async () => {
    if (!editable || busy || !canIssue) return;
    const body = build();
    if (body === null) {
      fail('VALIDATION');
      return;
    }
    setBusy(true);
    setError(null);
    const id = await persist();
    if (id === undefined) {
      setBusy(false);
      return;
    }
    const result = await actions.issue({
      workspaceId,
      invoiceId: id,
      supplier: body.supplier,
      ...(acknowledged ? { acknowledgeUnreviewedGst: true } : {}),
    });
    setBusy(false);
    if (!result.ok) {
      fail(result.error.code);
      return;
    }
    router.replace(`${basePath}/${id}`);
    router.refresh();
  };

  const discard = async () => {
    if (!editable || busy || invoiceId === undefined) return;
    setBusy(true);
    setError(null);
    const result = await actions.discardDraft({ workspaceId, invoiceId });
    setBusy(false);
    if (!result.ok) {
      fail(result.error.code);
      return;
    }
    router.replace(basePath);
    router.refresh();
  };

  useHotkey(
    'mod+s',
    () => {
      void save();
    },
    { enabled: editable },
  );
  useHotkey(
    'mod+enter',
    () => {
      void issue();
    },
    { enabled: editable },
  );

  return (
    <div className="grid gap-6 lg:grid-cols-2" data-slot="invoice-editor">
      <form
        noValidate
        className="flex flex-col gap-4"
        aria-label={invoiceId === undefined ? t('editor.titleNew') : t('editor.titleDraft')}
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        {error === null ? null : (
          <Alert tone="danger" role="alert">
            {error}
          </Alert>
        )}
        {message === null ? null : (
          <Alert tone="success" role="status">
            {message}
          </Alert>
        )}
        <fieldset disabled={!editable} className="flex flex-col gap-4">
          <Field label={t('editor.matter')} required>
            <Input
              autoComplete="off"
              data-fees-field="matter"
              value={matterId}
              onChange={(event) => {
                setMatterId(event.target.value);
              }}
            />
          </Field>
          <Field label={t('editor.person')} required>
            <Input
              autoComplete="off"
              data-fees-field="person"
              value={personId}
              onChange={(event) => {
                setPersonId(event.target.value);
              }}
            />
          </Field>
          <Field label={t('editor.agreement')}>
            <Input
              autoComplete="off"
              data-fees-field="agreement"
              value={agreementId}
              onChange={(event) => {
                setAgreementId(event.target.value);
              }}
            />
          </Field>
          <Field label={t('editor.supplierName')} required>
            <Input
              data-fees-field="supplier-name"
              value={supplierName}
              onChange={(event) => {
                setSupplierName(event.target.value);
              }}
            />
          </Field>
          <Field label={t('editor.supplierState')} required>
            <Input
              inputMode="numeric"
              maxLength={2}
              data-fees-field="supplier-state"
              value={supplierState}
              onChange={(event) => {
                setSupplierState(event.target.value);
              }}
            />
          </Field>
          <Field label={t('editor.supplierGstin')}>
            <Input
              data-fees-field="supplier-gstin"
              value={supplierGstin}
              onChange={(event) => {
                setSupplierGstin(event.target.value);
              }}
            />
          </Field>
          <Field label={t('editor.placeOfSupply')} required>
            <Input
              inputMode="numeric"
              maxLength={2}
              data-fees-field="place-of-supply"
              value={placeOfSupply}
              onChange={(event) => {
                setPlaceOfSupply(event.target.value);
              }}
            />
          </Field>
          <Field label={t('editor.recipientGstin')}>
            <Input
              data-fees-field="recipient-gstin"
              value={recipientGstin}
              onChange={(event) => {
                setRecipientGstin(event.target.value);
              }}
            />
          </Field>
          <Field label={t('editor.dueDate')}>
            <Input
              type="date"
              data-fees-field="due-date"
              value={dueDate}
              onChange={(event) => {
                setDueDate(event.target.value);
              }}
            />
          </Field>

          <div className="flex flex-col gap-3" role="group" aria-label={t('editor.lines')}>
            <h3 className="font-medium">{t('editor.lines')}</h3>
            {lines.map((line) => (
              <div
                key={line.id}
                data-slot="invoice-line"
                className="border-line flex flex-col gap-3 rounded-md border p-3"
              >
                <Field label={t('editor.description')} required>
                  <Input
                    data-fees-field="line-description"
                    value={line.description}
                    onChange={(event) => {
                      updateLine(line.id, { description: event.target.value });
                    }}
                  />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label={t('editor.quantity')} required>
                    <Input
                      inputMode="numeric"
                      className="tabular-nums"
                      data-fees-field="line-quantity"
                      value={line.quantity}
                      onChange={(event) => {
                        updateLine(line.id, { quantity: event.target.value });
                      }}
                    />
                  </Field>
                  <Field label={t('editor.unitPrice')} required>
                    <Input
                      inputMode="decimal"
                      className="text-right tabular-nums"
                      data-fees-field="line-price"
                      value={line.unitPrice}
                      onChange={(event) => {
                        updateLine(line.id, { unitPrice: event.target.value });
                      }}
                    />
                  </Field>
                </div>
                <label className="flex flex-col gap-1 text-sm">
                  {t('editor.treatment')}
                  <select
                    className={SELECT_CLASS}
                    data-fees-field="line-treatment"
                    value={line.gstTreatment}
                    onChange={(event) => {
                      updateLine(line.id, { gstTreatment: asTreatment(event.target.value) });
                    }}
                  >
                    {GST_TREATMENTS.map((value) => (
                      <option key={value} value={value}>
                        {t(`gst.${value}`)}
                      </option>
                    ))}
                  </select>
                </label>
                {lines.length > 1 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="self-start"
                    onClick={() => {
                      setLines((current) => current.filter((entry) => entry.id !== line.id));
                    }}
                  >
                    {t('editor.removeLine')}
                  </Button>
                ) : null}
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              className="self-start"
              onClick={() => {
                setLines((current) => [
                  ...current,
                  {
                    id: counter,
                    description: '',
                    quantity: '1',
                    unitPrice: '0.00',
                    gstTreatment: 'forward_charge',
                  },
                ]);
                setCounter(counter + 1);
              }}
            >
              {t('editor.addLine')}
            </Button>
          </div>
        </fieldset>

        {isOwner && preview?.gstUnreviewed === true ? (
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={acknowledged}
              disabled={!editable}
              onChange={(event) => {
                setAcknowledged(event.target.checked);
              }}
            />
            <span>{t('editor.acknowledge')}</span>
          </label>
        ) : null}
        {!isOwner && preview?.gstUnreviewed === true ? (
          <Alert tone="warning" role="note">
            {t('editor.ownerOnly')}
          </Alert>
        ) : null}

        <div className="bg-surface sticky bottom-0 flex flex-wrap gap-2 py-3">
          <Button
            type="button"
            variant="outline"
            disabled={!editable || busy}
            onClick={() => void runPreview()}
          >
            {t('editor.preview')}
          </Button>
          <Button type="submit" variant="secondary" disabled={!editable || busy}>
            {t('editor.save')}
          </Button>
          <Button
            type="button"
            disabled={!editable || busy || !canIssue}
            onClick={() => void issue()}
          >
            {t('editor.issue')}
          </Button>
          {invoiceId === undefined ? null : (
            <Button
              type="button"
              variant="destructive"
              disabled={!editable || busy}
              onClick={() => void discard()}
            >
              {t('editor.discard')}
            </Button>
          )}
        </div>
        <p className="text-ink-muted text-xs" data-slot="fees-shortcuts">
          {t('shortcuts.save')} · {t('shortcuts.issue')}
        </p>
      </form>

      <div className="flex flex-col gap-3">
        {preview === null ? (
          <p className="text-ink-muted text-sm">{t('preview.empty')}</p>
        ) : (
          <InvoicePreview
            supplierName={supplierName}
            matterId={matterId}
            personId={personId}
            lines={preview.lines}
            totals={preview.totals}
            gstUnreviewed={preview.gstUnreviewed}
          />
        )}
      </div>
    </div>
  );
}
