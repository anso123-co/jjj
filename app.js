import { supabase } from "./supabaseClient.js";

const fmtCOP = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });

/** UI helpers */
const $ = (id) => document.getElementById(id);

function toast(message, type = "success", ms = 2600) {
  const host = $("toasts");
  if (!host) return;

  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.innerHTML = `
    <p class="msg">${escapeHtml(message)}</p>
    <button class="btn icon" aria-label="Cerrar notificación">✕</button>
  `;
  const btn = el.querySelector("button");
  btn.addEventListener("click", () => el.remove());
  host.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (m) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[m]));
}

function clampInt(v, def = 0) {
  const n = parseInt(String(v).replace(/[^\d-]/g, ""), 10);
  return Number.isFinite(n) ? n : def;
}

function calcFinalPrice(basePrice, extra, discountPercent) {
  const pre = (basePrice || 0) + (extra || 0);
  const disc = Math.max(0, Math.min(100, discountPercent || 0));
  const final = Math.round(pre * (1 - disc / 100));
  return { pre, final, disc };
}

/** Admin access (oculto) */
function goToAdmin() {
  try {
    const url = new URL("./admin.html", window.location.href).href;
    window.location.assign(url);
  } catch {
    window.location.href = "./admin.html";
  }
}

function normalizeShortcut(raw) {
  // Remove accents, spaces, punctuation and weird IME chars.
  return String(raw || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function checkAdminShortcutFromInput(raw) {
  const norm = normalizeShortcut(raw);
  if (norm !== "admin") return false;

  const si = $("searchInput");
  if (si) si.value = "";

  // pequeño delay para que Android procese el evento sin “romper” el input
  setTimeout(goToAdmin, 180);
  return true;
}

function setupLogoLongPress() {
  const logo = $("brandLogo");
  if (!logo) return;

  let t = null;
  const ms = 1200;

  const clear = () => {
    if (t) clearTimeout(t);
    t = null;
  };

  const start = (e) => {
    // evita click fantasma
    clear();
    t = setTimeout(() => {
      clear();
      goToAdmin();
    }, ms);
  };

  const cancel = () => clear();

  logo.addEventListener("pointerdown", start, { passive: true });
  logo.addEventListener("pointerup", cancel, { passive: true });
  logo.addEventListener("pointercancel", cancel, { passive: true });
  logo.addEventListener("pointerleave", cancel, { passive: true });
}

/** Cart storage */
const CART_KEY = "lumina_cart_v1";

function loadCart() {
  try {
    const raw = localStorage.getItem(CART_KEY);
    const arr = JSON.parse(raw || "[]");
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function saveCart(items) {
  localStorage.setItem(CART_KEY, JSON.stringify(items || []));
}

function cartKey(item) {
  return `${item.product_id}__${item.size_id}__${item.color}`;
}

function cartCount(cart) {
  return cart.reduce((acc, it) => acc + (it.qty || 0), 0);
}

function calcShipping(subtotal) {
  if (subtotal >= 150000) return 0;
  return subtotal > 0 ? 12000 : 0;
}

/** Data */
let allProducts = []; // with sizes embedded
let filtered = [];
let categories = [];
let catNameBySlug = new Map();

function prettyCategory(slug) {
  const key = String(slug || "").toLowerCase();
  return catNameBySlug.get(key) || (key ? (key[0].toUpperCase() + key.slice(1)) : "Accesorios");
}

async function initCategories() {
  try {
    const { data, error } = await supabase
      .from("categories")
      .select("slug,name,is_active,sort_order")
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });

    if (error) throw error;

    categories = (data || []).filter(c => c.is_active !== false);
    catNameBySlug = new Map(categories.map(c => [String(c.slug || "").toLowerCase(), c.name]));

    hydrateCategorySelect();
  } catch {
    // Si no existe la tabla o falla, no rompemos: dejamos el select como está.
  }
}

function hydrateCategorySelect() {
  const sel = $("categorySelect");
  if (!sel) return;

  const prev = sel.value || "";
  sel.innerHTML = `<option value="">Todas</option>`;

  for (const c of categories) {
    const opt = document.createElement("option");
    opt.value = c.slug;
    opt.textContent = c.name;
    sel.appendChild(opt);
  }

  sel.value = prev; // intenta conservar
}

const state = {
  q: "",
  category: "",
  featuredOnly: false,
  priceCap: null,
  sort: "featured",

  modalProduct: null,
  modalSizeId: null,
  modalColor: null,
};

async function fetchCatalog() {
  $("loadingBar")?.classList.remove("hidden");
  $("emptyState")?.classList.add("hidden");

  try {
    const { data: products, error: pErr } = await supabase
      .from("products")
      .select("id,name,category,desc,base_price,discount_percent,featured,colors,image_url,image_path,created_at")
      .order("created_at", { ascending: false });

    if (pErr) throw pErr;

    const { data: sizes, error: sErr } = await supabase
      .from("product_sizes")
      .select("id,product_id,label,extra_price")
      .order("created_at", { ascending: true });

    if (sErr) throw sErr;

    // embed sizes
    const byProd = new Map();
    for (const s of (sizes || [])) {
      if (!byProd.has(s.product_id)) byProd.set(s.product_id, []);
      byProd.get(s.product_id).push(s);
    }

    allProducts = (products || []).map(p => ({ ...p, sizes: byProd.get(p.id) || [] }));

    // fill categories select if missing (optional)
    applyFiltersRender();
    renderCart(); // update count
  } catch (e) {
    console.error(e);
    toast(`Error cargando productos: ${e?.message || e}`, "error", 4200);
    allProducts = [];
    filtered = [];
    renderGrid();
  } finally {
    $("loadingBar")?.classList.add("hidden");
  }
}

function applyFiltersRender() {
  const q = (state.q || "").trim().toLowerCase();
  const cat = (state.category || "").trim().toLowerCase();

  let items = allProducts.slice();

  // search (name, category, desc)
  if (q) {
    items = items.filter(p => {
      const name = (p.name || "").toLowerCase();
      const c = (p.category || "").toLowerCase();
      const d = (p.desc || "").toLowerCase();
      return name.includes(q) || c.includes(q) || d.includes(q);
    });
  }

  // category
  if (cat) {
    items = items.filter(p => (p.category || "").toLowerCase() === cat);
  }

  // featured only
  if (state.featuredOnly === true || state.featuredOnly === "yes") {
    items = items.filter(p => !!p.featured);
  }

  // price cap based on final "desde"
  if (Number.isFinite(state.priceCap) && state.priceCap !== null) {
    items = items.filter(p => {
      const minExtra = (p.sizes?.length ? Math.min(...p.sizes.map(s => s.extra_price || 0)) : 0);
      const { final } = calcFinalPrice(p.base_price || 0, minExtra, p.discount_percent || 0);
      return final <= state.priceCap;
    });
  }

  // sorting
  const sort = state.sort;
  items.sort((a,b) => {
    if (sort === "featured") {
      if (!!a.featured !== !!b.featured) return a.featured ? -1 : 1;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    }

    const minA = (a.sizes?.length ? Math.min(...a.sizes.map(s => s.extra_price || 0)) : 0);
    const minB = (b.sizes?.length ? Math.min(...b.sizes.map(s => s.extra_price || 0)) : 0);
    const priceA = calcFinalPrice(a.base_price || 0, minA, a.discount_percent || 0).final;
    const priceB = calcFinalPrice(b.base_price || 0, minB, b.discount_percent || 0).final;

    if (sort === "price_asc") return priceA - priceB;
    if (sort === "price_desc") return priceB - priceA;

    const nameA = (a.name || "").toLowerCase();
    const nameB = (b.name || "").toLowerCase();
    if (sort === "name_asc") return nameA.localeCompare(nameB, "es");
    if (sort === "name_desc") return nameB.localeCompare(nameA, "es");
    return 0;
  });

  filtered = items;
  renderGrid();
}

function fallbackImg() {
  // Placeholder ultra-ligero (data URI SVG) — CLARO (sin tema oscuro)
  const svg = encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="900" height="675">
      <defs>
        <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
          <stop stop-color="#7c3aed" stop-opacity=".20" offset="0"/>
          <stop stop-color="#06b6d4" stop-opacity=".14" offset="1"/>
        </linearGradient>
      </defs>
      <rect width="100%" height="100%" fill="#f8fafc"/>
      <rect x="40" y="40" width="820" height="595" rx="36" fill="url(#g)" stroke="rgba(15,23,42,.12)"/>
      <text x="50%" y="52%" dominant-baseline="middle" text-anchor="middle"
        fill="rgba(11,18,32,.70)" font-family="system-ui,Segoe UI,Roboto" font-size="28" font-weight="800">
        ACCESORIOS
      </text>
      <text x="50%" y="58%" dominant-baseline="middle" text-anchor="middle"
        fill="rgba(11,18,32,.45)" font-family="system-ui,Segoe UI,Roboto" font-size="16">
        imagen pendiente
      </text>
    </svg>
  `);
  return `data:image/svg+xml;charset=utf-8,${svg}`;
}

function renderGrid() {
  const grid = $("productsGrid");
  if (!grid) return;

  grid.innerHTML = "";
  const count = $("resultCount");
  if (count) count.textContent = `${filtered.length} producto(s)`;

  if (!filtered.length) {
    $("emptyState")?.classList.remove("hidden");
    return;
  }
  $("emptyState")?.classList.add("hidden");

  const frag = document.createDocumentFragment();

  for (const p of filtered) {
    const minExtra = (p.sizes?.length ? Math.min(...p.sizes.map(s => s.extra_price || 0)) : 0);
    const { pre, final, disc } = calcFinalPrice(p.base_price || 0, minExtra, p.discount_percent || 0);

    const card = document.createElement("article");
    card.className = "card";
    card.innerHTML = `
      <div class="cardMedia">
        <img src="${escapeHtml(p.image_url || fallbackImg())}"
             alt="${escapeHtml(p.name || "Producto")}"
             loading="lazy" decoding="async" />
      </div>
      <div class="cardBody">
        <div class="cardBadges">
          <span class="badge category">${escapeHtml((p.category || "accesorios").toLowerCase())}</span>
          ${p.featured ? `<span class="badge featured">Destacado</span>` : ""}
          ${disc > 0 ? `<span class="badge discount">-${disc}%</span>` : ""}
        </div>

        <h3 class="cardTitle">${escapeHtml(p.name || "Producto")}</h3>

        <div class="priceRow" aria-label="Precio">
          <div>
            <div class="muted tiny">Desde</div>
            <div class="row" style="gap:10px; align-items:baseline;">
              <div class="priceMain">${fmtCOP.format(final)}</div>
              ${disc > 0 ? `<div class="priceOld">${fmtCOP.format(pre)}</div>` : ""}
            </div>
          </div>
          <span class="badge">COP</span>
        </div>

        <div class="cardActions">
          <button class="btn primary block" type="button" aria-label="Ver detalles">Ver</button>
        </div>
      </div>
    `;

    card.querySelector("button").addEventListener("click", () => openModal(p.id));
    frag.appendChild(card);
  }

  grid.appendChild(frag);
}

/** Modal + focus management */
let lastFocusEl = null;

function openModal(productId) {
  const p = allProducts.find(x => x.id === productId);
  if (!p) return;

  state.modalProduct = p;

  $("modalTitle").textContent = p.name || "Producto";
  $("modalDesc").textContent = p.desc || "Sin descripción.";
  $("modalImg").src = p.image_url || fallbackImg();
  $("modalImg").alt = p.name || "Producto";

  const badges = [];
  badges.push(`<span class="badge category">${escapeHtml(p.category || "accesorios")}</span>`);
  if (p.featured) badges.push(`<span class="badge featured">Destacado</span>`);
  if ((p.discount_percent || 0) > 0) badges.push(`<span class="badge discount">-${p.discount_percent}%</span>`);
  $("modalBadges").innerHTML = badges.join("");

  // sizes
  const sizeSelect = $("sizeSelect");
  sizeSelect.innerHTML = "";
  const sizes = (p.sizes?.length ? p.sizes : [{ id: "no-size", product_id: p.id, label: "Única", extra_price: 0 }]);
  for (const s of sizes) {
    const opt = document.createElement("option");
    opt.value = s.id;
    opt.textContent = `${s.label}${s.extra_price ? ` (+${fmtCOP.format(s.extra_price)})` : ""}`;
    sizeSelect.appendChild(opt);
  }
  state.modalSizeId = sizes[0].id;

  // colors
  const colorSelect = $("colorSelect");
  colorSelect.innerHTML = "";
  const colors = (Array.isArray(p.colors) && p.colors.length) ? p.colors : ["Negro"];
  for (const c of colors) {
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c;
    colorSelect.appendChild(opt);
  }
  state.modalColor = colors[0];

  sizeSelect.onchange = () => {
    state.modalSizeId = sizeSelect.value;
    updateModalPrice();
  };
  colorSelect.onchange = () => {
    state.modalColor = colorSelect.value;
  };

  updateModalPrice();

  // show (hidden + class for CSS)
  lastFocusEl = document.activeElement;
  $("modalBackdrop").hidden = false;
  $("productModal").hidden = false;
  $("modalBackdrop").setAttribute("aria-hidden", "false");
  $("productModal").classList.add("open");
  $("modalBackdrop").classList.add("open");

  // focus first primary action
  setTimeout(() => $("addToCartBtn")?.focus(), 0);
}

function closeModal() {
  $("modalBackdrop")?.classList.remove("open");
  $("productModal")?.classList.remove("open");
  $("modalBackdrop")?.setAttribute("aria-hidden", "true");

  // hide after a tick (no animation heavy)
  setTimeout(() => {
    if ($("modalBackdrop")) $("modalBackdrop").hidden = true;
    if ($("productModal")) $("productModal").hidden = true;
  }, 0);

  state.modalProduct = null;
  state.modalSizeId = null;
  state.modalColor = null;

  if (lastFocusEl && typeof lastFocusEl.focus === "function") {
    setTimeout(() => lastFocusEl.focus(), 0);
  }
}

function updateModalPrice() {
  const p = state.modalProduct;
  if (!p) return;

  const size = (p.sizes?.length ? p.sizes.find(s => s.id === state.modalSizeId) : null) || { extra_price: 0, label: "Única", id: "no-size" };
  const { pre, final, disc } = calcFinalPrice(p.base_price || 0, size.extra_price || 0, p.discount_percent || 0);

  $("modalPrice").textContent = fmtCOP.format(final);

  if (disc > 0) {
    $("modalOldPrice").classList.remove("hidden");
    $("modalOldPrice").textContent = fmtCOP.format(pre);
    $("modalDiscountHint").classList.remove("hidden");
    $("modalDiscountHint").textContent = `-${disc}%`;
  } else {
    $("modalOldPrice").classList.add("hidden");
    $("modalDiscountHint").classList.add("hidden");
  }

  $("modalFormula").textContent = `(${fmtCOP.format(p.base_price || 0)} + ${fmtCOP.format(size.extra_price || 0)}) → descuento ${disc}%`;
}

/** Cart UI */
let cartLastFocusEl = null;

function openCart() {
  cartLastFocusEl = document.activeElement;
  $("drawerBackdrop").hidden = false;
  $("cartDrawer").hidden = false;

  $("drawerBackdrop").classList.add("open");
  $("cartDrawer").classList.add("open");
  $("cartDrawer").setAttribute("aria-hidden", "false");
  $("drawerBackdrop").setAttribute("aria-hidden", "false");

  setTimeout(() => $("cartCloseBtn")?.focus(), 0);
}
function closeCart() {
  $("drawerBackdrop").classList.remove("open");
  $("cartDrawer").classList.remove("open");
  $("cartDrawer").setAttribute("aria-hidden", "true");
  $("drawerBackdrop").setAttribute("aria-hidden", "true");

  setTimeout(() => {
    if ($("drawerBackdrop")) $("drawerBackdrop").hidden = true;
    if ($("cartDrawer")) $("cartDrawer").hidden = true;
  }, 0);

  if (cartLastFocusEl && typeof cartLastFocusEl.focus === "function") {
    setTimeout(() => cartLastFocusEl.focus(), 0);
  }
}

function renderCart() {
  const cart = loadCart();
  $("cartCount").textContent = String(cartCount(cart));

  const host = $("cartItems");
  host.innerHTML = "";

  if (!cart.length) {
    const empty = document.createElement("div");
    empty.className = "panel";
    empty.innerHTML = `
      <h2 style="margin:0 0 6px;">Carrito vacío</h2>
      <p class="muted" style="margin:0;">Agrega un producto para empezar.</p>
    `;
    host.appendChild(empty);

    $("cartSubtotal").textContent = fmtCOP.format(0);
    $("cartShipping").textContent = fmtCOP.format(0);
    $("cartTotal").textContent = fmtCOP.format(0);
    return;
  }

  let subtotal = 0;

  for (const it of cart) {
    const p = allProducts.find(x => x.id === it.product_id);
    const size = p?.sizes?.find(s => s.id === it.size_id) || { extra_price: 0, label: "Única" };

    const { final } = calcFinalPrice(p?.base_price || 0, size.extra_price || 0, p?.discount_percent || 0);
    const line = final * it.qty;
    subtotal += line;

    const el = document.createElement("div");
    el.className = "cartItem";
    el.innerHTML = `
      <div class="cartItemTop">
        <div class="cartThumb">
          <img src="${escapeHtml(p?.image_url || fallbackImg())}" alt="${escapeHtml(p?.name || "Producto")}" loading="lazy" decoding="async" />
        </div>
        <div class="cartMeta">
          <p class="name">${escapeHtml(p?.name || "Producto")}</p>
          <p class="variant">Talla: ${escapeHtml(size.label)} · Color: ${escapeHtml(it.color)}</p>
          <p class="muted tiny" style="margin:6px 0 0;">
            ${fmtCOP.format(final)} c/u
          </p>
        </div>
      </div>

      <div class="qtyRow">
        <div class="qtyControls" aria-label="Cantidad">
          <button class="btn" type="button" aria-label="Disminuir">-</button>
          <div class="qty" aria-label="Cantidad actual">${it.qty}</div>
          <button class="btn" type="button" aria-label="Aumentar">+</button>
        </div>
        <div class="linePrice">
          <strong>${fmtCOP.format(line)}</strong>
          <button class="btn danger" type="button" aria-label="Eliminar">Eliminar</button>
        </div>
      </div>
    `;

    const [minusBtn, plusBtn] = el.querySelectorAll(".qtyControls .btn");
    const delBtn = el.querySelector(".btn.danger");

    minusBtn.addEventListener("click", () => updateCartQty(it, -1));
    plusBtn.addEventListener("click", () => updateCartQty(it, +1));
    delBtn.addEventListener("click", () => removeFromCart(it));

    host.appendChild(el);
  }

  const shipping = calcShipping(subtotal);
  const total = subtotal + shipping;

  $("cartSubtotal").textContent = fmtCOP.format(subtotal);
  $("cartShipping").textContent = fmtCOP.format(shipping);
  $("cartTotal").textContent = fmtCOP.format(total);
}

function addToCart(product, sizeId, color) {
  const cart = loadCart();
  const item = {
    product_id: product.id,
    size_id: sizeId || "no-size",
    color: color || "Negro",
    qty: 1,
  };

  const k = cartKey(item);
  const found = cart.find(x => cartKey(x) === k);
  if (found) {
    found.qty = Math.min(99, (found.qty || 1) + 1);
  } else {
    cart.push(item);
  }

  saveCart(cart);
  renderCart();
  toast("Agregado al carrito", "success");
}

function updateCartQty(item, delta) {
  const cart = loadCart();
  const k = cartKey(item);
  const found = cart.find(x => cartKey(x) === k);
  if (!found) return;

  found.qty = Math.max(1, (found.qty || 1) + delta);
  saveCart(cart);
  renderCart();
}

function removeFromCart(item) {
  let cart = loadCart();
  const k = cartKey(item);
  cart = cart.filter(x => cartKey(x) !== k);
  saveCart(cart);
  renderCart();
  toast("Item eliminado", "warn");
}

/** Focus trap (simple) */
function trapFocusIfOpen(e) {
  // Modal
  const modal = $("productModal");
  if (modal && !modal.hidden && modal.classList.contains("open")) {
    if (e.key === "Tab") return trapTab(e, modal);
  }
  // Drawer
  const drawer = $("cartDrawer");
  if (drawer && !drawer.hidden && drawer.classList.contains("open")) {
    if (e.key === "Tab") return trapTab(e, drawer);
  }
}

function trapTab(e, root) {
  const focusable = root.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
  const list = Array.from(focusable).filter(el => !el.hasAttribute("disabled") && !el.getAttribute("aria-hidden"));
  if (!list.length) return;

  const first = list[0];
  const last = list[list.length - 1];

  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

/** Events */
function wireEvents() {
  // Filters toggle mobile
  const toggleBtn = $("filtersToggleBtn");
  const body = $("filtersBody");
  let open = true;

  function setOpen(v) {
    open = v;
    toggleBtn.setAttribute("aria-expanded", String(open));
    body.classList.toggle("hidden", !open);
  }

  setOpen(window.innerWidth >= 700);
  toggleBtn.addEventListener("click", () => setOpen(!open));

  // Search input (debounced) + Admin shortcut (mobile-safe)
  const searchEl = $("searchInput");
  const searchForm = document.getElementById("searchForm");
  let searchTimer = null;

  const handleSearchValue = () => {
    const val = searchEl?.value || "";
    if (checkAdminShortcutFromInput(val)) return;

    state.q = val;
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => applyFiltersRender(), 120);
  };

  if (searchEl) {
    searchEl.addEventListener("input", handleSearchValue, { passive: true });
    searchEl.addEventListener("change", handleSearchValue);
    searchEl.addEventListener("search", handleSearchValue);
    searchEl.addEventListener("compositionend", handleSearchValue);
    searchEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") handleSearchValue();
    });
  }
  if (searchForm) {
    searchForm.addEventListener("submit", (e) => {
      e.preventDefault();
      handleSearchValue();
    });
  }

  // filters
  $("categorySelect").addEventListener("change", (e) => {
    state.category = (e.target.value || "").toLowerCase();
    applyFiltersRender();
  });

  $("sortSelect").addEventListener("change", (e) => {
    state.sort = e.target.value;
    applyFiltersRender();
  });

  $("featuredOnly").addEventListener("change", (e) => {
    state.featuredOnly = !!e.target.checked;
    applyFiltersRender();
  });

  $("priceCap").addEventListener("input", (e) => {
    const val = clampInt(e.target.value, NaN);
    state.priceCap = Number.isFinite(val) ? val : null;
    applyFiltersRender();
  });

  $("clearFiltersBtn").addEventListener("click", () => {
    state.q = "";
    state.category = "";
    state.sort = "featured";
    state.featuredOnly = false;
    state.priceCap = null;

    $("searchInput").value = "";
    $("categorySelect").value = "";
    $("sortSelect").value = "featured";
    $("featuredOnly").checked = false;
    $("priceCap").value = "";

    applyFiltersRender();
    toast("Filtros limpiados", "success");
  });

  // Cart
  $("cartOpenBtn").addEventListener("click", () => {
    openCart();
    renderCart();
  });
  $("cartCloseBtn").addEventListener("click", closeCart);
  document.getElementById("cartBackBtn")?.addEventListener("click", () => {
  // usa tu función existente para cerrar carrito:
  closeCart();
});
  $("drawerBackdrop").addEventListener("click", closeCart);

  $("clearCartBtn").addEventListener("click", () => {
    saveCart([]);
    renderCart();
    toast("Carrito vacío", "warn");
  });

  $("checkoutBtn").addEventListener("click", () => {
    const cart = loadCart();
    if (!cart.length) return toast("Tu carrito está vacío.", "warn");
    toast("Compra simulada ✅ (aquí iría el pago)", "success", 3200);
  });

  // Modal
  $("modalCloseBtn").addEventListener("click", closeModal);
  $("modalBackdrop").addEventListener("click", closeModal);

  $("addToCartBtn").addEventListener("click", () => {
    const p = state.modalProduct;
    if (!p) return;
    addToCart(p, state.modalSizeId, state.modalColor);
  });

  $("buyNowBtn").addEventListener("click", () => {
    const p = state.modalProduct;
    if (!p) return;
    addToCart(p, state.modalSizeId, state.modalColor);
    closeModal();
    openCart();
    renderCart();
  });

  // ESC + focus trap
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      const modalOpen = $("productModal") && !$("productModal").hidden && $("productModal").classList.contains("open");
      const cartOpen = $("cartDrawer") && !$("cartDrawer").hidden && $("cartDrawer").classList.contains("open");

      if (modalOpen) return closeModal();
      if (cartOpen) return closeCart();
    }
    if (e.key === "Tab") trapFocusIfOpen(e);
  });

  setupLogoLongPress();
}

/** Boot */
document.addEventListener("DOMContentLoaded", () => {
  // Default values
  $("sortSelect").value = "featured";
  $("resultCount").textContent = "";
  $("modalBackdrop").hidden = true;
  $("drawerBackdrop").hidden = true;
  $("productModal").hidden = true;
  $("cartDrawer").hidden = true;

  wireEvents();
  renderCart();
  fetchCatalog();
});
