(function () {
  "use strict";

  const STORAGE_KEYS = {
    inventory: "lifeinshop_inventory_v1",
    orders: "lifeinshop_orders_v1",
    movements: "lifeinshop_movements_v1",
    shift: "lifeinshop_shift_v1",
  };

  const STORE_EVENT = "lifeinshop:store-updated";

  // In-memory fallback for restricted file:/// origins where localStorage may throw
  const memoryStore = Object.create(null);

  function readStorage(key) {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw !== null) {
        memoryStore[key] = raw;
        return JSON.parse(raw);
      }
    } catch (_) {
      // Fall through to in-memory fallback
    }
    if (Object.prototype.hasOwnProperty.call(memoryStore, key)) {
      try {
        return JSON.parse(memoryStore[key]);
      } catch (_) {
        return null;
      }
    }
    return null;
  }

  function writeStorage(key, value) {
    const serialized = JSON.stringify(value);
    memoryStore[key] = serialized;
    try {
      window.localStorage.setItem(key, serialized);
    } catch (_) {
      // Silently keep in-memory copy on restricted file:/// contexts
    }
  }

  function getCatalogProducts() {
    const cat = window.LIFEINSHOP_CATALOG;
    return cat && Array.isArray(cat.PRODUCTS) ? cat.PRODUCTS : [];
  }

  function findProductById(productId) {
    if (!productId) return null;
    const products = getCatalogProducts();
    for (let i = 0; i < products.length; i += 1) {
      if (products[i].id === productId) return products[i];
    }
    return null;
  }

  function getVariantSku(productOrId, size) {
    const product =
      typeof productOrId === "string" ? findProductById(productOrId) : productOrId;
    if (!product || !product.sku || size === undefined || size === null || size === "") {
      return "";
    }
    return product.sku + "-" + String(size).trim();
  }

  function normalizePhone(phone) {
    if (phone === undefined || phone === null) return "";
    let digits = String(phone).replace(/\D+/g, "");
    if (digits.startsWith("8801") && digits.length === 13) {
      digits = digits.slice(2);
    } else if (digits.startsWith("880") && digits.length > 11) {
      digits = "0" + digits.slice(3);
    } else if (digits.startsWith("88") && digits.length === 13) {
      digits = digits.slice(2);
    }
    return digits;
  }

  // Deterministic realistic stock seed across all 15 products / 72 variants
  const SEED_STOCK_BY_PRODUCT = {
    "air-jordan-4-grey": { "40": 3, "41": 5, "42": 4, "43": 2, "44": 0 },
    "air-jordan-4-brown": { "40": 2, "41": 4, "42": 3, "43": 0, "44": 2 },
    "nike-mind-white-black": { "40": 4, "41": 6, "42": 2, "43": 3, "44": 0 },
    "nike-zoomx-ash": { "40": 1, "41": 3, "42": 5, "43": 2, "44": 1 },
    "redtape-classic-white": { "40": 2, "41": 4, "42": 5, "43": 3, "44": 1 },
    "hoka-black-cream": { "40": 0, "41": 3, "42": 4, "43": 2, "44": 1 },
    "adidas-premium-sneakers": { "41": 3, "42": 5, "43": 4, "44": 2, "45": 0 },
    "panda-running-black": { "40": 4, "41": 6, "42": 5, "43": 3, "44": 2 },
    "slip-on-knit-black": { "40": 1, "41": 2, "42": 1, "43": 0, "44": 0 },
    "panda-slip-on-black": { "40": 3, "41": 4, "42": 3, "43": 2, "44": 1 },
    "american-eagle-denim": { "30": 3, "32": 6, "34": 5, "36": 4, "38": 2 },
    "ae-stretch-denim-jeans": { "30": 2, "32": 5, "34": 4, "36": 1, "38": 0 },
    "slim-fit-chino-pant": { "30": 4, "32": 7, "34": 6, "36": 3, "38": 2 },
    "mens-check-shirt": { M: 5, L: 6, XL: 2 },
    "drop-shoulder-polo": { M: 2, L: 1, XL: 1, XXL: 0 },
  };

  function buildSeedInventory() {
    const inv = {};
    const products = getCatalogProducts();
    for (let i = 0; i < products.length; i += 1) {
      const p = products[i];
      const map = SEED_STOCK_BY_PRODUCT[p.id] || {};
      const sizes = Array.isArray(p.sizes) ? p.sizes : [];
      for (let j = 0; j < sizes.length; j += 1) {
        const size = String(sizes[j]);
        const sku = getVariantSku(p, size);
        if (!sku) continue;
        const seeded = Object.prototype.hasOwnProperty.call(map, size)
          ? map[size]
          : 3;
        inv[sku] = Math.max(0, Number(seeded) || 0);
      }
    }
    return inv;
  }

  function minutesAgoIso(mins) {
    return new Date(Date.now() - mins * 60 * 1000).toISOString();
  }

  function buildSeedOrders() {
    const aj4Sku = getVariantSku("air-jordan-4-grey", "42") || "LIS-AJ4-GRY-42";
    const nmSku = getVariantSku("nike-mind-white-black", "41") || "LIS-NM-WBK-41";
    const rtSku = getVariantSku("redtape-classic-white", "42") || "LIS-RT-WHT-42";

    return [
      {
        orderNumber: "#LIS-1042",
        channel: "online",
        status: "pending",
        createdAt: minutesAgoIso(28),
        updatedAt: minutesAgoIso(28),
        customerName: "Tanvir Hasan",
        customerPhone: "01718452291",
        address: "House 14, Road 7, Uttara Sector 11, Dhaka",
        deliveryNote: "Call 15 mins before delivery",
        zone: "inside",
        deliveryFee: 80,
        items: [
          {
            productId: "air-jordan-4-grey",
            name: "Air Jordan 4 Sneakers — Grey",
            sku: aj4Sku,
            size: "42",
            qty: 1,
            price: 2190,
            image: "assets/images/products/air-jordan-4-grey-1.webp",
          },
        ],
        subtotal: 2190,
        discountType: null,
        discountAmount: 0,
        grandTotal: 2270,
        paymentMethod: "cod",
        paymentStatus: "unpaid",
        payments: [],
        paidAmount: 0,
        changeDue: 0,
        cashier: null,
        rtoCount: 0,
        stockRestockedAt: null,
        exchanges: [],
      },
      {
        orderNumber: "#LIS-1041",
        channel: "online",
        status: "confirmed",
        createdAt: minutesAgoIso(115),
        updatedAt: minutesAgoIso(92),
        customerName: "Mahmudul Karim",
        customerPhone: "01842903314",
        address: "Zindabazar Main Road, Sylhet",
        deliveryNote: "",
        zone: "outside",
        deliveryFee: 130,
        items: [
          {
            productId: "nike-mind-white-black",
            name: "Nike Mind Sneakers — White & Black",
            sku: nmSku,
            size: "41",
            qty: 1,
            price: 2490,
            image: "assets/images/products/nike-mind-white-black-1.webp",
          },
        ],
        subtotal: 2490,
        discountType: null,
        discountAmount: 0,
        grandTotal: 2620,
        paymentMethod: "cod",
        paymentStatus: "unpaid",
        payments: [],
        paidAmount: 0,
        changeDue: 0,
        cashier: null,
        rtoCount: 1,
        stockRestockedAt: null,
        exchanges: [],
      },
      {
        orderNumber: "#POS-2018",
        channel: "pos",
        status: "completed",
        createdAt: minutesAgoIso(185),
        updatedAt: minutesAgoIso(185),
        customerName: "Rafiqul Islam",
        customerPhone: "01911204877",
        address: "Narayanganj Showroom Counter",
        deliveryNote: "",
        zone: "showroom",
        deliveryFee: 0,
        items: [
          {
            productId: "redtape-classic-white",
            name: "RedTape Classic Sneakers — White",
            sku: rtSku,
            size: "42",
            qty: 1,
            price: 1450,
            image: "assets/images/products/redtape-classic-white-1.webp",
          },
        ],
        subtotal: 1450,
        discountType: "fixed",
        discountAmount: 50,
        grandTotal: 1400,
        paymentMethod: "cash",
        paymentStatus: "paid",
        payments: [{ method: "cash", amount: 1400, ref: "" }],
        paidAmount: 1500,
        changeDue: 100,
        cashier: "Emran (Owner)",
        rtoCount: 0,
        stockRestockedAt: null,
        exchanges: [],
      },
    ];
  }

  function buildSeedMovements() {
    const aj4Sku = getVariantSku("air-jordan-4-grey", "42") || "LIS-AJ4-GRY-42";
    const nmSku = getVariantSku("nike-mind-white-black", "41") || "LIS-NM-WBK-41";
    const rtSku = getVariantSku("redtape-classic-white", "42") || "LIS-RT-WHT-42";
    const chnSku = getVariantSku("slim-fit-chino-pant", "32") || "LIS-CHN-085-32";

    return [
      {
        id: "MOV-1004",
        createdAt: minutesAgoIso(28),
        sku: aj4Sku,
        productId: "air-jordan-4-grey",
        productName: "Air Jordan 4 Sneakers — Grey",
        size: "42",
        type: "online_order",
        qtyDelta: -1,
        stockBefore: 5,
        stockAfter: 4,
        refOrder: "#LIS-1042",
        note: "Website COD checkout — Inside Dhaka",
      },
      {
        id: "MOV-1003",
        createdAt: minutesAgoIso(115),
        sku: nmSku,
        productId: "nike-mind-white-black",
        productName: "Nike Mind Sneakers — White & Black",
        size: "41",
        type: "online_order",
        qtyDelta: -1,
        stockBefore: 7,
        stockAfter: 6,
        refOrder: "#LIS-1041",
        note: "Website COD checkout — Sylhet",
      },
      {
        id: "MOV-1002",
        createdAt: minutesAgoIso(185),
        sku: rtSku,
        productId: "redtape-classic-white",
        productName: "RedTape Classic Sneakers — White",
        size: "42",
        type: "pos_sale",
        qtyDelta: -1,
        stockBefore: 6,
        stockAfter: 5,
        refOrder: "#POS-2018",
        note: "Showroom counter cash sale (Emran)",
      },
      {
        id: "MOV-1001",
        createdAt: minutesAgoIso(260),
        sku: chnSku,
        productId: "slim-fit-chino-pant",
        productName: "Men's Premium Slim Fit Chino Pant",
        size: "32",
        type: "purchase_in",
        qtyDelta: 4,
        stockBefore: 3,
        stockAfter: 7,
        refOrder: "",
        note: "Morning showroom stock-in",
      },
    ];
  }

  function buildSeedShift() {
    const opened = new Date();
    opened.setHours(10, 0, 0, 0);
    if (opened.getTime() > Date.now()) {
      opened.setTime(Date.now() - 2 * 60 * 60 * 1000);
    }
    return {
      shiftId: "SH-2611-01",
      cashier: "Emran (Owner)",
      showroom: "Shimanto Tower, Shop 6031, Narayanganj",
      openedAt: opened.toISOString(),
      openingCash: 5000,
      status: "open",
    };
  }

  function ensureInitialized() {
    let inv = readStorage(STORAGE_KEYS.inventory);
    if (!inv || typeof inv !== "object" || Array.isArray(inv)) {
      inv = buildSeedInventory();
      writeStorage(STORAGE_KEYS.inventory, inv);
    } else {
      // Backfill any newly added catalog variants without clobbering existing stock
      const seeded = buildSeedInventory();
      let dirty = false;
      const keys = Object.keys(seeded);
      for (let i = 0; i < keys.length; i += 1) {
        if (!Object.prototype.hasOwnProperty.call(inv, keys[i])) {
          inv[keys[i]] = seeded[keys[i]];
          dirty = true;
        }
      }
      if (dirty) writeStorage(STORAGE_KEYS.inventory, inv);
    }

    const orders = readStorage(STORAGE_KEYS.orders);
    if (!Array.isArray(orders)) {
      writeStorage(STORAGE_KEYS.orders, buildSeedOrders());
    }

    const movements = readStorage(STORAGE_KEYS.movements);
    if (!Array.isArray(movements)) {
      writeStorage(STORAGE_KEYS.movements, buildSeedMovements());
    }

    const shift = readStorage(STORAGE_KEYS.shift);
    if (!shift || typeof shift !== "object" || Array.isArray(shift)) {
      writeStorage(STORAGE_KEYS.shift, buildSeedShift());
    }
  }

  function loadInventory() {
    ensureInitialized();
    return readStorage(STORAGE_KEYS.inventory) || {};
  }

  function loadOrders() {
    ensureInitialized();
    return readStorage(STORAGE_KEYS.orders) || [];
  }

  function loadMovements() {
    ensureInitialized();
    return readStorage(STORAGE_KEYS.movements) || [];
  }

  function loadShift() {
    ensureInitialized();
    return readStorage(STORAGE_KEYS.shift) || buildSeedShift();
  }

  function emitChange(reason, detail) {
    try {
      const payload = Object.assign({ reason: reason || "update", at: new Date().toISOString() }, detail || {});
      if (typeof window.CustomEvent === "function") {
        window.dispatchEvent(new window.CustomEvent(STORE_EVENT, { detail: payload }));
      }
    } catch (_) {
      // Non-browser environment fallback
    }
  }

  function makeMovementId(movements) {
    let maxNum = 1000;
    for (let i = 0; i < movements.length; i += 1) {
      const m = String(movements[i].id || "").match(/(\d+)$/);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n > maxNum) maxNum = n;
      }
    }
    return "MOV-" + String(maxNum + 1);
  }

  function generateOrderNumber(channel, orders) {
    const prefix = channel === "pos" ? "#POS-" : "#LIS-";
    let maxNum = channel === "pos" ? 2018 : 1042;
    const existing = Object.create(null);
    for (let i = 0; i < orders.length; i += 1) {
      const ordNum = String(orders[i].orderNumber || "");
      existing[ordNum.toUpperCase()] = true;
      if (ordNum.toUpperCase().startsWith(prefix)) {
        const numPart = parseInt(ordNum.slice(prefix.length), 10);
        if (!isNaN(numPart) && numPart > maxNum) {
          maxNum = numPart;
        }
      }
    }
    let next = maxNum + 1;
    let candidate = prefix + String(next);
    while (existing[candidate.toUpperCase()]) {
      next += 1;
      candidate = prefix + String(next);
    }
    return candidate;
  }

  function getStock(productId, size) {
    const sku = getVariantSku(productId, size);
    if (!sku) return 0;
    const inv = loadInventory();
    const val = Number(inv[sku]);
    return Number.isFinite(val) && val > 0 ? Math.floor(val) : 0;
  }

  function getProductStockMap(productId) {
    const product = findProductById(productId);
    if (!product) return {};
    const inv = loadInventory();
    const out = {};
    const sizes = Array.isArray(product.sizes) ? product.sizes : [];
    for (let i = 0; i < sizes.length; i += 1) {
      const s = String(sizes[i]);
      const sku = getVariantSku(product, s);
      const val = Number(inv[sku]);
      out[s] = Number.isFinite(val) && val > 0 ? Math.floor(val) : 0;
    }
    return out;
  }

  function getProductTotalStock(productId) {
    const map = getProductStockMap(productId);
    let total = 0;
    const keys = Object.keys(map);
    for (let i = 0; i < keys.length; i += 1) {
      total += map[keys[i]];
    }
    return total;
  }

  function getFirstInStockSize(productId) {
    const product = findProductById(productId);
    if (!product || !Array.isArray(product.sizes)) return null;
    const inv = loadInventory();
    for (let i = 0; i < product.sizes.length; i += 1) {
      const s = String(product.sizes[i]);
      const sku = getVariantSku(product, s);
      if ((Number(inv[sku]) || 0) > 0) return s;
    }
    return null;
  }

  function findVariantByCode(code) {
    if (!code) return null;
    const needle = String(code).trim().toUpperCase();
    if (!needle) return null;
    const products = getCatalogProducts();
    const inv = loadInventory();
    for (let i = 0; i < products.length; i += 1) {
      const p = products[i];
      const sizes = Array.isArray(p.sizes) ? p.sizes : [];
      for (let j = 0; j < sizes.length; j += 1) {
        const s = String(sizes[j]);
        const sku = getVariantSku(p, s);
        if (sku.toUpperCase() === needle) {
          const val = Number(inv[sku]);
          return {
            product: p,
            size: s,
            sku: sku,
            stock: Number.isFinite(val) && val > 0 ? Math.floor(val) : 0,
          };
        }
      }
    }
    return null;
  }

  function getOrders() {
    return loadOrders().slice();
  }

  function getOrderById(orderNumber) {
    if (!orderNumber) return null;
    const raw = String(orderNumber).trim().toUpperCase();
    const withHash = raw.startsWith("#") ? raw : "#" + raw;
    const orders = loadOrders();
    for (let i = 0; i < orders.length; i += 1) {
      const cur = String(orders[i].orderNumber || "").trim().toUpperCase();
      if (cur === raw || cur === withHash) {
        return orders[i];
      }
    }
    return null;
  }

  function getMovements() {
    return loadMovements().slice();
  }

  function getShift() {
    return Object.assign({}, loadShift());
  }

  function lookupCustomerByPhone(phone) {
    const norm = normalizePhone(phone);
    if (!norm || norm.length < 10) return null;
    const orders = loadOrders();
    let orderCount = 0;
    let totalSpent = 0;
    let baseHistoricalRto = 0;
    let liveReturnedCount = 0;
    let name = "";
    let lastAddress = "";

    for (let i = 0; i < orders.length; i += 1) {
      const o = orders[i];
      if (normalizePhone(o.customerPhone) !== norm) continue;
      orderCount += 1;
      if (!name && o.customerName) name = o.customerName;
      if (!lastAddress && o.address && o.zone !== "showroom") {
        lastAddress = o.address;
      }
      if (o.status !== "cancelled" && o.status !== "returned") {
        totalSpent += Number(o.grandTotal) || 0;
      }
      if (o.status === "returned") {
        liveReturnedCount += 1;
      }
      const seededRto = Number(o.rtoCount) || 0;
      if (seededRto > baseHistoricalRto) {
        baseHistoricalRto = seededRto;
      }
    }

    if (orderCount === 0) return null;

    if (!lastAddress) {
      for (let i = 0; i < orders.length; i += 1) {
        if (normalizePhone(orders[i].customerPhone) === norm && orders[i].address) {
          lastAddress = orders[i].address;
          break;
        }
      }
    }

    return {
      name: name || "Returning Customer",
      phone: norm,
      orderCount: orderCount,
      totalSpent: totalSpent,
      rtoCount: Math.max(baseHistoricalRto, liveReturnedCount) + (baseHistoricalRto > 0 && liveReturnedCount > 0 ? liveReturnedCount : 0),
      lastAddress: lastAddress || "",
    };
  }

  function commitSale(payload) {
    const data = payload || {};
    const channel = data.channel === "pos" ? "pos" : "online";
    const rawItems = Array.isArray(data.items) ? data.items : [];
    if (rawItems.length === 0) {
      return { ok: false, error: "Cannot complete order with an empty cart." };
    }

    const inv = loadInventory();
    const requiredBySku = Object.create(null);
    const normalizedItems = [];

    for (let i = 0; i < rawItems.length; i += 1) {
      const row = rawItems[i];
      const product = findProductById(row.productId);
      if (!product) {
        return { ok: false, error: "Product not found in catalog." };
      }
      const size = String(row.size || "").trim();
      const qty = Math.floor(Number(row.qty) || 0);
      if (!size || qty < 1) {
        return { ok: false, error: "Invalid size or quantity for " + product.name + "." };
      }
      const sku = getVariantSku(product, size);
      if (!sku) {
        return { ok: false, error: "Invalid variant SKU for " + product.name + "." };
      }
      requiredBySku[sku] = (requiredBySku[sku] || 0) + qty;
      normalizedItems.push({
        productId: product.id,
        name: row.name || product.name,
        sku: sku,
        size: size,
        qty: qty,
        price: Number.isFinite(Number(row.price)) ? Number(row.price) : product.price,
        image: row.image || (product.images && product.images[0]) || "",
      });
    }

    // Strict pre-commit atomic stock validation across aggregated SKUs
    for (let i = 0; i < normalizedItems.length; i += 1) {
      const item = normalizedItems[i];
      const avail = Math.max(0, Math.floor(Number(inv[item.sku]) || 0));
      const needed = requiredBySku[item.sku];
      if (avail < needed) {
        return {
          ok: false,
          error:
            avail === 0
              ? item.name + " (Size " + item.size + ") just sold out."
              : "Only " + avail + " left in " + item.name + " (Size " + item.size + ").",
        };
      }
    }

    const orders = loadOrders();
    const movements = loadMovements();
    const now = new Date().toISOString();
    const orderNumber = generateOrderNumber(channel, orders);

    // Atomic deduction + immutable movement log entries
    const movType = channel === "pos" ? "pos_sale" : "online_order";
    for (let i = 0; i < normalizedItems.length; i += 1) {
      const item = normalizedItems[i];
      const before = Math.max(0, Math.floor(Number(inv[item.sku]) || 0));
      const after = Math.max(0, before - item.qty);
      inv[item.sku] = after;

      movements.unshift({
        id: makeMovementId(movements),
        createdAt: now,
        sku: item.sku,
        productId: item.productId,
        productName: item.name,
        size: item.size,
        type: movType,
        qtyDelta: -item.qty,
        stockBefore: before,
        stockAfter: after,
        refOrder: orderNumber,
        note:
          channel === "pos"
            ? "Showroom POS counter sale"
            : "Online storefront checkout (" + (data.zone === "outside" ? "Outside Dhaka" : "Inside Dhaka") + ")",
      });
    }

    let subtotal = 0;
    for (let i = 0; i < normalizedItems.length; i += 1) {
      subtotal += normalizedItems[i].price * normalizedItems[i].qty;
    }
    const discountAmount = Math.max(
      0,
      Math.min(subtotal, Math.round(Number(data.discountAmount) || 0))
    );
    const deliveryFee =
      channel === "pos" ? 0 : Math.max(0, Math.round(Number(data.deliveryFee) || 0));
    const grandTotal = Math.max(0, subtotal - discountAmount + deliveryFee);

    const paymentMethod = data.paymentMethod || (channel === "pos" ? "cash" : "cod");
    let payments = Array.isArray(data.payments)
      ? data.payments.map(function (p) {
          return {
            method: String(p.method || "cash"),
            amount: Math.max(0, Math.round(Number(p.amount) || 0)),
            ref: String(p.ref || "").trim(),
          };
        })
      : [];

    if (channel === "pos" && payments.length === 0) {
      payments = [{ method: paymentMethod, amount: grandTotal, ref: "" }];
    }

    const cleanPhone = normalizePhone(data.customerPhone || "");
    const existingCustomer = cleanPhone ? lookupCustomerByPhone(cleanPhone) : null;
    const priorRto = existingCustomer ? existingCustomer.rtoCount : 0;
    const shift = loadShift();

    const order = {
      orderNumber: orderNumber,
      channel: channel,
      status: channel === "pos" ? "completed" : "pending",
      createdAt: now,
      updatedAt: now,
      customerName:
        String(data.customerName || "").trim() ||
        (channel === "pos" ? "Walk-in Customer" : "Online Customer"),
      customerPhone: cleanPhone || String(data.customerPhone || "").trim(),
      address:
        String(data.address || "").trim() ||
        (channel === "pos" ? "Narayanganj Showroom Counter" : ""),
      deliveryNote: String(data.deliveryNote || "").trim(),
      zone: data.zone || (channel === "pos" ? "showroom" : "inside"),
      deliveryFee: deliveryFee,
      items: normalizedItems,
      subtotal: subtotal,
      discountType: discountAmount > 0 ? data.discountType || "fixed" : null,
      discountAmount: discountAmount,
      grandTotal: grandTotal,
      paymentMethod: paymentMethod,
      paymentStatus: channel === "pos" ? "paid" : "unpaid",
      payments: payments,
      paidAmount:
        channel === "pos"
          ? Math.max(grandTotal, Math.round(Number(data.paidAmount) || grandTotal))
          : 0,
      changeDue:
        channel === "pos" ? Math.max(0, Math.round(Number(data.changeDue) || 0)) : 0,
      cashier: channel === "pos" ? data.cashier || shift.cashier || "Emran (Owner)" : null,
      rtoCount: priorRto,
      stockRestockedAt: null,
      exchanges: [],
    };

    orders.unshift(order);

    writeStorage(STORAGE_KEYS.inventory, inv);
    writeStorage(STORAGE_KEYS.orders, orders);
    writeStorage(STORAGE_KEYS.movements, movements);

    emitChange("sale", { orderNumber: orderNumber, channel: channel });
    return { ok: true, order: order };
  }

  const VALID_ONLINE_STATUSES = {
    pending: true,
    confirmed: true,
    packed: true,
    shipped: true,
    delivered: true,
    cancelled: true,
    returned: true,
  };

  function updateOnlineOrderStatus(orderNumber, newStatus, opts) {
    const options = opts || {};
    const status = String(newStatus || "").trim().toLowerCase();
    if (!VALID_ONLINE_STATUSES[status]) {
      return { ok: false, error: "Invalid order status: " + newStatus };
    }

    const orders = loadOrders();
    const raw = String(orderNumber || "").trim().toUpperCase();
    const withHash = raw.startsWith("#") ? raw : "#" + raw;
    let idx = -1;
    for (let i = 0; i < orders.length; i += 1) {
      const cur = String(orders[i].orderNumber || "").trim().toUpperCase();
      if (cur === raw || cur === withHash) {
        idx = i;
        break;
      }
    }
    if (idx === -1) {
      return { ok: false, error: "Order not found." };
    }

    const order = orders[idx];
    const now = new Date().toISOString();
    order.status = status;
    order.updatedAt = now;

    if (status === "delivered") {
      order.paymentStatus = "paid";
    }

    const inv = loadInventory();
    const movements = loadMovements();
    let invChanged = false;
    let movChanged = false;

    if ((status === "cancelled" || status === "returned") && !order.stockRestockedAt) {
      const items = Array.isArray(order.items) ? order.items : [];
      const isDamaged = options.damaged === true;

      for (let i = 0; i < items.length; i += 1) {
        const item = items[i];
        const sku = getVariantSku(item.productId, item.size) || item.sku;
        const qty = Math.max(1, Math.floor(Number(item.qty) || 1));
        const before = Math.max(0, Math.floor(Number(inv[sku]) || 0));

        if (isDamaged) {
          movements.unshift({
            id: makeMovementId(movements),
            createdAt: now,
            sku: sku,
            productId: item.productId,
            productName: item.name,
            size: String(item.size),
            type: "manual_adjust",
            qtyDelta: 0,
            stockBefore: before,
            stockAfter: before,
            refOrder: order.orderNumber,
            note: options.note || "Damaged return — not restocked",
          });
          movChanged = true;
        } else {
          const after = before + qty;
          inv[sku] = after;
          invChanged = true;
          movements.unshift({
            id: makeMovementId(movements),
            createdAt: now,
            sku: sku,
            productId: item.productId,
            productName: item.name,
            size: String(item.size),
            type:
              status === "cancelled"
                ? "online_cancel_restock"
                : "courier_return_restock",
            qtyDelta: qty,
            stockBefore: before,
            stockAfter: after,
            refOrder: order.orderNumber,
            note:
              options.note ||
              (status === "cancelled"
                ? "Online order cancelled — auto-restocked"
                : "Courier RTO return received — restocked"),
          });
          movChanged = true;
        }
      }

      order.stockRestockedAt = now;
      order.damagedReturn = isDamaged;
    }

    if (invChanged) writeStorage(STORAGE_KEYS.inventory, inv);
    writeStorage(STORAGE_KEYS.orders, orders);
    if (movChanged) writeStorage(STORAGE_KEYS.movements, movements);

    emitChange("order-status", { orderNumber: order.orderNumber, status: status });
    return { ok: true, order: order };
  }

  function exchangeOrderItemSize(orderNumber, itemIndex, newSize) {
    const orders = loadOrders();
    const raw = String(orderNumber || "").trim().toUpperCase();
    const withHash = raw.startsWith("#") ? raw : "#" + raw;
    let ordIdx = -1;
    for (let i = 0; i < orders.length; i += 1) {
      const cur = String(orders[i].orderNumber || "").trim().toUpperCase();
      if (cur === raw || cur === withHash) {
        ordIdx = i;
        break;
      }
    }
    if (ordIdx === -1) {
      return { ok: false, error: "Order not found." };
    }

    const order = orders[ordIdx];
    const items = Array.isArray(order.items) ? order.items : [];
    const idx = Number(itemIndex);
    if (!Number.isInteger(idx) || idx < 0 || idx >= items.length) {
      return { ok: false, error: "Order item not found." };
    }

    const item = items[idx];
    const oldSize = String(item.size);
    const targetSize = String(newSize || "").trim();
    if (!targetSize || targetSize === oldSize) {
      return { ok: false, error: "Select a different replacement size." };
    }

    const product = findProductById(item.productId);
    if (!product || !Array.isArray(product.sizes) || product.sizes.indexOf(targetSize) === -1) {
      return { ok: false, error: "Size " + targetSize + " is not valid for this item." };
    }

    const inv = loadInventory();
    const oldSku = getVariantSku(product, oldSize);
    const newSku = getVariantSku(product, targetSize);
    const qty = Math.max(1, Math.floor(Number(item.qty) || 1));
    const availNew = Math.max(0, Math.floor(Number(inv[newSku]) || 0));

    if (availNew < qty) {
      return {
        ok: false,
        error: "Insufficient stock for Size " + targetSize + " (" + availNew + " left).",
      };
    }

    const movements = loadMovements();
    const now = new Date().toISOString();

    // Atomic swap: +qty back to old size, -qty from new size
    const oldBefore = Math.max(0, Math.floor(Number(inv[oldSku]) || 0));
    const oldAfter = oldBefore + qty;
    inv[oldSku] = oldAfter;

    const newBefore = availNew;
    const newAfter = Math.max(0, newBefore - qty);
    inv[newSku] = newAfter;

    movements.unshift({
      id: makeMovementId(movements),
      createdAt: now,
      sku: oldSku,
      productId: product.id,
      productName: item.name,
      size: oldSize,
      type: "size_exchange_in",
      qtyDelta: qty,
      stockBefore: oldBefore,
      stockAfter: oldAfter,
      refOrder: order.orderNumber,
      note: "7-day size exchange: returned Size " + oldSize + " for Size " + targetSize,
    });

    movements.unshift({
      id: makeMovementId(movements),
      createdAt: now,
      sku: newSku,
      productId: product.id,
      productName: item.name,
      size: targetSize,
      type: "size_exchange_out",
      qtyDelta: -qty,
      stockBefore: newBefore,
      stockAfter: newAfter,
      refOrder: order.orderNumber,
      note: "7-day size exchange: issued Size " + targetSize + " (from Size " + oldSize + ")",
    });

    item.size = targetSize;
    item.sku = newSku;
    if (!Array.isArray(order.exchanges)) order.exchanges = [];
    order.exchanges.push({
      fromSize: oldSize,
      toSize: targetSize,
      at: now,
      productName: item.name,
      qty: qty,
    });
    order.updatedAt = now;

    writeStorage(STORAGE_KEYS.inventory, inv);
    writeStorage(STORAGE_KEYS.orders, orders);
    writeStorage(STORAGE_KEYS.movements, movements);

    emitChange("size-exchange", {
      orderNumber: order.orderNumber,
      fromSize: oldSize,
      toSize: targetSize,
    });
    return { ok: true, order: order };
  }

  function adjustVariantStock(productId, size, delta, note) {
    const product = findProductById(productId);
    if (!product) {
      return { ok: false, error: "Product not found." };
    }
    const cleanSize = String(size || "").trim();
    const sku = getVariantSku(product, cleanSize);
    if (!sku) {
      return { ok: false, error: "Invalid size." };
    }
    const d = Math.trunc(Number(delta) || 0);
    if (d === 0) {
      return { ok: true, stockAfter: getStock(productId, cleanSize) };
    }

    const inv = loadInventory();
    const before = Math.max(0, Math.floor(Number(inv[sku]) || 0));
    const after = Math.max(0, before + d);
    const actualDelta = after - before;
    inv[sku] = after;

    const movements = loadMovements();
    if (actualDelta !== 0) {
      movements.unshift({
        id: makeMovementId(movements),
        createdAt: new Date().toISOString(),
        sku: sku,
        productId: product.id,
        productName: product.name,
        size: cleanSize,
        type: actualDelta > 0 ? "purchase_in" : "manual_adjust",
        qtyDelta: actualDelta,
        stockBefore: before,
        stockAfter: after,
        refOrder: "",
        note:
          String(note || "").trim() ||
          (actualDelta > 0 ? "Showroom stock-in adjustment" : "Manual stock count adjustment"),
      });
    }

    writeStorage(STORAGE_KEYS.inventory, inv);
    writeStorage(STORAGE_KEYS.movements, movements);

    emitChange("stock-adjust", { sku: sku, stockAfter: after });
    return { ok: true, stockAfter: after, stockBefore: before, sku: sku };
  }

  function getShiftMetrics() {
    const shift = loadShift();
    const orders = loadOrders();
    const openingCash = Number(shift.openingCash) || 0;

    let posCash = 0;
    let posBkash = 0;
    let posNagad = 0;
    let posCard = 0;
    let posTotal = 0;
    let posCount = 0;

    let onlinePendingCount = 0;
    let onlineConfirmedCount = 0;
    let onlinePackedCount = 0;
    let onlineShippedCount = 0;
    let onlineActiveCount = 0;
    let onlineDeliveredCount = 0;
    let onlineRevenue = 0;
    let onlineDeliveredRevenue = 0;

    for (let i = 0; i < orders.length; i += 1) {
      const o = orders[i];
      const total = Number(o.grandTotal) || 0;

      if (o.channel === "pos") {
        if (o.status === "cancelled" || o.status === "returned") continue;
        posCount += 1;
        posTotal += total;

        const pays = Array.isArray(o.payments) && o.payments.length > 0
          ? o.payments
          : [{ method: o.paymentMethod || "cash", amount: total }];

        for (let j = 0; j < pays.length; j += 1) {
          const m = String(pays[j].method || "cash").toLowerCase();
          const amt = Number(pays[j].amount) || 0;
          if (m === "cash") posCash += amt;
          else if (m === "bkash") posBkash += amt;
          else if (m === "nagad") posNagad += amt;
          else if (m === "card") posCard += amt;
        }
      } else {
        const st = String(o.status || "pending").toLowerCase();
        if (st === "pending") {
          onlinePendingCount += 1;
          onlineActiveCount += 1;
          onlineRevenue += total;
        } else if (st === "confirmed") {
          onlineConfirmedCount += 1;
          onlineActiveCount += 1;
          onlineRevenue += total;
        } else if (st === "packed") {
          onlinePackedCount += 1;
          onlineActiveCount += 1;
          onlineRevenue += total;
        } else if (st === "shipped") {
          onlineShippedCount += 1;
          onlineActiveCount += 1;
          onlineRevenue += total;
        } else if (st === "delivered") {
          onlineDeliveredCount += 1;
          onlineRevenue += total;
          onlineDeliveredRevenue += total;
        }
      }
    }

    return {
      openingCash: openingCash,
      posCash: posCash,
      posBkash: posBkash,
      posNagad: posNagad,
      posCard: posCard,
      posTotal: posTotal,
      posCount: posCount,
      onlinePendingCount: onlinePendingCount,
      onlineConfirmedCount: onlineConfirmedCount,
      onlinePackedCount: onlinePackedCount,
      onlineShippedCount: onlineShippedCount,
      onlineActiveCount: onlineActiveCount,
      onlineDeliveredCount: onlineDeliveredCount,
      onlineRevenue: onlineRevenue,
      onlineDeliveredRevenue: onlineDeliveredRevenue,
      totalRevenue: posTotal + onlineRevenue,
      expectedDrawerCash: openingCash + posCash,
    };
  }

  function resetDemoData() {
    writeStorage(STORAGE_KEYS.inventory, buildSeedInventory());
    writeStorage(STORAGE_KEYS.orders, buildSeedOrders());
    writeStorage(STORAGE_KEYS.movements, buildSeedMovements());
    writeStorage(STORAGE_KEYS.shift, buildSeedShift());
    emitChange("reset", {});
    return { ok: true };
  }

  function subscribe(fn) {
    if (typeof fn !== "function") {
      return function () {};
    }
    const onCustom = function (ev) {
      fn(ev && ev.detail ? ev.detail : { reason: "local" });
    };
    const onStorage = function (ev) {
      if (!ev || !ev.key) {
        fn({ reason: "storage" });
        return;
      }
      if (
        ev.key === STORAGE_KEYS.inventory ||
        ev.key === STORAGE_KEYS.orders ||
        ev.key === STORAGE_KEYS.movements ||
        ev.key === STORAGE_KEYS.shift
      ) {
        // Keep in-memory cache synced with cross-tab change
        if (ev.newValue !== null) {
          memoryStore[ev.key] = ev.newValue;
        }
        fn({ reason: "storage", key: ev.key });
      }
    };

    try {
      window.addEventListener(STORE_EVENT, onCustom);
      window.addEventListener("storage", onStorage);
    } catch (_) {
      // Non-DOM test environment
    }

    return function unsubscribe() {
      try {
        window.removeEventListener(STORE_EVENT, onCustom);
        window.removeEventListener("storage", onStorage);
      } catch (_) {
        // ignore
      }
    };
  }

  // Initialize cleanly on load
  ensureInitialized();

  window.LIFEINSHOP_STORE = {
    STORAGE_KEYS: STORAGE_KEYS,
    normalizePhone: normalizePhone,
    getVariantSku: getVariantSku,
    getStock: getStock,
    getProductStockMap: getProductStockMap,
    getProductTotalStock: getProductTotalStock,
    getFirstInStockSize: getFirstInStockSize,
    findVariantByCode: findVariantByCode,
    getOrders: getOrders,
    getOrderById: getOrderById,
    getMovements: getMovements,
    getShift: getShift,
    lookupCustomerByPhone: lookupCustomerByPhone,
    commitSale: commitSale,
    updateOnlineOrderStatus: updateOnlineOrderStatus,
    exchangeOrderItemSize: exchangeOrderItemSize,
    adjustVariantStock: adjustVariantStock,
    getShiftMetrics: getShiftMetrics,
    resetDemoData: resetDemoData,
    subscribe: subscribe,
  };
})();
