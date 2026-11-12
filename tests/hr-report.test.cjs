const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const response = data => ({ ok: true, headers: new Headers({ 'X-HR-Calendar': 'overlap-v1' }), json: async () => data });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const staff = [{ id: 'one', full_name: '<img src=x onerror=alert(1)> سارا', is_active: true }, { id: 'two', full_name: 'رضا', is_active: true }];
function fixture(url) {
    return { year: Number(url.searchParams.get('year')), month: Number(url.searchParams.get('month')), staff: staff.map(s => ({
        staff_id: s.id, full_name: s.full_name, is_complete: false, incomplete_days: 1,
        total_presence_minutes: 480, total_expected_minutes: 480, total_absence_minutes: 0, total_overtime_minutes: 0,
        total_late_minutes: 30, total_early_departure_minutes: 10,
        days: [{ date: '2026-10-24', jalali_date: '1405/08/02', status: 'present', reason: '<script>bad()</script>',
            scheduled_start: '08:00', scheduled_end: '17:00', first_arrival: '08:30', last_departure: '16:50',
            presence_minutes: 480, expected_minutes: 480, absence_minutes: 0, overtime_minutes: 0, late_minutes: 30, early_departure_minutes: 10 },
        { date: '2026-10-25', status: 'pending', late_minutes: null, early_departure_minutes: null, presence_minutes: 1, expected_minutes: 480, absence_minutes: 0, overtime_minutes: 0 }]
    })) };
}
function setup(t) {
    const dom = new JSDOM(html, { url: 'https://frontend.test/', runScripts: 'outside-only', pretendToBeVisual: true });
    t.after(() => dom.window.close());
    const w = dom.window, requests = [], downloads = [];
    w.requestAnimationFrame = () => 0;
    w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: () => () => {} });
    w.matchMedia = () => ({ matches: false, addEventListener() {} });
    w.confirm = () => true;
    w.scrollTo = () => {};
    w.HTMLElement.prototype.scrollIntoView = () => {};
    w.HTMLAnchorElement.prototype.click = function () { downloads.push({ filename: this.download, href: this.href }); };
    const blobs = [];
    w.URL.createObjectURL = blob => { blobs.push(blob); return `blob:test-${blobs.length}`; };
    w.URL.revokeObjectURL = () => {};
    let handler = async url => {
        if (url.pathname === '/hr/staff') return response(staff);
        if (url.pathname === '/hr/reports/monthly') return response(fixture(url));
        if (url.pathname.endsWith('/schedules')) return response([{ id: 's1', effective_from: '2020-01-01', weekly_minutes: [450, 480, 480, 480, 480, 0, 0], weekly_start_minutes: null, weekly_end_minutes: [null, null, null, null, null, null, null] }]);
        return response([]);
    };
    w.fetch = async (url, options = {}) => { const parsed = new URL(url); requests.push({ url: parsed, options }); return handler(parsed, options); };
    const context = dom.getInternalVMContext();
    const run = code => vm.runInContext(code, context);
    run(source);
    run(`localStorage.setItem('deept_token', 'test-token'); hrStaffList = ${JSON.stringify(staff)}; renderHrStaffList();`);
    requests.length = 0;
    return { w, run, requests, downloads, blobs, handler: fn => { handler = fn; }, tick: () => new Promise(r => setImmediate(r)) };
}

test('roster icons are beside each name, escaped, accessible; main page never fetches reports', async t => {
    const h = setup(t);
    await h.run('loadHrSettings()');
    assert.equal(h.w.document.querySelectorAll('[data-hr-report-staff]').length, 2);
    const button = h.w.document.querySelector('[data-hr-report-staff]');
    assert.equal(button.parentElement.className, 'hr-staff-name');
    assert.ok(button.getAttribute('aria-label').includes(staff[0].full_name));
    assert.equal(button.title, button.getAttribute('aria-label'));
    assert.equal(h.w.document.querySelector('#hr-staff-list img'), null);
    assert.equal(h.requests.some(r => r.url.pathname.includes('/reports/')), false);
    assert.equal(h.w.document.querySelector('#hr-days-off-admin').open, false);
    button.click();
    await h.tick();
    assert.equal(h.requests.at(-1).url.searchParams.get('staff_id'), 'one');
    assert.equal(h.w.document.querySelector('#hrReportModal').classList.contains('hidden'), false);
});

test('selected-only daily report, punctuality despite full duration, nulls and escaped self-contained HTML', async t => {
    const h = setup(t);
    await h.run("openHrReport('one')");
    const content = h.w.document.querySelector('#hr-report-content');
    assert.equal(content.querySelectorAll('tbody tr').length, 2);
    assert.equal(content.querySelectorAll('.hr-timing-alert').length, 2);
    assert.equal(content.querySelectorAll('tbody tr')[1].children[9].textContent, '—');
    assert.equal(content.querySelectorAll('tbody tr')[1].children[7].textContent, '—');
    assert.ok(content.textContent.includes('08:30'));
    assert.ok(!content.textContent.includes('رضا'));
    assert.match(h.w.document.querySelector('#hr-report-status').textContent, /ناقص/);
    const doc = h.run('hrReportDocument(hrReport.data)');
    assert.match(doc, /dir="rtl"/);
    assert.match(doc, /&lt;script&gt;bad\(\)&lt;\/script&gt;/);
    assert.ok(!doc.includes('<img'));
    assert.ok(!doc.includes('2026-10-24'));
    assert.ok(!doc.includes('رضا'));
    assert.ok(!doc.includes('<script'));
    assert.equal(content.querySelector('details').open, false);
    const printable = new JSDOM(doc);
    assert.equal(printable.window.document.querySelector('details').open, true);
    assert.equal(printable.window.document.querySelectorAll('details:not([open])').length, 0);
    printable.window.close();
    await h.run("exportHrReport('html')");
    assert.match(h.downloads[0].filename, /-one\.html$/);
});

test('real authenticated XLSX blob fetch is scoped and JSON impostors disable exports', async t => {
    const h = setup(t);
    await h.run("openHrReport('two')");
    h.handler(async url => ({ ok: true, headers: new Headers({ 'content-type': mime }), blob: async () => new h.w.Blob(['PK-fixture'], { type: mime }) }));
    await h.run("exportHrReport('xlsx')");
    const request = h.requests.at(-1);
    assert.equal(request.url.pathname, '/hr/reports/monthly.xlsx');
    assert.equal(request.url.searchParams.get('staff_id'), 'two');
    assert.equal(request.options.headers.Authorization, 'Bearer test-token');
    assert.match(h.downloads[0].filename, /-two\.xlsx$/);
    assert.equal(h.blobs[0].type, mime);
    h.handler(async () => ({ ok: true, headers: new Headers({ 'content-type': 'application/json' }) }));
    await h.run("exportHrReport('xlsx')");
    assert.equal(h.downloads.length, 1);
    assert.equal(h.w.document.querySelector('#hr-report-excel').disabled, true);
});

test('late report responses never replace the selected employee or month; closed/error exports blocked', async t => {
    const h = setup(t), first = deferred();
    let firstUrl;
    h.handler(async url => { if (!firstUrl) { firstUrl = url; return first.promise; } return response(fixture(url)); });
    const old = h.run("openHrReport('one')");
    assert.equal(h.w.document.querySelector('#hr-report-html').disabled, true);
    await h.run("openHrReport('two')");
    first.resolve(response(fixture(firstUrl)));
    await old;
    assert.equal(h.run('hrReport.data.staff.staff_id'), 'two');
    const next = deferred();
    h.handler(url => { firstUrl = url; return next.promise; });
    const pending = h.run('loadHrReport()');
    h.w.document.querySelector('#hr-report-month').value = '2';
    h.handler(async url => response(fixture(url)));
    await h.run('loadHrReport()');
    next.resolve(response(fixture(firstUrl)));
    await pending;
    assert.equal(h.run('Number(hrReport.data.month)'), 2);
    h.run('closeHrReport()');
    await h.run("exportHrReport('html')");
    assert.equal(h.downloads.length, 0);
    h.handler(async () => ({ ok: false }));
    await h.run("openHrReport('two')");
    assert.equal(h.w.document.querySelector('#hr-report-excel').disabled, true);
});

test('pending Excel is discarded on employee/month changes or close; year edits invalidate immediately', async t => {
    const h = setup(t);
    for (const action of ["openHrReport('two')", "document.getElementById('hr-report-month').value='2';loadHrReport()", 'closeHrReport()']) {
        h.handler(async url => response(fixture(url)));
        await h.run("openHrReport('one')");
        const wait = deferred();
        h.handler(url => url.pathname.endsWith('.xlsx') ? wait.promise : Promise.resolve(response(fixture(url))));
        const exporting = h.run("exportHrReport('xlsx')");
        await h.run(action);
        wait.resolve({ ok: true, headers: new Headers({ 'content-type': mime }), blob: async () => new h.w.Blob(['PK']) });
        await exporting;
        assert.equal(h.downloads.length, 0);
    }
    h.handler(async url => response(fixture(url)));
    await h.run("openHrReport('one')");
    const year = h.w.document.querySelector('#hr-report-year');
    year.value = '1404'; year.dispatchEvent(new h.w.Event('input'));
    assert.equal(h.w.document.querySelector('#hr-report-html').disabled, true);
    await h.run("exportHrReport('html')");
    assert.equal(h.downloads.length, 0);
});

test('all HR dates use interactive Shamsi selection/clear, ISO stays hidden; work-order behavior preserved', async t => {
    const h = setup(t);
    await h.run("openHrSchedule('one')");
    h.run('initHrDaysOff()');
    assert.equal(h.w.document.querySelectorAll('#hrPage input[type="date"], #hrScheduleModal input[type="date"]').length, 0);
    assert.equal(h.w.document.getElementById('hr-attendance-from'), null);
    assert.equal(h.w.document.getElementById('hr-attendance-to'), null);
    for (const id of ['hr-schedule-from', 'hr-days-off-date']) {
        const hidden = h.w.document.getElementById(id);
        assert.equal(hidden.type, 'hidden');
        let changes = 0;
        hidden.addEventListener('change', () => changes++);
        h.run(`toggleJalaliCalendar('${id}')`);
        assert.equal(h.w.document.getElementById(`${id}-calendar`).classList.contains('hidden'), false);
        h.run(`selectJalaliDate('${id}',1405,8,2)`);
        assert.equal(hidden.value, '2026-10-24');
        assert.match(h.w.document.getElementById(`${id}-display`).value, /آبان/);
        h.run(`clearJalaliDate('${id}')`);
        assert.equal(hidden.value, '');
        assert.equal(changes, 2);
    }
    let changes = 0;
    h.w.document.getElementById('wo-due').addEventListener('change', () => changes++);
    h.run("selectJalaliDate('wo-due',1405,8,2)");
    assert.equal(changes, 0);
    assert.equal(h.run("hrDateDisplay('2026-02-31')"), '');
    assert.throws(() => h.run('jalaliToGregorian(NaN, 1, 1)'), /Invalid/);
    assert.throws(() => h.run('jalaliToGregorian(1405, 12, 31)'), /Invalid/);
    await h.tick();
});

test('legacy schedules retain durations; paired same-day timings, duration window and zero-day validation', async t => {
    const h = setup(t);
    await h.run("openHrSchedule('one')");
    assert.equal(h.w.document.getElementById('hr-week-0').value, '7.5');
    assert.equal(h.w.document.getElementById('hr-start-0').value, '');
    assert.equal(h.run('hrSchedulePayload().weekly_start_minutes.every(v => v === null)'), true);
    const set = (id, value) => { h.w.document.getElementById(id).value = value; };
    set('hr-start-0', '08:00');
    assert.throws(() => h.run('hrSchedulePayload()'), /هر دو/);
    set('hr-end-0', '07:00');
    assert.throws(() => h.run('hrSchedulePayload()'), /همان روز/);
    set('hr-end-0', '15:00');
    assert.throws(() => h.run('hrSchedulePayload()'), /مدت هدف/);
    set('hr-end-0', '16:00');
    assert.equal(h.run('hrSchedulePayload().weekly_start_minutes[0]'), 480);
    assert.equal(h.run('hrSchedulePayload().weekly_end_minutes[0]'), 960);
    set('hr-week-0', '0');
    assert.throws(() => h.run('hrSchedulePayload()'), /مدت صفر/);
    h.run("new Function(document.getElementById('hr-week-0').getAttribute('oninput')).call(document.getElementById('hr-week-0'))");
    assert.equal(h.w.document.getElementById('hr-start-0').value, '');
    assert.equal(h.run('hrSchedulePayload().weekly_minutes[0]'), 0);
    assert.throws(() => h.run("hrTimeMinutes('24:00')"), /ساعت معتبر/);
    assert.throws(() => h.run("hrTimeMinutes('23:60')"), /ساعت معتبر/);
    assert.equal(h.run("hrTimeMinutes('23:59')"), 1439);
    h.run("clearJalaliDate('hr-schedule-from')");
    assert.throws(() => h.run('hrSchedulePayload()'), /تاریخ/);
});

test('days-off failures are independent from report; personal leave POST stays scoped', async t => {
    const h = setup(t);
    h.handler(async url => url.pathname === '/hr/days-off' ? { ok: false } : response(fixture(url)));
    await h.run('loadHrDaysOff()');
    await h.run("openHrReport('one')");
    assert.equal(h.w.document.querySelector('#hr-report-excel').disabled, false);
    assert.match(h.w.document.querySelector('#hr-days-off-status').textContent, /ناموفق/);
    h.w.document.getElementById('hr-days-off-staff').value = 'two';
    h.w.document.getElementById('hr-days-off-reason').value = 'مرخصی';
    h.handler(async (url, options) => options.method === 'POST' ? response({}) : response([]));
    await h.run('saveHrDayOff()');
    const post = h.requests.find(r => r.options.method === 'POST');
    assert.equal(JSON.parse(post.options.body).staff_id, 'two');
    assert.equal(h.requests.filter(r => r.url.pathname === '/hr/reports/monthly').length, 1);
});

test('schedule save posts exact arrays; invalid input never posts; closed reports stay closed on mutation', async t => {
    const h = setup(t);
    await h.run("openHrSchedule('one')");
    h.w.document.getElementById('hr-start-0').value = '08:00';
    const writes = [];
    h.handler(async (url, options) => {
        if (options.method === 'POST') { writes.push(JSON.parse(options.body)); return response({}); }
        return response([]);
    });
    await h.run('saveHrSchedule()');
    assert.equal(writes.length, 0);
    h.w.document.getElementById('hr-end-0').value = '16:00';
    await h.run('saveHrSchedule()');
    assert.equal(writes.length, 1);
    assert.deepEqual(writes[0].weekly_minutes, [450, 480, 480, 480, 480, 0, 0]);
    assert.deepEqual(writes[0].weekly_start_minutes, [480, null, null, null, null, null, null]);
    assert.deepEqual(writes[0].weekly_end_minutes, [960, null, null, null, null, null, null]);
    assert.match(writes[0].effective_from, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(h.requests.some(r => r.url.pathname.includes('/reports/')), false);
    assert.equal(h.w.document.querySelector('#hrReportModal').classList.contains('hidden'), true);
});

test('schedule 409 expands history with actionable guidance, preserves all inputs and reenables save without deleting', async t => {
    const h = setup(t);
    await h.run("openHrSchedule('one')");
    h.w.document.getElementById('hr-week-0').value = '8.25';
    h.w.document.getElementById('hr-start-0').value = '08:15';
    h.w.document.getElementById('hr-end-0').value = '17:00';
    const before = h.run('JSON.stringify(hrSchedulePayload())');
    const history = h.w.document.getElementById('hr-schedule-history');
    const historyHtml = history.innerHTML;
    history.closest('details').open = false;
    const count = h.requests.length;
    h.handler(async () => ({ ok: false, status: 409 }));
    await h.run('saveHrSchedule()');
    assert.equal(h.run('JSON.stringify(hrSchedulePayload())'), before);
    assert.equal(history.innerHTML, historyHtml);
    assert.equal(history.closest('details').open, true);
    assert.equal(h.w.document.getElementById('hr-schedule-save').disabled, false);
    const message = h.w.document.getElementById('hr-schedule-status').textContent;
    assert.match(message, /تاریخ انتخاب‌شده.*قبلاً/);
    assert.match(message, /تاریخچه حذف کنید/);
    assert.match(message, /دوباره ذخیره کنید/);
    assert.equal(h.requests.length, count + 1);
    assert.equal(h.requests.at(-1).options.method, 'POST');
});

test('wrong-scope/month reports and invalid Shamsi controls cannot be exported or trigger date loops', async t => {
    const h = setup(t);
    h.handler(async url => { const data = fixture(url); data.staff = data.staff.filter(s => s.staff_id === 'two'); return response(data); });
    await h.run("openHrReport('one')");
    assert.equal(h.w.document.getElementById('hr-report-html').disabled, true);
    h.handler(async url => { const data = fixture(url); data.month = 99; return response(data); });
    await h.run('loadHrReport()');
    assert.equal(h.w.document.getElementById('hr-report-excel').disabled, true);
    h.handler(async url => { const data = fixture(url); data.staff[0].days = [null]; return response(data); });
    await h.run('loadHrReport()');
    assert.equal(h.w.document.getElementById('hr-report-html').disabled, true);
    h.w.document.getElementById('hr-report-year').value = '';
    const count = h.requests.length;
    await h.run('loadHrReport()');
    assert.equal(h.requests.length, count);
    assert.match(h.w.document.getElementById('hr-report-status').textContent, /معتبر/);
    h.run('initHrDaysOff()');
    h.w.document.getElementById('hr-days-off-year').value = '';
    await h.run('loadHrDaysOff()');
    assert.equal(h.requests.length, count);
    h.handler(async url => response(fixture(url)));
    const wait = deferred();
    h.handler(() => wait.promise);
    const opening = h.run("openHrReport('one')");
    const requestUrl = h.requests.at(-1).url;
    h.run('closeHrReport()');
    wait.resolve(response(fixture(requestUrl)));
    await opening;
    assert.equal(h.run('hrReport.data'), null);
    assert.equal(h.w.document.getElementById('hr-report-html').disabled, true);
});

test('existing roster create, activation and deletion actions remain functional', async t => {
    const h = setup(t), writes = [];
    h.handler(async (url, options) => {
        if (options.method) { writes.push({ path: url.pathname, method: options.method, body: options.body && JSON.parse(options.body) }); return response({ full_name: 'کارمند جدید' }); }
        return response(staff);
    });
    h.w.document.getElementById('hr-new-staff-name').value = 'کارمند جدید';
    h.w.document.getElementById('hr-new-staff-role').value = 'مترجم';
    h.w.document.getElementById('hr-new-staff-pin').value = '1234';
    await h.run('addHrStaff()');
    await h.run("toggleHrStaffActive('one', false)");
    await h.run("deleteHrStaff('two')");
    assert.deepEqual(writes.map(w => w.method), ['POST', 'PATCH', 'DELETE']);
    assert.deepEqual(writes[0].body, { full_name: 'کارمند جدید', role: 'مترجم', pin: '1234' });
    assert.deepEqual(writes[1].body, { is_active: false });
    assert.equal(h.requests.some(r => r.url.pathname.includes('/reports/')), false);
});

test('clock action preserves its payload and refreshes only the relevant visible staff report', async t => {
    const h = setup(t);
    await h.run("openHrReport('one')");
    let clockStaff = 'two';
    h.handler(async (url, options) => {
        if (url.pathname === '/hr/clock') return response({ action: 'clock_in', record: { staff_id: clockStaff, staff_name: 'کارمند', clock_in: '2026-11-11T05:00:00Z', is_remote: true } });
        if (url.pathname === '/hr/reports/monthly') return response(fixture(url));
        return response([]);
    });
    const clock = async () => {
        h.w.document.getElementById('hr-clock-pin').value = '1234';
        h.w.document.getElementById('hr-clock-remote').checked = true;
        await h.run('submitHrClock()');
        await h.tick();
    };
    const reportCount = () => h.requests.filter(r => r.url.pathname === '/hr/reports/monthly').length;
    await clock();
    assert.equal(reportCount(), 1);
    const post = h.requests.find(r => r.url.pathname === '/hr/clock');
    assert.deepEqual(JSON.parse(post.options.body), { pin: '1234', lat: null, lng: null, remote: true });
    assert.equal(h.w.document.getElementById('hr-clock-pin').value, '');
    clockStaff = 'one';
    await clock();
    assert.equal(reportCount(), 2);
    h.run('closeHrReport()');
    await clock();
    assert.equal(reportCount(), 2);
    assert.equal(h.w.document.getElementById('hr-clock-submit-btn').disabled, false);
});

test('report year range matches API 1300..1600 without restricting independent days-off years', async t => {
    const h = setup(t);
    await h.run("openHrReport('one')");
    const year = h.w.document.getElementById('hr-report-year');
    assert.equal(year.min, '1300');
    const count = h.requests.length;
    for (const invalid of ['1200', '1299', '1601']) {
        year.value = invalid;
        await h.run('loadHrReport()');
        assert.equal(h.requests.length, count);
        assert.equal(h.w.document.getElementById('hr-report-html').disabled, true);
    }
    year.value = '1300';
    await h.run('loadHrReport()');
    assert.equal(h.requests.at(-1).url.searchParams.get('year'), '1300');
    assert.equal(h.w.document.getElementById('hr-report-excel').disabled, false);
    h.run('initHrDaysOff()');
    assert.equal(h.w.document.getElementById('hr-days-off-year').min, '1200');
});

test('shared view switches, direct routing and logout invalidate both HR dialogs without restoring hidden-page focus', async t => {
    const h = setup(t);
    for (const exit of ["showFullView('docSamplesPage')", 'hideWorkspaceViews()', 'showLandingView()', "applyRouteForPath('/home')", "navigateTo('/home')", 'executeLogout()']) {
        h.run("currentUserSession = {user_id:'office',type:'office',token:'test-token'};localStorage.setItem('deept_token','test-token');history.replaceState({}, '', '/hr');applyRouteForPath('/hr')");
        await h.tick();
        assert.equal(h.w.document.getElementById('hrPage').classList.contains('hidden'), false);
        const opener = h.w.document.querySelector('[data-hr-report-staff]');
        let focused = 0;
        opener.focus = () => focused++;
        await h.w.openHrReport('one', opener);
        await h.w.openHrSchedule('one', opener);
        const reportVersion = h.run('hrReport.version'), scheduleVersion = h.run('hrSchedule.version');
        h.run(exit);
        assert.equal(h.w.document.getElementById('hrReportModal').classList.contains('hidden'), true, exit);
        assert.equal(h.w.document.getElementById('hrScheduleModal').classList.contains('hidden'), true, exit);
        assert.ok(h.run('hrReport.version') > reportVersion, exit);
        assert.ok(h.run('hrSchedule.version') > scheduleVersion, exit);
        assert.equal(h.run('hrReport.data'), null);
        assert.equal(h.run('hrSchedule.staffId'), null);
        assert.equal(focused, 0, exit);
        assert.equal(h.w.document.getElementById('hr-report-excel').disabled, true);
        const count = h.requests.length;
        await h.run("exportHrReport('html');exportHrReport('xlsx')");
        assert.equal(h.requests.length, count);
        assert.equal(h.downloads.length, 0);
    }
    assert.equal(h.run('currentUserSession'), null);
    assert.equal(h.w.localStorage.getItem('deept_token'), null);
});

test('browser Back closes report and Forward to /hr preserves HR entry without resurrecting report', async t => {
    const h = setup(t);
    h.run("currentUserSession = {type:'office',token:'test-token'};history.replaceState({}, '', '/home');applyRouteForPath('/home');openHrPage()");
    await h.tick();
    await h.run("openHrReport('one')");
    const back = new Promise(resolve => h.w.addEventListener('popstate', resolve, { once: true }));
    h.w.history.back();
    await back;
    assert.equal(h.w.location.pathname, '/home');
    assert.equal(h.w.document.getElementById('hrReportModal').classList.contains('hidden'), true);
    assert.equal(h.run('hrReport.data'), null);
    assert.equal(h.w.document.getElementById('hr-report-html').disabled, true);
    const count = h.requests.filter(r => r.url.pathname === '/hr/reports/monthly').length;
    const forward = new Promise(resolve => h.w.addEventListener('popstate', resolve, { once: true }));
    h.w.history.forward();
    await forward;
    await h.tick();
    assert.equal(h.w.location.pathname, '/hr');
    assert.equal(h.w.document.getElementById('hrPage').classList.contains('hidden'), false);
    assert.equal(h.w.document.getElementById('hrReportModal').classList.contains('hidden'), true);
    assert.equal(h.requests.filter(r => r.url.pathname === '/hr/reports/monthly').length, count);
    await h.run("openHrReport('one')");
    assert.equal(h.w.document.getElementById('hr-report-excel').disabled, false);
});

test('navigation/logout discard pending report and schedule responses and pending Excel blob completion', async t => {
    const h = setup(t);
    for (const exit of ["applyRouteForPath('/home')", "navigateTo('/home')", 'executeLogout()']) {
        h.run("currentUserSession = {type:'office',token:'test-token'};localStorage.setItem('deept_token','test-token');history.replaceState({}, '', '/hr');showFullView('hrPage')");
        const reportWait = deferred(), scheduleWait = deferred();
        let reportUrl;
        h.handler(url => {
            if (url.pathname === '/hr/reports/monthly') { reportUrl = url; return reportWait.promise; }
            if (url.pathname.endsWith('/schedules')) return scheduleWait.promise;
            return Promise.resolve(response([]));
        });
        const report = h.run("openHrReport('one')"), schedule = h.run("openHrSchedule('one')");
        h.run(exit);
        reportWait.resolve(response(fixture(reportUrl)));
        scheduleWait.resolve(response([]));
        await Promise.all([report, schedule]);
        assert.equal(h.run('hrReport.data'), null, exit);
        assert.equal(h.run('hrSchedule.staffId'), null, exit);
        assert.equal(h.w.document.getElementById('hrReportModal').classList.contains('hidden'), true);
        h.run("currentUserSession = {type:'office',token:'test-token'};localStorage.setItem('deept_token','test-token');history.replaceState({}, '', '/hr');showFullView('hrPage')");
        h.handler(async url => response(fixture(url)));
        await h.run("openHrReport('one')");
        const blobWait = deferred();
        h.handler(async () => ({ ok: true, headers: new Headers({ 'content-type': mime }), blob: () => blobWait.promise }));
        const exporting = h.run("exportHrReport('xlsx')");
        await h.tick();
        assert.equal(h.run('hrReport.exporting'), true);
        h.run(exit);
        blobWait.resolve(new h.w.Blob(['PK-old-report'], { type: mime }));
        await exporting;
        await h.run("exportHrReport('html');exportHrReport('xlsx')");
        assert.equal(h.downloads.length, 0, exit);
        assert.equal(h.blobs.length, 0, exit);
        assert.equal(h.w.document.getElementById('hr-report-excel').disabled, true);
    }
});
