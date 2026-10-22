// The web app manifest (#50): installable, standalone, with an Android Web Share Target so a PDF or
// photo shared from WhatsApp, Gmail or Files lands in CauseDeck in two taps. The manifest asks for
// no permission (no notifications, SMS, contacts or background capture); the service worker takes
// the `/share-target` POST and saves the files on the device before anything is sent. The brand
// mark is the temporary one (app/icon.svg). Light and dark theme colours are in the root layout's
// `viewport.themeColor`; the manifest holds the light one.
import type { MetadataRoute } from 'next';

const SHARE_TARGET_ACCEPT = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'audio/*',
  'text/calendar',
  '.ics',
  'text/plain',
  'application/zip',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

const THEME_COLORS = { light: '#FBFAF6', dark: '#0E1116' } as const;

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'CauseDeck',
    short_name: 'CauseDeck',
    description: 'Your court day, prepared.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: THEME_COLORS.light,
    theme_color: THEME_COLORS.light,
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/icon-monochrome-512.png', sizes: '512x512', type: 'image/png', purpose: 'monochrome' },
    ],
    screenshots: [
      { src: '/screenshots/home-narrow.png', sizes: '540x960', type: 'image/png', form_factor: 'narrow' },
      { src: '/screenshots/home-wide.png', sizes: '1280x720', type: 'image/png', form_factor: 'wide' },
    ],
    share_target: {
      action: '/share-target',
      method: 'POST',
      enctype: 'multipart/form-data',
      params: {
        title: 'title',
        text: 'text',
        url: 'url',
        files: [{ name: 'files', accept: SHARE_TARGET_ACCEPT }],
      },
    },
  };
}
