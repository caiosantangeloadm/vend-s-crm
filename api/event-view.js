// Página pública somente-leitura de UM compromisso específico.
// Pensada pra compartilhar um único evento com alguém de fora, sem dar acesso ao
// resto da agenda — diferente de agenda-view.js (que mostra os próximos 30 dias inteiros).
//
// Segurança: token próprio do evento (events.publicToken), gerado só quando o dono clica
// em "Compartilhar" nesse compromisso específico. Usa a Service Role Key (só existe no
// servidor) pra ler o evento certo ignorando RLS — mesma abordagem já usada em
// agenda-view.js, calendar-feed.js e note-view.js.

const SUPABASE_URL = 'https://hjolrtpenlbtjoitiium.supabase.co';
const MONTH_NAMES = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];

function escapeHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
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
        const evRes = await fetch(
            `${SUPABASE_URL}/rest/v1/events?select=id,title,"startDate","startTime","endDate","endTime",location,"deletedAt","shareViews"&"publicToken"=eq.${encodeURIComponent(token)}`,
            { headers }
        );
        const evData = await evRes.json();
        if (!Array.isArray(evData) || !evData.length || evData[0].deletedAt) {
            res.status(403).send('Link inválido ou compromisso não compartilhado mais.');
            return;
        }
        const e = evData[0];

        try {
            await fetch(`${SUPABASE_URL}/rest/v1/events?id=eq.${encodeURIComponent(e.id)}`, {
                method: 'PATCH',
                headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
                body: JSON.stringify({ "shareViews": (e.shareViews || 0) + 1, "shareLastViewedAt": new Date().toISOString() }),
            });
        } catch (err) { /* silencioso */ }

        const dateLabel = (() => {
            if (!e.startDate) return '';
            const [y, m, d] = e.startDate.split('-').map(Number);
            return `${d} de ${MONTH_NAMES[m - 1]} de ${y}`;
        })();
        const timeLabel = e.startTime ? `${e.startTime}${e.endTime ? ' – ' + e.endTime : ''}` : 'Dia inteiro';

        const html = `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(e.title || 'Compromisso')} — Vend-s Inteligência CRM</title>
<style>body{margin:0;padding:0;background:#030303;font-family:Inter,Segoe UI,Arial,sans-serif;color:#e2e8f0;}</style>
</head>
<body>
<div style="max-width:600px;margin:0 auto;padding:32px 20px;">
    <div style="margin-bottom:24px;">
        <div style="font-size:24px;font-weight:900;letter-spacing:-1px;"><span style="color:#5b8fa8;">Vend-s</span></div>
        <div style="font-size:10px;color:#475569;text-transform:uppercase;letter-spacing:2px;margin-top:3px;">Compromisso — Visualização Somente-Leitura</div>
    </div>
    <div style="background:#0a0a0a;border:1px solid #1f1f1f;border-radius:16px;padding:24px;">
        <h1 style="font-size:20px;font-weight:700;color:#fff;margin:0 0 16px;">${escapeHtml(e.title || 'Sem título')}</h1>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
            <span style="font-size:16px;">📅</span>
            <span style="font-size:14px;color:#cbd5e1;">${escapeHtml(dateLabel)}</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:${e.location ? '10px' : '0'};">
            <span style="font-size:16px;">🕐</span>
            <span style="font-size:14px;color:#cbd5e1;">${escapeHtml(timeLabel)}</span>
        </div>
        ${e.location ? `<div style="display:flex;align-items:center;gap:8px;"><span style="font-size:16px;">📍</span><span style="font-size:14px;color:#cbd5e1;">${escapeHtml(e.location)}</span></div>` : ''}
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
        res.status(500).send('Erro ao carregar o compromisso: ' + err.message);
    }
};
