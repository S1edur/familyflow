/*
 * Service worker Family Flow — ТІЛЬКИ для пушів.
 *
 * Навмисно без кешування і без обробника fetch: застосунок синхронізується
 * з базою, і закешований старий бандл тихо показував би стару версію після
 * деплою. Офлайн уже покриває черга змін у localStorage.
 */
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()))

self.addEventListener('push', event => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch { data = { body: event.data && event.data.text() } }
  const title = data.title || 'Family Flow'
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || '',
    tag: data.tag,               // однаковий tag замінює попереднє, а не складає стос
    data: { url: data.url || '/' },
    icon: '/icon-192.png',
    badge: '/icon-192.png',
  }))
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/'
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const c of all) {
      if ('focus' in c) { await c.focus(); if ('navigate' in c) await c.navigate(url); return }
    }
    await self.clients.openWindow(url)
  })())
})
