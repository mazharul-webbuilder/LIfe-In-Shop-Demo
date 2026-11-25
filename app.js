import { BRAND, CATEGORIES, HERO_SLIDES, PRODUCTS, SIZE_CHARTS } from './data/catalog.js';

const BAG_STORAGE_KEY = 'lifeinshop_bag_v1';
const DEFAULT_PRODUCT_ID = 'air-jordan-4-grey';
const HERO_AUTOPLAY_MS = 6000;
const AI_TYPING_DELAY_MS = 450;

/* ==========================================================================
   Shared Helpers
   ========================================================================== */

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

function pad2(num) {
  return String(num).padStart(2, '0');
}

function getProductById(id) {
  return PRODUCTS.find((item) => item.id === id) || null;
}

function isMobileViewport() {
  return window.innerWidth < 768;
}

function normalizeBDPhone(raw) {
  let digits = String(raw || '').replace(/\D/g, '');
  if (digits.startsWith('8801') && digits.length >= 13) {
    digits = digits.slice(2);
  }
  return digits.slice(0, 11);
}

/* ==========================================================================
   Application State
   ========================================================================== */

const state = {
  page: document.body?.dataset?.page || 'home',
  bag: [],
  activeOverlay: null,
  lastTrigger: null,
  activeCategory: 'all',
  // Checkout
  checkoutItems: [],
  checkoutSource: 'bag', // 'bag' | 'direct'
  // PDP
  currentProduct: null,
  currentImageIndex: 0,
  selectedSize: null,
  pdpQty: 1,
  // AI Chat
  chatInitialized: false,
  chatReplyTimer: null,
};

/* ==========================================================================
   Persistent Shopping Bag (localStorage)
   ========================================================================== */

function loadBag() {
  try {
    const raw = window.localStorage.getItem(BAG_STORAGE_KEY);
    if (!raw) {
      state.bag = [];
      return;
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      state.bag = [];
      return;
    }
    state.bag = parsed
      .filter((entry) => entry && typeof entry.id === 'string' && getProductById(entry.id))
      .map((entry) => ({
        id: entry.id,
        size: String(entry.size || ''),
        qty: Math.min(10, Math.max(1, parseInt(entry.qty, 10) || 1)),
      }));
  } catch {
    state.bag = [];
  }
}

function saveBag() {
  try {
    window.localStorage.setItem(BAG_STORAGE_KEY, JSON.stringify(state.bag));
  } catch {
    // Ignore storage quota or private-mode restriction
  }
}

function getBagHydratedItems() {
  return state.bag
    .map((entry, index) => {
      const product = getProductById(entry.id);
      if (!product) return null;
      return { ...entry, index, product };
    })
    .filter(Boolean);
}

function getBagTotalCount() {
  return state.bag.reduce((sum, item) => sum + item.qty, 0);
}

function getItemsSubtotal(items) {
  return items.reduce((sum, item) => {
    const product = item.product || getProductById(item.id);
    return sum + (product ? product.price * item.qty : 0);
  }, 0);
}

function addToBag(productId, size, qty = 1) {
  const product = getProductById(productId);
  if (!product) return;
  const safeQty = Math.min(10, Math.max(1, parseInt(qty, 10) || 1));
  const existing = state.bag.find((item) => item.id === productId && item.size === size);
  if (existing) {
    existing.qty = Math.min(10, existing.qty + safeQty);
  } else {
    state.bag.push({ id: productId, size: String(size), qty: safeQty });
  }
  saveBag();
  renderBagUI();
}

function updateBagItemQty(index, delta) {
  const item = state.bag[index];
  if (!item) return;
  const nextQty = item.qty + delta;
  if (nextQty <= 0) {
    state.bag.splice(index, 1);
  } else {
    item.qty = Math.min(10, nextQty);
  }
  saveBag();
  renderBagUI();
}

function removeBagItem(index) {
  if (index < 0 || index >= state.bag.length) return;
  state.bag.splice(index, 1);
  saveBag();
  renderBagUI();
}

function clearBag() {
  state.bag = [];
  saveBag();
  renderBagUI();
}

function renderBagUI() {
  const badge = document.getElementById('bag-count-badge');
  const itemsWrap = document.getElementById('bag-items');
  const emptyState = document.getElementById('bag-empty-state');
  const footer = document.getElementById('bag-footer');
  const subtotalEl = document.getElementById('bag-subtotal');

  const count = getBagTotalCount();
  if (badge) {
    badge.textContent = String(count);
    badge.classList.toggle('is-empty', count === 0);
  }

  const hydrated = getBagHydratedItems();
  const isEmpty = hydrated.length === 0;

  if (emptyState) emptyState.hidden = !isEmpty;
  if (itemsWrap) itemsWrap.hidden = isEmpty;
  if (footer) footer.hidden = isEmpty;

  if (itemsWrap) {
    itemsWrap.innerHTML = hydrated
      .map(({ index, product, size, qty }) => {
        const href = `product.html?id=${encodeURIComponent(product.id)}`;
        const lineTotal = formatBDT(product.price * qty);
        return `
          <article class="bag-item">
            <a href="${href}">
              <img class="bag-item-img" src="${escapeHtml(product.images[0])}" alt="${escapeHtml(product.name)}" loading="lazy">
            </a>
            <div class="bag-item-info">
              <div class="bag-item-top">
                <div>
                  <a href="${href}" class="bag-item-title">${escapeHtml(product.name)}</a>
                  <p class="bag-item-meta">Size: ${escapeHtml(size)} · ${escapeHtml(product.colorName)}</p>
                </div>
                <button type="button" class="bag-item-remove" data-bag-remove="${index}">Remove</button>
              </div>
              <div class="bag-item-bottom">
                <div class="bag-qty-controls" role="group" aria-label="Adjust quantity for ${escapeHtml(product.name)}">
                  <button type="button" class="bag-qty-btn" data-bag-dec="${index}" aria-label="Decrease quantity">−</button>
                  <span class="bag-qty-num">${qty}</span>
                  <button type="button" class="bag-qty-btn" data-bag-inc="${index}" aria-label="Increase quantity">+</button>
                </div>
                <span class="bag-item-price">${lineTotal}</span>
              </div>
            </div>
          </article>
        `;
      })
      .join('');
  }

  if (subtotalEl) {
    subtotalEl.textContent = formatBDT(getItemsSubtotal(hydrated));
  }
}

/* ==========================================================================
   Unified Overlay, Backdrop, Scroll Lock & Floating Dock Manager
   ========================================================================== */

const OVERLAY_IDS = {
  'mobile-nav': 'mobile-nav-drawer',
  search: 'search-overlay',
  bag: 'bag-drawer',
  checkout: 'checkout-drawer',
  'size-guide': 'size-guide-modal',
  lightbox: 'pdp-lightbox',
  'ai-chat': 'ai-chat-panel',
};

function closeAllOverlays({ restoreFocus = true } = {}) {
  const prevOverlay = state.activeOverlay;
  const triggerToRestore = restoreFocus ? state.lastTrigger : null;

  Object.values(OVERLAY_IDS).forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.classList.remove('is-open');
      el.setAttribute('aria-hidden', 'true');
    }
  });

  const backdrop = document.getElementById('drawer-backdrop');
  if (backdrop) {
    backdrop.classList.remove('is-open');
    backdrop.setAttribute('aria-hidden', 'true');
  }

  document.body.classList.remove('scroll-locked');

  const dock = document.getElementById('floating-dock');
  if (dock) dock.classList.remove('is-hidden');

  const mobileMenuBtn = document.getElementById('mobile-menu-btn');
  if (mobileMenuBtn) mobileMenuBtn.setAttribute('aria-expanded', 'false');

  const aiTrigger = document.getElementById('ai-chat-trigger');
  if (aiTrigger) aiTrigger.setAttribute('aria-expanded', 'false');

  state.activeOverlay = null;

  if (prevOverlay && triggerToRestore && typeof triggerToRestore.focus === 'function') {
    triggerToRestore.focus({ preventScroll: true });
    state.lastTrigger = null;
  }
}

function openOverlay(name, triggerEl = null) {
  const targetId = OVERLAY_IDS[name];
  const target = targetId ? document.getElementById(targetId) : null;
  if (!target) return;

  closeAllOverlays({ restoreFocus: false });

  state.activeOverlay = name;
  state.lastTrigger = triggerEl || document.activeElement;

  target.classList.add('is-open');
  target.setAttribute('aria-hidden', 'false');

  const needsBackdrop = name !== 'lightbox' && (name !== 'ai-chat' || isMobileViewport());
  const backdrop = document.getElementById('drawer-backdrop');
  if (backdrop && needsBackdrop) {
    backdrop.classList.add('is-open');
    backdrop.setAttribute('aria-hidden', 'false');
  }

  const needsScrollLock = name !== 'ai-chat' || isMobileViewport();
  if (needsScrollLock) {
    document.body.classList.add('scroll-locked');
  }

  // Always hide floating dock whenever ANY drawer, modal, lightbox, or chat panel is open
  const dock = document.getElementById('floating-dock');
  if (dock) dock.classList.add('is-hidden');

  if (name === 'mobile-nav') {
    document.getElementById('mobile-menu-btn')?.setAttribute('aria-expanded', 'true');
  } else if (name === 'ai-chat') {
    document.getElementById('ai-chat-trigger')?.setAttribute('aria-expanded', 'true');
  }
}

/* ==========================================================================
   Shared Product Card Renderer
   ========================================================================== */

function renderProductCard(product) {
  const href = `product.html?id=${encodeURIComponent(product.id)}`;
  const primaryImg = product.images[0] || '';
  const secondaryImg = product.images.length > 1 ? product.images[1] : null;
  const hasDiscount = Boolean(product.compareAtPrice && product.compareAtPrice > product.price);
  const badgeText = product.badge || (hasDiscount ? `Save ${formatBDT(product.compareAtPrice - product.price)}` : '');

  return `
    <a href="${href}" class="product-card">
      <div class="card-media">
        <img class="card-img-primary" src="${escapeHtml(primaryImg)}" alt="${escapeHtml(product.name)}" loading="lazy">
        ${secondaryImg ? `<img class="card-img-secondary" src="${escapeHtml(secondaryImg)}" alt="" loading="lazy" aria-hidden="true">` : ''}
        ${hasDiscount ? `<span class="card-badge">${escapeHtml(badgeText)}</span>` : ''}
      </div>
      <div class="card-meta">
        <h3 class="card-title">${escapeHtml(product.name)}</h3>
        <div class="card-price-row">
          <span class="card-price">${formatBDT(product.price)}</span>
          ${hasDiscount ? `<span class="card-compare">${formatBDT(product.compareAtPrice)}</span>` : ''}
        </div>
      </div>
    </a>
  `;
}

/* ==========================================================================
   Live Search Overlay
   ========================================================================== */

function renderSearchResults(query) {
  const container = document.getElementById('search-results');
  if (!container) return;

  const q = String(query || '').trim().toLowerCase();
  const matches = q
    ? PRODUCTS.filter((p) => {
        const haystack = [p.name, p.categoryLabel, p.category, p.colorName, p.sku, p.shortDesc]
          .join(' ')
          .toLowerCase();
        return haystack.includes(q);
      })
    : PRODUCTS.filter((p) => p.featured).slice(0, 6);

  if (matches.length === 0) {
    container.innerHTML = `
      <div class="search-empty">
        No products found for &ldquo;${escapeHtml(query.trim())}&rdquo;. Try &ldquo;Jordan&rdquo;, &ldquo;Nike&rdquo;, &ldquo;Denim&rdquo;, or &ldquo;Shirt&rdquo;.
      </div>
    `;
    return;
  }

  container.innerHTML = matches
    .slice(0, 8)
    .map((product) => {
      const href = `product.html?id=${encodeURIComponent(product.id)}`;
      const priceHtml = product.compareAtPrice
        ? `${formatBDT(product.price)} <s style="color:var(--ink-muted);font-weight:400;margin-left:4px;">${formatBDT(product.compareAtPrice)}</s>`
        : formatBDT(product.price);
      return `
        <a href="${href}" class="search-result-item">
          <img src="${escapeHtml(product.images[0])}" alt="${escapeHtml(product.name)}" loading="lazy">
          <div class="search-result-info">
            <div class="search-result-name">${escapeHtml(product.name)}</div>
            <div class="search-result-price">${priceHtml}</div>
          </div>
        </a>
      `;
    })
    .join('');
}

/* ==========================================================================
   Instant 4-Field BD COD Checkout Drawer
   ========================================================================== */

function getSelectedRadioValue(name, fallback) {
  const checked = document.querySelector(`input[name="${name}"]:checked`);
  return checked ? checked.value : fallback;
}

function updateCheckoutTotals() {
  const subtotalEl = document.getElementById('co-subtotal');
  const shippingEl = document.getElementById('co-shipping');
  const totalEl = document.getElementById('co-total');

  const subtotal = getItemsSubtotal(state.checkoutItems);
  const zone = getSelectedRadioValue('co-zone', 'inside');
  const shipping = zone === 'outside' ? BRAND.shipping.outsideDhaka : BRAND.shipping.insideDhaka;
  const total = subtotal + shipping;

  if (subtotalEl) subtotalEl.textContent = formatBDT(subtotal);
  if (shippingEl) shippingEl.textContent = formatBDT(shipping);
  if (totalEl) totalEl.textContent = formatBDT(total);

  return { subtotal, shipping, total, zone };
}

function updatePaymentUI() {
  const payment = getSelectedRadioValue('co-payment', 'cod');
  const bkashNote = document.getElementById('co-bkash-note');
  const submitBtn = document.getElementById('co-submit-btn');

  if (bkashNote) bkashNote.hidden = payment !== 'bkash';
  if (submitBtn) {
    submitBtn.textContent =
      payment === 'bkash'
        ? 'Confirm Order — bKash / Nagad (Demo)'
        : 'Confirm Order — Cash on Delivery';
  }
}

function openCheckout(items, source, triggerEl = null) {
  const validItems = (items || [])
    .map((entry) => {
      const product = entry.product || getProductById(entry.id);
      if (!product) return null;
      return {
        id: product.id,
        size: String(entry.size || product.sizes[0] || ''),
        qty: Math.min(10, Math.max(1, parseInt(entry.qty, 10) || 1)),
        product,
      };
    })
    .filter(Boolean);

  if (validItems.length === 0) return;

  state.checkoutItems = validItems;
  state.checkoutSource = source;

  const form = document.getElementById('checkout-form');
  const successView = document.getElementById('checkout-success');
  const errorEl = document.getElementById('co-error');
  const summaryWrap = document.getElementById('checkout-summary-items');

  if (form) form.hidden = false;
  if (successView) successView.hidden = true;
  if (errorEl) {
    errorEl.textContent = '';
    errorEl.hidden = true;
  }

  if (summaryWrap) {
    summaryWrap.innerHTML = validItems
      .map(
        ({ product, size, qty }) => `
          <div class="checkout-summary-row">
            <img src="${escapeHtml(product.images[0])}" alt="${escapeHtml(product.name)}">
            <div class="checkout-summary-meta">
              <div class="checkout-summary-name">${escapeHtml(product.name)}</div>
              <div class="checkout-summary-sub">Size ${escapeHtml(size)} · Qty ${qty}</div>
            </div>
            <span class="checkout-summary-price">${formatBDT(product.price * qty)}</span>
          </div>
        `
      )
      .join('');
  }

  updatePaymentUI();
  updateCheckoutTotals();
  openOverlay('checkout', triggerEl);

  const checkoutBody = document.querySelector('#checkout-drawer .checkout-body');
  if (checkoutBody) checkoutBody.scrollTop = 0;

  if (!isMobileViewport()) {
    setTimeout(() => document.getElementById('co-name')?.focus(), 180);
  }
}

function showCheckoutError(message, focusEl) {
  const errorEl = document.getElementById('co-error');
  if (errorEl) {
    errorEl.textContent = message;
    errorEl.hidden = false;
  }
  if (focusEl && typeof focusEl.focus === 'function') {
    focusEl.focus();
  }
}

function handleCheckoutSubmit(event) {
  event.preventDefault();

  const nameInput = document.getElementById('co-name');
  const phoneInput = document.getElementById('co-phone');
  const addressInput = document.getElementById('co-address');
  const errorEl = document.getElementById('co-error');

  if (errorEl) {
    errorEl.textContent = '';
    errorEl.hidden = true;
  }

  if (state.checkoutItems.length === 0) {
    showCheckoutError('Your order has no items. Please select a product first.');
    return;
  }

  const fullName = String(nameInput?.value || '').trim();
  const phone = normalizeBDPhone(phoneInput?.value || '');
  if (phoneInput) phoneInput.value = phone;
  const address = String(addressInput?.value || '').trim();

  if (fullName.length < 2) {
    showCheckoutError('Please enter your full name (at least 2 characters).', nameInput);
    return;
  }

  if (!/^01[3-9]\d{8}$/.test(phone)) {
    showCheckoutError('Please enter a valid 11-digit BD mobile number (e.g. 017XXXXXXXX).', phoneInput);
    return;
  }

  if (address.length < 6) {
    showCheckoutError('Please enter your full delivery address (house, road, area).', addressInput);
    return;
  }

  const { subtotal, shipping, total, zone } = updateCheckoutTotals();
  const payment = getSelectedRadioValue('co-payment', 'cod');
  const zoneLabel = zone === 'outside' ? 'Outside Dhaka' : 'Inside Dhaka';
  const paymentLabel = payment === 'bkash' ? 'bKash / Nagad (Demo)' : 'Cash on Delivery';

  const orderNumber = Math.floor(1000 + Math.random() * 9000);
  const orderId = `#LIS-${orderNumber}`;

  const itemLinesPlain = state.checkoutItems.map(
    ({ product, size, qty }) => `- ${product.name} (Size ${size} x ${qty}) = ${formatBDT(product.price * qty)}`
  );

  const itemLinesHtml = state.checkoutItems
    .map(
      ({ product, size, qty }) =>
        `<div>• ${escapeHtml(product.name)} (Size ${escapeHtml(size)} × ${qty}) — <strong>${formatBDT(product.price * qty)}</strong></div>`
    )
    .join('');

  const orderIdEl = document.getElementById('co-order-id');
  const orderSummaryEl = document.getElementById('co-order-summary');
  const waConfirmEl = document.getElementById('co-wa-confirm');
  const form = document.getElementById('checkout-form');
  const successView = document.getElementById('checkout-success');

  if (orderIdEl) orderIdEl.textContent = orderId;
  if (orderSummaryEl) {
    orderSummaryEl.innerHTML = `
      <div style="margin-bottom:8px;"><strong>Customer:</strong> ${escapeHtml(fullName)} (${escapeHtml(phone)})</div>
      <div style="margin-bottom:8px;"><strong>Delivery (${escapeHtml(zoneLabel)}):</strong> ${escapeHtml(address)}</div>
      <div style="margin-bottom:8px;"><strong>Payment:</strong> ${escapeHtml(paymentLabel)}</div>
      <div style="margin-bottom:8px;padding-top:8px;border-top:1px solid var(--border-hairline);">${itemLinesHtml}</div>
      <div style="padding-top:8px;border-top:1px solid var(--border-hairline);color:var(--ink-primary);">
        <strong>Subtotal:</strong> ${formatBDT(subtotal)} · <strong>Delivery:</strong> ${formatBDT(shipping)}<br>
        <strong>Total Payable: ${formatBDT(total)}</strong>
      </div>
    `;
  }

  const waText = [
    `Hello Life In Shop, I placed a demo order:`,
    `Order ID: ${orderId}`,
    `Name: ${fullName}`,
    `Phone: ${phone}`,
    `Zone: ${zoneLabel} (${formatBDT(shipping)})`,
    `Address: ${address}`,
    `Payment: ${paymentLabel}`,
    `Items:`,
    ...itemLinesPlain,
    `Total Payable: ${formatBDT(total)}`,
  ].join('\n');

  if (waConfirmEl) {
    waConfirmEl.href = `${BRAND.whatsappUrl}?text=${encodeURIComponent(waText)}`;
  }

  if (state.checkoutSource === 'bag') {
    clearBag();
  }

  if (form) form.hidden = true;
  if (successView) successView.hidden = false;

  const checkoutBody = document.querySelector('#checkout-drawer .checkout-body');
  if (checkoutBody) checkoutBody.scrollTop = 0;
}

/* ==========================================================================
   Interactive Demo AI Shopping Assistant
   ========================================================================== */

function appendChatMessage(html, role) {
  const container = document.getElementById('ai-chat-messages');
  if (!container) return;
  const msg = document.createElement('div');
  msg.className = `chat-msg ${role === 'user' ? 'is-user' : 'is-bot'}`;
  if (role === 'user') {
    msg.textContent = html;
  } else {
    msg.innerHTML = html;
  }
  container.appendChild(msg);
  container.scrollTop = container.scrollHeight;
}

function showTypingIndicator() {
  const container = document.getElementById('ai-chat-messages');
  if (!container) return null;
  container.querySelectorAll('.chat-typing').forEach((el) => el.remove());

  const typing = document.createElement('div');
  typing.className = 'chat-typing';
  typing.setAttribute('aria-label', 'Assistant is typing');
  typing.innerHTML = '<span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span>';
  container.appendChild(typing);
  container.scrollTop = container.scrollHeight;
  return typing;
}

function buildAIReply(rawInput) {
  const text = String(rawInput || '').trim().toLowerCase();
  const onPDP = state.page === 'product' && state.currentProduct;
  const prod = state.currentProduct;

  // 1. PDP specific fit query
  if (onPDP && /\b(will this fit|this fit|fit me|this shoe|this product|this shirt|this pant|this denim)\b/.test(text)) {
    return `<strong>${escapeHtml(prod.name)}</strong> is available in sizes <strong>${escapeHtml(prod.sizes.join(', '))}</strong>.<br>${escapeHtml(prod.fitNote)} Need to double-check? Tap <em>Size Guide</em> above or enjoy our 7-day size exchange.`;
  }

  // 2. Size / Fit / Measurement queries
  if (/\b(size|sizing|fit|chart|measurement|eu|waist|chest|inch|cm|40|41|42|43|44|45|medium|large|xl|xxl)\b/.test(text)) {
    if (onPDP) {
      return `For <strong>${escapeHtml(prod.name)}</strong>, available sizes are <strong>${escapeHtml(prod.sizes.join(', '))}</strong>. ${escapeHtml(prod.fitNote)} If you're between two sizes, we offer a 7-day size exchange on unused items.`;
    }
    return `Here is our quick sizing overview:<br>• <strong>Sneakers &amp; Runners:</strong> EU 40–44 (Adidas up to EU 45)<br>• <strong>Denim &amp; Chinos:</strong> Waist 30&Prime; to 38&Prime;<br>• <strong>Shirts &amp; Polos:</strong> M (40&Prime; chest), L (42&Prime;), XL (44&Prime;), XXL (46&Prime;)<br>Every product page has a full measurement chart + 7-day easy size exchange.`;
  }

  // 3. Delivery / Shipping / Dhaka / COD / Payment
  if (/\b(deliver|delivery|shipping|dhaka|outside|charge|fee|cod|cash|payment|bkash|nagad|courier|days|time|fast)\b/.test(text)) {
    return `We deliver nationwide with <strong>Cash on Delivery</strong> (zero advance required):<br>• <strong>Inside Dhaka:</strong> ${formatBDT(BRAND.shipping.insideDhaka)} (24–48 hours)<br>• <strong>Outside Dhaka:</strong> ${formatBDT(BRAND.shipping.outsideDhaka)} (2–4 business days)<br>Pay at your doorstep or use bKash/Nagad. You can place an order in seconds using Express Checkout.`;
  }

  // 4. Showroom / Location / Narayanganj / Contact
  if (/\b(showroom|location|address|narayanganj|jalkhuri|shimanto|visit|store|shop|map|phone|call|number|contact|whatsapp)\b/.test(text)) {
    return `Visit our physical showroom:<br><strong>${escapeHtml(BRAND.showroomAddress)}</strong><br>Call or WhatsApp: <strong>${escapeHtml(BRAND.phoneDisplay)}</strong><br><a href="${escapeHtml(BRAND.mapsUrl)}" target="_blank" rel="noopener">Open in Google Maps →</a> &nbsp;·&nbsp; <a href="${escapeHtml(BRAND.whatsappUrl)}" target="_blank" rel="noopener">WhatsApp Support →</a>`;
  }

  // 5. Category / Product / Best Sellers / Price / Discount queries
  if (/\b(best|seller|popular|recommend|sneaker|shoe|jordan|nike|hoka|adidas|redtape|panda|slip|denim|jean|chino|pant|shirt|polo|price|cost|sale|discount|offer|budget|cheap)\b/.test(text)) {
    let picks = [];
    if (/\b(jordan|aj4)\b/.test(text)) {
      picks = PRODUCTS.filter((p) => p.id.includes('jordan'));
    } else if (/\b(nike|zoomx|mind)\b/.test(text)) {
      picks = PRODUCTS.filter((p) => p.id.includes('nike'));
    } else if (/\b(hoka|running|runner|panda|slip)\b/.test(text)) {
      picks = PRODUCTS.filter((p) => p.category === 'running').slice(0, 3);
    } else if (/\b(denim|jean|american eagle)\b/.test(text)) {
      picks = PRODUCTS.filter((p) => p.category === 'denim');
    } else if (/\b(chino|pant)\b/.test(text)) {
      picks = PRODUCTS.filter((p) => p.category === 'chinos' || p.category === 'denim').slice(0, 3);
    } else if (/\b(shirt|polo)\b/.test(text)) {
      picks = PRODUCTS.filter((p) => p.category === 'shirts' || p.category === 'polos');
    } else if (/\b(sale|discount|offer)\b/.test(text)) {
      picks = PRODUCTS.filter((p) => p.compareAtPrice);
    } else {
      picks = [
        getProductById('air-jordan-4-grey'),
        getProductById('nike-mind-white-black'),
        getProductById('nike-zoomx-ash'),
        getProductById('ae-stretch-denim-jeans'),
      ].filter(Boolean);
    }

    const listHtml = picks
      .map(
        (p) =>
          `<a href="product.html?id=${encodeURIComponent(p.id)}">${escapeHtml(p.name)} — ${formatBDT(p.price)}${p.compareAtPrice ? ` (${escapeHtml(p.badge || 'Sale')})` : ''}</a>`
      )
      .join('<br>');

    return `Top picks from Life In Shop right now:<br>${listHtml}`;
  }

  // 6. Order / Track / Return / Exchange
  if (/\b(order|track|tracking|status|return|exchange|refund|cancel)\b/.test(text)) {
    return `You can place an order directly with <strong>Order Now — Cash on Delivery</strong> (no account needed). Unused items qualify for a <strong>7-day size exchange</strong>. In the full Laravel storefront, live order tracking by <code>#LIS-XXXX</code> Order ID works right inside this chat.<br><a href="${escapeHtml(BRAND.whatsappUrl)}" target="_blank" rel="noopener">Track or exchange on WhatsApp →</a>`;
  }

  // 7. Short Greetings
  if (/^(hi|hello|hey|assalamu|salam|hlw|good\s*(morning|afternoon|evening))\b/.test(text)) {
    return `Hello! Welcome to <strong>${escapeHtml(BRAND.name)}</strong>. I'm running in interactive Demo Mode — tap a quick topic below or ask about sneaker/apparel sizes, delivery charges, best sellers, or our Narayanganj showroom.`;
  }

  // 8. Generic Polished Demo Fallback for ANY other arbitrary message
  return `Thanks for your message! This interactive AI Shopping Assistant is running in <strong>Demo Preview Mode</strong>. In your live custom Laravel store, it connects directly to real-time stock, smart sizing, and order tracking. Need instant human help? Tap below to reach us on WhatsApp (${escapeHtml(BRAND.phoneDisplay)}).<br><a href="${escapeHtml(BRAND.whatsappUrl)}" target="_blank" rel="noopener">Chat on WhatsApp →</a>`;
}

function sendChatMessage(rawText) {
  const clean = String(rawText || '').trim();
  if (!clean) return;

  appendChatMessage(clean, 'user');

  if (state.chatReplyTimer) {
    clearTimeout(state.chatReplyTimer);
    state.chatReplyTimer = null;
  }

  const typingNode = showTypingIndicator();

  state.chatReplyTimer = setTimeout(() => {
    typingNode?.remove();
    appendChatMessage(buildAIReply(clean), 'bot');
    state.chatReplyTimer = null;
  }, AI_TYPING_DELAY_MS);
}

function renderChatChips() {
  const chipsWrap = document.getElementById('ai-chat-chips');
  if (!chipsWrap) return;

  const chips =
    state.page === 'product'
      ? ['Will this fit me?', 'Size Help', 'Delivery Charge', 'Showroom Location', 'Best Sellers']
      : ['Size Help', 'Delivery Charge', 'Showroom Location', 'Best Sellers'];

  chipsWrap.innerHTML = chips
    .map((label) => `<button type="button" class="chat-chip" data-chat-chip="${escapeHtml(label)}">${escapeHtml(label)}</button>`)
    .join('');
}

function initAIChat() {
  const trigger = document.getElementById('ai-chat-trigger');
  const closeBtn = document.getElementById('ai-chat-close');
  const form = document.getElementById('ai-chat-form');
  const input = document.getElementById('ai-chat-input');
  const chipsWrap = document.getElementById('ai-chat-chips');
  const panel = document.getElementById('ai-chat-panel');

  if (!trigger || !panel) return;

  renderChatChips();

  const ensureWelcomeMessage = () => {
    if (state.chatInitialized) return;
    state.chatInitialized = true;
    const welcome =
      state.page === 'product' && state.currentProduct
        ? `Hi! Looking at <strong>${escapeHtml(state.currentProduct.name)}</strong> (${formatBDT(state.currentProduct.price)})? Ask me about sizing, fit, Cash on Delivery charges, or our Narayanganj showroom.`
        : `Welcome to <strong>${escapeHtml(BRAND.name)}</strong>. I'm your interactive AI Shopping Assistant (Demo Mode). Ask about sizes, Inside/Outside Dhaka delivery, best sellers, or our showroom.`;
    appendChatMessage(welcome, 'bot');
  };

  trigger.addEventListener('click', () => {
    ensureWelcomeMessage();
    openOverlay('ai-chat', trigger);
    if (!isMobileViewport()) {
      setTimeout(() => input?.focus(), 160);
    }
  });

  closeBtn?.addEventListener('click', () => closeAllOverlays());

  chipsWrap?.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-chat-chip]');
    if (!chip) return;
    sendChatMessage(chip.dataset.chatChip);
  });

  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!input) return;
    const value = input.value.trim();
    if (!value) return;
    input.value = '';
    sendChatMessage(value);
  });

  // On desktop, clicking outside the floating chat panel closes it cleanly
  document.addEventListener('click', (event) => {
    if (state.activeOverlay !== 'ai-chat' || isMobileViewport()) return;
    if (panel.contains(event.target) || trigger.contains(event.target)) return;
    closeAllOverlays({ restoreFocus: false });
  });
}

/* ==========================================================================
   Home Page: Hero Slider, Category Strip & Filterable Catalog
   ========================================================================== */

function initHeroSlider() {
  const slider = document.getElementById('hero-slider');
  const track = document.getElementById('hero-track');
  const dotsWrap = document.getElementById('hero-dots');
  const counterEl = document.getElementById('hero-counter');
  const prevBtn = document.getElementById('hero-prev');
  const nextBtn = document.getElementById('hero-next');

  if (!slider || !track || HERO_SLIDES.length === 0) return;

  const total = HERO_SLIDES.length;
  let current = 0;
  let timer = null;
  let paused = false;
  const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

  track.innerHTML = HERO_SLIDES.map((slide, idx) => {
    const headingTag = idx === 0 ? 'h1' : 'h2';
    const titleHtml = escapeHtml(slide.title).replace(/\n/g, '<br>');
    return `
      <div class="hero-slide" data-slide-index="${idx}">
        <img class="hero-slide-img" src="${escapeHtml(slide.image)}" alt="${escapeHtml(slide.imageAlt)}" ${idx === 0 ? 'fetchpriority="high"' : 'loading="lazy"'}>
        <div class="hero-slide-scrim" aria-hidden="true"></div>
        <div class="hero-slide-content container">
          <div class="hero-copy">
            <span class="hero-eyebrow">${escapeHtml(slide.eyebrow)}</span>
            <${headingTag} class="hero-title">${titleHtml}</${headingTag}>
            <p class="hero-subtitle">${escapeHtml(slide.subtitle)}</p>
            <div class="hero-cta-row">
              <a href="${escapeHtml(slide.ctaHref)}" class="btn btn-light">${escapeHtml(slide.ctaLabel)}</a>
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');

  if (dotsWrap) {
    dotsWrap.innerHTML = HERO_SLIDES.map(
      (slide, idx) =>
        `<button type="button" class="hero-dot${idx === 0 ? ' is-active' : ''}" role="tab" aria-selected="${idx === 0 ? 'true' : 'false'}" aria-label="Slide ${idx + 1}: ${escapeHtml(slide.eyebrow)}" data-hero-dot="${idx}"></button>`
    ).join('');
  }

  function updateSlideUI() {
    track.style.transform = `translate3d(-${current * 100}%, 0, 0)`;
    if (counterEl) {
      counterEl.textContent = `${pad2(current + 1)} / ${pad2(total)}`;
    }
    if (dotsWrap) {
      dotsWrap.querySelectorAll('.hero-dot').forEach((dot, idx) => {
        const isActive = idx === current;
        dot.classList.toggle('is-active', isActive);
        dot.setAttribute('aria-selected', isActive ? 'true' : 'false');
      });
    }
  }

  function goTo(index) {
    current = (index + total) % total;
    updateSlideUI();
  }

  function stopAutoplay() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  function startAutoplay() {
    if (prefersReducedMotion || paused || document.hidden || total <= 1) return;
    stopAutoplay();
    timer = setInterval(() => goTo(current + 1), HERO_AUTOPLAY_MS);
  }

  prevBtn?.addEventListener('click', () => {
    goTo(current - 1);
    startAutoplay();
  });

  nextBtn?.addEventListener('click', () => {
    goTo(current + 1);
    startAutoplay();
  });

  dotsWrap?.addEventListener('click', (event) => {
    const dot = event.target.closest('[data-hero-dot]');
    if (!dot) return;
    goTo(parseInt(dot.dataset.heroDot, 10) || 0);
    startAutoplay();
  });

  slider.addEventListener('mouseenter', () => {
    paused = true;
    stopAutoplay();
  });

  slider.addEventListener('mouseleave', () => {
    paused = false;
    startAutoplay();
  });

  slider.addEventListener('focusin', () => {
    paused = true;
    stopAutoplay();
  });

  slider.addEventListener('focusout', (event) => {
    if (!slider.contains(event.relatedTarget)) {
      paused = false;
      startAutoplay();
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopAutoplay();
    } else {
      startAutoplay();
    }
  });

  // Touch swipe support
  let touchStartX = 0;
  let touchStartY = 0;

  slider.addEventListener(
    'touchstart',
    (event) => {
      if (!event.touches || event.touches.length !== 1) return;
      touchStartX = event.touches[0].clientX;
      touchStartY = event.touches[0].clientY;
      stopAutoplay();
    },
    { passive: true }
  );

  slider.addEventListener(
    'touchend',
    (event) => {
      if (!event.changedTouches || event.changedTouches.length !== 1) return;
      const dx = event.changedTouches[0].clientX - touchStartX;
      const dy = event.changedTouches[0].clientY - touchStartY;
      if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) {
        goTo(dx < 0 ? current + 1 : current - 1);
      }
      startAutoplay();
    },
    { passive: true }
  );

  updateSlideUI();
  startAutoplay();
}

function initHomeCatalog() {
  const categoryGrid = document.getElementById('category-grid');
  const filterTabs = document.getElementById('filter-tabs');
  const productGrid = document.getElementById('product-grid');
  const catalogCount = document.getElementById('catalog-count');
  const catalogSection = document.getElementById('catalog-section');

  const validCategories = new Set(['all', ...CATEGORIES.map((c) => c.id)]);

  // Render 6 editorial category cards
  if (categoryGrid) {
    categoryGrid.innerHTML = CATEGORIES.map(
      (cat) => `
        <button type="button" class="category-card" data-category-card="${escapeHtml(cat.id)}" aria-label="Shop ${escapeHtml(cat.name)}">
          <img class="category-card-img" src="${escapeHtml(cat.image)}" alt="${escapeHtml(cat.name)}" loading="lazy">
          <div class="category-card-overlay">
            <span class="category-card-name">${escapeHtml(cat.shortName)}</span>
            <span class="category-card-desc">${escapeHtml(cat.description)}</span>
          </div>
        </button>
      `
    ).join('');
  }

  // Render filter tabs
  if (filterTabs) {
    const tabs = [{ id: 'all', label: 'All' }, ...CATEGORIES.map((c) => ({ id: c.id, label: c.shortName }))];
    filterTabs.innerHTML = tabs
      .map(
        (tab) =>
          `<button type="button" class="filter-tab" role="tab" aria-selected="false" data-filter="${escapeHtml(tab.id)}">${escapeHtml(tab.label)}</button>`
      )
      .join('');
  }

  function applyCategoryFilter(categoryId, { scroll = false, updateUrl = false } = {}) {
    const safeCat = validCategories.has(categoryId) ? categoryId : 'all';
    state.activeCategory = safeCat;

    const filtered =
      safeCat === 'all' ? PRODUCTS : PRODUCTS.filter((product) => product.category === safeCat);

    if (catalogCount) {
      catalogCount.textContent = `${filtered.length} ${filtered.length === 1 ? 'Item' : 'Items'}`;
    }

    if (productGrid) {
      productGrid.innerHTML = filtered.map(renderProductCard).join('');
    }

    filterTabs?.querySelectorAll('.filter-tab').forEach((tab) => {
      const isActive = tab.dataset.filter === safeCat;
      tab.classList.toggle('is-active', isActive);
      tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });

    document.querySelectorAll('.desktop-nav .nav-link[data-nav-category]').forEach((link) => {
      link.classList.toggle('is-active', link.dataset.navCategory === safeCat);
    });

    if (updateUrl) {
      const url = new URL(window.location.href);
      if (safeCat === 'all') {
        url.searchParams.delete('category');
      } else {
        url.searchParams.set('category', safeCat);
      }
      history.replaceState(null, '', url.pathname + url.search + url.hash);
    }

    if (scroll && catalogSection) {
      const headerHeight = document.getElementById('site-header')?.offsetHeight || 64;
      const top = catalogSection.getBoundingClientRect().top + window.scrollY - headerHeight - 12;
      window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    }
  }

  // Click category cards
  categoryGrid?.addEventListener('click', (event) => {
    const card = event.target.closest('[data-category-card]');
    if (!card) return;
    applyCategoryFilter(card.dataset.categoryCard, { scroll: true, updateUrl: true });
  });

  // Click filter tabs
  filterTabs?.addEventListener('click', (event) => {
    const tab = event.target.closest('[data-filter]');
    if (!tab) return;
    applyCategoryFilter(tab.dataset.filter, { scroll: false, updateUrl: true });
  });

  // Click any [data-nav-category] link on Home (header, mobile drawer, footer, View All)
  document.querySelectorAll('[data-nav-category]').forEach((link) => {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      const cat = link.dataset.navCategory || 'all';
      if (state.activeOverlay) closeAllOverlays({ restoreFocus: false });
      applyCategoryFilter(cat, { scroll: true, updateUrl: true });
    });
  });

  // Initial URL ?category= param handling
  const initialParam = new URLSearchParams(window.location.search).get('category');
  if (initialParam && validCategories.has(initialParam)) {
    applyCategoryFilter(initialParam, { scroll: false, updateUrl: false });
    if (window.location.hash === '#catalog-section' || initialParam !== 'all') {
      requestAnimationFrame(() => {
        setTimeout(() => applyCategoryFilter(initialParam, { scroll: true, updateUrl: false }), 120);
      });
    }
  } else {
    applyCategoryFilter('all', { scroll: false, updateUrl: false });
  }
}

/* ==========================================================================
   Product Detail Page (PDP)
   ========================================================================== */

function initProductPage() {
  const params = new URLSearchParams(window.location.search);
  const requestedId = params.get('id') || DEFAULT_PRODUCT_ID;
  const initialProduct = getProductById(requestedId) || getProductById(DEFAULT_PRODUCT_ID) || PRODUCTS[0];

  const mainImg = document.getElementById('pdp-main-img');
  const imgCounter = document.getElementById('pdp-img-counter');
  const thumbsWrap = document.getElementById('pdp-thumbs');
  const zoomBtn = document.getElementById('pdp-zoom-btn');
  const mainFrame = mainImg?.closest('.pdp-main-frame');

  const lightbox = document.getElementById('pdp-lightbox');
  const lightboxImg = document.getElementById('pdp-lightbox-img');
  const lightboxPrev = document.getElementById('pdp-lightbox-prev');
  const lightboxNext = document.getElementById('pdp-lightbox-next');
  const lightboxClose = document.getElementById('pdp-lightbox-close');

  const breadcrumbCat = document.getElementById('pdp-breadcrumb-cat');
  const breadcrumbName = document.getElementById('pdp-breadcrumb-name');
  const catLabel = document.getElementById('pdp-category-label');
  const skuEl = document.getElementById('pdp-sku');
  const titleEl = document.getElementById('pdp-title');
  const priceEl = document.getElementById('pdp-price');
  const compareEl = document.getElementById('pdp-compare-price');
  const discountBadge = document.getElementById('pdp-discount-badge');
  const shortDescEl = document.getElementById('pdp-short-desc');

  const colorwayWrap = document.getElementById('pdp-colorway-wrap');
  const colorwaysEl = document.getElementById('pdp-colorways');
  const colorLabelEl = document.getElementById('pdp-color-label');

  const sizesEl = document.getElementById('pdp-sizes');
  const sizeErrorEl = document.getElementById('pdp-size-error');
  const sizeGuideBtn = document.getElementById('size-guide-open-btn');
  const sizeGuideModal = document.getElementById('size-guide-modal');
  const sizeGuideCloseBtn = document.getElementById('size-guide-close-btn');
  const sizeGuideTitle = document.getElementById('size-guide-title');
  const sizeGuideTable = document.getElementById('size-guide-table');

  const qtyDecBtn = document.getElementById('qty-dec');
  const qtyValEl = document.getElementById('qty-val');
  const qtyIncBtn = document.getElementById('qty-inc');

  const orderNowBtn = document.getElementById('pdp-order-now-btn');
  const addBagBtn = document.getElementById('pdp-add-bag-btn');
  const accordionsEl = document.getElementById('pdp-accordions');
  const relatedGrid = document.getElementById('pdp-related-grid');

  const stickyBar = document.getElementById('pdp-mobile-sticky-bar');
  const stickyPrice = document.getElementById('pdp-sticky-price');
  const stickySize = document.getElementById('pdp-sticky-size');
  const stickyOrderBtn = document.getElementById('pdp-sticky-order-btn');

  function updateStickyBarMeta() {
    const product = state.currentProduct;
    if (!product) return;
    if (stickyPrice) {
      stickyPrice.textContent = formatBDT(product.price * state.pdpQty);
    }
    if (stickySize) {
      stickySize.textContent = state.selectedSize
        ? `Size ${state.selectedSize} · Qty ${state.pdpQty}`
        : 'Select size to order';
    }
  }

  function setGalleryImage(index) {
    const product = state.currentProduct;
    if (!product || !product.images.length) return;
    const total = product.images.length;
    state.currentImageIndex = (index + total) % total;
    const src = product.images[state.currentImageIndex];

    if (mainImg) {
      mainImg.src = src;
      mainImg.alt = `${product.name} — view ${state.currentImageIndex + 1}`;
    }
    if (imgCounter) {
      imgCounter.textContent = `${pad2(state.currentImageIndex + 1)} / ${pad2(total)}`;
    }
    if (lightboxImg && state.activeOverlay === 'lightbox') {
      lightboxImg.src = src;
      lightboxImg.alt = `${product.name} — enlarged view ${state.currentImageIndex + 1}`;
    }
    thumbsWrap?.querySelectorAll('.pdp-thumb').forEach((btn, idx) => {
      const isActive = idx === state.currentImageIndex;
      btn.classList.toggle('is-active', isActive);
      btn.setAttribute('aria-current', isActive ? 'true' : 'false');
    });
  }

  function openLightbox(triggerEl) {
    const product = state.currentProduct;
    if (!product || !lightbox || !lightboxImg) return;
    lightboxImg.src = product.images[state.currentImageIndex] || product.images[0];
    lightboxImg.alt = `${product.name} — enlarged view ${state.currentImageIndex + 1}`;
    openOverlay('lightbox', triggerEl);
  }

  function renderSizeGuide() {
    const product = state.currentProduct;
    const chart = SIZE_CHARTS[product?.sizeType] || SIZE_CHARTS.footwear;
    if (sizeGuideTitle) sizeGuideTitle.textContent = chart.title;
    if (sizeGuideTable) {
      const headCells = chart.headers.map((h) => `<th scope="col">${escapeHtml(h)}</th>`).join('');
      const bodyRows = chart.rows
        .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`)
        .join('');
      sizeGuideTable.innerHTML = `<table><thead><tr>${headCells}</tr></thead><tbody>${bodyRows}</tbody></table>`;
    }
  }

  function getRelatedProducts(product) {
    const sameCategory = PRODUCTS.filter((p) => p.category === product.category && p.id !== product.id);
    const others = PRODUCTS.filter((p) => p.category !== product.category && p.featured);
    const fallback = PRODUCTS.filter((p) => p.id !== product.id && !sameCategory.includes(p) && !others.includes(p));
    return [...sameCategory, ...others, ...fallback].slice(0, 4);
  }

  function renderPDP(product) {
    state.currentProduct = product;
    state.currentImageIndex = 0;

    // Preserve selected size only if valid on switched colorway
    if (!state.selectedSize || !product.sizes.includes(state.selectedSize)) {
      state.selectedSize = null;
    }

    document.title = `${product.name} — ${BRAND.name}`;

    // Highlight active category in desktop nav
    document.querySelectorAll('.desktop-nav .nav-link[data-nav-category]').forEach((link) => {
      link.classList.toggle('is-active', link.dataset.navCategory === product.category);
    });

    if (breadcrumbCat) {
      breadcrumbCat.textContent = product.categoryLabel;
      breadcrumbCat.href = `index.html?category=${encodeURIComponent(product.category)}#catalog-section`;
    }
    if (breadcrumbName) breadcrumbName.textContent = product.name;
    if (catLabel) catLabel.textContent = product.categoryLabel;
    if (skuEl) skuEl.textContent = product.sku;
    if (titleEl) titleEl.textContent = product.name;
    if (priceEl) priceEl.textContent = formatBDT(product.price);

    const hasDiscount = Boolean(product.compareAtPrice && product.compareAtPrice > product.price);
    if (compareEl) {
      compareEl.textContent = hasDiscount ? formatBDT(product.compareAtPrice) : '';
      compareEl.hidden = !hasDiscount;
    }
    if (discountBadge) {
      discountBadge.textContent = hasDiscount
        ? product.badge || `Save ${formatBDT(product.compareAtPrice - product.price)}`
        : '';
      discountBadge.hidden = !hasDiscount;
    }

    if (shortDescEl) shortDescEl.textContent = product.shortDesc;

    // Gallery thumbnails
    if (thumbsWrap) {
      thumbsWrap.innerHTML = product.images
        .map(
          (src, idx) => `
            <button type="button" class="pdp-thumb${idx === 0 ? ' is-active' : ''}" role="listitem" data-thumb-idx="${idx}" aria-label="View angle ${idx + 1} of ${product.images.length}">
              <img src="${escapeHtml(src)}" alt="${escapeHtml(product.name)} angle ${idx + 1}" loading="lazy">
            </button>
          `
        )
        .join('');
    }
    setGalleryImage(0);

    // Colorways
    const hasSiblings = Array.isArray(product.siblings) && product.siblings.length > 1;
    if (colorwayWrap) colorwayWrap.hidden = !hasSiblings;
    if (hasSiblings && colorwaysEl) {
      if (colorLabelEl) colorLabelEl.textContent = product.colorName;
      colorwaysEl.innerHTML = product.siblings
        .map((sib) => {
          const active = sib.id === product.id;
          return `
            <button
              type="button"
              class="colorway-swatch${active ? ' is-active' : ''}"
              data-sibling-id="${escapeHtml(sib.id)}"
              style="background-color: ${escapeHtml(sib.colorHex)};"
              title="${escapeHtml(sib.colorName)}"
              aria-label="Select color ${escapeHtml(sib.colorName)}"
              aria-pressed="${active ? 'true' : 'false'}"
            ></button>
          `;
        })
        .join('');
    }

    // Size chips
    if (sizesEl) {
      sizesEl.innerHTML = product.sizes
        .map((size) => {
          const isActive = state.selectedSize === size;
          return `
            <button
              type="button"
              class="size-chip${isActive ? ' is-active' : ''}"
              role="radio"
              aria-checked="${isActive ? 'true' : 'false'}"
              data-size="${escapeHtml(size)}"
            >${escapeHtml(size)}</button>
          `;
        })
        .join('');
    }

    if (sizeErrorEl) sizeErrorEl.hidden = true;
    if (qtyValEl) qtyValEl.textContent = String(state.pdpQty);
    updateStickyBarMeta();

    // Hairline Accordions
    if (accordionsEl) {
      const highlightsHtml = (product.highlights || [])
        .map((line) => `<li>${escapeHtml(line)}</li>`)
        .join('');

      accordionsEl.innerHTML = `
        <details class="pdp-accordion-item" open>
          <summary>Product Highlights &amp; Fit</summary>
          <div class="pdp-accordion-content">
            <ul>${highlightsHtml}</ul>
            <p style="margin-top:10px;"><strong>Fit Note:</strong> ${escapeHtml(product.fitNote)}</p>
          </div>
        </details>
        <details class="pdp-accordion-item">
          <summary>Delivery &amp; Cash on Delivery</summary>
          <div class="pdp-accordion-content">
            <ul>
              <li>Inside Dhaka: ${formatBDT(BRAND.shipping.insideDhaka)} (24–48 hours)</li>
              <li>Outside Dhaka: ${formatBDT(BRAND.shipping.outsideDhaka)} (2–4 business days)</li>
              <li>Cash on Delivery nationwide — pay only when your parcel arrives</li>
              <li>Showroom pickup available at ${escapeHtml(BRAND.showroomAddress)}</li>
            </ul>
          </div>
        </details>
        <details class="pdp-accordion-item">
          <summary>7-Day Size Exchange Policy</summary>
          <div class="pdp-accordion-content">
            <p>Need a different size? Request an easy size exchange within 7 days of delivery on unused items with original packaging via WhatsApp (${escapeHtml(BRAND.phoneDisplay)}) or at our Narayanganj showroom.</p>
          </div>
        </details>
      `;
    }

    // Related Products
    if (relatedGrid) {
      relatedGrid.innerHTML = getRelatedProducts(product).map(renderProductCard).join('');
    }
  }

  function ensureSizeSelected() {
    if (state.selectedSize) {
      if (sizeErrorEl) sizeErrorEl.hidden = true;
      return true;
    }
    if (sizeErrorEl) sizeErrorEl.hidden = false;
    if (sizesEl) {
      const rect = sizesEl.getBoundingClientRect();
      const headerHeight = document.getElementById('site-header')?.offsetHeight || 64;
      if (rect.top < headerHeight + 20 || rect.bottom > window.innerHeight - 80) {
        const targetY = rect.top + window.scrollY - headerHeight - 80;
        window.scrollTo({ top: Math.max(0, targetY), behavior: 'smooth' });
      }
      sizesEl.querySelector('.size-chip')?.focus({ preventScroll: true });
    }
    return false;
  }

  // Gallery thumbnail click
  thumbsWrap?.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-thumb-idx]');
    if (!btn) return;
    setGalleryImage(parseInt(btn.dataset.thumbIdx, 10) || 0);
  });

  // Main frame & zoom lightbox triggers
  zoomBtn?.addEventListener('click', (event) => {
    event.stopPropagation();
    openLightbox(zoomBtn);
  });
  mainImg?.addEventListener('click', () => openLightbox(zoomBtn || mainImg));

  // Gallery swipe (main frame & lightbox)
  function attachSwipe(el) {
    if (!el) return;
    let startX = 0;
    let startY = 0;
    el.addEventListener(
      'touchstart',
      (event) => {
        if (!event.touches || event.touches.length !== 1) return;
        startX = event.touches[0].clientX;
        startY = event.touches[0].clientY;
      },
      { passive: true }
    );
    el.addEventListener(
      'touchend',
      (event) => {
        if (!event.changedTouches || event.changedTouches.length !== 1) return;
        const dx = event.changedTouches[0].clientX - startX;
        const dy = event.changedTouches[0].clientY - startY;
        if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) {
          setGalleryImage(dx < 0 ? state.currentImageIndex + 1 : state.currentImageIndex - 1);
        }
      },
      { passive: true }
    );
  }
  attachSwipe(mainFrame);
  attachSwipe(lightbox);

  // Lightbox controls
  lightboxPrev?.addEventListener('click', () => setGalleryImage(state.currentImageIndex - 1));
  lightboxNext?.addEventListener('click', () => setGalleryImage(state.currentImageIndex + 1));
  lightboxClose?.addEventListener('click', () => closeAllOverlays());
  lightbox?.addEventListener('click', (event) => {
    if (event.target === lightbox) closeAllOverlays();
  });

  // Colorway switch (no page reload via history.replaceState)
  colorwaysEl?.addEventListener('click', (event) => {
    const swatch = event.target.closest('[data-sibling-id]');
    if (!swatch) return;
    const sibling = getProductById(swatch.dataset.siblingId);
    if (!sibling || sibling.id === state.currentProduct?.id) return;

    const url = new URL(window.location.href);
    url.searchParams.set('id', sibling.id);
    history.replaceState(null, '', url.pathname + url.search);
    renderPDP(sibling);
  });

  // Size chip selection
  sizesEl?.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-size]');
    if (!chip || chip.classList.contains('is-oos')) return;
    state.selectedSize = chip.dataset.size;

    sizesEl.querySelectorAll('.size-chip').forEach((btn) => {
      const active = btn.dataset.size === state.selectedSize;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-checked', active ? 'true' : 'false');
    });

    if (sizeErrorEl) sizeErrorEl.hidden = true;
    updateStickyBarMeta();
  });

  // Size Guide Modal
  sizeGuideBtn?.addEventListener('click', () => {
    renderSizeGuide();
    openOverlay('size-guide', sizeGuideBtn);
  });
  sizeGuideCloseBtn?.addEventListener('click', () => closeAllOverlays());
  sizeGuideModal?.addEventListener('click', (event) => {
    if (event.target === sizeGuideModal) closeAllOverlays();
  });

  // Quantity stepper (1..10)
  qtyDecBtn?.addEventListener('click', () => {
    if (state.pdpQty <= 1) return;
    state.pdpQty -= 1;
    if (qtyValEl) qtyValEl.textContent = String(state.pdpQty);
    updateStickyBarMeta();
  });

  qtyIncBtn?.addEventListener('click', () => {
    if (state.pdpQty >= 10) return;
    state.pdpQty += 1;
    if (qtyValEl) qtyValEl.textContent = String(state.pdpQty);
    updateStickyBarMeta();
  });

  // Order Now — Cash on Delivery (Direct single-item checkout)
  function triggerDirectOrder(triggerEl) {
    if (!ensureSizeSelected() || !state.currentProduct) return;
    openCheckout(
      [{ id: state.currentProduct.id, size: state.selectedSize, qty: state.pdpQty, product: state.currentProduct }],
      'direct',
      triggerEl
    );
  }

  orderNowBtn?.addEventListener('click', () => triggerDirectOrder(orderNowBtn));
  stickyOrderBtn?.addEventListener('click', () => triggerDirectOrder(stickyOrderBtn));

  // Add to Bag (Persistent bag + open Bag drawer)
  addBagBtn?.addEventListener('click', () => {
    if (!ensureSizeSelected() || !state.currentProduct) return;
    addToBag(state.currentProduct.id, state.selectedSize, state.pdpQty);
    openOverlay('bag', addBagBtn);
  });

  // Mobile Sticky Bottom Order Bar + Lifted Floating Dock (only once CTA scrolls above sticky header)
  const dock = document.getElementById('floating-dock');
  if (stickyBar && orderNowBtn) {
    const syncStickyBar = (isIntersecting, rect) => {
      const headerHeight = document.getElementById('site-header')?.offsetHeight || 64;
      const showSticky = isMobileViewport() && !isIntersecting && rect.bottom <= headerHeight + 16;
      stickyBar.classList.toggle('is-visible', showSticky);
      if (dock) dock.classList.toggle('is-lifted', showSticky);
    };

    const syncStickyBarFromRect = () => {
      const rect = orderNowBtn.getBoundingClientRect();
      const headerHeight = document.getElementById('site-header')?.offsetHeight || 64;
      const isIntersecting = rect.bottom > headerHeight && rect.top < window.innerHeight;
      syncStickyBar(isIntersecting, rect);
    };

    if ('IntersectionObserver' in window) {
      const observer = new IntersectionObserver(
        (entries) => {
          const entry = entries[0];
          syncStickyBar(entry.isIntersecting, entry.boundingClientRect);
        },
        { rootMargin: '-64px 0px 0px 0px', threshold: 0 }
      );
      observer.observe(orderNowBtn);
    }

    window.addEventListener('scroll', syncStickyBarFromRect, { passive: true });
    window.addEventListener('resize', syncStickyBarFromRect, { passive: true });
    syncStickyBarFromRect();
  }

  // Ensure any [data-nav-category] link on PDP routes to index.html?category=<id>#catalog-section
  document.querySelectorAll('[data-nav-category]').forEach((link) => {
    const cat = link.dataset.navCategory;
    if (cat === 'all') {
      link.setAttribute('href', 'index.html#catalog-section');
    } else if (cat) {
      link.setAttribute('href', `index.html?category=${encodeURIComponent(cat)}#catalog-section`);
    }
  });

  renderPDP(initialProduct);

  // Lightbox keyboard navigation (Left / Right arrows)
  document.addEventListener('keydown', (event) => {
    if (state.activeOverlay !== 'lightbox') return;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      setGalleryImage(state.currentImageIndex - 1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      setGalleryImage(state.currentImageIndex + 1);
    }
  });
}

/* ==========================================================================
   Shared Event Bindings (Header, Drawers, Search, Bag, Checkout, ESC)
   ========================================================================== */

function initSharedInteractions() {
  // Backdrop & ESC
  document.getElementById('drawer-backdrop')?.addEventListener('click', () => closeAllOverlays());

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.activeOverlay) {
      event.preventDefault();
      closeAllOverlays();
    }
  });

  // Mobile Nav Drawer
  const mobileMenuBtn = document.getElementById('mobile-menu-btn');
  mobileMenuBtn?.addEventListener('click', () => openOverlay('mobile-nav', mobileMenuBtn));
  document.getElementById('mobile-nav-close')?.addEventListener('click', () => closeAllOverlays());

  // Search Overlay
  const searchOpenBtn = document.getElementById('search-open-btn');
  const searchCloseBtn = document.getElementById('search-close-btn');
  const searchInput = document.getElementById('search-input');

  searchOpenBtn?.addEventListener('click', () => {
    openOverlay('search', searchOpenBtn);
    renderSearchResults(searchInput?.value || '');
    setTimeout(() => searchInput?.focus(), 120);
  });

  searchCloseBtn?.addEventListener('click', () => closeAllOverlays());

  searchInput?.addEventListener('input', () => {
    renderSearchResults(searchInput.value);
  });

  // Shopping Bag Drawer
  const bagOpenBtn = document.getElementById('bag-open-btn');
  const bagCloseBtn = document.getElementById('bag-close-btn');
  const bagItemsWrap = document.getElementById('bag-items');
  const bagCheckoutBtn = document.getElementById('bag-checkout-btn');

  bagOpenBtn?.addEventListener('click', () => {
    renderBagUI();
    openOverlay('bag', bagOpenBtn);
  });

  bagCloseBtn?.addEventListener('click', () => closeAllOverlays());

  bagItemsWrap?.addEventListener('click', (event) => {
    const decBtn = event.target.closest('[data-bag-dec]');
    if (decBtn) {
      updateBagItemQty(parseInt(decBtn.dataset.bagDec, 10), -1);
      return;
    }
    const incBtn = event.target.closest('[data-bag-inc]');
    if (incBtn) {
      updateBagItemQty(parseInt(incBtn.dataset.bagInc, 10), 1);
      return;
    }
    const removeBtn = event.target.closest('[data-bag-remove]');
    if (removeBtn) {
      removeBagItem(parseInt(removeBtn.dataset.bagRemove, 10));
    }
  });

  bagCheckoutBtn?.addEventListener('click', () => {
    const items = getBagHydratedItems();
    if (items.length === 0) return;
    openCheckout(items, 'bag', bagCheckoutBtn);
  });

  // Checkout Drawer Controls
  document.getElementById('checkout-close-btn')?.addEventListener('click', () => closeAllOverlays());
  document.getElementById('co-continue-btn')?.addEventListener('click', () => closeAllOverlays());

  document.querySelectorAll('input[name="co-zone"]').forEach((radio) => {
    radio.addEventListener('change', () => updateCheckoutTotals());
  });

  document.querySelectorAll('input[name="co-payment"]').forEach((radio) => {
    radio.addEventListener('change', () => updatePaymentUI());
  });

  const clearCheckoutError = () => {
    const errorEl = document.getElementById('co-error');
    if (errorEl && !errorEl.hidden) {
      errorEl.textContent = '';
      errorEl.hidden = true;
    }
  };

  const nameInput = document.getElementById('co-name');
  const phoneInput = document.getElementById('co-phone');
  const addressInput = document.getElementById('co-address');

  nameInput?.addEventListener('input', clearCheckoutError);
  addressInput?.addEventListener('input', clearCheckoutError);
  phoneInput?.addEventListener('input', () => {
    const cleaned = normalizeBDPhone(phoneInput.value);
    if (phoneInput.value !== cleaned) {
      phoneInput.value = cleaned;
    }
    clearCheckoutError();
  });

  document.getElementById('checkout-form')?.addEventListener('submit', handleCheckoutSubmit);

  // Sync bag across Back/Forward bfcache navigation & other tabs
  window.addEventListener('pageshow', () => {
    loadBag();
    renderBagUI();
  });

  window.addEventListener('storage', (event) => {
    if (event.key === BAG_STORAGE_KEY) {
      loadBag();
      renderBagUI();
    }
  });
}

/* ==========================================================================
   Bootstrap
   ========================================================================== */

function init() {
  loadBag();
  renderBagUI();
  initSharedInteractions();

  if (state.page === 'product') {
    initProductPage();
  } else {
    initHeroSlider();
    initHomeCatalog();
  }

  initAIChat();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
