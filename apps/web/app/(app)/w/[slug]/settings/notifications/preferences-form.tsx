'use client';
// Notification preferences (#199, #23 UI spec). From 768 px a matrix table (rows are categories,
// columns In-app / Email / Push) of switches; under 768 px one card per category with three
// switches. Mandatory channels (`security.alert` in-app and email) are checked, disabled and carry
// a lock with the explanation. Below the matrix: the digest selector (`Instant / Daily at 6:30 pm /
// Off`, which drives the `digest.daily` email, so that category has no row), `Do not push during
// court hours` and `Show details on lock screen`. Every change saves at once through its server
// action, optimistically, and rolls back with an error message if the save fails. With no
// categories to show (#288 empty state) the matrix gives way to `No notification settings...`.
import { Alert } from '@causedeck/ui/alert';
import { Button } from '@causedeck/ui/button';
import { EmptyState } from '@causedeck/ui/empty-state';
import { Field } from '@causedeck/ui/field';
import { Skeleton, SkeletonGroup } from '@causedeck/ui/skeleton';
import { Switch } from '@causedeck/ui/switch';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@causedeck/ui/table';
import { ToggleGroup, ToggleGroupItem } from '@causedeck/ui/toggle-group';
import {
  CATEGORY_KEYS,
  CHANNELS,
  DIGESTS,
  type CategoryKey,
  type Channel,
  type Digest,
} from '@causedeck/notifications/categories';
import { BellOff, Lock } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';

import type { Result } from '../../../../../../lib/safe-action.ts';

import type { PreferenceView, SettingsView } from './actions.ts';

export interface PreferencesActions {
  setPreference: (input: {
    workspaceId: string;
    category: CategoryKey;
    channel: Channel;
    enabled: boolean;
  }) => Promise<Result<PreferenceView>>;
  setDigest: (input: {
    workspaceId: string;
    digest: Digest;
  }) => Promise<Result<{ digest: Digest }>>;
  setCourtHoursQuiet: (input: {
    workspaceId: string;
    enabled: boolean;
  }) => Promise<Result<SettingsView>>;
  setLockScreenDetails: (input: {
    workspaceId: string;
    enabled: boolean;
  }) => Promise<Result<SettingsView>>;
}

export interface PreferencesFormProps {
  workspaceId: string;
  preferences: readonly PreferenceView[];
  digest: Digest;
  settings: SettingsView;
  actions: PreferencesActions;
}

/** The digest selector drives this category's email, so it has no row of its own. */
const ROWS = CATEGORY_KEYS.filter((key) => key !== 'digest.daily');

/** Message ids for the dotted category keys (next-intl keys cannot contain dots). */
const CATEGORY_MESSAGE = {
  'workspace.invite': 'workspaceInvite',
  'member.joined': 'memberJoined',
  'security.alert': 'securityAlert',
  'billing.notice': 'billingNotice',
  'reminder.hearing': 'reminderHearing',
  'proposal.new': 'proposalNew',
  'court.board': 'courtBoard',
  'judgment.alert': 'judgmentAlert',
  'status.next_date': 'statusNextDate',
  'status.order': 'statusOrder',
  'status.stage': 'statusStage',
  'digest.daily': 'digestDaily',
  'digest.end_of_day': 'digestEndOfDay',
  'system.notice': 'systemNotice',
} as const satisfies Record<CategoryKey, string>;

const CHANNEL_MESSAGE = { in_app: 'inApp', email: 'email', push: 'push' } as const satisfies Record<
  Channel,
  string
>;

const cellKey = (category: CategoryKey, channel: Channel) => `${category}:${channel}`;

type Status = { kind: 'idle' } | { kind: 'saved' } | { kind: 'error' };

export function PreferencesForm({
  workspaceId,
  preferences,
  digest: initialDigest,
  settings: initialSettings,
  actions,
}: PreferencesFormProps) {
  const t = useTranslations('notifications.preferences');
  const mandatoryId = useId();
  const [cells, setCells] = useState<Record<string, PreferenceView>>(() =>
    Object.fromEntries(preferences.map((p) => [cellKey(p.category, p.channel), p])),
  );
  const [digest, setDigestValue] = useState<Digest>(initialDigest);
  const [settings, setSettings] = useState<SettingsView>(initialSettings);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  /** Apply `next` now; save; on failure put `undo` back and say so. */
  async function save<O>(apply: () => void, undo: () => void, send: () => Promise<Result<O>>) {
    apply();
    setStatus({ kind: 'idle' });
    let ok = false;
    try {
      ok = (await send()).ok;
    } catch {
      ok = false;
    }
    if (ok) {
      setStatus({ kind: 'saved' });
    } else {
      undo();
      setStatus({ kind: 'error' });
    }
  }

  const toggleCell = (category: CategoryKey, channel: Channel, enabled: boolean) => {
    const key = cellKey(category, channel);
    const previous = cells[key];
    if (previous === undefined || previous.locked) return;
    const put = (value: boolean) => {
      setCells((current) => ({ ...current, [key]: { ...previous, enabled: value } }));
    };
    void save(
      () => {
        put(enabled);
      },
      () => {
        put(previous.enabled);
      },
      () => actions.setPreference({ workspaceId, category, channel, enabled }),
    );
  };

  const chooseDigest = (next: string) => {
    if (!(DIGESTS as readonly string[]).includes(next) || next === digest) return;
    const previous = digest;
    void save(
      () => {
        setDigestValue(next as Digest);
      },
      () => {
        setDigestValue(previous);
      },
      () => actions.setDigest({ workspaceId, digest: next as Digest }),
    );
  };

  const toggleSetting = (name: keyof SettingsView, enabled: boolean) => {
    const previous = settings[name];
    const send =
      name === 'courtHoursQuiet' ? actions.setCourtHoursQuiet : actions.setLockScreenDetails;
    void save(
      () => {
        setSettings((current) => ({ ...current, [name]: enabled }));
      },
      () => {
        setSettings((current) => ({ ...current, [name]: previous }));
      },
      () => send({ workspaceId, enabled }),
    );
  };

  const categoryLabel = (category: CategoryKey) =>
    t(`categories.${CATEGORY_MESSAGE[category]}.label`);
  const channelLabel = (channel: Channel) => t(`channels.${CHANNEL_MESSAGE[channel]}`);

  const cellSwitch = (category: CategoryKey, channel: Channel) => {
    const cell = cells[cellKey(category, channel)];
    if (cell === undefined) return null;
    return (
      <span className="inline-flex items-center gap-2">
        <Switch
          checked={cell.enabled}
          disabled={cell.locked}
          aria-label={t('switchLabel', {
            category: categoryLabel(category),
            channel: channelLabel(channel),
          })}
          aria-describedby={cell.locked ? mandatoryId : undefined}
          data-category={category}
          data-channel={channel}
          onCheckedChange={(value) => {
            toggleCell(category, channel, value);
          }}
        />
        {cell.locked ? (
          <Lock aria-label={t('lockedLabel')} role="img" className="text-ink-muted size-3.5" />
        ) : null}
      </span>
    );
  };

  const isMandatory = (category: CategoryKey) =>
    CHANNELS.some((channel) => cells[cellKey(category, channel)]?.locked === true);

  const categoryText = (category: CategoryKey, withExplanationId: boolean) => (
    <div className="flex flex-col gap-0.5">
      <span className="font-medium">{categoryLabel(category)}</span>
      <span className="text-ink-muted text-xs">
        {t(`categories.${CATEGORY_MESSAGE[category]}.description`)}
      </span>
      {isMandatory(category) ? (
        <span
          id={withExplanationId ? mandatoryId : undefined}
          data-slot="mandatory-explanation"
          className="text-ink-muted inline-flex items-start gap-1 text-xs"
        >
          <Lock aria-hidden className="mt-0.5 size-3 shrink-0" />
          {t('mandatory')}
        </span>
      ) : null}
    </div>
  );

  return (
    <div data-slot="notification-preferences" className="flex flex-col gap-8">
      {preferences.length === 0 ? (
        <EmptyState
          data-pattern-state="empty"
          data-slot="preferences-empty"
          icon={<BellOff />}
          title={t('empty')}
          className="py-8"
        />
      ) : null}
      <div
        data-slot="preferences-matrix"
        className={preferences.length === 0 ? 'hidden' : 'hidden md:block'}
      >
        <Table>
          <TableCaption className="sr-only">{t('matrixCaption')}</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">{t('categoryHeader')}</TableHead>
              {CHANNELS.map((channel) => (
                <TableHead key={channel} scope="col" className="w-24 text-center">
                  {channelLabel(channel)}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {ROWS.map((category) => (
              <TableRow key={category} data-category={category}>
                <TableCell>{categoryText(category, true)}</TableCell>
                {CHANNELS.map((channel) => (
                  <TableCell key={channel} className="text-center">
                    {cellSwitch(category, channel)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ul
        data-slot="preferences-cards"
        className={preferences.length === 0 ? 'hidden' : 'flex flex-col gap-3 md:hidden'}
      >
        {ROWS.map((category) => (
          <li
            key={category}
            data-category={category}
            className="border-line bg-surface flex flex-col gap-3 rounded-lg border p-4"
          >
            {categoryText(category, false)}
            <div className="flex flex-col gap-2">
              {CHANNELS.map((channel) => (
                <div key={channel} className="flex items-center justify-between gap-3 text-sm">
                  <span aria-hidden>{channelLabel(channel)}</span>
                  {cellSwitch(category, channel)}
                </div>
              ))}
            </div>
          </li>
        ))}
      </ul>

      <Field label={t('digest.label')} hint={t('digest.hint')}>
        <ToggleGroup
          type="single"
          value={digest}
          onValueChange={chooseDigest}
          className="flex-wrap"
          data-slot="digest-selector"
        >
          {DIGESTS.map((value) => (
            <ToggleGroupItem key={value} value={value}>
              {t(`digest.${value}`)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </Field>

      <div className="flex flex-col gap-4">
        <Field label={t('courtHours.label')} hint={t('courtHours.hint')} orientation="horizontal">
          <Switch
            checked={settings.courtHoursQuiet}
            onCheckedChange={(value) => {
              toggleSetting('courtHoursQuiet', value);
            }}
          />
        </Field>
        <Field label={t('lockScreen.label')} hint={t('lockScreen.hint')} orientation="horizontal">
          <Switch
            checked={settings.lockScreenDetails}
            onCheckedChange={(value) => {
              toggleSetting('lockScreenDetails', value);
            }}
          />
        </Field>
      </div>

      <p role="status" aria-live="polite" className="text-sm">
        {status.kind === 'saved' ? <span className="text-ink-muted">{t('saved')}</span> : null}
        {status.kind === 'error' ? <span className="text-danger">{t('error')}</span> : null}
      </p>
    </div>
  );
}

export function PreferencesSkeleton() {
  const t = useTranslations('notifications.preferences');
  return (
    <SkeletonGroup
      data-slot="preferences-skeleton"
      data-pattern-state="loading"
      labels={{ loading: t('loading') }}
      className="gap-3"
    >
      {Array.from({ length: 7 }, (_, i) => (
        <div key={i} className="border-line flex items-center gap-3 border-b py-3">
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
          <Skeleton className="h-5 w-9" />
          <Skeleton className="h-5 w-9" />
          <Skeleton className="h-5 w-9" />
        </div>
      ))}
    </SkeletonGroup>
  );
}

export function PreferencesError() {
  const t = useTranslations('notifications.preferences');
  const router = useRouter();
  return (
    <Alert
      tone="danger"
      data-pattern-state="error"
      action={
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            router.refresh();
          }}
        >
          {t('retry')}
        </Button>
      }
    >
      {t('loadError')}
    </Alert>
  );
}
