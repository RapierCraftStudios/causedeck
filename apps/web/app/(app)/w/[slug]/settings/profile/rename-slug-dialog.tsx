'use client';
// The owner-only `Rename` dialog of the workspace profile form (#284). Its own module so the form
// loads it lazily (`next/dynamic`) the first time an owner opens it; the form keeps the state.
import { Button } from '@causedeck/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@causedeck/ui/dialog';
import { Field } from '@causedeck/ui/field';
import { Input } from '@causedeck/ui/input';
import { useTranslations } from 'next-intl';
import type { SyntheticEvent } from 'react';

export interface RenameSlugDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  formId: string;
  value: string;
  onValueChange: (value: string) => void;
  error: string | undefined;
  /** Confirm stays disabled while saving or when the value is the current slug. */
  disabled: boolean;
  onSubmit: (event: SyntheticEvent) => void;
}

export function RenameSlugDialog({
  open,
  onOpenChange,
  formId,
  value,
  onValueChange,
  error,
  disabled,
  onSubmit,
}: RenameSlugDialogProps) {
  const t = useTranslations('settings.profile');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-slot="rename-slug-dialog">
        <DialogHeader>
          <DialogTitle>{t('renameTitle')}</DialogTitle>
          <DialogDescription>{t('renameBody')}</DialogDescription>
        </DialogHeader>
        {/* A separate form: the dialog portals out of the profile form. */}
        <form noValidate id={formId} onSubmit={onSubmit}>
          <Field label={t('newSlug')} error={error} hint={t('newSlugHint')}>
            <Input
              name="slug"
              value={value}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => {
                onValueChange(event.target.value);
              }}
            />
          </Field>
        </form>
        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            {t('cancel')}
          </Button>
          <Button type="submit" form={formId} disabled={disabled}>
            {t('renameConfirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
