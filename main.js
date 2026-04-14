 const expandedStats = new Set();
        let coffeeList = []; // 預留存放豆單的空間
        // 使用 fetch 讀取外部 JSON
        async function loadCoffeeData() {
            try {
                const response = await fetch('coffee_list.json');
                if (!response.ok) throw new Error('無法取得豆單資料');

                coffeeList = await response.json();

                // 確保資料抓到後，才執行畫面的渲染
                renderCoffeeMenu();
            } catch (error) {
                console.error('讀取失敗:', error);
                // 這裡可以放一個備用的錯誤顯示
            }
        }

        // 修改原本的初始化位置
        window.onload = function () {
            loadCoffeeData(); // 改成呼叫這個讀取函式
        };


        // 1. 先宣告空的變數
        let customers = [];

        // 2. 建立讀取 JSON 的非同步函式
        async function initData() {
            try {
                const response = await fetch('customers.json'); // 讀取外部 JSON
                if (!response.ok) throw new Error('讀取 JSON 失敗');

                customers = await response.json(); // 將資料存入變數

                // 3. 資料確認讀取後，再執行初始化渲染
                initApp();
            } catch (error) {
                console.error('初始化失敗:', error);
                alert('無法載入攤販資料，請檢查網路或檔案路徑');
            }
        }

        // 4. 將原本放在最底部的初始化程式碼封裝起來
        function initApp() {
            document.getElementById('daySelect').value = new Date().getDay();
            renderOrders();
        }

        // 5. 執行！
        initData();

        const typeNames = {
            hot_am: '☕ 熱美式', ice_am: '🧊 冰美式', large_hot_am: "☕️ 大熱美",
            hot_latte: '🔥 熱拿鐵', hot_latte_sugar: '🍬 熱拿鐵 (加糖)',
            ice_latte_sugar: '🍭 冰拿鐵 (加糖)', ice_latte: '❄️ 冰拿鐵',
            large_hot_latte: '🥤 大熱拿', hand_drip: '💧 手沖', potential_item: '❓ 待確認'
        };

        function getTodayDateString() {
            const today = new Date();
            return today.getFullYear() + (today.getMonth() + 1).toString().padStart(2, '0') + today.getDate().toString().padStart(2, '0');
        }

        function sanitizeKeyPart(s) { return s ? s.replace(/ /g, '_').replace(/[^a-zA-Z0-9\u4e00-\u9fa5_]/g, '') : ''; }
        function getStorageKey(name, item, loc, index = 0) { return `${getTodayDateString()}_${sanitizeKeyPart(name)}_${sanitizeKeyPart(item)}_${sanitizeKeyPart(loc)}_${index}`; }
        function getAbsenceKey(groupId) { return `${getTodayDateString()}_absent_${groupId}`; }
        function escapeJsString(s) { return s ? s.replace(/\\/g, '\\\\').replace(/'/g, '\\\'') : ''; }

        window.toggleDone = function (name, item, loc, index, groupId) {
            if (isGroupAbsent(groupId)) { alert("該組已標記為「缺席」！"); return; }
            const key = getStorageKey(name, item, loc, index);
            localStorage.getItem(key) === 'true' ? localStorage.removeItem(key) : localStorage.setItem(key, 'true');
            renderOrders();
        }

        window.toggleAbsence = function (groupId) {
            const key = getAbsenceKey(groupId);
            if (localStorage.getItem(key) === 'true') {
                localStorage.removeItem(key);
            } else {
                localStorage.setItem(key, 'true');
                const day = parseInt(document.getElementById('daySelect').value);
                customers.filter(c => c.groupId === groupId && (c.days.length === 0 || c.days.includes(day))).forEach(c => {
                    for (let i = 0; i < (c.count || 1); i++) localStorage.removeItem(getStorageKey(c.name, c.item, c.loc, i));
                });
            }
            renderOrders();
        }

        function isItemDone(name, item, loc, index = 0) { return localStorage.getItem(getStorageKey(name, item, loc, index)) === 'true'; }
        function isGroupAbsent(groupId) { return groupId ? localStorage.getItem(getAbsenceKey(groupId)) === 'true' : false; }

        window.clearAllDone = function () {
            if (!confirm("確定要重置今日所有狀態嗎？")) return;
            const day = parseInt(document.getElementById('daySelect').value);
            const todaysOrders = customers.filter(c => c.days.length === 0 || c.days.includes(day));
            todaysOrders.forEach(c => {
                for (let i = 0; i < (c.count || 1); i++) localStorage.removeItem(getStorageKey(c.name, c.item, c.loc, i));
                if (c.groupId) localStorage.removeItem(getAbsenceKey(c.groupId));
            });
            expandedStats.clear();
            renderOrders();
        }

        function renderMemos(todaysOrders) {
            const memoList = document.getElementById('dynamicMemoList');
            const staticList = document.getElementById('staticMemoList');
            const filterMemos = todaysOrders.filter(c => c.tag && !c.tag.includes('寄杯')).filter(c => {
                for (let i = 0; i < (c.count || 1); i++) if (!isItemDone(c.name, c.item, c.loc, i)) return true;
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

        // 輔助函式：產生各區塊的 HTML
        function makeHtml(stats, prefix) {
            let html = '', totalN = 0, totalD = 0;
            let hasData = false;
            for (const k in typeNames) {
                if (stats[k].total > 0) {
                    hasData = true;
                    let s = stats[k];
                    let activeTotal = s.orders.filter(o => !o.isAbsent).length;
                    let rem = activeTotal - s.done;
                    let per = activeTotal > 0 ? Math.round((s.done / activeTotal) * 100) : 100;
                    let id = `detail_${prefix}_${k}`;

                    html += `
                    <div class="stat-row" onclick="toggleStatDetail('${id}')">
                        <span>${typeNames[k]}</span>
                        <div class="progress-counts">
                            <span class="count-total">${activeTotal}</span>
                            <span class="count-remaining">剩: <b style="${rem === 0 ? 'color:var(--color-success)' : ''}">${rem}</b></span>
                        </div>
                    </div>
                    <div class="stat-row-progress">
                        <div class="progress-fill" style="width:${per}%; background-color:${rem === 0 ? 'var(--color-success)' : 'var(--color-accent)'};"></div>
                    </div>
                    <div id="${id}" class="stat-detail-list" style="display:block;">
                        ${s.orders.map(o => {
                        let safe = [escapeJsString(o.name), escapeJsString(o.item), escapeJsString(o.loc), o.index, o.groupId];
                        return `
                            <div class="stat-detail-item ${o.isAbsent ? 'absent' : (o.isDone ? 'done' : '')}">
                                <span class="absence-toggle" onclick="event.stopPropagation(); toggleAbsence('${o.groupId}')">${o.isAbsent ? '恢復' : '缺席'}</span>
                                <div class="customer-info" onclick="toggleDone('${safe[0]}','${safe[1]}','${safe[2]}',${safe[3]},'${safe[4]}')">
                                    <span class="customer-name">${o.name}${o.count > 1 ? ` (${o.index + 1}/${o.count})` : ''} ${o.tag || o.note ? `<span class="customer-tag">${o.tag || o.note}</span>` : ''}</span>
                                    <span class="customer-loc">${o.item}</span>
                                </div>
                                <input type="checkbox" ${o.isDone || o.isAbsent ? 'checked' : ''} onclick="${o.isAbsent ? 'event.preventDefault()' : `toggleDone('${safe[0]}','${safe[1]}','${safe[2]}',${safe[3]},'${safe[4]}')`}">
                            </div>`;
                    }).join('')}
                    </div>`;
                    totalN += activeTotal;
                    totalD += s.done;
                }
            }
            if (!hasData) return '<div style="text-align:center;color:#999;padding:10px;">無訂單</div>';
            let rem = totalN - totalD;
            let per = totalN > 0 ? Math.round((totalD / totalN) * 100) : 100;
            html += `
            <div class="stat-row total">
                <span>🏆 總計 (扣除缺席)</span>
                <div class="progress-counts">
                    <span class="count-total">${totalN}</span>
                    <span class="count-remaining">剩: <b style="${rem === 0 ? 'color:var(--color-success)' : ''}">${rem}</b></span>
                </div>
            </div>
            <div class="stat-row-progress">
                <div class="progress-fill" style="width:${per}%; background-color:${rem === 0 ? 'var(--color-success)' : 'var(--color-total-progress)'};"></div>
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
                for (const k in typeNames) obj[k] = { total: 0, done: 0, orders: [] };
                return obj;
            };

            let sNeigh = createStatsObj(), sOther = createStatsObj(), sAsk = createStatsObj();
            const todaysOrders = customers.filter(c => c.days.length === 0 || c.days.includes(day));
            renderMemos(todaysOrders);

            todaysOrders.forEach(c => {
                let target;
                if (c.loc === "當日問") target = sAsk;
                else if (c.loc.includes("鄰居")) target = sNeigh;
                else target = sOther;

                let isAbsent = isGroupAbsent(c.groupId);
                if (typeNames[c.type]) {
                    target[c.type].total += (c.count || 1);
                    for (let i = 0; i < (c.count || 1); i++) {
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

        window.toggleStatDetail = function (id) {
            const el = document.getElementById(id);
            if (el) {
                if (el.style.display === 'block') { el.style.display = 'none'; expandedStats.delete(id); }
                else { el.style.display = 'block'; expandedStats.add(id); }
            }
        }

        // 初始化頁面
        document.getElementById('daySelect').value = new Date().getDay();
        renderOrders();