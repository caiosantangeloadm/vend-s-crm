const CACHE_NAME = 'sant-crm-cache-v1';
const CORE_ASSETS = [
    './Sant CRM Cloude.html',
    './manifest.json',
    './ICONE VEND-S.svg'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS))
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
        )
    );
    self.clients.claim();
});

// Estratégia: network-first para o HTML principal (sempre pega a versão mais nova quando online),
// cache-first para os demais arquivos (ícones, manifest).
self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;

    if (req.url.endsWith('.html') || req.mode === 'navigate') {
        event.respondWith(
            fetch(req)
                .then((res) => {
                    const resClone = res.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
                    return res;
                })
                .catch(() => caches.match(req))
        );
        return;
    }

    event.respondWith(
        caches.match(req).then((cached) => cached || fetch(req))
    );
});

// ── Push real ────────────────────────────────────────────────────────
// Disparado pelo navegador quando o servidor (Edge Function) envia um push,
// mesmo com o app/aba completamente fechado — é isso que resolve o problema
// de notificações que só apareciam com o app aberto.
self.addEventListener('push', (event) => {
    let data = { title: 'Vend-s CRM', body: 'Você tem uma notificação.', tag: 'vends-push', url: '/' };
    try { if (event.data) data = { ...data, ...event.data.json() }; } catch (e) {}

    event.waitUntil(
        self.registration.showNotification(data.title, {
            body: data.body,
            tag: data.tag,
            icon: './ICONE VEND-S.svg',
            badge: './ICONE VEND-S.svg',
            data: { url: data.url || '/' },
        })
    );
});

// Clique na notificação: foca uma aba já aberta do CRM, ou abre uma nova.
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const targetUrl = (event.notification.data && event.notification.data.url) || '/';
    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            for (const client of clientList) {
                if ('focus' in client) return client.focus();
            }
            if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
        })
    );
});
