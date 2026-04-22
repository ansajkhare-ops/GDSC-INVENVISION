'use strict';

let forecastChart = null;

document.addEventListener('DOMContentLoaded', () => {
  loadAnalyticsSummary();
  loadProductsForForecast();
});

async function loadAnalyticsSummary() {
  try {
    const [pr, ir] = await Promise.all([
      fetch('/api/products', { credentials:'same-origin' }),
      fetch('/api/invoices', { credentials:'same-origin' }),
    ]);
    const pd = await pr.json();
    const id = await ir.json();
    const products  = pd.products || [];
    const invoices  = id.invoices || [];
    const set = (el, v) => { const e=document.getElementById(el); if(e) e.textContent=v; };
    set('aProducts', products.length);
    set('aRevenue', fmt(invoices.reduce((s,i)=>s+parseFloat(i.total||0),0)));
    set('aInvoices', invoices.length);
    set('aLowStock', products.filter(p=>p.current_stock<=p.min_stock).length);
    renderTopProducts(invoices);
    renderLowStock(products);
    populateForecastSelect(products);
  } catch(e) {}
}

function renderTopProducts(invoices) {
  const tbody = document.getElementById('topProductsTbody');
  // Aggregate from invoices
  const map = {};
  invoices.forEach(inv => { /* invoices don't have items here, skip */ });
  tbody.innerHTML = '<tr><td colspan="4" class="tbl-empty">Add products and make sales to see data</td></tr>';
}

function renderLowStock(products) {
  const tbody = document.getElementById('lowStockTbody');
  const low = products.filter(p => p.current_stock <= p.min_stock);
  if (!low.length) { tbody.innerHTML = '<tr><td colspan="4" class="tbl-empty">✅ All items have sufficient stock</td></tr>'; return; }
  tbody.innerHTML = low.map(p => {
    const s = p.current_stock <= 0 ? 'badge-red' : 'badge-amber';
    const l = p.current_stock <= 0 ? 'Out of Stock' : 'Low Stock';
    return `<tr>
      <td class="bold">${esc(p.name)}</td>
      <td>${fmtQty(p.current_stock)} ${esc(p.unit)}</td>
      <td>${fmtQty(p.min_stock)}</td>
      <td><span class="badge ${s}">${l}</span></td>
    </tr>`;
  }).join('');
}

async function loadProductsForForecast() {
  try {
    const r = await fetch('/api/products', { credentials:'same-origin' });
    const d = await r.json();
    populateForecastSelect(d.products || []);
  } catch(e) {}
}

function populateForecastSelect(products) {
  const sel = document.getElementById('forecastProduct');
  if (!sel) return;
  sel.innerHTML = '<option value="">-- Select a product --</option>' +
    products.map(p => `<option value="${p.id}" data-stock="${p.current_stock}">${esc(p.name)} (Stock: ${fmtQty(p.current_stock)})</option>`).join('');
}

async function loadProductSales(productId) {
  if (!productId) return;
  const opt = document.querySelector(`#forecastProduct option[value="${productId}"]`);
  if (opt) document.getElementById('currentStock').value = opt.dataset.stock || 0;
  // Could fetch sales history for this product in future
}

async function runForecast() {
  const salesRaw = document.getElementById('salesData').value.trim();
  if (!salesRaw) return showToast('Enter sales history data', 'error');
  const salesData = salesRaw.split(/[\s,;]+/).map(Number).filter(n => !isNaN(n) && n >= 0);
  if (salesData.length < 2) return showToast('Need at least 2 data points', 'error');

  const btn = document.getElementById('forecastBtn');
  btn.textContent = '⏳ Analyzing...'; btn.disabled = true;

  const productSel = document.getElementById('forecastProduct');
  const itemName = productSel.options[productSel.selectedIndex]?.text || 'Item';

  try {
    const res = await fetch('/api/predict', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sales_data:     salesData,
        current_stock:  parseFloat(document.getElementById('currentStock').value) || 0,
        reorder_point:  parseFloat(document.getElementById('reorderPoint').value) || 0,
        lead_time:      parseInt(document.getElementById('leadTime').value) || 7,
        model:          document.getElementById('modelSelect').value,
        item_name:      itemName,
      }),
    });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || 'Failed');
    displayForecast(d);
  } catch(e) {
    showToast(e.message, 'error');
  } finally {
    btn.textContent = '🔮 Generate Forecast'; btn.disabled = false;
  }
}

function displayForecast(d) {
  document.getElementById('forecastResults').style.display = 'block';
  document.getElementById('forecastEmpty').style.display   = 'none';

  const set = (id, v) => { const e=document.getElementById(id); if(e) e.textContent=v; };
  set('r_day',   Math.round(d.next_day));
  set('r_week',  Math.round(d.next_week));
  set('r_month', Math.round(d.next_month));

  // Auto badge
  const ab = document.getElementById('autoBadge');
  if (d.auto_selected) { ab.style.display='block'; ab.textContent = `🤖 Auto-selected: ${d.auto_model_name || d.auto_selected}`; }
  else { ab.style.display='none'; }

  // Reorder alert
  const ra = document.getElementById('reorderAlert');
  const alertColors = { ok:'rgba(16,185,129,0.1)', warning:'rgba(245,158,11,0.1)', danger:'rgba(239,68,68,0.1)' };
  const alertBorders = { ok:'rgba(16,185,129,0.3)', warning:'rgba(245,158,11,0.3)', danger:'rgba(239,68,68,0.3)' };
  const alertIcons = { ok:'✅', warning:'⚠️', danger:'🚨' };
  ra.style.background = alertColors[d.reorder_status] || alertColors.ok;
  ra.style.border = `1px solid ${alertBorders[d.reorder_status] || alertBorders.ok}`;
  ra.textContent = `${alertIcons[d.reorder_status] || ''} ${d.reorder_message}`;

  // Seasonality
  const sc = document.getElementById('seasonalityCard');
  if (d.seasonality && d.seasonality !== 'No strong weekly pattern detected') {
    sc.style.display = 'block'; sc.textContent = `📅 ${d.seasonality}`;
  } else { sc.style.display = 'none'; }

  // Chart
  if (forecastChart) forecastChart.destroy();
  const ctx = document.getElementById('forecastChart').getContext('2d');
  const labels = d.forecast_series.map((_, i) => `Day ${i+1}`);
  forecastChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label:'Forecast', data: d.forecast_series, borderColor:'#2563eb', backgroundColor:'rgba(37,99,235,0.1)', tension:0.4, fill:true, pointRadius:3 },
        { label:'Upper', data: d.forecast_upper, borderColor:'rgba(37,99,235,0.3)', borderDash:[4,4], pointRadius:0, tension:0.4 },
        { label:'Lower', data: d.forecast_lower, borderColor:'rgba(37,99,235,0.3)', borderDash:[4,4], pointRadius:0, tension:0.4 },
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend:{ labels:{ color:'#94a3b8', font:{size:11} } } },
      scales: {
        x: { ticks:{ color:'#475569', font:{size:10} }, grid:{ color:'rgba(255,255,255,0.04)' } },
        y: { ticks:{ color:'#475569', font:{size:10} }, grid:{ color:'rgba(255,255,255,0.04)' } },
      }
    }
  });
}
