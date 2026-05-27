/**
 * 一味淨生活咖啡系統 - 中午 12:30 自動跨日清空同步版
 */

// ⚠️ 請在此處填入你的 Google 試算表 ID
const SPREADSHEET_ID = '1aH2ap9QeqhpKI34-K9SsyiHnTpXPM1ud2rpOmAQtSIA'; 
// ⚠️ 如果你有設定 Google Apps Script 網頁部署，請填在這邊（若尚未設定，可先保持空字串，系統會改用本地儲存備份）
const GAS_WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbyAXTwhXOZfmICm1QjOd0tq5qJKYH0rMql4dWc_1SxlCkBmF8nD-1NEDrHLKzzLo481lQ/exec'; 

let customers = [];
let syncInterval = null; 

// --- 初始化與資料讀取 ---
async function initData(isBackgroundSync = false) {
    try {
        // 🚀 核心：每次讀取前，先檢查當前時間是否需要執行 12:30 自動清空
        await checkAndExecuteAutoClear();

        const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:json&v=${new Date().getTime()}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error('無法連線至雲端');
        
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

        syncCloudToLocal();

        if (!isBackgroundSync) {
            initApp();
            startAutoSync(); 
        } else {
            renderOrders(); 
        }
    } catch (error) {
        console.error('雲端同步失敗:', error);
    }
}

// 🕒 自動判斷是否過了中午 12:30 且需要清空
async function checkAndExecuteAutoClear() {
    if (!GAS_WEB_APP_URL || GAS_WEB_APP_URL.includes('XXXXX')) return;

    const now = new Date();
    const currentHours = now.getHours();
    const currentMinutes = now.getMinutes();
    
    // 計算出「今天目標重置日」的字串記號
    // 如果今天還沒到 12:30，那「昨天的狀態」在今天早上還要看，所以重置目標標籤算在「昨天」
    // 如果今天已經過了 12:30，那重置目標標籤算在「今天」
    let targetResetDateStr = getTodayDateString(); 
    if (currentHours < 12 || (currentHours === 12 && currentMinutes < 30)) {
        // 如果在 12:30 之前，代表要檢查的是「昨天中午有沒有清空過」
        const yesterday = new Date(now);
        yesterday.setDate(now.getDate() - 1);
        targetResetDateStr = yesterday.getFullYear() + (yesterday.getMonth() + 1).toString().padStart(2, '0') + yesterday.getDate().toString().padStart(2, '0');
    }

    try {
        // 向 GAS 發送 GET 請求，詢問雲端最後一次清空的日期是什麼時候
        const checkRes = await fetch(`${GAS_WEB_APP_URL}?v=${new Date().getTime()}`);
        if (checkRes.ok) {
            const checkData = await checkRes.json();
            const cloudLastClearDate = checkData.lastClearDate;

            // 如果雲端記錄的最後清空日期，早於我們計算出來的重置目標日，代表「到了 12:30 卻還沒清空」！
            if (cloudLastClearDate !== targetResetDateStr) {
                console.log(`[系統通知] 已過中午 12:30，自動發動全系統清空作業...`);
                
                // 本地快速擦除
                localStorage.clear(); 

                // 通知雲端永久清空，並把最後清空日標記為 targetResetDateStr
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

function startAutoSync() {
    if (syncInterval) clearInterval(syncInterval);
    syncInterval = setInterval(() => {
        initData(true);
    }, 5000); // 每 5 秒自動在背景檢查一次變更與時間
}

function syncCloudToLocal() {
    customers.forEach(c => {
        const count = c.count || 1;
        for (let i = 0; i < count; i++) {
            const doneKey = getStorageKey(c.name, c.item, c.loc, i);
            const absentKey = getAbsenceKey(c.name, c.item, c.loc, i);
            
            if (c.cloudDoneArr[i] === 'true') localStorage.setItem(doneKey, 'true');
            else localStorage.removeItem(doneKey);
            
            if (c.cloudAbsentArr[i] === 'true') localStorage.setItem(absentKey, 'true');
            else localStorage.removeItem(absentKey);
        }
    });
}

function initApp() {
    // 1. 取得今天星期幾 (0 是週日，1-6 是週一到週六)
    const today = new Date().getDay();
    console.log("系統偵測今天的星期數字為:", today); // 👈 你可以按 F12 打開主控台看這行印出多少
    // 2. 讓網頁上那顆「星期下拉選單」自動選中今天的星期
    const daySelect = document.getElementById('daySelect');
    if (daySelect) {
        daySelect.value = today;
    }

    // 3. 綁定「非動態」按鈕與選單的事件監聽
    document.getElementById('clearAllBtn').addEventListener('click', manualClearAll);
    
    // 當使用者手動切換星期下拉選單時，才去重新拉雲端/渲染
    daySelect.addEventListener('change', () => { 
        initData(true); 
    });
    
    const statsContainer = document.querySelector('.stats-container');
    if (statsContainer) {
        statsContainer.addEventListener('click', handleStatsClick);
    }

    // 🚀 核心修正：強制根據今天的星期，執行第一次的訂單篩選與畫面渲染
    renderOrders(); 
    renderPrices(); 
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
            mode: 'no-cors',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: action, groupId: groupId, index: index, value: value })
        });
        setTimeout(startAutoSync, 2000);
    } catch (err) {
        console.error('即時同步至雲端失敗:', err);
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

// 手動重置按鈕邏輯
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

// --- 渲染引擎 (makeHtml, renderOrders, renderMemos, renderPrices 保留原樣) ---
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
    const day = parseInt(document.getElementById('daySelect').value);
    const sNDiv = document.getElementById('stats-neighbor');
    const sADiv = document.getElementById('stats-ask');
    const sODiv = document.getElementById('stats-other');
    if (day === 1) { 
        sNDiv.innerHTML = sADiv.innerHTML = sODiv.innerHTML = '<div style="text-align:center;color:#999;padding:10px;">本日休息</div>';
        document.getElementById('clearAllBtn').disabled = true; document.getElementById('dynamicMemoList').innerHTML = ''; return;
    }
    document.getElementById('clearAllBtn').disabled = false;
    const createStatsObj = () => { let obj = {}; for (const k in CONFIG.TYPE_NAMES) obj[k] = { total: 0, done: 0, orders: [] }; return obj; };
    let sNeigh = createStatsObj(), sOther = createStatsObj(), sAsk = createStatsObj();
    const todaysOrders = customers.filter(c => c.days.length === 0 || c.days.includes(day));
    renderMemos(todaysOrders);
    todaysOrders.forEach(c => {
        let target = (c.loc === "當日問") ? sAsk : (c.loc.includes("鄰居") ? sNeigh : sOther);
        if (CONFIG.TYPE_NAMES[c.type]) {
            const count = c.count || 1; target[c.type].total += count;
            for (let i = 0; i < count; i++) {
                let isAbsent = isItemAbsent(c.name, c.item, c.loc, i); let done = isItemDone(c.name, c.item, c.loc, i);
                if (done && !isAbsent) target[c.type].done++;
                target[c.type].orders.push({ ...c, isDone: done, isAbsent, index: i });
            }
        }
    });
    sNDiv.innerHTML = makeHtml(sNeigh, 'n'); sADiv.innerHTML = makeHtml(sAsk, 'a'); sODiv.innerHTML = makeHtml(sOther, 'o');
}

function renderMemos(todaysOrders) {
    const memoList = document.getElementById('dynamicMemoList'); const staticList = document.getElementById('staticMemoList');
    const filterMemos = todaysOrders.filter(c => c.tag && !c.tag.includes('寄杯')).filter(c => { for (let i = 0; i < (c.count || 1); i++) { if (!isItemDone(c.name, c.item, c.loc, i)) return true; } return false; });
    if (filterMemos.length > 0) {
        let html = '<li class="dynamic-memo-title">🎯 今日需確認：</li>';
        filterMemos.forEach(c => html += `<li class="dynamic-memo-item"><b>${c.name.split('(')[0]}</b> <span class="memo-tag">${c.item}</span></li>`);
        memoList.innerHTML = html; staticList.classList.add('has-dynamic');
    } else { memoList.innerHTML = ''; staticList.classList.remove('has-dynamic'); }
}

function renderPrices() {
    const baseContainer = document.getElementById('baseDrinksContainer'); if (baseContainer) { baseContainer.innerHTML = CONFIG.BASE_DRINKS.map(item => `<div class="price-item">${item.name}<span class="p-value">${item.price}</span></div>`).join(''); }
    const otherContainer = document.getElementById('otherItemsContainer'); if (otherContainer) { otherContainer.innerHTML = CONFIG.OTHER_ITEMS.map(item => `<div class="price-item">${item.name}<span class="p-value">${item.price}</span></div>`).join(''); }
    const menuTable = document.getElementById('menuTableBody'); if (menuTable) { menuTable.innerHTML = CONFIG.MENU_DATA.map(item => `<tr><td>${item.name}</td><td><span class="menu-price">${item.takeout || '-'}</span></td><td><span class="menu-price">${item.dinein || '-'}</span></td><td><span class="menu-price">${item.halfPound || '-'}</span></td><td><span class="menu-price">${item.drip || '-'}</span></td></tr>`).join(''); }
}

function getTodayDateString() {
    const t = new Date(); return t.getFullYear() + (t.getMonth() + 1).toString().padStart(2, '0') + t.getDate().toString().padStart(2, '0');
}
function sanitize(s) { return s ? s.replace(/ /g, '_').replace(/[^a-zA-Z0-9\u4e00-\u9fa5_]/g, '') : ''; }
function getStorageKey(n, i, l, idx = 0) { return `${getTodayDateString()}_${sanitize(n)}_${sanitize(i)}_${sanitize(l)}_${idx}`; }
function isItemDone(n, i, l, idx = 0) { return localStorage.getItem(getStorageKey(n, i, l, idx)) === 'true'; }
function getAbsenceKey(n, i, l, idx = 0) { return `${getTodayDateString()}_absent_${sanitize(n)}_${sanitize(i)}_${sanitize(l)}_${idx}`; }
function isItemAbsent(n, i, l, idx = 0) { return localStorage.getItem(getAbsenceKey(n, i, l, idx)) === 'true'; }

initData();