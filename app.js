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
        endpoint: 'https://police.deept.ir/api/translate/police-certificate',
        active:              true,
        usePassportSession:  true,
        legacySingleSession: true,   // old backend contract -- singular session_id, not yet updated
    },
    'vehicle-deed': {
        label:               'سند مالکیت خودرو (برگ سبز)',
        endpoint: 'https://backend.deept.ir/api/translate/vehicle-deed',
        active:              true,
        usePassportSession:  true,
    },
    'marriage-certificate': {
        label:               'سند ازدواج',
        endpoint:            '',
        active:              false,
        usePassportSession:  true,
    },
    'birth-certificate': {
        label:               'شناسنامه',
        endpoint:            '',
        active:              false,
        usePassportSession:  true,
    },
    'notary-deed': {
        label:               'اسناد دفترخانه (سند رسمی)',
        endpoint: 'https://backend.deept.ir/api/translate/notary-deed',
        active:              true,
        usePassportSession:  true,
    },
    'academic-transcript': {
        label:               'ریزنمرات علوم پزشکی',
        endpoint: 'https://backend.deept.ir/api/translate/academic-transcript',
        active:              true,
        usePassportSession:  true,
    },
    'gazette-notice': {
        label:               'آگهی تاسیس / تغییرات (روزنامه رسمی)',
        endpoint: 'https://backend.deept.ir/api/translate/gazette-notice',
        active:              true,
        usePassportSession:  false,
    },
    'high-school-transcript': {
        label:               'ریزنمرات دبیرستان',
        endpoint: 'https://backend.deept.ir/api/translate/high-school-transcript',
        active:              true,
        usePassportSession:  true,
    },
    'ownership-deed': {
    label: 'سند مالکیت (تک برگ؛ نام مالک اول)',
    endpoint: 'https://backend.deept.ir/api/translate/ownership-deed',
    active: true,
    usePassportSession: true,
    },
    'azad-transcript': {
        label:               'ریزنمرات دانشگاه آزاد اسلامی',
        endpoint: 'https://backend.deept.ir/api/translate/azad-transcript',
        active:              true,
        usePassportSession:  true,
    },
    'insurance-record': {
        label:               'سوابق کامل بیمه تامین اجتماعی',
        endpoint: 'https://backend.deept.ir/api/translate/insurance-record',
        active:              true,
        usePassportSession:  true,
    },
    'consolidated-insurance-record': {
        label:               'سوابق تلفیقی بیمه تامین اجتماعی',
        endpoint: 'https://backend.deept.ir/api/translate/consolidated-insurance-record',
        active:              true,
        usePassportSession:  true,
    },
    'police-certificate': {
    label:               'گواهی عدم سوء پیشینه',
    endpoint:            'https://deept-back-end.onrender.com/api/translate/police-certificate',
    // or your proxied domain, e.g. backend.deept.ir/api/translate/police-certificate
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
            type: 'individual',
            contact: '',
            office: '',
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

let currentUserSession = loadSession();
let trackingProjectsDatabase = [];

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
    toggle('adminPanelHeaderBtn', !loggedIn || localStorage.getItem('deept_is_admin') !== '1');
    toggle('logoutHeaderBtn',    !loggedIn);
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

// ═══════════════════════════════════════════════════════════
// PROFILE
// ═══════════════════════════════════════════════════════════
function toggleProfileAccountType() {
    document.getElementById('officeFieldsBlock').classList.toggle('hidden', document.getElementById('accountTypeToggle').value !== 'office');
}
function saveProfileConfiguration() {
    if (!currentUserSession) return;
    currentUserSession.type    = document.getElementById('accountTypeToggle').value;
    currentUserSession.contact = document.getElementById('profileContactInput').value;
    currentUserSession.office  = currentUserSession.type === 'office' ? document.getElementById('officeNameInput').value : '';
    localStorage.setItem('deept_mock_user', JSON.stringify(currentUserSession));
    document.getElementById('profileDisplayName').textContent = currentUserSession.office || currentUserSession.username;
    document.getElementById('headerUserName').textContent     = currentUserSession.office || currentUserSession.username;
    showToast('✅ پروفایل بروزرسانی شد.');
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
    };

    const token = getToken();
    try {
        const res = await fetch(`${CORE}/users/me/preferences`, {
            method: 'PATCH',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        if (!res.ok) throw new Error();
        status.style.color = 'var(--accent)';
        status.textContent = '✅ ذخیره شد. از سند بعدی اعمال می‌شود.';
    } catch (e) {
        status.style.color = '#f87171';
        status.textContent = '❌ ذخیره تنظیمات ناموفق بود.';
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
    { id:"notary_deed", label:"سند دفترخانه", full:false, fields:[] },
    { id:"academic_transcript", label:"ریزنمرات دانشگاهی", full:false, fields:[] },
    { id:"azad_transcript", label:"ریزنمرات دانشگاه آزاد", full:false, fields:[] },
    { id:"property_deed_owner", label:"سند مالکیت ملک", full:false, fields:[] },
    { id:"insurance_record", label:"سابقهٔ بیمه", full:false, fields:[] },
    { id:"consolidated_insurance_record", label:"سابقهٔ بیمهٔ تجمیعی", full:false, fields:[] },
    { id:"gazette_notice", label:"آگهی روزنامهٔ رسمی", full:false, fields:[] },
    { id:"high_school_transcript", label:"ریزنمرات دبیرستان", full:false, fields:[] },
];

let dpServerPhrases = {};   // {doc_type: {field_key: text}} -- last known saved state, from GET
let dpDraft = {};           // {doc_type: {field_key: text}} -- unsaved edits, kept across doc-type switches
let dpCurrentDoc = DP_DOCS[0].id;

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

    if (!doc.fields.length){
        const note = document.createElement('div');
        note.className = 'text-[11px] p-3 rounded-lg';
        note.style.cssText = 'background:var(--bg-main);border:1px dashed var(--border-subtle);color:var(--text-muted);line-height:1.9;';
        note.textContent = 'عبارات ثابت این نوع سند هنوز به این بخش اضافه نشده — به‌زودی.';
        list.appendChild(note);
        document.getElementById('dp-save-btn').disabled = true;
        return;
    }
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
    } catch (e) {
        dpServerPhrases = {};
    }
    dpDraft = {};
    renderDocumentPhrases();
}

async function saveDocumentPhrases(){
    if (!currentUserSession) return;
    const doc = DP_DOCS.find(d => d.id === dpCurrentDoc);
    const changes = dpDraft[doc.id] || {};
    const btn = document.getElementById('dp-save-btn');
    const status = document.getElementById('dp-save-status');

    // A complex field with a structurally broken draft value is excluded
    // -- never sent to the backend, and left as-is (with its warning) so
    // the translator can keep fixing it. Everything else in this document
    // type's draft is safe to send in the same request.
    const toSend = {};
    let blockedCount = 0;
    for (const key in changes){
        const f = doc.fields.find(f => f.key === key);
        if (f.kind === 'complex' && !dpCheckComplex(changes[key], f.tokens).valid){
            blockedCount++;
            continue;
        }
        toSend[key] = changes[key] === '' ? null : changes[key];
    }

    status.classList.remove('hidden');
    if (Object.keys(toSend).length === 0){
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
            body: JSON.stringify({ document_phrases: { [doc.id]: toSend } })
        });
        if (!res.ok) throw new Error();
        const p = await res.json();
        dpServerPhrases = p.document_phrases || {};
        // Only the fields actually sent (the valid ones) are cleared from
        // the draft -- a blocked complex field stays in draft, with its
        // warning, even though the rest of this save succeeded.
        for (const key of Object.keys(toSend)) delete dpDraft[doc.id][key];
        if (dpDraft[doc.id] && Object.keys(dpDraft[doc.id]).length === 0) delete dpDraft[doc.id];
        status.style.color = 'var(--accent)';
        status.textContent = blockedCount > 0
            ? `✅ ${Object.keys(toSend).length} مورد ذخیره شد؛ ${blockedCount} مورد دارای خطا ذخیره نشد.`
            : '✅ ذخیره شد. از سند بعدی اعمال می‌شود.';
        renderDocumentPhrases();
    } catch (e) {
        status.style.color = '#f87171';
        status.textContent = '❌ ذخیره ناموفق بود.';
    } finally {
        btn.disabled = false;
    }
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
        box.innerHTML = `
            <div class="grid grid-cols-[1.6fr_1fr_1fr_96px] items-center gap-3 px-3 py-2 text-[11px] font-black" style="color:var(--text-muted);border-bottom:1px solid var(--divider);">
                <span>نام</span>
                <span>کد ملی</span>
                <span>شماره همراه</span>
                <span></span>
            </div>
            ${clients.map(c => `
                <div class="grid grid-cols-[1.6fr_1fr_1fr_96px] items-center gap-3 p-3 rounded-xl" style="background:var(--bg-main);border:1px solid var(--border-subtle);">
                    <div>
                        <div class="font-black text-sm" style="color:var(--text-main);">${escapeHtml(displayName(c))}</div>
                        ${enName(c) && enName(c) !== displayName(c) ? `<div class="text-[11px] en" style="color:var(--text-muted);">${escapeHtml(enName(c))}</div>` : ''}
                    </div>
                    <div class="text-xs en font-bold" style="color:var(--text-main);" dir="ltr">${escapeHtml(c.national_id) || '—'}</div>
                    <div class="text-xs en font-bold" style="color:var(--text-main);" dir="ltr">${escapeHtml(c.phone) || '—'}</div>
                    <button onclick="openClientProfile('${c.id}')" class="text-xs font-bold px-3 py-1.5 rounded-lg transition justify-self-end" style="background:var(--card-surface);color:var(--accent);border:1px solid var(--border-color);">مشاهده</button>
                </div>
            `).join('')}`;
    } catch (e) {
        box.innerHTML = `<div class="text-xs text-center py-6" style="color:#f87171;">خطا در دریافت لیست مشتریان.
            <button onclick="renderDashboardClients('${(q || '').replace(/'/g,"")}')" class="block mx-auto mt-2 text-[11px] font-bold px-3 py-1 rounded-lg" style="background:var(--card-surface);color:var(--accent);border:1px solid var(--border-color);">🔄 تلاش مجدد</button>
        </div>`;
    }
}

let currentClientDetailId = null;
let invoiceDraft = [];   // [{description, quantity, line_total_toman, job_id}] -- built up before POSTing to /invoices

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
const ACTIVITY_CATEGORY_COLORS = { job: '#4ade80', sanam: '#38bdf8' };

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
        // job_id is only ever set for a real DeepT job -- a Sanam-sourced
        // row is a fresh draft line, not a link back to its original
        // (already-invoiced) Sanam invoice_item.
        invoiceDraft.push({
            description, quantity: 1, unit_price_toman: priceToman,
            job_id: type === 'job' ? id : null, _source_key: key,
        });
    } else {
        invoiceDraft = invoiceDraft.filter(row => row._source_key !== key);
    }
    renderDraftRows();
}

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
            type: 'sanam', id: d.id, date: d.date,
            title: d.description + (d.quantity > 1 ? ` ×${d.quantity}` : ''),
            price: d.line_total_toman || 0, trackingCode: d.tracking_code,
            checkable: true,
        });
    });
    rows.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    if (countEl) countEl.textContent = rows.length;
    box.innerHTML = !rows.length
        ? `<div class="text-xs text-center py-4" style="color:var(--text-muted);">// بدون سابقه پروژه یا سند</div>`
        : rows.map(r => {
            const color = ACTIVITY_CATEGORY_COLORS[r.type];
            const checked = isActivityInDraft(activityRowKey(r.type, r.id));
            const st = r.type === 'job' ? (ACTIVITY_STATUS_LABELS[r.status] || { text: escapeHtml(r.status), color: 'var(--text-muted)' }) : null;
            const idBadge = r.type === 'job'
                ? `<span class="en" style="color:var(--text-muted);font-size:.65rem;" title="شناسه کار">#${escapeHtml(String(r.id).slice(0, 8))}</span>`
                : (r.trackingCode ? `<span class="en" style="color:var(--text-muted);font-size:.65rem;">کد پیگیری ${escapeHtml(r.trackingCode)}</span>` : '');
            const dateStr = r.date ? escapeHtml(String(r.date).slice(0, 10)) : '—';
            return `<div class="flex items-center gap-2.5 p-2.5 rounded-lg text-xs" style="background:var(--bg-main);border:1px solid var(--border-subtle);border-inline-start:3px solid ${color};">
                <input type="checkbox" ${checked ? 'checked' : ''} ${r.checkable ? '' : 'disabled'}
                    data-activity-key="${escapeHtml(activityRowKey(r.type, r.id))}"
                    onchange='toggleActivityInDraft(${JSON.stringify(r.type)}, ${JSON.stringify(r.id)}, ${JSON.stringify(r.title)}, ${r.price}, this.checked)'
                    style="width:15px;height:15px;accent-color:${color};flex-shrink:0;cursor:${r.checkable ? 'pointer' : 'not-allowed'};">
                <span class="flex-1" style="color:var(--text-main);">${escapeHtml(r.title)}</span>
                ${idBadge}
                <span class="en shrink-0" style="color:var(--text-muted);">${dateStr}</span>
                <span class="en font-bold shrink-0" style="color:var(--accent);width:80px;text-align:left;">${r.price ? r.price.toLocaleString() + ' ت' : '—'}</span>
                ${st ? `<span class="status-pill" style="color:${st.color};background:${st.color}1f;">${st.text}</span>` : ''}
            </div>`;
        }).join('');
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
    invoiceDraft.push({ description: '', quantity: 1, unit_price_toman: 0, job_id: null });
    renderDraftRows();
}

// Quick-add for per-item official fees that repeat across an order --
// تمبر دادگستری (۶۰,۰۰۰ هر سند) و مهر وزارت خارجه (۵۰,۰۰۰ هر صفحه) --
// prefilled with today's default price, quantity still fully editable.
function addPresetInvoiceRow(description, unitPriceToman) {
    invoiceDraft.push({ description, quantity: 1, unit_price_toman: unitPriceToman, job_id: null });
    renderDraftRows();
}

function updateDraftRow(idx, field, value) {
    if (!invoiceDraft[idx]) return;
    invoiceDraft[idx][field] = field === 'description' ? value : (parseInt(value, 10) || 0);
    if (field === 'quantity' || field === 'unit_price_toman') renderDraftRows();
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
        return `
        <div class="flex items-center gap-1.5 p-2 rounded-lg" style="background:var(--card-surface);border:1px solid var(--border-subtle);">
            <input type="text" value="${row.description.replace(/"/g,'&quot;')}" placeholder="شرح ردیف (مثلاً هزینه پیک)" oninput="updateDraftRow(${idx},'description',this.value)" class="auth-input flex-1" style="padding:.4rem .6rem;font-size:.78rem;">
            <input type="number" min="1" value="${row.quantity}" title="تعداد" oninput="updateDraftRow(${idx},'quantity',this.value)" class="auth-input en" dir="ltr" style="width:52px;padding:.4rem .4rem;font-size:.78rem;text-align:center;">
            <span class="text-[10px] shrink-0" style="color:var(--text-muted);">×</span>
            <input type="number" value="${row.unit_price_toman}" title="قیمت واحد (تومان)" oninput="updateDraftRow(${idx},'unit_price_toman',this.value)" class="auth-input en" dir="ltr" style="width:100px;padding:.4rem .6rem;font-size:.78rem;">
            <span class="text-[11px] font-bold en shrink-0" style="width:95px;text-align:left;color:var(--accent);">${lineTotal.toLocaleString()}</span>
            <button onclick="removeDraftRow(${idx})" style="color:#f87171;background:none;border:none;cursor:pointer;font-weight:700;padding:0 .25rem;">✕</button>
        </div>`;
    }).join('');
    updateDraftTotal();
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
                <span class="text-[10px] en font-bold" style="color:${isToday ? 'var(--accent)' : 'var(--text-muted)'};">${d.getDate()}</span>
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
     'clientProfilePage', 'workSchedulePage', 'settingsPage'].forEach(id => {
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
async function openClientProfile(clientId) {
    if (!currentUserSession) { openAuthModal(); return; }
    currentClientDetailId = clientId;
    invoiceDraft = [];
    showFullView('clientProfilePage');
    navigateTo('/clients/' + clientId);

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
        document.getElementById('cp-dob').textContent = c.date_of_birth || '—';
        document.getElementById('cp-national').textContent = c.national_id || '—';
        document.getElementById('cp-passport').textContent = c.passport_number || '—';
        document.getElementById('cp-nationality').textContent = c.nationality || '—';
        document.getElementById('cp-phone').textContent = c.phone || '—';
        document.getElementById('cp-email').textContent = c.email || '—';
        document.getElementById('cp-notes').value = c.notes || '';
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

// ── Open the office-wide weekly work schedule ──────────────────────────
let scheduleWeekStart = null;
let scheduleTypeFilter = null;
let scheduleWeekOrders = [];

/* ============ SECTION: OFFICE WEEKLY SCHEDULE ============ */
function openWorkSchedulePage() {
    if (!currentUserSession) { openAuthModal(); return; }
    showFullView('workSchedulePage');
    navigateTo('/schedule');
    scheduleWeekStart = startOfPersianWeek(new Date());
    scheduleTypeFilter = null;
    setScheduleTypeFilter(null);
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

function setScheduleWeekToToday() {
    scheduleWeekStart = startOfPersianWeek(new Date());
    renderScheduleWeek();
}

function shiftScheduleWeek(n) {
    if (!scheduleWeekStart) scheduleWeekStart = startOfPersianWeek(new Date());
    scheduleWeekStart.setDate(scheduleWeekStart.getDate() + n * 7);
    renderScheduleWeek();
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
    renderScheduleWeek();
}

async function renderScheduleWeek() {
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

    grid.innerHTML = `<div class="text-xs text-center py-6" style="color:var(--text-muted);grid-column:1/-1;">در حال بارگذاری تقویم...</div>`;

    let orders = [];
    try {
        const url = new URL(`${CORE}/work-orders`);
        url.searchParams.set('from', fromISO);
        url.searchParams.set('to', toISO);
        if (scheduleTypeFilter) url.searchParams.set('order_type', scheduleTypeFilter);
        const res = await fetch(url, { headers: { 'Authorization': `Bearer ${getToken()}` } });
        if (!res.ok) throw new Error();
        orders = await res.json();
    } catch (e) {
        grid.innerHTML = `<div class="text-xs text-center py-6" style="color:#f87171;grid-column:1/-1;">خطا در دریافت زمان‌بندی.
            <button onclick="renderScheduleWeek()" class="block mx-auto mt-2 text-[11px] font-bold px-3 py-1 rounded-lg" style="background:var(--card-surface);color:var(--accent);border:1px solid var(--border-color);">🔄 تلاش مجدد</button>
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
                <span class="text-[10px] en font-bold" style="color:${isToday ? 'var(--accent)' : 'var(--text-muted)'};">${d.getDate()}</span>
            </div>
            ${pendingCount ? `<div class="text-[9px] font-bold mb-1" style="color:var(--accent);"><span class="en">${pendingCount}</span> در انتظار</div>` : ''}
            ${overdue ? `<div class="text-[9px] font-bold mb-1" style="color:#f87171;">⚠ ددلاین گذشته</div>` : ''}
            ${itemsHtml}
          </div>`;
    }).join('');

    if (!orders.length) {
        list.innerHTML = `<div class="text-xs text-center py-4" style="color:var(--text-muted);">// در این هفته سفارشی ثبت نشده</div>`;
    } else {
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
        return `
        <div class="flex items-center gap-1.5 p-2 rounded-lg" style="background:var(--bg-main);border:1px solid var(--border-subtle);">
            <input type="text" value="${row.description.replace(/"/g,'&quot;')}" oninput="updateInvoiceEditRow(${idx},'description',this.value)" class="auth-input flex-1" style="padding:.4rem .6rem;font-size:.78rem;">
            <input type="number" min="1" value="${row.quantity}" oninput="updateInvoiceEditRow(${idx},'quantity',this.value)" class="auth-input en" dir="ltr" style="width:52px;padding:.4rem .4rem;font-size:.78rem;text-align:center;">
            <span class="text-[10px] shrink-0" style="color:var(--text-muted);">×</span>
            <input type="number" value="${row.unit_price_toman}" oninput="updateInvoiceEditRow(${idx},'unit_price_toman',this.value)" class="auth-input en" dir="ltr" style="width:100px;padding:.4rem .6rem;font-size:.78rem;">
            <span class="text-[11px] font-bold en shrink-0" style="width:92px;text-align:left;color:var(--accent);">${lineTotal.toLocaleString()}</span>
            <button onclick="removeInvoiceEditRow(${idx})" style="color:#f87171;background:none;border:none;cursor:pointer;font-weight:700;padding:0 .25rem;">✕</button>
        </div>`;
    }).join('');
    updateInvoiceEditTotal();
}

function updateInvoiceEditRow(idx, field, value) {
    if (!invoiceEditState || !invoiceEditState.items[idx]) return;
    const row = invoiceEditState.items[idx];
    if (field === 'description') row.description = value;
    else if (field === 'quantity') row.quantity = parseInt(value, 10) || 1;
    else if (field === 'unit_price_toman') row.unit_price_toman = parseInt(value, 10) || 0;
    row.line_total_toman = (row.quantity || 1) * (row.unit_price_toman || 0);
    document.getElementById('ive-rows').children[idx].querySelector('span').textContent = row.line_total_toman.toLocaleString();
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
            `${data.invoices_created} فاکتور جدید ساخته شد` +
            (data.invoices_skipped_already_imported ? ` (${data.invoices_skipped_already_imported} فاکتور قبلاً وارد شده بود و رد شد)` : '') +
            (errors.length ? ` — ${errors.length} ردیف رد شد: ${errors.map(e => `کد پیگیری ${e.tracking_code} (${e.reason})`).join('، ')}` : '') +
            '.';
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
    ['pp-first','pp-last','pp-father','pp-dob','pp-national'].forEach(id => document.getElementById(id).value = '');
}

function ppFillFields(data) {
    document.getElementById('pp-first').value    = data.first_name    || '';
    document.getElementById('pp-last').value     = data.last_name     || '';
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
    const father   = document.getElementById('pp-father').value.trim().toUpperCase();
    const dob      = document.getElementById('pp-dob').value.trim();
    const national = document.getElementById('pp-national').value.trim();

    if (!first || !last) { showToast('⚠️ نام و نام خانوادگی الزامی است.'); return; }

    ppShowStatus('⏳', 'در حال ثبت جلسه...');

    try {
        const res = await fetch(`${getActiveBackendOrigin()}/passport/confirm`, {
            method: 'POST',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ first_name:first, last_name:last, father_name:father, date_of_birth:dob, national_id:national })
        });
        if (!res.ok) { const e = await res.json(); throw new Error(e.detail || 'خطای سرور'); }
        const data = await res.json();

        confirmedPassports.push({ session_id:data.session_id, first_name:first, last_name:last, father_name:father, date_of_birth:dob, national_id:national });
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
            saveOrAttachClient({ first_name:first, last_name:last, father_name:father, date_of_birth:dob, national_id:national, session_id:data.session_id });
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
    ['ac-first','ac-last','ac-first-fa','ac-last-fa','ac-national','ac-father','ac-dob','ac-phone','ac-email','ac-passport','ac-nationality','ac-notes']
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

    // GitHub Pages has no server routing: a refresh on /dashboard etc. lands
    // on 404.html, which stashes the intended path in sessionStorage and
    // redirects to '/'. Restore it here so the route below sees the real
    // path instead of '/'.
    let initialPath = window.location.pathname;
    try {
        const redirected = sessionStorage.getItem('deept_redirect_path');
        if (redirected && redirected.startsWith('/') && redirected !== '/') {
            sessionStorage.removeItem('deept_redirect_path');
            window.history.replaceState({ path: redirected }, '', redirected);
            initialPath = redirected;
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
function closeModals()   {
    ['loginOverlay','signupOverlay','quickStartOverlay'].forEach(id=>{
        const el=document.getElementById(id); if(el) el.classList.remove('open');
    });
}
function switchToSignup() { closeModals(); setTimeout(openSignup,80); }
function switchToLogin()  { closeModals(); setTimeout(openLogin,80); }
function closeAuthModal() { closeModals(); }
function switchAuthState(s) { if(s==='signup') switchToSignup(); else switchToLogin(); }

document.addEventListener('keydown',e=>{
    if(e.key!=='Enter') return;
    if(document.getElementById('loginOverlay').classList.contains('open'))  handleLogin();
    if(document.getElementById('signupOverlay').classList.contains('open')) handleSignup();
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
(function() {
    const saved = localStorage.getItem('deept_theme') || 'dark';
    if (saved === 'light') {
        document.body.setAttribute('data-theme', 'light');
        document.getElementById('themeBtn').textContent = '☀️';
    }
})();


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
        const res = await fetch(`${CORE}/jobs/admin/all`, {
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
    updateCrmDashboard();
}

function resetCrmTimeFrame() {
    const yearSel = document.getElementById('crmStatsYear');
    const monthSel = document.getElementById('crmStatsMonth');
    if (yearSel) yearSel.value = '';
    if (monthSel) monthSel.value = '';
    try { localStorage.removeItem(CRM_TF_KEY); } catch(e) {}
    syncCrmMonthDisabled();
    updateCrmTimeFrameLabel();
    updateCrmDashboard();
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
// don't belong in the primary init block (hero logo, CRM selects).
// Theme restore, test session, syncUserSessionDOM, activation redirect
// and routing all live in initializeApp() and must NOT be duplicated here.
(function(){
    // Set hero logo
    const heroLogo=document.getElementById('heroLogo');
    if(heroLogo) heroLogo.src="data:image/png;base64,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AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACcEmAAgAQSUp2yh2gAAAAASUVORK5CYII=";

    // CRM time-frame selects — init early so they are ready when admin opens CRM
    try { populateCrmTimeFrameSelects(); } catch(e) {}
})();
