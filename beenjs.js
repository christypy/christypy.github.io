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
        const row = []; let cur = '', inQ = false;
        for (let i = 0; i < line.length; i++) {
            const c = line[i];
            if (c === '"') { 
                if (inQ && line[i+1] === '"') { cur += '"'; i++; } 
                else { inQ = !inQ; }
            } else if (c === ',' && !inQ) { row.push(cur); cur = ''; }
            else { cur += c; }
        }
        row.push(cur); rows.push(row);
    }
    return rows;
}

// ══════════════════════════════════════
// 🚀 【關鍵優化】DATA LIFECYCLE (快取優先、背景同步)
// ══════════════════════════════════════
async function loadData() {
    // 1. ⚡ 零秒開機：優先撈手機本地舊快取，畫面直接出來，不用等網路！
    try {
        const localCache = localStorage.getItem('cashier_coffee_data_cache');
        if (localCache) {
            coffeeData = JSON.parse(localCache);
            console.log("[🚀 快取系統] 已秒開本地收銀快取資料");
            render(); 
        }
    } catch (e) {
        console.error("讀取本地快取失敗", e);
    }

    // 2. 🌍 背景靜態同步：悄悄去抓雲端最新狀態
    try {
        // 設定 5 秒超時限制，防止山區或市集網路卡死時轉圈圈
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        const res = await fetch(`${MENU_CSV_URL}&t=${new Date().getTime()}`, { signal: controller.signal });
        clearTimeout(timeoutId);
        
        if (!res.ok) throw new Error("CSV 讀取失敗");
        const text = await res.text();
        const rows = parseCSV(text);

        const freshData = [];
        // 跳過 CSV 標題列
        for (let i = 1; i < rows.length; i++) {
            const r = rows[i];
            if (r.length < 11) continue;
            freshData.push({
                id: r[0].trim(),
                type: r[1].trim(), // classic / other / single
                name: r[2].trim(),
                origin: r[3].trim(),
                process: r[4].trim(),
                roast: r[5].trim(),
                roastName: r[6].trim(),
                flavor: r[7].trim(),
                take: parseInt(r[8]) || 0,
                stay: parseInt(r[9]) || 0,
                pound: parseInt(r[10]) || 0,
                drip: parseInt(r[11]) || 0,
                available: r[12] ? r[12].trim().toLowerCase() === 'true' : true
            });
        }

        // 資料有變才覆蓋並重新渲染，避免干擾正在點餐的操作
        if (JSON.stringify(coffeeData) !== JSON.stringify(freshData)) {
            coffeeData = freshData;
            localStorage.setItem('cashier_coffee_data_cache', JSON.stringify(freshData));
            console.log("[🌍 雲端同步] 資料已在背景更新完畢");
            render();
        }
    } catch (err) {
        console.warn("⚠️ 雲端讀取超時或失敗，繼續維持本地快取操作:", err);
        // 如果連快取都全新沒資料，才渲染空提示
        if (coffeeData.length === 0) render();
    }
}

async function callGAS(payload) {
    const res = await fetch(GAS_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error("GAS 請求失敗");
    return await res.json();
}

// ══════════════════════════════════════
// RENDER
// ══════════════════════════════════════
function render() {
    const grid = document.getElementById('menuGrid');
    if (!grid) return;

    if (coffeeData.length === 0) {
        grid.innerHTML = '<div class="loading-state">☕ 正在從雲端建立收銀選單...</div>';
        return;
    }

    let html = '';
    // 只顯示上架中(available)的品項
    const avails = coffeeData.filter(b => b.available);

    if (avails.length === 0) {
        grid.innerHTML = '<div class="loading-state">目前無上架品項</div>';
        renderCart();
        renderAdminStatus();
        return;
    }

    avails.forEach(b => {
        let badge = '';
        if (b.type === 'single') {
            const rc = { lr: '浅', mr: '中', dr: '深' }[b.roast] || '中';
            badge = `<span class="badge ${b.roast || 'mr'}">${rc}</span>`;
        } else {
            badge = `<span class="badge classic-badge">經典</span>`;
        }

        const sub = b.type === 'single' ? `${b.origin} • ${b.process}` : '一味淨生活經典調配';

        html += `
        <div class="menu-card">
            ${badge}
            <div class="card-title">${b.name}</div>
            <div class="card-subtitle">${sub}</div>
            <div class="price-grid">
        `;
        if (b.take)  html += `<button class="p-btn" onclick="addToCart('${b.id}','take','外帶',${b.take})">外帶 $${b.take}</button>`;
        if (b.stay)  html += `<button class="p-btn" onclick="addToCart('${b.id}','stay','內用',${b.stay})">內用 $${b.stay}</button>`;
        if (b.pound) html += `<button class="p-btn" onclick="addToCart('${b.id}','pound','半磅',${b.pound})">半磅 $${b.pound}</button>`;
        if (b.drip)  html += `<button class="p-btn" onclick="addToCart('${b.id}','drip','濾掛',${b.drip})">濾掛 $${b.drip}</button>`;
        html += `</div></div>`;
    });

    grid.innerHTML = html;
    renderCart();
    renderAdminStatus();
}

// ══════════════════════════════════════
// CART & PRICING LOGIC
// ══════════════════════════════════════
function addToCart(id, pType, pLabel, price) {
    const bean = coffeeData.find(x => x.id === id);
    if (!bean) return;
    const k = `${id}_${pType}`;
    if (cart[k]) { cart[k].qty++; } 
    else { cart[k] = { id, name: bean.name, pType, pLabel, price, qty: 1 }; }
    renderCart();
}

function updateQty(k, delta) {
    if (!cart[k]) return;
    cart[k].qty += delta;
    if (cart[k].qty <= 0) delete cart[k];
    renderCart();
}

function renderCart() {
    const itemsDiv = document.getElementById('cartItems');
    const totalDiv = document.getElementById('cartTotal');
    if (!itemsDiv || !totalDiv) return;

    const entries = Object.entries(cart);
    if (entries.length === 0) {
        itemsDiv.innerHTML = '<div class="empty-cart">🛒 購物車空空如也</div>';
        totalDiv.textContent = '$0';
        return;
    }

    let html = '', total = 0;
    for (const [k, item] of entries) {
        const sub = item.price * item.qty;
        total += sub;
        html += `
        <div class="cart-item">
            <div class="item-meta">
                <div class="item-name">${item.name}</div>
                <div class="item-spec">${item.pLabel} $${item.price}</div>
            </div>
            <div class="item-ctrl">
                <button class="qty-btn" onclick="updateQty('${k}',-1)">-</button>
                <span class="qty-val">${item.qty}</span>
                <button class="qty-btn" onclick="updateQty('${k}',1)">+</button>
                <span class="item-sub">$${sub}</span>
            </div>
        </div>`;
    }
    itemsDiv.innerHTML = html;
    totalDiv.textContent = `$${total}`;
}

function clearCart() { cart = {}; renderCart(); }

async function checkout() {
    const entries = Object.entries(cart);
    if (entries.length === 0) { alert('購物車是空的'); return; }
    const btn = document.querySelector('.checkout-btn');
    const oldText = btn.textContent;
    btn.textContent = '⏳ 雲端結帳中…'; btn.disabled = true;

    const items = entries.map(([_, x]) => ({ id: x.id, name: x.name, pType: x.pType, pLabel: x.pLabel, price: x.price, qty: x.qty }));
    try {
        await callGAS({ action: 'checkout', items });
        alert('🎉 結帳成功！已同步扣減雲端庫存/紀錄');
        clearCart();
    } catch (err) {
        alert('❌ 結帳失敗，請檢查網路連線：' + err.message);
    } finally {
        btn.textContent = oldText; btn.disabled = false;
    }
}

// ══════════════════════════════════════
// ADMIN: STATUS MANAGEMENT
// ══════════════════════════════════════
function switchAdminTab(t) {
    currentAdminTab = t;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(`tab_${t}`).classList.add('active');
    document.getElementById('panel_status').style.display = t === 'status' ? 'block' : 'none';
    document.getElementById('panel_add').style.display = t === 'add' ? 'block' : 'none';
}

function renderAdminStatus() {
    const container = document.getElementById('adminStatusContainer');
    if (!container) return;

    if (coffeeData.length === 0) {
        container.innerHTML = '<div>暫無選單資料</div>';
        return;
    }

    container.innerHTML = coffeeData.map(b => {
        const info = b.type === 'single' ? `[${b.roastName}] ${b.origin}` : '經典供應';
        return `
        <div class="status-row">
            <div class="status-info">
                <strong>${b.name}</strong>
                <div style="font-size:11px; color:#777;">${info}</div>
            </div>
            <button class="toggle-btn ${b.available ? 'on' : 'off'}" onclick="toggleAvailable('${b.id}', ${b.available})">
                ${b.available ? '上架中' : '已下架'}
            </button>
        </div>`;
    }).join('');
}

async function toggleAvailable(id, curState) {
    // 💡 本地立即切換狀態，不讓使用者在畫面上等網路轉圈
    const target = coffeeData.find(x => x.id === id);
    if (target) {
        target.available = !curState;
        localStorage.setItem('cashier_coffee_data_cache', JSON.stringify(coffeeData));
        render();
    }

    try {
        // 背景靜態向雲端發送修改指令
        await callGAS({ action: 'toggleAvailable', id, available: !curState });
    } catch (err) {
        alert('雲端狀態同步失敗，網頁重新整理後將回復原本狀態。錯誤：' + err.message);
        // 若失敗，則復原
        if (target) {
            target.available = curState;
            localStorage.setItem('cashier_coffee_data_cache', JSON.stringify(coffeeData));
            render();
        }
    }
}

async function submitNewBean() {
    const name = document.getElementById('f_name').value.trim();
    if (!name) { alert('請填寫豆子名稱'); return; }
    const rv = document.getElementById('f_roast').value;
    const bean = {
        name, origin: document.getElementById('f_origin').value.trim(),
        process: document.getElementById('f_process').value.trim(),
        roast: rv, roastName: { lr: '淺焙', mr: '中焙', dr: '深焙' }[rv],
        flavor: document.getElementById('f_flavor').value.trim(),
        take: parseInt(document.getElementById('f_take').value) || 0,
        stay: parseInt(document.getElementById('f_stay').value) || 0,
        pound: parseInt(document.getElementById('f_pound').value) || 0,
        drip: parseInt(document.getElementById('f_drip').value) || 0,
    };
    const btn = document.querySelector('.submit-btn');
    btn.textContent = '⏳ 寫入中…'; btn.disabled = true;
    try {
        const r = await callGAS({ action: 'addBean', bean });
        
        // 成功後直接推進本地變數，並主動更新快取，省去重新拉整份雲端的時間
        const newBean = { ...bean, id: r.newId, type: 'single', available: true };
        coffeeData.push(newBean);
        localStorage.setItem('cashier_coffee_data_cache', JSON.stringify(coffeeData));
        render();

        const msg = document.getElementById('addSuccessMsg');
        if (msg) { msg.style.display = 'block'; setTimeout(() => msg.style.display = 'none', 3000); }
        ['f_name', 'f_origin', 'f_process', 'f_flavor', 'f_take', 'f_stay', 'f_pound', 'f_drip'].forEach(id => document.getElementById(id).value = '');
        setTimeout(() => switchAdminTab('status'), 1200);
    } catch (err) {
        alert('新增單品豆失敗：' + err.message);
    } finally {
        btn.textContent = '✨ 確認上架並寫入雲端'; btn.disabled = false;
    }
}

// ══════════════════════════════════════
// INIT
// ══════════════════════════════════════
window.addEventListener('DOMContentLoaded', loadData);