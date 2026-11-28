(function () {
  'use strict';

  const CATALOG = window.LIFEINSHOP_CATALOG;
  const STORE = window.LIFEINSHOP_STORE;
  if (!CATALOG || !STORE) return;

  const { BRAND, CATEGORIES, PRODUCTS } = CATALOG;

  const DRAFT_STORAGE_KEY = 'lifeinshop_pos_draft_v1';
  const HELD_STORAGE_KEY = 'lifeinshop_pos_held_v1';
  const SCAN_DEMO_PRIORITY = [
    'LIS-AJ4-GRY-42',
    'LIS-NM-WBK-41',
    'LIS-ZMX-ASH-42',
    'LIS-RT-WHT-42',
    'LIS-AED-095-32',
    'LIS-SHRT-069-L',
  ];

  /* ==========================================================================
     Safe Storage & Shared Formatters
     ========================================================================== */

  const memoryFallback = Object.create(null);

  function readLocal(key, fallback) {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw !== null) {
        memoryFallback[key] = raw;
        return JSON.parse(raw);
      }
    } catch (_) {
      // Fall through to memory cache on restricted file:///
    }
    if (Object.prototype.hasOwnProperty.call(memoryFallback, key)) {
      try {
        return JSON.parse(memoryFallback[key]);
      } catch (_) {
        return fallback;
      }
    }
    return fallback;
  }

  function writeLocal(key, value) {
    const serialized = JSON.stringify(value);
    memoryFallback[key] = serialized;
    try {
      window.localStorage.setItem(key, serialized);
    } catch (_) {
      // Ignore file:/// or private storage error
    }
  }

  function formatBDT(amount) {
    const num = Math.round(Number(amount) || 0);
    return `৳${num.toLocaleString('en-IN')}`;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function getProductById(id) {
    return PRODUCTS.find((p) => p.id === id) || null;
  }

  function formatTimeAgo(iso) {
    if (!iso) return '';
    const dt = new Date(iso);
    if (isNaN(dt.getTime())) return '';
    const diffMs = Date.now() - dt.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    return dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  function formatReceiptDate(iso) {
    const dt = iso ? new Date(iso) : new Date();
    if (isNaN(dt.getTime())) return '';
    return dt.toLocaleString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  }

  /* ==========================================================================
     Web Audio API Chime / Buzz Feedback
     ========================================================================== */

  let audioCtx = null;

  function playBeep(kind) {
    try {
      const AudioCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtor) return;
      if (!audioCtx) audioCtx = new AudioCtor();
      if (audioCtx.state === 'suspended') {
        audioCtx.resume().catch(() => {});
      }

      const now = audioCtx.currentTime;
      if (kind === 'error') {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(210, now);
        gain.gain.setValueAtTime(0.06, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(now);
        osc.stop(now + 0.16);
        return;
      }

      // Crisp POS chime (2 quick ascending tones)
      [880, 1175].forEach((freq, idx) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        const start = now + idx * 0.065;
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, start);
        gain.gain.setValueAtTime(0.07, start);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.085);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(start);
        osc.stop(start + 0.09);
      });
    } catch (_) {
      // Audio unavailable or blocked
    }
  }

  /* ==========================================================================
     Deterministic Inline SVG Code128-Style Barcode Renderer
     ========================================================================== */

  function renderBarcodeSvg(code) {
    const clean = String(code || 'LIS-0000').replace(/[^A-Z0-9#\-]/gi, '').toUpperCase();
    const bars = [];
    let x = 8;

    // Start guard
    bars.push({ x, w: 2 }); x += 3;
    bars.push({ x, w: 1 }); x += 2;
    bars.push({ x, w: 2 }); x += 4;

    for (let i = 0; i < clean.length; i += 1) {
      const ch = clean.charCodeAt(i);
      const pattern = [
        ((ch >> 0) & 1) ? 2.2 : 1.1,
        ((ch >> 1) & 1) ? 2.0 : 1.0,
        ((ch >> 2) & 1) ? 2.4 : 1.2,
        ((ch >> 3) & 1) ? 1.8 : 1.0,
        ((ch >> 4) & 1) ? 2.2 : 1.1,
        ((ch >> 5) & 1) ? 1.8 : 1.0,
      ];
      for (let j = 0; j < pattern.length; j += 1) {
        const w = pattern[j];
        if (j % 2 === 0) {
          bars.push({ x, w });
        }
        x += w + 0.6;
      }
      x += 1.2;
    }

    // Stop guard
    bars.push({ x, w: 2 }); x += 3;
    bars.push({ x, w: 1 }); x += 2;
    bars.push({ x, w: 2 }); x += 10;

    const totalW = Math.ceil(x);
    const rects = bars
      .map((b) => `<rect x="${b.x.toFixed(1)}" y="2" width="${b.w.toFixed(1)}" height="32" fill="#000000"/>`)
      .join('');

    return `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalW} 48" role="img" aria-label="Barcode ${escapeHtml(clean)}">
        ${rects}
        <text x="${(totalW / 2).toFixed(1)}" y="45" text-anchor="middle" font-family="Courier New, monospace" font-size="9.5" font-weight="700" fill="#000000">${escapeHtml(clean)}</text>
      </svg>
    `;
  }

  /* ==========================================================================
     POS Workspace State
     ========================================================================== */

  function createEmptyDraft() {
    return {
      items: [], // { productId, size, qty }
      customerPhone: '',
      customerName: '',
      discountType: 'fixed', // 'fixed' | 'percent'
      discountInput: '',
      payMode: 'cash', // 'cash' | 'bkash' | 'nagad' | 'card' | 'split'
      cashTendered: '',
      mfsRef: '',
      splitCash: '',
      splitMfsMethod: 'bkash',
      splitMfsAmount: '',
      splitRef: '',
    };
  }

  const state = {
    workspaceTab: 'pos', // 'pos' | 'orders' | 'inventory'
    mobilePane: 'catalog', // 'catalog' | 'bill'
    // Tab 1: POS Catalog
    posCategory: 'all',
    posSearch: '',
    scanDemoCursor: 0,
    scanToastTimer: null,
    // Tab 1: Active Bill & Held Bills
    draft: createEmptyDraft(),
    heldBills: [],
    // Tab 2: Orders
    orderFilter: 'all',
    orderSearch: '',
    // Tab 3: Inventory
    invSearch: '',
    invLowOnly: false,
    resetConfirming: false,
    resetTimer: null,
    // Modals
    activeModal: null, // 'size-matrix' | 'exchange' | 'return' | 'print'
    sizeMatrixProductId: null,
    exchangeCtx: null, // { orderNumber, itemIndex, selectedSize }
    returnCtx: null, // { orderNumber, targetStatus }
    printCtx: null, // { type: 'receipt' | 'slip', orderNumber, width: '80mm' | '58mm' }
  };

  function loadDraftAndHeld() {
    const savedDraft = readLocal(DRAFT_STORAGE_KEY, null);
    if (savedDraft && typeof savedDraft === 'object') {
      const merged = Object.assign(createEmptyDraft(), savedDraft);
      merged.items = Array.isArray(savedDraft.items)
        ? savedDraft.items
            .filter((it) => it && getProductById(it.productId) && it.size)
            .map((it) => ({
              productId: it.productId,
              size: String(it.size),
              qty: Math.max(1, Math.min(20, parseInt(it.qty, 10) || 1)),
            }))
        : [];
      state.draft = merged;
    } else {
      state.draft = createEmptyDraft();
    }

    const savedHeld = readLocal(HELD_STORAGE_KEY, []);
    state.heldBills = Array.isArray(savedHeld) ? savedHeld : [];
  }

  function saveDraft() {
    writeLocal(DRAFT_STORAGE_KEY, state.draft);
  }

  function saveHeldBills() {
    writeLocal(HELD_STORAGE_KEY, state.heldBills);
  }

  /* ==========================================================================
     Toast & Error Helpers
     ========================================================================== */

  function showScanToast(message, isError = false) {
    const el = document.getElementById('pos-scan-toast');
    if (!el) return;
    if (state.scanToastTimer) {
      clearTimeout(state.scanToastTimer);
      state.scanToastTimer = null;
    }
    el.textContent = message;
    el.classList.toggle('is-error', Boolean(isError));
    el.hidden = false;
    state.scanToastTimer = setTimeout(() => {
      el.hidden = true;
      state.scanToastTimer = null;
    }, 3600);
  }

  function setBillError(msg) {
    const el = document.getElementById('pos-bill-error');
    if (!el) return;
    if (!msg) {
      el.textContent = '';
      el.hidden = true;
    } else {
      el.textContent = msg;
      el.hidden = false;
    }
  }

  /* ==========================================================================
     Workspace Tab Switching & Mobile Pane Switching
     ========================================================================== */

  function syncMobileStickyVisibility() {
    const sticky = document.getElementById('pos-mobile-sticky-bill');
    if (!sticky) return;
    const hideSticky = state.workspaceTab !== 'pos' || state.mobilePane === 'bill';
    sticky.classList.toggle('is-hidden', hideSticky);
  }

  function setWorkspaceTab(tab, { updateUrl = true } = {}) {
    const valid = ['pos', 'orders', 'inventory'];
    const next = valid.includes(tab) ? tab : 'pos';
    state.workspaceTab = next;

    document.querySelectorAll('#pos-workspace-tabs [data-workspace-tab]').forEach((btn) => {
      const active = btn.dataset.workspaceTab === next;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });

    const viewMap = {
      pos: document.getElementById('view-pos'),
      orders: document.getElementById('view-orders'),
      inventory: document.getElementById('view-inventory'),
    };
    Object.keys(viewMap).forEach((key) => {
      const section = viewMap[key];
      if (!section) return;
      const active = key === next;
      section.hidden = !active;
      section.classList.toggle('is-active', active);
    });

    syncMobileStickyVisibility();

    if (next === 'orders') {
      renderOrdersView();
    } else if (next === 'inventory') {
      renderInventoryView();
    } else {
      renderPosCatalogGrid();
      renderActiveBill();
    }

    if (updateUrl) {
      try {
        const url = new URL(window.location.href);
        if (next === 'pos') {
          url.searchParams.delete('tab');
        } else {
          url.searchParams.set('tab', next);
        }
        window.history.replaceState(null, '', url.pathname + url.search);
      } catch (_) {
        // Ignore SecurityError on file:///
      }
    }
  }

  function setMobilePane(pane) {
    const next = pane === 'bill' ? 'bill' : 'catalog';
    state.mobilePane = next;

    document.querySelectorAll('#pos-mobile-tabs [data-pos-pane]').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.posPane === next);
    });

    document.getElementById('pos-catalog-pane')?.classList.toggle('is-mobile-active', next === 'catalog');
    document.getElementById('pos-bill-pane')?.classList.toggle('is-mobile-active', next === 'bill');
    syncMobileStickyVisibility();
  }

  function updatePendingBadge() {
    const metrics = STORE.getShiftMetrics();
    const badge = document.getElementById('orders-pending-badge');
    if (badge) {
      badge.textContent = String(metrics.onlinePendingCount);
      badge.classList.toggle('is-zero', metrics.onlinePendingCount === 0);
    }
  }

  /* ==========================================================================
     Unified Modal Manager
     ========================================================================== */

  const MODAL_IDS = {
    'size-matrix': 'size-matrix-modal',
    exchange: 'exchange-modal',
    return: 'return-modal',
    print: 'print-modal',
  };

  function closeAllModals() {
    Object.values(MODAL_IDS).forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        el.classList.remove('is-open');
        el.setAttribute('aria-hidden', 'true');
      }
    });
    const backdrop = document.getElementById('pos-modal-backdrop');
    if (backdrop) {
      backdrop.classList.remove('is-open');
      backdrop.setAttribute('aria-hidden', 'true');
    }
    document.body.classList.remove('scroll-locked');
    state.activeModal = null;
  }

  function openModal(name) {
    const id = MODAL_IDS[name];
    const target = id ? document.getElementById(id) : null;
    if (!target) return;

    closeAllModals();
    state.activeModal = name;
    target.classList.add('is-open');
    target.setAttribute('aria-hidden', 'false');

    const backdrop = document.getElementById('pos-modal-backdrop');
    if (backdrop) {
      backdrop.classList.add('is-open');
      backdrop.setAttribute('aria-hidden', 'false');
    }
    document.body.classList.add('scroll-locked');
  }

  /* ==========================================================================
     TAB 1: SHOWROOM POS TERMINAL
     ========================================================================== */

  function getInBillQty(productId, size) {
    const found = state.draft.items.find((it) => it.productId === productId && it.size === String(size));
    return found ? found.qty : 0;
  }

  function renderPosCategoryTabs() {
    const wrap = document.getElementById('pos-category-tabs');
    if (!wrap) return;

    const tabs = [
      { id: 'all', label: 'All' },
      ...CATEGORIES.map((c) => ({ id: c.id, label: c.shortName })),
      { id: 'low', label: 'Low Stock', isLow: true },
    ];

    wrap.innerHTML = tabs
      .map((tab) => {
        const active = state.posCategory === tab.id;
        return `
          <button
            type="button"
            class="pos-cat-tab${tab.isLow ? ' is-low-tab' : ''}${active ? ' is-active' : ''}"
            role="tab"
            aria-selected="${active ? 'true' : 'false'}"
            data-pos-cat="${escapeHtml(tab.id)}"
          >${escapeHtml(tab.label)}</button>
        `;
      })
      .join('');
  }

  function isProductLowStock(productId) {
    const total = STORE.getProductTotalStock(productId);
    if (total <= 4) return true;
    const stockMap = STORE.getProductStockMap(productId);
    return Object.values(stockMap).some((qty) => qty <= 2);
  }

  function renderPosCatalogGrid() {
    const grid = document.getElementById('pos-product-grid');
    if (!grid) return;

    const q = state.posSearch.trim().toLowerCase();
    const filtered = PRODUCTS.filter((p) => {
      if (state.posCategory === 'low') {
        if (!isProductLowStock(p.id)) return false;
      } else if (state.posCategory !== 'all' && p.category !== state.posCategory) {
        return false;
      }

      if (!q) return true;
      const variantSkus = (p.sizes || []).map((s) => STORE.getVariantSku(p, s)).join(' ');
      const haystack = [p.name, p.sku, p.categoryLabel, p.colorName, variantSkus].join(' ').toLowerCase();
      return haystack.includes(q);
    });

    if (filtered.length === 0) {
      grid.innerHTML = `<div class="pos-grid-empty">No matching products found. Try clearing filters or scanning another SKU.</div>`;
      return;
    }

    grid.innerHTML = filtered
      .map((p) => {
        const stockMap = STORE.getProductStockMap(p.id);
        const total = STORE.getProductTotalStock(p.id);
        const badgeClass = total === 0 ? ' is-out' : total <= 4 ? ' is-low' : '';
        const badgeLabel = total === 0 ? 'OOS' : `${total} left`;

        const miniSizes = (p.sizes || [])
          .map((size) => {
            const qty = stockMap[size] || 0;
            const cls = qty === 0 ? ' is-oos' : qty <= 2 ? ' is-low' : '';
            return `<span class="pos-mini-size${cls}" title="Size ${escapeHtml(size)}: ${qty} left">${escapeHtml(size)}</span>`;
          })
          .join('');

        return `
          <button type="button" class="pos-product-card${total === 0 ? ' is-out' : ''}" data-pos-product="${escapeHtml(p.id)}">
            <div class="pos-card-media">
              <img src="${escapeHtml(p.images[0])}" alt="${escapeHtml(p.name)}" loading="lazy">
              <span class="pos-stock-badge${badgeClass}">${escapeHtml(badgeLabel)}</span>
            </div>
            <div class="pos-card-body">
              <span class="pos-card-sku">${escapeHtml(p.sku)}</span>
              <span class="pos-card-name">${escapeHtml(p.name)}</span>
              <span class="pos-card-price">${formatBDT(p.price)}</span>
              <div class="pos-card-sizes">${miniSizes}</div>
            </div>
          </button>
        `;
      })
      .join('');
  }

  function openSizeMatrixModal(productId) {
    const product = getProductById(productId);
    if (!product) return;
    state.sizeMatrixProductId = product.id;

    const imgEl = document.getElementById('sm-img');
    const skuEl = document.getElementById('sm-sku');
    const titleEl = document.getElementById('sm-title');
    const priceEl = document.getElementById('sm-price');
    const gridEl = document.getElementById('sm-grid');

    if (imgEl) {
      imgEl.src = product.images[0] || '';
      imgEl.alt = product.name;
    }
    if (skuEl) skuEl.textContent = product.sku;
    if (titleEl) titleEl.textContent = product.name;
    if (priceEl) priceEl.textContent = formatBDT(product.price);

    if (gridEl) {
      const stockMap = STORE.getProductStockMap(product.id);
      gridEl.innerHTML = (product.sizes || [])
        .map((size) => {
          const stock = stockMap[size] || 0;
          const inBill = getInBillQty(product.id, size);
          const remaining = Math.max(0, stock - inBill);
          const disabled = remaining <= 0;
          const stockCls = stock === 0 ? ' is-out' : stock <= 2 ? ' is-low' : '';
          const stockText =
            stock === 0
              ? '0 OOS'
              : inBill > 0 && remaining === 0
              ? `Max (${stock})`
              : `${stock} left`;
          return `
            <button
              type="button"
              class="sm-size-btn${stock === 0 ? ' is-oos' : ''}"
              data-sm-size="${escapeHtml(size)}"
              ${disabled ? 'disabled' : ''}
            >
              <span class="sm-size-label">${escapeHtml(size)}</span>
              <span class="sm-size-stock${stockCls}">${escapeHtml(stockText)}</span>
            </button>
          `;
        })
        .join('');
    }

    openModal('size-matrix');
  }

  function addItemToBill(productId, size, sourceLabel = '') {
    const product = getProductById(productId);
    if (!product) return false;
    const cleanSize = String(size);
    const liveStock = STORE.getStock(product.id, cleanSize);
    const existing = state.draft.items.find((it) => it.productId === product.id && it.size === cleanSize);
    const currentQty = existing ? existing.qty : 0;

    if (liveStock <= 0) {
      playBeep('error');
      showScanToast(`Out of stock: ${product.name} (Size ${cleanSize})`, true);
      return false;
    }

    if (currentQty >= liveStock) {
      playBeep('error');
      showScanToast(`Stock limit reached: only ${liveStock} left in Size ${cleanSize}.`, true);
      return false;
    }

    if (existing) {
      existing.qty += 1;
    } else {
      state.draft.items.push({ productId: product.id, size: cleanSize, qty: 1 });
    }

    setBillError('');
    saveDraft();
    renderActiveBill();
    playBeep('success');

    const sku = STORE.getVariantSku(product, cleanSize);
    const prefix = sourceLabel ? `${sourceLabel} ` : 'Added ';
    showScanToast(`${prefix}${sku} · ${product.name} (Size ${cleanSize})`, false);
    return true;
  }

  function handleBarcodeScan(rawCode, isDemo = false) {
    const code = String(rawCode || '').trim().toUpperCase();
    if (!code) return false;

    const match = STORE.findVariantByCode(code);
    if (!match) {
      playBeep('error');
      showScanToast(`Unknown barcode / SKU: ${code}`, true);
      return false;
    }

    return addItemToBill(match.product.id, match.size, isDemo ? 'Scanned' : 'Scanned');
  }

  function triggerScanDemo() {
    // Try priority flagship SKUs starting with LIS-AJ4-GRY-42, cycling to next in-stock variant
    const orderedCandidates = [];
    for (let i = 0; i < SCAN_DEMO_PRIORITY.length; i += 1) {
      const idx = (state.scanDemoCursor + i) % SCAN_DEMO_PRIORITY.length;
      orderedCandidates.push(SCAN_DEMO_PRIORITY[idx]);
    }

    for (let i = 0; i < orderedCandidates.length; i += 1) {
      const code = orderedCandidates[i];
      const match = STORE.findVariantByCode(code);
      if (match && match.stock > getInBillQty(match.product.id, match.size)) {
        state.scanDemoCursor = (SCAN_DEMO_PRIORITY.indexOf(code) + 1) % SCAN_DEMO_PRIORITY.length;
        handleBarcodeScan(code, true);
        return;
      }
    }

    // Fallback: scan any remaining in-stock variant across catalog
    for (let i = 0; i < PRODUCTS.length; i += 1) {
      const p = PRODUCTS[i];
      for (let j = 0; j < p.sizes.length; j += 1) {
        const s = p.sizes[j];
        if (STORE.getStock(p.id, s) > getInBillQty(p.id, s)) {
          handleBarcodeScan(STORE.getVariantSku(p, s), true);
          return;
        }
      }
    }

    playBeep('error');
    showScanToast('All demo inventory is currently in the active bill or sold out.', true);
  }

  function computeBillFinancials() {
    let subtotal = 0;
    let totalQty = 0;

    state.draft.items.forEach((it) => {
      const p = getProductById(it.productId);
      if (!p) return;
      subtotal += p.price * it.qty;
      totalQty += it.qty;
    });

    const rawDisc = Math.max(0, Number(state.draft.discountInput) || 0);
    let discountAmount = 0;
    if (subtotal > 0 && rawDisc > 0) {
      if (state.draft.discountType === 'percent') {
        const pct = Math.min(100, rawDisc);
        discountAmount = Math.round((subtotal * pct) / 100);
      } else {
        discountAmount = Math.min(subtotal, Math.round(rawDisc));
      }
    }

    const netTotal = Math.max(0, subtotal - discountAmount);
    const effectiveDiscPct = subtotal > 0 ? (discountAmount / subtotal) * 100 : 0;

    return { subtotal, totalQty, discountAmount, netTotal, effectiveDiscPct };
  }

  function renderCustomerLookupBadge() {
    const badge = document.getElementById('pos-cust-badge');
    const nameInput = document.getElementById('pos-cust-name');
    if (!badge) return;

    const phone = STORE.normalizePhone(state.draft.customerPhone);
    if (phone.length < 10) {
      badge.hidden = true;
      badge.classList.remove('has-rto');
      return;
    }

    const found = STORE.lookupCustomerByPhone(phone);
    if (!found) {
      badge.hidden = true;
      badge.classList.remove('has-rto');
      return;
    }

    if (nameInput && !state.draft.customerName.trim() && found.name) {
      state.draft.customerName = found.name;
      nameInput.value = found.name;
      saveDraft();
    }

    const rtoPart = found.rtoCount > 0 ? ` · ⚠ ${found.rtoCount} Past Return (RTO)` : '';
    badge.textContent = `Returning Customer: ${found.name} · ${found.orderCount} ${found.orderCount === 1 ? 'order' : 'orders'} (${formatBDT(found.totalSpent)})${rtoPart}`;
    badge.classList.toggle('has-rto', found.rtoCount > 0);
    badge.hidden = false;
  }

  function renderPaymentPanels(netTotal) {
    const mode = state.draft.payMode || 'cash';

    document.querySelectorAll('.pay-mode-btn[data-pay-mode]').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.payMode === mode);
    });

    const cashPanel = document.getElementById('pay-panel-cash');
    const mfsPanel = document.getElementById('pay-panel-mfs');
    const splitPanel = document.getElementById('pay-panel-split');

    if (cashPanel) cashPanel.hidden = mode !== 'cash';
    if (mfsPanel) mfsPanel.hidden = !(mode === 'bkash' || mode === 'nagad' || mode === 'card');
    if (splitPanel) splitPanel.hidden = mode !== 'split';

    if (mode === 'cash') {
      const tendered = Math.max(0, Number(state.draft.cashTendered) || 0);
      const change = tendered >= netTotal && netTotal > 0 ? tendered - netTotal : 0;
      const changeEl = document.getElementById('pos-change-due');
      if (changeEl) changeEl.textContent = formatBDT(change);
    } else if (mode === 'bkash' || mode === 'nagad' || mode === 'card') {
      const labelEl = document.getElementById('pos-mfs-label');
      const labels = {
        bkash: 'bKash TrxID / Last 4 Digits (Optional)',
        nagad: 'Nagad TrxID / Last 4 Digits (Optional)',
        card: 'Card Slip / Last 4 Digits (Optional)',
      };
      if (labelEl) labelEl.textContent = labels[mode] || labels.bkash;
    } else if (mode === 'split') {
      const splitCash = Math.max(0, Math.round(Number(state.draft.splitCash) || 0));
      const splitMfs = Math.max(0, Math.round(Number(state.draft.splitMfsAmount) || 0));
      const remaining = netTotal - (splitCash + splitMfs);
      const bar = document.getElementById('pos-split-remaining');
      if (bar) {
        if (netTotal > 0 && remaining === 0) {
          bar.textContent = 'Split Balanced · ৳0 Remaining';
          bar.classList.add('is-settled');
        } else if (remaining > 0) {
          bar.textContent = `Remaining Due: ${formatBDT(remaining)}`;
          bar.classList.remove('is-settled');
        } else if (remaining < 0) {
          bar.textContent = `Overpaid by ${formatBDT(Math.abs(remaining))}`;
          bar.classList.remove('is-settled');
        } else {
          bar.textContent = 'Remaining Due: ৳0';
          bar.classList.remove('is-settled');
        }
      }
    }
  }

  function syncBillInputsFromState() {
    const setVal = (id, val) => {
      const el = document.getElementById(id);
      if (el && el.value !== String(val ?? '')) {
        el.value = String(val ?? '');
      }
    };
    setVal('pos-cust-phone', state.draft.customerPhone);
    setVal('pos-cust-name', state.draft.customerName);
    setVal('pos-disc-input', state.draft.discountInput);
    setVal('pos-cash-tendered', state.draft.cashTendered);
    setVal('pos-mfs-ref', state.draft.mfsRef);
    setVal('pos-split-cash', state.draft.splitCash);
    setVal('pos-split-mfs-method', state.draft.splitMfsMethod || 'bkash');
    setVal('pos-split-mfs-amount', state.draft.splitMfsAmount);
    setVal('pos-split-ref', state.draft.splitRef);

    document.querySelectorAll('.disc-type-btn[data-disc-type]').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.discType === state.draft.discountType);
    });
  }

  function renderActiveBill() {
    const emptyEl = document.getElementById('pos-cart-empty');
    const listEl = document.getElementById('pos-cart-items');
    const recallBtn = document.getElementById('pos-recall-btn');
    const subtotalEl = document.getElementById('pos-subtotal');
    const discRow = document.getElementById('pos-discount-row');
    const discVal = document.getElementById('pos-discount-val');
    const discWarn = document.getElementById('pos-disc-warning');
    const netEl = document.getElementById('pos-net-total');
    const completeBtn = document.getElementById('pos-complete-btn');
    const mobileCount = document.getElementById('pos-mobile-bill-count');
    const mobileSummary = document.getElementById('pos-mobile-sticky-summary');

    // Clamp cart quantities silently if stock dropped in another tab
    let clamped = false;
    state.draft.items = state.draft.items.filter((it) => {
      const avail = STORE.getStock(it.productId, it.size);
      if (avail <= 0) {
        clamped = true;
        return false;
      }
      if (it.qty > avail) {
        it.qty = avail;
        clamped = true;
      }
      return true;
    });
    if (clamped) saveDraft();

    const isEmpty = state.draft.items.length === 0;
    if (emptyEl) emptyEl.hidden = !isEmpty;
    if (listEl) {
      listEl.hidden = isEmpty;
      listEl.innerHTML = state.draft.items
        .map((it, idx) => {
          const product = getProductById(it.productId);
          if (!product) return '';
          const avail = STORE.getStock(product.id, it.size);
          return `
            <div class="bill-item">
              <img class="bill-item-img" src="${escapeHtml(product.images[0])}" alt="${escapeHtml(product.name)}">
              <div class="bill-item-info">
                <div class="bill-item-name" title="${escapeHtml(product.name)}">${escapeHtml(product.name)}</div>
                <div class="bill-item-sub">
                  <span class="bill-size-tag">Size ${escapeHtml(it.size)}</span>
                  <span class="tabular-price">${formatBDT(product.price)}</span>
                </div>
              </div>
              <div class="bill-item-right">
                <span class="bill-item-total">${formatBDT(product.price * it.qty)}</span>
                <div class="bill-qty-row">
                  <div class="bill-qty-box">
                    <button type="button" class="bill-qty-btn" data-bill-dec="${idx}" aria-label="Decrease quantity">−</button>
                    <span class="bill-qty-num">${it.qty}</span>
                    <button type="button" class="bill-qty-btn" data-bill-inc="${idx}" aria-label="Increase quantity" ${it.qty >= avail ? 'disabled' : ''}>+</button>
                  </div>
                  <button type="button" class="bill-remove-btn" data-bill-remove="${idx}" aria-label="Remove item">×</button>
                </div>
              </div>
            </div>
          `;
        })
        .join('');
    }

    if (recallBtn) {
      recallBtn.textContent = `Recall (${state.heldBills.length})`;
    }

    const { subtotal, totalQty, discountAmount, netTotal, effectiveDiscPct } = computeBillFinancials();

    if (subtotalEl) subtotalEl.textContent = formatBDT(subtotal);
    if (discRow) discRow.hidden = discountAmount <= 0;
    if (discVal) discVal.textContent = `-${formatBDT(discountAmount)}`;
    if (discWarn) discWarn.hidden = !(discountAmount > 0 && effectiveDiscPct > 15);
    if (netEl) netEl.textContent = formatBDT(netTotal);
    if (completeBtn) completeBtn.disabled = isEmpty;
    if (mobileCount) mobileCount.textContent = String(totalQty);
    if (mobileSummary) {
      mobileSummary.textContent = `${totalQty} ${totalQty === 1 ? 'item' : 'items'} · ${formatBDT(netTotal)}`;
    }

    syncBillInputsFromState();
    renderCustomerLookupBadge();
    renderPaymentPanels(netTotal);
  }

  function holdActiveBill() {
    if (state.draft.items.length === 0) {
      showScanToast('Active bill is empty — nothing to park.', true);
      return;
    }
    state.heldBills.unshift(Object.assign({}, state.draft, { parkedAt: new Date().toISOString() }));
    state.draft = createEmptyDraft();
    saveHeldBills();
    saveDraft();
    setBillError('');
    renderActiveBill();
    playBeep('success');
    showScanToast(`Bill parked (${state.heldBills.length} held). Press Recall anytime.`, false);
  }

  function recallHeldBill() {
    if (state.heldBills.length === 0) {
      showScanToast('No parked bills to recall.', true);
      return;
    }
    const recalled = state.heldBills.shift();
    if (state.draft.items.length > 0) {
      state.heldBills.push(Object.assign({}, state.draft, { parkedAt: new Date().toISOString() }));
    }
    state.draft = Object.assign(createEmptyDraft(), recalled);
    delete state.draft.parkedAt;
    saveHeldBills();
    saveDraft();
    setBillError('');
    renderActiveBill();
    playBeep('success');
    showScanToast('Parked bill recalled to counter.', false);
  }

  function clearActiveBill() {
    state.draft = createEmptyDraft();
    saveDraft();
    setBillError('');
    renderActiveBill();
  }

  function completePosSale() {
    setBillError('');
    if (state.draft.items.length === 0) {
      setBillError('Add at least one item before completing the sale.');
      return;
    }

    const { discountAmount, netTotal } = computeBillFinancials();
    const mode = state.draft.payMode || 'cash';
    let payments = [];
    let paidAmount = netTotal;
    let changeDue = 0;

    if (mode === 'cash') {
      const rawTendered = String(state.draft.cashTendered || '').trim();
      const tendered = rawTendered === '' ? netTotal : Math.round(Number(rawTendered) || 0);
      if (tendered < netTotal) {
        setBillError(`Cash received (${formatBDT(tendered)}) is less than Net Payable (${formatBDT(netTotal)}).`);
        playBeep('error');
        return;
      }
      paidAmount = tendered;
      changeDue = Math.max(0, tendered - netTotal);
      payments = [{ method: 'cash', amount: netTotal, ref: '' }];
    } else if (mode === 'bkash' || mode === 'nagad' || mode === 'card') {
      payments = [{ method: mode, amount: netTotal, ref: String(state.draft.mfsRef || '').trim() }];
    } else if (mode === 'split') {
      const cashPart = Math.max(0, Math.round(Number(state.draft.splitCash) || 0));
      const mfsPart = Math.max(0, Math.round(Number(state.draft.splitMfsAmount) || 0));
      const mfsMethod = state.draft.splitMfsMethod || 'bkash';
      const ref = String(state.draft.splitRef || '').trim();

      if (cashPart + mfsPart !== netTotal) {
        setBillError(`Split amounts (${formatBDT(cashPart + mfsPart)}) must equal Net Payable (${formatBDT(netTotal)}). Tap "Auto-Fill Rest".`);
        playBeep('error');
        return;
      }
      if (cashPart > 0) payments.push({ method: 'cash', amount: cashPart, ref: '' });
      if (mfsPart > 0) payments.push({ method: mfsMethod, amount: mfsPart, ref });
      paidAmount = netTotal;
      changeDue = 0;
    }

    const itemsPayload = state.draft.items.map((it) => {
      const product = getProductById(it.productId);
      return {
        productId: it.productId,
        name: product ? product.name : it.productId,
        size: it.size,
        qty: it.qty,
        price: product ? product.price : 0,
        image: product && product.images ? product.images[0] : '',
      };
    });

    const shift = STORE.getShift();
    const res = STORE.commitSale({
      channel: 'pos',
      items: itemsPayload,
      customerName: state.draft.customerName.trim() || 'Walk-in Customer',
      customerPhone: STORE.normalizePhone(state.draft.customerPhone),
      discountType: discountAmount > 0 ? state.draft.discountType : null,
      discountAmount,
      paymentMethod: mode,
      payments,
      paidAmount,
      changeDue,
      cashier: shift.cashier || 'Emran (Owner)',
    });

    if (!res || !res.ok) {
      setBillError((res && res.error) || 'Could not complete sale due to stock mismatch.');
      playBeep('error');
      return;
    }

    playBeep('success');
    state.draft = createEmptyDraft();
    saveDraft();
    refreshAllViews();
    openPrintModal('receipt', res.order.orderNumber);
  }

  /* ==========================================================================
     TAB 2: UNIFIED ONLINE ORDERS & SHOWROOM LEDGER
     ========================================================================== */

  const STATUS_LABELS = {
    pending: 'Pending Online',
    confirmed: 'Confirmed',
    packed: 'Packed',
    shipped: 'Shipped',
    delivered: 'Delivered',
    completed: 'Completed (POS)',
    cancelled: 'Cancelled',
    returned: 'Returned (RTO)',
  };

  const NEXT_STAGE_MAP = {
    pending: { next: 'confirmed', label: 'Confirm Order' },
    confirmed: { next: 'packed', label: 'Mark Packed' },
    packed: { next: 'shipped', label: 'Mark Shipped' },
    shipped: { next: 'delivered', label: 'Mark Delivered' },
  };

  function buildOrderWhatsAppLink(order) {
    const cleanPhone = STORE.normalizePhone(order.customerPhone);
    const waNum = cleanPhone.startsWith('01') ? `88${cleanPhone}` : cleanPhone;
    const itemSummary = (order.items || [])
      .map((it) => `${it.name} (Size ${it.size} x ${it.qty})`)
      .join(', ');
    const msg = `Assalamu Alaikum ${order.customerName}, this is Life In Shop confirming your order ${order.orderNumber}: ${itemSummary}. Total Payable: ${formatBDT(order.grandTotal)} (${order.zone === 'outside' ? 'Outside Dhaka' : 'Inside Dhaka'} COD). Please reply YES to confirm dispatch.`;
    return `https://wa.me/${waNum}?text=${encodeURIComponent(msg)}`;
  }

  function renderOrdersView() {
    const metrics = STORE.getShiftMetrics();
    const setText = (id, text) => {
      const el = document.getElementById(id);
      if (el) el.textContent = text;
    };

    setText('kpi-pending', String(metrics.onlinePendingCount));
    setText('kpi-confirmed', String(metrics.onlineConfirmedCount + metrics.onlinePackedCount));
    setText('kpi-shipped', String(metrics.onlineShippedCount));
    setText('kpi-pos-sales', formatBDT(metrics.posTotal));
    setText('kpi-total-rev', formatBDT(metrics.totalRevenue));

    document.querySelectorAll('#orders-filter-tabs [data-order-filter]').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.orderFilter === state.orderFilter);
    });

    const listEl = document.getElementById('orders-list');
    if (!listEl) return;

    const q = state.orderSearch.trim().toLowerCase();
    const orders = STORE.getOrders().filter((o) => {
      const f = state.orderFilter;
      if (f === 'pos' && o.channel !== 'pos') return false;
      else if (f === 'cancelled_returned' && o.status !== 'cancelled' && o.status !== 'returned') return false;
      else if (f !== 'all' && f !== 'pos' && f !== 'cancelled_returned') {
        if (o.channel !== 'online' || o.status !== f) return false;
      }

      if (!q) return true;
      const itemsText = (o.items || []).map((it) => `${it.name} ${it.sku} ${it.size}`).join(' ');
      const haystack = [o.orderNumber, o.customerName, o.customerPhone, o.address, itemsText]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });

    if (orders.length === 0) {
      listEl.innerHTML = `<div class="pos-grid-empty">No orders match this filter.</div>`;
      return;
    }

    listEl.innerHTML = orders
      .map((order) => {
        const isPos = order.channel === 'pos';
        const statusLabel = STATUS_LABELS[order.status] || order.status;
        const rtoBadge =
          order.rtoCount > 0
            ? `<span class="rto-pill">⚠ ${order.rtoCount} Past Return (RTO)</span>`
            : '';

        const phoneClean = STORE.normalizePhone(order.customerPhone);
        const contactsHtml = phoneClean
          ? `
            <div class="order-customer-contacts">
              <a href="tel:+88${escapeHtml(phoneClean)}" class="order-tel-link">${escapeHtml(phoneClean)}</a>
              ${
                !isPos
                  ? `<a href="${escapeHtml(buildOrderWhatsAppLink(order))}" target="_blank" rel="noopener" class="order-wa-link">WhatsApp Confirm ↗</a>`
                  : ''
              }
            </div>
          `
          : '';

        const itemsHtml = (order.items || [])
          .map(
            (it) => `
              <div class="order-item-line">
                <img src="${escapeHtml(it.image || '')}" alt="${escapeHtml(it.name)}" loading="lazy">
                <div>
                  <strong>${escapeHtml(it.name)}</strong><br>
                  <span style="color:var(--ink-muted);font-size:11.5px;">Size ${escapeHtml(it.size)} × ${it.qty} · ${escapeHtml(it.sku)} · ${formatBDT(it.price * it.qty)}</span>
                </div>
              </div>
            `
          )
          .join('');

        const exchangesHtml = (order.exchanges || [])
          .map(
            (ex) =>
              `<span class="order-exchange-tag">Exchanged: Size ${escapeHtml(ex.fromSize)} → Size ${escapeHtml(ex.toSize)}</span>`
          )
          .join(' ');

        let payMeta = '';
        if (isPos) {
          const parts = (order.payments || [])
            .map((p) => `${p.method.toUpperCase()} ${formatBDT(p.amount)}${p.ref ? ` (${p.ref})` : ''}`)
            .join(' + ');
          payMeta = `${parts || order.paymentMethod.toUpperCase()}${order.discountAmount > 0 ? ` · Disc -${formatBDT(order.discountAmount)}` : ''}`;
        } else {
          const zoneText = order.zone === 'outside' ? `Outside Dhaka (${formatBDT(order.deliveryFee)})` : `Inside Dhaka (${formatBDT(order.deliveryFee)})`;
          payMeta = `${zoneText} · ${order.paymentMethod === 'bkash' ? 'bKash/Nagad' : 'COD'} (${order.paymentStatus})`;
        }

        // Workflow Action Buttons
        const actionBtns = [];
        if (isPos) {
          actionBtns.push(
            `<button type="button" class="order-act-btn is-primary" data-order-print-receipt="${escapeHtml(order.orderNumber)}">80mm Receipt</button>`
          );
          if (order.status !== 'cancelled' && order.status !== 'returned') {
            actionBtns.push(
              `<button type="button" class="order-act-btn" data-order-exchange="${escapeHtml(order.orderNumber)}">Size Exchange</button>`
            );
          }
        } else {
          const stage = NEXT_STAGE_MAP[order.status];
          if (stage) {
            actionBtns.push(
              `<button type="button" class="order-act-btn is-primary" data-order-advance="${escapeHtml(order.orderNumber)}" data-next-status="${escapeHtml(stage.next)}">${escapeHtml(stage.label)}</button>`
            );
          }
          actionBtns.push(
            `<button type="button" class="order-act-btn" data-order-print-slip="${escapeHtml(order.orderNumber)}">Packing Slip (A4)</button>`
          );
          if (order.status !== 'cancelled' && order.status !== 'returned') {
            actionBtns.push(
              `<button type="button" class="order-act-btn" data-order-exchange="${escapeHtml(order.orderNumber)}">Size Exchange</button>`
            );
          }
          if (order.status === 'pending' || order.status === 'confirmed' || order.status === 'packed') {
            actionBtns.push(
              `<button type="button" class="order-act-btn is-danger" data-order-return="${escapeHtml(order.orderNumber)}" data-return-status="cancelled">Cancel &amp; Restock</button>`
            );
          } else if (order.status === 'shipped' || order.status === 'delivered') {
            actionBtns.push(
              `<button type="button" class="order-act-btn is-danger" data-order-return="${escapeHtml(order.orderNumber)}" data-return-status="returned">Receive Return</button>`
            );
          } else if (order.stockRestockedAt) {
            const restockLabel = order.damagedReturn
              ? 'Damaged — Not Restocked'
              : 'Stock Auto-Restocked';
            actionBtns.push(
              `<span style="font-size:11.5px;font-weight:600;color:var(--ink-muted);margin-left:auto;">✓ ${restockLabel}</span>`
            );
          }
        }

        return `
          <article class="order-card">
            <div class="order-card-top">
              <div class="order-id-group">
                <span class="order-number">${escapeHtml(order.orderNumber)}</span>
                <span class="channel-pill ${isPos ? 'is-pos' : 'is-online'}">${isPos ? 'Showroom POS' : 'Online COD'}</span>
                <span class="status-pill is-${escapeHtml(order.status)}">${escapeHtml(statusLabel)}</span>
                ${rtoBadge}
              </div>
              <span class="order-time">${escapeHtml(formatTimeAgo(order.createdAt))}</span>
            </div>

            <div class="order-card-body">
              <div>
                <div class="order-customer-name">${escapeHtml(order.customerName)}</div>
                ${contactsHtml}
                <div class="order-address">${escapeHtml(order.address || 'Narayanganj Showroom Counter')}</div>
                ${order.deliveryNote ? `<div class="order-note">Note: ${escapeHtml(order.deliveryNote)}</div>` : ''}
              </div>

              <div>
                <div class="order-items-list">${itemsHtml}</div>
                ${exchangesHtml}
              </div>

              <div class="order-totals-col">
                <div class="order-grand-total">${formatBDT(order.grandTotal)}</div>
                <div class="order-pay-meta">${escapeHtml(payMeta)}</div>
              </div>
            </div>

            <div class="order-card-actions">
              ${actionBtns.join('')}
            </div>
          </article>
        `;
      })
      .join('');
  }

  /* ==========================================================================
     TAB 3: LIVE VARIANT INVENTORY & DAILY SHIFT
     ========================================================================== */

  const MOVEMENT_LABELS = {
    pos_sale: 'POS Sale',
    online_order: 'Online Order',
    online_cancel_restock: 'Cancel Restock',
    courier_return_restock: 'RTO Restock',
    size_exchange_in: 'Exchange In',
    size_exchange_out: 'Exchange Out',
    purchase_in: 'Stock In',
    manual_adjust: 'Adjustment',
  };

  function renderInventoryView() {
    const shift = STORE.getShift();
    const m = STORE.getShiftMetrics();

    const summaryEl = document.getElementById('shift-summary-grid');
    if (summaryEl) {
      summaryEl.innerHTML = `
        <div class="shift-card">
          <span class="shift-card-label">Opening Float</span>
          <div class="shift-card-value">${formatBDT(m.openingCash)}</div>
          <div class="shift-card-sub">${escapeHtml(shift.shiftId)} · ${escapeHtml(shift.cashier)}</div>
        </div>
        <div class="shift-card">
          <span class="shift-card-label">Showroom Cash</span>
          <div class="shift-card-value">${formatBDT(m.posCash)}</div>
          <div class="shift-card-sub">${m.posCount} showroom ${m.posCount === 1 ? 'sale' : 'sales'}</div>
        </div>
        <div class="shift-card is-highlight">
          <span class="shift-card-label">Expected Cash Drawer</span>
          <div class="shift-card-value">${formatBDT(m.expectedDrawerCash)}</div>
          <div class="shift-card-sub">Opening Float + Cash Sales</div>
        </div>
        <div class="shift-card">
          <span class="shift-card-label">Digital Counter Tenders</span>
          <div class="shift-card-value">${formatBDT(m.posBkash + m.posNagad + m.posCard)}</div>
          <div class="shift-card-sub">bKash ${formatBDT(m.posBkash)} · Nagad ${formatBDT(m.posNagad)} · Card ${formatBDT(m.posCard)}</div>
        </div>
        <div class="shift-card">
          <span class="shift-card-label">Showroom POS Total</span>
          <div class="shift-card-value">${formatBDT(m.posTotal)}</div>
          <div class="shift-card-sub">Settled at counter</div>
        </div>
        <div class="shift-card">
          <span class="shift-card-label">Online COD Active</span>
          <div class="shift-card-value">${m.onlineActiveCount} Orders</div>
          <div class="shift-card-sub">Pending ${m.onlinePendingCount} · Conf/Pack ${m.onlineConfirmedCount + m.onlinePackedCount} · Ship ${m.onlineShippedCount}</div>
        </div>
        <div class="shift-card">
          <span class="shift-card-label">Online Delivered</span>
          <div class="shift-card-value">${formatBDT(m.onlineDeliveredRevenue)}</div>
          <div class="shift-card-sub">${m.onlineDeliveredCount} completed COD parcels</div>
        </div>
        <div class="shift-card">
          <span class="shift-card-label">Combined Revenue</span>
          <div class="shift-card-value">${formatBDT(m.totalRevenue)}</div>
          <div class="shift-card-sub">Showroom + Active/Delivered Online</div>
        </div>
      `;
    }

    const lowBtn = document.getElementById('inv-low-only-btn');
    if (lowBtn) lowBtn.classList.toggle('is-active', state.invLowOnly);

    const invListEl = document.getElementById('inventory-list');
    const countEl = document.getElementById('inv-total-skus');
    const q = state.invSearch.trim().toLowerCase();

    let totalVariantCount = 0;
    let shownVariantCount = 0;
    const groupsHtml = [];

    PRODUCTS.forEach((p) => {
      const stockMap = STORE.getProductStockMap(p.id);
      const sizes = p.sizes || [];
      totalVariantCount += sizes.length;

      const productMatches =
        !q || [p.name, p.sku, p.categoryLabel, p.colorName].join(' ').toLowerCase().includes(q);

      const matchingSizes = sizes.filter((s) => {
        const sku = STORE.getVariantSku(p, s);
        const qty = stockMap[s] || 0;
        if (state.invLowOnly && qty > 2) return false;
        if (productMatches) return true;
        return sku.toLowerCase().includes(q) || String(s).toLowerCase() === q;
      });

      if (matchingSizes.length === 0) return;
      shownVariantCount += matchingSizes.length;

      const cellsHtml = matchingSizes
        .map((size) => {
          const sku = STORE.getVariantSku(p, size);
          const qty = stockMap[size] || 0;
          const stockCls = qty === 0 ? ' is-out' : qty <= 2 ? ' is-low' : '';
          return `
            <div class="inv-variant-cell">
              <div class="inv-var-label">
                <span class="inv-var-size">Size ${escapeHtml(size)}</span>
                <span class="inv-var-stock${stockCls}">${qty === 0 ? '0 OOS' : `${qty} left`}</span>
              </div>
              <div class="inv-adjust-btns" role="group" aria-label="Adjust stock for ${escapeHtml(sku)}">
                <button type="button" class="inv-adj-btn" data-inv-prod="${escapeHtml(p.id)}" data-inv-size="${escapeHtml(size)}" data-inv-delta="-1" ${qty <= 0 ? 'disabled' : ''}>-1</button>
                <button type="button" class="inv-adj-btn" data-inv-prod="${escapeHtml(p.id)}" data-inv-size="${escapeHtml(size)}" data-inv-delta="1">+1</button>
                <button type="button" class="inv-adj-btn" data-inv-prod="${escapeHtml(p.id)}" data-inv-size="${escapeHtml(size)}" data-inv-delta="5">+5</button>
              </div>
            </div>
          `;
        })
        .join('');

      groupsHtml.push(`
        <div class="inv-product-group">
          <div class="inv-product-head">
            <img src="${escapeHtml(p.images[0])}" alt="${escapeHtml(p.name)}" loading="lazy">
            <div>
              <div class="inv-product-name">${escapeHtml(p.name)}</div>
              <div class="inv-product-sku">${escapeHtml(p.sku)} · ${escapeHtml(p.categoryLabel)} · ${formatBDT(p.price)}</div>
            </div>
          </div>
          <div class="inv-variant-grid">${cellsHtml}</div>
        </div>
      `);
    });

    if (countEl) {
      countEl.textContent =
        shownVariantCount === totalVariantCount
          ? `${totalVariantCount} Variant SKUs`
          : `${shownVariantCount} of ${totalVariantCount} SKUs`;
    }

    if (invListEl) {
      invListEl.innerHTML =
        groupsHtml.length > 0
          ? groupsHtml.join('')
          : `<div class="pos-grid-empty">No matching variant SKUs found.</div>`;
    }

    // Immutable Stock Movements Audit Log
    const movEl = document.getElementById('movements-list');
    if (movEl) {
      const movements = STORE.getMovements().slice(0, 60);
      if (movements.length === 0) {
        movEl.innerHTML = `<div class="pos-grid-empty">No stock movements logged yet.</div>`;
      } else {
        movEl.innerHTML = movements
          .map((mv) => {
            const label = MOVEMENT_LABELS[mv.type] || mv.type;
            const deltaText = mv.qtyDelta > 0 ? `+${mv.qtyDelta}` : String(mv.qtyDelta);
            const deltaCls = mv.qtyDelta > 0 ? ' is-pos' : mv.qtyDelta < 0 ? ' is-neg' : '';
            return `
              <div class="movement-row">
                <div class="movement-top">
                  <span class="movement-type">${escapeHtml(label)}</span>
                  <span class="movement-delta${deltaCls}">${escapeHtml(deltaText)} (${mv.stockBefore} → ${mv.stockAfter})</span>
                </div>
                <div class="movement-meta">
                  <strong>${escapeHtml(mv.sku)}</strong> · ${escapeHtml(mv.productName)} (Size ${escapeHtml(mv.size)})${mv.refOrder ? ` · <strong>${escapeHtml(mv.refOrder)}</strong>` : ''}
                </div>
                <div class="movement-time">${escapeHtml(mv.note)} · ${escapeHtml(formatTimeAgo(mv.createdAt))}</div>
              </div>
            `;
          })
          .join('');
      }
    }
  }

  /* ==========================================================================
     MODALS: 7-Day Size Exchange, Cancel/Return Restock, Receipt / A4 Print
     ========================================================================== */

  function openExchangeModal(orderNumber) {
    const order = STORE.getOrderById(orderNumber);
    if (!order || !order.items || !order.items.length) return;

    const itemIndex = 0;
    const item = order.items[itemIndex];
    const product = getProductById(item.productId);
    if (!product) return;

    state.exchangeCtx = { orderNumber: order.orderNumber, itemIndex, selectedSize: null };

    const infoEl = document.getElementById('ex-order-info');
    const curEl = document.getElementById('ex-current-item');
    const gridEl = document.getElementById('ex-size-grid');
    const errEl = document.getElementById('ex-error');
    const confirmBtn = document.getElementById('ex-confirm-btn');

    if (infoEl) {
      infoEl.innerHTML = `<strong>${escapeHtml(order.orderNumber)}</strong> · ${escapeHtml(order.customerName)}${order.customerPhone ? ` (${escapeHtml(order.customerPhone)})` : ''}`;
    }
    if (curEl) {
      curEl.textContent = `Current Item: ${item.name} — Size ${item.size} (Qty ${item.qty})`;
    }
    if (errEl) {
      errEl.textContent = '';
      errEl.hidden = true;
    }
    if (confirmBtn) confirmBtn.disabled = true;

    if (gridEl) {
      const stockMap = STORE.getProductStockMap(product.id);
      gridEl.innerHTML = (product.sizes || [])
        .map((size) => {
          const isCurrent = String(size) === String(item.size);
          const avail = stockMap[size] || 0;
          const disabled = isCurrent || avail < item.qty;
          const stockCls = avail === 0 ? ' is-out' : avail <= 2 ? ' is-low' : '';
          const note = isCurrent ? 'Current' : avail === 0 ? '0 OOS' : `${avail} left`;
          return `
            <button
              type="button"
              class="sm-size-btn${avail === 0 && !isCurrent ? ' is-oos' : ''}"
              data-ex-size="${escapeHtml(size)}"
              ${disabled ? 'disabled' : ''}
            >
              <span class="sm-size-label">${escapeHtml(size)}</span>
              <span class="sm-size-stock${isCurrent ? '' : stockCls}">${escapeHtml(note)}</span>
            </button>
          `;
        })
        .join('');
    }

    openModal('exchange');
  }

  function openReturnModal(orderNumber, targetStatus) {
    const order = STORE.getOrderById(orderNumber);
    if (!order) return;

    state.returnCtx = { orderNumber: order.orderNumber, targetStatus };

    const titleEl = document.getElementById('ret-title');
    const infoEl = document.getElementById('ret-order-info');
    const checkEl = document.getElementById('ret-damaged-check');
    const confirmBtn = document.getElementById('ret-confirm-btn');

    const isCancel = targetStatus === 'cancelled';
    if (titleEl) titleEl.textContent = isCancel ? 'Cancel & Restock Order' : 'Receive Courier Return (RTO)';
    if (confirmBtn) confirmBtn.textContent = isCancel ? 'Confirm Cancel & Update Stock' : 'Confirm Return & Update Stock';
    if (checkEl) checkEl.checked = false;

    if (infoEl) {
      const lines = (order.items || [])
        .map((it) => `<div>• ${escapeHtml(it.name)} — Size ${escapeHtml(it.size)} × ${it.qty}</div>`)
        .join('');
      infoEl.innerHTML = `
        <div style="margin-bottom:6px;"><strong>${escapeHtml(order.orderNumber)}</strong> · ${escapeHtml(order.customerName)} (${formatBDT(order.grandTotal)})</div>
        ${lines}
      `;
    }

    openModal('return');
  }

  function setPrintBodyMode(modeClass) {
    document.body.classList.remove('print-mode-80mm', 'print-mode-58mm', 'print-mode-a4');
    if (modeClass) document.body.classList.add(modeClass);
  }

  function renderThermalReceiptHtml(order, width) {
    const is58 = width === '58mm';
    const itemsRows = (order.items || [])
      .map(
        (it) => `
          <tr>
            <td>${escapeHtml(it.name)}<br><small>Size ${escapeHtml(it.size)} · ${escapeHtml(it.sku)}</small></td>
            <td class="r-qty">${it.qty}</td>
            <td class="r-price">${formatBDT(it.price * it.qty)}</td>
          </tr>
        `
      )
      .join('');

    const paymentRows = (order.payments || [])
      .map(
        (p) => `
          <tr>
            <td>Paid (${escapeHtml(p.method.toUpperCase())}${p.ref ? ` · ${escapeHtml(p.ref)}` : ''})</td>
            <td>${formatBDT(p.amount)}</td>
          </tr>
        `
      )
      .join('');

    return `
      <div class="receipt-paper${is58 ? ' is-58mm' : ''}">
        <div class="receipt-center">
          <div class="receipt-brand">${escapeHtml(BRAND.name)}</div>
          <div class="receipt-sub">${escapeHtml(BRAND.tagline)}</div>
          <div class="receipt-sub">Shimanto Tower, Level 6, Shop 6031<br>Jalkhuri, Narayanganj · ${escapeHtml(BRAND.phoneDisplay)}</div>
        </div>

        <div class="receipt-divider"></div>

        <div class="receipt-meta">
          <div>Invoice: <strong>${escapeHtml(order.orderNumber)}</strong></div>
          <div>Date: ${escapeHtml(formatReceiptDate(order.createdAt))}</div>
          <div>Cashier: ${escapeHtml(order.cashier || 'Emran (Owner)')}</div>
          <div>Customer: ${escapeHtml(order.customerName)}${order.customerPhone ? ` (${escapeHtml(order.customerPhone)})` : ''}</div>
        </div>

        <div class="receipt-divider"></div>

        <table class="receipt-table">
          <thead>
            <tr>
              <th>Item</th>
              <th class="r-qty">Qty</th>
              <th class="r-price">Total</th>
            </tr>
          </thead>
          <tbody>${itemsRows}</tbody>
        </table>

        <div class="receipt-divider"></div>

        <table class="receipt-totals">
          <tr><td>Subtotal</td><td>${formatBDT(order.subtotal)}</td></tr>
          ${order.discountAmount > 0 ? `<tr><td>Counter Discount</td><td>-${formatBDT(order.discountAmount)}</td></tr>` : ''}
          <tr class="receipt-grand"><td>NET TOTAL</td><td>${formatBDT(order.grandTotal)}</td></tr>
          ${paymentRows}
          ${order.paidAmount > order.grandTotal ? `<tr><td>Cash Tendered</td><td>${formatBDT(order.paidAmount)}</td></tr>` : ''}
          ${order.changeDue > 0 ? `<tr><td>Change Returned</td><td>${formatBDT(order.changeDue)}</td></tr>` : ''}
        </table>

        <div class="receipt-divider"></div>

        <div class="receipt-barcode">${renderBarcodeSvg(order.orderNumber)}</div>

        <div class="receipt-footer-note">
          7-Day Size Exchange available on unused items with original receipt.<br>
          Thank you for shopping at Life In Shop!
        </div>
      </div>
    `;
  }

  function renderA4PackingSlipHtml(order) {
    const codAmount = order.paymentStatus === 'paid' ? 0 : order.grandTotal;
    const rows = (order.items || [])
      .map(
        (it) => `
          <tr>
            <td><strong>${escapeHtml(it.name)}</strong><br><span style="color:#5C5A55;font-size:11px;">${escapeHtml(it.sku)}</span></td>
            <td>${escapeHtml(it.size)}</td>
            <td>${it.qty}</td>
            <td style="text-align:right;" class="tabular-price">${formatBDT(it.price * it.qty)}</td>
          </tr>
        `
      )
      .join('');

    return `
      <div class="packing-slip">
        <div class="slip-header">
          <div>
            <div class="slip-brand">${escapeHtml(BRAND.name)}</div>
            <div style="font-size:12px;color:#5C5A55;margin-top:2px;">Courier Dispatch &amp; Packing Slip</div>
            <div style="font-size:12px;margin-top:6px;">
              <strong>Order:</strong> ${escapeHtml(order.orderNumber)} &nbsp;|&nbsp;
              <strong>Date:</strong> ${escapeHtml(formatReceiptDate(order.createdAt))}
            </div>
          </div>
          <div class="slip-cod-box">
            <span class="slip-cod-label">${codAmount > 0 ? 'COD Collectible' : 'Prepaid / Settled'}</span>
            <span class="slip-cod-amount">${formatBDT(codAmount)}</span>
          </div>
        </div>

        <div class="slip-grid">
          <div class="slip-box">
            <div class="slip-box-title">Ship To (Customer)</div>
            <div><strong>${escapeHtml(order.customerName)}</strong></div>
            <div>Phone: <strong>${escapeHtml(order.customerPhone)}</strong></div>
            <div style="margin-top:4px;">${escapeHtml(order.address)}</div>
            <div style="margin-top:4px;font-size:11.5px;color:#5C5A55;">Zone: ${order.zone === 'outside' ? 'Outside Dhaka' : 'Inside Dhaka'} (${formatBDT(order.deliveryFee)})</div>
            ${order.deliveryNote ? `<div style="margin-top:5px;font-weight:600;">Note: ${escapeHtml(order.deliveryNote)}</div>` : ''}
          </div>
          <div class="slip-box">
            <div class="slip-box-title">Ship From (Showroom)</div>
            <div><strong>${escapeHtml(BRAND.name)}</strong></div>
            <div>${escapeHtml(BRAND.showroomAddress)}</div>
            <div style="margin-top:4px;">Hotline: ${escapeHtml(BRAND.phoneDisplay)}</div>
            <div style="margin-top:4px;font-size:11.5px;color:#5C5A55;">7-Day Size Exchange · Unused items only</div>
          </div>
        </div>

        <table class="slip-items-table">
          <thead>
            <tr>
              <th>Product &amp; SKU</th>
              <th>Size</th>
              <th>Qty</th>
              <th style="text-align:right;">Amount</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
            <tr>
              <td colspan="3" style="text-align:right;">Delivery Charge</td>
              <td style="text-align:right;" class="tabular-price">${formatBDT(order.deliveryFee)}</td>
            </tr>
            <tr>
              <td colspan="3" style="text-align:right;"><strong>Grand Total (${order.paymentMethod === 'bkash' ? 'bKash/Nagad' : 'COD'})</strong></td>
              <td style="text-align:right;" class="tabular-price"><strong>${formatBDT(order.grandTotal)}</strong></td>
            </tr>
          </tbody>
        </table>

        <div class="receipt-barcode">${renderBarcodeSvg(order.orderNumber)}</div>
      </div>
    `;
  }

  function renderPrintPreview() {
    if (!state.printCtx) return;
    const order = STORE.getOrderById(state.printCtx.orderNumber);
    if (!order) return;

    const titleEl = document.getElementById('print-modal-title');
    const toggleEl = document.getElementById('print-width-toggle');
    const previewEl = document.getElementById('print-preview-area');
    const newSaleBtn = document.getElementById('print-new-sale-btn');

    if (state.printCtx.type === 'slip') {
      if (titleEl) titleEl.textContent = `A4 Courier Packing Slip · ${order.orderNumber}`;
      if (toggleEl) toggleEl.hidden = true;
      if (newSaleBtn) newSaleBtn.textContent = 'Close Preview';
      setPrintBodyMode('print-mode-a4');
      if (previewEl) previewEl.innerHTML = renderA4PackingSlipHtml(order);
    } else {
      const width = state.printCtx.width || '80mm';
      if (titleEl) titleEl.textContent = `Thermal Receipt · ${order.orderNumber}`;
      if (toggleEl) {
        toggleEl.hidden = false;
        toggleEl.querySelectorAll('[data-print-width]').forEach((btn) => {
          btn.classList.toggle('is-active', btn.dataset.printWidth === width);
        });
      }
      if (newSaleBtn) newSaleBtn.textContent = state.workspaceTab === 'pos' ? 'New Sale' : 'Close';
      setPrintBodyMode(width === '58mm' ? 'print-mode-58mm' : 'print-mode-80mm');
      if (previewEl) previewEl.innerHTML = renderThermalReceiptHtml(order, width);
    }
  }

  function openPrintModal(type, orderNumber) {
    state.printCtx = {
      type,
      orderNumber,
      width: (state.printCtx && state.printCtx.width) || '80mm',
    };
    renderPrintPreview();
    openModal('print');
  }

  /* ==========================================================================
     Refresh All Live Views
     ========================================================================== */

  function refreshAllViews() {
    updatePendingBadge();
    renderPosCategoryTabs();
    renderPosCatalogGrid();
    renderActiveBill();

    if (state.workspaceTab === 'orders') {
      renderOrdersView();
    } else if (state.workspaceTab === 'inventory') {
      renderInventoryView();
    }

    if (state.activeModal === 'size-matrix' && state.sizeMatrixProductId) {
      openSizeMatrixModal(state.sizeMatrixProductId);
    }
  }

  /* ==========================================================================
     Event Bindings & Global HID Barcode Scanner Listener
     ========================================================================== */

  function initEvents() {
    // Top workspace tabs
    document.getElementById('pos-workspace-tabs')?.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-workspace-tab]');
      if (!btn) return;
      setWorkspaceTab(btn.dataset.workspaceTab, { updateUrl: true });
    });

    // Mobile catalog/bill switcher + sticky bar button
    document.getElementById('pos-mobile-tabs')?.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-pos-pane]');
      if (!btn) return;
      setMobilePane(btn.dataset.posPane);
    });

    document.getElementById('pos-mobile-sticky-bill')?.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-pos-pane]');
      if (!btn) return;
      setMobilePane(btn.dataset.posPane);
    });

    // POS Search & Scan
    const searchInput = document.getElementById('pos-search-input');
    searchInput?.addEventListener('input', () => {
      state.posSearch = searchInput.value;
      renderPosCatalogGrid();
    });

    searchInput?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        const val = searchInput.value.trim();
        if (!val) return;
        const match = STORE.findVariantByCode(val);
        if (match) {
          event.preventDefault();
          event.stopPropagation();
          handleBarcodeScan(val, false);
          searchInput.value = '';
          state.posSearch = '';
          renderPosCatalogGrid();
        }
      }
    });

    document.getElementById('pos-scan-demo-btn')?.addEventListener('click', () => triggerScanDemo());

    // POS Category tabs
    document.getElementById('pos-category-tabs')?.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-pos-cat]');
      if (!btn) return;
      state.posCategory = btn.dataset.posCat;
      renderPosCategoryTabs();
      renderPosCatalogGrid();
    });

    // POS Product grid -> open 1-Tap Size Matrix modal
    document.getElementById('pos-product-grid')?.addEventListener('click', (event) => {
      const card = event.target.closest('[data-pos-product]');
      if (!card) return;
      openSizeMatrixModal(card.dataset.posProduct);
    });

    // 1-Tap Size Matrix pick -> add immediately & close modal
    document.getElementById('sm-grid')?.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-sm-size]');
      if (!btn || btn.disabled || !state.sizeMatrixProductId) return;
      const ok = addItemToBill(state.sizeMatrixProductId, btn.dataset.smSize);
      if (ok) closeAllModals();
    });

    // Active Bill actions
    document.getElementById('pos-hold-btn')?.addEventListener('click', holdActiveBill);
    document.getElementById('pos-recall-btn')?.addEventListener('click', recallHeldBill);
    document.getElementById('pos-clear-btn')?.addEventListener('click', clearActiveBill);

    // Customer inputs
    const custPhoneInput = document.getElementById('pos-cust-phone');
    const custNameInput = document.getElementById('pos-cust-name');

    custPhoneInput?.addEventListener('input', () => {
      const cleaned = STORE.normalizePhone(custPhoneInput.value).slice(0, 11);
      if (custPhoneInput.value !== cleaned) custPhoneInput.value = cleaned;
      state.draft.customerPhone = cleaned;
      saveDraft();
      renderCustomerLookupBadge();
    });

    custNameInput?.addEventListener('input', () => {
      state.draft.customerName = custNameInput.value;
      saveDraft();
    });

    // Active bill cart qty/remove
    document.getElementById('pos-cart-items')?.addEventListener('click', (event) => {
      const decBtn = event.target.closest('[data-bill-dec]');
      if (decBtn) {
        const idx = parseInt(decBtn.dataset.billDec, 10);
        const item = state.draft.items[idx];
        if (!item) return;
        if (item.qty > 1) item.qty -= 1;
        else state.draft.items.splice(idx, 1);
        saveDraft();
        setBillError('');
        renderActiveBill();
        return;
      }

      const incBtn = event.target.closest('[data-bill-inc]');
      if (incBtn) {
        const idx = parseInt(incBtn.dataset.billInc, 10);
        const item = state.draft.items[idx];
        if (!item) return;
        const avail = STORE.getStock(item.productId, item.size);
        if (item.qty < avail) {
          item.qty += 1;
          saveDraft();
          setBillError('');
          renderActiveBill();
        }
        return;
      }

      const removeBtn = event.target.closest('[data-bill-remove]');
      if (removeBtn) {
        const idx = parseInt(removeBtn.dataset.billRemove, 10);
        state.draft.items.splice(idx, 1);
        saveDraft();
        setBillError('');
        renderActiveBill();
      }
    });

    // Discount toggle, input & quick pills
    document.querySelectorAll('.disc-type-btn[data-disc-type]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.draft.discountType = btn.dataset.discType;
        saveDraft();
        renderActiveBill();
      });
    });

    const discInput = document.getElementById('pos-disc-input');
    discInput?.addEventListener('input', () => {
      state.draft.discountInput = discInput.value;
      saveDraft();
      renderActiveBill();
    });

    document.querySelectorAll('[data-quick-disc]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.draft.discountType = 'fixed';
        state.draft.discountInput = btn.dataset.quickDisc;
        saveDraft();
        renderActiveBill();
      });
    });

    // Payment mode tabs
    document.querySelectorAll('.pay-mode-btn[data-pay-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.draft.payMode = btn.dataset.payMode;
        setBillError('');
        saveDraft();
        renderActiveBill();
      });
    });

    // Cash quick denominations & tendered input
    document.querySelectorAll('[data-quick-cash]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const { netTotal } = computeBillFinancials();
        const val = btn.dataset.quickCash;
        state.draft.cashTendered = val === 'exact' ? String(netTotal) : val;
        setBillError('');
        saveDraft();
        renderActiveBill();
      });
    });

    document.getElementById('pos-cash-tendered')?.addEventListener('input', (event) => {
      state.draft.cashTendered = event.target.value;
      setBillError('');
      saveDraft();
      renderPaymentPanels(computeBillFinancials().netTotal);
    });

    document.getElementById('pos-mfs-ref')?.addEventListener('input', (event) => {
      state.draft.mfsRef = event.target.value;
      saveDraft();
    });

    // Split tender inputs & Auto-Fill Rest
    document.getElementById('pos-split-cash')?.addEventListener('input', (event) => {
      state.draft.splitCash = event.target.value;
      setBillError('');
      saveDraft();
      renderPaymentPanels(computeBillFinancials().netTotal);
    });

    document.getElementById('pos-split-mfs-method')?.addEventListener('change', (event) => {
      state.draft.splitMfsMethod = event.target.value;
      saveDraft();
    });

    document.getElementById('pos-split-mfs-amount')?.addEventListener('input', (event) => {
      state.draft.splitMfsAmount = event.target.value;
      setBillError('');
      saveDraft();
      renderPaymentPanels(computeBillFinancials().netTotal);
    });

    document.getElementById('pos-split-ref')?.addEventListener('input', (event) => {
      state.draft.splitRef = event.target.value;
      saveDraft();
    });

    document.getElementById('pos-split-autofill-btn')?.addEventListener('click', () => {
      const { netTotal } = computeBillFinancials();
      const cashPart = Math.max(0, Math.round(Number(state.draft.splitCash) || 0));
      const rest = Math.max(0, netTotal - cashPart);
      state.draft.splitMfsAmount = String(rest);
      setBillError('');
      saveDraft();
      syncBillInputsFromState();
      renderPaymentPanels(netTotal);
    });

    document.getElementById('pos-complete-btn')?.addEventListener('click', completePosSale);

    // TAB 2: Orders filters, search & card actions
    document.getElementById('orders-filter-tabs')?.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-order-filter]');
      if (!btn) return;
      state.orderFilter = btn.dataset.orderFilter;
      renderOrdersView();
    });

    document.getElementById('orders-search-input')?.addEventListener('input', (event) => {
      state.orderSearch = event.target.value;
      renderOrdersView();
    });

    document.getElementById('orders-list')?.addEventListener('click', (event) => {
      const advBtn = event.target.closest('[data-order-advance]');
      if (advBtn) {
        const res = STORE.updateOnlineOrderStatus(advBtn.dataset.orderAdvance, advBtn.dataset.nextStatus);
        if (res && res.ok) {
          playBeep('success');
          refreshAllViews();
        }
        return;
      }

      const slipBtn = event.target.closest('[data-order-print-slip]');
      if (slipBtn) {
        openPrintModal('slip', slipBtn.dataset.orderPrintSlip);
        return;
      }

      const recBtn = event.target.closest('[data-order-print-receipt]');
      if (recBtn) {
        openPrintModal('receipt', recBtn.dataset.orderPrintReceipt);
        return;
      }

      const exBtn = event.target.closest('[data-order-exchange]');
      if (exBtn) {
        openExchangeModal(exBtn.dataset.orderExchange);
        return;
      }

      const retBtn = event.target.closest('[data-order-return]');
      if (retBtn) {
        openReturnModal(retBtn.dataset.orderReturn, retBtn.dataset.returnStatus);
      }
    });

    // TAB 3: Inventory search, low-only toggle, stock +/- buttons, 2-tap Reset Demo
    document.getElementById('inv-search-input')?.addEventListener('input', (event) => {
      state.invSearch = event.target.value;
      renderInventoryView();
    });

    document.getElementById('inv-low-only-btn')?.addEventListener('click', () => {
      state.invLowOnly = !state.invLowOnly;
      renderInventoryView();
    });

    document.getElementById('inventory-list')?.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-inv-delta]');
      if (!btn || btn.disabled) return;
      const delta = parseInt(btn.dataset.invDelta, 10) || 0;
      STORE.adjustVariantStock(btn.dataset.invProd, btn.dataset.invSize, delta);
      playBeep('success');
      refreshAllViews();
    });

    const resetBtn = document.getElementById('reset-demo-btn');
    resetBtn?.addEventListener('click', () => {
      if (!state.resetConfirming) {
        state.resetConfirming = true;
        resetBtn.classList.add('is-confirming');
        resetBtn.textContent = 'Click Again to Confirm Reset';
        if (state.resetTimer) clearTimeout(state.resetTimer);
        state.resetTimer = setTimeout(() => {
          state.resetConfirming = false;
          resetBtn.classList.remove('is-confirming');
          resetBtn.textContent = 'Reset Demo Data';
        }, 4000);
        return;
      }

      if (state.resetTimer) clearTimeout(state.resetTimer);
      state.resetConfirming = false;
      resetBtn.classList.remove('is-confirming');
      resetBtn.textContent = 'Reset Demo Data';

      STORE.resetDemoData();
      state.draft = createEmptyDraft();
      state.heldBills = [];
      saveDraft();
      saveHeldBills();
      refreshAllViews();
      playBeep('success');
    });

    // Exchange Modal interactions
    document.getElementById('ex-size-grid')?.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-ex-size]');
      if (!btn || btn.disabled || !state.exchangeCtx) return;
      state.exchangeCtx.selectedSize = btn.dataset.exSize;
      document.querySelectorAll('#ex-size-grid [data-ex-size]').forEach((b) => {
        b.classList.toggle('is-selected', b.dataset.exSize === state.exchangeCtx.selectedSize);
      });
      const confirmBtn = document.getElementById('ex-confirm-btn');
      if (confirmBtn) confirmBtn.disabled = false;
      const errEl = document.getElementById('ex-error');
      if (errEl) errEl.hidden = true;
    });

    document.getElementById('ex-confirm-btn')?.addEventListener('click', () => {
      if (!state.exchangeCtx || !state.exchangeCtx.selectedSize) return;
      const res = STORE.exchangeOrderItemSize(
        state.exchangeCtx.orderNumber,
        state.exchangeCtx.itemIndex,
        state.exchangeCtx.selectedSize
      );
      if (!res || !res.ok) {
        const errEl = document.getElementById('ex-error');
        if (errEl) {
          errEl.textContent = (res && res.error) || 'Could not complete size exchange.';
          errEl.hidden = false;
        }
        playBeep('error');
        return;
      }
      playBeep('success');
      closeAllModals();
      refreshAllViews();
    });

    // Cancel / Return Modal confirm
    document.getElementById('ret-confirm-btn')?.addEventListener('click', () => {
      if (!state.returnCtx) return;
      const damaged = Boolean(document.getElementById('ret-damaged-check')?.checked);
      const res = STORE.updateOnlineOrderStatus(state.returnCtx.orderNumber, state.returnCtx.targetStatus, {
        damaged,
      });
      if (res && res.ok) {
        playBeep('success');
        closeAllModals();
        refreshAllViews();
      }
    });

    // Print Modal controls
    document.getElementById('print-width-toggle')?.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-print-width]');
      if (!btn || !state.printCtx) return;
      state.printCtx.width = btn.dataset.printWidth;
      renderPrintPreview();
    });

    document.getElementById('print-trigger-btn')?.addEventListener('click', () => {
      window.print();
    });

    document.getElementById('print-new-sale-btn')?.addEventListener('click', () => {
      closeAllModals();
      if (state.workspaceTab === 'pos') {
        document.getElementById('pos-search-input')?.focus();
      }
    });

    // Modal close buttons & backdrop clicks
    ['sm-close-btn', 'ex-close-btn', 'ret-close-btn', 'print-close-btn'].forEach((id) => {
      document.getElementById(id)?.addEventListener('click', closeAllModals);
    });

    document.getElementById('pos-modal-backdrop')?.addEventListener('click', closeAllModals);

    Object.values(MODAL_IDS).forEach((id) => {
      const el = document.getElementById(id);
      el?.addEventListener('click', (event) => {
        if (event.target === el) closeAllModals();
      });
    });

    // Global HID Barcode Wedge Listener (<70ms inter-key delta + Enter) & POS Hotkeys
    let scanBuffer = '';
    let lastKeyTime = 0;

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && state.activeModal) {
        event.preventDefault();
        closeAllModals();
        return;
      }

      if (event.key === 'F2') {
        event.preventDefault();
        if (state.workspaceTab !== 'pos') setWorkspaceTab('pos', { updateUrl: true });
        setMobilePane('catalog');
        const input = document.getElementById('pos-search-input');
        input?.focus();
        input?.select();
        return;
      }

      if (event.key === 'F6' && state.workspaceTab === 'pos' && !state.activeModal) {
        event.preventDefault();
        holdActiveBill();
        return;
      }

      if (event.key === 'F10' && state.workspaceTab === 'pos' && !state.activeModal) {
        event.preventDefault();
        const disc = document.getElementById('pos-disc-input');
        disc?.focus();
        disc?.select();
        return;
      }

      if (event.key === 'F11' && state.workspaceTab === 'pos' && !state.activeModal) {
        event.preventDefault();
        state.draft.payMode = 'cash';
        saveDraft();
        renderActiveBill();
        const cash = document.getElementById('pos-cash-tendered');
        cash?.focus();
        cash?.select();
        return;
      }

      // HID Barcode Scanner detection (ignores manual form fields except #pos-search-input)
      if (state.workspaceTab !== 'pos' || state.activeModal) return;
      const target = event.target;
      const isEditable =
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT');
      if (isEditable && target.id !== 'pos-search-input') {
        scanBuffer = '';
        return;
      }

      const now = Date.now();
      if (event.key === 'Enter') {
        if (scanBuffer.length >= 5 && now - lastKeyTime < 120) {
          event.preventDefault();
          const scanned = scanBuffer;
          scanBuffer = '';
          if (target && target.id === 'pos-search-input') {
            target.value = '';
            state.posSearch = '';
            renderPosCatalogGrid();
          }
          handleBarcodeScan(scanned, false);
        } else {
          scanBuffer = '';
        }
        return;
      }

      if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        if (now - lastKeyTime > 70) {
          scanBuffer = event.key;
        } else {
          scanBuffer += event.key;
        }
        lastKeyTime = now;
      }
    });

    // Live Store Subscription (same-tab mutations + cross-tab Storefront COD orders)
    STORE.subscribe(() => {
      refreshAllViews();
    });

    window.addEventListener('pageshow', () => {
      refreshAllViews();
    });
  }

  /* ==========================================================================
     Bootstrap
     ========================================================================== */

  function init() {
    loadDraftAndHeld();
    initEvents();

    // Respect ?tab=orders / #orders or ?tab=inventory / #inventory
    let initialTab = 'pos';
    try {
      const params = new URLSearchParams(window.location.search);
      const paramTab = params.get('tab');
      const hashTab = String(window.location.hash || '').replace('#', '');
      if (paramTab === 'orders' || hashTab === 'orders') initialTab = 'orders';
      else if (paramTab === 'inventory' || hashTab === 'inventory') initialTab = 'inventory';
    } catch (_) {
      // ignore
    }

    updatePendingBadge();
    renderPosCategoryTabs();
    renderPosCatalogGrid();
    renderActiveBill();
    setWorkspaceTab(initialTab, { updateUrl: false });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
