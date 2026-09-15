// Página pública somente-leitura de um "Cartão de Contato" — dados básicos de um contato do
// CRM (nome, empresa, cargo, telefones, e-mail, site), pra apresentar/compartilhar sem dar
// acesso ao CRM e sem expor dados privados (notas, histórico, endereço, valores de negócio).
//
// Segurança: token próprio do contato (contacts.publicToken), gerado só quando o dono clica em
// "Compartilhar Cartão" nesse contato específico. Usa a Service Role Key (só existe no servidor)
// pra ler o contato certo ignorando RLS — mesma abordagem já usada em note-view.js e task-view.js.

const SUPABASE_URL = 'https://hjolrtpenlbtjoitiium.supabase.co';

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
        const cRes = await fetch(
            `${SUPABASE_URL}/rest/v1/contacts?select=id,name,"lastName",company,job,"phoneProf","phonePess",phone,"emailProf","emailPess",email,site,"deletedAt","shareViews"&"publicToken"=eq.${encodeURIComponent(token)}`,
            { headers }
        );
        const cData = await cRes.json();
        if (!Array.isArray(cData) || !cData.length || cData[0].deletedAt) {
            res.status(403).send('Link inválido ou cartão não compartilhado mais.');
            return;
        }
        const c = cData[0];

        try {
            await fetch(`${SUPABASE_URL}/rest/v1/contacts?id=eq.${encodeURIComponent(c.id)}`, {
                method: 'PATCH',
                headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
                body: JSON.stringify({ "shareViews": (c.shareViews || 0) + 1, "shareLastViewedAt": new Date().toISOString() }),
            });
        } catch (err) { /* silencioso */ }
        const fullName = `${c.name || ''} ${c.lastName || ''}`.trim() || 'Contato';
        const phone = c.phoneProf || c.phonePess || c.phone || '';
        const email = c.emailProf || c.emailPess || c.email || '';
        const site = c.site ? (c.site.startsWith('http') ? c.site : `https://${c.site}`) : '';

        const rows = [
            c.company ? { icon: '🏢', label: c.job ? `${c.company} — ${c.job}` : c.company } : (c.job ? { icon: '💼', label: c.job } : null),
            phone ? { icon: '📞', label: phone, href: `tel:${phone.replace(/\D/g, '')}` } : null,
            email ? { icon: '✉️', label: email, href: `mailto:${email}` } : null,
            site ? { icon: '🌐', label: c.site, href: site } : null,
        ].filter(Boolean);

        const rowsHtml = rows.map(r => `
            <div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid #1f1f1f;">
                <span style="font-size:16px;">${r.icon}</span>
                ${r.href
                    ? `<a href="${escapeHtml(r.href)}" style="font-size:14px;color:#5b8fa8;text-decoration:none;">${escapeHtml(r.label)}</a>`
                    : `<span style="font-size:14px;color:#cbd5e1;">${escapeHtml(r.label)}</span>`}
            </div>`).join('');

        const html = `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(fullName)} — Vend-s Inteligência CRM</title>
<style>body{margin:0;padding:0;background:#030303;font-family:Inter,Segoe UI,Arial,sans-serif;color:#e2e8f0;}</style>
</head>
<body>
<div style="max-width:480px;margin:0 auto;padding:32px 20px;">
    <div style="margin-bottom:24px;">
        <div style="font-size:24px;font-weight:900;letter-spacing:-1px;"><span style="color:#5b8fa8;">Vend-s</span></div>
        <div style="font-size:10px;color:#475569;text-transform:uppercase;letter-spacing:2px;margin-top:3px;">Cartão de Contato</div>
    </div>
    <div style="background:#0a0a0a;border:1px solid #1f1f1f;border-radius:16px;padding:24px;">
        <h1 style="font-size:20px;font-weight:700;color:#fff;margin:0 0 8px;">${escapeHtml(fullName)}</h1>
        ${rowsHtml || '<p style="color:#64748b;font-size:13px;">Sem dados de contato adicionais.</p>'}
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
        res.status(500).send('Erro ao carregar o cartão: ' + err.message);
    }
};
