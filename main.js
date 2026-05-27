/**
 * 一味淨生活咖啡系統 - 中午 12:30 自動跨日清空同步版
 */

// ⚠️ 請在此處填入你的 Google 試算表 ID
const SPREADSHEET_ID = '1aH2ap9QeqhpKI34-K9SsyiHnTpXPM1ud2rpOmAQtSIA'; 
// ⚠️ 如果你有設定 Google Apps Script 網頁部署，請填在這邊（若尚未設定，可先保持空字串，系統會改用本地儲存備份）
const GAS_WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbyAXTwhXOZfmICm1QjOd0tq5qJKYH0rMql4dWc_1SxlCkBmF8nD-1NEDrHLKzzLo481lQ/exec'; 


let customers = [];
let syncInterval = null; 

// 前端修改品項文字與 試算表 type 代碼的快速轉換字典
const ITEM_TYPE_MAP = {
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

// --- 🚀 頁面初始化：用 DOMContentLoaded 確保 HTML 跑完立刻秒跳星期 ---
window.addEventListener('DOMContentLoaded', () => {
    initApp();
});

function initApp() {
    // 1. 瞬間取得今天星期幾 (0是週日, 1-6是週一到週六)
    const today = new Date().getDay(); 
    
    // 2. 讓下拉選單立刻選中今天
    const daySelect = document.getElementById('daySelect');
    if (daySelect) {
        daySelect.value = today;
    }

    // 3. 綁定基本按鈕與手動切換選單事件
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

    // 4. 🚀 修正點：先只渲染靜態的價格表，訂單列表等雲端資料到了再畫（避免跑出「無訂單」）
    renderPrices(); 
}

function handleDaySelectChange() {
    initData(true); // 手動切換星期時，強制刷一次雲端與畫面
}

// --- 🕒 核心資料讀取與同步引擎 ---
async function initData(isBackgroundSync = false) {
    try {
        // 檢查時間是否需要自動發動中午 12:30 的大清空
        await checkAndExecuteAutoClear();

        // 遠端抓取 Google 試算表最新 JSON 資料 (加上時間戳記防止瀏覽器快取舊資料)
        const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:json&v=${new Date().getTime()}`;
        const res = await fetch(url);
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


        // 雲端最新資料撈回後，強制同步至本地 LocalStorage
        syncCloudToLocal();
        
        // 🚀 補上這段：如果目前處於修改鎖定期，強制修正抓回來的雲端舊資料，防止畫面閃爍彈回！
        if (localEditLock.groupId) {
            customers = customers.map(c => {
                if (c.groupId === localEditLock.groupId) {
                    return { ...c, item: localEditLock.newItem, type: localEditLock.newType };
                }
                return c;
            });
        }
        
        // 資料確實到齊了，這時候大腳一踩刷出正確的訂單列表！
        renderOrders();

        // 如果是第一次開網頁成功，這時候才啟動背景每 5 秒的自動輪詢定時器
        if (!isBackgroundSync) {
            startAutoSync(); 
        }
    } catch (error) {
        console.error('雲端同步失敗，採用本地資料墊底:', error);
        renderOrders();
    }
}

// 🚀 建立自動同步監聽器（每 5 秒鐘自動檢查一次雲端變更）
function startAutoSync() {
    if (syncInterval) clearInterval(syncInterval);
    syncInterval = setInterval(() => {
        initData(true); // 傳入 true 代表背景默默同步
    }, 5000); 
}

// 將雲端最新的完成/缺席狀態覆蓋至本地
function syncCloudToLocal() {
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

// 🕒 自動判斷是否過了中午 12:30 且需要清空
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
                console.log(`[系統通知] 已過中午 12:30，自動發動全系統跨日清空作業...`);
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

// --- 🖱️ 點擊與即時資料傳輸事件 ---
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
            mode: 'no-cors',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: action, groupId: groupId, index: index, value: value })
        });
        setTimeout(startAutoSync, 2000);
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

// --- 🚀 修正版：打開彈窗時，自動將品項選單預設為該攤販目前的品項 ---
function openEditModal() {
    const modal = document.getElementById('vendorEditModal');
    const vendorSelect = document.getElementById('modalVendorSelect');
    const itemSelect = document.getElementById('modalItemSelect');
    
    if (!modal || !vendorSelect || !itemSelect) return;
    
    // 1. 清空舊的選項
    vendorSelect.innerHTML = '';
    
    // 2. 找出「今天有營業」且有 groupId 的攤販
    const daySelect = document.getElementById('daySelect');
    const day = daySelect ? parseInt(daySelect.value) : new Date().getDay();
    const todaysVendors = customers.filter(c => (c.days.length === 0 || c.days.includes(day)) && c.groupId);
    
    if (todaysVendors.length === 0) {
        vendorSelect.innerHTML = '<option value="">-- 本日無營業攤販 --</option>';
        itemSelect.value = "hot_am"; // 預設防呆
    } else {
        // 3. 渲染攤販選項，並把目前的品項塞進 data-item 屬性中
        vendorSelect.innerHTML = todaysVendors.map(c => {
            let displayName = (c.name || c.groupId).trim();
            // 如果名字太長，自動切斷
            if (displayName.length > 6) {
                displayName = displayName.slice(0, 6) + '...';
            }
            return `<option value="${c.groupId}" data-item="${c.item}">[${c.loc}] ${displayName}</option>`;
        }).join('');
    }
    
    // 4. 🚀 關鍵核心：立刻觸發一次選單連動，讓「更換品項」秒變為當前店家的品項
    onModalVendorChange();
    
    // 5. 顯示彈窗
    modal.style.display = 'flex';
}

// --- 🚀 連動更新：當切換店家時，更換品項自動切過去 ---
function onModalVendorChange() {
    const vendorSelect = document.getElementById('modalVendorSelect');
    const itemSelect = document.getElementById('modalItemSelect');
    
    if (!vendorSelect || !itemSelect || vendorSelect.value === "") return;
    
    // 抓取目前被選中的 <option> 標籤
    const selectedOption = vendorSelect.options[vendorSelect.selectedIndex];
    
    // 從標籤中取出我們剛剛埋進去的 data-item（也就是這家店目前的品項，如 "冰手沖"）
    const currentItem = selectedOption.dataset.item;
    
    if (currentItem) {
        // 🚀 讓底下的品項選單數值，直接秒切成跟目前品項一模一樣！
        itemSelect.value = currentItem;
    }
}
function closeEditModal() {
    document.getElementById('vendorEditModal').style.display = 'none';
}


// 建立一個全域的暫時鎖定物件，用來防止雲端時間差造成的彈回現象
let localEditLock = {
    groupId: null,
    newItem: null,
    newType: null
};

// --- 🚀 安全升級：密碼防護版 ---
async function submitVendorEdit() {
    const vendorSelect = document.getElementById('modalVendorSelect');
    const itemSelect = document.getElementById('modalItemSelect');
    
    if (!vendorSelect || !itemSelect || vendorSelect.value === "") {
        alert("無有效店家可修改");
        return;
    }

    // 🔒 1. 彈出密碼確認視窗
    const password = prompt("請輸入管理員密碼以確認修改：");
    
    // 💡 這裡設定你的密碼，例如我幫你預設 "8888"，你可以自己改成想要的密碼
    if (password !== "1008") { 
        alert("密碼錯誤，拒絕修改！");
        return; // 密碼不對就直接切斷，不執行後續動作
    }
    
    const groupId = vendorSelect.value;
    const newItem = itemSelect.value;
    const newType = ITEM_TYPE_MAP[newItem] || "hot_am"; 
    
    // 2. 確實關閉計時器，停止背景輪詢
    if (syncInterval) {
        clearInterval(syncInterval);
        syncInterval = null;
    }
    
    // 3. 關鍵鎖定：把這次修改的品項釘死在全域變數裡，防止被舊資料覆蓋
    localEditLock.groupId = groupId;
    localEditLock.newItem = newItem;
    localEditLock.newType = newType;
    
    // 4. 立即強制更新前端陣列並刷畫面
    customers = customers.map(c => {
        if (c.groupId === groupId) {
            return { ...c, item: newItem, type: newType };
        }
        return c; 
    });
    renderOrders();
    closeEditModal();
    
    // 5. 發送請求至雲端
    if (GAS_WEB_APP_URL && !GAS_WEB_APP_URL.includes('XXXXX')) {
        try {
            console.log("[系統] 密碼驗證通過，正在發送請求至雲端...");
            
            await fetch(GAS_WEB_APP_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain' }, 
                body: JSON.stringify({ 
                    action: 'updateItem', 
                    groupId: groupId, 
                    newItem: newItem
                })
            });
            
            console.log("[系統] 雲端已成功接收並處理完畢！");
        } catch (err) {
            console.error('更新雲端品項失敗，保留本地修改狀態:', err);
        }
    }
    
    // 6. 拉長安全重啟時間
    setTimeout(() => {
        localEditLock.groupId = null;
        localEditLock.newItem = null;
        localEditLock.newType = null;
        console.log("[系統] 緩衝結束，解除鎖定並重啟背景輪詢...");
        startAutoSync();
    }, 6000); 
}

// --- 🎨 頁面 HTML 渲染引擎 ---
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

function renderOrders() {
    const daySelect = document.getElementById('daySelect');
    if (!daySelect) return;
    const day = parseInt(daySelect.value);
    
    const sNDiv = document.getElementById('stats-neighbor');
    const sADiv = document.getElementById('stats-ask');
    const sODiv = document.getElementById('stats-other');
    
    if (day === 1) { 
        if (sNDiv) sNDiv.innerHTML = '<div style="text-align:center;color:#999;padding:10px;">本日休息</div>';
        if (sADiv) sADiv.innerHTML = '<div style="text-align:center;color:#999;padding:10px;">本日休息</div>';
        if (sODiv) sODiv.innerHTML = '<div style="text-align:center;color:#999;padding:10px;">本日休息</div>';
        const clearBtn = document.getElementById('clearAllBtn');
        if (clearBtn) clearBtn.disabled = true; 
        const memoList = document.getElementById('dynamicMemoList');
        if (memoList) memoList.innerHTML = ''; 
        return;
    }
    
    const clearBtn = document.getElementById('clearAllBtn');
    if (clearBtn) clearBtn.disabled = false;

    // 如果雲端資料還沒下載完（長度為0），先直接返回，不要渲染「無訂單」三個字
    if (!customers || customers.length === 0) return;

    const createStatsObj = () => { let obj = {}; for (const k in CONFIG.TYPE_NAMES) obj[k] = { total: 0, done: 0, orders: [] }; return obj; };
    let sNeigh = createStatsObj(), sOther = createStatsObj(), sAsk = createStatsObj();
    const todaysOrders = customers.filter(c => c.days.length === 0 || c.days.includes(day));
    
    renderMemos(todaysOrders);

    todaysOrders.forEach(c => {
        let target = (c.loc === "當日問") ? sAsk : (c.loc.includes("鄰居") ? sNeigh : sOther);
        if (CONFIG.TYPE_NAMES[c.type]) {
            const count = c.count || 1; target[c.type].total += count;
            for (let i = 0; i < count; i++) {
                let isAbsent = isItemAbsent(c.name, c.item, c.loc, i); 
                let done = isItemDone(c.name, c.item, c.loc, i);
                if (done && !isAbsent) target[c.type].done++;
                target[c.type].orders.push({ ...c, isDone: done, isAbsent, index: i });
            }
        }
    });
    if (sNDiv) sNDiv.innerHTML = makeHtml(sNeigh, 'n'); 
    if (sADiv) sADiv.innerHTML = makeHtml(sAsk, 'a'); 
    if (sODiv) sODiv.innerHTML = makeHtml(sOther, 'o');
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
        baseContainer.innerHTML = CONFIG.BASE_DRINKS.map(item => `<div class="price-item">${item.name}<span class="p-value">${item.price}</span></div>`).join(''); 
    }
    const otherContainer = document.getElementById('otherItemsContainer'); 
    if (otherContainer && CONFIG.OTHER_ITEMS) { 
        otherContainer.innerHTML = CONFIG.OTHER_ITEMS.map(item => `<div class="price-item">${item.name}<span class="p-value">${item.price}</span></div>`).join(''); 
    }
    const menuTable = document.getElementById('menuTableBody'); 
    if (menuTable && CONFIG.MENU_DATA) { 
        menuTable.innerHTML = CONFIG.MENU_DATA.map(item => `<tr><td>${item.name}</td><td><span class="menu-price">${item.takeout || '-'}</span></td><td><span class="menu-price">${item.dinein || '-'}</span></td><td><span class="menu-price">${item.halfPound || '-'}</span></td><td><span class="menu-price">${item.drip || '-'}</span></td></tr>`).join(''); 
    }
}

// --- 🛠️ 輔助工具函式區 ---
function getTodayDateString() {
    const t = new Date(); return t.getFullYear() + (t.getMonth() + 1).toString().padStart(2, '0') + t.getDate().toString().padStart(2, '0');
}
function sanitize(s) { return s ? s.replace(/ /g, '_').replace(/[^a-zA-Z0-9\u4e00-\u9fa5_]/g, '') : ''; }
function getStorageKey(n, i, l, idx = 0) { return `${getTodayDateString()}_${sanitize(n)}_${sanitize(i)}_${sanitize(l)}_${idx}`; }
function isItemDone(n, i, l, idx = 0) { return localStorage.getItem(getStorageKey(n, i, l, idx)) === 'true'; }
function getAbsenceKey(n, i, l, idx = 0) { return `${getTodayDateString()}_absent_${sanitize(n)}_${sanitize(i)}_${sanitize(l)}_${idx}`; }
function isItemAbsent(n, i, l, idx = 0) { return localStorage.getItem(getAbsenceKey(n, i, l, idx)) === 'true'; }

// 🚀 唯一啟動執行入口
initData();