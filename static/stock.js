'use strict';

let allProducts = [];

// ── Init ─────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadProducts();
  loadStockHistory();
});

// ── Modal helpers ─────────────────────────────
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
document.addEventListener('keydown', e => { if (e.key === 'Escape') document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open')); });

// ── Load Products ─────────────────────────────
async function loadProducts() {
  try {
    const r = await fetch('/api/products', { credentials: 'same-origin' });
    const d = await r.json();
    allProducts = d.products || [];
    renderProducts(allProducts);
    updateStats(allProducts);
    populateRestockSelect(allProducts);
  } catch(e) { showToast('Failed to load products', 'error'); }
}

function updateStats(products) {
  const total    = products.length;
  const inStock  = products.filter(p => p.current_stock > p.min_stock).length;
  const lowStock = products.filter(p => p.current_stock > 0 && p.current_stock <= p.min_stock).length;
  const outOf    = products.filter(p => p.current_stock <= 0).length;
  document.getElementById('sTotalProducts').textContent = total;
  document.getElementById('sInStock').textContent       = inStock;
  document.getElementById('sLowStock').textContent      = lowStock;
  document.getElementById('sOutOfStock').textContent    = outOf;
  const badge = document.getElementById('lowStockBadge');
  if (badge) { badge.style.display = lowStock + outOf > 0 ? 'inline' : 'none'; badge.textContent = lowStock + outOf; }
}

function getStatusBadge(p) {
  if (p.current_stock <= 0) return '<span class="badge badge-red">Out of Stock</span>';
  if (p.current_stock <= p.min_stock) return '<span class="badge badge-amber">Low Stock</span>';
  return '<span class="badge badge-green">In Stock</span>';
}

function getStockBar(p) {
  if (p.min_stock <= 0) return '';
  const pct = Math.min(100, Math.round((p.current_stock / (p.min_stock * 2)) * 100));
  const cls = p.current_stock <= 0 ? 'fill-red' : p.current_stock <= p.min_stock ? 'fill-amber' : 'fill-green';
  return `<div class="stock-bar"><div class="stock-fill ${cls}" style="width:${pct}%"></div></div>`;
}

function renderProducts(products) {
  const tbody = document.getElementById('productsTbody');
  if (!products.length) {
    tbody.innerHTML = '<tr><td colspan="10" class="tbl-empty">No products found. Click "+ Add Product" to get started.</td></tr>';
    return;
  }
  tbody.innerHTML = products.map((p, i) => `
    <tr>
      <td class="bold">${i + 1}</td>
      <td><div class="bold">${esc(p.name)}</div><div style="font-size:0.72rem;color:var(--text3)">${esc(p.description || '')}</div></td>
      <td><span class="badge badge-blue">${esc(p.category)}</span></td>
      <td>${esc(p.unit)}</td>
      <td>
        <div class="bold">${fmtQty(p.current_stock)} ${esc(p.unit)}</div>
        ${getStockBar(p)}
      </td>
      <td>${fmtQty(p.min_stock)}</td>
      <td>₹${fmt(p.buying_price)}</td>
      <td>₹${fmt(p.selling_price)}</td>
      <td>${getStatusBadge(p)}</td>
      <td>
        <div style="display:flex;gap:5px">
          <button class="btn btn-success btn-sm btn-icon" title="Restock" onclick="quickRestock(${p.id})">📥</button>
          <button class="btn btn-ghost btn-sm btn-icon" title="Edit" onclick="editProduct(${p.id})">✏️</button>
          <button class="btn btn-danger btn-sm btn-icon" title="Delete" onclick="deleteProduct(${p.id},'${esc(p.name)}')">🗑</button>
        </div>
      </td>
    </tr>
  `).join('');
}

function filterProducts(val) {
  const query = (val || document.getElementById('productSearch').value || '').toLowerCase();
  const cat   = document.getElementById('catFilter').value;
  const filtered = allProducts.filter(p =>
    (!query || p.name.toLowerCase().includes(query) || (p.description||'').toLowerCase().includes(query)) &&
    (!cat || p.category === cat)
  );
  renderProducts(filtered);
}

// ── Add Product ───────────────────────────────
async function addProduct() {
  const name = document.getElementById('pName').value.trim();
  if (!name) return showToast('Product name is required', 'error');
  const body = {
    name, category: document.getElementById('pCategory').value,
    unit: document.getElementById('pUnit').value,
    min_stock: parseFloat(document.getElementById('pMinStock').value) || 10,
    buying_price: parseFloat(document.getElementById('pBuyPrice').value) || 0,
    selling_price: parseFloat(document.getElementById('pSellPrice').value) || 0,
    description: document.getElementById('pDesc').value.trim(),
    init_stock: parseFloat(document.getElementById('pInitStock').value) || 0,
    expiry_date: document.getElementById('pExpiry').value || null,
  };
  try {
    const r = await fetch('/api/products', { method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Failed');
    closeModal('addProductModal');
    ['pName','pDesc','pBuyPrice','pSellPrice','pExpiry'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('pInitStock').value = '0';
    document.getElementById('pMinStock').value = '10';
    showToast(`✅ ${name} added successfully!`);
    loadProducts();
  } catch(e) { showToast(e.message, 'error'); }
}

// ── Restock ───────────────────────────────────
function populateRestockSelect(products) {
  const sel = document.getElementById('rsProduct');
  sel.innerHTML = '<option value="">-- Select product --</option>' +
    products.map(p => `<option value="${p.id}">${esc(p.name)} (${fmtQty(p.current_stock)} ${esc(p.unit)})</option>`).join('');
}

function quickRestock(productId) {
  document.getElementById('rsProduct').value = productId;
  const p = allProducts.find(x => x.id === productId);
  if (p) document.getElementById('rsBuyPrice').value = p.buying_price;
  openModal('restockModal');
}

async function restockItem() {
  const productId = document.getElementById('rsProduct').value;
  const qty = parseFloat(document.getElementById('rsQty').value);
  if (!productId) return showToast('Select a product', 'error');
  if (!qty || qty <= 0) return showToast('Enter a valid quantity', 'error');
  const body = {
    product_id: productId, quantity: qty,
    buying_price: parseFloat(document.getElementById('rsBuyPrice').value) || 0,
    supplier: document.getElementById('rsSupplier').value.trim(),
    batch_no:  document.getElementById('rsBatch').value.trim(),
    expiry_date: document.getElementById('rsExpiry').value || null,
    note: document.getElementById('rsNote').value.trim(),
  };
  try {
    const r = await fetch('/api/stock/in', { method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Failed');
    closeModal('restockModal');
    ['rsQty','rsSupplier','rsBatch','rsNote','rsExpiry'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('rsProduct').value = '';
    showToast(`✅ Stock updated! +${qty} units added`);
    loadProducts(); loadStockHistory();
  } catch(e) { showToast(e.message, 'error'); }
}

// ── Edit Product ──────────────────────────────
function editProduct(id) {
  const p = allProducts.find(x => x.id === id);
  if (!p) return;
  document.getElementById('epId').value = id;
  document.getElementById('epName').value = p.name;
  document.getElementById('epCategory').value = p.category;
  document.getElementById('epBuyPrice').value = p.buying_price;
  document.getElementById('epSellPrice').value = p.selling_price;
  document.getElementById('epMinStock').value = p.min_stock;
  document.getElementById('epUnit').value = p.unit;
  openModal('editProductModal');
}

async function saveEditProduct() {
  const id = document.getElementById('epId').value;
  const body = {
    name: document.getElementById('epName').value.trim(),
    category: document.getElementById('epCategory').value,
    buying_price: parseFloat(document.getElementById('epBuyPrice').value) || 0,
    selling_price: parseFloat(document.getElementById('epSellPrice').value) || 0,
    min_stock: parseFloat(document.getElementById('epMinStock').value) || 0,
    unit: document.getElementById('epUnit').value,
  };
  try {
    const r = await fetch(`/api/products/${id}`, { method:'PUT', credentials:'same-origin', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Failed');
    closeModal('editProductModal');
    showToast('Product updated!');
    loadProducts();
  } catch(e) { showToast(e.message, 'error'); }
}

// ── Delete Product ────────────────────────────
async function deleteProduct(id, name) {
  if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
  try {
    const r = await fetch(`/api/products/${id}`, { method:'DELETE', credentials:'same-origin' });
    if (!r.ok) throw new Error('Failed to delete');
    showToast('Product deleted');
    loadProducts();
  } catch(e) { showToast(e.message, 'error'); }
}

// ── Stock History ─────────────────────────────
async function loadStockHistory() {
  try {
    const r = await fetch('/api/stock/history', { credentials:'same-origin' });
    const d = await r.json();
    const tbody = document.getElementById('historyTbody');
    const items = d.items || [];
    if (!items.length) { tbody.innerHTML = '<tr><td colspan="6" class="tbl-empty">No stock movements yet</td></tr>'; return; }
    tbody.innerHTML = items.slice(0, 50).map(h => `
      <tr>
        <td style="font-size:0.78rem">${h.created_at || ''}</td>
        <td class="bold">${esc(h.product_name)}</td>
        <td>${h.type === 'in' ? '<span class="badge badge-green">📥 Stock In</span>' : '<span class="badge badge-red">📤 Sale</span>'}</td>
        <td class="bold">${h.type === 'in' ? '+' : '-'}${fmtQty(h.quantity)}</td>
        <td>₹${fmt(h.price)}</td>
        <td style="color:var(--text3);font-size:0.8rem">${esc(h.note || h.supplier || '')}</td>
      </tr>
    `).join('');
  } catch(e) {}
}
