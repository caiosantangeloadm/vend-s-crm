// Página pública somente-leitura de UMA tarefa específica.
// Pensada pra passar uma tarefa (com checklist) pra alguém de fora do CRM — um terceirizado,
// um freelancer — sem dar acesso ao resto do sistema.
//
// Segurança: token próprio da tarefa (tasks.publicToken), gerado só quando o dono clica em
// "Compartilhar" nessa tarefa específica. Usa a Service Role Key (só existe no servidor) pra
// ler a tarefa certa ignorando RLS — mesma abordagem já usada em note-view.js e event-view.js.

const SUPABASE_URL = 'https://hjolrtpenlbtjoitiium.supabase.co';
const ATTACHMENT_BUCKET = 'attachments';

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
        const taskRes = await fetch(
            `${SUPABASE_URL}/rest/v1/tasks?select=id,title,"desc",date,time,"dueDate",priority,checklist,attachments,completed,"deletedAt","shareViews"&"publicToken"=eq.${encodeURIComponent(token)}`,
            { headers }
        );
        const taskData = await taskRes.json();
        if (!Array.isArray(taskData) || !taskData.length || taskData[0].deletedAt) {
            res.status(403).send('Link inválido ou tarefa não compartilhada mais.');
            return;
        }
        const t = taskData[0];

        try {
            await fetch(`${SUPABASE_URL}/rest/v1/tasks?id=eq.${encodeURIComponent(t.id)}`, {
                method: 'PATCH',
                headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
                body: JSON.stringify({ "shareViews": (t.shareViews || 0) + 1, "shareLastViewedAt": new Date().toISOString() }),
            });
        } catch (e) { /* silencioso */ }

        // Anexos: cada um vira um link temporário (1h) pro arquivo real no Storage — o
        // bucket é privado, então o visitante só consegue abrir através desse link assinado,
        // nunca acessando o arquivo diretamente.
        const attachments = Array.isArray(t.attachments) ? t.attachments : [];
        const signedAttachments = await Promise.all(attachments.map(async (a) => {
            if (!a.storagePath) return null;
            try {
                const signRes = await fetch(
                    `${SUPABASE_URL}/storage/v1/object/sign/${ATTACHMENT_BUCKET}/${a.storagePath}`,
                    { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn: 3600 }) }
                );
                const signData = await signRes.json();
                if (!signData.signedURL) return null;
                return { title: a.title || 'Arquivo', url: `${SUPABASE_URL}/storage/v1${signData.signedURL}` };
            } catch (e) { return null; }
        }));
        const attachmentsHtml = signedAttachments.filter(Boolean).length
            ? `<div style="margin-top:16px;padding-top:16px;border-top:1px solid #1f1f1f;">
                ${signedAttachments.filter(Boolean).map(a => `
                    <a href="${a.url}" target="_blank" rel="noopener" style="display:flex;align-items:center;gap:8px;padding:8px 0;font-size:13px;color:#5b8fa8;text-decoration:none;">
                        📎 ${escapeHtml(a.title)}
                    </a>`).join('')}
               </div>`
            : '';

        const checklist = Array.isArray(t.checklist) ? t.checklist : [];
        const checklistHtml = checklist.length
            ? checklist.map(it => `
                <div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:8px;">
                    <span style="font-size:14px;">${it.done ? '☑' : '☐'}</span>
                    <span style="font-size:14px;${it.done ? 'color:#64748b;text-decoration:line-through;' : 'color:#e2e8f0;'}">${escapeHtml(it.text || '')}</span>
                </div>`).join('')
            : '';

        const fmtDate = (d) => {
            if (!d) return '';
            const [y, m, dd] = d.split('-');
            return `${dd}/${m}/${y}`;
        };
        const priorityLabels = { low: 'Baixa', medium: 'Normal', high: 'Alta (Urgente)' };

        const html = `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(t.title || 'Tarefa')} — Vend-s Inteligência CRM</title>
<style>body{margin:0;padding:0;background:#030303;font-family:Inter,Segoe UI,Arial,sans-serif;color:#e2e8f0;}</style>
</head>
<body>
<div style="max-width:600px;margin:0 auto;padding:32px 20px;">
    <div style="margin-bottom:24px;">
        <div style="font-size:24px;font-weight:900;letter-spacing:-1px;"><span style="color:#5b8fa8;">Vend-s</span></div>
        <div style="font-size:10px;color:#475569;text-transform:uppercase;letter-spacing:2px;margin-top:3px;">Tarefa — Visualização Somente-Leitura</div>
    </div>
    <div style="background:#0a0a0a;border:1px solid #1f1f1f;border-radius:16px;padding:24px;">
        <h1 style="font-size:20px;font-weight:700;color:#fff;margin:0 0 12px;">${t.completed ? '✅ ' : ''}${escapeHtml(t.title || 'Sem título')}</h1>
        <div style="display:flex;flex-wrap:wrap;gap:14px;margin-bottom:16px;">
            ${t.date ? `<span style="font-size:12px;color:#94a3b8;">📅 ${fmtDate(t.date)}${t.time ? ' às ' + escapeHtml(t.time) : ''}</span>` : ''}
            ${t.dueDate ? `<span style="font-size:12px;color:#f87171;">🚩 Prazo final: ${fmtDate(t.dueDate)}</span>` : ''}
            ${t.priority ? `<span style="font-size:12px;color:#94a3b8;">🚩 Prioridade: ${priorityLabels[t.priority] || t.priority}</span>` : ''}
        </div>
        ${t.desc ? `<p style="font-size:14px;line-height:1.7;color:#cbd5e1;white-space:pre-wrap;margin-bottom:16px;">${escapeHtml(t.desc)}</p>` : ''}
        ${checklistHtml}
        ${attachmentsHtml}
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
        res.status(500).send('Erro ao carregar a tarefa: ' + err.message);
    }
};
