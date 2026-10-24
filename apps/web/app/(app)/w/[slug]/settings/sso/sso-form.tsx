'use client';
// SSO provider settings (#683): the existing providers (enable switch, remove) and a form that adds
// or replaces one. The secret fields are write-only: they are sent on save and never shown again.
import { Button } from '@causedeck/ui/button';
import { Input } from '@causedeck/ui/input';
import { Label } from '@causedeck/ui/label';
import { Skeleton, SkeletonGroup } from '@causedeck/ui/skeleton';
import { toast } from '@causedeck/ui/sonner';
import { Switch } from '@causedeck/ui/switch';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useId, useState, type SyntheticEvent } from 'react';

import { SettingSection } from '../../../../../../components/settings/setting-section.tsx';
import { useOnline } from '../../../../../../components/settings/settings-offline-banner.tsx';
import type { Result } from '../../../../../../lib/safe-action.ts';

import type { SsoProviderView } from './actions.ts';

export function SsoSkeleton() {
  return (
    <SkeletonGroup>
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-48 w-full" />
    </SkeletonGroup>
  );
}

export interface SsoProviderFormProps {
  workspaceId: string;
  providers: SsoProviderView[];
  save: (input: unknown) => Promise<Result<SsoProviderView>>;
  remove: (input: unknown) => Promise<Result<{ id: string }>>;
}

export function SsoProviderForm({ workspaceId, providers, save, remove }: SsoProviderFormProps) {
  const t = useTranslations('settings.sso');
  const id = useId();
  const router = useRouter();
  const online = useOnline();
  const [protocol, setProtocol] = useState<'oidc' | 'saml'>('oidc');
  const [pending, setPending] = useState(false);

  async function run<T>(call: () => Promise<Result<T>>, done: 'saved' | 'removed') {
    setPending(true);
    let result: Result<T>;
    try {
      result = await call();
    } catch {
      result = { ok: false, error: { code: 'INTERNAL', message: '' } };
    }
    setPending(false);
    if (!result.ok) {
      toast(t(result.error.code === 'FORBIDDEN' ? 'toast.forbidden' : 'toast.failed'));
      return false;
    }
    toast(t(`toast.${done}`));
    router.refresh();
    return true;
  }

  async function onSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const field = (name: string) => {
      const value = data.get(name);
      return typeof value === 'string' ? value.trim() : '';
    };
    const settings =
      protocol === 'oidc'
        ? { clientId: field('clientId'), clientSecret: field('clientSecret') }
        : { entryPoint: field('entryPoint'), cert: field('cert') };
    const ok = await run(
      () =>
        save({
          workspaceId,
          protocol,
          issuer: field('issuer'),
          domain: field('domain'),
          enabled: true,
          settings,
        }),
      'saved',
    );
    if (ok) form.reset();
  }

  return (
    <>
      {providers.length === 0 ? (
        <p className="text-ink-muted text-sm" data-pattern-state="empty">
          {t('empty')}
        </p>
      ) : (
        <SettingSection id={`${id}-providers`} title={t('title')} description={t('description')}>
          <ul className="flex flex-col gap-3">
            {providers.map((provider) => (
              <li key={provider.id} className="flex items-center justify-between gap-3">
                <span className="min-w-0 text-sm">
                  <span className="block truncate font-medium">{provider.domain}</span>
                  <span className="text-ink-muted block truncate">
                    {provider.protocol.toUpperCase()} · {provider.issuer}
                  </span>
                </span>
                <Switch
                  checked={provider.enabled}
                  readOnly={!online || pending}
                  aria-label={`${provider.domain}: ${t(provider.enabled ? 'status.enabled' : 'status.disabled')}`}
                  onCheckedChange={(enabled) => {
                    void run(
                      () =>
                        save({
                          workspaceId,
                          providerId: provider.id,
                          protocol: provider.protocol,
                          issuer: provider.issuer,
                          domain: provider.domain,
                          enabled,
                        }),
                      'saved',
                    );
                  }}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!online || pending}
                  onClick={() => {
                    void run(() => remove({ workspaceId, providerId: provider.id }), 'removed');
                  }}
                >
                  {t('form.delete')}
                </Button>
              </li>
            ))}
          </ul>
        </SettingSection>
      )}
      <form onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-3">
        <div className="flex gap-2" role="group" aria-label={t('form.protocol')}>
          {(['oidc', 'saml'] as const).map((value) => (
            <Button
              key={value}
              type="button"
              size="sm"
              variant={protocol === value ? 'secondary' : 'ghost'}
              aria-pressed={protocol === value}
              onClick={() => {
                setProtocol(value);
              }}
            >
              {value.toUpperCase()}
            </Button>
          ))}
        </div>
        <Field id={`${id}-issuer`} name="issuer" label={t('form.issuer')} />
        <Field id={`${id}-domain`} name="domain" label={t('form.domain')} />
        {protocol === 'oidc' ? (
          <>
            <Field id={`${id}-clientId`} name="clientId" label={t('form.clientId')} />
            <Field
              id={`${id}-clientSecret`}
              name="clientSecret"
              label={t('form.clientSecret')}
              type="password"
            />
          </>
        ) : (
          <>
            <Field id={`${id}-entryPoint`} name="entryPoint" label={t('form.entryPoint')} />
            <Field id={`${id}-cert`} name="cert" label={t('form.cert')} />
          </>
        )}
        <Button type="submit" loading={pending} disabled={!online}>
          {t('form.save')}
        </Button>
      </form>
    </>
  );
}

function Field({
  id,
  name,
  label,
  type = 'text',
}: {
  id: string;
  name: string;
  label: string;
  type?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} name={name} type={type} autoComplete="off" required />
    </div>
  );
}
