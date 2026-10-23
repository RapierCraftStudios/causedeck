// Installability and service-worker registration (#50): `beforeinstallprompt` handling, iOS
// detection (no Web Share Target there, so iOS gets add-to-home-screen steps and an in-app upload
// button), the second-visit rule and the per-viewer dismissal. localStorage can throw (private
// mode, blocked storage), so every access is guarded.
export const SW_URL = '/sw.js';
const VISITS_KEY = 'cd_pwa_visits';
const DISMISSED_PREFIX = 'cd_pwa_install_dismissed:';

export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage blocked: the banner then simply shows again next time.
  }
}

/** Count this visit (once per page load) and return the total. */
export function recordVisit(): number {
  const visits = (Number.parseInt(read(VISITS_KEY) ?? '0', 10) || 0) + 1;
  write(VISITS_KEY, String(visits));
  return visits;
}

export const isDismissed = (viewerId: string): boolean =>
  read(DISMISSED_PREFIX + viewerId) !== null;

export function dismissInstall(viewerId: string): void {
  write(DISMISSED_PREFIX + viewerId, '1');
}

export function isStandalone(): boolean {
  const ios = (navigator as { standalone?: boolean }).standalone === true;
  // `matchMedia` is missing in jsdom and some embedded webviews: treat those as not installed.
  if (ios || typeof window.matchMedia !== 'function') return ios;
  return window.matchMedia('(display-mode: standalone)').matches;
}

export function isIos(
  userAgent = navigator.userAgent,
  maxTouchPoints = navigator.maxTouchPoints,
): boolean {
  // iPadOS 13+ reports as a Mac with touch points.
  return (
    /iphone|ipad|ipod/i.test(userAgent) || (/macintosh/i.test(userAgent) && maxTouchPoints > 1)
  );
}

export interface BannerInput {
  visits: number;
  standalone: boolean;
  dismissed: boolean;
  ios: boolean;
  hasPrompt: boolean;
}

/** Android: after the second visit with a prompt in hand. iOS: same rule, instructions instead. */
export function bannerMode(input: BannerInput): 'android' | 'ios' | null {
  if (input.standalone || input.dismissed || input.visits < 2) return null;
  if (input.ios) return 'ios';
  return input.hasPrompt ? 'android' : null;
}

/** Hold the install prompt for the banner; returns a stop function. */
export function listenForInstallPrompt(
  onPrompt: (event: BeforeInstallPromptEvent) => void,
): () => void {
  const handler = (event: Event) => {
    event.preventDefault();
    onPrompt(event as BeforeInstallPromptEvent);
  };
  window.addEventListener('beforeinstallprompt', handler);
  return () => {
    window.removeEventListener('beforeinstallprompt', handler);
  };
}

/**
 * Register `/sw.js` at scope `/` (the default for a worker served from the root; the scope is never
 * widened with `Service-Worker-Allowed`). `onWaiting` fires when a new version is installed and
 * waiting; the update policy decides when it takes over.
 */
export async function registerServiceWorker(
  onWaiting: (registration: ServiceWorkerRegistration) => void,
): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  try {
    const registration = await navigator.serviceWorker.register(SW_URL, { scope: '/' });
    const check = () => {
      if (registration.waiting !== null && navigator.serviceWorker.controller !== null) {
        onWaiting(registration);
      }
    };
    check();
    registration.addEventListener('updatefound', () => {
      registration.installing?.addEventListener('statechange', check);
    });
    return registration;
  } catch {
    return null;
  }
}

/** Ask the waiting worker to take over. */
export function applyWaitingUpdate(registration: ServiceWorkerRegistration): void {
  registration.waiting?.postMessage({ type: 'SKIP_WAITING' });
}
