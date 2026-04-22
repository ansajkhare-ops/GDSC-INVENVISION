'use strict';

let allCustomers     = [];
let activeCustomerId = null;

document.addEventListener('DOMContentLoaded', loadCustomers);
function openModal(id)  { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
document.addEventListener('keydown', e => {
  if (e.key === 'Escape')
    document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open'));
});

// ── Load All Customers ────────────────────────
async function loadCustomers() {
  try {
    const r = await fetch('/api/customers', { credentials: 'same-origin' });
    const d = await r.json();
    allCustomers = d.customers || [];
    renderCustomers(allCustomers);
    updateStats(allCustomers);
  } catch(e) {
    showToast('Failed to load customers', 'error');
  }
}

function updateStats(customers) {
  const totalDue  = customers.reduce((s, c) => s + parseFloat(c.balance_due || 0), 0);
  const overdue   = customers.filter(c => parseFloat(c.balance_due || 0) > 0).length;
  const totalBiz  = customers.reduce((s, c) => s + parseFloat(c.total_purchased || 0), 0);
  const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  set('cTotal',         customers.length);
  set('cTotalDue',      '₹' + fmt(totalDue));
  set('cOverdue',       overdue);
  set('cTotalBusiness', '₹' + fmt(totalBiz));
}

// ── Render Table ──────────────────────────────
function renderCustomers(customers) {
  const tbody = document.getElementById('customersTbody');
  if (!customers.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="tbl-empty">
      No customers yet. Click "+ Add Customer" to get started.</td></tr>`;
    return;
  }
  tbody.innerHTML = customers.map((c, i) => {
    const due   = parseFloat(c.balance_due || 0);
    const badge = due > 0
      ? `<span class="badge badge-red">Due ₹${fmt(due)}</span>`
      : `<span class="badge badge-green">Clear</span>`;
    return `<tr>
      <td class="bold">${i + 1}</td>
      <td>
        <div class="bold">${esc(c.name)}</div>
        ${c.address ? `<div style="font-size:0.72rem;color:var(--text3)">${esc(c.address)}</div>` : ''}
      </td>
      <td>${esc(c.phone || '—')}</td>
      <td class="bold">₹${fmt(c.total_purchased)}</td>
      <td class="bold" style="color:${due > 0 ? 'var(--red)' : 'var(--green)'}">₹${fmt(due)}</td>
      <td>${badge}</td>
      <td>
        <button class="btn btn-success btn-sm" onclick="openKhata(${c.id})">📒 View Khata</button>
      </td>
    </tr>`;
  }).join('');
}

function filterCustomers(val) {
  const q = val.toLowerCase();
  renderCustomers(allCustomers.filter(c =>
    c.name.toLowerCase().includes(q) || (c.phone || '').includes(q)
  ));
}

// ── Add Customer ──────────────────────────────
async function addCustomer() {
  const name = document.getElementById('cName').value.trim();
  if (!name) return showToast('Customer name is required', 'error');
  const body = {
    name,
    phone:        document.getElementById('cPhone').value.trim(),
    address:      document.getElementById('cAddress').value.trim(),
    credit_limit: parseFloat(document.getElementById('cCreditLimit').value) || 0,
  };
  try {
    const r = await fetch('/api/customers', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Failed');
    closeModal('addCustomerModal');
    document.getElementById('cName').value         = '';
    document.getElementById('cPhone').value        = '';
    document.getElementById('cAddress').value      = '';
    document.getElementById('cCreditLimit').value  = '0';
    showToast(`✅ ${name} added to Khata!`);
    loadCustomers();
  } catch(e) {
    showToast(e.message, 'error');
  }
}

// ── Open Khata (Detail Modal) ─────────────────
async function openKhata(id) {
  activeCustomerId = id;
  const c = allCustomers.find(x => x.id === id);
  if (!c) return;

  document.getElementById('detailCustomerName').textContent = `📒 ${c.name}'s Khata`;

  const due       = parseFloat(c.balance_due || 0);
  const purchased = parseFloat(c.total_purchased || 0);
  const limit     = parseFloat(c.credit_limit || 0);

  document.getElementById('detailStats').innerHTML = `
    <div style="background:var(--card-h);border:1px solid var(--border);border-radius:10px;padding:14px;text-align:center">
      <div style="font-size:0.68rem;color:var(--text3);margin-bottom:4px">Total Purchased</div>
      <div style="font-size:1.5rem;font-weight:800;color:var(--accent-l);font-family:'JetBrains Mono',monospace">₹${fmt(purchased)}</div>
    </div>
    <div style="background:${due > 0 ? 'rgba(239,68,68,0.1)' : 'rgba(16,185,129,0.08)'};
      border:1px solid ${due > 0 ? 'rgba(239,68,68,0.25)' : 'rgba(16,185,129,0.2)'};
      border-radius:10px;padding:14px;text-align:center">
      <div style="font-size:0.68rem;color:var(--text3);margin-bottom:4px">Balance Due</div>
      <div style="font-size:1.5rem;font-weight:800;color:${due > 0 ? 'var(--red)' : 'var(--green)'};font-family:'JetBrains Mono',monospace">₹${fmt(due)}</div>
      ${due > 0 ? '<div style="font-size:0.7rem;color:var(--text3)">Collect payment below</div>' : ''}
    </div>
    <div style="background:var(--card-h);border:1px solid var(--border);border-radius:10px;padding:14px;text-align:center">
      <div style="font-size:0.68rem;color:var(--text3);margin-bottom:4px">Credit Limit</div>
      <div style="font-size:1.5rem;font-weight:800;color:var(--text1);font-family:'JetBrains Mono',monospace">${limit > 0 ? '₹' + fmt(limit) : 'No Limit'}</div>
    </div>`;

  // Clear input fields
  ['creditAmount','creditNote','payAmount','payNote'].forEach(id => {
    const el = document.getElementById(id); if(el) el.value = '';
  });

  await loadTransactions(id);
  openModal('customerDetailModal');
}

// ── Load Transaction History ──────────────────
async function loadTransactions(id) {
  const tbody = document.getElementById('detailTbody');
  tbody.innerHTML = '<tr><td colspan="5" class="tbl-empty">Loading...</td></tr>';
  try {
    const r = await fetch(`/api/customers/${id}/transactions`, { credentials: 'same-origin' });
    const d = await r.json();
    const txns = d.transactions || [];
    if (!txns.length) {
      tbody.innerHTML = `<tr><td colspan="5" class="tbl-empty">
        No transactions yet — add a credit sale or record a payment above.</td></tr>`;
      return;
    }
    tbody.innerHTML = txns.map(t => {
      const isCredit = t.type === 'credit';
      return `<tr>
        <td style="font-size:0.78rem;white-space:nowrap">${esc(t.created_at || '')}</td>
        <td>${isCredit
          ? '<span class="badge badge-red">💸 Credit Sale</span>'
          : '<span class="badge badge-green">💵 Payment</span>'}</td>
        <td class="bold" style="color:${isCredit ? 'var(--red)' : 'var(--green)'}">
          ${isCredit ? '+' : '−'}₹${fmt(t.amount)}
        </td>
        <td>${isCredit ? '—' : esc(t.payment_mode || '—')}</td>
        <td style="color:var(--text3);font-size:0.8rem">${esc(t.note || '')}</td>
      </tr>`;
    }).join('');
  } catch(e) {
    tbody.innerHTML = '<tr><td colspan="5" class="tbl-empty">Failed to load</td></tr>';
  }
}

// ── Record Credit Sale (customer owes money) ──
async function recordCreditSale() {
  if (!activeCustomerId) return;
  const amount = parseFloat(document.getElementById('creditAmount').value);
  if (!amount || amount <= 0) return showToast('Enter a valid sale amount', 'error');
  const body = {
    amount,
    type:  'credit',
    note:  document.getElementById('creditNote').value.trim(),
    payment_mode: 'Credit',
  };
  try {
    const r = await fetch(`/api/customers/${activeCustomerId}/payment`, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Failed');
    document.getElementById('creditAmount').value = '';
    document.getElementById('creditNote').value   = '';
    showToast(`✅ Credit sale of ₹${fmt(amount)} recorded`);
    await loadCustomers();
    await openKhata(activeCustomerId);
  } catch(e) {
    showToast(e.message, 'error');
  }
}

// ── Collect Payment (customer pays back) ──────
async function recordPayment() {
  if (!activeCustomerId) return;
  const amount = parseFloat(document.getElementById('payAmount').value);
  if (!amount || amount <= 0) return showToast('Enter a valid amount', 'error');
  const body = {
    amount,
    type:         'payment',
    payment_mode: document.getElementById('payMode2').value,
    note:         document.getElementById('payNote').value.trim(),
  };
  try {
    const r = await fetch(`/api/customers/${activeCustomerId}/payment`, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Failed');
    document.getElementById('payAmount').value = '';
    document.getElementById('payNote').value   = '';
    showToast(`✅ Payment of ₹${fmt(amount)} collected`);
    await loadCustomers();
    await openKhata(activeCustomerId);
  } catch(e) {
    showToast(e.message, 'error');
  }
}

// ── Delete Customer ───────────────────────────
async function deleteCustomer() {
  if (!activeCustomerId) return;
  const c = allCustomers.find(x => x.id === activeCustomerId);
  if (!confirm(`Delete "${c ? c.name : 'this customer'}"? Cannot be undone.`)) return;
  try {
    const r = await fetch(`/api/customers/${activeCustomerId}`, {
      method: 'DELETE', credentials: 'same-origin',
    });
    if (!r.ok) throw new Error('Failed');
    closeModal('customerDetailModal');
    showToast('Customer deleted');
    activeCustomerId = null;
    loadCustomers();
  } catch(e) {
    showToast(e.message, 'error');
  }
}
