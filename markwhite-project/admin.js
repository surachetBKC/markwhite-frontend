// *** ADMIN CONSOLE & EDITOR LOGIC ***
if (!STATE.employeesCache) STATE.employeesCache = [];
STATE.activeLocationSearchIdx = null; // เก็บ Index ของ Location ที่กำลังเปิด Dropdown ค้นหาอยู่

function enterAdminMode() {
    STATE.tempConfig = JSON.parse(JSON.stringify(STATE.config));
    if (!STATE.tempConfig.notify_groups) STATE.tempConfig.notify_groups = [];
    STATE.view = 'admin';
    STATE.adminTab = 'forms';
    render();
}

function switchAdminTab(tab) {
    STATE.adminTab = tab;
    // โหลดข้อมูลพนักงานเมื่อเข้าหน้า Groups หรือ Locations
    if ((tab === 'groups' || tab === 'locations') && STATE.employeesCache.length === 0) {
        fetchEmployees();
    }
    // ปิด Search Dropdown ที่ค้างอยู่
    STATE.activeLocationSearchIdx = null;
    render();
}

// ==========================================
// ส่วนที่ 2: Logic การ Render (โฟกัสแก้ไข Tab Locations)
// ==========================================

function renderAdmin(c) {
    let content = '';

    // --- TAB: FORMS ---
    if (STATE.adminTab === 'forms') {
        const keys = ['ALL', 'S', 'L', 'Q', 'D', 'C', 'O'];
        const filterHTML = `
            <div class="flex gap-2 overflow-x-auto pb-4 mb-2 no-scrollbar px-1">
                ${keys.map(k => {
                    const active = STATE.adminCategoryFilter === k;
                    let style = active ? 'bg-slate-800 text-white shadow-lg' : 'glass-panel text-slate-500 hover:bg-white';
                        if (k !== 'ALL' && active) {
                        if(k==='S') style = 'bg-green-500 text-white shadow-lg shadow-green-200';
                        if(k==='L') style = 'bg-purple-500 text-white shadow-lg shadow-purple-200';
                        if(k==='Q') style = 'bg-blue-500 text-white shadow-lg shadow-blue-200';
                        if(k==='D') style = 'bg-orange-500 text-white shadow-lg shadow-orange-200';
                        if(k==='C') style = 'bg-yellow-500 text-white shadow-lg shadow-yellow-200';
                    }
                    return `<button onclick="STATE.adminCategoryFilter='${k}'; render()" class="px-4 py-2 rounded-full text-xs font-bold whitespace-nowrap transition-all ${style}">${k==='ALL' ? 'All' : CATEGORIES[k].label}</button>`;
                }).join('')}
            </div>
        `;

        const filteredForms = STATE.tempConfig.forms.filter(f => STATE.adminCategoryFilter === 'ALL' || (f.category || 'O') === STATE.adminCategoryFilter);

        const formsHTML = filteredForms.map((f, idx) => {
            const originalIdx = STATE.tempConfig.forms.indexOf(f);
            const cat = f.category || 'O';
            const reportCount = f.fields ? f.fields.length : 0;
            const cmCount = f.cm_fields ? f.cm_fields.length : 0;
            return `
            <div class="glass-panel p-4 rounded-3xl mb-3 flex justify-between items-center cursor-pointer hover:border-brand-300 transition group" onclick="editFormStructure(${originalIdx})">
                <div class="flex items-center gap-4">
                    <div class="w-10 h-10 rounded-xl ${f.logoColor || f.color} text-white flex items-center justify-center shadow-md group-hover:scale-110 transition-transform"><i data-lucide="${f.icon}" width="20"></i></div>
                    <div>
                        <h4 class="font-bold text-slate-800 text-sm">${f.title}</h4>
                        <div class="flex items-center gap-2 mt-1">
                                <span class="text-[9px] px-2 py-0.5 rounded-full ${f.tagColor || 'bg-slate-100'} border border-current opacity-80 font-bold">${CATEGORIES[cat].label}</span>
                                <span class="text-[10px] text-slate-400">R:${reportCount} | CM:${cmCount}</span>
                        </div>
                    </div>
                </div>
                <button onclick="event.stopPropagation(); deleteForm(${originalIdx})" class="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-full transition"><i data-lucide="trash-2" width="18"></i></button>
            </div>`;
        }).join('');

            content = `
            ${filterHTML}
            <div class="flex justify-between items-center mb-4 mt-2">
                <h3 class="text-xs font-bold text-slate-500 uppercase tracking-wider pl-2">Active Forms (${filteredForms.length})</h3>
                <button onclick="createNewForm()" class="text-xs font-bold text-brand-600 bg-brand-50 px-3 py-1.5 rounded-lg border border-brand-100 flex items-center gap-1 hover:shadow-md transition-all"><i data-lucide="plus" width="14"></i> New</button>
            </div>
            ${formsHTML}
            ${filteredForms.length === 0 ? '<div class="text-center py-10 text-slate-400 text-xs">No forms in this category.</div>' : ''}
        `;
    }
    // --- TAB: EVALUATIONS ---
    else if (STATE.adminTab === 'evaluations') {
        const evals = STATE.tempConfig.evaluations || [];
        const evalsHTML = evals.map((e, idx) => {
            const assessmentsCount = (e.assessments || e.items || []).length;
            return `
            <div class="glass-panel p-4 rounded-3xl mb-3 flex justify-between items-center cursor-pointer hover:border-purple-300 transition group" onclick="openEvalEditor(${idx})">
                <div class="flex items-center gap-4">
                    <div class="w-10 h-10 rounded-xl bg-purple-500 text-white flex items-center justify-center shadow-md group-hover:scale-110 transition-transform"><i data-lucide="calculator" width="20"></i></div>
                    <div>
                        <h4 class="font-bold text-slate-800 text-sm">${e.name}</h4>
                        <div class="flex items-center gap-2 mt-1">
                            <span class="text-[10px] text-slate-400">${assessmentsCount} Assessments</span>
                            <span class="text-[10px] text-slate-400">|</span>
                            <span class="text-[10px] text-slate-400">Custom Formula</span>
                        </div>
                    </div>
                </div>
                <button onclick="event.stopPropagation(); deleteEval(${idx})" class="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-full transition"><i data-lucide="trash-2" width="18"></i></button>
            </div>`;
        }).join('');

        content = `
        <div class="flex justify-between items-center mb-4 mt-2">
            <h3 class="text-xs font-bold text-slate-500 uppercase tracking-wider pl-2">Evaluation Systems (${evals.length})</h3>
            <button onclick="createNewEval()" class="text-xs font-bold text-purple-600 bg-purple-50 px-3 py-1.5 rounded-lg border border-purple-100 flex items-center gap-1 hover:shadow-md transition-all"><i data-lucide="plus" width="14"></i> New Eval</button>
        </div>
        ${evalsHTML}
        ${evals.length === 0 ? '<div class="text-center py-10 text-slate-400 text-xs">No evaluations created.</div>' : ''}
        `;
    }
    // --- TAB: GROUPS ---
    else if (STATE.adminTab === 'groups') {
        const groups = STATE.tempConfig.notify_groups || [];

        const groupsHTML = groups.map((g, idx) => {
            return `
            <div class="glass-panel p-4 rounded-3xl mb-3 flex justify-between items-center cursor-pointer hover:border-pink-300 transition group" onclick="openGroupEditor(${idx})">
                <div class="flex items-center gap-4">
                    <div class="w-10 h-10 rounded-xl bg-pink-500 text-white flex items-center justify-center shadow-md group-hover:scale-110 transition-transform">
                        <i data-lucide="users" width="20"></i>
                    </div>
                    <div>
                        <h4 class="font-bold text-slate-800 text-sm">${g.name}</h4>
                        <div class="flex items-center gap-2 mt-1">
                            <span class="text-[10px] text-slate-400">${g.members ? g.members.length : 0} Members</span>
                        </div>
                    </div>
                </div>
                <button onclick="event.stopPropagation(); deleteGroup(${idx})" class="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-full transition"><i data-lucide="trash-2" width="18"></i></button>
            </div>`;
        }).join('');

        content = `
            <div class="flex justify-between items-center mb-4 mt-2">
                <h3 class="text-xs font-bold text-slate-500 uppercase tracking-wider pl-2">Notify Groups (${groups.length})</h3>
                <button onclick="createNewGroup()" class="text-xs font-bold text-pink-600 bg-pink-50 px-3 py-1.5 rounded-lg border border-pink-100 flex items-center gap-1 hover:shadow-md transition-all">
                    <i data-lucide="plus" width="14"></i> New Group
                </button>
            </div>
            ${groupsHTML}
            ${groups.length === 0 ? '<div class="text-center py-10 text-slate-400 text-xs">No groups created.</div>' : ''}
        `;
    }

    // ==========================================
    // TAB: LOCATIONS (FIXED SEARCH BOX & TYPE SWITCH)
    // ==========================================
    else if (STATE.adminTab === 'locations') {
        const locations = STATE.tempConfig.locations || [];
        const groups = STATE.tempConfig.notify_groups || [];
        const employees = STATE.employeesCache || [];

        content = `
            <div class="glass-panel rounded-3xl overflow-visible min-h-[400px]"> <div class="p-4 bg-white/50 border-b border-white/50 flex justify-between items-center">
                    <h3 class="font-bold text-slate-800 text-sm">Master Locations & Contacts</h3>
                    <button onclick="addNewLocation()" class="text-xs bg-brand-600 text-white px-3 py-1.5 rounded-lg font-bold hover:bg-brand-700 shadow-md flex items-center gap-1">
                        <i data-lucide="plus" width="14"></i> Add Location
                    </button>
                </div>
                <div class="divide-y divide-white/50" onclick="closeAllLocDropdowns()">
                    ${locations.map((loc, i) => {
                        // Normalize Data
                        const name = typeof loc === 'string' ? loc : loc.name;
                        const notifyType = (typeof loc === 'object' && loc.notify_type) ? loc.notify_type : (loc.email ? 'email' : 'person');
                        const notifyValue = (typeof loc === 'object' && loc.notify_value) ? loc.notify_value : (loc.email || '');

                        let inputHTML = '';

                        // --- CASE 1: PERSON (Searchable Dropdown) ---
                        if(notifyType === 'person') {
                            const empName = employees.find(e => String(e.employee_code) === String(notifyValue))?.full_name || '-- Select Employee --';
                            const isSearchOpen = STATE.activeLocationSearchIdx === i;

                            // *** แก้ไข: เพิ่ม z-index ให้ dropdown และปรับสีกล่องค้นหาให้ชัด ***
                            inputHTML = `
                                <div class="relative w-full" onclick="event.stopPropagation()">
                                    <button onclick="toggleLocSearch(${i})" class="w-full text-left text-xs text-slate-700 bg-white border border-slate-200 rounded px-2 py-1.5 outline-none hover:border-brand-500 focus:border-brand-500 flex justify-between items-center shadow-sm">
                                        <span class="truncate">${notifyValue ? empName : '<span class="text-slate-400">Select Employee...</span>'}</span>
                                        <i data-lucide="chevron-down" width="14" class="text-slate-400"></i>
                                    </button>

                                    ${isSearchOpen ? `
                                    <div class="absolute top-full left-0 w-full bg-white border border-slate-200 rounded-xl shadow-2xl mt-1 z-[99] overflow-hidden slide-up-sm ring-1 ring-black/5">
                                        <div class="p-2 border-b border-slate-100 bg-slate-50 sticky top-0">
                                            <input type="text"
                                                   id="loc-search-input-${i}"
                                                   onkeyup="filterLocEmployees(${i}, this.value)"
                                                   placeholder="🔍 Search name..."
                                                   class="w-full text-xs p-2 rounded-lg border border-slate-300 bg-white text-slate-800 outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-200 shadow-inner">
                                        </div>
                                        <div id="loc-search-list-${i}" class="max-h-48 overflow-y-auto p-1 bg-white">
                                            ${employees.map(emp => `
                                                <div onclick="selectLocationEmployee(${i}, '${emp.employee_code}')" class="loc-emp-item p-2 hover:bg-brand-50 rounded-lg cursor-pointer text-xs text-slate-700 flex flex-col border-b border-transparent hover:border-brand-100 transition-colors" data-search="${emp.full_name.toLowerCase()}">
                                                    <span class="font-bold">${emp.full_name}</span>
                                                    <span class="text-[9px] text-slate-400">${emp.position_name_th || '-'}</span>
                                                </div>
                                            `).join('')}
                                        </div>
                                    </div>
                                    ` : ''}
                                </div>
                            `;
                        }
                        // --- CASE 2: GROUP (Standard Select) ---
                        else if(notifyType === 'group') {
                            inputHTML = `
                                <select onchange="updateLocation(${i}, 'notify_value', this.value)" class="w-full text-xs text-pink-700 bg-pink-50 border border-pink-200 rounded px-2 py-1.5 outline-none focus:border-pink-500 cursor-pointer">
                                    <option value="" ${!notifyValue?'selected':''}>-- Select Group --</option>
                                    ${groups.map(g =>
                                        `<option value="${g.id}" ${notifyValue==g.id?'selected':''}>👥 ${g.name}</option>`
                                    ).join('')}
                                </select>`;
                        }
                        // --- CASE 3: EMAIL (Manual Input) ---
                        else {
                            inputHTML = `
                                <input type="text" value="${notifyValue}" onchange="updateLocation(${i}, 'notify_value', this.value)" class="w-full text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded px-2 py-1.5 outline-none focus:border-slate-500" placeholder="alert@example.com">
                            `;
                        }

                        // เพิ่ม z-index แบบ dynamic: แถวบนๆ จะมี z-index สูงกว่าแถวล่าง เพื่อให้ Dropdown ทับแถวล่างได้
                        return `
                        <div class="p-4 flex gap-4 items-start group hover:bg-white/30 transition relative" style="z-index: ${100 - i};">
                            <div class="flex-[2]">
                                <label class="text-[9px] text-slate-400 font-bold uppercase mb-1 block">Location Name</label>
                                <input value="${name}" onchange="updateLocation(${i}, 'name', this.value)" class="w-full text-sm font-bold text-slate-700 bg-transparent border-b border-transparent hover:border-slate-300 focus:border-brand-500 outline-none transition-colors py-1" placeholder="Location Name">
                            </div>

                            <div class="flex-[3]">
                                <div class="flex justify-between items-center mb-1">
                                    <label class="text-[9px] text-slate-400 font-bold uppercase flex items-center gap-1"><i data-lucide="bell" width="10"></i> Notify Target</label>

                                    <select onchange="updateLocation(${i}, 'notify_type', this.value)" class="text-[9px] bg-white border border-slate-200 rounded px-1 py-0.5 outline-none cursor-pointer hover:border-brand-400 text-slate-600 font-bold">
                                        <option value="person" ${notifyType==='person'?'selected':''}>👤 Person</option>
                                        <option value="group" ${notifyType==='group'?'selected':''}>👥 Group</option>
                                        <option value="email" ${notifyType==='email'?'selected':''}>📧 Email</option>
                                    </select>
                                </div>
                                ${inputHTML}
                            </div>

                            <div class="pt-4">
                                <button onclick="removeLocation(${i})" class="text-slate-300 hover:text-red-500 p-2 transition bg-white/50 rounded-full hover:bg-red-50"><i data-lucide="trash-2" width="16"></i></button>
                            </div>
                        </div>`;
                    }).join('')}
                    ${locations.length === 0 ? '<div class="text-center py-10 text-slate-400 text-xs">No locations defined.</div>' : ''}
                </div>
            </div>
        `;
    }
    // --- TAB: MAP ---
    else if (STATE.adminTab === 'map') {
        content = `
            <div class="glass-panel p-8 rounded-3xl text-center">
                <div class="w-16 h-16 bg-blue-50 text-brand-600 rounded-full flex items-center justify-center mx-auto mb-4 border-4 border-white shadow-sm">
                    <i data-lucide="map" width="32"></i>
                </div>
                <h3 class="font-bold text-slate-800 mb-2">Factory Map (KML)</h3>
                <label class="block w-full border-2 border-dashed border-brand-300 rounded-xl p-6 cursor-pointer hover:border-brand-500 hover:bg-brand-50/50 transition-all group relative overflow-hidden">
                    <div class="text-slate-400 group-hover:text-brand-600 text-sm font-bold flex flex-col items-center gap-2">
                        <i data-lucide="upload-cloud" width="24"></i>
                        <span>Click to Upload KML</span>
                    </div>
                    <input type="file" accept=".kml" hidden onchange="handleKMLUpload(this)">
                </label>
                ${STATE.tempConfig.mapKml ? `<div class="mt-4 p-3 bg-green-50 text-green-700 text-xs rounded-xl border border-green-200 flex items-center justify-center gap-2 font-bold"><i data-lucide="check-circle" width="14"></i> KML Loaded</div>` : ''}
            </div>
            `;
    }

    // MAIN RENDER CONTAINER
    c.innerHTML = `
        <div class="h-full flex flex-col bg-slate-50/50 backdrop-blur-xl fade-in" onclick="closeAllLocDropdowns()">
            <div class="bg-white/80 pt-12 pb-4 px-4 border-b border-slate-200 flex justify-between items-center shadow-sm z-20">
                <div class="flex items-center gap-2">
                    <button onclick="STATE.view='home'; render()" class="p-2 hover:bg-slate-100 rounded-full transition"><i data-lucide="arrow-left" width="20"></i></button>
                    <h2 class="font-bold text-slate-800">Admin Console</h2>
                </div>
                <button onclick="saveConfigToDB(this)" class="bg-green-500 text-white px-4 py-2 rounded-lg text-xs font-bold shadow hover:bg-green-600 transition flex items-center gap-2"><i data-lucide="save" width="14"></i> Save</button>
            </div>
                <div class="p-4 flex gap-2 overflow-x-auto border-b border-slate-100 bg-white/50 z-10 no-scrollbar">
                <button onclick="switchAdminTab('forms')" class="px-5 py-2 rounded-full text-xs font-bold transition-all whitespace-nowrap ${STATE.adminTab==='forms'?'bg-slate-800 text-white shadow-md':'bg-white border hover:bg-slate-50'}">FORMS</button>
                <button onclick="switchAdminTab('evaluations')" class="px-5 py-2 rounded-full text-xs font-bold transition-all whitespace-nowrap ${STATE.adminTab==='evaluations'?'bg-slate-800 text-white shadow-md':'bg-white border hover:bg-slate-50'}">EVALUATIONS</button>
                <button onclick="switchAdminTab('groups')" class="px-5 py-2 rounded-full text-xs font-bold transition-all whitespace-nowrap ${STATE.adminTab==='groups'?'bg-slate-800 text-white shadow-md':'bg-white border hover:bg-slate-50'}">GROUPS</button>
                <button onclick="switchAdminTab('locations')" class="px-5 py-2 rounded-full text-xs font-bold transition-all whitespace-nowrap ${STATE.adminTab==='locations'?'bg-slate-800 text-white shadow-md':'bg-white border hover:bg-slate-50'}">LOCATIONS</button>
                <button onclick="switchAdminTab('map')" class="px-5 py-2 rounded-full text-xs font-bold transition-all whitespace-nowrap ${STATE.adminTab==='map'?'bg-slate-800 text-white shadow-md':'bg-white border hover:bg-slate-50'}">MAP (KML)</button>
            </div>
            <div class="flex-1 overflow-y-auto p-5 pb-24">
                ${content}
            </div>
            ${renderGroupEditorModal()}
        </div>`;

    lucide.createIcons();
}

// ==========================================
// ส่วนที่ 3: Helper Functions สำหรับ Location Search & Logic
// ==========================================

// เปิด/ปิด Dropdown ค้นหา
window.toggleLocSearch = (idx) => {
    // ถ้าเปิดอันเดิมอยู่ ให้ปิด (Toggle) ถ้าเปิดอันใหม่ ให้เซ็ตค่าใหม่
    STATE.activeLocationSearchIdx = (STATE.activeLocationSearchIdx === idx) ? null : idx;
    render();

    // Auto Focus ช่องค้นหาหลังจาก Render เสร็จ
    if(STATE.activeLocationSearchIdx === idx) {
        setTimeout(() => {
            const input = document.getElementById(`loc-search-input-${idx}`);
            if(input) input.focus();
        }, 50);
    }
};

// ปิด Dropdown ทั้งหมด (เมื่อคลิกที่ว่าง)
window.closeAllLocDropdowns = () => {
    if(STATE.activeLocationSearchIdx !== null) {
        STATE.activeLocationSearchIdx = null;
        render();
    }
};

// เลือกพนักงานจาก Dropdown
window.selectLocationEmployee = (locIdx, empCode) => {
    STATE.tempConfig.locations[locIdx].notify_value = empCode;
    STATE.activeLocationSearchIdx = null; // ปิด Dropdown
    render();
};

// ฟังก์ชันกรองรายชื่อ (Filter Logic)
window.filterLocEmployees = (locIdx, text) => {
    const listContainer = document.getElementById(`loc-search-list-${locIdx}`);
    if(!listContainer) return;

    const items = listContainer.getElementsByClassName('loc-emp-item');
    const filter = text.toLowerCase();

    for (let i = 0; i < items.length; i++) {
        const name = items[i].getAttribute('data-search');
        if (name.includes(filter)) {
            items[i].style.display = "flex";
        } else {
            items[i].style.display = "none";
        }
    }
};

// *** FIX: แก้ไข updateLocation ให้รองรับการเปลี่ยน Type แล้ว Render ทันที ***
window.updateLocation = (idx, key, val) => {
    // แปลง Legacy Data เป็น Object ถ้าจำเป็น
    if (typeof STATE.tempConfig.locations[idx] === 'string') {
        STATE.tempConfig.locations[idx] = {
            name: STATE.tempConfig.locations[idx],
            notify_type: 'person',
            notify_value: ''
        };
    }

    STATE.tempConfig.locations[idx][key] = val;

    // ถ้าเปลี่ยน Type ให้เคลียร์ค่าเก่าทิ้ง และ Re-render ทันทีเพื่อเปลี่ยน Input Field
    if (key === 'notify_type') {
        STATE.tempConfig.locations[idx].notify_value = '';
        render(); // << จุดสำคัญที่ขาดไปก่อนหน้านี้
    }
};

window.addNewLocation = () => {
    if (!STATE.tempConfig.locations) STATE.tempConfig.locations = [];
    STATE.tempConfig.locations.push({
        name: "New Area",
        notify_type: "person",
        notify_value: ""
    });
    render();
};

// --- GROUP EDITOR LOGIC ---

function createNewGroup() {
    STATE.tempConfig.notify_groups.push({
        id: "grp_" + Date.now(),
        name: "New Group",
        members: [] // Array of {code, name, position}
    });
    render();
    openGroupEditor(STATE.tempConfig.notify_groups.length - 1);
}

function openGroupEditor(idx) {
    STATE.editingGroupIdx = idx;
    const modal = document.getElementById('group-editor-modal');
    if(modal) {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        renderGroupEditorContent();
    }
}

function closeGroupEditor() {
    const modal = document.getElementById('group-editor-modal');
    if(modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
}

function deleteGroup(idx) {
    if(confirm("Delete this group?")) {
        STATE.tempConfig.notify_groups.splice(idx, 1);
        render();
    }
}

// 1. ฟังก์ชันแสดงหน้าต่าง Group Editor (แก้ไขให้เรียก render รายชื่อแบบถูกต้อง)
function renderGroupEditorContent() {
    const group = STATE.tempConfig.notify_groups[STATE.editingGroupIdx];
    const container = document.getElementById('group-editor-content');

    // 1. เตรียมตัวเลือกสำหรับ Dropdown (Unique Values)
    const emps = STATE.employeesCache || [];
    const getUnique = (key) => [...new Set(emps.map(e => e[key]).filter(x => x && x !== '-'))].sort();

    const depts = getUnique('department_th');
    const sects = getUnique('section_th');
    const positions = getUnique('position_name_th');

    // 2. สร้าง HTML
    container.innerHTML = `
        <div class="mb-4">
            <label class="text-xs font-bold text-slate-700">Group Name</label>
            <input value="${group.name}" onchange="updateGroupName(${STATE.editingGroupIdx}, this.value)" class="w-full p-3 glass-input rounded-xl text-sm font-bold outline-none mt-1 focus:ring-2 focus:ring-pink-300 transition-all">
        </div>

        <div class="flex gap-4 h-[500px]"> <div class="flex-1 flex flex-col glass-panel rounded-2xl overflow-hidden shadow-sm">
                <div class="p-3 bg-pink-50 border-b border-pink-100 flex justify-between items-center">
                    <h4 class="text-xs font-bold text-pink-700 uppercase">Members (${group.members.length})</h4>
                    ${group.members.length > 0 ? `<button onclick="removeAllMembers()" class="text-[9px] text-red-500 hover:text-red-700 font-bold hover:underline">Remove All</button>` : ''}
                </div>
                <div class="flex-1 overflow-y-auto p-2 space-y-2 custom-scrollbar">
                    ${group.members.map((m, i) => `
                        <div class="flex justify-between items-center p-2 bg-white rounded-lg border border-slate-100 shadow-sm hover:shadow-md transition-all">
                            <div>
                                <div class="text-xs font-bold text-slate-700">${m.name}</div>
                                <div class="text-[9px] text-slate-400">${m.position || '-'}</div>
                            </div>
                            <button onclick="removeMemberFromGroup(${i})" class="text-slate-300 hover:text-red-500 transition-colors"><i data-lucide="minus-circle" width="16"></i></button>
                        </div>
                    `).join('')}
                    ${group.members.length === 0 ? '<div class="h-full flex flex-col items-center justify-center text-slate-300 text-xs"><i data-lucide="users" width="32" class="mb-2 opacity-50"></i>No members yet</div>' : ''}
                </div>
            </div>

            <div class="flex-[1.5] flex flex-col glass-panel rounded-2xl overflow-hidden shadow-sm">
                <div class="p-3 bg-slate-50 border-b border-slate-200 space-y-2">

                    <div class="relative">
                        <i data-lucide="search" width="14" class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"></i>
                        <input type="text" id="emp-search" onkeyup="filterEmployees()" placeholder="Search Name / ID..." class="w-full pl-9 p-2 text-xs rounded-xl border border-slate-300 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-200 transition-all">
                    </div>

                    <div class="grid grid-cols-3 gap-2">
                        <select id="filter-dept" onchange="filterEmployees()" class="p-1.5 text-[10px] rounded-lg border border-slate-300 outline-none bg-white text-slate-600 font-bold cursor-pointer hover:border-blue-400 focus:border-blue-500">
                            <option value="">All Departments</option>
                            ${depts.map(d => `<option value="${d}">${d}</option>`).join('')}
                        </select>
                        <select id="filter-sect" onchange="filterEmployees()" class="p-1.5 text-[10px] rounded-lg border border-slate-300 outline-none bg-white text-slate-600 font-bold cursor-pointer hover:border-blue-400 focus:border-blue-500">
                            <option value="">All Sections</option>
                            ${sects.map(s => `<option value="${s}">${s}</option>`).join('')}
                        </select>
                        <select id="filter-pos" onchange="filterEmployees()" class="p-1.5 text-[10px] rounded-lg border border-slate-300 outline-none bg-white text-slate-600 font-bold cursor-pointer hover:border-blue-400 focus:border-blue-500">
                            <option value="">All Positions</option>
                            ${positions.map(p => `<option value="${p}">${p}</option>`).join('')}
                        </select>
                    </div>

                    <div class="flex justify-between items-end pt-1">
                        <span id="filter-count" class="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Showing all</span>
                        <button onclick="selectAllFiltered()" class="flex items-center gap-1 bg-blue-50 text-blue-600 px-3 py-1 rounded-lg text-[10px] font-bold border border-blue-100 hover:bg-blue-100 hover:shadow-sm transition-all active:scale-95">
                            <i data-lucide="check-square" width="12"></i> Select All Filtered
                        </button>
                    </div>
                </div>

                <div class="flex-1 overflow-y-auto p-2 space-y-1 bg-slate-50/50" id="emp-list">
                    </div>
            </div>
        </div>
    `;

    // เรียก Render List ครั้งแรก
    filterEmployees();
}

// 2. ฟังก์ชันหัวใจหลัก (แก้ไขใหม่: กรองข้อมูลดิบก่อน แล้วค่อยตัดมาแสดง ทำให้ค้นหาเจอทุกคน)
function renderEmployeeList(currentMembers, filterText = "") {
    // เช็คว่ามีข้อมูลพนักงานหรือยัง
    if (!STATE.employeesCache || STATE.employeesCache.length === 0) {
        return '<div class="text-center p-4"><i data-lucide="loader-2" class="animate-spin mx-auto mb-2"></i> Loading data...</div>';
    }

    const memberCodes = currentMembers.map(m => m.code);
    let candidates = STATE.employeesCache;

    // A. กรองคนที่เป็น Member อยู่แล้วออกไป (จะไม่แสดงในลิสต์ขวา)
    candidates = candidates.filter(e => !memberCodes.includes(e.employee_code));

    // B. กรองตามคำค้นหา (Search Logic)
    if (filterText) {
        const lower = filterText.toLowerCase();
        candidates = candidates.filter(e =>
            (e.full_name && e.full_name.toLowerCase().includes(lower)) ||
            (e.employee_code && e.employee_code.toLowerCase().includes(lower))
        );
    }

    // C. จำกัดจำนวนการแสดงผล (Slice) เพื่อประสิทธิภาพ
    // ถ้าค้นหา: แสดงผลลัพธ์ 100 คนแรกที่เจอ
    // ถ้าไม่ค้นหา: แสดง 100 คนแรกของบริษัท
    const displayList = candidates.slice(0, 100);

    if (displayList.length === 0) return '<div class="text-center p-4 text-xs text-slate-400">No employees found</div>';

    return displayList.map(emp => `
        <div class="emp-item flex justify-between items-center p-2 bg-white rounded-lg border border-slate-100 hover:border-blue-300 cursor-pointer group transition-all"
             onclick="addMemberToGroup('${emp.employee_code}', '${emp.full_name}', '${emp.position_name_th}')">
            <div>
                <div class="text-xs font-bold text-slate-700">${emp.full_name}</div>
                <div class="text-[10px] text-slate-400">${emp.position_name_th}</div>
            </div>
            <i data-lucide="plus-circle" width="16" class="text-slate-300 group-hover:text-blue-500"></i>
        </div>
    `).join('');
}

// 3. ฟังก์ชัน Event ตอนพิมพ์ค้นหา (แก้ไขให้ Re-render HTML ใหม่ แทนการซ่อน CSS)
window.currentFilteredEmployees = [];

// ฟังก์ชันกรองและแสดงผล (เรียกทุกครั้งที่พิมพ์หรือเปลี่ยน Dropdown)
window.filterEmployees = () => {
    // 1. รับค่าจาก Inputs
    const term = document.getElementById('emp-search')?.value.toLowerCase() || "";
    const dept = document.getElementById('filter-dept')?.value || "";
    const sect = document.getElementById('filter-sect')?.value || "";
    const pos = document.getElementById('filter-pos')?.value || "";

    const group = STATE.tempConfig.notify_groups[STATE.editingGroupIdx];
    const memberCodes = group.members.map(m => m.code);

    // 2. Logic การกรอง
    let candidates = STATE.employeesCache.filter(e => {
        // กรองคนที่มีอยู่แล้วออก
        if (memberCodes.includes(e.employee_code)) return false;

        // กรองตาม Text Search
        const matchText = !term || (
            (e.full_name && e.full_name.toLowerCase().includes(term)) ||
            (e.employee_code && e.employee_code.toLowerCase().includes(term))
        );

        // กรองตาม Dropdown
        const matchDept = !dept || e.department_th === dept;
        const matchSect = !sect || e.section_th === sect;
        const matchPos  = !pos || e.position_name_th === pos;

        return matchText && matchDept && matchSect && matchPos;
    });

    // เก็บค่าที่กรองได้ไว้ใช้กับปุ่ม Select All
    window.currentFilteredEmployees = candidates;

    // อัปเดตตัวเลขจำนวนที่เจอ
    const countEl = document.getElementById('filter-count');
    if(countEl) countEl.innerText = `Found ${candidates.length} people`;

    // 3. Render List (จำกัดการแสดงผลแค่ 100 คนเพื่อประสิทธิภาพ แต่ Select All จะได้ทั้งหมด)
    const listEl = document.getElementById('emp-list');
    if(!listEl) return;

    if (candidates.length === 0) {
        listEl.innerHTML = '<div class="text-center p-8 text-xs text-slate-400 flex flex-col items-center gap-2"><i data-lucide="search-x" width="24" class="opacity-50"></i>No matching employees found</div>';
        lucide.createIcons();
        return;
    }

    const displayList = candidates.slice(0, 100); // Render Limit

    listEl.innerHTML = displayList.map(emp => `
        <div class="emp-item flex justify-between items-center p-2.5 bg-white rounded-xl border border-slate-200 hover:border-blue-400 hover:shadow-md cursor-pointer group transition-all duration-200"
             onclick="addMemberToGroup('${emp.employee_code}', '${emp.full_name}', '${emp.position_name_th}')">
            <div>
                <div class="text-xs font-bold text-slate-700">${emp.full_name} <span class="text-slate-300 font-normal">| ${emp.employee_code}</span></div>
                <div class="flex items-center gap-2 mt-0.5">
                    <span class="text-[9px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded border border-slate-200">${emp.position_name_th || '-'}</span>
                    <span class="text-[9px] text-slate-400 truncate max-w-[120px]">${emp.department_th || '-'} / ${emp.section_th || '-'}</span>
                </div>
            </div>
            <div class="w-6 h-6 rounded-full bg-slate-50 text-slate-300 flex items-center justify-center group-hover:bg-blue-500 group-hover:text-white transition-all">
                <i data-lucide="plus" width="14" stroke-width="3"></i>
            </div>
        </div>
    `).join('');

    // Show 'Show more' hint if needed
    if(candidates.length > 100) {
        listEl.innerHTML += `<div class="text-center text-[9px] text-slate-400 py-2 italic">Showing top 100 of ${candidates.length} results. Use filters to narrow down.</div>`;
    }

    lucide.createIcons();
};

window.updateGroupName = (idx, val) => {
    STATE.tempConfig.notify_groups[idx].name = val;
};

window.addMemberToGroup = (code, name, position) => {
    const group = STATE.tempConfig.notify_groups[STATE.editingGroupIdx];
    // Prevent duplicate
    if(group.members.find(m => m.code === code)) return;

    group.members.push({ code, name, position });
    renderGroupEditorContent();
};

window.removeMemberFromGroup = (memberIdx) => {
    const group = STATE.tempConfig.notify_groups[STATE.editingGroupIdx];
    group.members.splice(memberIdx, 1);
    renderGroupEditorContent();
};

function renderGroupEditorModal() {
    return `
    <div id="group-editor-modal" class="fixed inset-0 z-[70] bg-slate-900/50 backdrop-blur-sm hidden items-center justify-center p-4">
        <div class="bg-white w-full max-w-4xl rounded-[2rem] shadow-2xl flex flex-col max-h-[90vh] overflow-hidden slide-up">
            <div class="p-4 border-b border-slate-100 flex justify-between items-center">
                <h3 class="font-bold text-lg text-slate-800 flex items-center gap-2"><i data-lucide="users" class="text-pink-500"></i> Manage Group Members</h3>
                <button onclick="closeGroupEditor()" class="p-2 hover:bg-slate-100 rounded-full"><i data-lucide="x" width="20"></i></button>
            </div>
            <div id="group-editor-content" class="p-6 overflow-y-auto bg-slate-50/50 flex-1"></div>
            <div class="p-4 border-t border-slate-100 bg-white flex justify-end">
                <button onclick="closeGroupEditor(); render();" class="px-6 py-2 bg-slate-800 text-white rounded-xl text-sm font-bold shadow-lg hover:scale-105 transition-all">Done</button>
            </div>
        </div>
    </div>`;
}

// *** FORM EDITOR FUNCTIONS ***
function editFormStructure(formIdx) {
    // 1. Force Load Employees if empty (แก้ปัญหาค้นหาไม่เจอ)
    if (!STATE.employeesCache || STATE.employeesCache.length === 0) {
        fetchEmployees();
    }

    STATE.editingFormIdx = formIdx;
    STATE.editorActiveTab = 'report';
    const form = STATE.tempConfig.forms[formIdx];

    const elTitle = document.getElementById('editor-form-title');
    if(!elTitle) return console.error("Editor modal not found");

    elTitle.value = form.title;
    document.getElementById('editor-form-category').value = form.category || 'O';
    document.getElementById('editor-form-icon').value = form.icon;
    document.getElementById('editor-form-logo-color').value = form.logoColor || form.color;

    // ตั้งค่า Tag Color (ถ้ามี)
    const elTag = document.getElementById('editor-form-tag-color');
    if(elTag) elTag.value = form.tagColor || "bg-slate-100 text-slate-700 border-slate-200";

    // Setup Linked Evaluations
    const linkedEvalReport = document.getElementById('editor-linked-evals-report');
    const linkedEvalCm = document.getElementById('editor-linked-evals-cm');
    const allEvals = STATE.tempConfig.evaluations || [];
    const reportLinks = form.linked_evals_report || [];
    const cmLinks = form.linked_evals_cm || [];

    if(linkedEvalReport) {
        linkedEvalReport.innerHTML = allEvals.map((e) => {
            const isLinked = reportLinks.includes(e.id);
            return `<button onclick="toggleEvalLink('report', '${e.id}')" class="text-[10px] px-2 py-1 rounded-md border transition-all w-full text-left ${isLinked ? 'bg-blue-500 text-white border-blue-500 shadow-sm' : 'bg-white text-slate-400 border-slate-200 hover:border-blue-300'}">${isLinked?'✔':'+'} ${e.name}</button>`;
        }).join('');
    }
    if(linkedEvalCm) {
        linkedEvalCm.innerHTML = allEvals.map((e) => {
            const isLinked = cmLinks.includes(e.id);
            return `<button onclick="toggleEvalLink('cm', '${e.id}')" class="text-[10px] px-2 py-1 rounded-md border transition-all w-full text-left ${isLinked ? 'bg-orange-500 text-white border-orange-500 shadow-sm' : 'bg-white text-slate-400 border-slate-200 hover:border-orange-300'}">${isLinked?'✔':'+'} ${e.name}</button>`;
        }).join('');
    }

    renderEditorFields();

    // Show Modal
    document.getElementById('form-editor-modal').classList.remove('hidden');
    document.getElementById('form-editor-modal').classList.add('flex');
    lucide.createIcons();
}

function switchEditorTab(tab) {
    STATE.editorActiveTab = tab;
    document.getElementById('tab-report').className = tab === 'report' ? "flex-1 py-2 rounded-lg text-xs font-bold transition-all bg-white shadow-sm text-slate-800" : "flex-1 py-2 rounded-lg text-xs font-bold transition-all text-slate-500 hover:bg-white/50";
    document.getElementById('tab-cm').className = tab === 'countermeasure' ? "flex-1 py-2 rounded-lg text-xs font-bold transition-all bg-white shadow-sm text-slate-800" : "flex-1 py-2 rounded-lg text-xs font-bold transition-all text-slate-500 hover:bg-white/50";
    renderEditorFields();
}

function renderEditorFields() {
    const form = STATE.tempConfig.forms[STATE.editingFormIdx];
    const fields = STATE.editorActiveTab === 'report' ? form.fields : (form.cm_fields || []);
    const groups = STATE.tempConfig.notify_groups || [];

    document.getElementById('editor-fields-container').innerHTML = fields.map((f, i) => {
        let optionsHTML = '';

        // ===============================================
        // NEW TYPE: PERSONNEL (Combined Fixed & Selector)
        // ===============================================
        if (f.type === 'personnel') {
            const mode = f.personnel_mode || 'user_select'; // 'user_select' หรือ 'admin_fixed'
            const source = f.source || (mode === 'admin_fixed' ? 'manual' : 'all');
            const members = f.fixed_members || [];

            let configContent = '';

            // --- Logic: เลือก UI แสดงผลตามโหมดและแหล่งข้อมูล ---
            if (mode === 'admin_fixed') {
                if (source === 'manual') {
                    configContent = `
                    <div class="mt-2">
                        <div class="flex flex-wrap gap-2 mb-3 min-h-[30px]">
                            ${members.length > 0 ? members.map((m, mIdx) => `
                                <div class="flex items-center gap-2 px-3 py-1 bg-white border border-indigo-100 rounded-full shadow-sm">
                                    <div class="w-5 h-5 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-[10px] font-bold">${m.name.charAt(0)}</div>
                                    <span class="text-xs font-bold text-slate-700">${m.name}</span>
                                    <button onclick="removeFixedEmpFromField(${i}, ${mIdx})" class="text-slate-400 hover:text-red-500"><i data-lucide="x" width="12"></i></button>
                                </div>
                            `).join('') : '<span class="text-[10px] text-slate-400 italic">No personnel added yet.</span>'}
                        </div>
                        <div class="relative">
                            <input type="text" id="fixed-search-${i}" onkeyup="filterFixedEmpSearch(${i}, this.value)" placeholder="🔍 Search & Add Employee..." class="w-full text-xs p-2 rounded-lg border border-slate-300 bg-white focus:border-indigo-500 outline-none">
                            <div id="fixed-search-results-${i}" class="hidden absolute top-full left-0 w-full bg-white border border-slate-200 rounded-xl shadow-2xl mt-1 z-[100] max-h-40 overflow-y-auto ring-1 ring-black/5"></div>
                        </div>
                    </div>`;
                } else if (source === 'group') {
                    configContent = `
                    <select onchange="updateFieldMeta(${i}, 'group_id', this.value)" class="w-full text-xs p-2 mt-2 rounded-lg border border-indigo-200 outline-none bg-white text-slate-700 font-bold">
                        <option value="">-- Select Group to Fix --</option>
                        ${groups.map(g => `<option value="${g.id}" ${f.group_id === g.id ? 'selected' : ''}>👥 ${g.name}</option>`).join('')}
                    </select>`;
                } else if (source === 'location') {
                    configContent = `<div class="mt-2 p-3 bg-white/60 rounded-lg border border-indigo-100 text-[10px] text-slate-600 font-medium">System will automatically lock this field to the <b>Notify Target</b> of the selected location.</div>`;
                }
            } else {
                // User Select Mode
                if (source === 'group') {
                    configContent = `
                    <select onchange="updateFieldMeta(${i}, 'group_id', this.value)" class="w-full text-xs p-2 mt-2 rounded-lg border border-brand-200 outline-none bg-white text-slate-700 font-bold">
                        <option value="">-- Filter by Group --</option>
                        ${groups.map(g => `<option value="${g.id}" ${f.group_id === g.id ? 'selected' : ''}>👥 ${g.name}</option>`).join('')}
                    </select>`;
                } else if (source === 'location') {
                    configContent = `<div class="mt-2 p-3 bg-white/60 rounded-lg border border-brand-100 text-[10px] text-slate-600 font-medium">User will pick a person from the <b>Location's Target</b> list.</div>`;
                } else {
                    configContent = `<div class="mt-2 p-3 bg-white/60 rounded-lg border border-brand-100 text-[10px] text-slate-600 font-medium">User can search and select from <b>All Employees</b>.</div>`;
                }
            }

            // --- Logic: เตรียม Class สำหรับปุ่ม Source ต่างๆ ---
            const isManualActive = source === 'manual' || source === 'all';
            const manualClass = mode === 'admin_fixed'
                ? (isManualActive ? 'bg-indigo-50 border-indigo-500 text-indigo-700' : 'bg-white border-slate-200 text-slate-400')
                : (isManualActive ? 'bg-brand-50 border-brand-500 text-brand-700' : 'bg-white border-slate-200 text-slate-400');

            const groupClass = source === 'group'
                ? (mode === 'admin_fixed' ? 'bg-indigo-50 border-indigo-500 text-indigo-700' : 'bg-brand-50 border-brand-500 text-brand-700')
                : 'bg-white border-slate-200 text-slate-400';

            const locClass = source === 'location'
                ? (mode === 'admin_fixed' ? 'bg-indigo-50 border-indigo-500 text-indigo-700' : 'bg-brand-50 border-brand-500 text-brand-700')
                : 'bg-white border-slate-200 text-slate-400';

            optionsHTML = `
            <div class="mt-3 p-4 rounded-2xl bg-slate-50 border border-slate-200">
                <div class="flex p-1 bg-white rounded-xl border border-slate-200 mb-4 shadow-sm">
                    <button onclick="updatePersonnelMode(${i}, 'user_select')" class="flex-1 py-1.5 rounded-lg text-[10px] font-black transition-all ${mode === 'user_select' ? 'bg-brand-500 text-white shadow-md' : 'text-slate-400 hover:text-slate-600'}">USER SELECTS</button>
                    <button onclick="updatePersonnelMode(${i}, 'admin_fixed')" class="flex-1 py-1.5 rounded-lg text-[10px] font-black transition-all ${mode === 'admin_fixed' ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-600'}">ADMIN FIXED</button>
                </div>

                <div class="flex items-center gap-2 mb-2"><i data-lucide="database" class="text-slate-400" width="12"></i><label class="text-[10px] font-bold text-slate-500 uppercase">Data Source</label></div>

                <div class="flex gap-2 mb-2">
                    <button onclick="updateFieldMeta(${i}, 'source', '${mode === 'admin_fixed' ? 'manual' : 'all'}'); renderEditorFields()" class="flex-1 flex items-center justify-center p-2 rounded-lg border transition-all ${manualClass}"><span class="text-[10px] font-bold">${mode === 'admin_fixed' ? 'Manual' : 'All'}</span></button>
                    <button onclick="updateFieldMeta(${i}, 'source', 'group'); renderEditorFields()" class="flex-1 flex items-center justify-center p-2 rounded-lg border transition-all ${groupClass}"><span class="text-[10px] font-bold">Group</span></button>
                    <button onclick="updateFieldMeta(${i}, 'source', 'location'); renderEditorFields()" class="flex-1 flex items-center justify-center p-2 rounded-lg border transition-all ${locClass}"><span class="text-[10px] font-bold">Location</span></button>
                </div>
                ${configContent}
            </div>`;
        }

        // --- TYPE: SELECT / MULTISELECT ---
        else if(f.type === 'select' || f.type === 'multiselect') {
            optionsHTML = `<div class="mt-2 pl-2 border-l-2 border-slate-200"><label class="text-[10px] font-bold text-slate-400 uppercase">Options</label><div class="flex flex-wrap gap-1 mt-1">${(f.options||[]).map((opt, optIdx) => `<span class="bg-white border border-slate-200 text-slate-600 px-2 py-0.5 rounded text-[10px] flex items-center gap-1 shadow-sm">${opt} <button onclick="removeOptionFromField(${i}, ${optIdx})" class="hover:text-red-500">×</button></span>`).join('')}</div><div class="flex gap-1 mt-2"><input type="text" id="new-opt-${i}" class="flex-1 p-1 text-xs border rounded outline-none bg-white focus:ring-1 focus:ring-brand-300" placeholder="New option..."><button onclick="addOptionToField(${i})" class="bg-brand-50 text-brand-600 px-2 py-1 rounded text-[10px] font-bold border border-brand-100">Add</button></div></div>`;
        }

        // --- MAIN RENDER WRAPPER ---
        return `
        <div class="glass-panel p-4 rounded-3xl mb-3 relative" style="z-index: ${100 - i};">
            <div class="flex justify-between items-start mb-3">
                <div class="flex-1 grid grid-cols-2 gap-3">
                    <input value="${f.label}" onchange="updateFieldMeta(${i}, 'label', this.value)" class="p-2.5 text-sm font-bold border rounded-xl outline-none text-slate-700 bg-white/50 focus:bg-white focus:ring-2 focus:ring-brand-400 transition-all">
                    <select onchange="updateFieldMeta(${i}, 'type', this.value); renderEditorFields()" class="p-2.5 text-sm border rounded-xl outline-none bg-white cursor-pointer font-bold text-slate-600">
                        <option value="text" ${f.type==='text'?'selected':''}>Text</option>
                        <option value="textarea" ${f.type==='textarea'?'selected':''}>Long Text</option>
                        <option value="personnel" ${f.type==='personnel'?'selected':''}>👤 Personnel</option>
                        <option value="select" ${f.type==='select'?'selected':''}>Dropdown</option>
                        <option value="multiselect" ${f.type==='multiselect'?'selected':''}>Checkbox (Multi)</option>
                        <option value="date" ${f.type==='date'?'selected':''}>Date</option>
                        <option value="image" ${f.type==='image'?'selected':''}>Attachment</option>
                    </select>
                </div>
                <div class="flex gap-1 ml-2">
                    <button onclick="moveField(${i}, -1)" class="p-2 text-slate-300 hover:text-brand-500"><i data-lucide="arrow-up" width="16"></i></button>
                    <button onclick="removeField(${i})" class="p-2 text-slate-300 hover:text-red-500"><i data-lucide="trash-2" width="16"></i></button>
                </div>
            </div>
            ${optionsHTML}
        </div>`;
    }).join('');

    lucide.createIcons();
}

window.updatePersonnelMode = (idx, mode) => {
    const form = STATE.tempConfig.forms[STATE.editingFormIdx];
    const targetArr = STATE.editorActiveTab === 'report' ? form.fields : form.cm_fields;
    targetArr[idx].personnel_mode = mode;
    targetArr[idx].source = mode === 'admin_fixed' ? 'manual' : 'all'; // Default Source
    renderEditorFields();
};

// 1. ฟังก์ชันค้นหาพนักงาน (สำหรับ Fixed Personnel)
window.filterFixedEmpSearch = (fieldIdx, text) => {
    const container = document.getElementById(`fixed-search-results-${fieldIdx}`);
    if (!container) return;

    if (!text) {
        container.classList.add('hidden');
        return;
    }

    // ตรวจสอบว่ามีข้อมูลพนักงานหรือไม่
    if (!STATE.employeesCache || STATE.employeesCache.length === 0) {
        container.innerHTML = `<div class="p-2 text-[10px] text-slate-400 text-center">Loading data...</div>`;
        container.classList.remove('hidden');
        // ลองโหลดใหม่อีกครั้งเผื่อยังไม่มา
        fetchEmployees().then(() => filterFixedEmpSearch(fieldIdx, text));
        return;
    }

    const lower = text.toLowerCase();
    const matches = STATE.employeesCache.filter(e =>
        (e.full_name && e.full_name.toLowerCase().includes(lower)) ||
        (String(e.employee_code).includes(lower))
    ).slice(0, 10); // แสดงแค่ 10 คนแรก

    if (matches.length > 0) {
        container.innerHTML = matches.map(m => `
            <div onclick="addFixedEmpToField(${fieldIdx}, '${m.employee_code}', '${m.full_name}')"
                 class="p-2 hover:bg-indigo-50 cursor-pointer border-b border-slate-100 last:border-0 flex flex-col group">
                <span class="text-xs font-bold text-slate-700 group-hover:text-indigo-700">${m.full_name}</span>
                <span class="text-[10px] text-slate-400 group-hover:text-indigo-400">${m.position_name_th || '-'}</span>
            </div>
        `).join('');
        container.classList.remove('hidden');
    } else {
        container.innerHTML = `<div class="p-2 text-[10px] text-slate-400 text-center">No matches found</div>`;
        container.classList.remove('hidden');
    }
};

// 2. ฟังก์ชันกดเลือกพนักงาน
window.addFixedEmpToField = (fieldIdx, code, name) => {
    const form = STATE.tempConfig.forms[STATE.editingFormIdx];
    const fields = STATE.editorActiveTab === 'report' ? form.fields : (form.cm_fields || []);

    if (!fields[fieldIdx].fixed_members) fields[fieldIdx].fixed_members = [];

    // ป้องกันเลือกซ้ำ
    if (!fields[fieldIdx].fixed_members.find(m => m.code === code)) {
        fields[fieldIdx].fixed_members.push({ code, name });
        renderEditorFields(); // Re-render เพื่อแสดง Tag ชื่อใหม่
    }

    // เคลียร์ช่องค้นหา
    const input = document.getElementById(`fixed-search-${fieldIdx}`);
    if(input) input.value = '';

    // ซ่อนผลลัพธ์
    const container = document.getElementById(`fixed-search-results-${fieldIdx}`);
    if(container) container.classList.add('hidden');
};

// 3. ฟังก์ชันลบพนักงานออกจากลิสต์
window.removeFixedEmpFromField = (fieldIdx, memberIdx) => {
    const form = STATE.tempConfig.forms[STATE.editingFormIdx];
    const fields = STATE.editorActiveTab === 'report' ? form.fields : (form.cm_fields || []);

    if (fields[fieldIdx].fixed_members) {
        fields[fieldIdx].fixed_members.splice(memberIdx, 1);
        renderEditorFields();
    }
};

function addNewFieldToEditor() {
    const labelInput = document.getElementById('new-field-label');
    const typeInput = document.getElementById('new-field-type');
    if (labelInput && labelInput.value.trim() !== "") {
        const label = labelInput.value.trim();
        const type = typeInput.value;
        const newField = { id: "f_"+Date.now(), label: label, type: type, options: (type === 'select' || type === 'multiselect') ? ['Option 1'] : [], is_required: false };

        const form = STATE.tempConfig.forms[STATE.editingFormIdx];
        if (STATE.editorActiveTab === 'report') {
            form.fields.push(newField);
        } else {
            if(!form.cm_fields) form.cm_fields = [];
            form.cm_fields.push(newField);
        }

        labelInput.value = '';
        renderEditorFields();
    } else {
        alert("Please enter a field label");
        labelInput?.focus();
    }
}

window.removeField = (idx) => {
    const form = STATE.tempConfig.forms[STATE.editingFormIdx];
    if (STATE.editorActiveTab === 'report') form.fields.splice(idx, 1);
    else form.cm_fields.splice(idx, 1);
    renderEditorFields();
};
window.updateFieldMeta = (idx, key, val) => {
    const form = STATE.tempConfig.forms[STATE.editingFormIdx];
    const targetArr = STATE.editorActiveTab === 'report' ? form.fields : form.cm_fields;
    targetArr[idx][key] = val;
    const type = targetArr[idx].type;
    if((type === 'select' || type === 'multiselect') && !targetArr[idx].options) { targetArr[idx].options = ["Option 1"]; }
};
window.moveField = (idx, dir) => {
    const form = STATE.tempConfig.forms[STATE.editingFormIdx];
    const fields = STATE.editorActiveTab === 'report' ? form.fields : form.cm_fields;
    if((dir===-1 && idx>0) || (dir===1 && idx<fields.length-1)) { [fields[idx], fields[idx+dir]] = [fields[idx+dir], fields[idx]]; renderEditorFields(); }
};
window.addOptionToField = (fieldIdx) => {
    const input = document.getElementById(`new-opt-${fieldIdx}`); const val = input.value.trim();
    if(val) {
        const form = STATE.tempConfig.forms[STATE.editingFormIdx];
        const fields = STATE.editorActiveTab === 'report' ? form.fields : form.cm_fields;
        if(!fields[fieldIdx].options) fields[fieldIdx].options = [];
        fields[fieldIdx].options.push(val); renderEditorFields();
    }
};
window.removeOptionFromField = (fieldIdx, optIdx) => {
    const form = STATE.tempConfig.forms[STATE.editingFormIdx];
    const fields = STATE.editorActiveTab === 'report' ? form.fields : form.cm_fields;
    fields[fieldIdx].options.splice(optIdx, 1); renderEditorFields();
};
function closeFormEditor() { document.getElementById('form-editor-modal').classList.add('hidden'); document.getElementById('form-editor-modal').classList.remove('flex'); }

function saveFormEditor() {
    const f = STATE.tempConfig.forms[STATE.editingFormIdx];
    f.title = document.getElementById('editor-form-title').value;
    f.category = document.getElementById('editor-form-category').value;
    f.icon = document.getElementById('editor-form-icon').value;
    f.logoColor = document.getElementById('editor-form-logo-color').value;
    closeFormEditor();
    render();
}
function createNewForm() { STATE.tempConfig.forms.push({ id: "form_"+Date.now(), title: "New Form", category: "S", icon: "clipboard", logoColor: "bg-slate-500", tagColor: "bg-slate-100 text-slate-700 border-slate-200", fields: [], cm_fields: [], linked_evals_report: [], linked_evals_cm: [] }); render(); editFormStructure(STATE.tempConfig.forms.length - 1); }
function deleteForm(idx) { if(confirm("Delete this form?")) { STATE.tempConfig.forms.splice(idx,1); render(); } }

window.toggleEvalLink = (type, evalId) => {
    const form = STATE.tempConfig.forms[STATE.editingFormIdx];
    if(type === 'report') {
        if(!form.linked_evals_report) form.linked_evals_report = [];
        if(form.linked_evals_report.includes(evalId)) form.linked_evals_report = form.linked_evals_report.filter(id => id !== evalId);
        else form.linked_evals_report.push(evalId);
    } else {
        if(!form.linked_evals_cm) form.linked_evals_cm = [];
        if(form.linked_evals_cm.includes(evalId)) form.linked_evals_cm = form.linked_evals_cm.filter(id => id !== evalId);
        else form.linked_evals_cm.push(evalId);
    }
    editFormStructure(STATE.editingFormIdx); // re-render
};


// *** EVALUATION EDITOR SYSTEM (UPDATED) ***

function createNewEval() {
    if(!STATE.tempConfig.evaluations) STATE.tempConfig.evaluations = [];
    STATE.tempConfig.evaluations.push({
        id: "eval_"+Date.now(),
        name: "New Assessment System",
        assessments: [],
        formula: "",
        logic: []
    });
    render();
    openEvalEditor(STATE.tempConfig.evaluations.length - 1);
}

function openEvalEditor(idx) {
    STATE.editingEvalIdx = idx;
    const evalData = STATE.tempConfig.evaluations[idx];

    // Safety Init & Migration
    if (!evalData.assessments) {
        if (evalData.items) {
             evalData.assessments = evalData.items.map((item, i) => ({
                 id: "Part" + (i+1),
                 name: item.label || "Criteria",
                 type: 'range',
                 min: 0,
                 max: item.max_score || 10,
                 options: []
             }));
        } else {
             evalData.assessments = [];
        }
    }
    if (!evalData.logic) evalData.logic = [];
    if (!evalData.formula) evalData.formula = "";

    document.getElementById('eval-name').value = evalData.name;
    document.getElementById('eval-formula').value = evalData.formula || "";

    // Add Event Listener for Formula Input to handle Drop
    const formulaInput = document.getElementById('eval-formula');
    formulaInput.addEventListener('drop', handleFormulaDrop);
    formulaInput.addEventListener('dragover', (e) => e.preventDefault());

    renderEvalComponents();
    document.getElementById('eval-editor-modal').classList.remove('hidden');
    document.getElementById('eval-editor-modal').classList.add('flex');
    lucide.createIcons();
}

function handleFormulaDrop(e) {
    e.preventDefault();
    const variableId = e.dataTransfer.getData("text/plain");
    const input = document.getElementById('eval-formula');
    const startPos = input.selectionStart;
    const endPos = input.selectionEnd;
    const text = input.value;

    // Insert Variable ID at cursor
    input.value = text.substring(0, startPos) + variableId + text.substring(endPos, text.length);
}

function addVariableToFormula(id) {
    const input = document.getElementById('eval-formula');
    input.value += id; // Append to end if clicked (simpler than tracking cursor for clicks)
}

function closeEvalEditor() {
    document.getElementById('eval-editor-modal').classList.add('hidden');
    document.getElementById('eval-editor-modal').classList.remove('flex');
}

function renderEvalComponents() {
    const evalData = STATE.tempConfig.evaluations[STATE.editingEvalIdx];

    // --- 1. RENDER ASSESSMENTS ---
    const assessmentsHTML = (evalData.assessments || []).map((assess, i) => {

        // Auto-generate ID if empty (Hidden from User)
        if(!assess.id || assess.id.trim() === "") {
             assess.id = String.fromCharCode(65 + i); // A, B, C...
             updateAssessment(i, 'id', assess.id);
        }

        let contentHTML = '';
        if(assess.type === 'fixed') {
             contentHTML = `
             <div class="mt-3 bg-slate-50/50 rounded-xl border border-slate-200 overflow-hidden">
                <div class="grid grid-cols-12 gap-2 px-3 py-2 bg-slate-100/50 border-b border-slate-200 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                    <div class="col-span-8">Label Text</div>
                    <div class="col-span-3 text-center">Score</div>
                    <div class="col-span-1"></div>
                </div>
                <div class="p-2 space-y-2">
                    ${(assess.options || []).map((opt, optIdx) => `
                        <div class="flex items-center gap-2 group">
                            <div class="w-6 h-6 rounded-full bg-white border border-slate-200 flex items-center justify-center text-[10px] text-slate-400 font-bold shadow-sm">${optIdx + 1}</div>
                            <input value="${opt.label}" onchange="updateAssessOpt(${i}, ${optIdx}, 'label', this.value)" class="flex-1 p-2 bg-white border border-slate-200 rounded-lg text-xs text-slate-700 outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-200 transition-all placeholder:text-slate-300" placeholder="Option Label">
                            <input type="number" value="${opt.score}" onchange="updateAssessOpt(${i}, ${optIdx}, 'score', parseFloat(this.value))" class="w-16 p-2 bg-white border border-slate-200 rounded-lg text-xs text-center font-bold text-brand-600 outline-none focus:border-brand-500 transition-all">
                            <button onclick="removeAssessOpt(${i}, ${optIdx})" class="w-8 h-8 flex items-center justify-center text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all opacity-0 group-hover:opacity-100"><i data-lucide="trash-2" width="14"></i></button>
                        </div>
                    `).join('')}
                    <button onclick="addAssessOpt(${i})" class="w-full py-2 border border-dashed border-slate-300 rounded-lg text-xs font-bold text-slate-400 hover:text-brand-600 hover:border-brand-300 hover:bg-brand-50 transition-all flex items-center justify-center gap-2 mt-2">
                        <i data-lucide="plus" width="14"></i> Add Option
                    </button>
                </div>
             </div>`;
        } else if(assess.type === 'text') {
             // NEW: Text Input Preview
             contentHTML = `
             <div class="mt-3 bg-slate-50/50 p-4 rounded-xl border border-slate-200">
                <div class="flex items-center gap-2 mb-2">
                    <i data-lucide="type" class="text-slate-400" width="16"></i>
                    <label class="text-[10px] font-bold text-slate-500 uppercase">Input Preview</label>
                </div>
                <textarea disabled class="w-full p-3 bg-white border border-slate-200 rounded-lg text-sm text-slate-400 italic resize-none" rows="2" placeholder="User will enter text comments here... (Not Scored)"></textarea>
             </div>`;
        } else {
             contentHTML = `
             <div class="mt-3 flex items-center gap-4 bg-slate-50/50 p-4 rounded-xl border border-slate-200">
                <div class="flex-1">
                    <label class="text-[10px] font-bold text-slate-400 uppercase mb-1 block">Min Score</label>
                    <input type="number" value="${assess.min !== undefined ? assess.min : 0}" onchange="updateAssessment(${i}, 'min', parseFloat(this.value))" class="w-full p-2 bg-white border border-slate-200 rounded-lg text-sm font-bold text-slate-700 outline-none focus:border-brand-500 text-center">
                </div>
                <div class="flex items-center justify-center pt-12">
                    <div class="h-1 w-16 bg-slate-200 rounded-full"></div>
                </div>
                <div class="flex-1">
                    <label class="text-[10px] font-bold text-slate-400 uppercase mb-1 block">Max Score</label>
                    <input type="number" value="${assess.max !== undefined ? assess.max : 10}" onchange="updateAssessment(${i}, 'max', parseFloat(this.value))" class="w-full p-2 bg-white border border-slate-200 rounded-lg text-sm font-bold text-slate-700 outline-none focus:border-brand-500 text-center">
                </div>
             </div>`;
        }

        return `
        <div class="group relative bg-white rounded-2xl p-5 mb-4 border border-slate-100 shadow-[0_2px_8px_rgba(0,0,0,0.04)] hover:shadow-[0_4px_12px_rgba(0,0,0,0.08)] hover:border-brand-200 transition-all duration-300">
            <div class="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onclick="removeAssessment(${i})" class="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"><i data-lucide="trash-2" width="16"></i></button>
            </div>

            <div class="flex items-start gap-4 mb-4">
                <div class="w-12 h-12 rounded-2xl bg-gradient-to-br from-purple-500 to-indigo-600 text-white flex items-center justify-center font-bold text-lg shadow-purple-200 shadow-lg shrink-0">
                    ${assess.id}
                </div>
                <div class="flex-1">
                    <div class="flex gap-4 mb-2">
                        <div class="flex-[3]">
                            <label class="text-[9px] font-extrabold text-slate-400 uppercase tracking-widest mb-1 block">Assessment Name</label>
                            <input value="${assess.name}" onchange="updateAssessment(${i}, 'name', this.value)" class="w-full text-sm font-bold text-slate-700 bg-transparent border-b-2 border-slate-100 focus:border-brand-500 rounded-none px-0 py-1 outline-none transition-all placeholder:text-slate-300" placeholder="e.g. ความรุนแรง">
                        </div>
                    </div>

                    <div class="flex gap-4 mt-3 flex-wrap">
                        <label class="flex items-center gap-2 cursor-pointer group/radio">
                            <div class="w-4 h-4 rounded-full border-2 border-slate-300 group-hover/radio:border-brand-400 flex items-center justify-center ${assess.type==='range'?'border-brand-500':''}">
                                ${assess.type==='range' ? '<div class="w-2 h-2 rounded-full bg-brand-500"></div>' : ''}
                            </div>
                            <input type="radio" name="astype_${i}" class="hidden" ${assess.type==='range'?'checked':''} onchange="updateAssessment(${i}, 'type', 'range'); renderEvalComponents()">
                            <span class="text-xs font-bold ${assess.type==='range'?'text-brand-600':'text-slate-500'}">Range (Slider)</span>
                        </label>
                        <label class="flex items-center gap-2 cursor-pointer group/radio">
                            <div class="w-4 h-4 rounded-full border-2 border-slate-300 group-hover/radio:border-brand-400 flex items-center justify-center ${assess.type==='fixed'?'border-brand-500':''}">
                                ${assess.type==='fixed' ? '<div class="w-2 h-2 rounded-full bg-brand-500"></div>' : ''}
                            </div>
                            <input type="radio" name="astype_${i}" class="hidden" ${assess.type==='fixed'?'checked':''} onchange="updateAssessment(${i}, 'type', 'fixed'); renderEvalComponents()">
                            <span class="text-xs font-bold ${assess.type==='fixed'?'text-brand-600':'text-slate-500'}">Fixed Options</span>
                        </label>
                        <label class="flex items-center gap-2 cursor-pointer group/radio">
                            <div class="w-4 h-4 rounded-full border-2 border-slate-300 group-hover/radio:border-brand-400 flex items-center justify-center ${assess.type==='text'?'border-brand-500':''}">
                                ${assess.type==='text' ? '<div class="w-2 h-2 rounded-full bg-brand-500"></div>' : ''}
                            </div>
                            <input type="radio" name="astype_${i}" class="hidden" ${assess.type==='text'?'checked':''} onchange="updateAssessment(${i}, 'type', 'text'); renderEvalComponents()">
                            <span class="text-xs font-bold ${assess.type==='text'?'text-brand-600':'text-slate-500'}">Text (No Score)</span>
                        </label>
                    </div>
                </div>
            </div>

            ${contentHTML}
        </div>
        `;
    }).join('');

    document.getElementById('eval-assessments-container').innerHTML = assessmentsHTML;

    // --- 2. RENDER DRAGGABLE FORMULA TAGS ---
    // Filter out text type from dragging to formula
    const draggableTags = (evalData.assessments || [])
        .filter(a => a.type !== 'text')
        .map(a => `
        <div draggable="true" ondragstart="event.dataTransfer.setData('text/plain', '${a.id}')" onclick="addVariableToFormula('${a.id}')"
             class="draggable-tag bg-white border border-brand-200 text-brand-700 px-3 py-1.5 rounded-lg text-xs font-bold cursor-move hover:bg-brand-50 hover:shadow-md transition-all select-none flex items-center gap-2 group">
            <span class="w-5 h-5 rounded bg-brand-100 text-brand-600 flex items-center justify-center text-[10px]">${a.id}</span>
            <span>${a.name}</span>
        </div>
    `).join('');

    // Inject logic to render tags above formula input
    const formulaContainer = document.getElementById('eval-formula-tags');
    if(formulaContainer) formulaContainer.innerHTML = draggableTags;


    // --- 3. RENDER LOGIC (RANKING) WITH COLOR PICKER ---
    const logicHTML = (evalData.logic || []).map((l, i) => `
        <div class="group flex items-center gap-3 p-3 bg-white rounded-xl border border-slate-100 shadow-sm mb-2 hover:border-brand-200 hover:shadow-md transition-all">
            <div class="flex items-center gap-2 bg-slate-50 rounded-lg px-3 py-2 border border-slate-200">
                <span class="text-[10px] font-bold text-slate-400 uppercase">Score</span>
                <input type="number" value="${l.min}" onchange="updateEvalLogic(${i}, 'min', parseFloat(this.value))" class="w-10 bg-transparent text-center text-xs font-bold text-slate-700 outline-none border-b border-transparent focus:border-brand-500 transition-colors" placeholder="0">
                <span class="text-slate-400 text-xs">-</span>
                <input type="number" value="${l.max}" onchange="updateEvalLogic(${i}, 'max', parseFloat(this.value))" class="w-10 bg-transparent text-center text-xs font-bold text-slate-700 outline-none border-b border-transparent focus:border-brand-500 transition-colors" placeholder="100">
            </div>

            <i data-lucide="arrow-right" class="text-slate-300" width="16"></i>

            <div class="flex-1">
                <input type="text" value="${l.label}" onchange="updateEvalLogic(${i}, 'label', this.value)" class="w-full p-2 bg-slate-50 border border-transparent hover:border-slate-200 focus:border-brand-500 rounded-lg text-xs font-bold text-slate-700 outline-none transition-all placeholder:text-slate-300" placeholder="Grade Name (e.g. High Risk)">
            </div>

            <div class="relative group/color">
                <input type="color" value="${l.hexColor || (l.color && l.color.startsWith('#') ? l.color : '#22c55e')}" onchange="updateEvalLogic(${i}, 'hexColor', this.value)" class="custom-color-input cursor-pointer">
                <div class="absolute -top-8 left-1/2 -translate-x-1/2 bg-slate-800 text-white text-[9px] px-2 py-1 rounded opacity-0 group-hover/color:opacity-100 transition pointer-events-none whitespace-nowrap">Pick Color</div>
            </div>

            <button onclick="removeEvalLogic(${i})" class="w-8 h-8 flex items-center justify-center text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all opacity-0 group-hover:opacity-100"><i data-lucide="x" width="14"></i></button>
        </div>
    `).join('');

    document.getElementById('eval-logic-container').innerHTML = logicHTML;

    lucide.createIcons();
}

function addNewAssessment() {
    if(!STATE.tempConfig.evaluations[STATE.editingEvalIdx].assessments) {
        STATE.tempConfig.evaluations[STATE.editingEvalIdx].assessments = [];
    }

    STATE.tempConfig.evaluations[STATE.editingEvalIdx].assessments.push({
        id: "", // Will be auto-generated in render
        name: "New Criteria",
        type: 'range',
        min: 0,
        max: 10,
        options: []
    });
    renderEvalComponents();
}

window.updateAssessment = (idx, key, val) => {
    STATE.tempConfig.evaluations[STATE.editingEvalIdx].assessments[idx][key] = val;
};
window.removeAssessment = (idx) => {
    STATE.tempConfig.evaluations[STATE.editingEvalIdx].assessments.splice(idx, 1);
    renderEvalComponents();
};

window.addAssessOpt = (idx) => {
    if(!STATE.tempConfig.evaluations[STATE.editingEvalIdx].assessments[idx].options)
       STATE.tempConfig.evaluations[STATE.editingEvalIdx].assessments[idx].options = [];
    STATE.tempConfig.evaluations[STATE.editingEvalIdx].assessments[idx].options.push({label: 'New Option', score: 0});
    renderEvalComponents();
};
window.updateAssessOpt = (aIdx, oIdx, key, val) => {
     STATE.tempConfig.evaluations[STATE.editingEvalIdx].assessments[aIdx].options[oIdx][key] = val;
};
window.removeAssessOpt = (aIdx, oIdx) => {
     STATE.tempConfig.evaluations[STATE.editingEvalIdx].assessments[aIdx].options.splice(oIdx, 1);
     renderEvalComponents();
};

function addEvalLogic() {
    STATE.tempConfig.evaluations[STATE.editingEvalIdx].logic.push({ min: 0, max: 100, label: "Pass", hexColor: "#22c55e" });
    renderEvalComponents();
}
window.updateEvalLogic = (idx, key, val) => {
    STATE.tempConfig.evaluations[STATE.editingEvalIdx].logic[idx][key] = val;
    // Update legacy color class if needed, but rely on hexColor
    if(key === 'hexColor') STATE.tempConfig.evaluations[STATE.editingEvalIdx].logic[idx].color = val;
    renderEvalComponents();
};
window.removeEvalLogic = (idx) => { STATE.tempConfig.evaluations[STATE.editingEvalIdx].logic.splice(idx, 1); renderEvalComponents(); };

function saveEvalEditor() {
    STATE.tempConfig.evaluations[STATE.editingEvalIdx].name = document.getElementById('eval-name').value;
    STATE.tempConfig.evaluations[STATE.editingEvalIdx].formula = document.getElementById('eval-formula').value;
    closeEvalEditor();
    render();
}
function deleteEval(idx) { if(confirm("Delete this evaluation?")) { STATE.tempConfig.evaluations.splice(idx, 1); render(); } }

// *** LOCATION & MAP ADMIN ***
function addNewLocation() { STATE.tempConfig.locations.push({ name: "New Location", email: "" }); render(); }
function removeLocation(idx) { if(confirm("Delete this location?")) { STATE.tempConfig.locations.splice(idx, 1); render(); } }
window.updateLocation = (idx, key, val) => { if (typeof STATE.tempConfig.locations[idx] === 'string') { STATE.tempConfig.locations[idx] = { name: STATE.tempConfig.locations[idx], email: "" }; } STATE.tempConfig.locations[idx][key] = val; };
function handleKMLUpload(input) { const file = input.files[0]; if(file) { const r = new FileReader(); r.onload = (e) => { STATE.tempConfig.mapKml = e.target.result; render(); showToast("KML Loaded"); }; r.readAsText(file); } }

async function saveConfigToDB(btn) {
    const originalText = btn.innerHTML;
    btn.innerHTML = `<i data-lucide="loader-2" class="animate-spin" width="14"></i> Saving...`;
    lucide.createIcons();
    btn.disabled = true;
    try {
        const res = await fetch(`${API_URL}/config`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(STATE.tempConfig) });
        if(res.ok) {
            STATE.config = JSON.parse(JSON.stringify(STATE.tempConfig));
            STATE.originalConfig = JSON.parse(JSON.stringify(STATE.tempConfig));
            STATE.translationCache = {};
            showToast("Config Saved Successfully!");
            STATE.view = 'home';
            render();
        } else alert("Save failed");
    } catch(e) { alert("Error saving config"); } finally { btn.innerHTML = originalText; btn.disabled = false; lucide.createIcons(); }
}

// ฟังก์ชันเลือกทั้งหมดที่ผ่านการกรอง
window.selectAllFiltered = () => {
    const candidates = window.currentFilteredEmployees || [];

    if (candidates.length === 0) return alert("No employees to select.");
    if (candidates.length > 500) {
        if(!confirm(`You are about to add ${candidates.length} members. This might slow down the display slightly. Continue?`)) return;
    }

    const group = STATE.tempConfig.notify_groups[STATE.editingGroupIdx];

    // Add all candidates
    candidates.forEach(emp => {
        group.members.push({
            code: emp.employee_code,
            name: emp.full_name,
            position: emp.position_name_th
        });
    });

    // Refresh UI
    renderGroupEditorContent();
    showToast(`Added ${candidates.length} members`);
};

// ฟังก์ชันลบทั้งหมดในกลุ่ม
window.removeAllMembers = () => {
    if(!confirm("Are you sure you want to remove ALL members from this group?")) return;
    STATE.tempConfig.notify_groups[STATE.editingGroupIdx].members = [];
    renderGroupEditorContent();
};