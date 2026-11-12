// Run with node --test tests/hr-report.test.cjs; supply jsdom through NODE_PATH.
// Dependencies stay outside this repository. Network calls are always mocked.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const hrSource = source.slice(source.indexOf('const HR_WEEKDAYS ='), source.indexOf('function renderHrPresentNow('));
assert.ok(hrSource.length > 1000, 'HR source boundaries must exist');

function functionSource(name) {
    const match = source.match(new RegExp(`function ${name}\\([^]*?\\n\\}`));
    assert.ok(match, `${name} must exist`);
    return match[0];
}

function setup(t) {
    const dom = new JSDOM(html, { url: 'https://frontend.test/', runScripts: 'outside-only' });
    t.after(() => dom.window.close());
    const w = dom.window;
    const context = dom.getInternalVMContext();
    w.fetch = async () => { throw new Error('Unexpected fetch'); };
    w.getToken = () => 'test-token';
    w.showToast = () => {};
    w.confirm = () => true;
    // Date conversion is outside this HR change; retain real Tehran helpers.
    w.formatIsoAsJalaliDisplay = value => `date:${value}`;
    vm.runInContext(`const CORE = 'https://core.test'; const HR_TIMEZONE = 'Asia/Tehran';
        let hrStaffList = []; ${functionSource('escapeHtml')}
        ${functionSource('_tehranDateString')} ${functionSource('_tehranTimeString')}
        ${hrSource}`, context);
    const run = code => vm.runInContext(code, context);
    const el = id => w.document.getElementById(id);
    el('hr-report-year').value = '1405';
    el('hr-report-month').add(new w.Option('month', '1'));
    el('hr-report-month').value = '1';
    return { w, run, el };
}

function report(name = 'Staff', statuses = ['pending', 'incomplete', 'present', 'shortfall', 'overtime', 'not_configured', 'future', 'day_off', 'absent']) {
    return {
        year: 1405, month: 1, from: '2026-03-21', to: '2026-04-20', as_of: '2026-03-25T08:00:00Z',
        staff: [{ full_name: name, total_presence_minutes: 1500, total_expected_minutes: 1800,
            is_complete: !statuses.includes('incomplete'), incomplete_days: statuses.filter(s => s === 'incomplete').length,
            total_absence_minutes: 360, total_overtime_minutes: 60,
            days: statuses.map((status, i) => ({ status, date: `2026-03-${21 + i}`, jalali_date: `1405/01/${i + 1}`,
                expected_minutes: 480, presence_minutes: 450,
                absence_minutes: status === 'shortfall' || status === 'absent' ? 30 : 0,
                overtime_minutes: status === 'overtime' ? 60 : 0, reason: '<img src=x onerror=alert(1)>' })) }],
    };
}

function setReport(env, value) {
    env.w.fixture = value;
    env.run('hrMonthlyReport = fixture');
}

const response = body => ({ ok: true, json: async () => body });
const deferred = () => {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
};

test('complete app and price catalog load against real markup with callable HR handlers', async t => {
    const dom = new JSDOM(html, { url: 'https://frontend.test/', runScripts: 'outside-only' });
    t.after(() => dom.window.close());
    const w = dom.window;
    w.fetch = async () => response([]);
    w.setTimeout = () => 0;
    w.setInterval = () => 0;
    w.requestAnimationFrame = () => 0;
    // jsdom has no canvas renderer; background animation is not under test.
    w.HTMLCanvasElement.prototype.getContext = () => Object.fromEntries(
        ['clearRect', 'beginPath', 'moveTo', 'lineTo', 'stroke', 'arc', 'fill'].map(name => [name, () => {}]));
    w.matchMedia = () => ({ matches: false, addEventListener() {}, addListener() {} });
    const context = dom.getInternalVMContext();
    vm.runInContext(fs.readFileSync(path.join(root, 'price-catalog.js'), 'utf8'), context);
    assert.doesNotThrow(() => vm.runInContext(source, context));
    for (const [, name] of hrSource.matchAll(/(?:async )?function (\w+)\(/g)) {
        assert.equal(typeof w[name], 'function', name);
    }
    await w.openHrSchedule('staff');
    assert.equal(w.document.querySelectorAll('#hr-schedule-week input').length, 7);
    w.closeHrSchedule();
});

test('all new functions are callable and static HR IDs exist exactly once', t => {
    const env = setup(t);
    const names = [...hrSource.matchAll(/(?:async )?function (\w+)\(/g)].map(m => m[1]);
    assert.deepEqual(names, ['hrDuration', 'hrRequest', 'updateHrDateLabel', 'initializeHrReport',
        'loadHrMonthlyReport', 'renderHrMonthlyReport', 'saveHrDayOff', 'openHrSchedule',
        'closeHrSchedule', 'saveHrSchedule', 'exportHrReport']);
    for (const name of names) assert.equal(typeof env.w[name], 'function', name);
    for (const [, id] of hrSource.matchAll(/getElementById\('([^']+)'\)/g)) {
        assert.equal(env.w.document.querySelectorAll(`[id="${id}"]`).length, 1, id);
    }
    for (const element of env.w.document.querySelectorAll('[onclick], [onchange]')) {
        for (const attr of ['onclick', 'onchange']) {
            const code = element.getAttribute(attr) || '';
            for (const name of names) {
                if (code.includes(`${name}(`)) assert.doesNotThrow(() => new vm.Script(code));
            }
        }
    }
});

test('duration formatting covers zero, minute boundaries and totals over 24 hours', t => {
    const { w } = setup(t);
    for (const [minutes, expected] of [[0, '0:00'], [1, '0:01'], [59, '0:59'], [60, '1:00'], [90, '1:30'], [1500, '25:00']]) {
        assert.equal(w.hrDuration(minutes), expected);
    }
});

test('initialization supplies Persian months/year and preserves the selected staff', t => {
    const env = setup(t);
    env.el('hr-report-month').replaceChildren();
    env.w.loadHrMonthlyReport = () => {};
    env.run('hrStaffList = [{ id: "staff", full_name: "<Staff>" }]');
    env.w.initializeHrReport();
    const parts = new Intl.DateTimeFormat('en-US-u-ca-persian', {
        timeZone: 'Asia/Tehran', year: 'numeric', month: 'numeric',
    }).formatToParts(new Date());
    assert.equal(env.el('hr-report-month').options.length, 12);
    assert.equal(env.el('hr-report-year').value, parts.find(p => p.type === 'year').value);
    assert.equal(env.el('hr-report-month').value, parts.find(p => p.type === 'month').value);
    env.el('hr-dayoff-staff').value = 'staff';
    env.w.initializeHrReport();
    assert.equal(env.el('hr-dayoff-staff').value, 'staff');
    assert.equal(env.el('hr-dayoff-staff').options[1].text, '<Staff>');
});

test('report renders every status including pending, escaped text and collapsed totals', t => {
    const env = setup(t);
    const data = report('<script>alert(1)</script>');
    setReport(env, data);
    env.w.renderHrMonthlyReport();
    const card = env.el('hr-monthly-report').querySelector('details');
    assert.equal(card.open, false);
    assert.match(card.querySelector('summary').textContent, /25:00/);
    assert.equal(card.querySelectorAll('script, img').length, 0);
    assert.match(card.querySelector('summary').textContent, /گزارش ناقص/);
    const rows = card.querySelectorAll('tbody tr');
    assert.equal(rows.length, data.staff[0].days.length);
    data.staff[0].days.forEach((day, i) => {
        assert.ok(rows[i].lastElementChild.textContent.includes(env.run(`HR_DAY_STATUS['${day.status}']`)));
        if (['pending', 'incomplete', 'not_configured', 'future'].includes(day.status)) {
            assert.equal(rows[i].children[3].textContent, '—');
            assert.equal(rows[i].children[4].textContent, '—');
        }
    });
    env.el('hr-report-exceptions-only').checked = true;
    env.w.renderHrMonthlyReport();
    assert.equal(env.el('hr-monthly-report').querySelectorAll('tbody tr').length, 4);
    setReport(env, { staff: [] });
    env.w.renderHrMonthlyReport();
    assert.ok(env.el('hr-monthly-report').textContent.trim());
});

test('schedule hours validate all seven days and serialize rounded integer minutes', async t => {
    const env = setup(t);
    const calls = [];
    env.w.fetch = async (url, options) => { calls.push({ url, options }); return response([]); };
    await env.w.openHrSchedule('staff / one');
    assert.equal(env.el('hr-schedule-week').querySelectorAll('input').length, 7);
    assert.equal(env.el('hr-schedule-save').disabled, false);
    for (const invalid of ['', '-0.1', '24.01', 'abc', 'Infinity']) {
        env.el('hr-week-0').value = invalid;
        await env.w.saveHrSchedule();
        assert.equal(calls.length, 1, `invalid input ${invalid} must not POST`);
        assert.ok(env.el('hr-schedule-status').textContent);
    }
    const hours = ['7.5', '0', '24', '0.0166666667', '8.333333', '1.999', '0.5'];
    hours.forEach((value, i) => { env.el(`hr-week-${i}`).value = value; });
    // Isolate the save payload from its subsequent refreshes.
    env.w.openHrSchedule = async () => {};
    env.w.initializeHrReport = () => {};
    await env.w.saveHrSchedule();
    assert.match(calls[1].url, /staff%20%2F%20one\/schedules$/);
    assert.deepEqual(JSON.parse(calls[1].options.body).weekly_minutes, [450, 0, 1440, 1, 500, 120, 30]);
});

test('closed schedule rejects late responses and Escape closes the real modal', async t => {
    const env = setup(t);
    const pending = deferred();
    env.w.fetch = () => pending.promise;
    const loading = env.w.openHrSchedule('one');
    assert.equal(env.el('hrScheduleModal').classList.contains('hidden'), false);
    env.w.document.dispatchEvent(new env.w.KeyboardEvent('keydown', { key: 'Escape' }));
    pending.resolve(response([]));
    await loading;
    assert.equal(env.el('hrScheduleModal').classList.contains('hidden'), true);
    assert.equal(env.el('hr-schedule-week').children.length, 0);
    assert.equal(env.run('hrScheduleStaffId'), null);
});

test('CSV quotes commas/newlines/quotes, prevents formula prefixes and releases download URL', async t => {
    const env = setup(t);
    const data = report('=SUM(1,2) "name"\nnext', ['pending']);
    const prefixes = ['=', '+', '-', '@', ' \t='];
    data.staff[0].days = prefixes.map(prefix => ({ ...data.staff[0].days[0], reason: `${prefix}danger,"quoted"\nnext` }));
    setReport(env, data);
    let blob, filename, revoked;
    env.w.URL.createObjectURL = value => { blob = value; return 'blob:test'; };
    env.w.URL.revokeObjectURL = value => { revoked = value; };
    env.w.HTMLAnchorElement.prototype.click = function () { filename = this.download; };
    env.w.setTimeout = callback => callback();
    env.w.exportHrReport();
    const csv = await new Promise(resolve => {
        const reader = new env.w.FileReader();
        reader.onload = () => resolve(reader.result);
        reader.readAsText(blob);
    });
    assert.equal(filename, 'attendance-1405-01.csv');
    assert.equal(revoked, 'blob:test');
    assert.equal(env.w.document.querySelector('a[download]'), null);
    assert.ok(csv.includes('"\'=SUM(1,2) ""name""\nnext"'));
    for (const prefix of prefixes) assert.ok(csv.includes(`"'${prefix}danger,""quoted""\nnext"`));
    assert.ok(csv.includes('\r\n'));
    assert.ok(csv.includes(env.run('HR_DAY_STATUS.pending')));
});

test('refresh clears old data, rejects stale success and enables export only after both requests', async t => {
    const env = setup(t);
    const older = deferred();
    const newer = deferred();
    const days = deferred();
    let requests = 0;
    env.w.fetch = url => {
        if (url.includes('/days-off?')) return days.promise;
        return ++requests === 1 ? older.promise : newer.promise;
    };
    setReport(env, report('Old'));
    env.w.renderHrMonthlyReport();
    const first = env.w.loadHrMonthlyReport();
    assert.equal(env.run('hrMonthlyReport'), null);
    assert.equal(env.el('hr-monthly-report').children.length, 0);
    assert.equal(env.el('hr-report-export').disabled, true);
    const second = env.w.loadHrMonthlyReport();
    newer.resolve(response(report('New')));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(env.el('hr-report-export').disabled, true);
    days.resolve(response([]));
    await second;
    older.resolve(response(report('Stale')));
    await first;
    assert.equal(env.run('hrMonthlyReport.staff[0].full_name'), 'New');
    assert.match(env.el('hr-monthly-report').textContent, /New/);
    assert.equal(env.el('hr-report-export').disabled, false);
});

test('stale failures cannot overwrite a newer report', async t => {
    const env = setup(t);
    const older = deferred();
    let calls = 0;
    env.w.fetch = url => url.includes('/days-off?') ? Promise.resolve(response([]))
        : ++calls === 1 ? older.promise : Promise.resolve(response(report('Newest')));
    const first = env.w.loadHrMonthlyReport();
    await env.w.loadHrMonthlyReport();
    const status = env.el('hr-report-status').textContent;
    older.reject(new Error('stale failure'));
    await first;
    assert.equal(env.el('hr-report-status').textContent, status);
    assert.equal(env.run('hrMonthlyReport.staff[0].full_name'), 'Newest');
});

test('report errors and invalid filters keep old report and export unavailable', async t => {
    const env = setup(t);
    for (const failDaysOff of [false, true]) {
        setReport(env, report());
        env.w.fetch = async url => {
            if (failDaysOff && !url.includes('/days-off?')) return response(report());
            throw new Error('network failure');
        };
        await env.w.loadHrMonthlyReport();
        assert.equal(env.el('hr-report-status').textContent, 'network failure');
        assert.equal(env.run('hrMonthlyReport'), null);
        assert.equal(env.el('hr-report-export').disabled, true);
        assert.equal(env.el('hr-monthly-report').children.length, 0);
    }
    env.w.fetch = () => assert.fail('invalid filters must not fetch');
    for (const year of ['1299', '1601', '1405.5', '']) {
        env.el('hr-report-year').value = year;
        await env.w.loadHrMonthlyReport();
        assert.ok(env.el('hr-report-status').textContent);
    }
});

test('request errors are actionable for unauthorized, conflict and server failures', async t => {
    const env = setup(t);
    const messages = [];
    for (const status of [401, 409, 500]) {
        env.w.fetch = async () => ({ ok: false, status });
        await assert.rejects(env.w.hrRequest('/test'), error => { messages.push(error.message); return !!error.message; });
    }
    assert.equal(new Set(messages).size, 3);
});

test('day-off save validates required fields, trims reason and refreshes report', async t => {
    const env = setup(t);
    const calls = [];
    let refreshed = 0;
    env.w.fetch = async (url, options) => { calls.push({ url, options }); return response({ id: 'day' }); };
    env.w.loadHrMonthlyReport = async () => { refreshed++; };
    await env.w.saveHrDayOff();
    assert.equal(calls.length, 0);
    env.el('hr-dayoff-date').value = '2026-03-25';
    env.el('hr-dayoff-reason').value = '   ';
    await env.w.saveHrDayOff();
    assert.equal(calls.length, 0);
    env.el('hr-dayoff-reason').value = '  holiday  ';
    await env.w.saveHrDayOff();
    assert.deepEqual(JSON.parse(calls[0].options.body), { date: '2026-03-25', reason: 'holiday', staff_id: null });
    assert.equal(refreshed, 1);
    assert.equal(env.el('hr-dayoff-save').disabled, false);
    assert.equal(env.el('hr-dayoff-reason').value, '');
});
