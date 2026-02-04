// ==========================================
// *** SHARED CONFIGURATION & API KEYS ***
// ==========================================

const CLOUDFLARE_WORKER_URL = "markwhite-api.surachet-si.workers.dev";

// Google Maps Key
const GOOGLE_MAPS_API_KEY = "AIzaSyBYTRyiJuhYNYmmjRoCH0fvCUFgkVhpc6Y";

// VAPID Public Key for Web Push
const VAPID_PUBLIC_KEY = "BCNpvarbRgcqB_Lb4YCHz_G2_6ugFzZA5d9tgxXkBzGeyvFiopKQPWAN8rINW7euFbBvEpPMyWn2skFErFCvLH4";

function getApiBaseUrl() {
    // ถ้ามี URL จาก Cloudflare ให้ใช้
    if (CLOUDFLARE_WORKER_URL) return CLOUDFLARE_WORKER_URL;
    
    // Fallback: ถ้าไม่มีให้ใช้ path ปัจจุบัน (กรณีรัน local)
    return window.location.origin; 
}

// ประกาศตัวแปร API_URL ให้เป็น Global (สำคัญมาก บรรทัดนี้ต้องอยู่ตรงนี้)
const API_URL = getApiBaseUrl();

console.log("🔗 API Connected to:", API_URL);

// *** LANGUAGE SETTINGS ***
const LANGUAGES = {
    th: { label: 'TH', flag: 'static/flags/th.png', name: 'Thai' },
    en: { label: 'GB', flag: 'static/flags/gb.png', name: 'English' },
    jp: { label: 'JP', flag: 'static/flags/jp.png', name: 'Japanese' },
    mm: { label: 'MM', flag: 'static/flags/mm.png', name: 'Burmese' }
};

const UI_BASE = {
    login_name: { th: "ชื่อผู้ตรวจสอบ", en: "Inspector Name", jp: "検査員名", mm: "စစ်ဆေးရေးမှူးအမည်" },
    login_placeholder: { th: "ระบุชื่อของคุณ", en: "Enter your name", jp: "名前を入力", mm: "သင့်အမည်ထည့်ပါ" },
    login_btn: { th: "เข้าสู่ระบบ & เช็คอิน", en: "Login & Check In", jp: "ログイン & チェックイン", mm: "လော့ဂ်အင် & Check In" },
    welcome_back: { th: "ยินดีต้อนรับ,", en: "Welcome back,", jp: "おかえりなさい、", mm: "ကြိုဆိုပါတယ်," },
    safety_officer: { th: "เจ้าหน้าที่ความปลอดภัย", en: "Safety Officer", jp: "安全担当者", mm: "ဘေးကင်းရေးအရာရှိ" },
    start_report: { th: "เริ่มรายงาน →", en: "Start Report →", jp: "レポート開始 →", mm: "အစီရင်ခံစာစတင် →" },
    current_location: { th: "สถานที่ปัจจุบัน", en: "Current Location", jp: "現在の場所", mm: "လက်ရှိတည်နေရာ" },
    change_location: { th: "เปลี่ยนจุด", en: "Change Location", jp: "場所を変更", mm: "တည်နေရာပြောင်း" },
    evidence_photos: { th: "รูปถ่ายประกอบ", en: "Evidence Photos", jp: "証拠写真", mm: "သက်သေဓာတ်ပုံများ" },
    add_photo: { th: "เพิ่มรูป", en: "Add", jp: "追加", mm: "ထည့်ပါ" },
    ai_hint: { th: "บอก AI ว่าให้โฟกัสอะไร...", en: "Tell AI what to focus on...", jp: "AIに焦点を伝える...", mm: "AI ကို ဘာအာရုံစိုက်ရမလဲ ပြောပါ..." },
    save_draft: { th: "บันทึกร่าง", en: "Save Draft", jp: "下書き保存", mm: "မူကြမ်းသိမ်း" },
    submit_report: { th: "ส่งรายงาน", en: "Submit Report", jp: "レポート送信", mm: "အစီရင်ခံစာတင်သွင်း" },
    select_option: { th: "เลือกรายการ...", en: "Select Option...", jp: "選択してください...", mm: "ရွေးချယ်ပါ..." },
    type_details: { th: "ระบุรายละเอียด...", en: "Type details...", jp: "詳細を入力...", mm: "အသေးစိတ်ရိုက်ထည့်ပါ..." },
    nav_home: { th: "หน้าหลัก", en: "Home", jp: "ホーム", mm: "ပင်မ" },
    nav_history: { th: "ประวัติ", en: "History", jp: "履歴", mm: "မှတ်တမ်း" },
    nav_notify: { th: "แจ้งเตือน", en: "Notify", jp: "通知", mm: "အသိပေးချက်" },
    nav_profile: { th: "โปรไฟล์", en: "Profile", jp: "プロフィール", mm: "ပရိုဖိုင်" },
    history_title: { th: "ประวัติการรายงาน", en: "Report History", jp: "レポート履歴", mm: "အစီရင်ခံစာမှတ်တမ်း" },
    history_empty: { th: "ไม่พบประวัติการรายงาน", en: "No history found", jp: "履歴が見つかりません", mm: "မှတ်တမ်းမတွေ့ပါ" },
    view_detail: { th: "ดูรายละเอียด", en: "View Detail", jp: "詳細を見る", mm: "အသေးစိတ်ကြည့်ပါ" },
    report_detail: { th: "รายละเอียดรายงาน", en: "Report Detail", jp: "レポート詳細", mm: "အစီရင်ခံစာအသေးစိတ်" },
    status_pending: { th: "รออนุมัติ", en: "Pending", jp: "保留中", mm: "ဆိုင်းငံ့" },
    inspector_label: { th: "ผู้ตรวจสอบ", en: "Inspector", jp: "検査員", mm: "စစ်ဆေးရေးမှူး" },
    location_label: { th: "สถานที่", en: "Location", jp: "場所", mm: "တည်နေရာ" },
    date_label: { th: "วันที่", en: "Date", jp: "日付", mm: "ရက်စွဲ" },
    map_title: { th: "ระบุพิกัดตำแหน่ง", en: "Pin Exact Location", jp: "正確な場所を特定", mm: "တိကျသောတည်နေရာ" },
    map_hint: { th: "เลื่อนแผนที่เพื่อระบุโซน", en: "Drag map to auto-detect zone", jp: "マップをドラッグしてゾーンを検出", mm: "ဇုန်ရှာရန် မြေပုံကိုဆွဲပါ" },
    map_outside_alert: { th: "อยู่นอกพื้นที่กำหนด", en: "Outside Area", jp: "エリア外", mm: "ဧရိယာအပြင်ဘက်" },
    map_confirm_btn: { th: "ยืนยันตำแหน่ง", en: "Confirm Location", jp: "場所を確認", mm: "တည်နေရာအတည်ပြု" },
    map_blocked_btn: { th: "ไม่อยู่ในพื้นที่ (ห้ามเลือก)", en: "Outside Area (Blocked)", jp: "エリア外 (選択不可)", mm: "ဧရိယာအပြင်ဘက် (ပိတ်ထားသည်)" },
    map_checking: { th: "กำลังตรวจสอบ...", en: "Checking...", jp: "確認中...", mm: "စစ်ဆေးနေသည်..." },
    gps_required: { th: "กรุณาระบุตำแหน่ง GPS บนแผนที่", en: "GPS location from map required", jp: "地図上のGPS位置が必要です", mm: "မြေပုံမှ GPS တည်နေရာလိုအပ်သည်" },
    countermeasure_action: { th: "เพิ่มการแก้ไข", en: "Add Countermeasure", jp: "対策を追加", mm: "ပြင်ဆင်မှုထည့်ပါ" },
    cm_title: { th: "การแก้ไขปัญหา", en: "Countermeasure", jp: "対策", mm: "ပြင်ဆင်မှု" },
    cm_saved: { th: "บันทึกการแก้ไขเรียบร้อย", en: "Countermeasure saved", jp: "対策が保存されました", mm: "ပြင်ဆင်မှုသိမ်းဆည်းပြီး" },
    eval_score: { th: "คะแนนประเมิน", en: "Eval Score", jp: "評価スコア", mm: "အကဲဖြတ်ရမှတ်" },
    eval_grade: { th: "เกรด", en: "Grade", jp: "グレード", mm: "အဆင့်" }
};

const CATEGORIES = {
    'S': { label: 'Safety', color: 'bg-green-500' },
    'L': { label: 'Law', color: 'bg-purple-500' },
    'Q': { label: 'Quality', color: 'bg-blue-500' },
    'D': { label: 'Delivery', color: 'bg-orange-500' },
    'C': { label: 'Cost', color: 'bg-yellow-500' },
    'O': { label: 'Other', color: 'bg-slate-500' }
};

const DEFAULT_FACTORY_LATLNG = { lat: 13.425849, lng: 101.014714 }; // ปรับเป็นค่ากลางที่ต้องการ

// Default Config (Fallback)
const DEFAULT_CONFIG = {
    locations: [],
    forms: [],
    evaluations: [],
    mapKml: null
};

const savedLangState = localStorage.getItem('mw_language') || 'th';

// ==========================================
// *** CENTRAL STATE MANAGEMENT (COMPLETE) ***
// ==========================================
const STATE = {
    view: 'login',
    user: null,
    appInitialized: false,
    language: savedLangState,
    config: null,
    originalConfig: null,
    tempConfig: null,
    historyList: [],
    historyCacheTime: 0,
    translationCache: {},
    employeesCache: [], // *** เก็บข้อมูลพนักงานที่นี่ที่เดียว ***
    favorites: [],
    userSettings: {},
    notifications: [],
    formData: {},
    evalScores: {},
    selectedReport: null,
    isEditingCM: false,
    cmTempImages: {},
    mapInstance: null,
    pickerMapInstance: null,
    currentMapCenter: DEFAULT_FACTORY_LATLNG,
    isMapLoaded: false,
    pickerPolygons: [],
    mapMemory: { center: null, zoom: null },
    adminTab: 'forms',
    adminCategoryFilter: 'ALL',
    editingFormIdx: null,
    editingEvalIdx: null,
    editingGroupIdx: null,
    activeLocationSearchIdx: null,
    editorActiveTab: 'report',
    navTab: 'home',
    previousView: 'home',
    returnToFullMap: false,
    historyScrollPos: 0,
    isHomeEditing: false
};

// *** GLOBAL HELPER FUNCTIONS ***
function t(key) { return UI_BASE[key]?.[STATE.language] || UI_BASE[key]?.['th'] || key; }

function showLoading(show, text="Loading...") {
    const el = document.getElementById('loading-overlay');
    const txt = document.getElementById('loading-text');
    if(show && el) { el.style.display = 'flex'; txt.innerText = text; }
    else if(el) { el.style.display = 'none'; }
}

function showToast(msg) {
    const c = document.getElementById('toast-container');
    if(!c) return;
    const t = document.createElement('div');
    t.className = "bg-slate-800 text-white px-4 py-3 rounded-xl shadow-lg text-sm flex items-center gap-2 animate-[slideUp_0.3s_ease-out]";
    t.innerHTML = `<i data-lucide="check-circle" width="16"></i> ${msg}`;
    c.appendChild(t);
    if(window.lucide) lucide.createIcons();
    setTimeout(() => t.remove(), 3000);
}

function autoResize(el) { el.style.height='auto'; el.style.height=el.scrollHeight+'px'; }

// *** GLOBAL DATA FETCHING (รวมไว้ที่นี่ที่เดียว) ***
window.fetchEmployees = async function() {
    if (STATE.employeesCache.length > 0) return;
    try {
        const res = await fetch(`${API_URL}/employees`);
        if (res.ok) STATE.employeesCache = await res.json();
    } catch (e) { console.error("Failed to load employees", e); }
};

function loadGoogleMapsScript() {
    if (window.google && window.google.maps) return;
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&libraries=places,geometry&callback=initMapInternal`;
    script.async = true;
    script.defer = true;
    document.head.appendChild(script);
}
window.initMapInternal = () => { STATE.isMapLoaded = true; };

// ==========================================
// *** GLOBAL LANGUAGE SWITCHER (Google Widget Mode) ***
// ==========================================
window.changeLanguage = function(lang) {
    let gLang = lang;
    if (lang === 'jp') gLang = 'ja';
    if (lang === 'mm') gLang = 'my';

    localStorage.setItem('mw_language', lang);
    STATE.language = lang;

    // [!!! บรรทัดสำคัญที่ต้องเพิ่ม !!!]
    // บันทึกว่า "Session นี้ปลดล็อค PIN แล้ว" เพื่อกันไม่ให้เด้งไปหน้า PIN หลัง Reload
    sessionStorage.setItem('mw_session_unlocked', 'true');

    // จัดการ Cookie
    const domain = window.location.hostname;
    const cookieOpts = "path=/;";
    const domainOpt = (domain !== 'localhost' && !domain.includes('127.0.0.1')) ? `domain=.${domain};` : '';

    // ล้าง Cookie เก่า
    document.cookie = `googtrans=; expires=Thu, 01 Jan 1970 00:00:00 UTC; ${cookieOpts}`;
    document.cookie = `googtrans=; expires=Thu, 01 Jan 1970 00:00:00 UTC; ${cookieOpts} ${domainOpt}`;

    // ตั้ง Cookie ใหม่
    if (lang === 'th') {
        document.cookie = `googtrans=/auto/th; ${cookieOpts} ${domainOpt}`;
    } else {
        document.cookie = `googtrans=/auto/${gLang}; ${cookieOpts} ${domainOpt}`;
    }

    // Reload หน้าเว็บ
    setTimeout(() => {
        window.location.reload();
    }, 100);
};

// เพิ่มฟังก์ชันเรียกตอนเปิดเว็บ เพื่อคงสถานะภาษาเดิมไว้
(function initLanguage() {
    const savedLang = localStorage.getItem('mw_language');
    if (savedLang && savedLang !== 'th') {
        // ถ้าเคยเลือกภาษาอื่นไว้ ให้ตั้งค่า State ให้ตรงกัน
        STATE.language = savedLang;
        // เช็ค Cookie ว่าหลุดไหม ถ้าหลุดให้ตั้งใหม่
        if (document.cookie.indexOf('googtrans') === -1) {
             let gLang = savedLang;
             if (gLang === 'jp') gLang = 'ja';
             if (gLang === 'mm') gLang = 'my';
             document.cookie = `googtrans=/auto/${gLang}; path=/`;
             window.location.reload();
        }
    }

})();




