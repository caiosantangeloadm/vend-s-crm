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
    // Enviado sem conteúdo de propósito (ver Edge Function send-push-reminders) — a mensagem
    // genérica abaixo é o que sempre aparece; tocar nela abre o CRM com os detalhes reais.
    // Sem ícone/badge de propósito (o arquivo tem espaço no nome, o que pode falhar em
    // alguns navegadores/SOs e, se a Promise de showNotification rejeitar, o navegador cai
    // no aviso genérico próprio dele em vez do nosso — por isso simplificamos ao máximo e
    // blindamos com try/catch, garantindo que ALGUMA notificação sempre apareça).
    let title = '🔔 Vend-s CRM';
    let body = 'Você tem um lembrete — toque para ver na Agenda/Tarefas.';
    let url = '/';
    try {
        if (event.data) {
            const json = event.data.json();
            if (json.title) title = json.title;
            if (json.body) body = json.body;
            if (json.url) url = json.url;
        }
    } catch (e) { /* payload vazio ou inválido — usa o texto padrão acima */ }

    event.waitUntil(
        self.registration.showNotification(title, {
            body: body,
            tag: 'vends-push',
            data: { url: url },
        }).catch(() => {
            // Última tentativa, o mais simples possível, sem nenhuma opção extra.
            return self.registration.showNotification(title, { body: body });
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
