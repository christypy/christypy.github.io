/**
 * 一味淨生活咖啡系統 - 徹底修復標籤大小寫問題版
 */

// ⚠️ 請在此處填入你的 Google 試算表 ID
const SPREADSHEET_ID = '1aH2ap9QeqhpKI34-K9SsyiHnTpXPM1ud2rpOmAQtSIA'; 
// ⚠️ 如果你有設定 Google Apps Script 網頁部署，請填在這邊（若尚未設定，可先保持空字串，系統會改用本地儲存備份）
const GAS_WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbz0Ex6MfHhOg5OR-0v_YFZ_d036IE_JNT8ZONwY94Pz_LWCVsC9JXW7QG6gyZVuBA-Jeg/exec'; 

let customers = [];

// --- 初始化與資料讀取 ---
async function initData() {
    try {
        // 使用時間戳記強迫每次重整都抓到雲端最新狀態（包含勾選、缺席紀錄）
        const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:json&v=${new Date().getTime()}`;
        
        const res = await fetch(url);
        if (!res.ok) throw new Error('無法連線至雲端');
        
        const text = await res.text();
        const jsonString = text.substring(text.indexOf('{'), text.lastIndexOf('}') + 1);
        const data = JSON.parse(jsonString);
        
        const rows = data.table.rows;
        customers = rows.map(row => {
            const cells = row.c;
            // 讀取試算表第 10 欄與第 11 欄的勾選狀態 (例如 "true,false")
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

        // 將雲端狀態寫入本地快取，確保兩邊一致
        syncCloudToLocal();
        initApp();
    } catch (error) {
        console.error('雲端讀取失敗，採用本地既有暫存狀態:', error);
    }
}

function syncCloudToLocal() {
    customers.forEach(c => {
        const count = c.count || 1;
        for (let i = 0; i < count; i++) {
            const doneKey = getStorageKey(c.name, c.item, c.loc, i);
            const absentKey = getAbsenceKey(c.name, c.item, c.loc, i);
            
            // 只有當雲端「確實有紀錄」時，才強制同步到本地
            if (c.cloudDoneArr && c.cloudDoneArr.length > 0 && c.cloudDoneArr.includes('true')) {
                if (c.cloudDoneArr[i] === 'true') localStorage.setItem(doneKey, 'true');
                else localStorage.removeItem(doneKey);
            }
            
            if (c.cloudAbsentArr && c.cloudAbsentArr.length > 0 && c.cloudAbsentArr.includes('true')) {
                if (c.cloudAbsentArr[i] === 'true') localStorage.setItem(absentKey, 'true');
                else localStorage.removeItem(absentKey);
            }
        }
    });
}

function initApp() {
    document.getElementById('daySelect').value = new Date().getDay();
    document.getElementById('clearAllBtn').addEventListener('click', clearAllDone);
    document.getElementById('daySelect').addEventListener('change', renderOrders);
    
    const statsContainer = document.querySelector('.stats-container');
    if (statsContainer) statsContainer.addEventListener('click', handleStatsClick);

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

// ✨ 背景發送非同步請求更新 Google 試算表，不影響網頁流暢度
async function sendStatusToCloud(action, groupId, index, value) {
    if (!GAS_WEB_APP_URL || GAS_WEB_APP_URL.includes('XXXXX')) return;
    try {
        fetch(GAS_WEB_APP_URL, {
            method: 'POST',
            mode: 'no-cors',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: action, groupId: groupId, index: index, value: value })
        });
    } catch (err) {
        console.error('即時同步至雲端失敗:', err);
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

function clearAllDone() {
    if (!confirm("確定要重置今日所有狀態嗎？")) return;
    const day = parseInt(document.getElementById('daySelect').value);
    
    customers.filter(c => c.days.length === 0 || c.days.includes(day)).forEach(c => {
        for (let i = 0; i < (c.count || 1); i++) {
            localStorage.removeItem(getStorageKey(c.name, c.item, c.loc, i));
            localStorage.removeItem(getAbsenceKey(c.name, c.item, c.loc, i)); 
        }
    });
    renderOrders();
    
    if (GAS_WEB_APP_URL && !GAS_WEB_APP_URL.includes('XXXXX')) {
        fetch(GAS_WEB_APP_URL, {
            method: 'POST',
            mode: 'no-cors',
            body: JSON.stringify({ action: 'clearAll', day: day })
        });
    }
}

// --- 渲染引擎 ---
function makeHtml(stats, prefix) {
    let html = '', totalN = 0, totalD = 0;
    let hasData = false;

    for (const k in CONFIG.TYPE_NAMES) {
        if (stats[k] && stats[k].total > 0) {
            hasData = true;
            const s = stats[k];
            const activeTotal = s.orders.filter(o => !o.isAbsent).length;
            const rem = activeTotal - s.done;
            const per = activeTotal > 0 ? Math.round((s.done / activeTotal) * 100) : 100;
            const id = `detail_${prefix}_${k}`;

            html += `
                <div class="stat-row">
                    <span>${CONFIG.TYPE_NAMES[k]}</span>
                    <div class="progress-counts">
                        <span class="count-total">${activeTotal}</span>
                        <span class="count-remaining">剩: <b style="${rem === 0 ? 'color:var(--color-success)' : ''}">${rem}</b></span>
                    </div>
                </div>
                <div class="stat-row-progress">
                    <div class="progress-fill" style="width:${per}%; background-color:${rem === 0 ? 'var(--color-success)' : 'var(--color-accent)'};"></div>
                </div>
                <div id="${id}" class="stat-detail-list" style="display: block;">
                    ${s.orders.map(o => {
                        let displayTag = o.tag || o.note || '';
                        if (displayTag.includes('neighbor') || displayTag.includes('other') || displayTag.includes('_')) {
                            displayTag = ''; 
                        }
                        return `
                        <div class="stat-detail-item ${o.isAbsent ? 'absent' : (o.isDone ? 'done' : '')}"
                             data-name="${o.name}" data-item="${o.item}" data-loc="${o.loc}" 
                             data-index="${o.index}" data-groupid="${o.groupId}">
                            <span class="absence-toggle">${o.isAbsent ? '恢復' : '缺席'}</span>
                            <div class="customer-info">
                                <span class="customer-name">${o.name}${o.count > 1 ? ` (${o.index + 1}/${o.count})` : ''} 
                                    ${displayTag ? `<span class="customer-tag">${displayTag}</span>` : ''}
                                </span>
                                <span class="customer-loc">${o.item}</span>
                            </div>
                            <input type="checkbox" ${o.isDone || o.isAbsent ? 'checked' : ''} ${o.isAbsent ? 'disabled' : ''}>
                        </div>`;
                    }).join('')}
                </div>`;
            totalN += activeTotal;
            totalD += s.done;
        }
    }
    if (!hasData) return '<div style="text-align:center;color:#999;padding:10px;">無訂單</div>';
    
    const totalRem = totalN - totalD;
    const totalPer = totalN > 0 ? Math.round((totalD / totalN) * 100) : 100;
    html += `
        <div class="stat-row total">
            <span>🏆 總計 (扣除缺席)</span>
            <div class="progress-counts">
                <span class="count-total">${totalN}</span>
                <span class="count-remaining">剩: <b style="${totalRem === 0 ? 'color:var(--color-success)' : ''}">${totalRem}</b></span>
            </div>
        </div>
        <div class="stat-row-progress">
            <div class="progress-fill" style="width:${totalPer}%; background-color:${totalRem === 0 ? 'var(--color-success)' : 'var(--color-total-progress)'};"></div>
        </div>`;
    return html;
}

function renderOrders() {
    const day = parseInt(document.getElementById('daySelect').value);
    const sNDiv = document.getElementById('stats-neighbor');
    const sADiv = document.getElementById('stats-ask');
    const sODiv = document.getElementById('stats-other');

    if (day === 1) { 
        sNDiv.innerHTML = sADiv.innerHTML = sODiv.innerHTML = '<div style="text-align:center;color:#999;padding:10px;">本日休息</div>';
        document.getElementById('clearAllBtn').disabled = true;
        document.getElementById('dynamicMemoList').innerHTML = '';
        return;
    }
    document.getElementById('clearAllBtn').disabled = false;

    const createStatsObj = () => {
        let obj = {};
        for (const k in CONFIG.TYPE_NAMES) obj[k] = { total: 0, done: 0, orders: [] };
        return obj;
    };

    let sNeigh = createStatsObj(), sOther = createStatsObj(), sAsk = createStatsObj();
    const todaysOrders = customers.filter(c => c.days.length === 0 || c.days.includes(day));
    
    renderMemos(todaysOrders);

    todaysOrders.forEach(c => {
        let target = (c.loc === "當日問") ? sAsk : (c.loc.includes("鄰居") ? sNeigh : sOther);
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
    sNDiv.innerHTML = makeHtml(sNeigh, 'n');
    sADiv.innerHTML = makeHtml(sAsk, 'a');
    sODiv.innerHTML = makeHtml(sOther, 'o');
}

function renderMemos(todaysOrders) {
    const memoList = document.getElementById('dynamicMemoList');
    const staticList = document.getElementById('staticMemoList');
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
    if (baseContainer) {
        baseContainer.innerHTML = CONFIG.BASE_DRINKS.map(item => `
            <div class="price-item">${item.name}<span class="p-value">${item.price}</span></div>
        `).join('');
    }
    const otherContainer = document.getElementById('otherItemsContainer');
    if (otherContainer) {
        otherContainer.innerHTML = CONFIG.OTHER_ITEMS.map(item => `
            <div class="price-item">${item.name}<span class="p-value">${item.price}</span></div>
        `).join('');
    }
    const menuTable = document.getElementById('menuTableBody');
    if (menuTable) {
        menuTable.innerHTML = CONFIG.MENU_DATA.map(item => `
            <tr>
                <td>${item.name}</td>
                <td><span class="menu-price">${item.takeout || '-'}</span></td>
                <td><span class="menu-price">${item.dinein || '-'}</span></td>
                <td><span class="menu-price">${item.halfPound || '-'}</span></td>
                <td><span class="menu-price">${item.drip || '-'}</span></td>
            </tr>
        `).join('');
    }
}

function getTodayDateString() {
    const t = new Date();
    return t.getFullYear() + (t.getMonth() + 1).toString().padStart(2, '0') + t.getDate().toString().padStart(2, '0');
}
function sanitize(s) { return s ? s.replace(/ /g, '_').replace(/[^a-zA-Z0-9\u4e00-\u9fa5_]/g, '') : ''; }
function getStorageKey(n, i, l, idx = 0) { return `${getTodayDateString()}_${sanitize(n)}_${sanitize(i)}_${sanitize(l)}_${idx}`; }
function isItemDone(n, i, l, idx = 0) { return localStorage.getItem(getStorageKey(n, i, l, idx)) === 'true'; }
function getAbsenceKey(n, i, l, idx = 0) { return `${getTodayDateString()}_absent_${sanitize(n)}_${sanitize(i)}_${sanitize(l)}_${idx}`; }
function isItemAbsent(n, i, l, idx = 0) { return localStorage.getItem(getAbsenceKey(n, i, l, idx)) === 'true'; }

initData();