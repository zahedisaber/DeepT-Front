const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const response = (data, legacy = false) => ({ ok: true, headers: new Headers(legacy ? {} : { 'X-HR-Calendar': 'overlap-v1' }), json: async () => data });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function setup(t) {
    const dom = new JSDOM(html, { url: 'https://frontend.test/', runScripts: 'outside-only', pretendToBeVisual: true });
    t.after(() => dom.window.close());
    const w = dom.window, requests = [];
    w.requestAnimationFrame = () => 0;
    w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: () => () => {} });
    w.matchMedia = () => ({ matches: false, addEventListener() {} });
    w.scrollTo = () => {};
    w.HTMLElement.prototype.scrollIntoView = () => {};
    let handler = async () => response([]);
    w.fetch = async url => { const parsed = new URL(url); requests.push(parsed); return handler(parsed); };
    const run = code => vm.runInContext(code, dom.getInternalVMContext());
    run(source);
    run("localStorage.setItem('deept_token','test');hrAttendance.anchor='2026-10-24';");
    return { w, run, requests, handler: fn => { handler = fn; } };
}
const row = (staff, start, end, extra = {}) => ({ staff_id: staff, staff_name: staff, clock_in: start, clock_out: end, ...extra });
const selectDay = (h, day) => h.w.document.querySelector(`[data-hr-day="${day}"]`).click();

test('calendar uses monthly staff/day results for split and clipped shifts, not interval length', async t => {
    const h = setup(t);
    const rows = [row('one', '2026-10-24T08:00:00+03:30', '2026-10-24T12:00:00+03:30'), row('one', '2026-10-24T12:00:00+03:30', '2026-10-24T16:00:00+03:30'), row('one', '2026-10-25T22:00:00+03:30', '2026-10-26T06:00:00+03:30')];
    h.handler(async u => u.pathname === '/hr/reports/monthly' ? response({ year: +u.searchParams.get('year'), month: +u.searchParams.get('month'), staff: [{ staff_id: 'one', days: [
        { date: '2026-10-24', status: 'present', expected_minutes: 480, absence_minutes: 0, overtime_minutes: 0 },
        { date: '2026-10-25', status: 'shortfall', expected_minutes: 480, absence_minutes: 360, overtime_minutes: 0 },
        { date: '2026-10-26', status: 'overtime', expected_minutes: 300, absence_minutes: 0, overtime_minutes: 60 }
    ] }] }) : response(u.searchParams.has('open_only') ? [] : rows));
    await h.run('loadHrAttendance()');
    const queries = h.requests.filter(u => u.pathname === '/hr/reports/monthly');
    assert.ok(queries.length >= 2 && queries.length <= 3);
    assert.equal(new Set(queries.map(u => u.search)).size, queries.length);
    assert.ok(queries.every(u => !u.searchParams.has('staff_id')));
    assert.equal(h.w.document.querySelectorAll('[data-hr-day="2026-10-24"] .hr-status-within').length, 2);
    assert.ok(h.w.document.querySelector('[data-hr-day="2026-10-25"] .hr-status-shortfall'));
    assert.ok(h.w.document.querySelector('[data-hr-day="2026-10-26"] .hr-status-overtime'));
    selectDay(h, '2026-10-26');
    assert.ok(h.w.document.querySelector('#hr-attendance-details .hr-status-overtime'));
    assert.equal(h.run("hrAttendanceMinutes(hrAttendance.buckets.get('2026-10-24'))"), 480);
    h.run(`hrAttendance.rows.push(${JSON.stringify(row('one', '2026-10-24T17:00:00+03:30', null))});renderHrAttendanceList(hrAttendance.rows)`);
    assert.equal(h.w.document.querySelectorAll('[data-hr-day="2026-10-24"] .hr-status-within').length, 0);
});

test('optional status failure leaves attendance/present usable, neutral with warning', async t => {
    const h = setup(t);
    h.handler(async u => u.pathname === '/hr/reports/monthly' ? { ok: false } : response([row('one', '2026-10-24T08:00:00Z', u.searchParams.has('open_only') ? null : '2026-10-24T16:00:00Z')]));
    await h.run('loadHrAttendance()');
    assert.equal(h.run('hrAttendance.state'), 'ready');
    assert.ok(h.w.document.querySelector('.hr-timesheet-event'));
    assert.equal(h.w.document.querySelector('.hr-timesheet-event[class*="hr-status-"]'), null);
    assert.match(h.w.document.getElementById('hr-attendance-status').textContent, /وضعیت رنگی محاسبه نشد/);
    assert.match(h.w.document.getElementById('hr-present-now-list').textContent, /one/);
});

test('status requests are scoped and discard old generations, mismatched months and other staff', async t => {
    const h = setup(t), old = deferred();
    h.handler(u => u.pathname === '/hr/reports/monthly' ? old.promise : response([]));
    const first = h.run('loadHrAttendance()');
    h.handler(async u => u.pathname === '/hr/reports/monthly' ? response({ year: +u.searchParams.get('year'), month: +u.searchParams.get('month'), staff: [{ staff_id: 'other', days: [{ date: '2026-10-24', status: 'absent' }] }, { staff_id: 'two', days: [{ date: '2026-10-24', status: 'present', expected_minutes: 1, absence_minutes: 0, overtime_minutes: 0 }] }] }) : response([]));
    h.run("hrAttendance.staffId='two'");
    await h.run('loadHrAttendance()');
    assert.ok(h.requests.filter(u => u.pathname === '/hr/reports/monthly').slice(-2).every(u => u.searchParams.get('staff_id') === 'two'));
    const size = h.run('hrAttendance.statuses.size');
    old.resolve(response({ year: 1405, month: 8, staff: [{ staff_id: 'old', days: [{ date: '2026-10-24', status: 'absent' }] }] }));
    await first;
    assert.equal(h.run('hrAttendance.statuses.size'), size);
    assert.equal(h.run("hrAttendance.statuses.has('2026-10-24|other')"), false);
    h.handler(async u => u.pathname === '/hr/reports/monthly' ? response({ year: 0, month: 0, staff: [] }) : response([]));
    const next = h.run('navigateHrAttendance(1)');
    assert.equal(h.run('hrAttendance.statuses.size'), 0);
    await next;
    assert.equal(h.run('hrAttendance.statusLookup'), 'error');
});

test('month queries every displayed Saturday..Friday cell, Shamsi labels and real leap/year navigation', async t => {
    const h = setup(t);
    await h.run('loadHrAttendance()');
    const cells = h.w.document.querySelectorAll('[data-hr-day]');
    const q = h.requests.find(u => u.searchParams.has('overlap')).searchParams;
    assert.equal(h.requests.filter(u => u.pathname === '/hr/attendance').length, 2);
    assert.equal(h.w.document.getElementById('hr-attendance-coverage').classList.contains('hidden'), true);
    assert.ok(!h.w.document.getElementById('hr-present-now-list').textContent.includes('قدیمی'));
    assert.equal(q.get('from'), cells[0].dataset.hrDay);
    assert.equal(q.get('to'), cells[cells.length - 1].dataset.hrDay);
    assert.equal(new Date(`${q.get('from')}T12:00Z`).getUTCDay(), 6);
    assert.equal(new Date(`${q.get('to')}T12:00Z`).getUTCDay(), 5);
    assert.ok([28, 35, 42].includes(cells.length));
    assert.match(h.w.document.getElementById('hr-attendance-label').textContent, /آبان.*۱۴۰۵/);
    assert.ok(h.w.document.querySelectorAll('.is-outside').length);
    for (const year of [1403, 1404, 1405]) {
        h.run(`hrAttendance.anchor=fmtWeekISO(jalaliMonthBounds(${year},12).firstDay)`);
        const length = h.run(`(Date.parse(fmtWeekISO(jalaliMonthBounds(${year},12).lastDay))-Date.parse(fmtWeekISO(jalaliMonthBounds(${year},12).firstDay)))/86400000+1`);
        assert.ok([29, 30].includes(length));
        await h.run('navigateHrAttendance(1)');
        assert.equal(h.run('hrAttendanceRange().j.y'), year + 1);
        assert.equal(h.run('hrAttendanceRange().j.m'), 1);
        await h.run('navigateHrAttendance(-1)');
        assert.equal(h.run('hrAttendanceRange().j.m'), 12);
    }
});

test('week straddles Shamsi year with seven full dates, today and retained period on refresh', async t => {
    const h = setup(t);
    h.run("hrAttendance.anchor=fmtWeekISO(jalaliMonthBounds(1404,1).firstDay)");
    await h.run("setHrAttendanceView('week')");
    assert.equal(h.w.document.querySelectorAll('[data-hr-day]').length, 7);
    assert.match(h.w.document.getElementById('hr-attendance-label').textContent, /۱۴۰۳.*۱۴۰۴/);
    const before = h.run('hrAttendance.anchor');
    await h.run('loadHrAttendance()');
    assert.equal(h.run('hrAttendance.anchor'), before);
    await h.run('navigateHrAttendance(1)');
    assert.equal(h.run(`hrAttendance.anchor`), h.run(`hrAttendanceAddDay('${before}',7)`));
    await h.run('navigateHrAttendance(0)');
    assert.equal(h.run('hrAttendance.anchor'), h.run('hrToday()'));
});

test('Tehran midnight, clipped overnight, union per staff/day, remote, open and invalid records', t => {
    const h = setup(t);
    assert.equal(h.run("new Date(hrAttendanceDayStart('2026-10-24')).toISOString()"), '2026-10-23T20:30:00.000Z');
    assert.equal(h.run("new Date(hrAttendanceDayStart('2021-06-01')).toISOString()"), '2021-05-31T19:30:00.000Z');
    assert.equal(h.run("_tehranDateString(new Date(hrAttendanceDayStart('2021-03-22')))"), '2021-03-22');
    const rows = [
        row('one', '2026-10-23T20:45:00Z', '2026-10-24T00:30:00Z', { is_remote: true }),
        row('one', '2026-10-24T21:30:00+03:30', '2026-10-25T02:00:00+03:30'),
        row('one', '2026-10-24T22:00:00+03:30', '2026-10-25T01:00:00+03:30'),
        row('two', '2026-10-24T22:00:00+03:30', '2026-10-24T23:00:00+03:30'),
        row('two', '2026-10-24T08:00:00Z', null),
        row('two', '2026-10-24T10:00:00Z', '2026-10-24T09:00:00Z'),
        row('two', 'broken', 'also broken')
    ];
    h.run(`renderHrAttendanceList(${JSON.stringify(rows)})`);
    assert.equal(h.run("hrAttendance.buckets.get('2026-10-24').length"), 6);
    assert.equal(h.run("hrAttendanceMinutes(hrAttendance.buckets.get('2026-10-24'))"), 435);
    assert.equal(h.run("hrAttendanceMinutes(hrAttendance.buckets.get('2026-10-25'))"), 120);
    selectDay(h, '2026-10-24');
    const text = h.w.document.getElementById('hr-attendance-details').textContent;
    assert.match(text, /دورکاری/); assert.match(text, /ادامه/); assert.match(text, /نهایی نشده/); assert.match(text, /زمان نامعتبر/);
    assert.ok(!text.includes('2026-'));
    assert.match(h.w.document.getElementById('hr-attendance-status').textContent, /۲ رکورد با زمان نامعتبر/);
});

test('open multi-year record never expands into day intervals or invented hours', t => {
    const h = setup(t);
    h.run(`renderHrAttendanceList(${JSON.stringify([row('one', '2000-01-01T00:00:00Z', null)])})`);
    assert.ok(h.w.document.querySelectorAll('[data-hr-day]').length <= 42);
    assert.equal(h.run('[...hrAttendance.buckets.values()].flat().length'), 0);
    assert.equal(h.run('hrAttendanceMinutes([...hrAttendance.buckets.values()].flat())'), 0);
});

test('compact more opens all shifts below, safe names/notes, no inferred absence', t => {
    const h = setup(t), rows = Array.from({ length: 5 }, (_, i) => row('one', `2026-10-24T0${i}:00:00Z`, `2026-10-24T0${i}:30:00Z`, { staff_name: '<img src=x onerror=bad()>', note: '<script>bad()</script>' }));
    h.run(`renderHrAttendanceList(${JSON.stringify(rows)})`);
    const cell = h.w.document.querySelector('[data-hr-day="2026-10-24"]');
    assert.equal(cell.querySelectorAll('.hr-timesheet-event').length, 2);
    assert.equal(cell.querySelector('.hr-timesheet-mobile-count').textContent, '۵ ثبت');
    assert.match(cell.querySelector('.hr-timesheet-mobile-duration').textContent, /مدت بسته: ۲:۳۰/);
    assert.match(cell.getAttribute('aria-label'), /۵ رکورد/);
    assert.match(cell.querySelector('.hr-timesheet-more').textContent, /۳/);
    cell.click();
    assert.equal(h.w.document.querySelectorAll('.hr-timesheet-shift').length, 5);
    assert.equal(h.w.document.querySelector('#hr-attendance-details img, #hr-attendance-details script'), null);
    selectDay(h, '2026-10-25');
    assert.match(h.w.document.getElementById('hr-attendance-details').textContent, /تعیین نمی‌شود/);
});

test('async roster preserves filter and history never scopes present-now request', async t => {
    const h = setup(t), roster = deferred();
    h.handler(u => u.pathname === '/hr/staff' ? roster.promise : Promise.resolve(response(u.searchParams.has('open_only') ? [row('two', '2000-01-01T00:00Z', null)] : [])));
    const loading = h.run('loadHrStaff()');
    h.run("hrAttendance.staffId='one'");
    await h.run('loadHrAttendance()');
    roster.resolve(response([{ id: 'one', full_name: 'سارا' }, { id: 'two', full_name: 'رضا' }]));
    await loading;
    assert.equal(h.w.document.getElementById('hr-attendance-staff').value, 'one');
    const open = h.requests.find(u => u.searchParams.has('open_only'));
    assert.equal(open.search, '?open_only=true');
    assert.match(h.w.document.getElementById('hr-present-now-list').textContent, /two/);
    assert.equal(h.requests.find(u => u.searchParams.has('from')).searchParams.get('staff_id'), 'one');
});

test('navigation/filter races, failed requests and independent present errors clear stale state', async t => {
    const h = setup(t), old = deferred();
    h.handler(u => u.searchParams.has('open_only') ? response([]) : old.promise);
    const pending = h.run('loadHrAttendance()');
    h.handler(async u => response(u.searchParams.has('open_only') ? [] : [row('two', '2026-10-24T10:00Z', '2026-10-24T11:00Z')]));
    h.run("hrAttendance.staffId='two'");
    await h.run('loadHrAttendance()');
    old.resolve(response([row('one', '2026-10-24T10:00Z', null)]));
    await pending;
    assert.equal(h.run('hrAttendance.rows[0].staff_id'), 'two');
    const oldFailure = deferred();
    h.handler(() => oldFailure.promise);
    const oldPeriod = h.run('loadHrAttendance()');
    h.handler(async () => response([]));
    await h.run('navigateHrAttendance(1)');
    oldFailure.resolve({ ok: false });
    await oldPeriod;
    assert.equal(h.run('hrAttendance.state'), 'ready');
    assert.ok(!h.w.document.getElementById('hr-present-now-list').textContent.includes('خطا'));
    h.handler(async () => ({ ok: false }));
    await h.run('loadHrAttendance()');
    assert.equal(h.run('hrAttendance.rows.length'), 0);
    assert.equal(h.w.document.querySelectorAll('.hr-timesheet-event').length, 0);
    assert.match(h.w.document.getElementById('hr-attendance-status').textContent, /خطا/);
    assert.match(h.w.document.getElementById('hr-present-now-list').textContent, /مشخص نیست/);
});

test('route leave and logout invalidate pending calendar and present responses', async t => {
    const h = setup(t);
    for (const action of ["applyRouteForPath('/home')", 'executeLogout()']) {
        const wait = deferred();
        h.handler(() => wait.promise);
        const pending = h.run('loadHrAttendance()');
        h.run(action);
        wait.resolve(response([row('one', '2026-10-24T10:00Z', null)]));
        await pending;
        assert.equal(h.w.document.querySelectorAll('.hr-timesheet-event').length, 0);
        assert.equal(h.w.document.getElementById('hr-present-now-list').textContent, '');
    }
});

test('legacy fallback uses widened absolute UTC bounds, includes final Tehran day and persists coverage warnings', async t => {
    const h = setup(t);
    h.run("hrAttendance.view='week';hrAttendance.staffId='one'");
    const rows = [
        row('one', '2026-10-23T20:35:00Z', '2026-10-23T21:35:00Z'),
        row('one', '2026-10-30T19:00:00Z', '2026-10-30T20:00:00Z'),
        row('one', '2026-10-22T21:00:00Z', '2026-10-22T22:00:00Z'),
        row('one', '2026-10-30T20:35:00Z', '2026-10-30T21:35:00Z')
    ];
    h.handler(async u => {
        if (u.searchParams.has('open_only') || u.searchParams.has('overlap')) return response([], true);
        assert.equal(u.searchParams.get('from'), '2026-10-22T20:30:00.000Z');
        assert.equal(u.searchParams.get('to'), '2026-10-30T20:30:00.000Z');
        assert.equal(u.searchParams.get('staff_id'), 'one');
        assert.equal(u.searchParams.has('overlap'), false);
        // Simulate legacy server's plain timestamp-string comparison.
        return response(rows.filter(r => r.clock_in >= u.searchParams.get('from') && r.clock_in < u.searchParams.get('to')), true);
    });
    await h.run('loadHrAttendance()');
    assert.equal(h.requests.filter(u => u.pathname === '/hr/attendance').length, 3);
    assert.equal(h.run('hrAttendance.state'), 'ready');
    assert.equal(h.run("hrAttendance.buckets.get('2026-10-24').length"), 1);
    assert.equal(h.run("hrAttendance.buckets.get('2026-10-30').length"), 1);
    assert.equal(h.w.document.querySelectorAll('.hr-timesheet-event').length, 2);
    const warning = h.w.document.getElementById('hr-attendance-coverage');
    assert.equal(warning.classList.contains('hidden'), false);
    assert.match(warning.textContent, /سرور فعلی قدیمی است.*داده‌ها ممکن است کامل نباشند/);
    assert.match(warning.textContent, /طولانی.*صفحه‌بندی/);
    selectDay(h, '2026-10-30');
    assert.equal(warning.classList.contains('hidden'), false);
    const present = h.w.document.getElementById('hr-present-now-list').textContent;
    assert.match(present, /قدیمی.*قدیمی.*صفحه‌بندی/);
    assert.match(present, /وضعیت قطعی.*مشخص نیست/);
    assert.ok(!present.includes('در حال حاضر کسی حاضر ثبت نشده'));
    h.handler(async () => response([]));
    await h.run('loadHrAttendance()');
    assert.equal(warning.classList.contains('hidden'), true);
    assert.ok(!h.w.document.getElementById('hr-present-now-list').textContent.includes('قدیمی'));
});

test('legacy mode tolerates absent headers objects and warns even with returned open shifts', async t => {
    const h = setup(t);
    h.handler(async () => ({ ok: true, json: async () => [row('one', '2026-10-24T10:00Z', null)] }));
    await h.run('loadHrAttendance()');
    assert.equal(h.run('hrAttendance.state'), 'ready');
    assert.equal(h.w.document.getElementById('hr-attendance-coverage').classList.contains('hidden'), false);
    assert.match(h.w.document.getElementById('hr-present-now-list').textContent, /قدیمی.*one/s);
});

test('both legacy fetch stages discard stale success/error results and fallback failure clears old records', async t => {
    const h = setup(t);
    for (const stage of ['capability', 'fallback']) for (const failed of [false, true]) {
        const wait = deferred(), reached = deferred();
        h.handler(u => {
            if (u.searchParams.has('open_only')) return response([]);
            if (stage === 'capability' || !u.searchParams.has('overlap')) { reached.resolve(); return wait.promise; }
            return response([], true);
        });
        const pending = h.run('loadHrAttendance()');
        await reached.promise;
        h.handler(async () => response([]));
        await h.run('navigateHrAttendance(1)');
        const count = h.requests.length;
        wait.resolve(failed ? { ok: false } : response([row('old', '2026-10-24T10:00Z', null)], true));
        await pending;
        assert.equal(h.requests.length, count, 'stale capability must not start a fallback');
        assert.equal(h.run('hrAttendance.state'), 'ready');
        assert.equal(h.run('hrAttendance.rows.length'), 0);
        assert.equal(h.run('hrAttendance.legacy'), false);
    }
    h.run("hrAttendance.anchor='2026-10-24'");
    h.handler(async () => response([row('one', '2026-10-24T10:00Z', null)]));
    await h.run('loadHrAttendance()');
    assert.ok(h.w.document.querySelectorAll('.hr-timesheet-event').length);
    h.handler(async u => u.searchParams.has('overlap') ? response([], true) : u.searchParams.has('open_only') ? response([]) : { ok: false });
    await h.run('loadHrAttendance()');
    assert.equal(h.run('hrAttendance.state'), 'error');
    assert.equal(h.w.document.querySelectorAll('.hr-timesheet-event').length, 0);
    assert.match(h.w.document.getElementById('hr-attendance-status').textContent, /خطا/);
    assert.equal(h.w.document.getElementById('hr-attendance-coverage').classList.contains('hidden'), false);
    for (const action of ["applyRouteForPath('/home')", 'executeLogout()']) {
        const wait = deferred(), reached = deferred();
        h.handler(u => {
            if (u.searchParams.has('open_only')) return response([]);
            if (u.searchParams.has('overlap')) return response([], true);
            reached.resolve(); return wait.promise;
        });
        const pending = h.run('loadHrAttendance()');
        await reached.promise;
        h.run(action);
        wait.resolve(response([row('one', '2026-10-24T10:00Z', null)], true));
        await pending;
        assert.equal(h.w.document.querySelectorAll('.hr-timesheet-event').length, 0);
        assert.equal(h.run('hrAttendance.rows.length'), 0);
    }
});

test('session changes/logout clear selected staff and pending old roster; normal HR navigation preserves filter', async t => {
    const h = setup(t);
    h.run("currentUserSession={user_id:'A'};localStorage.setItem('deept_token','token-A')");
    h.handler(async u => response(u.pathname === '/hr/staff' ? [{ id: 'one', full_name: 'Account A name' }] : []));
    await h.run('loadHrSettings()');
    h.run("hrAttendance.staffId='one';renderHrAttendanceStaff();closeHrDialogs()");
    await h.run('loadHrSettings()');
    assert.equal(h.w.document.getElementById('hr-attendance-staff').value, 'one');
    const old = deferred();
    h.handler(u => u.pathname === '/hr/staff' ? old.promise : response([]));
    const oldRoster = h.run('loadHrStaff()');
    h.run('executeLogout()');
    assert.equal(h.run('hrAttendance.staffId'), '');
    assert.equal(h.w.document.getElementById('hr-attendance-staff').options.length, 1);
    const next = deferred();
    h.run("currentUserSession={user_id:'B'};localStorage.setItem('deept_token','token-B')");
    h.handler(u => u.pathname === '/hr/staff' ? next.promise : response([]));
    const loadingB = h.run('loadHrSettings()');
    assert.equal(h.w.document.getElementById('hr-attendance-staff').value, '');
    assert.ok(!h.w.document.getElementById('hr-staff-list').textContent.includes('Account A'));
    old.resolve(response([{ id: 'one', full_name: 'Account A name' }]));
    await oldRoster;
    assert.equal(h.w.document.getElementById('hr-attendance-staff').options.length, 1);
    next.resolve(response([{ id: 'two', full_name: 'Account B name' }]));
    await loadingB;
    assert.equal(h.w.document.getElementById('hr-attendance-staff').value, '');
    assert.ok(!h.w.document.getElementById('hr-attendance-staff').textContent.includes('Account A'));
    assert.match(h.w.document.getElementById('hr-attendance-staff').textContent, /Account B/);
    // Direct owner change without a logout must also clear names before the new roster arrives.
    h.run("hrAttendance.staffId='two';renderHrAttendanceStaff();currentUserSession={user_id:'C'}");
    const third = deferred();
    h.handler(u => u.pathname === '/hr/staff' ? third.promise : response([]));
    const loadingC = h.run('loadHrSettings()');
    assert.equal(h.w.document.getElementById('hr-attendance-staff').options.length, 1);
    assert.equal(h.run('hrStaffList.length'), 0);
    third.resolve(response([]));
    await loadingC;
});

test('daily union rounds down minutes for each employee before adding employee totals', t => {
    const h = setup(t);
    const rows = [
        row('one', '2026-10-24T10:00:00Z', '2026-10-24T10:00:40Z'),
        row('one', '2026-10-24T10:00:30Z', '2026-10-24T10:01:20Z'),
        row('two', '2026-10-24T10:00:00Z', '2026-10-24T10:00:50Z')
    ];
    h.run(`renderHrAttendanceList(${JSON.stringify(rows)})`);
    assert.equal(h.run("hrAttendanceMinutes(hrAttendance.buckets.get('2026-10-24'))"), 1);
});

test('weekly chips show clipped Tehran start/end times, midnight as 24:00, and explicit open/invalid states', t => {
    const h = setup(t);
    h.run("hrAttendance.view='week'");
    const rows = [
        row('one', '2026-10-24T19:00:00Z', '2026-10-25T02:30:00Z'),
        row('two', '2026-10-24T05:00:00Z', '2026-10-24T06:15:00Z'),
        row('open', '2026-10-26T05:00:00Z', null),
        row('bad', '2026-10-26T06:00:00Z', '2026-10-26T05:00:00Z')
    ];
    h.run(`renderHrAttendanceList(${JSON.stringify(rows)})`);
    const first = h.w.document.querySelector('[data-hr-day="2026-10-24"]');
    const times = [...first.querySelectorAll('.hr-timesheet-time')].map(el => el.textContent);
    assert.deepEqual(times, ['۲۲:۳۰ - ۲۴:۰۰', '۰۸:۳۰ - ۰۹:۴۵']);
    assert.ok([...first.querySelectorAll('.hr-timesheet-time')].every(el => el.dir === 'ltr'));
    const next = h.w.document.querySelector('[data-hr-day="2026-10-25"]');
    assert.equal(next.querySelector('.hr-timesheet-time').textContent, '۰۰:۰۰ - ۰۶:۰۰');
    assert.match(next.querySelector('.hr-timesheet-event').textContent, /۶:۰۰.*ادامه/);
    const unresolved = h.w.document.querySelector('[data-hr-day="2026-10-26"]');
    assert.equal(unresolved.querySelectorAll('.hr-timesheet-time').length, 0);
    assert.match(unresolved.textContent, /باز \/ غیرقطعی/);
    assert.match(unresolved.textContent, /زمان نامعتبر/);
    assert.equal(h.w.document.querySelectorAll('.hr-timesheet-mobile-count').length, 0);
});
