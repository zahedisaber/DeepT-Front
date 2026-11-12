/* Opt-in, browser-only sample data. Never delegate a request to the real API. */
(() => {
    'use strict';
    const { hostname, search } = window.location;
    const flags = new URLSearchParams(search).getAll('hr-preview');
    if (flags.length !== 1 || flags[0] !== '1' || !(hostname.endsWith('.vercel.app') || hostname === 'localhost' || hostname === '127.0.0.1')) return;

    function memoryStorage() {
        const values = new Map();
        return {
            get length() { return values.size; },
            key(index) { return [...values.keys()][Number(index)] ?? null; },
            getItem(key) { return values.get(String(key)) ?? null; },
            setItem(key, value) { values.set(String(key), String(value)); },
            removeItem(key) { values.delete(String(key)); },
            clear() { values.clear(); }
        };
    }
    // Do not even read the original storage getters: an existing login is private.
    Object.defineProperty(window, 'localStorage', { value: memoryStorage(), configurable: true });
    Object.defineProperty(window, 'sessionStorage', { value: memoryStorage(), configurable: true });
    const officeName = 'دفتر نمونه';
    Object.entries({ token: 'sample-only-not-a-credential', user_id: 'sample-office', user_name: officeName,
        user_email: 'sample@example.invalid', account_type: 'office', office_name: officeName, is_admin: '0'
    }).forEach(([key, value]) => localStorage.setItem(`deept_${key}`, value));

    // Keep opt-in across SPA navigation, including logo/home and logout. A full
    // reload without the flag is the only way back to real storage and fetch.
    for (const method of ['pushState', 'replaceState']) {
        const original = history[method].bind(history);
        history[method] = (state, title, url) => {
            if (url != null) {
                const next = new URL(url, location.href);
                next.searchParams.set('hr-preview', '1');
                url = next.href;
            }
            return original(state, title, url);
        };
    }
    history.replaceState(null, '', '/hr?hr-preview=1');

    const banner = document.createElement('aside');
    banner.id = 'hr-sample-banner';
    banner.setAttribute('aria-label', 'Sample data preview');
    banner.innerHTML = '<strong lang="en" dir="ltr">SAMPLE DATA · Sample data preview</strong><span lang="fa" dir="rtl">پیش‌نمایش با داده نمونه؛ تغییرات ذخیره نمی‌شود</span>';
    const style = document.createElement('style');
    style.textContent = `
        :root { --hr-sample-height: 72px; }
        #hr-sample-banner { position:fixed;inset:0 0 auto;z-index:2147483647;box-sizing:border-box;background:#ffda73;color:#332300;border-bottom:2px solid #9b6100;padding:6px 10px;text-align:center;font:12px/1.6 Tahoma,sans-serif;overflow-wrap:anywhere; }
        #hr-sample-banner strong,#hr-sample-banner span { display:block; }
        .header-bar { padding-top:calc(var(--hr-sample-height) + 12px) !important; }
        .hr-overlay,.modal-overlay { top:var(--hr-sample-height) !important; }
        .hr-dialog { max-height:calc(100dvh - var(--hr-sample-height) - 40px) !important; }
        body { padding-top:var(--hr-sample-height); }
        @media(max-width:640px) { .hr-dialog { max-height:calc(100dvh - var(--hr-sample-height) - 16px) !important; } }
    `;
    document.head.appendChild(style);
    document.body.appendChild(banner);
    const measureBanner = () => {
        const height = banner.getBoundingClientRect().height;
        if (height) document.documentElement.style.setProperty('--hr-sample-height', `${Math.ceil(height)}px`);
        if (typeof window.reflowOpenViewHeaderPadding === 'function') window.reflowOpenViewHeaderPadding();
    };
    if (window.ResizeObserver) new ResizeObserver(measureBanner).observe(banner);
    window.addEventListener('resize', measureBanner);
    document.addEventListener('DOMContentLoaded', measureBanner);
    measureBanner();

    let serial = 10;
    const staff = [
        { id: 'sample-sara', full_name: 'سارا احمدی', role: 'مترجم', is_active: true },
        { id: 'sample-reza', full_name: 'رضا محمدی', role: 'ویراستار', is_active: true }
    ];
    const schedules = new Map();
    const daysOff = [];
    const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } });
    const denied = () => json({ detail: 'Sample data preview: این عملیات در پیش‌نمایش مجاز نیست؛ هیچ درخواستی به سرور ارسال نشد.' }, 403);
    const iso = date => window.fmtWeekISO(date);
    function scheduleList(person) {
        if (!schedules.has(person.id)) {
            const current = window.hrCurrentMonth();
            const effective = iso(window.jalaliMonthBounds(current.y, current.m).firstDay);
            const target = person.id === 'sample-reza' ? 420 : 480;
            schedules.set(person.id, [{ id: `schedule-${person.id}`, staff_id: person.id, effective_from: effective,
                weekly_minutes: Array(7).fill(target), weekly_start_minutes: Array(7).fill(1020 - target), weekly_end_minutes: Array(7).fill(1020) }]);
        }
        return schedules.get(person.id);
    }
    const time = minutes => minutes == null ? null : `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
    function attendance(url) {
        const current = window.hrCurrentMonth();
        const first = iso(window.jalaliMonthBounds(current.y, current.m).firstDay);
        const today = window.hrToday();
        const add = (day, n) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
        const shift = (id, person, day, start, end, remote = false, next = false) => ({ id, staff_id: person.id, staff_name: person.full_name,
            clock_in: new Date(`${day}T${start}:00+03:30`).toISOString(),
            clock_out: end ? new Date(`${next ? add(day, 1) : day}T${end}:00+03:30`).toISOString() : null,
            is_remote: remote, note: 'SAMPLE DATA - داده نمونه' });
        const rows = [
            shift('sample-boundary', staff[0], first, '00:15', '08:15'),
            shift('sample-remote', staff[1], first, '09:00', '16:00', true),
            shift('sample-night', staff[0], add(first, 1), '22:00', '06:00', false, true),
            shift('sample-extra', staff[0], first, '17:00', '18:00'),
            shift('sample-open', staff[1], today, '08:30', null, true)
        ];
        if (url.searchParams.get('open_only') === 'true') return rows.filter(r => r.clock_out == null);
        const from = url.searchParams.get('from'), to = url.searchParams.get('to');
        const lo = from ? Date.parse(`${from}T00:00:00+03:30`) : -Infinity;
        const hi = to ? Date.parse(`${to}T23:59:59.999+03:30`) : Infinity;
        return rows.filter(r => (!url.searchParams.get('staff_id') || r.staff_id === url.searchParams.get('staff_id')) &&
            Date.parse(r.clock_in) <= hi && (url.searchParams.get('overlap') === 'true' && r.clock_out ? Date.parse(r.clock_out) > lo : Date.parse(r.clock_in) >= lo));
    }
    function report(person, year, month) {
        const first = window.jalaliMonthBounds(year, month).firstDay;
        const history = scheduleList(person);
        const days = Array.from({ length: 8 }, (_, i) => {
            const date = new Date(first); date.setDate(first.getDate() + i);
            const dateISO = iso(date), weekday = (date.getDay() + 1) % 7;
            const schedule = history.filter(s => s.effective_from <= dateISO).sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0];
            const target = schedule?.weekly_minutes[weekday] || 0;
            const start = schedule?.weekly_start_minutes?.[weekday] ?? null;
            const end = schedule?.weekly_end_minutes?.[weekday] ?? null;
            const off = daysOff.find(d => d.date === dateISO && (!d.staff_id || d.staff_id === person.id));
            let status = ['present', 'present', 'present', 'shortfall', 'absent', 'overtime', 'incomplete', 'day_off'][i];
            if (!schedule) status = 'not_configured';
            else if (off || !target) status = 'day_off';
            const working = !['not_configured', 'day_off'].includes(status);
            const expected = working ? target : 0;
            let presence = !working || i === 4 ? 0 : Math.max(0, target + (i === 3 ? -60 : i === 5 ? 60 : i === 6 ? -120 : 0));
            // Match the seeded calendar's daily totals, including the clipped overnight shift.
            if (working && person.id === 'sample-sara' && i < 3) {
                presence = [540, 120, 360][i];
                status = presence > expected ? 'overtime' : presence < expected ? 'shortfall' : 'present';
            }
            const arrival = working && i !== 4 ? start == null ? null : start + (i === 1 ? 20 : i === 2 ? -20 : 0) : null;
            const departure = arrival == null || i === 6 ? null : arrival + presence;
            const provisional = ['incomplete', 'not_configured'].includes(status);
            return { date: dateISO, status, reason: `SAMPLE DATA / داده و معیارهای نمونه، نه محاسبه سرور${off ? `: ${off.reason}` : ''}`,
                scheduled_start: time(start), scheduled_end: time(end), first_arrival: time(arrival), last_departure: time(departure),
                presence_minutes: presence, expected_minutes: expected,
                absence_minutes: provisional ? null : Math.max(0, expected - presence),
                overtime_minutes: provisional ? null : Math.max(0, presence - expected),
                late_minutes: provisional || arrival == null || start == null ? null : Math.max(0, arrival - start),
                early_departure_minutes: provisional || departure == null || end == null ? null : Math.max(0, end - departure) };
        });
        const incompleteDays = days.filter(d => d.status === 'incomplete').length;
        const entry = { staff_id: person.id, full_name: person.full_name, days, is_complete: incompleteDays === 0, incomplete_days: incompleteDays };
        for (const [total, daily] of Object.entries({ presence: 'presence', expected: 'expected', absence: 'absence', overtime: 'overtime', late: 'late', early_departure: 'early_departure' })) {
            entry[`total_${total}_minutes`] = days.reduce((sum, d) => sum + (total === 'expected' && ['incomplete', 'not_configured'].includes(d.status) ? 0 : d[`${daily}_minutes`] || 0), 0);
        }
        return { year, month, sample_data: true, staff: [entry] };
    }

    // Minimal OpenXML workbook in a standards-compliant, uncompressed ZIP.
    // Inline strings avoid shared-string state; duration cells are numeric days.
    function workbook(data) {
        const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c])).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
        const s = data.staff[0];
        const rows = [
            ['SAMPLE DATA / داده نمونه؛ معیارهای نمونه، نه محاسبه سرور'],
            [s.full_name, `${data.year}/${String(data.month).padStart(2, '0')}`, s.staff_id],
            ['حضور', 'موظفی', 'کسری', 'اضافه‌کار', 'تأخیر', 'خروج زودهنگام'],
            [s.total_presence_minutes, s.total_expected_minutes, s.total_absence_minutes, s.total_overtime_minutes, s.total_late_minutes, s.total_early_departure_minutes],
            ['تاریخ شمسی', 'شروع مقرر', 'پایان مقرر', 'ورود', 'خروج', 'حضور', 'موظفی', 'کسری', 'اضافه‌کار', 'تأخیر', 'خروج زودهنگام', 'وضعیت'],
            ...s.days.map(d => [window.hrDateDisplay(d.date), d.scheduled_start, d.scheduled_end, d.first_arrival, d.last_departure,
                d.presence_minutes, d.expected_minutes, d.absence_minutes, d.overtime_minutes, d.late_minutes, d.early_departure_minutes, d.status])
        ];
        const sheet = rows.map((row, r) => `<row r="${r + 1}">${row.map((v, c) => `<c r="${String.fromCharCode(65 + c)}${r + 1}" ${typeof v === 'number' ? `s="1"><v>${v / 1440}</v>` : `t="inlineStr"><is><t>${escape(v ?? '')}</t></is>`}</c>`).join('')}</row>`).join('');
        const files = {
            '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
            '_rels/.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
            'xl/workbook.xml': '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sample attendance" sheetId="1" r:id="rId1"/></sheets></workbook>',
            'xl/_rels/workbook.xml.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
            'xl/styles.xml': '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="[h]:mm"/></numFmts><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>',
            'xl/worksheets/sheet1.xml': `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0" rightToLeft="1"/></sheetViews><sheetData>${sheet}</sheetData></worksheet>`
        };
        const encoder = new TextEncoder(), chunks = [], central = [];
        let offset = 0, centralSize = 0;
        for (const [name, xml] of Object.entries(files)) {
            const filename = encoder.encode(name), bytes = encoder.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${xml}`);
            let crc = 0xffffffff;
            for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
            crc = (crc ^ 0xffffffff) >>> 0;
            const local = new Uint8Array(30 + filename.length), l = new DataView(local.buffer);
            l.setUint32(0, 0x04034b50, true); l.setUint16(4, 20, true); l.setUint16(12, 33, true);
            l.setUint32(14, crc, true); l.setUint32(18, bytes.length, true); l.setUint32(22, bytes.length, true); l.setUint16(26, filename.length, true); local.set(filename, 30);
            const directory = new Uint8Array(46 + filename.length), d = new DataView(directory.buffer);
            d.setUint32(0, 0x02014b50, true); d.setUint16(4, 20, true); d.setUint16(6, 20, true); d.setUint16(14, 33, true);
            d.setUint32(16, crc, true); d.setUint32(20, bytes.length, true); d.setUint32(24, bytes.length, true); d.setUint16(28, filename.length, true); d.setUint32(42, offset, true); directory.set(filename, 46);
            chunks.push(local, bytes); central.push(directory); offset += local.length + bytes.length; centralSize += directory.length;
        }
        const end = new Uint8Array(22), e = new DataView(end.buffer);
        e.setUint32(0, 0x06054b50, true); e.setUint16(8, central.length, true); e.setUint16(10, central.length, true); e.setUint32(12, centralSize, true); e.setUint32(16, offset, true);
        return new Blob([...chunks, ...central, end], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    }

    window.fetch = async (input, init = {}) => {
        try {
            const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, location.href);
            const method = String(init.method || input.method || 'GET').toUpperCase();
            // Match the app's Core origin explicitly; arbitrary hosts never pass.
            if (url.origin !== 'https://core.deept.ir') return denied();
            const p = url.pathname;
            let body = {};
            if (method !== 'GET' && method !== 'DELETE') {
                const raw = init.body ?? (typeof input.clone === 'function' ? await input.clone().text() : '{}');
                body = JSON.parse(raw || '{}');
            }
            if (method === 'GET') {
                if (p === '/auth/verify') return json({ valid: true, user_id: 'sample-office', account_type: 'office', office_name: officeName, contact_info: '' });
                if (p === '/wallet/sample-office') return json({ balance_toman: 0 });
                if (p === '/announcements/active') return json({ active: false });
                if (p === '/hr/location') return json({ office_lat: 35.7, office_lng: 51.4 });
                if (p === '/hr/attendance') return json(attendance(url), 200, { 'X-HR-Calendar': 'overlap-v1' });
                if (p === '/hr/staff') return json(staff);
                if (p === '/hr/reports/monthly' || p === '/hr/reports/monthly.xlsx') {
                    const person = staff.find(s => s.id === url.searchParams.get('staff_id'));
                    const year = Number(url.searchParams.get('year')), month = Number(url.searchParams.get('month'));
                    if ((url.searchParams.has('staff_id') && !person) || (p.endsWith('.xlsx') && !person) || !Number.isInteger(year) || year < 1300 || year > 1600 || !Number.isInteger(month) || month < 1 || month > 12) return json({ detail: 'Select sample staff and a valid Shamsi period.' }, 400);
                    const data = person ? report(person, year, month) : { year, month, sample_data: true, staff: staff.flatMap(s => report(s, year, month).staff) };
                    if (p.endsWith('.xlsx')) {
                        const blob = workbook(data);
                        return new Response(blob, { headers: { 'Content-Type': blob.type, 'Content-Disposition': `attachment; filename="sample-${year}-${month}-${person.id}.xlsx"` } });
                    }
                    return json(data);
                }
            }
            if (p === '/hr/staff' && method === 'POST') {
                if (!body.full_name?.trim() || !body.pin) return json({ detail: 'Name and PIN required.' }, 422);
                const person = { id: `sample-${++serial}`, full_name: String(body.full_name).trim(), role: String(body.role || ''), is_active: true };
                staff.push(person); return json(person, 201);
            }
            const match = p.match(/^\/hr\/staff\/([^/]+)(?:\/schedules(?:\/([^/]+))?)?$/);
            if (match) {
                const person = staff.find(s => s.id === decodeURIComponent(match[1]));
                if (!person) return json({ detail: 'Sample staff not found.' }, 404);
                if (p.includes('/schedules')) {
                    const list = scheduleList(person);
                    if (method === 'GET' && !match[2]) return json(list);
                    if (method === 'POST' && !match[2]) {
                        if (!/^\d{4}-\d{2}-\d{2}$/.test(body.effective_from || '') || !window.hrDateDisplay(body.effective_from)) return json({ detail: 'Invalid date.' }, 422);
                        for (let i = 0; i < 7; i++) {
                            const minutes = body.weekly_minutes?.[i], start = body.weekly_start_minutes?.[i], end = body.weekly_end_minutes?.[i];
                            if (!Array.isArray(body.weekly_minutes) || body.weekly_minutes.length !== 7 || !Array.isArray(body.weekly_start_minutes) || body.weekly_start_minutes.length !== 7 || !Array.isArray(body.weekly_end_minutes) || body.weekly_end_minutes.length !== 7 || !Number.isInteger(minutes) || minutes < 0 || minutes > 1440 || (start == null) !== (end == null) || (start != null && (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > 1439 || end <= start || !minutes || minutes > end - start))) return json({ detail: 'Invalid sample schedule.' }, 422);
                        }
                        if (list.some(s => s.effective_from === body.effective_from)) return json({ detail: 'Schedule already exists for this date.' }, 409);
                        const saved = { id: `schedule-${++serial}`, staff_id: person.id, effective_from: body.effective_from, weekly_minutes: body.weekly_minutes, weekly_start_minutes: body.weekly_start_minutes, weekly_end_minutes: body.weekly_end_minutes };
                        list.push(saved); return json(saved, 201);
                    }
                    if (method === 'DELETE' && match[2]) {
                        const index = list.findIndex(s => s.id === decodeURIComponent(match[2]));
                        if (index < 0) return json({ detail: 'Schedule not found.' }, 404);
                        list.splice(index, 1); return json({ ok: true });
                    }
                } else {
                    if (method === 'PATCH') {
                        if (typeof body.is_active === 'boolean') person.is_active = body.is_active;
                        if (typeof body.full_name === 'string' && body.full_name.trim()) person.full_name = body.full_name.trim();
                        if (typeof body.role === 'string') person.role = body.role;
                        return json(person);
                    }
                    if (method === 'DELETE') { staff.splice(staff.indexOf(person), 1); schedules.delete(person.id); return json({ ok: true }); }
                }
            }
            if (p === '/hr/days-off') {
                if (method === 'GET') return json(daysOff.filter(d => (!url.searchParams.get('from') || d.date >= url.searchParams.get('from')) && (!url.searchParams.get('to') || d.date <= url.searchParams.get('to'))));
                if (method === 'POST') {
                    if (!window.hrDateDisplay(body.date) || !body.reason?.trim() || (body.staff_id && !staff.some(s => s.id === body.staff_id))) return json({ detail: 'Invalid sample day off.' }, 422);
                    if (daysOff.some(d => d.date === body.date && d.staff_id === (body.staff_id || null))) return json({ detail: 'Day off already exists.' }, 409);
                    const saved = { id: `day-off-${++serial}`, date: body.date, staff_id: body.staff_id || null, reason: String(body.reason) };
                    daysOff.push(saved); return json(saved, 201);
                }
            }
            if (method === 'DELETE' && /^\/hr\/days-off\/[^/]+$/.test(p)) {
                const index = daysOff.findIndex(d => d.id === decodeURIComponent(p.split('/').pop()));
                if (index < 0) return json({ detail: 'Day off not found.' }, 404);
                daysOff.splice(index, 1); return json({ ok: true });
            }
            return denied();
        } catch {
            return denied();
        }
    };
})();
