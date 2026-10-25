'use client';
// The memory screen's edit sheet and delete confirmation (#73). Edit changes the value, and for an
// owner the chamber-sharing choice (a court note shared with the chamber); no other role is offered
// it. Delete names the consequence: the embeddings are removed within 24 hours.
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@causedeck/ui/alert-dialog';
import { Button } from '@causedeck/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@causedeck/ui/sheet';
import { Textarea } from '@causedeck/ui/textarea';
import { useTranslations } from 'next-intl';
import { useState, type SyntheticEvent } from 'react';

import type { CardView } from '../../../../../../lib/memory/memory-state.ts';

export interface EditSheetProps {
  card: CardView | null;
  isOwner: boolean;
  pending: boolean;
  onClose: () => void;
  onSave: (input: { value: string; sharedWithChamber?: boolean }) => void;
}

export function EditSheet({ card, isOwner, pending, onClose, onSave }: EditSheetProps) {
  return (
    <Sheet
      open={card !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent data-slot="memory-edit-sheet">
        {card === null ? null : (
          <EditForm
            key={card.id}
            card={card}
            isOwner={isOwner}
            pending={pending}
            onSave={onSave}
            onClose={onClose}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function EditForm({
  card,
  isOwner,
  pending,
  onSave,
  onClose,
}: Omit<EditSheetProps, 'card'> & { card: CardView }) {
  const t = useTranslations('memory.edit');
  const [value, setValue] = useState(card.value);
  const [shared, setShared] = useState(card.sharedWithChamber);
  const [touched, setTouched] = useState(false);
  // Chamber sharing exists for a court note (M4); only the owner sees the choice.
  const canShare = isOwner && card.layer === 'M4';
  const empty = value.trim() === '';
  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    setTouched(true);
    if (empty) return;
    onSave({
      value: value.trim(),
      ...(canShare && shared !== card.sharedWithChamber ? { sharedWithChamber: shared } : {}),
    });
  };
  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <SheetHeader>
        <SheetTitle>{t('title')}</SheetTitle>
        <SheetDescription>
          {card.title}. {t('description')}
        </SheetDescription>
      </SheetHeader>
      <label className="flex flex-col gap-1 text-sm">
        {t('value')}
        <Textarea
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
          }}
          aria-invalid={touched && empty ? true : undefined}
        />
        {touched && empty ? (
          <span role="alert" className="text-danger text-xs">
            {t('valueRequired')}
          </span>
        ) : null}
      </label>
      <fieldset className="flex flex-col gap-2">
        <legend className="text-ink mb-1 text-sm font-medium">{t('scope')}</legend>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="radio"
            name="scope"
            checked={!shared}
            disabled={!canShare}
            onChange={() => {
              setShared(false);
            }}
          />
          {t('scopeUser')}
        </label>
        {canShare ? (
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="radio"
              name="scope"
              checked={shared}
              onChange={() => {
                setShared(true);
              }}
            />
            {t('scopeWorkspace')}
          </label>
        ) : (
          <p className="text-ink-muted text-xs">{t('chamberHint')}</p>
        )}
      </fieldset>
      <SheetFooter>
        <Button type="button" variant="ghost" onClick={onClose}>
          {t('cancel')}
        </Button>
        <Button type="submit" disabled={pending}>
          {t('save')}
        </Button>
      </SheetFooter>
    </form>
  );
}

export interface DeleteDialogProps {
  card: CardView | null;
  pending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function DeleteDialog({ card, pending, onClose, onConfirm }: DeleteDialogProps) {
  const t = useTranslations('memory.delete');
  return (
    <AlertDialog
      open={card !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <AlertDialogContent data-slot="memory-delete-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>{t('title')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('description', { title: card?.title ?? '' })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
          <AlertDialogAction disabled={pending} onClick={onConfirm}>
            {t('confirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
