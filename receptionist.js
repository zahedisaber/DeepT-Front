/* ========================================================================
   receptionist.js — منشی هوشمند (AI receptionist) for a certified
   translation office.
   ------------------------------------------------------------------------
   Loaded after app.js (see index.html) and relies on its globals: CORE,
   getToken(), currentUserSession, showFullView(), navigateTo(),
   openHomePanels(), showToast(), escapeHtml(), openAddClientModal(),
   myplEffective()/myPriceListServer/myPriceListDraft/
   loadMyPriceListCatalog(), HR_TIMEZONE, plus PRICE_CATALOG_BY_ID from
   price-catalog.js.

   What it does — the receptionist answers the phone (and chat) the way a
   certified translation office's front desk does, and takes the order.
   Calls are the main channel: see the "phone calls" section at the end
   (voice call mode, spoken-number parsing, call log, and the contract
   for bridging a real phone line). It handles:
     • price questions, from the office's OWN نرخنامه (official tariff +
       the translator's saved overrides/custom items), including page/term
       counts, copies, دادگستری/خارجه stamp fees and urgent surcharge;
     • office hours ("الان بازید؟"), in Tehran time;
     • address / phone / required originals / تأییدات / turnaround / languages;
     • the office's own custom FAQ entries;
     • an intake flow (name → mobile → documents → language → urgency →
       delivery → confirm) that files a درخواست (lead) in the inbox, where
       staff can follow up, copy a summary, or turn it into a مشتری.

   Two answer engines:
     1. Local engine (always available, default). Deterministic and
        grounded: every price it quotes comes from the catalog, so it can
        never invent a fee. The intake flow ALWAYS runs here, so captured
        data is exact.
     2. Optional server LLM (settings → "پاسخ با مدل زبانی"). Free-form
        questions are sent to DeepT-Core with the grounding the local
        engine computed, and the reply is shown instead. Any failure falls
        back to the local answer. Contract the backend must implement:
            POST {CORE}/receptionist/reply      (Bearer auth)
            { message, history:[{role,text}], office:{...settings},
              grounding:{ local_answer, documents:[{label,estimate}],
                          open_now, today_hours } }
            -> 200 { reply: "..." }
        The prompt there must instruct the model to quote ONLY prices that
        appear in grounding, never promise legal outcomes, and hand off to
        a human for anything it can't answer.

   Storage: settings + leads live in localStorage, per user id
   (deept_receptionist_v1_<user_id>). That keeps the feature fully usable
   today; moving them to DeepT-Core (so a public website widget can feed
   the same inbox) only needs rcpLoad()/rcpSave() swapped.
   ======================================================================== */

const RCP_STORAGE_PREFIX = 'deept_receptionist_v1_';

// Persian week order, with the JS getDay() index for each.
const RCP_WEEKDAYS = [
    { key: 'sat', label: 'شنبه',     js: 6 },
    { key: 'sun', label: 'یکشنبه',   js: 0 },
    { key: 'mon', label: 'دوشنبه',   js: 1 },
    { key: 'tue', label: 'سه‌شنبه',  js: 2 },
    { key: 'wed', label: 'چهارشنبه', js: 3 },
    { key: 'thu', label: 'پنجشنبه',  js: 4 },
    { key: 'fri', label: 'جمعه',     js: 5 },
];

const RCP_DEFAULT_CONFIG = {
    officeName: '',
    assistantName: 'سارا',
    greeting: '',
    phone: '',
    whatsapp: '',
    address: '',
    mapUrl: '',
    hours: {
        sat: { open: true,  from: '08:30', to: '17:00' },
        sun: { open: true,  from: '08:30', to: '17:00' },
        mon: { open: true,  from: '08:30', to: '17:00' },
        tue: { open: true,  from: '08:30', to: '17:00' },
        wed: { open: true,  from: '08:30', to: '17:00' },
        thu: { open: true,  from: '09:00', to: '13:00' },
        fri: { open: false, from: '',      to: ''      },
    },
    languages: 'انگلیسی، آلمانی، فرانسوی، ایتالیایی، اسپانیایی، عربی، ترکی',
    normalDays: 3,
    urgentDays: 1,
    urgentSurchargePct: 50,
    feeJustice: true,    // تمبر دادگستری per document (catalog item 224)
    feeForeign: true,    // مهر خارجه per document (catalog item 225)
    feeService: false,   // هزینه خدمات per document (catalog item 226)
    courier: true,       // پیک available (catalog item 228)
    extraNotes: '',      // anything else the receptionist should always mention for requirements
    faqs: [],            // [{q, a}]
    aiBackend: false,
    voiceName: '',       // speechSynthesis voice chosen in settings ('' = first Persian voice)
    readAloud: false,    // also speak replies in typed chat, not only in call mode
    // Landline routing policy, read by the telephony bridge (see
    // docs/receptionist-telephony.md §3): who answers the office line when.
    routing: { mode: 'no_answer', ringSeconds: 20, transferTo: '' },
};

const RCP_LEAD_STATUSES = {
    new:       { label: 'جدید',            color: '#22d3ee' },
    contacted: { label: 'تماس گرفته شد',   color: '#f59e0b' },
    converted: { label: 'تبدیل به مشتری',  color: '#22c55e' },
    closed:    { label: 'بسته شد',         color: '#9ca3af' },
};

// Everyday words → catalog item id. Checked before the fuzzy label match
// because clients rarely use the tariff sheet's formal names.
const RCP_DOC_SYNONYMS = [
    [['پاسپورت', 'گذرنامه'], '108'],
    [['کارت ملی', 'کارت ملی هوشمند'], '14'],
    [['شناسنامه'], '9'],
    [['عقدنامه', 'عقد نامه', 'سند ازدواج', 'قباله ازدواج', 'قباله'], '11'],
    [['طلاق نامه', 'طلاقنامه', 'سند طلاق'], '13'],
    [['ریزنمرات دانشگاه', 'ریز نمرات دانشگاه', 'ریزنمره دانشگاه', 'ریز نمره دانشگاه', 'ترنسکریپت'], '58'],
    [['ریزنمرات دبیرستان', 'ریز نمرات دبیرستان', 'ریزنمره دبیرستان', 'ریز نمره دبیرستان', 'ریزنمرات پیش دانشگاهی'], '53'],
    [['ریزنمرات', 'ریز نمرات', 'ریزنمره', 'ریز نمره'], '58'],
    [['دیپلم', 'پیش دانشگاهی'], '51'],
    [['دانشنامه', 'مدرک تحصیلی', 'مدرک دانشگاه', 'لیسانس', 'فوق لیسانس', 'کارشناسی ارشد', 'کارشناسی', 'دکترا', 'فارغ التحصیلی', 'کاردانی'], '56'],
    [['سند خانه', 'سند خونه', 'سند ملک', 'سند ملکی', 'سند مالکیت', 'سند تک برگ', 'تک برگ'], '77'],
    [['سند دفترچه ای'], '78'],
    [['گواهینامه موتور'], '181'],
    [['گواهینامه رانندگی', 'گواهینامه', 'لایسنس رانندگی'], '180'],
    [['سو پیشینه', 'سوپیشینه', 'سوء پیشینه', 'سوءپیشینه', 'عدم سو', 'عدم سوء'], '163'],
    [['پایان خدمت', 'کارت سربازی'], '105'],
    [['معافیت تحصیلی'], '106'],
    [['کارت معافیت', 'معافیت'], '107'],
    [['گواهی اشتغال به تحصیل', 'اشتغال به تحصیل'], '142'],
    [['گواهی اشتغال', 'اشتغال به کار', 'گواهی کار'], '146'],
    [['فیش حقوقی', 'فیش حقوق'], '6'],
    [['حکم کارگزینی'], '2'],
    [['گردش حساب', 'تمکن مالی', 'تمکن', 'گواهی بانکی', 'گواهی موجودی'], '16'],
    [['سابقه بیمه', 'بیمه تامین اجتماعی'], '25'],
    [['جواز کسب'], '125'],
    [['وکالتنامه', 'وکالت نامه'], '216'],
    [['اجاره نامه', 'اجارهنامه', 'قرارداد اجاره'], '81'],
    [['گواهی تولد'], '155'],
    [['گواهی فوت'], '156'],
    [['روزنامه رسمی'], '43'],
    [['اساسنامه'], '37'],
    [['کارت واکسن', 'واکسیناسیون'], '34'],
    [['گزارش پزشکی', 'مدارک پزشکی'], '27'],
];

const RCP_FA_NUMBER_WORDS = {
    'یک': 1, 'یه': 1, 'دو': 2, 'سه': 3, 'چهار': 4, 'پنج': 5, 'شش': 6, 'شیش': 6,
    'هفت': 7, 'هشت': 8, 'نه': 9, 'ده': 10,
};

const RCP_LANGS = [
    ['انگلیسی', ['انگلیسی', 'english', 'انگلیس', 'آمریکا', 'کانادا', 'استرالیا']],
    ['آلمانی', ['آلمانی', 'آلمان', 'german', 'اتریش']],
    ['فرانسوی', ['فرانسوی', 'فرانسه', 'french']],
    ['ایتالیایی', ['ایتالیایی', 'ایتالیا', 'italian']],
    ['اسپانیایی', ['اسپانیایی', 'اسپانیا', 'spanish']],
    ['عربی', ['عربی', 'عراق', 'امارات', 'arabic']],
    ['ترکی', ['ترکی', 'ترکیه', 'turkish', 'استانبولی']],
    ['روسی', ['روسی', 'روسیه', 'russian']],
];

/* ─────────────────────────── state ─────────────────────────── */

let rcpConfig = null;
let rcpLeads = [];
let rcpCalls = [];          // call log: [{id, startedAt, seconds, leadCode, transcript}]
let rcpCall = null;         // live call: {active, startedAt, recog, timer, listening, speaking, muted}
let rcpChat = null;          // { messages:[{role,text,chips,time}], intake, lastDocs }
let rcpActiveTab = 'chat';
let rcpLeadFilter = 'all';
let rcpAiFailedOnce = false;
let rcpPriceListRequested = false;

function rcpStorageKey() {
    const uid = (currentUserSession && currentUserSession.user_id) || 'anon';
    return RCP_STORAGE_PREFIX + uid;
}

function rcpLoad() {
    let stored = {};
    try { stored = JSON.parse(localStorage.getItem(rcpStorageKey()) || '{}') || {}; } catch (e) { stored = {}; }
    const cfg = Object.assign({}, RCP_DEFAULT_CONFIG, stored.config || {});
    cfg.hours = Object.assign({}, RCP_DEFAULT_CONFIG.hours, (stored.config && stored.config.hours) || {});
    if (!Array.isArray(cfg.faqs)) cfg.faqs = [];
    cfg.routing = Object.assign({}, RCP_DEFAULT_CONFIG.routing, (stored.config && stored.config.routing) || {});
    rcpConfig = cfg;
    rcpLeads = Array.isArray(stored.leads) ? stored.leads : [];
    rcpCalls = Array.isArray(stored.calls) ? stored.calls : [];
}

function rcpSave() {
    try {
        localStorage.setItem(rcpStorageKey(), JSON.stringify({ config: rcpConfig, leads: rcpLeads, calls: rcpCalls.slice(0, 300) }));
        return true;
    } catch (e) {
        showToast('❌ ذخیره‌سازی در مرورگر ممکن نشد.');
        return false;
    }
}

/* ─────────────────────────── page open/close ─────────────────────────── */

function openReceptionistPage(pushHistory = true) {
    if (!currentUserSession) { openAuthModal(); return; }
    rcpLoad();
    // Quote from the translator's own نرخنامه, not just catalog defaults.
    // Skip if the price-list page holds unsaved edits -- reloading would
    // discard that draft.
    if (!rcpPriceListRequested && typeof loadMyPriceListCatalog === 'function'
        && Object.keys(myPriceListDraft || {}).length === 0) {
        rcpPriceListRequested = true;
        loadMyPriceListCatalog();
    }
    showFullView('receptionistPage');
    if (!rcpChat) rcpResetChat(false);
    rcpSwitchTab(rcpActiveTab);
    if (pushHistory) navigateTo('/home/receptionist');
}

function closeReceptionistPage() {
    if (rcpCall && rcpCall.active) rcpEndCall();
    document.getElementById('receptionistPage').classList.add('hidden');
    document.body.style.overflow = 'auto';
    openHomePanels(false);
}

function rcpSwitchTab(tab) {
    rcpActiveTab = tab;
    ['chat', 'calls', 'leads', 'settings'].forEach(t => {
        const pane = document.getElementById('rcp-pane-' + t);
        const btn = document.getElementById('rcp-tab-' + t);
        if (pane) pane.classList.toggle('hidden', t !== tab);
        if (btn) btn.classList.toggle('rcp-tab-active', t === tab);
    });
    if (tab === 'chat') rcpRenderChat();
    if (tab === 'leads') rcpRenderLeads();
    if (tab === 'calls') rcpRenderCalls();
    if (tab === 'settings') rcpRenderSettings();
    rcpUpdateBadge();
}

function rcpUpdateBadge() {
    const n = rcpLeads.filter(l => l.status === 'new').length;
    const b = document.getElementById('rcp-leads-badge');
    if (!b) return;
    b.textContent = rcpFa(n);
    b.classList.toggle('hidden', n === 0);
}

/* ─────────────────────────── text helpers ─────────────────────────── */

function rcpFa(n) {
    return Number(n || 0).toLocaleString('fa-IR');
}

function rcpToman(n) {
    return Math.round(n || 0).toLocaleString('fa-IR') + ' تومان';
}

function rcpNormalize(s) {
    return String(s || '')
        .replace(/[يى]/g, 'ی').replace(/ك/g, 'ک').replace(/[ۀة]/g, 'ه').replace(/[أإ]/g, 'ا').replace(/ؤ/g, 'و')
        .replace(/[ً-ٰٟ]/g, '')            // harakat
        .replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
        .replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
        .replace(/‌/g, ' ')                          // ZWNJ → space
        .replace(/[؟?!.,،؛:;()«»"'\-_/]/g, ' ')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

function rcpHas(norm, words) {
    return words.some(w => norm.includes(rcpNormalize(w)));
}

function rcpTehranNow() {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: (typeof HR_TIMEZONE !== 'undefined' ? HR_TIMEZONE : 'Asia/Tehran'),
        weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(new Date());
    const get = t => (parts.find(p => p.type === t) || {}).value;
    const jsDay = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
    const hh = parseInt(get('hour'), 10) % 24;
    return { jsDay, minutes: hh * 60 + parseInt(get('minute'), 10) };
}

function rcpToMinutes(t) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(t || '');
    return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null;
}

function rcpFaTime(t) {
    return String(t || '').replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[d]);
}

/* ─────────────────────────── knowledge ─────────────────────────── */

function rcpOpenStatus() {
    const now = rcpTehranNow();
    const day = RCP_WEEKDAYS.find(d => d.js === now.jsDay);
    const h = rcpConfig.hours[day.key] || {};
    const from = rcpToMinutes(h.from), to = rcpToMinutes(h.to);
    const openNow = !!(h.open && from !== null && to !== null && now.minutes >= from && now.minutes < to);
    const todayText = h.open ? `${day.label}‌ها از ${rcpFaTime(h.from)} تا ${rcpFaTime(h.to)}` : `${day.label}‌ها تعطیل هستیم`;
    // next opening, for "closed" answers
    let next = null;
    if (!openNow) {
        const startIdx = RCP_WEEKDAYS.indexOf(day);
        for (let i = 0; i < 8 && !next; i++) {
            const d = RCP_WEEKDAYS[(startIdx + i) % 7];
            const dh = rcpConfig.hours[d.key] || {};
            const df = rcpToMinutes(dh.from);
            if (!dh.open || df === null) continue;
            if (i === 0 && now.minutes >= df) continue;
            next = `${i === 0 ? 'امروز' : (i === 1 ? 'فردا (' + d.label + ')' : d.label)} ساعت ${rcpFaTime(dh.from)}`;
        }
    }
    return { openNow, todayText, next };
}

function rcpHoursTable() {
    return RCP_WEEKDAYS.map(d => {
        const h = rcpConfig.hours[d.key] || {};
        return `• ${d.label}: ${h.open ? rcpFaTime(h.from) + ' تا ' + rcpFaTime(h.to) : 'تعطیل'}`;
    }).join('\n');
}

function rcpCatalogItem(id) {
    return (typeof PRICE_CATALOG_BY_ID !== 'undefined') ? PRICE_CATALOG_BY_ID[id] : null;
}

function rcpPrice(id, component) {
    const item = rcpCatalogItem(id);
    if (!item) return 0;
    try { return Number(myplEffective(id, component)) || 0; } catch (e) { return Number(item[component]) || 0; }
}

function rcpCleanLabel(label) {
    return String(label || '').replace(/\s*\((هر صفحه|هر ترم|هر سال)\)\s*/g, ' ').trim();
}

// Finds catalog documents mentioned in a message. Synonyms first, then a
// token-overlap match against official labels for the long tail.
function rcpDetectDocs(text) {
    const norm = rcpNormalize(text);
    const found = [];
    const claimed = [];   // spans already matched, so "ریزنمرات دانشگاه" doesn't also match "ریزنمرات"
    for (const [words, id] of RCP_DOC_SYNONYMS) {
        if (!rcpCatalogItem(id) || found.some(f => f.id === id)) continue;
        for (const w of words) {
            const nw = rcpNormalize(w);
            const at = norm.indexOf(nw);
            if (at === -1) continue;
            if (claimed.some(([s, e]) => at < e && at + nw.length > s)) continue;
            claimed.push([at, at + nw.length]);
            found.push({ id, at, end: at + nw.length });
            break;
        }
    }
    if (!found.length && typeof PRICE_CATALOG_BY_ID !== 'undefined') {
        const STOP = new Set(['گواهی', 'برای', 'ترجمه', 'سند', 'کارت', 'هر', 'صفحه', 'غیره', 'اسناد', 'یا', 'و', 'از', 'به', 'با',
            'ثبت', 'سفارش', 'قیمت', 'هزینه', 'رسمی', 'چند', 'چنده', 'میشه', 'میخوام', 'دارم', 'سلام', 'لطفا', 'انگلیسی', 'آلمانی', 'فرانسوی', 'سایر', 'کلیه', 'مدارک', 'مدرک', 'نامه']);
        const tokens = new Set(norm.split(' ').filter(t => t.length >= 3 && !STOP.has(t)));
        let best = null;
        Object.values(PRICE_CATALOG_BY_ID).forEach(item => {
            if (!item || !item.label || (typeof PINNED_ITEM_IDS !== 'undefined' && PINNED_ITEM_IDS.has(item.id) && !String(item.id).startsWith('custom-'))) return;
            const lt = rcpNormalize(item.label).split(' ').filter(t => t.length >= 3 && !STOP.has(t));
            if (!lt.length) return;
            const hits = lt.filter(t => tokens.has(t)).length;
            const score = hits / lt.length;
            if ((hits >= 2 || (lt.length === 1 && hits === 1)) && score >= 0.5 && (!best || score > best.score)) best = { id: item.id, score, at: 0, end: 0, whole: true };
        });
        if (best) found.push(best);
    }
    // Quantities, per document by position: a count right BEFORE the
    // name is copies ("۲ تا شناسنامه"), a count+unit right AFTER it is
    // pages/terms/years ("ریزنمرات ۸ ترم"). The fuzzy match has no
    // position, so it reads the whole message.
    const numRe = '(\\d+|' + Object.keys(RCP_FA_NUMBER_WORDS).join('|') + ')';
    const toNum = v => /^\d+$/.test(v) ? parseInt(v, 10) : RCP_FA_NUMBER_WORDS[v];
    const before = new RegExp('(?:^|\\s)' + numRe + '\\s*(?:تا|عدد|نسخه|سری|برگ)?\\s*$');
    const afterUnit = new RegExp('^\\s*(?:\\S+\\s+){0,2}?' + numRe + '\\s*(صفحه|برگ|ترم|سال)(?![\\u0600-\\u06FF])');
    const anyUnit = new RegExp(numRe + '\\s*(صفحه|برگ|ترم|سال)(?![\\u0600-\\u06FF])');
    const anyCopy = new RegExp(numRe + '\\s*(تا|عدد|نسخه|سری)(?![\\u0600-\\u06FF])');
    found.sort((a, b) => a.at - b.at);
    return found.map((f, idx) => {
        let units = 1, copies = 1;
        if (f.whole) {
            const u = anyUnit.exec(norm), c = anyCopy.exec(norm);
            if (u) units = toNum(u[1]) || 1;
            if (c) copies = toNum(c[1]) || 1;
        } else {
            const prevEnd = idx > 0 ? found[idx - 1].end : 0;
            const nextAt = idx < found.length - 1 ? found[idx + 1].at : norm.length;
            const b = before.exec(norm.slice(prevEnd, f.at));
            const a = afterUnit.exec(norm.slice(f.end, nextAt));
            if (b) copies = toNum(b[1]) || 1;
            if (a) units = toNum(a[1]) || 1;
        }
        return { id: f.id, units: Math.min(units, 200), copies: Math.min(copies, 50) };
    });
}

function rcpDetectLang(text) {
    const norm = rcpNormalize(text);
    const hit = RCP_LANGS.find(([, words]) => rcpHas(norm, words));
    return hit ? hit[0] : null;
}

// Estimate for one detected document: base (× units if per-page/term),
// × copies, + per-document stamp/service fees chosen in settings.
function rcpEstimateDoc(doc) {
    const item = rcpCatalogItem(doc.id);
    const base = rcpPrice(doc.id, 'base');
    const units = item.baseUnit ? doc.units : 1;
    const translation = base * units;
    const fees = [];
    if (rcpConfig.feeJustice && rcpCatalogItem('224')) fees.push(['تمبر دادگستری', rcpPrice('224', 'base')]);
    if (rcpConfig.feeForeign && rcpCatalogItem('225')) fees.push(['مهر خارجه', rcpPrice('225', 'base')]);
    if (rcpConfig.feeService && rcpCatalogItem('226')) fees.push(['هزینه خدمات', rcpPrice('226', 'base')]);
    const feeSum = fees.reduce((s, [, v]) => s + v, 0);
    let extraNote = '';
    let extras = [];
    try { extras = (typeof myplEffectiveExtras === 'function') ? myplEffectiveExtras(doc.id) : []; } catch (e) { extras = []; }
    if (!extras.length && item.extra) extras = [{ price: rcpPrice(doc.id, 'extra'), unit: item.unit }];
    if (extras.length) extraNote = extras.map(x => `${rcpToman(x.price)} به ازای ${x.unit || 'هر مورد اضافه'}`).join('، ');
    return {
        id: doc.id,
        label: rcpCleanLabel(item.label),
        baseUnit: item.baseUnit || null,
        units, copies: doc.copies,
        unitPrice: base,
        translation,
        fees, feeSum,
        perCopy: translation + feeSum,
        total: (translation + feeSum) * doc.copies,
        extraNote,
    };
}

function rcpQuoteText(docs, urgent) {
    const ests = docs.map(rcpEstimateDoc);
    const lines = [];
    let total = 0;
    ests.forEach(e => {
        const unitTxt = e.baseUnit ? ` (${rcpFa(e.units)} ${e.baseUnit} × ${rcpToman(e.unitPrice)})` : '';
        const copyTxt = e.copies > 1 ? ` × ${rcpFa(e.copies)} نسخه` : '';
        lines.push(`📄 ${e.label}${unitTxt}${copyTxt}`);
        lines.push(`   حق‌الترجمه: ${rcpToman(e.translation)}`);
        e.fees.forEach(([n, v]) => lines.push(`   ${n}: ${rcpToman(v)}`));
        if (e.extraNote) lines.push(`   در صورت نیاز: ${e.extraNote}`);
        if (e.baseUnit && e.units === 1) lines.push(`   (قیمت به ازای هر ${e.baseUnit} است — تعداد ${e.baseUnit} را بگویید تا دقیق‌تر حساب کنم)`);
        total += e.total;
    });
    let urgentFee = 0;
    if (urgent && rcpConfig.urgentSurchargePct > 0) {
        urgentFee = Math.round(ests.reduce((s, e) => s + e.translation * e.copies, 0) * rcpConfig.urgentSurchargePct / 100);
        lines.push(`⚡ فوری (${rcpFa(rcpConfig.urgentSurchargePct)}٪ روی حق‌الترجمه): ${rcpToman(urgentFee)}`);
        total += urgentFee;
    }
    lines.push('');
    lines.push(`💰 برآورد کل: حدود ${rcpToman(total)}`);
    lines.push('مبلغ نهایی پس از دیدن اصل مدرک (تعداد سطرها و توضیحات) مشخص می‌شود.');
    return { text: lines.join('\n'), total, estimates: ests, urgentFee };
}

/* ─────────────────────────── intents ─────────────────────────── */

const RCP_INTENTS = {
    greet:    ['سلام', 'درود', 'وقت بخیر', 'صبح بخیر', 'عصر بخیر', 'hello', 'hi'],
    thanks:   ['ممنون', 'مرسی', 'متشکرم', 'سپاس', 'دستت درد نکنه', 'خداحافظ'],
    price:    ['قیمت', 'هزینه', 'چنده', 'چند میشه', 'چقدر میشه', 'چقدر می شه', 'تعرفه', 'نرخ', 'هزینش', 'هزینه اش', 'چند تومن', 'چند تومان', 'مبلغ'],
    hours:    ['ساعت کاری', 'ساعت کار', 'باز هستید', 'بازید', 'باز است', 'بازه', 'تعطیل', 'چه ساعتی', 'کی باز', 'تا کی', 'ساعت چند', 'الان باز'],
    address:  ['آدرس', 'ادرس', 'کجایید', 'کجا هستید', 'نشانی', 'لوکیشن', 'مسیر', 'کجاست', 'نقشه'],
    contact:  ['شماره تماس', 'شماره تلفن', 'تلفن', 'واتساپ', 'واتس اپ', 'تماس بگیرم', 'شمارتون'],
    time:     ['چند روز', 'چقدر طول', 'کی آماده', 'کی حاضر', 'زمان تحویل', 'تحویل', 'فوری', 'امروز آماده', 'فردا آماده', 'چه زمانی'],
    reqs:     ['مدارک لازم', 'چه مدارکی', 'چی لازمه', 'چی بیارم', 'چه چیزی بیارم', 'اصل مدرک', 'کپی', 'اسکن', 'تایید', 'تأیید', 'دادگستری', 'وزارت خارجه', 'امور خارجه', 'مهر', 'آپوستیل', 'اپوستیل'],
    langs:    ['چه زبان', 'کدوم زبان', 'چه زبونی', 'زبان ها', 'زبانهایی', 'به چه زبانی'],
    order:    ['سفارش', 'ثبت درخواست', 'ثبت سفارش', 'میخوام ترجمه', 'می خواهم ترجمه', 'میخوام بدم', 'نوبت', 'رزرو', 'ترجمه کنید', 'ترجمه کنم', 'می خوام', 'میخوام'],
    human:    ['اپراتور', 'مترجم صحبت', 'با یک نفر', 'با آدم', 'پشتیبان', 'کارشناس', 'تماس بگیرید', 'زنگ بزنید'],
    courier:  ['پیک', 'ارسال', 'پست', 'بفرستید', 'غیرحضوری', 'غیر حضوری', 'آنلاین'],
    cancel:   ['لغو', 'انصراف', 'بیخیال', 'کنسل'],
};

function rcpDetectIntents(text) {
    const norm = rcpNormalize(text);
    return Object.keys(RCP_INTENTS).filter(k => rcpHas(norm, RCP_INTENTS[k]));
}

function rcpMatchFaq(text) {
    const norm = rcpNormalize(text);
    const tokens = new Set(norm.split(' ').filter(t => t.length >= 3));
    let best = null;
    (rcpConfig.faqs || []).forEach(f => {
        if (!f || !f.q || !f.a) return;
        const qt = rcpNormalize(f.q).split(' ').filter(t => t.length >= 3);
        if (!qt.length) return;
        const hits = qt.filter(t => tokens.has(t)).length;
        const score = hits / qt.length;
        if (hits >= 1 && score >= 0.5 && (!best || score > best.score)) best = { f, score };
    });
    return best ? best.f : null;
}

function rcpOfficeName() {
    return rcpConfig.officeName || 'دفتر ترجمه رسمی';
}

function rcpGreetingText() {
    if (rcpConfig.greeting) return rcpConfig.greeting;
    return `سلام، وقت بخیر 🌷\nمن ${rcpConfig.assistantName || 'منشی'}، منشی هوشمند ${rcpOfficeName()} هستم.\nمی‌توانم قیمت ترجمه رسمی مدارک، ساعات کاری، مدارک لازم و زمان تحویل را بگویم یا سفارش شما را ثبت کنم. چه کمکی از دستم برمی‌آید؟`;
}

const RCP_MAIN_CHIPS = ['قیمت ترجمه شناسنامه', 'الان باز هستید؟', 'چه مدارکی لازم است؟', 'ثبت سفارش'];

/* ─────────────────────────── local engine ─────────────────────────── */

function rcpAnswerQuestion(text) {
    const intents = rcpDetectIntents(text);
    const docs = rcpDetectDocs(text);
    const urgent = rcpHas(rcpNormalize(text), ['فوری', 'عجله', 'امروز', 'سریع']);
    if (docs.length) rcpChat.lastDocs = docs;

    const faq = rcpMatchFaq(text);
    if (faq && !docs.length) return { text: faq.a, chips: ['ثبت سفارش', 'سؤال دیگری دارم'] };

    const parts = [];
    const chips = new Set();

    if (docs.length && (intents.includes('price') || intents.length === 0 || intents.includes('order') === false)) {
        const q = rcpQuoteText(docs, urgent);
        parts.push(q.text);
        chips.add('ثبت سفارش');
        chips.add('زمان تحویل چقدر است؟');
    }
    if (intents.includes('price') && !docs.length) {
        const samples = ['14', '9', '108', '51'].filter(rcpCatalogItem)
            .map(id => `• ${rcpCleanLabel(rcpCatalogItem(id).label)}: ${rcpToman(rcpPrice(id, 'base'))}`);
        parts.push(`قیمت‌ها طبق نرخنامه رسمی کانون مترجمان است. چند نمونه (فقط حق‌الترجمه):\n${samples.join('\n')}\n\nنام مدرک‌تان را بنویسید (مثلاً «سند ازدواج» یا «ریزنمرات دانشگاه ۸ ترم») تا دقیق برآورد کنم.`);
        ['قیمت ترجمه پاسپورت', 'قیمت ترجمه دیپلم'].forEach(c => chips.add(c));
    }
    if (intents.includes('hours')) {
        const s = rcpOpenStatus();
        parts.push(s.openNow
            ? `بله، الان باز هستیم ✅ (${s.todayText}).`
            : `الان دفتر بسته است.${s.next ? ' نوبت بعدی باز شدن: ' + s.next + '.' : ''}\nالبته همین‌جا می‌توانید سفارش ثبت کنید تا همکارانم با شما تماس بگیرند.`);
        parts.push('ساعات کاری:\n' + rcpHoursTable());
    }
    if (intents.includes('address')) {
        parts.push(rcpConfig.address
            ? `📍 آدرس: ${rcpConfig.address}${rcpConfig.mapUrl ? '\nمسیریابی: ' + rcpConfig.mapUrl : ''}`
            : 'آدرس دفتر هنوز در تنظیمات ثبت نشده؛ لطفاً با شماره دفتر تماس بگیرید.');
    }
    if (intents.includes('contact') || intents.includes('human')) {
        const c = [];
        if (rcpConfig.phone) c.push(`☎️ تلفن: ${rcpConfig.phone}`);
        if (rcpConfig.whatsapp) c.push(`💬 واتساپ: ${rcpConfig.whatsapp}`);
        parts.push((intents.includes('human') ? 'حتماً، همکاران مترجم ما در خدمت‌تان هستند.\n' : '')
            + (c.length ? c.join('\n') : 'شماره تماس دفتر هنوز در تنظیمات ثبت نشده است.')
            + (intents.includes('human') ? '\nاگر بخواهید، سفارش را ثبت می‌کنم تا خودشان با شما تماس بگیرند.' : ''));
        chips.add('ثبت سفارش');
    }
    if (intents.includes('time')) {
        parts.push(`⏱ زمان تحویل معمول ${rcpFa(rcpConfig.normalDays)} روز کاری است (بعد از دریافت اصل مدارک).`
            + (rcpConfig.urgentDays ? `\n⚡ ترجمه فوری: ${rcpFa(rcpConfig.urgentDays)} روز کاری${rcpConfig.urgentSurchargePct ? ' با ' + rcpFa(rcpConfig.urgentSurchargePct) + '٪ هزینه اضافه روی حق‌الترجمه' : ''}.` : '')
            + ((rcpConfig.feeJustice || rcpConfig.feeForeign) ? '\nدریافت تأییدات دادگستری و امور خارجه ممکن است چند روز کاری به این زمان اضافه کند.' : ''));
    }
    if (intents.includes('reqs')) {
        const r = [
            '📋 برای ترجمه رسمی، «اصل» مدرک لازم است (کپی و عکس فقط برای برآورد قیمت کافی است).',
            'برای مدارک تحصیلی معمولاً تأییدیه وزارت علوم/آموزش‌وپرورش (و برای دانشگاه آزاد، استعلام) پیش از تأیید دادگستری لازم است.',
            'تأیید دادگستری و امور خارجه بنا به درخواست سفارت/مقصد انجام می‌شود؛ اگر الزامات سفارت را دارید، همراه بیاورید.',
            'املای انگلیسی نام‌ها را مطابق پاسپورت می‌نویسیم؛ لطفاً تصویر صفحه اول پاسپورت را هم بفرستید.',
        ];
        if (rcpConfig.extraNotes) r.push(rcpConfig.extraNotes);
        parts.push(r.join('\n'));
    }
    if (intents.includes('langs')) {
        parts.push(`🌐 زبان‌های ترجمه رسمی این دفتر: ${rcpConfig.languages || '—'}.`);
    }
    if (intents.includes('courier')) {
        parts.push(rcpConfig.courier
            ? `🛵 بله، امکان ارسال و دریافت مدارک با پیک داریم${rcpCatalogItem('228') ? ' (هزینه پیک حدود ' + rcpToman(rcpPrice('228', 'base')) + ')' : ''}. برای برآورد قیمت می‌توانید تصویر مدارک را بفرستید؛ اصل مدرک برای ترجمه رسمی لازم است.`
            : 'فعلاً تحویل مدارک فقط به‌صورت حضوری در دفتر است.');
    }
    if (!parts.length && rcpHas(rcpNormalize(text), ['سوال دیگری', 'سؤال دیگری', 'سوال دیگه', 'یه سوال'])) {
        return { text: 'بفرمایید، در خدمتم 🌷', chips: RCP_MAIN_CHIPS };
    }
    if (intents.includes('thanks') && !parts.length) {
        return { text: 'خواهش می‌کنم 🌷 اگر سؤال دیگری داشتید در خدمتم.', chips: ['ثبت سفارش'] };
    }
    if (intents.includes('greet') && !parts.length) {
        return { text: `سلام، خوش آمدید 🌷 من ${rcpConfig.assistantName || 'منشی'} هستم. بفرمایید، چه مدرکی را می‌خواهید ترجمه کنید؟`, chips: RCP_MAIN_CHIPS };
    }
    if (faq) parts.push(faq.a);

    if (!parts.length) {
        return {
            text: 'متوجه سؤال‌تان نشدم 🙏 می‌توانید نام مدرک (مثلاً «کارت ملی» یا «سند مالکیت»)، یا سؤال‌تان درباره ساعات کاری، آدرس، مدارک لازم و زمان تحویل را بپرسید.'
                + (rcpConfig.phone ? `\nیا با شماره ${rcpConfig.phone} با همکارانم صحبت کنید.` : ''),
            chips: RCP_MAIN_CHIPS,
            unknown: true,
        };
    }
    if (!chips.size) ['ثبت سفارش', 'قیمت ترجمه'].forEach(c => chips.add(c));
    return { text: parts.join('\n\n'), chips: [...chips] };
}

/* ── intake flow ── */

const RCP_INTAKE_STEPS = ['name', 'phone', 'docs', 'lang', 'urgency', 'delivery', 'confirm'];

function rcpIntakePrompt(step) {
    const i = rcpChat.intake;
    switch (step) {
        case 'name':     return { text: 'برای ثبت سفارش، لطفاً نام و نام خانوادگی‌تان را بنویسید.', chips: ['انصراف'] };
        case 'phone':    return { text: `ممنون ${i.data.name} عزیز. شماره موبایل‌تان را وارد کنید (مثلاً ۰۹۱۲۱۲۳۴۵۶۷) تا همکارانم برای هماهنگی تماس بگیرند.`, chips: ['انصراف'] };
        case 'docs':     return { text: 'چه مدارکی را می‌خواهید ترجمه کنید؟ (مثلاً: «شناسنامه، کارت ملی و ۲ ترم ریزنمرات دانشگاه»)', chips: ['شناسنامه', 'پاسپورت', 'دیپلم', 'سند ازدواج'] };
        case 'lang':     return { text: 'به چه زبانی ترجمه شود؟', chips: ['انگلیسی', 'آلمانی', 'فرانسوی', 'ایتالیایی'] };
        case 'urgency':  return { text: `ترجمه عادی (${rcpFa(rcpConfig.normalDays)} روز کاری) یا فوری (${rcpFa(rcpConfig.urgentDays)} روز کاری)؟`, chips: ['عادی', 'فوری'] };
        case 'delivery': return rcpConfig.courier
            ? { text: 'مدارک را حضوری می‌آورید یا پیک بفرستیم؟', chips: ['حضوری', 'پیک'] }
            : null;
        case 'confirm': {
            const q = rcpQuoteText(i.data.docs, i.data.urgent);
            i.data.quote = q;
            return {
                text: `خلاصه سفارش:\n👤 ${i.data.name}\n📱 ${rcpFaTime(i.data.phone)}\n🌐 زبان: ${i.data.lang}\n⏱ ${i.data.urgent ? 'فوری' : 'عادی'}${i.data.delivery ? '\n🚚 ' + i.data.delivery : ''}\n\n${q.text}\n\nثبت شود؟`,
                chips: ['بله، ثبت کن', 'نه، انصراف'],
            };
        }
    }
    return null;
}

function rcpIntakeAdvance() {
    const i = rcpChat.intake;
    while (true) {
        const idx = RCP_INTAKE_STEPS.indexOf(i.step);
        i.step = RCP_INTAKE_STEPS[idx + 1];
        if (i.step === 'docs' && i.data.docs && i.data.docs.length) continue;
        if (i.step === 'lang' && i.data.lang) continue;
        if (i.step === 'delivery' && !rcpConfig.courier) continue;
        return rcpIntakePrompt(i.step);
    }
}

function rcpStartIntake(seedText) {
    rcpChat.intake = {
        step: 'name',
        data: {
            name: '', phone: '',
            docs: (rcpDetectDocs(seedText || '').length ? rcpDetectDocs(seedText) : (rcpChat.lastDocs || [])),
            lang: rcpDetectLang(seedText || ''),
            urgent: rcpHas(rcpNormalize(seedText || ''), ['فوری', 'عجله']),
            delivery: '',
        },
    };
    return rcpIntakePrompt('name');
}

function rcpLooksLikeQuestion(text, norm) {
    if (/[؟?]/.test(text)) return true;
    const i = rcpDetectIntents(text).filter(k => ['price', 'hours', 'address', 'reqs', 'time', 'contact', 'langs'].includes(k));
    return i.length > 0 && norm.split(' ').length >= 2;
}

function rcpHandleIntake(text) {
    const i = rcpChat.intake;
    const norm = rcpNormalize(text);

    if (rcpHas(norm, RCP_INTENTS.cancel) || (i.step === 'confirm' && rcpHas(norm, ['نه', 'خیر']))) {
        rcpChat.intake = null;
        return { text: 'باشه، سفارش ثبت نشد. اگر سؤال دیگری دارید در خدمتم.', chips: RCP_MAIN_CHIPS };
    }

    // A side question mid-intake: answer it, then repeat the pending question.
    if (i.step !== 'name' && i.step !== 'confirm' && rcpLooksLikeQuestion(text, norm) && i.step !== 'docs') {
        const ans = rcpAnswerQuestion(text);
        const re = rcpIntakePrompt(i.step);
        return { text: ans.text + '\n\n— ' + re.text, chips: re.chips };
    }

    switch (i.step) {
        case 'name': {
            const name = text.trim().replace(/^(من|اسمم|اسم من|نام من)\s+/, '').replace(/\s+(هستم|هست|است)$/, '').trim();
            if (name.length < 2 || name.length > 60 || /\d/.test(rcpNormalize(name))) {
                return { text: 'لطفاً نام و نام خانوادگی را بدون عدد بنویسید.', chips: ['انصراف'] };
            }
            i.data.name = name;
            return rcpIntakeAdvance();
        }
        case 'phone': {
            const digits = rcpSpokenDigits(text).replace(/^0098/, '0').replace(/^98(?=9)/, '0');
            const m = /^0?9\d{9}$/.exec(digits);
            if (!m) return { text: 'شماره موبایل معتبر نیست. لطفاً ۱۱ رقم و با ۰۹ شروع شود.', chips: ['انصراف'] };
            i.data.phone = digits.startsWith('0') ? digits : '0' + digits;
            return rcpIntakeAdvance();
        }
        case 'docs': {
            const docs = rcpDetectDocs(text);
            if (!docs.length) {
                // keep the free-text so staff can still price it by hand
                i.data.docsFreeText = text.trim();
                i.data.docs = [];
                const nxt = rcpIntakeAdvance();
                return { text: 'این مدرک را در نرخنامه پیدا نکردم؛ آن را یادداشت کردم تا همکار مترجم قیمت دقیق را اعلام کند.\n\n' + nxt.text, chips: nxt.chips };
            }
            i.data.docs = docs;
            const lang = rcpDetectLang(text);
            if (lang) i.data.lang = lang;
            return rcpIntakeAdvance();
        }
        case 'lang': {
            const lang = rcpDetectLang(text) || (text.trim().length <= 20 ? text.trim() : null);
            if (!lang) return rcpIntakePrompt('lang');
            i.data.lang = lang;
            return rcpIntakeAdvance();
        }
        case 'urgency': {
            i.data.urgent = rcpHas(norm, ['فوری', 'عجله', 'سریع']);
            return rcpIntakeAdvance();
        }
        case 'delivery': {
            i.data.delivery = rcpHas(norm, ['پیک', 'ارسال', 'بفرست']) ? 'ارسال/دریافت با پیک' : 'تحویل حضوری در دفتر';
            return rcpIntakeAdvance();
        }
        case 'confirm': {
            if (!rcpHas(norm, ['بله', 'آره', 'اره', 'ثبت', 'باشه', 'اوکی', 'ok', 'تایید', 'تأیید', 'درسته'])) {
                return { text: 'برای ثبت «بله» و برای لغو «انصراف» را بزنید.', chips: ['بله، ثبت کن', 'نه، انصراف'] };
            }
            const lead = rcpCreateLead(i.data);
            rcpChat.intake = null;
            const s = rcpOpenStatus();
            return {
                text: `✅ سفارش شما با کد پیگیری ${rcpFaTime(lead.code)} ثبت شد.\n`
                    + (s.openNow ? 'همکارانم به‌زودی با شما تماس می‌گیرند.' : `همکارانم در اولین ساعت کاری${s.next ? ' (' + s.next + ')' : ''} با شما تماس می‌گیرند.`)
                    + (rcpConfig.address && !String(i.data.delivery).includes('پیک') ? `\n📍 آدرس دفتر: ${rcpConfig.address}` : '')
                    + '\nلطفاً «اصل» مدارک را همراه داشته باشید.',
                chips: ['سؤال دیگری دارم'],
            };
        }
    }
    return rcpIntakePrompt(i.step);
}

function rcpLocalReply(text) {
    if (rcpChat.intake) return rcpHandleIntake(text);
    const intents = rcpDetectIntents(text);
    const norm = rcpNormalize(text);
    const wantsOrder = intents.includes('order') && !intents.includes('price')
        || rcpHas(norm, ['ثبت سفارش', 'ثبت درخواست', 'بله ثبت']);
    if (wantsOrder) return rcpStartIntake(text);
    return rcpAnswerQuestion(text);
}

/* ── optional server LLM ── */

async function rcpServerReply(text, local) {
    const s = rcpOpenStatus();
    const docs = rcpDetectDocs(text).map(d => {
        const e = rcpEstimateDoc(d);
        return { label: e.label, units: e.units, copies: e.copies, translation: e.translation, fees: e.fees, estimate: e.total, extra: e.extraNote };
    });
    const office = Object.assign({}, rcpConfig);
    delete office.aiBackend;
    const res = await fetch(`${CORE}/receptionist/reply`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            message: text,
            history: rcpChat.messages.slice(-12).map(m => ({ role: m.role === 'bot' ? 'assistant' : 'user', text: m.text })),
            office,
            grounding: { local_answer: local.text, documents: docs, open_now: s.openNow, today_hours: s.todayText },
        }),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const p = await res.json();
    if (!p || typeof p.reply !== 'string' || !p.reply.trim()) throw new Error('empty');
    return { text: p.reply.trim(), chips: local.chips };
}

/* ─────────────────────────── chat UI ─────────────────────────── */

function rcpResetChat(render = true) {
    rcpChat = { messages: [], intake: null, lastDocs: [] };
    rcpPushBot({ text: rcpGreetingText(), chips: RCP_MAIN_CHIPS });
    if (render) rcpRenderChat();
}

function rcpPushBot(r) {
    rcpChat.messages.push({ role: 'bot', text: r.text, chips: r.chips || [], time: Date.now() });
}

async function rcpSend(textArg) {
    const input = document.getElementById('rcp-input');
    const text = (textArg !== undefined ? textArg : (input ? input.value : '')).trim();
    if (!text) return;
    if (input && textArg === undefined) input.value = '';
    rcpChat.messages.push({ role: 'user', text, time: Date.now() });
    rcpRenderChat(true);

    const inIntake = !!rcpChat.intake;
    let reply = rcpLocalReply(text);
    if (rcpConfig.aiBackend && !inIntake && !rcpChat.intake) {
        try {
            reply = await rcpServerReply(text, reply);
        } catch (e) {
            if (!rcpAiFailedOnce) {
                rcpAiFailedOnce = true;
                showToast('مدل زبانی سرور در دسترس نیست؛ پاسخ‌ها از موتور داخلی است.', 3500);
            }
        }
    } else {
        await new Promise(r => setTimeout(r, 350));   // a short "typing" beat
    }
    rcpPushBot(reply);
    rcpRenderChat();
    if (rcpCall && rcpCall.active) rcpSpeak(reply.text);
    else rcpSpeakChat(reply.text);
}

function rcpRenderChat(typing = false) {
    const box = document.getElementById('rcp-messages');
    if (!box || !rcpChat) return;
    const last = rcpChat.messages[rcpChat.messages.length - 1];
    box.innerHTML = rcpChat.messages.map(m => `
        <div class="rcp-msg ${m.role === 'bot' ? 'rcp-msg-bot' : 'rcp-msg-user'}">
            <div class="rcp-bubble">${escapeHtml(m.text).replace(/\n/g, '<br>')}</div>
        </div>`).join('')
        + (typing ? '<div class="rcp-msg rcp-msg-bot"><div class="rcp-bubble rcp-typing"><span></span><span></span><span></span></div></div>' : '');
    const chipsEl = document.getElementById('rcp-chips');
    if (chipsEl) {
        const chips = (!typing && last && last.role === 'bot') ? (last.chips || []) : [];
        chipsEl.innerHTML = chips.map(c => `<button type="button" class="rcp-chip" data-chip="${escapeHtml(c)}">${escapeHtml(c)}</button>`).join('');
        chipsEl.querySelectorAll('.rcp-chip').forEach(b => b.addEventListener('click', () => rcpSend(b.dataset.chip)));
    }
    const head = document.getElementById('rcp-chat-title');
    if (head) head.textContent = `${rcpConfig.assistantName || 'منشی'} · ${rcpOfficeName()}`;
    const st = document.getElementById('rcp-chat-status');
    if (st) {
        const s = rcpOpenStatus();
        st.textContent = s.openNow ? '● دفتر باز است' : '● خارج از ساعت کاری';
        st.style.color = s.openNow ? '#22c55e' : '#f59e0b';
    }
    const ra = document.getElementById('rcp-read-aloud');
    if (ra) ra.textContent = rcpConfig.readAloud ? '🔊 خواندن پاسخ‌ها: روشن' : '🔈 خواندن پاسخ‌ها: خاموش';
    const eng = document.getElementById('rcp-engine-label');
    if (eng) eng.textContent = rcpConfig.aiBackend ? 'مدل زبانی سرور + موتور داخلی' : 'موتور داخلی (قیمت‌ها از نرخنامه شما)';
    box.scrollTop = box.scrollHeight;
}

/* ─────────────────────────── leads ─────────────────────────── */

function rcpCreateLead(data) {
    const code = Math.max(1000, ...rcpLeads.map(l => l.code || 0)) + 1;
    const lead = {
        id: 'lead-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        code,
        createdAt: new Date().toISOString(),
        status: 'new',
        source: (rcpCall && rcpCall.active) ? 'call' : 'chat',
        name: data.name,
        phone: data.phone,
        lang: data.lang || '',
        urgent: !!data.urgent,
        delivery: data.delivery || '',
        docs: (data.quote ? data.quote.estimates : []).map(e => ({ id: e.id, label: e.label, units: e.units, copies: e.copies, total: e.total })),
        docsFreeText: data.docsFreeText || '',
        estimate: data.quote ? data.quote.total : 0,
        notes: '',
        transcript: rcpChat.messages.slice(-30).map(m => ({ role: m.role, text: m.text })),
    };
    rcpLeads.unshift(lead);
    rcpSave();
    rcpUpdateBadge();
    return lead;
}

function rcpLeadSummary(l) {
    return [
        `درخواست ترجمه رسمی — کد ${rcpFaTime(l.code)}`,
        `نام: ${l.name}`,
        `موبایل: ${l.phone}`,
        `زبان: ${l.lang || '—'} | ${l.urgent ? 'فوری' : 'عادی'}${l.delivery ? ' | ' + l.delivery : ''}`,
        'مدارک:',
        ...(l.docs.length ? l.docs.map(d => `• ${d.label}${d.units > 1 ? ' (' + rcpFa(d.units) + ')' : ''}${d.copies > 1 ? ' × ' + rcpFa(d.copies) : ''} — ${rcpToman(d.total)}`) : []),
        ...(l.docsFreeText ? [`• (شرح مشتری) ${l.docsFreeText}`] : []),
        `برآورد: ${rcpToman(l.estimate)}`,
        ...(l.notes ? [`یادداشت: ${l.notes}`] : []),
    ].join('\n');
}

function rcpRenderLeads() {
    const list = document.getElementById('rcp-leads-list');
    if (!list) return;
    document.querySelectorAll('[data-rcp-filter]').forEach(b =>
        b.classList.toggle('rcp-tab-active', b.dataset.rcpFilter === rcpLeadFilter));
    const leads = rcpLeads.filter(l => rcpLeadFilter === 'all' || l.status === rcpLeadFilter);
    if (!leads.length) {
        list.innerHTML = `<div class="workspace-panel p-8 text-center text-sm" style="color:var(--text-muted);">
            ${rcpLeads.length ? 'درخواستی با این وضعیت وجود ندارد.' : 'هنوز درخواستی ثبت نشده. در «گفتگوی آزمایشی» یک سفارش ثبت کنید تا اینجا ببینید.'}</div>`;
        return;
    }
    list.innerHTML = leads.map(l => {
        const st = RCP_LEAD_STATUSES[l.status] || RCP_LEAD_STATUSES.new;
        const date = new Date(l.createdAt).toLocaleString('fa-IR', { timeZone: 'Asia/Tehran', dateStyle: 'medium', timeStyle: 'short' });
        const wa = l.phone ? 'https://wa.me/98' + l.phone.replace(/^0/, '') : '';
        const docs = l.docs.map(d => `<li>${escapeHtml(d.label)}${d.units > 1 ? ' · ' + rcpFa(d.units) : ''}${d.copies > 1 ? ' × ' + rcpFa(d.copies) : ''} <span style="color:var(--text-muted);">— ${rcpToman(d.total)}</span></li>`).join('')
            + (l.docsFreeText ? `<li style="color:var(--text-muted);">شرح مشتری: ${escapeHtml(l.docsFreeText)}</li>` : '');
        return `
        <div class="workspace-panel p-5" data-lead="${l.id}">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div class="flex items-center gap-2 flex-wrap">
                <span class="font-black" style="color:var(--text-main);">${escapeHtml(l.name)}</span>
                <span class="text-[11px] font-bold px-2 py-0.5 rounded-full" style="background:${st.color}22;color:${st.color};">${st.label}</span>
                <span class="text-[11px] font-bold px-2 py-0.5 rounded-full" style="background:var(--card-surface);color:var(--text-muted);border:1px solid var(--border-subtle);">${l.source === 'call' ? '📞 تماس' : '💬 گفتگو'}</span>
                ${l.urgent ? '<span class="text-[11px] font-bold px-2 py-0.5 rounded-full" style="background:#ef444422;color:#ef4444;">فوری</span>' : ''}
              </div>
              <div class="text-xs mt-1" style="color:var(--text-muted);">کد ${rcpFaTime(l.code)} · ${date} · <span dir="ltr">${escapeHtml(l.phone)}</span> · ${escapeHtml(l.lang || '—')}${l.delivery ? ' · ' + escapeHtml(l.delivery) : ''}</div>
            </div>
            <div class="text-left">
              <div class="text-[11px]" style="color:var(--text-muted);">برآورد</div>
              <div class="font-black" style="color:var(--accent);">${rcpToman(l.estimate)}</div>
            </div>
          </div>
          <ul class="text-sm mt-3 space-y-1 list-disc pr-5" style="color:var(--text-main);">${docs || '<li style="color:var(--text-muted);">—</li>'}</ul>
          <textarea class="converter-input w-full mt-3 text-sm" rows="2" placeholder="یادداشت داخلی..." data-lead-notes="${l.id}">${escapeHtml(l.notes || '')}</textarea>
          <div class="flex flex-wrap items-center gap-2 mt-3">
            <select class="converter-input text-xs" data-lead-status="${l.id}" style="width:auto;">
              ${Object.entries(RCP_LEAD_STATUSES).map(([k, v]) => `<option value="${k}" ${k === l.status ? 'selected' : ''}>${v.label}</option>`).join('')}
            </select>
            <a href="tel:${escapeHtml(l.phone)}" class="rcp-btn">📞 تماس</a>
            ${wa ? `<a href="${wa}" target="_blank" rel="noopener" class="rcp-btn">💬 واتساپ</a>` : ''}
            <button type="button" class="rcp-btn" data-lead-copy="${l.id}">📋 کپی خلاصه</button>
            <button type="button" class="rcp-btn" data-lead-client="${l.id}">➕ ثبت مشتری</button>
            <button type="button" class="rcp-btn" data-lead-transcript="${l.id}">💭 گفتگو</button>
            <button type="button" class="rcp-btn" data-lead-delete="${l.id}" style="color:#f87171;">حذف</button>
          </div>
          <div class="hidden mt-3 rounded-xl p-3 text-xs space-y-1" data-lead-transcript-box="${l.id}" style="background:var(--bg-secondary);border:1px solid var(--border-subtle);">
            ${(l.transcript || []).map(m => `<div><b style="color:${m.role === 'bot' ? 'var(--accent)' : 'var(--text-main)'};">${m.role === 'bot' ? 'منشی' : 'مشتری'}:</b> <span style="color:var(--text-muted);">${escapeHtml(m.text).replace(/\n/g, '<br>')}</span></div>`).join('')}
          </div>
        </div>`;
    }).join('');

    const find = id => rcpLeads.find(l => l.id === id);
    list.querySelectorAll('[data-lead-status]').forEach(el => el.addEventListener('change', () => {
        const l = find(el.dataset.leadStatus); if (!l) return;
        l.status = el.value; rcpSave(); rcpUpdateBadge(); rcpRenderLeads();
    }));
    list.querySelectorAll('[data-lead-notes]').forEach(el => el.addEventListener('change', () => {
        const l = find(el.dataset.leadNotes); if (!l) return;
        l.notes = el.value; rcpSave(); showToast('یادداشت ذخیره شد.');
    }));
    list.querySelectorAll('[data-lead-copy]').forEach(el => el.addEventListener('click', async () => {
        const l = find(el.dataset.leadCopy); if (!l) return;
        try { await navigator.clipboard.writeText(rcpLeadSummary(l)); showToast('خلاصه کپی شد ✓'); }
        catch (e) { showToast('کپی ممکن نشد.'); }
    }));
    list.querySelectorAll('[data-lead-transcript]').forEach(el => el.addEventListener('click', () => {
        const box = list.querySelector(`[data-lead-transcript-box="${el.dataset.leadTranscript}"]`);
        if (box) box.classList.toggle('hidden');
    }));
    list.querySelectorAll('[data-lead-delete]').forEach(el => el.addEventListener('click', () => {
        if (!confirm('این درخواست حذف شود؟')) return;
        rcpLeads = rcpLeads.filter(l => l.id !== el.dataset.leadDelete);
        rcpSave(); rcpUpdateBadge(); rcpRenderLeads();
    }));
    list.querySelectorAll('[data-lead-client]').forEach(el => el.addEventListener('click', () => {
        const l = find(el.dataset.leadClient); if (!l) return;
        rcpLeadToClient(l);
    }));
}

// Opens the existing «افزودن مشتری» dialog prefilled from the lead. The
// dialog itself saves to DeepT-Core; the lead is marked converted here.
function rcpLeadToClient(l) {
    if (typeof openAddClientModal !== 'function') return;
    openAddClientModal();
    const parts = String(l.name || '').trim().split(/\s+/);
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    set('ac-first-fa', parts[0] || '');
    set('ac-last-fa', parts.slice(1).join(' '));
    set('ac-phone', l.phone || '');
    set('ac-notes', rcpLeadSummary(l));
    const langMap = { 'فرانسوی': 'French', 'ایتالیایی': 'Italian', 'اسپانیایی': 'Spanish' };
    const sel = document.getElementById('ac-target-lang');
    if (sel && langMap[l.lang]) sel.value = langMap[l.lang];
    l.status = 'converted';
    rcpSave(); rcpUpdateBadge(); rcpRenderLeads();
}

function rcpSetLeadFilter(f) {
    rcpLeadFilter = f;
    rcpRenderLeads();
}

/* ─────────────────────────── settings ─────────────────────────── */

function rcpRenderSettings() {
    const c = rcpConfig;
    const val = (id, v) => { const el = document.getElementById(id); if (el) { if (el.type === 'checkbox') el.checked = !!v; else el.value = v ?? ''; } };
    val('rcp-s-office', c.officeName);
    val('rcp-s-assistant', c.assistantName);
    val('rcp-s-greeting', c.greeting);
    val('rcp-s-phone', c.phone);
    val('rcp-s-whatsapp', c.whatsapp);
    val('rcp-s-address', c.address);
    val('rcp-s-map', c.mapUrl);
    val('rcp-s-langs', c.languages);
    val('rcp-s-normal', c.normalDays);
    val('rcp-s-urgent', c.urgentDays);
    val('rcp-s-urgent-pct', c.urgentSurchargePct);
    val('rcp-s-fee-justice', c.feeJustice);
    val('rcp-s-fee-foreign', c.feeForeign);
    val('rcp-s-fee-service', c.feeService);
    val('rcp-s-courier', c.courier);
    val('rcp-s-notes', c.extraNotes);
    val('rcp-s-ai', c.aiBackend);
    rcpRenderVoiceSettings();
    val('rcp-s-route-mode', c.routing.mode);
    val('rcp-s-route-ring', c.routing.ringSeconds);
    val('rcp-s-route-transfer', c.routing.transferTo);

    const hoursEl = document.getElementById('rcp-s-hours');
    if (hoursEl) {
        hoursEl.innerHTML = RCP_WEEKDAYS.map(d => {
            const h = c.hours[d.key] || {};
            return `<div class="flex items-center gap-2 flex-wrap">
                <label class="flex items-center gap-2 text-sm w-28" style="color:var(--text-main);"><input type="checkbox" data-h-open="${d.key}" ${h.open ? 'checked' : ''}> ${d.label}</label>
                <input type="time" class="converter-input text-xs" data-h-from="${d.key}" value="${h.from || ''}" style="width:7rem;" dir="ltr">
                <span class="text-xs" style="color:var(--text-muted);">تا</span>
                <input type="time" class="converter-input text-xs" data-h-to="${d.key}" value="${h.to || ''}" style="width:7rem;" dir="ltr">
            </div>`;
        }).join('');
    }
    rcpRenderFaqs();
}

function rcpRenderFaqs() {
    const el = document.getElementById('rcp-s-faqs');
    if (!el) return;
    el.innerHTML = (rcpConfig.faqs.length ? '' : '<p class="text-xs" style="color:var(--text-muted);">هنوز پرسشی اضافه نشده. مثلاً «پارکینگ دارید؟» یا «کارت‌خوان دارید؟»</p>')
        + rcpConfig.faqs.map((f, idx) => `
        <div class="grid gap-2 p-3 rounded-xl" style="border:1px solid var(--border-subtle);">
            <input class="converter-input text-sm" placeholder="پرسش" data-faq-q="${idx}" value="${escapeHtml(f.q || '')}">
            <textarea class="converter-input text-sm" rows="2" placeholder="پاسخ" data-faq-a="${idx}">${escapeHtml(f.a || '')}</textarea>
            <button type="button" class="rcp-btn justify-self-start" style="color:#f87171;" onclick="rcpRemoveFaq(${idx})">حذف</button>
        </div>`).join('');
}

function rcpCollectFaqs() {
    document.querySelectorAll('[data-faq-q]').forEach(el => { const f = rcpConfig.faqs[+el.dataset.faqQ]; if (f) f.q = el.value.trim(); });
    document.querySelectorAll('[data-faq-a]').forEach(el => { const f = rcpConfig.faqs[+el.dataset.faqA]; if (f) f.a = el.value.trim(); });
}

function rcpAddFaq() {
    rcpCollectFaqs();
    rcpConfig.faqs.push({ q: '', a: '' });
    rcpRenderFaqs();
}

function rcpRemoveFaq(idx) {
    rcpCollectFaqs();
    rcpConfig.faqs.splice(idx, 1);
    rcpRenderFaqs();
}

function rcpSaveSettings() {
    const g = id => document.getElementById(id);
    const num = (id, def, min, max) => { const n = parseInt(g(id).value, 10); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def; };
    const c = rcpConfig;
    c.officeName = g('rcp-s-office').value.trim();
    c.assistantName = g('rcp-s-assistant').value.trim() || 'منشی';
    c.greeting = g('rcp-s-greeting').value.trim();
    c.phone = g('rcp-s-phone').value.trim();
    c.whatsapp = g('rcp-s-whatsapp').value.trim();
    c.address = g('rcp-s-address').value.trim();
    c.mapUrl = g('rcp-s-map').value.trim();
    c.languages = g('rcp-s-langs').value.trim();
    c.normalDays = num('rcp-s-normal', 3, 0, 60);
    c.urgentDays = num('rcp-s-urgent', 1, 0, 60);
    c.urgentSurchargePct = num('rcp-s-urgent-pct', 50, 0, 300);
    c.feeJustice = g('rcp-s-fee-justice').checked;
    c.feeForeign = g('rcp-s-fee-foreign').checked;
    c.feeService = g('rcp-s-fee-service').checked;
    c.courier = g('rcp-s-courier').checked;
    c.extraNotes = g('rcp-s-notes').value.trim();
    c.aiBackend = g('rcp-s-ai').checked;
    c.voiceName = g('rcp-s-voice') ? g('rcp-s-voice').value : '';
    c.routing = {
        mode: ['after_hours', 'no_answer', 'always'].includes(g('rcp-s-route-mode').value) ? g('rcp-s-route-mode').value : 'no_answer',
        ringSeconds: num('rcp-s-route-ring', 20, 5, 120),
        transferTo: g('rcp-s-route-transfer').value.trim(),
    };
    RCP_WEEKDAYS.forEach(d => {
        c.hours[d.key] = {
            open: document.querySelector(`[data-h-open="${d.key}"]`).checked,
            from: document.querySelector(`[data-h-from="${d.key}"]`).value,
            to: document.querySelector(`[data-h-to="${d.key}"]`).value,
        };
    });
    rcpCollectFaqs();
    c.faqs = c.faqs.filter(f => f.q && f.a);
    rcpAiFailedOnce = false;
    if (rcpSave()) {
        showToast('✅ تنظیمات منشی ذخیره شد.');
        rcpRenderFaqs();
        rcpResetChat(false);   // greeting/name may have changed
    }
}

/* ═══════════════════════════ phone calls ═══════════════════════════
   Answering calls is the receptionist's main job. In the browser this is
   a hands-free voice call: Web Speech API recognition (fa-IR) in,
   speechSynthesis out, same engine and intake flow as the chat, so a
   call can end with a filed درخواست. Every call goes into the call log
   (duration, outcome, transcript).

   Spoken phone numbers ("صفر نهصد و دوازده سیصد و چهل و پنج ...") are
   turned back into digits by rcpSpokenDigits().

   How an Iranian office landline (مخابرات, analog) gets routed to this
   agent -- FXO gateway vs. دایورت to a VoIP number vs. IP PBX, Asterisk
   ARI/ExternalMedia bridge, routing policy, Persian STT/TTS choices under
   sanctions -- is designed in docs/receptionist-telephony.md.

   Connecting the office's REAL phone line has to happen server-side
   (DeepT-Core): a telephony bridge (Asterisk/Issabel AGI, or a cloud
   PBX webhook) streams caller audio to STT, posts each caller turn to
   POST /receptionist/reply (same payload as rcpServerReply()), plays the
   reply with TTS, and on hang-up posts the call to
       POST /receptionist/calls  {started_at, seconds, caller_number,
                                  lead:{...} | null, transcript:[...],
                                  transferred_to: "..." | null}
   With "پاسخ با مدل زبانی سرور" on, this page also reads
       GET  /receptionist/calls  -> [{...same shape...}]
   and lists those calls (marked «خط تلفن») beside the browser ones.
   ═══════════════════════════════════════════════════════════════════ */

const RCP_SPOKEN = {
    'صفر': 0, 'یک': 1, 'یه': 1, 'دو': 2, 'سه': 3, 'چهار': 4, 'پنج': 5, 'شش': 6, 'شیش': 6, 'هفت': 7, 'هشت': 8, 'نه': 9,
    'ده': 10, 'یازده': 11, 'دوازده': 12, 'سیزده': 13, 'چهارده': 14, 'پانزده': 15, 'پونزده': 15, 'شانزده': 16, 'شونزده': 16,
    'هفده': 17, 'هجده': 18, 'هیجده': 18, 'نوزده': 19,
    'بیست': 20, 'سی': 30, 'چهل': 40, 'پنجاه': 50, 'شصت': 60, 'هفتاد': 70, 'هشتاد': 80, 'نود': 90,
    'صد': 100, 'یکصد': 100, 'دویست': 200, 'سیصد': 300, 'چهارصد': 400, 'پانصد': 500, 'پونصد': 500,
    'ششصد': 600, 'شیشصد': 600, 'هفتصد': 700, 'هشتصد': 800, 'نهصد': 900,
};

// "صفر نهصد و دوازده سیصد و چهل و پنج شصت و هفت هشتاد و نه" → "09123456789".
// Words joined by «و» form one number (900+12); words without «و» are
// separate groups ("نه یک دو" → "912"). Digit tokens pass through.
function rcpSpokenDigits(text) {
    const toks = rcpNormalize(text).replace(/(\d)\s+(?=\d)/g, '$1').split(' ');
    let out = '', cur = null, and = false;
    const flush = () => { if (cur !== null) { out += String(cur); cur = null; } };
    const room = n => (n >= 100 && n % 100 === 0) ? 100 : (n >= 20 && n % 10 === 0) ? 10 : 1;
    for (const t of toks) {
        if (/^\d+$/.test(t)) { flush(); out += t; and = false; continue; }
        if (t === 'و') { and = cur !== null; continue; }
        const v = RCP_SPOKEN[t];
        if (v === undefined) { flush(); and = false; continue; }
        if (and && cur !== null && v < room(cur)) cur += v; else { flush(); cur = v; }
        and = false;
    }
    flush();
    return out;
}

function rcpSpeechText(text) {
    return String(text || '')
        .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/gu, '')
        .replace(/[•—]/g, ' ')
        .replace(/×/g, ' ضرب در ')
        .replace(/٪/g, ' درصد')
        .replace(/\n+/g, '. ')
        .replace(/\s+/g, ' ')
        .trim();
}

// Persian voices are rare: Windows has none built in, and desktop Chrome
// adds none. Microsoft Edge exposes online Persian voices (e.g. "Dilara",
// "Farid"); Android Chrome uses the phone's Google TTS, which can download
// Persian. Settings → «صدای منشی» lists what this browser actually has.
function rcpVoices() {
    return ('speechSynthesis' in window) ? speechSynthesis.getVoices() : [];
}

function rcpPersianVoice() {
    const voices = rcpVoices();
    if (rcpConfig && rcpConfig.voiceName) {
        const chosen = voices.find(v => v.name === rcpConfig.voiceName);
        if (chosen) return chosen;
    }
    return voices.find(v => /^fa/i.test(v.lang)) || null;
}

function rcpRenderVoiceSettings() {
    const sel = document.getElementById('rcp-s-voice');
    const status = document.getElementById('rcp-s-voice-status');
    if (!sel || !status) return;
    if (!('speechSynthesis' in window)) {
        sel.innerHTML = '';
        status.innerHTML = '❌ این مرورگر اصلاً از خواندن متن با صدا پشتیبانی نمی‌کند.';
        return;
    }
    const voices = rcpVoices();
    const fa = voices.filter(v => /^fa/i.test(v.lang));
    const label = v => `${v.name} (${v.lang})${v.localService ? '' : ' · آنلاین'}`;
    sel.innerHTML = '<option value="">خودکار: اولین صدای فارسی</option>'
        + (fa.length ? '<optgroup label="فارسی">' + fa.map(v => `<option value="${escapeHtml(v.name)}">${escapeHtml(label(v))}</option>`).join('') + '</optgroup>' : '')
        + '<optgroup label="سایر صداها (فارسی را درست نمی‌خوانند)">' + voices.filter(v => !fa.includes(v)).map(v => `<option value="${escapeHtml(v.name)}">${escapeHtml(label(v))}</option>`).join('') + '</optgroup>';
    sel.value = rcpConfig.voiceName && voices.some(v => v.name === rcpConfig.voiceName) ? rcpConfig.voiceName : '';
    if (!voices.length) {
        status.innerHTML = '⏳ فهرست صداها هنوز بارگذاری نشده؛ چند ثانیه بعد دوباره این بخش را باز کنید.';
    } else if (fa.length) {
        status.innerHTML = `✅ ${rcpFa(fa.length)} صدای فارسی پیدا شد. «آزمایش صدا» را بزنید.`;
    } else {
        status.innerHTML = `⚠️ در این مرورگر <b>هیچ صدای فارسی</b> نیست (${rcpFa(voices.length)} صدای غیرفارسی موجود است)، به همین دلیل منشی بی‌صداست.<br>`
            + 'راه‌حل: همین صفحه را در <b>Microsoft Edge</b> باز کنید (صداهای آنلاین فارسی دارد)، یا روی گوشی اندروید در Chrome امتحان کنید. '
            + 'برای خط تلفن واقعی، صدا را سرور با یک سرویس تبدیل متن به گفتار فارسی تولید می‌کند و به مرورگر وابسته نیست.';
    }
}

function rcpTestVoice() {
    if (!('speechSynthesis' in window)) { showToast('این مرورگر صدا ندارد.'); return; }
    const sel = document.getElementById('rcp-s-voice');
    const voices = rcpVoices();
    const v = (sel && sel.value && voices.find(x => x.name === sel.value)) || voices.find(x => /^fa/i.test(x.lang));
    if (!v) { showToast('صدای فارسی در این مرورگر نیست؛ Edge را امتحان کنید.', 4000); }
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(`سلام، وقت بخیر. من ${rcpConfig.assistantName || 'منشی'} هستم، منشی هوشمند ${rcpOfficeName()}. ترجمه شناسنامه حدود سیصد و ده هزار تومان است.`);
    u.lang = 'fa-IR';
    if (v) u.voice = v;
    u.onerror = e => showToast('خطای پخش صدا: ' + (e.error || 'نامشخص'), 4000);
    speechSynthesis.speak(u);
}

// Typed-chat read-aloud (call mode always speaks).
function rcpSpeakChat(text) {
    if (!rcpConfig.readAloud || !('speechSynthesis' in window)) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(rcpSpeechText(text));
    u.lang = 'fa-IR';
    const v = rcpPersianVoice();
    if (v) u.voice = v;
    speechSynthesis.speak(u);
}

function rcpToggleReadAloud() {
    rcpConfig.readAloud = !rcpConfig.readAloud;
    rcpSave();
    if (!rcpConfig.readAloud && 'speechSynthesis' in window) speechSynthesis.cancel();
    rcpRenderChat();
    if (rcpConfig.readAloud && !rcpPersianVoice()) showToast('صدای فارسی در این مرورگر نیست؛ تنظیمات منشی → صدای منشی را ببینید.', 4500);
}

function rcpSpeak(text) {
    if (!rcpCall || !rcpCall.active) return;
    rcpStopListening();
    if (!('speechSynthesis' in window) || rcpCall.muted) { rcpAfterSpeak(); return; }
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(rcpSpeechText(text));
    u.lang = 'fa-IR';
    const v = rcpPersianVoice();
    if (v) u.voice = v;
    u.rate = 1;
    // Chrome sometimes never fires onend on long utterances -- a safety
    // timer (~speaking time + slack) keeps the call from stalling.
    let done = false;
    const finish = () => { if (done) return; done = true; clearTimeout(guard); rcpAfterSpeak(); };
    const guard = setTimeout(finish, 4000 + u.text.length * 90);
    u.onend = u.onerror = finish;
    rcpCall.speaking = true;
    rcpRenderCallPanel();
    try { speechSynthesis.speak(u); } catch (e) { finish(); }
}

function rcpAfterSpeak() {
    if (!rcpCall || !rcpCall.active) return;
    rcpCall.speaking = false;
    if (rcpCall.hangupAfterSpeak) { rcpEndCall(); return; }
    rcpStartListening();
}

function rcpStartListening() {
    if (!rcpCall || !rcpCall.active || !rcpCall.recog || rcpCall.listening || rcpCall.speaking || rcpCall.busy) { rcpRenderCallPanel(); return; }
    try { rcpCall.recog.start(); rcpCall.listening = true; } catch (e) { /* already started */ }
    rcpRenderCallPanel();
}

function rcpStopListening() {
    if (!rcpCall || !rcpCall.recog) return;
    try { rcpCall.recog.abort(); } catch (e) {}
    rcpCall.listening = false;
}

function rcpPhoneGreeting() {
    const s = rcpOpenStatus();
    return `${rcpOfficeName()}، سلام وقت‌تان بخیر. ${rcpConfig.assistantName || 'منشی'} هستم، منشی هوشمند دفتر.`
        + (s.openNow ? '' : ' الان خارج از ساعت کاری هستیم، ولی من می‌توانم سؤال‌تان را جواب بدهم یا سفارش‌تان را ثبت کنم.')
        + ' بفرمایید، در خدمتم.';
}

function rcpStartCall() {
    if (rcpCall && rcpCall.active) return;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    rcpResetChat(false);
    rcpChat.messages = [];
    rcpCall = {
        active: true, startedAt: Date.now(), recog: null, listening: false, speaking: false,
        busy: false, muted: false, silence: 0, leadCode: null, hangupAfterSpeak: false, interim: '',
    };
    if (SR) {
        const r = new SR();
        r.lang = 'fa-IR';
        r.interimResults = true;
        r.continuous = false;
        r.maxAlternatives = 1;
        r.onresult = ev => {
            let finalText = '', interim = '';
            for (let i = ev.resultIndex; i < ev.results.length; i++) {
                if (ev.results[i].isFinal) finalText += ev.results[i][0].transcript;
                else interim += ev.results[i][0].transcript;
            }
            rcpCall.interim = interim;
            rcpRenderCallPanel();
            if (finalText.trim()) {
                rcpCall.silence = 0;
                rcpCall.interim = '';
                rcpCallTurn(finalText.trim());
            }
        };
        r.onerror = ev => {
            if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') {
                showToast('دسترسی به میکروفون داده نشد؛ می‌توانید پاسخ‌ها را تایپ کنید.', 4000);
                rcpCall.recog = null;
            } else if (ev.error === 'no-speech') {
                rcpCall.silence++;
            }
        };
        r.onend = () => {
            if (!rcpCall || !rcpCall.active) return;
            rcpCall.listening = false;
            if (rcpCall.busy || rcpCall.speaking) return;
            if (rcpCall.silence >= 4) {
                rcpPushBot({ text: 'صدایی نمی‌شنوم. اگر قطع شد، دوباره تماس بگیرید. خدانگهدار.' });
                rcpCall.hangupAfterSpeak = true;
                rcpRenderChat();
                rcpSpeak(rcpChat.messages[rcpChat.messages.length - 1].text);
                return;
            }
            if (rcpCall.silence === 2) {
                rcpCall.silence++;
                rcpPushBot({ text: 'الو؟ صدای من را دارید؟' });
                rcpRenderChat();
                rcpSpeak('الو؟ صدای من را دارید؟');
                return;
            }
            rcpStartListening();
        };
        rcpCall.recog = r;
    } else {
        showToast('این مرورگر تشخیص گفتار ندارد (Chrome یا Edge را امتحان کنید). پاسخ‌ها را تایپ کنید.', 4500);
    }
    if (!rcpPersianVoice()) {
        // voices load async in Chrome; re-check shortly
        setTimeout(rcpRenderCallPanel, 800);
    }
    clearInterval(rcpCall.timer);
    rcpCall.timer = setInterval(rcpRenderCallPanel, 1000);
    const greet = rcpPhoneGreeting();
    rcpPushBot({ text: greet, chips: RCP_MAIN_CHIPS });
    rcpRenderChat();
    rcpRenderCallPanel();
    rcpSpeak(greet);
}

async function rcpCallTurn(text) {
    if (!rcpCall || !rcpCall.active) return;
    rcpStopListening();
    rcpCall.busy = true;
    rcpRenderCallPanel();
    const norm = rcpNormalize(text);
    if (!rcpChat.intake && rcpHas(norm, ['خداحافظ', 'خدانگهدار', 'قطع می کنم', 'فعلا', 'بای'])) {
        rcpChat.messages.push({ role: 'user', text, time: Date.now() });
        rcpPushBot({ text: `ممنون از تماس‌تان با ${rcpOfficeName()}. روز خوبی داشته باشید، خدانگهدار.` });
        rcpCall.hangupAfterSpeak = true;
        rcpCall.busy = false;
        rcpRenderChat();
        rcpSpeak(rcpChat.messages[rcpChat.messages.length - 1].text);
        return;
    }
    await rcpSend(text);           // pushes reply, renders, and speaks it
    if (rcpCall) rcpCall.busy = false;
}

function rcpToggleMute() {
    if (!rcpCall) return;
    rcpCall.muted = !rcpCall.muted;
    if (rcpCall.muted && 'speechSynthesis' in window) speechSynthesis.cancel();
    rcpRenderCallPanel();
}

function rcpEndCall() {
    if (!rcpCall || !rcpCall.active) return;
    rcpCall.active = false;
    clearInterval(rcpCall.timer);
    rcpStopListening();
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    const seconds = Math.round((Date.now() - rcpCall.startedAt) / 1000);
    const userTurns = rcpChat.messages.filter(m => m.role === 'user').length;
    rcpCalls.unshift({
        id: 'call-' + Date.now().toString(36),
        startedAt: new Date(rcpCall.startedAt).toISOString(),
        seconds,
        afterHours: !rcpOpenStatusAt(rcpCall.startedAt),
        leadCode: rcpCall.leadCode,
        outcome: rcpCall.leadCode ? 'order' : (userTurns ? 'answered' : 'silent'),
        transcript: rcpChat.messages.map(m => ({ role: m.role, text: m.text })),
    });
    rcpSave();
    const lead = rcpCall.leadCode;
    rcpCall = null;
    rcpChat.intake = null;
    rcpRenderCallPanel();
    rcpRenderChat();
    showToast(lead ? `تماس پایان یافت — سفارش ${rcpFaTime(lead)} ثبت شد.` : 'تماس پایان یافت و در «تماس‌ها» ثبت شد.');
}

// Open-at-time check for the call log (start time of the call).
function rcpOpenStatusAt(ts) {
    const d = new Date(ts);
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tehran', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d);
    const get = t => (parts.find(p => p.type === t) || {}).value;
    const jsDay = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
    const mins = (parseInt(get('hour'), 10) % 24) * 60 + parseInt(get('minute'), 10);
    const day = RCP_WEEKDAYS.find(x => x.js === jsDay);
    const h = rcpConfig.hours[day.key] || {};
    const f = rcpToMinutes(h.from), t = rcpToMinutes(h.to);
    return !!(h.open && f !== null && t !== null && mins >= f && mins < t);
}

function rcpDuration(sec) {
    const m = Math.floor(sec / 60), s = sec % 60;
    return rcpFaTime(`${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`);
}

function rcpRenderCallPanel() {
    const panel = document.getElementById('rcp-call-panel');
    const startBtn = document.getElementById('rcp-call-start');
    if (!panel || !startBtn) return;
    const live = !!(rcpCall && rcpCall.active);
    panel.classList.toggle('hidden', !live);
    startBtn.classList.toggle('hidden', live);
    if (!live) return;
    document.getElementById('rcp-call-timer').textContent = rcpDuration(Math.round((Date.now() - rcpCall.startedAt) / 1000));
    let state = 'در انتظار...';
    if (rcpCall.speaking) state = '🔊 منشی در حال صحبت';
    else if (rcpCall.busy) state = '… در حال پاسخ';
    else if (rcpCall.listening) state = '🎙 در حال شنیدن' + (rcpCall.interim ? ': «' + rcpCall.interim + '»' : '');
    else if (!rcpCall.recog) state = '⌨️ میکروفون در دسترس نیست — پاسخ را تایپ کنید';
    document.getElementById('rcp-call-state').textContent = state;
    document.getElementById('rcp-call-mute').textContent = rcpCall.muted ? '🔈 صدای منشی: خاموش' : '🔊 صدای منشی: روشن';
    const vn = document.getElementById('rcp-call-voice-note');
    if (vn) vn.classList.toggle('hidden', !!rcpPersianVoice() || rcpCall.muted);
}

async function rcpFetchLineCalls() {
    if (!rcpConfig.aiBackend) return [];
    try {
        const res = await fetch(`${CORE}/receptionist/calls`, { headers: { 'Authorization': `Bearer ${getToken()}` } });
        if (!res.ok) return [];
        const rows = await res.json();
        return (Array.isArray(rows) ? rows : []).map(r => ({
            id: 'line-' + (r.id || r.started_at),
            line: true,
            caller: r.caller_number || '',
            startedAt: r.started_at,
            seconds: r.seconds || 0,
            afterHours: !rcpOpenStatusAt(r.started_at),
            leadCode: r.lead && r.lead.code,
            outcome: r.lead ? 'order' : ((r.transcript || []).length ? 'answered' : 'silent'),
            transcript: (r.transcript || []).map(m => ({ role: m.role === 'assistant' ? 'bot' : (m.role || 'user'), text: m.text || '' })),
        }));
    } catch (e) { return []; }
}

async function rcpRenderCalls() {
    const list = document.getElementById('rcp-calls-list');
    const stats = document.getElementById('rcp-calls-stats');
    if (!list) return;
    const line = await rcpFetchLineCalls();
    const calls = [...line, ...rcpCalls].sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
    const n = calls.length;
    const orders = calls.filter(c => c.outcome === 'order').length;
    const after = calls.filter(c => c.afterHours).length;
    const avg = n ? Math.round(calls.reduce((s, c) => s + c.seconds, 0) / n) : 0;
    if (stats) {
        const tile = (label, value) => `<div class="workspace-panel p-4"><div class="text-[11px] font-bold" style="color:var(--text-muted);">${label}</div><div class="text-xl font-black mt-1" style="color:var(--text-main);">${value}</div></div>`;
        stats.innerHTML = tile('کل تماس‌ها', rcpFa(n))
            + tile('منجر به سفارش', n ? `${rcpFa(orders)} <span class="text-xs" style="color:var(--accent);">(${rcpFa(Math.round(orders * 100 / n))}٪)</span>` : '۰')
            + tile('خارج از ساعت کاری', rcpFa(after))
            + tile('میانگین مدت', rcpDuration(avg));
    }
    if (!n) {
        list.innerHTML = '<div class="workspace-panel p-8 text-center text-sm" style="color:var(--text-muted);">هنوز تماسی ثبت نشده. در «گفتگوی آزمایشی» دکمهٔ «شبیه‌سازی تماس ورودی» را بزنید.</div>';
        return;
    }
    const OUT = { order: ['سفارش ثبت شد', '#22c55e'], answered: ['پاسخ داده شد', '#22d3ee'], silent: ['بدون گفتگو', '#9ca3af'] };
    list.innerHTML = calls.map(c => {
        const [olabel, ocolor] = OUT[c.outcome] || OUT.answered;
        const date = new Date(c.startedAt).toLocaleString('fa-IR', { timeZone: 'Asia/Tehran', dateStyle: 'medium', timeStyle: 'short' });
        return `<div class="workspace-panel p-4">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="flex items-center gap-2 flex-wrap text-sm">
              <span class="font-bold" style="color:var(--text-main);">${c.line ? '☎️ خط تلفن' : '📞 تماس (مرورگر)'}</span>
              ${c.caller ? `<span dir="ltr" class="text-xs" style="color:var(--text-muted);">${escapeHtml(c.caller)}</span>` : ''}
              <span class="text-[11px] font-bold px-2 py-0.5 rounded-full" style="background:${ocolor}22;color:${ocolor};">${olabel}${c.leadCode ? ' · کد ' + rcpFaTime(c.leadCode) : ''}</span>
              ${c.afterHours ? '<span class="text-[11px] font-bold px-2 py-0.5 rounded-full" style="background:#f59e0b22;color:#f59e0b;">خارج از ساعت</span>' : ''}
            </div>
            <div class="text-xs" style="color:var(--text-muted);">${date} · ${rcpDuration(c.seconds)}</div>
          </div>
          <details class="mt-2"><summary class="text-xs cursor-pointer" style="color:var(--accent);">متن گفتگو</summary>
            <div class="mt-2 rounded-xl p-3 text-xs space-y-1" style="background:var(--bg-secondary);border:1px solid var(--border-subtle);">
              ${c.transcript.map(m => `<div><b style="color:${m.role === 'bot' ? 'var(--accent)' : 'var(--text-main)'};">${m.role === 'bot' ? 'منشی' : 'تماس‌گیرنده'}:</b> <span style="color:var(--text-muted);">${escapeHtml(m.text).replace(/\n/g, '<br>')}</span></div>`).join('')}
            </div>
          </details>
        </div>`;
    }).join('');
}

if ('speechSynthesis' in window) speechSynthesis.onvoiceschanged = () => {
    rcpRenderCallPanel();
    if (rcpConfig && rcpActiveTab === 'settings') rcpRenderVoiceSettings();
};

// Leaving the page by any route (header nav, back button, logout) hides
// #receptionistPage -- end a live call then, so the mic doesn't stay open
// behind another view.
(function rcpWatchPageHidden() {
    const el = document.getElementById('receptionistPage');
    if (!el || typeof MutationObserver === 'undefined') return;
    new MutationObserver(() => {
        if (el.classList.contains('hidden') && rcpCall && rcpCall.active) rcpEndCall();
    }).observe(el, { attributes: true, attributeFilter: ['class'] });
})();
