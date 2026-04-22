/* =============================================
   InvenVision – Frontend Logic
   Calls Flask Python backend for predictions
   ============================================= */

'use strict';

const API = 'http://127.0.0.1:5000/api';

// ---- State ----
let chartInstance = null;
let inventory = JSON.parse(localStorage.getItem('invenvision_inventory') || '[]');
let history   = JSON.parse(localStorage.getItem('invenvision_history')   || '[]');

// ---- Tab Switching ----
function switchTab(name) {
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  document.getElementById('nav-' + name).classList.add('active');

  if (name === 'inventory') renderInventory();
  if (name === 'history')   renderHistory();
}

// ---- Quick Fill Presets ----
const PRESETS = {
  electronics: {
    name: 'Wireless Earbuds', stock: 200, reorder: 40, lead: 7,
    sales: '22,25,18,30,28,24,32,35,29,27,33,38,31,26,34,40,36,28,31,35'
  },
  grocery: {
    name: 'Organic Oat Milk', stock: 80, reorder: 20, lead: 3,
    sales: '45,52,48,60,55,50,65,70,58,53,62,75,66,54,60,72,68,56,63,71'
  },
  fashion: {
    name: 'Summer Linen Shirt', stock: 60, reorder: 15, lead: 14,
    sales: '8,6,10,12,7,9,15,14,11,8,13,18,16,10,12,20,17,9,14,19'
  },
  seasonal: {
    name: 'Winter Jacket', stock: 120, reorder: 25, lead: 21,
    sales: '5,4,6,8,10,15,22,30,28,25,32,40,38,28,20,15,10,8,5,4'
  }
};

function quickFill(type) {
  const p = PRESETS[type];
  document.getElementById('itemName').value    = p.name;
  document.getElementById('currentStock').value = p.stock;
  document.getElementById('reorderPoint').value = p.reorder;
  document.getElementById('leadTime').value     = p.lead;
  document.getElementById('salesData').value    = p.sales;
  showToast('✨ Sample data loaded!', 'success');
}

// ---- Run Prediction (calls Flask API) ----
async function runPrediction() {
  const itemName    = document.getElementById('itemName').value.trim();
  const currentStock = parseFloat(document.getElementById('currentStock').value);
  const reorderPoint = parseFloat(document.getElementById('reorderPoint').value);
  const leadTime    = parseFloat(document.getElementById('leadTime').value) || 7;
  const model       = document.getElementById('forecastModel').value;
  const rawSales    = document.getElementById('salesData').value;

  // Validation
  if (!itemName) return showToast('⚠️ Please enter an item name', 'error');
  const salesArr = rawSales.split(',').map(s => parseFloat(s.trim())).filter(n => !isNaN(n));
  if (salesArr.length < 5) return showToast('⚠️ Enter at least 5 days of sales data', 'error');

  // Show loading
  const btn = document.getElementById('predictBtn');
  btn.innerHTML = '<div class="spinner"></div> Forecasting...';
  btn.classList.add('loading');

  try {
    const res = await fetch(`${API}/predict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        item_name:     itemName,
        sales_data:    salesArr,
        current_stock: currentStock || 0,
        reorder_point: reorderPoint || 0,
        lead_time:     leadTime,
        model:         model
      })
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Server error');
    }

    const data = await res.json();
    displayResults(data, itemName, salesArr, currentStock, reorderPoint);

    // Save to history
    history.unshift({
      id: Date.now(),
      item: itemName,
      model: model,
      date: new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
      timestamp: Date.now(),
      next_day: data.next_day,
      next_week: data.next_week,
      next_month: data.next_month,
      status: data.reorder_status,
      sales_count: salesArr.length
    });
    localStorage.setItem('invenvision_history', JSON.stringify(history.slice(0, 50)));

  } catch (err) {
    showToast('❌ ' + err.message, 'error');
    console.error(err);
  } finally {
    btn.innerHTML = '<span class="btn-icon">✨</span> Generate Forecast';
    btn.classList.remove('loading');
  }
}

// ---- Display Results ----
function displayResults(data, itemName, salesArr, currentStock, reorderPoint) {
  document.getElementById('emptyState').style.display  = 'none';
  document.getElementById('resultsArea').classList.remove('hidden');

  // Forecast cards
  setCard('day',   data.next_day,   salesArr);
  setCard('week',  data.next_week,  salesArr);
  setCard('month', data.next_month, salesArr);

  // Reorder alert
  renderAlert(data.reorder_status, data.reorder_message, data.stock_days_left);

  // Chart
  renderChart(salesArr, data.forecast_series, itemName);

  // Stats
  document.getElementById('stat-avg').textContent  = data.avg_daily.toFixed(1);
  document.getElementById('stat-peak').textContent = data.peak_day;
  document.getElementById('stat-vol').textContent  = data.volatility + '%';
  document.getElementById('stat-days').textContent = data.stock_days_left >= 999 ? '∞' : data.stock_days_left;
}

function setCard(period, value, salesArr) {
  document.getElementById('val-' + period).textContent = Math.round(value);
  const avg = salesArr.reduce((a, b) => a + b, 0) / salesArr.length;
  const diff = period === 'day' ? value - salesArr[salesArr.length - 1] : value - (avg * (period === 'week' ? 7 : 30));
  const pct  = Math.abs(diff / (period === 'day' ? salesArr[salesArr.length - 1] || 1 : avg * (period === 'week' ? 7 : 30) || 1) * 100).toFixed(1);
  const el   = document.getElementById('trend-' + period);
  if (Math.abs(diff) < 0.5) {
    el.textContent = '→ Stable'; el.className = 'card-trend trend-flat';
  } else if (diff > 0) {
    el.textContent = `↑ +${pct}%`; el.className = 'card-trend trend-up';
  } else {
    el.textContent = `↓ -${pct}%`; el.className = 'card-trend trend-down';
  }
}

function renderAlert(status, message, daysLeft) {
  const el = document.getElementById('reorderAlert');
  const map = {
    danger:  { cls: 'alert-danger',  icon: '🚨' },
    warning: { cls: 'alert-warning', icon: '⚠️' },
    ok:      { cls: 'alert-success', icon: '✅' }
  };
  const m = map[status] || map['ok'];
  el.className = `reorder-alert ${m.cls}`;
  el.innerHTML = `
    <span class="alert-icon">${m.icon}</span>
    <div>
      <strong>${message}</strong>
      ${daysLeft < 999 ? `<div style="font-size:0.8rem;opacity:0.8;margin-top:2px">Estimated ${daysLeft} day${daysLeft !== 1 ? 's' : ''} of stock remaining at current rate.</div>` : ''}
    </div>`;
}

// ---- Chart ----
function renderChart(historical, forecastSeries, label) {
  const ctx = document.getElementById('forecastChart').getContext('2d');
  if (chartInstance) chartInstance.destroy();

  const histLabels = historical.map((_, i) => `Day ${i + 1}`);
  const fcastLabels = forecastSeries.map((_, i) => `+${i + 1}d`);
  const allLabels = [...histLabels, ...fcastLabels];

  const histData   = [...historical, ...new Array(forecastSeries.length).fill(null)];
  const fcastData  = [...new Array(historical.length - 1).fill(null), historical[historical.length - 1], ...forecastSeries];

  chartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: allLabels,
      datasets: [
        {
          label: 'Historical Sales',
          data: histData,
          borderColor: 'rgba(139,92,246,0.9)',
          backgroundColor: 'rgba(139,92,246,0.08)',
          borderWidth: 2.5,
          pointRadius: 3,
          pointBackgroundColor: 'rgba(167,139,250,0.9)',
          tension: 0.4,
          fill: true
        },
        {
          label: 'Forecast',
          data: fcastData,
          borderColor: 'rgba(6,182,212,0.9)',
          backgroundColor: 'rgba(6,182,212,0.06)',
          borderWidth: 2.5,
          borderDash: [6, 4],
          pointRadius: 3,
          pointBackgroundColor: 'rgba(6,182,212,0.9)',
          tension: 0.4,
          fill: true
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          labels: {
            color: '#9ca3af',
            font: { family: 'Outfit', size: 12 },
            usePointStyle: true,
            pointStyleWidth: 10
          }
        },
        tooltip: {
          backgroundColor: 'rgba(14,14,31,0.95)',
          borderColor: 'rgba(255,255,255,0.1)',
          borderWidth: 1,
          titleColor: '#f1f0ff',
          bodyColor: '#9ca3af',
          padding: 12,
          cornerRadius: 10
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(255,255,255,0.04)' },
          ticks: { color: '#6b7280', font: { family: 'Outfit', size: 11 }, maxTicksLimit: 12 }
        },
        y: {
          grid: { color: 'rgba(255,255,255,0.04)' },
          ticks: { color: '#6b7280', font: { family: 'Outfit', size: 11 } },
          title: { display: true, text: 'Units', color: '#4b5563', font: { family: 'Outfit' } }
        }
      }
    }
  });
}

// ---- Save to Inventory ----
function saveToInventory() {
  const itemName    = document.getElementById('itemName').value.trim();
  const currentStock = parseFloat(document.getElementById('currentStock').value) || 0;
  const reorderPoint = parseFloat(document.getElementById('reorderPoint').value) || 0;
  const nextWeek    = parseFloat(document.getElementById('val-week').textContent) || 0;
  const nextMonth   = parseFloat(document.getElementById('val-month').textContent) || 0;
  const daysLeft    = parseFloat(document.getElementById('stat-days').textContent) || 0;
  const alertEl     = document.getElementById('reorderAlert');

  if (!itemName) return showToast('⚠️ No prediction to save', 'error');
  if (inventory.find(i => i.item === itemName)) {
    // Update existing
    const idx = inventory.findIndex(i => i.item === itemName);
    inventory[idx] = { ...inventory[idx], currentStock, reorderPoint, nextWeek, nextMonth, daysLeft, date: new Date().toLocaleDateString(), status: getAlertStatus(alertEl) };
  } else {
    inventory.push({ id: Date.now(), item: itemName, currentStock, reorderPoint, nextWeek, nextMonth, daysLeft, date: new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }), status: getAlertStatus(alertEl) });
  }
  localStorage.setItem('invenvision_inventory', JSON.stringify(inventory));
  showToast('💾 Saved to Inventory!', 'success');
}

function getAlertStatus(el) {
  if (el.classList.contains('alert-danger'))  return 'danger';
  if (el.classList.contains('alert-warning')) return 'warning';
  return 'ok';
}

// ---- Render Inventory Tab ----
function renderInventory() {
  const grid  = document.getElementById('inventoryGrid');
  const empty = document.getElementById('inventoryEmpty');
  inventory = JSON.parse(localStorage.getItem('invenvision_inventory') || '[]');

  if (inventory.length === 0) {
    empty.style.display = 'block';
    grid.classList.add('hidden');
    return;
  }
  empty.style.display = 'none';
  grid.classList.remove('hidden');

  grid.innerHTML = inventory.map(item => {
    const pct = item.currentStock && item.nextMonth
      ? Math.min(100, Math.round((item.currentStock / (item.nextMonth || 1)) * 100))
      : 50;
    const statusMap = { ok: ['status-ok','✅ Healthy','progress-ok'], warning: ['status-warn','⚠️ Low','progress-warn'], danger: ['status-danger','🚨 Critical','progress-danger'] };
    const [sCls, sLabel, pCls] = statusMap[item.status] || statusMap['ok'];
    return `
      <div class="inv-card">
        <div class="inv-card-top">
          <div>
            <div class="inv-name">${escHtml(item.item)}</div>
            <div class="inv-date">Updated ${item.date}</div>
          </div>
          <span class="inv-status ${sCls}">${sLabel}</span>
        </div>
        <div class="inv-stats">
          <div class="inv-stat-item">
            <div class="inv-stat-label">Current Stock</div>
            <div class="inv-stat-val">${item.currentStock}</div>
          </div>
          <div class="inv-stat-item">
            <div class="inv-stat-label">Reorder Point</div>
            <div class="inv-stat-val">${item.reorderPoint}</div>
          </div>
          <div class="inv-stat-item">
            <div class="inv-stat-label">7-Day Forecast</div>
            <div class="inv-stat-val">${Math.round(item.nextWeek)} u</div>
          </div>
          <div class="inv-stat-item">
            <div class="inv-stat-label">Days Remaining</div>
            <div class="inv-stat-val">${item.daysLeft >= 999 ? '∞' : item.daysLeft}d</div>
          </div>
        </div>
        <div class="inv-progress">
          <div class="inv-progress-bar ${pCls}" style="width:${pct}%"></div>
        </div>
        <div class="inv-card-footer">
          <span style="font-size:0.76rem;color:var(--text-3)">30d demand: <strong style="color:var(--text-1)">${Math.round(item.nextMonth)} units</strong></span>
          <button class="inv-delete" onclick="deleteItem(${item.id})">🗑 Remove</button>
        </div>
      </div>`;
  }).join('');
}

function deleteItem(id) {
  inventory = inventory.filter(i => i.id !== id);
  localStorage.setItem('invenvision_inventory', JSON.stringify(inventory));
  renderInventory();
  showToast('🗑 Item removed', 'success');
}

// ---- Render History Tab ----
function renderHistory() {
  const list  = document.getElementById('historyList');
  const empty = document.getElementById('historyEmpty');
  history = JSON.parse(localStorage.getItem('invenvision_history') || '[]');

  if (history.length === 0) {
    empty.style.display = 'block';
    list.classList.add('hidden');
    return;
  }
  empty.style.display = 'none';
  list.classList.remove('hidden');

  const modelLabels = { sma: 'SMA', ema: 'EMA', holt: 'Holt', linear: 'Linear Reg.' };
  list.innerHTML = history.map(h => {
    const statusIcon = { ok: '✅', warning: '⚠️', danger: '🚨' }[h.status] || '📊';
    return `
      <div class="history-item">
        <div class="history-item-icon">${statusIcon}</div>
        <div class="history-meta">
          <div class="history-name">${escHtml(h.item)}</div>
          <div class="history-sub">${h.date} · ${modelLabels[h.model] || h.model} · ${h.sales_count} data points</div>
        </div>
        <div class="history-stats">
          <div>
            <div class="hist-stat-val">${Math.round(h.next_day)}</div>
            <div class="hist-stat-label">Tomorrow</div>
          </div>
          <div>
            <div class="hist-stat-val">${Math.round(h.next_week)}</div>
            <div class="hist-stat-label">7 Days</div>
          </div>
          <div>
            <div class="hist-stat-val">${Math.round(h.next_month)}</div>
            <div class="hist-stat-label">30 Days</div>
          </div>
        </div>
      </div>`;
  }).join('');
}

// ---- Helpers ----
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

let toastTimer = null;
function showToast(msg, type = 'success') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast toast-${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.classList.add('hidden'); }, 3200);
}
