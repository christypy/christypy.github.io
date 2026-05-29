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
            if (c === '"') { if (inQ && line[i+1] === '"') { cur += '"'; i++; } else inQ = !inQ; }
            else if (c === ',' && !inQ) { row.push(cur.trim()); cur = ''; }
            else cur += c;
        }
        row.push(cur.trim()); rows.push(row);
    }
    return rows;
}

// ══════════════════════════════════════
// FETCH DATA
// ══════════════════════════════════════
async function fetchMenuData() {
    try {
        const res = await fetch(MENU_CSV_URL + '&t=' + Date.now());
        if (!res.ok) throw new Error();
        const rows = parseCSV(await res.text());
        coffeeData = [];
        for (let i = 1; i < rows.length; i++) {
            const r = rows[i];
            if (!r[0]) continue;
            const type = r[0].trim(), name = (r[2]||'').trim();
            if (!name) continue;
            if (type === 'classic' || type === 'other') {
                coffeeData.push({ type, name, price: parseInt(r[8])||0 });
            } else if (type === 'single') {
                const status = (r[12]||'').trim();
                coffeeData.push({
                    id: parseInt(r[1])||i, type, name,
                    origin: (r[3]||'').trim(), process: (r[4]||'').trim(),
                    roast:  (r[5]||'lr').trim(), roastName:(r[6]||'淺焙').trim(),
                    flavor: (r[7]||'').trim(),
                    take:  parseInt(r[8])||0, stay: parseInt(r[9])||0,
                    pound: parseInt(r[10])||0, drip: parseInt(r[11])||0,
                    available: status === '1' || status === '上架'
                });
            }
        }
        render();
    } catch {
        document.getElementById('beanGrid').innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:20px;color:#a44a3f;font-size:0.8em;">⚠️ 讀取失敗，請重新整理</div>';
    }
}

// ══════════════════════════════════════
// RENDER INTERFACE
// ══════════════════════════════════════
function esc(s) { return s.replace(/'/g,"\\'"); }

function render() {
    // 渲染義式飲品
    document.getElementById('classicList').innerHTML = coffeeData
        .filter(d => d.type === 'classic')
        .map((item, i, arr) => `
            <li class="menu-item" onclick="addToCart('${esc(item.name)}',${item.price},'義式')">
                <span class="mi-name">${item.name}</span>
                <span class="mi-price">${item.price}</span>
            </li>${i < arr.length-1 ? '<div class="divider-line"></div>' : ''}
        `).join('');

    // 渲染其他品項
    document.getElementById('otherList').innerHTML = coffeeData
        .filter(d => d.type === 'other')
        .map((item, i, arr) => `
            <li class="menu-item" onclick="addToCart('${esc(item.name)}',${item.price},'其他')">
                <span class="mi-name">${item.name}</span>
                <span class="mi-price">${item.price}</span>
            </li>${i < arr.length-1 ? '<div class="divider-line"></div>' : ''}
        `).join('');

    // 渲染單品豆網格
    const singles = coffeeData.filter(d => d.type === 'single' && d.available);
    document.getElementById('beanGrid').innerHTML = singles.length === 0
        ? '<div style="grid-column:1/-1;text-align:center;padding:20px;color:#bbb;font-size:0.8em;">目前無供應單品豆</div>'
        : singles.map(item => `
            <div class="bean-card" onclick="openSpecSheet(${item.id})">
                <span class="bean-badge ${item.roast}">${item.roastName}</span>
                <div class="bean-name">${item.name}</div>
                ${item.origin ? `<div class="bean-tag">${item.origin}</div>` : ''}
            </div>
        `).join('');
}

// ══════════════════════════════════════
// SPEC SHEET (規格小彈窗)
// ══════════════════════════════════════
function openSpecSheet(id) {
    const item = coffeeData.find(c => c.id === id);
    if (!item) return;
    document.getElementById('specName').textContent = '🫘 ' + item.name;
    document.getElementById('specSub').textContent  = [item.roastName, item.origin, item.process].filter(Boolean).join(' · ');
    const specs = [
        { label:'外帶', price:item.take },
        { label:'內用', price:item.stay },
        { label:'濾掛', price:item.drip },
        { label:'半磅', price:item.pound }
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
function handleSpecOverlayClick(e) { if (e.target === document.getElementById('specOverlay')) closeSpecSheet(); }

// ══════════════════════════════════════
// CART CORE LOGIC
// ══════════════════════════════════════
function addToCart(name, price, subText) {
    cart[`${name}-${subText}-${Date.now()}`] = { name, subText, price, qty:1, temp:'冰' };
    updateCartUI();
}
function toggleTemp(k)   { if (cart[k]) { cart[k].temp = cart[k].temp==='冰'?'熱':'冰'; updateCartUI(); } }
function changeQty(k, d) { if (!cart[k]) return; cart[k].qty += d; if (cart[k].qty <= 0) delete cart[k]; updateCartUI(); }
function clearCart()     { cart = {}; document.getElementById('cashReceived').value=''; updateCartUI(); }
function setFastCash(n)  {
    document.getElementById('cashReceived').value = n;
    calculateChange();
}

function calculateChange() {
    const total = Object.values(cart).reduce((s,i) => s + i.price * i.qty, 0);
    const cash  = parseInt(document.getElementById('cashReceived').value) || 0;
    const change = cash >= total ? cash - total : 0;
    document.getElementById('calcChange').textContent = change;
}

function updateCartUI() {
    const keys  = Object.keys(cart);
    const total = Object.values(cart).reduce((s,i) => s + i.price * i.qty, 0);
    const count = Object.values(cart).reduce((s,i) => s + i.qty, 0);

    document.getElementById('topbarCount').textContent = count + ' 品項';
    document.getElementById('calcTotal').textContent   = total;

    if (keys.length === 0) {
        document.getElementById('cartList').innerHTML = '<div class="cart-empty"><div class="cart-empty-icon">🛒</div><span>收銀台空空如也</span></div>';
        calculateChange();
        return;
    }
    
    document.getElementById('cartList').innerHTML = keys.map(k => {
        const item = cart[k];
        const showTemp = item.subText === '內用' || item.subText === '外帶';
        return `
            <div class="cart-row">
                <div class="cart-info">
                    <div class="cart-name">${item.name}</div>
                    <div class="cart-meta">${item.subText}${showTemp ? ' · ' + item.temp : ''} &nbsp;·&nbsp; $${item.price}</div>
                </div>
                <div class="cart-controls">
                    ${showTemp ? `<button class="temp-btn" onclick="toggleTemp('${k}')">${item.temp}</button>` : ''}
                    <button class="qty-btn" onclick="changeQty('${k}',-1)">−</button>
                    <span class="qty-num">${item.qty}</span>
                    <button class="qty-btn" onclick="changeQty('${k}',1)">+</button>
                </div>
            </div>`;
    }).join('');
    
    calculateChange();
}

// ══════════════════════════════════════
// ADMIN MODAL
// ══════════════════════════════════════
function openAdminPanel()  { document.getElementById('adminOverlay').classList.add('open'); renderAdminTab(); }
function closeAdminPanel() { document.getElementById('adminOverlay').classList.remove('open'); }
function handleAdminOverlayClick(e) { if (e.target === document.getElementById('adminOverlay')) closeAdminPanel(); }
function switchAdminTab(tab) {
    currentAdminTab = tab;
    document.getElementById('tabStatus').classList.toggle('active', tab === 'status');
    document.getElementById('tabAdd').classList.toggle('active', tab === 'add');
    renderAdminTab();
}

function renderAdminTab() {
    const body = document.getElementById('adminBody');
    if (currentAdminTab === 'status') {
        const singles = coffeeData.filter(c => c.type === 'single');
        if (!singles.length) { body.innerHTML = '<div style="text-align:center;color:#bbb;padding:20px;font-size:0.85em;">尚無單品豆資料</div>'; return; }
        body.innerHTML = `
            <div class="batch-row">
                <button class="batch-btn" style="background:#4a3728;color:#fff;" onclick="batchUpdate(true)">✅ 全數上架</button>
                <button class="batch-btn" style="background:#bbb;color:#fff;" onclick="batchUpdate(false)">❌ 全數下架</button>
            </div>
            ${singles.map(item => `
                <div class="status-item">
                    <div><div class="si-name">${item.name}</div><div class="si-sub">${item.origin} · ${item.roastName}</div></div>
                    <label class="toggle">
                        <input type="checkbox" id="tog_${item.id}" ${item.available?'checked':''} onchange="toggleStatus(${item.id},this.checked)">
                        <span class="toggle-slider"></span>
                    </label>
                </div>`).join('')}`;
    } else {
        body.innerHTML = `
            <div class="form-note" style="margin-bottom:10px;">填寫後點「新增」，自動寫入試算表並設為上架。</div>
            <div class="success-msg" id="addSuccessMsg">✅ 已寫入試算表！</div>
            <div class="add-form">
                <div class="form-group full"><label class="form-label">豆子名稱 *</label><input class="form-input" id="f_name" placeholder="例：肯亞 AA" type="text"></div>
                <div class="form-grid-2">
                    <div class="form-group"><label class="form-label">產地</label><input class="form-input" id="f_origin" placeholder="肯亞" type="text"></div>
                    <div class="form-group"><label class="form-label">處理法</label><input class="form-input" id="f_process" placeholder="日曬" type="text"></div>
                    <div class="form-group"><label class="form-label">烘焙度</label>
                        <select class="form-select" id="f_roast"><option value="lr">淺焙</option><option value="mr">中焙</option><option value="dr">深焙</option></select>
                    </div>
                    <div class="form-group"><label class="form-label">風味描述</label><input class="form-input" id="f_flavor" placeholder="藍莓" type="text"></div>
                </div>
                <div class="form-grid-2" style="margin-top:2px;">
                    <div class="form-group"><label class="form-label">外帶 $</label><input class="form-input" id="f_take" type="number" placeholder="150" inputmode="numeric"></div>
                    <div class="form-group"><label class="form-label">內用 $</label><input class="form-input" id="f_stay" type="number" placeholder="160" inputmode="numeric"></div>
                    <div class="form-group"><label class="form-label">半磅 $</label><input class="form-input" id="f_pound" type="number" placeholder="350" inputmode="numeric"></div>
                    <div class="form-group"><label class="form-label">濾掛 $</label><input class="form-input" id="f_drip" type="number" placeholder="80" inputmode="numeric"></div>
                </div>
                <button class="submit-btn" onclick="submitNewBean()">＋ 新增單品豆</button>
            </div>`;
    }
}

async function callGAS(payload) {
    const res = await fetch(GAS_URL, { method:'POST', headers:{'Content-Type':'text/plain'}, body:JSON.stringify(payload) });
    return res.json();
}

async function toggleStatus(id, checked) {
    const item = coffeeData.find(c => c.id === id);
    if (!item) return;
    item.available = checked; render();
    const cb = document.getElementById('tog_' + id);
    if (cb) cb.disabled = true;
    try {
        const r = await callGAS({ action:'updateStatus', id, status:checked });
        if (!r.ok) throw new Error();
    } catch {
        alert('試算表同步失敗。');
        item.available = !checked; render();
    } finally {
        if (cb) cb.disabled = false;
    }
}

async function batchUpdate(status) {
    coffeeData.filter(c => c.type==='single').forEach(c => c.available = status);
    render(); renderAdminTab();
    try { await callGAS({ action:'batchUpdateStatus', status }); }
    catch { alert('批次同步失敗。'); }
}

async function submitNewBean() {
    const name = document.getElementById('f_name').value.trim();
    if (!name) { alert('請填寫豆子名稱'); return; }
    const rv = document.getElementById('f_roast').value;
    const bean = {
        name, origin:document.getElementById('f_origin').value.trim(),
        process:document.getElementById('f_process').value.trim(),
        roast:rv, roastName:{lr:'淺焙',mr:'中焙',dr:'深焙'}[rv],
        flavor:document.getElementById('f_flavor').value.trim(),
        take:parseInt(document.getElementById('f_take').value)||0,
        stay:parseInt(document.getElementById('f_stay').value)||0,
        pound:parseInt(document.getElementById('f_pound').value)||0,
        drip:parseInt(document.getElementById('f_drip').value)||0,
    };
    const btn = document.querySelector('.submit-btn');
    btn.textContent = '⏳ 寫入中…'; btn.disabled = true;
    try {
        const r = await callGAS({ action:'addBean', bean });
        coffeeData.push({ ...bean, id:r.newId, type:'single', available:true });
        render();
        const msg = document.getElementById('addSuccessMsg');
        if (msg) { msg.style.display='block'; setTimeout(()=>msg.style.display='none', 3000); }
        ['f_name','f_origin','f_process','f_flavor','f_take','f_stay','f_pound','f_drip'].forEach(id=>document.getElementById(id).value='');
        setTimeout(()=>switchAdminTab('status'), 1200);
    } catch { alert('寫入失敗。'); }
    finally { btn.textContent='＋ 新增單品豆'; btn.disabled=false; }
}

// ══════════════════════════════════════
// BOOT
// ══════════════════════════════════════
fetchMenuData();
updateCartUI();