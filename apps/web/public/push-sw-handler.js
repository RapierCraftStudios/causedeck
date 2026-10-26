// Web Push service-worker handlers (#197, #23). Registered standalone at scope `/` by the push
// permission card; the PWA service worker (Offline milestone) will `importScripts` this file.
// Payloads are JSON `{ title, body?, href, tag }` built by `@causedeck/notifications/push`: by
// default a generic title and a link only, never matter names or document text.
/** The service worker global scope. */
const sw = globalThis;

const DEFAULT_TITLE = 'CauseDeck';

/** A same-origin URL for `href`, or the app root. */
function sameOriginUrl(href) {
  try {
    const url = new URL(href || '/', sw.location.origin);
    return url.origin === sw.location.origin ? url.href : new URL('/', sw.location.origin).href;
  } catch {
    return new URL('/', sw.location.origin).href;
  }
}

sw.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = typeof data.title === 'string' && data.title ? data.title : DEFAULT_TITLE;
  const options = {
    data: { href: sameOriginUrl(data.href) },
    tag: typeof data.tag === 'string' ? data.tag : undefined,
  };
  if (typeof data.body === 'string' && data.body) options.body = data.body;
  event.waitUntil(sw.registration.showNotification(title, options));
});

sw.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const href = sameOriginUrl(event.notification.data && event.notification.data.href);
  event.waitUntil(
    sw.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      for (const client of windows) {
        if (client.url === href && 'focus' in client) return client.focus();
      }
      return sw.clients.openWindow(href);
    }),
  );
});
