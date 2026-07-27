// Página pública somente-leitura da Agenda (próximos 30 dias).
// Pensada pra compartilhar com um sócio/assistente por link, sem precisar de login.
//
// Segurança: mesmo token do feed .ics assinável (user_preferences.icsFeedToken).
// Usa a Service Role Key (só existe no servidor) pra localizar o dono do token e
// ler os eventos dele, ignorando RLS — a mesma abordagem já usada em calendar-feed.js.
// Mostra só título/horário/local — nunca descrição, anexos ou dados de contato.

const SUPABASE_URL = 'https://hjolrtpenlbtjoitiium.supabase.co';
const WEEKDAY_NAMES = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const MONTH_NAMES = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];

function escapeHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function addDays(dateStr, n) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(y, m - 1, d + n);
    const pad = x => String(x).padStart(2, '0');
    return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

function isEventOnDate(e, dateStr) {
    if (e.deletedAt) return false;
    if (Array.isArray(e.excludedDates) && e.excludedDates.includes(dateStr)) return false;
    if (!e.recurrence || e.recurrence === 'none') return e.startDate === dateStr;
    if (e.startDate > dateStr) return false;
    if (e.recurrenceEndType === 'date' && e.recurrenceEndDate && e.recurrenceEndDate < dateStr) return false;

    const [sy, sm, sd] = e.startDate.split('-').map(Number);
    const [ty, tm, td] = dateStr.split('-').map(Number);
    const start = new Date(sy, sm - 1, sd);
    const target = new Date(ty, tm - 1, td);
    const dow = target.getDay();
    const interval = e.recurrenceInterval || 1;

    if (e.recurrence === 'daily') {
        const diffDays = Math.round((target - start) / 86400000);
        return diffDays >= 0 && diffDays % interval === 0;
    }
    if (e.recurrence === 'weekly') {
        const weekdays = Array.isArray(e.recurrenceWeekdays) && e.recurrenceWeekdays.length ? e.recurrenceWeekdays : [start.getDay()];
        if (!weekdays.includes(dow)) return false;
        const startWeek = new Date(start); startWeek.setDate(start.getDate() - start.getDay());
        const targetWeek = new Date(target); targetWeek.setDate(target.getDate() - target.getDay());
        const diffWeeks = Math.round((targetWeek - startWeek) / (7 * 86400000));
        return diffWeeks >= 0 && diffWeeks % interval === 0;
    }
    if (e.recurrence === 'monthly') {
        if (e.recurrenceMonthlyMode === 'weekday') {
            const nth = e.recurrenceMonthlyNth || 1;
            const wd = e.recurrenceMonthlyWeekday ?? start.getDay();
            if (dow !== wd) return false;
            const occurrence = Math.ceil(td / 7);
            return occurrence === nth;
        }
        return td === sd;
    }
    if (e.recurrence === 'yearly') {
        return tm === sm && td === sd;
    }
    return false;
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
        const prefRes = await fetch(
            `${SUPABASE_URL}/rest/v1/user_preferences?select=user_id&icsFeedToken=eq.${encodeURIComponent(token)}`,
            { headers }
        );
        const prefData = await prefRes.json();
        if (!Array.isArray(prefData) || !prefData.length) {
            res.status(403).send('Link inválido.');
            return;
        }
        const userId = prefData[0].user_id;

        const evRes = await fetch(
            `${SUPABASE_URL}/rest/v1/events?select=*&user_id=eq.${encodeURIComponent(userId)}`,
            { headers }
        );
        const events = await evRes.json();
        const validEvents = (Array.isArray(events) ? events : []).filter(e => e.startDate);

        const today = new Date();
        const pad = x => String(x).padStart(2, '0');
        const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;

        const byDay = {};
        for (let i = 0; i < 30; i++) {
            const dateStr = addDays(todayStr, i);
            const dayEvents = validEvents
                .filter(e => isEventOnDate(e, dateStr))
                .sort((a, b) => (a.startTime || '23:59').localeCompare(b.startTime || '23:59'));
            if (dayEvents.length) byDay[dateStr] = dayEvents;
        }

        const dayBlocks = Object.keys(byDay).sort().map(dateStr => {
            const [y, m, d] = dateStr.split('-').map(Number);
            const dt = new Date(y, m - 1, d);
            const isToday = dateStr === todayStr;
            const header = `${WEEKDAY_NAMES[dt.getDay()]}, ${d} de ${MONTH_NAMES[m - 1]}`;
            const items = byDay[dateStr].map(e => `
                <div style="border-left:3px solid #5b8fa8;padding:10px 14px;margin-bottom:8px;background:#111827;border-radius:0 8px 8px 0;">
                    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;">
                        <span style="font-size:14px;font-weight:600;color:#f1f5f9;">${escapeHtml(e.title || 'Sem título')}</span>
                        ${e.startTime ? `<span style="font-size:12px;color:#94a3b8;">🕐 ${escapeHtml(e.startTime)}${e.endTime ? ' – ' + escapeHtml(e.endTime) : ''}</span>` : '<span style="font-size:11px;color:#64748b;">Dia inteiro</span>'}
                    </div>
                    ${e.location ? `<div style="font-size:12px;color:#64748b;margin-top:4px;">📍 ${escapeHtml(e.location)}</div>` : ''}
                </div>`).join('');
            return `
            <div style="margin-bottom:20px;">
                <p style="font-size:11px;font-weight:700;color:${isToday ? '#5b8fa8' : '#64748b'};text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">${header}${isToday ? ' — hoje' : ''}</p>
                ${items}
            </div>`;
        }).join('');

        const html = `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Agenda — Vend-s Inteligência CRM</title>
<style>body{margin:0;padding:0;background:#030303;font-family:Inter,Segoe UI,Arial,sans-serif;color:#e2e8f0;}</style>
</head>
<body>
<div style="max-width:600px;margin:0 auto;padding:32px 20px;">
    <div style="margin-bottom:28px;">
        <div style="font-size:24px;font-weight:900;letter-spacing:-1px;"><span style="color:#5b8fa8;">Vend-s</span></div>
        <div style="font-size:10px;color:#475569;text-transform:uppercase;letter-spacing:2px;margin-top:3px;">Agenda — Visualização Somente-Leitura</div>
    </div>
    ${dayBlocks || '<p style="color:#64748b;font-size:13px;">Nenhum compromisso nos próximos 30 dias.</p>'}
    <div style="margin-top:32px;padding-top:16px;border-top:1px solid #1f1f1f;text-align:center;">
        <p style="font-size:11px;color:#2d3748;">Vend-s Inteligência CRM — esta é uma visualização pública somente-leitura, sem opção de edição.</p>
    </div>
</div>
</body></html>`;

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, max-age=0');
        res.status(200).send(html);
    } catch (err) {
        res.status(500).send('Erro ao carregar a agenda: ' + err.message);
    }
};
