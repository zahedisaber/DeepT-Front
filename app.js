/* ========================================================================
   DeepT front-end application logic (app.js)
   ------------------------------------------------------------------------
   FEATURES: auth (DeepT-Core), passport extraction, document translation
   pipeline, dashboard / clients / work-orders / schedule / settings / invoice
   / client-profile / admin-CRM, Sanam import, wallet+Shaparak, date tool,
   quick-start (no-signup), SPA routing (404.html redirect -> applyRouteForPath).

   INTEGRATION CONTRACTS (do not change without a matching backend change):
     CORE            -> https://core.deept.ir  (auth/wallet/jobs/clients/invoices)
     BACKEND         -> https://backend.deept.ir (translation + passport)
     X-Service-Secret -> INTERNAL_SERVICE_SECRET (service-to-service, BackEnd side)
   State is persisted in localStorage under the deept_* keys (see SESSION section).
/* ============ CONFIGURATION & BACKEND ENDPOINTS ============ Core = auth/wallet/jobs/clients/invoices; BackEnd = translation + passport.
   QS_* point at a legacy quick-start server override; getActiveBackendOrigin()
   is the live switch. ============ */
// const CORE    = 'http://127.0.0.1:8001';
// const BACKEND = 'http://127.0.0.1:8000';

const CORE    = 'https://core.deept.ir';
const BACKEND = 'https://backend.deept.ir';

// ═══════════════════════════════════════════════════════════
// DOCUMENT REGISTRY
// To add a new document type: add one entry here. Nothing else changes.
// Fields:
//   label    → Persian name shown in dropdown
//   endpoint → full backend URL for this document type
//   active   → false shows as "به زودی" and is disabled
//   usePassportSession → true means session_id is sent with the request
// ═══════════════════════════════════════════════════════════
const DOCUMENT_REGISTRY = {
    'police-certificate': {
        label:               'گواهی عدم سوء پیشینه',
        endpoint: `${BACKEND}/api/translate/police-certificate`,
        active:              true,
        usePassportSession:  true,
        legacySingleSession: true,   // old backend contract -- singular session_id, not yet updated
    },
    'vehicle-deed': {
        label:               'سند مالکیت خودرو (برگ سبز)',
        endpoint: `${BACKEND}/api/translate/vehicle-deed`,
        active:              true,
        usePassportSession:  true,
    },
    'notary-deed': {
        label:               'اسناد دفترخانه (سند رسمی)',
        endpoint: `${BACKEND}/api/translate/notary-deed`,
        active:              true,
        usePassportSession:  true,
    },
    'academic-transcript': {
        label:               'ریزنمرات علوم پزشکی',
        endpoint: `${BACKEND}/api/translate/academic-transcript`,
        active:              true,
        usePassportSession:  true,
    },
    'gazette-notice': {
        label:               'آگهی تاسیس / تغییرات (روزنامه رسمی)',
        endpoint: `${BACKEND}/api/translate/gazette-notice`,
        active:              true,
        // Backend (gazette_notice.py) already accepts session_ids and
        // matches them against named individuals (board members, etc.)
        // via match_parties_to_identities -- this was just never turned
        // on here, so the passport UI (including "+ افزودن پاسپورت" for
        // more than one named individual) never showed for this type.
        usePassportSession:  true,
    },
    'high-school-transcript': {
        label:               'ریزنمرات دبیرستان',
        endpoint: `${BACKEND}/api/translate/high-school-transcript`,
        active:              true,
        usePassportSession:  true,
    },
    'ownership-deed': {
    label: 'سند مالکیت (تک برگ؛ نام مالک اول)',
    endpoint: `${BACKEND}/api/translate/ownership-deed`,
    active: true,
    usePassportSession: true,
    },
    'azad-transcript': {
        label:               'ریزنمرات دانشگاه آزاد اسلامی',
        endpoint: `${BACKEND}/api/translate/azad-transcript`,
        active:              true,
        usePassportSession:  true,
    },
    'insurance-record': {
        label:               'سوابق کامل بیمه تامین اجتماعی',
        endpoint: `${BACKEND}/api/translate/insurance-record`,
        active:              true,
        usePassportSession:  true,
    },
    'consolidated-insurance-record': {
        label:               'سوابق تلفیقی بیمه تامین اجتماعی',
        endpoint: `${BACKEND}/api/translate/consolidated-insurance-record`,
        active:              true,
        usePassportSession:  true,
    },
};

// Populate the hidden native select (kept so every other part of the app
// can keep reading docTemplate.value unchanged) AND the searchable list.
(function buildDocDropdown() {
    const sel = document.getElementById('docTemplate');
    if (!sel) return;
    sel.innerHTML = '';

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'یک مدرک انتخاب کنید';
    placeholder.disabled = true;
    placeholder.selected = true;
    sel.appendChild(placeholder);

    Object.entries(DOCUMENT_REGISTRY).forEach(([key, doc]) => {
        const opt = document.createElement('option');
        opt.value    = key;
        opt.textContent = doc.active ? doc.label : `${doc.label} — به زودی`;
        opt.disabled = !doc.active;
        sel.appendChild(opt);
    });

    renderDocDropdownList('');
})();

/* ============ SECTION: DOCUMENT-TYPE SEARCH DROPDOWN ============
   Searchable <input> + hidden <select> (id: docTemplate*) so old flowing
   markup still works with handleDocTypeSelected(). ============ */
function renderDocDropdownList(query) {
    const list = document.getElementById('docTemplateOptions');
    if (!list) return;
    list.innerHTML = '';

    const q = (query || '').trim().toLowerCase();
    const entries = Object.entries(DOCUMENT_REGISTRY).filter(([key, doc]) => {
        if (!q) return true;
        return doc.label.toLowerCase().includes(q);
    });

    if (!entries.length) {
        const empty = document.createElement('div');
        empty.className = 'px-3 py-2 text-xs';
        empty.style.color = 'var(--text-muted)';
        empty.textContent = 'موردی یافت نشد';
        list.appendChild(empty);
        return;
    }

    entries.forEach(([key, doc]) => {
        const item = document.createElement('div');
        item.className = 'px-3 py-2 text-sm cursor-pointer';
        item.style.fontFamily = "'Vazirmatn',sans-serif";
        item.textContent = doc.active ? doc.label : `${doc.label} — به زودی`;
        if (!doc.active) {
            item.style.opacity = '0.5';
            item.style.cursor = 'not-allowed';
        } else {
            item.addEventListener('mouseenter', () => { item.style.background = 'var(--accent-hover)'; });
            item.addEventListener('mouseleave', () => { item.style.background = ''; });
            item.addEventListener('click', () => {
                document.getElementById('docTemplate').value = key;
                document.getElementById('docTemplateSearch').value = doc.label;
                document.getElementById('docTemplate').dispatchEvent(new Event('change'));
                closeDocDropdownList();
            });
        }
        list.appendChild(item);
    });
}

function filterDocDropdown() {
    const query = document.getElementById('docTemplateSearch').value;
    openDocDropdownList();
    renderDocDropdownList(query);
}

function openDocDropdownList() {
    const input = document.getElementById('docTemplateSearch');
    const list = document.getElementById('docTemplateOptions');
    const rect = input.getBoundingClientRect();
    const availableBelow = window.innerHeight - rect.bottom - 12;
    const maxHeight = Math.max(160, Math.min(320, availableBelow));
    list.style.position = 'fixed';
    list.style.top = (rect.bottom + 4) + 'px';
    list.style.left = rect.left + 'px';
    list.style.width = rect.width + 'px';
    list.style.maxHeight = maxHeight + 'px';
    list.style.overflowY = 'auto';
    list.classList.remove('hidden');
}

function closeDocDropdownList() {
    document.getElementById('docTemplateOptions').classList.add('hidden');
}

document.addEventListener('click', (e) => {
    const wrapper = document.getElementById('docTemplateSearch')?.closest('.relative');
    if (wrapper && !wrapper.contains(e.target)) {
        closeDocDropdownList();
    }
});
// ─── APP STATE ───
// ─── SESSION — reads from real auth (deept_token) or falls back to mock ───
/* ============ SECTION: SESSION & PERSISTED STATE ============
   localStorage keys (deept_*) are the source of truth for auth + wallet;
   loadSession() then derived state below. ============ */

function loadSession() {
    const token = localStorage.getItem('deept_token');
    const userId = localStorage.getItem('deept_user_id');

    // Real authenticated session
    if (token && userId) {
        const email = localStorage.getItem('deept_user_email') || '';
        const userName = localStorage.getItem('deept_user_name') || '';

        return {
            token,
            user_id: userId,
            email,
            username: userName || (email ? email.split('@')[0] : ''),
            type: localStorage.getItem('deept_account_type') || 'individual',
            contact: localStorage.getItem('deept_contact_info') || '',
            office: localStorage.getItem('deept_office_name') || '',
            is_admin: localStorage.getItem('deept_is_admin') === '1'
        };
    }

    // Test/mock session
    try {
        return JSON.parse(
            localStorage.getItem('deept_mock_user') || 'null'
        );
    } catch (error) {
        console.warn('Invalid mock session:', error);
        localStorage.removeItem('deept_mock_user');
        return null;
    }
}

async function syncProfileFromServer() {
    if (!currentUserSession || !currentUserSession.token) return;
    try {
        const res = await fetch(`${CORE}/auth/verify`, {
            headers: { 'Authorization': `Bearer ${currentUserSession.token}` }
        });
        if (!res.ok) return;
        const data = await res.json();
        if (!data.valid) return;
        let changed = false;
        if (data.account_type && data.account_type !== currentUserSession.type) {
            localStorage.setItem('deept_account_type', data.account_type);
            currentUserSession.type = data.account_type;
            changed = true;
        }
        // office_name/contact_info can legitimately be cleared back to ''
        // by the server (see saveProfileConfiguration()), unlike
        // account_type above -- so these compare/store even when falsy,
        // rather than only ever moving away from the default.
        const officeName = data.office_name || '';
        if (officeName !== (currentUserSession.office || '')) {
            localStorage.setItem('deept_office_name', officeName);
            currentUserSession.office = officeName;
            changed = true;
        }
        const contactInfo = data.contact_info || '';
        if (contactInfo !== (currentUserSession.contact || '')) {
            localStorage.setItem('deept_contact_info', contactInfo);
            currentUserSession.contact = contactInfo;
            changed = true;
        }
        if (changed) syncUserSessionDOM();
    } catch (e) { /* offline or Core unreachable -- keep the cached value, try again next load */ }
}

let currentUserSession = loadSession();
let trackingProjectsDatabase = [];
let resetPasswordToken = null; // carried from ?reset_token=... on page load through to handleResetPassword()

// ─── PASSPORT SESSION STATE ───
let confirmedPassports = [];   // every confirmed passport lives here -- no more "first one is special"
let selectedClientId   = null; // set when the session came from "select existing client" -- sent as client_id on submit

// Multi-passport jobs (e.g. a client bringing a spouse's or child's
// passport too) -- the FIRST identity saved this session is the main
// contact; everyone after that attaches to that profile as a نفر مرتبط
// (related person) instead of becoming their own separate client.
let mainContactClientId     = null;
let mainContactNationalId   = null;

/* ============ SECTION: PASSPORT PIPELINE STATE ============
   confirmedPassports/selectedClientId/mainContact* back the multi-party
   passport workflow; pp* fields hold the in-flight intent. ============ */
function getActiveBackendOrigin() {
    const docType = document.getElementById('docTemplate').value;
    const docDef  = DOCUMENT_REGISTRY[docType];
    if (docDef && docDef.endpoint) {
        try { return new URL(docDef.endpoint).origin; } catch(e) {}
    }
    return BACKEND; // fallback before a document type is selected
}
let ppSelectedFile  = null;
let ppCurrentMode   = null;   // 'upload' | 'manual' | 'skip'
let docSelectedFile = null;

// ═══════════════════════════════════════════════════════════
// TOAST
// ═══════════════════════════════════════════════════════════

// Escapes user-controlled text before it's interpolated into innerHTML.
// REQUIRED wherever a template literal injects data that originated from
// a user (signup name/email, uploaded filenames, manually-entered names,
// backend error messages that may echo input) -- without this, a user
// could set e.g. their signup name to a <script>/onerror payload and have
// it execute in another user's (or an admin's) browser when that data is
// rendered elsewhere.
/* ============ SECTION: SHARED UI UTILITIES ============
   escapeHtml/showToast used across every feature. ============ */
function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function showToast(msg, duration=2500) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), duration);
}

// ═══════════════════════════════════════════════════════════
// THEME
// ═══════════════════════════════════════════════════════════
function toggleGlobalTheme() {
    const body = document.body;
    const next = (body.getAttribute('data-theme') || 'dark') === 'dark' ? 'light' : 'dark';
    body.setAttribute('data-theme', next);
    document.getElementById('themeBtnIcon').textContent = next === 'light' ? '🌙' : '☀️';
    document.getElementById('themeBtnText').textContent = next === 'light' ? 'تاریک' : 'روشن';
    localStorage.setItem('deept_theme', next);
}
(function(){
    const saved = localStorage.getItem('deept_theme');
    if (saved === 'light') {
        document.body.setAttribute('data-theme','light');
        document.getElementById('themeBtnIcon').textContent = '🌙';
        document.getElementById('themeBtnText').textContent = 'تاریک';
    }
})();

// ═══════════════════════════════════════════════════════════
// AUTH MODAL
// ═══════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════
// USER SESSION SYNC
// ═══════════════════════════════════════════════════════════
/* ============ SECTION: AUTH SESSION + HEADER UI ============
   Login/logout, profile account type, header badge + user-name sync. ============ */
function syncUserSessionDOM() {
    const loggedIn = !!currentUserSession;
    const toggle = (id, hide) => { const el=document.getElementById(id); if(el) el.classList.toggle('hidden', hide); };
    toggle('authHeaderBtn',      loggedIn);
    toggle('mainHeroAuthCall',   loggedIn);
    toggle('workspaceHeaderBtn', !loggedIn);
    toggle('clientsHeaderBtn',   !loggedIn);
    toggle('scheduleHeaderBtn',  !loggedIn);
    toggle('settingsHeaderBtn',  !loggedIn);
    toggle('priceListHeaderBtn', !loggedIn);
    toggle('adminPanelHeaderBtn', !loggedIn || localStorage.getItem('deept_is_admin') !== '1');
    // HR clock in/out: office-only sub-users (see hr.py) -- an "individual"
    // account has no staff to punch in/out, so this stays hidden for it.
    const isOffice = loggedIn && currentUserSession.type === 'office';
    toggle('hrClockHeaderBtn',  !isOffice);
    toggle('logoutHeaderBtn',    !loggedIn);
    // Side rail: same destinations/visibility as the header-bar pills
    // above, just also shown/hidden here (see #sideRail in index.html).
    toggle('sideRail',           !loggedIn);
    toggle('railWorkspaceBtn',   !loggedIn);
    toggle('railClientsBtn',     !loggedIn);
    toggle('railScheduleBtn',    !loggedIn);
    toggle('railPriceListBtn',   !loggedIn);
    toggle('railSettingsBtn',    !loggedIn);
    toggle('railAdminPanelBtn',  !loggedIn || localStorage.getItem('deept_is_admin') !== '1');
    toggle('railHrClockBtn',    !isOffice);
    const ub = document.getElementById('userBadge');
    if (ub) { ub.classList.toggle('hidden', !loggedIn); ub.style.display = loggedIn ? 'flex' : 'none'; }
    if (loggedIn) {
        const displayName = currentUserSession.office || currentUserSession.username || currentUserSession.email || '؟';
        const l = displayName[0].toUpperCase();
        const set = (id, val) => { const el=document.getElementById(id); if(el) el.textContent=val; };
        set('avatarLetter',       l);
        set('headerAvatarBadge',  l);
        set('headerUserName',     displayName);
        set('profileDisplayName', displayName);
        set('profileEmailBadge',  currentUserSession.email || '');
        const at = document.getElementById('accountTypeToggle');
        if (at) at.value = currentUserSession.type || 'individual';
        const pc = document.getElementById('profileContactInput');
        if (pc) pc.value = currentUserSession.contact || '';
        const on = document.getElementById('officeNameInput');
        if (on) on.value = currentUserSession.office || '';
        toggleProfileAccountType();
    }
}

// ═══════════════════════════════════════════════════════════
// LOGOUT
// ═══════════════════════════════════════════════════════════
function confirmLogout()   { document.getElementById('logoutOverlay').classList.remove('hidden'); }
function closeLogoutConfirm() { document.getElementById('logoutOverlay').classList.add('hidden'); }
function executeLogout() {
    currentUserSession = null;
    localStorage.removeItem('deept_mock_user');
    localStorage.removeItem('deept_token');
    localStorage.removeItem('deept_user_id');
    localStorage.removeItem('deept_user_name');
    localStorage.removeItem('deept_user_email');
    localStorage.removeItem('deept_is_admin');
    localStorage.removeItem('deept_account_type');
    localStorage.removeItem('deept_office_name');
    localStorage.removeItem('deept_contact_info');
    closeLogoutConfirm();
    closeWorkspaceDashboard();
    closeChatInterface();
    syncUserSessionDOM();
    showLandingView();
    showToast('👋 با موفقیت خارج شدید.');
}
document.getElementById('logoutOverlay').addEventListener('click', function(e) {
    if (e.target === this) closeLogoutConfirm();
});
document.getElementById('myplRepriceModal').addEventListener('click', function(e) {
    if (e.target === this) closeMyPriceListRepriceModal();
});
document.getElementById('editWorkRecordModal').addEventListener('click', function(e) {
    if (e.target === this) closeEditWorkRecordModal();
});

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

// ═══════════════════════════════════════════════════════════
// PROFILE
// ═══════════════════════════════════════════════════════════
function toggleProfileAccountType() {
    document.getElementById('officeFieldsBlock').classList.toggle('hidden', document.getElementById('accountTypeToggle').value !== 'office');
}
async function saveProfileConfiguration() {
    if (!currentUserSession) return;
    const type    = document.getElementById('accountTypeToggle').value;
    const contact = document.getElementById('profileContactInput').value;
    const office  = type === 'office' ? document.getElementById('officeNameInput').value : '';

    // Test/mock session (see initializeApp()'s ?test=1 handling) has no
    // real account behind it to PATCH -- keep the old localStorage-only
    // behavior for it.
    if (!currentUserSession.token) {
        currentUserSession.type    = type;
        currentUserSession.contact = contact;
        currentUserSession.office  = office;
        localStorage.setItem('deept_mock_user', JSON.stringify(currentUserSession));
        document.getElementById('profileDisplayName').textContent = currentUserSession.office || currentUserSession.username;
        document.getElementById('headerUserName').textContent     = currentUserSession.office || currentUserSession.username;
        showToast('✅ پروفایل بروزرسانی شد.');
        return;
    }

    const btn = document.getElementById('saveProfileBtn');
    const originalLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'در حال ذخیره...';
    try {
        const res = await fetch(`${CORE}/auth/me`, {
            method: 'PATCH',
            headers: { 'Authorization': `Bearer ${currentUserSession.token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ account_type: type, office_name: office, contact_info: contact })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.detail || 'خطای سرور');

        localStorage.setItem('deept_account_type', data.account_type || 'individual');
        localStorage.setItem('deept_office_name', data.office_name || '');
        localStorage.setItem('deept_contact_info', data.contact_info || '');
        currentUserSession.type    = data.account_type || 'individual';
        currentUserSession.office  = data.office_name || '';
        currentUserSession.contact = data.contact_info || '';
        syncUserSessionDOM();
        showToast('✅ پروفایل بروزرسانی شد.');
    } catch (e) {
        showToast('❌ خطا در ذخیره پروفایل: ' + e.message);
    } finally {
        btn.disabled = false;
        btn.textContent = originalLabel;
    }
}

// ═══════════════════════════════════════════════════════════
// TRANSLATION PREFERENCES -- font, fixed header/certification wording, and
// date format applied to every future translation across every document
// type. A blank field always means "use the system default"; DeepT-Back-
// End's doc_prefs.py is the one place that default text/size actually
// lives, so this screen never needs to know or show it verbatim.
// ═══════════════════════════════════════════════════════════
async function loadPreferences() {
    if (!currentUserSession) return;
    const token = getToken();
    try {
        const res = await fetch(`${CORE}/users/me/preferences`, { headers: { 'Authorization': `Bearer ${token}` } });
        if (!res.ok) throw new Error();
        const p = await res.json();
        document.getElementById('pref-font-name').value = p.font_name || '';
        document.getElementById('pref-font-size').value = p.font_size_pt ? String(p.font_size_pt) : '';
        document.getElementById('pref-header-text').value = p.header_text || '';
        document.getElementById('pref-cert-text').value = p.certification_text || '';
        document.getElementById('pref-date-format').value = p.date_format || '';
        document.getElementById('pref-hide-header').checked = !!p.hide_header;
        document.getElementById('pref-hide-certification').checked = !!p.hide_certification;
        document.getElementById('pref-disable-completion-email').checked = !!p.disable_completion_email;
        togglePrefHidden('header');
        togglePrefHidden('certification');
    } catch (e) {
        // Non-critical -- fields just stay blank (= defaults), same as a
        // translator who never customized anything.
    }
}

function resetPrefField(id) {
    const el = document.getElementById(id);
    if (el) el.value = '';
}

function togglePrefHidden(which) {
    const hidden = document.getElementById(`pref-hide-${which}`).checked;
    const textareaId = which === 'header' ? 'pref-header-text' : 'pref-cert-text';
    const textarea = document.getElementById(textareaId);
    const resetBtn = textarea.nextElementSibling;
    textarea.disabled = hidden;
    if (resetBtn) resetBtn.disabled = hidden;
    textarea.style.opacity = hidden ? '0.45' : '1';
    if (resetBtn) resetBtn.style.opacity = hidden ? '0.45' : '1';
}

async function savePreferences() {
    if (!currentUserSession) return;
    const btn = document.getElementById('pref-save-btn');
    const status = document.getElementById('pref-save-status');
    btn.disabled = true;
    status.classList.remove('hidden');
    status.style.color = 'var(--text-muted)';
    status.textContent = 'در حال ذخیره...';

    const sizeVal = document.getElementById('pref-font-size').value;
    const body = {
        font_name: document.getElementById('pref-font-name').value || null,
        font_size_pt: sizeVal ? parseFloat(sizeVal) : null,
        header_text: document.getElementById('pref-header-text').value || null,
        certification_text: document.getElementById('pref-cert-text').value || null,
        date_format: document.getElementById('pref-date-format').value || null,
        hide_header: document.getElementById('pref-hide-header').checked,
        hide_certification: document.getElementById('pref-hide-certification').checked,
        disable_completion_email: document.getElementById('pref-disable-completion-email').checked,
    };

    const token = getToken();
    try {
        const res = await fetch(`${CORE}/users/me/preferences`, {
            method: 'PATCH',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.detail || 'خطای سرور');
        status.style.color = 'var(--accent)';
        status.textContent = '✅ ذخیره شد. از سند بعدی اعمال می‌شود.';
    } catch (e) {
        status.style.color = '#f87171';
        status.textContent = `❌ ذخیره تنظیمات ناموفق بود: ${e.message || 'خطای نامشخص'}`;
    } finally {
        btn.disabled = false;
    }
}

// ═══════════════════════════════════════════════════════════
// PER-DOCUMENT-TYPE PHRASE OVERRIDES -- every other hardcoded phrase a
// document type has (table labels, disclaimer paragraphs, legal
// boilerplate), beyond the header/certification fields above. Only two
// document types are wired on the DeepT-Back-End side so far; the field
// catalog below must match doc_prefs.py's call sites in those files
// exactly -- same field keys, same default text -- or a translator's
// override would silently target the wrong phrase (or none at all).
// ═══════════════════════════════════════════════════════════
const DP_DOCS = [
    { id:"police_certificate", label:"گواهی عدم سوءپیشینه", full:true, fields:[
        { key:"emblem_line", label:"سطر آرم قضائیه", kind:"simple", def:"Emblem of IRI Judiciary" },
        { key:"title_block", label:"عنوان سند", kind:"simple", def:"(Criminal Records Department)\nPolice Certificate" },
        { key:"photo_caption", label:"زیرنویس محل عکس", kind:"simple", def:"(Holder's photo printed)" },
        { key:"body_intro", label:"جملهٔ آغازین متن گواهی", kind:"complex",
          tokens:[{key:"first_name",label:"نام"},{key:"last_name",label:"نام خانوادگی"},{key:"father_name",label:"نام پدر"},{key:"date_of_birth",label:"تاریخ تولد"},{key:"national_id",label:"کد ملی"}],
          def:"Pursuant to Article 13 of Criminal Records By-law enacted in 2019, this is to certify that holder of the above photo, given name: {{first_name}}, surname: {{last_name}}, father's name: {{father_name}}, born on {{date_of_birth}}, holder of national identification number {{national_id}}, has no record of criminal conviction." },
        { key:"qr_caption", label:"زیرنویس کد QR", kind:"simple", def:"[Printed QR Code]" },
        { key:"postscript_label", label:"برچسب پی‌نوشت", kind:"simple", def:"Postscript:" },
        { key:"note_1", label:"پی‌نوشت ۱ — مادهٔ ۶۵۵", kind:"simple", def:"1. By the virtue of Article 655 of Criminal Procedure, the electronic copy of this certificate shall be valid and sufficient, and no seal is required." },
        { key:"note_2", label:"پی‌نوشت ۲ — استعلام آنلاین", kind:"simple", def:"2. This certificate was issued electronically by inspecting the existing records in accordance with Note 2 of Article 10 of the mentioned By-law. Authenticity can be verified for two months at www.adliran.ir." },
        { key:"note_3", label:"پی‌نوشت ۳ — مبلغ پرداختی", kind:"complex",
          tokens:[{key:"amount",label:"مبلغ"},{key:"transaction_number",label:"شمارهٔ تراکنش"}],
          def:"3. A sum of {{amount}} Rials was received for electronic services through No. {{transaction_number}}." },
    ]},
    { id:"vehicle_deed", label:"سند خودرو", full:true, fields:[
        { key:"notes_intro", label:"مقدمهٔ تذکرات پشت سند", kind:"simple", def:"Owners are required to read the following notes carefully and observe them:" },
        { key:"note_1", label:"تذکر ۱ — رعایت مقررات راهنمایی", kind:"simple", def:"All drivers must observe traffic rules and regulations in order to respect other’s rights and avoid any damages due to the violation of these rules and regulations. In the new system, all violations will be recorded in the plate owner’s profile; therefore, the plate owner will be liable for others’ use of the vehicle." },
        { key:"note_2", label:"تذکر ۲ — نگهداری پلاک", kind:"simple", def:"It is crucial to carefully maintain the plate; therefore,\nA: Always keep the plate clean and readable and install it on the specified place.\nB. In case the identification card, ownership deed, or the plate of the vehicle is lost or damaged, the owner is required to notify the nearest police station and refer to traffic police station within 48 hours in order to receive a duplicate of the lost document(s)." },
        { key:"note_3", label:"تذکر ۳ — انتقال مالکیت", kind:"simple", def:"In case the owner decides to sell or transfer the vehicle to others, both parties to the transaction must refer to Vehicle Transfer department, holding their identity documents including National ID card, birth certificate, completion of military service card or military service exemption card along with identity documents of the vehicle, the certificate of government debts and duties settlement and the vehicle itself." },
        { key:"note_label", label:"برچسب بخش «نکته»", kind:"simple", def:"Note:" },
        { key:"note_a", label:"نکتهٔ الف — تسریع انتقال", kind:"simple", def:"To accelerate and facilitate the transfer process, it is highly recommended to plan the transfer to take place in the city where the new owner resides." },
        { key:"note_b", label:"نکتهٔ ب — تعویض پلاک", kind:"simple", def:"As the plate number is registered under the owner’s name, the former owner’s plates must be removed at transfer units under police supervision, and new plates must be registered under the new owner’s name and installed." },
        { key:"note_4", label:"تذکر ۴ — کارت شناسایی خودرو", kind:"simple", def:"The vehicle ID card or any other services will be sent to the owner’s residence. According to Article 6 of Traffic Bylaw, the owner is obliged to refer to plate changing centers, vehicle service offices or Police+10 offices to alter his/her address within 10 days in case his/her address changes." },
    ]},
    { id:"notary_deed", label:"سند دفترخانه", full:true, fields:[
        { key:"disclaimer_verification", label:"شناسه سند و اطلاعات اصلی این سند، پس از امضای الکترونیکی سردفتر، از طریق درگاه سازمان ثبت اسناد و املاک کشور به نشانی www.ssaa.ir قابل استعلام است.", kind:"simple", def:"The document ID and the main information of this deed can be verified after the electronic signature by the notary public, through the portal of the Registration Organization for Deeds and Real Estates at www.ssaa.ir. " },
        { key:"disclaimer_forgery", label:"جعل اسناد رسمی مطابق مواد ۵۳۲ و ۵۳۳ قانون مجازات اسلامی قابل تعقیب و مجازات است.", kind:"simple", def:"Any forgery of official documents will be subject to Articles 532 and 533 of the Islamic Penal Code." },
        { key:"registration_statement", label:"این سند به شماره {{reg_no}} در دفترخانه اسناد رسمی شماره {{notary_office}} {{notary_loc}} به تاریخ {{reg_date}} ثبت گردید.", kind:"complex",
          tokens:[{key:"reg_no",label:"شماره ثبت"},{key:"notary_loc",label:"محل دفترخانه"},{key:"notary_office",label:"شماره دفترخانه"},{key:"reg_date",label:"تاریخ ثبت"}],
          def:"This document was registered under No. {{reg_no}} in {{notary_loc}} Notary Public Office No. {{notary_office}}, dated {{reg_date}}." },
        { key:"notary_certification_statement", label:"با احراز هویت طرفین، اینجانب سردفتر گواهی می‌نمایم که کلیه مندرجات این سند در حضور اینجانب تنظیم گردیده است. امضا، مهر و منگنه شده توسط {{notary_name}}، سردفتر اسناد رسمی شماره {{notary_office}} {{notary_loc}}.", kind:"complex",
          tokens:[{key:"notary_name",label:"نام سردفتر"},{key:"notary_loc",label:"محل دفترخانه"},{key:"notary_office",label:"شماره دفترخانه"}],
          def:"Having ascertained of the parties' identities, I, the notary public, certify that all written contents of this deed were drawn up before me. Signed, sealed and embossed by {{notary_name}}, {{notary_loc}} Notary Public No. {{notary_office}}." },
    ]},
    { id:"academic_transcript", label:"ریزنمرات دانشگاهی", full:false, fields:[],
      // Open-ended Persian-term -> English-equivalent glossary (course
      // names DeepT-Back-End's academic_transcript.py always translates
      // one specific way, e.g. "کارآموزی" -> "Training"), distinct from
      // the fixed-field phrase overrides above -- see renderTermGlossary().
      // These three are the exact built-in defaults from that file's
      // DEFAULT_COURSE_NAME_GLOSSARY; a translator can override any of
      // them or add entirely new terms via the searchable table below.
      glossary: { defaults: {
          "کارآموزی در عرصه": "Clinical Training",
          "کارآموزی": "Training",
          "کارورزی": "Internship",
      } },
    },
    { id:"azad_transcript", label:"ریزنمرات دانشگاه آزاد", full:true, fields:[
        { key:"course_list_intro", label:"فهرست دروس و ریزنمرات نامبرده در طی دوره تحصیلی به شرح زیر می‌باشد.", kind:"simple", def:"The course list and transcript of records are displayed below." },
    ],
      // Course-name terms this document type always translates one
      // specific way (enforced as a mandatory instruction to the
      // extraction model, not a post-processing substitution -- see
      // azad_transcript.py's DEFAULT_COURSE_NAME_GLOSSARY), same
      // renderTermGlossary() UI as academic_transcript's glossary below.
      glossary: { defaults: {
          "روستا": "Rural Architecture",
          "دفاع مقدس": "Iran-Iraq War",
      } },
    },
    { id:"property_deed_owner", label:"سند مالکیت ملک", full:true, fields:[
        { key:"hologram_seal_note", label:"تشریح هولوگرام اداره ثبت", kind:"simple", def:"Affixed Hologram Seal of Registration Organization for Deeds and Real Estate." },
        { key:"legal_basis_statement", label:"این سند مالکیت رسمی است و مطابق ثبت دفتر املاک الکترونیک، بر اساس ماده ۲۲ قانون ثبت و ماده ۴ قانون کاداستر جامع، صادر و در یک برگ تسلیم می‌شود.", kind:"simple", def:"This title deed is officially registered and is issued in one copy according to real estate registration, based on the article 22 of Registration Act and Article 4 of Comprehensive Cadastral Law." },
        { key:"signed_embossed_statement", label:"امضا و ممهور به مهر برجسته توسط رئیس واحد ثبتی: {{registration_department}}، {{city}}، {{date_of_registration}}", kind:"complex",
          tokens:[{key:"registration_department",label:"ادارهٔ ثبت"},{key:"city",label:"شهر"},{key:"date_of_registration",label:"تاریخ ثبت"}],
          def:"Signed and Embossed by Director of Registration Unit: {{registration_department}}, {{city}}, {{date_of_registration}}" },
    ]},
    { id:"insurance_record", label:"سابقهٔ بیمه", full:false, fields:[] },
    { id:"consolidated_insurance_record", label:"سابقهٔ بیمهٔ تجمیعی", full:false, fields:[] },
    { id:"gazette_notice", label:"آگهی روزنامهٔ رسمی", full:true, fields:[
        { key:"footnote", label:"این روزنامه بصورت الکترونیکی و در قالب فایل PDF تولید و منتشر شده است. برای اطمینان از اعتبار و صحت امضاء دیجیتال و نسخه چاپی به نشانی مندرج در انتهای آگهی مراجعه نمایید.\nرفع مسئولیت:\nمطالب آگهی‌های منتشرشده در روزنامه رسمی براساس چرخه مشخصی که از تقدیم مفاد آن از سوی ذینفع قانونی به ادارات ثبت شرکت‌ها (شرکتها) در تهران و شهرستان‌ها آغاز و پس از اجرای تشریفات مربوطه به صورت آگهی تسلیم روزنامه رسمی کشور می‌گردد، تهیه می‌نماید. لذا این مرجع هیچ‌گونه دخالتی در مندرجات آگهی‌های مزبور نداشته و ندارد.", kind:"simple", def:"This Official Gazette is produced and published electronically in PDF format. To verify the validity and authenticity of the digital signature and the printed copy, please refer to the address stated at the end of the notice.\nDisclaimer: The content of notices published in the Official Gazette follows a defined process that begins with the interested party submitting the notice's content to the Companies and Non-Commercial Institutions Registration Offices in Tehran and other cities, and, after completing the relevant formalities, is forwarded for publication in the Official Gazette of the country. This authority therefore has no involvement whatsoever in the content of such notices." },
    ]},
    { id:"high_school_transcript", label:"ریزنمرات دبیرستان", full:true, fields:[
        { key:"document_title", label:"عنوان مدرک", kind:"simple", def:"Score Report Sheet" },
    ]},
];

let dpServerPhrases = {};   // {doc_type: {field_key: text}} -- last known saved state, from GET
let dpDraft = {};           // {doc_type: {field_key: text}} -- unsaved edits, kept across doc-type switches
let dpCurrentDoc = DP_DOCS[0].id;

// Term-glossary state (see renderTermGlossary()) -- same
// server/draft-split convention as dpServerPhrases/dpDraft above, just
// keyed by an open-ended Persian term instead of a fixed field name.
let dpGlossaryServer = {};  // {doc_type: {persian_term: english}} -- last known saved state, from GET
let dpGlossaryDraft = {};   // {doc_type: {persian_term: english}} -- unsaved edits
let dpGlossarySearch = '';  // current client-side filter text for the glossary table

/* ============ SECTION: DOCUMENT-PHRASE OVERRIDES ============
   Per-document-type phrase catalog (PATCH /users/me/preferences merge,
   {{token}} chips are JS-rendered units, never raw braces). ============ */
function dpEffectiveValue(docId, key, def){
    if (dpDraft[docId] && dpDraft[docId][key] !== undefined) return dpDraft[docId][key];
    if (dpServerPhrases[docId] && dpServerPhrases[docId][key] !== undefined) return dpServerPhrases[docId][key];
    return def;
}

// Structural check for a {{token}}-bearing phrase: every required token
// must appear exactly once. Missing = that real piece of document data
// silently disappears from the printed document; a stray single brace
// is flagged too (the classic "{amount}" typo). Mirrors DeepT-Back-End's
// own server-side check in doc_prefs.py -- this is a fast first warning
// for the translator, not a substitute for that check.
function dpCheckComplex(text, tokens){
    const counts = {};
    tokens.forEach(t => counts[t.key] = 0);
    const re = /\{\{(\w+)\}\}/g;
    let m;
    while ((m = re.exec(text))){
        if (counts.hasOwnProperty(m[1])) counts[m[1]]++;
    }
    const missing = tokens.filter(t => counts[t.key] === 0);
    const duplicated = tokens.filter(t => counts[t.key] > 1);
    const doubleOpen = (text.match(/\{\{/g)||[]).length;
    const singleOpen = (text.match(/\{(?!\{)/g)||[]).length - doubleOpen;
    const doubleClose = (text.match(/\}\}/g)||[]).length;
    const singleClose = (text.match(/(?<!\})\}/g)||[]).length - doubleClose;
    const strayBrace = singleOpen > 0 || singleClose > 0;
    return { valid: missing.length===0 && duplicated.length===0 && !strayBrace, missing, duplicated, strayBrace };
}

function dpMakeChip(key){
    const span = document.createElement('span');
    span.className = 'dp-token-chip';
    span.contentEditable = 'false';
    span.dataset.token = key;
    const label = document.createElement('span');
    label.textContent = `{{${key}}}`;
    span.appendChild(label);
    const x = document.createElement('span');
    x.className = 'dp-token-x';
    x.dataset.removeChip = '1';
    x.title = 'حذف این داده از عبارت';
    x.textContent = '×';
    span.appendChild(x);
    return span;
}

function dpPopulateEditor(div, value, tokenKeys){
    div.innerHTML = '';
    const knownKeys = new Set(tokenKeys);
    const re = /\{\{(\w+)\}\}/g;
    let lastIndex = 0, m;
    while ((m = re.exec(value))){
        if (m.index > lastIndex) div.appendChild(document.createTextNode(value.slice(lastIndex, m.index)));
        if (knownKeys.has(m[1])) {
            div.appendChild(dpMakeChip(m[1]));
        } else {
            div.appendChild(document.createTextNode(m[0]));
        }
        lastIndex = re.lastIndex;
    }
    if (lastIndex < value.length) div.appendChild(document.createTextNode(value.slice(lastIndex)));
    if (!div.childNodes.length) div.appendChild(document.createTextNode(''));
}

// The inverse of dpPopulateEditor() -- walks the live DOM back into the
// same "...{{token}}..." string shape the backend expects. A chip always
// serializes to a well-formed {{key}}; there is no other way for one to
// exist in this editor's DOM at all.
function dpSerializeEditor(div){
    let out = '';
    div.childNodes.forEach(node => {
        if (node.nodeType === Node.TEXT_NODE) {
            out += node.textContent;
        } else if (node.classList && node.classList.contains('dp-token-chip')) {
            out += `{{${node.dataset.token}}}`;
        } else {
            out += node.textContent;
        }
    });
    return out;
}

// Strips any literal "{" / "}" a translator typed or pasted directly --
// the only legitimate way a placeholder enters this editor is as a chip,
// so a bare brace character can only ever be a mistake, never intended
// content. Runs after every edit, so a typed "{" is removed on the spot
// rather than sitting there as the start of something that could later
// look like a broken placeholder.
function dpSanitizeEditor(div){
    const walker = document.createTreeWalker(div, NodeFilter.SHOW_TEXT);
    const toFix = [];
    let node;
    while ((node = walker.nextNode())) {
        if (/[{}]/.test(node.textContent)) toFix.push(node);
    }
    toFix.forEach(n => { n.textContent = n.textContent.replace(/[{}]/g, ''); });
}

// Inserts a token chip at the current text-caret position inside `div`
// (falls back to the end of the content if the caret isn't inside this
// editor -- e.g. focus was on the toolbar button, not the text itself).
function dpInsertChipAtCaret(div, key){
    div.focus();
    const sel = window.getSelection();
    let range;
    if (sel && sel.rangeCount && div.contains(sel.anchorNode)) {
        range = sel.getRangeAt(0);
    } else {
        range = document.createRange();
        range.selectNodeContents(div);
        range.collapse(false);
    }
    range.deleteContents();
    const chip = dpMakeChip(key);
    range.insertNode(chip);
    range.setStartAfter(chip);
    range.setEndAfter(chip);
    sel.removeAllRanges();
    sel.addRange(range);
}

function populateDocSelect(){
    const sel = document.getElementById('dp-doc-select');
    if (sel.options.length) return; // already populated
    DP_DOCS.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d.id; opt.textContent = d.label;
        sel.appendChild(opt);
    });
}

function renderDocumentPhrases(){
    const sel = document.getElementById('dp-doc-select');
    dpCurrentDoc = sel.value || DP_DOCS[0].id;
    const doc = DP_DOCS.find(d => d.id === dpCurrentDoc);
    const list = document.getElementById('dp-field-list');
    list.innerHTML = '';
    document.getElementById('dp-save-status').classList.add('hidden');

    // A document type can have a fixed-field phrase list, a term glossary,
    // both (e.g. azad_transcript), or -- until wired up -- neither, in
    // which case the "به‌زودی" pending note is the only thing shown. Both
    // sections render side by side when both apply; saveCurrentDocumentSettings()
    // sends whichever of the two has pending changes, combined in one request.
    const glossarySection = document.getElementById('dp-glossary-section');
    if (doc.glossary){
        glossarySection.classList.remove('hidden');
        renderTermGlossary(doc);
    } else {
        glossarySection.classList.add('hidden');
    }

    if (!doc.fields.length){
        list.classList.toggle('hidden', !!doc.glossary);
        if (!doc.glossary){
            const note = document.createElement('div');
            note.className = 'text-[11px] p-3 rounded-lg';
            note.style.cssText = 'background:var(--bg-main);border:1px dashed var(--border-subtle);color:var(--text-muted);line-height:1.9;';
            note.textContent = 'عبارات ثابت این نوع سند هنوز به این بخش اضافه نشده — به‌زودی.';
            list.appendChild(note);
        }
        document.getElementById('dp-save-btn').disabled = !doc.glossary;
        return;
    }
    list.classList.remove('hidden');
    document.getElementById('dp-save-btn').disabled = false;

    doc.fields.forEach(f => {
        const val = dpEffectiveValue(doc.id, f.key, f.def);
        const dirty = !!(dpDraft[doc.id] && dpDraft[doc.id][f.key] !== undefined);
        const card = document.createElement('div');
        card.className = 'p-3 rounded-lg';
        card.style.cssText = `background:var(--bg-main);border:1px solid ${dirty ? 'var(--accent)' : 'var(--border-subtle)'};`;
        card.dataset.dpField = f.key;

        const kindLabel = f.kind === 'complex' ? 'پیچیده' : 'ساده';
        card.innerHTML = `
          <div class="flex items-start justify-between gap-2 mb-1.5">
            <div class="flex items-center gap-1.5 flex-wrap">
              <span class="text-xs font-bold" style="color:var(--text-main);">${f.label}</span>
              <span class="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style="background:${f.kind==='complex' ? 'rgba(248,113,113,.12);color:#f87171' : 'rgba(52,199,89,.12);color:#34c759'};">${kindLabel}</span>
            </div>
            <button class="text-[10px] font-bold px-2 py-1 rounded-md shrink-0" data-dp-reset="${f.key}" ${val === f.def ? 'disabled' : ''} style="background:var(--panel-bg);color:var(--text-muted);border:1px solid var(--border-subtle);">↺ بازنشانی</button>
          </div>
        `;

        if (f.kind === 'complex'){
            const editor = document.createElement('div');
            editor.className = 'dp-token-editor auth-input w-full en';
            editor.contentEditable = 'true';
            editor.dir = 'ltr';
            editor.dataset.dpInput = f.key;
            dpPopulateEditor(editor, val, f.tokens.map(t => t.key));
            card.appendChild(editor);
        } else {
            const ta = document.createElement('textarea');
            ta.className = 'auth-input resize-none w-full en';
            ta.dir = 'ltr';
            ta.style.fontSize = '.72rem';
            ta.rows = Math.min(6, Math.max(2, Math.ceil(val.length / 70)));
            ta.dataset.dpInput = f.key;
            ta.value = val;
            card.appendChild(ta);
        }
        list.appendChild(card);

        if (f.kind === 'complex'){
            dpRenderComplexExtras(card, doc, f, val);
        }
    });
}

function dpRenderComplexExtras(card, doc, f, val){
    const result = dpCheckComplex(val, f.tokens);

    const toolbar = document.createElement('div');
    toolbar.className = 'dp-extra flex flex-wrap items-center gap-1.5 mt-2';
    const ttLabel = document.createElement('span');
    ttLabel.className = 'text-[10px]';
    ttLabel.style.color = 'var(--text-muted)';
    ttLabel.textContent = 'درج دادهٔ سند:';
    toolbar.appendChild(ttLabel);
    f.tokens.forEach(t => {
        const count = (val.match(new RegExp(`\\{\\{${t.key}\\}\\}`, 'g'))||[]).length;
        const present = count === 1;
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'text-[10px] font-mono font-bold px-1.5 py-0.5 rounded';
        b.dir = 'ltr';
        b.style.cssText = present
            ? 'border:1px solid #34c759;color:#34c759;background:rgba(52,199,89,.1);'
            : 'border:1px dashed var(--border-subtle);color:var(--text-muted);background:var(--panel-bg);cursor:pointer;';
        b.dataset.dpInsertToken = t.key;
        b.textContent = (present ? '✓ ' : '') + `{{${t.key}}}`;
        b.title = t.label + (present ? ' — درج شده (برای حذف، روی × کنار آن در متن بزنید)' : ' — کلیک برای درج در محل مکان‌نما');
        if (present) b.disabled = true;
        toolbar.appendChild(b);
    });
    card.appendChild(toolbar);

    const checkRow = document.createElement('div');
    checkRow.className = 'dp-extra text-[10px] font-bold mt-1.5';
    checkRow.style.color = result.valid ? '#34c759' : '#f87171';
    checkRow.textContent = result.valid ? '✓ ساختار عبارت سالم است.' : '! ساختار این عبارت مشکل دارد — ذخیره نمی‌شود.';
    card.appendChild(checkRow);

    if (!result.valid){
        const warn = document.createElement('div');
        warn.className = 'dp-extra text-[10px] mt-1.5 p-2 rounded';
        warn.style.cssText = 'background:rgba(248,113,113,.1);border:1px solid rgba(248,113,113,.3);color:var(--text-main);line-height:1.8;';
        const parts = [];
        if (result.missing.length) parts.push(`⚠ ${result.missing.map(t=>t.label).join('، ')} از این عبارت حذف شده.`);
        if (result.duplicated.length) parts.push(`⚠ ${result.duplicated.map(t=>t.label).join('، ')} بیش از یک‌بار درج شده.`);
        if (result.strayBrace) parts.push(`⚠ یک آکولاد تک در متن دیده می‌شود — احتمالاً تایپی ناقص.`);
        warn.innerHTML = parts.join('<br>');
        card.appendChild(warn);
    }
}

function dpCommitFieldEdit(doc, f, newValue, textareaEl){
    const savedVal = (dpServerPhrases[doc.id] && dpServerPhrases[doc.id][f.key] !== undefined) ? dpServerPhrases[doc.id][f.key] : f.def;
    if (!dpDraft[doc.id]) dpDraft[doc.id] = {};
    if (newValue === savedVal){
        delete dpDraft[doc.id][f.key];
        if (Object.keys(dpDraft[doc.id]).length === 0) delete dpDraft[doc.id];
    } else {
        dpDraft[doc.id][f.key] = newValue;
    }

    const card = textareaEl.closest('[data-dp-field]');
    const dirty = !!(dpDraft[doc.id] && dpDraft[doc.id][f.key] !== undefined);
    card.style.borderColor = dirty ? 'var(--accent)' : 'var(--border-subtle)';
    card.querySelector('[data-dp-reset]').disabled = (newValue === f.def);

    if (f.kind === 'complex'){
        card.querySelectorAll('.dp-extra').forEach(el => el.remove());
        dpRenderComplexExtras(card, doc, f, newValue);
    }
}

document.addEventListener('input', (e) => {
    if (e.target.matches('.dp-token-editor')){
        dpSanitizeEditor(e.target);
        const doc = DP_DOCS.find(d => d.id === dpCurrentDoc);
        const f = doc.fields.find(f => f.key === e.target.dataset.dpInput);
        dpCommitFieldEdit(doc, f, dpSerializeEditor(e.target), e.target);
        return;
    }
    if (!e.target.matches('[data-dp-input]')) return;
    const doc = DP_DOCS.find(d => d.id === dpCurrentDoc);
    const f = doc.fields.find(f => f.key === e.target.dataset.dpInput);
    dpCommitFieldEdit(doc, f, e.target.value, e.target);
});

// Plain-text-only paste into a token editor -- blocks pasted HTML/rich
// formatting, and dpSanitizeEditor() (triggered by the input event this
// produces) strips any brace characters the pasted text happened to
// contain, same as typing them directly would.
document.addEventListener('paste', (e) => {
    if (!e.target.matches('.dp-token-editor')) return;
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text/plain');
    document.execCommand('insertText', false, text);
});

document.addEventListener('click', (e) => {
    const resetBtn = e.target.closest('[data-dp-reset]');
    if (resetBtn){
        const doc = DP_DOCS.find(d => d.id === dpCurrentDoc);
        if (dpDraft[doc.id]) delete dpDraft[doc.id][resetBtn.dataset.dpReset];
        renderDocumentPhrases();
        return;
    }
    const insertBtn = e.target.closest('[data-dp-insert-token]');
    if (insertBtn && !insertBtn.disabled){
        const card = insertBtn.closest('[data-dp-field]');
        const editor = card.querySelector('.dp-token-editor');
        dpInsertChipAtCaret(editor, insertBtn.dataset.dpInsertToken);
        const doc = DP_DOCS.find(d => d.id === dpCurrentDoc);
        const f = doc.fields.find(f => f.key === editor.dataset.dpInput);
        dpCommitFieldEdit(doc, f, dpSerializeEditor(editor), editor);
        return;
    }
    const removeChipBtn = e.target.closest('[data-remove-chip]');
    if (removeChipBtn){
        const chip = removeChipBtn.closest('.dp-token-chip');
        const editor = chip.closest('.dp-token-editor');
        chip.remove();
        const doc = DP_DOCS.find(d => d.id === dpCurrentDoc);
        const f = doc.fields.find(f => f.key === editor.dataset.dpInput);
        dpCommitFieldEdit(doc, f, dpSerializeEditor(editor), editor);
    }
});

async function loadDocumentPhrasesCatalog(){
    populateDocSelect();
    if (!currentUserSession) { renderDocumentPhrases(); return; }
    const token = getToken();
    try {
        const res = await fetch(`${CORE}/users/me/preferences`, { headers: { 'Authorization': `Bearer ${token}` } });
        if (!res.ok) throw new Error();
        const p = await res.json();
        dpServerPhrases = p.document_phrases || {};
        dpGlossaryServer = p.term_glossary || {};
    } catch (e) {
        dpServerPhrases = {};
        dpGlossaryServer = {};
    }
    dpDraft = {};
    dpGlossaryDraft = {};
    renderDocumentPhrases();
}

// Sends whichever of the two settings kinds this document type has pending
// drafts for -- the fixed-field phrase editor (dpDraft) and/or the
// open-ended term glossary (dpGlossaryDraft), e.g. azad_transcript has
// both. Both concerns share one button/status area in the settings markup,
// and are combined into a single PATCH request when both apply (the same
// way Core's own update_preferences() already merges multiple sparse
// fields off one DB round trip).
async function saveCurrentDocumentSettings(){
    if (!currentUserSession) return;
    const doc = DP_DOCS.find(d => d.id === dpCurrentDoc);
    const btn = document.getElementById('dp-save-btn');
    const status = document.getElementById('dp-save-status');
    status.classList.remove('hidden');

    const body = {};
    let blockedCount = 0;

    if (doc.fields.length){
        const changes = dpDraft[doc.id] || {};
        const toSend = {};
        // A complex field with a structurally broken draft value is
        // excluded -- never sent to the backend, and left as-is (with its
        // warning) so the translator can keep fixing it.
        for (const key in changes){
            const f = doc.fields.find(f => f.key === key);
            if (f.kind === 'complex' && !dpCheckComplex(changes[key], f.tokens).valid){
                blockedCount++;
                continue;
            }
            toSend[key] = changes[key] === '' ? null : changes[key];
        }
        if (Object.keys(toSend).length) body.document_phrases = { [doc.id]: toSend };
    }

    if (doc.glossary){
        const changes = dpGlossaryDraft[doc.id] || {};
        const toSend = {};
        for (const term in changes) toSend[term] = changes[term] === '' ? null : changes[term];
        if (Object.keys(toSend).length) body.term_glossary = { [doc.id]: toSend };
    }

    if (Object.keys(body).length === 0){
        status.style.color = '#f87171';
        status.textContent = blockedCount > 0
            ? '❌ عبارت دارای خطای ساختاری را قبل از ذخیره اصلاح کنید.'
            : 'تغییری برای ذخیره وجود ندارد.';
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
            body: JSON.stringify(body)
        });
        const p = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(p.detail || 'خطای سرور');

        let savedCount = 0;
        if (body.document_phrases){
            dpServerPhrases = p.document_phrases || {};
            // Only the fields actually sent (the valid ones) are cleared
            // from the draft -- a blocked complex field stays in draft,
            // with its warning, even though the rest of this save succeeded.
            const sentKeys = Object.keys(body.document_phrases[doc.id]);
            savedCount += sentKeys.length;
            for (const key of sentKeys) delete dpDraft[doc.id][key];
            if (dpDraft[doc.id] && Object.keys(dpDraft[doc.id]).length === 0) delete dpDraft[doc.id];
        }
        if (body.term_glossary){
            dpGlossaryServer = p.term_glossary || {};
            savedCount += Object.keys(body.term_glossary[doc.id]).length;
            delete dpGlossaryDraft[doc.id];
        }

        status.style.color = 'var(--accent)';
        status.textContent = blockedCount > 0
            ? `✅ ${savedCount} مورد ذخیره شد؛ ${blockedCount} مورد دارای خطا ذخیره نشد.`
            : `✅ ${savedCount} مورد ذخیره شد. از سند بعدی اعمال می‌شود.`;
        renderDocumentPhrases();
    } catch (e) {
        status.style.color = '#f87171';
        status.textContent = `❌ ذخیره ناموفق بود: ${e.message || 'خطای نامشخص'}`;
    } finally {
        btn.disabled = false;
    }
}

// ═══════════════════════════════════════════════════════════
// TERM GLOSSARY -- an open-ended Persian-term -> English-equivalent table
// (e.g. academic_transcript's course-name terms), distinct from the
// fixed-field phrase overrides above: any number of arbitrary Persian
// phrases, not just a handful of named fields, so it renders as a
// searchable table with add/remove rather than a fixed card per field.
// Storage shape mirrors document_phrases exactly --
// prefs["term_glossary"][doc_type] = {persian_term: english_equivalent}
// -- see DeepT-Core's preferences.py and DeepT-Back-End's
// doc_prefs.get_term_glossary().
// ═══════════════════════════════════════════════════════════

// Every term this document type currently has an opinion about (its own
// built-in defaults, plus whatever the translator already saved), each
// resolved to its effective display value: an unsaved draft edit first,
// then a saved override, then the document type's own default. A draft
// value of '' (the translator cleared the input) still renders as blank
// here -- same convention dpEffectiveValue()/the phrase editor already
// use elsewhere -- it only actually clears the saved override once sent.
function dpGlossaryRows(doc){
    const defaults = doc.glossary.defaults || {};
    const server = dpGlossaryServer[doc.id] || {};
    const draft = dpGlossaryDraft[doc.id] || {};
    const terms = new Set([...Object.keys(defaults), ...Object.keys(server), ...Object.keys(draft)]);
    const rows = [];
    terms.forEach(term => {
        const isDefault = Object.prototype.hasOwnProperty.call(defaults, term);
        let value;
        if (draft[term] !== undefined) value = draft[term];
        else if (server[term] !== undefined) value = server[term];
        else value = defaults[term];
        const savedVal = server[term] !== undefined ? server[term] : (isDefault ? defaults[term] : undefined);
        const dirty = draft[term] !== undefined && draft[term] !== savedVal;
        rows.push({ term, value, isDefault, dirty, hasOverride: server[term] !== undefined });
    });
    rows.sort((a, b) => a.term.localeCompare(b.term, 'fa'));
    return rows;
}

function renderTermGlossary(doc){
    const rowsEl = document.getElementById('dp-glossary-rows');
    rowsEl.innerHTML = '';
    const q = dpGlossarySearch.trim();
    const rows = dpGlossaryRows(doc).filter(r =>
        !q || r.term.includes(q) || r.value.toLowerCase().includes(q.toLowerCase())
    );

    if (!rows.length){
        const note = document.createElement('div');
        note.className = 'text-[11px] p-3 rounded-lg';
        note.style.cssText = 'background:var(--bg-main);border:1px dashed var(--border-subtle);color:var(--text-muted);';
        note.textContent = q ? 'موردی با این عبارت جستجو پیدا نشد.' : 'هیچ واژه‌ای ثبت نشده است.';
        rowsEl.appendChild(note);
        return;
    }

    rows.forEach(r => {
        const row = document.createElement('div');
        row.className = 'flex items-center gap-2 p-2 rounded-lg';
        row.style.cssText = `background:var(--bg-main);border:1px solid ${r.dirty ? 'var(--accent)' : 'var(--border-subtle)'};`;
        row.dataset.dpGlossaryTerm = r.term;

        const termLabel = document.createElement('div');
        termLabel.className = 'text-xs font-bold shrink-0';
        termLabel.style.cssText = 'color:var(--text-main);width:9rem;';
        termLabel.textContent = r.term;
        row.appendChild(termLabel);

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'auth-input w-full en';
        input.style.cssText = 'font-size:.72rem;';
        input.dir = 'ltr';
        input.value = r.value;
        input.dataset.dpGlossaryInput = r.term;
        row.appendChild(input);

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'text-[10px] font-bold px-2 py-1 rounded-md shrink-0';
        btn.style.cssText = 'background:var(--panel-bg);color:var(--text-muted);border:1px solid var(--border-subtle);';
        btn.dataset.dpGlossaryRemove = r.term;
        btn.textContent = r.isDefault ? '↺ بازنشانی' : '🗑 حذف';
        // Nothing to undo on an untouched default term: no saved override,
        // no pending edit.
        btn.disabled = !r.dirty && !r.hasOverride;
        row.appendChild(btn);

        rowsEl.appendChild(row);
    });
}

function dpCommitGlossaryTerm(doc, term, newValue){
    const server = dpGlossaryServer[doc.id] || {};
    const isDefault = Object.prototype.hasOwnProperty.call(doc.glossary.defaults, term);
    const savedVal = server[term] !== undefined ? server[term] : (isDefault ? doc.glossary.defaults[term] : undefined);
    if (!dpGlossaryDraft[doc.id]) dpGlossaryDraft[doc.id] = {};
    if (newValue === savedVal){
        delete dpGlossaryDraft[doc.id][term];
        if (Object.keys(dpGlossaryDraft[doc.id]).length === 0) delete dpGlossaryDraft[doc.id];
    } else {
        dpGlossaryDraft[doc.id][term] = newValue;
    }
}

document.addEventListener('input', (e) => {
    if (e.target.matches('[data-dp-glossary-input]')){
        const doc = DP_DOCS.find(d => d.id === dpCurrentDoc);
        dpCommitGlossaryTerm(doc, e.target.dataset.dpGlossaryInput, e.target.value);
        const row = e.target.closest('[data-dp-glossary-term]');
        const draft = dpGlossaryDraft[doc.id];
        const dirty = !!(draft && draft[e.target.dataset.dpGlossaryInput] !== undefined);
        row.style.borderColor = dirty ? 'var(--accent)' : 'var(--border-subtle)';
        return;
    }
    if (e.target.id === 'dp-glossary-search'){
        dpGlossarySearch = e.target.value;
        const doc = DP_DOCS.find(d => d.id === dpCurrentDoc);
        renderTermGlossary(doc);
    }
});

document.addEventListener('click', (e) => {
    const removeBtn = e.target.closest('[data-dp-glossary-remove]');
    if (removeBtn){
        const doc = DP_DOCS.find(d => d.id === dpCurrentDoc);
        dpCommitGlossaryTerm(doc, removeBtn.dataset.dpGlossaryRemove, '');
        renderTermGlossary(doc);
        return;
    }
    if (e.target.id === 'dp-glossary-add-btn'){
        const doc = DP_DOCS.find(d => d.id === dpCurrentDoc);
        const termInput = document.getElementById('dp-glossary-new-term');
        const englishInput = document.getElementById('dp-glossary-new-english');
        const term = termInput.value.trim();
        const english = englishInput.value.trim();
        const status = document.getElementById('dp-glossary-add-status');
        if (!term || !english){
            status.textContent = 'هر دو فیلد را پر کنید.';
            status.classList.remove('hidden');
            return;
        }
        status.classList.add('hidden');
        dpCommitGlossaryTerm(doc, term, english);
        termInput.value = '';
        englishInput.value = '';
        renderTermGlossary(doc);
    }
});

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

// ═══════════════════════════════════════════════════════════
// WALLET
// ═══════════════════════════════════════════════════════════
/* ============ SECTION: WALLET, PAYMENT & SUPPORT ============
   Shaparak gateway redirect + wallet balance refresh + support tickets. ============ */
function triggerShaparakPayment() {
    // Real payment isn't live yet -- during the trial, credit is added
    // manually by the admin. No self-service top-up exists on the frontend
    // at all right now; this replaces the old fake simulator, which showed
    // a fabricated number disconnected from the real backend balance.
    showToast('برای افزایش اعتبار با پشتیبانی تماس بگیرید.');
}

async function refreshWalletBalanceDisplay() {
    if (!currentUserSession) return;
    const token = localStorage.getItem('deept_token');
    const userId = localStorage.getItem('deept_user_id');
    try {
        const res = await fetch(`${CORE}/wallet/${userId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
            const data = await res.json();
            document.getElementById('walletBalanceDisplay').textContent = data.balance_toman.toLocaleString();
        }
    } catch (e) { /* leave last-known display value on transient network failure */ }
}
function submitSupportTicket() {
    const text = document.getElementById('supportTicketMsg').value;
    if (!text) return;
    showToast('📩 پیام شما ثبت شد.');
    document.getElementById('supportTicketMsg').value = '';
}

// ═══════════════════════════════════════════════════════════
// WORKSPACE DASHBOARD
// ═══════════════════════════════════════════════════════════
/* ============ SECTION: VIEW NAVIGATION (workspace/clients/landing) ============ */
async function openWorkspaceDashboard(pushHistory = true) {
    if (!currentUserSession) { openAuthModal(); return; }
    const hb = document.querySelector('.header-bar');
    if (hb) hb.classList.remove('hidden');
    // landingPage defaults to visible in the static HTML -- hide it here so
    // a refresh / deep link to an authenticated view doesn't leave the
    // landing header + content rendered underneath the dashboard.
    const lp = document.getElementById('landingPage');
    if (lp) lp.style.display = 'none';
    const dashboardEl = document.getElementById('workspaceDashboard');
    dashboardEl.classList.remove('hidden');
    dashboardEl.scrollTop = 0;
    document.getElementById('clientsWorkspace').classList.add('hidden');
    document.getElementById('adminDashboard').classList.add('hidden');
    document.getElementById('clientProfilePage').classList.add('hidden');
    document.getElementById('workSchedulePage').classList.add('hidden');
    document.getElementById('settingsPage').classList.add('hidden');
    document.getElementById('myPriceListPage').classList.add('hidden');

    // Reserve exactly as much top space as the header actually needs,
    // measured live -- more reliable than a fixed padding guess, since it
    // stays correct even if the header's real height ever changes.
    const headerEl = document.querySelector('.header-bar');
    if (headerEl) {
        dashboardEl.style.paddingTop = (headerEl.offsetHeight + 16) + 'px';
    }

    document.body.style.overflow = 'hidden';
    await renderDashboardActiveProjects();
    refreshWalletBalanceDisplay();
    if (pushHistory) navigateTo('/dashboard');
}

// Separate top-level section from the translation-projects dashboard above --
// kept in sync through shared data only: clients come from confirmed
// passport_session identities, and a client's job history is read straight
// from translation_jobs via client_id, not duplicated anywhere.
async function openClientsWorkspace(pushHistory = true) {
    if (!currentUserSession) { openAuthModal(); return; }
    const hb = document.querySelector('.header-bar');
    if (hb) hb.classList.remove('hidden');
    // Same fix as openWorkspaceDashboard() above.
    const lp = document.getElementById('landingPage');
    if (lp) lp.style.display = 'none';
    const el = document.getElementById('clientsWorkspace');
    el.classList.remove('hidden');
    el.scrollTop = 0;
    document.getElementById('workspaceDashboard').classList.add('hidden');
    document.getElementById('adminDashboard').classList.add('hidden');
    document.getElementById('clientProfilePage').classList.add('hidden');
    document.getElementById('workSchedulePage').classList.add('hidden');
    document.getElementById('settingsPage').classList.add('hidden');
    document.getElementById('myPriceListPage').classList.add('hidden');

    const headerEl = document.querySelector('.header-bar');
    if (headerEl) {
        el.style.paddingTop = (headerEl.offsetHeight + 16) + 'px';
    }

    document.body.style.overflow = 'hidden';
    renderDashboardClients();
    if (pushHistory) navigateTo('/clients');
}

function closeClientsWorkspace(pushHistory = true) {
    document.getElementById('clientsWorkspace').classList.add('hidden');
    document.body.style.overflow = 'auto';
    showLandingView();
    if (pushHistory) navigateTo('/');
}

function showLandingView() {
    const lp = document.getElementById('landingPage');
    if (lp) lp.style.display = '';
    const hb = document.querySelector('.header-bar');
    if (hb) hb.classList.add('hidden');
    const wd = document.getElementById('workspaceDashboard');
    if (wd) wd.classList.add('hidden');
    const ad = document.getElementById('adminDashboard');
    if (ad) ad.classList.add('hidden');
    const cw = document.getElementById('clientsWorkspace');
    if (cw) cw.classList.add('hidden');
    const pp = document.getElementById('clientProfilePage');
    if (pp) pp.classList.add('hidden');
    const sp = document.getElementById('workSchedulePage');
    if (sp) sp.classList.add('hidden');
    const st = document.getElementById('settingsPage');
    if (st) st.classList.add('hidden');
    const pl = document.getElementById('myPriceListPage');
    if (pl) pl.classList.add('hidden');
    document.body.style.overflow = 'auto';
}

function closeWorkspaceDashboard(pushHistory = true) {
    document.getElementById('workspaceDashboard').classList.add('hidden');
    document.body.style.overflow = 'auto';
    showLandingView();
    if (pushHistory) navigateTo('/');
}
let allJobsTerminal = false;

/* ============ SECTION: DASHBOARD — ACTIVE PROJECTS ============
   Renders the translation-jobs table (id: projectDashboardRowsBlock). ============ */
async function renderDashboardActiveProjects() {
    const tbody = document.getElementById('projectDashboardRowsBlock');
    if (!currentUserSession) return;

    const token  = localStorage.getItem('deept_token');
    const userId = localStorage.getItem('deept_user_id');

    let jobs = [];
    try {
        const res = await fetch(`${CORE}/jobs?user_id=${userId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) jobs = await res.json();
    } catch (e) { /* keep whatever was last rendered on a transient failure */ }

    allJobsTerminal = jobs.length > 0 && jobs.every(j => j.status === 'completed' || j.status === 'failed');

    tbody.innerHTML = '';
    if (!jobs.length) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-center py-8 text-sm" style="color:var(--text-muted);">// بدون پروژه فعال</td></tr>`;
        return;
    }

    const STATUS_LABELS = {
        queued:     { text: 'در صف',      color: '#94a3b8' },
        processing: { text: 'در حال پردازش', color: '#fb923c' },
        completed:  { text: 'آماده',      color: '#4ade80' },
        failed:     { text: 'ناموفق',     color: '#f87171' },
    };

    jobs.forEach((job) => {
        const typeLabel = DOCUMENT_REGISTRY[job.document_type]?.label || escapeHtml(job.document_type);
        const dateStr = new Date(job.created_at).toLocaleDateString('fa-IR');
        const st = STATUS_LABELS[job.status] || { text: escapeHtml(job.status), color: 'var(--text-muted)' };

        let actionsHtml;
        if (job.status === 'completed') {
            actionsHtml = `<button onclick="downloadJobResult('${job.id}')" class="font-bold hover:underline" style="color:var(--accent);">دانلود DOCX</button>`;
        } else if (job.status === 'failed') {
                        actionsHtml = `<span style="color:#f87171;font-size:11px;">${escapeHtml(job.error_message) || 'خطا رخ داد'}</span>`;
        } else {
            actionsHtml = `<span style="color:var(--text-muted);">در حال پردازش...</span>`;
        }

        const row = document.createElement('tr');
        row.innerHTML = `
            <td class="py-3 text-right">
                <div class="font-black en" style="color:var(--text-main);">${job.id.slice(0,8)}</div>
                                <div class="text-[10px] truncate max-w-[170px]" style="color:var(--text-muted);">${escapeHtml(job.original_filename)}</div>
            </td>
            <td class="py-3 text-center font-bold" style="color:var(--accent);">
                ${typeLabel}
                <div class="text-[10px] font-normal" style="color:var(--text-muted);">${job.price_toman ? job.price_toman.toLocaleString() + ' تومان' : ''}</div>
            </td>
            <td class="py-3 text-center" style="color:var(--text-muted);">${dateStr}</td>
            <td class="py-3 text-center"><span style="color:${st.color};font-weight:700;">${st.text}</span></td>
            <td class="py-3 text-left text-xs">${actionsHtml}</td>`;
        tbody.appendChild(row);
    });
}

// ═══════════════════════════════════════════════════════════
// DASHBOARD — MY CLIENTS
// ═══════════════════════════════════════════════════════════
let dashboardClientsDebounce = null;
function searchDashboardClients(q) {
    clearTimeout(dashboardClientsDebounce);
    dashboardClientsDebounce = setTimeout(() => renderDashboardClients(q), 250);
}

async function renderDashboardClients(q = '') {
    const box = document.getElementById('dashboardClientsList');
    if (!box) return;
    box.innerHTML = `<div class="text-xs text-center py-6" style="color:var(--text-muted);">در حال بارگذاری...</div>`;
    const token = localStorage.getItem('deept_token');
    try {
        const url = new URL(`${CORE}/clients`);
        if (q) url.searchParams.set('q', q);
        const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
        if (!res.ok) throw new Error();
        const clients = await res.json();
        if (!clients.length) {
            box.innerHTML = `<div class="text-xs text-center py-6" style="color:var(--text-muted);">// هنوز مشتری‌ای ثبت نشده</div>`;
            return;
        }
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
                                ${enName(c) && enName(c) !== displayName(c) ? `<div class="text-[11px] en" style="color:var(--text-muted);">${escapeHtml(enName(c))}</div>` : ''}
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
    } catch (e) {
        box.innerHTML = `<div class="text-xs text-center py-6" style="color:#f87171;">خطا در دریافت لیست مشتریان.
            <button onclick="renderDashboardClients('${(q || '').replace(/'/g,"")}')" class="block mx-auto mt-2 text-[11px] font-bold px-3 py-1 rounded-lg" style="background:var(--card-surface);color:var(--accent);border:1px solid var(--border-color);">🔄 تلاش مجدد</button>
        </div>`;
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
        const hasJob = checked.some(r => r.type === 'job');
        const deleteBtn = document.getElementById(`${prefix}-activity-bulk-delete`);
        if (deleteBtn) {
            deleteBtn.disabled = hasJob;
            deleteBtn.title = hasJob ? 'رکوردهای ترجمه قابل حذف نیستند -- فقط رکوردهای سنام حذف‌شدنی‌اند.' : '';
        }
        // Editing multiple different rows' fields in one form doesn't make
        // sense -- only enabled for exactly one checked row.
        const editBtn = document.getElementById(`${prefix}-activity-bulk-edit`);
        if (editBtn) {
            editBtn.disabled = checked.length !== 1;
            editBtn.title = checked.length !== 1 ? 'برای ویرایش، فقط یک مورد را انتخاب کنید.' : '';
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
    if (checked.length !== 1) return;
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

// ═══════════════════════════════════════════════════════════════════════
// FULL-WINDOW CLIENT PROFILE (CRM layout) + FULL-WINDOW WORK SCHEDULE
// (برنامه کاری دفتر). These replace the cramped modal with a HubSpot-style
// three-column client screen and a dedicated office-wide weekly calendar.
// ═══════════════════════════════════════════════════════════════════════

/* ============ SECTION: VIEW SHOW/HIDE + FULL-WINDOW VIEWS ============
   showFullView toggles the fixed overlay screens; hideWorkspaceViews resets. ============ */
function hideWorkspaceViews() {
    // landingPage defaults to visible and is only ever explicitly hidden
    // by showDashboardView()/showAdminDashboard() -- any authenticated
    // view reached directly (a reload, or a deep link via
    // applyRouteForPath) skipped that step and left the landing page's
    // own header/content showing underneath, e.g. on /settings, /schedule
    // and /clients/:id, all of which route through this function.
    const lp = document.getElementById('landingPage');
    if (lp) lp.style.display = 'none';
    ['workspaceDashboard', 'clientsWorkspace', 'adminDashboard',
     'clientProfilePage', 'workSchedulePage', 'settingsPage', 'myPriceListPage', 'hrPage'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
    });
}

function showFullView(id) {
    hideWorkspaceViews();
    const headerEl = document.querySelector('.header-bar');
	if (headerEl) headerEl.classList.remove('hidden');
    const el = document.getElementById(id);
    el.classList.remove('hidden');
    el.scrollTop = 0;
    if (headerEl) el.style.paddingTop = (headerEl.offsetHeight + 16) + 'px';
    document.body.style.overflow = 'hidden';
}

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
            await renderDashboardClients();
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

// ── Full-window settings page: translation preferences (font, header/
// certification wording, date format) and per-document-type phrase
// overrides. Previously crammed into the dashboard's narrow sidebar
// column; moved here so both settings cards get real room to breathe.
/* ============ SECTION: SETTINGS (translation pref + phrases) ============ */
function openSettingsPage(pushHistory = true) {
    if (!currentUserSession) { openAuthModal(); return; }
    showFullView('settingsPage');
    if (pushHistory) navigateTo('/settings');
    loadPreferences();
    loadDocumentPhrasesCatalog();
}

function closeSettingsPage() {
    document.getElementById('settingsPage').classList.add('hidden');
    document.body.style.overflow = 'auto';
    openWorkspaceDashboard(false);
}

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
        renderDashboardClients();
    } catch (err) {
        status.style.color = '#f87171';
        status.textContent = `❌ ${err.message || 'بارگذاری فایل سنام ناموفق بود.'}`;
    } finally {
        btn.disabled = false;
        btn.textContent = 'انتخاب فایل اکسل...';
        document.getElementById('sanamFileInput').value = '';
    }
}

async function downloadJobResult(jobId) {
    const token = localStorage.getItem('deept_token');
    try {
        const res = await fetch(`${CORE}/jobs/${jobId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) { showToast('خطا در دریافت فایل.'); return; }
        const job = await res.json();
        if (!job.result_file_b64) {
            if (job.status === 'completed') {
                showToast('فایل منقضی شده و حذف شده است. لطفاً سند را دوباره ارسال کنید.');
            } else {
                showToast('فایل هنوز آماده نیست.');
            }
            return;
        }

        const byteChars = atob(job.result_file_b64);
        const byteNumbers = new Array(byteChars.length);
        for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });

        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = job.result_filename || 'Translated.docx';
        document.body.appendChild(a); a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast('✅ فایل دانلود شد.');
    } catch (e) {
        showToast('خطا در دانلود فایل.');
    }
}
function purgeFile(idx) {
    if (confirm('حذف کامل این فایل؟')) {
        trackingProjectsDatabase.splice(idx, 1);
        renderDashboardActiveProjects();
        showToast('🗑️ فایل حذف شد.');
    }
}
setInterval(async () => {
    if (allJobsTerminal) return;
    if (!document.getElementById('workspaceDashboard').classList.contains('hidden')) await renderDashboardActiveProjects();
}, 30000);

// ═══════════════════════════════════════════════════════════
// URL ROUTING — keeps the address bar in sync with the visible view
// ═══════════════════════════════════════════════════════════
/* ============ SECTION: SPA ROUTING ============
   applyRouteForPath reads location.pathname; popstate + 404 redirect hook in.
   (The 404.html stash + this handler together drive the dashboard route.) ============ */
function navigateTo(path, pushHistory = true) {
    if (pushHistory && location.pathname !== path) {
        history.pushState({ path }, '', path);
    }
    // applyRouteForPath(path);
}

// Applies whichever view a given path represents, WITHOUT touching
// history -- used both by popstate and by the initial page load, so a
// direct visit or refresh on /dashboard lands on the right screen.
function applyRouteForPath(path) {

    if (path === '/dashboard' || path === '/new-project' || path === '/clients') {

        if (currentUserSession) {

            if (path === '/clients') {
                openClientsWorkspace(false);
            } else {
                openWorkspaceDashboard(false);

                if (path === '/new-project') {
                    openChatInterface(false);
                }
            }

        } else {
            navigateTo('/', false);
            showLandingView();
            openLogin();
            showToast('برای دسترسی به این بخش، ابتدا وارد شوید.');
        }

    } else if (path === '/schedule') {

        if (currentUserSession) {
            openWorkSchedulePage();
        } else {
            navigateTo('/', false);
            showLandingView();
            openLogin();
            showToast('برای دسترسی به این بخش، ابتدا وارد شوید.');
        }

    } else if (/^\/clients\/[^/]+$/.test(path)) {

        const clientId = path.split('/')[2];

        if (currentUserSession) {
            openClientProfile(clientId);
        } else {
            navigateTo('/', false);
            showLandingView();
            openLogin();
            showToast('برای دسترسی به این بخش، ابتدا وارد شوید.');
        }

    } else if (path === '/settings') {

        if (currentUserSession) {
            openSettingsPage(false);
        } else {
            navigateTo('/', false);
            showLandingView();
            openLogin();
            showToast('برای دسترسی به این بخش، ابتدا وارد شوید.');
        }

    } else if (path === '/price-list') {

        if (currentUserSession) {
            openMyPriceListPage(false);
        } else {
            navigateTo('/', false);
            showLandingView();
            openLogin();
            showToast('برای دسترسی به این بخش، ابتدا وارد شوید.');
        }

    } else if (path === '/hr') {

        if (currentUserSession) {
            openHrPage(false);
        } else {
            navigateTo('/', false);
            showLandingView();
            openLogin();
            showToast('برای دسترسی به این بخش، ابتدا وارد شوید.');
        }

    } else if (path === '/login') {

        showLandingView();
        openLogin();

    } else if (path === '/admin') {

        if (currentUserSession) {
            // Non-admins have no admin view -- send them to their dashboard
            // instead of leaving them on a blank/landing screen.
            if (localStorage.getItem('deept_is_admin') === '1') {
                showAdminDashboard();
            } else {
                openWorkspaceDashboard(false);
            }
        } else {
            navigateTo('/', false);
            showLandingView();
            openLogin();
            showToast('برای دسترسی به این بخش، ابتدا وارد شوید.');
        }

    } else {

        // Root / unknown route
        if (currentUserSession) {
            openWorkspaceDashboard(false);
        } else {
            showLandingView();
        }
    }
}
window.addEventListener('popstate', () => {
    applyRouteForPath(location.pathname);
});
// ═══════════════════════════════════════════════════════════
// CHAT MODAL — open/close
// ═══════════════════════════════════════════════════════════
/* ============ SECTION: TRANSLATION PIPELINE (chat modal) ============
   Stages: doc type -> passport -> document; multi-passport; chunk upload. ============ */
// forceStage lets a caller override the usual "resume where the passport
// step left off" guess -- needed by openChatForClient(), which populates
// confirmedPassports from a saved client profile BEFORE the doctype has
// ever been picked in this session; without it, a non-empty
// confirmedPassports would (correctly, for every OTHER caller here) jump
// straight past doctype selection into the document-upload stage.
function openChatInterface(pushHistory = true, forceStage = null) {
    document.getElementById('chatModal').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    if (forceStage) {
        showOnlyStage(forceStage);
    } else if (confirmedPassports.length > 0) {
        showOnlyStage('document');
    } else {
        showOnlyStage('doctype');
    }
    if (pushHistory) navigateTo('/new-project');
}
function closeChatInterface(pushHistory = true) {
    document.getElementById('chatModal').classList.add('hidden');
    if (document.getElementById('workspaceDashboard').classList.contains('hidden')) {
        document.body.style.overflow = 'auto';
    }
    if (pushHistory) navigateTo('/dashboard');
}
// Single source of truth for stage visibility -- always shows exactly one
// of the three stages, never a partial/mixed state. Every stage transition
// in the app should go through this function, not toggle classes directly.
function showOnlyStage(stage) {
    // stage: 'doctype' | 'passport' | 'document'
    document.getElementById('docTypeStageHeader').classList.toggle('hidden', stage !== 'doctype');
    document.getElementById('docTypeStageBody').classList.toggle('hidden', stage !== 'doctype');
    document.getElementById('docTypeStageSummary').classList.toggle('hidden', stage === 'doctype');
    document.getElementById('step1Panel').classList.toggle('hidden', stage !== 'passport');
    document.getElementById('passportStageSummary').classList.toggle('hidden', stage !== 'document');
    if (stage === 'document') {
        document.getElementById('passportSummaryLabel').textContent =
            confirmedPassports.length > 0
                ? confirmedPassports.map(p => `${p.first_name} ${p.last_name}`).join('، ')
                : 'بدون پاسپورت';
    }
        document.getElementById('step2Panel').classList.toggle('hidden', stage !== 'document');
    if (stage === 'document') {
        const currentDocType = document.getElementById('docTemplate').value;
        document.getElementById('courseCodesToggleWrap').classList.toggle('hidden', currentDocType !== 'academic-transcript');
    }
}

// ═══════════════════════════════════════════════════════════
// STEP 1 — PASSPORT SESSION
// ═══════════════════════════════════════════════════════════
/* ============ SECTION: PASSPORT STEPS EXTRACTION ============
   Upload / existing-client / manual / skip modes; session confirm + save. ============ */
function ppSetMode(mode) {
    ppCurrentMode = mode;
    // Hide all sub-sections first
    document.getElementById('pp-upload-zone').classList.add('hidden');
    document.getElementById('pp-fields').classList.add('hidden');
    document.getElementById('pp-skip-confirm').classList.add('hidden');
    document.getElementById('pp-existing-client').classList.add('hidden');
    ppShowStatus('','');

    if (mode === 'upload') {
        document.getElementById('pp-upload-zone').classList.remove('hidden');
    } else if (mode === 'manual') {
        ppClearFields();
        document.getElementById('pp-fields').classList.remove('hidden');
    } else if (mode === 'skip') {
        document.getElementById('pp-skip-confirm').classList.remove('hidden');
    } else if (mode === 'existing') {
        document.getElementById('pp-existing-client').classList.remove('hidden');
        ppSearchExistingClients('');
    }
}

// ── "Select existing client" — reuse a saved client's identity ──────────────
let ppClientSearchDebounce = null;
function ppSearchExistingClients(q) {
    clearTimeout(ppClientSearchDebounce);
    ppClientSearchDebounce = setTimeout(() => ppFetchExistingClients(q), 250);
}

async function ppFetchExistingClients(q) {
    const box = document.getElementById('pp-client-results');
    box.innerHTML = `<div class="text-xs text-center py-3" style="color:var(--text-muted);">در حال بارگذاری...</div>`;
    const token = localStorage.getItem('deept_token');
    try {
        const url = new URL(`${CORE}/clients`);
        if (q) url.searchParams.set('q', q);
        const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
        if (!res.ok) throw new Error();
        const clients = await res.json();
        if (!clients.length) {
            box.innerHTML = `<div class="text-xs text-center py-3" style="color:var(--text-muted);">مشتری‌ای یافت نشد.</div>`;
            return;
        }
        box.innerHTML = clients.map(c => `
            <button onclick="ppSelectExistingClient('${c.id}')" class="w-full flex items-center justify-between p-2.5 rounded-lg text-right transition" style="background:var(--bg-main);border:1px solid var(--border-subtle);" onmouseover="this.style.borderColor='var(--accent)'" onmouseout="this.style.borderColor='var(--border-subtle)'">
                <span>
                    <div class="font-bold text-sm en" style="color:var(--text-main);">${escapeHtml(c.first_name)} ${escapeHtml(c.last_name)}</div>
                    <div class="text-[11px] en" style="color:var(--text-muted);">کد ملی: ${escapeHtml(c.national_id) || '—'}</div>
                </span>
                <span style="color:var(--accent);font-size:.7rem;font-weight:700;">انتخاب ←</span>
            </button>
        `).join('');
    } catch (e) {
        box.innerHTML = `<div class="text-xs text-center py-3" style="color:#f87171;">خطا در دریافت لیست مشتریان.</div>`;
    }
}

async function ppSelectExistingClient(clientId) {
    ppShowStatus('⏳', 'در حال بارگذاری اطلاعات مشتری...');
    const token = localStorage.getItem('deept_token');
    try {
        const res = await fetch(`${getActiveBackendOrigin()}/passport/from-client/${clientId}`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e.detail || 'خطای سرور'); }
        const data = await res.json();
        const idn = data.identity || {};
        confirmedPassports.push({
            session_id:    data.session_id,
            first_name:    idn.first_name    || '',
            last_name:     idn.last_name     || '',
            father_name:   idn.father_name   || '',
            date_of_birth: idn.date_of_birth || '',
        });
        selectedClientId = clientId;
        // The first person established this session (whether picked from
        // the list or freshly confirmed) is the main contact -- anyone
        // confirmed afterward attaches to them as a نفر مرتبط instead of
        // becoming a separate client.
        if (!mainContactClientId) {
            mainContactClientId = clientId;
            mainContactNationalId = idn.national_id || null;
        }
        updateClientBadge();
        document.getElementById('pp-existing-client').classList.add('hidden');
        ppShowStatus('', '');
        showToast(`✅ ${idn.first_name} ${idn.last_name} انتخاب شد — بدون بارگذاری پاسپورت`);
    } catch (err) {
        ppShowStatus('❌', 'دریافت اطلاعات مشتری ناموفق بود.');
    }
}

function ppShowStatus(icon, text) {
    const bar = document.getElementById('pp-status');
    if (!text) { bar.classList.add('hidden'); return; }
    bar.classList.remove('hidden');
    document.getElementById('pp-status-icon').textContent = icon;
    document.getElementById('pp-status-text').textContent = text;
}

function ppClearFields() {
    ['pp-first','pp-last','pp-first-fa','pp-last-fa','pp-father','pp-dob','pp-national'].forEach(id => document.getElementById(id).value = '');
}

function ppFillFields(data) {
    document.getElementById('pp-first').value    = data.first_name    || '';
    document.getElementById('pp-last').value     = data.last_name     || '';
    document.getElementById('pp-first-fa').value = data.first_name_fa || '';
    document.getElementById('pp-last-fa').value  = data.last_name_fa  || '';
    document.getElementById('pp-father').value   = data.father_name   || '';
    document.getElementById('pp-dob').value      = data.date_of_birth || '';
    document.getElementById('pp-national').value = data.national_id   || '';
}

function ppHandleFile(file) {
    if (!file) return;
    ppSelectedFile = file;
    document.getElementById('pp-file-name').textContent = `📎 ${file.name}`;
    document.getElementById('pp-file-name').classList.remove('hidden');
    document.getElementById('pp-drop-text').classList.add('hidden');
    document.getElementById('pp-extract-btn').disabled = false;
}

// Drag and drop on passport zone
const ppDropZoneEl = document.getElementById('pp-drop-zone');
if (ppDropZoneEl) {
    ppDropZoneEl.addEventListener('dragover', e => { e.preventDefault(); ppDropZoneEl.classList.add('drag-over'); });
    ppDropZoneEl.addEventListener('dragleave', () => ppDropZoneEl.classList.remove('drag-over'));
    ppDropZoneEl.addEventListener('drop', e => {
        e.preventDefault();
        ppDropZoneEl.classList.remove('drag-over');
        if (e.dataTransfer.files.length) ppHandleFile(e.dataTransfer.files[0]);
    });
}

async function ppRunExtraction() {
    if (!ppSelectedFile) return;
    const btn = document.getElementById('pp-extract-btn');
    btn.disabled = true;
    btn.textContent = 'استخراج اطلاعات';
    ppShowStatus('⏳', 'در حال ارسال به DeepT...');

    const fd = new FormData();
    fd.append('file', ppSelectedFile);

    try {
        const res = await fetch(`${getActiveBackendOrigin()}/passport/extract`, { method:'POST', body:fd });
        if (!res.ok) { const e = await res.json(); throw new Error(e.detail || 'خطای سرور'); }
        const data = await res.json();
        // Show fields pre-filled for review
        document.getElementById('pp-upload-zone').classList.add('hidden');
        ppFillFields(data);
        ppShowStatus('✅', 'اطلاعات استخراج شد — بررسی و تأیید کنید.');
        document.getElementById('pp-fields').classList.remove('hidden');
    } catch (err) {
        ppShowStatus('❌', 'استخراج اطلاعات ناموفق بود. لطفاً پس از مدتی دوباره تلاش کنید.');
        btn.disabled = false;
        btn.textContent = 'در حال استخراج اطلاعات';
    }
}

async function ppConfirmSession() {
    const first    = document.getElementById('pp-first').value.trim().toUpperCase();
    const last     = document.getElementById('pp-last').value.trim().toUpperCase();
    const firstFa  = document.getElementById('pp-first-fa').value.trim();
    const lastFa   = document.getElementById('pp-last-fa').value.trim();
    const father   = document.getElementById('pp-father').value.trim().toUpperCase();
    const dob      = document.getElementById('pp-dob').value.trim();
    const national = document.getElementById('pp-national').value.trim();

    if (!first || !last) { showToast('⚠️ نام و نام خانوادگی الزامی است.'); return; }

    ppShowStatus('⏳', 'در حال ثبت جلسه...');

    try {
        const res = await fetch(`${getActiveBackendOrigin()}/passport/confirm`, {
            method: 'POST',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ first_name:first, last_name:last, first_name_fa:firstFa, last_name_fa:lastFa, father_name:father, date_of_birth:dob, national_id:national })
        });
        if (!res.ok) { const e = await res.json(); throw new Error(e.detail || 'خطای سرور'); }
        const data = await res.json();

        confirmedPassports.push({ session_id:data.session_id, first_name:first, last_name:last, first_name_fa:firstFa, last_name_fa:lastFa, father_name:father, date_of_birth:dob, national_id:national });
        updateClientBadge();
document.getElementById('pp-fields').classList.add('hidden');
document.getElementById('ppModeButtons').classList.add('hidden');
ppShowStatus('', '');
        showToast(`✅ پاسپورت ${first} ${last} ثبت شد (مجموع: ${confirmedPassports.length} نفر)`);

        // Identity is stored in the profile the moment it's confirmed --
        // no separate "save as client" step needed when a national ID was
        // captured. Silent on success; a client without a national ID (a
        // foreign passport, or the field left blank) simply isn't
        // auto-saved -- the manual "💾 ذخیره مشتری" button on the
        // confirmed-passports list still covers that case once one is typed in.
        if (national) {
            saveOrAttachClient({ first_name:first, last_name:last, first_name_fa:firstFa, last_name_fa:lastFa, father_name:father, date_of_birth:dob, national_id:national, session_id:data.session_id });
        }
    } catch (err) {
        ppShowStatus('❌', 'ثبت اطلاعات ناموفق بود. لطفاً دوباره تلاش کنید.');
    }
}

// Auto-persists a confirmed identity -- called right after every passport
// confirmation that has a national ID, so "no need to upload passport next
// time" holds without any extra click. The FIRST identity saved this
// session becomes the main contact; anyone confirmed afterward (a spouse,
// a child -- documents often arrive together for a family) attaches to
// that same profile as a نفر مرتبط instead of becoming a separate client.
// Silent on success (a quiet toast only); failures are swallowed since this
// runs alongside a translation job that must not be blocked by it.
async function saveOrAttachClient(identity) {
    const token = localStorage.getItem('deept_token');

    if (!mainContactClientId) {
        try {
            const res = await fetch(`${CORE}/clients`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    first_name:    identity.first_name,
                    last_name:     identity.last_name,
                    first_name_fa: identity.first_name_fa || '',
                    last_name_fa:  identity.last_name_fa  || '',
                    national_id:   identity.national_id,
                    father_name:   identity.father_name   || '',
                    date_of_birth: identity.date_of_birth || '',
                    source_passport_session_id: identity.session_id || null,
                })
            });
            if (res.ok) {
                const client = await res.json();
                mainContactClientId = client.id;
                mainContactNationalId = identity.national_id;
                // The whole point of auto-saving a client here (vs. only
                // via the explicit "select existing client" picker) is so
                // this job still ends up in that client's سابقه پروژه‌ها --
                // which only happens if the job is actually submitted with
                // this client_id. Backend upserts by national_id (see
                // upsert_client_by_national_id in DeepT-Core), so this is
                // the same client record every time this person's document
                // is translated, not a fresh duplicate.
                selectedClientId = client.id;
                showToast(`👤 ${identity.first_name} ${identity.last_name} به‌عنوان مخاطب اصلی ذخیره شد.`, 1800);
            }
        } catch (e) { /* best-effort -- the job itself must not fail because of this */ }
        return;
    }

    if (identity.national_id === mainContactNationalId) return; // same person confirmed twice this session

    try {
        const res = await fetch(`${CORE}/clients/${mainContactClientId}/related`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                first_name:    identity.first_name,
                last_name:     identity.last_name,
                national_id:   identity.national_id,
                father_name:   identity.father_name   || '',
                date_of_birth: identity.date_of_birth || '',
            })
        });
        if (res.ok) {
            showToast(`👨‍👩‍👧 ${identity.first_name} ${identity.last_name} به‌عنوان نفر مرتبط به پروفایل اضافه شد.`, 2000);
        }
    } catch (e) { /* best-effort */ }
}

function ppActivateSkipSession() {
    passportSession = { session_id:'SKIP', first_name:'—', last_name:'—', father_name:null, date_of_birth:null };
    ppActivateSessionUI();
    showOnlyStage('document');
    showToast('⏭️ جلسه بدون پاسپورت شروع شد.');
}

function updateClientBadge() {
    const badge = document.getElementById('activeClientBadge');
    const btn   = document.getElementById('newClientBtn');
    const countEl = document.getElementById('multiPassportCount');
    const addBtn  = document.getElementById('addPassportBtn');
    const continueBtn = document.getElementById('continueToDocBtn');
    if (countEl) countEl.textContent = confirmedPassports.length;
    if (confirmedPassports.length > 0) {
        badge.classList.remove('hidden'); badge.style.display = 'flex';
        document.getElementById('activeClientName').textContent =
            confirmedPassports.map(p => `${p.first_name} ${p.last_name}`).join('، ');
        btn.classList.remove('hidden');
        if (addBtn) addBtn.classList.remove('hidden');
        if (continueBtn) continueBtn.classList.remove('hidden');
    } else {
        badge.classList.add('hidden'); badge.style.display = 'none';
        btn.classList.add('hidden');
        if (addBtn) addBtn.classList.add('hidden');
        if (continueBtn) continueBtn.classList.add('hidden');
        const modeButtons = document.getElementById('ppModeButtons');
        if (modeButtons) modeButtons.classList.remove('hidden');
    }
renderConfirmedPassportsList();
}
function renderConfirmedPassportsList() {
    const box = document.getElementById('confirmedPassportsList');
    if (!box) return;
    if (!confirmedPassports.length) { box.innerHTML = ''; return; }
box.innerHTML = confirmedPassports.map((p, idx) => `
        <div class="flex items-center justify-between p-2 rounded-lg" style="background:var(--bg-main);border:1px solid var(--border-subtle);">
            <span style="color:var(--text-main);">🟢 ${escapeHtml(p.first_name)} ${escapeHtml(p.last_name)}</span>
            <span class="flex items-center gap-2.5">
                <button onclick="openSaveClientModal(${idx})" style="color:var(--accent);background:none;border:none;cursor:pointer;font-weight:700;font-size:.72rem;">${p.national_id ? '✏️ ثبت جزئیات تماس' : '💾 ذخیره مشتری'}</button>
                <button onclick="removeConfirmedPassport(${idx})" style="color:#f87171;background:none;border:none;cursor:pointer;font-weight:700;">حذف ✕</button>
            </span>
        </div>
    `).join('');
}

function removeConfirmedPassport(idx) {
    const p = confirmedPassports[idx];
    if (p && p.session_id) {
        fetch(`${getActiveBackendOrigin()}/passport/${p.session_id}`, { method:'DELETE' }).catch(()=>{});
    }
    confirmedPassports.splice(idx, 1);
    if (!confirmedPassports.length) {
        selectedClientId = null;
        mainContactClientId = null;
        mainContactNationalId = null;
    }
    updateClientBadge();
}

// ── "Save as new client" — persist a confirmed passport for reuse ───────────
let saveClientSourceIdx = null;

/* ============ SECTION: SAVE-AS-CLIENT & ADD-CLIENT MODALS ============ */
function openSaveClientModal(idx) {
    const p = confirmedPassports[idx];
    if (!p) return;
    saveClientSourceIdx = idx;
    document.getElementById('saveClientNamePreview').textContent = `${p.first_name} ${p.last_name}`;
    ['sc-phone','sc-email','sc-passport','sc-national','sc-nationality','sc-notes'].forEach(id => document.getElementById(id).value = '');
    // Already captured automatically at confirm time when the passport had
    // one printed -- prefilled here so the translator isn't asked twice,
    // but still editable in case it needs correcting.
    if (p.national_id) document.getElementById('sc-national').value = p.national_id;

    // A main contact already exists this session -> this person will be
    // saved as a نفر مرتبط on that profile, not a separate client, so the
    // modal says so up front instead of implying a new independent client.
    const isRelated = mainContactClientId && p.national_id && p.national_id !== mainContactNationalId;
    document.getElementById('sc-modal-title').textContent = isRelated ? '👨‍👩‍👧 افزودن نفر مرتبط' : '💾 ذخیره به‌عنوان مشتری';
    document.getElementById('sc-modal-desc').textContent = isRelated
        ? 'این فرد به‌عنوان نفر مرتبط به پروفایل مخاطب اصلی این کار اضافه می‌شود.'
        : 'دفعه بعد بدون بارگذاری پاسپورت، این مشتری را از لیست «مشتریان قبلی» انتخاب کنید.';

    document.getElementById('saveClientModal').classList.remove('hidden');
}

function closeSaveClientModal() {
    document.getElementById('saveClientModal').classList.add('hidden');
    saveClientSourceIdx = null;
}

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
        renderDashboardClients();
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

async function submitSaveClient() {
    if (saveClientSourceIdx === null) return;
    const p = confirmedPassports[saveClientSourceIdx];
    if (!p) return;

    const nationalId = document.getElementById('sc-national').value.trim();
    if (!nationalId) {
        showToast('⚠️ کد ملی الزامی است — شناسه اصلی مشتری برای جلوگیری از ثبت تکراری است.');
        document.getElementById('sc-national').focus();
        return;
    }

    const btn = document.getElementById('sc-submit-btn');
    btn.disabled = true;
    btn.textContent = 'در حال ذخیره...';
    const token = localStorage.getItem('deept_token');

    // A main contact already established this session, and this is someone
    // else (e.g. a family member) -- attach as a نفر مرتبط on that profile
    // instead of creating a second independent client.
    const isRelated = mainContactClientId && nationalId !== mainContactNationalId;

    try {
        const res = isRelated
            ? await fetch(`${CORE}/clients/${mainContactClientId}/related`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    first_name: p.first_name, last_name: p.last_name, national_id: nationalId,
                    father_name: p.father_name || '', date_of_birth: p.date_of_birth || '',
                })
            })
            : await fetch(`${CORE}/clients`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    first_name:    p.first_name,
                    last_name:     p.last_name,
                    national_id:   nationalId,
                    father_name:   p.father_name   || '',
                    date_of_birth: p.date_of_birth || '',
                    phone:           document.getElementById('sc-phone').value.trim()       || null,
                    email:           document.getElementById('sc-email').value.trim()       || null,
                    passport_number: document.getElementById('sc-passport').value.trim()    || null,
                    nationality:     document.getElementById('sc-nationality').value.trim() || null,
                    notes:           document.getElementById('sc-notes').value.trim()       || null,
                    source_passport_session_id: p.session_id || null,
                })
            });
        if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e.detail || 'خطای سرور'); }

        if (isRelated) {
            showToast('✅ به‌عنوان نفر مرتبط به پروفایل مخاطب اصلی اضافه شد.');
        } else {
            const client = await res.json();
            mainContactClientId = client.id;
            mainContactNationalId = nationalId;
            showToast('✅ مشتری ذخیره شد.');
        }
        closeSaveClientModal();
    } catch (e) {
        showToast('❌ ذخیره مشتری ناموفق بود.');
    } finally {
        btn.disabled = false;
        btn.textContent = 'ذخیره مشتری';
    }
}
/* ============ SECTION: PIPELINE STAGE FLOW CONTROL ============
   Stage back/forward + document-type selection. ============ */
    function goBackToDocTypeStage() {
    showOnlyStage('doctype');
}
function goBackToPassportStage() {
    showOnlyStage('passport');
}
function handleDocTypeSelected() {
    const docType = document.getElementById('docTemplate').value;
    if (!docType) return;
    const docDef  = DOCUMENT_REGISTRY[docType];
    document.getElementById('docTypeSummaryLabel').textContent = docDef ? docDef.label : docType;
    showOnlyStage('passport');
    toggleMultiPassportUI();
}
function reopenDocTypeStage() {
    showOnlyStage('doctype');
}
function toggleMultiPassportUI() {
    const docType = document.getElementById('docTemplate').value;
    const docDef  = DOCUMENT_REGISTRY[docType];
    const block   = document.getElementById('multiPassportBlock');
    if (docDef && docDef.usePassportSession && !docDef.legacySingleSession) {
        block.classList.remove('hidden');
        document.getElementById('multiPassportCount').textContent = confirmedPassports.length;
    } else {
        block.classList.add('hidden');
    }
}

function addExtraPassport() {
    ppSelectedFile = null;
    ppClearFields();
    document.getElementById('pp-fields').classList.add('hidden');
    document.getElementById('pp-upload-zone').classList.add('hidden');
    ppShowStatus('','');
    document.getElementById('ppModeButtons').classList.remove('hidden');
}
function continueToDocumentStep() {
    showOnlyStage('document');
}
function confirmNewClient() {
    if (!confirm('بستن جلسه فعلی؟\nبرای مشتری جدید باید پاسپورت‌ها مجدداً ثبت شوند.')) return;

    confirmedPassports.forEach(p => {
        if (p.session_id) fetch(`${getActiveBackendOrigin()}/passport/${p.session_id}`, { method:'DELETE' }).catch(()=>{});
    });
    confirmedPassports = [];
    selectedClientId = null;
    mainContactClientId = null;
    mainContactNationalId = null;
    updateClientBadge();

    ppSelectedFile  = null;
    docSelectedFile = null;
    document.getElementById('pp-upload-zone').classList.add('hidden');
    document.getElementById('pp-fields').classList.add('hidden');
     document.getElementById('ppModeButtons').classList.remove('hidden');
    ppShowStatus('','');

    resetDocZone();
    showOnlyStage('doctype');
    showToast('🔄 جلسه بسته شد. آماده مشتری جدید.');
}

// ═══════════════════════════════════════════════════════════
// STEP 2 — DOCUMENT UPLOAD & TRANSLATION
// ═══════════════════════════════════════════════════════════
function handleDocFileSelection(file) {
    if (!file) return;
    docSelectedFile = file;
    document.getElementById('docFileInfo').textContent = `📄 ${file.name} (${(file.size/1024).toFixed(0)} KB)`;
    document.getElementById('docFileInfo').classList.remove('hidden');
    document.getElementById('docDropText').classList.add('hidden');
    document.getElementById('submitBtn').disabled = false;
}

// Drag and drop on document zone
const docDropZoneEl = document.getElementById('docDropZone');
if (docDropZoneEl) {
    docDropZoneEl.addEventListener('dragover', e => { e.preventDefault(); docDropZoneEl.classList.add('drag-over'); });
    docDropZoneEl.addEventListener('dragleave', () => docDropZoneEl.classList.remove('drag-over'));
    docDropZoneEl.addEventListener('drop', e => {
        e.preventDefault();
        docDropZoneEl.classList.remove('drag-over');
        if (e.dataTransfer.files.length) handleDocFileSelection(e.dataTransfer.files[0]);
    });
}
/* ============ SECTION: CHUNKED FILE UPLOAD ============
   BackEnd /upload/chunk with retries; falls back to direct translate. ============ */
async function uploadFileInChunks(file, onProgress) {
    const CHUNK_SIZE = 150 * 1024;
    const MAX_RETRIES_PER_CHUNK = 3;

    const uploadId = crypto.randomUUID();
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
        const start = chunkIndex * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, file.size);
        const chunkBlob = file.slice(start, end);

        const fd = new FormData();
        fd.append('upload_id', uploadId);
        fd.append('chunk_index', chunkIndex);
        fd.append('total_chunks', totalChunks);
        fd.append('original_filename', file.name);
        fd.append('chunk', chunkBlob);

        let succeeded = false;
        for (let attempt = 1; attempt <= MAX_RETRIES_PER_CHUNK; attempt++) {
            try {
                const res = await fetch('https://backend.deept.ir/upload/chunk', {
                    method: 'POST',
                    body: fd,
                });
                if (!res.ok) {
                    const err = await res.json().catch(() => ({ detail: 'خطای ناشناخته' }));
                    throw new Error(err.detail);
                }
                succeeded = true;
                break;
            } catch (networkErr) {
                if (attempt === MAX_RETRIES_PER_CHUNK) {
                    throw new Error(`آپلود قطعه ${chunkIndex + 1} از ${totalChunks} ناموفق بود.`);
                }
                await new Promise(r => setTimeout(r, 500 * attempt));
            }
        }

        if (onProgress) {
            const percent = Math.round(((chunkIndex + 1) / totalChunks) * 100);
            onProgress(percent);
        }
    }

    return uploadId;
}
/* ============ SECTION: TRANSLATION PIPELINE — EXECUTION ============
   Core: execute -> chunk upload -> /api/translate/<docType> -> deduct + download. ============ */
async function executeTranslationPipeline() {
    if (!docSelectedFile) return;

    if (!currentUserSession) {
        openAuthModal();
        return;
    }

    const idempotencyKey = crypto.randomUUID();
    const submitBtn      = document.getElementById('submitBtn');
    const statusBubble   = document.getElementById('processingStatusBubble');
    const statusText     = document.getElementById('statusMessageText');
    const statusVideoIcon = document.getElementById('statusVideoIcon');
    const statusCheckIcon = document.getElementById('statusCheckIcon');

    submitBtn.disabled = true;
    statusBubble.classList.remove('hidden');
    statusVideoIcon.classList.remove('hidden');
    statusCheckIcon.classList.add('hidden');
    statusText.style.color = 'var(--text-muted)';
    statusText.textContent = 'در حال ارسال به سرور...';
    
    const docType = document.getElementById('docTemplate').value;
    const docDef  = DOCUMENT_REGISTRY[docType];

    if (!docDef || !docDef.active || !docDef.endpoint) {
        showToast('این نوع سند هنوز پشتیبانی نمی‌شود.');
        submitBtn.disabled = false;
        statusBubble.classList.add('hidden');
        return;
    }

   // After
    const fd = new FormData();
    fd.append('document_file', docSelectedFile);
    fd.append('idempotency_key', idempotencyKey);

    if (docType === 'academic-transcript') {
        const includeCourseCodes = document.getElementById('includeCourseCodesCheckbox').checked;
        fd.append('include_course_codes', includeCourseCodes ? 'true' : 'false');
    }
    
    // Passport session(s). police-certificate still uses its old backend
    // contract (legacySingleSession) until that repo is updated; every other
    // document type uses the universal multi-passport contract by default.
if (docDef.usePassportSession) {
        if (docDef.legacySingleSession) {
            let sid = confirmedPassports[0]?.session_id;
            if (!sid) {
                try {
                    statusText.textContent = 'در حال ایجاد جلسه موقت...';
                    const r = await fetch(`${getActiveBackendOrigin()}/passport/confirm`, {
                        method: 'POST',
                        headers: {'Content-Type':'application/json'},
                        body: JSON.stringify({ first_name:'', last_name:'', father_name:'', date_of_birth:'' })
                    });
                    const d = await r.json();
                    sid = d.session_id;
                } catch(e) { /* backend will fall back to doc-extracted identity */ }
            }
            if (sid) fd.append('session_id', sid);
        } else {
            confirmedPassports.forEach(p => fd.append('session_ids', p.session_id));
            if (selectedClientId) fd.append('client_id', selectedClientId);
        }
    }

    const url = docDef.endpoint;
    const token = localStorage.getItem('deept_token');

    // After
    try {
    statusText.textContent = 'در حال پردازش؛ این فرایند ممکن است چند دقیقه طول بکشد. لطفا منتظر بمانید.';

    let res;
    let directFailed = false;
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            res = await fetch(url, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
                body: fd
            });
            break; // got a real HTTP response (even an error one) -- stop retrying
        } catch (networkErr) {
            // Only retry on a true network-level failure (connection drop,
            // ERR_HTTP2_PROTOCOL_ERROR, timeout) -- NOT on a normal HTTP
            // error response, which already reached `break` above.
            if (attempt === maxAttempts) {
                directFailed = true;
                break;
            }
            statusText.textContent = `اتصال قطع شد، تلاش مجدد... (${attempt}/${maxAttempts})`;
            await new Promise(r => setTimeout(r, 1500 * attempt));
        }
    }

    // Direct upload never got a response after every retry. For document
    // types that support it, fall back to sending the file in small
    // pieces instead -- only a failed piece needs retrying, not the whole
    // file each time, so this is much more likely to get through on a
    // genuinely bad connection.
    if (directFailed && docType === 'academic-transcript') {
        try {
            const uploadId = await uploadFileInChunks(docSelectedFile, (percent) => {
                statusText.textContent = `در حال آپلود سند... ${percent}%`;
            });

            const chunkedFd = new FormData();
            chunkedFd.append('upload_id', uploadId);
            chunkedFd.append('idempotency_key', idempotencyKey);
            if (docType === 'academic-transcript') {
                chunkedFd.append('include_course_codes', fd.get('include_course_codes'));
            }
            if (docDef.usePassportSession) {
                if (docDef.legacySingleSession) {
                    const sid = fd.get('session_id');
                    if (sid) chunkedFd.append('session_id', sid);
                } else {
                    fd.getAll('session_ids').forEach(sid => chunkedFd.append('session_ids', sid));
                }
            }

            statusText.textContent = 'در حال پردازش؛ این فرایند ممکن است چند دقیقه طول بکشد. لطفا منتظر بمانید.';
            res = await fetch(url, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
                body: chunkedFd
            });
        } catch (chunkErr) {
            throw new Error('آپلود سند ناموفق بود. لطفاً اتصال اینترنت خود را بررسی کرده و دوباره تلاش کنید.');
        }
    } else if (directFailed) {
        throw new Error('آپلود سند ناموفق بود. لطفاً اتصال اینترنت خود را بررسی کرده و دوباره تلاش کنید.');
    }

    if (!res.ok) {
        const err = await res.json().catch(()=>({detail:'خطای ناشناخته'}));
        throw new Error(err.detail);
    }
        // Backend now returns a ticket immediately -- {job_id, status,
        // price_toman, page_count} -- NOT the finished file. The actual
        // translation runs in the background; there is nothing to
        // download yet. The real "my translations" list (checking status,
        // downloading once ready) is a separate piece still to be built --
        // for now, just confirm the ticket was created and show the price.
        const ticket = await res.json();

        allJobsTerminal = false; // a fresh queued job exists now -- resume polling
        const priceLabel = ticket.price_toman ? `${ticket.price_toman.toLocaleString()} تومان` : '';
        statusVideoIcon.classList.add('hidden');
        statusCheckIcon.classList.remove('hidden');
        statusText.style.color = 'var(--text-main)';
        statusText.textContent = 'سند شما ثبت شد و در صف پردازش قرار گرفت. ترجمه پس از چند ثانیه در «میز کار دیجیتال ← پروژه‌های ترجمه» قابل مشاهده خواهد بود.';
        showToast(`✅ سند شما ثبت شد. هزینه: ${priceLabel}`);
        document.getElementById('nextDocBtn').classList.remove('hidden');

    } catch (err) {
        // Never display err.message directly -- it can be raw English from
        // a network-level failure (timeout, CORS, connection drop), not
        // just backend detail text. Always show a fixed Persian message.
        statusBubble.classList.add('hidden');
        showToast('❌ خطا در پردازش سند. لطفاً دوباره تلاش کنید یا با پشتیبانی تماس بگیرید.');
    } finally {
        submitBtn.disabled = false;
    }
}

function resetDocZone() {
    docSelectedFile = null;
    document.getElementById('docFileInfo').classList.add('hidden');
    document.getElementById('docDropText').classList.remove('hidden');
    document.getElementById('docFileInput').value = '';
    document.getElementById('submitBtn').disabled = true;
    document.getElementById('nextDocBtn').classList.add('hidden');
    document.getElementById('processingStatusBubble').classList.add('hidden');
}

function resetForNextDocument() {
    resetDocZone();
    showToast('آماده بارگذاری سند بعدی.');
}

// ═══════════════════════════════════════════════════════════
// CANVAS BACKGROUND
// ═══════════════════════════════════════════════════════════
// canvas removed

// ═══════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════
refreshWalletBalanceDisplay();

// Pending password-reset token (set by openResetPassword from the emailed
// link, consumed by handleResetPassword). Declared before initializeApp so
// the IIFE below can call openResetPassword without hitting the `let` TDZ.
let pendingResetToken = null;

(function initializeApp() {
    const params = new URLSearchParams(window.location.search);

    // Restore persisted session FIRST
    currentUserSession = loadSession();

    // Test session only if there is no real session
    if (params.get('test') === '1' && !currentUserSession) {
        currentUserSession = {
            email: 'test@deept.ir',
            username: 'مترجم آزمایشی',
            type: 'office',
            contact: '@deept_test',
            office: 'دارالترجمه آزمایشی DeepT'
        };

        localStorage.setItem(
            'deept_mock_user',
            JSON.stringify(currentUserSession)
        );
    }

    // Synchronize UI with restored session
    syncUserSessionDOM();

    // Preload نرخنامه من overrides in the background (not just when Settings
    // happens to be opened) so the invoice draft-row picker reflects a
    // translator's own saved prices from the very first invoice of the
    // session, not just the catalog defaults.
    if (currentUserSession) loadMyPriceListCatalog();

    // account_type is only ever learned fresh at login time (see
    // saveSession()) -- an already-logged-in session from before that
    // existed, or one that simply hasn't logged in again since, has no
    // other way to pick up "this is an office account" and the HR
    // attendance UI that unlocks (see syncUserSessionDOM()). office_name/
    // contact_info aren't returned by login/signup at all (see ProfileUpdate
    // in DeepT-Core), only by /auth/verify -- so this is also the only way
    // a saved profile edit shows up in a different tab/session. Self-heals
    // on every page load instead of requiring a re-login.
    syncProfileFromServer();

    // GitHub Pages has no server routing: a refresh on /dashboard etc. lands
    // on 404.html, which stashes the intended path (+ query string, e.g. a
    // password-reset link is /login/?reset_token=...) in sessionStorage and
    // redirects to '/'. Restore it here so the route below sees the real
    // path instead of '/' -- and merge the query string back into `params`
    // above, since that was built from '/'s own (empty) location.search,
    // not the original request's.
    let initialPath = window.location.pathname;
    try {
        const redirected = sessionStorage.getItem('deept_redirect_path');
        if (redirected && redirected.startsWith('/') && redirected !== '/') {
            sessionStorage.removeItem('deept_redirect_path');
            const [redirectedPath, redirectedQuery] = redirected.split('?');
            window.history.replaceState({ path: redirectedPath }, '', redirected);
            initialPath = redirectedPath;
            if (redirectedQuery) {
                for (const [k, v] of new URLSearchParams(redirectedQuery)) {
                    params.set(k, v);
                }
            }
        }
    } catch (e) { /* sessionStorage unavailable -- fall back to location */ }

    // Route only after session has been restored
    applyRouteForPath(initialPath);

    // Email activation redirect (from DeepT-Core's /auth/activate) --
    // opens the login modal directly so the user can enter their password
    // right away, instead of landing on a bare page.
    const activated = params.get('activated');
    if (activated === 'success') {
        showToast('✅ ایمیل شما تایید شد. اکنون وارد شوید.');
        openLogin();
        window.history.replaceState({}, document.title, window.location.pathname);
    } else if (activated === 'error') {
        showToast('⚠️ لینک فعال‌سازی نامعتبر یا قبلاً استفاده شده است.');
        openLogin();
        window.history.replaceState({}, document.title, window.location.pathname);
    }
    // Password reset link (from DeepT-Core's send_password_reset_email) --
    // opens the "set new password" modal directly with the token already
    // in hand, same idea as the activation redirect above.
    const resetToken = params.get('reset_token');
    if (resetToken) {
        openResetPassword(resetToken);
        window.history.replaceState({}, document.title, window.location.pathname);
    }
})();

// ── AUTH ──
/* ============ SECTION: DEEPT-CORE API CLIENT (auth) ============
   verify/signup/login/activate; token + session persistence. ============ */
async function corePost(path, body) {
    const res = await fetch(`${CORE}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    return { ok: res.ok, data: await res.json() };
}

function saveSession(data) {
    if (!data || !data.token || !data.user_id) {
        console.error('Invalid login response. Session was not saved.', data);
        return false;
    }

    localStorage.setItem('deept_token', String(data.token));
    localStorage.setItem('deept_user_id', String(data.user_id));
    localStorage.setItem('deept_user_name', data.full_name || data.username || '');
    localStorage.setItem('deept_user_email', data.email || '');
    localStorage.setItem('deept_is_admin', data.is_admin ? '1' : '0');
    localStorage.setItem('deept_account_type', data.account_type || 'individual');

    return true;
}

/* ============ SECTION: LOGIN / SIGNUP / AUTH MODALS ============
   Auth modals close only via explicit ✕ / switch links / success; only
   quickStartOverlay keeps backdrop-click close. Success panels. ============ */
async function handleLogin() {
    const email = document.getElementById('li-email').value.trim();
    const pass  = document.getElementById('li-pass').value;
    const err   = document.getElementById('li-error');
    const btn   = document.querySelector('#loginForm .modal-btn');
    err.classList.remove('show');
    if (!email||!pass) { err.textContent='لطفاً همه فیلدها را پر کنید.'; err.classList.add('show'); return; }
    btn.textContent='در حال ورود...'; btn.disabled=true;
    try {
        const {ok,data} = await corePost('/auth/login', {email, password:pass});
        if (!ok) { err.textContent=data.detail||'ایمیل یا رمز عبور اشتباه است.'; err.classList.add('show'); btn.textContent='ورود'; btn.disabled=false; return; }
       if (!saveSession(data)) {
    console.error('Login succeeded but session could not be saved.');
    return;
}

document.getElementById('loginForm').style.display = 'none';
document.getElementById('loginSuccess').classList.add('show');

currentUserSession = loadSession();
syncUserSessionDOM();

setTimeout(() => {
    closeModals();

    if (currentUserSession?.is_admin) {
        showAdminDashboard();
    } else {
        showDashboardView();
    }
}, 1400);
    } catch(e) { err.textContent='خطا در اتصال.'; err.classList.add('show'); btn.textContent='ورود'; btn.disabled=false; }
}

async function handleSignup() {
    const name  = document.getElementById('su-name').value.trim();
    const email = document.getElementById('su-email').value.trim();
    const pass  = document.getElementById('su-pass').value;
    const err   = document.getElementById('su-error');
    const btn   = document.querySelector('#signupForm .modal-btn');
    err.classList.remove('show');
    if (!name||!email||!pass) { err.textContent='لطفاً همه فیلدها را پر کنید.'; err.classList.add('show'); return; }
    if (pass.length<8)        { err.textContent='رمز عبور باید حداقل ۸ کاراکتر باشد.'; err.classList.add('show'); return; }
    if (!email.includes('@')) { err.textContent='یک ایمیل معتبر وارد کنید.'; err.classList.add('show'); return; }
    btn.textContent='در حال ثبت‌نام...'; btn.disabled=true;
    try {
        const {ok,data} = await corePost('/auth/signup', {email, password:pass, full_name:name, account_type:'individual'});
        if (!ok) { err.textContent=data.detail||'این ایمیل قبلاً ثبت شده است.'; err.classList.add('show'); btn.textContent='ساخت حساب'; btn.disabled=false; return; }
        document.getElementById('signupForm').style.display='none';
        document.getElementById('signupSuccess').classList.add('show');
        // Account exists but is unverified -- don't save a session or route
        // to the dashboard, nothing will work until the activation link is
        // clicked. Just show the "check your email" message and stop.
    } catch(e) { err.textContent='خطا در اتصال.'; err.classList.add('show'); btn.textContent='ساخت حساب'; btn.disabled=false; }
}

// ── MODAL FUNCTIONS ──
function openLogin() {
    const form = document.getElementById('loginForm');
    const succ = document.getElementById('loginSuccess');
    if (form) form.style.display = '';
    if (succ) succ.classList.remove('show');
    const err = document.getElementById('li-error');
    if (err) { err.textContent=''; err.classList.remove('show'); }
    const btn = document.querySelector('#loginForm .modal-btn');
    if (btn) { btn.textContent='ورود'; btn.disabled=false; }
    document.getElementById('loginOverlay').classList.add('open');
}
function openSignup() {
    const form = document.getElementById('signupForm');
    const succ = document.getElementById('signupSuccess');
    if (form) form.style.display = '';
    if (succ) succ.classList.remove('show');
    const err = document.getElementById('su-error');
    if (err) { err.textContent=''; err.classList.remove('show'); }
    const btn = document.querySelector('#signupForm .modal-btn');
    if (btn) { btn.textContent='ساخت حساب'; btn.disabled=false; }
    document.getElementById('signupOverlay').classList.add('open');
}
function openAuthModal() { openLogin(); }
function togglePasswordVisibility(btn) {
    const input = btn.parentElement.querySelector('input');
    if (!input) return;
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    btn.classList.toggle('showing', show);
    btn.setAttribute('aria-label', show ? 'پنهان کردن رمز عبور' : 'نمایش رمز عبور');
}
function openForgotPassword() {
    const form = document.getElementById('forgotPasswordForm');
    const succ = document.getElementById('forgotPasswordSuccess');
    if (form) form.style.display = '';
    if (succ) succ.classList.remove('show');
    const err = document.getElementById('fp-error');
    if (err) { err.textContent=''; err.classList.remove('show'); }
    const btn = document.querySelector('#forgotPasswordForm .modal-btn');
    if (btn) { btn.textContent='ارسال لینک بازیابی'; btn.disabled=false; }
    document.getElementById('fp-email').value = '';
    closeModals();
    setTimeout(() => document.getElementById('forgotPasswordOverlay').classList.add('open'), 80);
}
function openResetPassword(token) {
    resetPasswordToken = token;
    const form = document.getElementById('resetPasswordForm');
    const succ = document.getElementById('resetPasswordSuccess');
    if (form) form.style.display = '';
    if (succ) succ.classList.remove('show');
    const err = document.getElementById('rp-error');
    if (err) { err.textContent=''; err.classList.remove('show'); }
    const btn = document.querySelector('#resetPasswordForm .modal-btn');
    if (btn) { btn.textContent='تنظیم رمز عبور'; btn.disabled=false; }
    document.getElementById('rp-pass').value = '';
    document.getElementById('rp-pass-confirm').value = '';
    document.getElementById('resetPasswordOverlay').classList.add('open');
}
function closeModals()   {
    ['loginOverlay','signupOverlay','quickStartOverlay','forgotPasswordOverlay','resetPasswordOverlay'].forEach(id=>{
        const el=document.getElementById(id); if(el) el.classList.remove('open');
    });
}
function switchToSignup() { closeModals(); setTimeout(openSignup,80); }
function switchToLogin()  { closeModals(); setTimeout(openLogin,80); }
function closeAuthModal() { closeModals(); }
function switchAuthState(s) { if(s==='signup') switchToSignup(); else switchToLogin(); }

async function handleForgotPassword() {
    const email = document.getElementById('fp-email').value.trim();
    const err = document.getElementById('fp-error');
    const btn = document.querySelector('#forgotPasswordForm .modal-btn');
    err.classList.remove('show');
    if (!email) { err.textContent='لطفاً ایمیل خود را وارد کنید.'; err.classList.add('show'); return; }
    btn.textContent='در حال ارسال...'; btn.disabled=true;
    try {
        const { ok } = await corePost('/auth/forgot-password', { email });
        if (!ok) { err.textContent='خطا در ارسال درخواست.'; err.classList.add('show'); btn.textContent='ارسال لینک بازیابی'; btn.disabled=false; return; }
        document.getElementById('forgotPasswordForm').style.display='none';
        document.getElementById('forgotPasswordSuccess').classList.add('show');
    } catch(e) {
        err.textContent='خطا در اتصال.'; err.classList.add('show'); btn.textContent='ارسال لینک بازیابی'; btn.disabled=false;
    }
}

async function handleResetPassword() {
    const pass    = document.getElementById('rp-pass').value;
    const confirm = document.getElementById('rp-pass-confirm').value;
    const err = document.getElementById('rp-error');
    const btn = document.querySelector('#resetPasswordForm .modal-btn');
    err.classList.remove('show');
    if (!pass || !confirm)   { err.textContent='لطفاً همه فیلدها را پر کنید.'; err.classList.add('show'); return; }
    if (pass.length < 8)     { err.textContent='رمز عبور باید حداقل ۸ کاراکتر باشد.'; err.classList.add('show'); return; }
    if (pass !== confirm)    { err.textContent='رمز عبور و تکرار آن یکسان نیستند.'; err.classList.add('show'); return; }
    if (!resetPasswordToken) { err.textContent='لینک بازیابی نامعتبر است.'; err.classList.add('show'); return; }
    btn.textContent='در حال ثبت...'; btn.disabled=true;
    try {
        const {ok,data} = await corePost('/auth/reset-password', { token: resetPasswordToken, new_password: pass });
        if (!ok) { err.textContent=data.detail||'لینک بازیابی نامعتبر یا منقضی شده است.'; err.classList.add('show'); btn.textContent='تنظیم رمز عبور'; btn.disabled=false; return; }
        document.getElementById('resetPasswordForm').style.display='none';
        document.getElementById('resetPasswordSuccess').classList.add('show');

        setTimeout(() => {
            resetPasswordToken = null;
            window.history.replaceState({}, document.title, window.location.pathname);
            switchToLogin();
        }, 1400);
    } catch(e) { err.textContent='خطا در اتصال.'; err.classList.add('show'); btn.textContent='تنظیم رمز عبور'; btn.disabled=false; }
}

document.addEventListener('keydown',e=>{
    if(e.key!=='Enter') return;
    if(document.getElementById('loginOverlay').classList.contains('open'))          handleLogin();
    if(document.getElementById('signupOverlay').classList.contains('open'))         handleSignup();
    if(document.getElementById('forgotPasswordOverlay').classList.contains('open')) handleForgotPassword();
    if(document.getElementById('resetPasswordOverlay').classList.contains('open'))  handleResetPassword();
});

// ['loginOverlay','signupOverlay'].forEach(id=>{
//     const el=document.getElementById(id);
//     if(el) el.addEventListener('click',e=>{ if(e.target===el) closeModals(); });
// });

// ── LANDING JS (date converter, quick start pipeline) ──

// ── LOGO (embedded, theme-aware via CSS filter) ──
// logo embedded in hero

// ── DEEPT-CORE AUTH ──





// ── LOGIN ──


// ── SIGNUP ──



function openQuickStart() {
    qsReset();
    document.getElementById('quickStartOverlay').classList.add('open');
}

// ['loginOverlay','signupOverlay','quickStartOverlay'].forEach(id => {
//     const el = document.getElementById(id);
//     if (!el) return;
//     el.addEventListener('click', e => {
//         if (e.target === el) closeModals();
//     });
// });

// ── THEME ──
// (Theme restore + button label live in the single init block near
// toggleGlobalTheme() above. A duplicate block used to live here targeting
// getElementById('themeBtn') — since that id exists on two elements (the
// app header button and the landing header button), it silently overwrote
// the app header button's icon/text child spans with plain text, breaking
// the next toggle for anyone with a saved 'light' theme. Removed rather
// than fixed twice.)


// ── TOAST ──


// ── MODALS ──

// ── DATE CONVERTER ──
function j2g(jy,jm,jd){
    jy-=979;jm-=1;jd-=1;
    let n=365*jy+Math.floor(jy/33)*8+Math.floor((jy%33+3)/4);
    for(let i=0;i<jm;i++)n+=(i<6)?31:30;
    n+=jd;let g=n+79;
    let gy=1600+400*Math.floor(g/146097);g%=146097;
    let lp=true;
    if(g>=36525){g--;gy+=100*Math.floor(g/36524);g%=36524;if(g>=365){g++;lp=false;}}
    gy+=4*Math.floor(g/1461);g%=1461;
    if(g>=366){lp=false;g--;gy+=Math.floor(g/365);g%=365;}
    let gm,gd;const d=[31,lp?29:28,31,30,31,30,31,31,30,31,30,31];
    for(let i=0;i<12;i++){if(g<d[i]){gm=i+1;gd=g+1;break;}g-=d[i];}
    return{gy,gm,gd};
}
/* ============ SECTION: DATE TOOL + QUICK-START PIPELINE ============
   Persian->Gregorian converter (j2g) + no-signup quick-start modal. ============ */
function convertDate(){
    const day=parseInt(document.getElementById('t-day').value);
    const mon=parseInt(document.getElementById('t-month').value);
    const yr=parseInt(document.getElementById('t-year').value);
    const errEl=document.getElementById('t-error');
    const resEl=document.getElementById('t-result');
    errEl.classList.remove('show');resEl.classList.remove('show');
    if(!day||!mon||!yr){errEl.textContent='همه موارد را وارد کنید.';errEl.classList.add('show');return;}
    if(yr<1200||yr>1500){errEl.textContent='سال شمسی معتبر وارد کنید (مثلاً ۱۳۸۰).';errEl.classList.add('show');return;}
    if(day<1||day>31){errEl.textContent='روز معتبر وارد کنید.';errEl.classList.add('show');return;}
    try{
        const{gy,gm,gd}=j2g(yr,mon,day);
        const obj=new Date(gy,gm-1,gd);
        const p=n=>String(n).padStart(2,'0');
        document.getElementById('t-main').textContent=`${gy} / ${p(gm)} / ${p(gd)}`;
        document.getElementById('t-f1').textContent=`${gy}-${p(gm)}-${p(gd)}`;
        document.getElementById('t-f2').textContent=`${p(gd)}/${p(gm)}/${gy}`;
        document.getElementById('t-f3').textContent=`${p(gm)}/${p(gd)}/${gy}`;
        document.getElementById('t-f4').textContent=new Intl.DateTimeFormat('en-US',{month:'long',day:'numeric',year:'numeric'}).format(obj);
        resEl.classList.add('show');
    }catch(e){errEl.textContent='خطا در تبدیل.';errEl.classList.add('show');}
}
function copyFmt(id){
    const el = document.getElementById(id);
    if (!el) return;
    // Get text from the .fmt-value span if inside a button, or directly
    const valEl = el.querySelector('.fmt-value') || el;
    const v = valEl.textContent.trim();
    if (!v) return;

    function onCopied() {
        const tip = document.getElementById('cp-' + id);
        if (tip) { tip.classList.add('show'); setTimeout(()=>tip.classList.remove('show'), 1400); }
        showToast('کپی شد: ' + v);
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(v).then(onCopied).catch(() => fallbackCopyText(v, onCopied));
    } else {
        fallbackCopyText(v, onCopied);
    }
}

function fallbackCopyText(text, onSuccess) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    try {
        document.execCommand('copy');
        onSuccess();
    } catch (e) {
        showToast('کپی خودکار پشتیبانی نمی‌شود. لطفاً دستی کپی کنید.');
    }
    document.body.removeChild(ta);
}

// ── QUICK START PIPELINE ──
const QS = { mode:null, passFile:null, docFile:null, sessionId:null, blob:null };
const QS_BACKEND = 'https://police.deept.ir';

function qsReset() {
    Object.assign(QS, {mode:null,passFile:null,docFile:null,sessionId:null,blob:null});
    qsGoToPanel(1);
    ['qsModeUpload','qsModeManual','qsModeSkip'].forEach(id=>document.getElementById(id).classList.remove('selected'));
    document.getElementById('qsUploadZone').style.display='none';
    document.getElementById('qsManualZone').style.display='none';
    document.getElementById('qsPassFileName').style.display='none';
    document.getElementById('qsPassFileName').textContent='';
    document.getElementById('qsDocFileName').style.display='none';
    document.getElementById('qsDocFileName').textContent='';
    document.getElementById('qsNext1').disabled=true;
    document.getElementById('qsNext2').disabled=true;
    document.getElementById('qsProcessing').classList.remove('show');
}

function qsGoToPanel(n) {
    [1,2,3].forEach(i => {
        document.getElementById('qsPanel'+i).classList.toggle('active', i===n);
        const dot=document.getElementById('qd'+i);
        dot.classList.toggle('done', i<n);
        dot.classList.toggle('active', i===n);
        if(i<n) dot.textContent='✓';
        else dot.textContent=String(i);
    });
    [1,2].forEach(i => document.getElementById('ql'+i).classList.toggle('done', i<n));
}

function qsSelectMode(mode) {
    QS.mode=mode;
    ['Upload','Manual','Skip'].forEach(m=>
        document.getElementById('qsMode'+m).classList.toggle('selected', m.toLowerCase()===mode)
    );
    document.getElementById('qsUploadZone').style.display = mode==='upload'?'block':'none';
    document.getElementById('qsManualZone').style.display = mode==='manual'?'block':'none';
    document.getElementById('qsNext1').disabled = (mode==='upload' && !QS.passFile);
    if (mode==='skip'||mode==='manual') document.getElementById('qsNext1').disabled=false;
}

function qsHandlePassport(file) {
    if (!file) return;
    QS.passFile=file;
    const el=document.getElementById('qsPassFileName');
    el.textContent='📎 '+file.name; el.style.display='block';
    if (QS.mode==='upload') document.getElementById('qsNext1').disabled=false;
}
function qsHandleDoc(file) {
    if (!file) return;
    QS.docFile=file;
    const el=document.getElementById('qsDocFileName');
    el.textContent='📄 '+file.name; el.style.display='block';
    document.getElementById('qsNext2').disabled=false;
}

// Drag-drop passport
const qsPassDropEl = document.getElementById('qsPassDrop');
if (qsPassDropEl) {
    ['dragover','dragleave','drop'].forEach(evt => {
        qsPassDropEl.addEventListener(evt, e => {
            e.preventDefault();
            qsPassDropEl.classList.toggle('over', evt==='dragover');
            if (evt==='drop' && e.dataTransfer.files.length) qsHandlePassport(e.dataTransfer.files[0]);
        });
    });
}
// Drag-drop document
const qsDocDropEl = document.getElementById('qsDocDrop');
if (qsDocDropEl) {
    ['dragover','dragleave','drop'].forEach(evt => {
        qsDocDropEl.addEventListener(evt, e => {
            e.preventDefault();
            qsDocDropEl.classList.toggle('over', evt==='dragover');
            if (evt==='drop' && e.dataTransfer.files.length) qsHandleDoc(e.dataTransfer.files[0]);
        });
    });
}

async function qsRunTranslation() {
    if (!QS.docFile) return;
    const btn=document.getElementById('qsNext2');
    btn.disabled=true; btn.textContent='در حال پردازش...';
    document.getElementById('qsProcessing').classList.add('show');
    try {
        // 1. Confirm identity session
        let identity = { first_name:'', last_name:'', father_name:'', date_of_birth:'' };
        if (QS.mode==='upload' && QS.passFile) {
            const pfd=new FormData(); pfd.append('file', QS.passFile);
            const pRes=await fetch(`${QS_BACKEND}/passport/extract`,{method:'POST',body:pfd});
            if (pRes.ok) Object.assign(identity, await pRes.json());
        } else if (QS.mode==='manual') {
            identity = {
                first_name:    document.getElementById('qsFirst').value.trim().toUpperCase(),
                last_name:     document.getElementById('qsLast').value.trim().toUpperCase(),
                father_name:   document.getElementById('qsFather').value.trim().toUpperCase(),
                date_of_birth: document.getElementById('qsDob').value.trim()
            };
        }
        const cRes=await fetch(`${QS_BACKEND}/passport/confirm`,{
            method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify(identity)
        });
        const { session_id } = await cRes.json();
        QS.sessionId = session_id;

        // 2. Translate
        const docType=document.getElementById('qsDocType').value;
        const fd=new FormData();
        fd.append('document_file', QS.docFile);
        fd.append('session_id', session_id);
        const tRes=await fetch(`${QS_BACKEND}/api/translate/${docType}`,{method:'POST',body:fd});
        if (!tRes.ok) { throw new Error('translation_failed'); }
        QS.blob = await tRes.blob();

        document.getElementById('qsProcessing').classList.remove('show');
        qsGoToPanel(3);
    } catch(err) {
        document.getElementById('qsProcessing').classList.remove('show');
        btn.disabled=false; btn.textContent='ترجمه و پرداخت ←';
        toast('❌ خطا در پردازش سند. لطفاً دوباره تلاش کنید.');
    }
}

function qsSimulatePayment() {
    if (!QS.blob) { toast('خطا — فایل یافت نشد.'); return; }
    const url=URL.createObjectURL(QS.blob);
    const a=document.createElement('a'); a.href=url; a.download='DeepT_Translation.docx';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast('✅ پرداخت موفق — فایل دانلود شد');
    setTimeout(closeModals, 2000);
}


// ── VIEW CONTROLLER ──
/* ============ SECTION: ADMIN PANEL (users + CRM) ============
   Admin wallet topup/deduct/toggle/delete + CRM reports. ============ */
function showDashboardView() {
    const lp=document.getElementById('landingPage');
    if(lp) lp.style.display='none';
    openWorkspaceDashboard();
}

function showAdminDashboard() {
    const lp = document.getElementById('landingPage');
    if (lp) lp.style.display = 'none';
    const hb = document.querySelector('.header-bar');
    if (hb) hb.classList.remove('hidden');
    document.getElementById('workspaceDashboard').classList.add('hidden');
    document.getElementById('clientsWorkspace').classList.add('hidden');
    document.getElementById('clientProfilePage').classList.add('hidden');
    document.getElementById('workSchedulePage').classList.add('hidden');
    document.getElementById('settingsPage').classList.add('hidden');
    document.getElementById('myPriceListPage').classList.add('hidden');
    document.getElementById('adminDashboard').classList.remove('hidden');
    switchAdminTab('users');
    loadAdminUsers();
    // Without its own URL, a reload had nowhere to route back to and fell
    // through to the landing page instead -- navigateTo is a no-op if the
    // address bar already says /admin (e.g. when applyRouteForPath itself
    // calls this on a reload), so this is safe to call unconditionally.
    navigateTo('/admin');
}

function adminLogout() {
    currentUserSession = null;

    localStorage.removeItem('deept_mock_user');
    localStorage.removeItem('deept_token');
    localStorage.removeItem('deept_user_id');
    localStorage.removeItem('deept_user_name');
    localStorage.removeItem('deept_user_email');
    localStorage.removeItem('deept_is_admin');
    localStorage.removeItem('deept_account_type');
    localStorage.removeItem('deept_office_name');
    localStorage.removeItem('deept_contact_info');

    document.getElementById('adminDashboard')?.classList.add('hidden');

    location.reload();
}

var adminUsersCache = [];
    
function renderAdminUsersRows(users) {
    const tbody = document.getElementById('adminUsersRowsBlock');
    if (!users.length) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-center py-8 text-sm" style="color:var(--text-muted);">کاربری یافت نشد.</td></tr>`;
        return;
    }
    tbody.innerHTML = users.map(u => `
        <tr style="border-bottom:1px solid var(--divider);${(u.email_verified === false || u.is_active === false) ? 'opacity:0.5;' : ''}">
                        <td class="py-3 px-3 en" style="color:var(--text-main);">${escapeHtml(u.email)}</td>
            <td class="py-3 px-3" style="color:var(--text-main);">${escapeHtml(u.full_name)}</td>
            <td class="py-3 px-3" style="color:var(--text-muted);">${u.account_type === 'office' ? 'دارالترجمه' : 'حقیقی'}</td>
            <td class="py-3 px-3 font-mono font-bold text-base" style="color:var(--accent);">${u.balance_toman.toLocaleString()}</td>
            <td class="py-3 px-3">
                <div class="flex items-center gap-1.5">
                    <input type="number" id="topup-${u.user_id}" placeholder="مبلغ" class="auth-input text-sm w-28 py-2">
                    <button onclick="adminTopup('${u.user_id}')" class="text-sm font-bold px-3 py-2 rounded-lg" style="background:var(--accent);color:var(--btn-text-on-accent);">شارژ</button>
                </div>
            </td>
            <td class="py-3 px-3">
                <div class="flex items-center gap-1.5">
                    <input type="number" id="deduct-${u.user_id}" placeholder="مبلغ" class="auth-input text-sm w-28 py-2">
                    <button onclick="adminDeduct('${u.user_id}')" class="text-sm font-bold px-3 py-2 rounded-lg" style="background:#f87171;color:#fff;">کسر</button>
                </div>
            </td>
            <td class="py-3 px-3">
                    <div class="flex flex-col items-start gap-1.5">
                        <button onclick="adminToggleActive('${u.user_id}', ${u.email_verified === false || u.is_active === false})" class="text-sm font-bold px-3 py-2 rounded-lg" style="background:${(u.email_verified === false || u.is_active === false) ? '#4ade80' : '#f87171'};color:#fff;">
                            ${(u.email_verified === false || u.is_active === false) ? 'فعال‌سازی' : 'غیرفعال‌سازی'}
                        </button>
                        <button onclick="adminDeleteUser('${u.user_id}', '${(u.email||'').replace(/'/g,"")}')" class="text-sm font-bold px-3 py-2 rounded-lg" style="background:#7f1d1d;color:#fff;">
                            حذف دائمی
                        </button>
                    </div>
                </td>
            <td class="py-3 px-3">
                <button onclick="adminViewUserJobs('${u.user_id}', '${(u.email||'').replace(/'/g,"")}')" class="text-sm font-bold px-3 py-2 rounded-lg" style="background:var(--bg-main);color:var(--text-main);border:1px solid var(--border-subtle);">مشاهده</button>
            </td>
        </tr>
    `).join('');
}

function filterAdminUsers() {
    const query = (document.getElementById('adminUserSearchInput').value || '').trim().toLowerCase();
    const filtered = query
        ? adminUsersCache.filter(u => (u.email || '').toLowerCase().includes(query))
        : adminUsersCache;
    renderAdminUsersRows(filtered);
}

async function loadAdminUsers() {
    const token = localStorage.getItem('deept_token');
    const tbody = document.getElementById('adminUsersRowsBlock');
    try {
        const res = await fetch(`${CORE}/wallet/admin/users`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) {
            tbody.innerHTML = `<tr><td colspan="6" class="text-center py-8 text-sm" style="color:var(--text-muted);">خطا در دریافت لیست کاربران.</td></tr>`;
            return;
        }
        adminUsersCache = await res.json();
        const searchInput = document.getElementById('adminUserSearchInput');
        if (searchInput) searchInput.value = '';
        renderAdminUsersRows(adminUsersCache);
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-center py-8 text-sm" style="color:var(--text-muted);">خطا در اتصال.</td></tr>`;
    }
}
async function adminDeduct(userId) {
    const token = localStorage.getItem('deept_token');
    const input = document.getElementById(`deduct-${userId}`);
    const amount = parseInt(input.value, 10);
    if (!amount || amount <= 0) { showToast('مبلغ نامعتبر است.'); return; }
    if (!confirm(`کسر ${amount.toLocaleString()} تومان از این کاربر؟`)) return;
    try {
        const res = await fetch(`${CORE}/wallet/admin/deduct`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ user_id: userId, amount_toman: amount, document_type: 'manual-admin-adjustment', description: 'کسر دستی توسط ادمین' })
        });
        const data = await res.json();
        if (!res.ok) { showToast(data.detail || 'خطا در کسر اعتبار.'); return; }
        showToast(`کسر موفق. موجودی جدید: ${data.balance_toman.toLocaleString()} تومان`);
        input.value = '';
        loadAdminUsers();
    } catch (e) {
        showToast('خطا در اتصال.');
    }
}

async function adminToggleActive(userId, makeActive) {
    const token = localStorage.getItem('deept_token');
    const actionLabel = makeActive ? 'فعال‌سازی' : 'غیرفعال‌سازی';
    if (!confirm(`${actionLabel} این حساب؟`)) return;
    try {
        const res = await fetch(`${CORE}/wallet/admin/toggle-active`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ user_id: userId, is_active: makeActive })
        });
        const data = await res.json();
        if (!res.ok) { showToast(data.detail || 'خطا.'); return; }
        showToast(`✅ ${actionLabel} انجام شد.`);
        loadAdminUsers();
    } catch (e) {
        showToast('خطا در اتصال.');
    }
}

async function adminDeleteUser(userId, userEmail) {
    const typed = prompt(`این عملیات غیرقابل بازگشت است و تمام اطلاعات این کاربر (پروژه‌ها، تراکنش‌ها، کیف پول) را برای همیشه حذف می‌کند.\n\nبرای تایید، ایمیل کاربر را دقیقاً تایپ کنید:\n${userEmail}`);
    if (typed !== userEmail) {
        if (typed !== null) showToast('ایمیل واردشده مطابقت ندارد. عملیات لغو شد.');
        return;
    }
    const token = localStorage.getItem('deept_token');
    try {
        const res = await fetch(`${CORE}/wallet/admin/users/${userId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        if (!res.ok) { showToast(data.detail || 'خطا در حذف حساب.'); return; }
        showToast('✅ حساب کاربر برای همیشه حذف شد.');
        loadAdminUsers();
    } catch (e) {
        showToast('خطا در اتصال.');
    }
}

async function adminTopup(userId) {
    const token = localStorage.getItem('deept_token');
    const input = document.getElementById(`topup-${userId}`);
    const amount = parseInt(input.value, 10);
    if (!amount || amount <= 0) { showToast('مبلغ نامعتبر است.'); return; }
    try {
        const res = await fetch(`${CORE}/wallet/topup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ user_id: userId, amount_toman: amount })
        });
        const data = await res.json();
        if (!res.ok) { showToast(data.detail || 'خطا در شارژ.'); return; }
        showToast(`شارژ موفق. موجودی جدید: ${data.balance_toman.toLocaleString()} تومان`);
        input.value = '';
        loadAdminUsers();
    } catch (e) {
        showToast('خطا در اتصال.');
    }
}

async function adminViewUserJobs(userId, email) {
    const token = localStorage.getItem('deept_token');
    const panel = document.getElementById('adminUserJobsPanel');
    const tbody = document.getElementById('adminUserJobsRowsBlock');
    document.getElementById('adminUserJobsTitle').textContent = `پروژه‌های ${email}`;
    panel.classList.remove('hidden');
    tbody.innerHTML = `<tr><td colspan="5" class="text-center py-8 text-sm" style="color:var(--text-muted);">در حال بارگذاری...</td></tr>`;
    try {
        const res = await fetch(`${CORE}/jobs?user_id=${userId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) {
            tbody.innerHTML = `<tr><td colspan="5" class="text-center py-8 text-sm" style="color:var(--text-muted);">خطا در دریافت پروژه‌ها.</td></tr>`;
            return;
        }
        const jobs = await res.json();
        if (!jobs.length) {
            tbody.innerHTML = `<tr><td colspan="5" class="text-center py-8 text-sm" style="color:var(--text-muted);">این کاربر پروژه‌ای ندارد.</td></tr>`;
            return;
        }
        const typeLabel = (t) => DOCUMENT_REGISTRY[t]?.label || t;
        const statusLabel = (s) => ({queued:'در صف', processing:'در حال پردازش', completed:'تکمیل شده', failed:'ناموفق'}[s] || s);
        tbody.innerHTML = jobs.map(j => `
            <tr style="border-bottom:1px solid var(--divider);">
                <td class="py-2 px-2" style="color:var(--text-main);">${typeLabel(j.document_type)}</td>
                <td class="py-2 px-2" style="color:var(--text-muted);">${statusLabel(j.status)}</td>
                <td class="py-2 px-2 font-mono" style="color:var(--text-main);">${(j.price_toman||0).toLocaleString()}</td>
                                <td class="py-2 px-2 en" style="color:var(--text-muted);">${escapeHtml(j.original_filename)}</td>
                <td class="py-2 px-2 en" style="color:var(--text-muted);">${(j.created_at||'').slice(0,10)}</td>
            </tr>
        `).join('');
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-center py-8 text-sm" style="color:var(--text-muted);">خطا در اتصال.</td></tr>`;
    }
}

// ── CRM PANEL LOGIC ──
var adminCrmJobsCache = [];

/* ============ SECTION: ADMIN CRM REPORTS ============
   Time-frame selector, doc-type stats, filters, jobs table. ============ */
function switchAdminTab(tab) {
    const usersPanel = document.getElementById('adminUsersPanel');
    const crmPanel = document.getElementById('adminCrmPanel');
    const tabUsersBtn = document.getElementById('adminTabUsers');
    const tabCrmBtn = document.getElementById('adminTabCrm');
    
    const jobsPanel = document.getElementById('adminUserJobsPanel');
    if (jobsPanel) jobsPanel.classList.add('hidden');
    
    if (tab === 'users') {
        if (usersPanel) usersPanel.classList.remove('hidden');
        if (crmPanel) crmPanel.classList.add('hidden');
        
        if (tabUsersBtn) {
            tabUsersBtn.classList.add('border-b-2');
            tabUsersBtn.style.borderColor = 'var(--accent)';
            tabUsersBtn.style.color = 'var(--accent)';
            tabUsersBtn.classList.remove('border-transparent');
        }
        if (tabCrmBtn) {
            tabCrmBtn.classList.remove('border-b-2');
            tabCrmBtn.style.borderColor = 'transparent';
            tabCrmBtn.style.color = 'var(--text-muted)';
        }
    } else if (tab === 'crm') {
        if (usersPanel) usersPanel.classList.add('hidden');
        if (crmPanel) crmPanel.classList.remove('hidden');
        
        if (tabCrmBtn) {
            tabCrmBtn.classList.add('border-b-2');
            tabCrmBtn.style.borderColor = 'var(--accent)';
            tabCrmBtn.style.color = 'var(--accent)';
            tabCrmBtn.classList.remove('border-transparent');
        }
        if (tabUsersBtn) {
            tabUsersBtn.classList.remove('border-b-2');
            tabUsersBtn.style.borderColor = 'transparent';
            tabUsersBtn.style.color = 'var(--text-muted)';
        }
        
        loadAdminCrmData();
    }
}

async function loadAdminCrmData() {
    const token = localStorage.getItem('deept_token');
    const tableBody = document.getElementById('crmJobsTableBody');
    if (tableBody) {
        tableBody.innerHTML = `<tr><td colspan="7" class="text-center py-8 text-sm" style="color:var(--text-muted);">در حال بارگذاری داده‌های CRM...</td></tr>`;
    }
    
    try {
        // Scope the fetch to the persisted time-frame (if any) instead of
        // always pulling every job ever created -- see GET /jobs/admin/all's
        // own docstring. "همهٔ زمان‌ها" (no saved year) still fetches
        // everything, same as before this existed.
        const tf = getSavedCrmTimeFrame();
        const qs = new URLSearchParams();
        if (tf.year) qs.set('year', tf.year);
        if (tf.year && tf.month) qs.set('month', tf.month);
        const url = `${CORE}/jobs/admin/all${qs.toString() ? '?' + qs.toString() : ''}`;
        const res = await fetch(url, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) {
            if (tableBody) tableBody.innerHTML = `<tr><td colspan="7" class="text-center py-8 text-sm" style="color:var(--text-muted);">خطا در بارگذاری داده‌های CRM.</td></tr>`;
            showToast('خطا در بارگذاری داده‌های CRM');
            return;
        }
        adminCrmJobsCache = await res.json();
        
        populateCrmDocTypeFilter();
        populateCrmTimeFrameSelects();
        updateCrmDashboard();
    } catch (e) {
        console.error(e);
        if (tableBody) tableBody.innerHTML = `<tr><td colspan="7" class="text-center py-8 text-sm" style="color:var(--text-muted);">خطا در اتصال به سرور.</td></tr>`;
        showToast('خطا در ارتباط با سرور.');
    }
}

function populateCrmDocTypeFilter() {
    const select = document.getElementById('crmDocTypeFilter');
    if (!select || select.options.length > 1) return;
    
    Object.entries(DOCUMENT_REGISTRY).forEach(([key, doc]) => {
        const opt = document.createElement('option');
        opt.value = key;
        opt.textContent = doc.label;
        select.appendChild(opt);
    });
}

// ── CRM Time-Frame (Gregorian, persisted) ────────────────────────
const CRM_TF_KEY = 'deept_crm_timeframe';
const CRM_GREG_MONTH_LABELS = ['ژانویه','فوریه','مارس','آوریل','مه','ژوئن','ژوئیه','اوت','سپتامبر','اکتبر','نوامبر','دسامبر'];

// Reads the persisted year/month selection directly from localStorage --
// used by loadAdminCrmData() to decide what to *fetch* (year/month query
// params, see GET /jobs/admin/all), independent of whether the <select>
// elements happen to be populated yet (populateCrmTimeFrameSelects() only
// runs after the fetch, same as before this scoping existed).
function getSavedCrmTimeFrame() {
    try {
        const saved = JSON.parse(localStorage.getItem(CRM_TF_KEY) || 'null');
        if (saved && typeof saved.year !== 'undefined') return { year: saved.year || '', month: saved.month || '' };
    } catch (e) {}
    return { year: '', month: '' };
}

function populateCrmTimeFrameSelects() {
    const yearSel = document.getElementById('crmStatsYear');
    const monthSel = document.getElementById('crmStatsMonth');
    if (!yearSel || !monthSel) return;
    // Populate once
    if (yearSel.options.length === 0) {
        const nowY = new Date().getFullYear();
        const years = [];
        for (let y = nowY + 1; y >= nowY - 4; y--) years.push(y);
        yearSel.innerHTML = '<option value="">همهٔ زمان‌ها</option>' + years.map(y => `<option value="${y}">${y.toLocaleString('fa-IR', {useGrouping:false})}</option>`).join('');
        monthSel.innerHTML = '<option value="">کل سال</option>' + CRM_GREG_MONTH_LABELS.map((lbl, i) => `<option value="${i+1}">${lbl}</option>`).join('');
    }
    // Restore from localStorage
    try {
        const saved = JSON.parse(localStorage.getItem(CRM_TF_KEY) || 'null');
        if (saved && typeof saved.year !== 'undefined') {
            yearSel.value = saved.year || '';
            monthSel.value = saved.month || '';
        } else {
            yearSel.value = '';
            monthSel.value = '';
        }
    } catch(e) { yearSel.value=''; monthSel.value=''; }
    syncCrmMonthDisabled();
    updateCrmTimeFrameLabel();
}

function syncCrmMonthDisabled() {
    const yearSel = document.getElementById('crmStatsYear');
    const monthSel = document.getElementById('crmStatsMonth');
    if (!yearSel || !monthSel) return;
    const hasYear = !!yearSel.value;
    monthSel.disabled = !hasYear;
    monthSel.style.opacity = hasYear ? '1' : '0.5';
    if (!hasYear) monthSel.value = '';
}

function getCrmStatsRange() {
    const yearSel = document.getElementById('crmStatsYear');
    const monthSel = document.getElementById('crmStatsMonth');
    const y = yearSel ? parseInt(yearSel.value, 10) : NaN;
    if (isNaN(y)) return null;
    const m = monthSel ? parseInt(monthSel.value, 10) : NaN;
    if (isNaN(m)) {
        // whole year
        return { start: new Date(y, 0, 1), end: new Date(y + 1, 0, 1) };
    }
    return { start: new Date(y, m - 1, 1), end: new Date(y, m, 1) };
}

function getCrmStatsLabel() {
    const yearSel = document.getElementById('crmStatsYear');
    const monthSel = document.getElementById('crmStatsMonth');
    const yVal = yearSel ? yearSel.value : '';
    const mVal = monthSel ? monthSel.value : '';
    if (!yVal) return 'همهٔ زمان‌ها';
    if (!mVal) return `سال ${parseInt(yVal,10).toLocaleString('fa-IR', {useGrouping:false})}`;
    const idx = parseInt(mVal,10) - 1;
    return `${CRM_GREG_MONTH_LABELS[idx]} ${parseInt(yVal,10).toLocaleString('fa-IR', {useGrouping:false})}`;
}

function updateCrmTimeFrameLabel() {
    const el = document.getElementById('crmStatsRangeLabel');
    if (!el) return;
    const label = getCrmStatsLabel();
    el.textContent = label === 'همهٔ زمان‌ها' ? '' : `▸ ${label}`;
}

function onCrmTimeFrameChange() {
    syncCrmMonthDisabled();
    updateCrmTimeFrameLabel();
    const yearSel = document.getElementById('crmStatsYear');
    const monthSel = document.getElementById('crmStatsMonth');
    try {
        localStorage.setItem(CRM_TF_KEY, JSON.stringify({ year: yearSel.value || '', month: monthSel.value || '' }));
    } catch(e) {}
    // Re-fetch scoped to the newly-picked time-frame, rather than
    // re-filtering whatever's already in adminCrmJobsCache -- that cache
    // may only ever have held the PREVIOUS time-frame's jobs to begin
    // with (see loadAdminCrmData()), so a wider or different selection
    // needs its own fetch, not just a re-filter of what's already local.
    loadAdminCrmData();
}

function resetCrmTimeFrame() {
    const yearSel = document.getElementById('crmStatsYear');
    const monthSel = document.getElementById('crmStatsMonth');
    if (yearSel) yearSel.value = '';
    if (monthSel) monthSel.value = '';
    try { localStorage.removeItem(CRM_TF_KEY); } catch(e) {}
    syncCrmMonthDisabled();
    updateCrmTimeFrameLabel();
    // Same reasoning as onCrmTimeFrameChange() above -- "همهٔ زمان‌ها" needs
    // a full re-fetch (everything), not a re-filter of a possibly-scoped cache.
    loadAdminCrmData();
}

function updateCrmDashboard() {
    // Ensure selects are populated (for direct calls)
    if (document.getElementById('crmStatsYear') && document.getElementById('crmStatsYear').options.length === 0) {
        populateCrmTimeFrameSelects();
    } else {
        syncCrmMonthDisabled();
        updateCrmTimeFrameLabel();
    }

    const range = getCrmStatsRange();
    const label = getCrmStatsLabel();
    const filteredForStats = range ? adminCrmJobsCache.filter(j => {
        const d = new Date(j.created_at);
        return !isNaN(d) && d >= range.start && d < range.end;
    }) : [...adminCrmJobsCache];

    const totalMonthly = filteredForStats.length;
    const completedMonthly = filteredForStats.filter(j => j.status === 'completed');
    const failedMonthly = filteredForStats.filter(j => j.status === 'failed');
    
    const profitMonthly = completedMonthly.reduce((sum, j) => sum + (j.price_toman || 0), 0);
    const failureRateMonthly = totalMonthly > 0 ? ((failedMonthly.length / totalMonthly) * 100).toFixed(1) : '0';

    // Dynamic labels — beside همهٔ زمان‌ها concept
    const profitLabelEl = document.getElementById('crmStatProfitLabel');
    const profitSubEl = document.getElementById('crmStatProfitSub');
    const workLabelEl = document.getElementById('crmStatWorkLabel');
    const failureLabelEl = document.getElementById('crmStatFailureLabel');
    if (profitLabelEl) profitLabelEl.textContent = label === 'همهٔ زمان‌ها' ? 'سود بازه انتخابی (تومان)' : `سود ${label} (تومان)`;
    if (profitSubEl) profitSubEl.textContent = label === 'همهٔ زمان‌ها' ? 'جمع پرداختی کارهای موفق — همهٔ زمان‌ها' : `جمع پرداختی کارهای موفق — ${label}`;
    if (workLabelEl) workLabelEl.textContent = label === 'همهٔ زمان‌ها' ? 'تعداد کل کارها' : `تعداد کل کارهای ${label}`;
    if (failureLabelEl) failureLabelEl.textContent = label === 'همهٔ زمان‌ها' ? 'نرخ ناموفق' : `نرخ ناموفق ${label}`;
    
    document.getElementById('crmStatProfit').textContent = profitMonthly.toLocaleString();
    document.getElementById('crmStatWorkCount').textContent = totalMonthly.toLocaleString();
    document.getElementById('crmStatWorkDetails').textContent = `موفق: ${completedMonthly.length.toLocaleString()} | ناموفق: ${failedMonthly.length.toLocaleString()}`;
    document.getElementById('crmStatFailureRate').textContent = `${failureRateMonthly}%`;
    
    // Build per-document-type aggregation for the SELECTED time-frame (global)
    const docTypeStats = {};
    Object.entries(DOCUMENT_REGISTRY).forEach(([key, doc]) => {
        docTypeStats[key] = { label: doc.label, total: 0, completed: 0, failed: 0, revenue: 0 };
    });
    
    filteredForStats.forEach(j => {
        const t = j.document_type;
        if (!docTypeStats[t]) {
            docTypeStats[t] = { label: t, total: 0, completed: 0, failed: 0, revenue: 0 };
        }
        docTypeStats[t].total++;
        if (j.status === 'completed') {
            docTypeStats[t].completed++;
            docTypeStats[t].revenue += (j.price_toman || 0);
        } else if (j.status === 'failed') {
            docTypeStats[t].failed++;
        }
    });

    // Only types that have at least one job in the selected frame
    const grandTotal = filteredForStats.length;
    const activeTypes = Object.entries(docTypeStats)
        .filter(([_, s]) => s.total > 0)
        .sort((a, b) => b[1].total - a[1].total);

    // Shared colour palette
    const palette = ['#00ffff','#60a5fa','#a78bfa','#34d399','#f59e0b','#f87171','#fb923c','#e879f9','#38bdf8','#4ade80'];

    // ── Summary Table ──────────────────────────────────────────
    const tableTbody = document.getElementById('crmDocTypeSummaryTableBody');
    if (tableTbody) {
        if (activeTypes.length === 0) {
            tableTbody.innerHTML = `<tr><td colspan="6" class="text-center py-4" style="color:var(--text-muted);">داده‌ای وجود ندارد.</td></tr>`;
        } else {
            tableTbody.innerHTML = activeTypes.map(([key, s], idx) => {
                const share = grandTotal > 0 ? ((s.total / grandTotal) * 100).toFixed(1) : '0.0';
                const color = palette[idx % palette.length];
                return `
                    <tr style="border-bottom:1px solid var(--divider);">
                        <td class="py-2 px-1" style="color:var(--text-main);">
                            <span class="inline-block w-2 h-2 rounded-full ml-1" style="background:${color};vertical-align:middle;"></span>${s.label}
                        </td>
                        <td class="py-2 px-1 text-center font-black en" style="color:var(--text-main);">${s.total.toLocaleString()}</td>
                        <td class="py-2 px-1 text-center en" style="color:#4ade80;">${s.completed.toLocaleString()}</td>
                        <td class="py-2 px-1 text-center en" style="color:#f87171;">${s.failed.toLocaleString()}</td>
                        <td class="py-2 px-1 text-center en font-bold" style="color:var(--accent);">${share}%</td>
                        <td class="py-2 px-1 text-center en" style="color:var(--text-muted);">${s.revenue.toLocaleString()}</td>
                    </tr>
                `;
            }).join('');
        }
    }

    // ── Horizontal Bar Graph ───────────────────────────────────
    const graphContainer = document.getElementById('crmDocTypeSummaryGraphContainer');
    if (graphContainer) {
        if (activeTypes.length === 0) {
            graphContainer.innerHTML = `<div class="text-center py-4 text-xs" style="color:var(--text-muted);">داده‌ای وجود ندارد.</div>`;
        } else {
            const maxTotal = activeTypes[0][1].total; // already sorted desc
            graphContainer.innerHTML = activeTypes.map(([key, s], idx) => {
                const barWidthPct = maxTotal > 0 ? ((s.total / maxTotal) * 100).toFixed(1) : 0;
                const sharePct   = grandTotal > 0 ? ((s.total / grandTotal) * 100).toFixed(1) : '0.0';
                const color = palette[idx % palette.length];
                return `
                    <div>
                        <div class="flex items-center justify-between mb-1">
                            <span class="text-xs font-bold truncate" style="color:var(--text-main); max-width:55%;" title="${s.label}">${s.label}</span>
                            <span class="text-xs font-mono font-black en" style="color:${color}; white-space:nowrap;">
                                ${s.total.toLocaleString()} <span style="color:var(--text-muted); font-weight:400;">(${sharePct}%)</span>
                            </span>
                        </div>
                        <div class="w-full rounded-full overflow-hidden" style="height:10px; background:var(--bg-main);">
                            <div class="h-full rounded-full transition-all duration-700"
                                 style="width:${barWidthPct}%; background: linear-gradient(90deg, ${color}99, ${color}); box-shadow: 0 0 6px ${color}55;">
                            </div>
                        </div>
                    </div>
                `;
            }).join('');
        }
    }

    applyCrmFilters();
}

function applyCrmFilters() {
    const emailQuery = (document.getElementById('crmEmailFilter').value || '').trim().toLowerCase();
    const docTypeVal = document.getElementById('crmDocTypeFilter').value;
    const statusVal = document.getElementById('crmStatusFilter').value;
    const dateVal = document.getElementById('crmDateFilter').value;
    
    const now = new Date();
    
    const filtered = adminCrmJobsCache.filter(j => {
        if (emailQuery && !(j.email || '').toLowerCase().includes(emailQuery)) {
            return false;
        }
        if (docTypeVal && j.document_type !== docTypeVal) {
            return false;
        }
        if (statusVal && j.status !== statusVal) {
            return false;
        }
        if (dateVal) {
            const jobDate = new Date(j.created_at);
            if (dateVal === 'today') {
                if (jobDate.toDateString() !== now.toDateString()) return false;
            } else if (dateVal === 'yesterday') {
                const yesterday = new Date();
                yesterday.setDate(now.getDate() - 1);
                if (jobDate.toDateString() !== yesterday.toDateString()) return false;
            } else if (dateVal === 'last7') {
                const diffTime = Math.abs(now - jobDate);
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                if (diffDays > 7) return false;
            } else if (dateVal === 'last30') {
                const diffTime = Math.abs(now - jobDate);
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                if (diffDays > 30) return false;
            } else if (dateVal === 'thisMonth') {
                if (jobDate.getFullYear() !== now.getFullYear() || jobDate.getMonth() !== now.getMonth()) {
                    return false;
                }
            }
        }
        return true;
    });
    
    document.getElementById('crmFilteredCount').textContent = `یافت شده: ${filtered.length.toLocaleString()} کار`;
    
    const tbody = document.getElementById('crmJobsTableBody');
    if (!tbody) return;
    
    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-center py-8 text-sm" style="color:var(--text-muted);">هیچ کاری با مشخصات فیلتر شده یافت نشد.</td></tr>`;
        return;
    }
    
    const typeLabel = (t) => DOCUMENT_REGISTRY[t]?.label || t;
    const statusLabel = (s) => ({
        queued: 'در صف',
        processing: 'در حال پردازش',
        completed: 'تکمیل شده',
        failed: 'ناموفق'
    }[s] || s);
    
    const statusBadgeStyle = (s) => {
        if (s === 'completed') return 'background:#4ade80; color:#000; font-weight:bold;';
        if (s === 'failed') return 'background:#f87171; color:#fff; font-weight:bold;';
        if (s === 'processing') return 'background:#60a5fa; color:#000; font-weight:bold;';
        return 'background:#9ca3af; color:#000;';
    };
    
    tbody.innerHTML = filtered.map(j => {
        const errMsg = j.error_message ? escapeHtml(j.error_message) : '—';
        const dateStr = (j.created_at || '').slice(0, 10) + ' ' + (j.created_at || '').slice(11, 16);
        return `
            <tr style="border-bottom:1px solid var(--divider);">
                <td class="py-2 px-2 en text-right" style="color:var(--text-main); font-size:0.8rem;" dir="ltr">${escapeHtml(j.email)}</td>
                <td class="py-2 px-2" style="color:var(--text-main);">${typeLabel(j.document_type)}</td>
                <td class="py-2 px-2 text-center">
                    <span class="px-2 py-0.5 rounded text-xs" style="${statusBadgeStyle(j.status)}">
                        ${statusLabel(j.status)}
                    </span>
                </td>
                <td class="py-2 px-2 text-center en" style="color:var(--text-muted); font-size:0.8rem;">${dateStr}</td>
                <td class="py-2 px-2 text-center font-mono" style="color:var(--text-main);">${(j.price_toman || 0).toLocaleString()}</td>
                <td class="py-2 px-2 en text-right" style="color:var(--text-muted); font-size:0.85rem;" dir="ltr">${escapeHtml(j.original_filename)}</td>
                <td class="py-2 px-2 text-xs text-red-400 max-w-xs truncate" title="${errMsg}" style="color: #fb7185;">${errMsg}</td>
            </tr>
        `;
    }).join('');
}

// ── THEME ──

// alias for landing page toggle button
/* ============ SECTION: THEME, BACKGROUND CANVAS & BOOT ============
   data-theme attribute + body::before grid draw + final init IIFEs. ============ */
function toggleTheme() { toggleGlobalTheme(); }

// ── CANVAS NODES ──
(function() {
    const canvas = document.getElementById('bgCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let W = canvas.width  = window.innerWidth;
    let H = canvas.height = window.innerHeight;
    const nodes = [];
    for (let i = 0; i < 80; i++) nodes.push({
        x:  Math.random() * W,
        y:  Math.random() * H,
        vx: (Math.random() - .5) / 6,
        vy: (Math.random() - .5) / 6
    });
    function draw() {
        W = canvas.width  = window.innerWidth;
        H = canvas.height = window.innerHeight;
        ctx.clearRect(0, 0, W, H);
        const light = document.body.getAttribute('data-theme') === 'light';
        canvas.style.opacity = light ? '0.12' : '0.55';
        for (let i = 0; i < nodes.length; i++) {
            for (let j = i + 1; j < nodes.length; j++) {
                const dx = nodes[i].x - nodes[j].x;
                const dy = nodes[i].y - nodes[j].y;
                const d  = Math.sqrt(dx*dx + dy*dy);
                if (d < 160) {
                    ctx.beginPath();
                    ctx.moveTo(nodes[i].x, nodes[i].y);
                    ctx.lineTo(nodes[j].x, nodes[j].y);
                    ctx.strokeStyle = light
                        ? `rgba(0,114,168,${(1-d/160)*.18})`
                        : `rgba(0,212,255,${(1-d/160)*.65})`;
                    ctx.lineWidth = .8;
                    ctx.stroke();
                }
            }
            ctx.beginPath();
            ctx.arc(nodes[i].x, nodes[i].y, 1.7, 0, Math.PI*2);
            ctx.fillStyle = light ? '#0072a8' : '#00d4ff';
            ctx.fill();
            nodes[i].x += nodes[i].vx;
            nodes[i].y += nodes[i].vy;
            if (nodes[i].x < 0 || nodes[i].x > W) nodes[i].vx *= -1;
            if (nodes[i].y < 0 || nodes[i].y > H) nodes[i].vy *= -1;
        }
        requestAnimationFrame(draw);
    }
    window.addEventListener('resize', () => {
        W = canvas.width  = window.innerWidth;
        H = canvas.height = window.innerHeight;
    });
    draw();
})();

// ── INIT ──
// SECONDARY INIT — runs after initializeApp(); only handles things that
// don't belong in the primary init block (CRM selects).
// Theme restore, test session, syncUserSessionDOM, activation redirect
// and routing all live in initializeApp() and must NOT be duplicated here.
(function(){

    // CRM time-frame selects — init early so they are ready when admin opens CRM
    try { populateCrmTimeFrameSelects(); } catch(e) {}
})();
