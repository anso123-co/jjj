import { supabase } from "./supabaseClient.js";

const fmtCOP = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
const $ = (id) => document.getElementById(id);

// Mantener la opción, pero por regla del proyecto NO usamos fondo con fotos.
const USE_PHOTO_BG = false;
if (USE_PHOTO_BG) initPhotoBackgroundSlideshow(PHOTO_BG_URLS, 9000);

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (m) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[m]));
}

function toast(message, type = "success", ms = 2800) {
  const host = $("toasts");
  if (!host) return;

  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.innerHTML = `
    <p class="msg">${escapeHtml(message)}</p>
    <button class="btn icon" aria-label="Cerrar notificación">✕</button>
  `;
  el.querySelector("button").addEventListener("click", () => el.remove());
  host.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

function clampInt(v, def = 0) {
  const n = parseInt(String(v).replace(/[^\d-]/g, ""), 10);
  return Number.isFinite(n) ? n : def;
}
function slugifyCategory(input) {
  return String(input || "")
    .trim()
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")   // quita acentos
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function titleCase(s) {
  const t = String(s || "").trim().replace(/\s+/g, " ");
  if (!t) return "";
  return t.split(" ").map(w => w ? (w[0].toUpperCase() + w.slice(1).toLowerCase()) : "").join(" ");
}

async function getIsAdmin(userId) {
  const { data, error } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) return { isAdmin: false, error };
  return { isAdmin: !!data?.is_admin, error: null };
}

/** Editor state */
let sessionUser = null;
let isAdmin = false;

let editingProductId = null;
let currentImageFile = null; // file listo para subir
let currentImageUrl = null;
let currentImagePath = null;

let colors = [];
let sizes = []; // [{label, extra_price, id?}]

function resetEditor() {
  editingProductId = null;

  $("editorTitle").textContent = "Crear producto";

  $("nameInput").value = "";
  $("categoryInput").value = "manillas";
  $("descInput").value = "";
  $("basePriceInput").value = "";
  $("discountInput").value = "0";
  $("featuredInput").checked = false;

  colors = [];
  sizes = [];

  currentImageFile = null;
  currentImageUrl = null;
  currentImagePath = null;

  $("imageInput").value = "";
  setPreview(null);

  renderPills();
  $("savingHint").textContent = "";
}

function setPreview(urlOrNull) {
  const img = $("imagePreview");
  if (!img) return;

  if (urlOrNull) {
    img.src = urlOrNull;
    img.style.opacity = "1";
  } else {
    // placeholder liviano (sin dark)
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="675">
        <rect width="100%" height="100%" fill="#f8fafc"/>
        <rect x="40" y="40" width="820" height="595" rx="36" fill="rgba(124,58,237,.10)" stroke="rgba(15,23,42,.12)"/>
        <text x="50%" y="52%" dominant-baseline="middle" text-anchor="middle"
          fill="rgba(11,18,32,.70)" font-family="system-ui,Segoe UI,Roboto" font-size="26" font-weight="800">SIN IMAGEN</text>
      </svg>`
    );
    img.style.opacity = "0.9";
  }
}

function renderPills() {
  const cHost = $("colorsPills");
  const sHost = $("sizesPills");
  cHost.innerHTML = "";
  sHost.innerHTML = "";

  for (const c of colors) {
    const pill = document.createElement("span");
    pill.className = "pillTag";
    pill.innerHTML = `${escapeHtml(c)} <button type="button" aria-label="Quitar color">✕</button>`;
    pill.querySelector("button").addEventListener("click", () => {
      colors = colors.filter(x => x !== c);
      renderPills();
    });
    cHost.appendChild(pill);
  }

  for (const s of sizes) {
    const pill = document.createElement("span");
    pill.className = "pillTag";
    pill.innerHTML = `${escapeHtml(s.label)} (${fmtCOP.format(s.extra_price || 0)}) <button type="button" aria-label="Quitar talla">✕</button>`;
    pill.querySelector("button").addEventListener("click", () => {
      sizes = sizes.filter(x => x !== s);
      renderPills();
    });
    sHost.appendChild(pill);
  }
}

function makeImagePath(productId, file) {
  const ext = (file?.name || "image.webp").split(".").pop()?.toLowerCase() || "webp";
  const safeExt = ["webp","jpg","jpeg","png"].includes(ext) ? ext : "webp";
  const ts = Date.now();
  return `${productId}/${ts}.${safeExt}`;
}

/**
 * Compresión en navegador:
 * - convierte a WebP (q≈0.75)
 * - max ancho 1200px
 * - intenta < 300KB bajando calidad si es necesario
 * Si falla, devuelve el archivo original y un warning.
 */
async function compressToWebPIfPossible(file) {
  const MAX_W = 1200;
  const TARGET = 300 * 1024;
  const START_Q = 0.75;
  const MIN_Q = 0.55;

  // Tipos permitidos
  const okType = ["image/jpeg","image/png","image/webp"].includes(file.type);
  if (!okType) return { file, warning: "Formato no permitido." };

  // Si ya es webp y es pequeño, lo dejamos
  if (file.type === "image/webp" && file.size <= TARGET) return { file, warning: null };

  try {
    const bitmap = await (window.createImageBitmap ? createImageBitmap(file) : loadImageBitmapFallback(file));

    const scale = Math.min(1, MAX_W / bitmap.width);
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;

    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("Canvas no soportado.");

    ctx.drawImage(bitmap, 0, 0, w, h);

    let q = START_Q;
    let blob = await canvasToBlob(canvas, "image/webp", q);
    if (!blob) throw new Error("No se pudo generar WebP.");

    while (blob.size > TARGET && q > MIN_Q) {
      q = Math.max(MIN_Q, q - 0.07);
      blob = await canvasToBlob(canvas, "image/webp", q);
      if (!blob) break;
    }

    if (!blob) throw new Error("No se pudo generar WebP.");

    const out = new File([blob], (file.name || "image").replace(/\.[^/.]+$/, "") + ".webp", { type: "image/webp" });

    const warning = out.size > TARGET
      ? `No se logró <300KB (quedó ${Math.round(out.size/1024)}KB). Se subirá igual en WebP.`
      : null;

    return { file: out, warning };
  } catch (e) {
    return { file, warning: `No se pudo comprimir/convertir (se usará original): ${e?.message || e}` };
  }
}

function loadImageBitmapFallback(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => {
    if (!canvas.toBlob) return resolve(null);
    canvas.toBlob((blob) => resolve(blob), type, quality);
  });
}

async function uploadImageIfNeeded(productId) {
  if (!currentImageFile) {
    return { image_url: currentImageUrl, image_path: currentImagePath };
  }

  // optionally delete previous image when replacing (best-effort)
  if (currentImagePath) {
    await deleteImageIfExists(currentImagePath);
  }

  const path = makeImagePath(productId, currentImageFile);

  const { error: upErr } = await supabase.storage
    .from("product-images")
    .upload(path, currentImageFile, {
      cacheControl: "31536000",
      upsert: true,
      contentType: currentImageFile.type || "image/webp",
    });

  if (upErr) throw upErr;

  const { data: pub } = supabase.storage.from("product-images").getPublicUrl(path);
  return { image_url: pub?.publicUrl || null, image_path: path };
}

async function deleteImageIfExists(path) {
  try {
    const { error } = await supabase.storage.from("product-images").remove([path]);
    // ignorar si falla
    if (error) console.warn("deleteImage error:", error);
  } catch (e) {
    console.warn("deleteImage exception:", e);
  }
}

async function fetchAllProducts() {
  const { data: products, error: pErr } = await supabase
    .from("products")
    .select("id,name,category,desc,base_price,discount_percent,featured,colors,image_url,image_path,created_at")
    .order("created_at", { ascending: false });

  if (pErr) throw pErr;

  const { data: sizesRows, error: sErr } = await supabase
    .from("product_sizes")
    .select("id,product_id,label,extra_price,created_at")
    .order("created_at", { ascending: true });

  if (sErr) throw sErr;

  const byProd = new Map();
  for (const s of (sizesRows || [])) {
    if (!byProd.has(s.product_id)) byProd.set(s.product_id, []);
    byProd.get(s.product_id).push(s);
  }

  return (products || []).map(p => ({ ...p, sizes: byProd.get(p.id) || [] }));
}

function renderProductList(rows) {
  const host = $("productsList");
  host.innerHTML = "";

  if (!rows.length) {
    host.innerHTML = `<div class="panel"><h3 style="margin:0 0 6px;">Sin productos</h3><p class="muted" style="margin:0;">Crea el primero arriba.</p></div>`;
    return;
  }

  for (const p of rows) {
    const minExtra = (p.sizes?.length ? Math.min(...p.sizes.map(s => s.extra_price || 0)) : 0);
    const pre = (p.base_price || 0) + minExtra;
    const disc = Math.max(0, Math.min(100, p.discount_percent || 0));
    const final = Math.round(pre * (1 - disc / 100));

    const el = document.createElement("div");
    el.className = "adminItem";
    el.innerHTML = `
      <div class="adminThumb">
        <img src="${escapeHtml(p.image_url || "")}" alt="${escapeHtml(p.name || "Producto")}" loading="lazy" decoding="async"
          onerror="this.src='data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg xmlns=&quot;http://www.w3.org/2000/svg&quot; width=&quot;64&quot; height=&quot;64&quot;><rect width=&quot;100%&quot; height=&quot;100%&quot; fill=&quot;#f8fafc&quot;/><rect x=&quot;6&quot; y=&quot;6&quot; width=&quot;52&quot; height=&quot;52&quot; rx=&quot;12&quot; fill=&quot;rgba(124,58,237,.10)&quot; stroke=&quot;rgba(15,23,42,.12)&quot;/></svg>')}';" />
      </div>
      <div class="adminMeta">
        <p class="title">${escapeHtml(p.name || "Producto")}</p>
        <p class="sub">
          <span class="badge category">${escapeHtml((p.category || "accesorios").toLowerCase())}</span>
          ${p.featured ? `<span class="badge featured">Destacado</span>` : ""}
          ${disc > 0 ? `<span class="badge discount">-${disc}%</span>` : ""}
          <span class="badge">Desde ${fmtCOP.format(final)}</span>
        </p>
      </div>
      <div class="adminActions">
        <button class="btn primary" type="button" aria-label="Editar">Editar</button>
        <button class="btn danger" type="button" aria-label="Eliminar">Eliminar</button>
      </div>
    `;

    const [editBtn, delBtn] = el.querySelectorAll("button");

    editBtn.addEventListener("click", () => loadIntoEditor(p));
    delBtn.addEventListener("click", () => deleteProductFlow(p));

    host.appendChild(el);
  }
}

function loadIntoEditor(p) {
  editingProductId = p.id;
  $("editorTitle").textContent = "Editar producto";

  $("nameInput").value = p.name || "";
  $("categoryInput").value = (p.category || "manillas").toLowerCase();
  $("descInput").value = p.desc || "";
  $("basePriceInput").value = String(p.base_price || 0);
  $("discountInput").value = String(p.discount_percent || 0);
  $("featuredInput").checked = !!p.featured;

  colors = Array.isArray(p.colors) ? [...p.colors] : [];
  sizes = (p.sizes || []).map(s => ({ id: s.id, label: s.label, extra_price: s.extra_price || 0 }));

  currentImageFile = null;
  currentImageUrl = p.image_url || null;
  currentImagePath = p.image_path || null;

  $("imageInput").value = "";
  setPreview(currentImageUrl);

  renderPills();
  $("savingHint").textContent = "";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function saveProduct() {
  if (!sessionUser) return toast("No hay sesión.", "error");
  if (!isAdmin) return toast("No eres admin (is_admin=false).", "error", 4000);

  const name = $("nameInput").value.trim();
  const category = $("categoryInput").value.trim().toLowerCase();
  const desc = $("descInput").value.trim();
  const base_price = clampInt($("basePriceInput").value, NaN);
  const discount_percent = clampInt($("discountInput").value, 0);
  const featured = $("featuredInput").checked;

  if (!name) return toast("Nombre requerido.", "warn");
  if (!category) return toast("Categoría requerida.", "warn");
  if (!Number.isFinite(base_price) || base_price < 0) return toast("Precio base inválido.", "warn");

  if (!sizes.length) sizes = [{ label: "Única", extra_price: 0 }];

  $("saveBtn").disabled = true;
  $("savingHint").textContent = "Guardando…";

  try {
    // 1) upsert product (sin imagen aún)
    let productId = editingProductId;

    if (!productId) {
      const { data, error } = await supabase
        .from("products")
        .insert([{
          name,
          category,
          desc,
          base_price,
          discount_percent: Math.max(0, Math.min(100, discount_percent)),
          featured,
          colors
        }])
        .select("id,image_url,image_path")
        .single();

      if (error) throw error;
      productId = data.id;
      editingProductId = productId;
      currentImageUrl = data.image_url || null;
      currentImagePath = data.image_path || null;
    } else {
      const { error } = await supabase
        .from("products")
        .update({
          name,
          category,
          desc,
          base_price,
          discount_percent: Math.max(0, Math.min(100, discount_percent)),
          featured,
          colors
        })
        .eq("id", productId);

      if (error) throw error;
    }

    // 2) upload image if needed, then update product with image_url/path
    const img = await uploadImageIfNeeded(productId);

    if (img?.image_url !== currentImageUrl || img?.image_path !== currentImagePath) {
      const { error } = await supabase
        .from("products")
        .update({ image_url: img.image_url, image_path: img.image_path })
        .eq("id", productId);

      if (error) throw error;

      currentImageUrl = img.image_url;
      currentImagePath = img.image_path;
    }

    // 3) sizes: delete old then insert new
    const { error: delErr } = await supabase
      .from("product_sizes")
      .delete()
      .eq("product_id", productId);

    if (delErr) throw delErr;

    const rows = sizes.map(s => ({
      product_id: productId,
      label: s.label,
      extra_price: clampInt(s.extra_price, 0),
    }));

    const { error: insErr } = await supabase.from("product_sizes").insert(rows);
    if (insErr) throw insErr;

    toast("Guardado ✅", "success");
    $("savingHint").textContent = "Listo.";

    await refreshListAndResetIfCreate(false);
  } catch (e) {
    console.error(e);
    toast(`Error guardando: ${e?.message || e}`, "error", 5000);
    $("savingHint").textContent = `Error: ${e?.message || e}`;
  } finally {
    $("saveBtn").disabled = false;
  }
}

async function refreshListAndResetIfCreate(resetAfter) {
  const rows = await fetchAllProducts();
  renderProductList(rows);

  if (resetAfter) resetEditor();
}

async function deleteProductFlow(p) {
  if (!confirm(`¿Eliminar "${p.name}"? Esto borrará tallas e imagen.`)) return;

  try {
    // delete image first (best effort)
    if (p.image_path) await deleteImageIfExists(p.image_path);

    const { error } = await supabase.from("products").delete().eq("id", p.id);
    if (error) throw error;

    toast("Producto eliminado", "warn");
    await refreshListAndResetIfCreate(true);
  } catch (e) {
    toast(`Error eliminando: ${e?.message || e}`, "error", 4500);
  }
}

function showLoggedIn(email) {
  $("loginPanel").classList.add("hidden");
  $("editorPanel").classList.remove("hidden");
  $("listPanel").classList.remove("hidden");
  $("logoutBtn").hidden = false;
  $("adminEmail").textContent = email || "";
}

function showLoggedOut() {
  $("loginPanel").classList.remove("hidden");
  $("editorPanel").classList.add("hidden");
  $("listPanel").classList.add("hidden");
  $("logoutBtn").hidden = true;
  $("adminEmail").textContent = "";
  resetEditor();
}

async function ensureAdminOrBlock(user) {
  const { isAdmin: ok, error } = await getIsAdmin(user.id);
  if (error) toast(`Error validando admin: ${error.message}`, "error", 4500);

  if (!ok) {
    toast("Acceso denegado: is_admin=false", "error", 4500);
    await supabase.auth.signOut();
    return false;
  }
  return true;
}

function wireEvents() {
  $("loginBtn").addEventListener("click", async () => {
    const email = $("loginEmail").value.trim();
    const password = $("loginPass").value;

    if (!email || !password) return toast("Email y contraseña requeridos.", "warn");

    $("loginBtn").disabled = true;
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;

      sessionUser = data.user;
      const ok = await ensureAdminOrBlock(sessionUser);
      if (!ok) return;

      isAdmin = true;
      showLoggedIn(sessionUser.email);
      toast("Sesión iniciada ✅", "success");

      await refreshListAndResetIfCreate(true);
    } catch (e) {
      toast(`Login error: ${e?.message || e}`, "error", 4500);
    } finally {
      $("loginBtn").disabled = false;
    }
  });

  $("logoutBtn").addEventListener("click", async () => {
    await supabase.auth.signOut();
    sessionUser = null;
    isAdmin = false;
    showLoggedOut();
    toast("Sesión cerrada", "warn");
  });

  $("refreshBtn").addEventListener("click", async () => {
    try {
      const rows = await fetchAllProducts();
      renderProductList(rows);
      toast("Actualizado", "success");
    } catch (e) {
      toast(`Error actualizando: ${e?.message || e}`, "error", 4500);
    }
  });

  $("saveBtn").addEventListener("click", saveProduct);

  $("cancelEditBtn").addEventListener("click", () => {
    resetEditor();
    toast("Edición cancelada", "warn");
  });

  // Color add
  $("colorAddInput").addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const val = e.target.value.trim();
    if (!val) return;
    if (colors.includes(val)) return toast("Ese color ya existe.", "warn");
    colors.push(val);
    e.target.value = "";
    renderPills();
  });

  // Size add: "M, 5000"
  $("sizeAddInput").addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const raw = e.target.value.trim();
    if (!raw) return;

    const parts = raw.split(",").map(s => s.trim()).filter(Boolean);
    if (parts.length < 1) return toast("Formato inválido.", "warn");

    const label = parts[0];
    const extra = clampInt(parts[1] ?? "0", 0);

    if (sizes.some(s => (s.label || "").toLowerCase() === label.toLowerCase())) {
      return toast("Esa talla ya existe.", "warn");
    }

    sizes.push({ label, extra_price: extra });
    e.target.value = "";
    renderPills();
  });

  // Image preview + compresión
  $("imageInput").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) {
      currentImageFile = null;
      setPreview(currentImageUrl);
      return;
    }

    // preview inmediato (antes de compresión)
    const tmpUrl = URL.createObjectURL(file);
    setPreview(tmpUrl);

    const { file: out, warning } = await compressToWebPIfPossible(file);
    currentImageFile = out;

    // preview del archivo final (si se comprimió)
    try {
      const finalUrl = URL.createObjectURL(out);
      setPreview(finalUrl);
    } catch {}

    if (warning) toast(warning, "warn", 5200);

    toast(`Imagen lista: ${Math.round(out.size / 1024)}KB (${out.type || "archivo"})`, "success", 2400);
  });
}

async function bootstrap() {
  wireEvents();

  // On load: session?
  const { data } = await supabase.auth.getSession();
  const sess = data?.session;

  if (!sess?.user) {
    showLoggedOut();
    return;
  }

  sessionUser = sess.user;
  const ok = await ensureAdminOrBlock(sessionUser);
  if (!ok) {
    showLoggedOut();
    return;
  }

  isAdmin = true;
  showLoggedIn(sessionUser.email);
  toast("Sesión activa ✅", "success");

  try {
    await refreshListAndResetIfCreate(true);
  } catch (e) {
    toast(`Error cargando lista: ${e?.message || e}`, "error", 4500);
  }
}

/** Fondo con fotos (NO usar en este proyecto; se deja por compatibilidad) */
function initPhotoBackgroundSlideshow(urls, intervalMs = 9000) {
  const a = document.getElementById("bgA");
  const b = document.getElementById("bgB");
  if (!a || !b || !Array.isArray(urls) || urls.length === 0) return;

  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    a.style.backgroundImage = `url("${urls[0]}")`;
    a.style.opacity = "0.22";
    b.style.opacity = "0";
    return;
  }

  let i = 0;
  let showingA = true;

  const set = (el, url) => {
    el.style.backgroundImage = `url("${url}")`;
    el.style.backgroundSize = "cover";
    el.style.backgroundPosition = "center";
    el.style.opacity = "0.22";
  };

  set(a, urls[0]);
  set(b, urls[1 % urls.length]);

  setInterval(() => {
    i = (i + 1) % urls.length;
    const next = urls[i];

    if (showingA) {
      set(b, next);
      b.style.opacity = "0.22";
      a.style.opacity = "0";
    } else {
      set(a, next);
      a.style.opacity = "0.22";
      b.style.opacity = "0";
    }
    showingA = !showingA;
  }, intervalMs);
}

// Placeholder (solo si USE_PHOTO_BG=true)
const PHOTO_BG_URLS = [];

document.addEventListener("DOMContentLoaded", bootstrap);
