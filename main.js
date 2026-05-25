/**
 * 一味淨生活咖啡系統 - 徹底修復標籤大小寫問題版
 */

// ⚠️ 請在此處填入你的 Google 試算表 ID
const SPREADSHEET_ID = '1aH2ap9QeqhpKI34-K9SsyiHnTpXPM1ud2rpOmAQtSIA'; 
// ⚠️ 如果你有設定 Google Apps Script 網頁部署，請填在這邊（若尚未設定，可先保持空字串，系統會改用本地儲存備份）
const GAS_WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbxkSZ6hm9NlknXcrzgSNPW1ISwX_HR3K2soj094K2y_tgsnrurtPLJIVclTBfZ7Syo/exec'; 


// --- 1. 全域狀態 ---
let customers = [];

// --- 2. 初始化與資料讀取 ---

async function initData() {
    try {
        // 僅需讀取客戶資料，豆單與名稱對照直接引用 CONFIG
        const customerRes = await fetch('customers.json');

        if (!customerRes.ok) throw new Error('資料讀取失敗');

        customers = await customerRes.json();

        initApp();
    } catch (error) {
        console.error('初始化失敗:', error);
    }
}

function initApp() {
    // 設定今日星期
    document.getElementById('daySelect').value = new Date().getDay();

    // 綁定「非動態」按鈕的事件
    document.getElementById('clearAllBtn').addEventListener('click', clearAllDone);
    document.getElementById('daySelect').addEventListener('change', renderOrders);
    
    // 綁定統計區容器的事件委派
    const statsContainer = document.querySelector('.stats-container');
    if (statsContainer) {
        statsContainer.addEventListener('click', handleStatsClick);
    }

    // 執行初始渲染
    renderOrders(); // 渲染攤販訂單清單
    renderPrices(); // 渲染義式飲品、其他品項與單品豆單表格
}

// --- 3. 事件委派處理中心（✨ 已修正：徹底分流「缺席按鈕」與「整列點擊」） ---

function handleStatsClick(e) {
    // 1. 優先處理「缺席/恢復」按鈕點擊
    if (e.target.classList.contains('absence-toggle')) {
        e.stopPropagation(); // 阻止事件冒泡
        const parent = e.target.closest('.stat-detail-item');
        if (parent) {
            const d = parent.dataset;
            // 傳入精確的單杯資料進行 切換
            toggleAbsence(d.name, d.item, d.loc, parseInt(d.index));
        }
        return; // 執行完立刻離開，不讓下方的訂單完成邏輯干擾
    }

    // 2. 處理「整列點擊」（點擊勾選框或文字判定為完成訂單）
    const item = e.target.closest('.stat-detail-item');
    // 只有在非缺席狀態下，點擊整列才能切換完成狀態
    if (item && !item.classList.contains('absent')) {
        const d = item.dataset;
        toggleDone(d.name, d.item, d.loc, parseInt(d.index), d.groupid);
    }
}

// --- 4. 業務邏輯 ---

function toggleDone(name, item, loc, index, groupId) {
    // 改為判斷這「那一杯」有沒有缺席，缺席就不能點完成
    if (isItemAbsent(name, item, loc, index)) return; 
    
    const key = getStorageKey(name, item, loc, index);
    localStorage.getItem(key) === 'true' 
        ? localStorage.removeItem(key) 
        : localStorage.setItem(key, 'true');
    renderOrders();
}

// 傳入更多參數，讓按鈕知道是哪一家的哪一杯要缺席
function toggleAbsence(name, item, loc, index) {
    const key = getAbsenceKey(name, item, loc, index);
    
    if (localStorage.getItem(key) === 'true') {
        // 如果原本是缺席，按第二次就是「恢復」，清除缺席註記
        localStorage.removeItem(key);
    } else {
        // 如果原本不是缺席，設定為缺席，並移除「這特定一杯」的已完成標記
        localStorage.setItem(key, 'true');
        localStorage.removeItem(getStorageKey(name, item, loc, index));
    }
    renderOrders();
}

function clearAllDone() {
    if (!confirm("確定要重置今日所有狀態嗎？")) return;
    const day = parseInt(document.getElementById('daySelect').value);
    customers.filter(c => c.days.length === 0 || c.days.includes(day)).forEach(c => {
        for (let i = 0; i < (c.count || 1); i++) {
            localStorage.removeItem(getStorageKey(c.name, c.item, c.loc, i));
            localStorage.removeItem(getAbsenceKey(c.name, c.item, c.loc, i)); // 同步清除單杯缺席
        }
    });
    renderOrders();
}

// --- 5. 渲染引擎 ---

function makeHtml(stats, prefix) {
    let html = '', totalN = 0, totalD = 0;
    let hasData = false;

    // 統一使用 CONFIG.TYPE_NAMES 作為來源
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
                    ${s.orders.map(o => `
                        <div class="stat-detail-item ${o.isAbsent ? 'absent' : (o.isDone ? 'done' : '')}"
                             data-name="${o.name}" data-item="${o.item}" data-loc="${o.loc}" 
                             data-index="${o.index}" data-groupid="${o.groupId}">
                            <span class="absence-toggle">${o.isAbsent ? '恢復' : '缺席'}</span>
                            <div class="customer-info">
                                <span class="customer-name">${o.name}${o.count > 1 ? ` (${o.index + 1}/${o.count})` : ''} 
                                    ${o.tag || o.note ? `<span class="customer-tag">${o.tag || o.note}</span>` : ''}
                                </span>
                                <span class="customer-loc">${o.item}</span>
                            </div>
                            <input type="checkbox" ${o.isDone || o.isAbsent ? 'checked' : ''} ${o.isAbsent ? 'disabled' : ''}>
                        </div>
                    `).join('')}
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

// --- 6. 工具函式 ---

function getTodayDateString() {
    const t = new Date();
    return t.getFullYear() + (t.getMonth() + 1).toString().padStart(2, '0') + t.getDate().toString().padStart(2, '0');
}

function sanitize(s) { return s ? s.replace(/ /g, '_').replace(/[^a-zA-Z0-9\u4e00-\u9fa5_]/g, '') : ''; }
function getStorageKey(n, i, l, idx = 0) { return `${getTodayDateString()}_${sanitize(n)}_${sanitize(i)}_${sanitize(l)}_${idx}`; }
function isItemDone(n, i, l, idx = 0) { return localStorage.getItem(getStorageKey(n, i, l, idx)) === 'true'; }

function getAbsenceKey(n, i, l, idx = 0) { 
    return `${getTodayDateString()}_absent_${sanitize(n)}_${sanitize(i)}_${sanitize(l)}_${idx}`; 
}

function isItemAbsent(n, i, l, idx = 0) { 
    return localStorage.getItem(getAbsenceKey(n, i, l, idx)) === 'true'; 
}

function isGroupAbsent(gid) { 
    return gid ? localStorage.getItem(`${getTodayDateString()}_absent_group_${gid}`) === 'true' : false; 
}

// 啟動系統
initData();