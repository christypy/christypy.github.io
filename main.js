/**
 * 一味淨生活咖啡系統 - 🚀 效能極速優化版（快取優先、背景同步）
 */

const SPREADSHEET_ID = '1aH2ap9QeqhpKI34-K9SsyiHnTpXPM1ud2rpOmAQtSIA'; 
const GAS_WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbyAXTwhXOZfmICm1QjOd0tq5qJKYH0rMql4dWc_1SxlCkBmF8nD-1NEDrHLKzzLo481lQ/exec'; 

let customers = [];
let syncInterval = null; 

const ITEM_TYPE_MAP = {
    "大拿鐵": "large_latte",
    "大熱美": "large_hot_am",
    "大熱拿": "large_hot_latte",
    "冰手沖": "ice_hand",
    "冰美式": "ice_am",
    "冰拿鐵": "ice_latte",
    "冰拿鐵加糖": "ice_latte_sugar",
    "熱手沖": "hot_hand",
    "熱美式": "hot_am",
    "熱拿鐵": "hot_latte",
    "熱拿鐵加糖": "hot_latte_sugar",
    "待確認":     "potential_item"
};

window.addEventListener('DOMContentLoaded', () => {
    initApp();
});

function initApp() {
    const today = new Date().getDay(); 
    const daySelect = document.getElementById('daySelect');
    if (daySelect) {
        daySelect.value = today;
    }

    const clearBtn = document.getElementById('clearAllBtn');
    if (clearBtn) clearBtn.addEventListener('click', manualClearAll);
    
    if (daySelect) {
        daySelect.removeEventListener('change', handleDaySelectChange);
        daySelect.addEventListener('change', handleDaySelectChange);
    }
    
    const statsContainer = document.querySelector('.stats-container');
    if (statsContainer) {
        statsContainer.addEventListener('click', handleStatsClick);
    }

    renderPrices(); 
    
    // 🚀 【關鍵優化】: 開機時立刻嘗試載入快取，達到秒開效果
    loadLocalCache();
    renderOrders();
    
    // 隨後立刻去抓一次雲端最新資料，並啟動定時器
    initData(false);
}

function handleDaySelectChange() {
    renderOrders(); // 切換星期時立刻切換畫面，不等待網路
    initData(true); 
}

// 🚀 【新增】從本地 LocalStorage 快速撈回客戶名單快取
function loadLocalCache() {
    try {
        const cachedData = localStorage.getItem('coffee_customers_cache');
        if (cachedData) {
            customers = JSON.parse(cachedData);
            console.log('[🚀 系統快取] 已成功秒開本地客戶快取資料');
        }
    } catch (e) {
        console.error('讀取本地客戶快取失敗', e);
    }
}

async function initData(isBackgroundSync = false) {
    try {
        await checkAndExecuteAutoClear();

        // 加上隨機參數防止瀏覽器快取舊資料
        const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:json&sheet=Sheet1&v=${new Date().getTime()}`;
        
        // 🚀 使用較短的 timeout 限制，避免網路卡死時轉圈太久
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 6000); 

        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (!res.ok) throw new Error('無法連線至雲端試算表');
        
        const text = await res.text();
        const jsonString = text.substring(text.indexOf('{'), text.lastIndexOf('}') + 1);
        const data = JSON.parse(jsonString);
        
        const rows = data.table.rows;
        customers = rows.map(row => {
            const cells = row.c;
            const cloudDoneStr = cells[9] ? String(cells[9].v) : "";
            const cloudAbsentStr = cells[10] ? String(cells[10].v) : "";
            
            return {
                loc: cells[0] ? String(cells[0].v) : "",
                name: cells[1] ? String(cells[1].v) : "",
                item: cells[2] ? String(cells[2].v) : "",
                type: cells[3] ? String(cells[3].v) : "",
                days: (cells[4] && cells[4].v) ? String(cells[4].v).split(',').map(Number) : [],
                count: cells[5] ? Number(cells[5].v) : 1,
                note: (cells[6] && cells[6].v) ? String(cells[6].v) : "",
                tag: (cells[7] && cells[7].v) ? String(cells[7].v) : "",
                groupId: cells[8] ? String(cells[8].v) : "",
                cloudDoneArr: cloudDoneStr ? cloudDoneStr.split(',') : [],
                cloudAbsentArr: cloudAbsentStr ? cloudAbsentStr.split(',') : []
            };
        });

        // 🚀 【關鍵優化】: 將最新的客戶結構同步儲存到快取，下次開網頁直接用
        localStorage.setItem('coffee_customers_cache', JSON.stringify(customers));

        syncCloudToLocal();
        
        if (localEditLock.groupId) {
            customers = customers.map(c => {
                if (c.groupId === localEditLock.groupId) {
                    return { ...c, item: localEditLock.newItem, type: localEditLock.newType };
                }
                return c;
            });
        }
        
        // 重新渲染最新狀態
        renderOrders();

        if (!isBackgroundSync) {
            startAutoSync(); 
        }
    } catch (error) {
        console.warn('⚠️ 雲端讀取超時或失敗，系統繼續維持使用本地快取:', error);
        // 如果原本沒撈到快取，才需要再次渲染空畫面
        if(customers.length === 0) {
            renderOrders();
        }
        if (!isBackgroundSync) {
            startAutoSync(); 
        }
    }
}

function startAutoSync() {
    if (syncInterval) clearInterval(syncInterval);
    // 調整為 20 秒背景偷偷刷新一次即可，減少頻繁請求造成的卡頓
    syncInterval = setInterval(() => {
        initData(true); 
    }, 20000); 
}

const LOCAL_WRITE_GRACE_MS = 8000; 
let lastLocalWriteTime = 0;

function markLocalWrite() {
    lastLocalWriteTime = Date.now();
}

function syncCloudToLocal() {
    const now = Date.now();
    const inGrace = (now - lastLocalWriteTime) < LOCAL_WRITE_GRACE_MS;
    if (inGrace) return; 

    customers.forEach(c => {
        const count = c.count || 1;
        for (let i = 0; i < count; i++) {
            const doneKey = getStorageKey(c.name, c.item, c.loc, i);
            const absentKey = getAbsenceKey(c.name, c.item, c.loc, i);
            
            if (c.cloudDoneArr && c.cloudDoneArr.length > 0) {
                if (c.cloudDoneArr[i] === 'true') localStorage.setItem(doneKey, 'true');
                else localStorage.removeItem(doneKey);
            }
            
            if (c.cloudAbsentArr && c.cloudAbsentArr.length > 0) {
                if (c.cloudAbsentArr[i] === 'true') localStorage.setItem(absentKey, 'true');
                else localStorage.removeItem(absentKey);
            }
        }
    });
}

async function checkAndExecuteAutoClear() {
    if (!GAS_WEB_APP_URL || GAS_WEB_APP_URL.includes('XXXXX')) return;

    const now = new Date();
    const currentHours = now.getHours();
    const currentMinutes = now.getMinutes();
    
    let targetResetDateStr = getTodayDateString(); 
    if (currentHours < 12 || (currentHours === 12 && currentMinutes < 30)) {
        const yesterday = new Date(now);
        yesterday.setDate(now.getDate() - 1);
        targetResetDateStr = yesterday.getFullYear() + (yesterday.getMonth() + 1).toString().padStart(2, '0') + yesterday.getDate().toString().padStart(2, '0');
    }

    try {
        const checkRes = await fetch(`${GAS_WEB_APP_URL}?v=${new Date().getTime()}`);
        if (checkRes.ok) {
            const checkData = await checkRes.json();
            const cloudLastClearDate = checkData.lastClearDate;

            if (cloudLastClearDate !== targetResetDateStr) {
                console.log(`[系統通知] 自動發動全系統跨日清空作業...`);
                localStorage.clear(); 
                await fetch(GAS_WEB_APP_URL, {
                    method: 'POST',
                    mode: 'no-cors',
                    body: JSON.stringify({ action: 'clearAll', dateStr: targetResetDateStr })
                });
            }
        }
    } catch (e) {
        console.error("檢查自動清空時發生錯誤:", e);
    }
}

function handleStatsClick(e) {
    if (e.target.classList.contains('absence-toggle')) {
        e.stopPropagation();
        const parent = e.target.closest('.stat-detail-item');
        if (parent) {
            const d = parent.dataset;
            toggleAbsence(d.name, d.item, d.loc, parseInt(d.index), d.groupid);
        }
        return;
    }
    const item = e.target.closest('.stat-detail-item');
    if (item && !item.classList.contains('absent')) {
        const d = item.dataset;
        toggleDone(d.name, d.item, d.loc, parseInt(d.index), d.groupid);
    }
}

async function sendStatusToCloud(action, groupId, index, value) {
    if (!GAS_WEB_APP_URL || GAS_WEB_APP_URL.includes('XXXXX')) return;
    try {
        clearInterval(syncInterval);
        await fetch(GAS_WEB_APP_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({ action: action, groupId: groupId, index: index, value: value })
        });
        setTimeout(startAutoSync, 4000);
    } catch (err) {
        console.error('同步至雲端失敗:', err);
        startAutoSync();
    }
}

function toggleDone(name, item, loc, index, groupId) {
    if (isItemAbsent(name, item, loc, index)) return; 
    const key = getStorageKey(name, item, loc, index);
    let newValue = false;
    
    if (localStorage.getItem(key) === 'true') {
        localStorage.removeItem(key);
        newValue = false;
    } else {
        localStorage.setItem(key, 'true');
        newValue = true;
    }
    markLocalWrite(); 
    renderOrders();
    if (groupId) sendStatusToCloud('toggleDone', groupId, index, newValue);
}

function toggleAbsence(name, item, loc, index, groupId) {
    const key = getAbsenceKey(name, item, loc, index);
    let newAbsentValue = false;
    
    if (localStorage.getItem(key) === 'true') {
        localStorage.removeItem(key);
        newAbsentValue = false;
    } else {
        localStorage.setItem(key, 'true');
        newAbsentValue = true;
        localStorage.removeItem(getStorageKey(name, item, loc, index));
        if (groupId) sendStatusToCloud('toggleDone', groupId, index, false);
    }
    markLocalWrite(); 
    renderOrders();
    if (groupId) sendStatusToCloud('toggleAbsence', groupId, index, newAbsentValue);
}

function manualClearAll() {
    if (!confirm("確定要手動重置今日所有狀態嗎？")) return;
    clearInterval(syncInterval);
    localStorage.clear();
    renderOrders();
    
    if (GAS_WEB_APP_URL && !GAS_WEB_APP_URL.includes('XXXXX')) {
        fetch(GAS_WEB_APP_URL, {
            method: 'POST',
            mode: 'no-cors',
            body: JSON.stringify({ action: 'clearAll', dateStr: getTodayDateString() })
        }).then(() => {
            setTimeout(startAutoSync, 3000);
        });
    } else {
        startAutoSync();
    }
}

function openEditModal() {
    const modal = document.getElementById('vendorEditModal');
    const vendorSelect = document.getElementById('modalVendorSelect');
    const itemSelect = document.getElementById('modalItemSelect');
    
    if (!modal || !vendorSelect || !itemSelect) return;
    
    vendorSelect.innerHTML = '';
    
    const daySelect = document.getElementById('daySelect');
    const day = daySelect ? parseInt(daySelect.value) : new Date().getDay();
    const todaysVendors = customers.filter(c => (c.days.length === 0 || c.days.includes(day)) && c.groupId);
    
    if (todaysVendors.length === 0) {
        vendorSelect.innerHTML = '<option value="">-- 本日無營業攤販 --</option>';
        itemSelect.value = "hot_am"; 
    } else {
        vendorSelect.innerHTML = todaysVendors.map(c => {
            let displayName = (c.name || c.groupId).trim();
            if (displayName.length > 6) {
                displayName = displayName.slice(0, 6) + '...';
            }
            return `<option value="${c.groupId}" data-item="${c.item}">[${c.loc}] ${displayName}</option>`;
        }).join('');
    }
    
    onModalVendorChange();
    modal.style.display = 'flex';
}

function onModalVendorChange() {
    const vendorSelect = document.getElementById('modalVendorSelect');
    const itemSelect = document.getElementById('modalItemSelect');
    
    if (!vendorSelect || !itemSelect || vendorSelect.value === "") return;
    const selectedOption = vendorSelect.options[vendorSelect.selectedIndex];
    const currentItem = selectedOption.dataset.item;
    
    if (currentItem) {
        itemSelect.value = currentItem;
    }
}
function closeEditModal() {
    document.getElementById('vendorEditModal').style.display = 'none';
}

let localEditLock = {
    groupId: null,
    newItem: null,
    newType: null
};

async function submitVendorEdit() {
    const vendorSelect = document.getElementById('modalVendorSelect');
    const itemSelect = document.getElementById('modalItemSelect');
    
    if (!vendorSelect || !itemSelect || vendorSelect.value === "") {
        alert("無有效店家可修改");
        return;
    }

    const password = prompt("請輸入管理員密碼以確認修改：");
    if (password !== "1008") { 
        alert("密碼錯誤，拒絕修改！");
        return; 
    }
    
    const groupId = vendorSelect.value;
    const newItem = itemSelect.value;
    const newType = ITEM_TYPE_MAP[newItem] || "hot_am"; 
    
    if (syncInterval) {
        clearInterval(syncInterval);
        syncInterval = null;
    }
    
    localEditLock.groupId = groupId;
    localEditLock.newItem = newItem;
    localEditLock.newType = newType;
    
    customers = customers.map(c => {
        if (c.groupId === groupId) {
            return { ...c, item: newItem, type: newType };
        }
        return c; 
    });
    renderOrders();
    closeEditModal();
    
    if (GAS_WEB_APP_URL && !GAS_WEB_APP_URL.includes('XXXXX')) {
        try {
            await fetch(GAS_WEB_APP_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain' }, 
                body: JSON.stringify({ 
                    action: 'updateItem', 
                    groupId: groupId, 
                    newItem: newItem
                })
            });
        } catch (err) {
            console.error('更新雲端品項失敗:', err);
        }
    }
    
    setTimeout(() => {
        localEditLock.groupId = null;
        localEditLock.newItem = null;
        localEditLock.newType = null;
        startAutoSync();
    }, 6000); 
}

function makeHtml(stats, prefix) {
    let html = '', totalN = 0, totalD = 0; let hasData = false;
    for (const k in CONFIG.TYPE_NAMES) {
        if (stats[k] && stats[k].total > 0) {
            hasData = true; const s = stats[k];
            const activeTotal = s.orders.filter(o => !o.isAbsent).length;
            const rem = activeTotal - s.done;
            const per = activeTotal > 0 ? Math.round((s.done / activeTotal) * 100) : 100;
            const id = `detail_${prefix}_${k}`;
            html += `
                <div class="stat-row"><span>${CONFIG.TYPE_NAMES[k]}</span><div class="progress-counts"><span class="count-total">${activeTotal}</span><span class="count-remaining">剩: <b style="${rem === 0 ? 'color:var(--color-success)' : ''}">${rem}</b></span></div></div>
                <div class="stat-row-progress"><div class="progress-fill" style="width:${per}%; background-color:${rem === 0 ? 'var(--color-success)' : 'var(--color-accent)'};"></div></div>
                <div id="${id}" class="stat-detail-list" style="display: block;">
                    ${s.orders.map(o => {
                        let displayTag = o.tag || o.note || '';
                        if (displayTag.includes('neighbor') || displayTag.includes('other') || displayTag.includes('_')) displayTag = ''; 
                        return `
                        <div class="stat-detail-item ${o.isAbsent ? 'absent' : (o.isDone ? 'done' : '')}" data-name="${o.name}" data-item="${o.item}" data-loc="${o.loc}" data-index="${o.index}" data-groupid="${o.groupId}">
                            <span class="absence-toggle">${o.isAbsent ? '恢復' : '缺席'}</span>
                            <div class="customer-info"><span class="customer-name">${o.name}${o.count > 1 ? ` (${o.index + 1}/${o.count})` : ''} ${displayTag ? `<span class="customer-tag">${displayTag}</span>` : ''}</span><span class="customer-loc">${o.item}</span></div>
                            <input type="checkbox" ${o.isDone || o.isAbsent ? 'checked' : ''} ${o.isAbsent ? 'disabled' : ''}>
                        </div>`;
                    }).join('')}
                </div>`;
            totalN += activeTotal; totalD += s.done;
        }
    }
    if (!hasData) return '<div style="text-align:center;color:#999;padding:10px;">無訂單</div>';
    const totalRem = totalN - totalD; const totalPer = totalN > 0 ? Math.round((totalD / totalN) * 100) : 100;
    html += `<div class="stat-row total"><span>🏆 總計 (扣除缺席)</span><div class="progress-counts"><span class="count-total">${totalN}</span><span class="count-remaining">剩: <b style="${totalRem === 0 ? 'color:var(--color-success)' : ''}">${totalRem}</b></span></div></div><div class="stat-row-progress"><div class="progress-fill" style="width:${totalPer}%; background-color:${totalRem === 0 ? 'var(--color-success)' : 'var(--color-total-progress)'};"></div></div>`;
    return html;
}

function renderDashboard(todaysOrders) {
    const dashboard = document.getElementById('summaryDashboard');
    if (!dashboard) return;

    let itemCounts = {};

    todaysOrders.forEach(c => {
        const count = c.count || 1;
        for (let i = 0; i < count; i++) {
            let isAbsent = isItemAbsent(c.name, c.item, c.loc, i);
            let isDone = isItemDone(c.name, c.item, c.loc, i);
            
            if (!isAbsent && !isDone) {
                const itemName = c.item || "未定品項";
                itemCounts[itemName] = (itemCounts[itemName] || 0) + 1;
            }
        }
    });

    const entries = Object.entries(itemCounts);
    if (entries.length === 0) {
        dashboard.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: var(--color-success); font-weight: bold; font-size: 14px; padding: 4px 0;">🎉 今日所有咖啡皆已製作送達！</div>';
        return;
    }

    entries.sort((a, b) => b[1] - a[1]);

    dashboard.innerHTML = entries.map(([name, count]) => `
        <div class="dashboard-pill">
            <span class="pill-name">☕ ${name}</span>
            <span class="pill-count">${count} 杯</span>
        </div>
    `).join('');
}

function renderOrders() {
    const daySelect = document.getElementById('daySelect');
    if (!daySelect) return;
    const day = parseInt(daySelect.value);
    
    const sDDiv = document.getElementById('stats-deliver');
    const sADiv = document.getElementById('stats-ask');
    const dashboard = document.getElementById('summaryDashboard');
    
    if (day === 1) { 
        if (sDDiv) sDDiv.innerHTML = '<div style="text-align:center;color:#999;padding:10px;">本日休息</div>';
        if (sADiv) sADiv.innerHTML = '<div style="text-align:center;color:#999;padding:10px;">本日休息</div>';
        if (dashboard) dashboard.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:#999;font-size:14px;">本日公休</div>';
        const clearBtn = document.getElementById('clearAllBtn');
        if (clearBtn) clearBtn.disabled = true; 
        const memoList = document.getElementById('dynamicMemoList');
        if (memoList) memoList.innerHTML = ''; 
        return;
    }
    
    const clearBtn = document.getElementById('clearAllBtn');
    if (clearBtn) clearBtn.disabled = false;

    // 如果連快取都沒有（初次安裝或手動重置後），先提示讀取中
    if (!customers || customers.length === 0) {
        if (sDDiv) sDDiv.innerHTML = '<div style="text-align:center;color:#999;padding:10px;">☕ 正在聯絡雲端建立名單...</div>';
        return;
    }

    const createStatsObj = () => { let obj = {}; for (const k in CONFIG.TYPE_NAMES) obj[k] = { total: 0, done: 0, orders: [] }; return obj; };
    let sDeliver = createStatsObj(), sAsk = createStatsObj();
    const todaysOrders = customers.filter(c => c.days.length === 0 || c.days.includes(day));
    
    renderDashboard(todaysOrders);
    renderMemos(todaysOrders);

    todaysOrders.forEach(c => {
        let target = (c.loc === "當日問") ? sAsk : sDeliver;
        if (CONFIG.TYPE_NAMES[c.type]) {
            const count = c.count || 1; 
            target[c.type].total += count;
            for (let i = 0; i < count; i++) {
                let isAbsent = isItemAbsent(c.name, c.item, c.loc, i); 
                let done = isItemDone(c.name, c.item, c.loc, i);
                if (done && !isAbsent) target[c.type].done++;
                target[c.type].orders.push({ ...c, isDone: done, isAbsent, index: i });
            }
        }
    });
    if (sDDiv) sDDiv.innerHTML = makeHtml(sDeliver, 'd'); 
    if (sADiv) sADiv.innerHTML = makeHtml(sAsk, 'a'); 
}

function renderMemos(todaysOrders) {
    const memoList = document.getElementById('dynamicMemoList'); 
    const staticList = document.getElementById('staticMemoList');
    if (!memoList || !staticList) return;

    const filterMemos = todaysOrders.filter(c => c.tag && !c.tag.includes('寄杯')).filter(c => { 
        for (let i = 0; i < (c.count || 1); i++) { 
            if (!isItemDone(c.name, c.item, c.loc, i)) return true; 
        } 
        return false; 
    });
    
    if (filterMemos.length > 0) {
        let html = '<li class="dynamic-memo-title">🎯 今日需確認：</li>';
        filterMemos.forEach(c => html += `<li class="dynamic-memo-item"><b>${c.name.split('(')[0]}</b> <span class="memo-tag">${c.item}</span></li>`);
        memoList.innerHTML = html; 
        staticList.classList.add('has-dynamic');
    } else { 
        memoList.innerHTML = ''; 
        staticList.classList.remove('has-dynamic'); 
    }
}

function renderPrices() {
    const baseContainer = document.getElementById('baseDrinksContainer'); 
    if (baseContainer && CONFIG.BASE_DRINKS) { 
        baseContainer.innerHTML = CONFIG.BASE_DRINKS.map(item => `<div class="mini-price-item">${item.name}<span class="p-cost">${item.price}</span></div>`).join(''); 
    }
    const otherContainer = document.getElementById('otherItemsContainer'); 
    if (otherContainer && CONFIG.OTHER_ITEMS) { 
        otherContainer.innerHTML = CONFIG.OTHER_ITEMS.map(item => `<div class="mini-price-item">${item.name}<span class="p-cost">${item.price}</span></div>`).join(''); 
    }
    const menuTable = document.getElementById('menuTableBody'); 
    if (menuTable && CONFIG.MENU_DATA) { 
        menuTable.innerHTML = CONFIG.MENU_DATA.map(item => `<tr><td>${item.name}</td><td><span class="menu-price">${item.takeout || '-'}</span></td><td><span class="menu-price">${item.dinein || '-'}</span></td><td><span class="menu-price">${item.halfPound || '-'}</span></td><td><span class="menu-price">${item.drip || '-'}</span></td></tr>`).join(''); 
    }
}

function toggleSection(id, btn) {
    const sections = ['menuReference', 'method', 'memoSection'];
    const el = document.getElementById(id);
    const isVisible = el.classList.contains('visible');

    sections.forEach(s => {
        document.getElementById(s).classList.remove('visible');
    });
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('nav-active'));

    if (!isVisible) {
        el.classList.add('visible');
        if (btn) btn.classList.add('nav-active');
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

function getTodayDateString() {
    const t = new Date(); return t.getFullYear() + (t.getMonth() + 1).toString().padStart(2, '0') + t.getDate().toString().padStart(2, '0');
}
function sanitize(s) { return s ? s.replace(/ /g, '_').replace(/[^a-zA-Z0-9\u4e00-\u9fa5_]/g, '') : ''; }
function getStorageKey(n, i, l, idx = 0) { return `${getTodayDateString()}_${sanitize(n)}_${sanitize(i)}_${sanitize(l)}_${idx}`; }
function isItemDone(n, i, l, idx = 0) { return localStorage.getItem(getStorageKey(n, i, l, idx)) === 'true'; }
function getAbsenceKey(n, i, l, idx = 0) { return `${getTodayDateString()}_absent_${sanitize(n)}_${sanitize(i)}_${sanitize(l)}_${idx}`; }
function isItemAbsent(n, i, l, idx = 0) { return localStorage.getItem(getAbsenceKey(n, i, l, idx)) === 'true'; }