'use strict';

let cart = [];
let searchTimeout = null;
let currentInvoiceData = null;
let allInvoices = [];

// ── Init ─────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadInvoices();
});

function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
document.addEventListener('keydown', e => { if (e.key === 'Escape') document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open')); });

// ── New Sale ──────────────────────────────────
function openNewSale() {
  cart = [];
  document.getElementById('productSearchInput').value = '';
  document.getElementById('custName').value = 'Walk-in Customer';
  document.getElementById('custPhone').value = '';
  document.getElementById('saleDiscount').value = '0';
  document.getElementById('saleTax').value = '0';
  renderCart();
  openModal('newSaleModal');
}

// ── Product Search ────────────────────────────
function searchProductsForSale(query) {
  clearTimeout(searchTimeout);
  const results = document.getElementById('productSearchResults');
  if (!query.trim()) { results.style.display = 'none'; return; }
  searchTimeout = setTimeout(async () => {
    try {
      const r = await fetch(`/api/products?search=${encodeURIComponent(query)}`, { credentials:'same-origin' });
      const d = await r.json();
      const products = d.products || [];
      if (!products.length) { results.style.display = 'none'; return; }
      results.style.display = 'block';
      results.innerHTML = products.slice(0, 8).map(p => `
        <div class="search-result-item" onclick="addToCart(${JSON.stringify(p).replace(/"/g,'&quot;')})">
          <div>
            <div class="result-name">${esc(p.name)}</div>
            <div class="result-meta">${esc(p.category)} · Stock: ${fmtQty(p.current_stock)} ${esc(p.unit)}</div>
          </div>
          <div class="result-price">₹${fmt(p.selling_price)}</div>
        </div>
      `).join('');
    } catch(e) {}
  }, 250);
}

// ── Cart Logic ────────────────────────────────
function addToCart(product) {
  document.getElementById('productSearchResults').style.display = 'none';
  document.getElementById('productSearchInput').value = '';
  if (product.current_stock <= 0) { showToast(`${product.name} is out of stock!`, 'error'); return; }
  const existing = cart.find(i => i.id === product.id);
  if (existing) { existing.qty = Math.min(existing.qty + 1, product.current_stock); }
  else { cart.push({ id: product.id, name: product.name, unit: product.unit, price: product.selling_price, qty: 1, maxQty: product.current_stock }); }
  renderCart();
}

function removeFromCart(idx) {
  cart.splice(idx, 1);
  renderCart();
}

function updateQty(idx, val) {
  const qty = parseFloat(val) || 0;
  if (qty <= 0) { cart.splice(idx, 1); }
  else { cart[idx].qty = Math.min(qty, cart[idx].maxQty); }
  renderCart();
}

function renderCart() {
  const container = document.getElementById('cartItems');
  const totalsEl  = document.getElementById('cartTotals');
  if (!cart.length) {
    container.innerHTML = `<div class="empty-state" style="padding:24px"><div class="empty-icon">🛒</div><div class="empty-desc">Search and add products above</div></div>`;
    totalsEl.style.display = 'none';
    ['cartSubtotal','cartTotal','finalAmtDisplay'].forEach(id => document.getElementById(id).textContent = '0.00');
    return;
  }
  container.innerHTML = cart.map((item, i) => `
    <div class="cart-item">
      <div class="cart-item-name">${esc(item.name)}<br><span style="font-size:0.72rem;color:var(--text3)">Max: ${fmtQty(item.maxQty)} ${esc(item.unit)}</span></div>
      <input class="form-control cart-item-qty" type="number" min="0.01" max="${item.maxQty}" step="0.01" value="${item.qty}" oninput="updateQty(${i}, this.value)"/>
      <div class="cart-item-price">₹${fmt(item.price * item.qty)}</div>
      <button class="cart-remove" onclick="removeFromCart(${i})">✕</button>
    </div>
  `).join('');
  totalsEl.style.display = 'block';
  recalcCart();
}

function recalcCart() {
  const subtotal  = cart.reduce((s, i) => s + i.price * i.qty, 0);
  const discount  = parseFloat(document.getElementById('saleDiscount')?.value) || 0;
  const taxPct    = parseFloat(document.getElementById('saleTax')?.value) || 0;
  const afterDisc = Math.max(0, subtotal - discount);
  const taxAmt    = afterDisc * taxPct / 100;
  const total     = afterDisc + taxAmt;
  const setTxt = (id, v) => { const el = document.getElementById(id); if(el) el.textContent = fmt(v); };
  setTxt('cartSubtotal', subtotal);
  setTxt('cartTotal', total);
  setTxt('finalAmtDisplay', total);
}

// ── Create Invoice ────────────────────────────
async function createInvoice() {
  if (!cart.length) return showToast('Add at least one item', 'error');
  const subtotal = cart.reduce((s, i) => s + i.price * i.qty, 0);
  const discount = parseFloat(document.getElementById('saleDiscount').value) || 0;
  const taxPct   = parseFloat(document.getElementById('saleTax').value) || 0;
  const afterDisc = Math.max(0, subtotal - discount);
  const taxAmount = afterDisc * taxPct / 100;
  const total     = afterDisc + taxAmount;
  const body = {
    customer_name:  document.getElementById('custName').value.trim() || 'Walk-in Customer',
    customer_phone: document.getElementById('custPhone').value.trim(),
    payment_mode:   document.getElementById('payMode').value,
    subtotal, discount, tax_pct: taxPct, tax_amount: taxAmount, total,
    items: cart.map(i => ({ product_id: i.id, product_name: i.name, quantity: i.qty, unit_price: i.price, total: i.price * i.qty })),
  };
  try {
    const r = await fetch('/api/invoices', { method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Failed');
    closeModal('newSaleModal');
    showToast(`✅ Invoice #${d.invoice_no} created!`);
    currentInvoiceData = { ...d, ...body };
    showInvoice(currentInvoiceData);
    loadInvoices();
  } catch(e) { showToast(e.message, 'error'); }
}

// ── Invoice View ──────────────────────────────
function showInvoice(inv) {
  const items = inv.items || [];
  document.getElementById('invoicePreviewContent').innerHTML = `
    <div class="invoice-preview" id="printableInvoice">
      <div class="inv-header">
        <div>
          <div class="inv-company">InvenVision Pro</div>
          <div class="inv-company-sub">Inventory Management System</div>
        </div>
        <div class="inv-meta">
          <div class="inv-num">Invoice #${esc(inv.invoice_no || inv.invoice_number || '—')}</div>
          <div class="inv-date">${new Date(inv.created_at || Date.now()).toLocaleString('en-IN')}</div>
        </div>
      </div>
      <div class="inv-divider"></div>
      <div class="inv-customer">
        <div class="inv-customer-label">Bill To</div>
        <div class="inv-customer-name">${esc(inv.customer_name || 'Walk-in Customer')}</div>
        ${inv.customer_phone ? `<div style="font-size:0.78rem;color:#64748b">${esc(inv.customer_phone)}</div>` : ''}
      </div>
      <table class="inv-table">
        <thead><tr><th>#</th><th>Product</th><th>Qty</th><th>Unit Price</th><th>Total</th></tr></thead>
        <tbody>
          ${items.map((it, i) => `
            <tr>
              <td>${i+1}</td>
              <td>${esc(it.product_name)}</td>
              <td>${fmtQty(it.quantity)}</td>
              <td>₹${fmt(it.unit_price)}</td>
              <td>₹${fmt(it.total)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      <div class="inv-totals">
        <div class="inv-total-row"><span>Subtotal</span><span>₹${fmt(inv.subtotal)}</span></div>
        ${inv.discount > 0 ? `<div class="inv-total-row"><span>Discount</span><span>-₹${fmt(inv.discount)}</span></div>` : ''}
        ${inv.tax_amount > 0 ? `<div class="inv-total-row"><span>Tax (${inv.tax_pct}%)</span><span>₹${fmt(inv.tax_amount)}</span></div>` : ''}
        <div class="inv-total-row inv-total-final"><span>Total</span><span>₹${fmt(inv.total)}</span></div>
      </div>
      <div class="inv-footer">
        Payment: <strong>${esc(inv.payment_mode || 'Cash')}</strong> &nbsp;·&nbsp; Thank you for your purchase!
      </div>
    </div>
  `;
  openModal('invoiceViewModal');
}

function printInvoice() {
  window.print();
}

// ── Load Invoices ─────────────────────────────
async function loadInvoices() {
  try {
    const r = await fetch('/api/invoices', { credentials:'same-origin' });
    const d = await r.json();
    allInvoices = d.invoices || [];
    renderInvoices(allInvoices);
    updateSalesStats(allInvoices);
  } catch(e) { showToast('Failed to load invoices', 'error'); }
}

function updateSalesStats(invoices) {
  const today = new Date().toDateString();
  const todayInv = invoices.filter(i => new Date(i.created_at).toDateString() === today);
  const set = (id, v) => { const el = document.getElementById(id); if(el) el.textContent = v; };
  set('sTodayBills', todayInv.length);
  set('sTodayRevenue', fmt(todayInv.reduce((s, i) => s + parseFloat(i.total || 0), 0)));
  set('sTotalBills', invoices.length);
  set('sTotalRevenue', fmt(invoices.reduce((s, i) => s + parseFloat(i.total || 0), 0)));
}

function renderInvoices(invoices) {
  const tbody = document.getElementById('invoicesTbody');
  if (!invoices.length) { tbody.innerHTML = '<tr><td colspan="8" class="tbl-empty">No invoices yet. Create your first sale!</td></tr>'; return; }
  tbody.innerHTML = invoices.map(inv => `
    <tr style="cursor:pointer" onclick="viewInvoice(${inv.id})">
      <td class="bold">#${esc(inv.invoice_no)}</td>
      <td style="font-size:0.8rem">${new Date(inv.created_at).toLocaleString('en-IN')}</td>
      <td>${esc(inv.customer_name)}</td>
      <td>${inv.item_count || '—'}</td>
      <td class="bold">₹${fmt(inv.total)}</td>
      <td><span class="badge badge-blue">${esc(inv.payment_mode)}</span></td>
      <td><span class="badge badge-green">Paid</span></td>
      <td style="display:flex;gap:6px">
        <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();viewInvoice(${inv.id})">View</button>
        <button class="btn btn-sm" style="background:rgba(239,68,68,0.15);color:#f87171;border:1px solid rgba(239,68,68,0.3)" onclick="event.stopPropagation();deleteInvoice(${inv.id},'${esc(inv.invoice_no)}')" title="Delete invoice">🗑️</button>
      </td>
    </tr>
  `).join('');
}

function filterInvoices(val) {
  const q = val.toLowerCase();
  renderInvoices(allInvoices.filter(i => i.customer_name.toLowerCase().includes(q) || i.invoice_no.toLowerCase().includes(q)));
}

async function viewInvoice(id) {
  try {
    const r = await fetch(`/api/invoices/${id}`, { credentials:'same-origin' });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Failed to load');
    currentInvoiceData = d;
    showInvoice(d);
  } catch(e) { showToast(e.message, 'error'); }
}

async function deleteInvoice(id, invNo) {
  if (!confirm(`Delete Invoice #${invNo}?\n\nStock will be restored automatically.`)) return;
  try {
    const r = await fetch(`/api/invoices/${id}`, { method:'DELETE', credentials:'same-origin' });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Delete failed');
    showToast(`✅ Invoice #${invNo} deleted. Stock restored.`);
    // Close view modal if open
    closeModal('invoiceViewModal');
    loadInvoices();
  } catch(e) { showToast(e.message, 'error'); }
}

// Close search dropdown when clicking outside
document.addEventListener('click', e => {
  const res = document.getElementById('productSearchResults');
  if (res && !res.contains(e.target) && e.target.id !== 'productSearchInput') res.style.display = 'none';
});

