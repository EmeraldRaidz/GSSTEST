/* Green Mountain Food Services storefront. Runs entirely in the browser and builds every page from orders.vgs. */
const $ = id => document.getElementById(id);
const on = (id, ev, fn) => { const el = $(id); if (el) el.addEventListener(ev, fn); };
const money = n => "$" + Number(n).toFixed(2);
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
};
const PAGE = location.pathname.split("/").pop() || "index.html";
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

let PRODUCTS = [], BUSINESS = {}, SLIDES = [];
let cart = store.get("gmfs_cart2", {});
let me = store.get("gmfs_session", null);
const users = () => store.get("gmfs_users", {});
const user = () => users()[me] || null;
if (me && !user()) me = null;
const num = (k, d) => { const n = parseFloat(BUSINESS[k]); return isNaN(n) ? d : n; };

/* ---------- Reading orders.vgs ---------- */
function parseVGS(text) {
  const out = {business: {}, products: [], slides: [], images: {}}, MULTI = ["spec", "hours"];
  let cur = null;
  text.split(/\r?\n/).forEach(raw => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const sec = line.match(/^\[(\w+)\]$/);
    if (sec) {
      if (sec[1] === "product") { cur = {}; out.products.push(cur); }
      else if (sec[1] === "slide") { cur = {}; out.slides.push(cur); }
      else if (sec[1] === "business") cur = out.business;
      else if (sec[1] === "images") cur = out.images;
      else cur = null;
      return;
    }
    const c = line.indexOf(":");
    if (!cur || c < 1) return;
    const k = line.slice(0, c).trim().toLowerCase(), v = line.slice(c + 1).trim();
    if (MULTI.includes(k)) (cur[k] = cur[k] || []).push(v.split("|").map(x => x.trim()));
    else cur[k] = v;
  });
  // "image:" can be a name from [images] (e.g. truckPic) or a direct path/link. Bare file names go in image_folder.
  const folder = out.images.image_folder || "";
  const img = v => {
    if (!v) return "";
    const f = out.images[v.toLowerCase()];
    const p = f === undefined ? v : f;
    return !p || /^(https?:|data:|\/)/i.test(p) || p.includes("/") ? p : folder + p;
  };
  out.slides.forEach(s => { s.image = img(s.image); });
  out.products = out.products.filter(p => p.name).map(p => ({
    id: Number(p.id), code: p.code || "", cat: p.category || "Other", name: p.name, size: p.size || "",
    each: parseFloat(p.each) || 0, caseQty: parseInt(p.case_qty, 10) || 1, casePrice: parseFloat(p.case_price) || 0,
    emoji: p.emoji || "📦", bg: p.color || "#e8edf0", image: img(p.image), tag: p.tag || "",
    desc: p.description || "", spec: p.spec || []
  }));
  return out;
}
// Looks for orders.vgs next to this script. The file is a text file wrapped so the browser can open it
// from a double-clicked folder and from a web host; a plain fetch is the backup.
const VGS_URL = new URL("orders.vgs", document.currentScript ? document.currentScript.src : location.href).href;
function loadVGS() {
  return new Promise((resolve, reject) => {
    const viaFetch = () => fetch(VGS_URL).then(r => r.ok ? r.text() : Promise.reject(new Error("HTTP " + r.status))).then(resolve, reject);
    const s = document.createElement("script");
    s.charset = "utf-8"; s.src = VGS_URL;
    s.onload = () => typeof window.VGS === "string" ? resolve(window.VGS) : viaFetch();
    s.onerror = viaFetch;
    document.head.appendChild(s);
  });
}

/* ---------- Store hours (in the store's own time zone) ---------- */
function bizNow() {
  try { return new Date(new Date().toLocaleString("en-US", {timeZone: BUSINESS.timezone || "America/New_York"})); }
  catch (e) { return new Date(); }
}
const ymd = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const fmtTime = t => { let [h, m] = t.split(":").map(Number); const ap = h >= 12 ? "PM" : "AM"; h = h % 12 || 12; return h + ":" + String(m).padStart(2, "0") + " " + ap; };
const fmtDate = s => new Date(s + "T12:00:00").toLocaleDateString(undefined, {weekday: "long", month: "long", day: "numeric"});
const mins = t => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const hoursFor = dateStr => (BUSINESS.hours || []).find(h => h[0] === DAYS[new Date(dateStr + "T12:00:00").getDay()]);
const isOpenDay = dateStr => { const r = hoursFor(dateStr); return !!r && r[1].toLowerCase() !== "closed"; };
function openStatus() {
  const now = bizNow(), row = (BUSINESS.hours || []).find(h => h[0] === DAYS[now.getDay()]);
  if (!row || row[1].toLowerCase() === "closed") return {open: false, text: "Closed today"};
  const cur = now.getHours() * 60 + now.getMinutes();
  if (cur >= mins(row[1]) && cur < mins(row[2])) return {open: true, text: "Open now, until " + fmtTime(row[2])};
  return {open: false, text: "Closed now (open " + fmtTime(row[1]) + " to " + fmtTime(row[2]) + " today)"};
}

/* ---------- Cart ---------- */
const lines = () => Object.keys(cart).map(k => {
  const [id, t] = k.split(":"), p = PRODUCTS.find(x => x.id == id);
  return p && {k, p, t, q: cart[k], unit: t === "c" ? p.casePrice : p.each, label: t === "c" ? "Case of " + p.caseQty : "Each"};
}).filter(Boolean);
const subtotal = () => lines().reduce((s, l) => s + l.unit * l.q, 0);
const saveCart = () => store.set("gmfs_cart2", cart);
function setQty(k, q) { if (q <= 0) delete cart[k]; else cart[k] = Math.min(q, 5000); saveCart(); renderCart(); }

const thumbHtml = p => p.image
  ? `<img class="lt" src="${esc(p.image)}" alt="" data-em="${esc(p.emoji)}" onerror="this.replaceWith(this.dataset.em)">`
  : esc(p.emoji);
function lineHtml(l) {
  return `<div class="line">
    <div class="em">${thumbHtml(l.p)}</div>
    <div><b>${esc(l.p.name)}</b><span class="size">${esc(l.label)} &middot; ${money(l.unit)}</span>
      <div class="qty">
        <button data-dec="${l.k}" aria-label="Decrease quantity">&minus;</button><span>${l.q}</span>
        <button data-inc="${l.k}" aria-label="Increase quantity">+</button>
        <button class="rm" data-rm="${l.k}">Remove</button>
      </div></div>
    <b>${money(l.unit * l.q)}</b>
  </div>`;
}
function renderCart() {
  const ls = lines();
  $("count").textContent = Object.values(cart).reduce((a, b) => a + b, 0);
  $("subtotal").textContent = money(subtotal());
  $("pinTotal").textContent = money(subtotal());
  $("checkoutBtn").classList.toggle("disabled", !ls.length);
  $("checkoutBtn").setAttribute("aria-disabled", String(!ls.length));
  $("items").innerHTML = ls.length ? ls.map(lineHtml).join("") : `<p class="empty">Your cart is empty. Add a product to get started.</p>`;
  if ($("cartPage")) renderCartPage();
  if ($("sumBox")) renderSummary();
}
function renderCartPage() {
  const ls = lines();
  if (!ls.length) { $("cartPage").innerHTML = `<div class="panel-box"><p>Your cart is empty.</p><a class="btn" href="products.html">Browse products</a></div>`; return; }
  const saved = ls.filter(l => l.t === "c").reduce((s, l) => s + (l.p.each * l.p.caseQty - l.p.casePrice) * l.q, 0);
  $("cartPage").innerHTML = `<div class="cart-layout"><div class="box">${ls.map(lineHtml).join("")}</div>
    <div class="box sumbox">
      ${saved > 0.004 ? `<p class="save">You save ${money(saved)} by buying cases.</p>` : ""}
      <div class="total"><span>Subtotal</span><span>${money(subtotal())}</span></div>
      <a class="btn block" href="checkout.html">Check out</a>
      <p class="size" style="margin:14px 0 0"><a class="link" href="products.html">Continue shopping</a> &nbsp; <button class="link" data-clear>Clear cart</button></p>
    </div></div>`;
}
function cartClicks(e) {
  const d = e.target.dataset;
  if (d.inc) setQty(d.inc, cart[d.inc] + 1);
  if (d.dec) setQty(d.dec, cart[d.dec] - 1);
  if (d.rm) setQty(d.rm, 0);
  if (e.target.closest("[data-clear]")) { cart = {}; saveCart(); renderCart(); }
}
function toast(msg) { const t = $("toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("show"), 1800); }
function drawer(open) { $("drawer").classList.toggle("open", open); $("overlay").classList.toggle("open", open); $("drawer").setAttribute("aria-hidden", String(!open)); }

/* ---------- Accounts (kept in this browser only) ---------- */
const showModal = html => { $("panel").innerHTML = html; $("modal").classList.add("open"); const i = $("panel").querySelector("input"); if (i) i.focus(); };
const closeModal = () => $("modal").classList.remove("open");
async function hash(s) {
  if (window.crypto && crypto.subtle) {
    const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
    return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
  }
  return btoa(unescape(encodeURIComponent(s)));
}
function renderAcct() {
  const u = user();
  $("acctBtn").textContent = u ? "Hi, " + u.name.split(" ")[0] : "Sign in";
  $("ordersLink").hidden = !u;
  if ($("ordersPage")) renderOrdersPage();
}
function authView(mode, err) {
  const up = mode === "up";
  showModal(`<h2 id="mTitle">${up ? "Create account" : "Sign in"}</h2>
    <div class="tabs"><button class="chip" data-auth="in" aria-pressed="${!up}">Sign in</button><button class="chip" data-auth="up" aria-pressed="${up}">Create account</button></div>
    <form id="authForm" data-mode="${mode}">
      ${up ? `<label class="f">Name<input name="name" required autocomplete="name"></label>
        <label class="f">Business name<input name="business" required autocomplete="organization"></label>
        <label class="f">Phone<input name="phone" type="tel" required autocomplete="tel"></label>
        <label class="f">Delivery address<textarea name="address" rows="2" required></textarea></label>` : ""}
      <label class="f">Email<input name="email" type="email" required autocomplete="email"></label>
      <label class="f">Password<input name="password" type="password" required minlength="6" autocomplete="${up ? "new-password" : "current-password"}"></label>
      <p class="err" role="alert">${esc(err || "")}</p>
      <div class="actions"><button type="button" class="btn ghost" data-close>Close</button><button class="btn">${up ? "Create account" : "Sign in"}</button></div>
    </form>`);
}
function accountView() {
  const u = user();
  showModal(`<h2 id="mTitle">Your account</h2>
    <p><b>${esc(u.name)}</b><br>${esc(u.business)}<br>${esc(me)}<br>${esc(u.phone || "")}<br>${esc(u.address)}</p>
    <p><a class="link" href="orders.html">View previous orders</a></p>
    <div class="actions"><button class="btn ghost" data-close>Close</button><button class="btn" data-signout>Sign out</button></div>`);
}
async function handleAuth(f, mode) {
  const em = f.email.trim().toLowerCase(), h = await hash(em + ":" + f.password), u = users();
  if (mode === "up") {
    if (u[em]) return authView("up", "An account with that email already exists. Sign in instead.");
    u[em] = {name: f.name.trim(), business: f.business.trim(), phone: f.phone.trim(), address: f.address.trim(), h, orders: []};
    store.set("gmfs_users", u);
  } else if (!u[em] || u[em].h !== h) {
    return authView("in", "Email or password is incorrect.");
  }
  me = em; store.set("gmfs_session", me);
  renderAcct(); closeModal(); toast("Signed in as " + u[em].name); prefillCheckout();
}

/* ---------- Categories and searching ---------- */
function orderedCats() {
  const present = [...new Set(PRODUCTS.map(p => p.cat))];
  const listed = (BUSINESS.categories || "").split("|").map(x => x.trim()).filter(Boolean);
  return [...listed.filter(c => present.includes(c)), ...present.filter(c => !listed.includes(c))];
}
// Matches name, size, category, tag, description and item code ("GM-1004", "gm1004" and "1004" all work).
function matchesQuery(p, q) {
  q = String(q || "").trim().toLowerCase(); if (!q) return true;
  if ((p.name + " " + p.size + " " + p.cat + " " + p.tag + " " + p.desc + " " + p.code).toLowerCase().includes(q)) return true;
  const c = q.replace(/[^a-z0-9]/g, "");
  return c.length >= 3 && /\d/.test(c) && p.code.toLowerCase().replace(/[^a-z0-9]/g, "").includes(c);
}
function renderCatBar() {
  const el = $("catBar"); if (!el) return;
  const cats = orderedCats(), only = F.cats.size === 1 ? [...F.cats][0] : null;
  el.innerHTML = `<button class="cbtn" data-chip="" aria-pressed="${F.cats.size === 0}">All <span>${PRODUCTS.length}</span></button>`
    + cats.map(c => `<button class="cbtn" data-chip="${esc(c)}" aria-pressed="${only === c}">${esc(c)} <span>${PRODUCTS.filter(p => p.cat === c).length}</span></button>`).join("");
}

/* ---------- Product cards and the Products page ---------- */
const QTY = Array.from({length: 500}, (_, i) => `<option>${i + 1}</option>`).join("");
const qtyChoice = {}, expanded = new Set();
const F = {q: "", cats: new Set(), tags: new Set(), max: Infinity, top: 0, sort: "featured"};

function buyRow(p, t, unit) {
  const k = p.id + ":" + t, v = qtyChoice[k] || 1;
  return `<div class="buyrow${t === "e" ? " alt" : ""}">
    <button data-add="${k}">Add</button>
    <select data-qty="${k}" aria-label="Quantity of ${unit}">${QTY.replace(`<option>${v}</option>`, `<option selected>${v}</option>`)}</select>
    <button data-add="${k}">${unit} to cart</button></div>`;
}
function productCard(p) {
  const open = expanded.has(p.id);
  return `<article class="card">
    <div class="thumb" style="background:${esc(p.bg)}">${esc(p.emoji)}${p.image ? `<img src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy" onerror="this.remove()">` : ""}${p.tag ? `<span class="tag">${esc(p.tag)}</span>` : ""}</div>
    <div class="info">
      <span class="cat">${esc(p.cat)}</span><h3>${esc(p.name)}</h3><div class="size">${esc(p.size)}</div>${p.code ? `<div class="code">Item ${esc(p.code)}</div>` : ""}
      <div class="price">${money(p.casePrice)} <small>per case of ${p.caseQty}</small></div>
      <div class="size">or ${money(p.each)} each</div>
      ${buyRow(p, "c", "case")}${buyRow(p, "e", "each")}
      <button class="more" data-more="${p.id}" aria-expanded="${open}">${open ? "Show less ▴" : "Show more ▾"}</button>
      ${open ? `<div class="detail"><p>${esc(p.desc)}</p><dl>${p.spec.map(s => `<dt>${esc(s[0])}</dt><dd>${esc(s[1] || "")}</dd>`).join("")}
        <dt>Case</dt><dd>${p.caseQty} &times; ${esc(p.size)}, saves ${money(Math.max(0, p.each * p.caseQty - p.casePrice))}</dd></dl></div>` : ""}
    </div></article>`;
}
function initProducts() {
  if (!$("grid")) return;
  const cats = orderedCats(), tags = [...new Set(PRODUCTS.map(p => p.tag).filter(Boolean))];
  F.top = Math.ceil(Math.max(...PRODUCTS.map(p => p.casePrice)) / 10) * 10; F.max = F.top;
  const pre = new URLSearchParams(location.search).get("cat");
  if (pre && cats.includes(pre)) F.cats.add(pre);
  $("catFilters").innerHTML = cats.map(c => `<label class="check"><input type="checkbox" data-cat="${esc(c)}"${F.cats.has(c) ? " checked" : ""}> ${esc(c)} <span class="n">${PRODUCTS.filter(p => p.cat === c).length}</span></label>`).join("");
  $("tagGroup").hidden = !tags.length;
  $("tagFilters").innerHTML = tags.map(t => `<label class="check"><input type="checkbox" data-tag="${esc(t)}"> ${esc(t)}</label>`).join("");
  $("priceMax").max = F.top; $("priceMax").value = F.top; $("priceLabel").textContent = money(F.top);
  if (window.matchMedia("(max-width:820px)").matches) $("filterBox").open = false;
  renderProducts();
}
function renderProducts() {
  const list = PRODUCTS.filter(p => (!F.cats.size || F.cats.has(p.cat)) && (!F.tags.size || F.tags.has(p.tag)) && p.casePrice <= F.max
    && matchesQuery(p, F.q));
  if (F.sort === "low") list.sort((a, b) => a.casePrice - b.casePrice);
  if (F.sort === "high") list.sort((a, b) => b.casePrice - a.casePrice);
  if (F.sort === "name") list.sort((a, b) => a.name.localeCompare(b.name));
  renderCatBar();
  $("resultCount").textContent = list.length + (list.length === 1 ? " product" : " products");
  $("grid").innerHTML = list.length ? list.map(productCard).join("")
    : `<div class="panel-box" style="grid-column:1/-1"><p>No products match your filters.</p><button class="btn sm" data-clearf>Clear filters</button></div>`;
}
function clearFilters() {
  F.q = ""; F.cats.clear(); F.tags.clear(); F.max = F.top; F.sort = "featured";
  $("search").value = ""; $("sort").value = "featured"; $("priceMax").value = F.top; $("priceLabel").textContent = money(F.top);
  document.querySelectorAll("#filters input[type=checkbox]").forEach(c => c.checked = false);
  renderProducts();
}
function wireProducts() {
  on("catBar", "click", e => {
    const b = e.target.closest("[data-chip]"); if (!b) return;
    F.cats.clear(); if (b.dataset.chip) F.cats.add(b.dataset.chip);
    document.querySelectorAll("#catFilters [data-cat]").forEach(c => c.checked = F.cats.has(c.dataset.cat));
    renderProducts();
  });
  on("filters", "change", e => {
    const d = e.target.dataset;
    if (d.cat !== undefined) e.target.checked ? F.cats.add(d.cat) : F.cats.delete(d.cat);
    if (d.tag !== undefined) e.target.checked ? F.tags.add(d.tag) : F.tags.delete(d.tag);
    renderProducts();
  });
  on("filters", "input", e => {
    if (e.target.id === "search") { F.q = e.target.value.trim().toLowerCase(); renderProducts(); }
    if (e.target.id === "priceMax") { F.max = Number(e.target.value); $("priceLabel").textContent = money(F.max); renderProducts(); }
  });
  on("clearFilters", "click", clearFilters);
  on("sort", "change", e => { F.sort = e.target.value; renderProducts(); });
  on("grid", "click", e => {
    const a = e.target.closest("[data-add]"), m = e.target.closest("[data-more]");
    if (e.target.closest("[data-clearf]")) clearFilters();
    if (a) {
      const k = a.dataset.add, sel = a.closest(".buyrow").querySelector("select"), n = Number(sel.value);
      setQty(k, (cart[k] || 0) + n);
      delete qtyChoice[k]; sel.value = 1;
      toast("Added " + n + " " + (k.endsWith("c") ? (n > 1 ? "cases" : "case") : "each") + " to cart");
    }
    if (m) { const id = Number(m.dataset.more); expanded.has(id) ? expanded.delete(id) : expanded.add(id); renderProducts(); }
  });
  on("grid", "change", e => { if (e.target.dataset.qty) qtyChoice[e.target.dataset.qty] = Number(e.target.value); });
}

/* ---------- Home ---------- */
function renderHome() {
  renderMarket(); renderCarousel();
  if ($("infoStrip")) {
    const st = openStatus();
    $("infoStrip").innerHTML = `<span><span class="dot ${st.open ? "open" : ""}"></span>${esc(st.text)}</span><span>Delivers to ${esc(BUSINESS.delivery)}</span><a class="link" href="delivery.html">Delivery and pickup details</a>`;
  }
  if ($("tiles")) {
    const cats = orderedCats();
    $("tiles").innerHTML = cats.map(c => { const ps = PRODUCTS.filter(p => p.cat === c);
      return `<a class="tile" href="products.html?cat=${encodeURIComponent(c)}"><span class="em">${esc(ps[0].emoji)}</span><b>${esc(c)}</b><span>${ps.length} ${ps.length === 1 ? "product" : "products"}</span></a>`; }).join("");
  }
}

function renderMarket() {
  // Banner at the very top of the home page only (index.html has the #marketAd slot)
  const el = $("marketAd"); if (!el) return;
  const b = BUSINESS;
  if ((b.market_show || "yes").toLowerCase() === "no") { el.innerHTML = ""; return; }
  const title = b.market_title || "Whitehall Market";
  const addr = b.market_address || title + ", Whitehall, NY 12887";
  const href = b.market_link || "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(addr);
  el.innerHTML = `<section class="mbanner" aria-label="${esc(title)}"><div class="wrap mbanner-in">
    <span class="mb-ic" aria-hidden="true">🏪</span>
    <div class="mb-tx"><span class="market-new">New</span><h2>${esc(title)}</h2><p>${esc(b.market_text || "")}</p></div>
    <a class="btn ghost sm mb-btn" href="${esc(href)}" target="_blank" rel="noopener">📍 ${esc(b.market_link_text || "Get directions")}</a>
  </div></section>`;
}
function renderCarousel() {
  const el = $("carousel"); if (!el) return;
  const n = SLIDES.length;
  if (!n) { el.hidden = true; return; }
  el.hidden = false;
  let cur = 0, hold = false, paused = window.matchMedia("(prefers-reduced-motion:reduce)").matches;
  el.innerHTML = `<div class="c-view"><div class="c-track">${SLIDES.map((s, i) => `<figure class="c-slide" role="group" aria-roledescription="slide" aria-label="${i + 1} of ${n}">
      <div class="c-ph" style="background:${esc(s.color || "#2b5242")}"><span>${esc(s.emoji || "📷")}</span></div>
      ${s.image ? `<img src="${esc(s.image)}" alt="${esc(s.title || "")}" loading="${i ? "lazy" : "eager"}" onerror="this.remove()">` : ""}
      ${s.title || s.text ? `<figcaption>${s.title ? `<b>${esc(s.title)}</b>` : ""}${s.text ? `<span>${esc(s.text)}</span>` : ""}</figcaption>` : ""}</figure>`).join("")}</div>
    ${n > 1 ? `<button class="c-btn c-prev" type="button" aria-label="Previous picture">&#8249;</button><button class="c-btn c-next" type="button" aria-label="Next picture">&#8250;</button>` : ""}</div>
    ${n > 1 ? `<div class="c-bar"><div class="c-dots">${SLIDES.map((s, i) => `<button class="c-dot" type="button" data-dot="${i}" aria-label="Show picture ${i + 1}"></button>`).join("")}</div><button class="c-pause" type="button">${paused ? "Play" : "Pause"}</button></div>` : ""}`;
  const track = el.querySelector(".c-track"), dots = [...el.querySelectorAll(".c-dot")], slides = [...el.querySelectorAll(".c-slide")];
  const go = i => {
    cur = (i + n) % n; track.style.transform = `translateX(-${cur * 100}%)`;
    dots.forEach((d, k) => d.setAttribute("aria-current", String(k === cur)));
    slides.forEach((s, k) => s.setAttribute("aria-hidden", String(k !== cur)));
  };
  el.addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.classList.contains("c-prev")) go(cur - 1);
    if (b.classList.contains("c-next")) go(cur + 1);
    if (b.dataset.dot !== undefined) go(Number(b.dataset.dot));
    if (b.classList.contains("c-pause")) { paused = !paused; b.textContent = paused ? "Play" : "Pause"; }
  });
  el.addEventListener("mouseenter", () => hold = true); el.addEventListener("mouseleave", () => hold = false);
  el.addEventListener("focusin", () => hold = true); el.addEventListener("focusout", () => hold = false);
  let x0 = null;
  el.addEventListener("touchstart", e => { x0 = e.touches[0].clientX; }, {passive: true});
  el.addEventListener("touchend", e => { if (x0 === null) return; const dx = e.changedTouches[0].clientX - x0; x0 = null; if (Math.abs(dx) > 40) go(cur + (dx < 0 ? 1 : -1)); });
  if (n > 1) setInterval(() => { if (!paused && !hold && !document.hidden) go(cur + 1); }, 5000);
  go(0);
}

/* ---------- Checkout ---------- */
function fees() {
  const form = $("checkoutForm"), f = form ? form.elements.fulfillment.value : "delivery";
  const sub = subtotal(), base = num("delivery_fee", 0), freeOver = num("free_delivery_over", Infinity), minD = num("min_delivery_order", 0);
  const fee = f === "delivery" && base && sub < freeOver ? base : 0;
  return {f, sub, fee, total: sub + fee, minD, freeOver, short: f === "delivery" && minD > 0 && sub < minD};
}
function renderSummary() {
  const box = $("sumBox"); if (!box) return;
  const t = fees(), ls = lines(), card = $("checkoutForm").elements.payment.value === "card";
  box.innerHTML = `<h2>Order summary</h2>
    ${ls.map(l => `<div class="sum-line"><span>${l.q} &times; ${esc(l.p.name)} <span class="size">(${esc(l.label)})</span></span><span>${money(l.unit * l.q)}</span></div>`).join("")}
    <div class="sum-line sum-top"><span>Subtotal</span><span>${money(t.sub)}</span></div>
    <div class="sum-line"><span>${t.f === "delivery" ? "Delivery" : "Pickup"}</span><span>${t.fee ? money(t.fee) : "Free"}</span></div>
    <div class="sum-line sum-total"><span>Total</span><span>${money(t.total)}</span></div>
    ${t.f === "delivery" && t.fee && isFinite(t.freeOver) ? `<p class="size">Free delivery on orders of ${money(t.freeOver)} or more.</p>` : ""}
    ${t.short ? `<div class="note">Delivery orders have a ${money(t.minD)} minimum. Add ${money(t.minD - t.sub)} more, or choose pickup.</div>` : ""}
    <button class="btn block" type="submit" style="margin-top:14px">${card ? "🔒 Continue to secure payment" : "Place order"}</button>
    ${card ? `<p class="size" style="margin:8px 0 0">You will enter your card on Stripe's secure page, then come back here.</p>` : ""}
    <p class="size" style="margin:12px 0 0"><a class="link" href="cart.html">Edit cart</a></p>`;
}
function renderCheckout() {
  const el = $("checkoutPage"); if (!el) return;
  const qs = new URLSearchParams(location.search);
  if (qs.get("paid")) { confirmCardPayment(qs.get("paid")); return; }
  if (!lines().length) { el.innerHTML = `<div class="panel-box"><p>Your cart is empty.</p><a class="btn" href="products.html">Browse products</a></div>`; return; }
  const b = BUSINESS, fee = num("delivery_fee", 0), freeOver = num("free_delivery_over", Infinity);
  const delivSub = fee ? money(fee) + " delivery" + (isFinite(freeOver) ? ", free over " + money(freeOver) : "") : "Delivered to your door";
  el.innerHTML = `<form id="checkoutForm" class="checkout-layout">
    <div>
      <section class="panel-box"><h2>1. Your details</h2>
        <div class="row2"><label class="f">Name<input name="name" required autocomplete="name"></label><label class="f">Business name<input name="business" autocomplete="organization"></label></div>
        <div class="row2"><label class="f">Email<input name="email" type="email" required autocomplete="email"></label><label class="f">Phone<input name="phone" type="tel" required autocomplete="tel"></label></div>
      </section>
      <section class="panel-box"><h2>2. Pickup or delivery</h2>
        <div class="opts">
          <label class="opt"><input type="radio" name="fulfillment" value="delivery" checked><b>Delivery</b><span>${esc(delivSub)}</span></label>
          <label class="opt"><input type="radio" name="fulfillment" value="pickup"><b>Pickup</b><span>Free. Collect at ${esc(b.address)}.</span></label>
        </div>
        <div id="deliveryFields">
          <label class="f">Delivery address<textarea name="address" rows="2" required placeholder="Street, town and ZIP"></textarea></label>
          <div class="row2"><label class="f">Delivery date<input type="date" name="ddate" required></label>
            <label class="f">Time window<select name="dwindow"><option>Morning</option><option>Afternoon</option></select></label></div>
          <p class="size">We deliver to ${esc(b.delivery)}.</p>
        </div>
        <div id="pickupFields" hidden>
          <div class="note" style="margin-top:0">Pick up at <b>${esc(b.address)}, ${esc(b.city)}</b>. ${esc(b.pickup_note || "")}</div>
          <div class="row2"><label class="f">Pickup date<input type="date" name="pdate" required></label>
            <label class="f">Pickup time<select name="ptime" required></select></label></div>
          <p class="err" id="slotMsg"></p>
        </div>
      </section>
      <section class="panel-box"><h2>3. Payment and notes</h2>
        <label class="f">Payment<select name="payment"><option value="card">Pay now by card (secure checkout by Stripe)</option><option>Pay when I receive or pick up my order</option><option>Send me an invoice</option></select></label>
        <p class="size" id="payNote" style="margin:6px 0 0">Visa, Mastercard, American Express and Discover. We never see or store your card number.</p>
        <label class="f">Order notes (optional)<textarea name="notes" rows="2" placeholder="Anything we should know"></textarea></label>
      </section>
      <p class="err" id="checkoutErr" role="alert"></p>
    </div>
    <aside class="panel-box" id="sumBox"></aside>
  </form>`;
  const f = $("checkoutForm"), today = bizNow(), tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  f.elements.pdate.min = ymd(today); f.elements.ddate.min = ymd(tomorrow);
  prefillCheckout(); toggleFulfillment();
  if (qs.get("canceled")) {
    $("checkoutErr").textContent = "Card payment was canceled and you were not charged. You can try again or pick another payment option.";
    history.replaceState(null, "", "checkout.html");
  }
}
function toggleFulfillment() {
  const f = $("checkoutForm"), pick = f.elements.fulfillment.value === "pickup";
  $("deliveryFields").hidden = pick; $("pickupFields").hidden = !pick;
  $("deliveryFields").querySelectorAll("input,select,textarea").forEach(x => x.disabled = pick);
  $("pickupFields").querySelectorAll("input,select,textarea").forEach(x => x.disabled = !pick);
  if (pick) fillSlots();
  renderSummary();
}
function fillSlots() {
  const f = $("checkoutForm"), sel = f.elements.ptime, date = f.elements.pdate.value, msg = $("slotMsg");
  msg.textContent = ""; sel.innerHTML = `<option value="">Choose a date first</option>`;
  if (!date) return;
  if (!isOpenDay(date)) { msg.textContent = "We are closed that day. Please choose another date."; return; }
  const row = hoursFor(date), now = bizNow(), isToday = date === ymd(now), nowM = now.getHours() * 60 + now.getMinutes(), out = [];
  for (let m = mins(row[1]); m + 30 <= mins(row[2]); m += 30) {
    if (isToday && m < nowM + 60) continue;
    out.push(fmtTime(String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0")));
  }
  if (!out.length) { msg.textContent = "No pickup times are left that day. Please choose another date."; return; }
  sel.innerHTML = out.map(o => `<option>${o}</option>`).join("");
}
function prefillCheckout() {
  const u = user(), f = $("checkoutForm"); if (!u || !f) return;
  const set = (n, v) => { if (v && f.elements[n] && !f.elements[n].value) f.elements[n].value = v; };
  set("name", u.name); set("business", u.business); set("email", me); set("phone", u.phone); set("address", u.address);
}
function buildOrder(f, t) {
  const pick = t.f === "pickup";
  return {
    id: "GM-" + Date.now().toString(36).toUpperCase(), account: me,
    customer: {name: f.name, business: f.business, email: f.email, phone: f.phone},
    fulfillment: t.f, address: pick ? BUSINESS.address + ", " + BUSINESS.city : f.address,
    date: pick ? f.pdate : f.ddate, time: pick ? f.ptime : f.dwindow, payment: f.payment, notes: f.notes || "",
    items: lines().map(l => ({k: l.k, id: l.p.id, name: l.p.name, type: l.t === "c" ? "case" : "each", label: l.label, qty: l.q, unit_price: l.unit})),
    subtotal: Number(t.sub.toFixed(2)), delivery_fee: t.fee, total: Number(t.total.toFixed(2)), placed_at: new Date().toISOString()
  };
}
function placeOrder(f, t) {
  const order = buildOrder(f, t);
  // A web host with an order endpoint can receive this; without one the request simply fails quietly.
  if (/^https?:$/.test(location.protocol)) fetch("/order", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(order)}).catch(() => {});
  finishOrder(order);
}
// Card payments: the server prices the cart, Stripe takes the card, then Stripe sends the customer back here.
async function payByCard(f, t) {
  const err = $("checkoutErr"), btn = $("checkoutForm").querySelector("[type=submit]");
  if (!/^https?:$/.test(location.protocol)) { err.textContent = "Card payment only works on the live website, not when the files are opened from your computer."; return; }
  const order = buildOrder(f, t);
  order.payment = "Paid by card";
  btn.disabled = true; btn.textContent = "Opening secure payment...";
  try {
    const r = await fetch("/api/checkout", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({
      orderId: order.id, customer: order.customer, fulfillment: order.fulfillment, address: order.address,
      date: order.date, time: order.time, notes: order.notes, items: order.items.map(i => ({id: i.id, type: i.type, qty: i.qty}))})});
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.url) throw new Error(d.error || "The payment page could not be opened. Please try again.");
    store.set("gmfs_pending", {...order, session: d.id});
    location.href = d.url;
  } catch (e) {
    err.textContent = e.message;
    btn.disabled = false; btn.textContent = "🔒 Continue to secure payment";
  }
}
async function confirmCardPayment(session) {
  const el = $("checkoutPage");
  el.innerHTML = `<div class="panel-box"><p>Checking your payment...</p></div>`;
  let s = {};
  try { const r = await fetch("/api/checkout-status?id=" + encodeURIComponent(session)); s = await r.json(); } catch (e) {}
  history.replaceState(null, "", "checkout.html");
  if (!s.paid) {
    el.innerHTML = `<div class="panel-box"><p>We could not confirm your payment. If you were charged, please call us at ${esc(BUSINESS.phone)} with the time of your order.</p><a class="btn" href="checkout.html">Back to checkout</a></div>`;
    return;
  }
  const order = store.get("gmfs_pending", null);
  store.set("gmfs_pending", null);
  if (order && order.session === session) { order.total = s.total; finishOrder(order); return; }
  cart = {}; saveCart(); renderCart();
  el.innerHTML = `<div class="panel-box done"><div class="em">✅</div><h2>Payment received</h2><p>Thank you. Your order number is <b>${esc(s.orderId || "")}</b>.</p><div class="btns"><a class="btn" href="products.html">Continue shopping</a></div></div>`;
}
function finishOrder(order) {
  const pick = order.fulfillment === "pickup";
  console.log("Order placed:", order);
  if (me && users()[me]) {
    const u = users();
    u[me].orders.push({id: order.id, placed_at: order.placed_at, total: order.total, fulfillment: order.fulfillment, date: order.date, time: order.time,
      items: order.items.map(i => ({k: i.k, name: i.name, label: i.label, qty: i.qty}))});
    store.set("gmfs_users", u);
  }
  const lineList = order.items.map(i => `${i.qty} &times; ${esc(i.name)} (${esc(i.label)})`).join("<br>");
  cart = {}; saveCart(); renderCart();
  $("checkoutPage").innerHTML = `<div class="panel-box done"><div class="em">✅</div><h2>Order received</h2>
    <p>Thank you, ${esc(order.customer.name)}. Your order number is <b>${esc(order.id)}</b>.</p>
    <p>${pick ? "Pickup" : "Delivery"} on <b>${esc(fmtDate(order.date))}</b>, <b>${esc(order.time)}</b><br>${esc(order.address)}</p>
    <p class="size">${lineList}</p>
    <p>Total: <b>${money(order.total)}</b> &middot; ${esc(order.payment)}</p>
    <div class="btns"><a class="btn" href="products.html">Continue shopping</a>${me ? `<a class="btn ghost" href="orders.html">Previous orders</a>` : ""}</div></div>`;
  window.scrollTo(0, 0);
}
function wireCheckout() {
  on("checkoutPage", "change", e => {
    if (e.target.name === "fulfillment") toggleFulfillment();
    if (e.target.name === "pdate") fillSlots();
    if (e.target.name === "payment") { $("payNote").hidden = e.target.value !== "card"; renderSummary(); }
  });
  on("checkoutPage", "submit", e => {
    e.preventDefault();
    if (e.target.id !== "checkoutForm") return;
    const t = fees(), f = Object.fromEntries(new FormData(e.target)), err = $("checkoutErr");
    err.textContent = "";
    const date = t.f === "delivery" ? f.ddate : f.pdate;
    if (!isOpenDay(date)) { err.textContent = t.f === "delivery" ? "We do not deliver on that day. Please choose another date." : "We are closed that day. Please choose another date."; return; }
    if (t.short) { err.textContent = "Delivery orders have a " + money(t.minD) + " minimum. Add more items or choose pickup."; return; }
    if (f.payment === "card") payByCard(f, t); else placeOrder(f, t);
  });
}

/* ---------- Previous orders ---------- */
function renderOrdersPage() {
  const u = user(), el = $("ordersPage");
  if (!u) { el.innerHTML = `<div class="panel-box"><p>Sign in to see your previous orders and reorder in one click.</p><button class="btn sm" data-auth="in">Sign in</button></div>`; return; }
  if (!u.orders.length) { el.innerHTML = `<div class="panel-box"><p>No orders yet. Orders you place while signed in will show up here.</p><a class="btn" href="products.html">Browse products</a></div>`; return; }
  const spent = u.orders.reduce((s, o) => s + o.total, 0), today = ymd(bizNow());
  el.innerHTML = `<div class="stats"><div><b>${u.orders.length}</b><span>orders placed</span></div><div><b>${money(spent)}</b><span>total spent</span></div><div><b>${money(spent / u.orders.length)}</b><span>average order</span></div></div>`
    + u.orders.slice().reverse().map(o => `<div class="order"><b>${esc(o.id)}</b> &middot; placed ${new Date(o.placed_at).toLocaleDateString()} &middot; ${money(o.total)}
      ${o.date ? `<span class="badge">${o.date >= today ? "Scheduled" : "Completed"}</span><br>${o.fulfillment === "pickup" ? "Pickup" : "Delivery"}: ${esc(fmtDate(o.date))}, ${esc(o.time)}` : ""}<br>
      ${o.items.map(i => `${i.qty} &times; ${esc(i.name)} (${esc(i.label)})`).join("<br>")}
      ${o.items.every(i => i.k) ? `<br><button class="btn sm" style="margin-top:10px" data-reorder="${esc(o.id)}">Reorder</button>` : ""}</div>`).join("");
}
function wireOrders() {
  on("ordersPage", "click", e => {
    if (e.target.closest("[data-auth]")) return authView("in");
    const r = e.target.closest("[data-reorder]"); if (!r) return;
    const o = user().orders.find(x => x.id === r.dataset.reorder);
    o.items.forEach(i => setQty(i.k, (cart[i.k] || 0) + i.qty));
    location.href = "cart.html";
  });
}

/* ---------- Quick order ---------- */
const qEl = k => document.querySelector(`[data-q="${k}"]`);
const qv = k => Math.min(500, Math.max(0, Math.floor(Number(qEl(k).value) || 0)));
function quickTotals() {
  let total = 0;
  PRODUCTS.forEach(p => {
    const t = qv(p.id + ":c") * p.casePrice + qv(p.id + ":e") * p.each; total += t;
    document.querySelector(`[data-qt="${p.id}"]`).textContent = money(t);
  });
  $("quickTotal").textContent = money(total); $("quickAdd").disabled = total === 0;
}
function renderQuick() {
  const el = $("quickPage"); if (!el) return;
  el.innerHTML = `<div class="qsearch"><label class="sr" for="quickSearch">Search products</label><input id="quickSearch" type="search" placeholder="Search by name, item code or category" autocomplete="off"></div><p class="empty" id="quickNone" hidden>No products match your search.</p>
    <div class="qrow qhead"><span>Product</span><span>Cases</span><span>Single units</span><span style="text-align:right">Total</span></div>`
    + PRODUCTS.map(p => `<div class="qrow" data-qrow="${p.id}"><div class="qinfo"><div class="qem">${thumbHtml(p)}</div><div><b>${esc(p.name)}</b><br><span class="size">${esc(p.size)}${p.code ? " &middot; " + esc(p.code) : ""}</span></div></div>
      <label class="qf"><span class="qlab">Cases</span><input type="number" min="0" max="500" value="0" inputmode="numeric" data-q="${p.id}:c"><small>${money(p.casePrice)} per case of ${p.caseQty}</small></label>
      <label class="qf"><span class="qlab">Single units</span><input type="number" min="0" max="500" value="0" inputmode="numeric" data-q="${p.id}:e"><small>${money(p.each)} each</small></label>
      <div class="qtot" data-qt="${p.id}">$0.00</div></div>`).join("")
    + `<div class="qfoot"><div><span class="size">Order total</span><br><b style="font-size:1.4rem" id="quickTotal">$0.00</b></div>
      <div><button class="btn ghost" id="quickReset" type="button">Reset</button> <button class="btn" id="quickAdd" type="button" disabled>Add all to cart</button></div></div>`;
  on("quickPage", "input", e => { if (e.target.id !== "quickSearch") quickTotals(); });
  on("quickSearch", "input", e => {
    let shown = 0;
    PRODUCTS.forEach(p => { const row = document.querySelector(`[data-qrow="${p.id}"]`), ok = matchesQuery(p, e.target.value); row.hidden = !ok; if (ok) shown++; });
    $("quickNone").hidden = shown > 0;
  });
  on("quickReset", "click", () => { document.querySelectorAll("[data-q]").forEach(i => i.value = 0); quickTotals(); });
  on("quickAdd", "click", () => {
    PRODUCTS.forEach(p => ["c", "e"].forEach(t => { const k = p.id + ":" + t, n = qv(k); if (n) { cart[k] = Math.min(5000, (cart[k] || 0) + n); } }));
    saveCart(); location.href = "cart.html";
  });
}

/* ---------- Delivery and pickup, Help ---------- */
function hoursTable() {
  const today = DAYS[bizNow().getDay()];
  return `<table class="hours">${(BUSINESS.hours || []).map(h => `<tr class="${h[0] === today ? "today" : ""}"><td>${esc(h[0])}</td><td>${h[1].toLowerCase() === "closed" ? "Closed" : fmtTime(h[1]) + " to " + fmtTime(h[2])}</td></tr>`).join("")}</table>`;
}
const faqHtml = list => list.map(f => `<details class="q"><summary>${esc(f[0])}</summary><p>${esc(f[1])}</p></details>`).join("");
function renderDelivery() {
  const el = $("deliveryPage"); if (!el) return;
  const b = BUSINESS, st = openStatus(), fee = num("delivery_fee", 0), freeOver = num("free_delivery_over", Infinity), minD = num("min_delivery_order", 0);
  const openDays = (b.hours || []).filter(h => h[1].toLowerCase() !== "closed").map(h => h[0]).join(", ");
  el.innerHTML = `<div class="help-grid">
    <div class="hcard"><h3>Delivery</h3>
      <p><b>Where we deliver</b><br>${esc(b.delivery)}</p>
      <p><b>Delivery days</b><br>${esc(openDays)}</p>
      <p><b>Cost</b><br>${fee ? money(fee) + " per delivery" + (isFinite(freeOver) ? ", free on orders of " + money(freeOver) + " or more" : "") : "Free delivery"}</p>
      ${minD ? `<p><b>Minimum order</b><br>${money(minD)} for delivery</p>` : ""}
      <p>Choose a delivery date and a morning or afternoon window at checkout.</p></div>
    <div class="hcard"><h3>Pickup</h3>
      <p><b>Pickup address</b><br>${esc(b.address)}<br>${esc(b.city)}</p>
      <p><b>Cost</b><br>Free, with no minimum order</p>
      <p>${esc(b.pickup_note || "")}</p>
      <p><span class="dot ${st.open ? "open" : ""}"></span>${esc(st.text)}</p>${hoursTable()}</div>
  </div>
  <div class="steps" style="margin-top:20px">
    <div class="step"><b>1</b><h3>Place your order</h3><p>Fill your cart and choose pickup or delivery at checkout.</p></div>
    <div class="step"><b>2</b><h3>We pack it</h3><p>Your order is picked and packed at our warehouse in ${esc(b.city)}.</p></div>
    <div class="step"><b>3</b><h3>You receive it</h3><p>We deliver on your chosen day, or you collect it at the time you picked.</p></div>
  </div>
  <div class="hcard" style="margin-top:20px"><h3>Common questions</h3>${faqHtml([
    ["How do I know if you deliver to me?", "We deliver to " + b.delivery + ". If you are near the edge of that area, call " + b.phone + " and we will confirm."],
    ["Can I order for both delivery and pickup?", "Yes. Place two separate orders, choosing delivery for one and pickup for the other."],
    ["Can I change my delivery date or time?", "Call us as soon as you can with your order number and we will do our best to change it."],
    ["What are your delivery days?", "We deliver " + openDays + ". We are closed on the other days."]])}</div>`;
}
function renderHelp() {
  const el = $("helpPage"); if (!el) return;
  const b = BUSINESS, st = openStatus();
  const lat = Number(b.lat), lon = Number(b.lon), d = 0.006, q = encodeURIComponent(b.address + ", " + b.city);
  el.innerHTML = `<div class="help-grid">
    <div class="hcard"><h3>Contact us</h3>
      <p><b>Email</b><br><a class="link" href="mailto:${esc(b.email)}">${esc(b.email)}</a></p>
      <p><b>Phone</b><br><a class="link" href="tel:${esc(b.phone.replace(/[^\d+]/g, ""))}">${esc(b.phone)}</a>${b.tollfree ? "<br>Toll free: " + esc(b.tollfree) : ""}</p>
      <p><b>Address</b><br>${esc(b.address)}<br>${esc(b.city)}</p></div>
    <div class="hcard"><h3>Opening hours</h3><p><span class="dot ${st.open ? "open" : ""}"></span>${esc(st.text)}</p>${hoursTable()}</div>
    <div class="hcard"><h3>Find us</h3>
      <iframe class="map" title="Map of ${esc(b.name)}" loading="lazy" src="https://www.openstreetmap.org/export/embed.html?bbox=${lon - d}%2C${lat - d / 2}%2C${lon + d}%2C${lat + d / 2}&amp;layer=mapnik&amp;marker=${lat}%2C${lon}"></iframe>
      <p><a class="link" href="https://www.google.com/maps/search/?api=1&query=${q}" target="_blank" rel="noopener">Get directions</a></p></div>
  </div>
  <div class="hcard" style="margin-top:20px"><h3>Common questions</h3>${faqHtml([
    ["Do you deliver?", "Yes, to " + b.delivery + ". See the Delivery and pickup page for fees and days."],
    ["Can I pick up my order?", "Yes. Choose Pickup at checkout and collect it at " + b.address + " during opening hours."],
    ["How do cases work?", "Every product can be bought by the single unit or by the case. A case costs less per unit."],
    ["I need to change an order.", "Call us as soon as you can with your order number."],
    ["How do I reorder?", "Sign in, open Previous orders and press Reorder to fill your cart with the same items."]])}</div>`;
}
function renderFooter() {
  const f = $("footInfo"); if (!f) return;
  f.innerHTML = esc(BUSINESS.address) + ", " + esc(BUSINESS.city) + "<br>" + esc(BUSINESS.phone) + "<br>" + esc(BUSINESS.email);
}

/* ---------- Wiring and start up ---------- */
on("items", "click", cartClicks);
on("cartPage", "click", cartClicks);
on("panel", "click", e => {
  const a = e.target.closest("[data-auth]");
  if (a) authView(a.dataset.auth);
  if (e.target.closest("[data-close]")) closeModal();
  if (e.target.closest("[data-signout]")) { me = null; store.set("gmfs_session", null); renderAcct(); closeModal(); toast("Signed out"); }
});
on("panel", "submit", e => {
  e.preventDefault();
  if (e.target.id === "authForm") handleAuth(Object.fromEntries(new FormData(e.target)), e.target.dataset.mode);
});
on("modal", "click", e => { if (e.target === $("modal")) closeModal(); });
on("acctBtn", "click", () => user() ? accountView() : authView("in"));
on("openCart", "click", () => drawer(true));
on("totalPin", "click", () => drawer(true));
on("closeCart", "click", () => drawer(false));
on("overlay", "click", () => drawer(false));
on("fullCart", "click", () => drawer(false));
on("checkoutBtn", "click", e => { if (!lines().length) { e.preventDefault(); toast("Your cart is empty"); } });
document.addEventListener("keydown", e => { if (e.key === "Escape") { drawer(false); closeModal(); } });
wireProducts(); wireCheckout(); wireOrders();

document.querySelectorAll(".menu a").forEach(a => { if (a.getAttribute("href") === PAGE) a.setAttribute("aria-current", "page"); });
$("yr").textContent = new Date().getFullYear();
$("count").textContent = Object.values(cart).reduce((a, b) => a + b, 0);
renderAcct();

loadVGS().then(text => {
  const d = parseVGS(text);
  if (!d.products.length) throw new Error("orders.vgs has no products");
  PRODUCTS = d.products; BUSINESS = d.business; SLIDES = d.slides;
  renderCart(); renderFooter(); renderHome(); initProducts(); renderCheckout(); renderQuick(); renderDelivery(); renderHelp();
}).catch(err => {
  console.error("Could not load orders.vgs:", err);
  const m = document.querySelector("main");
  if (m) m.insertAdjacentHTML("afterbegin", `<div class="wrap page"><div class="note">We could not load our product list right now. Please refresh the page, or call us if this keeps happening.</div></div>`);
});
