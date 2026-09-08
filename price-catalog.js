/* ========================================================================
   price-catalog.js — Official DeepT translation tariff ("فهرست اسناد و حق
   الترجمه ترجمه رسمی"), transcribed from the price-sheet PDF.
   ------------------------------------------------------------------------
   Read-only reference data. A translator's own price overrides for the
   "نرخنامه من" settings section live server-side in pref_price_list
   (DeepT-Core /users/me/preferences) and are kept separately in app.js
   (myPriceListOverrides) -- this file only ever supplies the catalog's own
   defaults and is never itself written to.

   Each item:
     id    -> the tariff sheet's own row number (e.g. "56", or "9-1" for a
              lettered sub-item/addition under row 9) -- stable, used as
              the override key sent to the backend. Never reuse or renumber
              an id; that would silently repoint anyone's saved override.
     label -> Persian document name, as printed.
     base  -> flat/base price in Toman for the whole document.
     extra -> the official per-line/per-item/etc. addition for a document
              longer than the base assumes, or null if the price is flat
              with no such addition. This is reference info shown next to
              the editable base-price field -- never auto-multiplied into
              an invoice row (a translator adds it to the row's price by
              hand for however many extra lines the actual document has).
     unit  -> Persian label for what `extra` is charged per (e.g. "هر
              سطر"), or null when extra is null.
     addition -> true for a lettered sub-item that is only ever an add-on
              to its parent row (e.g. "9-1"), never invoiced on its own.
   ======================================================================== */
const PRICE_CATALOG = [
  { category: "احکام کارگزینی و حقوق و دستمزد", items: [
    { id: "1", label: "حکم اعضای هیئت علمی", base: 391680, extra: 10000, unit: "هر سطر" },
    { id: "2", label: "حکم کارگزینی", base: 391680, extra: 10000, unit: "هر سطر" },
    { id: "3", label: "حکم افزایش حقوق (کارمند/بازنشسته)", base: 391680, extra: 10000, unit: "هر سطر" },
    { id: "4", label: "حکم بازنشستگی", base: 179250, extra: 10000, unit: "هر سطر" },
    { id: "5", label: "حکم مستمری وظیفه‌بگیر", base: 179250, extra: 10000, unit: "هر سطر" },
    { id: "6", label: "فیش حقوقی", base: 265200, extra: 5000, unit: "هر آیتم" },
    { id: "7", label: "فیش مستمری", base: 179250, extra: 2500, unit: "هر سطر" },
    { id: "8", label: "برگه مرخصی", base: 195840, extra: null, unit: null },
  ]},
  { category: "احوال شخصیه و اسناد سجلی", items: [
    { id: "9", label: "شناسنامه", base: 171360, extra: null, unit: null },
    { id: "9-1", label: "وقایع شناسنامه (ازدواج، طلاق یا فوت همسر، مشخصات هریک از فرزندان، فوت)", base: 25000, extra: null, unit: null, addition: true },
    { id: "10", label: "پروانه زناشویی (برگه موقت)", base: 293760, extra: null, unit: null },
    { id: "11", label: "سند ازدواج یا رونوشت آن", base: 477360, extra: 10000, unit: "هر سطر توضیحات، مهریه، شهود و معرفین" },
    { id: "12", label: "سند طلاق (دفترچه) (هر صفحه)", base: 550800, extra: 20000, unit: "هر سطر توضیحات، مهریه، شهود و معرفین" },
    { id: "13", label: "طلاق نامه (ورقه) (هر صفحه)", base: 550800, extra: 20000, unit: "هر سطر توضیحات، مهریه، شهود و معرفین" },
    { id: "14", label: "کارت ملی", base: 146880, extra: null, unit: null },
    { id: "15", label: "نکاح خط (مخصوص اتباع افغانی)", base: 700000, extra: 20000, unit: "هر سطر توضیحات، مهریه، شهود و معرفین" },
  ]},
  { category: "اسناد بانکی", items: [
    { id: "16", label: "گواهی‌های بانکی (موجودی، سپرده، تمکن مالی و غیره) (هر صفحه)", base: 265200, extra: 15000, unit: "هر سطر" },
    { id: "17", label: "پرینت بانکی (هر صفحه)", base: 269280, extra: 15000, unit: "هر سطر" },
    { id: "18", label: "گواهی عدم پرداخت چک", base: 265200, extra: 15000, unit: "هر سطر" },
    { id: "19", label: "واخواست‌نامه", base: 265200, extra: 15000, unit: "هر سطر" },
  ]},
  { category: "اسناد بیمه", items: [
    { id: "20", label: "گواهی بیمه اتومبیل و بیمه شخص ثالث (هر صفحه)", base: 359040, extra: 10000, unit: "هر سطر" },
    { id: "21", label: "بیمه‌نامه اتومبیل و سایر وسائط نقلیه (هر صفحه)", base: 354960, extra: 20000, unit: "هر خط" },
    { id: "22", label: "قرارداد بیمه آتش‌سوزی و حوادث ساختمان (هر صفحه)", base: 354960, extra: 20000, unit: "هر سطر" },
    { id: "23", label: "دفترچه بیمه", base: 204000, extra: null, unit: null },
    { id: "24", label: "سابقه بیمه با ریز دستمزد (هر صفحه)", base: 277440, extra: 15000, unit: "هر سطر" },
    { id: "25", label: "برگ سابقه بیمه تأمین اجتماعی (هر صفحه)", base: 277440, extra: 15000, unit: "هر ردیف" },
    { id: "26", label: "لیست بیمه کارکنان (هر صفحه)", base: 265200, extra: 6000, unit: "هر سطر" },
  ]},
  { category: "اسناد پزشکی", items: [
    { id: "27", label: "گزارش پزشکی و بیمارستانی", base: 354960, extra: 15000, unit: "هر سطر" },
    { id: "28", label: "برگ آزمایش پزشکی", base: 244800, extra: 15000, unit: "هر سطر" },
    { id: "29", label: "پروانه مطب پزشک", base: 293760, extra: null, unit: null },
    { id: "30", label: "پروانه دائم پزشکی", base: 277440, extra: null, unit: null },
    { id: "31", label: "پروانه مسئولیت فنی داروخانه، آزمایشگاه، دامپزشکی و غیره", base: 393760, extra: null, unit: null },
    { id: "32", label: "جواز تأسیس داروخانه", base: 465120, extra: null, unit: null },
    { id: "33", label: "جواز دفن", base: 265200, extra: 12240, unit: "هر سطر" },
    { id: "34", label: "کارت واکسیناسیون", base: 179250, extra: 15000, unit: "هر آیتم" },
    { id: "35", label: "گزارش پزشکی قانونی", base: 354960, extra: 15000, unit: "هر سطر" },
    { id: "36", label: "گواهی سلامت دانش‌آموز (شناسنامه سلامت)", base: 354960, extra: 15000, unit: "هر سطر" },
  ]},
  { category: "اسناد تجاری - شرکت", items: [
    { id: "37", label: "اساسنامه شرکت‌ها و سازمان‌ها (هر صفحه)", base: 265200, extra: 15000, unit: "هر سطر" },
    { id: "38", label: "ترازنامه یا سایر صورت‌های مالی (سود و زیان، گردش وجه نقد و غیره) (هر صفحه)", base: 408000, extra: 20000, unit: "هر سطر جدول" },
    // Two-part addition in the source (۲۰،۰۰۰ هر سطر + ۵،۰۰۰ هر آیتم جدول) --
    // `extra` carries the per-line figure; the per-table-item figure is
    // noted here since the {base, extra, unit} shape only fits one.
    { id: "39", label: "گزارش حسابرسی (هر صفحه)", base: 408000, extra: 20000, unit: "هر سطر (+ ۵٬۰۰۰ هر آیتم جدول)" },
    { id: "40", label: "اظهارنامه، تقاضای ثبت شرکت، شرکت‌نامه (پشت و رو)", base: 685440, extra: null, unit: null },
    { id: "41", label: "اوراق سهام", base: 293760, extra: null, unit: null },
    { id: "42", label: "اوراق مشارکت و اوراق قرضه", base: 293760, extra: null, unit: null },
    { id: "43", label: "روزنامه رسمی، آگهی تغییرات و تصمیمات", base: 236640, extra: 10000, unit: "هر سطر" },
    { id: "44", label: "روزنامه رسمی، آگهی تأسیس", base: 354960, extra: 10000, unit: "هر سطر" },
    { id: "45", label: "گواهی سهام (سهم‌الشرکه)", base: 293760, extra: null, unit: null },
    { id: "46", label: "معرفی‌نامه نماینده شرکت", base: 293760, extra: null, unit: null },
  ]},
  { category: "اسناد تجاری - گمرکی", items: [
    { id: "47", label: "بارنامه گمرکی (اسناد صادرات و واردات، دریایی، هوایی، زمینی، فیاتا و غیره) (هر صفحه)", base: 497760, extra: 25000, unit: "هر ردیف، توضیحات، جدول" },
    { id: "48", label: "برگ سبز گمرکی (هر صفحه)", base: 462400, extra: 15000, unit: "هر سطر" },
    { id: "48-1", label: "هر ظهرنویسی و مهر", base: 30000, extra: null, unit: null, addition: true },
    { id: "49", label: "دفترچه ترانزیت (هر صفحه)", base: 367200, extra: 20000, unit: "هر مهر، تمدید، توضیحات" },
  ]},
  { category: "اسناد تحصیلی دانش‌آموزی", items: [
    { id: "50", label: "توصیه‌نامه تحصیلی (بعد از تحصیلات سوم راهنمایی)", base: 179250, extra: 5000, unit: "هر سطر و هر مهر" },
    { id: "51", label: "دیپلم پایان تحصیلات متوسطه یا پیش‌دانشگاهی", base: 204000, extra: null, unit: null },
    { id: "51-1", label: "مهرها، ظهرنویسی، توضیحات", base: 20000, extra: null, unit: null, addition: true },
    { id: "52", label: "گواهی رتبه قبولی در دانشگاه‌های دولتی و آزاد", base: 204000, extra: 15000, unit: "هر سطر" },
    { id: "53", label: "ریزنمرات دبیرستان یا پیش‌دانشگاهی (هر ترم)", base: 89760, extra: 5000, unit: "هر درس" },
    { id: "53-1", label: "شرح ابتدایی، مهرها، ظهرنویسی، توضیحات", base: 20000, extra: null, unit: null, addition: true },
    { id: "54", label: "ریزنمرات دبستان، راهنمایی (هر سال)", base: 179250, extra: 5000, unit: "هر درس" },
    { id: "54-1", label: "شرح ابتدایی، مهرها، ظهرنویسی، توضیحات", base: 20000, extra: null, unit: null, addition: true },
    { id: "55", label: "کارنامه توصیفی ابتدائی", base: 273360, extra: 20000, unit: "هر درس" },
    { id: "55-1", label: "شرح ابتدایی، مهرها، ظهرنویسی، توضیحات", base: 20000, extra: null, unit: null, addition: true },
  ]},
  { category: "اسناد دانشگاهی", items: [
    { id: "56", label: "گواهی پایان تحصیلات و دانشنامه (کاردانی، کارشناسی، کارشناسی ارشد، دکترا)، گواهی فارغ‌التحصیلی", base: 293760, extra: 20000, unit: "به ازای هر مهر، توضیحات ظهر سند" },
    { id: "57", label: "گواهی ریزنمرات دانشگاهی", base: 179250, extra: 15000, unit: "هر سطر" },
    { id: "58", label: "ریزنمرات دانشگاه (هر ترم)", base: 97920, extra: 5000, unit: "هر درس" },
    { id: "58-1", label: "شرح ابتدایی، مهرها، ظهرنویسی، توضیحات", base: 20000, extra: null, unit: null, addition: true },
    { id: "59", label: "سرفصل دروس دانشگاهی (هر صفحه)", base: 265200, extra: 20000, unit: "هر سطر" },
    { id: "60", label: "کارت دانشجویی", base: 250000, extra: null, unit: null },
    { id: "61", label: "گواهی رتبه دانشجو و فارغ‌التحصیل", base: 204000, extra: 15000, unit: "هر سطر" },
    { id: "62", label: "گواهی و لیست دروس تدریس استاد و ساعات تدریس (هر صفحه)", base: 391680, extra: 10000, unit: "هر سطر" },
    { id: "63", label: "دانشنامه دانشگاه خارجی", base: 500000, extra: null, unit: null },
    { id: "63-1", label: "هر مهر و توضیحات، ظهرنویسی", base: 20000, extra: null, unit: null, addition: true },
    { id: "64", label: "ریزنمرات دانشگاه خارجی", base: 1200000, extra: 15000, unit: "هر سطر" },
    { id: "64-1", label: "هر مهر و توضیحات، ظهرنویسی", base: 20000, extra: null, unit: null, addition: true },
    { id: "65", label: "گواهی تحصیلی دانشگاه خارجی", base: 300000, extra: 15000, unit: "هر سطر" },
    { id: "65-1", label: "هر مهر و توضیحات، ظهرنویسی", base: 20000, extra: null, unit: null, addition: true },
    { id: "66", label: "کارنامه سازمان ملی سنجش و ارزشیابی نظام آموزش کشور", base: 350000, extra: 5000, unit: "هر آیتم" },
  ]},
  { category: "اسناد ثبتی (ثبت اسناد و املاک)", items: [
    { id: "67", label: "اجرائیه ثبتی (اسناد لازم‌الاجرا)", base: 550000, extra: null, unit: null },
    { id: "68", label: "استعلامات ثبتی", base: 350000, extra: null, unit: null },
    { id: "69", label: "پاسخ استعلامات ثبتی", base: 350000, extra: null, unit: null },
    { id: "70", label: "گواهی ثبت علائم تجاری (هر صفحه)", base: 277440, extra: 10000, unit: "هر سطر" },
    { id: "71", label: "گواهی ثبت اختراع (هر صفحه)", base: 277440, extra: 10000, unit: "هر سطر" },
    { id: "72", label: "صورت‌مجلس تفکیکی (هر صفحه)", base: 340000, extra: 20000, unit: "هر سطر" },
  ]},
  { category: "اسناد ملکی عرصه و اعیان", items: [
    { id: "73", label: "برگ نظریه ارزیابی و کارشناسی ملک (هر صفحه)", base: 489600, extra: 15000, unit: "هر سطر" },
    { id: "74", label: "مبایعه‌نامه خودنویس (هر صفحه)", base: 428400, extra: 20000, unit: "هر سطر" },
    { id: "75", label: "پروانه یا گواهی عدم خلاف ساختمان", base: 391680, extra: 5000, unit: "هر آیتم" },
    // Printed exactly as 91,680 in the source sheet, well below sibling
    // row 75's 391,680 -- possibly a typo in the official PDF, kept
    // faithful to what's printed rather than silently "corrected".
    { id: "76", label: "پروانه ساخت/ساختمان", base: 91680, extra: 5000, unit: "هر آیتم" },
    { id: "77", label: "سند مالکیت (تک‌برگی)", base: 571200, extra: 10000, unit: "هر سطر" },
    { id: "77-1", label: "هر نقل و انتقال، رهن و غیره", base: 50000, extra: null, unit: null, addition: true },
    { id: "78", label: "سند مالکیت دفترچه‌ای", base: 465120, extra: 10000, unit: "هر سطر" },
    { id: "78-1", label: "هر نقل و انتقال، رهن و غیره", base: 50000, extra: null, unit: null, addition: true },
    { id: "79", label: "پروانه پایان کار ساختمان", base: 391680, extra: 5000, unit: "هر آیتم" },
    { id: "80", label: "قرارداد فروش غیرثبتی روستایی با مهر شورا برای املاک فاقد سند", base: 428400, extra: 20000, unit: "هر سطر" },
    { id: "81", label: "اجاره‌نامه (هر صفحه)", base: 354960, extra: 20000, unit: "هر سطر" },
    { id: "82", label: "بنچاق (هر صفحه)", base: 354960, extra: 20000, unit: "هر سطر" },
    { id: "83", label: "صلح‌نامه محضری (هر صفحه)", base: 354960, extra: 20000, unit: "هر سطر" },
    { id: "84", label: "قولنامه رسمی (هر صفحه)", base: 428400, extra: 20000, unit: "هر سطر" },
    { id: "85", label: "مبایعه‌نامه (هر صفحه)", base: 428400, extra: 20000, unit: "هر سطر" },
    { id: "86", label: "مبایعه‌نامه با کد رهگیری (هر صفحه)", base: 428400, extra: 20000, unit: "هر سطر" },
  ]},
  { category: "اسناد مالیاتی", items: [
    { id: "87", label: "اظهارنامه مالیاتی (هر صفحه)", base: 408000, extra: 10000, unit: "هر سطر" },
    { id: "88", label: "برگ تشخیص مالیات، مالیات قطعی (هر صفحه)", base: 342720, extra: 15000, unit: "هر سطر" },
    { id: "89", label: "گواهی مالیاتی", base: 342720, extra: 15000, unit: "هر سطر" },
    { id: "90", label: "مالیات بر ارث (هر صفحه)", base: 440640, extra: 20000, unit: "هر سطر" },
    { id: "91", label: "برگ گواهی ماده ۱۸۷ قانون مالیات‌های مستقیم (هر صفحه)", base: 342720, extra: 15000, unit: "هر سطر" },
  ]},
  { category: "اسناد مخابراتی و رسانه", items: [
    { id: "92", label: "ریز مکالمات تلفن (هر صفحه)", base: 224400, extra: 5000, unit: "هر سطر" },
    { id: "93", label: "سند تلفن همراه", base: 195840, extra: null, unit: null },
    { id: "94", label: "فکس، تلکس، نمابر و پست الکترونیک (منوط به اجازه مراجع ذیربط یا طبق قانون) (هر صفحه)", base: 300000, extra: 20000, unit: "هر سطر (در صورت وجود ریسک مسئولیت، بین ۲۰٬۰۰۰ تا ۳۵٬۰۰۰)" },
    { id: "95", label: "چت‌های خصوصی و فرسته‌ها در فضای مجازی (منوط به اجازه مراجع ذیربط یا طبق قانون) (هر صفحه)", base: 300000, extra: 15000, unit: "هر سطر (در صورت وجود ریسک مسئولیت، بین ۲۰٬۰۰۰ تا ۳۵٬۰۰۰)" },
  ]},
  { category: "اسناد (احکام) ورزشی", items: [
    { id: "96", label: "احکام صادره از اداره کل تربیت بدنی و فدراسیون‌ها", base: 265200, extra: 15000, unit: "هر سطر" },
    { id: "97", label: "حکم و گواهی مربیگری", base: 265200, extra: 15000, unit: "هر سطر" },
    { id: "98", label: "گواهی عضویت در باشگاه، تقدیرنامه و لوح سپاس", base: 265200, extra: 15000, unit: "هر سطر" },
    { id: "99", label: "حکم قهرمانی", base: 265200, extra: 15000, unit: "هر سطر" },
  ]},
  { category: "اسناد وسائل نقلیه", items: [
    { id: "100", label: "سند ثبت، تابعیت و مالکیت هواپیما (هر صفحه)", base: 306000, extra: 30000, unit: "هر سطر" },
    { id: "101", label: "سند وسائط نقلیه سبک", base: 306000, extra: 15000, unit: "هر سطر" },
    { id: "102", label: "سند خودرو (نقلیه سنگین)", base: 306000, extra: 20000, unit: "هر سطر" },
    { id: "103", label: "سند ماشین‌آلات سنگین راهسازی و ساختمانی", base: 306000, extra: 30000, unit: "هر سطر" },
    { id: "104", label: "سند مالکیت یا انتقال شناورها (کشتی، لنج، نفتکش و غیره) (هر صفحه)", base: 306000, extra: 30000, unit: "هر سطر" },
  ]},
  { category: "اسناد وظیفه عمومی", items: [
    { id: "105", label: "کارت پایان خدمت", base: 195840, extra: null, unit: null },
    { id: "106", label: "گواهی معافیت تحصیلی", base: 146880, extra: 15000, unit: "هر سطر" },
    { id: "107", label: "کارت معافیت", base: 195840, extra: null, unit: null },
  ]},
  { category: "اسناد مربوط به گذرنامه", items: [
    { id: "108", label: "گذرنامه", base: 228480, extra: 15000, unit: "هر قلم شامل هر مهر ورود و خروج و غیره" },
    { id: "108-1", label: "روادید، برای هر نفر", base: 25000, extra: null, unit: null, addition: true },
    { id: "109", label: "کارت اقامت موقت اتباع خارجی", base: 195840, extra: null, unit: null },
    { id: "110", label: "کارت/برگ تردد اتباع خارجی", base: 195840, extra: null, unit: null },
    { id: "111", label: "گزارش ورود و خروج از کشور (هر صفحه)", base: 179250, extra: 10000, unit: "هر ردیف" },
  ]},
  { category: "انواع پروانه و جواز اشتغال به کار واحدهای صنفی و صنعتی", items: [
    { id: "112", label: "جواز اشتغال به کار", base: 179250, extra: 10000, unit: "هر سطر" },
    { id: "113", label: "موافقت اصولی", base: 354960, extra: 15000, unit: "هر سطر" },
    { id: "114", label: "پروانه بهره‌برداری (پشت و رو)", base: 469600, extra: 10000, unit: "هر سطر ظهر سند" },
    { id: "115", label: "پروانه مهندسی", base: 391680, extra: null, unit: null },
    { id: "116", label: "پروانه فعالیت", base: 391680, extra: 10000, unit: "هر سطر ظهر سند" },
    { id: "117", label: "پروانه نشر و انتشارات", base: 293760, extra: null, unit: null },
    { id: "118", label: "پروانه وکالت", base: 293760, extra: null, unit: null },
    { id: "119", label: "دفترچه وکالت", base: 367200, extra: 25000, unit: "هر تمدید و هر پرداخت" },
    { id: "120", label: "کارت عضویت کانون وکلا", base: 195840, extra: null, unit: null },
    { id: "121", label: "دفترچه بازرگانی", base: 465120, extra: 25000, unit: "هر تمدید" },
    { id: "122", label: "جواز تأسیس دفاتر ترجمه", base: 465120, extra: null, unit: null },
    { id: "123", label: "پروانه مترجمی رسمی", base: 367200, extra: 25000, unit: "هر تمدید و هر پرداخت" },
    { id: "124", label: "پروانه تاسیس", base: 391680, extra: 10000, unit: "هر سطر ظهر سند" },
    { id: "125", label: "جواز کسب", base: 301920, extra: 15000, unit: "هر سطر ظهر سند" },
    { id: "126", label: "پروانه گل و گیاه", base: 301920, extra: 15000, unit: "هر سطر ظهر سند" },
    { id: "127", label: "کارت بازرگانی هوشمند، کارت عضویت اتاق بازرگانی", base: 250000, extra: null, unit: null },
  ]},
  { category: "قبوض", items: [
    { id: "128", label: "قبض آب، برق، گاز، پسماند شهری و تلفن", base: 244800, extra: 5000, unit: "هر قلم" },
    { id: "129", label: "قبض پرداخت مالیات، بیمه، عوارض شهرداری و غیره", base: 244800, extra: 5000, unit: "هر قلم" },
    { id: "130", label: "قبض نوسازی و عمران شهری", base: 244800, extra: 5000, unit: "هر قلم" },
    { id: "131", label: "قبوض جریمه راهور", base: 244800, extra: 5000, unit: "هر قلم" },
    { id: "132", label: "قبض اجرای دادگستری", base: 244800, extra: 5000, unit: "هر قلم" },
  ]},
  { category: "قراردادها", items: [
    { id: "133", label: "قرارداد استخدامی (هر صفحه)", base: 500000, extra: 15000, unit: "هر سطر" },
    { id: "134", label: "قرارداد بیمه (هر صفحه)", base: 500000, extra: 15000, unit: "هر سطر" },
    { id: "135", label: "قرارداد بین اشخاص حقیقی، محضری یا دارای گواهی امضا و ممهور به مهر یک مرجع رسمی (هر صفحه)", base: 500000, extra: 15000, unit: "هر سطر" },
    { id: "136", label: "قرارداد بین دو شرکت مربوط به خرید کالا یا خدمات (هر صفحه)", base: 500000, extra: 30000, unit: "هر سطر" },
    { id: "137", label: "قرارداد کار اشخاص با دولت، مؤسسه یا شرکت (هر صفحه)", base: 500000, extra: 30000, unit: "هر سطر" },
    { id: "138", label: "قراردادهای دیجیتال و استارت‌آپ (هر صفحه)", base: 500000, extra: 15000, unit: "هر سطر" },
    { id: "139", label: "قراردادهای مربوط به پروژه‌ها (هر صفحه)", base: 500000, extra: 15000, unit: "هر سطر" },
  ]},
  { category: "انواع گواهی", items: [
    { id: "140", label: "گواهی اداری و استخدامی", base: 265200, extra: 10000, unit: "هر سطر" },
    { id: "141", label: "گواهی استاندارد کالا", base: 265200, extra: 20000, unit: "هر سطر" },
    { id: "142", label: "گواهی اشتغال به تحصیل", base: 265200, extra: 10000, unit: "هر سطر" },
    { id: "143", label: "گواهی اشتغال به کار از کارخانجات و واحدهای صنعتی و غیره", base: 265200, extra: 10000, unit: "هر سطر" },
    { id: "144", label: "گواهی اشتغال به کار از واحدهای صنفی", base: 265200, extra: 10000, unit: "هر سطر" },
    { id: "145", label: "گواهی اشتغال به کار برای اتباع خارجی", base: 265200, extra: 10000, unit: "هر سطر" },
    { id: "146", label: "گواهی اشتغال به کار مؤسسات و بخش خصوصی", base: 265200, extra: 10000, unit: "هر سطر" },
    { id: "147", label: "گواهی اشتغال و تدریس استادان و اعضاء هیأت علمی", base: 265200, extra: 10000, unit: "هر سطر" },
    { id: "148", label: "گواهی امضاء محضری", base: 265200, extra: 10000, unit: "هر سطر" },
    { id: "149", label: "گواهی آموزشی", base: 265200, extra: 10000, unit: "هر سطر" },
    { id: "150", label: "گواهی بازرسی کالا (هر صفحه)", base: 265200, extra: 20000, unit: "هر سطر" },
    { id: "151", label: "گواهی بهداشتی غذایی، دارویی و آرایشی (کالا) (هر صفحه)", base: 265200, extra: 20000, unit: "هر سطر" },
    { id: "152", label: "گواهی پرداخت عوارض شهری", base: 265200, extra: 10000, unit: "هر سطر" },
    { id: "153", label: "گواهی تألیف و انتشار", base: 265200, extra: 10000, unit: "هر سطر" },
    { id: "154", label: "گواهی تجرد و/یا گواهی احوال شخصیه", base: 195840, extra: null, unit: null },
    { id: "155", label: "گواهی تولد", base: 195840, extra: null, unit: null },
    { id: "156", label: "گواهی فوت", base: 195840, extra: null, unit: null },
    { id: "157", label: "گواهی تحصیلی (دانش‌آموزی و دانشجویی)", base: 204000, extra: null, unit: null },
    { id: "158", label: "گواهی شرکت در سمینار", base: 265200, extra: 10000, unit: "هر سطر" },
    { id: "159", label: "گواهی ریزنمرات دانشگاهی", base: 204000, extra: null, unit: null },
    { id: "160", label: "گواهی سرمایه‌گذاری، یا مالکیت بازرگانی و غیره", base: 265200, extra: 10000, unit: "هر سطر" },
    { id: "161", label: "گواهی عدم پرداخت چک", base: 265200, extra: 10000, unit: "هر سطر" },
    { id: "162", label: "گواهی عدم خسارت خودرو (هر صفحه)", base: 179250, extra: 12240, unit: "هر سطر" },
    { id: "163", label: "گواهی عدم سوءپیشینه", base: 195840, extra: null, unit: null },
    { id: "164", label: "گواهی فارغ‌التحصیلی (ابتدائی، متوسطه و دبیرستان)", base: 204000, extra: null, unit: null },
    { id: "165", label: "گواهی سلامت کالا و قابلیت عرضه به بازار", base: 497760, extra: null, unit: null },
    { id: "166", label: "گواهی کارکرد (کارمند و کارگر) (هر صفحه)", base: 265200, extra: 10000, unit: "هر سطر" },
    { id: "167", label: "گواهی کنترل کیفیت (گواهینامه‌های استاندارد، ایزو)", base: 265200, extra: 10000, unit: "هر سطر" },
    { id: "168", label: "گواهی فنی و حرفه‌ای", base: 293760, extra: null, unit: null },
    { id: "169", label: "گواهی مبدأ (هر صفحه)", base: 497760, extra: 25000, unit: "هر سطر توضیحات" },
    { id: "170", label: "گواهی محل اقامت (تغییر، کدپستی)", base: 265200, extra: 10000, unit: "هر سطر" },
    { id: "171", label: "گواهی‌های اشتغال به کار (شرح وظایف شغلی) (هر صفحه)", base: 265200, extra: 10000, unit: "هر سطر" },
    { id: "172", label: "گواهی موقت پایان تحصیلات کاردانی، کارشناسی، کارشناسی ارشد، دکترا (منوط به عدم قید فقد اعتبار برای ترجمه)", base: 293760, extra: null, unit: null },
    { id: "173", label: "گواهی‌های آموزشی (حضور در سمینار، کارگاه و غیره)", base: 265200, extra: 10000, unit: "هر سطر" },
    { id: "174", label: "گواهی‌های انجمن مهندسین", base: 265200, extra: 10000, unit: "هر سطر" },
    { id: "175", label: "گواهی کار پزشکان و پرستاران و غیره (هر صفحه)", base: 265200, extra: 10000, unit: "هر سطر" },
    { id: "176", label: "گواهی اعطای نمایندگی شرکت خارجی به ایرانی (هر صفحه)", base: 497760, extra: 25000, unit: "هر سطر توضیحات" },
    { id: "177", label: "گواهی اعطای نمایندگی شرکت ایرانی به خارجی (هر صفحه)", base: 497760, extra: 25000, unit: "هر سطر توضیحات" },
    { id: "178", label: "انواع استعلامات (هر صفحه)", base: 265200, extra: 10000, unit: "هر سطر" },
    { id: "179", label: "سایر گواهی‌ها (هر صفحه)", base: 265200, extra: 10000, unit: "هر سطر" },
  ]},
  { category: "گواهینامه‌های غیر تحصیلی و کاری", items: [
    { id: "180", label: "گواهینامه رانندگی", base: 195840, extra: null, unit: null },
    { id: "181", label: "گواهینامه موتورسیکلت‌رانی", base: 195840, extra: null, unit: null },
    { id: "182", label: "گواهینامه فرهنگی هنری", base: 293760, extra: null, unit: null },
    { id: "183", label: "گواهینامه‌های دریانوردی، کشتیرانی", base: 293760, extra: null, unit: null },
    { id: "184", label: "گواهینامه‌های دوره‌های آموزشی (با ارزش استخدامی)", base: 293760, extra: null, unit: null },
    // Source prints this row's addition as "۲۰،۰۰۰ ریال" -- every other
    // addition in the whole sheet is Toman, so this looks like a stray
    // typo; treated as 20,000 Toman for consistency with its neighbors.
    { id: "185", label: "شناسنامه دریانوردی (هر صفحه)", base: 293760, extra: 20000, unit: "هر سطر" },
    { id: "186", label: "گواهینامه راهبری قطار و مترو (هر صفحه)", base: 293760, extra: 20000, unit: "هر سطر" },
    { id: "187", label: "دفترچه/اجازه کار برای اتباع بیگانه (هر صفحه)", base: 293760, extra: 20000, unit: "هر سطر" },
    { id: "188", label: "سایر گواهینامه‌ها", base: 293760, extra: 20000, unit: "هر سطر" },
  ]},
  { category: "اوراق و اسناد قضایی و قانون", items: [
    { id: "189", label: "دادخواست و لوایح (هر صفحه)", base: 700000, extra: 35000, unit: "هر سطر" },
    { id: "190", label: "ابلاغیه، اخطاریه (هر صفحه)", base: 195840, extra: 25000, unit: "هر سطر" },
    { id: "191", label: "اجرائیه (هر صفحه)", base: 350000, extra: 35000, unit: "هر سطر" },
    { id: "192", label: "برگ جلب، احضاریه (هر صفحه)", base: 350000, extra: 25000, unit: "هر سطر" },
    { id: "193", label: "احکام دادگاه خانواده (فرزندخواندگی، حکم حضانت و سرپرستی اطفال و غیره) (هر صفحه)", base: 700000, extra: 35000, unit: "هر سطر" },
    { id: "194", label: "قرارها و احکام دادگاه‌های حقوقی، کیفری، خانواده و غیره (دادنامه) (هر صفحه)", base: 700000, extra: 35000, unit: "هر سطر" },
    { id: "195", label: "احکام داوری ایران (هر صفحه)", base: 700000, extra: 35000, unit: "هر سطر" },
    { id: "196", label: "حکم/قرار شناسایی، اجرای آراء محاکم/داوری خارجی (هر صفحه)", base: 700000, extra: 35000, unit: "هر سطر" },
    { id: "197", label: "آراء مراجع شبه‌قضائی (هیأت‌های اداری، انتظامی) (هر صفحه)", base: 700000, extra: 35000, unit: "هر سطر" },
    { id: "198", label: "اظهارنامه (هر صفحه)", base: 350000, extra: 25000, unit: "هر سطر" },
    { id: "199", label: "قیم‌نامه (هر صفحه)", base: 452880, extra: 25000, unit: "هر سطر" },
    { id: "200", label: "صورتجلسه تحقیق و بازپرسی و دادگاه (هر صفحه)", base: 700000, extra: 35000, unit: "هر سطر" },
    { id: "201", label: "شکایت کیفری (هر صفحه)", base: 350000, extra: 25000, unit: "هر سطر" },
    { id: "202", label: "گزارش اصلاحی (سازش و ...) (هر صفحه)", base: 700000, extra: 35000, unit: "هر سطر" },
    { id: "203", label: "گواهی حصر وراثت (هر صفحه)", base: 354960, extra: 25000, unit: "هر سطر" },
    { id: "204", label: "درخواست استرداد مجرمین (هر صفحه)", base: 700000, extra: 35000, unit: "هر سطر" },
    { id: "205", label: "مکاتبات قضائی بین‌المللی (هر صفحه)", base: 700000, extra: 35000, unit: "هر سطر" },
    { id: "206", label: "درخواست معاضدت قضایی (هر صفحه)", base: 700000, extra: 35000, unit: "هر سطر" },
    { id: "207", label: "صورتجلسات کلانتری و آگاهی (هر صفحه)", base: 350000, extra: 25000, unit: "هر سطر" },
    { id: "208", label: "احکام دادگاه خارجی (هر صفحه)", base: 700000, extra: 35000, unit: "هر سطر" },
    { id: "209", label: "آراء داوری خارجی (هر صفحه)", base: 700000, extra: 35000, unit: "هر سطر" },
    { id: "210", label: "قانون (در صورت ترجمه، به شرط رضایت یا پرداخت مناسب به مترجم) (هر صفحه)", base: 700000, extra: 35000, unit: "هر سطر" },
  ]},
  { category: "اوراق محضری", items: [
    { id: "211", label: "استشهادیه (هر صفحه)", base: 489600, extra: 20000, unit: "هر شاهد و گواهی دفترخانه" },
    { id: "212", label: "استشهادیه کفالت (والدین یا فرزندان) (هر صفحه)", base: 489600, extra: 20000, unit: "هر شاهد و گواهی دفترخانه" },
    { id: "213", label: "برابر اصل مدارک خارجی (هر صفحه)", base: 15000, extra: null, unit: null },
    { id: "214", label: "تعهدنامه، رضایت‌نامه، اقرارنامه، شهادتنامه و اسناد مشابه (هر صفحه)", base: 489600, extra: 30000, unit: "هر سطر" },
    { id: "215", label: "وصیت‌نامه محضری (هر صفحه)", base: 489600, extra: 30000, unit: "هر سطر" },
    { id: "216", label: "وکالت‌نامه (سایز A4) (هر صفحه)", base: 514080, extra: 25000, unit: "هر سطر" },
    { id: "217", label: "وکالت‌نامه بزرگ (سایز A3) (هر صفحه)", base: 440640, extra: 25000, unit: "هر سطر" },
  ]},
  { category: "کارت‌ها", items: [
    { id: "218", label: "کارت شناسائی", base: 146880, extra: null, unit: null },
    { id: "219", label: "کارت شناسایی کارگاه", base: 375960, extra: null, unit: null },
    { id: "220", label: "کارت عضویت نظام مهندسی", base: 195840, extra: null, unit: null },
    { id: "221", label: "کارت مباشرت", base: 293760, extra: null, unit: null },
    { id: "222", label: "کارت مربی‌گری سازمان فنی و حرفه‌ای", base: 293760, extra: null, unit: null },
    { id: "223", label: "کارت نظام پزشکی", base: 195840, extra: null, unit: null },
  ]},
];

// Flat id -> item lookup, built once at load time -- every consumer in
// app.js (rendering, effective-price lookup, invoice-picker search) wants
// O(1) access by id rather than re-scanning the category tree each time.
const PRICE_CATALOG_BY_ID = {};
PRICE_CATALOG.forEach(group => {
  group.items.forEach(item => {
    PRICE_CATALOG_BY_ID[item.id] = item;
  });
});
