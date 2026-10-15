/* ========================================================================
   DeepT CRM module (crm.js) -- office management for translation offices
   ------------------------------------------------------------------------
   FEATURES: clients list + client profile/detail, related persons, invoice
   draft/view/print/edit/email, نرخنامه من (price list over price-catalog.js),
   Sanam .xlsx import, work orders + Jalali office calendar/schedule, HR
   (staff roster, location-checked clock in/out, attendance), add/edit client.

   Split out of app.js as the first step toward selling the CRM separately
   from the translation platform. Code was MOVED here unchanged; the
   "// ---- moved from app.js" markers record where each block came from.

   LOAD ORDER (index.html): price-catalog.js -> crm.js -> app.js.
   crm.js only declares functions/state and binds DOM listeners at load
   time; it calls into app.js (CORE, showToast, escapeHtml, showFullView,
   navigateTo, DOCUMENT_REGISTRY, ...) only from inside functions, which run
   after app.js has loaded. app.js's initializeApp() calls into this file
   at load time (loadMyPriceListCatalog, route handlers), which is why
   crm.js must load first.

   REMAINING LINKS TO TRANSLATION (to become optional, see the appraisal):
     - client activity list merges DeepT jobs (renderClientActivityList)
     - invoice draft rows carry job_id; job price edits via /jobs/{id}/fields
     - openChatForClient() starts the translation pipeline for a client
     - "save confirmed passport as client" stays in app.js (openSaveClientModal)
   ======================================================================== */

// ---- moved from app.js (stage) lines 508-513 ----
document.getElementById('myplRepriceModal').addEventListener('click', function(e) {
    if (e.target === this) closeMyPriceListRepriceModal();
});
document.getElementById('editWorkRecordModal').addEventListener('click', function(e) {
    if (e.target === this) closeEditWorkRecordModal();
});

// ---- moved from app.js (stage) lines 515-880 ----
// ═══════════════════════════════════════════════════════════
// HR CLOCK IN / CLOCK OUT -- office accounts only (see hr.py). No login of
// their own for staff: a PIN entered here, under the OFFICE's own already-
// logged-in session, is all that identifies which staff member is
// punching -- same as a shared physical time clock. The server also
// requires the browser's current GPS position to be within a small
// radius of this office's registered location (see حضور غیاب پرسنل's
// loadHrSettings(), for registering it) -- replaced an earlier WiFi-IP
// check, which broke every time the office's ISP reassigned its public IP.
// ═══════════════════════════════════════════════════════════

// Promise wrapper around the Geolocation API, shared by the clock-in/out
// PIN pad and registerHrLocation() below.
function _getGeoPosition() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            reject(new Error('مرورگر شما از موقعیت‌یابی پشتیبانی نمی‌کند.'));
            return;
        }
        navigator.geolocation.getCurrentPosition(
            pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
            err => reject(new Error(
                err.code === err.PERMISSION_DENIED
                    ? 'اجازهٔ دسترسی به موقعیت مکانی داده نشد. برای ثبت ورود/خروج باید دسترسی موقعیت مکانی را در مرورگر فعال کنید.'
                    : 'دریافت موقعیت مکانی ناموفق بود. اتصال GPS/اینترنت را بررسی کنید.'
            )),
            { enableHighAccuracy: true, timeout: 10000 }
        );
    });
}

function openHrClockWidget() {
    document.getElementById('hr-clock-pin').value = '';
    document.getElementById('hr-clock-status').classList.add('hidden');
    document.getElementById('hrClockOverlay').classList.remove('hidden');
    document.getElementById('hr-clock-pin').focus();
}
function closeHrClockWidget() {
    document.getElementById('hrClockOverlay').classList.add('hidden');
}
document.getElementById('hrClockOverlay').addEventListener('click', function(e) {
    if (e.target === this) closeHrClockWidget();
});
document.getElementById('hr-clock-pin').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') submitHrClock();
});

async function submitHrClock() {
    const pin = document.getElementById('hr-clock-pin').value.trim();
    const status = document.getElementById('hr-clock-status');
    const btn = document.getElementById('hr-clock-submit-btn');
    status.classList.remove('hidden');
    if (!pin) {
        status.style.color = '#f87171';
        status.textContent = 'پین را وارد کنید.';
        return;
    }
    btn.disabled = true;
    status.style.color = 'var(--text-muted)';
    status.textContent = 'در حال دریافت موقعیت مکانی...';
    try {
        const { lat, lng } = await _getGeoPosition();
        status.textContent = 'در حال ثبت...';
        const res = await fetch(`${CORE}/hr/clock`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ pin, lat, lng })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.detail || 'خطای سرور');
        const time = new Date(data.record.clock_in && data.action === 'clock_in' ? data.record.clock_in : data.record.clock_out)
            .toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' });
        status.style.color = 'var(--accent)';
        status.textContent = data.action === 'clock_in'
            ? `✅ ورود ${data.record.staff_name} ساعت ${time} ثبت شد.`
            : `✅ خروج ${data.record.staff_name} ساعت ${time} ثبت شد.`;
        document.getElementById('hr-clock-pin').value = '';
        // The clock widget is only ever opened from within حضور غیاب
        // پرسنل now (see index.html) -- refresh its "present now" list so
        // this punch shows up without needing a manual reload.
        loadHrAttendance();
    } catch (e) {
        status.style.color = '#f87171';
        status.textContent = `❌ ${e.message || 'خطای نامشخص'}`;
    } finally {
        btn.disabled = false;
    }
}

// ── HR settings panel (حضور غیاب پرسنل) ──────────────────────────────────
// Office location (geofence) registration + staff roster management + a
// read-only timesheet view. Manual correction of a forgotten clock-out is
// supported server-side (PATCH /hr/attendance/{id}, see hr.py) but has no
// editing UI here yet -- v1 of this panel is view + roster management only.
let hrStaffList = [];

async function loadHrSettings() {
    const fromInput = document.getElementById('hr-attendance-from');
    const toInput = document.getElementById('hr-attendance-to');
    if (!fromInput.value && !toInput.value) {
        const today = new Date();
        const twoWeeksAgo = new Date(today.getTime() - 13 * 24 * 60 * 60 * 1000);
        toInput.value = today.toISOString().slice(0, 10);
        fromInput.value = twoWeeksAgo.toISOString().slice(0, 10);
    }
    await Promise.all([loadHrLocation(), loadHrStaff(), loadHrAttendance()]);
}

async function loadHrLocation() {
    try {
        const res = await fetch(`${CORE}/hr/location`, { headers: { 'Authorization': `Bearer ${getToken()}` } });
        const data = await res.json();
        document.getElementById('hr-location').textContent =
            (data.office_lat != null && data.office_lng != null) ? 'ثبت شده ✅' : 'ثبت نشده';
    } catch (e) {
        document.getElementById('hr-location').textContent = 'ثبت نشده';
    }
}

async function registerHrLocation() {
    const btn = document.getElementById('hr-location-register-btn');
    const status = document.getElementById('hr-location-status');
    btn.disabled = true;
    status.classList.remove('hidden');
    status.style.color = 'var(--text-muted)';
    status.textContent = 'در حال دریافت موقعیت مکانی...';
    try {
        const { lat, lng } = await _getGeoPosition();
        status.textContent = 'در حال ثبت...';
        const res = await fetch(`${CORE}/hr/location/register`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ lat, lng })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.detail || 'خطای سرور');
        document.getElementById('hr-location').textContent = 'ثبت شده ✅';
        status.style.color = 'var(--accent)';
        status.textContent = '✅ موقعیت فعلی این دستگاه به‌عنوان محل دفتر ثبت شد.';
    } catch (e) {
        status.style.color = '#f87171';
        status.textContent = `❌ ${e.message || 'خطای نامشخص'}`;
    } finally {
        btn.disabled = false;
    }
}

async function loadHrStaff() {
    try {
        const res = await fetch(`${CORE}/hr/staff`, { headers: { 'Authorization': `Bearer ${getToken()}` } });
        hrStaffList = await res.json();
    } catch (e) {
        hrStaffList = [];
    }
    renderHrStaffList();
}

// Small fixed palette (not random) so a staff member's avatar color stays
// stable across re-renders -- picked by a cheap hash of their id, not
// insertion order, so it doesn't shift as other staff are added/removed.
const HR_AVATAR_COLORS = ['#00d4ff', '#c084fc', '#34c759', '#f59e0b', '#f87171', '#38bdf8'];
function _hrAvatarColor(id) {
    let hash = 0;
    for (const ch of String(id)) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    return HR_AVATAR_COLORS[hash % HR_AVATAR_COLORS.length];
}

function renderHrStaffList() {
    const list = document.getElementById('hr-staff-list');
    list.innerHTML = '';
    if (!hrStaffList.length) {
        const note = document.createElement('div');
        note.className = 'text-[11px] p-4 rounded-xl text-center';
        note.style.cssText = 'background:var(--bg-main);border:1px dashed var(--border-subtle);color:var(--text-muted);';
        note.textContent = 'هنوز کارمندی ثبت نشده — با دکمهٔ «افزودن کارمند جدید» شروع کنید.';
        list.appendChild(note);
        return;
    }
    hrStaffList.forEach(s => {
        const row = document.createElement('div');
        row.className = 'flex items-center gap-3 p-3 rounded-xl transition';
        row.style.cssText = `background:var(--bg-main);border:1px solid var(--border-subtle);opacity:${s.is_active ? '1' : '.6'};`;
        const initial = (s.full_name || '؟').trim().charAt(0) || '؟';
        row.innerHTML = `
          <div class="w-9 h-9 rounded-full flex items-center justify-center font-black text-sm shrink-0" style="background:${_hrAvatarColor(s.id)};color:#0a0a0a;">${initial}</div>
          <div style="flex:1;min-width:0;">
            <div class="text-xs font-bold truncate" style="color:var(--text-main);">${s.full_name}</div>
            <div class="text-[10px] truncate" style="color:var(--text-muted);">${s.role || 'بدون سمت مشخص'}</div>
          </div>
          <span class="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0" style="background:${s.is_active ? 'rgba(52,199,89,.12);color:#34c759' : 'rgba(148,148,148,.15);color:#999'};">${s.is_active ? '● فعال' : '○ غیرفعال'}</span>
          <div class="flex items-center gap-1 shrink-0">
            <button type="button" data-hr-toggle-staff="${s.id}" data-hr-active="${s.is_active}" title="${s.is_active ? 'غیرفعال کردن' : 'فعال کردن'}" class="w-7 h-7 rounded-lg flex items-center justify-center text-xs transition" style="background:var(--panel-bg);color:var(--text-muted);border:1px solid var(--border-subtle);">${s.is_active ? '⏸' : '▶'}</button>
            <button type="button" data-hr-delete-staff="${s.id}" title="حذف" class="w-7 h-7 rounded-lg flex items-center justify-center text-xs transition" style="background:rgba(248,113,113,.1);color:#f87171;border:1px solid rgba(248,113,113,.3);">🗑</button>
          </div>
        `;
        list.appendChild(row);
    });
}

function openAddHrStaffModal() {
    document.getElementById('hr-new-staff-name').value = '';
    document.getElementById('hr-new-staff-role').value = '';
    document.getElementById('hr-new-staff-pin').value = '';
    document.getElementById('hr-staff-add-status').classList.add('hidden');
    document.getElementById('addHrStaffModal').classList.remove('hidden');
    document.getElementById('hr-new-staff-name').focus();
}
function closeAddHrStaffModal() {
    document.getElementById('addHrStaffModal').classList.add('hidden');
}
document.getElementById('addHrStaffModal').addEventListener('click', function(e) {
    if (e.target === this) closeAddHrStaffModal();
});

document.addEventListener('click', (e) => {
    const toggleBtn = e.target.closest('[data-hr-toggle-staff]');
    if (toggleBtn) {
        toggleHrStaffActive(toggleBtn.dataset.hrToggleStaff, toggleBtn.dataset.hrActive !== 'true');
        return;
    }
    const delBtn = e.target.closest('[data-hr-delete-staff]');
    if (delBtn) deleteHrStaff(delBtn.dataset.hrDeleteStaff);
});

async function toggleHrStaffActive(staffId, newActive) {
    try {
        const res = await fetch(`${CORE}/hr/staff/${staffId}`, {
            method: 'PATCH',
            headers: { 'Authorization': `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ is_active: newActive })
        });
        if (!res.ok) throw new Error();
        await loadHrStaff();
    } catch (e) { /* row just stays as it was -- no destructive fallback needed */ }
}

async function deleteHrStaff(staffId) {
    if (!confirm('این کارمند برای همیشه حذف شود؟ سابقهٔ حضور او در تایم‌شیت باقی می‌ماند اما نامش دیگر نمایش داده نخواهد شد.')) return;
    try {
        const res = await fetch(`${CORE}/hr/staff/${staffId}`, {
            method: 'DELETE', headers: { 'Authorization': `Bearer ${getToken()}` }
        });
        if (!res.ok) throw new Error();
        await loadHrStaff();
    } catch (e) { /* no-op on failure -- row stays visible, translator can retry */ }
}

async function addHrStaff() {
    const nameInput = document.getElementById('hr-new-staff-name');
    const roleInput = document.getElementById('hr-new-staff-role');
    const pinInput = document.getElementById('hr-new-staff-pin');
    const status = document.getElementById('hr-staff-add-status');
    const full_name = nameInput.value.trim();
    const role = roleInput.value.trim();
    const pin = pinInput.value.trim();
    status.classList.add('hidden');
    if (!full_name || !pin) {
        status.style.color = '#f87171';
        status.textContent = 'نام و پین را وارد کنید.';
        status.classList.remove('hidden');
        return;
    }
    const btn = document.getElementById('hr-staff-add-btn');
    btn.disabled = true;
    try {
        const res = await fetch(`${CORE}/hr/staff`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ full_name, role: role || null, pin })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.detail || 'خطای سرور');
        status.style.color = 'var(--accent)';
        status.textContent = `✅ ${data.full_name} با موفقیت اضافه شد.`;
        status.classList.remove('hidden');
        await loadHrStaff();
        setTimeout(closeAddHrStaffModal, 700);
    } catch (e) {
        status.style.color = '#f87171';
        status.textContent = `❌ ${e.message || 'خطای نامشخص'}`;
        status.classList.remove('hidden');
    } finally {
        btn.disabled = false;
    }
}

async function loadHrAttendance() {
    const from = document.getElementById('hr-attendance-from').value;
    const to = document.getElementById('hr-attendance-to').value;
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    // A date-only "to" (from <input type=date>) must include the WHOLE
    // day -- appending the day's last second turns it into an inclusive
    // upper bound for the plain string comparison hr.py's /hr/attendance
    // does against each record's full ISO clock_in timestamp.
    if (to) params.set('to', `${to}T23:59:59`);
    try {
        const res = await fetch(`${CORE}/hr/attendance?${params}`, { headers: { 'Authorization': `Bearer ${getToken()}` } });
        const rows = await res.json();
        renderHrAttendanceList(rows);
        // "Present now" is just this same result set filtered down to
        // still-open records (no clock_out yet) -- no second round trip.
        // Someone who clocked in before the selected "از" date won't show
        // here, but the date range defaults to the last two weeks (see
        // loadHrSettings()), which comfortably covers any forgotten
        // clock-out.
        renderHrPresentNow(rows.filter(r => !r.clock_out));
    } catch (e) {
        renderHrAttendanceList([]);
        renderHrPresentNow([]);
    }
}

function renderHrPresentNow(rows) {
    const list = document.getElementById('hr-present-now-list');
    if (!list) return;
    list.innerHTML = '';
    if (!rows || !rows.length) {
        const note = document.createElement('div');
        note.className = 'text-[11px] p-3 rounded-lg';
        note.style.cssText = 'background:var(--bg-main);border:1px dashed var(--border-subtle);color:var(--text-muted);';
        note.textContent = 'در حال حاضر کسی حاضر ثبت نشده است.';
        list.appendChild(note);
        return;
    }
    rows.forEach(r => {
        const inTime = new Date(r.clock_in).toLocaleString('fa-IR');
        const row = document.createElement('div');
        row.className = 'flex items-center justify-between gap-2 flex-wrap p-2.5 rounded-lg text-[11px]';
        row.style.cssText = 'background:rgba(52,199,89,.08);border:1px solid rgba(52,199,89,.25);';
        row.innerHTML = `
          <span class="font-bold flex items-center gap-1.5" style="color:var(--text-main);"><span style="color:#34c759;">●</span> ${r.staff_name || '؟'}</span>
          <span style="color:var(--text-muted);">از ساعت ${inTime}</span>
        `;
        list.appendChild(row);
    });
}

function renderHrAttendanceList(rows) {
    const list = document.getElementById('hr-attendance-list');
    list.innerHTML = '';
    if (!rows || !rows.length) {
        const note = document.createElement('div');
        note.className = 'text-[11px] p-3 rounded-lg';
        note.style.cssText = 'background:var(--bg-main);border:1px dashed var(--border-subtle);color:var(--text-muted);';
        note.textContent = 'رکوردی در این بازه یافت نشد.';
        list.appendChild(note);
        return;
    }
    rows.forEach(r => {
        const inTime = new Date(r.clock_in).toLocaleString('fa-IR');
        const outTime = r.clock_out ? new Date(r.clock_out).toLocaleString('fa-IR') : 'هنوز حاضر است';
        const row = document.createElement('div');
        row.className = 'p-2 rounded-lg text-[11px]';
        row.style.cssText = 'background:var(--bg-main);border:1px solid var(--border-subtle);';
        row.innerHTML = `
          <div class="flex items-center justify-between gap-2 flex-wrap">
            <span class="font-bold" style="color:var(--text-main);">${r.staff_name || '؟'}</span>
            <span style="color:var(--text-muted);">ورود: ${inTime} — خروج: ${outTime}</span>
          </div>
          ${r.note ? `<div style="color:var(--text-muted);margin-top:2px;">یادداشت: ${r.note}</div>` : ''}
        `;
        list.appendChild(row);
    });
}


// ---- moved from app.js (stage) lines 1818-2246 ----
// ═══════════════════════════════════════════════════════════
// نرخنامه من (MY PRICE LIST) -- a translator's own price overrides for
// every row of the official tariff catalog (price-catalog.js, loaded as a
// separate script -- see PRICE_CATALOG/PRICE_CATALOG_BY_ID). An item can
// have up to two independently-priced components -- "base" (sometimes
// itself per-page/term/etc., see item.baseUnit) and "extra" (a per-line/
// per-item addition, see item.extra/item.unit) -- both overridable here,
// both entered as live quantities on an invoice row (see mypl* further
// down for that). Persisted as pref_price_list on DeepT-Core (PATCH
// /users/me/preferences, two-level sparse merge, same convention as
// document_phrases above).
// ═══════════════════════════════════════════════════════════
let myPriceListServer = {};  // {item_id: {base?, extra?}} -- last known saved overrides, from GET
let myPriceListDraft  = {};  // {item_id: {base?, extra?}} -- unsaved edits

// The price actually shown/used for one component ("base" or "extra") of
// an item right now: an unsaved edit wins over a saved override, which
// wins over the catalog's own default for that component.
function myplEffective(itemId, component) {
    const draftVal = myPriceListDraft[itemId] && myPriceListDraft[itemId][component];
    if (draftVal !== undefined) return draftVal;
    const savedVal = myPriceListServer[itemId] && myPriceListServer[itemId][component];
    if (savedVal !== undefined) return savedVal;
    return PRICE_CATALOG_BY_ID[itemId][component];
}

// Both components at once -- what an invoice row actually needs to
// compute its price. `extra` is null when the item has no such component
// at all (not just "not overridden").
function myplEffectiveComponents(itemId) {
    const item = PRICE_CATALOG_BY_ID[itemId];
    return {
        base: myplEffective(itemId, 'base'),
        extra: item.extra !== null ? myplEffective(itemId, 'extra') : null,
    };
}

// "مهر برابر با اصل" (certified-true-copy stamp) is priced per page by its
// own pinned catalog item (id "227", هزینه مهر برابر با اصل برای هر
// صفحه) but isn't tied to any one document type -- almost any actual
// translated document (never a pinned service fee like پیک/اسکن, and not
// item 227 itself) can additionally need some number of its pages
// stamped. So every non-pinned row gets this as a universal third
// quantity, on top of whatever base/extra components the item itself has.
const MOHR_BARABAR_ASL_ITEM_ID = '227';

// Maps an updateDraftRow()/updateInvoiceEditRow() field name to the row
// property it actually mutates -- shared so both functions handle all
// three نرخنامه quantities identically rather than repeating the
// three-way branch.
const MYPL_QTY_FIELD_MAP = {
    myplBaseQty:  '_mypl_base_qty',
    myplExtraQty: '_mypl_extra_qty',
    myplMohrQty:  '_mypl_mohr_qty',
};

// Recomputes a نرخنامه-linked invoice row's unit_price_toman from its own
// live base/extra/مهر quantities and each component's current effective
// price -- e.g. ریزنمرات دانشگاه (id "58") at 2 ترم + 10 درس + 3 صفحه مهر
// becomes base×2 + extra×10 + مهر×3. No-op for a plain manually-typed row
// (no _mypl_item_id). Called on every quantity edit, and re-derives from
// نرخنامه's *current* prices each time rather than freezing them at
// add-time -- if the translator tweaks نرخنامه mid-session, a
// not-yet-submitted row picks that up too.
function myplRecomputeRowPrice(row) {
    if (!row._mypl_item_id) return;
    const c = myplEffectiveComponents(row._mypl_item_id);
    const baseQty = row._mypl_base_qty || 0;
    const extraQty = row._mypl_extra_qty || 0;
    let total = baseQty * c.base + (c.extra !== null ? extraQty * c.extra : 0);
    if (!PINNED_ITEM_IDS.has(row._mypl_item_id)) {
        const mohrQty = row._mypl_mohr_qty || 0;
        total += mohrQty * myplEffective(MOHR_BARABAR_ASL_ITEM_ID, 'base');
    }
    row.unit_price_toman = total;
}

// The "تعداد ..." quantity inputs shown under a نرخنامه-linked row: one
// per component the item itself has (an item with a flat one-off base and
// no extra shows neither of those two -- same as before variable pricing
// existed), plus the universal مهر برابر با اصل page count for any actual
// document (not a pinned service fee). Shared by the invoice draft and
// invoice-edit renderers; `updateFn` names which row-mutating function to
// wire the inputs to (updateDraftRow or updateInvoiceEditRow).
function myplRowQtyControlsHtml(row, idx, updateFn) {
    if (!row._mypl_item_id) return '';
    const item = PRICE_CATALOG_BY_ID[row._mypl_item_id];
    const showMohr = !PINNED_ITEM_IDS.has(row._mypl_item_id);
    if (!item.baseUnit && item.extra === null && !showMohr) return '';
    let html = '<div class="flex items-center gap-3 flex-wrap w-full mt-1" style="padding-inline-start:1.75rem;">';
    if (item.baseUnit) {
        html += `<label class="text-[10px] flex items-center gap-1" style="color:var(--text-muted);">تعداد ${escapeHtml(item.baseUnit)}
            <input type="number" min="0" value="${row._mypl_base_qty}" oninput="${updateFn}(${idx},'myplBaseQty',this.value)" class="auth-input en" dir="ltr" style="width:52px;padding:.25rem .35rem;font-size:.72rem;text-align:center;">
        </label>`;
    }
    if (item.extra !== null) {
        html += `<label class="text-[10px] flex items-center gap-1" style="color:var(--text-muted);">تعداد (${escapeHtml(item.unit)})
            <input type="number" min="0" value="${row._mypl_extra_qty}" oninput="${updateFn}(${idx},'myplExtraQty',this.value)" class="auth-input en" dir="ltr" style="width:52px;padding:.25rem .35rem;font-size:.72rem;text-align:center;">
        </label>`;
    }
    if (showMohr) {
        html += `<label class="text-[10px] flex items-center gap-1" style="color:var(--text-muted);">تعداد صفحه (مهر برابر با اصل)
            <input type="number" min="0" value="${row._mypl_mohr_qty || 0}" oninput="${updateFn}(${idx},'myplMohrQty',this.value)" class="auth-input en" dir="ltr" style="width:52px;padding:.25rem .35rem;font-size:.72rem;text-align:center;">
        </label>`;
    }
    html += '</div>';
    return html;
}

// A small "🔄" button shown only on a row with no تie to نرخنامه yet --
// a Sanam-imported job (often carrying Sanam's own, possibly stale
// price), a settled job's price, or anything typed from scratch. Once a
// row IS نرخنامه-linked it already has its own live price, so the button
// disappears -- there'd be nothing left to reprice it against. `kind`
// is 'draft' (client-detail/full-profile invoice draft) or 'ive'
// (an already-created invoice's edit view); see openMyPriceListRepriceModal().
function myplRepriceButtonHtml(kind, idx, row) {
    if (row._mypl_item_id) return '';
    return `<button type="button" onclick="openMyPriceListRepriceModal('${kind}',${idx})" title="به‌روزرسانی قیمت از نرخنامه" style="color:var(--accent);background:none;border:none;cursor:pointer;font-size:.9rem;padding:0 .25rem;">🔄</button>`;
}

async function loadMyPriceListCatalog() {
    if (!currentUserSession) { renderMyPriceList(); return; }
    const token = getToken();
    try {
        const res = await fetch(`${CORE}/users/me/preferences`, { headers: { 'Authorization': `Bearer ${token}` } });
        if (!res.ok) throw new Error();
        const p = await res.json();
        myPriceListServer = p.price_list || {};
    } catch (e) {
        myPriceListServer = {};
    }
    myPriceListDraft = {};
    renderMyPriceList();
}

// One labeled number input for a single component ("base" or "extra") of
// an item -- shared by both components below since they behave
// identically, just against a different key and default.
function myplMakeComponentField(item, component, labelText) {
    const wrap = document.createElement('div');
    wrap.className = 'flex flex-col shrink-0';
    wrap.style.width = '128px';

    const label = document.createElement('span');
    label.className = 'text-[9px] mb-0.5 truncate';
    label.style.color = 'var(--text-muted);';
    label.title = labelText;
    label.textContent = labelText;
    wrap.appendChild(label);

    const input = document.createElement('input');
    input.type = 'number';
    input.value = myplEffective(item.id, component);
    input.dir = 'ltr';
    input.className = 'auth-input en';
    input.style.cssText = 'padding:.35rem .5rem;font-size:.76rem;width:100%;';
    input.addEventListener('input', () => myplCommit(item.id, component, input.value));
    wrap.appendChild(input);

    return wrap;
}

function renderMyPriceList() {
    const list = document.getElementById('mypl-list');
    if (!list) return;
    const query = (document.getElementById('mypl-search').value || '').trim();
    list.innerHTML = '';

    PRICE_CATALOG.forEach(group => {
        const matches = group.items.filter(item => !query || item.label.includes(query));
        if (!matches.length) return;

        // پinned (e.g. "هزینه‌های رایج") isn't part of the official tariff --
        // a translator's own everyday fees (courier, scanning, stamps...),
        // shown first (guaranteed by array order -- see price-catalog.js)
        // in a visibly different amber box so they read as "yours to set",
        // not one more row of the government sheet below them.
        const header = document.createElement('div');
        header.className = 'text-[11px] font-black px-1 pt-2 pb-1 sticky top-0 flex items-center gap-1.5';
        header.style.cssText = group.pinned
            ? 'color:#fbbf24;background:var(--panel-bg);'
            : 'color:var(--accent);background:var(--panel-bg);';
        header.innerHTML = group.pinned
            ? `⭐ ${escapeHtml(group.category)}`
            : escapeHtml(group.category);
        list.appendChild(header);

        matches.forEach(item => {
            const dirty = !!myPriceListDraft[item.id];
            const row = document.createElement('div');
            row.className = 'flex items-center gap-2 p-2 rounded-lg flex-wrap';
            row.style.cssText = group.pinned
                ? `background:rgba(251,191,36,.08);border:1px solid ${dirty ? 'var(--accent)' : 'rgba(251,191,36,.35)'};`
                : `background:var(--bg-main);border:1px solid ${dirty ? 'var(--accent)' : 'var(--border-subtle)'};`;
            row.dataset.myplItem = item.id;

            const info = document.createElement('div');
            info.className = 'flex-1 min-w-0';
            info.style.minWidth = '160px';
            info.innerHTML = `<div class="text-xs font-bold truncate" style="color:var(--text-main);" title="${escapeHtml(item.label)}">${escapeHtml(item.label)}${item.addition ? ' <span class="font-normal" style="color:var(--text-muted);">(افزوده)</span>' : ''}</div>`;
            row.appendChild(info);

            row.appendChild(myplMakeComponentField(item, 'base', item.baseUnit ? `قیمت هر ${item.baseUnit}` : 'قیمت پایه'));
            if (item.extra !== null) {
                row.appendChild(myplMakeComponentField(item, 'extra', `افزوده به ازای ${item.unit}`));
            }

            const resetBtn = document.createElement('button');
            resetBtn.type = 'button';
            resetBtn.title = 'بازگشت به نرخ پیش‌فرض رسمی';
            resetBtn.className = 'text-xs font-bold px-2 py-2 rounded-lg shrink-0 transition';
            resetBtn.style.cssText = 'background:var(--panel-bg);color:var(--text-muted);border:1px solid var(--border-subtle);';
            resetBtn.textContent = '↺';
            const atDefault = myplEffective(item.id, 'base') === item.base
                && (item.extra === null || myplEffective(item.id, 'extra') === item.extra);
            resetBtn.disabled = atDefault;
            resetBtn.addEventListener('click', () => {
                myplCommit(item.id, 'base', item.base);
                if (item.extra !== null) myplCommit(item.id, 'extra', item.extra);
                renderMyPriceList();
            });
            row.appendChild(resetBtn);

            list.appendChild(row);
        });
    });

    if (!list.children.length) {
        const empty = document.createElement('div');
        empty.className = 'text-[11px] text-center py-6';
        empty.style.color = 'var(--text-muted)';
        empty.textContent = 'موردی یافت نشد.';
        list.appendChild(empty);
    }
}

function myplCommit(itemId, component, rawValue) {
    const price = parseInt(rawValue, 10);
    const savedVal = (myPriceListServer[itemId] && myPriceListServer[itemId][component] !== undefined)
        ? myPriceListServer[itemId][component]
        : PRICE_CATALOG_BY_ID[itemId][component];
    if (!Number.isFinite(price) || price === savedVal) {
        if (myPriceListDraft[itemId]) {
            delete myPriceListDraft[itemId][component];
            if (!Object.keys(myPriceListDraft[itemId]).length) delete myPriceListDraft[itemId];
        }
    } else {
        myPriceListDraft[itemId] = myPriceListDraft[itemId] || {};
        myPriceListDraft[itemId][component] = price;
    }
    const row = document.querySelector(`[data-mypl-item="${itemId}"]`);
    if (row) row.style.borderColor = myPriceListDraft[itemId] ? 'var(--accent)' : 'var(--border-subtle)';
}

function resetAllMyPriceListDrafts() {
    myPriceListDraft = {};
    renderMyPriceList();
}

// Bulk inflation adjustment: bump every catalog item's *current* effective
// price (whether that's still the official default or an already-saved
// override) by a percentage, all at once. Reuses myplCommit() per
// component so it gets the exact same draft/dirty-marking/reset-to-default
// behavior as a manual edit -- this is just many manual edits done at
// once, still nothing but a draft until "ذخیرهٔ نرخنامه" is pressed.
function openMyplBulkIncreaseModal() {
    document.getElementById('mypl-bulk-increase-pct').value = '';
    document.getElementById('myplBulkIncreaseModal').classList.remove('hidden');
    document.getElementById('mypl-bulk-increase-pct').focus();
}

function closeMyplBulkIncreaseModal() {
    document.getElementById('myplBulkIncreaseModal').classList.add('hidden');
}

function applyMyplBulkIncrease() {
    const pct = parseFloat(document.getElementById('mypl-bulk-increase-pct').value);
    if (!Number.isFinite(pct) || pct === 0) {
        showToast('یک درصد معتبر و غیرصفر وارد کنید.');
        return;
    }
    const factor = 1 + pct / 100;
    PRICE_CATALOG.forEach(group => {
        group.items.forEach(item => {
            const newBase = Math.max(0, Math.round(myplEffective(item.id, 'base') * factor));
            myplCommit(item.id, 'base', newBase);
            if (item.extra !== null) {
                const newExtra = Math.max(0, Math.round(myplEffective(item.id, 'extra') * factor));
                myplCommit(item.id, 'extra', newExtra);
            }
        });
    });
    closeMyplBulkIncreaseModal();
    renderMyPriceList();
    showToast(`قیمت‌ها ${pct > 0 ? '📈 افزایش' : '📉 کاهش'} یافت — برای ثبت نهایی «ذخیرهٔ نرخنامه» را بزنید.`);
}

async function saveMyPriceList() {
    if (!currentUserSession) return;
    const btn = document.getElementById('mypl-save-btn');
    const status = document.getElementById('mypl-save-status');
    status.classList.remove('hidden');

    if (!Object.keys(myPriceListDraft).length) {
        status.style.color = '#f87171';
        status.textContent = 'تغییری برای ذخیره وجود ندارد.';
        return;
    }

    btn.disabled = true;
    status.style.color = 'var(--text-muted)';
    status.textContent = 'در حال ذخیره...';

    const token = getToken();
    try {
        const res = await fetch(`${CORE}/users/me/preferences`, {
            method: 'PATCH',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ price_list: myPriceListDraft })
        });
        const p = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(p.detail || 'خطای سرور');
        myPriceListServer = p.price_list || {};
        myPriceListDraft = {};
        status.style.color = 'var(--accent)';
        status.textContent = '✅ نرخنامه ذخیره شد.';
        renderMyPriceList();
    } catch (e) {
        status.style.color = '#f87171';
        status.textContent = `❌ ذخیره ناموفق بود: ${e.message || 'خطای نامشخص'}`;
    } finally {
        btn.disabled = false;
    }
}

// Ready-to-print A3 handout of the whole نرخنامه (every category, in the
// same ردیف/فهرست/قیمت layout as the official tariff sheet this catalog
// was transcribed from) -- current effective prices only (unsaved drafts
// included, same "live" convention myplEffective() already uses
// elsewhere), so what prints always matches what's actually quoted right
// now. Opened as a separate window/tab rather than an in-page @media
// print block: this needs its own A3-landscape @page size and its own
// two-column flow, independent of (and much denser than) the main app's
// own screen layout -- keeping it fully separate avoids the main
// stylesheet's screen rules ever leaking into what gets printed.
function printMyPriceList() {
    const officeName = (currentUserSession && (currentUserSession.office || currentUserSession.username || currentUserSession.email)) || '';
    const todayFa = new Date().toLocaleDateString('fa-IR');

    const priceCell = (item) => {
        const base = myplEffective(item.id, 'base').toLocaleString();
        const baseUnitTxt = item.baseUnit ? ` (هر ${escapeHtml(item.baseUnit)})` : '';
        let txt = `${base}${baseUnitTxt}`;
        if (item.extra !== null) {
            txt += ` + ${myplEffective(item.id, 'extra').toLocaleString()} ${escapeHtml(item.unit || '')}`;
        }
        return txt;
    };

    // One CONTINUOUS table for the whole catalog -- category headers are
    // just another row (colspan, distinct style) inside the same <tbody>,
    // not a separate <table> per category. This is deliberate: a separate
    // break-inside:avoid table per category treats that whole category as
    // one unbreakable block, so a category that doesn't quite fit in the
    // column space left wastes it all rather than partially filling it --
    // with 26 categories of very uneven size, that dead space was the main
    // reason this overflowed onto 4 pages instead of 2. A single table
    // lets the browser's column/page breaking flow row-by-row instead,
    // packing tightly the way the original tariff sheet itself does
    // (a category routinely continues right across a column boundary).
    const rowsHtml = PRICE_CATALOG.map(group => {
        // Pinned items (هزینه‌های رایج) aren't real rows of the official
        // tariff sheet -- their ids (224+) are just internal bookkeeping,
        // continuing past the sheet's own last row ("223") so they never
        // collide with a real one (see price-catalog.js's header comment).
        // Printing them would misleadingly suggest they're official
        // numbered items, so this column stays blank for this category only.
        const itemRows = group.items.map(item => `
            <tr>
                <td class="col-id">${group.pinned ? '' : escapeHtml(item.id)}</td>
                <td class="col-label">${escapeHtml(item.label)}</td>
                <td class="col-price en" dir="ltr">${priceCell(item)}</td>
            </tr>`).join('');
        return `<tr class="cat-row"><td colspan="3" class="cat-title">${escapeHtml(group.category)}</td></tr>${itemRows}`;
    }).join('');

    const printWin = window.open('', '_blank');
    if (!printWin) { showToast('⚠️ مرورگر بازشدن پنجرهٔ چاپ را مسدود کرد. لطفاً اجازه دهید و دوباره تلاش کنید.'); return; }

    printWin.document.write(`<!DOCTYPE html>
<html dir="rtl" lang="fa">
<head>
<meta charset="UTF-8">
<title>نرخنامه من</title>
<style>
    @page { size: A3 landscape; margin: 7mm; }
    * { box-sizing: border-box; }
    body { font-family: Tahoma, 'Vazirmatn', sans-serif; direction: rtl; margin: 0; color: #111; }
    header { text-align: center; margin-bottom: 3mm; }
    header h1 { font-size: 13px; margin: 0 0 1mm; }
    header .meta { font-size: 8px; color: #444; }
    .cols { column-count: 3; column-gap: 5mm; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    tr.cat-row { break-after: avoid; break-inside: avoid; }
    tr { break-inside: avoid; }
    th, td { border: 0.5px solid #999; padding: .5mm 1mm; font-size: 7.5px; line-height: 1.25; text-align: right; vertical-align: top; overflow-wrap: break-word; }
    .cat-title { background: #e5e5e5; font-weight: bold; text-align: center; font-size: 7.5px; padding: .7mm 1mm; }
    .col-id { width: 4%; text-align: center; padding-left: .5mm; padding-right: .5mm; }
    .col-label { width: 65%; }
    .col-price { width: 31%; text-align: left; }
    @media print { .no-print { display: none !important; } }
</style>
</head>
<body>
    <div class="no-print" style="text-align:center;padding:10px;">
        <button onclick="window.print()" style="font-family:Tahoma,sans-serif;padding:8px 16px;font-size:13px;cursor:pointer;">🖨️ چاپ / ذخیره PDF</button>
    </div>
    <header>
        <h1>فهرست اسناد و حق‌الترجمه ترجمه رسمی — نرخنامه من</h1>
        <div class="meta">${officeName ? escapeHtml(officeName) + ' — ' : ''}تاریخ تهیه: ${todayFa}</div>
    </header>
    <div class="cols"><table><tbody>${rowsHtml}</tbody></table></div>
</body>
</html>`);
    printWin.document.close();
    printWin.onload = () => { printWin.focus(); printWin.print(); };
}


// ---- moved from app.js (stage) lines 2603-3999 ----
// ═══════════════════════════════════════════════════════════
// DASHBOARD — MY CLIENTS
// ═══════════════════════════════════════════════════════════
// Fetched once per visit to مشتریان (and refetched after any add/edit/
// delete/Sanam-import -- see renderDashboardClients(q, forceRefresh)
// callers below), then filtered locally on every keystroke: instant, and
// matches substrings across every field (Farsi name, Latin name, phone,
// national id) regardless of whatever subset the server's own ?q= filter
// happens to cover.
let dashboardClientsCache = null;

function clientMatchesQuery(c, q) {
    const needle = q.trim().toLowerCase();
    if (!needle) return true;
    const haystacks = [
        c.first_name_fa, c.last_name_fa,
        `${c.first_name_fa || ''} ${c.last_name_fa || ''}`,
        c.first_name, c.last_name,
        `${c.first_name || ''} ${c.last_name || ''}`,
        c.national_id, c.phone,
    ];
    return haystacks.some(h => (h || '').toString().toLowerCase().includes(needle));
}

function searchDashboardClients(q) {
    renderDashboardClients(q);
}

async function renderDashboardClients(q = '', forceRefresh = false) {
    const box = document.getElementById('dashboardClientsList');
    if (!box) return;
    const token = localStorage.getItem('deept_token');

    if (dashboardClientsCache === null || forceRefresh) {
        box.innerHTML = `<div class="text-xs text-center py-6" style="color:var(--text-muted);">در حال بارگذاری...</div>`;
        try {
            const res = await fetch(`${CORE}/clients`, { headers: { 'Authorization': `Bearer ${token}` } });
            if (!res.ok) throw new Error();
            dashboardClientsCache = await res.json();
        } catch (e) {
            dashboardClientsCache = null;
            box.innerHTML = `<div class="text-xs text-center py-6" style="color:#f87171;">خطا در دریافت لیست مشتریان.
                <button onclick="renderDashboardClients('${(q || '').replace(/'/g,"")}', true)" class="block mx-auto mt-2 text-[11px] font-bold px-3 py-1 rounded-lg" style="background:var(--card-surface);color:var(--accent);border:1px solid var(--border-color);">🔄 تلاش مجدد</button>
            </div>`;
            return;
        }
    }

    if (!dashboardClientsCache.length) {
        box.innerHTML = `<div class="text-xs text-center py-6" style="color:var(--text-muted);">// هنوز مشتری‌ای ثبت نشده</div>`;
        return;
    }

    const clients = dashboardClientsCache.filter(c => clientMatchesQuery(c, q));
    if (!clients.length) {
        box.innerHTML = `<div class="text-xs text-center py-6" style="color:var(--text-muted);">موردی یافت نشد.</div>`;
        return;
    }

    {
        const faName = (c) => `${c.first_name_fa || ''} ${c.last_name_fa || ''}`.trim();
        const enName = (c) => `${c.first_name || ''} ${c.last_name || ''}`.trim();
        const displayName = (c) => faName(c) || enName(c) || '—';
        // A real <table> instead of one independent CSS-grid <div> per row:
        // separate grid containers each size their own fr columns off their
        // own content, so a row with a longer/shorter name than the header's
        // label text drifts the column boundaries out of alignment with it
        // row by row. A <table> shares one column layout across the header
        // and every row by construction, so this can't happen.
        box.innerHTML = `
            <table class="ws-table" style="width:100%;border-spacing:0;font-size:.8rem;">
                <thead>
                    <tr>
                        <th style="text-align:right;padding-inline-start:.75rem;">نام</th>
                        <th style="text-align:right;">کد ملی</th>
                        <th style="text-align:right;">شماره همراه</th>
                        <th style="width:140px;"></th>
                    </tr>
                </thead>
                <tbody>
                    ${clients.map(c => `
                        <tr>
                            <td style="padding:.6rem .75rem .6rem 0;">
                                <div class="font-black text-sm" style="color:var(--text-main);">${escapeHtml(displayName(c))}</div>
                            </td>
                            <td class="en font-bold" style="padding:.6rem 0;color:var(--text-main);text-align:right;" dir="ltr">${escapeHtml(c.national_id) || '—'}</td>
                            <td class="en font-bold" style="padding:.6rem 0;color:var(--text-main);text-align:right;" dir="ltr">${escapeHtml(c.phone) || '—'}</td>
                            <td style="padding:.6rem 0;">
                                <span class="flex items-center gap-1.5 justify-end">
                                    <button onclick="openClientProfile('${c.id}')" class="text-xs font-bold px-3 py-1.5 rounded-lg transition" style="background:var(--card-surface);color:var(--accent);border:1px solid var(--border-color);">مشاهده</button>
                                    <button onclick="deleteClient('${c.id}')" title="حذف مشتری" class="text-xs font-bold px-2 py-1.5 rounded-lg transition" style="background:var(--card-surface);color:#f87171;border:1px solid var(--border-color);">🗑</button>
                                </span>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>`;
    }
}

let currentClientDetailId = null;
let invoiceDraft = [];   // [{description, quantity, line_total_toman, job_id}] -- built up before POSTing to /invoices
// The activity list's own computed rows from the last render -- lets the
// bulk action bar (create invoice / delete / edit fields) below look up a
// checked row's current type/title/price without a second fetch.
let lastActivityRows = [];
let editWorkRecordTarget = null;   // { type, id } while editWorkRecordModal is open

/* ============ SECTION: CLIENT DETAIL + DRAFT INVOICE ============
   Related persons, jobs list, notes, and the draft-invoice builder. ============ */
async function openClientDetail(clientId) {
    currentClientDetailId = clientId;
    invoiceDraft = [];
    document.getElementById('clientDetailModal').classList.remove('hidden');
    const token = localStorage.getItem('deept_token');
    try {
        const res = await fetch(`${CORE}/clients/${clientId}`, { headers: { 'Authorization': `Bearer ${token}` } });
        if (!res.ok) throw new Error();
        const c = await res.json();

        document.getElementById('cd-name').textContent = `${c.first_name} ${c.last_name}`;
        document.getElementById('cd-subtitle').textContent = c.father_name ? `فرزند ${c.father_name}` : '';
        document.getElementById('cd-passport').textContent = c.passport_number || '—';
        document.getElementById('cd-national').textContent = c.national_id || '—';
        document.getElementById('cd-phone').textContent = c.phone || '—';
        document.getElementById('cd-email').textContent = c.email || '—';
        document.getElementById('cd-notes').value = c.notes || '';
        // cd-job-count's header was replaced by the combined activity
        // list's own count (cd-activity-count, set in renderClientActivityList).

        const related = c.related_persons || [];
        document.getElementById('cd-related-count').textContent = related.length;
        const relatedBox = document.getElementById('cd-related-list');
        relatedBox.innerHTML = !related.length
            ? `<div class="text-xs text-center py-3" style="color:var(--text-muted);">// نفر مرتبطی ثبت نشده</div>`
            : related.map(r => `
                <div class="flex items-center justify-between p-2.5 rounded-lg text-xs" style="background:var(--bg-main);border:1px solid var(--border-subtle);">
                    <span class="en" style="color:var(--text-main);">${escapeHtml(r.first_name)} ${escapeHtml(r.last_name)}</span>
                    <span class="flex items-center gap-2">
                        <span class="en" style="color:var(--text-muted);">کد ملی: ${escapeHtml(r.national_id) || '—'}</span>
                        <button onclick="removeRelatedPerson('${(r.national_id||'').replace(/'/g,"")}')" style="color:#f87171;background:none;border:none;cursor:pointer;font-weight:700;">حذف ✕</button>
                    </span>
                </div>`).join('');

        renderClientActivityList(c.jobs || [], c.sanam_documents || []);

        renderDraftRows();
        await renderClientInvoices(clientId);
        workWeekStart = startOfPersianWeek(new Date());
        setWorkOrderTypeFilter(null);
    } catch (e) {
        showToast('خطا در دریافت اطلاعات مشتری.');
    }
}

// ── Combined activity list: DeepT jobs + Sanam-imported documents ────────
// One merged, chronological, color-coded list a translator can check items
// in directly onto the invoice draft below -- replaces the two separate
// lists (jobs / Sanam docs) and the jobs list's old one-at-a-time "+
// افزودن" button. Same isProfilePageOpen() prefix convention as
// renderClientInvoices()/updateDraftTotal(), since this renders into
// whichever of the two client-detail views (full-window profile page, or
// the older modal) is actually open.
const ACTIVITY_STATUS_LABELS = {
    queued:     { text: 'در صف',        color: '#94a3b8' },
    processing: { text: 'در حال پردازش', color: '#fb923c' },
    completed:  { text: 'آماده',        color: '#4ade80' },
    failed:     { text: 'ناموفق',       color: '#f87171' },
};
const ACTIVITY_CATEGORY_COLORS = { job: '#4ade80', sanam: '#38bdf8', manual: '#fbbf24' };

function activityRowKey(type, id) { return `${type}:${id}`; }

// A row is "checked" whenever it's currently sitting in invoiceDraft --
// the checkbox IS the draft-membership toggle, no separate selection
// state to keep in sync.
function isActivityInDraft(key) {
    return invoiceDraft.some(row => row._source_key === key);
}

function toggleActivityInDraft(type, id, description, priceToman, checked) {
    const key = activityRowKey(type, id);
    if (checked) {
        if (isActivityInDraft(key)) return;
        // job_id links back to a completed DeepT job; sanam_document_id
        // links back to an imported-but-unbilled Sanam work item (see
        // clients.py's _get_sanam_documents) -- the backend marks it billed
        // (invoice_id) once the invoice is actually created, so it won't be
        // offered again for a second invoice.
        invoiceDraft.push({
            description, quantity: 1, unit_price_toman: priceToman,
            job_id: type === 'job' ? id : null,
            sanam_document_id: type === 'sanam' ? id : null,
            _source_key: key,
        });
    } else {
        invoiceDraft = invoiceDraft.filter(row => row._source_key !== key);
    }
    renderDraftRows();
}

// ── Bulk action bar: create invoice / delete / edit fields ──────────────
// Appears above the activity list the moment any row is checked, acting
// on whichever activity-list rows are currently checked (i.e. present in
// invoiceDraft with a _source_key -- a manually-typed draft row has none,
// so it's never counted here). "Create invoice" just reuses the existing
// submitDraftInvoice() flow; delete/edit act on the underlying job/sanam
// record itself, not just its draft copy.
function checkedActivityRows() {
    const checkedKeys = new Set(invoiceDraft.map(r => r._source_key).filter(Boolean));
    return lastActivityRows.filter(r => checkedKeys.has(activityRowKey(r.type, r.id)));
}

function updateActivityBulkBar() {
    ['cd', 'cp'].forEach(prefix => {
        const bar = document.getElementById(`${prefix}-activity-bulk-bar`);
        if (!bar) return;
        const checked = checkedActivityRows();
        if (!checked.length) { bar.classList.add('hidden'); return; }
        bar.classList.remove('hidden');
        const countEl = document.getElementById(`${prefix}-activity-bulk-count`);
        if (countEl) countEl.textContent = `${checked.length.toLocaleString()} مورد انتخاب شده`;

        // A DeepT job is never deletable (it's the record of real
        // translation work performed) -- only Sanam-imported rows are.
        // Styled as disabled but never given the actual `disabled`
        // attribute -- a real disabled button swallows the click before it
        // ever reaches bulkDeleteCheckedActivityRows()/
        // openEditWorkRecordModalForSelection() below, so their own toast
        // explaining *why* never fires and the button just looks broken.
        const hasJob = checked.some(r => r.type === 'job');
        const deleteBtn = document.getElementById(`${prefix}-activity-bulk-delete`);
        if (deleteBtn) {
            deleteBtn.style.opacity = hasJob ? '.45' : '1';
            deleteBtn.style.cursor = hasJob ? 'not-allowed' : 'pointer';
            deleteBtn.title = hasJob ? 'رکوردهای ترجمه قابل حذف نیستند -- فقط رکوردهای سنام حذف‌شدنی‌اند.' : '';
        }
        // Editing multiple different rows' fields in one form doesn't make
        // sense -- only enabled for exactly one checked row.
        const editBtn = document.getElementById(`${prefix}-activity-bulk-edit`);
        if (editBtn) {
            const single = checked.length === 1;
            editBtn.style.opacity = single ? '1' : '.45';
            editBtn.style.cursor = single ? 'pointer' : 'not-allowed';
            editBtn.title = single ? '' : 'برای ویرایش، فقط یک مورد را انتخاب کنید.';
        }
    });
}

// Re-fetches just the jobs/sanam_documents for the open client and
// re-renders the activity list -- unlike openClientDetail/openClientProfile,
// this leaves invoiceDraft untouched (aside from whatever the caller already
// removed/updated), so an unrelated manually-typed draft row or a still-
// checked other item survives a delete/edit of one record.
async function _refetchClientActivity(clientId) {
    if (!clientId) return;
    const token = localStorage.getItem('deept_token');
    try {
        const res = await fetch(`${CORE}/clients/${clientId}`, { headers: { 'Authorization': `Bearer ${token}` } });
        if (!res.ok) throw new Error();
        const c = await res.json();
        renderClientActivityList(c.jobs || [], c.sanam_documents || []);
    } catch (e) {
        showToast('خطا در به‌روزرسانی سابقهٔ مشتری.');
    }
}

async function bulkDeleteCheckedActivityRows() {
    const checked = checkedActivityRows();
    if (!checked.length) return;
    if (checked.some(r => r.type === 'job')) {
        showToast('⚠️ رکوردهای ترجمه قابل حذف نیستند.');
        return;
    }
    if (!confirm(`${checked.length} رکورد برای همیشه حذف شود؟ این کار قابل بازگشت نیست.`)) return;

    const token = localStorage.getItem('deept_token');
    let failed = 0;
    for (const row of checked) {
        try {
            const res = await fetch(`${CORE}/invoices/sanam-documents/${row.id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` },
            });
            if (!res.ok) { failed++; continue; }
            invoiceDraft = invoiceDraft.filter(r => r._source_key !== activityRowKey(row.type, row.id));
        } catch (e) {
            failed++;
        }
    }
    renderDraftRows();
    await _refetchClientActivity(currentClientDetailId);
    showToast(failed ? `⚠️ ${failed} مورد حذف نشد (احتمالاً قبلاً در فاکتوری استفاده شده).` : '✅ رکورد(ها) حذف شد.');
}

function openEditWorkRecordModalForSelection() {
    const checked = checkedActivityRows();
    if (checked.length !== 1) {
        showToast(checked.length ? '⚠️ برای ویرایش، فقط یک مورد را انتخاب کنید.' : '⚠️ ابتدا یک مورد را انتخاب کنید.');
        return;
    }
    openEditWorkRecordModal(checked[0].type, checked[0].id);
}

function openEditWorkRecordModal(type, id) {
    const row = lastActivityRows.find(r => r.type === type && String(r.id) === String(id));
    if (!row) return;
    editWorkRecordTarget = { type, id };

    const fieldsBox = document.getElementById('edit-work-record-fields');
    if (type === 'job') {
        fieldsBox.innerHTML = `
            <label class="text-xs font-bold block mb-1" style="color:var(--text-main);">قیمت (تومان)</label>
            <input type="number" id="ewr-price" class="auth-input en w-full" dir="ltr" value="${row.price || 0}">
            <p class="text-[11px] mt-2" style="color:var(--text-muted);">فقط قیمت این سفارش قابل ویرایش است -- نوع سند تغییر نمی‌کند.</p>`;
    } else {
        fieldsBox.innerHTML = `
            <label class="text-xs font-bold block mb-1" style="color:var(--text-main);">شرح</label>
            <input type="text" id="ewr-description" class="auth-input w-full" value="${(row.title || '').replace(/"/g, '&quot;')}">
            <label class="text-xs font-bold block mb-1 mt-2.5" style="color:var(--text-main);">تعداد کپی</label>
            <input type="number" id="ewr-copies" class="auth-input en w-full" dir="ltr" min="1" value="${row.copies || 1}">
            <label class="text-xs font-bold block mb-1 mt-2.5" style="color:var(--text-main);">قیمت (تومان)</label>
            <input type="number" id="ewr-price" class="auth-input en w-full" dir="ltr" value="${row.price || 0}">
            <label class="text-xs font-bold block mb-1 mt-2.5" style="color:var(--text-main);">تاریخ درخواست</label>
            <input type="text" id="ewr-date" class="auth-input w-full" value="${(row.date || '').replace(/"/g, '&quot;')}">`;
    }
    document.getElementById('editWorkRecordModal').classList.remove('hidden');
}

function closeEditWorkRecordModal() {
    editWorkRecordTarget = null;
    document.getElementById('editWorkRecordModal').classList.add('hidden');
}

async function submitEditWorkRecord() {
    if (!editWorkRecordTarget) return;
    const { type, id } = editWorkRecordTarget;
    const token = localStorage.getItem('deept_token');

    let url, body;
    if (type === 'job') {
        url = `${CORE}/jobs/${id}/fields`;
        body = { price_toman: parseInt(document.getElementById('ewr-price').value, 10) || 0 };
    } else {
        url = `${CORE}/invoices/sanam-documents/${id}`;
        body = {
            description: document.getElementById('ewr-description').value.trim(),
            copies: parseInt(document.getElementById('ewr-copies').value, 10) || 1,
            price_toman: parseInt(document.getElementById('ewr-price').value, 10) || 0,
            request_date: document.getElementById('ewr-date').value.trim() || null,
        };
    }

    try {
        const res = await fetch(url, {
            method: 'PATCH',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || 'خطای سرور'); }

        // A row already checked into the draft keeps stale values (they
        // were snapshotted at check-time) unless refreshed here too.
        const draftRow = invoiceDraft.find(r => r._source_key === activityRowKey(type, id));
        if (draftRow) {
            if (body.description !== undefined) draftRow.description = body.description;
            draftRow.unit_price_toman = body.price_toman;
            renderDraftRows();
        }

        closeEditWorkRecordModal();
        showToast('✅ رکورد ویرایش شد.');
        await _refetchClientActivity(currentClientDetailId);
    } catch (e) {
        showToast(`❌ ${e.message || 'ویرایش ناموفق بود.'}`);
    }
}

// The full-window profile page (cp-) shows this as a real <table> (it has
// the width for real columns); the older, narrower client-detail modal
// (cd-) keeps the original compact card-row layout, which is what it has
// room for. Both read from the same computed `rows` array below.
function renderClientActivityList(jobs, sanamDocs) {
    const prefix = isProfilePageOpen() ? 'cp' : 'cd';
    const box = document.getElementById(prefix + '-activity-list');
    const countEl = document.getElementById(prefix + '-activity-count');
    if (!box) return;

    const rows = [];
    (jobs || []).forEach(j => {
        rows.push({
            type: 'job', id: j.id, date: j.created_at,
            title: DOCUMENT_REGISTRY[j.document_type]?.label || j.document_type,
            price: j.price_toman || 0, status: j.status,
            // Only a completed job has a settled price worth invoicing.
            checkable: j.status === 'completed',
        });
    });
    (sanamDocs || []).forEach(d => {
        rows.push({
            type: 'sanam', id: d.id, date: d.request_date || d.created_at,
            title: d.description, copies: d.copies || 1,
            price: d.price_toman || 0, trackingCode: d.tracking_code,
            // Already attached to an invoice -- don't offer it for a second one.
            checkable: !d.invoice_id, billed: !!d.invoice_id,
        });
    });
    rows.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    lastActivityRows = rows;

    if (countEl) countEl.textContent = rows.length;
    if (prefix === 'cp') renderClientStats(rows);

    if (!rows.length) {
        const emptyMsg = '// بدون سابقه پروژه یا سند';
        box.innerHTML = prefix === 'cp'
            ? `<tr><td colspan="6" class="text-xs text-center py-4" style="color:var(--text-muted);">${emptyMsg}</td></tr>`
            : `<div class="text-xs text-center py-4" style="color:var(--text-muted);">${emptyMsg}</div>`;
        updateActivityBulkBar();
        return;
    }

    box.innerHTML = rows.map(r => {
        const color = ACTIVITY_CATEGORY_COLORS[r.type];
        const checked = isActivityInDraft(activityRowKey(r.type, r.id));
        const st = r.type === 'job' ? (ACTIVITY_STATUS_LABELS[r.status] || { text: escapeHtml(r.status), color: 'var(--text-muted)' })
            : (r.billed ? { text: 'فاکتور شده', color: '#4ade80' } : null);
        const idBadge = r.type === 'job'
            ? `<span class="en" style="color:var(--text-muted);font-size:.65rem;" title="شناسه کار">#${escapeHtml(String(r.id).slice(0, 8))}</span>`
            : (r.trackingCode ? `<span class="en" style="color:var(--text-muted);font-size:.65rem;">کد پیگیری ${escapeHtml(r.trackingCode)}</span>` : '');
        const dateStr = r.date ? escapeHtml(String(r.date).slice(0, 10)) : '—';
        const dotTitle = r.type === 'job' ? 'ترجمه ماشینی' : (r.type === 'sanam' ? 'وارد شده از سنام' : 'ردیف دستی');
        const checkbox = `<input type="checkbox" ${checked ? 'checked' : ''} ${r.checkable ? '' : 'disabled'}
            data-activity-key="${escapeHtml(activityRowKey(r.type, r.id))}"
            onchange='toggleActivityInDraft(${JSON.stringify(r.type)}, ${JSON.stringify(r.id)}, ${JSON.stringify(r.title)}, ${r.price}, this.checked)'
            style="width:15px;height:15px;accent-color:${color};flex-shrink:0;cursor:${r.checkable ? 'pointer' : 'not-allowed'};">`;

        if (prefix === 'cp') {
            return `<tr>
                <td style="padding:.6rem;"><span title="${dotTitle}" style="width:9px;height:9px;border-radius:50%;background:${color};display:inline-block;"></span></td>
                <td style="padding:.6rem;color:var(--text-main);font-weight:700;">${escapeHtml(r.title)}</td>
                <td class="en" style="padding:.6rem;color:var(--text-muted);">${idBadge || '—'}</td>
                <td class="en" style="padding:.6rem;color:var(--text-muted);">${dateStr}</td>
                <td class="en font-bold" style="padding:.6rem;color:var(--accent);">${r.price ? r.price.toLocaleString() + ' ت' : '—'}</td>
                <td style="padding:.6rem;text-align:center;">${r.billed ? `<span class="status-pill" style="color:${st.color};background:${st.color}1f;">${st.text}</span>` : checkbox}</td>
            </tr>`;
        }
        return `<div class="flex items-center gap-2.5 p-2.5 rounded-lg text-xs" style="background:var(--bg-main);border:1px solid var(--border-subtle);border-inline-start:3px solid ${color};">
            <span title="${dotTitle}" style="width:9px;height:9px;border-radius:50%;background:${color};display:inline-block;flex-shrink:0;"></span>
            ${checkbox}
            <span class="flex-1" style="color:var(--text-main);">${escapeHtml(r.title)}</span>
            ${idBadge}
            <span class="en shrink-0" style="color:var(--text-muted);">${dateStr}</span>
            <span class="en font-bold shrink-0" style="color:var(--accent);width:80px;text-align:left;">${r.price ? r.price.toLocaleString() + ' ت' : '—'}</span>
            ${st ? `<span class="status-pill" style="color:${st.color};background:${st.color}1f;">${st.text}</span>` : ''}
        </div>`;
    }).join('');
    updateActivityBulkBar();
}

// Quick-glance numbers above the profile's activity table -- a failed job
// never actually charged the client (see the wallet-refund-on-failure
// fix), so it's excluded from "مجموع درآمد" same as it would be from a
// real invoice.
function renderClientStats(rows) {
    const countEl = document.getElementById('cp-stat-count');
    const revenueEl = document.getElementById('cp-stat-revenue');
    const pendingEl = document.getElementById('cp-stat-pending');
    const lastEl = document.getElementById('cp-stat-last');
    if (!countEl) return;

    const revenue = rows.reduce((sum, r) => sum + (r.status === 'failed' ? 0 : (r.price || 0)), 0);
    const pending = rows.filter(r => r.status === 'processing' || r.status === 'queued').length;
    const last = rows.length ? (rows[0].date || '').slice(0, 10) : '';

    countEl.textContent = rows.length;
    revenueEl.textContent = revenue.toLocaleString();
    pendingEl.textContent = pending;
    lastEl.textContent = last || '—';
}

async function renderClientInvoices(clientId) {
    const profileOpen = isProfilePageOpen();
    const prefix = profileOpen ? 'cp' : 'cd';
    const box = document.getElementById(prefix + '-invoices-list');
    const countEl = document.getElementById(prefix + '-invoice-count');
    const token = localStorage.getItem('deept_token');
    box.innerHTML = `<div class="text-xs text-center py-3" style="color:var(--text-muted);">در حال بارگذاری...</div>`;
    try {
        const res = await fetch(`${CORE}/invoices?client_id=${clientId}`, { headers: { 'Authorization': `Bearer ${token}` } });
        if (!res.ok) throw new Error();
        const invoices = await res.json();
        if (countEl) countEl.textContent = invoices.length;
        if (!invoices.length) {
            box.innerHTML = `<div class="text-xs text-center py-4" style="color:var(--text-muted);">// بدون فاکتور ثبت‌شده</div>`;
            return;
        }
        const SOURCE_LABELS = { sanam_import: 'سنام', manual: 'دستی' };
        const TYPE_LABELS = {
            invoice:  { text: 'فاکتور',     color: '#4ade80' },
            proforma: { text: 'پیش‌فاکتور', color: '#fb923c' },
        };
        box.innerHTML = invoices.map(inv => {
            const t = TYPE_LABELS[inv.invoice_type] || TYPE_LABELS.invoice;
            // finalized_at (set once printed/emailed) is purely informational
            // now -- editing is always allowed, never locked by it.
            const sentBadge = inv.finalized_at
                ? `<span class="text-[10px] shrink-0" style="color:var(--text-muted);" title="قبلاً چاپ یا ایمیل شده">✓ ارسال‌شده</span>`
                : '';
            const actions = `<button onclick="event.stopPropagation();openInvoiceView('${inv.id}', true)" class="text-[10px] font-bold px-2 py-1 rounded-md shrink-0" style="background:var(--card-surface);color:var(--accent);border:1px solid var(--border-color);">✏️ ویرایش</button>`;
            return `
            <div onclick="openInvoiceView('${inv.id}')" class="p-2.5 rounded-lg text-xs cursor-pointer transition hover:opacity-80" style="background:var(--bg-main);border:1px solid var(--border-subtle);">
                <div class="flex items-center justify-between gap-2">
                    <span class="flex items-center gap-1.5" style="color:var(--text-main);">
                        🧾 <span class="status-pill" style="color:${t.color};background:${t.color}1f;">${t.text}</span>
                        ${SOURCE_LABELS[inv.source] || inv.source}${inv.tracking_code ? ' · کد پیگیری ' + escapeHtml(inv.tracking_code) : ''}
                    </span>
                    <span class="flex items-center gap-2">
                        <span class="font-bold en" style="color:var(--accent);">${(inv.total_toman || 0).toLocaleString()} تومان</span>
                        ${sentBadge}
                        ${actions}
                    </span>
                </div>
            </div>`;
        }).join('');
    } catch (e) {
        box.innerHTML = `<div class="text-xs text-center py-3" style="color:#f87171;">خطا در دریافت فاکتورها.</div>`;
    }
}

// ── Invoice draft builder — prices are volatile enough (and one-off costs
// like هزینه پیک come up often enough) that every line, whether checked in
// from the activity list above or typed in from scratch, has to stay
// editable right up until the translator actually submits the invoice.
// Quantity × unit price, not just a flat total, since per-item costs
// (تمبر دادگستری, هر صفحه مهر وزارت خارجه, ...) commonly repeat several
// times in one order. ──────────────────────────────────────────────────

function addCustomInvoiceRow() {
    invoiceDraft.push({ description: '', quantity: 1, unit_price_toman: 0, job_id: null, sanam_document_id: null });
    renderDraftRows();
}

// نرخنامه picker -- a searchable dropdown (search <input> + a floating
// filtered list), same pattern as the document-type picker in the
// translation-pipeline stage (docTemplateSearch/docTemplateOptions). A
// plain <select> with 236 options in <optgroup>s only supports the
// browser's own prefix typeahead, not real keyword search across a list
// this long -- this instead filters by any keyword typed, anywhere in
// the label.
//
// There are three separate instances of this picker on screen at once
// (the client-detail invoice draft "cd", the full-profile-page invoice
// draft "cp", and an already-created invoice's edit view "ive"), so
// everything here is parameterized by `instance` rather than tripled.
function myplDropdownIds(instance) {
    return { search: `${instance}-mypl-search`, options: `${instance}-mypl-options` };
}

// Filters the full catalog by keyword (matching anywhere in the label,
// not just a prefix) and renders the results into `list`, calling
// `onSelect(itemId)` when one is clicked. Shared by the three
// add-a-row dropdowns above and the reprice-an-existing-row modal below
// -- both are "search the catalog, do something with what got picked",
// differing only in what "do something" means.
function renderMyPriceListMatches(list, query, onSelect) {
    list.innerHTML = '';

    const q = (query || '').trim();
    const matches = [];
    PRICE_CATALOG.forEach(group => {
        group.items.forEach(item => {
            if (!q || item.label.includes(q)) matches.push(item);
        });
    });

    if (!matches.length) {
        const empty = document.createElement('div');
        empty.className = 'px-3 py-2 text-xs';
        empty.style.color = 'var(--text-muted)';
        empty.textContent = 'موردی یافت نشد';
        list.appendChild(empty);
        return;
    }

    // A blank query matches all 246 -- rendering every one of them just to
    // scroll past is wasted work; cap the list and nudge toward typing.
    const capped = matches.slice(0, 80);
    capped.forEach(item => {
        const row = document.createElement('div');
        row.className = 'px-3 py-2 text-sm cursor-pointer';
        row.style.fontFamily = "'Vazirmatn',sans-serif";
        row.textContent = `${item.label} (${item.base.toLocaleString()})`;
        row.addEventListener('mouseenter', () => { row.style.background = 'var(--accent-hover)'; });
        row.addEventListener('mouseleave', () => { row.style.background = ''; });
        row.addEventListener('click', () => onSelect(item.id));
        list.appendChild(row);
    });
    if (matches.length > capped.length) {
        const more = document.createElement('div');
        more.className = 'px-3 py-2 text-[10px] text-center';
        more.style.color = 'var(--text-muted)';
        more.textContent = `و ${(matches.length - capped.length).toLocaleString()} مورد دیگر — برای محدود کردن نتایج تایپ کنید`;
        list.appendChild(more);
    }
}

function renderMyPriceListDropdown(instance, query) {
    const list = document.getElementById(myplDropdownIds(instance).options);
    if (!list) return;
    renderMyPriceListMatches(list, query, (itemId) => selectMyPriceListItem(instance, itemId));
}

function filterMyPriceListDropdown(instance) {
    const { search } = myplDropdownIds(instance);
    const input = document.getElementById(search);
    if (!input) return;
    openMyPriceListDropdown(instance);
    renderMyPriceListDropdown(instance, input.value);
}

function openMyPriceListDropdown(instance) {
    const { search, options } = myplDropdownIds(instance);
    const input = document.getElementById(search);
    const list = document.getElementById(options);
    if (!input || !list) return;
    const rect = input.getBoundingClientRect();
    const availableBelow = window.innerHeight - rect.bottom - 12;
    const maxHeight = Math.max(160, Math.min(320, availableBelow));
    list.style.position = 'fixed';
    list.style.top = (rect.bottom + 4) + 'px';
    list.style.left = rect.left + 'px';
    list.style.width = Math.max(rect.width, 260) + 'px';
    list.style.maxHeight = maxHeight + 'px';
    list.style.overflowY = 'auto';
    list.classList.remove('hidden');
}

function closeMyPriceListDropdown(instance) {
    document.getElementById(myplDropdownIds(instance).options)?.classList.add('hidden');
}

['cd', 'cp', 'ive'].forEach(instance => {
    document.addEventListener('click', (e) => {
        const wrapper = document.getElementById(myplDropdownIds(instance).search)?.closest('.relative');
        if (wrapper && !wrapper.contains(e.target)) closeMyPriceListDropdown(instance);
    });
});

// ── Reprice an existing row from نرخنامه ──────────────────────────────
// A row that isn't نرخنامه-linked (a Sanam-imported job -- possibly
// carrying Sanam's own, out-of-date price -- a job's settled price, or
// one typed from scratch) has no live tie to نرخنامه at all. This lets
// the translator pick the matching catalog item and swap that one row's
// description/price for it, turning it into a normal نرخنامه-linked row
// (live price + quantity controls) from then on -- see the "🔄" button
// rendered in renderDraftRows()/renderInvoiceEditRows() for any row
// missing _mypl_item_id.
let myplRepriceTarget = null;  // { kind: 'draft'|'ive', idx } while the modal is open

function openMyPriceListRepriceModal(kind, idx) {
    myplRepriceTarget = { kind, idx };
    document.getElementById('myplRepriceModal').classList.remove('hidden');
    const search = document.getElementById('mypl-reprice-search');
    search.value = '';
    search.focus();
    filterMyPriceListRepriceModal();
}

function closeMyPriceListRepriceModal() {
    myplRepriceTarget = null;
    document.getElementById('myplRepriceModal').classList.add('hidden');
}

function filterMyPriceListRepriceModal() {
    const list = document.getElementById('mypl-reprice-results');
    const query = document.getElementById('mypl-reprice-search').value;
    renderMyPriceListMatches(list, query, applyMyPriceListReprice);
}

function applyMyPriceListReprice(itemId) {
    if (!myplRepriceTarget) return;
    const { kind, idx } = myplRepriceTarget;
    const items = kind === 'ive' ? (invoiceEditState && invoiceEditState.items) : invoiceDraft;
    const row = items && items[idx];
    if (!row) { closeMyPriceListRepriceModal(); return; }

    const item = PRICE_CATALOG_BY_ID[itemId];
    row.description = item.label;
    row._mypl_item_id = itemId;
    row._mypl_base_qty = 1;
    row._mypl_extra_qty = 0;
    row._mypl_mohr_qty = 0;
    myplRecomputeRowPrice(row);

    closeMyPriceListRepriceModal();
    if (kind === 'ive') renderInvoiceEditRows(); else renderDraftRows();
}

// Picking an item adds a draft row linked to that catalog item
// (_mypl_item_id), starting at 1×base + 0×extra. If the item has a
// variable component (baseUnit and/or extra), renderDraftRows()/
// renderInvoiceEditRows() show live "تعداد ..." inputs under the row for
// each one -- see myplRowQtyControlsHtml() and myplRecomputeRowPrice(). A
// flat, no-extra item (the common case) just adds instantly, no further
// input needed.
function selectMyPriceListItem(instance, itemId) {
    const item = PRICE_CATALOG_BY_ID[itemId];
    const row = {
        description: item.label, quantity: 1, unit_price_toman: 0,
        _mypl_item_id: itemId, _mypl_base_qty: 1, _mypl_extra_qty: 0, _mypl_mohr_qty: 0,
    };
    myplRecomputeRowPrice(row);

    if (instance === 'ive') {
        if (!invoiceEditState) return;
        row.line_total_toman = 0;
        invoiceEditState.items.push(row);
        renderInvoiceEditRows();
    } else {
        row.job_id = null;
        row.sanam_document_id = null;
        invoiceDraft.push(row);
        renderDraftRows();
    }

    const { search } = myplDropdownIds(instance);
    const input = document.getElementById(search);
    if (input) input.value = '';
    closeMyPriceListDropdown(instance);
}

// Deliberately never re-renders the row list on a plain edit -- rebuilding
// box.innerHTML while the very input the translator is typing into is
// part of that HTML would drop keyboard focus after every single
// keystroke (there's no way to type a 2-digit number if the box vanishes
// out from under the cursor after the first digit). Instead this patches
// just the two numbers that can change -- the row's displayed price (for
// a نرخنامه-linked row, where price is computed rather than typed) and
// its line total -- directly in the existing DOM.
function updateDraftRow(idx, field, value) {
    const row = invoiceDraft[idx];
    if (!row) return;
    if (MYPL_QTY_FIELD_MAP[field]) {
        const qty = Math.max(0, parseInt(value, 10) || 0);
        row[MYPL_QTY_FIELD_MAP[field]] = qty;
        myplRecomputeRowPrice(row);
    } else if (field === 'description') {
        row.description = value;
    } else {
        row[field] = parseInt(value, 10) || 0;
    }

    const prefix = isProfilePageOpen() ? 'cp' : 'cd';
    const rowEl = document.getElementById(prefix + '-draft-rows').children[idx];
    if (rowEl) {
        const priceEl = rowEl.querySelector('.mypl-computed-price');
        if (priceEl) priceEl.textContent = row.unit_price_toman.toLocaleString();
        const totalEl = rowEl.querySelector('.draft-line-total');
        if (totalEl) totalEl.textContent = ((row.quantity || 0) * (row.unit_price_toman || 0)).toLocaleString();
    }
    updateDraftTotal();
}

function removeDraftRow(idx) {
    const removed = invoiceDraft[idx];
    invoiceDraft.splice(idx, 1);
    renderDraftRows();
    // Keep the activity list's checkbox in sync when a row checked in from
    // there gets removed via this button instead of unchecking it above.
    if (removed && removed._source_key) {
        const cb = document.querySelector(`input[data-activity-key="${CSS.escape(removed._source_key)}"]`);
        if (cb) cb.checked = false;
    }
}

function isProfilePageOpen() {
    const el = document.getElementById('clientProfilePage');
    return el && !el.classList.contains('hidden');
}

function updateDraftTotal() {
    const total = invoiceDraft.reduce((s, row) => s + (row.quantity || 0) * (row.unit_price_toman || 0), 0);
    const id = isProfilePageOpen() ? 'cp-draft-total' : 'cd-draft-total';
    const el = document.getElementById(id);
    if (el) el.textContent = total.toLocaleString();
}

function renderDraftRows() {
    const profileOpen = isProfilePageOpen();
    const prefix = profileOpen ? 'cp' : 'cd';
    const box = document.getElementById(prefix + '-draft-rows');
    const empty = document.getElementById(prefix + '-draft-empty');
    if (!box || !empty) return;
    empty.classList.toggle('hidden', invoiceDraft.length > 0);
    box.innerHTML = invoiceDraft.map((row, idx) => {
        const lineTotal = (row.quantity || 0) * (row.unit_price_toman || 0);
        // Same color as the source it came from in the activity list above
        // (amber for a row typed fresh, with no _source_key at all) -- so
        // the draft keeps showing the same category coding end to end.
        const dotColor = ACTIVITY_CATEGORY_COLORS[(row._source_key || '').split(':')[0]] || ACTIVITY_CATEGORY_COLORS.manual;
        // A نرخنامه-linked row's price is computed from its own quantity
        // inputs below (see myplRowQtyControlsHtml) -- shown, not typed.
        const priceField = row._mypl_item_id
            ? `<span class="mypl-computed-price auth-input en" dir="ltr" title="محاسبه‌شده از تعداد زیر" style="width:100px;padding:.4rem .6rem;font-size:.78rem;display:inline-flex;align-items:center;opacity:.75;">${row.unit_price_toman.toLocaleString()}</span>`
            : `<input type="number" value="${row.unit_price_toman}" title="قیمت واحد (تومان)" oninput="updateDraftRow(${idx},'unit_price_toman',this.value)" class="auth-input en" dir="ltr" style="width:100px;padding:.4rem .6rem;font-size:.78rem;">`;
        return `
        <div class="flex flex-wrap items-center gap-1.5 p-2 rounded-lg" style="background:var(--card-surface);border:1px solid var(--border-subtle);border-inline-start:3px solid ${dotColor};">
            <span style="width:8px;height:8px;border-radius:50%;background:${dotColor};display:inline-block;flex-shrink:0;"></span>
            <input type="text" value="${row.description.replace(/"/g,'&quot;')}" placeholder="شرح ردیف (مثلاً هزینه پیک)" oninput="updateDraftRow(${idx},'description',this.value)" class="auth-input flex-1" style="padding:.4rem .6rem;font-size:.78rem;">
            <input type="number" min="1" value="${row.quantity}" title="تعداد" oninput="updateDraftRow(${idx},'quantity',this.value)" class="auth-input en" dir="ltr" style="width:52px;padding:.4rem .4rem;font-size:.78rem;text-align:center;">
            <span class="text-[10px] shrink-0" style="color:var(--text-muted);">×</span>
            ${priceField}
            <span class="draft-line-total text-[11px] font-bold en shrink-0" style="width:95px;text-align:left;color:var(--accent);">${lineTotal.toLocaleString()}</span>
            ${myplRepriceButtonHtml('draft', idx, row)}
            <button onclick="removeDraftRow(${idx})" style="color:#f87171;background:none;border:none;cursor:pointer;font-weight:700;padding:0 .25rem;">✕</button>
            ${myplRowQtyControlsHtml(row, idx, 'updateDraftRow')}
        </div>`;
    }).join('');
    updateDraftTotal();
    updateActivityBulkBar();
}

async function submitDraftInvoice(invoiceType) {
    if (!currentClientDetailId) return;
    if (!invoiceDraft.length) { showToast('⚠️ حداقل یک ردیف به فاکتور اضافه کنید.'); return; }
    if (invoiceDraft.some(row => !row.description.trim())) { showToast('⚠️ شرح همه ردیف‌ها باید تکمیل شود.'); return; }

    const items = invoiceDraft.map(row => ({
        description: row.description,
        quantity: row.quantity || 1,
        line_total_toman: (row.quantity || 0) * (row.unit_price_toman || 0),
        job_id: row.job_id,
        sanam_document_id: row.sanam_document_id,
    }));

    const token = localStorage.getItem('deept_token');
    try {
        const res = await fetch(`${CORE}/invoices`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ client_id: currentClientDetailId, items, invoice_type: invoiceType })
        });
        if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e.detail || 'خطای سرور'); }
        const label = invoiceType === 'proforma' ? 'پیش‌فاکتور' : 'فاکتور';
        showToast(`✅ ${label}ی با ${items.length} ردیف ثبت شد.`);
        invoiceDraft = [];
        renderDraftRows();
        // Uncheck every activity-list checkbox now that the draft they
        // fed is gone -- no cached jobs/sanam data to re-render the list
        // properly from here, but this keeps it from lying about state.
        document.querySelectorAll('input[data-activity-key]').forEach(cb => { cb.checked = false; });
        await renderClientInvoices(currentClientDetailId);
    } catch (e) {
        showToast('❌ ثبت فاکتور ناموفق بود.');
    }
}

function closeClientDetailModal() {
    document.getElementById('clientDetailModal').classList.add('hidden');
    currentClientDetailId = null;
}

// ═══════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════
// JALALI (PERSIAN) CALENDAR PICKER — every date elsewhere in the app is
// shown in Persian (fa-IR), but a plain <input type="date"> only ever
// gives the browser's own native, Gregorian-first picker. This renders a
// real, clickable Jalali calendar the translator can pick a day from --
// currently used for a work order's مهلت (ددلاین). The value stored and
// sent to the backend stays a Gregorian ISO string throughout (work-orders
// due-date filtering in DeepT-Core compares these as plain strings), so
// only the *display* is Persian -- nothing downstream has to change.
// ═══════════════════════════════════════════════════════════════════════
const PERSIAN_MONTHS_FA = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
                            'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
const PERSIAN_WEEKDAYS_FA = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج']; // شنبه..جمعه, single-letter headers

function toPersianDigits(input) {
    const fa = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
    return String(input).replace(/[0-9]/g, d => fa[+d]);
}

// Civil-calendar conversion algorithm (the same one used by most Jalali
// date libraries) -- round-trips exactly for every date, leap years
// included, verified against known Nowruz dates (1403-1405).
function gregorianToJalali(gy, gm, gd) {
    const g_d_m = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
    const gy2 = (gm > 2) ? (gy + 1) : gy;
    let days = 355666 + (365 * gy) + Math.floor((gy2 + 3) / 4) - Math.floor((gy2 + 99) / 100)
        + Math.floor((gy2 + 399) / 400) + gd + g_d_m[gm - 1];
    let jy = -1595 + (33 * Math.floor(days / 12053));
    days %= 12053;
    jy += 4 * Math.floor(days / 1461);
    days %= 1461;
    if (days > 365) {
        jy += Math.floor((days - 1) / 365);
        days = (days - 1) % 365;
    }
    let jm, jd;
    if (days < 186) {
        jm = 1 + Math.floor(days / 31);
        jd = 1 + (days % 31);
    } else {
        jm = 7 + Math.floor((days - 186) / 30);
        jd = 1 + ((days - 186) % 30);
    }
    return [jy, jm, jd];
}

function jalaliToGregorian(jy, jm, jd) {
    jy += 1595;
    let days = -355668 + (365 * jy) + (Math.floor(jy / 33) * 8) + Math.floor(((jy % 33) + 3) / 4)
        + jd + ((jm < 7) ? (jm - 1) * 31 : ((jm - 7) * 30) + 186);
    let gy = 400 * Math.floor(days / 146097);
    days %= 146097;
    if (days > 36524) {
        gy += 100 * Math.floor(--days / 36524);
        days %= 36524;
        if (days >= 365) days++;
    }
    gy += 4 * Math.floor(days / 1461);
    days %= 1461;
    if (days > 365) {
        gy += Math.floor((days - 1) / 365);
        days = (days - 1) % 365;
    }
    const gd0 = days + 1;
    const sal_a = [0, 31, ((gy % 4 === 0 && gy % 100 !== 0) || (gy % 400 === 0)) ? 29 : 28,
        31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let gm = 0, gd = gd0;
    for (; gm < 13; gm++) {
        const v = sal_a[gm];
        if (gd <= v) break;
        gd -= v;
    }
    return [gy, gm, gd];
}

// Month 1-6 are always 31 days, 7-11 always 30 -- only month 12 (28/29
// days, esfand) varies by leap year. Rather than re-deriving the 33-year
// leap-year rule (easy to get subtly wrong), just measure this Jalali
// year's real length via the already-verified conversion above.
function jalaliYearLength(jy) {
    const [gy1, gm1, gd1] = jalaliToGregorian(jy, 1, 1);
    const [gy2, gm2, gd2] = jalaliToGregorian(jy + 1, 1, 1);
    return Math.round((Date.UTC(gy2, gm2 - 1, gd2) - Date.UTC(gy1, gm1 - 1, gd1)) / 86400000);
}

function jalaliMonthLength(jy, jm) {
    if (jm <= 6) return 31;
    if (jm <= 11) return 30;
    return jalaliYearLength(jy) - 336; // 336 = 6×31 + 5×30, the first 11 months
}

function formatIsoAsJalaliDisplay(iso) {
    if (!iso) return '';
    const [gy, gm, gd] = iso.split('-').map(Number);
    const [jy, jm, jd] = gregorianToJalali(gy, gm, gd);
    return `${toPersianDigits(jd)} ${PERSIAN_MONTHS_FA[jm - 1]} ${toPersianDigits(jy)}`;
}

let jalaliCalendarOpenFor = null;  // e.g. 'wo-due', or null when closed
let jalaliCalendarViewYear = null;
let jalaliCalendarViewMonth = null;

function toggleJalaliCalendar(baseId) {
    if (jalaliCalendarOpenFor === baseId) { closeJalaliCalendar(); return; }
    const popup = document.getElementById(baseId + '-calendar');
    const hidden = document.getElementById(baseId);
    if (!popup || !hidden) return;

    jalaliCalendarOpenFor = baseId;
    const today = new Date();
    if (hidden.value) {
        const [gy, gm, gd] = hidden.value.split('-').map(Number);
        [jalaliCalendarViewYear, jalaliCalendarViewMonth] = gregorianToJalali(gy, gm, gd);
    } else {
        [jalaliCalendarViewYear, jalaliCalendarViewMonth] =
            gregorianToJalali(today.getFullYear(), today.getMonth() + 1, today.getDate());
    }
    renderJalaliCalendar();
    popup.classList.remove('hidden');
}

function closeJalaliCalendar() {
    if (!jalaliCalendarOpenFor) return;
    document.getElementById(jalaliCalendarOpenFor + '-calendar')?.classList.add('hidden');
    jalaliCalendarOpenFor = null;
}

function jalaliCalendarShiftMonth(n) {
    jalaliCalendarViewMonth += n;
    if (jalaliCalendarViewMonth > 12) { jalaliCalendarViewMonth = 1; jalaliCalendarViewYear++; }
    if (jalaliCalendarViewMonth < 1) { jalaliCalendarViewMonth = 12; jalaliCalendarViewYear--; }
    renderJalaliCalendar();
}

function renderJalaliCalendar() {
    const baseId = jalaliCalendarOpenFor;
    if (!baseId) return;
    const popup = document.getElementById(baseId + '-calendar');
    const hidden = document.getElementById(baseId);
    if (!popup || !hidden) return;

    const jy = jalaliCalendarViewYear, jm = jalaliCalendarViewMonth;
    let selJ = null;
    if (hidden.value) {
        const [gy, gm, gd] = hidden.value.split('-').map(Number);
        selJ = gregorianToJalali(gy, gm, gd);
    }
    const today = new Date();
    const [ty, tm, td] = gregorianToJalali(today.getFullYear(), today.getMonth() + 1, today.getDate());

    const [gy1, gm1, gd1] = jalaliToGregorian(jy, jm, 1);
    const jsWeekday = new Date(gy1, gm1 - 1, gd1).getDay(); // JS: 0=Sun..6=Sat
    const startOffset = (jsWeekday + 1) % 7;                // shift so 0=Sat (شنبه)
    const monthLen = jalaliMonthLength(jy, jm);

    let cells = '';
    for (let i = 0; i < startOffset; i++) cells += `<div></div>`;
    for (let d = 1; d <= monthLen; d++) {
        const isSel = !!(selJ && selJ[0] === jy && selJ[1] === jm && selJ[2] === d);
        const isToday = ty === jy && tm === jm && td === d;
        cells += `<button type="button" onclick="selectJalaliDate('${baseId}',${jy},${jm},${d})"
            class="text-[11px] rounded-md py-1.5 en" style="
                background:${isSel ? 'var(--accent)' : 'transparent'};
                color:${isSel ? 'var(--btn-text-on-accent)' : (isToday ? 'var(--accent)' : 'var(--text-main)')};
                font-weight:${isSel || isToday ? '900' : '600'};
                border:${isToday && !isSel ? '1px solid var(--accent)' : '1px solid transparent'};
                cursor:pointer;">${toPersianDigits(d)}</button>`;
    }

    popup.innerHTML = `
        <div class="flex items-center justify-between mb-2">
            <button type="button" onclick="jalaliCalendarShiftMonth(-1)" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:.95rem;padding:0 .4rem;">‹</button>
            <span class="text-xs font-black" style="color:var(--text-main);">${PERSIAN_MONTHS_FA[jm - 1]} ${toPersianDigits(jy)}</span>
            <button type="button" onclick="jalaliCalendarShiftMonth(1)" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:.95rem;padding:0 .4rem;">›</button>
        </div>
        <div class="grid grid-cols-7 gap-0.5 mb-1">
            ${PERSIAN_WEEKDAYS_FA.map(w => `<div class="text-[10px] text-center font-bold" style="color:var(--text-muted);">${w}</div>`).join('')}
        </div>
        <div class="grid grid-cols-7 gap-0.5">${cells}</div>
        <div class="flex items-center justify-between mt-2 pt-2" style="border-top:1px solid var(--divider);">
            <button type="button" onclick="jalaliCalendarGoToday('${baseId}')" class="text-[10px] font-bold" style="background:none;border:none;color:var(--accent);cursor:pointer;">امروز</button>
            <button type="button" onclick="clearJalaliDate('${baseId}')" class="text-[10px] font-bold" style="background:none;border:none;color:#f87171;cursor:pointer;">پاک کردن</button>
        </div>`;
}

function selectJalaliDate(baseId, jy, jm, jd) {
    const [gy, gm, gd] = jalaliToGregorian(jy, jm, jd);
    const iso = `${gy}-${String(gm).padStart(2, '0')}-${String(gd).padStart(2, '0')}`;
    const hidden = document.getElementById(baseId);
    const display = document.getElementById(baseId + '-display');
    if (hidden) hidden.value = iso;
    if (display) display.value = formatIsoAsJalaliDisplay(iso);
    closeJalaliCalendar();
}

function clearJalaliDate(baseId) {
    const hidden = document.getElementById(baseId);
    const display = document.getElementById(baseId + '-display');
    if (hidden) hidden.value = '';
    if (display) display.value = '';
    closeJalaliCalendar();
}

function jalaliCalendarGoToday(baseId) {
    const today = new Date();
    const [jy, jm, jd] = gregorianToJalali(today.getFullYear(), today.getMonth() + 1, today.getDate());
    selectJalaliDate(baseId, jy, jm, jd);
}

document.addEventListener('click', (e) => {
    if (!jalaliCalendarOpenFor) return;
    const wrapper = document.getElementById(jalaliCalendarOpenFor + '-display')?.closest('.relative');
    if (wrapper && !wrapper.contains(e.target)) closeJalaliCalendar();
});

// WORK SCHEDULE / CALENDAR — weekly calendar of orders added from within a
// client's profile. Distinguishes سفارش های تاییدی from سفارش های مهر مترجم
// (type badges + filter) and surfaces deadlines so the translator stays on
// top of their schedule. Stored via DeepT-Core /work-orders (work_orders
// table).
// ═══════════════════════════════════════════════════════════════════════
const WORK_ORDER_TYPE_FA = {
    TAYIDI:        { text: 'تاییدی',     color: '#38bdf8' },
    MEHR_MOTARJEM: { text: 'مهر مترجم',  color: '#c084fc' },
};
const WORK_ORDER_STATUS_FA = {
    PENDING:   { text: 'در انتظار',  color: '#fbbf24' },
    DONE:      { text: 'انجام‌شده',    color: '#4ade80' },
    CANCELLED: { text: 'لغو شده',      color: '#f87171' },
};
const WEEKDAY_FA = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه'];

let workWeekStart = null;      // JS Date (Monday-based offset for Persian week)
let workOrderTypeFilter = null; // 'TAYIDI' | 'MEHR_MOTARJEM' | null = all
let workWeekOrders = [];       // orders for the visible week window
let workOrderEditingId = null; // id when editing, null when adding
let workOrderDraftType = 'MEHR_MOTARJEM';

/* ============ SECTION: WORK ORDERS, SCHEDULE & CALENDAR ============
   Persian-week helpers (startOfPersianWeek/fmtWeekISO) + order CRUD. ============ */
function getToken() { return localStorage.getItem('deept_token'); }

// ── Jalali (Persian/Shamsi) calendar conversion ────────────────────────
// JS Date has no native Jalali calendar support, and toLocaleDateString
// ('fa-IR', ...) only ever produces a Jalali-formatted TEXT LABEL -- it
// can't tell you which Gregorian dates are day 1..N of a given Jalali
// month, which any real "month view" grid needs to know. Rather than
// hand-implementing Jalali leap-year/month-length rules (easy to get
// subtly wrong), this leans on the same ICU Persian calendar the browser
// already uses for every fa-IR label in this app, in both directions:
// forward is a single direct lookup; reverse walks day-by-day from a
// close estimate until it matches (both calendars track the same real
// elapsed days, so this always converges, and it's only ever called a
// handful of times per calendar render/navigation).
const _JALALI_FMT = new Intl.DateTimeFormat('en-US-u-ca-persian', { year: 'numeric', month: 'numeric', day: 'numeric' });

function gregorianToJalali(date) {
    const parts = _JALALI_FMT.formatToParts(date);
    const get = (t) => parseInt(parts.find(p => p.type === t).value, 10);
    return { y: get('year'), m: get('month'), d: get('day') };
}

function jalaliToGregorian(jy, jm, jd) {
    const guess = new Date(jy + 621, 2, 15); // mid-March of the estimated Gregorian year -- always within ~2 weeks of Nowruz
    let g = gregorianToJalali(guess);
    while (g.y !== jy || g.m !== jm || g.d !== jd) {
        const cmp = (g.y - jy) || (g.m - jm) || (g.d - jd);
        guess.setDate(guess.getDate() + (cmp < 0 ? 1 : -1));
        g = gregorianToJalali(guess);
    }
    return guess;
}

// First/last Gregorian date of a given Jalali month -- the last day is
// found as "the day before the next Jalali month's 1st" rather than by
// computing the month's length directly, so this never needs to know
// Jalali leap-year rules (which years have a 30- vs 29-day Esfand) at all.
function jalaliMonthBounds(jy, jm) {
    const firstDay = jalaliToGregorian(jy, jm, 1);
    const nextJy = jm === 12 ? jy + 1 : jy;
    const nextJm = jm === 12 ? 1 : jm + 1;
    const lastDay = jalaliToGregorian(nextJy, nextJm, 1);
    lastDay.setDate(lastDay.getDate() - 1);
    return { firstDay, lastDay };
}

// ── Week navigation (Persian week: Saturday .. Friday) ────────────────
function startOfPersianWeek(d) {
    const date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    // JS getDay(): Sat=6, Sun=0, ... Fri=5. Persian week starts Saturday,
    // so the offset = (getDay() + 1) % 7 maps Sat->0, Sun->1, ... Fri->6.
    const offset = (date.getDay() + 1) % 7;
    date.setDate(date.getDate() - offset);
    return date;
}

function setWorkWeekToToday() {
    workWeekStart = startOfPersianWeek(new Date());
    renderWorkWeek();
}

function setWorkOrderTypeFilter(type) {
    workOrderTypeFilter = type;
    ['all', 'TAYIDI', 'MEHR_MOTARJEM'].forEach(t => {
        const el = document.getElementById('wft-' + t);
        if (!el) return;
        const active = (type === null && t === 'all') || type === t;
        if (t === 'all') {
            el.style.background = active ? 'var(--accent)' : 'var(--bg-main)';
            el.style.color = active ? 'var(--btn-text-on-accent)' : 'var(--text-main)';
            el.style.borderColor = 'var(--border-subtle)';
        } else {
            const color = WORK_ORDER_TYPE_FA[t].color;
            el.style.background = active ? color : 'var(--bg-main)';
            el.style.color = active ? '#000' : color;
            el.style.borderColor = color;
            el.style.fontWeight = active ? '900' : '700';
        }
    });
    renderWorkWeek();
}

function shiftWorkWeek(n) {
    if (!workWeekStart) workWeekStart = startOfPersianWeek(new Date());
    workWeekStart.setDate(workWeekStart.getDate() + n * 7);
    renderWorkWeek();
}

function fmtWeekISO(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

async function renderWorkWeek() {
    if (!currentClientDetailId) return;
    if (!workWeekStart) workWeekStart = startOfPersianWeek(new Date());

    const days = [];
    for (let i = 0; i < 7; i++) {
        const d = new Date(workWeekStart);
        d.setDate(workWeekStart.getDate() + i);
        days.push(d);
    }

    const fromISO = fmtWeekISO(days[0]);
    const toISO = fmtWeekISO(days[6]);

    // Label: e.g. "۱۴ آبان – ۲۰ آبان ۱۴۰۴"
    const startFmt = days[0].toLocaleDateString('fa-IR', { day: 'numeric', month: 'long', year: 'numeric' });
    const endFmt = days[6].toLocaleDateString('fa-IR', { day: 'numeric', month: 'long' });
    document.getElementById('workWeekLabel').textContent = `${startFmt} — ${endFmt}`;

    const grid = document.getElementById('workWeekGrid');
    grid.innerHTML = `<div class="text-xs text-center py-6" style="color:var(--text-muted);grid-column:1/-1;">در حال بارگذاری تقویم...</div>`;

    try {
        const url = new URL(`${CORE}/work-orders`);
        url.searchParams.set('client_id', currentClientDetailId);
        url.searchParams.set('from', fromISO);
        url.searchParams.set('to', toISO);
        if (workOrderTypeFilter) url.searchParams.set('order_type', workOrderTypeFilter);
        const res = await fetch(url, { headers: { 'Authorization': `Bearer ${getToken()}` } });
        if (!res.ok) throw new Error();
        workWeekOrders = await res.json();
    } catch (e) {
        workWeekOrders = [];
        grid.innerHTML = `<div class="text-xs text-center py-6" style="color:#f87171;grid-column:1/-1;">خطا در دریافت زمان‌بندی.
            <button onclick="renderWorkWeek()" class="block mx-auto mt-2 text-[11px] font-bold px-3 py-1 rounded-lg" style="background:var(--card-surface);color:var(--accent);border:1px solid var(--border-color);">🔄 تلاش مجدد</button>
        </div>`;
        return;
    }

    const today = startOfPersianWeek(new Date());
    today.setDate(today.getDate() + ((new Date().getDay() + 1) % 7)); // actual today

    const byDay = {};
    for (const o of workWeekOrders) byDay[o.due_date || ''] = (byDay[o.due_date || ''] || []).concat(o);

    grid.innerHTML = days.map((d, idx) => {
        const iso = fmtWeekISO(d);
        const isToday = fmtWeekISO(today) === iso;
        const orders = byDay[iso] || [];
        const pendingCount = orders.filter(o => o.status === 'PENDING').length;
        const overdue = orders.some(o =>
            o.status === 'PENDING' && o.due_date && o.due_date < fmtWeekISO(new Date()));

        const dayHeader = `
            <div class="flex items-center justify-between mb-1.5" style="padding-bottom:4px;border-bottom:1px solid var(--divider);">
                <span class="text-[11px] font-black" style="color:${isToday ? 'var(--accent)' : 'var(--text-main)'};">${WEEKDAY_FA[idx]}</span>
                <span class="text-[10px] en font-bold" style="color:${isToday ? 'var(--accent)' : 'var(--text-muted)'};">${gregorianToJalali(d).d}</span>
            </div>`;

        const ordersHtml = orders.length
            ? orders.map(o => {
                const t = WORK_ORDER_TYPE_FA[o.order_type] || { text: o.order_type, color: 'var(--accent)' };
                const s = WORK_ORDER_STATUS_FA[o.status] || { text: o.status, color: 'var(--text-muted)' };
                const done = o.status === 'DONE';
                return `
                  <div onclick="openWorkOrderEdit('${o.id}')" class="p-1.5 rounded-md text-[10px] cursor-pointer mb-1 hover:opacity-85" style="background:${(t.color) + '1a'};border:1px solid ${t.color}55;border-left:3px solid ${t.color};">
                    <div class="flex items-center justify-between gap-1">
                      <span class="font-bold truncate" style="color:${done ? 'var(--text-muted)' : 'var(--text-main)'};${done ? 'text-decoration:line-through;' : ''}">${escapeHtml(o.title || t.text)}</span>
                    </div>
                    <div class="flex items-center justify-between gap-1 mt-0.5" style="color:var(--text-muted);">
                      <span style="color:${t.color};">${t.text}</span>
                      <span class="en" style="color:${s.color};">${s.text}</span>
                    </div>
                  </div>`;
              }).join('')
            : `<div class="text-[10px] text-center py-2" style="color:var(--text-muted);">—</div>`;

        const deadlineHint = (overdue && pendingCount)
            ? `<div class="text-[9px] font-bold mt-1" style="color:#f87171;">⚠ ددلاین گذشته</div>`
            : '';

        return `
          <div class="p-1.5 rounded-lg" style="background:${isToday ? 'var(--accent-hover)' : 'var(--bg-main)'};border:1px solid ${isToday ? 'var(--border-color)' : 'var(--border-subtle)'};${overdue ? 'box-shadow:0 0 0 1px rgba(248,113,113,0.4);' : ''}">
            ${dayHeader}
            ${pendingCount ? `<div class="text-[9px] font-bold mb-1" style="color:var(--accent);"><span class="en">${pendingCount}</span> در انتظار</div>` : ''}
            ${deadlineHint}
            ${ordersHtml}
          </div>`;
    }).join('');
}

// ── Add / edit modal ────────────────────────────────────────────────────
function openWorkOrderModal() {
    if (!currentClientDetailId) return;
    workOrderEditingId = null;
    workOrderDraftType = 'MEHR_MOTARJEM';
    document.getElementById('wo-modal-title').textContent = '➕ افزودن سفارش کار';
    document.getElementById('wo-submit-btn').textContent = 'ثبت سفارش';
    document.getElementById('wo-title').value = '';
    document.getElementById('wo-due').value = '';
    document.getElementById('wo-due-display').value = '';
    document.getElementById('wo-notes').value = '';
    document.getElementById('wo-status').value = 'PENDING';
    document.getElementById('wo-status').disabled = true;
    document.getElementById('wo-delete-btn').classList.add('hidden');
    refreshWorkOrderTypeBtns();
    document.getElementById('workOrderModal').classList.remove('hidden');
}

function openWorkOrderEdit(orderId) {
    const o = (workWeekOrders || []).find(x => x.id === orderId);
    if (!o) return;
    workOrderEditingId = orderId;
    workOrderDraftType = o.order_type;
    document.getElementById('wo-modal-title').textContent = '✏️ ویرایش سفارش کار';
    document.getElementById('wo-submit-btn').textContent = 'ذخیره تغییرات';
    document.getElementById('wo-title').value = o.title || '';
    document.getElementById('wo-due').value = o.due_date || '';
    document.getElementById('wo-due-display').value = formatIsoAsJalaliDisplay(o.due_date || '');
    document.getElementById('wo-notes').value = o.notes || '';
    document.getElementById('wo-status').value = o.status || 'PENDING';
    document.getElementById('wo-status').disabled = false;
    document.getElementById('wo-delete-btn').classList.remove('hidden');
    refreshWorkOrderTypeBtns();
    document.getElementById('workOrderModal').classList.remove('hidden');
}

function closeWorkOrderModal() {
    document.getElementById('workOrderModal').classList.add('hidden');
    workOrderEditingId = null;
    closeJalaliCalendar();
}

function selectWorkOrderType(type) {
    workOrderDraftType = type;
    refreshWorkOrderTypeBtns();
}

function refreshWorkOrderTypeBtns() {
    ['TAYIDI', 'MEHR_MOTARJEM'].forEach(t => {
        const el = document.getElementById('wo-type-' + t);
        const active = workOrderDraftType === t;
        const color = WORK_ORDER_TYPE_FA[t].color;
        el.style.background = active ? color : 'var(--bg-main)';
        el.style.color = active ? '#000' : color;
        el.style.borderColor = color;
        el.style.fontWeight = '900';
    });
}

async function submitWorkOrder() {
    const payload = {
        client_id: currentClientDetailId,
        title: document.getElementById('wo-title').value.trim(),
        order_type: workOrderDraftType,
        due_date: document.getElementById('wo-due').value || null,
        notes: document.getElementById('wo-notes').value.trim() || null,
    };
    if (workOrderEditingId) {
        payload.status = document.getElementById('wo-status').value;
    }

    const url = workOrderEditingId
        ? `${CORE}/work-orders/${workOrderEditingId}`
        : `${CORE}/work-orders`;
    const method = workOrderEditingId ? 'PATCH' : 'POST';

    try {
        const res = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
            body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error();
        closeWorkOrderModal();
        showToast(workOrderEditingId ? 'سفارش به‌روزرسانی شد.' : 'سفارش به تقویم اضافه شد.');
        await renderWorkWeek();
    } catch (e) {
        showToast('خطا در ثبت سفارش.');
    }
}

async function deleteWorkOrder(orderId) {
    if (!orderId) return;
    if (!confirm('این سفارش حذف شود؟')) return;
    try {
        const res = await fetch(`${CORE}/work-orders/${orderId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${getToken()}` },
        });
        if (!res.ok) throw new Error();
        showToast('سفارش حذف شد.');
        await renderWorkWeek();
    } catch (e) {
        showToast('خطا در حذف سفارش.');
    }
}


// ---- moved from app.js (stage) lines 4035-4247 ----
// ── Open a client's full profile page ──────────────────────────────────
/* ============ SECTION: CLIENT PROFILE (CRM layout) ============
   Contact/passport, past jobs, Sanam docs, invoices + weekly calendar. ============ */
// The profile page has two tabs -- تقویم کاری gets a whole tab of its own
// (rather than sharing a cramped column with everything else) since a
// weekly grid needs real width to be readable; everything else (contact
// info, activity table, invoices) shares the "نمای کلی" tab.
function switchClientProfileTab(tab) {
    const isCalendar = tab === 'calendar';
    document.getElementById('cp-tab-overview').classList.toggle('hidden', isCalendar);
    document.getElementById('cp-tab-calendar').classList.toggle('hidden', !isCalendar);
    ['overview', 'calendar'].forEach(t => {
        const btn = document.getElementById('cp-tab-btn-' + t);
        if (!btn) return;
        const active = t === tab;
        btn.style.color = active ? 'var(--accent)' : 'var(--text-muted)';
        btn.style.borderBottomColor = active ? 'var(--accent)' : 'transparent';
    });
}

async function openClientProfile(clientId) {
    if (!currentUserSession) { openAuthModal(); return; }
    currentClientDetailId = clientId;
    invoiceDraft = [];
    showFullView('clientProfilePage');
    navigateTo('/clients/' + clientId);
    switchClientProfileTab('overview');

    const token = localStorage.getItem('deept_token');
    try {
        const res = await fetch(`${CORE}/clients/${clientId}`, { headers: { 'Authorization': `Bearer ${token}` } });
        if (!res.ok) throw new Error();
        const c = await res.json();

        document.getElementById('cp-name').textContent = `${c.first_name} ${c.last_name}`.trim() || '—';
        const faName = `${c.first_name_fa || ''} ${c.last_name_fa || ''}`.trim();
        const subParts = [];
        if (faName) subParts.push(`(${faName})`);
        if (c.father_name) subParts.push(`فرزند ${c.father_name}`);
        document.getElementById('cp-subtitle').textContent = subParts.join(' · ');
        document.getElementById('cp-last').textContent = c.last_name || '—';
        document.getElementById('cp-first').textContent = c.first_name || '—';
        document.getElementById('cp-first-fa').textContent = c.first_name_fa || '—';
        document.getElementById('cp-last-fa').textContent = c.last_name_fa || '—';
        document.getElementById('cp-father').textContent = c.father_name || '—';
        document.getElementById('cp-dob').textContent = c.date_of_birth || '—';
        document.getElementById('cp-national').textContent = c.national_id || '—';
        document.getElementById('cp-passport').textContent = c.passport_number || '—';
        document.getElementById('cp-nationality').textContent = c.nationality || '—';
        document.getElementById('cp-phone').textContent = c.phone || '—';
        document.getElementById('cp-email').textContent = c.email || '—';
        document.getElementById('cp-notes').value = c.notes || '';
        // target_language: null/undefined or anything other than the three
        // named languages falls back to the empty option, which means
        // English -- matches how DeepT-Core/Back-End treat a missing or
        // unrecognized value.
        const targetLangSel = document.getElementById('cp-target-lang');
        if (targetLangSel) {
            const validLangs = ['French', 'Italian', 'Spanish'];
            targetLangSel.value = validLangs.includes(c.target_language) ? c.target_language : '';
        }
        // cp-job-count's header was replaced by the combined activity
        // list's own count (cp-activity-count, set in renderClientActivityList).

        const related = c.related_persons || [];
        const relatedBox = document.getElementById('cp-related-list');
        relatedBox.innerHTML = !related.length
            ? `<div class="text-xs text-center py-3" style="color:var(--text-muted);">// نفر مرتبطی ثبت نشده</div>`
            : related.map(r => `
                <div class="flex items-center justify-between p-2.5 rounded-lg text-xs" style="background:var(--bg-main);border:1px solid var(--border-subtle);">
                    <span class="en" style="color:var(--text-main);">${escapeHtml(r.first_name)} ${escapeHtml(r.last_name)}</span>
                    <span class="flex items-center gap-2">
                        <span class="en" style="color:var(--text-muted);">کد ملی: ${escapeHtml(r.national_id) || '—'}</span>
                        <button onclick="removeRelatedPerson('${(r.national_id||'').replace(/'/g,"")}')" style="color:#f87171;background:none;border:none;cursor:pointer;font-weight:700;">حذف ✕</button>
                    </span>
                </div>`).join('');

        renderClientActivityList(c.jobs || [], c.sanam_documents || []);

        renderDraftRows();
        await renderClientInvoices(clientId);
        workWeekStart = startOfPersianWeek(new Date());
        setWorkOrderTypeFilter(null);
    } catch (e) {
        showToast('خطا در دریافت اطلاعات مشتری.');
    }
}

function closeClientProfilePage() {
    document.getElementById('clientProfilePage').classList.add('hidden');
    document.body.style.overflow = 'auto';
    currentClientDetailId = null;
    openClientsWorkspace(false);
}

// Removes a client entirely -- from the dashboard list's own 🗑 button, or
// from "🗑 حذف مشتری" on the open profile page itself. The backend blocks
// this once the client has any invoices (see DELETE /clients/{id}), since
// those are real financial records that must outlive the client they
// billed -- surfaced here as a plain error toast, not a silent no-op.
async function deleteClient(clientId) {
    if (!clientId) return;
    if (!confirm('این مشتری برای همیشه حذف شود؟ این کار قابل بازگشت نیست.')) return;

    const token = localStorage.getItem('deept_token');
    try {
        const res = await fetch(`${CORE}/clients/${clientId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` },
        });
        if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || 'خطای سرور'); }

        showToast('✅ مشتری حذف شد.');
        if (isProfilePageOpen() && currentClientDetailId === clientId) {
            closeClientProfilePage();
        } else {
            await renderDashboardClients('', true);
        }
    } catch (e) {
        showToast(`❌ ${e.message || 'حذف مشتری ناموفق بود.'}`);
    }
}

// Start a new project tied to the currently open client profile.
// Auto-populates the multi-passport list from what's already on file --
// the main contact plus any نفرات مرتبط (related persons, e.g. a spouse
// or child whose passport was confirmed alongside this client's on an
// earlier job) -- instead of making the translator re-upload passports
// DeepT already has. Mints a fresh session for each via the same
// /passport/confirm endpoint the manual upload flow uses (it only needs
// identity fields, not an actual image), so nothing downstream needs to
// know these came from a saved profile rather than a fresh scan. Every
// person added this way still shows up in the normal confirmed-passports
// list with its own remove button, so a translator can drop anyone not
// needed for this particular job before continuing.
async function openChatForClient() {
    if (!currentClientDetailId) return;
    selectedClientId = currentClientDetailId;
    mainContactClientId = currentClientDetailId;

    try {
        const token = localStorage.getItem('deept_token');
        const res = await fetch(`${CORE}/clients/${currentClientDetailId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
            const client = await res.json();
            const people = [client, ...(client.related_persons || [])];
            let addedCount = 0;
            for (const p of people) {
                if (!(p.first_name || '').trim() && !(p.last_name || '').trim()) continue;
                // Don't re-add someone already in the list (e.g. the
                // translator clicked "New Project" for this client twice).
                if (p.national_id && confirmedPassports.some(cp => cp.national_id === p.national_id)) continue;
                const first  = (p.first_name  || '').trim().toUpperCase();
                const last   = (p.last_name   || '').trim().toUpperCase();
                const father = (p.father_name || '').trim().toUpperCase();
                const dob    = (p.date_of_birth || '').trim();
                const national = (p.national_id || '').trim();
                try {
                    const r = await fetch(`${getActiveBackendOrigin()}/passport/confirm`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ first_name: first, last_name: last, father_name: father, date_of_birth: dob, national_id: national })
                    });
                    if (r.ok) {
                        const d = await r.json();
                        confirmedPassports.push({ session_id: d.session_id, first_name: first, last_name: last, father_name: father, date_of_birth: dob, national_id: national });
                        addedCount++;
                    }
                } catch (e) { /* one person's session failing shouldn't block the rest */ }
            }
            if (addedCount > 0) {
                updateClientBadge();
                showToast(addedCount > 1
                    ? `✅ اطلاعات ${addedCount} نفر از پروفایل این مشتری بارگذاری شد`
                    : `✅ اطلاعات مشتری از پروفایل بارگذاری شد`);
            }
        }
    } catch (e) { /* fall through -- worst case, translator uploads a passport manually as before */ }

    navigateTo('/new-project');
    // Force 'doctype': a document type still needs picking regardless of
    // whether identity info came pre-filled -- see openChatInterface()'s
    // forceStage doc comment.
    openChatInterface(false, 'doctype');
}

// ── Open the office-wide work schedule (monthly view by default, weekly
// as the alternate) ─────────────────────────────────────────────────────
let scheduleWeekStart = null;
let scheduleTypeFilter = null;
let scheduleWeekOrders = [];
let scheduleViewMode = 'month'; // 'month' (default) | 'week'

/* ============ SECTION: OFFICE WEEKLY SCHEDULE ============ */
function openWorkSchedulePage() {
    if (!currentUserSession) { openAuthModal(); return; }
    showFullView('workSchedulePage');
    navigateTo('/schedule');
    scheduleWeekStart = startOfPersianWeek(new Date());
    scheduleTypeFilter = null;
    scheduleViewMode = 'month';
    updateScheduleViewModeButtons();
    setScheduleTypeFilter(null); // also renders once, in the mode set above
}

function closeWorkSchedulePage() {
    document.getElementById('workSchedulePage').classList.add('hidden');
    document.body.style.overflow = 'auto';
    openWorkspaceDashboard(false);
}


// ---- moved from app.js (stage) lines 4355-5060 ----
// حضور غیاب پرسنل -- its own top-level page (see the header's "🕐 حضور
// غیاب پرسنل" button), not a settings card: staff roster management, a
// live "who's here right now" view, the full timesheet, and the clock
// in/out action itself all live together here. Office accounts only --
// an individual account has no staff to manage.
function openHrPage(pushHistory = true) {
    if (!currentUserSession) { openAuthModal(); return; }
    if (currentUserSession.type !== 'office') {
        showToast('این بخش فقط برای حساب‌های دارالترجمه (دفتر) در دسترس است.');
        return;
    }
    showFullView('hrPage');
    if (pushHistory) navigateTo('/hr');
    loadHrSettings();
}

function closeHrPage() {
    document.getElementById('hrPage').classList.add('hidden');
    document.body.style.overflow = 'auto';
    openWorkspaceDashboard(false);
}

// نرخنامه من -- its own top-level page (see the header's dedicated button),
// not a settings card, since it's a long, frequently-referenced list a
// translator jumps to directly while building an invoice.
function openMyPriceListPage(pushHistory = true) {
    if (!currentUserSession) { openAuthModal(); return; }
    showFullView('myPriceListPage');
    if (pushHistory) navigateTo('/price-list');
    loadMyPriceListCatalog();
}

function closeMyPriceListPage() {
    document.getElementById('myPriceListPage').classList.add('hidden');
    document.body.style.overflow = 'auto';
    openWorkspaceDashboard(false);
}

function setScheduleWeekToToday() {
    scheduleWeekStart = startOfPersianWeek(new Date());
    renderSchedule();
}

function shiftSchedulePeriod(n) {
    if (!scheduleWeekStart) scheduleWeekStart = startOfPersianWeek(new Date());
    if (scheduleViewMode === 'week') {
        scheduleWeekStart.setDate(scheduleWeekStart.getDate() + n * 7);
    } else {
        // Step by a real Jalali month, not a Gregorian one (setMonth()
        // would drift the displayed month out of sync with the label
        // within a step or two, since Jalali/Gregorian month boundaries
        // don't line up). Clamps the day-of-month to the target month's
        // actual length, same as JS Date's own end-of-month rollover
        // behavior for setMonth().
        const { y: jy, m: jm, d: jd } = gregorianToJalali(scheduleWeekStart);
        let newJy = jy, newJm = jm + n;
        while (newJm > 12) { newJm -= 12; newJy++; }
        while (newJm < 1) { newJm += 12; newJy--; }
        const { firstDay, lastDay } = jalaliMonthBounds(newJy, newJm);
        const monthLength = Math.round((lastDay - firstDay) / 86400000) + 1;
        scheduleWeekStart = jalaliToGregorian(newJy, newJm, Math.min(jd, monthLength));
    }
    renderSchedule();
}

function updateScheduleViewModeButtons() {
    ['month', 'week'].forEach(m => {
        const el = document.getElementById('sv-' + m);
        if (!el) return;
        const active = m === scheduleViewMode;
        el.style.background = active ? 'var(--accent)' : 'var(--bg-main)';
        el.style.color = active ? 'var(--btn-text-on-accent)' : 'var(--text-main)';
        el.style.borderColor = active ? 'transparent' : 'var(--border-subtle)';
    });
}

function setScheduleViewMode(mode) {
    scheduleViewMode = mode;
    updateScheduleViewModeButtons();
    renderSchedule();
}

function setScheduleTypeFilter(type) {
    scheduleTypeFilter = type;
    ['all', 'TAYIDI', 'MEHR_MOTARJEM'].forEach(t => {
        const el = document.getElementById('sf-' + t);
        if (!el) return;
        const active = (type === null && t === 'all') || type === t;
        if (t === 'all') {
            el.style.background = active ? 'var(--accent)' : 'var(--bg-main)';
            el.style.color = active ? 'var(--btn-text-on-accent)' : 'var(--text-main)';
            el.style.borderColor = active ? 'transparent' : 'var(--border-subtle)';
        } else {
            const color = WORK_ORDER_TYPE_FA[t].color;
            el.style.background = active ? color : 'var(--bg-main)';
            el.style.color = active ? '#000' : color;
            el.style.borderColor = color;
            el.style.fontWeight = active ? '900' : '700';
        }
    });
    renderSchedule();
}

function renderSchedule() {
    return scheduleViewMode === 'month' ? renderScheduleMonth() : renderScheduleWeekView();
}

// Shared by both views: fetches work orders for a date range, honoring
// the current scheduleTypeFilter -- the only thing that differs between
// the weekly and monthly view is which range gets passed in.
async function fetchScheduleOrders(fromISO, toISO) {
    const url = new URL(`${CORE}/work-orders`);
    url.searchParams.set('from', fromISO);
    url.searchParams.set('to', toISO);
    if (scheduleTypeFilter) url.searchParams.set('order_type', scheduleTypeFilter);
    const res = await fetch(url, { headers: { 'Authorization': `Bearer ${getToken()}` } });
    if (!res.ok) throw new Error();
    return res.json();
}

// Shared by both views: the flat chronological order list below the grid.
function renderScheduleOrderList(orders, emptyMessage) {
    const list = document.getElementById('scheduleOrderList');
    if (!orders.length) {
        list.innerHTML = `<div class="text-xs text-center py-4" style="color:var(--text-muted);">${emptyMessage}</div>`;
        return;
    }
    orders.sort((a, b) => (a.due_date || '').localeCompare(b.due_date || ''));
    list.innerHTML = orders.map(o => {
        const t = WORK_ORDER_TYPE_FA[o.order_type] || { text: o.order_type, color: 'var(--accent)' };
        const s = WORK_ORDER_STATUS_FA[o.status] || { text: o.status, color: 'var(--text-muted)' };
        return `
          <div class="flex items-center justify-between gap-3 p-2.5 rounded-lg text-xs" style="background:var(--bg-main);border:1px solid var(--border-subtle);">
            <div class="flex items-center gap-2 min-w-0">
              <span class="inline-block w-2.5 h-2.5 rounded-sm shrink-0" style="background:${t.color};"></span>
              <span class="font-bold en truncate" style="color:var(--text-main);">${escapeHtml(o.client_name || '')}${o.title ? ' — ' + escapeHtml(o.title) : ''}</span>
            </div>
            <div class="flex items-center gap-3 shrink-0">
              <span class="en font-bold" style="color:${o.due_date ? 'var(--accent)' : 'var(--text-muted)'};">${o.due_date || 'بدون ددلاین'}</span>
              <span style="color:${t.color};">${t.text}</span>
              <span class="en" style="color:${s.color};">${s.text}</span>
              ${o.client_id ? `<button onclick="openClientProfile('${o.client_id}')" class="text-[11px] font-bold px-2 py-1 rounded-md" style="background:var(--card-surface);color:var(--accent);border:1px solid var(--border-color);">مشتری</button>` : ''}
            </div>
          </div>`;
    }).join('');
}

async function renderScheduleWeekView() {
    const grid = document.getElementById('scheduleWeekGrid');
    const list = document.getElementById('scheduleOrderList');
    if (!grid || !list) return;
    if (!scheduleWeekStart) scheduleWeekStart = startOfPersianWeek(new Date());

    const days = [];
    for (let i = 0; i < 7; i++) {
        const d = new Date(scheduleWeekStart);
        d.setDate(scheduleWeekStart.getDate() + i);
        days.push(d);
    }
    const fromISO = fmtWeekISO(days[0]);
    const toISO = fmtWeekISO(days[6]);

    const startFmt = days[0].toLocaleDateString('fa-IR', { day: 'numeric', month: 'long', year: 'numeric' });
    const endFmt = days[6].toLocaleDateString('fa-IR', { day: 'numeric', month: 'long' });
    document.getElementById('scheduleWeekLabel').textContent = `${startFmt} — ${endFmt}`;
    document.getElementById('scheduleListHeading').textContent = '📋 سفارش‌های این هفته';

    grid.innerHTML = `<div class="text-xs text-center py-6" style="color:var(--text-muted);grid-column:1/-1;">در حال بارگذاری تقویم...</div>`;

    let orders = [];
    try {
        orders = await fetchScheduleOrders(fromISO, toISO);
    } catch (e) {
        grid.innerHTML = `<div class="text-xs text-center py-6" style="color:#f87171;grid-column:1/-1;">خطا در دریافت زمان‌بندی.
            <button onclick="renderScheduleWeekView()" class="block mx-auto mt-2 text-[11px] font-bold px-3 py-1 rounded-lg" style="background:var(--card-surface);color:var(--accent);border:1px solid var(--border-color);">🔄 تلاش مجدد</button>
        </div>`;
        list.innerHTML = '';
        return;
    }
    scheduleWeekOrders = orders;

    const todayISO = fmtWeekISO(new Date());
    const byDay = {};
    for (const o of orders) byDay[o.due_date || ''] = (byDay[o.due_date || ''] || []).concat(o);

    grid.innerHTML = days.map((d, idx) => {
        const iso = fmtWeekISO(d);
        const isToday = todayISO === iso;
        const dayOrders = byDay[iso] || [];
        const pendingCount = dayOrders.filter(o => o.status === 'PENDING').length;
        const overdue = dayOrders.some(o => o.status === 'PENDING' && o.due_date && o.due_date < todayISO);

        const itemsHtml = dayOrders.length
            ? dayOrders.map(o => {
                const t = WORK_ORDER_TYPE_FA[o.order_type] || { text: o.order_type, color: 'var(--accent)' };
                const s = WORK_ORDER_STATUS_FA[o.status] || { text: o.status, color: 'var(--text-muted)' };
                const done = o.status === 'DONE';
                const clickTarget = o.client_id
                    ? `onclick="openClientProfile('${o.client_id}')" title="باز کردن پروفایل مشتری"`
                    : '';
                return `
                  <div ${clickTarget} class="p-1.5 rounded-md text-[10px] cursor-pointer mb-1 hover:opacity-85" style="background:${(t.color) + '1a'};border:1px solid ${t.color}55;border-left:3px solid ${t.color};">
                    <div class="font-bold truncate" style="color:${done ? 'var(--text-muted)' : 'var(--text-main)'};${done ? 'text-decoration:line-through;' : ''}">${escapeHtml(o.client_name || '')}${o.title ? ' · ' + escapeHtml(o.title) : ''}</div>
                    <div class="flex items-center justify-between mt-0.5" style="color:var(--text-muted);">
                      <span style="color:${t.color};">${t.text}</span>
                      <span class="en" style="color:${s.color};">${s.text}</span>
                    </div>
                  </div>`;
              }).join('')
            : `<div class="text-[10px] text-center py-2" style="color:var(--text-muted);">—</div>`;

        return `
          <div class="p-1.5 rounded-lg" style="background:${isToday ? 'var(--accent-hover)' : 'var(--bg-main)'};border:1px solid ${isToday ? 'var(--border-color)' : 'var(--border-subtle)'};${overdue ? 'box-shadow:0 0 0 1px rgba(248,113,113,0.4);' : ''}">
            <div class="flex items-center justify-between mb-1.5" style="padding-bottom:4px;border-bottom:1px solid var(--divider);">
                <span class="text-[11px] font-black" style="color:${isToday ? 'var(--accent)' : 'var(--text-main)'};">${WEEKDAY_FA[idx]}</span>
                <span class="text-[10px] en font-bold" style="color:${isToday ? 'var(--accent)' : 'var(--text-muted)'};">${gregorianToJalali(d).d}</span>
            </div>
            ${pendingCount ? `<div class="text-[9px] font-bold mb-1" style="color:var(--accent);"><span class="en">${pendingCount}</span> در انتظار</div>` : ''}
            ${overdue ? `<div class="text-[9px] font-bold mb-1" style="color:#f87171;">⚠ ددلاین گذشته</div>` : ''}
            ${itemsHtml}
          </div>`;
    }).join('');

    renderScheduleOrderList(orders, '// در این هفته سفارشی ثبت نشده');
}

// Monthly grid (the default view): a full calendar month, Sat-first per
// WEEKDAY_FA/startOfPersianWeek's convention, including the leading/
// trailing days from adjacent months needed to fill out complete weeks
// (dimmed via `inMonth`) so every row has all 7 columns. Reuses the exact
// same #scheduleWeekGrid container as the weekly view (still a
// repeat(7,...) CSS grid either way) -- only the day-cell content differs,
// since a month cell has far less room per day than a week cell.
async function renderScheduleMonth() {
    const grid = document.getElementById('scheduleWeekGrid');
    const list = document.getElementById('scheduleOrderList');
    if (!grid || !list) return;
    if (!scheduleWeekStart) scheduleWeekStart = startOfPersianWeek(new Date());

    // The "month" here is the real Jalali month scheduleWeekStart falls in
    // -- NOT the Gregorian month of the same JS Date, which almost never
    // lines up with it (Jalali months start ~11 days into a Gregorian
    // month and have different lengths). jalaliMonthBounds() finds the
    // actual first/last Gregorian date of that Jalali month; the grid is
    // then padded out to full weeks the same way the week view already is.
    const { y: jy, m: jm } = gregorianToJalali(scheduleWeekStart);
    const { firstDay: monthFirstDay, lastDay: monthLastDay } = jalaliMonthBounds(jy, jm);
    const calStart = startOfPersianWeek(monthFirstDay);
    const calEnd = startOfPersianWeek(monthLastDay);
    calEnd.setDate(calEnd.getDate() + 6);

    const days = [];
    for (let d = new Date(calStart); d <= calEnd; d.setDate(d.getDate() + 1)) {
        days.push(new Date(d));
    }
    const fromISO = fmtWeekISO(days[0]);
    const toISO = fmtWeekISO(days[days.length - 1]);

    document.getElementById('scheduleWeekLabel').textContent =
        monthFirstDay.toLocaleDateString('fa-IR', { month: 'long', year: 'numeric' });
    document.getElementById('scheduleListHeading').textContent = '📋 سفارش‌های این ماه';

    grid.innerHTML = `<div class="text-xs text-center py-6" style="color:var(--text-muted);grid-column:1/-1;">در حال بارگذاری تقویم...</div>`;

    let orders = [];
    try {
        orders = await fetchScheduleOrders(fromISO, toISO);
    } catch (e) {
        grid.innerHTML = `<div class="text-xs text-center py-6" style="color:#f87171;grid-column:1/-1;">خطا در دریافت زمان‌بندی.
            <button onclick="renderScheduleMonth()" class="block mx-auto mt-2 text-[11px] font-bold px-3 py-1 rounded-lg" style="background:var(--card-surface);color:var(--accent);border:1px solid var(--border-color);">🔄 تلاش مجدد</button>
        </div>`;
        list.innerHTML = '';
        return;
    }
    scheduleWeekOrders = orders;

    const todayISO = fmtWeekISO(new Date());
    const byDay = {};
    for (const o of orders) byDay[o.due_date || ''] = (byDay[o.due_date || ''] || []).concat(o);

    const headerHtml = WEEKDAY_FA.map(w => `<div class="text-[10px] font-black text-center py-1" style="color:var(--text-muted);">${w}</div>`).join('');

    const cellsHtml = days.map(d => {
        const iso = fmtWeekISO(d);
        const isToday = todayISO === iso;
        const dJalali = gregorianToJalali(d);
        const inMonth = dJalali.y === jy && dJalali.m === jm;
        const dayOrders = byDay[iso] || [];
        const pendingCount = dayOrders.filter(o => o.status === 'PENDING').length;
        const overdue = dayOrders.some(o => o.status === 'PENDING' && o.due_date && o.due_date < todayISO);

        const itemsHtml = dayOrders.map(o => {
            const t = WORK_ORDER_TYPE_FA[o.order_type] || { text: o.order_type, color: 'var(--accent)' };
            const done = o.status === 'DONE';
            const clickTarget = o.client_id
                ? `onclick="openClientProfile('${o.client_id}')" title="باز کردن پروفایل مشتری"`
                : '';
            return `
              <div ${clickTarget} class="px-1 rounded text-[9px] cursor-pointer mb-0.5 truncate hover:opacity-85" style="background:${(t.color) + '1a'};border-inline-start:2px solid ${t.color};color:${done ? 'var(--text-muted)' : 'var(--text-main)'};${done ? 'text-decoration:line-through;' : ''}">${escapeHtml(o.client_name || o.title || '')}</div>`;
        }).join('');

        return `
          <div class="p-1 rounded-lg" style="min-height:64px;background:${isToday ? 'var(--accent-hover)' : 'var(--bg-main)'};border:1px solid ${isToday ? 'var(--border-color)' : 'var(--border-subtle)'};opacity:${inMonth ? '1' : '.45'};${overdue ? 'box-shadow:0 0 0 1px rgba(248,113,113,0.4);' : ''}">
            <div class="flex items-center justify-between mb-1">
              <span class="text-[10px] en font-bold" style="color:${isToday ? 'var(--accent)' : (inMonth ? 'var(--text-main)' : 'var(--text-muted)')};">${dJalali.d}</span>
              ${pendingCount ? `<span class="text-[8px] font-bold en" style="color:var(--accent);">${pendingCount}</span>` : ''}
            </div>
            ${itemsHtml}
          </div>`;
    }).join('');

    grid.innerHTML = headerHtml + cellsHtml;

    renderScheduleOrderList(orders, '// در این ماه سفارشی ثبت نشده');
}

// 
// ── Invoice view / print / email — a translator needs a signed paper copy
// for the client's file and often needs to email a copy too, not just see
// a row in a list. The browser's own print dialog doubles as the "PDF
// generator" (چاپ → ذخیره به‌عنوان PDF), so no server-side rendering is
// needed; #invoiceViewModal is the one thing left visible by the
// @media print rule above. ─────────────────────────────────────────────
let currentInvoiceView = null; // { id, client } — kept for the email prefill

const INVOICE_TYPE_LABELS_FA = { invoice: 'فاکتور', proforma: 'پیش‌فاکتور' };
let invoiceViewFinalized = false;     // whether it's been printed/emailed -- informational only, no longer a lock
let invoiceEditState = null;          // { items: [...], invoice_type } while editing
let invoiceEditType = 'invoice';

/* ============ SECTION: INVOICE VIEW / PRINT / EDIT / EMAIL ============
   Browser print-to-PDF is the 'PDF generator'; edit uses a JS row model. ============ */
async function openInvoiceView(invoiceId, autoEdit = false) {
    const token = localStorage.getItem('deept_token');
    try {
        const res = await fetch(`${CORE}/invoices/${invoiceId}`, { headers: { 'Authorization': `Bearer ${token}` } });
        if (!res.ok) throw new Error();
        const inv = await res.json();
        currentInvoiceView = { id: inv.id, client: inv.client || {} };
        invoiceViewFinalized = !!inv.finalized_at;
        invoiceEditState = null;

        // This invoice goes to the *translator's own client* (b2b) -- it
        // must read as coming from their دارالترجمه, never from DeepT.
        const issuer = inv.issuer || {};
        document.getElementById('iv-issuer-name').textContent = issuer.office_name || issuer.full_name || 'دفتر ترجمه رسمی';
        document.getElementById('iv-type-badge').textContent = INVOICE_TYPE_LABELS_FA[inv.invoice_type] || 'فاکتور';
        // issue_date_shamsi is computed server-side (and, for a Sanam-
        // imported invoice, passed through as-is since it's already a
        // Shamsi date from the judiciary's own export) -- see Core's
        // invoices.py _display_date().
        document.getElementById('iv-date').textContent = inv.issue_date_shamsi || '—';

        const clientName = `${inv.client?.first_name || ''} ${inv.client?.last_name || ''}`.trim();
        document.getElementById('iv-client-name').textContent = clientName || '—';
        document.getElementById('iv-client-national').textContent = inv.client?.national_id || '—';

        document.getElementById('iv-items').innerHTML = (inv.items || []).map(it => `
            <tr>
                <td class="p-2" style="border:1px solid var(--border-subtle);color:var(--text-main);">${escapeHtml(it.description)}</td>
                <td class="p-2 text-center en" style="border:1px solid var(--border-subtle);color:var(--text-main);">${it.quantity}</td>
                <td class="p-2 text-center en" style="border:1px solid var(--border-subtle);color:var(--text-main);">${(it.line_total_toman / (it.quantity || 1)).toLocaleString()}</td>
                <td class="p-2 text-center en font-bold" style="border:1px solid var(--border-subtle);color:var(--text-main);">${it.line_total_toman.toLocaleString()}</td>
            </tr>`).join('');
        document.getElementById('iv-total').textContent = `${(inv.total_toman || 0).toLocaleString()} تومان`;

        document.getElementById('iv-email-row').classList.add('hidden');
        document.getElementById('iv-email-row').classList.remove('flex');
        document.getElementById('iv-email-input').value = inv.client?.email || '';
        document.getElementById('iv-email-status').classList.add('hidden');

        document.getElementById('iv-edit-editor').classList.add('hidden');
        // Editing is always allowed now, regardless of finalized_at (see
        // startInvoiceEdit's comment) -- always show the real edit button.
        const editBtn = document.getElementById('iv-edit-btn');
        editBtn.classList.remove('hidden');
        editBtn.textContent = '✏️ ویرایش فاکتور';
        editBtn.style.color = 'var(--accent)';

        document.getElementById('invoiceViewModal').classList.remove('hidden');
        if (autoEdit) startInvoiceEdit();
    } catch (e) {
        showToast('خطا در دریافت فاکتور.');
    }
}

function closeInvoiceViewModal() {
    document.getElementById('invoiceViewModal').classList.add('hidden');
    currentInvoiceView = null;
}

async function printInvoiceView() {
    // Printing counts as issuing the invoice, so lock it (finalize) before
    // the sheet is sent to the printer -- after this it can no longer be edited.
    if (!invoiceViewFinalized && currentInvoiceView) {
        try {
            const res = await fetch(`${CORE}/invoices/${currentInvoiceView.id}/finalize`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${getToken()}` }
            });
            if (res.ok) { invoiceViewFinalized = true; await renderClientInvoices(currentClientDetailId); }
        } catch (e) {}
    }
    window.print();
}

function toggleInvoiceEmailRow() {
    const row = document.getElementById('iv-email-row');
    row.classList.toggle('hidden');
    row.classList.toggle('flex');
}

// ── Invoice editing (allowed only while not finalized) ───────────────────
function startInvoiceEdit() {
    // Editing used to be blocked once invoiceViewFinalized was set (printed
    // or emailed) -- that lock was removed at the translator's request;
    // finalized_at is tracked purely as an informational "was this ever
    // sent" marker now (see the "✓ ارسال‌شده" badge in renderClientInvoices).
    if (!currentInvoiceView) return;
    if (invoiceEditState) return;
    const rowsEl = document.getElementById('iv-items');
    const items = Array.from(rowsEl.querySelectorAll('tr')).map(tr => {
        const cells = tr.querySelectorAll('td');
        const desc = cells[0]?.textContent || '';
        const qty = parseInt(cells[1]?.textContent, 10) || 1;
        const unit = parseInt(cells[2]?.textContent.replace(/[^\d]/g, ''), 10) || 0;
        const line = parseInt(cells[3]?.textContent.replace(/[^\d]/g, ''), 10) || 0;
        return { description: desc, quantity: qty, unit_price_toman: unit, line_total_toman: line };
    });
    invoiceEditState = { items: items.map(i => ({
        description: i.description,
        quantity: i.quantity,
        unit_price_toman: i.unit_price_toman,
        line_total_toman: (i.quantity || 1) * (i.unit_price_toman || 0),
    })) };
    invoiceEditType = (document.getElementById('iv-type-badge').textContent === 'پیش‌فاکتور') ? 'proforma' : 'invoice';
    refreshInvoiceEditTypeBtns();
    renderInvoiceEditRows();
    document.getElementById('iv-edit-editor').classList.remove('hidden');
    document.getElementById('iv-edit-btn').classList.add('hidden');
}

function refreshInvoiceEditTypeBtns() {
    ['invoice', 'proforma'].forEach(t => {
        const el = document.getElementById('ive-type-' + t);
        const active = invoiceEditType === t;
        el.style.background = active ? 'var(--accent)' : 'var(--bg-main)';
        el.style.color = active ? 'var(--btn-text-on-accent)' : 'var(--text-muted)';
        el.style.borderColor = active ? 'transparent' : 'var(--border-subtle)';
    });
}

function setInvoiceEditType(t) {
    invoiceEditType = t;
    refreshInvoiceEditTypeBtns();
}

function renderInvoiceEditRows() {
    if (!invoiceEditState) return;
    const box = document.getElementById('ive-rows');
    box.innerHTML = invoiceEditState.items.map((row, idx) => {
        const lineTotal = (row.quantity || 1) * (row.unit_price_toman || 0);
        row.line_total_toman = lineTotal;
        // A نرخنامه-linked row's price is computed from its own quantity
        // inputs below (see myplRowQtyControlsHtml) -- shown, not typed.
        const priceField = row._mypl_item_id
            ? `<span class="mypl-computed-price auth-input en" dir="ltr" title="محاسبه‌شده از تعداد زیر" style="width:100px;padding:.4rem .6rem;font-size:.78rem;display:inline-flex;align-items:center;opacity:.75;">${row.unit_price_toman.toLocaleString()}</span>`
            : `<input type="number" value="${row.unit_price_toman}" oninput="updateInvoiceEditRow(${idx},'unit_price_toman',this.value)" class="auth-input en" dir="ltr" style="width:100px;padding:.4rem .6rem;font-size:.78rem;">`;
        return `
        <div class="flex flex-wrap items-center gap-1.5 p-2 rounded-lg" style="background:var(--bg-main);border:1px solid var(--border-subtle);">
            <input type="text" value="${row.description.replace(/"/g,'&quot;')}" oninput="updateInvoiceEditRow(${idx},'description',this.value)" class="auth-input flex-1" style="padding:.4rem .6rem;font-size:.78rem;">
            <input type="number" min="1" value="${row.quantity}" oninput="updateInvoiceEditRow(${idx},'quantity',this.value)" class="auth-input en" dir="ltr" style="width:52px;padding:.4rem .4rem;font-size:.78rem;text-align:center;">
            <span class="text-[10px] shrink-0" style="color:var(--text-muted);">×</span>
            ${priceField}
            <span class="ive-line-total text-[11px] font-bold en shrink-0" style="width:92px;text-align:left;color:var(--accent);">${lineTotal.toLocaleString()}</span>
            ${myplRepriceButtonHtml('ive', idx, row)}
            <button onclick="removeInvoiceEditRow(${idx})" style="color:#f87171;background:none;border:none;cursor:pointer;font-weight:700;padding:0 .25rem;">✕</button>
            ${myplRowQtyControlsHtml(row, idx, 'updateInvoiceEditRow')}
        </div>`;
    }).join('');
    updateInvoiceEditTotal();
}

// Same "never re-render the list mid-edit" reasoning as updateDraftRow()
// above -- rebuilding ive-rows while its own input is focused would drop
// keyboard focus after every keystroke.
function updateInvoiceEditRow(idx, field, value) {
    if (!invoiceEditState || !invoiceEditState.items[idx]) return;
    const row = invoiceEditState.items[idx];
    if (MYPL_QTY_FIELD_MAP[field]) {
        const qty = Math.max(0, parseInt(value, 10) || 0);
        row[MYPL_QTY_FIELD_MAP[field]] = qty;
        myplRecomputeRowPrice(row);
    } else if (field === 'description') row.description = value;
    else if (field === 'quantity') row.quantity = parseInt(value, 10) || 1;
    else if (field === 'unit_price_toman') row.unit_price_toman = parseInt(value, 10) || 0;

    row.line_total_toman = (row.quantity || 1) * (row.unit_price_toman || 0);
    const rowEl = document.getElementById('ive-rows').children[idx];
    const priceEl = rowEl.querySelector('.mypl-computed-price');
    if (priceEl) priceEl.textContent = row.unit_price_toman.toLocaleString();
    rowEl.querySelector('.ive-line-total').textContent = row.line_total_toman.toLocaleString();
    updateInvoiceEditTotal();
}

function removeInvoiceEditRow(idx) {
    if (!invoiceEditState) return;
    invoiceEditState.items.splice(idx, 1);
    renderInvoiceEditRows();
}

function addInvoiceEditRow() {
    if (!invoiceEditState) return;
    invoiceEditState.items.push({ description: '', quantity: 1, unit_price_toman: 0, line_total_toman: 0 });
    renderInvoiceEditRows();
}

function updateInvoiceEditTotal() {
    if (!invoiceEditState) return;
    const total = invoiceEditState.items.reduce((s, r) => s + ((r.quantity || 1) * (r.unit_price_toman || 0)), 0);
    document.getElementById('ive-total').textContent = total.toLocaleString();
}

function cancelInvoiceEdit() {
    invoiceEditState = null;
    document.getElementById('iv-edit-editor').classList.add('hidden');
    const editBtn = document.getElementById('iv-edit-btn');
    editBtn.classList.remove('hidden');
}

async function saveInvoiceEdit() {
    if (!invoiceEditState || !currentInvoiceView) return;
    if (!invoiceEditState.items.length) { showToast('⚠️ حداقل یک ردیف لازم است.'); return; }
    if (invoiceEditState.items.some(r => !r.description.trim())) { showToast('⚠️ شرح همه ردیف‌ها باید تکمیل شود.'); return; }
    const btn = document.getElementById('ive-save-btn');
    btn.disabled = true;
    btn.textContent = 'در حال ذخیره...';
    const token = localStorage.getItem('deept_token');
    try {
        const body = {
            items: invoiceEditState.items.map(r => ({
                description: r.description,
                quantity: r.quantity || 1,
                line_total_toman: (r.quantity || 1) * (r.unit_price_toman || 0),
            })),
            invoice_type: invoiceEditType,
        };
        const res = await fetch(`${CORE}/invoices/${currentInvoiceView.id}`, {
            method: 'PATCH',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.detail || 'خطای سرور');
        showToast('✅ تغییرات فاکتور ذخیره شد.');
        invoiceEditState = null;
        document.getElementById('iv-edit-editor').classList.add('hidden');
        const editBtn = document.getElementById('iv-edit-btn');
        editBtn.classList.remove('hidden');
        editBtn.textContent = '✏️ ویرایش فاکتور';
        await openInvoiceView(currentInvoiceView.id);
        await renderClientInvoices(currentClientDetailId);
    } catch (e) {
        showToast(`❌ ${e.message || 'ذخیره ناموفق بود.'}`);
    } finally {
        btn.disabled = false;
        btn.textContent = 'ذخیره تغییرات';
    }
}

async function submitInvoiceEmail() {
    if (!currentInvoiceView) return;
    const toEmail = document.getElementById('iv-email-input').value.trim();
    const status = document.getElementById('iv-email-status');
    const btn = document.getElementById('iv-email-submit');
    status.classList.remove('hidden');
    status.style.color = 'var(--text-muted)';
    status.textContent = 'در حال ارسال...';
    btn.disabled = true;

    const token = localStorage.getItem('deept_token');
    try {
        const res = await fetch(`${CORE}/invoices/${currentInvoiceView.id}/email`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(toEmail ? { to_email: toEmail } : {})
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.detail || 'خطای سرور');
        status.style.color = 'var(--accent)';
        status.textContent = `✅ فاکتور به ${data.to_email} ارسال شد.`;
    } catch (e) {
        status.style.color = '#f87171';
        status.textContent = `❌ ${e.message || 'ارسال ایمیل ناموفق بود.'}`;
    } finally {
        btn.disabled = false;
    }
}

async function saveClientNotes() {
    if (!currentClientDetailId) return;
    const notesId = isProfilePageOpen() ? 'cp-notes' : 'cd-notes';
    const notesEl = document.getElementById(notesId);
    if (!notesEl) return;
    const token = localStorage.getItem('deept_token');
    try {
        const res = await fetch(`${CORE}/clients/${currentClientDetailId}`, {
            method: 'PATCH',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ notes: notesEl.value })
        });
        if (!res.ok) throw new Error();
        showToast('✅ یادداشت ذخیره شد.');
    } catch (e) {
        showToast('خطا در ذخیره یادداشت.');
    }
}

// Per-client "translate into this language instead of English" setting
// (DeepT-Core's `target_language` field on the client record, read by
// DeepT-Back-End when it runs a translation). Saved immediately on change,
// same as other single-field edits on this page -- no separate save button
// needed for a dropdown.
async function saveClientTargetLanguage() {
    if (!currentClientDetailId) return;
    const sel = document.getElementById('cp-target-lang');
    if (!sel) return;
    const token = localStorage.getItem('deept_token');
    try {
        const res = await fetch(`${CORE}/clients/${currentClientDetailId}`, {
            method: 'PATCH',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ target_language: sel.value || null })
        });
        if (!res.ok) throw new Error();
        showToast('✅ زبان مقصد ترجمه ذخیره شد.');
    } catch (e) {
        showToast('خطا در ذخیره زبان مقصد ترجمه.');
    }
}

async function removeRelatedPerson(nationalId) {
    if (!currentClientDetailId) return;
    const token = localStorage.getItem('deept_token');
    try {
        const res = await fetch(`${CORE}/clients/${currentClientDetailId}/related/${nationalId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) throw new Error();
        showToast('✅ نفر مرتبط حذف شد.');
        if (isProfilePageOpen()) {
            await openClientProfile(currentClientDetailId);
        } else {
            await openClientDetail(currentClientDetailId);
        }
    } catch (e) {
        showToast('خطا در حذف نفر مرتبط.');
    }
}

// ── Sanam bulk import ─────────────────────────────────────────────────────────
/* ============ SECTION: SANAM IMPORT + FILE JOBS ============
   .xlsx bulk import (invoices/import-sanam) + job-result download. ============ */
async function handleSanamFileSelected(file) {
    if (!file) return;
    const btn    = document.getElementById('sanamUploadBtn');
    const status = document.getElementById('sanamImportStatus');
    btn.disabled = true;
    btn.textContent = 'در حال پردازش فایل...';
    status.classList.remove('hidden');
    status.style.color = 'var(--text-muted)';
    status.textContent = 'در حال بارگذاری و بررسی فایل سنام...';

    const fd = new FormData();
    fd.append('file', file);
    const token = localStorage.getItem('deept_token');

    try {
        const res = await fetch(`${CORE}/invoices/import-sanam`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: fd
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.detail || 'خطای سرور');

        const errors = data.errors || [];
        status.style.color = errors.length ? '#fb923c' : 'var(--accent)';
        status.textContent =
            `${errors.length ? '⚠️' : '✅'} ${data.clients_touched} مشتری ثبت/به‌روزرسانی شد — ` +
            `${data.documents_created} کار جدید به پروفایل مشتریان اضافه شد` +
            (data.documents_skipped_already_imported ? ` (${data.documents_skipped_already_imported} مورد قبلاً وارد شده بود و رد شد)` : '') +
            (errors.length ? ` — ${errors.length} ردیف رد شد: ${errors.map(e => `شماره تمبر ${e.stamp_number} (${e.reason})`).join('، ')}` : '') +
            ' — برای صدور فاکتور، از پروفایل هر مشتری موارد موردنظر را انتخاب کنید.';
        renderDashboardClients('', true);
    } catch (err) {
        status.style.color = '#f87171';
        status.textContent = `❌ ${err.message || 'بارگذاری فایل سنام ناموفق بود.'}`;
    } finally {
        btn.disabled = false;
        btn.textContent = 'انتخاب فایل اکسل...';
        document.getElementById('sanamFileInput').value = '';
    }
}


// ---- moved from app.js (stage) lines 5735-5845 ----
// ── Add a client directly from the Clients section — no passport upload or
// job needed, for a walk-in whose documents haven't come through DeepT yet. ──
let clientEditingId = null;

function openAddClientModal() {
    clientEditingId = null;
    ['ac-first','ac-last','ac-first-fa','ac-last-fa','ac-national','ac-father','ac-dob','ac-phone','ac-email','ac-passport','ac-nationality','ac-notes','ac-target-lang']
        .forEach(id => document.getElementById(id).value = '');
    document.getElementById('ac-submit-btn').textContent = 'افزودن مشتری';
    document.querySelector('#addClientModal h3').textContent = '➕ افزودن مشتری جدید';
    document.getElementById('addClientModal').classList.remove('hidden');
}

async function openAddClientModalForEdit() {
    if (!currentClientDetailId) return;
    const token = localStorage.getItem('deept_token');
    try {
        const res = await fetch(`${CORE}/clients/${currentClientDetailId}`, { headers: { 'Authorization': `Bearer ${token}` } });
        if (!res.ok) throw new Error();
        const c = await res.json();
        clientEditingId = currentClientDetailId;
        document.getElementById('ac-first').value = c.first_name || '';
        document.getElementById('ac-last').value = c.last_name || '';
        document.getElementById('ac-first-fa').value = c.first_name_fa || '';
        document.getElementById('ac-last-fa').value = c.last_name_fa || '';
        document.getElementById('ac-national').value = c.national_id || '';
        document.getElementById('ac-father').value = c.father_name || '';
        document.getElementById('ac-dob').value = c.date_of_birth || '';
        document.getElementById('ac-phone').value = c.phone || '';
        document.getElementById('ac-email').value = c.email || '';
        document.getElementById('ac-passport').value = c.passport_number || '';
        document.getElementById('ac-nationality').value = c.nationality || '';
        document.getElementById('ac-notes').value = c.notes || '';
        const acTargetLangSel = document.getElementById('ac-target-lang');
        if (acTargetLangSel) {
            const validLangs = ['French', 'Italian', 'Spanish'];
            acTargetLangSel.value = validLangs.includes(c.target_language) ? c.target_language : '';
        }
        document.getElementById('ac-submit-btn').textContent = 'ذخیره تغییرات';
        document.querySelector('#addClientModal h3').textContent = '✏️ ویرایش مشتری';
        document.getElementById('addClientModal').classList.remove('hidden');
    } catch (e) {
        showToast('خطا در دریافت اطلاعات مشتری.');
    }
}

function closeAddClientModal() {
    document.getElementById('addClientModal').classList.add('hidden');
}

async function submitAddClient() {
    const first = document.getElementById('ac-first').value.trim().toUpperCase();
    const last  = document.getElementById('ac-last').value.trim().toUpperCase();
    const nationalId = document.getElementById('ac-national').value.trim();

    if (!first || !last) { showToast('⚠️ نام و نام خانوادگی الزامی است.'); return; }
    if (!nationalId) {
        showToast('⚠️ کد ملی الزامی است — شناسه اصلی مشتری برای جلوگیری از ثبت تکراری است.');
        document.getElementById('ac-national').focus();
        return;
    }

    const btn = document.getElementById('ac-submit-btn');
    btn.disabled = true;
    btn.textContent = 'در حال افزودن...';
    const token = localStorage.getItem('deept_token');
    const payload = {
        first_name:  first,
        last_name:   last,
        first_name_fa: document.getElementById('ac-first-fa').value.trim(),
        last_name_fa:  document.getElementById('ac-last-fa').value.trim(),
        national_id: nationalId,
        father_name:   document.getElementById('ac-father').value.trim().toUpperCase(),
        date_of_birth: document.getElementById('ac-dob').value.trim(),
        phone:           document.getElementById('ac-phone').value.trim()       || null,
        email:           document.getElementById('ac-email').value.trim()       || null,
        passport_number: document.getElementById('ac-passport').value.trim()    || null,
        nationality:     document.getElementById('ac-nationality').value.trim() || null,
        notes:           document.getElementById('ac-notes').value.trim()       || null,
        target_language: document.getElementById('ac-target-lang').value        || null,
    };
    try {
        const res = clientEditingId
            ? await fetch(`${CORE}/clients/${clientEditingId}`, {
                method: 'PATCH',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            })
            : await fetch(`${CORE}/clients`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e.detail || 'خطای سرور'); }
        closeAddClientModal();
        showToast(clientEditingId ? '✅ تغییرات ذخیره شد.' : '✅ مشتری افزوده شد.');
        const savedId = clientEditingId || (await res.json().catch(()=>({}))).id;
        clientEditingId = null;
        renderDashboardClients('', true);
        if (currentUserSession && isProfilePageOpen() && savedId) {
            await openClientProfile(savedId);
        } else if (currentUserSession && savedId) {
            await openClientDetail(savedId);
        }
    } catch (e) {
        showToast(`❌ ${e.message || 'ذخیره ناموفق بود.'}`);
    } finally {
        btn.disabled = false;
        btn.textContent = clientEditingId ? 'ذخیره تغییرات' : 'افزودن مشتری';
    }
}
