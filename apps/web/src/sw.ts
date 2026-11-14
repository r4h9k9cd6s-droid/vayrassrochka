/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<string | { url: string; revision: string | null }> };

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

// Для переходов по страницам сайта без сети отдаём оболочку приложения.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.mode === 'navigate' && url.origin === self.location.origin && !url.pathname.startsWith('/api')) {
    event.respondWith(fetch(req).catch(async () => (await caches.match('/index.html')) ?? Response.error()));
  }
});

self.addEventListener('push', (event) => {
  const data = (() => {
    try {
      return event.data?.json() as { title: string; body: string; url?: string };
    } catch {
      return null;
    }
  })();
  if (!data) return;
  event.waitUntil(
    self.registration.showNotification(data.title, { body: data.body, icon: '/icon.svg', badge: '/icon.svg', data: { url: data.url ?? '/' } }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data as { url?: string })?.url ?? '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((list) => {
      const open = list[0];
      return open ? open.focus() : self.clients.openWindow(url);
    }),
  );
});

self.addEventListener('install', () => void self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
