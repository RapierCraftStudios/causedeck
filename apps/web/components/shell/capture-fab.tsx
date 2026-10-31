'use client';

import { Mic, Paperclip, Plus, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter } from 'next/navigation';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';

import { loadShellOverlays, useShellOverlays } from './use-shell-overlays.ts';

export interface CaptureApi {
  /** Whether the capture sheet is open. */
  open: boolean;
  setOpen: Dispatch<SetStateAction<boolean>>;
  /** Open the capture sheet (the `c` shortcut in #157 calls this). */
  openCapture: () => void;
}

const CaptureContext = createContext<CaptureApi | null>(null);

const noop = () => undefined;
const NO_CAPTURE: CaptureApi = { open: false, setOpen: noop, openCapture: noop };

function useCaptureState(): CaptureApi {
  const [open, setOpen] = useState(false);
  return useMemo(
    () => ({
      open,
      setOpen,
      openCapture: () => {
        setOpen(true);
      },
    }),
    [open],
  );
}

/** Shares the capture sheet's open state across the shell. */
export function CaptureProvider({ children }: { children: ReactNode }) {
  const api = useCaptureState();
  return <CaptureContext.Provider value={api}>{children}</CaptureContext.Provider>;
}

/** The capture API, or no-op defaults outside `<CaptureProvider>`. */
export function useCapture(): CaptureApi {
  return useContext(CaptureContext) ?? NO_CAPTURE;
}

interface CaptureAction {
  id: 'voice' | 'file';
  icon: LucideIcon;
}

const ACTIONS: readonly CaptureAction[] = [
  { id: 'voice', icon: Mic },
  { id: 'file', icon: Paperclip },
];

/**
 * The bottom nav's centre slot: a 52 px accent circle raised 16 px above the bar, labelled
 * `Capture`. The circle ends at 36 px and the 12 px label sits at 42-54 px of the 56 px slot, so
 * the two never overlap. It opens a bottom sheet with the three capture actions.
 */
export function CaptureFab() {
  const t = useTranslations('shell');
  const overlays = useShellOverlays();
  const router = useRouter();
  const pathname = usePathname();
  const shared = useContext(CaptureContext);
  // Standalone (outside the provider) the button keeps its own state.
  const local = useCaptureState();
  const { open, setOpen } = shared ?? local;

  // Opened (by the button or `openCapture()`) before the overlay chunk arrived: load it now.
  useEffect(() => {
    if (open && !overlays) void loadShellOverlays();
  }, [open, overlays]);

  const trigger = (
    <button
      type="button"
      data-capture-trigger=""
      data-focus-key="capture"
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={
        overlays
          ? undefined
          : () => {
              setOpen(true);
            }
      }
      className="group/capture focus-visible:outline-ring relative flex h-14 min-h-11 w-full min-w-11 flex-col items-center justify-end pb-0.5 outline-none focus-visible:outline-2"
    >
      <span
        aria-hidden="true"
        data-capture-circle=""
        className="bg-accent text-accent-ink shadow-3 group-active/capture:bg-accent/80 absolute -top-4 left-1/2 flex size-[52px] -translate-x-1/2 items-center justify-center rounded-full"
      >
        <Plus className="size-6" strokeWidth={1.75} />
      </span>
      <span data-capture-label="" className="text-ink text-[11px] leading-3 font-medium">
        {t('capture.label')}
      </span>
    </button>
  );

  if (!overlays) return trigger;
  const { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } = overlays;
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent side="bottom" data-capture-sheet="" labels={{ close: t('sheet.close') }}>
        <SheetHeader>
          <SheetTitle>{t('capture.title')}</SheetTitle>
          <SheetDescription>{t('capture.hint')}</SheetDescription>
        </SheetHeader>
        <ul className="flex flex-col gap-1">
          {ACTIONS.map(({ id, icon: Icon }) => (
            <li key={id}>
              <button
                type="button"
                data-capture-action={id}
                onClick={() => {
                  setOpen(false);
                  // Same addresses as voiceHref() and the camera command; inlined so the shell does
                  // not pull the command registry in. `file` opens the camera sheet, which also
                  // takes photos and files from the gallery.
                  const params = new URLSearchParams(window.location.search);
                  params.set('capture', id === 'voice' ? 'voice' : 'camera');
                  router.push(`${pathname}?${params.toString()}`);
                }}
                className="text-ink flex min-h-11 w-full items-center gap-3 rounded-md px-2 text-left text-sm font-medium disabled:opacity-60"
              >
                <Icon aria-hidden="true" className="size-[18px] shrink-0" strokeWidth={1.5} />
                {t(`capture.${id}`)}
              </button>
            </li>
          ))}
        </ul>
      </SheetContent>
    </Sheet>
  );
}
