self.addEventListener('push', e => {
  let data = {};
  try { data = e.data.json(); } catch (err) {}
  e.waitUntil(self.registration.showNotification(data.title || 'Focus 30', {
    body: data.body || 'Note ta dernière demi-heure ✍️',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: 'focus30-reminder'
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) if ('focus' in c) return c.focus();
    return clients.openWindow('/');
  }));
});
