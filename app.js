/* ========================================================================
   DeepT front-end application logic (app.js)
   ------------------------------------------------------------------------
   FEATURES: auth (DeepT-Core), passport extraction, document translation
   pipeline, dashboard / settings / admin platform reports, wallet+Shaparak,
   date tool, quick-start (no-signup), SPA routing (404.html redirect ->
   applyRouteForPath). The office CRM (clients, invoices, price list, Sanam,
   work orders/schedule, HR) lives in crm.js, which loads BEFORE this file.

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

const CORE    = 'https://core-ir.deept.ir';
const BACKEND = 'https://backend-ir.deept.ir';

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
        courseCodesToggle:   true,   // shows the "نمایش کد دروس" checkbox, sends include_course_codes
        chunkedUpload:       true,   // backend accepts upload_id as a fallback for large/flaky uploads
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
    'general-transcript': {
        label:               'ریزنمرات سیستم گلستان',
        endpoint: `${BACKEND}/api/translate/general-transcript`,
        active:              true,
        usePassportSession:  true,
        courseCodesToggle:   true,
        chunkedUpload:       true,
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
    },    'national-id-card': {
        label:               'کارت ملی',
        // Text read by eboo OCR, not Gemini vision (see national_id_card.py
        // on DeepT-Back-End). One file: front only, or a PDF of both sides.
        endpoint: `${BACKEND}/api/translate/national-id-card`,
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
    toggle('logoutHeaderBtn',    !loggedIn);
    // HR clock in/out: office-only sub-users (see hr.py) -- an "individual"
    // account has no staff to punch in/out, so this stays hidden for it.
    const isOffice = loggedIn && currentUserSession.type === 'office';
    // Nav destination buttons, now living inside the header-bar itself
    // (see index.html) rather than a separate rail element.
    toggle('railHomeBtn',        !loggedIn);
    toggle('railWorkspaceBtn',   !loggedIn);
    toggle('railClientsBtn',     !loggedIn);
    toggle('railScheduleBtn',    !loggedIn);
    toggle('railPriceListBtn',   !loggedIn);
    toggle('railSettingsBtn',    !loggedIn);
    toggle('railAccountSettingsBtn', !loggedIn);
    toggle('railAdminPanelBtn',  !loggedIn || localStorage.getItem('deept_is_admin') !== '1');
    toggle('railHrClockBtn',    !isOffice);
    // صفحه نخست panel grid -- same admin/office gating as the rail buttons above.
    toggle('homePanelAdmin',    !loggedIn || localStorage.getItem('deept_is_admin') !== '1');
    toggle('homePanelHr',       !isOffice);
    const ub = document.getElementById('userBadge');
    if (ub) { ub.classList.toggle('hidden', !loggedIn); ub.style.display = loggedIn ? 'flex' : 'none'; }
    toggle('headerWalletBadge', !loggedIn);
    if (loggedIn) {
        const displayName = currentUserSession.office || currentUserSession.username || currentUserSession.email || '؟';
        const l = displayName[0].toUpperCase();
        const set = (id, val) => { const el=document.getElementById(id); if(el) el.textContent=val; };
        set('avatarLetter',       l);
        set('headerAvatarBadge',  l);
        set('headerUserName',     displayName);
        set('profileDisplayName', displayName);
        set('profileEmailBadge',  currentUserSession.email || '');
        // صفحه نخست's own read-only profile+wallet card -- same data,
        // kept in sync alongside میز کار's copy above.
        set('home-avatarLetter',       l);
        set('home-profileDisplayName', displayName);
        set('home-profileEmailBadge',  currentUserSession.email || '');
        const at = document.getElementById('accountTypeToggle');
        if (at) at.value = currentUserSession.type || 'individual';
        const pc = document.getElementById('profileContactInput');
        if (pc) pc.value = currentUserSession.contact || '';
        const on = document.getElementById('officeNameInput');
        if (on) on.value = currentUserSession.office || '';
        toggleProfileAccountType();
        refreshWalletBalanceDisplay();
    }
}

// ═══════════════════════════════════════════════════════════
// USER PROFILE PREVIEW (header userBadge click) -- a read-only glance at
// the logged-in account's own profile (a translator or office using
// DeepT), not that account's مشتریان. Full editing stays in میز کار's own
// profile card; "ویرایش پروفایل" here just jumps there.
// ═══════════════════════════════════════════════════════════
function openUserProfilePreview(event) {
    if (!currentUserSession) return;
    // A click on userBadge bubbles to the document-level listener below
    // (added so clicking anywhere outside the popover closes it) --
    // without stopping it here, the same click that opens the popover
    // would also immediately close it.
    if (event) event.stopPropagation();

    const popover = document.getElementById('userProfilePreviewModal');
    if (!popover.classList.contains('hidden')) { closeUserProfilePreview(); return; }

    const displayName = currentUserSession.office || currentUserSession.username || currentUserSession.email || '؟';
    const isOffice = currentUserSession.type === 'office';
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set('upp-avatar', displayName[0].toUpperCase());
    set('upp-name', displayName);
    set('upp-email', currentUserSession.email || '');
    set('upp-type', isOffice ? 'دارالترجمه رسمی' : 'مترجم حقیقی');

    const officeRow = document.getElementById('upp-office-row');
    if (officeRow) officeRow.classList.toggle('hidden', !isOffice || !currentUserSession.office);
    set('upp-office', currentUserSession.office || '');

    const contactRow = document.getElementById('upp-contact-row');
    if (contactRow) contactRow.classList.toggle('hidden', !currentUserSession.contact);
    set('upp-contact', currentUserSession.contact || '');

    popover.classList.remove('hidden');
    refreshWalletBalanceDisplay();
}
function closeUserProfilePreview() {
    document.getElementById('userProfilePreviewModal').classList.add('hidden');
}
// Click anywhere outside the popover (it's open: event.stopPropagation()
// on both the badge and the popover itself keep this from ever seeing a
// click meant for either) or Escape closes it.
document.addEventListener('click', () => closeUserProfilePreview());
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeUserProfilePreview(); });

// ═══════════════════════════════════════════════════════════
// LOGOUT
// ═══════════════════════════════════════════════════════════
function confirmLogout()   { document.getElementById('logoutOverlay').classList.remove('hidden'); }
function closeLogoutConfirm() { document.getElementById('logoutOverlay').classList.add('hidden'); }
function executeLogout() {
    currentUserSession = null;
    lastKnownJobStatuses = {};
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
    // Leave the address bar on '/' -- otherwise it keeps showing the last
    // authenticated route (e.g. /dashboard or /account-settings) even though
    // a logged-out user shouldn't be able to land back on it.
    window.history.replaceState({}, document.title, '/');
    showToast('👋 با موفقیت خارج شدید.');
}
document.getElementById('logoutOverlay').addEventListener('click', function(e) {
    if (e.target === this) closeLogoutConfirm();
});

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
    // Client-side only (see isJobSoundEnabled()) -- set unconditionally,
    // not inside the server fetch below, so it still reflects correctly
    // even if that request fails.
    document.getElementById('pref-job-sound-enabled').checked = isJobSoundEnabled();
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
    { id:"general_transcript", label:"ریزنمرات سیستم گلستان", full:true, fields:[
        // Every fixed English text DeepT-Back-End's general_transcript.py
        // prints -- keys and defaults must match its PHRASE_DEFAULTS exactly
        // (generated from it). Saved as document_phrases["general_transcript"].
        { key:"document_subtitle", label:"عنوان کارنامه (زیر نام دانشگاه)", kind:"simple", def:"Academic Transcript of Records" },
        { key:"label_student_name", label:"برچسب نام دانشجو", kind:"simple", def:"Student Name" },
        { key:"label_father_name", label:"برچسب نام پدر", kind:"simple", def:"Father's Name" },
        { key:"label_date_of_birth", label:"برچسب تاریخ تولد", kind:"simple", def:"Date of Birth" },
        { key:"label_national_id", label:"برچسب کد ملی", kind:"simple", def:"National ID" },
        { key:"label_birth_certificate_number", label:"برچسب شماره شناسنامه", kind:"simple", def:"Birth Certificate Number" },
        { key:"semester_word", label:"واژهٔ «نیمسال» در عنوان ترم", kind:"simple", def:"Semester" },
        { key:"summer_semester", label:"ترم تابستان", kind:"simple", def:"Summer Semester" },
        { key:"academic_year_word", label:"واژهٔ «سال تحصیلی» در عنوان ترم", kind:"simple", def:"Academic Year" },
        { key:"status_academic_probation", label:"وضعیت «مشروط»", kind:"simple", def:"Academic Probation" },
        { key:"note_prefix", label:"پیشوند توضیحات ترم", kind:"simple", def:"Note:" },
        { key:"col_code", label:"ستون کد درس", kind:"simple", def:"Code" },
        { key:"col_name", label:"ستون نام درس", kind:"simple", def:"Course Name" },
        { key:"col_credits", label:"ستون واحد", kind:"simple", def:"Credit" },
        { key:"col_score", label:"ستون نمره", kind:"simple", def:"Score" },
        { key:"col_effect", label:"ستون اثر", kind:"simple", def:"Effect" },
        { key:"stat_gpa", label:"معدل ترم", kind:"simple", def:"GPA" },
        { key:"stat_attempted_credits", label:"واحد اخذ شده", kind:"simple", def:"Attempted Credits" },
        { key:"stat_earned_credits", label:"واحد گذرانده", kind:"simple", def:"Earned Credits" },
        { key:"stat_total_earned_credits", label:"گذرانده متوالی (کل)", kind:"simple", def:"Total Earned Credits" },
        { key:"stat_cgpa", label:"معدل کل", kind:"simple", def:"CGPA" },
        { key:"abbr_ann", label:"اختصار «اع ش» در ستون نمره", kind:"simple", def:"Ann" },
        { key:"abbr_ann_meaning", label:"توضیح «اع ش» (اعلام شده)", kind:"simple", def:"Announced" },
        { key:"abbr_ew", label:"اختصار «ح ا» در ستون نمره", kind:"simple", def:"EW" },
        { key:"abbr_ew_meaning", label:"توضیح «ح ا» (حذف اضطراری)", kind:"simple", def:"Emergency Withdrawal" },
        { key:"abbr_aw", label:"اختصار «ح م» در ستون نمره", kind:"simple", def:"AW" },
        { key:"abbr_aw_meaning", label:"توضیح «ح م» (حذف آموزشی)", kind:"simple", def:"Academic Withdrawal" },
        { key:"abbr_abw", label:"اختصار «اع ح» در ستون نمره", kind:"simple", def:"ABW" },
        { key:"abbr_abw_meaning", label:"توضیح «اع ح» (اعلام شده در حذف آیین نامه)", kind:"simple", def:"Announced in Bylaw Withdrawal" },
        { key:"abbr_ip", label:"اختصار «اد پ» در ستون نمره", kind:"simple", def:"IP" },
        { key:"abbr_ip_meaning", label:"توضیح «اد پ» (ادامه پروژه)", kind:"simple", def:"In Progress" },
        { key:"score_pass", label:"«قبول» در ستون نمره", kind:"simple", def:"Pass" },
        { key:"degree_bachelor", label:"مقطع کارشناسی", kind:"simple", def:"Bachelor's Degree" },
        { key:"degree_master", label:"مقطع کارشناسی ارشد", kind:"simple", def:"Master's Degree" },
        { key:"degree_phd", label:"مقطع دکتری", kind:"simple", def:"PhD Degree" },
        { key:"study_mode_tuition_free", label:"دوره روزانه", kind:"simple", def:"Tuition-Free" },
        { key:"study_mode_tuition_based", label:"دوره شبانه", kind:"simple", def:"Tuition-Based" },
        { key:"course_type_general", label:"نوع درس: عمومی", kind:"simple", def:"General" },
        { key:"course_type_basic", label:"نوع درس: پایه", kind:"simple", def:"Basic" },
        { key:"course_type_main", label:"نوع درس: اصلی", kind:"simple", def:"Main" },
        { key:"course_type_specialized", label:"نوع درس: تخصصی", kind:"simple", def:"Specialized" },
        { key:"course_type_optional", label:"نوع درس: اختیاری", kind:"simple", def:"Optional" },
        { key:"course_type_internship", label:"نوع درس: کارآموزی", kind:"simple", def:"Internship" },
        { key:"course_type_project", label:"نوع درس: پروژه", kind:"simple", def:"Project" },
        { key:"course_type_elective", label:"نوع درس: انتخابی", kind:"simple", def:"Elective" },
        { key:"course_type_practical", label:"نوع درس: عملی", kind:"simple", def:"Practical" },
        { key:"title_course_type_table", label:"عنوان جدول وضعیت دروس گذرانده بر اساس نوع درس", kind:"simple", def:"Status of Passed Courses Based on Course Type" },
        { key:"label_total_attempted_credits", label:"تعداد واحد اخذ شده تا کنون", kind:"simple", def:"Total Attempted Credits to Date" },
        { key:"title_program_summary", label:"عنوان بخش خلاصه وضعیت تحصیلی", kind:"simple", def:"PROGRAM SUMMARY RECORD HIGHLIGHTS" },
        { key:"label_student_cgpa", label:"معدل کل دانشجو", kind:"simple", def:"Student CGPA" },
        { key:"label_university_cgpa", label:"معدل دانشگاه", kind:"simple", def:"University CGPA" },
        { key:"label_faculty_cgpa", label:"معدل دانشکده", kind:"simple", def:"Faculty CGPA" },
        { key:"label_major_cgpa", label:"معدل رشته", kind:"simple", def:"Major CGPA" },
        { key:"grade_table_title", label:"عنوان جدول توضیح وضع نمرات", kind:"simple", def:"Grade Status Explanation" },
        { key:"grade_col_numeric", label:"ستون نمره عددی", kind:"simple", def:"Numeric Grade" },
        { key:"grade_col_letter", label:"ستون معادل حرفی", kind:"simple", def:"Letter Equivalent" },
        { key:"title_additional_data", label:"عنوان بخش اطلاعات تکمیلی", kind:"simple", def:"ADDITIONAL TRANSCRIPT DATA" },
        { key:"label_date_of_translation", label:"برچسب تاریخ ترجمه", kind:"simple", def:"Date of Translation" },
    ],
      // Course-name glossary for DeepT-Back-End's general_transcript.py --
      // same renderTermGlossary() table as academic_transcript above. These
      // are that file's DEFAULT_COURSE_NAME_GLOSSARY built-ins; a translator
      // can override any of them or add new terms, saved as
      // term_glossary["general_transcript"].
      glossary: { defaults: {
          "کارآموزی در عرصه": "Clinical Training",
          "کارآموزی": "Internship",
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
    ]},    // Keys/defaults must match national_id_card.py on DeepT-Back-End.
    { id:"national_id_card", label:"کارت ملی", full:true, fields:[
        { key:"emblem_line", label:"سطر آرم", kind:"simple", def:"IRI Emblem" },
        { key:"country_line", label:"جمهوری اسلامی ایران", kind:"simple", def:"Islamic Republic of Iran" },
        { key:"organization_line", label:"سازمان ثبت احوال کشور", kind:"simple", def:"National Organization for Civil Registration" },
        { key:"title", label:"عنوان سند", kind:"simple", def:"National ID Card" },
        { key:"photo_caption", label:"زیرنویس محل عکس", kind:"simple", def:"[Printed photo of the holder]" },
        { key:"front_label", label:"عنوان روی کارت", kind:"simple", def:"Front" },
        { key:"label_national_id", label:"شماره ملی", kind:"simple", def:"National ID number:" },
        { key:"label_given_name", label:"نام", kind:"simple", def:"Given name:" },
        { key:"label_surname", label:"نام خانوادگی", kind:"simple", def:"Surname:" },
        { key:"label_date_of_birth", label:"تاریخ تولد", kind:"simple", def:"Date of birth:" },
        { key:"label_father_name", label:"نام پدر", kind:"simple", def:"Father’s name:" },
        { key:"label_expiration_date", label:"پایان اعتبار", kind:"simple", def:"Expiration date:" },
        { key:"overleaf_label", label:"عنوان پشت کارت", kind:"simple", def:"Overleaf" },
        { key:"label_serial", label:"سریال کارت", kind:"simple", def:"Serial No." },
        { key:"overleaf_note_1", label:"اعلام تغییر نشانی به ثبت احوال الزام قانونی دارد.", kind:"simple", def:"The National Organization for Civil Registration MUST be informed about any change in the holder’s address" },
        { key:"overleaf_note_2", label:"از یابنده تقاضا می‌شود کارت را به صندوق پست بیندازد.", kind:"simple", def:"The finder is requested to drop the same in a postbox" },
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
            const formatted = data.balance_toman.toLocaleString();
            // All three copies (میز کار sidebar, header pill, صفحه نخست card)
            // show the same balance -- keep them in lockstep from one fetch.
            ['walletBalanceDisplay', 'headerWalletBalance', 'home-walletBalanceDisplay', 'upp-balance'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.textContent = formatted;
            });
        }
    } catch (e) { /* leave last-known display value on transient network failure */ }
}
async function submitSupportTicket() {
    const textEl = document.getElementById('supportTicketMsg');
    const text = textEl.value.trim();
    if (!text) return;
    const token = getToken();
    if (!token) { openAuthModal(); return; }
    try {
        const res = await fetch(`${CORE}/support/tickets`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: text })
        });
        if (res.ok) {
            textEl.value = '';
            showToast('📩 پیام شما ثبت شد.');
        } else {
            showToast('❌ ارسال تیکت ناموفق بود. دوباره تلاش کنید.');
        }
    } catch (e) {
        showToast('❌ ارسال تیکت ناموفق بود. اتصال خود را بررسی کنید.');
    }
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
    document.getElementById('accountSettingsPage').classList.add('hidden');
    document.getElementById('myPriceListPage').classList.add('hidden');
    document.getElementById('homePanelsPage').classList.add('hidden');
    document.getElementById('dateConverterPage').classList.add('hidden');
    document.getElementById('hrPage').classList.add('hidden');

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
    document.getElementById('accountSettingsPage').classList.add('hidden');
    document.getElementById('myPriceListPage').classList.add('hidden');
    document.getElementById('homePanelsPage').classList.add('hidden');
    document.getElementById('dateConverterPage').classList.add('hidden');
    document.getElementById('hrPage').classList.add('hidden');

    const headerEl = document.querySelector('.header-bar');
    if (headerEl) {
        el.style.paddingTop = (headerEl.offsetHeight + 16) + 'px';
    }

    document.body.style.overflow = 'hidden';
    renderDashboardClients('', true);
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
    const ast = document.getElementById('accountSettingsPage');
    if (ast) ast.classList.add('hidden');
    const pl = document.getElementById('myPriceListPage');
    if (pl) pl.classList.add('hidden');
    const hp = document.getElementById('homePanelsPage');
    if (hp) hp.classList.add('hidden');
    const dc = document.getElementById('dateConverterPage');
    if (dc) dc.classList.add('hidden');
    const hrp = document.getElementById('hrPage');
    if (hrp) hrp.classList.add('hidden');
    document.body.style.overflow = 'auto';
}

// صفحه نخست -- a round-corner grid of feature panels (میز کار, مشتریان,
// برنامه کاری, نرخنامه, تنظیمات, + admin/HR for those accounts), distinct
// from میز کار itself: a logged-in user's actual "home base" rather than
// one more workspace tool. Lives at its own /home route so '/' keeps
// defaulting straight to میز کار (applyRouteForPath's existing behavior).
function openHomePanels(pushHistory = true) {
    if (!currentUserSession) { openAuthModal(); return; }
    showFullView('homePanelsPage');
    if (pushHistory) navigateTo('/home');
}

// تبدیل تاریخ -- opened from its own card on صفحه نخست as a separate
// module (same converter as the public landing page's #tool section, see
// convertDate()/copyFmt() -- "h-" id prefix there).
function openDateConverterPage(pushHistory = true) {
    if (!currentUserSession) { openAuthModal(); return; }
    showFullView('dateConverterPage');
    if (pushHistory) navigateTo('/home/date-converter');
}

function closeDateConverterPage() {
    document.getElementById('dateConverterPage').classList.add('hidden');
    document.body.style.overflow = 'auto';
    openHomePanels(false);
}

// صفحه نخست -- the header-bar's own "home" nav button. This button is only
// ever visible to a logged-in user (same toggle(id, !loggedIn) pattern as
// every other nav icon), so there's no real scenario where the public
// marketing/landing page is the right destination: open the panel grid
// instead. showLandingView() stays the actual logged-out home.
function goToHomePage(pushHistory = true) {
    if (currentUserSession) {
        openHomePanels(pushHistory);
        return;
    }
    showLandingView();
    if (pushHistory) navigateTo('/');
}

function closeWorkspaceDashboard(pushHistory = true) {
    document.getElementById('workspaceDashboard').classList.add('hidden');
    document.body.style.overflow = 'auto';
    showLandingView();
    if (pushHistory) navigateTo('/');
}
let allJobsTerminal = false;

// ═══════════════════════════════════════════════════════════
// JOB-COMPLETE NOTIFICATIONS -- a toast + short chime the moment a job's
// status flips to "completed" during the 30s poll below, so the user
// doesn't have to keep میز کار open and watch the table to notice. Only
// fires for a transition observed live (lastKnownJobStatuses) -- a job
// that was already completed before this page loaded never triggers one.
// ═══════════════════════════════════════════════════════════
let lastKnownJobStatuses = {};

// Settings → "پخش صدا هنگام تکمیل ترجمه" toggle (see settingsPage) --
// purely a client-side preference (localStorage), unlike the rest of
// settingsPage's fields which round-trip through /users/me/preferences:
// whether to play a sound has no meaning on another device, so it never
// needs to sync. Defaults to enabled.
function isJobSoundEnabled() {
    return localStorage.getItem('deept_job_sound_enabled') !== '0';
}
function setJobSoundEnabled(enabled) {
    localStorage.setItem('deept_job_sound_enabled', enabled ? '1' : '0');
}

function playJobCompleteChime() {
    if (!isJobSoundEnabled()) return;
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        // "Snappy double-tap": two quick bell taps, E5 then C5. Each strike
        // is a fundamental plus inharmonic overtone partials (the
        // non-integer ratios are what make it sound like a struck bell
        // rather than a pure tone) with a short decay.
        const strikeBell = (fundamental, startTime) => {
            const partials = [
                { ratio: 1,    gain: 0.35, decay: 1.32 },
                { ratio: 2.01, gain: 0.18, decay: 1.02 },
                { ratio: 3.0,  gain: 0.10, decay: 0.78 },
                { ratio: 4.2,  gain: 0.07, decay: 0.60 },
                { ratio: 5.4,  gain: 0.04, decay: 0.42 },
            ];
            partials.forEach(({ ratio, gain: g, decay }) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'sine';
                osc.frequency.value = fundamental * ratio;
                gain.gain.setValueAtTime(0, startTime);
                gain.gain.linearRampToValueAtTime(g, startTime + 0.008);
                gain.gain.exponentialRampToValueAtTime(0.0001, startTime + decay);
                osc.connect(gain).connect(ctx.destination);
                osc.start(startTime);
                osc.stop(startTime + decay + 0.05);
            });
        };
        const now = ctx.currentTime;
        strikeBell(659.25, now);         // E5
        strikeBell(523.25, now + 0.35);  // C5
        setTimeout(() => ctx.close(), 2000);
    } catch (e) { /* Web Audio unavailable/blocked -- the toast still shows */ }
}

function notifyJobCompleted(job) {
    const typeLabel = DOCUMENT_REGISTRY[job.document_type]?.label || job.document_type;
    showToast(`🎉 ترجمه «${typeLabel}» آماده شد!`, 4000);
    playJobCompleteChime();
}

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

    const newlyCompleted = jobs.filter(j => j.status === 'completed' && lastKnownJobStatuses[j.id] && lastKnownJobStatuses[j.id] !== 'completed');
    jobs.forEach(j => { lastKnownJobStatuses[j.id] = j.status; });
    newlyCompleted.forEach(notifyJobCompleted);

    allJobsTerminal = jobs.length > 0 && jobs.every(j => j.status === 'completed' || j.status === 'failed');

    tbody.innerHTML = '';
    if (!jobs.length) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-center py-8 text-sm" style="color:var(--text-muted);">// بدون پروژه فعال</td></tr>`;
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

        // Every page-priced document type sends this from Back-End (see
        // count_pdf_pages()/core_client.create_job's page_count); a flat-fee
        // type (e.g. police certificate) and every job predating this field
        // have none -- shown as "—" rather than a misleading 0 or NaN.
        const pageCountCell = job.page_count
            ? job.page_count.toLocaleString()
            : '<span style="color:var(--text-muted);">—</span>';

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
            <td class="py-3 text-center font-bold" style="color:var(--text-main);" title="تعداد صفحات سند آپلودشده">${pageCountCell}</td>
            <td class="py-3 text-center" style="color:var(--text-muted);">${dateStr}</td>
            <td class="py-3 text-center"><span style="color:${st.color};font-weight:700;">${st.text}</span></td>
            <td class="py-3 text-left text-xs">${actionsHtml}</td>`;
        tbody.appendChild(row);
    });
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
     'clientProfilePage', 'workSchedulePage', 'settingsPage', 'accountSettingsPage', 'myPriceListPage', 'hrPage', 'homePanelsPage', 'dateConverterPage'].forEach(id => {
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

// تنظیمات حساب -- its own top-level page (see the header's "حساب" button +
// صفحه نخست card), for the operations that touch the account itself rather
// than a translation: changing the password and the login email. See
// index.html's #accountSettingsPage and DeepT-Core's auth.py.
function openAccountSettingsPage(pushHistory = true) {
    if (!currentUserSession) { openAuthModal(); return; }
    showFullView('accountSettingsPage');
    if (pushHistory) navigateTo('/account-settings');
    const emailEl = document.getElementById('acct-current-email');
    if (emailEl) emailEl.textContent = currentUserSession.email || '—';
    ['acct-cur-pass', 'acct-new-pass', 'acct-new-pass2', 'acct-new-email', 'acct-email-pass'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    ['acct-pass-status', 'acct-email-status'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
    });
}

function closeAccountSettingsPage() {
    document.getElementById('accountSettingsPage').classList.add('hidden');
    document.body.style.overflow = 'auto';
    openWorkspaceDashboard(false);
}

function showAccountStatus(id, msg, ok) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = msg;
    el.style.color = ok ? '#34d399' : '#f87171';
    el.classList.remove('hidden');
}

async function changeAccountPassword() {
    const cur = document.getElementById('acct-cur-pass').value;
    const nw  = document.getElementById('acct-new-pass').value;
    const nw2 = document.getElementById('acct-new-pass2').value;
    const btn = document.getElementById('acct-pass-btn');
    if (!cur || !nw || !nw2) { showAccountStatus('acct-pass-status', 'لطفاً همه فیلدها را پر کنید.', false); return; }
    if (nw.length < 8)       { showAccountStatus('acct-pass-status', 'رمز عبور جدید باید حداقل ۸ کاراکتر باشد.', false); return; }
    if (nw !== nw2)          { showAccountStatus('acct-pass-status', 'رمز عبور جدید و تکرار آن یکسان نیستند.', false); return; }

    const originalLabel = btn.textContent;
    btn.disabled = true; btn.textContent = 'در حال ثبت...';
    try {
        const res = await fetch(`${CORE}/auth/change-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
            body: JSON.stringify({ current_password: cur, new_password: nw })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.detail || 'خطای سرور');
        showAccountStatus('acct-pass-status', '✅ ' + (data.message || 'رمز عبور با موفقیت تغییر کرد.'), true);
        ['acct-cur-pass', 'acct-new-pass', 'acct-new-pass2'].forEach(id => { document.getElementById(id).value = ''; });
    } catch (e) {
        showAccountStatus('acct-pass-status', '❌ ' + e.message, false);
    } finally {
        btn.disabled = false; btn.textContent = originalLabel;
    }
}

async function changeAccountEmail() {
    const newEmail = document.getElementById('acct-new-email').value.trim();
    const pass     = document.getElementById('acct-email-pass').value;
    const btn      = document.getElementById('acct-email-btn');
    if (!newEmail || !pass)        { showAccountStatus('acct-email-status', 'لطفاً همه فیلدها را پر کنید.', false); return; }
    if (!newEmail.includes('@'))   { showAccountStatus('acct-email-status', 'یک ایمیل معتبر وارد کنید.', false); return; }

    const originalLabel = btn.textContent;
    btn.disabled = true; btn.textContent = 'در حال ارسال...';
    try {
        const res = await fetch(`${CORE}/auth/change-email`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}` },
            body: JSON.stringify({ new_email: newEmail, password: pass })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.detail || 'خطای سرور');
        showAccountStatus('acct-email-status', '✅ ' + (data.message || 'لینک تایید ارسال شد.'), true);
        ['acct-new-email', 'acct-email-pass'].forEach(id => { document.getElementById(id).value = ''; });
    } catch (e) {
        showAccountStatus('acct-email-status', '❌ ' + e.message, false);
    } finally {
        btn.disabled = false; btn.textContent = originalLabel;
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
// Runs regardless of which view is open (not just while میز کار is
// visible) so a job-complete notification can fire even when the user is
// elsewhere in the app; renderDashboardActiveProjects() itself guards on
// currentUserSession and just updates the (possibly hidden) table otherwise.
setInterval(async () => {
    if (allJobsTerminal || !currentUserSession) return;
    await renderDashboardActiveProjects();
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

    } else if (path === '/account-settings') {

        if (currentUserSession) {
            openAccountSettingsPage(false);
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

    } else if (path === '/home/date-converter') {

        if (currentUserSession) {
            openDateConverterPage(false);
        } else {
            navigateTo('/', false);
            showLandingView();
            openLogin();
            showToast('برای دسترسی به این بخش، ابتدا وارد شوید.');
        }

    } else if (path === '/home') {

        if (currentUserSession) {
            openHomePanels(false);
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
            openHomePanels(false);
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
// Fully clears every piece of in-flight translation-pipeline state (doc type,
// passport session(s), uploaded files, manual fields) so reopening the modal
// always starts from a clean slate. Called whenever the pipeline is closed.
function resetTranslationPipeline() {
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
    ppSetMode(null);

    ppClearFields();
    document.getElementById('pp-file-input').value = '';
    document.getElementById('pp-file-name').textContent = '';
    document.getElementById('pp-file-name').classList.add('hidden');
    document.getElementById('pp-drop-text').classList.remove('hidden');
    document.getElementById('pp-extract-btn').disabled = true;
    document.getElementById('pp-extract-btn').textContent = 'استخراج اطلاعات از پاسپورت';
    document.getElementById('pp-client-search').value = '';
    document.getElementById('pp-client-results').innerHTML = '';
    document.getElementById('ppModeButtons').classList.remove('hidden');

    document.getElementById('docTemplateSearch').value = '';
    document.getElementById('docTemplate').value = '';
    closeDocDropdownList();

    document.getElementById('includeCourseCodesCheckbox').checked = false;
    resetDocZone();
    showOnlyStage('doctype');
}

function closeChatInterface(pushHistory = true) {
    resetTranslationPipeline();
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
        document.getElementById('courseCodesToggleWrap').classList.toggle('hidden', !DOCUMENT_REGISTRY[currentDocType]?.courseCodesToggle);
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
    if (docDef && docDef.usePassportSession) {
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
// The backend document pipeline (Gemini-based multi-page processing) only
// accepts PDFs; a non-PDF used to reach it anyway and get rejected only
// after a wasted API call. Checked on file.type OR extension -- drag-and-
// drop from some file managers doesn't always set a reliable MIME type.
function isPdfFile(file) {
    return file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
}

function handleDocFileSelection(file) {
    if (!file) return;
    if (!isPdfFile(file)) {
        showToast('⚠️ فقط فایل PDF پذیرفته می‌شود. لطفاً سند را به‌صورت PDF بارگذاری کنید.');
        document.getElementById('docFileInput').value = '';
        return;
    }
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

    if (docDef.courseCodesToggle) {
        const includeCourseCodes = document.getElementById('includeCourseCodesCheckbox').checked;
        fd.append('include_course_codes', includeCourseCodes ? 'true' : 'false');
    }
    
    // Passport session(s) + client link. Every document type uses the
    // universal multi-passport contract.
    if (docDef.usePassportSession) {
        confirmedPassports.forEach(p => fd.append('session_ids', p.session_id));
        if (selectedClientId) fd.append('client_id', selectedClientId);
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
    if (directFailed && docDef.chunkedUpload) {
        try {
            const uploadId = await uploadFileInChunks(docSelectedFile, (percent) => {
                statusText.textContent = `در حال آپلود سند... ${percent}%`;
            });

            const chunkedFd = new FormData();
            chunkedFd.append('upload_id', uploadId);
            chunkedFd.append('idempotency_key', idempotencyKey);
            if (docDef.courseCodesToggle) {
                chunkedFd.append('include_course_codes', fd.get('include_course_codes'));
            }
            if (docDef.usePassportSession) {
                fd.getAll('session_ids').forEach(sid => chunkedFd.append('session_ids', sid));
                const cid = fd.get('client_id');
                if (cid) chunkedFd.append('client_id', cid);
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
        // The backend sanitizes every client-facing error to Persian text
        // (and passes 402 "insufficient credit" / 404 "no wallet yet"
        // through verbatim -- see main.py's HTTPException handler). Mark it
        // so the catch block can surface this safe detail instead of the
        // generic fallback, without ever leaking raw English network text.
        throw { backendDetail: err.detail };
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
        // Only backend-sanitized Persian detail is shown directly (the
        // 402/404 wallet messages above). Everything else -- genuine
        // network failures whose `err.message` can be raw English from a
        // timeout/CORS/connection drop -- stays behind a fixed message.
        statusBubble.classList.add('hidden');
        if (err && err.backendDetail) {
            showToast(`❌ ${err.backendDetail}`);
        } else {
            showToast('❌ خطا در پردازش سند. لطفاً دوباره تلاش کنید یا با پشتیبانی تماس بگیرید.');
        }
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
    // Email-change confirmation redirect (from DeepT-Core's
    // /auth/confirm-email-change, after clicking the link mailed to the NEW
    // address) -- the account's login email has now moved, so the user must
    // re-enter it: log out any stale session and open the login modal.
    const emailChanged = params.get('email_changed');
    if (emailChanged === 'success') {
        // Log out any still-open session first (its cached email is now
        // stale and its token still points at the old address), then show
        // the message after executeLogout()'s own toast so it isn't overwritten.
        if (currentUserSession) executeLogout();
        openLogin();
        showToast('✅ ایمیل حساب با موفقیت تغییر کرد. لطفاً با ایمیل جدید وارد شوید.');
        window.history.replaceState({}, document.title, window.location.pathname);
    } else if (emailChanged === 'error') {
        showToast('⚠️ لینک تغییر ایمیل نامعتبر یا منقضی شده است.');
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
    qsReset();
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
// prefix lets more than one copy of this tool live on the page at once
// (the landing page's own "t-" ids, plus صفحه نخست's "h-" ids) without id
// collisions -- defaults to 't' so the landing page's existing
// onclick="convertDate()" keeps working unchanged.
function convertDate(prefix='t'){
    const day=parseInt(document.getElementById(`${prefix}-day`).value);
    const mon=parseInt(document.getElementById(`${prefix}-month`).value);
    const yr=parseInt(document.getElementById(`${prefix}-year`).value);
    const errEl=document.getElementById(`${prefix}-error`);
    const resEl=document.getElementById(`${prefix}-result`);
    errEl.classList.remove('show');resEl.classList.remove('show');
    if(!day||!mon||!yr){errEl.textContent='همه موارد را وارد کنید.';errEl.classList.add('show');return;}
    if(yr<1200||yr>1500){errEl.textContent='سال شمسی معتبر وارد کنید (مثلاً ۱۳۸۰).';errEl.classList.add('show');return;}
    if(day<1||day>31){errEl.textContent='روز معتبر وارد کنید.';errEl.classList.add('show');return;}
    try{
        const{gy,gm,gd}=j2g(yr,mon,day);
        const obj=new Date(gy,gm-1,gd);
        const p=n=>String(n).padStart(2,'0');
        document.getElementById(`${prefix}-main`).textContent=`${gy} / ${p(gm)} / ${p(gd)}`;
        document.getElementById(`${prefix}-f1`).textContent=`${gy}-${p(gm)}-${p(gd)}`;
        document.getElementById(`${prefix}-f2`).textContent=`${p(gd)}/${p(gm)}/${gy}`;
        document.getElementById(`${prefix}-f3`).textContent=`${p(gm)}/${p(gd)}/${gy}`;
        document.getElementById(`${prefix}-f4`).textContent=new Intl.DateTimeFormat('en-US',{month:'long',day:'numeric',year:'numeric'}).format(obj);
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
    ['qsFirst','qsLast','qsFather','qsDob'].forEach(id=>document.getElementById(id).value='');
    document.getElementById('qsPassFile').value='';
    document.getElementById('qsDocFile').value='';
    document.getElementById('qsDocType').value='police-certificate';
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
    if (!isPdfFile(file)) {
        showToast('⚠️ فقط فایل PDF پذیرفته می‌شود. لطفاً سند را به‌صورت PDF بارگذاری کنید.');
        document.getElementById('qsDocFile').value = '';
        return;
    }
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
    openHomePanels();
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
    document.getElementById('accountSettingsPage').classList.add('hidden');
    document.getElementById('myPriceListPage').classList.add('hidden');
    document.getElementById('homePanelsPage').classList.add('hidden');
    document.getElementById('dateConverterPage').classList.add('hidden');
    document.getElementById('hrPage').classList.add('hidden');
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
        tbody.innerHTML = `<tr><td colspan="9" class="text-center py-8 text-sm" style="color:var(--text-muted);">کاربری یافت نشد.</td></tr>`;
        return;
    }
    tbody.innerHTML = users.map(u => `
        <tr style="border-bottom:1px solid var(--divider);${(u.email_verified === false || u.is_active === false) ? 'opacity:0.5;' : ''}">
                        <td class="py-3 px-3 en" style="color:var(--text-main);">${escapeHtml(u.email)}</td>
            <td class="py-3 px-3" style="color:var(--text-main);">${escapeHtml(u.full_name)}</td>
            <td class="py-3 px-3" style="color:var(--text-muted);">${u.account_type === 'office' ? 'دارالترجمه' : 'حقیقی'}</td>
            <td class="py-3 px-3 en" style="color:var(--text-muted);">${(u.created_at || '').slice(0, 10)} ${(u.created_at || '').slice(11, 16)}</td>
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
            <td class="py-3 px-3">
                <button onclick="adminViewUserClients('${u.user_id}', '${(u.email||'').replace(/'/g,"")}')" class="text-sm font-bold px-3 py-2 rounded-lg" style="background:var(--bg-main);color:var(--text-main);border:1px solid var(--border-subtle);">مشاهده</button>
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
            tbody.innerHTML = `<tr><td colspan="9" class="text-center py-8 text-sm" style="color:var(--text-muted);">خطا در دریافت لیست کاربران.</td></tr>`;
            return;
        }
        adminUsersCache = await res.json();
        const searchInput = document.getElementById('adminUserSearchInput');
        if (searchInput) searchInput.value = '';
        renderAdminUsersRows(adminUsersCache);
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="9" class="text-center py-8 text-sm" style="color:var(--text-muted);">خطا در اتصال.</td></tr>`;
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
    tbody.innerHTML = `<tr><td colspan="6" class="text-center py-8 text-sm" style="color:var(--text-muted);">در حال بارگذاری...</td></tr>`;
    try {
        const res = await fetch(`${CORE}/jobs?user_id=${userId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) {
            tbody.innerHTML = `<tr><td colspan="6" class="text-center py-8 text-sm" style="color:var(--text-muted);">خطا در دریافت پروژه‌ها.</td></tr>`;
            return;
        }
        const jobs = await res.json();
        if (!jobs.length) {
            tbody.innerHTML = `<tr><td colspan="6" class="text-center py-8 text-sm" style="color:var(--text-muted);">این کاربر پروژه‌ای ندارد.</td></tr>`;
            return;
        }
        const typeLabel = (t) => DOCUMENT_REGISTRY[t]?.label || t;
        const statusLabel = (s) => ({queued:'در صف', processing:'در حال پردازش', completed:'تکمیل شده', failed:'ناموفق'}[s] || s);
        // Not every document type tracks api_cost_usd yet, and a job
        // predating that field has none -- shown as "—" rather than $0.00.
        const costCell = (j) => j.api_cost_usd != null
            ? `$${j.api_cost_usd.toFixed(4)}`
            : '<span style="color:var(--text-muted);">—</span>';
        tbody.innerHTML = jobs.map(j => `
            <tr style="border-bottom:1px solid var(--divider);">
                <td class="py-2 px-2" style="color:var(--text-main);">${typeLabel(j.document_type)}</td>
                <td class="py-2 px-2" style="color:var(--text-muted);">${statusLabel(j.status)}</td>
                <td class="py-2 px-2 font-mono" style="color:var(--text-main);">${(j.price_toman||0).toLocaleString()}</td>
                <td class="py-2 px-2 en font-mono" style="color:var(--text-main);">${costCell(j)}</td>
                                <td class="py-2 px-2 en" style="color:var(--text-muted);">${escapeHtml(j.original_filename)}</td>
                <td class="py-2 px-2 en" style="color:var(--text-muted);">${(j.created_at||'').slice(0,10)}</td>
            </tr>
        `).join('');
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-center py-8 text-sm" style="color:var(--text-muted);">خطا در اتصال.</td></tr>`;
    }
}

async function adminViewUserClients(userId, email) {
    const token = localStorage.getItem('deept_token');
    const panel = document.getElementById('adminUserClientsPanel');
    const tbody = document.getElementById('adminUserClientsRowsBlock');
    document.getElementById('adminUserClientsTitle').textContent = `مشتریان ${email}`;
    panel.classList.remove('hidden');
    tbody.innerHTML = `<tr><td colspan="4" class="text-center py-8 text-sm" style="color:var(--text-muted);">در حال بارگذاری...</td></tr>`;
    try {
        const res = await fetch(`${CORE}/clients?user_id=${userId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) {
            tbody.innerHTML = `<tr><td colspan="4" class="text-center py-8 text-sm" style="color:var(--text-muted);">خطا در دریافت مشتریان.</td></tr>`;
            return;
        }
        const clients = await res.json();
        if (!clients.length) {
            tbody.innerHTML = `<tr><td colspan="4" class="text-center py-8 text-sm" style="color:var(--text-muted);">این کاربر مشتری‌ای ندارد.</td></tr>`;
            return;
        }
        const faName = (c) => `${c.first_name_fa || ''} ${c.last_name_fa || ''}`.trim();
        const enName = (c) => `${c.first_name || ''} ${c.last_name || ''}`.trim();
        const displayName = (c) => faName(c) || enName(c) || '—';
        tbody.innerHTML = clients.map(c => `
            <tr style="border-bottom:1px solid var(--divider);">
                <td class="py-2 px-2" style="color:var(--text-main);">${escapeHtml(displayName(c))}</td>
                <td class="py-2 px-2 en" style="color:var(--text-muted);">${escapeHtml(c.national_id) || '—'}</td>
                <td class="py-2 px-2 en" style="color:var(--text-muted);">${escapeHtml(c.phone) || '—'}</td>
                <td class="py-2 px-2 en" style="color:var(--text-muted);">${(c.created_at||'').slice(0,10)}</td>
            </tr>
        `).join('');
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="4" class="text-center py-8 text-sm" style="color:var(--text-muted);">خطا در اتصال.</td></tr>`;
    }
}

// ── CRM PANEL LOGIC ──
var adminCrmJobsCache = [];
var adminCrmUsersCache = [];

/* ============ SECTION: ADMIN CRM REPORTS ============
   Time-frame selector, doc-type stats, filters, jobs table. ============ */
function switchAdminTab(tab) {
    const usersPanel = document.getElementById('adminUsersPanel');
    const crmPanel = document.getElementById('adminCrmPanel');
    const tabUsersBtn = document.getElementById('adminTabUsers');
    const tabCrmBtn = document.getElementById('adminTabCrm');
    
    const jobsPanel = document.getElementById('adminUserJobsPanel');
    if (jobsPanel) jobsPanel.classList.add('hidden');
    const clientsPanel = document.getElementById('adminUserClientsPanel');
    if (clientsPanel) clientsPanel.classList.add('hidden');

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
        tableBody.innerHTML = `<tr><td colspan="8" class="text-center py-8 text-sm" style="color:var(--text-muted);">در حال بارگذاری داده‌های CRM...</td></tr>`;
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
        // Users (with created_at) are fetched alongside the jobs -- the CRM
        // stats grid and the new-users table both need to count signups in
        // the selected time-frame, and /wallet/admin/users is already the
        // one admin-authenticated source of that list.
        const [jobsRes, usersRes] = await Promise.all([
            fetch(url, { headers: { 'Authorization': `Bearer ${token}` } }),
            fetch(`${CORE}/wallet/admin/users`, { headers: { 'Authorization': `Bearer ${token}` } })
        ]);
        if (!jobsRes.ok) {
            if (tableBody) tableBody.innerHTML = `<tr><td colspan="7" class="text-center py-8 text-sm" style="color:var(--text-muted);">خطا در بارگذاری داده‌های CRM.</td></tr>`;
            showToast('خطا در بارگذاری داده‌های CRM');
            return;
        }
        adminCrmJobsCache = await jobsRes.json();
        if (usersRes.ok) {
            adminCrmUsersCache = await usersRes.json();
        }
        
        populateCrmDocTypeFilter();
        populateCrmTimeFrameSelects();
        updateCrmDashboard();
    } catch (e) {
        console.error(e);
        if (tableBody) tableBody.innerHTML = `<tr><td colspan="8" class="text-center py-8 text-sm" style="color:var(--text-muted);">خطا در اتصال به سرور.</td></tr>`;
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
    // Only completed jobs get an api_cost_usd today (set once extraction
    // finishes -- see DeepT-Core's PATCH /jobs/{job_id}); a job predating
    // this field, or whose document type doesn't track cost yet, is null
    // and contributes 0 rather than breaking the sum.
    const apiCostMonthly = filteredForStats.reduce((sum, j) => sum + (j.api_cost_usd || 0), 0);

    // Dynamic labels — beside همهٔ زمان‌ها concept
    const profitLabelEl = document.getElementById('crmStatProfitLabel');
    const profitSubEl = document.getElementById('crmStatProfitSub');
    const workLabelEl = document.getElementById('crmStatWorkLabel');
    const failureLabelEl = document.getElementById('crmStatFailureLabel');
    const apiCostLabelEl = document.getElementById('crmStatApiCostLabel');
    const apiCostSubEl = document.getElementById('crmStatApiCostSub');
    if (profitLabelEl) profitLabelEl.textContent = label === 'همهٔ زمان‌ها' ? 'سود بازه انتخابی (تومان)' : `سود ${label} (تومان)`;
    if (profitSubEl) profitSubEl.textContent = label === 'همهٔ زمان‌ها' ? 'جمع پرداختی کارهای موفق — همهٔ زمان‌ها' : `جمع پرداختی کارهای موفق — ${label}`;
    if (workLabelEl) workLabelEl.textContent = label === 'همهٔ زمان‌ها' ? 'تعداد کل کارها' : `تعداد کل کارهای ${label}`;
    if (failureLabelEl) failureLabelEl.textContent = label === 'همهٔ زمان‌ها' ? 'نرخ ناموفق' : `نرخ ناموفق ${label}`;
    if (apiCostLabelEl) apiCostLabelEl.textContent = label === 'همهٔ زمان‌ها' ? 'هزینه API (دلار)' : `هزینه API ${label} (دلار)`;
    if (apiCostSubEl) apiCostSubEl.textContent = label === 'همهٔ زمان‌ها' ? 'مجموع هزینهٔ واقعی Gemini — همهٔ زمان‌ها' : `مجموع هزینهٔ واقعی Gemini — ${label}`;

    document.getElementById('crmStatProfit').textContent = profitMonthly.toLocaleString();
    document.getElementById('crmStatWorkCount').textContent = totalMonthly.toLocaleString();
    document.getElementById('crmStatWorkDetails').textContent = `موفق: ${completedMonthly.length.toLocaleString()} | ناموفق: ${failedMonthly.length.toLocaleString()}`;
    document.getElementById('crmStatFailureRate').textContent = `${failureRateMonthly}%`;

    // ── New user signups in the SELECTED time-frame ──────────────
    const usersInFrame = range ? adminCrmUsersCache.filter(u => {
        const d = new Date(u.created_at);
        return !isNaN(d) && d >= range.start && d < range.end;
    }) : [...adminCrmUsersCache];
    const totalUsers = adminCrmUsersCache.length;

    const newUsersLabelEl = document.getElementById('crmStatNewUsersLabel');
    const newUsersSubEl = document.getElementById('crmStatNewUsersSub');
    if (newUsersLabelEl) newUsersLabelEl.textContent = label === 'همهٔ زمان‌ها' ? 'کاربران جدید (کل)' : `کاربران جدید ${label}`;
    if (newUsersSubEl) newUsersSubEl.textContent = label === 'همهٔ زمان‌ها' ? `مجموع کل کاربران: ${totalUsers.toLocaleString()}` : `از مجموع ${totalUsers.toLocaleString()} کاربر`;
    document.getElementById('crmStatNewUsers').textContent = usersInFrame.length.toLocaleString();

    // ── New Users Table (email / name / type / exact signup date-time) ──
    const signupsTbody = document.getElementById('crmNewUsersTableBody');
    if (signupsTbody) {
        if (usersInFrame.length === 0) {
            signupsTbody.innerHTML = `<tr><td colspan="4" class="text-center py-4" style="color:var(--text-muted);">کاربر جدیدی در این بازه ثبت‌نام نکرده است.</td></tr>`;
        } else {
            const sortedSignups = [...usersInFrame].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
            signupsTbody.innerHTML = sortedSignups.map(u => {
                const dt = (u.created_at || '').slice(0, 10) + ' ' + (u.created_at || '').slice(11, 16);
                return `
                    <tr style="border-bottom:1px solid var(--divider);">
                        <td class="py-2 px-2 en text-right" style="color:var(--text-main); font-size:0.8rem;" dir="ltr">${escapeHtml(u.email)}</td>
                        <td class="py-2 px-2" style="color:var(--text-main);">${escapeHtml(u.full_name)}</td>
                        <td class="py-2 px-2" style="color:var(--text-muted);">${u.account_type === 'office' ? 'دارالترجمه' : 'حقیقی'}</td>
                        <td class="py-2 px-2 text-center en" style="color:var(--text-muted); font-size:0.8rem;">${dt}</td>
                    </tr>
                `;
            }).join('');
        }
    }
    
    // Build per-document-type aggregation for the SELECTED time-frame (global)
    const docTypeStats = {};
    Object.entries(DOCUMENT_REGISTRY).forEach(([key, doc]) => {
        docTypeStats[key] = { label: doc.label, total: 0, completed: 0, failed: 0, revenue: 0, apiCost: 0 };
    });

    filteredForStats.forEach(j => {
        const t = j.document_type;
        if (!docTypeStats[t]) {
            docTypeStats[t] = { label: t, total: 0, completed: 0, failed: 0, revenue: 0, apiCost: 0 };
        }
        docTypeStats[t].total++;
        docTypeStats[t].apiCost += (j.api_cost_usd || 0);
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
            tableTbody.innerHTML = `<tr><td colspan="7" class="text-center py-4" style="color:var(--text-muted);">داده‌ای وجود ندارد.</td></tr>`;
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
                        <td class="py-2 px-1 text-center en" style="color:var(--text-muted);">$${s.apiCost.toFixed(2)}</td>
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
        tbody.innerHTML = `<tr><td colspan="8" class="text-center py-8 text-sm" style="color:var(--text-muted);">هیچ کاری با مشخصات فیلتر شده یافت نشد.</td></tr>`;
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
    
    // Not every document type tracks api_cost_usd yet, and a job predating
    // that field has none -- shown as "—" rather than $0.0000.
    const apiCostCell = (j) => j.api_cost_usd != null
        ? `$${j.api_cost_usd.toFixed(4)}`
        : '<span style="color:var(--text-muted);">—</span>';

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
                <td class="py-2 px-2 text-center en font-mono" style="color:var(--text-main);">${apiCostCell(j)}</td>
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
