// ══════════════════════════════════════
// CONFIG
// ══════════════════════════════════════
const MENU_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSEiSHdIF1FlVgrSp5r8DhCDnTKAVhfRjXPIizNQ_d5kK_FFUQJfQKhQG1YXe3ViIdExAiUnAPlKCO-/pub?gid=250388087&single=true&output=csv";
const GAS_URL = "https://script.google.com/macros/s/AKfycbyAXTwhXOZfmICm1QjOd0tq5qJKYH0rMql4dWc_1SxlCkBmF8nD-1NEDrHLKzzLo481lQ/exec";

// ══════════════════════════════════════
// STATE
// ══════════════════════════════════════
let coffeeData = [];
let cart = {};
let currentAdminTab = 'status';

// ══════════════════════════════════════
// CSV PARSER
// ══════════════════════════════════════
function parseCSV(text) {
    const rows = [];
    for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) continue;
        const row = [];
        let cur = '', inQ = false;
        for (let i = 0; i < line.length; i++) {
            const c = line[i];
            if (c === '"') {
                if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
                else { inQ = !inQ; }
            } else if (c === ',' && !inQ) {
                row.push(cur.trim()); cur = '';
            } else {
                cur += c;
            }
        }
        row.push(cur.trim());
        rows.push(row);
    }
    return rows;
}

// ══════════════════════════════════════
// DATA LOADING (快取優先、背景同步)
// ══════════════════════════════════════

/**
 * 解析 CSV rows 為 coffeeData 陣列。
 * 注意：available 欄位（r[12]）接受 '1'、'上架'、'true'（不分大小寫）三種格式。
 */
function rowsToData(rows) {
    const data = [];
    for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        if (!r[0]) continue;
        const type = r[0].trim();
        const name = (r[2] || '').trim();
        if (!name) continue;

        if (type === 'classic' || type === 'other') {
            // 義式飲品與其他品項：只有單一價格，直接從外帶欄取
            data.push({ type, name, price: parseInt(r[8]) || 0 });
        } else if (type === 'single') {
            const rawStatus = (r[12] || '').trim().toLowerCase();
            data.push({
                id:       parseInt(r[1]) || i,
                type,
                name,
                origin:   (r[3] || '').trim(),
                process:  (r[4] || '').trim(),
                roast:    (r[5] || 'lr').trim(),
                roastName:(r[6] || '淺焙').trim(),
                flavor:   (r[7] || '').trim(),
                take:     parseInt(r[8])  || 0,
                stay:     parseInt(r[9])  || 0,
                pound:    parseInt(r[10]) || 0,
                drip:     parseInt(r[11]) || 0,
                // 統一接受 '1' / '上架' / 'true' 三種標記
                available: rawStatus === '1' || rawStatus === '上架' || rawStatus === 'true'
            });
        }
    }
    return data;
}

async function fetchMenuData() {
    // 1. ⚡ 優先讀本地快取，畫面秒開
    try {
        const cached = localStorage.getItem('cashier_coffee_data_cache');
        if (cached) {
            coffeeData = JSON.parse(cached);
            render();
        }
    } catch (e) {
        console.error('[快取] 讀取失敗', e);
    }

    // 2. 🌍 背景向雲端同步最新資料（5 秒逾時）
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        const res = await fetch(`${MENU_CSV_URL}&t=${Date.now()}`, { signal: controller.signal });
        clearTimeout(timer);

        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const rows = parseCSV(await res.text());
        const freshData = rowsToData(rows);

        // 資料有變才覆蓋，避免干擾正在進行的點餐操作
        if (JSON.stringify(coffeeData) !== JSON.stringify(freshData)) {
            coffeeData = freshData;
            localStorage.setItem('cashier_coffee_data_cache', JSON.stringify(freshData));
            render();
        }
    } catch (err) {
        console.warn('[雲端] 同步失敗，維持本地快取:', err.message);
        if (coffeeData.length === 0) {
            document.getElementById('beanGrid').innerHTML =
                '<div style="grid-column:1/-1;text-align:center;padding:20px;color:#a44a3f;font-size:0.85em;">⚠️ 讀取失敗，請重新整理頁面</div>';
        }
    }
}

// ══════════════════════════════════════
// GAS API
// ══════════════════════════════════════

/**
 * 向 Google Apps Script 發送 POST 請求。
 * 失敗時拋出 Error，呼叫方可用 try/catch 攔截。
 */
async function callGAS(payload) {
    const res = await fetch(GAS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error(`GAS 請求失敗 (HTTP ${res.status})`);
    const data = await res.json();
    // Apps Script 有時回傳 { ok: false, error: '...' }
    if (data && data.ok === false) throw new Error(data.error || 'GAS 回傳錯誤');
    return data;
}

// ══════════════════════════════════════
// RENDER
// ══════════════════════════════════════

/** 轉義單引號，防止內聯 onclick 字串斷裂 */
function esc(s) { return s.replace(/'/g, "\\'"); }

function render() {
    // 義式飲品
    document.getElementById('classicList').innerHTML = coffeeData
        .filter(d => d.type === 'classic')
        .map(item => `
            <div class="menu-item" onclick="addToCart('${esc(item.name)}',${item.price},'義式')">
                <span class="mi-name">${item.name}</span>
                <span class="mi-price">${item.price}</span>
            </div>
        `).join('');

    // 其他品項
    document.getElementById('otherList').innerHTML = coffeeData
        .filter(d => d.type === 'other')
        .map(item => `
            <div class="menu-item" onclick="addToCart('${esc(item.name)}',${item.price},'其他')">
                <span class="mi-name">${item.name}</span>
                <span class="mi-price">${item.price}</span>
            </div>
        `).join('');

    // 單品咖啡豆（只顯示上架中的）
    const singles = coffeeData.filter(d => d.type === 'single' && d.available);
    document.getElementById('beanGrid').innerHTML = singles.length === 0
        ? '<div style="grid-column:1/-1;text-align:center;padding:20px;color:#bbb;font-size:0.85em;">無供應單品豆</div>'
        : singles.map(item => `
            <div class="bean-card" onclick="openSpecSheet(${item.id})">
                <span class="bean-badge ${item.roast}">${item.roastName}</span>
                <div class="bean-name">${item.name}</div>
                ${item.origin ? `<div class="bean-tag">${item.origin}</div>` : ''}
            </div>
        `).join('');

    renderAdminStatus();
}

// ══════════════════════════════════════
// SPEC SHEET MODAL
// ══════════════════════════════════════
function openSpecSheet(id) {
    const item = coffeeData.find(c => c.id === id);
    if (!item) return;
    document.getElementById('specName').textContent = '🫘 ' + item.name;
    document.getElementById('specSub').textContent  = [item.roastName, item.origin, item.process].filter(Boolean).join(' · ');
    const specs = [
        { label: '外帶', price: item.take  },
        { label: '內用', price: item.stay  },
        { label: '濾掛', price: item.drip  },
        { label: '半磅', price: item.pound }
    ].filter(s => s.price > 0);
    document.getElementById('specGrid').innerHTML = specs.map(s => `
        <button class="spec-btn" onclick="addToCart('${esc(item.name)}',${s.price},'${s.label}');closeSpecSheet();">
            <span class="spec-label">${s.label}</span>
            <span class="spec-price">${s.price}</span>
        </button>
    `).join('');
    document.getElementById('specOverlay').classList.add('open');
}
function closeSpecSheet() { document.getElementById('specOverlay').classList.remove('open'); }
function handleSpecOverlayClick(e) {
    if (e.target === document.getElementById('specOverlay')) closeSpecSheet();
}

// ══════════════════════════════════════
// CART
// ══════════════════════════════════════
function addToCart(name, price, subText) {
    const key = `${name}-${subText}`;
    if (cart[key]) {
        cart[key].qty += 1;
    } else {
        cart[key] = { name, subText, price, qty: 1, temp: '冰' };
    }
    updateCartUI();
}

function toggleTemp(k) {
    if (!cart[k]) return;
    cart[k].temp = cart[k].temp === '冰' ? '熱' : '冰';
    updateCartUI();
}

function changeQty(k, delta) {
    if (!cart[k]) return;
    cart[k].qty += delta;
    if (cart[k].qty <= 0) delete cart[k];
    updateCartUI();
}

function clearCart() {
    cart = {};
    const input = document.getElementById('cashReceived');
    if (input) input.value = '';
    updateCartUI();
}

function setFastCash(amount) {
    document.getElementById('cashReceived').value = amount;
    calculateChange();
}

function calculateChange() {
    const total  = Object.values(cart).reduce((s, i) => s + i.price * i.qty, 0);
    const cash   = parseInt(document.getElementById('cashReceived').value) || 0;
    const change = cash >= total ? cash - total : 0;
    document.getElementById('calcChange').textContent = change;
}

function updateCartUI() {
    const total = Object.values(cart).reduce((s, i) => s + i.price * i.qty, 0);
    const count = Object.values(cart).reduce((s, i) => s + i.qty, 0);

    document.getElementById('topbarCount').textContent = `${count} 品項`;
    document.getElementById('calcTotal').textContent   = total;

    const keys = Object.keys(cart);
    if (keys.length === 0) {
        document.getElementById('cartList').innerHTML =
            '<div class="cart-empty"><div class="cart-empty-icon">🛒</div><span>無品項</span></div>';
        calculateChange();
        return;
    }

    document.getElementById('cartList').innerHTML = keys.map(k => {
        const item     = cart[k];
        const showTemp = item.subText === '內用' || item.subText === '外帶';
        return `
            <div class="cart-row">
                <div class="cart-info">
                    <div class="cart-name">${item.name}</div>
                    <div class="cart-meta">${item.subText}${showTemp ? ' · ' + item.temp : ''} &nbsp;·&nbsp; $${item.price}</div>
                </div>
                <div class="cart-controls">
                    ${showTemp ? `<button class="temp-btn" onclick="toggleTemp('${k}')">${item.temp}</button>` : ''}
                    <button class="qty-btn" onclick="changeQty('${k}', -1)">−</button>
                    <span class="qty-num">${item.qty}</span>
                    <button class="qty-btn" onclick="changeQty('${k}', 1)">+</button>
                </div>
            </div>`;
    }).join('');
    calculateChange();
}

// ══════════════════════════════════════
// ADMIN PANEL
// ══════════════════════════════════════
function openAdminPanel() {
    document.getElementById('adminOverlay').classList.add('open');
    renderAdminTab();
}
function closeAdminPanel() { document.getElementById('adminOverlay').classList.remove('open'); }
function handleAdminOverlayClick(e) {
    if (e.target === document.getElementById('adminOverlay')) closeAdminPanel();
}

function switchAdminTab(tab) {
    currentAdminTab = tab;
    document.getElementById('tabStatus').classList.toggle('active', tab === 'status');
    document.getElementById('tabAdd').classList.toggle('active', tab === 'add');
    renderAdminTab();
}

function renderAdminTab() {
    const body = document.getElementById('adminBody');
    if (currentAdminTab === 'status') {
        renderAdminStatus();
    } else {
        body.innerHTML = `
            <div class="form-note" style="margin-bottom:12px;">填寫後點「新增」，自動寫入試算表並設為上架。</div>
            <div class="success-msg" id="addSuccessMsg">✅ 已寫入試算表！</div>
            <div class="add-form">
                <div class="form-group full">
                    <label class="form-label">豆子名稱 *</label>
                    <input class="form-input" id="f_name" placeholder="例：肯亞 AA 日曬" type="text">
                </div>
                <div class="form-grid-2">
                    <div class="form-group"><label class="form-label">產地</label><input class="form-input" id="f_origin" placeholder="例：肯亞" type="text"></div>
                    <div class="form-group"><label class="form-label">處理法</label><input class="form-input" id="f_process" placeholder="例：日曬" type="text"></div>
                    <div class="form-group">
                        <label class="form-label">烘焙度</label>
                        <select class="form-select" id="f_roast">
                            <option value="lr">淺焙</option>
                            <option value="mr">中焙</option>
                            <option value="dr">深焙</option>
                        </select>
                    </div>
                    <div class="form-group"><label class="form-label">風味描述</label><input class="form-input" id="f_flavor" placeholder="例：藍莓、甜感" type="text"></div>
                </div>
                <div class="form-label" style="margin-top:2px;">價格設定</div>
                <div class="form-grid-2">
                    <div class="form-group"><label class="form-label">外帶 $</label><input class="form-input" id="f_take"  type="number" placeholder="150" inputmode="numeric"></div>
                    <div class="form-group"><label class="form-label">內用 $</label><input class="form-input" id="f_stay"  type="number" placeholder="160" inputmode="numeric"></div>
                    <div class="form-group"><label class="form-label">半磅 $</label><input class="form-input" id="f_pound" type="number" placeholder="350" inputmode="numeric"></div>
                    <div class="form-group"><label class="form-label">濾掛 $</label><input class="form-input" id="f_drip"  type="number" placeholder="80"  inputmode="numeric"></div>
                </div>
                <button class="submit-btn" onclick="submitNewBean()">＋ 新增單品豆</button>
            </div>`;
    }
}

function renderAdminStatus() {
    const body    = document.getElementById('adminBody');
    // 如果目前 tab 不是 status，不強制覆蓋 DOM
    if (!body || currentAdminTab !== 'status') return;

    const singles = coffeeData.filter(c => c.type === 'single');
    if (!singles.length) {
        body.innerHTML = '<div style="text-align:center;color:#bbb;padding:30px;">尚無單品豆資料</div>';
        return;
    }
    body.innerHTML = `
        <div class="batch-row">
            <button class="batch-btn" style="background:#4a3728;color:#fff;" onclick="batchUpdate(true)">✅ 全數上架</button>
            <button class="batch-btn" style="background:#bbb;color:#fff;" onclick="batchUpdate(false)">❌ 全數下架</button>
        </div>
        ${singles.map(item => `
            <div class="status-item">
                <div>
                    <div class="si-name">${item.name}</div>
                    <div class="si-sub">${item.origin} · ${item.roastName}</div>
                </div>
                <label class="toggle">
                    <input type="checkbox" id="tog_${item.id}" ${item.available ? 'checked' : ''} onchange="toggleStatus(${item.id}, this.checked)">
                    <span class="toggle-slider"></span>
                </label>
            </div>`).join('')}`;
}

// ══════════════════════════════════════
// ADMIN: TOGGLE / BATCH / ADD
// ══════════════════════════════════════
async function toggleStatus(id, checked) {
    const item = coffeeData.find(c => c.id === id);
    if (!item) return;

    // 立即更新本地畫面，不等網路
    item.available = checked;
    localStorage.setItem('cashier_coffee_data_cache', JSON.stringify(coffeeData));
    render();

    const cb = document.getElementById(`tog_${id}`);
    if (cb) cb.disabled = true;
    try {
        await callGAS({ action: 'updateStatus', id, status: checked });
    } catch (err) {
        alert(`⚠️ 試算表同步失敗：${err.message}`);
        // 復原本地狀態
        item.available = !checked;
        localStorage.setItem('cashier_coffee_data_cache', JSON.stringify(coffeeData));
        render();
    } finally {
        if (cb) cb.disabled = false;
    }
}

async function batchUpdate(status) {
    coffeeData.filter(c => c.type === 'single').forEach(c => c.available = status);
    localStorage.setItem('cashier_coffee_data_cache', JSON.stringify(coffeeData));
    render();
    renderAdminTab();
    try {
        await callGAS({ action: 'batchUpdateStatus', status });
    } catch (err) {
        alert(`⚠️ 批次同步失敗：${err.message}`);
    }
}

async function submitNewBean() {
    const name = document.getElementById('f_name').value.trim();
    if (!name) { alert('請填寫豆子名稱'); return; }

    const rv = document.getElementById('f_roast').value;
    const roastMap = { lr: '淺焙', mr: '中焙', dr: '深焙' };
    const bean = {
        name,
        origin:   document.getElementById('f_origin').value.trim(),
        process:  document.getElementById('f_process').value.trim(),
        roast:    rv,
        roastName:roastMap[rv],
        flavor:   document.getElementById('f_flavor').value.trim(),
        take:     parseInt(document.getElementById('f_take').value)  || 0,
        stay:     parseInt(document.getElementById('f_stay').value)  || 0,
        pound:    parseInt(document.getElementById('f_pound').value) || 0,
        drip:     parseInt(document.getElementById('f_drip').value)  || 0,
    };

    const btn = document.querySelector('.submit-btn');
    btn.textContent = '⏳ 寫入中…';
    btn.disabled    = true;
    try {
        const r = await callGAS({ action: 'addBean', bean });
        // 立即推進本地資料，不必重新拉整份雲端
        coffeeData.push({ ...bean, id: r.newId, type: 'single', available: true });
        localStorage.setItem('cashier_coffee_data_cache', JSON.stringify(coffeeData));
        render();

        const msg = document.getElementById('addSuccessMsg');
        if (msg) { msg.style.display = 'block'; setTimeout(() => msg.style.display = 'none', 3000); }
        ['f_name', 'f_origin', 'f_process', 'f_flavor', 'f_take', 'f_stay', 'f_pound', 'f_drip']
            .forEach(fid => { document.getElementById(fid).value = ''; });
        setTimeout(() => switchAdminTab('status'), 1200);
    } catch (err) {
        alert(`⚠️ 寫入失敗：${err.message}`);
    } finally {
        btn.textContent = '＋ 新增單品豆';
        btn.disabled    = false;
    }
}

// ══════════════════════════════════════
// INIT
// ══════════════════════════════════════
window.addEventListener('DOMContentLoaded', () => {
    fetchMenuData();
    updateCartUI();
});