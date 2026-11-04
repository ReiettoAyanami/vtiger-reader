// vtiger-reader's service worker: only push notifications (plan 5.3), no caching, no offline.
// A message from the API is { title, body, url, tag } (api/src/modules/notifications/push.ts).

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let message = {};
  try {
    message = event.data ? event.data.json() : {};
  } catch {
    message = { body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.registration.showNotification(message.title || 'vtiger-reader', {
      body: message.body || '',
      tag: message.tag || undefined,
      // A newer notification with the same tag replaces the shown one, and still rings.
      renotify: Boolean(message.tag),
      icon: '/favicon.ico',
      data: { url: message.url || '/' },
    }),
  );
});

// A click opens the page the notification names, on the app's own address only: in an open tab of
// the app when there is one (the app navigates without reloading), else in a new one.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const wanted = (event.notification.data && event.notification.data.url) || '/';
  const target = new URL(wanted, self.location.origin);
  if (target.origin !== self.location.origin) return;
  const path = target.pathname + target.search + target.hash;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const tab = windows.find((w) => new URL(w.url).origin === self.location.origin);
      if (tab) {
        await tab.focus();
        tab.postMessage({ type: 'open', url: path });
        return;
      }
      await self.clients.openWindow(path);
    })(),
  );
});
