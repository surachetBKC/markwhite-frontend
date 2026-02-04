// ==========================================
// *** HELPER: EMPLOYEE IMAGE ***
// ==========================================
function getEmployeeImgHtml(empCode, name, sizeClass = "w-10 h-10", textClass = "text-xs") {
    // 1. สร้าง URL ตาม Pattern ที่ให้มา
    const imgUrl = `https://iapi.bkc.co.th/api/File/get?path=images%2Femployee&filename=${empCode}.jpg`;
    const initial = name ? name.charAt(0).toUpperCase() : '?';

    // 2. Return HTML: ลองโหลดรูปก่อน ถ้า Error (onerror) ให้ซ่อนรูปและโชว์ตัวอักษรย่อแทน
    return `
    <div class="${sizeClass} shrink-0 relative rounded-full overflow-hidden bg-slate-100 border border-slate-200 shadow-sm">
        <img src="${imgUrl}"
             class="w-full h-full object-cover"
             onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"
             loading="lazy">
        <div class="hidden absolute inset-0 w-full h-full bg-indigo-50 text-indigo-600 items-center justify-center font-bold ${textClass}">
            ${initial}
        </div>
    </div>`;
}

// ==========================================
// 1. FAST AUTO LOGIN (IIFE)
// ==========================================
(function fastAutoLoginCheck() {
    try {
        const savedUser = localStorage.getItem('mw_user_session');
        if (savedUser) {
            const userObj = JSON.parse(savedUser);
            if (userObj && userObj.userid) {
                STATE.user = userObj;

                // เช็คว่าเคยผ่านการสแกนหรือใส่ PIN มาหรือยังใน Session นี้
                const isSessionUnlocked = sessionStorage.getItem('mw_session_unlocked') === 'true';

                if (userObj.has_pin) {
                    if (isSessionUnlocked) {
                        STATE.view = 'home';
                    } else {
                        STATE.view = 'pin_lock';
                    }
                } else {
                    STATE.view = 'pin_setup';
                }

                // สั่ง Auto Face Scan ถ้าต้องเข้าหน้า PIN และเปิดใช้งานไว้
                if (STATE.view === 'pin_lock' && STATE.userSettings.biometric_enabled === 'true') {
                    setTimeout(() => {
                        if(typeof authenticateBiometrics === 'function') authenticateBiometrics();
                    }, 500);
                }
            }
        }
    } catch (e) {
        console.warn("Fast Login Error:", e);
        localStorage.removeItem('mw_user_session');
    }
})();

// ==========================================
// 2. PIN SYSTEM
// ==========================================
let pinBuffer = "";
let pinConfirmBuffer = "";
let isConfirmingParams = false;

// ฟังก์ชันเรียกใช้ Biometrics (Face Scan / Fingerprint)
async function authenticateBiometrics() {
    if (!window.PublicKeyCredential) return;

    // แสดง Loading ตอนเริ่มสแกนหน้า
    if(typeof showLoading === 'function') showLoading(true, "Face ID Processing...");

    try {
        const idToFetch = STATE.user.employee_code || STATE.user.userid;
        const res = await fetch(`${API_URL}/biometric/get-id/${idToFetch}`);
        const data = await res.json();

        if (!res.ok || !data.credential_id) {
            if(typeof showLoading === 'function') showLoading(false);
            return;
        }

        const rawId = Uint8Array.from(atob(data.credential_id), c => c.charCodeAt(0));

        // ปิด Loading ชั่วคราวเพื่อให้ Browser UI เด้งขึ้นมา
        if(typeof showLoading === 'function') showLoading(false);

        const assertion = await navigator.credentials.get({
            publicKey: {
                challenge: new Uint8Array(32),
                allowCredentials: [{
                    id: rawId,
                    type: 'public-key'
                }],
                userVerification: "required"
            },
            mediation: 'silent'
        });

        if (assertion) {
            // --- LOGIN SUCCESS ---
            STATE.view = 'home';
            render(); // Render หน้า Home ก่อน

            // >>> จุดสำคัญ: เรียกเช็ค Link Notify ตรงนี้ <<<
            if(window.checkDeepLink) window.checkDeepLink();

            if(window.enablePushNotifications) window.enablePushNotifications();
            if(typeof showToast === 'function') showToast("Authenticated with Face Scan");
        }
    } catch (e) {
        console.warn("Face Scan skipped or failed:", e);
        if(typeof showLoading === 'function') showLoading(false);
    }
}

// ==========================================
// *** BIOMETRIC REGISTRATION LOGIC ***
// ==========================================
async function registerBiometrics() {
    if (!window.PublicKeyCredential) {
        alert("อุปกรณ์หรือ Browser นี้ไม่รองรับการสแกนใบหน้า");
        return false;
    }

    try {
        const challenge = new Uint8Array(32);
        window.crypto.getRandomValues(challenge);

        const createOptions = {
            publicKey: {
                challenge: challenge,
                rp: { name: "MarkWhite+", id: window.location.hostname },
                user: {
                    id: Uint8Array.from(STATE.user.username, c => c.charCodeAt(0)),
                    name: STATE.user.username,
                    displayName: STATE.user.name || STATE.user.username
                },
                pubKeyCredParams: [{ alg: -7, type: "public-key" }],
                authenticatorSelection: { userVerification: "required" },
                timeout: 60000
            }
        };

        // >>> กล่องข้อความยืนยันของระบบจะเด้งที่นี่ <<<
        const credential = await navigator.credentials.create(createOptions);

        if (credential) {
            // แปลง ID เป็น Base64 เพื่อส่งไปเก็บที่ DB
            const credIdBase64 = btoa(String.fromCharCode(...new Uint8Array(credential.rawId)));

            // บันทึก Credential ID ลงในฐานข้อมูล (คอลัมน์ bio_credential_id)
            const idToSend = STATE.user.employee_code || STATE.user.userid;
            await fetch(`${API_URL}/user-settings`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    user_id: idToSend,
                    key: 'bio_credential_id',
                    value: credIdBase64
                })
            });
            return true;
        }
    } catch (e) {
        console.error("Biometric Reg Error:", e);
        return false;
    }
}

// ฟังก์ชันสำหรับส่งค่าไปบันทึกที่ Backend
async function saveBiometricToDB(credentialId) {
    const idToSend = STATE.user.employee_code || STATE.user.userid;
    try {
        await fetch(`${API_URL}/user-settings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                user_id: idToSend,
                key: 'bio_credential_id', // คอลัมน์ที่เราเพิ่งสร้าง
                value: credentialId
            })
        });
    } catch (e) { console.error("Save DB Error", e); }
}

function renderPinScreen(container, mode = 'unlock') {
    let title = "Enter PIN Code";
    let desc = `Hello, ${STATE.user?.name || 'User'}.`;

    if (mode === 'setup') {
        title = isConfirmingParams ? "Confirm New PIN" : "Create New PIN";
        desc = "Set a 6-digit PIN for quick access.";
    } else if (mode === 'change') {
         title = "Change PIN";
         desc = "Enter your NEW 6-digit PIN.";
    }

    // Dots
    let dotsHtml = '';
    for (let i = 0; i < 6; i++) {
        const isActive = i < pinBuffer.length;
        const activeClass = isActive ? 'bg-brand-500 scale-110 border-brand-500' : 'bg-transparent border-brand-200';
        dotsHtml += `<div id="pin-dot-${i}" class="pin-dot w-4 h-4 rounded-full border-2 ${activeClass} transition-all duration-100"></div>`;
    }

    // Styles
    const btnBase = "pin-btn w-16 h-16 rounded-full bg-white shadow-sm border border-slate-200 text-3xl font-bold text-slate-700 flex items-center justify-center font-mono select-none relative overflow-hidden";

    container.innerHTML = `
    <div class="min-h-screen flex flex-col items-center justify-center bg-slate-50 relative overflow-hidden select-none" style="touch-action: none;">
        <div class="absolute top-0 left-0 w-full h-1/2 bg-gradient-to-b from-blue-50 to-transparent pointer-events-none"></div>

        <div class="z-10 w-full max-w-md px-8 flex flex-col items-center">

            <div class="mb-8 flex flex-col items-center">
                <div class="w-16 h-16 bg-white rounded-2xl shadow-lg shadow-blue-100 flex items-center justify-center mb-4 text-brand-600">
                    <i data-lucide="${mode === 'unlock' ? 'lock' : 'key'}" width="32"></i>
                </div>
                <h2 class="text-2xl font-black text-slate-800 mb-1 tracking-tight">${title}</h2>
                <p class="text-slate-500 text-sm text-center font-medium">${desc}</p>
            </div>

            <div class="flex gap-4 mb-12 h-8 items-center justify-center">
                ${dotsHtml}
            </div>

            <div class="grid grid-cols-3 gap-x-6 gap-y-5 w-full max-w-[280px]">
                ${[1,2,3,4,5,6,7,8,9].map(n => `
                    <div class="${btnBase}" data-key="${n}">${n}</div>
                `).join('')}

                <div class="flex items-center justify-center">
                    ${mode === 'unlock' ? `
                        <div class="${btnBase} border-brand-100 text-brand-500" data-action="face">
                            <i data-lucide="scan-face" width="28"></i>
                        </div>
                    ` : ''}
                </div>

                <div class="${btnBase}" data-key="0">0</div>

                <div class="flex items-center justify-center">
                    <div class="${btnBase} bg-transparent border-transparent shadow-none text-slate-400 hover:text-red-500 hover:bg-red-50" data-key="del">
                        <i data-lucide="delete" width="32"></i>
                    </div>
                </div>
            </div>

            ${mode === 'unlock' ? `
            <button onclick="handleLogout()" class="mt-12 text-xs font-bold text-slate-400 hover:text-slate-600 uppercase tracking-widest transition-colors p-4">
                Switch Account
            </button>
            ` : ''}
        </div>
    </div>`;

    if(window.lucide) lucide.createIcons();

    // เรียกฟังก์ชันผูก Event ทันทีหลังจากสร้าง HTML
    bindPinPadEvents(mode);
}

function bindPinPadEvents(mode) {
    const buttons = document.querySelectorAll('.pin-btn');

    buttons.forEach(btn => {
        // ใช้ touchstart แทน click เพื่อตัด Delay 300ms ทิ้ง
        const startEvent = 'ontouchstart' in window ? 'touchstart' : 'mousedown';

        btn.addEventListener(startEvent, function(e) {
            e.preventDefault(); // ห้าม Scroll หรือ Zoom ขณะกดปุ่ม

            // Visual Feedback (จำลองการกดเพราะ preventDefault จะปิด :active ของ css)
            this.style.transform = "scale(0.9)";
            this.style.backgroundColor = "#F1F5F9"; // slate-100
            setTimeout(() => {
                this.style.transform = "scale(1)";
                this.style.backgroundColor = this.getAttribute('data-key') === 'del' ? 'transparent' : '#FFFFFF';
            }, 100);

            // Logic
            const key = this.getAttribute('data-key');
            const action = this.getAttribute('data-action');

            if (action === 'face') {
                if(window.authenticateBiometrics) window.authenticateBiometrics();
            } else if (key) {
                handlePinInput(key, mode);
            }
        }, { passive: false });
    });
}

function updatePinDots() {
    const len = pinBuffer.length;
    for (let i = 0; i < 6; i++) {
        const dot = document.getElementById(`pin-dot-${i}`);
        if (dot) {
            if (i < len) {
                dot.className = "pin-dot w-4 h-4 rounded-full border-2 transition-all duration-100 bg-brand-500 scale-110 border-brand-500";
            } else {
                dot.className = "pin-dot w-4 h-4 rounded-full border-2 transition-all duration-100 bg-transparent border-brand-200";
            }
        }
    }
}

async function handlePinInput(key, mode) {
    // สั่นตอบสนองทันที
    if (navigator.vibrate) navigator.vibrate(15);

    if (key === 'del') {
        if (pinBuffer.length > 0) {
            pinBuffer = pinBuffer.slice(0, -1);
            updatePinDots();
        }
        return;
    }

    if (pinBuffer.length < 6) {
        pinBuffer += key;
        updatePinDots();
    }

    // Check PIN
    if (pinBuffer.length === 6) {
        // หน่วงเล็กน้อยเพื่อให้จุดสุดท้ายแสดงผลก่อนส่ง Server
        setTimeout(async () => {
            if (mode === 'unlock') await verifyPinOnServer(pinBuffer);
            else if (mode === 'setup' || mode === 'change') handlePinSetupLogic(pinBuffer);
        }, 50);
    }
}

async function handlePinSetupLogic(inputPin) {
    if (!isConfirmingParams) {
        pinConfirmBuffer = inputPin;
        pinBuffer = "";
        isConfirmingParams = true;
        render();
    } else {
        if (inputPin === pinConfirmBuffer) await saveNewPin(inputPin);
        else {
            alert("PIN mismatch! Please try again.");
            pinBuffer = ""; pinConfirmBuffer = ""; isConfirmingParams = false; render();
        }
    }
}

async function verifyPinOnServer(pin) {
    if(typeof showLoading === 'function') showLoading(true, "Verifying...");

    try {
        const res = await fetch(`${API_URL}/pin/verify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: STATE.user.userid, pin: pin })
        });

        if (res.ok) {
            // --- LOGIN SUCCESS ---
            pinBuffer = "";
            STATE.view = 'home';
            render(); // Render หน้า Home ก่อน

            // >>> จุดสำคัญ: เรียกเช็ค Link Notify ตรงนี้ <<<
            if(window.checkDeepLink) window.checkDeepLink();

            if(window.enablePushNotifications) window.enablePushNotifications();
        } else {
            alert("Incorrect PIN");
            pinBuffer = "";
            render();
        }
    } catch (e) {
        console.error(e);
        alert("Connection Error");
        pinBuffer = "";
        render();
    } finally {
        // ปิด Loading เฉพาะกรณีที่ไม่มี Link (ถ้ามี Link ตัว checkDeepLink จะจัดการต่อเอง)
        const urlParams = new URLSearchParams(window.location.search);
        if (!urlParams.get('id')) {
            if(typeof showLoading === 'function') showLoading(false);
        }
    }
}

async function saveNewPin(pin) {
    if(typeof showLoading === 'function') showLoading(true, "Saving...");
    try {
        const res = await fetch(`${API_URL}/pin/set`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: STATE.user.userid, pin: pin })
        });
        if (res.ok) {
            STATE.user.has_pin = true;
            localStorage.setItem('mw_user_session', JSON.stringify(STATE.user));
            pinBuffer = ""; isConfirmingParams = false; STATE.view = 'home'; render();
            alert("PIN Setup Success!");
        } else alert("Failed to save PIN");
    } catch(e) { console.error(e); alert("Error"); }
    finally { if(typeof showLoading === 'function') showLoading(false); }
}

function startChangePin() {
    pinBuffer = ""; isConfirmingParams = false; STATE.view = 'pin_change'; render();
}

// ==========================================
// 4. LOGIN & LOGOUT
// ==========================================
async function handleLogin() {
    const userInp = document.getElementById('login-username');
    const passInp = document.getElementById('login-password');
    if (!userInp || !passInp) return;

    if(typeof showLoading === 'function') showLoading(true, "Logging in...");
    try {
        const res = await fetch(`${API_URL}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: userInp.value.trim(), password: passInp.value.trim() })
        });
        const data = await res.json();

        if (res.ok) {
            STATE.user = data.user;
            localStorage.setItem('mw_user_session', JSON.stringify(data.user));

            // [NEW] 1. เช็คและเปลี่ยนภาษาตามที่บันทึกไว้ใน DB ทันที
            // ถ้าภาษาไม่ตรง มันจะ Reload หน้าเว็บที่บรรทัดนี้เลย
            await syncUserLanguage(data.user.employee_code);

            // [Original] 2. โหลด Settings และ Favorites
            if (typeof loadUserProfile === 'function') loadUserProfile();

            // ---------------------------------------------------

            if(window.enablePushNotifications) window.enablePushNotifications();

            if (data.user.has_pin) STATE.view = 'home';
            else STATE.view = 'pin_setup';

            render();
        } else {
            alert(data.error || "Login failed");
        }
    } catch (e) { alert("Connection error"); console.error(e); }
    finally { if(typeof showLoading === 'function') showLoading(false); }
}

window.handleLogout = function() {
    if (!confirm("Are you sure you want to logout?")) return;

    localStorage.removeItem('mw_user_session');
    sessionStorage.clear(); // [สำคัญ] ล้าง Session ทั้งหมดรวมถึง mw_session_unlocked

    STATE.user = null;
    STATE.view = 'login';
    render();
};

function renderLogin(container) {
    container.innerHTML = `
    <div class="flex items-center justify-center min-h-screen bg-slate-50 px-6">
        <div class="w-full max-w-sm bg-white rounded-3xl shadow-xl border border-slate-100 p-8 text-center relative overflow-hidden">
             <div class="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-brand-400 to-indigo-500"></div>
             <div class="mb-6 inline-flex p-4 rounded-full bg-brand-50 text-brand-600 shadow-inner">
                <i data-lucide="user-circle-2" width="48" height="48"></i>
             </div>
             <h2 class="text-2xl font-bold text-slate-800 mb-1">Welcome Back</h2>
             <p class="text-slate-400 text-sm mb-8">Sign in to continue</p>

             <div class="space-y-4 text-left">
                <div>
                    <label class="block text-xs font-bold text-slate-500 uppercase mb-1 ml-1">Username</label>
                    <input type="text" id="login-username" class="w-full px-4 py-3 rounded-xl bg-slate-50 border border-slate-200 focus:border-brand-500 focus:ring-2 focus:ring-brand-200 outline-none transition-all font-medium text-slate-700" placeholder="Enter username">
                </div>
                <div>
                    <label class="block text-xs font-bold text-slate-500 uppercase mb-1 ml-1">Password</label>
                    <input type="password" id="login-password" class="w-full px-4 py-3 rounded-xl bg-slate-50 border border-slate-200 focus:border-brand-500 focus:ring-2 focus:ring-brand-200 outline-none transition-all font-medium text-slate-700" placeholder="••••••••">
                </div>
             </div>

             <button onclick="handleLogin()" class="w-full mt-8 py-3.5 bg-gradient-to-r from-brand-600 to-indigo-600 text-white font-bold rounded-xl shadow-lg shadow-brand-200 hover:shadow-xl active:scale-[0.98] transition-all flex items-center justify-center gap-2">
                <span>Sign In</span> <i data-lucide="arrow-right" width="18"></i>
             </button>
             <p class="mt-6 text-xs text-slate-400">MarkWhite+ System v2.0</p>
        </div>
    </div>`;
}

// ==========================================
// 5. PUSH NOTIFICATION
// ==========================================
function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) { outputArray[i] = rawData.charCodeAt(i); }
    return outputArray;
}

window.enablePushNotifications = async function() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    try {
        const registration = await navigator.serviceWorker.register('/sw.js');
        await navigator.serviceWorker.ready;
        let subscription = await registration.pushManager.getSubscription();

        if (!subscription) {
            subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
            });
        }

        if (STATE.user && subscription) {
            // *** แก้ไข: ใช้ employee_code ถ้ามี (เช่น TH22090) ถ้าไม่มีค่อยใช้ userid ***
            const idToSend = STATE.user.employee_code || STATE.user.userid;

            console.log("📡 Subscribing Push for:", idToSend);

            await fetch(`${API_URL}/subscribe`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    user_id: idToSend,
                    subscription_info: JSON.stringify(subscription)
                })
            });
        }
    } catch (error) { console.warn("Push Error:", error.message); }
};

// ==========================================
// 6. DEEP LINK (UPDATED - FIX ZOMBIE LOADING)
// ==========================================
window.checkDeepLink = function() {
    const urlParams = new URLSearchParams(window.location.search);
    const reportId = urlParams.get('id');

    if (reportId) {
        console.log("🔗 Deep Link Found: ID =", reportId);

        // 1. ขึ้น Loading ทันที เพื่อบอก User ว่ากำลังทำงาน
        if(typeof showLoading === 'function') showLoading(true, "Opening Report...");

        // 2. หน่วงเวลาเล็กน้อย (ตาม code เดิมของคุณ 800ms) เพื่อให้ระบบพร้อม
        setTimeout(() => {
            if (STATE.user) {
                // เรียกฟังก์ชันเปิดหน้า Detail
                if (typeof openHistoryDetail === 'function') {
                    openHistoryDetail(reportId);
                }

                // ล้าง URL เพื่อไม่ให้ Refresh แล้วกลับมาหน้าเดิม
                const cleanUrl = window.location.protocol + "//" + window.location.host + window.location.pathname;
                window.history.replaceState({ path: cleanUrl }, "", cleanUrl);
            }

            // 3. ปิด Loading เมื่อเสร็จ
            if(typeof showLoading === 'function') showLoading(false);
        }, 800);
    }
};

document.addEventListener('DOMContentLoaded', () => {
    // ไม่ต้องเรียก Auto Login ใน DOM อีกแล้ว (เพราะใช้ IIFE ข้างบน)
    render();

    if (STATE.user) {
        // ถ้ามี User ล็อกอินอยู่แล้ว (Auto Login)
        // >>> [เพิ่มตรงนี้] ให้โหลดข้อมูลโปรไฟล์ (Settings/Fav) ทันที <<<
        loadUserProfile();
        // ----------------------------------------------------------

        if (STATE.view === 'home') {
            window.checkDeepLink();
            window.enablePushNotifications();
        }
    }
});

// ฟังก์ชัน Placeholder (ถ้ามีไฟล์แยก ให้ลบส่วนนี้ออกได้เลย)
if (typeof renderHomeContent !== 'function') {
    window.renderHomeContent = () => { document.getElementById('main-content').innerHTML = '<div class="p-4 text-center">Home Content</div>'; };
    window.renderProfileContent = () => {
        document.getElementById('main-content').innerHTML = `
        <div class="p-6">
            <h2 class="text-xl font-bold mb-4">Profile</h2>
            <button onclick="startChangePin()" class="w-full py-3 bg-white border border-slate-200 rounded-xl mb-3 font-bold text-slate-600 gap-2 flex items-center justify-center"><i data-lucide="key-round" width="18"></i> Change PIN Code</button>
            <button onclick="handleLogout()" class="w-full py-3 bg-red-50 text-red-600 rounded-xl font-bold">Logout</button>
        </div>`;
    };
    window.initAppStructure = () => {
        const app = document.getElementById('app');
        app.innerHTML = `
        <div class="h-full flex flex-col bg-slate-50">
            <header id="main-header" class="bg-white px-6 py-4 flex justify-between items-center border-b border-slate-100 shadow-sm z-20">
                <div class="flex items-center gap-3">
                    <div class="w-10 h-10 rounded-full bg-gradient-to-br from-brand-500 to-indigo-600 text-white flex items-center justify-center font-bold text-lg shadow-md">
                        <span id="header-avatar">MW</span>
                    </div>
                    <div>
                        <h1 class="font-bold text-slate-800 text-lg leading-tight truncate max-w-[150px]" id="header-username">User</h1>
                        <p class="text-[10px] font-bold text-slate-400 uppercase tracking-wider">MarkWhite+</p>
                    </div>
                </div>
                <div id="admin-btn-container"></div>
            </header>
            <main id="main-content" class="flex-1 overflow-y-auto pb-24 relative custom-scrollbar"></main>
            <nav class="bg-white border-t border-slate-100 px-6 py-3 flex justify-between items-center shadow-[0_-4px_20px_-5px_rgba(0,0,0,0.05)] z-30 fixed bottom-0 w-full max-w-md left-1/2 -translate-x-1/2 rounded-t-3xl">
            </nav>
        </div>`;
    };
    window.updateBottomNav = () => {};
}

// *** MAIN RENDER & ROUTING ***
function render() {
    const app = document.getElementById('app');

    // Handle PIN Views
    if (STATE.view === 'pin_lock') {
        renderPinScreen(app, 'unlock');
        return;
    }
    if (STATE.view === 'pin_setup') {
        renderPinScreen(app, 'setup');
        return;
    }
    if (STATE.view === 'pin_change') { // เพิ่มหน้านี้สำหรับการแก้ไข
        renderPinScreen(app, 'change');
        return;
    }

    // 1. Handle Full Screen Views
    if (['login', 'form', 'admin', 'history_detail'].includes(STATE.view)) {
        STATE.appInitialized = false;

        if (STATE.view === 'login') renderLogin(app);
        else if (STATE.view === 'form') renderForm(app);
        else if (STATE.view === 'history_detail') renderHistoryDetail(app);
        else if (STATE.view === 'admin') {
            if (typeof renderAdmin === 'function') {
                renderAdmin(app);
            } else {
                alert("Admin module not loaded");
                STATE.view = 'home';
                render();
            }
        }

        if(window.lucide) lucide.createIcons();
        return;
    }

    // 2. Handle Layout Views (Home, History, Notify, Profile)
    if (!document.getElementById('main-content')) {
        initAppStructure();
    }

    const header = document.getElementById('main-header');
    const headerUsername = document.getElementById('header-username');

    if(headerUsername) headerUsername.textContent = STATE.user?.name || STATE.user?.username || 'User';

    const adminContainer = document.getElementById('admin-btn-container');
    if (adminContainer) {
        adminContainer.innerHTML = (typeof enterAdminMode === 'function') ? `<button onclick="enterAdminMode()" class="p-2 bg-white/20 rounded-full hover:bg-white/30 backdrop-blur-md transition mb-1"><i data-lucide="settings-2" width="20"></i></button>` : '';
    }

    // Handle Header Animation State
    if (STATE.view === 'home') {
        header?.classList.remove('header-collapsed');
    } else {
        header?.classList.add('header-collapsed');
    }

    const mainContent = document.getElementById('main-content');
    if(mainContent) {
        if (STATE.view === 'home') renderHomeContent(mainContent);
        else if (STATE.view === 'history') renderHistoryContent(mainContent);
        else if (STATE.view === 'notify') renderNotifyContent(mainContent);
        else if (STATE.view === 'profile') renderProfileContent(mainContent);
    }

    updateBottomNav();
    if(window.lucide) lucide.createIcons();
}

function initAppStructure() {
    const app = document.getElementById('app');
    const user = STATE.user || {};

    // ดึงค่า name ที่เราบันทึกไว้ใน handleLogin (ซึ่งเป็น Full Name)
    const displayName = user.name || user.username || 'Guest User';
    const displayRole = user.userrole || 'User';

    // *** UPDATED PADDING: pt-12 md:pt-16 to avoid top edge overlap on iPad ***
    app.innerHTML = `
    <div id="main-header" class="bg-gradient-to-br from-brand-600 to-teal-400 rounded-b-[2rem] shadow-xl shadow-blue-200/40 text-white relative overflow-hidden shrink-0 z-30 pt-12 md:pt-16 px-6 md:px-12 pb-8">
        <div class="absolute top-[-20%] right-[-10%] w-40 h-40 bg-white/10 rounded-full blur-2xl"></div>

        <div class="flex justify-between items-start mb-2 relative z-10">
             <div class="flex items-center gap-3">
                <img src="static/images/mw_mini.png" class="h-20 w-auto object-contain brightness-0 invert drop-shadow-md">
                <span class="text-xl font-extrabold text-white tracking-tight drop-shadow-sm">MarkWhite<span class="text-sky-200">+</span></span>
            </div>
            <div class="flex flex-col items-end gap-2">
                 <div id="admin-btn-container"></div>
                 ${renderLanguageSwitcher("flex gap-1")}
            </div>
        </div>

        <div id="welcome-section" class="relative z-10 pl-1">
            <p class="text-blue-100 text-[10px] font-bold uppercase tracking-wider mb-0.5">${t('welcome_back')}</p>

            <h2 id="header-username" class="text-2xl md:text-3xl font-extrabold tracking-tight text-white mb-2 truncate max-w-[90%] leading-tight">
                ${displayName}
            </h2>

            <div class="inline-flex items-center gap-2 px-3 py-1 bg-white/20 backdrop-blur-md rounded-full border border-white/10 text-xs font-semibold">
                <i data-lucide="shield" width="12" class="fill-current"></i> ${displayRole}
            </div>
        </div>
    </div>

    <div id="main-scroll-area" class="flex-1 w-full no-scrollbar relative z-10 overflow-y-auto overflow-x-hidden">
        <div id="main-content" class="pb-32 min-h-full"></div>
    </div>

    <div id="bottom-nav-container"></div>
    `;
    STATE.appInitialized = true;
    updateBottomNav();
}

function renderLanguageSwitcher(classes) {
    // แก้ไข onclick จาก changeLanguage เป็น setUserLanguage
    return `
        <div class="${classes}">
            ${Object.keys(LANGUAGES).map(lang => `
                <button onclick="setUserLanguage('${lang}')"
                    class="lang-btn w-8 h-8 rounded-full border border-white/50 bg-white/20 shadow-sm flex items-center justify-center transition-all ${STATE.language === lang ? 'active bg-white' : 'opacity-70 hover:opacity-100'}">
                    <img src="${LANGUAGES[lang].flag}" alt="${lang}">
                </button>
            `).join('')}
        </div>
    `;
}

// *** LOGIN SCREEN (UPDATED FOR USERNAME/PASSWORD) ***
function renderLogin(c) {
    // *** UPDATED PADDING: pt-16 md:pt-20 for iPad top spacing ***
    c.innerHTML = `
    <div class="flex-1 flex flex-col justify-center items-center p-8 pt-16 md:pt-20 slide-up">
        <div class="w-full max-w-sm glass-panel p-6 rounded-[2.5rem] relative overflow-hidden">
            <div class="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-brand-500 to-teal-400"></div>
            <div class="absolute top-4 right-4">${renderLanguageSwitcher("flex gap-2")}</div>
            <div class="flex flex-col items-center mb-4 mt-4">
                <img src="static/images/mw_full.png" class="w-80 object-contain drop-shadow-md">
            </div>
            <div class="space-y-5">

                <div>
                    <label class="text-[10px] font-bold text-slate-500 uppercase ml-3 mb-1 block tracking-wider">Username</label>
                    <div class="relative">
                        <div class="absolute left-4 top-1/2 -translate-y-1/2 text-brand-500"><i data-lucide="user" width="20"></i></div>
                        <input type="text" id="login-username" class="w-full pl-12 pr-4 py-4 glass-input rounded-2xl text-slate-700 font-bold placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-brand-500 transition-all" placeholder="Enter username">
                    </div>
                </div>

                <div>
                    <label class="text-[10px] font-bold text-slate-500 uppercase ml-3 mb-1 block tracking-wider">Password</label>
                    <div class="relative">
                        <div class="absolute left-4 top-1/2 -translate-y-1/2 text-brand-500"><i data-lucide="lock" width="20"></i></div>
                        <input type="password" id="login-password" class="w-full pl-12 pr-4 py-4 glass-input rounded-2xl text-slate-700 font-bold placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-brand-500 transition-all" placeholder="Enter password">
                    </div>
                </div>

                <button id="btn-login" onclick="handleLogin()" class="w-full py-4 bg-gradient-to-r from-brand-600 to-cyan-500 text-white rounded-2xl font-bold text-sm shadow-lg shadow-blue-200/50 hover:shadow-xl hover:scale-[1.02] active:scale-95 transition-all flex items-center justify-center gap-2">
                    ${t('login_btn')} <i data-lucide="arrow-right" width="18"></i>
                </button>
            </div>
        </div>
    </div>
    `;

}

// เพิ่มตัวแปร State
STATE.favorites = [];
STATE.userSettings = {}; // เก็บ { language: 'en', home_layout: '...' }
STATE.notifications = [];

// ==========================================
// *** AUTO LOGIN SYSTEM (LocalStorage) ***
// ==========================================
function checkAutoLogin() {
    const savedUser = localStorage.getItem('mw_user_session');

    // [เพิ่มบรรทัดนี้] อ่านค่าว่าเคยปลดล็อคหรือยัง
    const isSessionUnlocked = sessionStorage.getItem('mw_session_unlocked') === 'true';

    if (savedUser) {
        try {
            const userObj = JSON.parse(savedUser);
            STATE.user = userObj;

            if (userObj.has_pin) {
                // [แก้ตรงนี้] ถ้าปลดล็อคแล้ว (เช่น เพิ่งสแกนหน้าผ่าน) ให้เข้า Home เลย
                if (isSessionUnlocked) {
                    STATE.view = 'home';
                } else {
                    STATE.view = 'pin_lock';
                }
            } else {
                STATE.view = 'pin_setup';
            }
        } catch (e) {
            console.error("Auto-login error", e);
            localStorage.removeItem('mw_user_session');
            STATE.view = 'login';
        }
    } else {
        STATE.view = 'login';
    }
}

// เรียกใช้งานทันทีที่ไฟล์โหลด!
checkAutoLogin();

async function loadUserProfile() {
    // เช็คความปลอดภัย
    if (!STATE.user) return;

    // ใช้ employee_code เป็นหลัก (ถ้าไม่มีให้ใช้ userid)
    const idToFetch = STATE.user.employee_code || STATE.user.userid;

    console.log("📥 Loading Profile for:", idToFetch);

    try {
        const res = await fetch(`${API_URL}/user-profile/${idToFetch}`);
        if (res.ok) {
            const data = await res.json();

            // บันทึกลง STATE
            STATE.favorites = data.favorites || [];
            STATE.userSettings = data.settings || {};

            console.log("✅ Profile Loaded:", data);

            // Apply Language (ถ้ามีการตั้งค่าภาษาไว้)
            if (STATE.userSettings.language && STATE.userSettings.language !== STATE.language) {
                changeLanguage(STATE.userSettings.language);
            }

            // Update Notify Badge (ถ้ามีค่าส่งมา)
            if (data.noti_count !== undefined) {
                updateNotifyBadge(data.noti_count);
            }

            // ถ้าอยู่หน้า Home ให้ Render ใหม่เพื่อแสดงรายการโปรด
            if (STATE.view === 'home') {
                const mainContent = document.getElementById('main-content');
                if (mainContent) renderHomeContent(mainContent);
            }
        }
    } catch (e) {
        console.error("❌ Profile Load Error", e);
    }
}

function updateNotifyBadge(count) {
    const badge = document.getElementById('nav-notify-badge');
    if(badge) {
        if(count > 0) {
            badge.innerText = count;
            badge.classList.remove('hidden');
        } else {
            badge.classList.add('hidden');
        }
    }
}

// *** HOME & DASHBOARD ***
const WIDGETS = {
    'stats': {
        id: 'stats',
        title: 'Site Overview',
        render: () => `
            <div class="relative w-full h-64 rounded-3xl overflow-hidden shadow-sm border border-slate-100 group">
                <div id="overview-mini-map" class="w-full h-full bg-slate-200"></div>

                <div class="absolute bottom-2 left-2 bg-white/90 backdrop-blur-sm p-2 rounded-xl text-[9px] shadow-lg border border-slate-100 flex flex-col gap-1 z-10">
                    <div class="flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-yellow-400 border border-slate-400"></span> Pending</div>
                    <div class="flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-green-500 border border-slate-400"></span> Approved</div>
                    <div class="flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-red-500 border border-slate-400"></span> Revision</div>
                </div>

                <button onclick="openFullMap()" class="absolute top-2 right-2 bg-white/90 p-2 rounded-full shadow-md text-slate-600 hover:text-brand-600 active:scale-95 transition-all">
                    <i data-lucide="maximize-2" width="16"></i>
                </button>
            </div>`
    },
    'favorites': {
        id: 'favorites',
        title: 'Quick Access',
        render: () => {
            // [FIX] ป้องกัน Error: Cannot read properties of null (reading 'forms')
            if (!STATE.config || !STATE.config.forms) {
                return '<div class="text-center text-xs text-slate-400 py-4"><i data-lucide="loader-2" class="animate-spin inline mr-1"></i> Loading Config...</div>';
            }

            const favForms = STATE.config.forms.filter(f => STATE.favorites.includes(f.id));
            if (favForms.length === 0) return `<div class="text-center text-xs text-slate-400 py-4 bg-slate-50 rounded-xl border border-dashed border-slate-200">Tap star icon on forms to add here</div>`;

            return `
            <div class="flex gap-3 overflow-x-auto pb-4 pt-1 no-scrollbar -mx-2 px-2">
                ${favForms.map(f => `
                    <button onclick="if(!STATE.isHomeEditing) startForm('${f.id}')" class="shrink-0 w-20 flex flex-col items-center gap-2 group transition-all">
                        <div class="w-14 h-14 rounded-2xl ${f.logoColor} text-white flex items-center justify-center shadow-md group-hover:scale-110 group-active:scale-95 transition-all relative overflow-hidden">
                            <div class="absolute top-0 left-0 w-full h-full bg-white/20 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                            <i data-lucide="${f.icon}" width="24"></i>
                        </div>
                        <span class="text-[10px] font-bold text-slate-600 text-center leading-tight line-clamp-2 w-full">${f.title}</span>
                    </button>
                `).join('')}
            </div>`;
        }
    },
    'recent': {
        id: 'recent',
        title: 'Recent Activity',
        render: () => {
            // [FIX] ป้องกัน Error กรณี Config หรือ Form ยังไม่มา
            if (!STATE.config || !STATE.config.forms) {
                return '<div class="text-center text-xs text-slate-400 py-4">Loading...</div>';
            }

            return `
            <div id="home-mini-history" class="space-y-3">
                ${STATE.historyList.length > 0 ? generateMiniHistoryHTML(STATE.historyList) : '<div class="text-center text-xs text-slate-400 py-4"><i data-lucide="loader-2" class="animate-spin"></i> Loading...</div>'}
            </div>
            `;
        }
    },
    'weather': {
        id: 'weather',
        title: 'Announcement',
        render: () => `
            <div class="bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 p-4 rounded-2xl text-white shadow-lg relative overflow-hidden">
                <div class="flex justify-between items-start relative z-10">
                    <div>
                        <h4 class="font-bold text-sm">Safety Week!</h4>
                        <p class="text-[10px] opacity-90 mt-1 max-w-[80%]">Don't forget to wear PPE at all times in Zone A.</p>
                    </div>
                    <i data-lucide="megaphone" class="text-white/80" width="24"></i>
                </div>
            </div>
        `
    },
    'approvals': {
        id: 'approvals',
        title: 'For Your Approval',
        render: () => `
            <div class="bg-white p-4 rounded-3xl shadow-sm border border-slate-100 relative overflow-hidden">
                <div class="flex justify-between items-center mb-4">
                    <div class="flex items-center gap-2">
                        <div class="w-8 h-8 rounded-full bg-orange-50 text-orange-500 flex items-center justify-center">
                            <i data-lucide="file-check-2" width="16"></i>
                        </div>
                        <div>
                            <h4 class="font-bold text-sm text-slate-700 leading-none">Pending Requests</h4>
                            <p class="text-[10px] text-slate-400 font-medium mt-0.5">You have 3 items waiting</p>
                        </div>
                    </div>
                    <span class="bg-orange-100 text-orange-600 text-[10px] font-bold px-2 py-0.5 rounded-full">3</span>
                </div>

                <div class="space-y-3">
                    <div class="flex items-center justify-between group">
                        <div class="flex items-center gap-3">
                            <div class="w-10 h-10 rounded-full bg-slate-200 overflow-hidden border-2 border-white shadow-sm">
                                <img src="https://ui-avatars.com/api/?name=Somsak+J&background=random" class="w-full h-full object-cover">
                            </div>
                            <div>
                                <h5 class="text-xs font-bold text-slate-700">Somsak J.</h5>
                                <p class="text-[10px] text-slate-400">Sick Leave • 28 Jan (Full)</p>
                            </div>
                        </div>
                        <div class="flex gap-1">
                            <button class="w-8 h-8 rounded-full bg-red-50 text-red-500 hover:bg-red-500 hover:text-white flex items-center justify-center transition-all active:scale-90">
                                <i data-lucide="x" width="14"></i>
                            </button>
                            <button class="w-8 h-8 rounded-full bg-green-50 text-green-500 hover:bg-green-500 hover:text-white flex items-center justify-center transition-all active:scale-90">
                                <i data-lucide="check" width="14"></i>
                            </button>
                        </div>
                    </div>

                    <div class="flex items-center justify-between group">
                        <div class="flex items-center gap-3">
                            <div class="w-10 h-10 rounded-full bg-slate-200 overflow-hidden border-2 border-white shadow-sm">
                                <img src="https://ui-avatars.com/api/?name=Malee+K&background=random" class="w-full h-full object-cover">
                            </div>
                            <div>
                                <h5 class="text-xs font-bold text-slate-700">Malee K.</h5>
                                <p class="text-[10px] text-slate-400">Vacation • 1-2 Feb</p>
                            </div>
                        </div>
                        <div class="flex gap-1">
                            <button class="w-8 h-8 rounded-full bg-red-50 text-red-500 hover:bg-red-500 hover:text-white flex items-center justify-center transition-all active:scale-90">
                                <i data-lucide="x" width="14"></i>
                            </button>
                            <button class="w-8 h-8 rounded-full bg-green-50 text-green-500 hover:bg-green-500 hover:text-white flex items-center justify-center transition-all active:scale-90">
                                <i data-lucide="check" width="14"></i>
                            </button>
                        </div>
                    </div>

                    <button class="w-full py-2 mt-1 text-[10px] font-bold text-slate-400 hover:text-brand-600 hover:bg-slate-50 rounded-xl transition-colors dashed-border border-slate-200">
                        View all requests
                    </button>
                </div>
            </div>`
    },
    'tasks': {
        id: 'tasks',
        title: 'My Tasks',
        render: () => `
            <div class="bg-white p-5 rounded-[2rem] shadow-sm border border-slate-100 relative overflow-hidden group">

                <div class="flex justify-between items-center mb-5">
                    <div class="flex items-center gap-3">
                        <div class="w-10 h-10 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center border border-indigo-100">
                            <i data-lucide="clipboard-list" width="20"></i>
                        </div>
                        <div>
                            <h4 class="font-black text-sm text-slate-700 leading-tight">My Tasks</h4>
                            <p class="text-[10px] text-slate-400 font-bold mt-0.5">Assignments & Fixes</p>
                        </div>
                    </div>
                    <span class="bg-indigo-600 text-white text-[10px] font-bold px-2.5 py-1 rounded-lg shadow-sm shadow-indigo-200">2 Active</span>
                </div>

                <div class="space-y-3">

                    <div class="p-3.5 rounded-2xl bg-red-50/50 border border-red-100 hover:border-red-200 transition-all cursor-pointer relative overflow-hidden">
                        <div class="absolute left-0 top-0 bottom-0 w-1 bg-red-400"></div>

                        <div class="flex justify-between items-start mb-2 pl-2">
                            <div class="flex items-center gap-2">
                                <span class="relative flex h-2 w-2">
                                  <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                                  <span class="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                                </span>
                                <span class="text-[9px] font-black text-red-500 uppercase tracking-wider">REVISION NEEDED</span>
                            </div>
                            <span class="text-[9px] font-bold text-slate-400">10:30 AM</span>
                        </div>

                        <div class="pl-2">
                            <h5 class="text-xs font-bold text-slate-700 mb-1">Safety Patrol: Zone A</h5>

                            <div class="bg-white/60 p-2 rounded-xl mb-3 border border-red-100/50">
                                <p class="text-[10px] text-slate-600 italic line-clamp-2">
                                    <span class="font-bold text-red-400 not-italic">Manager:</span>
                                    "รูปภาพที่ 2 มืดเกินไป มองไม่เห็นรอยรั่ว รบกวนถ่ายใหม่ครับ"
                                </p>
                            </div>

                            <button class="w-full py-2 bg-white border border-red-100 text-red-500 text-[10px] font-bold rounded-xl hover:bg-red-500 hover:text-white transition-all flex items-center justify-center gap-2 shadow-sm">
                                <i data-lucide="pen-tool" width="12"></i> Fix Report Now
                            </button>
                        </div>
                    </div>

                    <div class="p-3.5 rounded-2xl bg-white border border-slate-100 hover:border-indigo-200 transition-all cursor-pointer group/item">
                        <div class="flex justify-between items-start mb-2">
                            <div class="flex items-center gap-2">
                                <span class="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
                                <span class="text-[9px] font-bold text-blue-500 uppercase tracking-wider">NEW TASK</span>
                            </div>
                            <span class="text-[9px] font-bold text-slate-300">Yesterday</span>
                        </div>
                        <div class="flex justify-between items-end">
                            <div>
                                <h5 class="text-xs font-bold text-slate-700 mb-0.5 group-hover/item:text-indigo-600 transition-colors">Monthly 5S Check</h5>
                                <p class="text-[10px] text-slate-400">Assigned by: Surachet S.</p>
                            </div>
                            <button class="w-8 h-8 rounded-full bg-slate-50 text-slate-400 group-hover/item:bg-indigo-50 group-hover/item:text-indigo-600 flex items-center justify-center transition-colors">
                                <i data-lucide="chevron-right" width="16"></i>
                            </button>
                        </div>
                    </div>

                </div>
            </div>`
    }
};

// ============================================================
// *** HOME RENDER FUNCTION (Compact Time & Tight Layout) ***
// ============================================================

function renderHomeContent(container) {
    // 1. อ่าน Layout
    let activeLayout = STATE.userSettings.home_layout
        ? STATE.userSettings.home_layout.split(',')
        : ['weather', 'favorites', 'stats', 'tasks', 'approvals', 'recent'];

    // Clean IDs
    activeLayout = activeLayout.filter(id => WIDGETS[id]);

    const isEditing = STATE.isHomeEditing || false;
    const now = new Date();

    // Date & Time Formatting
    const timeStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    const dayName = now.toLocaleDateString('en-GB', { weekday: 'long' });
    const fullDate = now.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

    // Header HTML (Compact Design)
    const headerHtml = `
        <div class="flex justify-between items-end mb-4 px-1 pt-0">
            <div>
                <h1 class="text-4xl font-black tracking-tight leading-none mb-1 text-slate-800 font-sans">
                    ${timeStr}
                </h1>

                <div class="flex items-center gap-2">
                    <span class="bg-blue-100 text-blue-700 text-[9px] font-extrabold px-1.5 py-0.5 rounded-md uppercase tracking-wider border border-blue-200">
                        ${dayName}
                    </span>
                    <span class="text-xs font-bold text-slate-400 tracking-wide">
                        ${fullDate}
                    </span>
                </div>
            </div>

            <button onclick="toggleHomeEditMode()" class="p-2 rounded-xl ${isEditing ? 'bg-slate-800 text-white shadow-lg rotate-180' : 'bg-white text-slate-400 border border-slate-100 shadow-sm'} transition-all duration-300 active:scale-90 hover:bg-slate-50 mb-1">
                ${isEditing ? '<i data-lucide="check" width="16"></i>' : '<i data-lucide="sliders-horizontal" width="16"></i>'}
            </button>
        </div>
    `;

    // Hint Text (แสดงเฉพาะตอน Edit)
    const hintHtml = `
        <div id="edit-hint" class="${isEditing ? 'flex' : 'hidden'} items-center justify-center gap-2 text-[10px] font-bold text-slate-400 mb-4 bg-slate-50/80 py-2 rounded-lg border border-dashed border-slate-200 animate-pulse">
            <span>Sort <i data-lucide="arrow-up-down" width="10" class="inline"></i></span>
            <div class="w-1 h-1 rounded-full bg-slate-300"></div>
            <span>Hide <i data-lucide="eye" width="10" class="inline"></i></span>
        </div>
    `;

    let contentHtml = `<div id="home-widgets-container" class="space-y-4 pb-24 relative min-h-[300px]">`;

    // Render Widgets
    activeLayout.forEach((widgetId, index) => {
        const widget = WIDGETS[widgetId];
        const isFirst = index === 0;
        const isLast = index === activeLayout.length - 1;

        // Controls (Manual Sort)
        const controls = `
            <div class="widget-controls">
                <button onclick="moveWidget('${widgetId}', -1)" class="ctrl-btn" ${isFirst ? 'style="visibility:hidden;"' : ''}>
                    <i data-lucide="arrow-up" width="16"></i>
                </button>
                <button onclick="moveWidget('${widgetId}', 1)" class="ctrl-btn" ${isLast ? 'style="visibility:hidden;"' : ''}>
                    <i data-lucide="arrow-down" width="16"></i>
                </button>
                <div class="ctrl-divider"></div>
                <button onclick="toggleWidgetVisibility('${widgetId}')" class="ctrl-btn btn-hide">
                    <i data-lucide="eye-off" width="16"></i>
                </button>
            </div>
        `;

        contentHtml += `
            <div class="home-widget bg-transparent rounded-2xl transition-all duration-300 ${isEditing ? 'scale-[0.98]' : ''}" id="widget-${widgetId}">
                ${controls}
                <div class="widget-content-area relative">
                    ${widgetId !== 'weather' ? `<h3 class="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest mb-2 ml-1 select-none pointer-events-none flex items-center gap-2">
                        ${widget.title}
                        ${isEditing ? '<div class="h-[1px] flex-1 bg-slate-100"></div>' : ''}
                    </h3>` : ''}
                    ${widget.render()}
                </div>
            </div>
        `;
    });

    // Hidden Items Area
    if (isEditing) {
        const allIds = Object.keys(WIDGETS);
        const hiddenIds = allIds.filter(id => !activeLayout.includes(id));

        if (hiddenIds.length > 0) {
            contentHtml += `
            <div class="mt-6 pt-4 border-t-2 border-dashed border-slate-100">
                <h3 class="text-[9px] font-black text-slate-300 uppercase text-center mb-3 tracking-[0.2em]">AVAILABLE</h3>
                <div class="grid grid-cols-2 gap-2 opacity-80">
                    ${hiddenIds.map(id => `
                        <button onclick="toggleWidgetVisibility('${id}')" class="flex flex-col items-center justify-center gap-1 p-3 bg-white rounded-xl border border-slate-100 shadow-sm hover:border-green-400 hover:shadow-md transition-all active:scale-95 group">
                            <div class="w-6 h-6 rounded-full bg-slate-50 text-slate-300 flex items-center justify-center group-hover:bg-green-500 group-hover:text-white transition-colors">
                                <i data-lucide="plus" width="14" stroke-width="3"></i>
                            </div>
                            <span class="text-[9px] font-bold text-slate-500 group-hover:text-slate-700">${WIDGETS[id].title}</span>
                        </button>
                    `).join('')}
                </div>
            </div>`;
        }
    }

    contentHtml += `</div>`;

    // Final Assembly
    container.innerHTML = `
        <div class="px-6 md:px-10 mt-2 fade-in ${isEditing ? 'editing-mode' : ''}">
            ${headerHtml}
            ${hintHtml}
            ${contentHtml}
        </div>
    `;

    if (activeLayout.includes('stats')) {
        // ใช้ setTimeout เล็กน้อยเพื่อให้ DOM สร้าง div เสร็จก่อน
        setTimeout(initOverviewMap, 200);
    }

    lucide.createIcons();

    if (STATE.historyList.length === 0 && activeLayout.includes('recent')) {
        fetchHistoryForHome(true);
    }
}

// ============================================================
// *** GLOBAL HELPERS (Move Widget Logic) ***
// ============================================================

// ฟังก์ชันเลื่อนลำดับ (ขึ้น/ลง)
window.moveWidget = function(widgetId, direction) {
    let currentLayout = STATE.userSettings.home_layout
        ? STATE.userSettings.home_layout.split(',')
        : Object.keys(WIDGETS);

    // Clean & Filter
    currentLayout = currentLayout.filter(id => WIDGETS[id]);

    const index = currentLayout.indexOf(widgetId);
    if (index === -1) return;

    const newIndex = index + direction;

    // ตรวจสอบว่าขยับได้หรือไม่ (ไม่หลุดขอบ)
    if (newIndex >= 0 && newIndex < currentLayout.length) {
        // Swap (สลับตำแหน่งใน Array)
        [currentLayout[index], currentLayout[newIndex]] = [currentLayout[newIndex], currentLayout[index]];

        // Update State
        STATE.userSettings.home_layout = currentLayout.join(',');

        // Re-render ทันที
        const mainContent = document.getElementById('main-content');
        if (mainContent) renderHomeContent(mainContent);

        // Save (Auto Save)
        saveHomeLayout();
    }
};

window.toggleHomeEditMode = function() {
    STATE.isHomeEditing = !STATE.isHomeEditing;
    const mainContent = document.getElementById('main-content');
    if (mainContent) renderHomeContent(mainContent);
    if (!STATE.isHomeEditing) saveHomeLayout();
};

window.toggleWidgetVisibility = function(widgetId) {
    let currentLayout = STATE.userSettings.home_layout
        ? STATE.userSettings.home_layout.split(',')
        : Object.keys(WIDGETS);

    currentLayout = currentLayout.filter(id => WIDGETS[id]);

    if (currentLayout.includes(widgetId)) {
        // Hide
        currentLayout = currentLayout.filter(id => id !== widgetId);
    } else {
        // Show (Add to end)
        currentLayout.push(widgetId);
    }

    STATE.userSettings.home_layout = currentLayout.join(',');

    const mainContent = document.getElementById('main-content');
    if (mainContent) renderHomeContent(mainContent);
    saveHomeLayout();
};

window.saveHomeLayout = async function() {
    const layoutStr = STATE.userSettings.home_layout;
    if (!STATE.user) return;

    const idToSend = STATE.user.employee_code || STATE.user.userid;

    try {
        await fetch(`${API_URL}/user-settings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                user_id: idToSend,
                key: 'home_layout',
                value: layoutStr
            })
        });
        console.log("💾 Layout Saved");
    } catch (e) {
        console.error("Save Layout Error", e);
    }
};

function generateMiniHistoryHTML(data) {
    const limited = data.slice(0, 3);
    if(limited.length === 0) return `<div class="text-center text-xs text-slate-400 py-4">No recent activity</div>`;

    return limited.map((item, index) => {
        const formConfig = STATE.config.forms.find(f => f.id === item.type_id) || { title: item.type_id, logoColor: 'bg-slate-500', icon: 'file' };
        return `
        <div onclick="openHistoryDetail('${item.id}')" class="glass-panel p-3 rounded-2xl flex gap-3 items-center cursor-pointer active:scale-95 transition-all slide-up" style="animation-delay: ${index * 100}ms">
            <div class="w-10 h-10 shrink-0 rounded-lg ${formConfig.logoColor} text-white flex items-center justify-center">
                <i data-lucide="${formConfig.icon}" width="18"></i>
            </div>
            <div class="flex-1 min-w-0">
                <h4 class="font-bold text-slate-800 text-xs truncate">${formConfig.title}</h4>
                <p class="text-[10px] text-slate-400">${new Date(item.created_at).toLocaleDateString()}</p>
            </div>
            <div class="px-2 py-1 bg-yellow-100 text-yellow-700 rounded text-[9px] font-bold">Pending</div>
        </div>`;
    }).join('');
}

async function fetchHistoryForHome(isBackground = false) {
    try {
        const res = await fetch(`${API_URL}/inspections`);
        if (!res.ok) throw new Error("Failed");
        const data = await res.json();

        STATE.historyList = data;
        STATE.historyCacheTime = Date.now();

        // Update DOM only if on Home
        if (STATE.view === 'home') {
            const container = document.getElementById('home-mini-history');
            if(container) {
                container.innerHTML = generateMiniHistoryHTML(data);
                lucide.createIcons();
            }
        }
    } catch(e) {}
}

// *** HISTORY PAGE ***
async function renderHistoryContent(container) {
    // 1. Render STATIC HEADER First
    container.innerHTML = `
        <div id="history-wrapper" class="px-6 md:px-12 mt-4 fade-in">
            <h3 class="text-lg font-bold text-slate-700 mb-4 px-2 flex items-center gap-2">
                <i data-lucide="history" class="text-brand-500"></i> ${t('history_title')}
            </h3>
            <div id="history-list-container">
                <div class="flex justify-center pt-10 opacity-0 animate-pulse"><i data-lucide="loader-2" class="text-brand-500" width="32"></i></div>
            </div>
        </div>
    `;
    lucide.createIcons();

    // 2. WAIT for Header Animation to Finish
    // ลดเวลาลงจาก 500ms เป็น 300ms เพื่อให้รู้สึกเร็วขึ้น
    setTimeout(() => {
        if (STATE.view !== 'history') return;

        const listContainer = document.getElementById('history-list-container');
        if (!listContainer) return;

        requestAnimationFrame(() => {
            if (STATE.historyList.length > 0) {
                // ถ้ามีข้อมูลใน Cache ให้แสดงเลย (ไม่ต้องรอ)
                listContainer.innerHTML = generateHistoryListHTML(STATE.historyList);
                lucide.createIcons();

                // *** FIXED: RESTORE SCROLL POSITION ***
                const scrollArea = document.getElementById('main-scroll-area');
                if(scrollArea && STATE.historyScrollPos) {
                    scrollArea.scrollTop = STATE.historyScrollPos;
                }

                // โหลด Background แบบเงียบๆ (Silent Update)
                fetchHistoryBackground();
            } else {
                // ถ้าไม่มีข้อมูล ให้แสดง Loader แล้วค่อยโหลด
                listContainer.innerHTML = `<div class="flex justify-center pt-10"><i data-lucide="loader-2" class="animate-spin text-brand-500" width="32"></i></div>`;
                lucide.createIcons();
                fetchHistoryBackground().then(() => {
                    // Restore scroll logic handled inside fetchHistoryBackground if needed,
                    // but usually init load starts at top.
                });
            }
        });
    }, 300);
}

function generateHistoryListHTML(data) {
    if (!data || data.length === 0) {
        return `<div class="flex flex-col items-center justify-center pt-12 text-slate-400 opacity-60 fade-in"><i data-lucide="clipboard-x" width="48" class="mb-4"></i><p>${t('history_empty')}</p></div>`;
    }

    return `<div class="space-y-3">
        ${data.map((item, index) => {
            const formConfig = STATE.config.forms.find(f => f.id === item.type_id) || { title: item.type_id, logoColor: 'bg-slate-500', icon: 'file' };
            const dateObj = new Date(item.created_at);
            const dateStr = dateObj.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute:'2-digit'});
            const hasImg = item.images && item.images.length > 0;

            return `
            <div onclick="openHistoryDetail('${item.id}')" class="glass-panel p-4 rounded-2xl flex gap-4 items-center cursor-pointer hover:scale-[1.01] active:scale-95 transition-all group shadow-sm slide-up" style="animation-delay: ${index * 50}ms">
                <div class="w-14 h-14 shrink-0 rounded-xl ${hasImg ? '' : formConfig.logoColor + ' text-white'} overflow-hidden relative shadow-md">
                    ${hasImg ? `<img src="${item.images[0]}" loading="lazy" class="w-full h-full object-cover">` : `<div class="w-full h-full flex items-center justify-center"><i data-lucide="${formConfig.icon}" width="24"></i></div>`}
                </div>
                <div class="flex-1 min-w-0">
                    <div class="flex justify-between items-start">
                        <h4 class="font-bold text-slate-800 text-sm truncate pr-2">${formConfig.title}</h4>
                        <span class="px-2 py-0.5 rounded-md bg-yellow-100 text-yellow-700 border border-yellow-200 text-[10px] font-bold whitespace-nowrap">${t('status_pending')}</span>
                    </div>
                    <p class="text-xs text-slate-500 flex items-center gap-1 mt-1 truncate"><i data-lucide="map-pin" width="10"></i> ${item.location}</p>
                    <p class="text-[10px] text-slate-400 mt-1">${dateStr}</p>
                </div>
                <div class="text-slate-300 group-hover:text-brand-500 transition-colors"><i data-lucide="chevron-right" width="20"></i></div>
            </div>`;
        }).join('')}
    </div>`;
}

async function fetchHistoryBackground() {
    try {
        const res = await fetch(`${API_URL}/inspections`);
        if (!res.ok) throw new Error("Failed to fetch");
        const data = await res.json();

        // *** FIX: ANTI-FLICKER LOGIC ***
        // ตรวจสอบว่าข้อมูลใหม่เหมือนกับข้อมูลเดิมหรือไม่ ถ้าเหมือนกันเป๊ะ ให้หยุดทำงานทันที (ไม่ Re-render)
        if (STATE.historyList && JSON.stringify(data) === JSON.stringify(STATE.historyList)) {
            // ข้อมูลไม่เปลี่ยน -> ไม่ต้องทำอะไร
            return;
        }

        STATE.historyList = data;
        STATE.historyCacheTime = Date.now();

        const container = document.getElementById('history-list-container');
        // ตรวจสอบว่ายังอยู่หน้า History หรือไม่ ก่อนจะอัปเดต DOM
        if (container && STATE.view === 'history') {
            container.innerHTML = generateHistoryListHTML(data);
            lucide.createIcons();

            // Restore Scroll Position (ถ้าเป็นการโหลดครั้งแรกหรือ Refresh เงียบๆ)
             const scrollArea = document.getElementById('main-scroll-area');
             if(scrollArea && STATE.historyScrollPos && STATE.historyScrollPos > 0) {
                 scrollArea.scrollTop = STATE.historyScrollPos;
             }
        }
    } catch (e) {
        // Handle Error เฉพาะกรณีที่ยังไม่มีข้อมูลใน List
        const container = document.getElementById('history-list-container');
        if(container && STATE.historyList.length === 0) {
            container.innerHTML = `<div class="flex flex-col items-center justify-center pt-10 text-slate-400"><i data-lucide="wifi-off" width="48" class="mb-2 opacity-50"></i><p class="text-sm font-medium">Connection Error</p></div>`;
            lucide.createIcons();
        }
    }
}

// *** NEW: Countermeasure Edit Helper Functions ***
function startCMEdit() {
    const report = STATE.selectedReport;
    if(!report) return;

    // Create deep copy of existing data to temp state for editing
    STATE.cmTempImages = {};
    const formConfig = STATE.config.forms.find(f => f.id === report.type_id);

    (formConfig.cm_fields || []).forEach(f => {
        if(f.type === 'image') {
            const existing = report.dynamic_data[f.id];
            STATE.cmTempImages[f.id] = Array.isArray(existing) ? [...existing] : (existing ? [existing] : []);
        }
    });

    STATE.isEditingCM = true;
    updateCMSectionOnly(); // Update only CM section, no full render
}

function cancelCMEdit() {
    STATE.isEditingCM = false;
    STATE.cmTempImages = {}; // clear temp
    updateCMSectionOnly(); // Update only CM section
}

// *** HELPER: GENERATE CM SECTION HTML (Extracted logic) ***
function getCMSectionHTML(report, formConfig) {
    const cmFields = formConfig.cm_fields || [];
    if (cmFields.length === 0) return '';

    let html = '';
    const isEditing = STATE.isEditingCM;
    const hasCMData = cmFields.some(f => report.dynamic_data[f.id]);

    html += `<div class="mt-8 relative">`;
    html += `<div class="absolute -top-8 left-8 w-0.5 h-8 bg-slate-200"></div>`; // Connector Line

    if (!isEditing && hasCMData) {
        // --- READ ONLY MODE ---
        html += `
        <div class="bg-white rounded-[2rem] p-6 shadow-sm border border-slate-100 relative overflow-hidden slide-up">
            <div class="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-orange-400 to-amber-500"></div>
            <div class="flex justify-between items-start mb-6">
                <div class="flex items-center gap-3">
                    <div class="w-12 h-12 rounded-2xl bg-orange-50 text-orange-500 flex items-center justify-center shadow-inner">
                        <i data-lucide="wrench" width="24"></i>
                    </div>
                    <div>
                        <h3 class="font-extrabold text-slate-800 text-lg">Countermeasure</h3>
                        <p class="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Corrective Action Taken</p>
                    </div>
                </div>
                <div class="text-right">
                    <div class="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Status</div>
                    <span class="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-green-100 text-green-700 text-xs font-bold border border-green-200">
                        <i data-lucide="check-circle-2" width="12"></i> Completed
                    </span>
                </div>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">`;

        cmFields.forEach(f => {
            const val = report.dynamic_data[f.id];
            let displayContent = '';

            if (f.type === 'image') {
                const imgs = Array.isArray(val) ? val : (val && val !== '-' ? [val] : []);
                if (imgs.length > 0) {
                    displayContent = `<div class="flex gap-2 overflow-x-auto pb-2">${imgs.map(src => `<img src="${src}" onclick="viewImage('${src}')" class="w-20 h-20 rounded-xl object-cover border border-slate-200 cursor-pointer hover:opacity-90">`).join('')}</div>`;
                } else {
                    displayContent = `<span class="text-slate-400 italic text-xs">No images attached</span>`;
                }
            } else {
                displayContent = `<div class="p-4 bg-slate-50 rounded-2xl text-sm font-semibold text-slate-700 border border-slate-100 group-hover:border-orange-200 transition-colors leading-relaxed">${val || '-'}</div>`;
            }

            html += `
            <div class="group ${f.type === 'image' ? 'col-span-2' : ''}">
                <label class="block text-[10px] font-extrabold text-slate-400 uppercase tracking-widest mb-2 group-hover:text-orange-500 transition-colors">${f.label}</label>
                ${displayContent}
            </div>`;
        });
        html += `</div>`;

        // Post-Correction Eval Result
        if (report.dynamic_data.eval_results_cm) {
            const res = report.dynamic_data.eval_results_cm;

            // --- Generate Details HTML ---
            let detailsHTML = '';
            const linkedEvals = formConfig.linked_evals_cm || [];

            if(linkedEvals.length > 0) {
                 detailsHTML = `<div id="eval-details-content-cm" class="hidden mt-4 pt-4 border-t border-slate-200 space-y-4">`;
                 linkedEvals.forEach(evalId => {
                     const evalConfig = STATE.config.evaluations.find(e => e.id === evalId);
                     if(evalConfig) {
                         detailsHTML += `<div class="mb-2"><h4 class="text-xs font-bold text-slate-700 mb-2">${evalConfig.name}</h4>`;

                         (evalConfig.assessments || []).forEach(assess => {
                             const key = `cm_${evalId}_${assess.id}`; // Context is 'cm'
                             const val = report.dynamic_data[key];

                             if (assess.type === 'text') {
                                 // NEW: Render Text for CM
                                 const textContent = val || '-';
                                 detailsHTML += `
                                 <div class="mb-3">
                                     <div class="text-[10px] text-slate-500 font-bold mb-1">${assess.name}</div>
                                     <div class="p-3 bg-slate-50 rounded-xl text-xs text-slate-700 border border-slate-100 italic">
                                        "${textContent}"
                                     </div>
                                 </div>`;
                             } else {
                                 // Render Score Bar
                                 const score = parseFloat(val) || 0;
                                 let maxScore = 10;
                                 if (assess.type === 'range') {
                                     maxScore = assess.max || 10;
                                 } else if (assess.options && assess.options.length > 0) {
                                     maxScore = Math.max(...assess.options.map(o => Number(o.score || 0)));
                                 }

                                 const percent = maxScore > 0 ? (score / maxScore) * 100 : 0;

                                 // ** FIXED: Color Coding & Rounded Ends & Safety Logic **
                                 let barColor = 'bg-red-500';
                                 if (formConfig.category === 'S') {
                                     // Safety: High Score = Red (Danger/Risk), Low Score = Green (Safe)
                                     if(percent >= 80) barColor = 'bg-red-500';
                                     else if(percent >= 50) barColor = 'bg-yellow-500';
                                     else barColor = 'bg-green-500';
                                 } else {
                                     // Standard: High Score = Green (Good), Low Score = Red (Bad)
                                     if(percent >= 80) barColor = 'bg-green-500';
                                     else if(percent >= 50) barColor = 'bg-yellow-500';
                                     else barColor = 'bg-red-500';
                                 }

                                 detailsHTML += `
                                 <div class="mb-2">
                                     <div class="flex justify-between text-[10px] text-slate-500 font-bold mb-1">
                                         <span>${assess.name}</span>
                                         <span>${score}/${maxScore}</span>
                                     </div>
                                     <div class="h-2 w-full bg-white rounded-full overflow-hidden border border-slate-200">
                                         <div class="h-full ${barColor} rounded-full" style="width: ${percent}%"></div>
                                     </div>
                                 </div>`;
                             }
                         });
                         detailsHTML += `</div>`;
                     }
                 });
                 detailsHTML += `</div>`;
            }

            // --- Update Main HTML ---
            html += `
            <div class="mt-6 p-1 rounded-2xl bg-gradient-to-r from-slate-100 to-slate-200 transition-all duration-300">

                <div class="flex items-center justify-between mb-2 px-2 pt-1">
                    <div class="flex items-center gap-2">
                         <i data-lucide="bar-chart-3" class="text-slate-400" width="14"></i>
                         <label class="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Post-Correction Assessment</label>
                    </div>
                     ${detailsHTML ? `<button onclick="toggleEvalDetailsCM(this)" class="text-[10px] font-bold text-slate-500 hover:text-slate-700 bg-white border border-slate-200 px-3 py-1 rounded-full flex items-center gap-1 transition-all">Show Details <i data-lucide="chevron-down" width="12"></i></button>` : ''}
                </div>

                <div class="bg-white rounded-xl p-4 flex justify-between items-center relative overflow-hidden shadow-sm">
                    <div class="absolute right-0 top-0 h-full w-32 bg-gradient-to-l from-green-50 to-transparent pointer-events-none"></div>
                    <div class="relative z-10 flex items-center gap-4">
                        <div class="w-10 h-10 rounded-full bg-green-100 text-green-600 flex items-center justify-center border-2 border-white shadow-sm">
                            <i data-lucide="check-circle" width="18"></i>
                        </div>
                        <div>
                            <div class="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest">Total Score</div>
                            <div class="text-2xl font-black text-slate-800">${res.total}</div>
                        </div>
                    </div>
                    <div class="relative z-10 text-right">
                        <div class="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest mb-1">Result</div>
                        <span class="px-4 py-1.5 rounded-lg text-white text-xs font-bold shadow-md" style="background-color: ${res.color || '#22c55e'}">${res.rank}</span>
                    </div>
                </div>

                ${detailsHTML}
            </div>`;
        }
        html += `</div>`;

    } else if (isEditing) {
        // --- EDIT MODE ---
        html += `
        <div class="bg-white rounded-[2rem] shadow-xl shadow-orange-100/50 border border-orange-100 overflow-hidden slide-up">
            <div class="px-6 py-5 bg-gradient-to-r from-orange-500 to-amber-500 text-white flex justify-between items-center">
                <div class="flex items-center gap-3">
                    <div class="w-10 h-10 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center">
                        <i data-lucide="edit-3" width="20"></i>
                    </div>
                    <div>
                        <h3 class="font-bold text-lg">Update Countermeasure</h3>
                        <p class="text-orange-100 text-xs font-medium">Please provide details of the fix.</p>
                    </div>
                </div>
                <button onclick="cancelCMEdit()" class="p-2 bg-white/10 hover:bg-white/20 rounded-full transition text-white">
                    <i data-lucide="x" width="20"></i>
                </button>
            </div>

            <div class="p-6 md:p-8 space-y-6">`;

        html += cmFields.map(field => {
            let inputHtml = '';
            const val = report.dynamic_data[field.id] || '';
            const baseClass = "w-full p-4 bg-slate-50 border-2 border-slate-100 rounded-xl text-slate-700 text-sm font-bold outline-none focus:border-orange-400 focus:bg-white transition-all placeholder:text-slate-300";

            if (field.type === 'textarea') {
                inputHtml = `<textarea id="cm_${field.id}" rows="3" class="${baseClass}" placeholder="Describe details...">${val}</textarea>`;
            } else if (field.type === 'date') {
                // *** IMPROVED DATE INPUT FOR COUNTERMEASURE ***
                inputHtml = `
                <div class="relative">
                    <input id="cm_${field.id}" type="date" value="${val}" class="${baseClass} appearance-none pr-12 cursor-pointer" style="min-height: 54px;">
                    <div class="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                        <i data-lucide="calendar" width="20"></i>
                    </div>
                </div>`;
            } else if (field.type === 'image') {
                const tempImgs = STATE.cmTempImages[field.id] || [];
                inputHtml = `
                <div id="cm_gallery_${field.id}" class="flex flex-wrap gap-3">
                    <button onclick="document.getElementById('cm_upload_${field.id}').click()" class="w-20 h-20 rounded-xl border-2 border-dashed border-orange-300 bg-orange-50 text-orange-400 hover:bg-orange-100 hover:text-orange-600 flex items-center justify-center transition-all">
                        <i data-lucide="plus" width="24"></i>
                    </button>
                    <input type="file" id="cm_upload_${field.id}" hidden accept="image/*" multiple onchange="handleCMImageUpload('${field.id}', this)">
                    ${tempImgs.map((src, i) => `
                        <div class="relative w-20 h-20 group">
                            <img src="${src}" class="w-full h-full object-cover rounded-xl border border-slate-200 shadow-sm">
                            <button onclick="removeCMImage('${field.id}', ${i})" class="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center shadow-md hover:scale-110 transition z-10"><i data-lucide="x" width="14"></i></button>
                        </div>
                    `).join('')}
                </div>`;
            } else {
                inputHtml = `<input id="cm_${field.id}" type="text" value="${val}" class="${baseClass}" placeholder="Type here...">`;
            }

            return `<div><label class="block text-xs font-extrabold text-slate-500 uppercase tracking-wider mb-2 ml-1">${field.label}</label>${inputHtml}</div>`;
        }).join('');

        const evalHtml = renderEvaluationSection(formConfig.linked_evals_cm, 'cm');
        if(evalHtml) {
            html += `
            <div class="pt-6 border-t border-slate-100">
                <div class="flex items-center gap-2 mb-4">
                    <i data-lucide="clipboard-check" class="text-orange-500" width="18"></i>
                    <h4 class="font-extrabold text-slate-700 text-sm uppercase tracking-wide">Post-Correction Evaluation</h4>
                </div>
                ${evalHtml}
            </div>`;
        }

        html += `
                <div class="flex gap-3 pt-4">
                    <button onclick="cancelCMEdit()" class="flex-1 py-3.5 rounded-xl border-2 border-slate-100 text-slate-500 font-bold text-sm hover:bg-slate-50 hover:text-slate-700 transition-all">Cancel</button>
                    <button onclick="submitCountermeasure(${report.id})" class="flex-[2] py-3.5 rounded-xl bg-gradient-to-r from-orange-500 to-amber-600 text-white font-bold text-sm shadow-lg shadow-orange-200 hover:shadow-xl hover:scale-[1.02] active:scale-95 transition-all flex items-center justify-center gap-2">
                        <i data-lucide="save" width="18"></i> Save Countermeasure
                    </button>
                </div>
            </div>
        </div>`;

    } else {
        // --- EMPTY STATE (Add Button) ---
        html += `
        <button onclick="startCMEdit()" class="w-full group relative overflow-hidden bg-white p-6 rounded-[2rem] shadow-sm border-2 border-dashed border-slate-200 hover:border-orange-300 transition-all duration-300 active:scale-95">
            <div class="absolute inset-0 bg-orange-50/50 opacity-0 group-hover:opacity-100 transition-opacity"></div>
            <div class="relative z-10 flex flex-col items-center justify-center gap-3 text-center">
                <div class="w-14 h-14 rounded-full bg-slate-50 group-hover:bg-orange-100 text-slate-400 group-hover:text-orange-500 flex items-center justify-center transition-colors">
                    <i data-lucide="plus" width="28" stroke-width="3"></i>
                </div>
                <div>
                    <h3 class="font-bold text-slate-700 group-hover:text-orange-700 transition-colors">Add Countermeasure</h3>
                    <p class="text-xs text-slate-400 font-medium mt-1">Record corrective actions and re-evaluate</p>
                </div>
            </div>
        </button>`;
    }
    html += `</div>`;
    return html;
}

// ** NEW HELPER: Updates only CM section DOM (Prevents scroll jump) **
function updateCMSectionOnly() {
    const container = document.getElementById('cm-section-container');
    if(container && STATE.selectedReport) {
        const formConfig = STATE.config.forms.find(f => f.id === STATE.selectedReport.type_id);
        container.innerHTML = getCMSectionHTML(STATE.selectedReport, formConfig);
        lucide.createIcons();
    }
}

// *** FIX: Use Partial Update for CM Images to avoid scroll jump ***
window.handleCMImageUpload = async (fieldId, input) => {
    if(input.files && input.files.length > 0) {
        // Use Promise.all to read multiple files efficiently
        const promises = Array.from(input.files).map(file => {
            return new Promise((resolve) => {
                const reader = new FileReader();
                reader.onload = (e) => resolve(e.target.result);
                reader.readAsDataURL(file);
            });
        });

        const newImages = await Promise.all(promises);

        if(!STATE.cmTempImages[fieldId]) STATE.cmTempImages[fieldId] = [];
        STATE.cmTempImages[fieldId].push(...newImages);

        // **KEY CHANGE**: Call partial update instead of full render
        updateCMImageGallery(fieldId);
    }
    input.value = ''; // Reset input to allow selecting same file again
};

window.removeCMImage = (fieldId, index) => {
    if(STATE.cmTempImages[fieldId]) {
        STATE.cmTempImages[fieldId].splice(index, 1);
        // **KEY CHANGE**: Call partial update instead of full render
        updateCMImageGallery(fieldId);
    }
};

// ** NEW HELPER: Updates only the image gallery container in DOM **
function updateCMImageGallery(fieldId) {
    const container = document.getElementById(`cm_gallery_${fieldId}`);
    if(!container) return; // Guard clause

    const tempImgs = STATE.cmTempImages[fieldId] || [];

    // Regenerate inner HTML for gallery only
    container.innerHTML = `
        <button onclick="document.getElementById('cm_upload_${fieldId}').click()" class="w-20 h-20 rounded-xl border-2 border-dashed border-orange-300 bg-orange-50 text-orange-400 hover:bg-orange-100 hover:text-orange-600 flex items-center justify-center transition-all">
            <i data-lucide="plus" width="24"></i>
        </button>
        <input type="file" id="cm_upload_${fieldId}" hidden accept="image/*" multiple onchange="handleCMImageUpload('${fieldId}', this)">

        ${tempImgs.map((src, i) => `
            <div class="relative w-20 h-20 group">
                <img src="${src}" class="w-full h-full object-cover rounded-xl border border-slate-200 shadow-sm">
                <button onclick="removeCMImage('${fieldId}', ${i})" class="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center shadow-md hover:scale-110 transition z-10"><i data-lucide="x" width="14"></i></button>
            </div>
        `).join('')}
    `;
    lucide.createIcons(); // Refresh icons for the new buttons
}

// ** NEW HELPER: Toggle Evaluation Details **
window.toggleEvalDetails = (btn) => {
    const content = document.getElementById('eval-details-content');
    if(!content) return;

    if(content.classList.contains('hidden')) {
        content.classList.remove('hidden');
        content.classList.add('fade-in'); // simple fade effect
        btn.innerHTML = `Hide Details <i data-lucide="chevron-up" width="12"></i>`;
    } else {
        content.classList.add('hidden');
        btn.innerHTML = `Show Details <i data-lucide="chevron-down" width="12"></i>`;
    }
    lucide.createIcons();
};

// ** NEW HELPER: Toggle CM Evaluation Details **
window.toggleEvalDetailsCM = (btn) => {
    const content = document.getElementById('eval-details-content-cm');
    if(!content) return;

    if(content.classList.contains('hidden')) {
        content.classList.remove('hidden');
        content.classList.add('fade-in');
        btn.innerHTML = `Hide Details <i data-lucide="chevron-up" width="12"></i>`;
    } else {
        content.classList.add('hidden');
        btn.innerHTML = `Show Details <i data-lucide="chevron-down" width="12"></i>`;
    }
    lucide.createIcons();
};

// *** FORM & REPORTING ***
function updateBottomNav() {
    const container = document.getElementById('bottom-nav-container');
    if(!container) return;

    container.innerHTML = `
        <div class="nav-center-curve">
            <div class="flex-1 flex justify-around pr-12">
                <button onclick="switchNavTab('home')" class="flex flex-col items-center justify-center gap-1 transition-all">
                    <i data-lucide="home" class="${STATE.navTab === 'home' ? 'text-brand-600 fill-brand-50' : 'text-slate-400'}" width="${STATE.navTab === 'home'?24:22}"></i>
                </button>
                <button onclick="switchNavTab('history')" class="flex flex-col items-center justify-center gap-1 transition-all">
                    <i data-lucide="clock" class="${STATE.navTab === 'history' ? 'text-brand-600 fill-brand-50' : 'text-slate-400'}" width="${STATE.navTab === 'history'?24:22}"></i>
                </button>
            </div>

            <div class="flex-1 flex justify-around pl-12">
                    <button onclick="switchNavTab('notify')" class="flex flex-col items-center justify-center gap-1 transition-all">
                        <i data-lucide="bell" class="${STATE.navTab === 'notify' ? 'text-brand-600 fill-brand-50' : 'text-slate-400'}" width="${STATE.navTab === 'notify'?24:22}"></i>
                </button>
                <button onclick="switchNavTab('profile')" class="flex flex-col items-center justify-center gap-1 transition-all">
                    <i data-lucide="user" class="${STATE.navTab === 'profile' ? 'text-brand-600 fill-brand-50' : 'text-slate-400'}" width="${STATE.navTab === 'profile'?24:22}"></i>
                </button>
            </div>
        </div>

        <div class="floating-btn-wrapper">
            <button onclick="openReportMenu()" class="w-full h-full bg-gradient-to-b from-blue-400 to-brand-500 rounded-full flex items-center justify-center text-white shadow-lg hover:scale-105 active:scale-95 transition-all">
                <i data-lucide="plus" width="32" stroke-width="3"></i>
            </button>
        </div>
    `;
    lucide.createIcons();
}

function switchNavTab(tabId) {
    // *** FIXED: Reset scroll position if switching tabs explicitly ***
    if(tabId === 'history') STATE.historyScrollPos = 0;

    STATE.navTab = tabId;
    STATE.view = tabId;
    render();
}

// *** FAVORITES LOGIC ***

// 1. โหลดข้อมูลดาว (เรียกตอน Login สำเร็จ)
async function fetchUserFavorites() {
    if (!STATE.user) return;
    const idToFetch = STATE.user.employee_code || STATE.user.userid;

    try {
        const res = await fetch(`${API_URL}/favorites/${idToFetch}`);
        if (res.ok) {
            STATE.favorites = await res.json();
            // Re-render หน้าจอถ้าจำเป็น
            if (STATE.view === 'home') {
                 const mainContent = document.getElementById('main-content');
                 if (mainContent) renderHomeContent(mainContent);
            }
        }
    } catch (e) {
        console.error("Failed to load favorites", e);
    }
}

// 3. ฟังก์ชันกดดาว (Toggle Favorite)
async function toggleFavorite(event, formId) {
    event.stopPropagation(); // ห้ามกดทะลุไปเปิดฟอร์ม
    if (!STATE.user) return alert("Please login first");

    // A. Optimistic Update (อัปเดตตัวแปรทันทีให้ User รู้สึกเร็ว)
    const index = STATE.favorites.indexOf(formId);
    if (index === -1) {
        STATE.favorites.push(formId); // เพิ่ม
    } else {
        STATE.favorites.splice(index, 1); // ลบ
    }

    // B. Re-render UI ทันที
    openReportMenu(); // อัปเดตใน Modal เลือกฟอร์ม
    if (STATE.view === 'home') {
        const mainContent = document.getElementById('main-content');
        if (mainContent) renderHomeContent(mainContent); // อัปเดต Widget Quick Access
    }

    // C. ส่งข้อมูลไปบันทึกที่ Server (Background)
    const idToSend = STATE.user.employee_code || STATE.user.userid;
    try {
        await fetch(`${API_URL}/favorites`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: idToSend, form_id: formId })
        });
    } catch (e) {
        console.error("Fav Error", e);
    }
}

function openReportMenu() {
    const container = document.getElementById('report-grid-container');
    const groupedForms = { S: [], L: [], Q: [], D: [], C: [], O: [] };

    STATE.config.forms.forEach(f => {
        const cat = f.category || 'O';
        if(groupedForms[cat]) groupedForms[cat].push(f);
        else groupedForms['O'].push(f);
    });

    // หา Form ที่ User กดดาวไว้
    const favoriteForms = STATE.config.forms.filter(f => STATE.favorites.includes(f.id));

    let htmlContent = '';

    // --- 1. RENDER FAVORITES SECTION (ถ้ามี) ---
    if (favoriteForms.length > 0) {
        htmlContent += `
        <div class="mb-4">
            <div class="flex items-center gap-2 mb-2 ml-1">
                <i data-lucide="star" class="text-yellow-400 fill-yellow-400" width="16"></i>
                <h3 class="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest">FAVORITES</h3>
            </div>
            <div class="flex gap-3 overflow-x-auto pb-4 no-scrollbar">
                ${renderFormCards(favoriteForms)}
                <div class="w-2 shrink-0"></div>
            </div>
            <div class="h-[1px] bg-slate-100 w-full mb-4"></div>
        </div>`;
    }

    // --- 2. RENDER ALL CATEGORIES ---
    htmlContent += Object.keys(groupedForms).map(cat => {
        if(groupedForms[cat].length === 0) return '';
        const info = CATEGORIES[cat];
        return `
        <div class="mb-2">
            <div class="flex items-center gap-2 mb-2 ml-1">
                <div class="w-2 h-2 rounded-full ${info.color.split(' ')[0].replace('text','bg')}"></div>
                <h3 class="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest">${info.label}</h3>
            </div>
            <div class="flex gap-3 overflow-x-auto pb-4 no-scrollbar">
                ${renderFormCards(groupedForms[cat])}
                <div class="w-2 shrink-0"></div>
            </div>
        </div>
        `;
    }).join('');

    container.innerHTML = htmlContent;
    lucide.createIcons();
    document.getElementById('report-selector-modal').classList.remove('hidden');
    document.getElementById('report-selector-modal').classList.add('flex');
}

// Helper: สร้าง HTML ของการ์ด (ใช้ร่วมกันทั้ง Fav และหมวดปกติ)
function renderFormCards(forms) {
    return forms.map(f => {
        const isFav = STATE.favorites.includes(f.id);
        // ถ้าเป็น Fav ให้ดาวสีเหลือง+ถมดำ, ถ้าไม่ ให้ดาวสีเทา+โปร่ง
        const starClass = isFav
            ? "text-yellow-400 fill-yellow-400"
            : "text-slate-300 hover:text-yellow-400";

        return `
        <button onclick="startForm('${f.id}'); closeReportSelector()" class="relative shrink-0 w-28 h-28 bg-slate-50/80 border border-slate-100 p-3 rounded-2xl flex flex-col items-center justify-center gap-2 hover:scale-[1.05] active:scale-95 transition-all duration-200 group shadow-sm hover:shadow-md snap-center">

            <div onclick="toggleFavorite(event, '${f.id}')" class="absolute top-2 right-2 z-10 p-1.5 rounded-full hover:bg-white/50 transition-all active:scale-90">
                <i data-lucide="star" class="${starClass}" width="16"></i>
            </div>

            <div class="w-10 h-10 rounded-xl ${f.logoColor || f.color} text-white flex items-center justify-center shadow-sm mt-1">
                <i data-lucide="${f.icon}" width="20"></i>
            </div>
            <span class="font-bold text-slate-700 text-xs text-center leading-tight line-clamp-2 w-full px-1">${f.title}</span>
        </button>
        `;
    }).join('');
}

function closeReportSelector() {
    document.getElementById('report-selector-modal').classList.add('hidden');
    document.getElementById('report-selector-modal').classList.remove('flex');
}

function startForm(formId) {
    // แก้ไข: ให้ Location เริ่มต้นเป็นค่าว่าง "" (ไม่ต้องดึงตัวแรกมา)
    STATE.formData = {
        type_id: formId,
        location: "", // <--- แก้ตรงนี้
        answers: {},
        images: [],
        gps: null,
        aiHint: ''
    };
    STATE.evalScores = {};
    STATE.view = 'form';
    render();
}

// *** DYNAMIC EVALUATION RENDERING (REDESIGNED - FIX SCROLL JUMP) ***
function renderEvaluationSection(evalIds, context = 'report') {
    if (!evalIds || evalIds.length === 0) return '';

    return evalIds.map(evalId => {
        const evalConfig = STATE.config.evaluations.find(e => e.id === evalId);
        if (!evalConfig) return '';

        // Calculate Result Logic (Initial)
        const result = calculateEvalResult(evalConfig, context);

        const itemsHTML = evalConfig.assessments.map((assess, index) => {
            let inputHTML = '';
            const key = `${context}_${evalId}_${assess.id}`;
            const currentVal = STATE.evalScores[key] || 0;

            if (assess.type === 'range') {
                const percent = ((currentVal - assess.min) / (assess.max - assess.min)) * 100;
                inputHTML = `
                <div class="mt-4 px-2">
                    <div class="flex justify-between text-xs font-bold text-slate-400 mb-2">
                        <span>${assess.min}</span>
                        <span id="val_disp_${key}" class="text-brand-600 text-lg">${currentVal}</span>
                        <span>${assess.max}</span>
                    </div>
                    <input type="range" min="${assess.min}" max="${assess.max}" step="1" value="${currentVal}"
                        oninput="updateEvalScore('${context}', '${evalId}', '${assess.id}', parseFloat(this.value), this)"
                        class="range-track w-full h-3 bg-slate-100 rounded-full appearance-none cursor-pointer accent-brand-500"
                        style="background: linear-gradient(to right, #0ea5e9 ${percent}%, #f1f5f9 ${percent}%);">
                </div>`;
            } else if (assess.type === 'text') {
                // NEW: Text Input Renderer
                const textVal = STATE.evalScores[key] || '';
                inputHTML = `
                <div class="mt-3">
                    <textarea
                        onchange="updateEvalScore('${context}', '${evalId}', '${assess.id}', this.value, this)"
                        class="w-full p-3 glass-input rounded-xl text-sm text-slate-700 outline-none focus:ring-2 focus:ring-brand-500 transition-all placeholder:text-slate-300"
                        rows="2"
                        placeholder="Type comments...">${textVal}</textarea>
                </div>`;
            } else {
                // Fixed: Use peer-checked logic to avoid re-rendering
                inputHTML = `
                <div class="grid grid-cols-1 gap-2 mt-3">
                    ${(assess.options || []).map(opt => {
                        const isSelected = currentVal === opt.score;
                        return `
                        <label class="cursor-pointer relative group">
                            <input type="radio" name="radio_${key}" value="${opt.score}" ${isSelected ? 'checked' : ''}
                                onchange="updateEvalScore('${context}', '${evalId}', '${assess.id}', parseFloat(this.value), this)"
                                class="hidden peer">
                            <div class="p-3 rounded-xl border transition-all flex items-center justify-between
                                bg-white border-slate-100 text-slate-600
                                peer-checked:bg-brand-50 peer-checked:border-brand-500 peer-checked:text-brand-700 peer-checked:shadow-md peer-checked:ring-1 peer-checked:ring-brand-200
                                hover:border-slate-300 hover:bg-slate-50">
                                <span class="text-xs font-bold">${opt.label}</span>
                                <span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-400 peer-checked:bg-brand-200 peer-checked:text-brand-800">${opt.score}</span>
                            </div>
                        </label>
                        `;
                    }).join('')}
                </div>`;
            }

            return `
            <div class="mb-6 last:mb-0">
                <div class="flex items-center gap-2 mb-1">
                    <div class="w-6 h-6 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center text-[10px] font-bold border border-slate-200">${index + 1}</div>
                    <label class="text-sm font-bold text-slate-700">${assess.name}</label>
                </div>
                ${inputHTML}
            </div>`;
        }).join('');

        // Result Summary Card with IDs for DOM updates
        return `
        <div class="bg-white/60 backdrop-blur-md p-5 rounded-[2rem] shadow-sm border border-white/50 mb-6">
            <div class="flex items-center gap-3 mb-6 pb-4 border-b border-slate-100/50">
                <div class="w-10 h-10 rounded-2xl bg-gradient-to-br from-brand-500 to-indigo-600 text-white flex items-center justify-center shadow-lg shadow-brand-200">
                    <i data-lucide="clipboard-check" width="20"></i>
                </div>
                <div>
                    <h3 class="font-bold text-slate-800 text-base">${evalConfig.name}</h3>
                    <p class="text-[10px] text-slate-400 font-medium uppercase tracking-wider">Evaluation Section</p>
                </div>
            </div>

            <div class="px-1">
                ${itemsHTML}
            </div>

            <div class="mt-6 bg-slate-50 rounded-2xl p-4 border border-slate-100 flex justify-between items-center relative overflow-hidden group">
                 <div class="absolute inset-0 bg-gradient-to-r from-white/0 via-white/50 to-white/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000 pointer-events-none"></div>
                 <div>
                    <span class="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest block mb-0.5">Total Score</span>
                    <span id="total_${context}_${evalId}" class="text-2xl font-black text-slate-800 tracking-tight">${result.score}</span>
                 </div>
                 <div class="text-right">
                    <span class="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest block mb-1">Result</span>
                    <span id="badge_${context}_${evalId}" class="inline-block px-4 py-1.5 rounded-xl text-white text-xs font-bold shadow-sm transform transition-transform duration-300 scale-100" style="background-color: ${result.color};">${result.label}</span>
                 </div>
            </div>
        </div>`;
    }).join('');
}

// ** Fixed: Do NOT re-render whole form, just patch DOM **
window.updateEvalScore = (context, evalId, assessId, val, inputEl) => {
    // 1. Update State
    STATE.evalScores[`${context}_${evalId}_${assessId}`] = val;

    // 2. Update Slider Visuals (if range input)
    if(inputEl && inputEl.type === 'range') {
        // Update number display
        const disp = document.getElementById(`val_disp_${context}_${evalId}_${assessId}`);
        if(disp) disp.innerText = val;

        // Update track gradient
        const min = parseFloat(inputEl.min);
        const max = parseFloat(inputEl.max);
        const percent = ((val - min) / (max - min)) * 100;
        inputEl.style.background = `linear-gradient(to right, #0ea5e9 ${percent}%, #f1f5f9 ${percent}%)`;
    }

    // 3. Recalculate Result
    const evalConfig = STATE.config.evaluations.find(e => e.id === evalId);
    if(evalConfig) {
        const result = calculateEvalResult(evalConfig, context);

        // 4. Update Result UI (Patching)
        const totalEl = document.getElementById(`total_${context}_${evalId}`);
        const badgeEl = document.getElementById(`badge_${context}_${evalId}`);

        if(totalEl) totalEl.innerText = result.score;
        if(badgeEl) {
            badgeEl.innerText = result.label;
            badgeEl.style.backgroundColor = result.color;
        }
    }
    // Note: Radio buttons style update is handled by CSS peer-checked, no JS needed here.
};

function calculateEvalResult(evalConfig, context) {
    let score = 0;

    // 1. Calculate Score based on Formula
    if(evalConfig.formula && evalConfig.formula.trim() !== "") {
        let formulaStr = evalConfig.formula;
        evalConfig.assessments.forEach(a => {
            if(a.type !== 'text') { // Skip text fields in calculation logic
                const val = STATE.evalScores[`${context}_${evalConfig.id}_${a.id}`] || 0;
                const re = new RegExp(`\\b${a.id}\\b`, 'g');
                formulaStr = formulaStr.replace(re, val);
            }
        });
        try {
            if(/^[0-9+\-*/().\s]+$/.test(formulaStr)) {
                score = eval(formulaStr);
            } else { score = 0; }
        } catch(e) { score = 0; }

        score = Math.round(score * 100) / 100;
    } else {
        // Fallback: Sum (Sum only numeric fields)
        evalConfig.assessments.forEach(a => {
            if(a.type !== 'text') {
                 score += (STATE.evalScores[`${context}_${evalConfig.id}_${a.id}`] || 0);
            }
        });
    }

    // 2. Determine Rank
    let label = "-";
    let color = "#94a3b8"; // slate-400

    if(evalConfig.logic) {
        for(const rule of evalConfig.logic) {
            if(score >= rule.min && score <= rule.max) {
                label = rule.label;
                color = rule.hexColor || rule.color || "#3b82f6";
                break;
            }
        }
    }

    return { score, label, color };
}

if (!STATE.employeesCache) STATE.employeesCache = [];

async function checkAiAvailability() {
    const aiButton = document.getElementById('ai-analyze-btn'); // ตรวจสอบ ID ให้ตรงกับใน renderForm
    const aiBadge = document.getElementById('ai-status-badge');

    if (!aiButton) return; // ป้องกัน Error ถ้าไม่ได้อยู่ในหน้าที่มีปุ่ม AI

    try {
        const response = await fetch(`${API_URL}/ai-check-status`); // ใช้ API_URL ที่ประกาศไว้ในไฟล์
        if (response.ok) {
            aiButton.disabled = false;
            aiButton.classList.remove('opacity-50', 'grayscale'); // คืนค่าสีปุ่ม
        } else {
            throw new Error("Quota Full");
        }
    } catch (error) {
        aiButton.disabled = true;
        aiButton.classList.add('opacity-50', 'grayscale'); // ทำให้ปุ่มดูจางลง
        aiButton.title = "ขณะนี้โควตา AI เต็มแล้ว";
        console.warn("Gemini AI Quota Full.");
    }
}

function renderForm(c) {
    const formConfig = STATE.config.forms.find(f => f.id === STATE.formData.type_id);
    const inputClass = "w-full p-4 glass-input rounded-xl text-slate-700 text-sm font-medium outline-none focus:ring-2 focus:ring-brand-500 transition-all";

    // เช็คโหลดข้อมูลพนักงานหากมีฟิลด์ประเภท personnel
    const hasPersonnelField = formConfig.fields.some(f => f.type === 'personnel');
    if (hasPersonnelField && STATE.employeesCache.length === 0) {
        fetchEmployees().then(() => { if (STATE.view === 'form') renderForm(c); });
    }

    const fieldsHTML = formConfig.fields.map((field, idx) => {
        const val = STATE.formData.answers[field.id];
        const requiredMark = field.is_required ? '<span class="text-red-400 ml-1">*</span>' : '';
        let inputHtml = '';

        // --- CASE: PERSONNEL (ระบบเลือกพนักงาน/กลุ่ม) ---
        if (field.type === 'personnel') {
            const mode = field.personnel_mode || 'user_select';

            if (mode === 'admin_fixed') {
                let displayMembers = [];
                if (!field.source || field.source === 'manual') displayMembers = (field.fixed_members || []).map(m => m.name);
                else if (field.source === 'group' && field.group_id) {
                    const group = (STATE.config.notify_groups || []).find(g => g.id === field.group_id);
                    if (group) displayMembers = [`👥 ${group.name}`];
                }
                else if (field.source === 'location') {
                     if(val) displayMembers = [val];
                }
                const savedValue = displayMembers.join(', ');
                if(field.source !== 'location' || !STATE.formData.answers[field.id]) STATE.formData.answers[field.id] = savedValue;

                inputHtml = `
                <div class="w-full p-3 bg-slate-100 rounded-xl border border-slate-200 relative group cursor-not-allowed">
                    <div class="absolute top-2 right-2 text-slate-400"><i data-lucide="lock" width="14"></i></div>
                    <div class="flex flex-wrap gap-2" id="tags_${field.id}">
                        ${displayMembers.length > 0 ? displayMembers.map(name => {
                            const isGroup = name.includes('👥');
                            const clickAction = isGroup ? `onclick="viewGroupMembers('${name}')"` : '';
                            const cursorStyle = isGroup ? 'cursor-pointer hover:bg-indigo-50 hover:border-indigo-300 transition-all pointer-events-auto' : '';
                            return `<div ${clickAction} class="flex items-center gap-2 px-3 py-1 bg-white border border-slate-200 rounded-full shadow-sm ${cursorStyle}"><div class="w-6 h-6 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-[10px] font-bold">${name.includes('👥') ? 'G' : name.charAt(0)}</div><span class="text-xs font-bold text-slate-700">${name}</span></div>`;
                        }).join('') : '<span class="text-xs text-slate-400 italic">Select Location to fill</span>'}
                    </div>
                    <input type="hidden" id="field_${field.id}" value="${savedValue}">
                </div>`;
            } else {
                let list = STATE.employeesCache || [];
                if (field.source === 'group' && field.group_id) {
                    const group = (STATE.config.notify_groups || []).find(g => g.id === field.group_id);
                    if (group && group.members) {
                        const memberCodes = group.members.map(m => String(m.code));
                        list = list.filter(e => memberCodes.includes(String(e.employee_code)));
                    }
                }
                const displayValue = val || t('select_option');
                const isGroupSelected = displayValue.includes('👥');
                const textColor = val ? 'text-slate-700 font-bold' : 'text-slate-400 font-normal';
                const extraClass = (field.source === 'location' && val) ? 'bg-brand-50 border-brand-200' : 'bg-white';

                inputHtml = `
                <div class="relative group emp-selector-container" style="z-index: ${50 - idx};">
                    <div class="${inputClass} flex justify-between items-center ${textColor} ${extraClass} relative z-10" id="disp_${field.id}">
                        <div onclick="toggleUserEmpSearch('${field.id}')" class="flex-1 flex items-center gap-2 cursor-pointer overflow-hidden"><span class="truncate pointer-events-none">${displayValue}</span></div>
                        <div class="flex items-center gap-2 pl-2">
                            ${isGroupSelected ? `<button onclick="viewGroupMembers('${displayValue}')" class="p-1.5 bg-indigo-100 text-indigo-600 rounded-full hover:bg-indigo-200 transition-colors"><i data-lucide="users" width="14"></i></button>` : ''}
                            <div onclick="toggleUserEmpSearch('${field.id}')" class="cursor-pointer flex items-center gap-1">${(field.source === 'location' && val) ? '<i data-lucide="zap" width="12" class="text-brand-500"></i>' : ''}<i data-lucide="chevron-down" width="16" class="text-slate-400"></i></div>
                        </div>
                    </div>
                    <input type="hidden" id="field_${field.id}" value="${val||''}">
                    <div id="list_panel_${field.id}" class="hidden absolute top-full left-0 w-full bg-white border border-slate-200 rounded-xl shadow-2xl mt-1 overflow-hidden slide-up-sm ring-1 ring-black/5 z-50">
                        <div class="p-2 border-b border-slate-100 bg-slate-50 sticky top-0 z-20"><input type="text" id="search_${field.id}" onkeyup="filterUserEmpList('${field.id}', this.value)" placeholder="🔍 Search name..." class="w-full text-sm p-2 rounded-lg border border-slate-300 bg-white outline-none focus:border-brand-500 text-slate-700"></div>
                        <div class="overflow-y-auto max-h-60 p-1 custom-scrollbar bg-white">${list.length > 0 ? list.map(emp => `<div onclick="selectUserEmp('${field.id}', '${emp.full_name}')" class="emp-option-item p-3 hover:bg-blue-50 rounded-lg cursor-pointer border-b border-transparent hover:border-blue-100 transition-colors flex flex-col group/item" data-search="${emp.full_name.toLowerCase()} ${emp.employee_code}"><span class="text-sm font-bold text-slate-700 group-hover/item:text-blue-700">${emp.full_name}</span><span class="text-[10px] text-slate-400">${emp.position_name_th || '-'}</span></div>`).join('') : '<div class="p-4 text-center text-xs text-slate-400">No Data</div>'}</div>
                    </div>
                </div>`;
            }
        }

        // --- STANDARD FIELDS (Select, Textarea, Date, Multi) ---
        else if (field.type === 'select') {
            inputHtml = `<div class="relative"><select id="field_${field.id}" onchange="STATE.formData.answers['${field.id}']=this.value" class="${inputClass} appearance-none cursor-pointer"><option value="" disabled ${!val?'selected':''}>${t('select_option')}</option>${(field.options||[]).map(o=>`<option value="${typeof o==='string'?o:o.value}" ${val===(typeof o==='string'?o:o.value)?'selected':''}>${typeof o==='string'?o:o.label}</option>`).join('')}</select><div class="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400"><i data-lucide="chevron-down" width="16"></i></div></div>`;
        }
        else if (field.type === 'textarea') {
            inputHtml = `<textarea id="field_${field.id}" rows="3" oninput="autoResize(this); STATE.formData.answers['${field.id}']=this.value" class="${inputClass} resize-y" style="min-height: 80px;" placeholder="${t('type_details')}">${val||''}</textarea>`;
        }
        else if (field.type === 'date') {
            inputHtml = `<div class="relative"><input id="field_${field.id}" type="date" value="${val||''}" onchange="STATE.formData.answers['${field.id}']=this.value" class="${inputClass} pr-12 appearance-none min-h-[54px] cursor-pointer"><div class="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400"><i data-lucide="calendar" width="20"></i></div></div>`;
        } else if (field.type === 'multiselect') {
            const selected = Array.isArray(val) ? val : [];
            inputHtml = `<div id="field_${field.id}" class="grid grid-cols-2 gap-2 mt-1">${(field.options||[]).map(opt=>{ const v=typeof opt==='string'?opt:opt.value; const l=typeof opt==='string'?opt:opt.label; const isSel=selected.includes(v); return `<div onclick="toggleMultiSelect(this,'${field.id}','${v}')" class="cursor-pointer relative group"><input type="checkbox" class="hidden" ${isSel?'checked':''}><div class="visual-box p-3 rounded-xl text-xs font-bold transition-all flex items-center gap-2 border ${isSel?'bg-brand-50 border-brand-500 text-brand-700 shadow-md':'glass-input text-slate-600'}"><div class="check-icon w-4 h-4 rounded border flex items-center justify-center transition-all bg-brand-500 text-white ${isSel?'opacity-100':'opacity-0 border-transparent'}"><i data-lucide="check" width="10"></i></div><span>${l}</span></div></div>`}).join('')}</div>`;
        } else {
            inputHtml = `<input id="field_${field.id}" type="${field.type}" value="${val||''}" oninput="STATE.formData.answers['${field.id}']=this.value" class="${inputClass}" placeholder="Value">`;
        }

        let rewriteBtn = (field.type === 'textarea' || field.type === 'text') ? `<button id="rewrite-btn-${field.id}" onclick="triggerAIRewrite('${field.id}')" class="text-[10px] text-brand-600 bg-brand-50/50 hover:bg-brand-100 px-2 py-1 rounded-full flex items-center gap-1 transition-colors"><i data-lucide="sparkles" width="12"></i> AI Rewrite</button>` : '';

        return `<div class="mb-5 slide-up" style="animation-delay: ${idx*50}ms;"><div class="flex justify-between items-center mb-2 ml-1"><label class="block text-xs font-bold text-slate-500 uppercase">${field.label} ${requiredMark}</label>${rewriteBtn}</div>${inputHtml}</div>`;
    }).join('');

    const imageGalleryHTML = `<div id="report_image_gallery" class="flex gap-3 overflow-x-auto pb-4 no-scrollbar">${generateImageGalleryItems()}</div>`;
    const evalHTML = renderEvaluationSection(formConfig.linked_evals_report, 'report');

    const aiBtn = document.getElementById('ai-analyze-btn');
    const aiInput = document.getElementById('ai-hint-input');

    if (aiBtn) {
        // 1. ปิดปุ่มไว้ก่อนระหว่างเช็ค
        aiBtn.disabled = true;
        aiBtn.classList.add('opacity-50', 'cursor-not-allowed');
        aiBtn.innerHTML = `<i data-lucide="loader-2" class="animate-spin" width="16"></i> Checking...`;
        if(window.lucide) lucide.createIcons();

        // 2. ยิง API เช็คสถานะ
        fetch(`${API_URL}/ai-check-status`)
            .then(res => res.json())
            .then(data => {
                if (data.status === 'available') {
                    // --- กรณีใช้งานได้ ---
                    aiBtn.disabled = false;
                    aiBtn.classList.remove('opacity-50', 'cursor-not-allowed');
                    aiBtn.innerHTML = `<i data-lucide="sparkles" width="16"></i> AI Analysis`;

                } else if (data.status === 'exhausted') {
                    // --- กรณี Quota เต็ม (ไม่ Error แดงแล้ว แต่ปุ่มจะกดไม่ได้) ---
                    aiBtn.disabled = true;
                    aiBtn.classList.add('bg-slate-300', 'text-slate-500', 'border-slate-300'); // เปลี่ยนสีปุ่มเป็นเทา
                    aiBtn.classList.remove('bg-gradient-to-r', 'from-purple-500', 'to-indigo-500'); // ลบสีรุ้งออก
                    aiBtn.innerHTML = `<i data-lucide="battery-warning" width="16"></i> Quota Full`;
                    if(aiInput) aiInput.placeholder = "AI Usage Limit Reached (Try again later)";

                } else {
                    // --- กรณี Error อื่นๆ ---
                    throw new Error(data.message);
                }
            })
            .catch(err => {
                console.warn("AI Check Silent Fail:", err);
                // กรณีพังจริงๆ ให้ปิดปุ่มแบบเงียบๆ
                aiBtn.disabled = true;
                aiBtn.innerHTML = `<i data-lucide="wifi-off" width="16"></i> AI Offline`;
            })
            .finally(() => {
                if(window.lucide) lucide.createIcons();
            });
    }

    c.innerHTML = `
        <div class="h-full flex flex-col relative fade-in" onclick="closeAllUserDropdowns(event)">
             <div class="absolute top-0 left-0 w-full pt-12 md:pt-14 pb-4 px-4 z-30 flex items-center justify-between">
                <button onclick="STATE.view='home'; render()" class="w-10 h-10 glass-panel rounded-full flex items-center justify-center text-slate-600 hover:bg-white transition"><i data-lucide="arrow-left" width="20"></i></button>
                <div class="glass-panel px-4 py-2 rounded-full text-xs font-bold text-slate-700 shadow-sm">${formConfig.title}</div>
                <div class="w-10"></div>
            </div>

            <div class="flex-1 overflow-y-auto pt-24 pb-32 px-6 md:px-12 no-scrollbar">
                <div class="glass-panel p-1 rounded-3xl mb-6 relative z-30">
                    <div class="h-32 bg-slate-100 rounded-[1.2rem] overflow-hidden relative group cursor-pointer border border-white/50" onclick="openMapPicker()">
                        <div id="mini-map" class="w-full h-full z-0 pointer-events-none opacity-80 group-hover:opacity-100 transition duration-500"></div>
                        <div class="absolute inset-0 flex items-center justify-center bg-black/10 group-hover:bg-transparent transition"><div class="bg-white/90 backdrop-blur px-3 py-1 rounded-full text-[10px] font-bold shadow-sm flex gap-1 items-center"><i data-lucide="map-pin" width="12"></i> ${t('change_location')}</div></div>
                    </div>
                    <div class="p-3">
                        <label class="text-[10px] font-bold text-slate-400 uppercase block mb-1">${t('current_location')}</label>
                        <select onchange="handleLocationChange(this.value)" class="w-full bg-transparent font-bold text-brand-900 text-sm outline-none cursor-pointer">
                            <option value="" disabled ${!STATE.formData.location ? 'selected' : ''}>-- ${t('select_option') || 'Select Location'} --</option>
                            ${STATE.config.locations.map(l => {
                                const name = typeof l === 'string' ? l : l.name;
                                return `<option value="${name}" ${STATE.formData.location === name ? 'selected' : ''}>${name}</option>`;
                            }).join('')}
                        </select>
                    </div>
                </div>

                <div class="mb-6 relative z-20">
                    <label class="block text-xs font-bold text-slate-500 uppercase mb-3 ml-1">${t('evidence_photos')} <span class="text-red-400">*</span></label>
                    ${imageGalleryHTML}
                    <div class="flex gap-2 items-center mt-2">
                        <input id="ai-hint-input" type="text" class="flex-1 glass-input rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-purple-500 placeholder:text-slate-400" placeholder="${t('ai_hint')}" value="${STATE.formData.aiHint}" onchange="STATE.formData.aiHint=this.value">
                        <button onclick="triggerAIAnalysis()" id="ai-analyze-btn" class="bg-gradient-to-r from-purple-500 to-indigo-500 text-white px-4 py-3 rounded-xl font-bold text-sm flex items-center gap-1 hover:shadow-lg transition-all whitespace-nowrap">
                            <i data-lucide="sparkles" width="16"></i> AI
                        </button>
                    </div>
                </div>

                <div class="md:grid md:grid-cols-2 md:gap-x-6 relative z-20">
                    ${fieldsHTML}
                </div>

                <div class="relative z-10 pt-4">
                    ${evalHTML}
                </div>
            </div>

            <div class="absolute bottom-6 left-6 right-6 md:left-1/2 md:right-auto md:-translate-x-1/2 md:w-96 z-40 flex gap-3">
                <button onclick="showToast('${t('save_draft')}')" class="h-14 w-14 glass-panel rounded-full flex items-center justify-center text-slate-600 hover:text-blue-500 shadow-lg active:scale-95 transition"><i data-lucide="save" width="24"></i></button>
                <button onclick="submitInspection()" class="flex-1 h-14 bg-gradient-to-r from-brand-600 to-indigo-600 text-white rounded-full font-bold shadow-xl shadow-blue-300/50 flex items-center justify-center gap-2 hover:shadow-2xl active:scale-95 transition-all">${t('submit_report')} <i data-lucide="send" width="18"></i></button>
            </div>
        </div>`;

    if(window.lucide) lucide.createIcons();
    setTimeout(() => { if(typeof initMiniMap === 'function') initMiniMap('mini-map'); }, 100);
    setTimeout(() => { document.querySelectorAll('textarea').forEach(el => autoResize(el)); }, 50);

    // [New Feature] เช็คโควตา AI ทันทีหลังจาก Render เสร็จ
    checkAiAvailability();
}

async function fetchEmployees() {
    if (STATE.employeesCache.length > 0) return;
    try {
        const res = await fetch(`${API_URL}/employees`);
        if (res.ok) STATE.employeesCache = await res.json();
    } catch (e) { console.error("Failed to load employees", e); }
}

// ==========================================
// *** HELPER FUNCTIONS FOR EMPLOYEE SELECTOR ***
// ==========================================

function getEmployeeOptionsHTML(field, currentVal) {
    if (!STATE.employeesCache || STATE.employeesCache.length === 0) return '<option disabled>Loading employees...</option>';

    let list = STATE.employeesCache;

    // 1. FILTER: BY GROUP
    if (field.source === 'group' && field.group_id) {
        const group = (STATE.config.notify_groups || []).find(g => g.id === field.group_id);
        if (group) {
            // Filter only employees present in this group
            const memberCodes = group.members.map(m => m.code);
            list = list.filter(e => memberCodes.includes(e.employee_code));
        }
    }

    // 2. FILTER: BY LOCATION (Optional Logic)
    else if (field.source === 'location') {
        // สามารถเพิ่ม logic กรองตาม Location ได้ที่นี่
    }

    return list.map(emp => {
        const isSelected = currentVal === emp.full_name;
        return `<option value="${emp.full_name}" ${isSelected?'selected':''}>${emp.full_name} (${emp.position_name_th})</option>`;
    }).join('');
}

function renderEmployeeDropdownOptions(fieldId, fieldConfig) {
    const select = document.getElementById(`field_${fieldId}`);
    if(select) {
        const val = STATE.formData.answers[fieldId];
        select.innerHTML = `<option value="" disabled ${!val?'selected':''}>${t('select_option')}</option>` + getEmployeeOptionsHTML(fieldConfig, val);
    }
}

// ==========================================
// *** MINI MAP (FORM) ***
// ==========================================
function initMiniMap(elementId) {
    if (!STATE.isMapLoaded || !window.google) {
        setTimeout(() => initMiniMap(elementId), 500);
        return;
    }

    const mapElement = document.getElementById(elementId);
    if (!mapElement) return;

    // ใช้ GPS ที่เลือกไว้ หรือค่า Default
    const center = STATE.formData.gps || STATE.currentMapCenter || DEFAULT_FACTORY_LATLNG;

    const map = new google.maps.Map(mapElement, {
        center: center,
        zoom: 18,
        mapTypeId: 'satellite',
        disableDefaultUI: true,
        zoomControl: false,
        gestureHandling: 'cooperative'
    });

    // วาด Zone (Polygons) ถ้ามี KML Config
    if (STATE.config.mapKml) {
        const polygons = parseKmlCoordinates(STATE.config.mapKml);
        const colors = ['#EF4444', '#3B82F6', '#10B981', '#F59E0B', '#8B5CF6'];
        const bounds = new google.maps.LatLngBounds();

        polygons.forEach((polyData, idx) => {
            new google.maps.Polygon({
                paths: polyData.path,
                strokeColor: colors[idx%5],
                strokeOpacity: 0.8,
                strokeWeight: 2,
                fillColor: colors[idx%5],
                fillOpacity: 0.15,
                map: map
            });
            polyData.path.forEach(p => bounds.extend(p));
        });

        // ถ้ายังไม่มี GPS ให้ Fit ตาม Zone ทั้งหมด
        if(polygons.length > 0 && !STATE.formData.gps) map.fitBounds(bounds);
    }

    // ถ้ามี GPS แล้ว ให้ปักหมุดโชว์
    if(STATE.formData.gps) {
        new google.maps.Marker({
            position: STATE.formData.gps,
            map: map,
            animation: google.maps.Animation.DROP
        });
    }
}

function initPickerMap() {
    // เช็คว่า Google Maps Script โหลดเสร็จหรือยัง
    if (!STATE.isMapLoaded || !window.google) return;

    // ถ้ายังไม่มี Map Instance ให้สร้างใหม่
    if (!STATE.pickerMapInstance) {
        const mapEl = document.getElementById("google-map-picker");
        if (!mapEl) return; // ป้องกัน Error ถ้าหา div ไม่เจอ

        STATE.pickerMapInstance = new google.maps.Map(mapEl, {
            center: STATE.currentMapCenter || { lat: 13.7563, lng: 100.5018 }, // Default BKK
            zoom: 19,
            mapTypeId: 'satellite',
            disableDefaultUI: true,
            zoomControl: false,
            // [FIX ERROR] 'greedy' ช่วยแก้ปัญหา Touch Event ตีกับ Scroll ของ Browser
            gestureHandling: 'greedy'
        });

        // [FIX PERFORMANCE] ใช้ 'idle' แทน 'center_changed' เพื่อไม่ให้ทำงานถี่เกินไปจนค้าง
        STATE.pickerMapInstance.addListener("idle", () => {
            const c = STATE.pickerMapInstance.getCenter();
            if (c) {
                STATE.currentMapCenter = { lat: c.lat(), lng: c.lng() };
                checkZoneIntersection(c);
            }
        });

        // คลิกเพื่อเลื่อน
        STATE.pickerMapInstance.addListener("click", (e) => {
            if(e.latLng) STATE.pickerMapInstance.panTo(e.latLng);
        });

    } else {
        // ถ้ามีอยู่แล้ว ให้ Refresh ขนาดและตำแหน่ง
        google.maps.event.trigger(STATE.pickerMapInstance, "resize");
        if(STATE.currentMapCenter) {
            STATE.pickerMapInstance.setCenter(STATE.currentMapCenter);
        }
    }

    // วาดเส้นขอบเขต (Polygons)
    renderMapPolygons();
}

// ฟังก์ชันช่วยวาด Polygon (แยกออกมาให้ดูง่าย)
function renderMapPolygons() {
    if (STATE.pickerPolygons && STATE.pickerPolygons.length > 0) {
        STATE.pickerPolygons.forEach(p => p.setMap(null));
    }
    STATE.pickerPolygons = [];

    if (STATE.config && STATE.config.mapKml) {
        const polygons = parseKmlCoordinates(STATE.config.mapKml);
        const colors = ['#EF4444', '#3B82F6', '#10B981', '#F59E0B', '#8B5CF6'];
        polygons.forEach((polyData, idx) => {
            const poly = new google.maps.Polygon({
                paths: polyData.path,
                strokeColor: colors[idx%5], strokeOpacity: 0.8, strokeWeight: 2,
                fillColor: colors[idx%5], fillOpacity: 0.15,
                map: STATE.pickerMapInstance, clickable: false
            });
            poly.zoneName = polyData.name;
            STATE.pickerPolygons.push(poly);
        });
    }
}

window.openMapPicker = function() {
    let modal = document.getElementById('map-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'map-modal';
        modal.className = 'fixed inset-0 z-[60] bg-slate-50 hidden flex-col animate-[fadeIn_0.2s_ease-out]';
        // ... (HTML เดิมของคุณภายใน modal.innerHTML ใช้อันเดิมได้เลย) ...
        modal.innerHTML = `
            <div class="absolute top-0 left-0 w-full pt-14 pb-4 px-4 z-20 flex justify-between items-center bg-white/80 backdrop-blur-md border-b border-white/50 shadow-sm">
                <div class="flex items-center gap-2">
                    <div class="w-8 h-8 rounded-full bg-brand-50 text-brand-600 flex items-center justify-center border border-brand-100">
                        <i data-lucide="map-pin" width="16"></i>
                    </div>
                    <div>
                        <h3 id="lbl-map-title" class="font-bold text-slate-700 text-sm leading-tight">Pin Location</h3>
                        <p class="text-[10px] text-slate-400 font-medium">Adjust pin to exact spot</p>
                    </div>
                </div>
                <button onclick="closeMapPicker()" class="w-9 h-9 rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-700 flex items-center justify-center transition-all active:scale-95">
                    <i data-lucide="x" width="20"></i>
                </button>
            </div>

            <div class="flex-1 relative w-full h-full pt-20">
                <div id="google-map-picker" class="w-full h-full bg-slate-200"></div>

                <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10 pointer-events-none drop-shadow-md text-red-500">
                    <i data-lucide="crosshair" width="40" height="40" stroke-width="2"></i>
                </div>

                <div id="zone-indicator" class="absolute top-28 left-1/2 -translate-x-1/2 bg-white/95 backdrop-blur px-4 py-2 rounded-full text-xs font-bold text-slate-700 shadow-lg hidden z-10 flex items-center gap-2 border border-slate-100 pointer-events-none transition-all ring-4 ring-black/5">
                    <i data-lucide="map" width="14" class="text-brand-500"></i> <span id="zone-name">Checking...</span>
                </div>

                <button onclick="panToCurrentLocation()" class="absolute bottom-32 right-4 bg-white text-slate-700 p-3 rounded-2xl shadow-xl z-10 hover:bg-slate-50 active:scale-95 transition-all border border-slate-100">
                    <i data-lucide="locate"></i>
                </button>
            </div>

            <div class="p-6 bg-white pb-10 z-20 rounded-t-[2rem] shadow-[0_-10px_40px_rgba(0,0,0,0.05)] -mt-6 relative">
                <div class="w-12 h-1.5 bg-slate-200 rounded-full mx-auto mb-4"></div>
                <p id="lbl-map-hint" class="text-xs text-center text-slate-400 mb-4 font-medium">Drag map to auto-detect zone</p>
                <button id="btn-confirm-location" onclick="confirmLocation()" class="w-full py-4 bg-gradient-to-r from-brand-600 to-indigo-600 text-white rounded-2xl font-bold text-sm shadow-lg shadow-brand-200 hover:shadow-xl active:scale-95 transition-all" disabled>
                    Loading Map...
                </button>
            </div>
        `;
        document.body.appendChild(modal);
    }

    modal.classList.remove('hidden');
    modal.classList.add('flex');
    if(window.lucide) lucide.createIcons();

    // เริ่มต้นแผนที่ (ใช้ setTimeout เพื่อให้มั่นใจว่า div สร้างเสร็จแล้ว)
    if (!STATE.isMapLoaded) {
        setTimeout(() => { initPickerMap(); panToCurrentLocation(); }, 500);
    } else {
        // [FIX 4] หน่วงเวลานิดนึงก่อน init เพื่อให้ transition ของ modal เสร็จก่อน
        requestAnimationFrame(() => {
            initPickerMap();
            panToCurrentLocation();
        });
    }
};

function closeMapPicker() { document.getElementById('map-modal').classList.add('hidden'); document.getElementById('map-modal').classList.remove('flex'); }

// ==========================================
// *** LOCATION PICKER (MODAL) ***
// ==========================================
window.openMapPicker = function() {
    // 1. สร้าง HTML Modal
    let modal = document.getElementById('map-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'map-modal';
        modal.className = 'fixed inset-0 z-[60] bg-slate-50 hidden flex-col animate-[fadeIn_0.2s_ease-out]';
        modal.innerHTML = `
            <div class="absolute top-0 left-0 w-full pt-14 pb-4 px-4 z-20 flex justify-between items-center bg-white/80 backdrop-blur-md border-b border-white/50 shadow-sm">
                <div class="flex items-center gap-2">
                    <div class="w-8 h-8 rounded-full bg-brand-50 text-brand-600 flex items-center justify-center border border-brand-100">
                        <i data-lucide="map-pin" width="16"></i>
                    </div>
                    <div>
                        <h3 id="lbl-map-title" class="font-bold text-slate-700 text-sm leading-tight">Pin Location</h3>
                        <p class="text-[10px] text-slate-400 font-medium">Adjust pin to exact spot</p>
                    </div>
                </div>
                <button onclick="closeMapPicker()" class="w-9 h-9 rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-700 flex items-center justify-center transition-all active:scale-95">
                    <i data-lucide="x" width="20"></i>
                </button>
            </div>

            <div class="flex-1 relative w-full h-full pt-20">
                <div id="google-map-picker" class="w-full h-full bg-slate-200"></div>
                <div class="crosshair text-red-500 drop-shadow-md absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10 pointer-events-none">
                    <i data-lucide="crosshair" width="48" height="48" stroke-width="2"></i>
                </div>
                <div id="zone-indicator" class="absolute top-32 left-1/2 -translate-x-1/2 bg-white/95 backdrop-blur px-4 py-2 rounded-full text-xs font-bold text-slate-700 shadow-lg hidden z-10 flex items-center gap-2 border border-slate-100 pointer-events-none transition-all ring-4 ring-black/5">
                    <i data-lucide="map" width="14" class="text-brand-500"></i> <span id="zone-name">Checking...</span>
                </div>
                <button onclick="panToCurrentLocation()" class="absolute bottom-28 right-4 bg-white text-slate-700 p-3 rounded-2xl shadow-xl z-10 hover:bg-slate-50 active:scale-95 transition-all border border-slate-100">
                    <i data-lucide="locate"></i>
                </button>
            </div>

            <div class="p-6 bg-white pb-10 z-20 rounded-t-[2rem] shadow-[0_-10px_40px_rgba(0,0,0,0.05)] -mt-6 relative">
                <div class="w-12 h-1.5 bg-slate-200 rounded-full mx-auto mb-4"></div>
                <p id="lbl-map-hint" class="text-xs text-center text-slate-400 mb-4 font-medium">Drag map to auto-detect zone</p>
                <button id="btn-confirm-location" onclick="confirmLocation()" class="w-full py-4 bg-gradient-to-r from-brand-600 to-indigo-600 text-white rounded-2xl font-bold text-sm shadow-lg shadow-brand-200 hover:shadow-xl active:scale-95 transition-all">
                    Confirm Location
                </button>
            </div>
        `;
        document.body.appendChild(modal);
    }

    // 2. แสดง Modal
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    if(window.lucide) lucide.createIcons();

    // 3. เริ่มต้นแผนที่
    if (!STATE.isMapLoaded) {
        setTimeout(() => { initPickerMap(); panToCurrentLocation(); }, 500);
    } else {
        initPickerMap();
        panToCurrentLocation();
    }
};

function closeMapPicker() {
    const modal = document.getElementById('map-modal');
    if(modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
}

function initPickerMap() {
    if (!STATE.isMapLoaded) return;

    if (!STATE.pickerMapInstance) {
        STATE.pickerMapInstance = new google.maps.Map(document.getElementById("google-map-picker"), {
            center: STATE.currentMapCenter || DEFAULT_FACTORY_LATLNG,
            zoom: 19,
            mapTypeId: 'satellite',
            disableDefaultUI: true,
            zoomControl: false
        });

        // Event: เมื่อเลื่อนแผนที่ ให้เช็ค Zone
        STATE.pickerMapInstance.addListener("center_changed", () => {
            const c = STATE.pickerMapInstance.getCenter();
            STATE.currentMapCenter = { lat: c.lat(), lng: c.lng() };
            checkZoneIntersection(c);
        });

        // Event: คลิกเพื่อเลื่อน
        STATE.pickerMapInstance.addListener("click", (e) => {
            STATE.pickerMapInstance.panTo(e.latLng);
        });
    } else {
        google.maps.event.trigger(STATE.pickerMapInstance, "resize");
    }

    // วาด Zone เพื่อใช้ตรวจจับ (แต่ไม่จำเป็นต้อง Clickable)
    if (STATE.pickerPolygons && STATE.pickerPolygons.length > 0) {
        STATE.pickerPolygons.forEach(p => p.setMap(null));
    }
    STATE.pickerPolygons = [];

    if (STATE.config.mapKml) {
        const polygons = parseKmlCoordinates(STATE.config.mapKml);
        const colors = ['#EF4444', '#3B82F6', '#10B981', '#F59E0B', '#8B5CF6'];

        polygons.forEach((polyData, idx) => {
            const poly = new google.maps.Polygon({
                paths: polyData.path,
                strokeColor: colors[idx%5],
                strokeOpacity: 0.8,
                strokeWeight: 2,
                fillColor: colors[idx%5],
                fillOpacity: 0.15,
                map: STATE.pickerMapInstance,
                clickable: false
            });
            poly.zoneName = polyData.name;
            STATE.pickerPolygons.push(poly);
        });
    }
}

function checkZoneIntersection(latLng) {
    const indicator = document.getElementById('zone-indicator');
    const confirmBtn = document.getElementById('btn-confirm-location');
    const zoneName = isLocationInPolygons(latLng);

    if(!indicator || !confirmBtn) return;

    indicator.classList.remove('hidden'); indicator.classList.add('flex');

    if (zoneName) {
        indicator.innerHTML = `<i data-lucide="map" width="14" class="text-blue-500"></i> <span class="text-blue-800">${zoneName}</span>`;
        confirmBtn.innerHTML = t('map_confirm_btn') || "Confirm Location";
        confirmBtn.disabled = false;
        confirmBtn.classList.remove('bg-gray-400', 'cursor-not-allowed', 'bg-slate-500');
        confirmBtn.classList.add('bg-gradient-to-r', 'from-blue-500', 'to-cyan-500');
        STATE.formData.tempLocation = zoneName;
    } else {
        indicator.innerHTML = `<i data-lucide="alert-circle" width="14" class="text-red-500"></i> <span class="text-red-600">${t('map_outside_alert') || "Outside Zone"}</span>`;
        confirmBtn.innerHTML = t('map_blocked_btn') || "Zone Required";
        confirmBtn.disabled = true;
        confirmBtn.classList.remove('bg-gradient-to-r', 'from-blue-500', 'to-cyan-500', 'bg-slate-500');
        confirmBtn.classList.add('bg-gray-400', 'cursor-not-allowed');
        STATE.formData.tempLocation = null;
    }
    if(window.lucide) lucide.createIcons();
}

function isLocationInPolygons(latLng) {
    if (window.google && google.maps.geometry && STATE.pickerPolygons.length > 0) {
        for (const poly of STATE.pickerPolygons) {
            if (google.maps.geometry.poly.containsLocation(latLng, poly)) return poly.zoneName;
        }
    }
    return null;
}

async function confirmLocation() {
    if (!STATE.formData.tempLocation) {
        showToast("Please move pin inside a valid zone");
        return;
    }

    STATE.formData.gps = STATE.currentMapCenter;
    const detectedZone = STATE.formData.tempLocation;

    // เช็คว่า Zone นี้มีใน Config หรือยัง ถ้ายังให้เพิ่มเข้าไป
    const existingIndex = STATE.config.locations.findIndex(l => (typeof l === 'string' ? l : l.name) === detectedZone);
    if (existingIndex === -1) {
        STATE.config.locations.push({ name: detectedZone, email: "" });
        showToast(`New Zone Detected: ${detectedZone}`);
    } else {
        showToast(`Selected: ${detectedZone}`);
    }

    // Trigger Logic การเปลี่ยน Location (เพื่อ Auto-fill คนดูแล)
    await handleLocationChange(detectedZone);

    closeMapPicker();
    render(); // Render UI ใหม่
}

function panToCurrentLocation() {
    if(navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(p => {
            const pos = { lat: p.coords.latitude, lng: p.coords.longitude };
            const gLatLng = new google.maps.LatLng(pos.lat, pos.lng);
            STATE.pickerMapInstance.panTo(pos);
            STATE.currentMapCenter = pos;
            checkZoneIntersection(gLatLng);
        }, () => {
            STATE.pickerMapInstance.panTo(DEFAULT_FACTORY_LATLNG);
            showToast("GPS Error: Using Default");
        });
    } else {
        STATE.pickerMapInstance.panTo(DEFAULT_FACTORY_LATLNG);
    }
}

function parseKmlCoordinates(kmlText) {
    try {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(kmlText, "text/xml");
        const placemarks = xmlDoc.getElementsByTagName("Placemark");
        const allPolygons = [];
        for (let i = 0; i < placemarks.length; i++) {
            const nameNode = placemarks[i].getElementsByTagName("name")[0];
            const name = nameNode ? nameNode.textContent.replace(/[\n\r]+/g, '').trim() : `Zone ${i+1}`;
            const coordsTags = placemarks[i].getElementsByTagName("coordinates");
            for (let j = 0; j < coordsTags.length; j++) {
                const rawCoords = coordsTags[j].textContent.trim().split(/\s+/);
                const polygonPath = [];
                rawCoords.forEach(pair => {
                    const [lon, lat] = pair.split(',');
                    if (lat && lon) polygonPath.push({ lat: parseFloat(lat), lng: parseFloat(lon) });
                });
                if (polygonPath.length > 0) allPolygons.push({ name: name, path: polygonPath });
            }
        }
        return allPolygons;
    } catch (e) {
        return [];
    }
}

// *** AI & UTILS ***
async function submitInspection() {
    if(STATE.formData.images.length === 0) return alert("Photo required");
    if(!STATE.formData.gps || STATE.formData.gps.lat === 0 || STATE.formData.gps.lng === 0) {
            return alert(t('gps_required') || "GPS location from map required");
    }

    showLoading(true, "Processing Data...");

    // --- FIX START: Prepare Evaluation Data ---
    // 1. Merge Raw Scores (สำหรับแสดงกราฟแท่งในหน้า Detail)
    // STATE.evalScores เก็บค่า key เช่น 'report_evalId_itemId' ซึ่งตรงกับที่หน้า Detail เรียกใช้
    Object.assign(STATE.formData.answers, STATE.evalScores);

    // 2. Calculate & Save Summary Result (สำหรับแสดงการ์ดสรุปผล Total/Rank)
    const formConfig = STATE.config.forms.find(f => f.id === STATE.formData.type_id);
    if (formConfig && formConfig.linked_evals_report && formConfig.linked_evals_report.length > 0) {
        // ใช้ Evaluation ตัวแรกเป็นตัวหลักในการแสดงผลสรุป (Summary Card)
        const mainEvalId = formConfig.linked_evals_report[0];
        const evalConfig = STATE.config.evaluations.find(e => e.id === mainEvalId);

        if (evalConfig) {
            // คำนวณผลลัพธ์ล่าสุดก่อนบันทึก
            const result = calculateEvalResult(evalConfig, 'report');

            // บันทึก object นี้เพื่อให้หน้า Detail นำไปแสดงเป็นการ์ด
            STATE.formData.answers['eval_results_report'] = {
                total: result.score,
                rank: result.label,
                color: result.color
            };
        }
    }
    // --- FIX END ---

    if (STATE.language !== 'th') {
        const allFields = [...formConfig.fields, ...(formConfig.cm_fields || [])];
        for(const field of allFields) {
            if(field.type === 'text' || field.type === 'textarea') {
                const originalVal = STATE.formData.answers[field.id];
                if(originalVal && typeof originalVal === 'string' && originalVal.trim() !== "") {
                    try { const thaiVal = await translateInputToThai(originalVal, STATE.language); STATE.formData.answers[field.id] = thaiVal; } catch (error) {}
                }
            }
        }
    }

    try {
        showLoading(true, "Saving to Database...");
        const res = await fetch(`${API_URL}/inspections`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type_id: STATE.formData.type_id,
                location: STATE.formData.location,
                inspector: STATE.user ? STATE.user.name : 'Anonymous',
                status: 'Pending',
                dynamic_data: STATE.formData.answers, // ข้อมูลนี้จะมี eval results รวมอยู่แล้ว
                images: STATE.formData.images,
                gps_lat: STATE.formData.gps ? STATE.formData.gps.lat : 0.0,
                gps_lng: STATE.formData.gps ? STATE.formData.gps.lng : 0.0
            })
        });
        if (res.ok) {
            showToast("Report Submitted Successfully!");
            STATE.historyCacheTime = 0; // Invalidate cache
        } else { throw new Error("Server returned " + res.status); }
    } catch (error) {
        console.warn("API Error", error);
        alert(`⚠️ Server Not Found or Error (${error.message}).\n\nSaving locally (Demo Mode) instead.`);
    } finally {
        showLoading(false); STATE.view = 'home'; render();
    }
}

async function triggerAIAnalysis() {
    if(STATE.formData.images.length === 0) return alert("Please upload a photo first");
    const btn = document.getElementById('ai-analyze-btn');
    const originalHTML = btn.innerHTML;
    btn.innerHTML = `<i data-lucide="loader-2" class="animate-spin" width="16"></i> Analyzing...`;
    lucide.createIcons();
    btn.disabled = true;

    try {
        const formConfig = STATE.config.forms.find(f => f.id === STATE.formData.type_id);
        const hint = STATE.formData.aiHint;
        const imageBase64 = STATE.formData.images[0];
        const langName = LANGUAGES[STATE.language].name;

        // *** 1. กรอง Date ออกจาก Prompt เพื่อประหยัด Token และไม่ให้ AI เดา ***
        const promptFields = formConfig.fields
            .filter(f => f.type !== 'date') // ไม่ส่ง date field ไปถาม AI
            .map(f => `- ${f.id} (${f.label}): Type=${f.type}, Options=${JSON.stringify(f.options || [])}`)
            .join('\n');

        const prompt = `Analyze the attached image in the context of a factory inspection. User Hint: "${hint}". Based on the image and hint, suggest values for the following fields in JSON format:\n${promptFields}\nIMPORTANT: Response must be strictly valid JSON. All string values MUST be written in ${langName} language.`;

        const res = await fetch(`${API_URL}/ai-analyze`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                prompt: prompt,
                image: imageBase64
            })
        });

        if(!res.ok) throw new Error("AI Server Error");
        const json = await res.json();

        // *** 2. กรองผลลัพธ์อีกชั้น (Double Check) ป้องกัน AI ตอบ Date กลับมา ***
        const cleanJson = {};
        for (const [key, value] of Object.entries(json)) {
            const fieldConfig = formConfig.fields.find(f => f.id === key);
            // รับค่าเฉพาะฟิลด์ที่มีอยู่จริง และไม่ใช่ Date
            if (fieldConfig && fieldConfig.type !== 'date') {
                cleanJson[key] = value;
            }
        }

        STATE.formData.answers = { ...STATE.formData.answers, ...cleanJson };
        render(); // Re-render หน้าจอ
        showToast("AI Analysis Complete!");

        // *** 3. สั่ง Resize Textarea ใหม่หลังจาก AI ใส่ข้อความ ***
        setTimeout(() => {
            document.querySelectorAll('textarea').forEach(el => autoResize(el));
        }, 100);

    } catch(e) {
        console.error(e);
        alert("AI Analysis Failed: " + e.message);
    } finally {
        btn.innerHTML = originalHTML;
        btn.disabled = false;
        lucide.createIcons();
    }
}

async function triggerAIRewrite(fieldId) {
    const currentVal = STATE.formData.answers[fieldId];
    if(!currentVal) return alert("Please type something first");
    const btn = document.getElementById(`rewrite-btn-${fieldId}`);
    if(btn) { btn.innerHTML = `<i data-lucide="loader-2" class="animate-spin" width="12"></i>`; lucide.createIcons(); }

    try {
        const langName = LANGUAGES[STATE.language].name;
        // *** CHANGED: Use Local Proxy API ***
        const res = await fetch(`${API_URL}/ai-rewrite`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                prompt: `Rewrite the following text to be professional, clear, and formal (${langName} language) for a factory report:\n\n"${currentVal}" Response must be valid JSON with key "result".`
            })
        });

        if(!res.ok) throw new Error("AI Server Error");
        const data = await res.json();

        // Python server returns { result: "..." } or raw string depending on implementation
        // ใน app.py ผม wrap json มาให้แล้ว
        let newText = "";
        if(data.result) {
             // ถ้า Python ตอบเป็น JSON object
             newText = (typeof data.result === 'object') ? data.result.result : data.result;
        } else {
             newText = data; // เผื่อกรณีหลุด
        }

        STATE.formData.answers[fieldId] = newText;
        const el = document.getElementById(`field_${fieldId}`);
        if(el) { el.value = newText; if(el.tagName === 'TEXTAREA') autoResize(el); }
    } catch(e) {
        console.error(e);
        showToast("Rewrite Failed");
    } finally {
        if(btn) { btn.innerHTML = `<i data-lucide="sparkles" width="12"></i> AI Rewrite`; lucide.createIcons(); }
    }
}

window.toggleMultiSelect = (btnElement, fieldId, val) => {
    // 1. อัปเดตข้อมูลใน State (Logic)
    let curr = STATE.formData.answers[fieldId] || [];
    const index = curr.indexOf(val);

    let isSelected = false;
    if (index === -1) {
        curr.push(val); // เลือก
        isSelected = true;
    } else {
        curr.filter(x => x !== val); // เอาออก (ใช้ splice เพื่อความชัวร์ใน array reference)
        curr.splice(index, 1);
        isSelected = false;
    }
    STATE.formData.answers[fieldId] = curr;

    // 2. อัปเดตหน้าตาปุ่มทันที (Visual) โดยไม่ต้อง Render ใหม่
    const visualBox = btnElement.querySelector('.visual-box');
    const checkIcon = btnElement.querySelector('.check-icon');
    const checkbox = btnElement.querySelector('input[type="checkbox"]');

    if (checkbox) checkbox.checked = isSelected;

    if (isSelected) {
        // สไตล์ตอนเลือก (Selected State)
        visualBox.classList.remove('glass-input', 'text-slate-600');
        visualBox.classList.add('bg-brand-50', 'border-brand-500', 'text-brand-700', 'shadow-md', 'ring-1', 'ring-brand-200');

        checkIcon.classList.remove('opacity-0', 'border-transparent');
        checkIcon.classList.add('opacity-100', 'border-brand-500');
    } else {
        // สไตล์ตอนไม่เลือก (Unselected State)
        visualBox.classList.add('glass-input', 'text-slate-600');
        visualBox.classList.remove('bg-brand-50', 'border-brand-500', 'text-brand-700', 'shadow-md', 'ring-1', 'ring-brand-200');

        checkIcon.classList.add('opacity-0', 'border-transparent');
        checkIcon.classList.remove('opacity-100', 'border-brand-500');
    }
};

function viewImage(src) {
    const modal = document.getElementById('image-viewer-modal');
    if (!modal) return;

    // ตั้งค่ารูป
    const imgEl = document.getElementById('image-viewer-src');
    if (imgEl) imgEl.src = src;

    // เปิด Modal
    modal.classList.remove('hidden');
    modal.classList.add('flex');

    // ✅ [แก้ไข] บังคับให้ Z-Index สูงกว่าหน้า Detail (ซึ่งอยู่ที่ 80)
    // ใส่เป็น 150 ไปเลยเพื่อให้มั่นใจว่าอยู่บนสุดเสมอ
    modal.style.zIndex = "150";

    // Animation (ถ้ามี)
    setTimeout(() => {
        if(imgEl) {
            imgEl.classList.remove('scale-95');
            imgEl.classList.add('scale-100');
        }
    }, 10);
}

function closeImageViewer() {
    const modal = document.getElementById('image-viewer-modal');
    const imgEl = document.getElementById('image-viewer-src');

    if (imgEl) {
        imgEl.classList.remove('scale-100');
        imgEl.classList.add('scale-95');
    }

    setTimeout(() => {
        if(modal) {
            modal.classList.add('hidden');
            modal.classList.remove('flex');
            // รีเซ็ต z-index กลับ (เผื่อไว้)
            modal.style.zIndex = "";
        }
    }, 200);
}

window.toggleBiometricSetting = async (isEnabled) => {
    if (!STATE.user) return alert("กรุณาเข้าสู่ระบบก่อนตั้งค่า");

    if (isEnabled) {
        // 1. ถ้า User จะเปิดใช้งาน ให้เรียกหน้าต่างลงทะเบียนใบหน้าก่อน
        const success = await registerBiometrics();
        if (!success) {
            // ถ้าลงทะเบียนไม่สำเร็จ (กดยกเลิก) ให้ดีดสวิตช์กลับเป็นปิด
            setTimeout(() => render(), 500);
            return;
        }
    }

    // 2. บันทึกสถานะลงใน STATE และ Database
    if (!STATE.userSettings) STATE.userSettings = {};
    STATE.userSettings.biometric_enabled = isEnabled ? 'true' : 'false';

    const idToSend = STATE.user.employee_code || STATE.user.userid;

    try {
        await fetch(`${API_URL}/user-settings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                user_id: idToSend,
                key: 'biometric_enabled',
                value: isEnabled ? 'true' : 'false'
            })
        });
        showToast(isEnabled ? "เปิดใช้งาน Face Scan แล้ว" : "ปิดการใช้งาน Face Scan");
    } catch (e) {
        console.error("Update Setting Error:", e);
    }
};

function renderProfileContent(c) {
    const user = STATE.user || {};

    // 1. เตรียมข้อมูล
    const showName = user.name || user.username || 'Guest';
    const showRole = user.userrole || user.position || 'Staff';
    const showID = user.employee_code || user.userid || '-';
    // const showDept = user.department || 'General';

    const isBioEnabled = STATE.userSettings && STATE.userSettings.biometric_enabled === 'true';

    // Helper: สร้าง Avatar
    const initial = showName.charAt(0).toUpperCase();

    // สีพื้นหลัง Avatar ตาม Role (กรณี Fallback)
    const roleColors = {
        'Safety Officer': 'bg-green-100 text-green-600',
        'Manager': 'bg-purple-100 text-purple-600',
        'Staff': 'bg-brand-50 text-brand-600',
        'Admin': 'bg-rose-100 text-rose-600'
    };
    const avatarClass = roleColors[showRole] || roleColors['Staff'];

    // Image URL Logic
    const empCode = user.employee_code || '';
    const imgUrl = `https://iapi.bkc.co.th/api/File/get?path=images%2Femployee&filename=${empCode}.jpg`;

    // 2. สร้าง HTML โครงสร้าง
    c.innerHTML = `
        <div class="h-full flex flex-col bg-slate-50/50 relative overflow-hidden">

            <div class="absolute top-0 left-0 w-full h-64 bg-gradient-to-b from-brand-50/80 to-transparent pointer-events-none"></div>
            <div class="absolute -top-20 -right-20 w-64 h-64 bg-blue-200/20 rounded-full blur-3xl pointer-events-none"></div>
            <div class="absolute top-40 -left-20 w-48 h-48 bg-purple-200/20 rounded-full blur-3xl pointer-events-none"></div>

            <div class="flex-1 overflow-y-auto custom-scrollbar pt-12 pb-32 px-6 md:px-12 relative z-10 fade-in">

                <div class="flex flex-col items-center justify-center mb-8">
                    <div class="relative mb-4 group cursor-pointer">

                        <div class="rounded-full p-1 bg-white shadow-lg shadow-blue-200/50 border border-slate-100">
                            <div class="w-28 h-28 bg-white rounded-full p-1 relative">
                                <img src="${imgUrl}"
                                     class="w-full h-full rounded-full object-cover shadow-inner"
                                     onerror="this.style.display='none'; document.getElementById('profile-fallback').style.display='flex';">

                                <div id="profile-fallback" class="hidden w-full h-full rounded-full ${avatarClass} items-center justify-center text-4xl font-extrabold shadow-inner">
                                    ${initial}
                                </div>
                            </div>
                        </div>

                        <div class="absolute bottom-1 right-1 w-8 h-8 bg-green-500 border-4 border-white rounded-full shadow-md flex items-center justify-center text-white" title="Online">
                            <i data-lucide="check" width="14" stroke-width="4"></i>
                        </div>
                    </div>

                    <h2 class="text-2xl font-black text-slate-800 tracking-tight text-center mb-1">${showName}</h2>
                    <div class="flex items-center gap-2">
                        <span class="px-3 py-1 rounded-full bg-white border border-slate-200 text-[10px] font-bold text-slate-500 uppercase tracking-wider shadow-sm flex items-center gap-1.5">
                            <div class="w-2 h-2 rounded-full bg-slate-400"></div> ${showRole}
                        </span>
                    </div>
                </div>

                <div class="grid grid-cols-2 gap-4 mb-6">
                    <div class="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm flex flex-col items-center justify-center gap-1 group hover:border-brand-200 transition-colors">
                        <div class="w-8 h-8 rounded-full bg-slate-50 text-slate-400 flex items-center justify-center mb-1 group-hover:bg-brand-50 group-hover:text-brand-500 transition-colors">
                            <i data-lucide="hash" width="16"></i>
                        </div>
                        <span class="text-[10px] font-bold text-slate-400 uppercase">Employee ID</span>
                        <span class="text-sm font-black text-slate-700 font-mono">${showID}</span>
                    </div>
                    <div class="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm flex flex-col items-center justify-center gap-1 group hover:border-purple-200 transition-colors">
                        <div class="w-8 h-8 rounded-full bg-slate-50 text-slate-400 flex items-center justify-center mb-1 group-hover:bg-purple-50 group-hover:text-purple-500 transition-colors">
                            <i data-lucide="shield-check" width="16"></i>
                        </div>
                        <span class="text-[10px] font-bold text-slate-400 uppercase">Status</span>
                        <span class="text-sm font-black text-green-600">Active</span>
                    </div>
                </div>

                <div class="mb-6">
                    <h3 class="text-xs font-extrabold text-slate-400 uppercase tracking-widest ml-4 mb-3">Security Center</h3>
                    <div class="bg-white rounded-[1.5rem] shadow-sm border border-slate-100 overflow-hidden">

                        <div class="p-5 flex items-center justify-between border-b border-slate-50 menu-item-hover">
                            <div class="flex items-center gap-4">
                                <div class="w-10 h-10 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
                                    <i data-lucide="scan-face" width="20"></i>
                                </div>
                                <div>
                                    <h4 class="font-bold text-sm text-slate-700">Face ID Login</h4>
                                    <p class="text-[10px] text-slate-400 font-medium">Use biometric to sign in</p>
                                </div>
                            </div>
                            <label class="relative inline-flex items-center cursor-pointer">
                                <input type="checkbox" class="sr-only peer" ${isBioEnabled ? 'checked' : ''} onchange="toggleBiometricSetting(this.checked)">
                                <div class="w-11 h-6 bg-slate-200 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand-600 transition-colors"></div>
                            </label>
                        </div>

                        <button onclick="startChangePin()" class="w-full p-5 flex items-center justify-between text-left menu-item-hover group">
                            <div class="flex items-center gap-4">
                                <div class="w-10 h-10 rounded-2xl bg-orange-50 text-orange-600 flex items-center justify-center group-hover:bg-orange-100 transition-colors">
                                    <i data-lucide="key-round" width="20"></i>
                                </div>
                                <div>
                                    <h4 class="font-bold text-sm text-slate-700">Change PIN Code</h4>
                                    <p class="text-[10px] text-slate-400 font-medium">Update your 6-digit access pin</p>
                                </div>
                            </div>
                            <i data-lucide="chevron-right" width="18" class="text-slate-300 group-hover:text-slate-500 transition-colors"></i>
                        </button>

                    </div>
                </div>

                <div class="mb-8">
                    <h3 class="text-xs font-extrabold text-slate-400 uppercase tracking-widest ml-4 mb-3">System</h3>
                    <div class="bg-white rounded-[1.5rem] shadow-sm border border-slate-100 overflow-hidden">
                         <div class="p-5 flex items-center justify-between border-b border-slate-50">
                            <div class="flex items-center gap-4">
                                <div class="w-10 h-10 rounded-2xl bg-slate-50 text-slate-600 flex items-center justify-center">
                                    <i data-lucide="languages" width="20"></i>
                                </div>
                                <div>
                                    <h4 class="font-bold text-sm text-slate-700">Language</h4>
                                    <p class="text-[10px] text-slate-400 font-medium">Display language</p>
                                </div>
                            </div>
                            <div class="flex items-center gap-1 bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-100">
                                <img src="${LANGUAGES[STATE.language].flag}" class="w-4 h-4 rounded-full object-cover">
                                <span class="text-xs font-bold text-slate-600 uppercase">${LANGUAGES[STATE.language].label}</span>
                            </div>
                        </div>

                        <button id="btn-logout" class="w-full p-5 flex items-center justify-between text-left menu-item-hover group bg-red-50/10 hover:bg-red-50/50 transition-colors">
                            <div class="flex items-center gap-4">
                                <div class="w-10 h-10 rounded-2xl bg-red-50 text-red-500 flex items-center justify-center group-hover:bg-red-100 transition-colors shadow-sm">
                                    <i data-lucide="log-out" width="20" class="ml-0.5"></i>
                                </div>
                                <div>
                                    <h4 class="font-bold text-sm text-red-600">Sign Out</h4>
                                    <p class="text-[10px] text-red-400 font-medium">Log out from this device</p>
                                </div>
                            </div>
                        </button>
                    </div>
                </div>

                <div class="text-center opacity-40 mb-6">
                    <div class="w-1 h-1 bg-slate-300 rounded-full mx-auto mb-2"></div>
                    <p class="text-[10px] text-slate-400 font-bold font-mono">MarkWhite+ v2.6.0 (Build 2026.02)</p>
                    <p class="text-[9px] text-slate-300 mt-0.5">Global Komatsu Standard</p>
                </div>

            </div>
        </div>
    `;

    // 3. ผูก Event Listeners
    setTimeout(() => {
        const btnLogout = document.getElementById('btn-logout');
        if (btnLogout) {
            btnLogout.onclick = () => {
                if(navigator.vibrate) navigator.vibrate(10);

                if(confirm("Are you sure you want to sign out?")) {
                    localStorage.removeItem('mw_user_session');
                    sessionStorage.clear();
                    STATE.user = null;
                    STATE.view = 'login';
                    render();
                }
            };
        }
        if (window.lucide) lucide.createIcons();
    }, 50);
}

// ** LOGOUT FUNCTION **
window.logout = function() {
    // 1. ถามยืนยันก่อน
    if (!confirm("Are you sure you want to logout?")) return;

    // 2. [สำคัญมาก] ลบข้อมูล Auto Login ออกจาก Hard Disk
    // ต้องใช้ชื่อ key เดียวกับตอนสั่ง setItem ใน handleLogin ('mw_user_session')
    localStorage.removeItem('mw_user_session');

    // 3. ล้าง sessionStorage เผื่อมีข้อมูลขยะเหลือ
    sessionStorage.clear();

    // 4. ล้างค่าในตัวแปร (RAM)
    STATE.user = null;
    STATE.view = 'login';
    STATE.appInitialized = false; // รีเซ็ตสถานะเริ่มต้นใหม่

    // 5. แจ้งเตือน (ถ้ามีฟังก์ชันนี้)
    if (typeof showToast === 'function') {
        showToast("Logged out successfully");
    }

    // 6. สั่ง Render หน้าจอใหม่ (จะเด้งไปหน้า Login)
    render();
};

// ==========================================
// *** NOTIFICATION SYSTEM (REAL DATA UX/UI) ***
// ==========================================

async function renderNotifyContent(c) {
    // 1. Render HTML Skeleton / Loading State ก่อน
    c.innerHTML = `
    <div class="px-6 md:px-12 mt-4 fade-in min-h-screen relative">
        <div class="flex justify-between items-center mb-6 px-2">
            <h3 class="text-lg font-bold text-slate-700 flex items-center gap-2">
                <i data-lucide="bell" class="text-brand-500"></i> ${t('nav_notify')}
            </h3>
            <button onclick="markAllNotificationsRead()" class="text-[10px] font-bold text-brand-600 bg-brand-50 hover:bg-brand-100 px-3 py-1.5 rounded-full transition-colors flex items-center gap-1">
                <i data-lucide="check-check" width="12"></i> Mark all read
            </button>
        </div>

        <div id="notify-list-container" class="space-y-3 pb-32">
            ${[1, 2, 3].map(() => `
            <div class="glass-panel p-4 rounded-2xl flex gap-4 items-center animate-pulse">
                <div class="w-12 h-12 rounded-full bg-slate-200"></div>
                <div class="flex-1 space-y-2">
                    <div class="h-3 bg-slate-200 rounded w-3/4"></div>
                    <div class="h-2 bg-slate-200 rounded w-1/2"></div>
                </div>
            </div>`).join('')}
        </div>
    </div>`;

    lucide.createIcons();

    // 2. Fetch Data จริงจาก API
    if (!STATE.user) {
        document.getElementById('notify-list-container').innerHTML = renderEmptyNotifyState("Please login to view notifications");
        return;
    }

    try {
        // *** จุดแก้ไขสำคัญ: ใช้ employee_code ในการดึงข้อมูลก่อน ถ้าไม่มีค่อยใช้ userid ***
        const idToFetch = STATE.user.employee_code || STATE.user.userid;

        console.log("🔔 Fetching notifications for:", idToFetch); // Debug ดูค่าใน Console

        const res = await fetch(`${API_URL}/notifications/${idToFetch}`);

        if (!res.ok) throw new Error("Failed to load");

        const notifications = await res.json();
        STATE.notifications = notifications; // Cache ไว้ใน State

        renderNotificationList(notifications);

        // Update Badge ที่ Navbar (นับจำนวนที่ยังไม่อ่าน)
        const unreadCount = notifications.filter(n => !n.is_read).length;
        updateNotifyBadge(unreadCount);

    } catch (e) {
        console.error("Notify Load Error", e);
        document.getElementById('notify-list-container').innerHTML = `
            <div class="text-center py-10 opacity-60">
                <i data-lucide="wifi-off" class="mx-auto mb-2 text-slate-400" width="32"></i>
                <p class="text-xs text-slate-400">Cannot load notifications</p>
                <button onclick="renderNotifyContent(document.getElementById('main-content'))" class="mt-4 text-xs text-brand-600 font-bold underline">Try Again</button>
            </div>`;
        lucide.createIcons();
    }
}

function renderNotificationList(data) {
    const container = document.getElementById('notify-list-container');
    if (!container) return;

    if (data.length === 0) {
        container.innerHTML = renderEmptyNotifyState();
        return;
    }

    container.innerHTML = data.map((item, index) => {
        // --- UX Logic: แยกประเภทด้วยสีและไอคอน ---
        let style = { icon: 'bell', bg: 'bg-slate-100', text: 'text-slate-500', border: 'border-slate-200' };
        const titleLower = item.title.toLowerCase();

        if (titleLower.includes('approve') || titleLower.includes('✅')) {
            style = { icon: 'check-circle-2', bg: 'bg-green-100', text: 'text-green-600', border: 'border-green-200' };
        } else if (titleLower.includes('reject') || titleLower.includes('❌') || titleLower.includes('revision')) {
            style = { icon: 'x-circle', bg: 'bg-red-100', text: 'text-red-500', border: 'border-red-200' };
        } else if (titleLower.includes('task') || titleLower.includes('assign')) {
            style = { icon: 'clipboard-list', bg: 'bg-blue-100', text: 'text-blue-600', border: 'border-blue-200' };
        }

        // --- UX Logic: Highlight Unread Items ---
        const isUnread = !item.is_read;
        const unreadClass = isUnread ? 'bg-white border-l-4 border-l-brand-500 shadow-md' : 'bg-white/60 border-l-4 border-l-transparent hover:bg-white';
        const opacityClass = isUnread ? 'opacity-100' : 'opacity-70';

        return `
        <div onclick="handleNotificationClick(${item.id}, '${item.link_action}', ${item.is_read})"
             class="${unreadClass} p-4 rounded-2xl flex gap-4 items-start cursor-pointer border-y border-r border-slate-100 transition-all duration-200 active:scale-[0.98] group slide-up relative overflow-hidden"
             style="animation-delay: ${index * 50}ms">

            ${isUnread ? `<div class="absolute top-3 right-3 w-2 h-2 rounded-full bg-red-500 shadow-sm animate-pulse"></div>` : ''}

            <div class="w-12 h-12 shrink-0 rounded-2xl ${style.bg} ${style.text} ${style.border} border flex items-center justify-center shadow-sm group-hover:scale-110 transition-transform duration-300">
                <i data-lucide="${style.icon}" width="22"></i>
            </div>

            <div class="flex-1 min-w-0 ${opacityClass} transition-opacity">
                <div class="flex justify-between items-start mb-0.5">
                    <h4 class="font-bold text-sm text-slate-800 leading-tight pr-4">${item.title}</h4>
                </div>
                <p class="text-xs text-slate-500 leading-relaxed line-clamp-2 mb-2">${item.message}</p>
                <div class="flex items-center gap-2">
                    <i data-lucide="clock" width="10" class="text-slate-400"></i>
                    <span class="text-[10px] font-bold text-slate-400">${getRelativeTime(item.created_at)}</span>
                </div>
            </div>
        </div>`;
    }).join('');

    lucide.createIcons();
}

function renderEmptyNotifyState(msg = null) {
    return `
    <div class="glass-panel p-10 rounded-[2.5rem] flex flex-col items-center justify-center text-center mt-4 border border-white/60 shadow-sm">
        <div class="w-20 h-20 bg-blue-50 text-blue-300 rounded-full flex items-center justify-center mb-6 relative">
            <i data-lucide="bell-off" width="36"></i>
            <div class="absolute inset-0 border-2 border-blue-100 rounded-full animate-ping opacity-20"></div>
        </div>
        <h4 class="text-slate-600 font-bold text-sm mb-1">No new notifications</h4>
        <p class="text-xs text-slate-400 max-w-[200px] leading-relaxed">${msg || "You're all caught up! Check back later for updates."}</p>
    </div>`;
}

// Helper: คำนวณเวลาแบบ "2 hours ago"
function getRelativeTime(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    const now = new Date();
    const diffInSeconds = Math.floor((now - date) / 1000);

    if (diffInSeconds < 60) return 'Just now';
    const diffInMinutes = Math.floor(diffInSeconds / 60);
    if (diffInMinutes < 60) return `${diffInMinutes}m ago`;
    const diffInHours = Math.floor(diffInMinutes / 60);
    if (diffInHours < 24) return `${diffInHours}h ago`;
    const diffInDays = Math.floor(diffInHours / 24);
    if (diffInDays < 7) return `${diffInDays}d ago`;

    return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

// Action: กดที่แจ้งเตือน
async function handleNotificationClick(notiId, linkAction, isRead) {
    // 1. Mark as Read (ส่งไปหลังบ้านเงียบๆ)
    if (!isRead) {
        // อัปเดต UI ทันทีเพื่อให้ User รู้สึกว่าระบบตอบสนองเร็ว
        const item = document.querySelector(`div[onclick*="handleNotificationClick(${notiId}"]`);
        if(item) {
             item.classList.remove('bg-white', 'border-l-4', 'border-l-brand-500', 'shadow-md');
             item.classList.add('bg-white/60', 'border-l-4', 'border-l-transparent');
             const dot = item.querySelector('.bg-red-500');
             if(dot) dot.remove();
        }

        // ลดตัวเลข Badge
        const badge = document.getElementById('nav-notify-badge');
        if(badge) {
            let count = parseInt(badge.innerText || '0');
            updateNotifyBadge(Math.max(0, count - 1));
        }

        // ยิง API
        fetch(`${API_URL}/notifications/read`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: notiId })
        }).catch(console.error);
    }

    // 2. Logic การนำทาง (Routing) แบบไม่ Refresh หน้า
    if (!linkAction || linkAction === '#' || linkAction === '/') return;

    // พยายามหา ID จาก URL (รองรับทั้ง /?id=XX และ /history?id=XX)
    let reportId = null;

    if (linkAction.includes('id=')) {
        try {
            // แยก string เพื่อเอาเฉพาะเลข ID
            const parts = linkAction.split('id=');
            if (parts.length > 1) {
                // เอาเฉพาะตัวเลข (เผื่อมี param อื่นต่อท้าย)
                reportId = parts[1].split('&')[0];
            }
        } catch (e) { console.error("Parse ID error", e); }
    }

    if (reportId) {
        // CASE A: มี ID ชัดเจน -> เปิด Modal เลย (ไม่ต้อง Refresh หน้า!)
        console.log("🔔 Opening Report In-App:", reportId);
        openHistoryDetail(reportId);
    } else if (linkAction.includes('history')) {
        // CASE B: ลิงก์ไปหน้าประวัติรวม -> สลับ Tab
        switchNavTab('history');
    } else {
        // CASE C: ลิงก์ภายนอกจริงๆ -> ยอมให้ Refresh/Redirect
        window.location.href = linkAction;
    }
}

// Action: กดปุ่ม Mark all read
async function markAllNotificationsRead() {
    if (!STATE.user) return;

    // UI Update (ทำให้เห็นว่าอ่านแล้วทันที)
    const container = document.getElementById('notify-list-container');
    if(container) {
        const unreadItems = container.querySelectorAll('.border-l-brand-500');
        unreadItems.forEach(el => {
            el.classList.remove('bg-white', 'border-l-4', 'border-l-brand-500', 'shadow-md');
            el.classList.add('bg-white/60', 'border-l-4', 'border-l-transparent', 'hover:bg-white');
            const dot = el.querySelector('.bg-red-500');
            if(dot) dot.remove();
        });
    }
    updateNotifyBadge(0);

    try {
        // *** แก้ไข: ส่ง employee_code ไปเพื่อเคลียร์สถานะ ***
        const idToSend = STATE.user.employee_code || STATE.user.userid;

        await fetch(`${API_URL}/notifications/read`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: idToSend })
        });
        showToast("All marked as read");
    } catch (e) {
        console.error(e);
    }
}

// *** APP STARTUP ***
async function loadConfig() {
    // 1. Check Session Storage for Auto-Login
    const storedUser = sessionStorage.getItem("authUser");
    if(storedUser) {
        try {
            STATE.user = JSON.parse(storedUser);
            STATE.view = 'home'; // Go directly to home
        } catch(e) {
            console.error("Invalid session data");
            sessionStorage.removeItem("authUser");
        }
    }

    try {
        const res = await fetch(`${API_URL}/config`);
        const data = await res.json();
        if(data.forms) {
            STATE.config = data;
            STATE.originalConfig = JSON.parse(JSON.stringify(data));
            STATE.translationCache = {};
        }
    } catch(e) { console.log("Config load failed, utilizing default"); }
}

// ============================================================
// *** NAVIGATION & MAP LOGIC (Smart Back Button & Map Memory) ***
// ============================================================

// เพิ่มตัวแปร Global State สำหรับ Map Memory
if (!STATE.mapMemory) {
    STATE.mapMemory = { center: null, zoom: null };
}

// 4. ปรับปรุง initOverviewMap ให้จำค่า Zoom/Center (Map Memory)
async function initOverviewMap() {
    if (!window.google || !window.google.maps) {
        setTimeout(initOverviewMap, 500);
        return;
    }
    const mapDiv = document.getElementById('overview-mini-map');
    if (!mapDiv) return;

    // สร้าง Custom Control (ปุ่ม Zoom) ถ้ายังไม่มี
    if (!document.getElementById('custom-zoom-ctrl')) {
        const ctrlContainer = document.createElement('div');
        ctrlContainer.id = 'custom-zoom-ctrl';
        ctrlContainer.style.cssText = 'position: absolute; bottom: 12px; right: 12px; display: flex; flex-direction: column; gap: 8px; z-index: 50;';
        ctrlContainer.innerHTML = `
            <button id="map-locate-btn" style="width:28px; height:28px; background:white; border-radius:8px; box-shadow:0 2px 8px rgba(0,0,0,0.15); display:flex; align-items:center; justify-content:center; color:#3b82f6; border:none; cursor:pointer; transition:0.2s; margin-bottom:4px;">${LOCATE_SVG}</button>
            <button id="map-zoom-in" style="width:28px; height:28px; background:white; border-radius:8px; box-shadow:0 2px 8px rgba(0,0,0,0.15); display:flex; align-items:center; justify-content:center; color:#64748b; border:none; cursor:pointer; transition:0.2s;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg></button>
            <button id="map-zoom-out" style="width:28px; height:28px; background:white; border-radius:8px; box-shadow:0 2px 8px rgba(0,0,0,0.15); display:flex; align-items:center; justify-content:center; color:#64748b; border:none; cursor:pointer; transition:0.2s;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line></svg></button>
        `;
        mapDiv.parentElement.appendChild(ctrlContainer);
    }

    try {
        // [MEMORY] ใช้ค่าที่จำไว้ หรือค่า Default
        const initialCenter = STATE.mapMemory.center || DEFAULT_FACTORY_LATLNG;
        const initialZoom = STATE.mapMemory.zoom || 16;

        const map = new google.maps.Map(mapDiv, {
            center: initialCenter,
            zoom: initialZoom,
            mapTypeId: 'hybrid',
            disableDefaultUI: true,
            zoomControl: false,
            gestureHandling: 'greedy',
            styles: [{ featureType: "poi", stylers: [{ visibility: "off" }] }]
        });

        // [MEMORY] จดจำค่าเมื่อแผนที่หยุดขยับ
        map.addListener('idle', () => {
            STATE.mapMemory = {
                center: map.getCenter(),
                zoom: map.getZoom()
            };
        });

        // Event ปุ่ม Zoom
        document.getElementById('map-zoom-in').onclick = () => map.setZoom(map.getZoom() + 1);
        document.getElementById('map-zoom-out').onclick = () => map.setZoom(map.getZoom() - 1);
        document.getElementById('map-locate-btn').onclick = () => {
            if(navigator.geolocation) navigator.geolocation.getCurrentPosition(p => {
                const pos = { lat: p.coords.latitude, lng: p.coords.longitude };
                map.panTo(pos);
                map.setZoom(18);
                new google.maps.Marker({
                    position: pos,
                    map: map,
                    icon: { path: google.maps.SymbolPath.CIRCLE, scale: 8, fillColor: "#3B82F6", fillOpacity: 1, strokeColor: "white", strokeWeight: 2 }
                });
            });
        };

        // Render KML Zones
        if (STATE.config && STATE.config.mapKml) {
            const kmlSource = STATE.config.mapKml.trim();
            if (kmlSource.startsWith('<')) renderKmlString(map, kmlSource);
            else fetch(kmlSource).then(r => r.text()).then(t => renderKmlString(map, t)).catch(console.warn);
        }

        // Plot Reports Markers
        fetchAndPlotReports(map);

        // Auto Scale Markers on Zoom
        map.customMarkers = [];
        google.maps.event.addListener(map, 'zoom_changed', function() {
            const zoom = map.getZoom();
            let newScale = zoom >= 19 ? 1.8 : (zoom >= 17 ? 1.4 : (zoom >= 15 ? 1.0 : 0.8));
            if (map.customMarkers) map.customMarkers.forEach(m => { m.setIcon({ ...m.getIcon(), scale: newScale }); });
        });

    } catch (e) { console.error("Map Init Error:", e); }
}

// (Helper functions อื่นๆ เหมือนเดิม)
function renderKmlString(map, kmlText) {
    try {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(kmlText, "text/xml");
        const placemarks = xmlDoc.getElementsByTagName("Placemark");
        const zoneColors = ["#EF4444", "#3B82F6", "#10B981", "#F59E0B", "#8B5CF6"];

        for (let i = 0; i < placemarks.length; i++) {
            const coordsTags = placemarks[i].getElementsByTagName("coordinates");
            for(let j=0; j<coordsTags.length; j++) {
                const raw = coordsTags[j].textContent.trim().split(/\s+/);
                const path = [];
                raw.forEach(p => {
                    const parts = p.split(",");
                    if(parts.length>=2) path.push({ lat: parseFloat(parts[1]), lng: parseFloat(parts[0]) });
                });
                if (path.length > 2) new google.maps.Polygon({
                    paths: path,
                    strokeColor: "#FFFFFF",
                    strokeOpacity: 0.8,
                    strokeWeight: 1.5,
                    fillColor: zoneColors[i % 5],
                    fillOpacity: 0.2,
                    map: map,
                    clickable: false
                });
            }
        }
    } catch (err) { console.error("KML Error", err); }
}

function getSvgPathByIconName(iconName) {
    const MAP_ICONS = {
        SHIELD: "M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z",
        STAR: "M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z",
        WRENCH: "M22.7 19l-9.1-9.1c.9-2.3.4-5-1.5-6.9-2-2-5-2.4-7.4-1.3L9 6 6 9 1.6 4.7C.4 7.1.9 10.1 2.9 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.5-.4.5-1.1.1-1.4z",
        FILE: "M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z",
        CLIPBOARD: "M19 3h-4.18C14.4 1.84 13.3 1 12 1c-1.3 0-2.4.84-2.82 2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 0c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm-2 14l-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z",
        CIRCLE: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"
    };
    if (!iconName) return MAP_ICONS.FILE;
    const name = iconName.toLowerCase().trim();
    if (name.includes('shield') || name.includes('safe')) return MAP_ICONS.SHIELD;
    if (name.includes('star') || name.includes('award')) return MAP_ICONS.STAR;
    if (name.includes('wrench') || name.includes('tool') || name.includes('setting')) return MAP_ICONS.WRENCH;
    if (name.includes('clip') || name.includes('check')) return MAP_ICONS.CLIPBOARD;
    return MAP_ICONS.CIRCLE;
}

async function fetchAndPlotReports(map) {
    try {
        // 1. [FIX] เช็คก่อนว่า Config โหลดเสร็จหรือยัง
        if (!STATE.config || !STATE.config.forms) {
            console.warn("Config not ready. Retrying plot in 500ms...");
            setTimeout(() => fetchAndPlotReports(map), 500);
            return;
        }

        const res = await fetch(`${API_URL}/inspections`);
        if (!res.ok) return; // ถ้าดึงข้อมูลไม่สำเร็จให้หยุด

        const reports = await res.json();
        let activeInfoWindow = null;

        reports.forEach(report => {
            if (!report.gps_lat || !report.gps_lng || parseFloat(report.gps_lat) === 0) return;
            const position = { lat: parseFloat(report.gps_lat), lng: parseFloat(report.gps_lng) };

            let statusColor = "#F59E0B", statusBg = "#FEF3C7", statusText = "Pending";
            if (report.status === 'Approved') { statusColor = "#10B981"; statusBg = "#D1FAE5"; statusText = "Approved"; }
            else if (report.status === 'Reject' || report.status === 'Revision') { statusColor = "#EF4444"; statusBg = "#FEE2E2"; statusText = "Revision"; }

            // 2. [FIX] ใช้ Optional Chaining ป้องกัน Error กรณี forms ยังไม่มาจริงๆ
            const formConfig = STATE.config?.forms?.find(f => f.id === report.type_id);

            const displayTitle = formConfig ? formConfig.title : report.type_id;
            const iconPath = getSvgPathByIconName(formConfig ? formConfig.icon : 'file');

            const imgUrl = (report.images && report.images.length > 0) ? report.images[0] : null;
            const imgHtml = imgUrl
                ? `<img src="${imgUrl}" style="width:40px; height:40px; border-radius:10px; object-fit:cover; border:2px solid white; box-shadow:0 2px 6px rgba(0,0,0,0.1);">`
                : `<div style="width:40px; height:40px; border-radius:10px; background:#F1F5F9; border:2px solid white; display:flex; align-items:center; justify-content:center; color:#CBD5E1; font-size:16px;">📷</div>`;

            const infoContent = `
                <div style="font-family:'Sarabun', sans-serif; width:220px; background:rgba(255, 255, 255, 0.98); backdrop-filter:blur(8px); border-radius:16px; padding:10px; box-shadow:0 8px 24px -4px rgba(0,0,0,0.12); position:relative;">
                    <button onclick="document.querySelector('.gm-ui-hover-effect').click()" style="position:absolute; top:6px; right:6px; background:transparent; border:none; color:#94A3B8; cursor:pointer; width:18px; height:18px; display:flex; justify-content:center; align-items:center;">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    </button>
                    <div style="display:flex; gap:10px; align-items:center;">
                        <div style="display:flex; flex-direction:column; align-items:center; gap:4px; flex-shrink:0;">
                            <span style="background:${statusBg}; color:${statusColor}; font-size:7px; font-weight:800; padding:1px 5px; border-radius:4px; text-transform:uppercase; letter-spacing:0.5px;">${statusText}</span>
                            ${imgHtml}
                        </div>
                        <div style="flex:1; min-width:0;">
                            <div style="font-size:11px; font-weight:800; color:#1E293B; margin-bottom:2px; line-height:1.2; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${displayTitle}</div>
                            <div style="display:flex; align-items:center; gap:3px; margin-bottom:1px;"><div style="font-size:9px;">👤</div><div style="font-size:9px; color:#475569; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:80px;">${report.inspector || 'Admin'}</div></div>
                            <div style="display:flex; align-items:center; gap:3px;"><div style="font-size:9px;">📍</div><div style="font-size:9px; color:#475569; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:80px;">${report.location || '-'}</div></div>
                        </div>
                    </div>
                    <button onclick="openHistoryDetail('${report.id}')" style="margin-top:8px; width:100%; background:#EFF6FF; color:#3B82F6; border:1px solid #DBEAFE; border-radius:8px; padding:4px; font-size:10px; font-weight:bold; cursor:pointer; transition:all 0.2s; display:flex; align-items:center; justify-content:center; gap:4px;" onmouseover="this.style.background='#DBEAFE'" onmouseout="this.style.background='#EFF6FF'">
                        View Detail <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
                    </button>
                </div>
            `;

            const marker = new google.maps.Marker({
                position: position,
                map: map,
                icon: {
                    path: iconPath,
                    fillColor: statusColor,
                    fillOpacity: 1,
                    strokeColor: '#FFFFFF',
                    strokeWeight: 2,
                    scale: 1.0,
                    anchor: new google.maps.Point(12, 12)
                },
                zIndex: 20
            });

            if (!map.customMarkers) map.customMarkers = [];
            map.customMarkers.push(marker);

            const infoWindow = new google.maps.InfoWindow({ content: infoContent });
            marker.addListener("click", () => {
                if (activeInfoWindow) activeInfoWindow.close();
                infoWindow.open(map, marker);
                activeInfoWindow = infoWindow;
            });
        });
    } catch (e) {
        console.warn("Fetch Reports Error (handled):", e.message);
    }
}

const LOCATE_SVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="2" x2="12" y2="6"></line><line x1="12" y1="18" x2="12" y2="22"></line><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line><line x1="2" y1="12" x2="6" y2="12"></line><line x1="18" y1="12" x2="22" y2="12"></line><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line><circle cx="12" cy="12" r="3"></circle></svg>`;

window.openFullMap = async function() {
    const modalId = 'full-map-modal';
    let modal = document.getElementById(modalId);
    if (!modal) {
        modal = document.createElement('div');
        modal.id = modalId;
        modal.className = 'fixed inset-0 z-[60] bg-slate-50 flex flex-col animate-[fadeIn_0.3s_ease-out]';
        modal.innerHTML = `
            <button onclick="document.getElementById('${modalId}').remove()" class="absolute top-14 right-6 z-[70] w-12 h-12 bg-white rounded-full shadow-xl flex items-center justify-center text-slate-600 hover:text-red-500 hover:bg-red-50 transition-all active:scale-95 border border-slate-100"><i data-lucide="x" width="28"></i></button>
            <div id="full-google-map" class="w-full h-full bg-slate-200"></div>
            <div class="absolute bottom-8 left-8 bg-white/95 backdrop-blur-md p-4 rounded-2xl text-xs shadow-xl border border-slate-100 flex flex-col gap-2 z-[60]">
                <div class="font-bold text-slate-400 text-[10px] uppercase mb-1 tracking-wider">Status</div>
                <div class="flex items-center gap-2"><span class="w-3 h-3 rounded-full bg-[#F59E0B] border border-white shadow-sm"></span> Pending</div>
                <div class="flex items-center gap-2"><span class="w-3 h-3 rounded-full bg-[#10B981] border border-white shadow-sm"></span> Approved</div>
                <div class="flex items-center gap-2"><span class="w-3 h-3 rounded-full bg-[#EF4444] border border-white shadow-sm"></span> Revision</div>
            </div>
            <div id="full-map-zoom" style="position: absolute; bottom: 32px; right: 32px; display: flex; flex-direction: column; gap: 8px; z-index: 60;">
                <button id="full-locate-btn" style="width:40px; height:40px; background:white; border-radius:12px; box-shadow:0 4px 15px rgba(0,0,0,0.1); display:flex; align-items:center; justify-content:center; color:#3b82f6; border:none; cursor:pointer;">${LOCATE_SVG.replace(/16/g, '20')}</button>
                <button id="full-zoom-in" style="width:40px; height:40px; background:white; border-radius:12px; box-shadow:0 4px 15px rgba(0,0,0,0.1); display:flex; align-items:center; justify-content:center; color:#64748b; border:none; cursor:pointer;"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg></button>
                <button id="full-zoom-out" style="width:40px; height:40px; background:white; border-radius:12px; box-shadow:0 4px 15px rgba(0,0,0,0.1); display:flex; align-items:center; justify-content:center; color:#64748b; border:none; cursor:pointer;"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line></svg></button>
            </div>
        `;
        document.body.appendChild(modal);
        lucide.createIcons();
    }
    const mapDiv = document.getElementById('full-google-map');
    if (!mapDiv || !window.google) return;

    try {
        const map = new google.maps.Map(mapDiv, {
            center: DEFAULT_FACTORY_LATLNG,
            zoom: 17,
            mapTypeId: 'hybrid',
            disableDefaultUI: true,
            zoomControl: false,
            gestureHandling: 'greedy'
        });

        document.getElementById('full-zoom-in').onclick = () => map.setZoom(map.getZoom() + 1);
        document.getElementById('full-zoom-out').onclick = () => map.setZoom(map.getZoom() - 1);
        document.getElementById('full-locate-btn').onclick = () => {
            if(navigator.geolocation) navigator.geolocation.getCurrentPosition(p => {
                map.panTo({ lat: p.coords.latitude, lng: p.coords.longitude });
                map.setZoom(18);
            });
        };

        if (STATE.config && STATE.config.mapKml) {
            const kmlSource = STATE.config.mapKml.trim();
            if (kmlSource.startsWith('<')) renderKmlString(map, kmlSource);
            else fetch(kmlSource).then(r => r.text()).then(t => renderKmlString(map, t)).catch(console.warn);
        }

        fetchAndPlotReports(map);

        map.customMarkers = [];
        google.maps.event.addListener(map, 'zoom_changed', function() {
            const zoom = map.getZoom();
            let newScale = zoom >= 19 ? 2.0 : (zoom >= 17 ? 1.5 : (zoom >= 15 ? 1.2 : 0.8));
            if (map.customMarkers) map.customMarkers.forEach(m => { m.setIcon({ ...m.getIcon(), scale: newScale }); });
        });
    } catch (e) { console.error("Full Map Error:", e); }
};

// ============================================================
// *** SMART NAVIGATION LOGIC (Modal System - No Reload) ***
// ============================================================
// 1. สร้าง HTML สำหรับ Global Loader (หน้าจอโหลดหมุนๆ แบบสวย)
function getGlobalLoaderHTML(message = "Processing...") {
    return `
    <div id="global-loader" class="fixed inset-0 z-[100] bg-slate-50/80 backdrop-blur-md flex flex-col items-center justify-center animate-[fadeIn_0.2s_ease-out]">

        <div class="relative w-20 h-20 mb-8">
            <div class="absolute inset-0 border-4 border-indigo-100 rounded-full"></div>
            <div class="absolute inset-0 border-4 border-t-brand-600 border-r-indigo-500 border-b-transparent border-l-transparent rounded-full animate-spin"></div>

            <div class="absolute inset-0 flex items-center justify-center">
                <div class="w-10 h-10 bg-white rounded-full shadow-sm flex items-center justify-center animate-pulse">
                    <img src="static/images/mw_mini.png" class="w-6 h-6 object-contain" onerror="this.style.display='none'">
                </div>
            </div>
        </div>

        <h3 id="loader-msg" class="text-lg font-black text-slate-700 tracking-tight mb-2">${message}</h3>
        <p class="text-xs text-slate-400 font-medium animate-pulse">Please wait a moment...</p>

        <div class="w-48 h-1 bg-slate-200 rounded-full mt-6 overflow-hidden">
            <div class="h-full bg-gradient-to-r from-brand-500 to-indigo-500 w-1/3 animate-pulse"></div>
        </div>
    </div>`;
}

// 2. ฟังก์ชันเรียกใช้งาน Global Loader (ใช้แทน Alert ธรรมดา)
window.showLoading = function(isLoading, message = "Loading...") {
    let loader = document.getElementById('global-loader');

    if (isLoading) {
        if (!loader) {
            // ถ้ายังไม่มี ให้สร้าง div ใหม่และแปะลง Body
            const div = document.createElement('div');
            div.innerHTML = getGlobalLoaderHTML(message);
            document.body.appendChild(div.firstElementChild);
        } else {
            // ถ้ามีแล้ว ให้อัปเดตข้อความและแสดง
            const msgEl = document.getElementById('loader-msg');
            if(msgEl) msgEl.innerText = message;
            loader.classList.remove('hidden');
            loader.classList.add('flex');
        }
    } else {
        // ซ่อน Loader
        if (loader) {
            loader.classList.add('hidden');
            loader.classList.remove('flex');
        }
    }
};

// ฟังก์ชันแสดงหน้าโหลด (Skeleton) ระหว่างรอข้อมูลจริง
function renderDetailLoading(c, basicInfo) {
    // พยายามดึง Config เพื่อโชว์ Title ให้ได้ก่อน (Optimistic UI)
    const formConfig = STATE.config.forms.find(f => f.id === basicInfo.type_id) || { title: basicInfo.type_id };

    c.innerHTML = `
    <div class="h-full flex flex-col relative bg-slate-50">
        <div class="absolute top-0 left-0 w-full pt-12 md:pt-14 pb-4 px-4 z-30 flex items-center justify-between bg-white/80 backdrop-blur-md border-b border-white/50 shadow-sm">
            <button onclick="closeDetailModal()" class="w-10 h-10 rounded-full flex items-center justify-center text-slate-600 hover:bg-slate-100 transition"><i data-lucide="arrow-left" width="20"></i></button>
            <div class="font-bold text-slate-700 text-sm">${t('report_detail')}</div>
            <div class="w-10"></div>
        </div>

        <div class="flex-1 overflow-y-auto pt-32 pb-24 px-6 md:px-12 no-scrollbar">

            <div class="bg-white p-5 rounded-3xl shadow-sm border border-slate-100 mb-6 relative">
                <h2 class="text-xl font-extrabold text-slate-800 mb-2 pr-16">${formConfig.title}</h2>
                <div class="flex items-center gap-2 mb-4">
                    <span class="px-2 py-1 rounded-md bg-slate-100 text-slate-500 border border-slate-200 text-[10px] font-bold">${basicInfo.status || 'Loading...'}</span>
                    <span class="text-xs text-slate-400">#${basicInfo.id}</span>
                </div>
                <div class="space-y-3 animate-pulse">
                    <div class="h-4 bg-slate-100 rounded w-1/2"></div>
                    <div class="h-4 bg-slate-100 rounded w-1/3"></div>
                </div>
            </div>

            <div class="space-y-6 animate-pulse">
                <div>
                    <div class="h-4 w-24 bg-slate-200 rounded mb-2"></div>
                    <div class="flex gap-2 overflow-hidden">
                        <div class="w-24 h-24 bg-slate-200 rounded-xl"></div>
                        <div class="w-24 h-24 bg-slate-200 rounded-xl"></div>
                    </div>
                </div>

                <div>
                    <div class="h-4 w-32 bg-slate-200 rounded mb-2"></div>
                    <div class="h-40 w-full bg-slate-200 rounded-2xl"></div>
                </div>

                <div class="grid grid-cols-2 gap-6">
                    <div class="h-12 w-full bg-slate-200 rounded-xl"></div>
                    <div class="h-12 w-full bg-slate-200 rounded-xl"></div>
                    <div class="h-12 w-full bg-slate-200 rounded-xl"></div>
                    <div class="h-12 w-full bg-slate-200 rounded-xl"></div>
                </div>
            </div>
        </div>
    </div>`;

    if(window.lucide) lucide.createIcons();
}

// 1. ฟังก์ชันเปิดหน้า Detail แบบ Modal
window.openHistoryDetail = async function(id) {
    if (!STATE.historyList) STATE.historyList = [];
    let basicInfo = STATE.historyList.find(i => i.id == id);
    if (!basicInfo) basicInfo = { id: id, type_id: 'Loading...', status: 'Loading' };

    STATE.selectedReport = basicInfo;
    const modal = getDetailModal();

    if (typeof renderDetailModalContent === 'function') {
        renderDetailModalContent(modal, basicInfo);
    } else {
        modal.innerHTML = `<div class="p-10 text-center">Loading Report #${id}...</div>`;
    }

    try {
        const res = await fetch(`${API_URL}/inspection/${id}`);
        if (!res.ok) throw new Error("Failed to load details");
        const fullData = await res.json();

        STATE.selectedReport = fullData;
        if (STATE.historyList.length > 0) {
            const listIndex = STATE.historyList.findIndex(i => i.id == id);
            if(listIndex !== -1) STATE.historyList[listIndex] = fullData;
        }

        renderDetailModalContent(modal, fullData);

    } catch(e) {
        console.error("Detail load error", e);
        if(typeof showToast === 'function') showToast("Error loading details");
        closeDetailModal();
    } finally {
        // [FIX] บังคับปิด Loading เสมอเมื่อจบการทำงาน
        if(typeof showLoading === 'function') showLoading(false);
    }
};

// 2. Helper: สร้างกล่อง Modal (ถ้ายังไม่มี)
function getDetailModal() {
    let modal = document.getElementById('detail-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'detail-modal';
        // z-[80] เพื่อให้สูงกว่า Full Map (z-[60])
        modal.className = 'fixed inset-0 z-[80] bg-slate-50 flex flex-col animate-[slideInRight_0.3s_ease-out]';
        document.body.appendChild(modal);
    }
    return modal;
}

// 3. Helper: ปิด Modal (กลับหน้าเดิมโดยไม่ต้องโหลดใหม่)
window.closeDetailModal = function() {
    const modal = document.getElementById('detail-modal');
    if (modal) {
        modal.remove(); // ลบ Modal ทิ้ง
        STATE.isEditingCM = false;

        // ถ้าอยู่หน้า History ให้ Refresh List เบาๆ เพื่ออัปเดตสถานะ
        if (STATE.view === 'history') {
             const listContainer = document.getElementById('history-list-container');
             if(listContainer && typeof generateHistoryListHTML === 'function') {
                 listContainer.innerHTML = generateHistoryListHTML(STATE.historyList);
                 if(window.lucide) lucide.createIcons();
             }
        }
    }
};

// 4. Render เนื้อหาใน Modal (ดัดแปลงมาจาก renderHistoryDetail เดิม)
function renderDetailModalContent(c, report) {
    const formConfig = STATE.config.forms.find(f => f.id === report.type_id) || { title: report.type_id, fields: [] };
    const userRole = STATE.user.userrole || 'User';
    const isApprover = (userRole === 'Safety Officer' || userRole === 'Manager') && report.status === 'Pending';

    let actionButtons = '';
    if (isApprover) {
        actionButtons = `
        <div class="fixed bottom-6 left-6 right-6 flex gap-3 z-[90] animate-[slideUp_0.3s_ease-out]">
            <button onclick="submitApproval('${report.id}', 'Rejected')" class="flex-1 py-4 bg-red-50 text-red-600 font-bold rounded-2xl shadow-lg border border-red-100 hover:bg-red-100 transition">Reject</button>
            <button onclick="submitApproval('${report.id}', 'Approved')" class="flex-1 py-4 bg-green-500 text-white font-bold rounded-2xl shadow-lg shadow-green-200 hover:bg-green-600 transition">Approve</button>
        </div>`;
    }

    // --- แก้ไขจุดนี้: เพิ่มปุ่มดูรายชื่อกลุ่ม ---
    const fieldsHTML = formConfig.fields.map((field, idx) => {
        const val = report.dynamic_data[field.id];
        let displayVal = val;
        if(Array.isArray(val)) displayVal = val.join(', ');
        if(!val) displayVal = "-";

        // Logic เช็คว่าเป็นกลุ่ม (Group) หรือไม่
        let groupBtn = '';
        if (typeof displayVal === 'string' && displayVal.includes('👥')) {
             groupBtn = `
             <button onclick="viewGroupMembers('${displayVal}')" class="ml-2 p-1.5 bg-indigo-50 text-indigo-600 rounded-full hover:bg-indigo-100 transition-colors border border-indigo-100 shrink-0" title="View Members">
                <i data-lucide="users" width="14"></i>
             </button>`;
        }

        return `
        <div class="mb-4 slide-up" style="animation-delay: ${300 + idx*50}ms;">
            <label class="block text-[10px] font-bold text-slate-400 uppercase mb-1">${field.label}</label>
            <div class="w-full p-3 bg-white/60 border border-white/50 rounded-xl text-slate-700 text-sm font-medium flex items-center justify-between">
                <span class="truncate">${displayVal}</span>
                ${groupBtn}
            </div>
        </div>`;
    }).join('');

    const imagesHTML = report.images && report.images.length > 0 ? `<div class="mb-6 slide-up" style="animation-delay: 100ms"><label class="block text-[10px] font-bold text-slate-400 uppercase mb-2">${t('evidence_photos')}</label><div class="flex gap-2 overflow-x-auto pb-2 no-scrollbar">${report.images.map(img => `<img src="${img}" onclick="viewImage('${img}')" class="w-24 h-24 rounded-xl object-cover shadow-sm border border-white cursor-pointer hover:opacity-90 shrink-0">`).join('')}</div></div>` : '';

    let evalResultHTML = '';
    if(report.dynamic_data.eval_results_report) {
         let detailsHTML = '';
         const linkedEvals = formConfig ? (formConfig.linked_evals_report || []) : [];

         if(linkedEvals.length > 0) {
             detailsHTML = `<div id="eval-details-content" class="hidden mt-4 pt-4 border-t border-blue-100 space-y-4">`;
             linkedEvals.forEach(evalId => {
                 const evalConfig = STATE.config.evaluations.find(e => e.id === evalId);
                 if(evalConfig) {
                     detailsHTML += `<div class="mb-2"><h4 class="text-xs font-bold text-blue-800 mb-2">${evalConfig.name}</h4>`;
                     (evalConfig.assessments || []).forEach(assess => {
                         const key = `report_${evalId}_${assess.id}`;
                         const val = report.dynamic_data[key];
                         if(assess.type === 'text') {
                             const textContent = val || '-';
                             detailsHTML += `<div class="mb-3"><div class="text-[10px] text-slate-500 font-bold mb-1">${assess.name}</div><div class="p-3 bg-slate-50 rounded-xl text-xs text-slate-700 border border-slate-100 italic">"${textContent}"</div></div>`;
                         } else {
                             const score = parseFloat(val) || 0;
                             let maxScore = 10;
                             if (assess.type === 'range') maxScore = assess.max || 10;
                             else if (assess.options && assess.options.length > 0) maxScore = Math.max(...assess.options.map(o => Number(o.score || 0)));
                             const percent = maxScore > 0 ? (score / maxScore) * 100 : 0;
                             let barColor = 'bg-red-500';
                             if (formConfig.category === 'S') {
                                 if(percent >= 80) barColor = 'bg-red-500'; else if(percent >= 50) barColor = 'bg-yellow-500'; else barColor = 'bg-green-500';
                             } else {
                                 if(percent >= 80) barColor = 'bg-green-500'; else if(percent >= 50) barColor = 'bg-yellow-500'; else barColor = 'bg-red-500';
                             }
                             detailsHTML += `<div class="mb-2"><div class="flex justify-between text-[10px] text-slate-500 font-bold mb-1"><span>${assess.name}</span><span>${score}/${maxScore}</span></div><div class="h-2 w-full bg-white rounded-full overflow-hidden border border-blue-100"><div class="h-full ${barColor} rounded-full" style="width: ${percent}%"></div></div></div>`;
                         }
                     });
                     detailsHTML += `</div>`;
                 }
             });
             detailsHTML += `</div>`;
         }

         evalResultHTML = `
         <div class="mb-6 bg-blue-50/50 p-4 rounded-[2rem] border border-blue-100 transition-all duration-300 slide-up" style="animation-delay: 250ms">
             <div class="flex items-center justify-between mb-4">
                 <div class="flex items-center gap-3">
                    <div class="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center">
                        <i data-lucide="file-check" width="16"></i>
                    </div>
                    <label class="text-[10px] font-bold text-blue-500 uppercase tracking-widest">Initial Assessment</label>
                 </div>
                 <button onclick="toggleEvalDetails(this)" class="text-[10px] font-bold text-blue-500 hover:text-blue-700 bg-white border border-blue-200 px-3 py-1 rounded-full flex items-center gap-1 transition-all">
                    Show Details <i data-lucide="chevron-down" width="12"></i>
                 </button>
             </div>
             <div class="flex justify-between items-center bg-white p-4 rounded-xl shadow-sm relative z-10">
                <span class="text-sm font-bold text-slate-700">Total Score: <span class="text-lg font-black">${report.dynamic_data.eval_results_report.total}</span></span>
                <span class="px-4 py-1 rounded-lg text-white text-xs font-bold shadow-sm" style="background-color: ${report.dynamic_data.eval_results_report.color || '#94a3b8'}">${report.dynamic_data.eval_results_report.rank}</span>
             </div>
             ${detailsHTML}
         </div>`;
    }

    let cmSectionHTML = '';
    if (typeof getCMSectionHTML === 'function') {
        cmSectionHTML = getCMSectionHTML(report, formConfig);
    }

    c.innerHTML = `
        <div class="h-full flex flex-col relative bg-slate-50">
            <div class="absolute top-0 left-0 w-full pt-12 md:pt-14 pb-4 px-4 z-30 flex items-center justify-between bg-white/80 backdrop-blur-md border-b border-white/50 shadow-sm">
                <button onclick="closeDetailModal()" class="w-10 h-10 rounded-full flex items-center justify-center text-slate-600 hover:bg-slate-100 transition"><i data-lucide="arrow-left" width="20"></i></button>
                <div class="font-bold text-slate-700 text-sm">${t('report_detail')}</div>
                <div class="w-10"></div>
            </div>

            <div class="flex-1 overflow-y-auto pt-32 pb-24 px-6 md:px-12 no-scrollbar">

                <div class="bg-white p-5 rounded-3xl shadow-sm border border-slate-100 mb-6 slide-up relative">
                    <button id="btn-resend-${report.id}" onclick="resendNotification('${report.id}')" class="absolute top-5 right-5 h-9 px-3 bg-indigo-50 text-indigo-600 rounded-xl border border-indigo-100 shadow-sm hover:bg-indigo-100 active:scale-95 transition-all flex items-center gap-2 group">
                        <i data-lucide="bell-ring" width="16" class="group-hover:animate-swing"></i>
                        <span class="text-[10px] font-bold">Resend</span>
                    </button>
                    <h2 class="text-xl font-extrabold text-slate-800 mb-2 pr-16">${formConfig.title}</h2>
                    <div class="flex items-center gap-2 mb-4">
                        <span class="px-2 py-1 rounded-md bg-yellow-100 text-yellow-700 border border-yellow-200 text-[10px] font-bold">${report.status}</span>
                        <span class="text-xs text-slate-400">#${report.id}</span>
                    </div>
                    <div class="grid grid-cols-2 gap-4 border-t border-slate-100 pt-4">
                        <div><label class="text-[10px] text-slate-400 font-bold uppercase">${t('inspector_label')}</label><p class="text-sm font-bold text-slate-700">${report.inspector}</p></div>
                        <div><label class="text-[10px] text-slate-400 font-bold uppercase">${t('date_label')}</label><p class="text-sm font-bold text-slate-700">${new Date(report.created_at).toLocaleDateString()}</p></div>
                    </div>
                </div>

                ${imagesHTML}
                <div class="mb-6 slide-up" style="animation-delay: 200ms">
                    <label class="block text-[10px] font-bold text-slate-400 uppercase mb-2">${t('location_label')}</label>
                    <div class="h-40 rounded-2xl overflow-hidden relative shadow-sm border border-slate-200">
                        <div id="detail-map-modal" class="w-full h-full bg-slate-200"></div>
                        <div class="absolute bottom-2 left-2 bg-white/90 backdrop-blur px-3 py-1 rounded-lg text-xs font-bold text-slate-700 shadow-sm"><i data-lucide="map-pin" width="12" class="inline text-red-500"></i> ${report.location}</div>
                    </div>
                </div>
                <div class="md:grid md:grid-cols-2 md:gap-x-6">${fieldsHTML}</div>
                ${evalResultHTML}
                <div id="cm-section-container" class="slide-up" style="animation-delay: 400ms">${cmSectionHTML}</div>
            </div>
            ${actionButtons}
        </div>`;

    setTimeout(() => {
        if(window.lucide) lucide.createIcons();
        if (!window.google) return;
        const gps = { lat: report.gps_lat, lng: report.gps_lng };
        if(gps.lat === 0 && gps.lng === 0) {
            const mapEl = document.getElementById('detail-map-modal');
            if(mapEl) mapEl.innerHTML = '<div class="w-full h-full flex items-center justify-center text-slate-400 text-xs">No GPS Data</div>';
            return;
        }
        const mapEl = document.getElementById('detail-map-modal');
        if(mapEl) {
            const map = new google.maps.Map(mapEl, { center: gps, zoom: 17, mapTypeId: 'satellite', disableDefaultUI: true });
            new google.maps.Marker({ position: gps, map: map });
        }
    }, 200);
}

// 5. Update: Submit Approval (ปิด Modal เมื่อเสร็จ)
window.submitApproval = async function(reportId, status) {
    if(!confirm(`Confirm ${status}?`)) return;

    if(typeof showLoading === 'function') showLoading(true, "Processing...");

    try {
        const res = await fetch(`${API_URL}/approve/${reportId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                // 🔥 แก้ตรงนี้: ส่ง Name แทน UserID เพื่อให้แสดงผลสวยงาม 🔥
                approver: STATE.user ? STATE.user.name : 'Unknown',
                status: status
            })
        });

        if (res.ok) {
            if(typeof showToast === 'function') showToast(`Report ${status}`);

            // ปิดหน้า Detail Modal
            if(typeof closeDetailModal === 'function') closeDetailModal();

            // โหลดข้อมูลข้างหลังใหม่
            if(typeof fetchHistoryBackground === 'function') fetchHistoryBackground();
        } else {
             const err = await res.json();
             alert("Error: " + (err.error || "Unknown error"));
        }
    } catch (e) {
        alert("Error: " + e.message);
    } finally {
        if(typeof showLoading === 'function') showLoading(false);
    }
};

window.resendNotification = async function(reportId) {
    // 1. Confirm Interaction
    if(!confirm("ต้องการส่งแจ้งเตือนซ้ำไปยังผู้รับผิดชอบใช่หรือไม่?\n(Resend notification to responsible person?)")) return;

    // 2. UI Feedback (Loading State)
    const btn = document.getElementById(`btn-resend-${reportId}`);
    const originalContent = btn ? btn.innerHTML : '';

    if(btn) {
        btn.disabled = true;
        btn.classList.add('opacity-70', 'cursor-not-allowed');
        btn.innerHTML = `<i data-lucide="loader-2" class="animate-spin" width="18"></i>`;
        if(window.lucide) lucide.createIcons();
    }

    try {
        // 3. Call API
        const res = await fetch(`${API_URL}/resend-notify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: reportId })
        });

        const data = await res.json();

        if (res.ok && data.status === 'success') {
            // Success Feedback
            showToast(`📢 Sent to ${data.sent_count} people successfully!`);
        } else if (data.status === 'warning') {
            // Warning (No target found)
            alert(`⚠️ ${data.message}`);
        } else {
            // Error
            throw new Error(data.message || 'Server Error');
        }
    } catch(e) {
        console.error("Resend Error:", e);
        alert("❌ Failed to send: " + e.message);
    } finally {
        // 4. Restore Button State
        if(btn) {
            btn.disabled = false;
            btn.classList.remove('opacity-70', 'cursor-not-allowed');
            btn.innerHTML = originalContent;
            if(window.lucide) lucide.createIcons();
        }
    }
};

// 6. Update: Submit Countermeasure (รีเฟรช Modal เมื่อเสร็จ)
window.submitCountermeasure = async function(reportId) {
    const report = STATE.selectedReport;
    if(!report) return alert("Error: Report data is missing. Please reload.");

    if(typeof showLoading === 'function') showLoading(true, "Saving Countermeasure...");

    // 1. Gather CM Field Data
    const formConfig = STATE.config.forms.find(f => f.id === report.type_id);
    const cmData = {};

    (formConfig.cm_fields || []).forEach(f => {
        if(f.type === 'image') {
            cmData[f.id] = STATE.cmTempImages[f.id] || [];
        } else {
            const el = document.getElementById(`cm_${f.id}`);
            if(el) cmData[f.id] = el.value;
        }
    });

    Object.assign(cmData, STATE.evalScores);

    if (formConfig.linked_evals_cm && formConfig.linked_evals_cm.length > 0) {
        const mainEvalId = formConfig.linked_evals_cm[0];
        const evalConfig = STATE.config.evaluations.find(e => e.id === mainEvalId);
        if (evalConfig && typeof calculateEvalResult === 'function') {
            const result = calculateEvalResult(evalConfig, 'cm');
            cmData['eval_results_cm'] = {
                total: result.score,
                rank: result.label,
                color: result.color
            };
        }
    }

    // 4. Send to API
    try {
        const res = await fetch(`${API_URL}/inspections/${reportId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                status: 'Completed',
                dynamic_data: cmData,
                updated_by: STATE.user ? STATE.user.name : 'Unknown'
            })
        });

        if(res.ok) {
            if(typeof showToast === 'function') showToast("Countermeasure Saved!");
            STATE.isEditingCM = false;
            if (typeof openHistoryDetail === 'function') {
                openHistoryDetail(reportId);
            }
        } else {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.error || "Server returned " + res.status);
        }
    } catch(e) {
        console.error("Save CM Error:", e);
        alert("Error saving: " + e.message);
    } finally {
        if(typeof showLoading === 'function') showLoading(false);
    }
};

// ============================================================
// *** IMAGE GALLERY LOGIC (NO RE-RENDER) ***
// ============================================================

// 1. ฟังก์ชันสร้าง HTML ของ Gallery (Helper)
function generateImageGalleryItems() {
    // ดึงข้อมูลรูปปัจจุบันจาก State
    const images = (STATE.formData && STATE.formData.images) ? STATE.formData.images : [];

    return `
        <button onclick="document.getElementById('cam-input').click()" class="w-20 h-20 rounded-2xl border-2 border-dashed border-blue-300 bg-blue-50/50 flex flex-col items-center justify-center text-blue-400 hover:bg-blue-100 transition shrink-0">
            <i data-lucide="camera" width="24"></i><span class="text-[9px] font-bold mt-1">${t('add_photo')}</span>
        </button>

        <input type="file" id="cam-input" hidden accept="image/*" multiple onchange="handleImageUpload(this)">

        ${images.map((img, idx) => `
            <div class="w-20 h-20 rounded-2xl relative shrink-0 group">
                <img src="${img}" onclick="viewImage('${img}')" class="w-full h-full object-cover rounded-2xl shadow-sm border border-white cursor-pointer hover:opacity-90 shrink-0">
                <button onclick="removeImage(${idx})" class="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 shadow-md hover:scale-110 transition z-10"><i data-lucide="x" width="12"></i></button>
            </div>
        `).join('')}
    `;
}

// 2. ฟังก์ชันอัปเดต DOM เฉพาะส่วน Gallery (ไม่ Render ทั้งหน้า)
function updateReportImageGallery() {
    const container = document.getElementById('report_image_gallery');
    if(container) {
        // เปลี่ยนเฉพาะไส้ในของ div gallery
        container.innerHTML = generateImageGalleryItems();
        // โหลดไอคอนใหม่เฉพาะส่วนนี้
        if(window.lucide) lucide.createIcons();
    }
}

// 3. ฟังก์ชันจัดการเมื่ออัปโหลดไฟล์ (แก้ไขใหม่ ตัด render() ทิ้ง)
async function handleImageUpload(input) {
    if(input.files && input.files.length > 0) {
        const promises = Array.from(input.files).map(file => {
            return new Promise((resolve) => {
                const reader = new FileReader();
                reader.onload = (e) => resolve(e.target.result);
                reader.readAsDataURL(file);
            });
        });

        const newImages = await Promise.all(promises);

        // เพิ่มรูปลง State
        if (!STATE.formData.images) STATE.formData.images = [];
        STATE.formData.images.push(...newImages);

        // *** KEY FIX: เรียก updateReportImageGallery() แทน render() ***
        updateReportImageGallery();
    }
    input.value = ''; // เคลียร์ค่า input เพื่อให้เลือกไฟล์เดิมซ้ำได้ถ้าต้องการ
}

// 4. ฟังก์ชันลบรูป (แก้ไขใหม่ ตัด render() ทิ้ง)
function removeImage(i) {
    if (STATE.formData.images) {
        STATE.formData.images.splice(i, 1);

        // *** KEY FIX: เรียก updateReportImageGallery() แทน render() ***
        updateReportImageGallery();
    }
}

window.handleLocationChange = async (newLocName) => {
    STATE.formData.location = newLocName;

    // โหลดข้อมูลพนักงานถ้ายังไม่มี
    if (!STATE.employeesCache || STATE.employeesCache.length === 0) {
        await fetchEmployees();
    }

    // หา Location Config
    const locConfig = STATE.config.locations.find(l => (typeof l === 'string' ? l : l.name) === newLocName);
    if (!locConfig || typeof locConfig === 'string' || !locConfig.notify_value) return;

    // หา Form Config
    const formConfig = STATE.config.forms.find(f => f.id === STATE.formData.type_id);
    if (!formConfig) return;

    // Loop หาฟิลด์ที่ต้อง Auto-fill
    formConfig.fields.forEach(field => {
        let targetName = null;

        // เช็คว่าฟิลด์นี้รองรับ Auto-fill และถูกตั้ง Source เป็น Location หรือไม่
        const isTargetField = (field.type === 'employee_selector' || field.type === 'fixed_personnel' || field.type === 'personnel');

        if (isTargetField && field.source === 'location') {

            // --- CASE A: Target เป็น PERSON ---
            if (locConfig.notify_type === 'person') {
                const emp = STATE.employeesCache.find(e => String(e.employee_code) === String(locConfig.notify_value));
                if (emp) targetName = emp.full_name;
            }

            // --- CASE B: Target เป็น GROUP ---
            else if (locConfig.notify_type === 'group') {
                const group = (STATE.config.notify_groups || []).find(g => String(g.id) === String(locConfig.notify_value));
                if (group) {
                    targetName = `👥 ${group.name}`;
                }
            }
        }

        // ถ้าได้ชื่อมาแล้ว ให้เอาไปหยอดใส่ UI
        if (targetName) {
            STATE.formData.answers[field.id] = targetName;

            const hiddenInput = document.getElementById(`field_${field.id}`);
            if (hiddenInput) hiddenInput.value = targetName;

            // --- 1. อัปเดต UI แบบป้ายชื่อ (Fixed Mode) ---
            const isFixedMode = field.type === 'fixed_personnel' || (field.type === 'personnel' && field.personnel_mode === 'admin_fixed');

            if (isFixedMode) {
                const tagContainer = document.getElementById(`tags_${field.id}`);
                if (tagContainer) {
                    const isGroup = targetName.includes('👥');
                    const clickAttr = isGroup ? `onclick="viewGroupMembers('${targetName}')"` : '';
                    const cursorClass = isGroup ? 'cursor-pointer hover:bg-indigo-100 pointer-events-auto' : '';
                    const extraIcon = isGroup ? `<i data-lucide="info" width="12" class="text-indigo-400 ml-1"></i>` : '';

                    tagContainer.innerHTML = `
                        <div ${clickAttr} class="flex items-center gap-2 px-3 py-1 bg-indigo-50 border border-indigo-200 rounded-full shadow-sm animate-pulse ${cursorClass}">
                            <div class="w-6 h-6 rounded-full bg-indigo-200 text-indigo-600 flex items-center justify-center text-[10px] font-bold">
                                ${isGroup ? 'G' : targetName.charAt(0)}
                            </div>
                            <span class="text-xs font-bold text-slate-700">${targetName}</span>
                            ${extraIcon}
                        </div>`;
                }
            }

            // --- 2. อัปเดต UI แบบ Dropdown (User Select Mode) ---
            const isSelectMode = field.type === 'employee_selector' || (field.type === 'personnel' && (!field.personnel_mode || field.personnel_mode === 'user_select'));

            if (isSelectMode) {
                 const dispEl = document.getElementById(`disp_${field.id}`);
                 if(dispEl) {
                     const isGroup = targetName.includes('👥');
                     // สร้าง HTML ใหม่โดยใส่ปุ่ม View เข้าไปถ้าเป็นกลุ่ม
                     dispEl.innerHTML = `
                        <div onclick="toggleUserEmpSearch('${field.id}')" class="flex-1 flex items-center gap-2 cursor-pointer overflow-hidden">
                            <span class="truncate font-bold text-brand-700">${targetName}</span>
                        </div>
                        <div class="flex items-center gap-2 pl-2">
                            ${isGroup ? `
                                <button onclick="viewGroupMembers('${targetName}')" class="p-1.5 bg-indigo-100 text-indigo-600 rounded-full hover:bg-indigo-200 transition-colors" title="View Members">
                                    <i data-lucide="users" width="14"></i>
                                </button>
                            ` : ''}
                            <div class="flex items-center gap-1">
                                <i data-lucide="zap" width="12" class="text-brand-500"></i>
                                <i data-lucide="check" width="14" class="text-green-500"></i>
                            </div>
                        </div>`;

                     dispEl.classList.add('bg-brand-50', 'border-brand-200');
                 }
            }
        }
    });

    if(window.lucide) lucide.createIcons();
};

// ==========================================
// *** NEW HELPER FUNCTIONS FOR DROPDOWN ***
// ==========================================

async function fetchEmployees() {
    if (STATE.employeesCache.length > 0) return;
    try {
        const res = await fetch(`${API_URL}/employees`);
        if (res.ok) STATE.employeesCache = await res.json();
    } catch (e) { console.error("Failed to load employees", e); }
}

window.toggleUserEmpSearch = (fieldId) => {
    document.querySelectorAll('[id^="list_panel_"]').forEach(el => {
        if(el.id !== `list_panel_${fieldId}`) el.style.display = 'none';
    });
    const panel = document.getElementById(`list_panel_${fieldId}`);
    const searchInput = document.getElementById(`search_${fieldId}`);
    if (panel.style.display === 'none') {
        panel.style.display = 'block';
        if(searchInput) setTimeout(() => searchInput.focus(), 100);
    } else {
        panel.style.display = 'none';
    }
};

window.filterUserEmpList = (fieldId, text) => {
    const list = document.getElementById(`list_panel_${fieldId}`);
    const items = list.querySelectorAll('.emp-option-item');
    const filter = text.toLowerCase();
    items.forEach(item => {
        const txt = item.getAttribute('data-search');
        if(txt.includes(filter)) item.style.display = 'flex';
        else item.style.display = 'none';
    });
};

window.selectUserEmp = (fieldId, name) => {
    STATE.formData.answers[fieldId] = name;
    const dispEl = document.getElementById(`disp_${fieldId}`);
    if(dispEl) {
        dispEl.innerHTML = `<span class="truncate">${name}</span><i data-lucide="chevron-down" width="16" class="text-slate-400"></i>`;
        dispEl.classList.remove('text-slate-400', 'font-normal');
        dispEl.classList.add('text-slate-700', 'font-bold');
    }
    document.getElementById(`list_panel_${fieldId}`).style.display = 'none';
    if(window.lucide) lucide.createIcons();
};

window.closeAllUserDropdowns = (e) => {
    if (!e.target.closest('.emp-selector-container')) {
        document.querySelectorAll('[id^="list_panel_"]').forEach(el => el.style.display = 'none');
    }
};

// ฟังก์ชันแสดงรายชื่อสมาชิกในกลุ่ม (Modal)
window.viewGroupMembers = (groupNameWithIcon) => {
    // 1. ตัดไอคอน 👥 ออกเพื่อเอาเฉพาะชื่อ
    const cleanName = groupNameWithIcon.replace('👥', '').trim();

    // 2. ค้นหากลุ่มใน Config
    const group = (STATE.config.notify_groups || []).find(g => g.name === cleanName);

    if (!group || !group.members || group.members.length === 0) {
        showToast("No members found in this group");
        return;
    }

    // 3. สร้าง Modal HTML
    let modal = document.getElementById('group-members-modal');
    if (modal) modal.remove(); // ลบอันเก่าถ้ามี

    modal = document.createElement('div');
    modal.id = 'group-members-modal';
    modal.className = 'fixed inset-0 z-[80] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-[fadeIn_0.2s_ease-out]';

    // สร้าง List สมาชิกพร้อมรูปภาพ
    const membersListHTML = group.members.map(m => `
        <div class="flex items-center gap-3 p-3 bg-slate-50 rounded-xl border border-slate-100">
            ${getEmployeeImgHtml(m.code, m.name, "w-10 h-10", "text-xs")}

            <div>
                <div class="text-sm font-bold text-slate-700">${m.name}</div>
                <div class="text-[10px] text-slate-400">${m.position || 'Staff'}</div>
            </div>
        </div>
    `).join('');

    modal.innerHTML = `
        <div class="bg-white w-full max-w-sm rounded-[2rem] shadow-2xl overflow-hidden slide-up">
            <div class="bg-brand-600 p-4 flex justify-between items-center text-white">
                <div class="flex items-center gap-2">
                    <i data-lucide="users" width="20"></i>
                    <div>
                        <h3 class="font-bold text-sm leading-tight">${group.name}</h3>
                        <p class="text-[10px] text-blue-100">${group.members.length} Members</p>
                    </div>
                </div>
                <button onclick="document.getElementById('group-members-modal').remove()" class="w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center transition-all">
                    <i data-lucide="x" width="18"></i>
                </button>
            </div>
            <div class="p-4 max-h-[60vh] overflow-y-auto space-y-2 custom-scrollbar">
                ${membersListHTML}
            </div>
        </div>
    `;

    document.body.appendChild(modal);
    if(window.lucide) lucide.createIcons();
};

async function syncUserLanguage(empCode) {
    if (!empCode) return;
    try {
        const res = await fetch(`${API_URL}/user/language?employee_code=${empCode}`);
        const data = await res.json();

        if (data.language) {
            // อ่านค่า Cookie ภาษาปัจจุบันของ Google (Format: /auto/en หรือ /th/en)
            const currentCookie = getCookie('googtrans');
            let currentLang = 'th'; // ค่าเริ่มต้นถ้าไม่มี Cookie

            if (currentCookie) {
                const parts = currentCookie.split('/');
                if (parts.length >= 3) currentLang = parts[2];
            }

            console.log(`🌍 Language Check - DB: ${data.language} | Current: ${currentLang}`);

            // ถ้าค่าใน DB ไม่ตรงกับที่ใชอยู่ ให้เปลี่ยนทันที
            if (data.language !== currentLang) {
                console.log("🔄 Syncing language from DB...");
                changeLanguage(data.language);
            }
        }
    } catch (e) {
        console.error("Error syncing language:", e);
    }
}

// 2. บันทึกภาษาลง DB เมื่อกดปุ่มเปลี่ยน
async function setUserLanguage(lang) {
    // 1. ถ้ายังไม่ Login ให้เปลี่ยนเลย
    if (!STATE.user || !STATE.user.employee_code) {
        changeLanguage(lang);
        return;
    }

    if(typeof showLoading === 'function') showLoading(true, "Switching Language...");

    try {
        await fetch(`${API_URL}/user/language`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                employee_code: STATE.user.employee_code,
                language: lang
            })
        });
    } catch (e) {
        console.warn("Failed to save language preference", e);
    }

    // [NEW] ฝัง Flag ไว้ใน Session ว่า "การ Reload ครั้งนี้มาจากการเปลี่ยนภาษา"
    sessionStorage.setItem('mw_skip_pin_for_lang', 'true');

    // สั่งเปลี่ยนภาษา (ซึ่งจะ Reload หน้าเว็บ)
    changeLanguage(lang);
}

// Helper: อ่าน Cookie (เผื่อ shared.js ไม่มี)
function getCookie(name) {
    const v = document.cookie.match('(^|;) ?' + name + '=([^;]*)(;|$)');
    return v ? v[2] : null;
}

// ==========================================
// FIX: PREVENT ZOOM (Final Safe Version)
// ==========================================
(function preventZoomBehavior() {
    // ฟังก์ชันตรวจสอบว่าเป็นแผนที่หรือไม่
    function isMap(target) {
        return target.closest('.gm-style') ||
               target.closest('div[id*="map"]') ||
               target.tagName === 'TEXTAREA' ||
               target.tagName === 'INPUT'; // ยกเว้น Input ด้วยเพื่อให้พิมพ์ได้ปกติ
    }

    const options = { passive: false };

    // 1. Gesture Zoom (Pinch)
    document.addEventListener('gesturestart', function (e) {
        if (e.cancelable) e.preventDefault();
    }, options);

    // 2. Double Tap Zoom (Touch End)
    let lastTouchEnd = 0;
    document.addEventListener('touchend', function (event) {
        if (isMap(event.target)) return; // ถ้าแตะแผนที่ ให้ปล่อยผ่าน

        const now = (new Date()).getTime();
        if (now - lastTouchEnd <= 300) {
            if (event.cancelable) event.preventDefault();
        }
        lastTouchEnd = now;
    }, options);

    // 3. [NEW] เพิ่มการดัก Touch Start เพื่อกัน Error Intervention
    document.addEventListener('touchstart', function (event) {
        if (isMap(event.target)) return; // ถ้าแตะแผนที่ ให้ปล่อยผ่านทันที

        if (event.touches.length > 1) {
            // ถ้าใช้ 2 นิ้วจิ้ม (นอกแผนที่) ให้กันไว้ก่อน
            if (event.cancelable) event.preventDefault();
        }
    }, options);

    // 4. Desktop Zoom Keys
    document.addEventListener('keydown', function (event) {
        if ((event.ctrlKey || event.metaKey) && (['+', '-', '='].includes(event.key))) {
            if (event.cancelable) event.preventDefault();
        }
    });

    // 5. Wheel Zoom
    document.addEventListener('wheel', function (event) {
        if (event.ctrlKey) {
            if (event.cancelable) event.preventDefault();
        }
    }, options);

})();



loadGoogleMapsScript();
loadConfig();
render();
