// Feed .ics assinável para Google Calendar (e outros apps de calendário).
// Google Calendar acessa esta URL periodicamente (a cada algumas horas) e
// atualiza a agenda sozinho, sem precisar reexportar o .ics manualmente.
//
// Segurança: o "token" na URL é um segredo (gerado no app, guardado em
// user_preferences.icsFeedToken, protegido por RLS para o próprio usuário).
// Esta função usa a Service Role Key (só existe no servidor, nunca no HTML)
// para localizar o dono do token e ler os eventos dele, ignorando RLS.

const SUPABASE_URL = 'https://hjolrtpenlbtjoitiium.supabase.co';

const WEEKDAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

function icsEscape(str) {
    return String(str || '')
        .replace(/\\/g, '\\\\')
        .replace(/;/g, '\\;')
        .replace(/,/g, '\\,')
        .replace(/\n/g, '\\n');
}

function foldLine(line) {
    // RFC 5545: linhas com mais de 75 octetos devem ser quebradas com CRLF + espaço
    if (line.length <= 75) return line;
    let out = '';
    let rest = line;
    out += rest.slice(0, 75);
    rest = rest.slice(75);
    while (rest.length > 0) {
        out += '\r\n ' + rest.slice(0, 74);
        rest = rest.slice(74);
    }
    return out;
}

function dateOnlyToIcs(dateStr) {
    return (dateStr || '').replace(/-/g, '');
}

function dateTimeToIcs(dateStr, timeStr) {
    const time = (timeStr || '00:00').replace(':', '') + '00';
    return `${dateOnlyToIcs(dateStr)}T${time}`;
}

function buildRRule(e) {
    if (!e.recurrence || e.recurrence === 'none') return null;
    const freqMap = { daily: 'DAILY', weekly: 'WEEKLY', monthly: 'MONTHLY', yearly: 'YEARLY' };
    const freq = freqMap[e.recurrence];
    if (!freq) return null;
    const parts = [`FREQ=${freq}`, `INTERVAL=${e.recurrenceInterval || 1}`];

    if (e.recurrence === 'weekly' && Array.isArray(e.recurrenceWeekdays) && e.recurrenceWeekdays.length) {
        parts.push('BYDAY=' + e.recurrenceWeekdays.map(d => WEEKDAY_CODES[d]).filter(Boolean).join(','));
    }
    if (e.recurrence === 'monthly' && e.recurrenceMonthlyMode === 'weekday') {
        const nth = e.recurrenceMonthlyNth || 1;
        const wd = WEEKDAY_CODES[e.recurrenceMonthlyWeekday || 0];
        parts.push(`BYDAY=${nth}${wd}`);
    }
    if (e.recurrenceEndType === 'date' && e.recurrenceEndDate) {
        parts.push(`UNTIL=${dateOnlyToIcs(e.recurrenceEndDate)}T235959Z`);
    }
    return parts.join(';');
}

function eventToVEvent(e) {
    const uid = (e.uid && e.uid.trim()) ? e.uid : `${e.id}@vend-s.com.br`;
    const isAllDay = !e.startTime;
    const lines = [];
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${uid}`);
    lines.push(`DTSTAMP:${dateTimeToIcs(new Date().toISOString().slice(0, 10), '00:00')}Z`);

    if (isAllDay) {
        lines.push(`DTSTART;VALUE=DATE:${dateOnlyToIcs(e.startDate)}`);
        if (e.endDate) lines.push(`DTEND;VALUE=DATE:${dateOnlyToIcs(e.endDate)}`);
    } else {
        lines.push(`DTSTART;TZID=America/Sao_Paulo:${dateTimeToIcs(e.startDate, e.startTime)}`);
        const endDate = e.endDate || e.startDate;
        const endTime = e.endTime || e.startTime;
        lines.push(`DTEND;TZID=America/Sao_Paulo:${dateTimeToIcs(endDate, endTime)}`);
    }

    const rrule = buildRRule(e);
    if (rrule) lines.push(`RRULE:${rrule}`);

    if (Array.isArray(e.excludedDates) && e.excludedDates.length) {
        const values = e.excludedDates.map(d => isAllDay
            ? dateOnlyToIcs(d)
            : `${dateTimeToIcs(d, e.startTime)}`
        );
        lines.push(isAllDay
            ? `EXDATE;VALUE=DATE:${values.join(',')}`
            : `EXDATE;TZID=America/Sao_Paulo:${values.join(',')}`);
    }

    lines.push(`SUMMARY:${icsEscape(e.title || 'Sem título')}`);
    if (e.location) lines.push(`LOCATION:${icsEscape(e.location)}`);
    if (e.desc) lines.push(`DESCRIPTION:${icsEscape(e.desc)}`);
    lines.push('END:VEVENT');
    return lines.map(foldLine).join('\r\n');
}

module.exports = async (req, res) => {
    const token = req.query.token;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!token || !serviceKey) {
        res.status(403).send('Token inválido ou feed não configurado.');
        return;
    }

    const headers = {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
    };

    try {
        // 1. Localiza o dono do token
        const prefRes = await fetch(
            `${SUPABASE_URL}/rest/v1/user_preferences?select=user_id&icsFeedToken=eq.${encodeURIComponent(token)}`,
            { headers }
        );
        const prefData = await prefRes.json();
        if (!Array.isArray(prefData) || !prefData.length) {
            res.status(403).send('Token inválido.');
            return;
        }
        const userId = prefData[0].user_id;

        // 2. Busca os eventos desse usuário (bypassa RLS via Service Role)
        const evRes = await fetch(
            `${SUPABASE_URL}/rest/v1/events?select=*&user_id=eq.${encodeURIComponent(userId)}`,
            { headers }
        );
        const events = await evRes.json();

        const body = [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            'PRODID:-//Vend-s Inteligencia CRM//Agenda//PT-BR',
            'CALSCALE:GREGORIAN',
            'METHOD:PUBLISH',
            'X-WR-CALNAME:Vend-s CRM — Agenda',
            'X-WR-TIMEZONE:America/Sao_Paulo',
            ...(Array.isArray(events) ? events.filter(e => e.startDate).map(eventToVEvent) : []),
            'END:VCALENDAR',
        ].join('\r\n');

        res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, max-age=0');
        res.status(200).send(body);
    } catch (err) {
        res.status(500).send('Erro ao gerar a agenda: ' + err.message);
    }
};
