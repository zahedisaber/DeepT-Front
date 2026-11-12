const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const preview = fs.readFileSync(path.join(root, 'hr-preview.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const catalog = fs.readFileSync(path.join(root, 'price-catalog.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const core = 'https://core.deept.ir';
function setup(t, url = 'https://example.vercel.app/?hr-preview=1', loadApp = true) {
    const dom = new JSDOM(html, { url, runScripts: 'outside-only', pretendToBeVisual: true });
    t.after(() => dom.window.close());
    const w = dom.window, realLocal = w.localStorage, realSession = w.sessionStorage;
    realLocal.setItem('deept_token', 'private-existing-login');
    realLocal.setItem('unrelated', 'private-value');
    realSession.setItem('deept_redirect_path', '/admin');
    const beforeLocal = JSON.stringify(realLocal), beforeSession = JSON.stringify(realSession);
    let storageTouches = 0, liveFetches = 0;
    Object.defineProperty(w, 'localStorage', { configurable: true, get() { storageTouches++; throw Error('Real local storage touched'); } });
    Object.defineProperty(w, 'sessionStorage', { configurable: true, get() { storageTouches++; throw Error('Real session storage touched'); } });
    const originalFetch = w.fetch = () => { liveFetches++; throw Error('Live fetch attempted'); };
    Object.assign(w, { Response, Request, Headers, Blob, TextEncoder });
    w.requestAnimationFrame = () => 0;
    w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: () => () => {} });
    w.matchMedia = () => ({ matches: false, addEventListener() {} });
    w.confirm = () => true;
    w.scrollTo = () => {};
    w.HTMLElement.prototype.scrollIntoView = () => {};
    const downloads = [];
    w.URL.createObjectURL = blob => { downloads.push(blob); return 'blob:sample'; };
    w.URL.revokeObjectURL = () => {};
    w.HTMLAnchorElement.prototype.click = () => {};
    const run = code => vm.runInContext(code, dom.getInternalVMContext());
    run(preview);
    if (loadApp) { run(catalog); run(app); }
    return { w, run, downloads, originalFetch, storageTouches: () => storageTouches, liveFetches: () => liveFetches,
        unchanged() { assert.equal(storageTouches, 0); assert.equal(liveFetches, 0); assert.equal(JSON.stringify(realLocal), beforeLocal); assert.equal(JSON.stringify(realSession), beforeSession); },
        api: (route, method = 'GET', body) => w.fetch(core + route, { method, ...(body ? { body: JSON.stringify(body) } : {}) }),
        tick: () => new Promise(resolve => setImmediate(resolve)) };
}
const currentQuery = h => h.run('new URLSearchParams({ year: hrCurrentMonth().y, month: hrCurrentMonth().m, staff_id: "sample-sara" }).toString()');

test('preview script is included before app and after catalog', () => {
    assert.ok(html.indexOf('src="/price-catalog.js"') < html.indexOf('src="/hr-preview.js"'));
    assert.ok(html.indexOf('src="/hr-preview.js"') < html.indexOf('src="/app.js"'));
});

test('exact opt-in and host boundary only; inactive mode leaves everything untouched', t => {
    for (const url of ['https://deept.ir/?hr-preview=1', 'https://example.vercel.app/', 'https://example.vercel.app/?hr-preview=0',
        'https://example.vercel.app/?hr-preview=11', 'https://example.vercel.app/?hr-preview=1&hr-preview=0',
        'https://example.vercel.app.evil.test/?hr-preview=1', 'https://notvercel.app/?hr-preview=1',
        'https://vercel.app/?hr-preview=1', 'https://localhost.evil.test/?hr-preview=1']) {
        const h = setup(t, url, false);
        assert.equal(h.w.fetch, h.originalFetch, url);
        assert.equal(h.w.location.href, url);
        assert.equal(h.w.document.getElementById('hr-sample-banner'), null);
        assert.equal(Object.getOwnPropertyDescriptor(h.w, 'localStorage').value, undefined);
        h.unchanged();
    }
    for (const host of ['example.vercel.app', 'localhost', '127.0.0.1']) {
        const h = setup(t, `http://${host}/?hr-preview=1`, false);
        assert.notEqual(h.w.fetch, h.originalFetch);
        assert.equal(h.w.localStorage.getItem('deept_account_type'), 'office');
        h.unchanged();
    }
});

test('actual app initializes office HR, renders two staff, and never touches original storage, even on logout', async t => {
    const h = setup(t);
    await h.tick();
    assert.equal(h.w.location.pathname + h.w.location.search, '/hr?hr-preview=1');
    assert.equal(h.run('currentUserSession.type'), 'office');
    assert.equal(h.w.document.getElementById('hrPage').classList.contains('hidden'), false);
    assert.equal(h.w.document.querySelectorAll('[data-hr-report-staff]').length, 2);
    assert.match(h.w.document.getElementById('hr-staff-list').textContent, /سارا احمدی/);
    assert.match(h.w.document.getElementById('hr-location').textContent, /ثبت شده/);
    assert.match(h.w.document.getElementById('hr-sample-banner').textContent, /Sample data preview.*تغییرات ذخیره نمی‌شود/);
    h.w.localStorage.setItem('a', 42);
    assert.equal(h.w.localStorage.getItem('a'), '42');
    assert.equal(h.w.sessionStorage.getItem('a'), null);
    h.w.sessionStorage.setItem('session-only', 'x');
    assert.equal(h.w.sessionStorage.key(0), 'session-only');
    h.run('executeLogout()');
    assert.equal(h.w.localStorage.getItem('deept_token'), null);
    assert.ok(h.w.document.getElementById('hr-sample-banner'));
    h.unchanged();
});

test('all unsupported fetches including external, writes, Request objects and navigation stay contained', async t => {
    const h = setup(t);
    for (const input of [core + '/wallet/topup/initiate', core + '/hr/clock', core + '/auth/me',
        core + '/hr/reports/all', 'https://evil.test/hr/staff', 'https://backend.deept.ir/jobs', '/app.js',
        new Request(core + '/auth/login', { method: 'POST', body: '{}' })]) {
        const res = await h.w.fetch(input, typeof input === 'string' ? { method: 'POST', body: '{}' } : {});
        assert.equal(res.status, 403);
        assert.match((await res.json()).detail, /Sample data preview/);
    }
    for (const route of ['/auth/verify', '/hr/staff', '/wallet/sample-office', '/announcements/active', '/hr/location', '/hr/attendance']) {
        assert.equal((await h.api(route, 'PUT', {})).status, 403);
    }
    h.run("navigateTo('/home'); applyRouteForPath('/home')");
    await h.tick();
    assert.equal(h.w.location.search, '?hr-preview=1');
    assert.equal((await h.w.fetch('https://example.com/')).status, 403);
    h.run('openHrPage()');
    await h.tick();
    assert.equal(h.w.location.pathname + h.w.location.search, '/hr?hr-preview=1');
    h.unchanged();
});

test('selected-only monthly samples use queried Shamsi bounds and independent timing/duration metrics', async t => {
    const h = setup(t);
    await h.tick();
    const query = currentQuery(h);
    const data = await (await h.api('/hr/reports/monthly?' + query)).json();
    assert.equal(data.staff.length, 1);
    assert.equal(data.staff[0].staff_id, 'sample-sara');
    assert.equal(data.sample_data, true);
    const days = data.staff[0].days;
    for (const d of days) {
        const j = h.run(`gregorianToJalali(new Date('${d.date}T12:00:00'))`);
        assert.equal(j.y, data.year); assert.equal(j.m, data.month);
        assert.match(d.reason, /SAMPLE DATA/);
    }
    assert.deepEqual(days.slice(0, 6).map(d => d.status), ['present', 'present', 'present', 'shortfall', 'absent', 'overtime']);
    assert.equal(days[1].late_minutes, 20); assert.equal(days[1].absence_minutes, 0); assert.equal(days[1].presence_minutes, 480);
    assert.equal(days[2].early_departure_minutes, 20); assert.equal(days[2].absence_minutes, 0);
    assert.equal(days[3].absence_minutes, 60); assert.equal(days[4].absence_minutes, 480); assert.equal(days[5].overtime_minutes, 60);
    const second = await (await h.api('/hr/reports/monthly?' + query.replace('sample-sara', 'sample-reza'))).json();
    assert.equal(second.staff[0].days[0].expected_minutes, 420);
    assert.equal(second.staff[0].days[0].scheduled_start, '10:00');
    for (const [year, month] of [[1404, 12], [1405, 1], [1406, 6]]) {
        const other = await (await h.api(`/hr/reports/monthly?year=${year}&month=${month}&staff_id=sample-reza`)).json();
        assert.equal(other.year, year); assert.equal(other.month, month);
        for (const day of other.staff[0].days) assert.equal(h.run(`gregorianToJalali(new Date('${day.date}T12:00:00')).m`), month);
        assert.ok(!JSON.stringify(other).includes('سارا'));
    }
    assert.equal((await h.api('/hr/reports/monthly?year=1405&month=8')).status, 400);
    assert.equal((await h.api('/hr/reports/monthly?year=1405&month=13&staff_id=sample-sara')).status, 400);
    h.unchanged();
});

test('schedule validation, conflict, deletion, effective dates and report recalculation stay in memory', async t => {
    const h = setup(t);
    const route = '/hr/staff/sample-sara/schedules';
    const initial = (await (await h.api(route)).json())[0];
    assert.equal((await h.api(route, 'POST', initial)).status, 409);
    assert.equal((await h.api(route, 'POST', { ...initial, weekly_minutes: [1] })).status, 422);
    assert.equal((await h.api(`${route}/${initial.id}`, 'DELETE')).status, 200);
    const saved = await h.api(route, 'POST', { ...initial, weekly_minutes: Array(7).fill(360), weekly_start_minutes: Array(7).fill(660) });
    assert.equal(saved.status, 201);
    const data = await (await h.api('/hr/reports/monthly?' + currentQuery(h))).json();
    assert.equal(data.staff[0].days[0].scheduled_start, '11:00');
    assert.equal(data.staff[0].days[0].expected_minutes, 360);
    assert.equal((await (await h.api(route)).json()).length, 1);
    h.unchanged();
});

test('personal leave and office days off have safe scoped CRUD and affect reports', async t => {
    const h = setup(t);
    const query = currentQuery(h);
    const original = await (await h.api('/hr/reports/monthly?' + query)).json();
    const date = original.staff[0].days[0].date;
    const saved = await (await h.api('/hr/days-off', 'POST', { date, staff_id: 'sample-sara', reason: 'مرخصی نمونه' })).json();
    assert.equal((await (await h.api(`/hr/days-off?from=${date}&to=${date}`)).json()).length, 1);
    assert.equal((await (await h.api('/hr/days-off?from=2099-01-01')).json()).length, 0);
    const report = await (await h.api('/hr/reports/monthly?' + query)).json();
    assert.equal(report.staff[0].days[0].status, 'day_off');
    assert.equal(report.staff[0].days[0].expected_minutes, 0);
    const other = await (await h.api('/hr/reports/monthly?' + query.replace('sample-sara', 'sample-reza'))).json();
    assert.equal(other.staff[0].days[0].status, 'present');
    assert.equal((await h.api(`/hr/days-off/${saved.id}`, 'DELETE')).status, 200);
    assert.equal((await (await h.api('/hr/reports/monthly?' + query)).json()).staff[0].days[0].status, 'present');
    h.unchanged();
});

test('roster create, patch, delete use only memory and unknown IDs fail closed', async t => {
    const h = setup(t);
    const created = await (await h.api('/hr/staff', 'POST', { full_name: 'کارمند نمونه', role: 'آزمایشی', pin: '1234' })).json();
    assert.equal((await (await h.api('/hr/staff')).json()).length, 3);
    const patched = await (await h.api(`/hr/staff/${created.id}`, 'PATCH', { is_active: false })).json();
    assert.equal(patched.is_active, false);
    assert.equal((await h.api(`/hr/staff/${created.id}`, 'DELETE')).status, 200);
    assert.equal((await h.api(`/hr/staff/${created.id}/schedules`)).status, 404);
    assert.equal((await (await h.api('/hr/staff')).json()).length, 2);
    h.unchanged();
});

function unzipStored(bytes) {
    const result = new Map();
    let offset = 0;
    while (bytes.readUInt32LE(offset) === 0x04034b50) {
        assert.equal(bytes.readUInt16LE(offset + 8), 0);
        const length = bytes.readUInt32LE(offset + 18), nameLength = bytes.readUInt16LE(offset + 26), extra = bytes.readUInt16LE(offset + 28);
        const name = bytes.subarray(offset + 30, offset + 30 + nameLength).toString();
        const start = offset + 30 + nameLength + extra;
        result.set(name, bytes.subarray(start, start + length).toString());
        offset = start + length;
    }
    assert.equal(bytes.readUInt32LE(offset), 0x02014b50);
    assert.equal(bytes.readUInt32LE(bytes.length - 22), 0x06054b50);
    assert.equal(bytes.readUInt16LE(bytes.length - 12), result.size);
    return result;
}

test('Excel is real OpenXML ZIP with only selected staff, requested period, numeric duration style and sample label', async t => {
    const h = setup(t);
    const res = await h.api('/hr/reports/monthly.xlsx?year=1405&month=8&staff_id=sample-reza');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /spreadsheetml.sheet/);
    const bytes = Buffer.from(await res.arrayBuffer());
    const files = unzipStored(bytes);
    assert.equal(files.size, 6);
    const sheet = files.get('xl/worksheets/sheet1.xml');
    assert.match(sheet, /رضا محمدی/); assert.match(sheet, /1405\/08/); assert.match(sheet, /SAMPLE DATA/);
    assert.ok(!sheet.includes('سارا')); assert.ok(!sheet.includes('sample-sara'));
    assert.match(sheet, /<c r="A4" s="1"><v>[\d.]+<\/v><\/c>/);
    assert.match(files.get('xl/styles.xml'), /formatCode="\[h\]:mm"/);
    for (const xml of files.values()) {
        const doc = new h.w.DOMParser().parseFromString(xml, 'application/xml');
        assert.equal(doc.querySelector('parsererror'), null);
    }
    h.unchanged();
});

test('actual report UI, HTML and XLSX downloads work with scoped sample data', async t => {
    const h = setup(t);
    await h.tick();
    await h.run("openHrReport('sample-sara')");
    assert.equal(h.w.document.querySelectorAll('#hr-report-content tbody tr').length, 8);
    assert.ok(h.w.document.querySelectorAll('#hr-report-content .hr-timing-alert').length >= 2);
    assert.equal(h.w.document.getElementById('hr-report-excel').disabled, false);
    await h.run("exportHrReport('html')");
    const exported = await h.downloads[0].text();
    assert.match(exported, /سارا احمدی/); assert.match(exported, /SAMPLE DATA/); assert.ok(!exported.includes('رضا'));
    await h.run("exportHrReport('xlsx')");
    assert.equal(h.downloads.length, 2);
    assert.equal(Buffer.from(await h.downloads[1].arrayBuffer()).subarray(0, 2).toString(), 'PK');
    h.unchanged();
});
