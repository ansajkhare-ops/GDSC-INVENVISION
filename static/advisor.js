'use strict';

document.addEventListener('DOMContentLoaded', loadAdvisor);
function openModal(id)  { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

async function loadAdvisor() {
  document.getElementById('advisorTbody').innerHTML =
    '<tr><td colspan="7" class="tbl-empty">Analyzing your sales data...</td></tr>';

  try {
    const r = await fetch('/api/reorder-advisor', { credentials: 'same-origin' });
    const d = await r.json();
    const items = d.items || [];
    renderAdvisor(items);
  } catch(e) {
    showToast('Failed to load advisor', 'error');
  }
}

function renderAdvisor(items) {
  const tbody = document.getElementById('advisorTbody');

  if (!items.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="tbl-empty">
      No products found. <a href="/stock" style="color:var(--accent-l)">Add products first →</a>
    </td></tr>`;
    return;
  }

  // Update stats
  const counts = { critical: 0, warning: 0, soon: 0, ok: 0 };
  items.forEach(i => counts[i.urgency] = (counts[i.urgency] || 0) + 1);
  const set = (id, v) => { const e = document.getElementById(id); if(e) e.textContent = v; };
  set('aCritical', counts.critical || 0);
  set('aWarning',  counts.warning  || 0);
  set('aSoon',     counts.soon     || 0);
  set('aOk',       counts.ok       || 0);

  // Check if any have no sales data
  const noData = items.some(i => !i.has_sales_data);
  const noMsg = document.getElementById('noSalesMsg');
  if (noMsg) noMsg.style.display = noData ? 'block' : 'none';

  tbody.innerHTML = items.map(item => {
    const urgencyBadge = {
      critical: '<span class="badge badge-red">🚨 Order NOW</span>',
      warning:  '<span class="badge badge-amber">⚠️ Order This Week</span>',
      soon:     '<span class="badge badge-blue">📅 Order Soon</span>',
      ok:       '<span class="badge badge-green">✅ Stock OK</span>',
    }[item.urgency] || '';

    const daysLeftText = item.days_left !== null
      ? `<span style="font-weight:700;color:${item.days_left <= 3 ? 'var(--red)' : item.days_left <= 7 ? 'var(--amber)' : 'var(--green)'}">${item.days_left} days</span>`
      : `<span style="color:var(--text3)">Unknown*</span>`;

    const avgText = item.avg_daily > 0
      ? `${item.avg_daily} ${esc(item.unit)}/day`
      : `<span style="color:var(--text3)">No data yet*</span>`;

    const orderQtyText = item.suggested_qty > 0
      ? `<span style="font-weight:700;color:var(--accent-l)">${item.suggested_qty} ${esc(item.unit)}</span><div style="font-size:0.7rem;color:var(--text3)">~30 day supply</div>`
      : `<span style="color:var(--text3)">Start selling to predict</span>`;

    const actionBtn = item.urgency !== 'ok'
      ? `<button class="btn btn-success btn-sm" onclick="openQuickRestock(${JSON.stringify(item).replace(/"/g,'&quot;')})">📥 Order</button>`
      : `<button class="btn btn-ghost btn-sm" onclick="openQuickRestock(${JSON.stringify(item).replace(/"/g,'&quot;')})">📥 Restock</button>`;

    return `<tr>
      <td>
        <div class="bold">${esc(item.name)}</div>
        <div style="font-size:0.72rem;color:var(--text3)">${esc(item.category)}</div>
      </td>
      <td class="bold">${fmtQty(item.current_stock)} ${esc(item.unit)}</td>
      <td>${avgText}</td>
      <td>${daysLeftText}</td>
      <td>${orderQtyText}</td>
      <td>${urgencyBadge}</td>
      <td>${actionBtn}</td>
    </tr>`;
  }).join('');
}

// ── Quick Restock ─────────────────────────────
function openQuickRestock(item) {
  document.getElementById('qrProductId').value   = item.id;
  document.getElementById('qrProductName').textContent = item.name;
  document.getElementById('qrProductMeta').textContent =
    `Category: ${item.category} · Unit: ${item.unit} · Current Stock: ${item.current_stock} ${item.unit}`;
  document.getElementById('qrQty').value  = item.suggested_qty || '';
  document.getElementById('qrQtyHint').textContent =
    item.suggested_qty > 0
      ? `AI suggestion: ${item.suggested_qty} ${item.unit} (~30 day supply)`
      : 'Enter quantity to order';
  document.getElementById('qrPrice').value    = '';
  document.getElementById('qrSupplier').value = '';
  document.getElementById('qrExpiry').value   = '';
  openModal('quickRestockModal');
}

async function confirmRestock() {
  const pid = document.getElementById('qrProductId').value;
  const qty = parseFloat(document.getElementById('qrQty').value);
  if (!pid || !qty || qty <= 0) return showToast('Enter a valid quantity', 'error');

  const body = {
    product_id:  pid,
    quantity:    qty,
    buying_price: parseFloat(document.getElementById('qrPrice').value) || 0,
    supplier:    document.getElementById('qrSupplier').value.trim(),
    expiry_date: document.getElementById('qrExpiry').value || null,
    note:        'Reorder from Advisor',
  };

  try {
    const r = await fetch('/api/stock/in', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Failed');
    closeModal('quickRestockModal');
    showToast(`✅ Stock updated! +${qty} units added`);
    loadAdvisor();
  } catch(e) {
    showToast(e.message, 'error');
  }
}
