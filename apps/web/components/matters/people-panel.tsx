'use client';
// The People tab (#393, #40 part 5): the matter's people grouped by role edge (we represent,
// appears for, instructed by, assigned to, opposite side), each with who they are (party, advocate,
// court or government staff, client, professional contact), their other names and, only for
// clients and professional contacts, their contact details. Groups without people are left out;
// with nobody at all, the empty state offers one primary action. Members with `matter.write` get
// Add person, Edit and Remove (confirmed); for everyone else those controls are absent, not
// disabled. A role held on one of the matter's proceedings is shown but changed on the
// Proceedings tab. Offline, changes are off. There is no contact-book import or search across
// workspaces: the form writes only this workspace's person.
import { Alert } from '@causedeck/ui/alert';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@causedeck/ui/alert-dialog';
import { Badge } from '@causedeck/ui/badge';
import { Button } from '@causedeck/ui/button';
import { EmptyState } from '@causedeck/ui/empty-state';
import { UserPlus, Users } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';

import type {
  PeopleGroupView,
  PersonEntryView,
  RoleEdgeKindView,
} from '../../lib/matters/people.ts';
import type { Result } from '../../lib/safe-action.ts';

import { useMatterAnnounce } from './matter-announcer.tsx';
import { useOnline } from './matters-offline-banner.tsx';
import { PersonForm, type UpsertPersonAction } from './person-form.tsx';

export type SetRoleEdgeAction = (input: {
  workspaceId: string;
  matterId: string;
  personId: string;
  kind: RoleEdgeKindView;
  remove?: boolean;
}) => Promise<Result<{ edgeId: string } | { removed: true }>>;

export interface PeoplePanelProps {
  workspaceId: string;
  matterId: string;
  groups: PeopleGroupView[];
  /** `matter.write`: Add person, Edit and Remove. */
  canWrite: boolean;
  actions: { upsertPerson: UpsertPersonAction; setRoleEdge: SetRoleEdgeAction };
  /** Dev preview of the offline state. */
  forcedOffline?: boolean;
}

/** Tamil or Kannada script in a name, for `lang` (shaping and screen-reader voice). */
export function scriptLang(text: string): 'ta' | 'kn' | undefined {
  if (/[஀-௿]/.test(text)) return 'ta';
  if (/[ಀ-೿]/.test(text)) return 'kn';
  return undefined;
}

type Editing = { person: PersonEntryView | undefined } | null;
type Removing = { person: PersonEntryView; kind: RoleEdgeKindView } | null;

function PersonRow({
  person,
  kind,
  canWrite,
  offline,
  onEdit,
  onRemove,
}: {
  person: PersonEntryView;
  kind: RoleEdgeKindView;
  canWrite: boolean;
  offline: boolean;
  onEdit: (button: HTMLButtonElement) => void;
  onRemove: (button: HTMLButtonElement) => void;
}) {
  const t = useTranslations('matters.workspace.people');
  const { contact } = person;
  return (
    <li
      data-person={person.id}
      className="border-line flex flex-col gap-1 border-b py-3 last:border-b-0 md:flex-row md:items-start md:justify-between md:gap-4"
    >
      <div className="flex min-w-0 flex-col gap-1">
        <p className="flex flex-wrap items-center gap-2">
          <span className="font-medium" lang={scriptLang(person.name)}>
            {person.name}
          </span>
          <Badge tone="neutral" data-person-kind={person.kind}>
            {t(`personKinds.${person.kind}`)}
          </Badge>
          {person.onProceeding ? <Badge tone="outline">{t('onProceeding')}</Badge> : null}
        </p>
        {person.aliases.length === 0 ? null : (
          <p className="text-ink-muted text-sm" data-person-aliases="">
            {t('aliases', { aliases: person.aliases.join(', ') })}
          </p>
        )}
        {contact === null ? null : (
          <dl
            data-person-contact=""
            className="text-ink-muted grid gap-x-2 text-sm sm:grid-cols-[auto_1fr]"
          >
            {contact.email === null ? null : (
              <>
                <dt>{t('contact.email')}</dt>
                <dd className="break-all">{contact.email}</dd>
              </>
            )}
            {contact.phone === null ? null : (
              <>
                <dt>{t('contact.phone')}</dt>
                <dd className="tabular-nums">{contact.phone}</dd>
              </>
            )}
            {contact.address === null ? null : (
              <>
                <dt>{t('contact.address')}</dt>
                <dd>{contact.address}</dd>
              </>
            )}
          </dl>
        )}
      </div>
      {canWrite ? (
        <div className="flex shrink-0 gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-person-edit=""
            aria-label={t('edit', { name: person.name })}
            disabled={offline}
            onClick={(event) => {
              onEdit(event.currentTarget);
            }}
          >
            {t('form.editTitle')}
          </Button>
          {person.onMatter ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-person-remove={kind}
              aria-label={t('remove', { name: person.name })}
              disabled={offline}
              onClick={(event) => {
                onRemove(event.currentTarget);
              }}
            >
              {t('removeConfirm')}
            </Button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

export function PeoplePanel({
  workspaceId,
  matterId,
  groups,
  canWrite,
  actions,
  forcedOffline = false,
}: PeoplePanelProps) {
  const t = useTranslations('matters.workspace.people');
  const tw = useTranslations('matters.workspace');
  const router = useRouter();
  const announce = useMatterAnnounce();
  const online = useOnline();
  const offline = forcedOffline || !online;
  const [editing, setEditing] = useState<Editing>(null);
  const [removing, setRemoving] = useState<Removing>(null);
  const [removeFailed, setRemoveFailed] = useState(false);
  const [removePending, setRemovePending] = useState(false);
  const invoker = useRef<HTMLElement | null>(null);
  const shown = groups.filter((group) => group.people.length > 0);

  async function onConfirmRemove() {
    if (removing === null || removePending || offline) return;
    setRemovePending(true);
    setRemoveFailed(false);
    let result: Awaited<ReturnType<SetRoleEdgeAction>>;
    try {
      result = await actions.setRoleEdge({
        workspaceId,
        matterId,
        personId: removing.person.id,
        kind: removing.kind,
        remove: true,
      });
    } catch {
      result = { ok: false, error: { code: 'INTERNAL', message: '' } };
    }
    setRemovePending(false);
    if (!result.ok) {
      setRemoveFailed(true);
      return;
    }
    announce(t('announceRemoved', { name: removing.person.name }));
    setRemoving(null);
    router.refresh();
  }

  const addButton = canWrite ? (
    <Button
      type="button"
      data-people-add=""
      disabled={offline}
      onClick={(event) => {
        invoker.current = event.currentTarget;
        setEditing({ person: undefined });
      }}
    >
      <UserPlus aria-hidden="true" />
      {t('add')}
    </Button>
  ) : undefined;

  return (
    <section
      data-slot="people-panel"
      aria-labelledby="matter-people-title"
      className="flex flex-col gap-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="matter-people-title" className="font-serif text-xl font-medium">
          {t('title')}
        </h2>
        {shown.length === 0 ? null : addButton}
      </div>
      {offline && canWrite ? (
        <Alert tone="warning" role="status">
          {tw('offlineAction')}
        </Alert>
      ) : null}

      {shown.length === 0 ? (
        <EmptyState
          data-pattern-state="empty"
          data-people="empty"
          icon={<Users />}
          title={t('empty')}
          action={addButton}
        />
      ) : (
        <div aria-label={t('listLabel')} className="flex flex-col gap-4" role="group">
          {shown.map((group) => (
            <section
              key={group.kind}
              data-people-group={group.kind}
              aria-labelledby={`people-group-${group.kind}`}
              className="border-line bg-surface rounded-lg border px-4 py-1"
            >
              <h3
                id={`people-group-${group.kind}`}
                className="text-ink-muted pt-3 text-sm font-medium"
              >
                {t(`kinds.${group.kind}`)}
              </h3>
              <ul>
                {group.people.map((person) => (
                  <PersonRow
                    key={person.id}
                    person={person}
                    kind={group.kind}
                    canWrite={canWrite}
                    offline={offline}
                    onEdit={(button) => {
                      invoker.current = button;
                      setEditing({ person });
                    }}
                    onRemove={(button) => {
                      invoker.current = button;
                      setRemoveFailed(false);
                      setRemoving({ person, kind: group.kind });
                    }}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {canWrite && editing !== null ? (
        <PersonForm
          key={editing.person?.id ?? 'new'}
          workspaceId={workspaceId}
          matterId={matterId}
          action={actions.upsertPerson}
          open
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
          person={editing.person}
          offline={offline}
          returnFocus={() => invoker.current}
        />
      ) : null}

      {canWrite ? (
        <AlertDialog
          open={removing !== null}
          onOpenChange={(open) => {
            if (!open) setRemoving(null);
          }}
        >
          <AlertDialogContent
            data-slot="person-remove-dialog"
            onCloseAutoFocus={(event) => {
              const target = invoker.current;
              if (target === null || !target.isConnected) return;
              event.preventDefault();
              target.focus();
            }}
          >
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t('removeTitle', { name: removing?.person.name ?? '' })}
              </AlertDialogTitle>
              <AlertDialogDescription>{t('removeHint')}</AlertDialogDescription>
            </AlertDialogHeader>
            {removeFailed ? (
              <Alert tone="danger" role="alert">
                {t('removeFailed')}
              </Alert>
            ) : null}
            <AlertDialogFooter>
              <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
              <Button
                type="button"
                variant="destructive"
                data-person-remove-confirm=""
                loading={removePending}
                disabled={removePending || offline}
                onClick={() => void onConfirmRemove()}
              >
                {t('removeConfirm')}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </section>
  );
}
