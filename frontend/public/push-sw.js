self.addEventListener('push', event => {
  let data = {title: 'Chindi', body: 'A little check-in for your wallet.', url: '/'};
  try { data = {...data, ...event.data.json()}; } catch { /* Empty push. */ }
  event.waitUntil(self.registration.showNotification(data.title, {body:data.body,icon:'/icons/icon-192.png',data:{url:data.url}}));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/', self.location.origin);
  if (url.origin !== self.location.origin) return;
  event.waitUntil(clients.openWindow(url.href));
});
