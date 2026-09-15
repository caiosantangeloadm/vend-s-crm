// Página pública somente-leitura do Catálogo (tabela de preços).
// Pensada pra mandar direto pro cliente, sem custo/margem/estoque, só nome+preço+descrição
// dos itens ativos.
//
// Segurança: token de conta próprio (user_preferences.catalogPublicToken), gerado só quando o
// dono clica em "Compartilhar" no Catálogo — diferente do token da Agenda. Usa a Service Role
// Key (só existe no servidor) pra localizar o dono do token e ler os produtos dele, ignorando
// RLS — mesma abordagem já usada em agenda-view.js, note-view.js e event-view.js.

const SUPABASE_URL = 'https://hjolrtpenlbtjoitiium.supabase.co';

function escapeHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

const UNIT_LABELS = { unidade: 'unidade', hora: 'hora', mes: 'mês', pacote: 'pacote', turma: 'Turma/Vaga', kg: 'kg', m2: 'm²' };

module.exports = async (req, res) => {
    const token = req.query.token;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!token || !serviceKey) {
        res.status(403).send('Link inválido.');
        return;
    }

    const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };

    try {
        const prefRes = await fetch(
            `${SUPABASE_URL}/rest/v1/user_preferences?select=user_id,"catalogShareViews"&"catalogPublicToken"=eq.${encodeURIComponent(token)}`,
            { headers }
        );
        const prefData = await prefRes.json();
        if (!Array.isArray(prefData) || !prefData.length) {
            res.status(403).send('Link inválido ou catálogo não compartilhado mais.');
            return;
        }
        const userId = prefData[0].user_id;

        try {
            await fetch(`${SUPABASE_URL}/rest/v1/user_preferences?user_id=eq.${encodeURIComponent(userId)}`, {
                method: 'PATCH',
                headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
                body: JSON.stringify({ "catalogShareViews": (prefData[0].catalogShareViews || 0) + 1, "catalogShareLastViewedAt": new Date().toISOString() }),
            });
        } catch (err) { /* silencioso */ }

        const prodRes = await fetch(
            `${SUPABASE_URL}/rest/v1/products?select=name,type,unit,price,description,"imageUrl",active,"deletedAt"&user_id=eq.${encodeURIComponent(userId)}`,
            { headers }
        );
        const products = await prodRes.json();
        const items = (Array.isArray(products) ? products : [])
            .filter(p => p.active !== false && !p.deletedAt)
            .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'pt-BR'));

        const cardsHtml = items.map(p => {
            const unitLabel = UNIT_LABELS[p.unit] || '';
            return `
            <div style="background:#0a0a0a;border:1px solid #1f1f1f;border-radius:14px;padding:18px;margin-bottom:12px;">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;">
                    <span style="font-size:15px;font-weight:700;color:#fff;">${escapeHtml(p.name)}</span>
                    <span style="font-size:16px;font-weight:800;color:#fbbf24;white-space:nowrap;">R$ ${(p.price || 0).toLocaleString('pt-BR')}${unitLabel ? `<span style="font-size:10px;color:#64748b;font-weight:400;"> / ${escapeHtml(unitLabel)}</span>` : ''}</span>
                </div>
                ${p.description ? `<p style="font-size:12px;color:#94a3b8;margin-top:6px;">${escapeHtml(p.description)}</p>` : ''}
            </div>`;
        }).join('');

        const html = `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Catálogo — Vend-s Inteligência CRM</title>
<style>body{margin:0;padding:0;background:#030303;font-family:Inter,Segoe UI,Arial,sans-serif;color:#e2e8f0;}</style>
</head>
<body>
<div style="max-width:600px;margin:0 auto;padding:32px 20px;">
    <div style="margin-bottom:24px;">
        <div style="font-size:24px;font-weight:900;letter-spacing:-1px;"><span style="color:#5b8fa8;">Vend-s</span></div>
        <div style="font-size:10px;color:#475569;text-transform:uppercase;letter-spacing:2px;margin-top:3px;">Catálogo de Produtos & Serviços</div>
    </div>
    ${cardsHtml || '<p style="color:#64748b;font-size:13px;">Nenhum item ativo no catálogo no momento.</p>'}
    <div style="margin-top:32px;padding-top:16px;border-top:1px solid #1f1f1f;text-align:center;">
        <p style="font-size:11px;color:#2d3748;">Vend-s Inteligência CRM — esta é uma visualização pública somente-leitura, sem opção de edição.</p>
    </div>
</div>
</body></html>`;

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, max-age=0');
        res.status(200).send(html);
    } catch (err) {
        res.status(500).send('Erro ao carregar o catálogo: ' + err.message);
    }
};
