/**
 * 一味淨生活咖啡系統 - 邏輯核心 (完整修正版)
 */

// --- 1. 全域狀態與設定 ---
let coffeeList = [];
let customers = [];

const typeNames = {
    hot_am: '☕ 熱美式', 
    ice_am: '🧊 冰美式', 
    large_hot_am: "☕️ 大熱美",
    hot_latte: '🔥 熱拿鐵', 
    hot_latte_sugar: '🍬 熱拿鐵 (加糖)',
    ice_latte_sugar: '🍭 冰拿鐵 (加糖)', 
    ice_latte: '❄️ 冰拿鐵',
    large_hot_latte: '🥤 大熱拿', 
    hand_drip: '💧 手沖', 
    potential_item: '❓ 待確認'
};

// --- 2. 初始化與資料讀取 ---

async function initData() {
    try {
        const [coffeeRes, customerRes] = await Promise.all([
            fetch('coffee_list.json'),
            fetch('customers.json')
        ]);

        if (!coffeeRes.ok || !customerRes.ok) throw new Error('資料讀取失敗');

        coffeeList = await coffeeRes.json();
        customers = await customerRes.json();

        initApp();
    } catch (error) {
        console.error('初始化失敗:', error);
        alert('無法載入資料，請檢查網路或檔案路徑');
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
    statsContainer.addEventListener('click', handleStatsClick);

    renderOrders();
}

// --- 3. 事件委派處理中心 ---

function handleStatsClick(e) {
    // 1. 處理「缺席」按鈕點擊
    if (e.target.classList.contains('absence-toggle')) {
        e.stopPropagation();
        const parent = e.target.closest('.stat-detail-item');
        toggleAbsence(parent.dataset.groupid);
        return;
    }

    // 2. 處理「訂單完成」點擊 (點擊背景或 Checkbox)
    const item = e.target.closest('.stat-detail-item');
    if (item && !item.classList.contains('absent')) {
        const d = item.dataset;
        toggleDone(d.name, d.item, d.loc, parseInt(d.index), d.groupid);
    }
}

// --- 4. 業務邏輯 ---

function toggleDone(name, item, loc, index, groupId) {
    if (isGroupAbsent(groupId)) return;
    const key = getStorageKey(name, item, loc, index);
    localStorage.getItem(key) === 'true' 
        ? localStorage.removeItem(key) 
        : localStorage.setItem(key, 'true');
    renderOrders();
}

function toggleAbsence(groupId) {
    const key = getAbsenceKey(groupId);
    if (localStorage.getItem(key) === 'true') {
        localStorage.removeItem(key);
    } else {
        localStorage.setItem(key, 'true');
        // 缺席時，移除該組所有已完成標記
        const day = parseInt(document.getElementById('daySelect').value);
        customers.filter(c => c.groupId === groupId && (c.days.length === 0 || c.days.includes(day))).forEach(c => {
            for (let i = 0; i < (c.count || 1); i++) {
                localStorage.removeItem(getStorageKey(c.name, c.item, c.loc, i));
            }
        });
    }
    renderOrders();
}

function clearAllDone() {
    if (!confirm("確定要重置今日所有狀態嗎？")) return;
    const day = parseInt(document.getElementById('daySelect').value);
    customers.filter(c => c.days.length === 0 || c.days.includes(day)).forEach(c => {
        for (let i = 0; i < (c.count || 1); i++) {
            localStorage.removeItem(getStorageKey(c.name, c.item, c.loc, i));
        }
        if (c.groupId) localStorage.removeItem(getAbsenceKey(c.groupId));
    });
    renderOrders();
}

// --- 5. 渲染引擎 ---

function makeHtml(stats, prefix) {
    let html = '', totalN = 0, totalD = 0;
    let hasData = false;

    for (const k in typeNames) {
        if (stats[k].total > 0) {
            hasData = true;
            const s = stats[k];
            const activeTotal = s.orders.filter(o => !o.isAbsent).length;
            const rem = activeTotal - s.done;
            const per = activeTotal > 0 ? Math.round((s.done / activeTotal) * 100) : 100;
            const id = `detail_${prefix}_${k}`;

            // 調整為預設展開且移除點擊提示
            html += `
                <div class="stat-row">
                    <span>${typeNames[k]}</span>
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
    const daySelect = document.getElementById('daySelect');
    const day = parseInt(daySelect.value);
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
        for (const k in typeNames) obj[k] = { total: 0, done: 0, orders: [] };
        return obj;
    };

    let sNeigh = createStatsObj(), sOther = createStatsObj(), sAsk = createStatsObj();
    const todaysOrders = customers.filter(c => c.days.length === 0 || c.days.includes(day));
    
    renderMemos(todaysOrders);

    todaysOrders.forEach(c => {
        let target = (c.loc === "當日問") ? sAsk : (c.loc.includes("鄰居") ? sNeigh : sOther);
        let isAbsent = isGroupAbsent(c.groupId);

        if (typeNames[c.type]) {
            const count = c.count || 1;
            target[c.type].total += count;
            for (let i = 0; i < count; i++) {
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

// --- 6. 工具函式 ---

function getTodayDateString() {
    const t = new Date();
    return t.getFullYear() + (t.getMonth() + 1).toString().padStart(2, '0') + t.getDate().toString().padStart(2, '0');
}

function sanitize(s) { return s ? s.replace(/ /g, '_').replace(/[^a-zA-Z0-9\u4e00-\u9fa5_]/g, '') : ''; }
function getStorageKey(n, i, l, idx = 0) { return `${getTodayDateString()}_${sanitize(n)}_${sanitize(i)}_${sanitize(l)}_${idx}`; }
function getAbsenceKey(gid) { return `${getTodayDateString()}_absent_${gid}`; }
function isItemDone(n, i, l, idx = 0) { return localStorage.getItem(getStorageKey(n, i, l, idx)) === 'true'; }
function isGroupAbsent(gid) { return gid ? localStorage.getItem(getAbsenceKey(gid)) === 'true' : false; }

// 啟動系統
initData();