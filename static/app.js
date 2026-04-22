'use strict';

// ── State ────────────────────────────────────
const API        = '';  // Flask serves on same origin
let chartInstance  = null;
let compareChart1  = null;
let compareChart2  = null;
let lastPrediction = null;
let _dbAvailable   = false;  // set from /api/health on load

// Check DB status on load
async function checkDBStatus() {
  try {
    const r = await fetch('/api/health', { credentials: 'same-origin' });
    const d = await r.json();
    _dbAvailable = d.db === true;
    const badge = document.getElementById('dbBadge');
    if (badge) {
      badge.textContent = _dbAvailable ? '🗄️ MySQL' : '💾 Local';
      badge.title = _dbAvailable ? 'Data saved to MySQL database' : 'MySQL not connected — using browser storage';
      badge.style.background = _dbAvailable ? 'rgba(16,185,129,0.15)' : 'rgba(245,158,11,0.15)';
      badge.style.borderColor = _dbAvailable ? 'rgba(16,185,129,0.3)' : 'rgba(245,158,11,0.3)';
      badge.style.color = _dbAvailable ? '#6ee7b7' : '#fcd34d';
    }
  } catch(e) { _dbAvailable = false; }
}

// ── Init ─────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initNotifications();
  setupDropzone();
  checkDBStatus();
  loadCommandCenter();
});

// ══════════════════════════════════════════════
//  Smart Command Center (Hackathon killer feature)
// ══════════════════════════════════════════════
async function loadCommandCenter() {
  const list = document.getElementById('cmdSuggestions');
  if (list) list.innerHTML = '<div class="cmd-suggest-loading">Analyzing inventory...</div>';
  try {
    const res = await fetch('/api/suggestions', { credentials: 'same-origin' });
    if (!res.ok) { renderSuggestions(null); return; }
    const d = await res.json();
    // Update stats
    const s = d.stats || {};
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v ?? '—'; };
    set('cmdTotal',   s.total   ?? '—');
    set('cmdAlerts',  s.alerts  ?? '—');
    set('cmdHealthy', s.healthy ?? '—');
    set('cmdExpiring',s.expiring ?? '—');
    renderSuggestions(d.suggestions || []);
  } catch(e) {
    renderSuggestions([]);
  }
}

function renderSuggestions(items) {
  const list = document.getElementById('cmdSuggestions');
  if (!list) return;
  if (!items || items.length === 0) {
    list.innerHTML = '<div class="cmd-suggest-item info"><span class="cmd-suggest-icon">💡</span><span class="cmd-suggest-text">Save items to Inventory to see AI-powered suggestions here.</span></div>';
    return;
  }
  list.innerHTML = items.slice(0, 5).map(s =>
    `<div class="cmd-suggest-item ${s.type}">
      <span class="cmd-suggest-icon">${s.icon}</span>
      <span class="cmd-suggest-text">${esc(s.text)}</span>
    </div>`
  ).join('');
}



// ══════════════════════════════════════════════
//  Feature E: Dark / Light Mode
// ══════════════════════════════════════════════
function initTheme() {
  const saved = localStorage.getItem('theme') || 'dark';
  setTheme(saved);
}
function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  setTheme(current === 'dark' ? 'light' : 'dark');
}
function setTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  const btn = document.getElementById('themeBtn');
  if (btn) btn.textContent = t === 'dark' ? '🌙' : '☀️';
  localStorage.setItem('theme', t);
  // Re-render chart with new colors if exists
  if (chartInstance) chartInstance.update();
}

// ══════════════════════════════════════════════
//  Feature C: Browser Notifications
// ══════════════════════════════════════════════
let notificationsEnabled = false;
function initNotifications() {
  if ('Notification' in window && Notification.permission === 'granted') {
    notificationsEnabled = true;
    updateNotifBtn();
  }
}
function toggleNotifications() {
  if (!('Notification' in window)) {
    showToast('⚠️ Browser notifications not supported', 'error'); return;
  }
  if (Notification.permission === 'granted') {
    notificationsEnabled = !notificationsEnabled;
    showToast(notificationsEnabled ? '🔔 Notifications enabled' : '🔕 Notifications disabled', 'success');
  } else {
    Notification.requestPermission().then(p => {
      notificationsEnabled = (p === 'granted');
      showToast(p === 'granted' ? '🔔 Notifications enabled!' : '🔕 Permission denied', p === 'granted' ? 'success' : 'error');
      updateNotifBtn();
    });
  }
  updateNotifBtn();
}
function updateNotifBtn() {
  const btn = document.getElementById('notifBtn');
  if (btn) btn.style.opacity = notificationsEnabled ? '1' : '0.5';
}
function sendNotification(title, body) {
  if (notificationsEnabled && Notification.permission === 'granted') {
    new Notification(title, { body, icon: '/favicon.ico' });
  }
}

// ══════════════════════════════════════════════
//  Feature D: CSV Upload / Drag-Drop
// ══════════════════════════════════════════════
function setupDropzone() {
  const zone = document.getElementById('uploadZone');
  if (!zone) return;
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) parseCSVFile(file);
  });
}
function handleFileUpload(input) {
  if (input.files[0]) parseCSVFile(input.files[0]);
}
function parseCSVFile(file) {
  const reader = new FileReader();
  reader.onload = e => {
    const lines = e.target.result.split('\n').map(l => l.trim()).filter(Boolean);
    const nums = [];
    for (const line of lines) {
      const parts = line.split(/[,;\t]/);
      const last = parts[parts.length - 1].trim();
      const n = parseFloat(last);
      if (!isNaN(n) && n >= 0) nums.push(n);
    }
    if (nums.length > 0) {
      document.getElementById('salesData').value = nums.join(', ');
      showToast(`📂 Loaded ${nums.length} data points from ${file.name}`, 'success');
    } else {
      showToast('⚠️ Could not parse numbers from file', 'error');
    }
  };
  reader.readAsText(file);
}

// ══════════════════════════════════════════════
//  Tab Switching
// ══════════════════════════════════════════════
function switchTab(name) {
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.mob-btn').forEach(b => b.classList.remove('active'));

  const content = document.getElementById('tab-' + name);
  const navBtn  = document.getElementById('nav-' + name);
  const mobBtn  = document.getElementById('mob-' + name);
  if (content) content.classList.add('active');
  if (navBtn)  navBtn.classList.add('active');
  if (mobBtn)  mobBtn.classList.add('active');

  if (name === 'inventory') renderInventory();
  if (name === 'history')   renderHistory();
  if (name === 'compare')   renderCompare();   // Feature B
}

// ══════════════════════════════════════════════
//  Quick Fill Presets
// ══════════════════════════════════════════════
const PRESETS = {
  electronics: { name:'Wireless Earbuds',   stock:200, reorder:40, lead:7,
    sales:'22,25,18,30,28,24,32,35,29,27,33,38,31,26,34,40,36,28,31,35' },
  grocery:     { name:'Organic Oat Milk',    stock:80,  reorder:20, lead:3,
    sales:'45,52,48,60,55,50,65,70,58,53,62,75,66,54,60,72,68,56,63,71' },
  fashion:     { name:'Summer Linen Shirt',  stock:60,  reorder:15, lead:14,
    sales:'8,6,10,12,7,9,15,14,11,8,13,18,16,10,12,20,17,9,14,19' },
  seasonal:    { name:'Winter Jacket',       stock:120, reorder:25, lead:21,
    sales:'5,4,6,8,10,15,22,30,28,25,32,40,38,28,20,15,10,8,5,4' },
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

// ══════════════════════════════════════════════
//  Run Prediction (calls Flask API)
// ══════════════════════════════════════════════
async function runPrediction() {
  const itemName    = document.getElementById('itemName').value.trim();
  const currentStock = parseFloat(document.getElementById('currentStock').value);
  const reorderPoint = parseFloat(document.getElementById('reorderPoint').value);
  const leadTime    = parseFloat(document.getElementById('leadTime').value) || 7;
  const model       = document.getElementById('forecastModel').value;
  const rawSales    = document.getElementById('salesData').value;

  if (!itemName) return showToast('⚠️ Please enter an item name', 'error');
  const salesArr = rawSales.split(',').map(s => parseFloat(s.trim())).filter(n => !isNaN(n));
  if (salesArr.length < 5) return showToast('⚠️ Enter at least 5 days of sales data', 'error');

  // Show skeleton (Feature G)
  showSkeleton();
  const btn = document.getElementById('predictBtn');
  btn.innerHTML = '<div class="spinner"></div> Forecasting...';
  btn.classList.add('loading');

  try {
    const res = await fetch(`${API}/api/predict`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        item_name: itemName, sales_data: salesArr,
        current_stock: currentStock || 0, reorder_point: reorderPoint || 0,
        lead_time: leadTime, model
      })
    });
    if (!res.ok) {
      if (res.status === 401) { window.location.href = '/login'; return; }
      const err = await res.json();
      throw new Error(err.error || 'Server error');
    }
    const data = await res.json();
    lastPrediction = { data, itemName, salesArr, currentStock: currentStock||0, reorderPoint: reorderPoint||0 };
    hideSkeleton();
    displayResults(data, itemName, salesArr);

    // Feature C: send notification if stock is low
    if (data.reorder_status === 'danger') {
      sendNotification('InvenVision Alert', `${itemName}: ${data.reorder_message}`);
    } else if (data.reorder_status === 'warning') {
      sendNotification('InvenVision Warning', `${itemName}: Stock getting low.`);
    }

    // Save to history
    history.unshift({
      id: Date.now(), item: itemName, model,
      auto_selected: data.auto_selected,
      date: new Date().toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' }),
      timestamp: Date.now(),
      next_day: data.next_day, next_week: data.next_week, next_month: data.next_month,
      status: data.reorder_status, sales_count: salesArr.length,
    });
    localStorage.setItem('inv_v2_history', JSON.stringify(history.slice(0, 50)));

  } catch (err) {
    hideSkeleton();
    showToast('❌ ' + err.message, 'error');
  } finally {
    btn.innerHTML = '<span class="btn-icon">✨</span> Generate Forecast';
    btn.classList.remove('loading');
  }
}

// ── Skeleton helpers (Feature G) ──────────────
function showSkeleton() {
  document.getElementById('emptyState').style.display = 'none';
  document.getElementById('resultsArea').classList.add('hidden');
  document.getElementById('skeletonLoader').classList.remove('hidden');
}
function hideSkeleton() {
  document.getElementById('skeletonLoader').classList.add('hidden');
}

// ══════════════════════════════════════════════
//  Display Results
// ══════════════════════════════════════════════
function displayResults(data, itemName, salesArr) {
  document.getElementById('emptyState').style.display = 'none';
  document.getElementById('resultsArea').classList.remove('hidden');

  // Feature J: Auto model badge
  const badge = document.getElementById('autoModelBadge');
  if (data.auto_selected) {
    document.getElementById('autoModelText').textContent =
      `Auto-selected: ${data.auto_model_name} (lowest error on your data)`;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }

  // Cards with animated counters (Feature G)
  animateCounter('val-day',   data.next_day);
  animateCounter('val-week',  data.next_week);
  animateCounter('val-month', data.next_month);

  // Feature I: confidence ranges
  const std = data.std || 0;
  setConfidence('conf-day',   data.next_day,   std * 1.5,     1);
  setConfidence('conf-week',  data.next_week,  std * 1.5 * 7, 7);
  setConfidence('conf-month', data.next_month, std * 1.5 * 30, 30);

  // Trend indicators
  setTrend('trend-day',   data.next_day,   salesArr[salesArr.length - 1]);
  setTrend('trend-week',  data.next_week,  (data.avg_daily * 7));
  setTrend('trend-month', data.next_month, (data.avg_daily * 30));

  // Reorder alert
  renderAlert(data.reorder_status, data.reorder_message, data.stock_days_left);

  // Feature H: Seasonality
  const seasCard = document.getElementById('seasonalityCard');
  if (data.seasonality) {
    document.getElementById('seasonalityText').textContent = data.seasonality;
    seasCard.classList.remove('hidden');
  } else {
    seasCard.classList.add('hidden');
  }

  // Chart
  renderChart(salesArr, data.forecast_series, data.forecast_upper, data.forecast_lower, itemName);

  // Stats
  document.getElementById('stat-avg').textContent   = data.avg_daily.toFixed(1);
  document.getElementById('stat-peak').textContent  = data.peak_day;
  document.getElementById('stat-vol').textContent   = data.volatility + '%';
  document.getElementById('stat-days').textContent  = data.stock_days_left >= 999 ? '∞' : data.stock_days_left;
}

// Feature G: animated number counter
function animateCounter(elId, target) {
  const el = document.getElementById(elId);
  const rounded = Math.round(target);
  const duration = 800;
  const start = performance.now();
  const startVal = 0;
  function step(now) {
    const progress = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.round(startVal + (rounded - startVal) * eased);
    if (progress < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// Feature I: confidence range display
function setConfidence(elId, val, band, days) {
  const lo = Math.max(0, Math.round(val - band));
  const hi = Math.round(val + band);
  document.getElementById(elId).textContent = `Range: ${lo}–${hi} u`;
}

function setTrend(elId, value, baseline) {
  const el  = document.getElementById(elId);
  const diff = value - baseline;
  const pct  = baseline > 0 ? Math.abs(diff / baseline * 100).toFixed(1) : 0;
  if (Math.abs(diff) < 0.5 || baseline === 0) {
    el.textContent = '→ Stable'; el.className = 'card-trend trend-flat';
  } else if (diff > 0) {
    el.textContent = `↑ +${pct}%`; el.className = 'card-trend trend-up';
  } else {
    el.textContent = `↓ -${pct}%`; el.className = 'card-trend trend-down';
  }
}

function renderAlert(status, message, daysLeft) {
  const el = document.getElementById('reorderAlert');
  const map = { danger:['alert-danger','🚨'], warning:['alert-warning','⚠️'], ok:['alert-success','✅'] };
  const [cls, icon] = map[status] || map['ok'];
  el.className = `reorder-alert ${cls}`;
  el.innerHTML = `<span class="alert-icon">${icon}</span>
    <div><strong>${message}</strong>
    ${daysLeft < 999 ? `<div style="font-size:0.78rem;opacity:0.8;margin-top:2px">Estimated ${daysLeft} day${daysLeft!==1?'s':''} of stock remaining.</div>` : ''}
    </div>`;
}

// ══════════════════════════════════════════════
//  Chart (with Feature I confidence band)
// ══════════════════════════════════════════════
function renderChart(historical, forecastSeries, upper, lower, label) {
  const ctx = document.getElementById('forecastChart').getContext('2d');
  if (chartInstance) chartInstance.destroy();

  const hLen  = historical.length;
  const fLen  = forecastSeries.length;
  const hLabels = historical.map((_, i) => `Day ${i+1}`);
  const fLabels = forecastSeries.map((_, i) => `+${i+1}d`);
  const labels  = [...hLabels, ...fLabels];

  const histData  = [...historical,    ...Array(fLen).fill(null)];
  const fcastData = [...Array(hLen-1).fill(null), historical[hLen-1], ...forecastSeries];
  const upperData = [...Array(hLen-1).fill(null), historical[hLen-1], ...(upper||[])];
  const lowerData = [...Array(hLen-1).fill(null), historical[hLen-1], ...(lower||[])];

  const isDark = document.documentElement.getAttribute('data-theme') !== 'light';

  chartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Historical Sales',
          data: histData,
          borderColor: 'rgba(139,92,246,0.9)',
          backgroundColor: 'rgba(139,92,246,0.07)',
          borderWidth: 2.5, pointRadius: 3,
          pointBackgroundColor: 'rgba(167,139,250,0.9)',
          tension: 0.4, fill: true,
        },
        {
          label: 'Forecast',
          data: fcastData,
          borderColor: 'rgba(6,182,212,0.9)',
          backgroundColor: 'rgba(6,182,212,0.05)',
          borderWidth: 2.5, borderDash: [6,4],
          pointRadius: 3, pointBackgroundColor: 'rgba(6,182,212,0.9)',
          tension: 0.4, fill: false,
        },
        {
          label: 'Upper Bound',
          data: upperData,
          borderColor: 'rgba(6,182,212,0.25)',
          backgroundColor: 'rgba(6,182,212,0.08)',
          borderWidth: 1, borderDash: [3,3],
          pointRadius: 0, tension: 0.4, fill: '+1',
        },
        {
          label: 'Lower Bound',
          data: lowerData,
          borderColor: 'rgba(6,182,212,0.25)',
          backgroundColor: 'rgba(6,182,212,0.08)',
          borderWidth: 1, borderDash: [3,3],
          pointRadius: 0, tension: 0.4, fill: false,
        },
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode:'index', intersect:false },
      plugins: {
        legend: { labels: { color: isDark ? '#9ca3af' : '#4b5563', font:{family:'Outfit',size:12}, usePointStyle:true, pointStyleWidth:10 } },
        tooltip: {
          backgroundColor: isDark ? 'rgba(14,14,31,0.97)' : 'rgba(255,255,255,0.97)',
          borderColor: 'rgba(139,92,246,0.3)', borderWidth:1,
          titleColor: isDark ? '#f1f0ff' : '#0f0a2e',
          bodyColor: isDark ? '#9ca3af' : '#4b5563',
          padding:12, cornerRadius:10,
          filter: item => item.dataset.label !== 'Lower Bound',
        }
      },
      scales: {
        x: { grid:{color:'rgba(127,127,127,0.06)'}, ticks:{color:isDark?'#6b7280':'#9ca3af',font:{family:'Outfit',size:11},maxTicksLimit:12} },
        y: { grid:{color:'rgba(127,127,127,0.06)'}, ticks:{color:isDark?'#6b7280':'#9ca3af',font:{family:'Outfit',size:11}},
             title:{display:true,text:'Units',color:isDark?'#4b5563':'#9ca3af',font:{family:'Outfit'}} }
      }
    }
  });
}

// ══════════════════════════════════════════════
//  Feature A: Export CSV
// ══════════════════════════════════════════════
function exportCSV() {
  if (!lastPrediction) return showToast('⚠️ Run a forecast first', 'error');
  const { data, itemName, salesArr } = lastPrediction;
  const rows = [
    ['InvenVision Forecast Export'],
    ['Item', itemName], ['Date', new Date().toLocaleDateString()],
    ['Model', data.auto_selected || data.model],
    [],
    ['Metric', 'Value'],
    ['Avg Daily Sales', data.avg_daily],
    ['Peak Day', data.peak_day],
    ['Volatility %', data.volatility],
    ['Stock Days Left', data.stock_days_left],
    ['Tomorrow Forecast', data.next_day],
    ['7-Day Forecast', data.next_week],
    ['30-Day Forecast', data.next_month],
    ['Reorder Status', data.reorder_status],
    [],
    ['Historical Sales (units/day)'],
    ...salesArr.map((v, i) => [`Day ${i+1}`, v]),
    [],
    ['14-Day Forecast Series'],
    ...data.forecast_series.map((v, i) => [`+${i+1}d`, v, `Upper: ${data.forecast_upper[i]}`, `Lower: ${data.forecast_lower[i]}`]),
  ];
  const csv = rows.map(r => r.join(',')).join('\n');
  download(`InvenVision_${itemName.replace(/\s+/g,'_')}.csv`, 'text/csv', csv);
  showToast('📥 CSV exported!', 'success');
}

// ══════════════════════════════════════════════
//  Feature A: Export PDF
// ══════════════════════════════════════════════
async function exportPDF() {
  if (!lastPrediction) return showToast('⚠️ Run a forecast first', 'error');
  showToast('📄 Generating PDF...', 'success');
  const { data, itemName } = lastPrediction;
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation:'portrait', unit:'mm', format:'a4' });

  // Header
  doc.setFillColor(109, 40, 217);
  doc.rect(0, 0, 210, 30, 'F');
  doc.setTextColor(255,255,255);
  doc.setFontSize(20); doc.setFont('helvetica','bold');
  doc.text('InvenVision', 14, 12);
  doc.setFontSize(10); doc.setFont('helvetica','normal');
  doc.text('Inventory Demand Forecast Report', 14, 20);
  doc.text(new Date().toLocaleDateString(), 160, 20);

  // Item info
  doc.setTextColor(30,30,30);
  doc.setFontSize(14); doc.setFont('helvetica','bold');
  doc.text(itemName, 14, 42);
  doc.setFontSize(9); doc.setFont('helvetica','normal');
  doc.setTextColor(100,100,100);
  doc.text(`Model: ${data.auto_model_name || data.model}  |  Status: ${data.reorder_status.toUpperCase()}`, 14, 50);

  // Key Metrics boxes
  const boxes = [
    { label:'Tomorrow',  val: Math.round(data.next_day)   + ' units' },
    { label:'7 Days',    val: Math.round(data.next_week)  + ' units' },
    { label:'30 Days',   val: Math.round(data.next_month) + ' units' },
    { label:'Avg Daily', val: data.avg_daily              + ' units' },
    { label:'Peak Day',  val: data.peak_day               + ' units' },
    { label:'Days Left', val: data.stock_days_left >= 999 ? 'Infinite' : data.stock_days_left + ' days' },
  ];
  const statusColors = { ok:[16,185,129], warning:[245,158,11], danger:[239,68,68] };
  const sc = statusColors[data.reorder_status] || statusColors.ok;
  let bx = 14, by = 58;
  boxes.forEach((b, i) => {
    if (i === 3) { bx = 14; by = 82; }
    doc.setFillColor(245,245,255); doc.roundedRect(bx, by, 58, 18, 2, 2, 'F');
    doc.setTextColor(100,100,100); doc.setFontSize(7);
    doc.text(b.label.toUpperCase(), bx+4, by+6);
    doc.setTextColor(30,30,30); doc.setFontSize(11); doc.setFont('helvetica','bold');
    doc.text(b.val, bx+4, by+14);
    doc.setFont('helvetica','normal');
    bx += 62;
  });

  // Reorder message
  by = 106;
  doc.setFillColor(...sc, 0.15);
  doc.setDrawColor(...sc);
  doc.roundedRect(14, by, 182, 12, 2, 2, 'FD');
  doc.setTextColor(30,30,30); doc.setFontSize(8);
  doc.text(data.reorder_message, 18, by+8);

  // Seasonality
  if (data.seasonality) {
    by += 18;
    doc.setTextColor(6,182,212);
    doc.setFontSize(8);
    doc.text('Seasonality: ' + data.seasonality, 14, by);
  }

  // Chart capture
  try {
    const chartPanel = document.getElementById('chartPanel');
    const canvas = await html2canvas(chartPanel, { scale:1.5, backgroundColor: '#0e0e1f' });
    const imgData = canvas.toDataURL('image/png');
    by += 10;
    doc.addImage(imgData, 'PNG', 14, by, 182, 70);
    by += 76;
  } catch(e) { by += 10; }

  // Forecast table
  doc.setFontSize(10); doc.setFont('helvetica','bold'); doc.setTextColor(30,30,30);
  doc.text('14-Day Forecast Series', 14, by+10);
  by += 14;
  const headers = ['Day', 'Forecast', 'Upper', 'Lower'];
  const colW = [20, 40, 40, 40];
  let cx = 14;
  doc.setFillColor(109,40,217); doc.rect(14, by, 182, 7, 'F');
  doc.setTextColor(255,255,255); doc.setFontSize(8);
  headers.forEach((h, i) => { doc.text(h, cx+2, by+5); cx += colW[i]; });
  doc.setTextColor(30,30,30);
  data.forecast_series.forEach((v, i) => {
    if (i >= 14) return;
    by += 7;
    if (by > 270) return;
    cx = 14;
    doc.setFillColor(i%2===0 ? 245 : 255, i%2===0 ? 245 : 255, i%2===0 ? 255 : 255);
    doc.rect(14, by, 182, 7, 'F');
    doc.setFontSize(7.5);
    ['+'+( i+1)+'d', Math.round(v), Math.round(data.forecast_upper[i]||v), Math.round(data.forecast_lower[i]||v)].forEach((cell, ci) => {
      doc.text(String(cell), cx+2, by+5);
      cx += colW[ci];
    });
  });

  doc.save(`InvenVision_${itemName.replace(/\s+/g,'_')}_report.pdf`);
  showToast('📄 PDF downloaded!', 'success');
}

function download(filename, mimeType, content) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type: mimeType }));
  a.download = filename; a.click();
  URL.revokeObjectURL(a.href);
}

// ══════════════════════════════════════════════
//  Save to Inventory (MySQL or localStorage)
// ══════════════════════════════════════════════
async function saveToInventory() {
  if (!lastPrediction) return showToast('⚠️ No prediction to save', 'error');
  const { data, itemName, currentStock, reorderPoint } = lastPrediction;
  const dateStr = new Date().toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' });
  const expiryDate = document.getElementById('expiryDate')?.value || null;

  if (_dbAvailable) {
    try {
      const res = await fetch('/api/inventory', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          item_name:     itemName,
          current_stock: currentStock || 0,
          reorder_point: reorderPoint || 0,
          next_week:     data.next_week,
          next_month:    data.next_month,
          days_left:     data.stock_days_left,
          status:        data.reorder_status,
          updated_date:  dateStr,
          expiry_date:   expiryDate,
        })
      });
      if (res.ok) {
        showToast('💾 Saved to MySQL database!', 'success');
        loadCommandCenter();  // Refresh AI suggestions
        return;
      }
    } catch(e) { console.warn('DB save failed, falling back to localStorage', e); }
  }

  // Fallback: localStorage
  const local = JSON.parse(localStorage.getItem('inv_v2_inventory') || '[]');
  const item = { id: Date.now(), item: itemName, currentStock: currentStock||0,
    reorderPoint: reorderPoint||0, nextWeek: data.next_week, nextMonth: data.next_month,
    daysLeft: data.stock_days_left, status: data.reorder_status, date: dateStr,
    expiryDate };
  const idx = local.findIndex(i => i.item === itemName);
  if (idx >= 0) local[idx] = item; else local.push(item);
  localStorage.setItem('inv_v2_inventory', JSON.stringify(local));
  showToast('💾 Saved locally (MySQL offline)', 'success');
  loadCommandCenter();
}

// ══════════════════════════════════════════════
//  Feature B: Compare Chart
// ══════════════════════════════════════════════
function renderCompare() {
  inventory = JSON.parse(localStorage.getItem('inv_v2_inventory') || '[]');
  const empty = document.getElementById('compareEmpty');
  const content = document.getElementById('compareContent');

  if (inventory.length < 2) {
    empty.style.display = 'block'; content.classList.add('hidden'); return;
  }
  empty.style.display = 'none'; content.classList.remove('hidden');

  const labels = inventory.map(i => i.item);
  const week7  = inventory.map(i => Math.round(i.nextWeek || 0));
  const month30 = inventory.map(i => Math.round(i.nextMonth || 0));
  const stocks  = inventory.map(i => i.currentStock || 0);
  const palette = ['#7c3aed','#06b6d4','#10b981','#f59e0b','#ef4444','#8b5cf6','#3b82f6','#ec4899'];

  const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
  const gridC = 'rgba(127,127,127,0.06)';
  const tickC = isDark ? '#6b7280' : '#9ca3af';

  // Chart 1 — 7-day demand
  const ctx1 = document.getElementById('compareChart').getContext('2d');
  if (compareChart1) compareChart1.destroy();
  compareChart1 = new Chart(ctx1, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: '7-Day Forecast (units)',
        data: week7,
        backgroundColor: palette.slice(0, labels.length).map(c => c + 'cc'),
        borderColor: palette.slice(0, labels.length),
        borderWidth: 2, borderRadius: 6,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: tickC, font:{family:'Outfit'} } } },
      scales: {
        x: { grid:{color:gridC}, ticks:{color:tickC,font:{family:'Outfit'}} },
        y: { grid:{color:gridC}, ticks:{color:tickC,font:{family:'Outfit'}}, beginAtZero:true }
      }
    }
  });

  // Chart 2 — stock vs 30-day demand
  const ctx2 = document.getElementById('compareChart2').getContext('2d');
  if (compareChart2) compareChart2.destroy();
  compareChart2 = new Chart(ctx2, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label:'Current Stock', data:stocks, backgroundColor:'rgba(139,92,246,0.7)', borderColor:'#7c3aed', borderWidth:2, borderRadius:5 },
        { label:'30-Day Demand', data:month30, backgroundColor:'rgba(239,68,68,0.6)', borderColor:'#ef4444', borderWidth:2, borderRadius:5 },
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color:tickC, font:{family:'Outfit'} } } },
      scales: {
        x: { grid:{color:gridC}, ticks:{color:tickC,font:{family:'Outfit'}} },
        y: { grid:{color:gridC}, ticks:{color:tickC,font:{family:'Outfit'}}, beginAtZero:true }
      }
    }
  });
}

// ══════════════════════════════════════════════
//  Render Inventory Tab (MySQL or localStorage)
// ══════════════════════════════════════════════
async function renderInventory() {
  const grid  = document.getElementById('inventoryGrid');
  const empty = document.getElementById('inventoryEmpty');
  grid.innerHTML = '<div style="padding:30px;text-align:center;color:var(--text-3)">Loading...</div>';
  grid.classList.remove('hidden'); empty.style.display = 'none';

  let items = [];
  if (_dbAvailable) {
    try {
      const res = await fetch('/api/inventory', { credentials: 'same-origin' });
      const d = await res.json();
      items = (d.items || []).map(r => ({
        id:           r.id,
        item:         r.item_name,
        currentStock: r.current_stock,
        reorderPoint: r.reorder_point,
        nextWeek:     r.next_week,
        nextMonth:    r.next_month,
        daysLeft:     r.days_left,
        status:       r.status,
        date:         r.updated_date || '',
      }));
    } catch(e) { items = []; }
  } else {
    items = JSON.parse(localStorage.getItem('inv_v2_inventory') || '[]');
  }

  if (items.length === 0) {
    empty.style.display = 'block'; grid.classList.add('hidden'); return;
  }
  empty.style.display = 'none'; grid.classList.remove('hidden');
  grid.innerHTML = items.map(item => {
    const pct = item.currentStock && item.nextMonth
      ? Math.min(100, Math.round(item.currentStock / (item.nextMonth||1) * 100)) : 50;
    const sm = { ok:['status-ok','Healthy','progress-ok'], warning:['status-warn','Low','progress-warn'], danger:['status-danger','Critical','progress-danger'] };
    const [sCls, sLabel, pCls] = sm[item.status] || sm['ok'];
    return `<div class="inv-card">
      <div class="inv-card-top">
        <div><div class="inv-name">${esc(item.item)}</div><div class="inv-date">Updated ${item.date}</div></div>
        <span class="inv-status ${sCls}">${sLabel}</span>
      </div>
      <div class="inv-stats">
        <div class="inv-stat-item"><div class="inv-stat-label">Current Stock</div><div class="inv-stat-val">${item.currentStock}</div></div>
        <div class="inv-stat-item"><div class="inv-stat-label">Reorder Point</div><div class="inv-stat-val">${item.reorderPoint}</div></div>
        <div class="inv-stat-item"><div class="inv-stat-label">7-Day Forecast</div><div class="inv-stat-val">${Math.round(item.nextWeek)} u</div></div>
        <div class="inv-stat-item"><div class="inv-stat-label">Days Remaining</div><div class="inv-stat-val">${item.daysLeft>=999?'\u221e':item.daysLeft}d</div></div>
      </div>
      <div class="inv-progress"><div class="inv-progress-bar ${pCls}" style="width:${pct}%"></div></div>
      <div class="inv-card-footer">
        <span style="font-size:0.74rem;color:var(--text-3)">30d demand: <strong style="color:var(--text-1)">${Math.round(item.nextMonth)} units</strong></span>
        <button class="inv-delete" onclick="deleteItem(${item.id})">\uD83D\uDDD1 Remove</button>
      </div>
    </div>`;
  }).join('');
}

async function deleteItem(id) {
  if (_dbAvailable) {
    try {
      await fetch(`/api/inventory/${id}`, { method:'DELETE', credentials:'same-origin' });
      showToast('Item removed from database', 'success');
    } catch(e) { showToast('Delete failed', 'error'); }
  } else {
    const local = JSON.parse(localStorage.getItem('inv_v2_inventory') || '[]').filter(i => i.id !== id);
    localStorage.setItem('inv_v2_inventory', JSON.stringify(local));
    showToast('Item removed', 'success');
  }
  renderInventory();
}

// ══════════════════════════════════════════════
//  Render History Tab (MySQL or localStorage)
// ══════════════════════════════════════════════
async function renderHistory() {
  const list  = document.getElementById('historyList');
  const empty = document.getElementById('historyEmpty');
  list.innerHTML = '<div style="padding:30px;text-align:center;color:var(--text-3)">Loading...</div>';
  list.classList.remove('hidden'); empty.style.display = 'none';

  let items = [];
  if (_dbAvailable) {
    try {
      const res = await fetch('/api/history', { credentials: 'same-origin' });
      const d = await res.json();
      items = (d.items || []).map(r => ({
        item:         r.item_name,
        model:        r.model,
        auto_selected:r.auto_selected,
        date:         r.date || '',
        next_day:     r.next_day,
        next_week:    r.next_week,
        next_month:   r.next_month,
        status:       r.status,
        sales_count:  r.sales_count,
      }));
    } catch(e) { items = []; }
  } else {
    items = JSON.parse(localStorage.getItem('inv_v2_history') || '[]');
  }

  if (items.length === 0) {
    empty.style.display = 'block'; list.classList.add('hidden'); return;
  }
  empty.style.display = 'none'; list.classList.remove('hidden');
  const mLabels = { sma:'SMA', ema:'EMA', holt:"Holt's", linear:'Linear Reg.', auto:'Auto' };
  list.innerHTML = items.map(h => {
    const icon = { ok:'\u2705', warning:'\u26A0\uFE0F', danger:'\uD83D\uDEA8' }[h.status] || '\uD83D\uDCCA';
    const mLabel = h.auto_selected ? `Auto \u2192 ${mLabels[h.auto_selected]||h.auto_selected}` : (mLabels[h.model]||h.model);
    return `<div class="history-item">
      <div class="history-item-icon">${icon}</div>
      <div class="history-meta">
        <div class="history-name">${esc(h.item)}</div>
        <div class="history-sub">${h.date} \u00B7 ${mLabel} \u00B7 ${h.sales_count} data points</div>
      </div>
      <div class="history-stats">
        <div><div class="hist-stat-val">${Math.round(h.next_day)}</div><div class="hist-stat-label">Tomorrow</div></div>
        <div><div class="hist-stat-val">${Math.round(h.next_week)}</div><div class="hist-stat-label">7 Days</div></div>
        <div><div class="hist-stat-val">${Math.round(h.next_month)}</div><div class="hist-stat-label">30 Days</div></div>
      </div>
    </div>`;
  }).join('');
}

// ── Helpers ───────────────────────────────────
function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
let toastTimer = null;
function showToast(msg, type='success') {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = `toast toast-${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 3400);
}
