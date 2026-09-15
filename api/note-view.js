// Página pública somente-leitura de uma Nota específica.
// Pensada pra compartilhar uma nota com alguém por link, sem precisar de login.
//
// Segurança: token próprio da nota (notes.publicToken), gerado só quando o dono clica em
// "Compartilhar" — diferente do token de conta usado no feed/visualização da Agenda. Usa a
// Service Role Key (só existe no servidor) pra ler a nota certa ignorando RLS — mesma
// abordagem já usada em agenda-view.js e calendar-feed.js.

const SUPABASE_URL = 'https://hjolrtpenlbtjoitiium.supabase.co';

function escapeHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// Conversão bem simples de markdown pra HTML — só o suficiente pro texto de uma nota
// (negrito, itálico, quebras de linha). Não precisa de listas/links complexos aqui.
function simpleMdToHtml(text) {
    return escapeHtml(text)
        .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
        .replace(/\*(.+?)\*/g, '<i>$1</i>')
        .replace(/\n/g, '<br>');
}

module.exports = async (req, res) => {
    const token = req.query.token;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!token || !serviceKey) {
        res.status(403).send('Link inválido.');
        return;
    }

    const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };

    try {
        const noteRes = await fetch(
            `${SUPABASE_URL}/rest/v1/notes?select=id,title,body,checklist,"updatedAt","createdAt","deletedAt","shareViews"&"publicToken"=eq.${encodeURIComponent(token)}`,
            { headers }
        );
        const noteData = await noteRes.json();
        if (!Array.isArray(noteData) || !noteData.length || noteData[0].deletedAt) {
            res.status(403).send('Link inválido ou nota não compartilhada mais.');
            return;
        }
        const n = noteData[0];

        // Contador de visualizações — não bloqueia a página se falhar (best-effort).
        try {
            await fetch(`${SUPABASE_URL}/rest/v1/notes?id=eq.${encodeURIComponent(n.id)}`, {
                method: 'PATCH',
                headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
                body: JSON.stringify({ "shareViews": (n.shareViews || 0) + 1, "shareLastViewedAt": new Date().toISOString() }),
            });
        } catch (e) { /* silencioso — visualizar a nota não deve falhar por causa do contador */ }

        const checklist = Array.isArray(n.checklist) ? n.checklist : [];
        const bodyHtml = checklist.length
            ? checklist.map(it => `
                <div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:8px;">
                    <span style="font-size:14px;">${it.done ? '☑' : '☐'}</span>
                    <span style="font-size:14px;${it.done ? 'color:#64748b;text-decoration:line-through;' : 'color:#e2e8f0;'}">${escapeHtml(it.text || '')}</span>
                </div>`).join('')
            : `<div style="font-size:14px;line-height:1.7;color:#e2e8f0;">${simpleMdToHtml(n.body || '')}</div>`;

        const dateRef = n.updatedAt || n.createdAt;
        const dateLabel = dateRef ? new Date(dateRef).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' }) : '';

        const html = `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(n.title || 'Nota')} — Vend-s Inteligência CRM</title>
<style>body{margin:0;padding:0;background:#030303;font-family:Inter,Segoe UI,Arial,sans-serif;color:#e2e8f0;}</style>
</head>
<body>
<div style="max-width:600px;margin:0 auto;padding:32px 20px;">
    <div style="margin-bottom:24px;">
        <div style="font-size:24px;font-weight:900;letter-spacing:-1px;"><span style="color:#5b8fa8;">Vend-s</span></div>
        <div style="font-size:10px;color:#475569;text-transform:uppercase;letter-spacing:2px;margin-top:3px;">Nota — Visualização Somente-Leitura</div>
    </div>
    <div style="background:#0a0a0a;border:1px solid #1f1f1f;border-radius:16px;padding:24px;">
        ${n.title ? `<h1 style="font-size:20px;font-weight:700;color:#fff;margin:0 0 6px;">${escapeHtml(n.title)}</h1>` : ''}
        ${dateLabel ? `<p style="font-size:11px;color:#64748b;margin:0 0 16px;">${dateLabel}</p>` : ''}
        ${bodyHtml}
    </div>
    <div style="margin-top:32px;padding-top:16px;border-top:1px solid #1f1f1f;text-align:center;">
        <p style="font-size:11px;color:#2d3748;">Vend-s Inteligência CRM — esta é uma visualização pública somente-leitura, sem opção de edição.</p>
    </div>
</div>
</body></html>`;

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, max-age=0');
        res.status(200).send(html);
    } catch (err) {
        res.status(500).send('Erro ao carregar a nota: ' + err.message);
    }
};
