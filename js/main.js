/* ==========================================================================
   KANDOTECH — page interactions (v2)
   ========================================================================== */

const state = { cat: "all", query: "", sort: "featured" };

document.addEventListener("DOMContentLoaded", async () => {
  try{
    await loadCatalog();
  }catch(e){
    showBackendError();
    return;
  }

  applyCategoryFromQuery();
  renderAll();
  wireCartDrawer();
  wireNav();
  wireContactForm();
  wireSearchAndSort();
  wireReveal();
  wireCounters();
  updateCartBadge();
  document.addEventListener("cart:change", () => {
    updateCartBadge();
    renderCartDrawer();
  });
  renderCartDrawer();

  connectLiveUpdates(() => {
    renderAll();
    renderCartDrawer(); // prices/stock may have changed
    showToast("Catalog updated live from the admin console");
  });
});

function applyCategoryFromQuery(){
  const params = new URLSearchParams(window.location.search);
  const cat = params.get("cat");
  if(cat && (cat === "all" || CATEGORIES.some(c => c.id === cat))){
    state.cat = cat;
  }
}

function renderAll(){
  const skuEl = document.getElementById("statSkus");
  const catEl = document.getElementById("statCats");
  if(skuEl) skuEl.dataset.count = PRODUCTS.length;
  if(catEl) catEl.dataset.count = CATEGORIES.length;
  if(skuEl && skuEl.dataset.animated) skuEl.textContent = PRODUCTS.length;
  if(catEl && catEl.dataset.animated) catEl.textContent = CATEGORIES.length;

  renderCategoryTiles();
  renderFilterList();
  renderCatalog();
  renderServices();
  renderBusinessInfo();
}

function renderBusinessInfo(){
  const b = BUSINESS || {};
  const set = (id, text) => { const el = document.getElementById(id); if(el && text) el.textContent = text; };

  set("bizAddress", b.address);
  set("bizPhone", b.phone);
  set("bizEmail", b.email);
  set("bizHours", b.hours);

  const footer = document.getElementById("footerBizLine");
  if(footer && b.name && b.address){
    const year = new Date().getFullYear();
    footer.textContent = `© ${year} ${b.name}. ${b.address}.`;
  }
}

function showBackendError(){
  const main = document.querySelector(".hero") || document.body;
  const box = document.createElement("div");
  box.style.cssText = "max-width:640px;margin:80px auto;padding:28px;background:var(--panel);border:1px solid var(--border);border-radius:16px;text-align:center;";
  box.innerHTML = `
    <h2 style="margin-top:0;">Can't reach the backend</h2>
    <p style="color:var(--text-dim);">This site now loads its catalog from the Kandotech server. Make sure the backend is running
    (<code class="mono">cd server/backend && npm start</code>) and that you're viewing this page at its address
    (e.g. <code class="mono">http://localhost:4242</code>), not by opening index.html directly.</p>
  `;
  main.replaceWith(box);
}

/* ---------- category tiles (hero entry points) ---------- */
function renderCategoryTiles(){
  const el = document.getElementById("tileGrid");
  if(!el) return;
  el.innerHTML = CATEGORIES.map(c => {
    const n = PRODUCTS.filter(p => p.cat === c.id).length;
    return `
    <button class="tile" data-cat="${c.id}" data-reveal="scale">
      <span class="pico-wrap">${ICONS[categoryIcon(c.id)] || ICONS.port}</span>
      <h3>${c.label}</h3>
      <span class="count">${n} items</span>
    </button>`;
  }).join("");
  el.addEventListener("click", e => {
    const btn = e.target.closest(".tile");
    if(!btn) return;
    window.location.href = `catalog.html?cat=${encodeURIComponent(btn.dataset.cat)}`;
  });
}

function categoryIcon(id){
  return { adapters:"port", "av-cables":"cable", networking:"lan", power:"power",
    drives:"scanner", accessories:"mouse", computers:"computer" }[id] || "port";
}

/* ---------- sidebar filter dropdown ---------- */
function renderFilterList(){
  const el = document.getElementById("filterList");
  if(!el) return;
  const all = [{ id: "all", label: "All Products" }, ...CATEGORIES.map(c => ({ id: c.id, label: c.label }))];
  el.innerHTML = `<select class="filter-select" id="categoryFilterSelect" aria-label="Filter by category">` +
    all.map(c => {
      const n = c.id === "all" ? PRODUCTS.length : PRODUCTS.filter(p => p.cat === c.id).length;
      return `<option value="${c.id}" ${c.id === state.cat ? "selected" : ""}>${c.label} (${n})</option>`;
    }).join("") +
    `</select>`;
  document.getElementById("categoryFilterSelect").addEventListener("change", e => {
    setCategory(e.target.value);
  });
}

function setCategory(cat){
  state.cat = cat;
  const select = document.getElementById("categoryFilterSelect");
  if(select) select.value = cat;
  renderCatalog();
}

/* ---------- search + sort ---------- */
function wireSearchAndSort(){
  const search = document.getElementById("searchInput");
  const sort = document.getElementById("sortSelect");
  const hasCatalogGrid = !!document.getElementById("catalogGrid");

  if(search){
    if(hasCatalogGrid){
      const params = new URLSearchParams(window.location.search);
      const q = params.get("q");
      if(q){ search.value = q; state.query = q.toLowerCase(); }
      search.addEventListener("input", () => {
        state.query = search.value.trim().toLowerCase();
        renderCatalog();
      });
    }else{
      search.addEventListener("keydown", e => {
        if(e.key !== "Enter") return;
        const term = search.value.trim();
        window.location.href = term ? `catalog.html?q=${encodeURIComponent(term)}` : "catalog.html";
      });
    }
  }
  if(sort){
    sort.addEventListener("change", () => {
      state.sort = sort.value;
      renderCatalog();
    });
  }
}

/* ---------- catalog grid ---------- */
function renderCatalog(){
  const grid = document.getElementById("catalogGrid");
  if(!grid) return;

  let items = state.cat === "all" ? [...PRODUCTS] : PRODUCTS.filter(p => p.cat === state.cat);
  if(state.query){
    items = items.filter(p =>
      p.name.toLowerCase().includes(state.query) ||
      p.desc.toLowerCase().includes(state.query) ||
      p.sku.toLowerCase().includes(state.query)
    );
  }
  if(state.sort === "price-asc") items.sort((a,b) => a.price - b.price);
  else if(state.sort === "price-desc") items.sort((a,b) => b.price - a.price);
  else if(state.sort === "name") items.sort((a,b) => a.name.localeCompare(b.name));
  else if(state.sort === "stock") items.sort((a,b) => b.stock - a.stock);

  const countEl = document.getElementById("resultCount");
  if(countEl) countEl.innerHTML = `<b>${items.length}</b> item${items.length === 1 ? "" : "s"}`;

  if(items.length === 0){
    grid.innerHTML = `<div class="empty-state">No items match "${state.query}". Try another search or category.</div>`;
    return;
  }
  grid.innerHTML = items.map(productCard).join("");
  grid.querySelectorAll("[data-add]").forEach(btn => {
    btn.addEventListener("click", () => {
      const p = PRODUCTS.find(x => x.sku === btn.dataset.add);
      Cart.add(btn.dataset.add, 1);
      showToast(`Added <strong>${p.name}</strong> to cart`);
      btn.classList.add("pulse");
      setTimeout(() => btn.classList.remove("pulse"), 400);
    });
  });
}

function productCard(p){
  const media = p.img
    ? `<img src="${p.img}" alt="${p.name}" loading="lazy">`
    : ICONS[p.icon] || ICONS.port;
  const stockLabel = p.stock === 0 ? `<span class="stock-flag out">Out of stock</span>`
    : p.stock <= 2 ? `<span class="stock-flag low">Only ${p.stock} left</span>`
    : `<span class="stock-flag">${p.stock} in stock</span>`;
  const catLabel = (CATEGORIES.find(c => c.id === p.cat) || {}).label || p.cat;
  return `
  <article class="card" data-reveal>
    <div class="card-media">
      ${stockLabel}
      ${media}
      <button class="quick-add" data-add="${p.sku}" aria-label="Add ${p.name} to cart" ${p.stock === 0 ? "disabled" : ""}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M12 5v14M5 12h14" stroke-linecap="round"/></svg>
      </button>
    </div>
    <div class="card-body">
      <div class="card-cat">${catLabel} · <span class="mono">${p.sku}</span></div>
      <div class="card-title">${p.name}</div>
      <p class="card-desc">${p.desc}</p>
      <div class="card-foot">
        <span class="price">${formatJMD(p.price)}</span>
        <button class="btn btn-primary btn-sm" data-add="${p.sku}" ${p.stock === 0 ? "disabled" : ""}>
          ${p.stock === 0 ? "Unavailable" : "Add to cart"}
        </button>
      </div>
    </div>
  </article>`;
}

/* ---------- services ---------- */
function renderServices(){
  const grid = document.getElementById("servicesGrid");
  if(!grid) return;
  const bars = ["var(--grad-primary)", "var(--grad-cool)", "var(--grad-warm)"];
  const svcIcons = ["lan","scanner","cable","computer","port","mouse"];
  grid.innerHTML = SERVICES.map((s, i) => `
    <div class="svc-card" style="--bar:${bars[i % bars.length]}" data-reveal>
      <span class="pico-wrap">${ICONS[svcIcons[i % svcIcons.length]] || ICONS.port}</span>
      <span class="badge">${s.price}</span>
      <h3>${s.name}</h3>
      <p>${s.desc}</p>
      <a class="btn btn-outline btn-sm" href="contact.html?service=${encodeURIComponent(s.name)}">Request this service</a>
    </div>
  `).join("");
}

/* ---------- cart drawer ---------- */
function wireCartDrawer(){
  const openBtn = document.getElementById("cartToggle");
  const closeBtn = document.getElementById("cartClose");
  const overlay = document.getElementById("overlay");
  const drawer = document.getElementById("cartDrawer");
  if(!drawer) return;
  const open = () => { drawer.classList.add("open"); overlay.classList.add("open"); };
  const close = () => { drawer.classList.remove("open"); overlay.classList.remove("open"); };
  openBtn && openBtn.addEventListener("click", open);
  closeBtn && closeBtn.addEventListener("click", close);
  overlay && overlay.addEventListener("click", close);
  window.__openCart = open;
}

function renderCartDrawer(){
  const itemsEl = document.getElementById("cartItems");
  const footEl = document.getElementById("cartFoot");
  if(!itemsEl) return;
  const lines = Cart.lines();
  if(lines.length === 0){
    itemsEl.innerHTML = `<div class="cart-empty">Your cart is empty.<br>Browse the catalog to add parts.</div>`;
    if(footEl) footEl.style.display = "none";
    return;
  }
  if(footEl) footEl.style.display = "block";
  itemsEl.innerHTML = lines.map(l => `
    <div class="cart-row" data-row="${l.sku}">
      <div class="cart-thumb">${l.product.img ? `<img src="${l.product.img}" alt="">` : ICONS[l.product.icon] || ICONS.port}</div>
      <div class="cart-row-info">
        <div class="name">${l.product.name}</div>
        <div class="price">${formatJMD(l.product.price)}</div>
        <div class="qty-ctrl">
          <button data-dec="${l.sku}" aria-label="Decrease quantity">−</button>
          <span>${l.qty}</span>
          <button data-inc="${l.sku}" aria-label="Increase quantity">+</button>
        </div>
        <button class="remove-link" data-remove="${l.sku}">Remove</button>
      </div>
    </div>
  `).join("");

  itemsEl.querySelectorAll("[data-inc]").forEach(b => b.addEventListener("click", () => {
    const l = Cart.lines().find(x => x.sku === b.dataset.inc);
    Cart.setQty(b.dataset.inc, l.qty + 1);
  }));
  itemsEl.querySelectorAll("[data-dec]").forEach(b => b.addEventListener("click", () => {
    const l = Cart.lines().find(x => x.sku === b.dataset.dec);
    Cart.setQty(b.dataset.dec, l.qty - 1);
  }));
  itemsEl.querySelectorAll("[data-remove]").forEach(b => b.addEventListener("click", () => {
    Cart.remove(b.dataset.remove);
  }));

  const totalEl = document.getElementById("cartTotal");
  if(totalEl) totalEl.textContent = formatJMD(Cart.subtotal());
}

function updateCartBadge(){
  document.querySelectorAll(".cart-count").forEach(el => {
    const n = Cart.count();
    el.textContent = n;
    el.style.display = n > 0 ? "flex" : "none";
  });
}

/* ---------- toasts ---------- */
function showToast(html){
  let stack = document.querySelector(".toast-stack");
  if(!stack){
    stack = document.createElement("div");
    stack.className = "toast-stack";
    document.body.appendChild(stack);
  }
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" style="color:var(--cyan); flex-shrink:0;"><path d="M20 6L9 17l-5-5" stroke-linecap="round" stroke-linejoin="round"/></svg><span>${html}</span>`;
  stack.appendChild(toast);
  setTimeout(() => {
    toast.classList.add("leaving");
    setTimeout(() => toast.remove(), 220);
  }, 2600);
}

/* ---------- mobile nav ---------- */
function wireNav(){
  const toggle = document.getElementById("menuToggle");
  const nav = document.getElementById("mainNav");
  if(!toggle || !nav) return;
  toggle.addEventListener("click", () => nav.classList.toggle("open"));
  nav.querySelectorAll("a").forEach(a => a.addEventListener("click", () => nav.classList.remove("open")));
}

/* ---------- contact form ---------- */
function wireContactForm(){
  const form = document.getElementById("contactForm");
  if(!form) return;

  const params = new URLSearchParams(window.location.search);
  const service = params.get("service");
  if(service){
    const select = document.getElementById("contactSubject");
    if(select && [...select.options].some(o => o.value === service)) select.value = service;
  }

  form.addEventListener("submit", e => {
    e.preventDefault();
    const status = document.getElementById("contactStatus");
    status.textContent = "Thanks — your request has been noted. We'll reach out shortly. (Wire this form to Formspree, Netlify Forms, or your inbox — see README.)";
    form.reset();
  });
}

/* ---------- scroll reveal ---------- */
function wireReveal(){
  const items = document.querySelectorAll("[data-reveal]");
  if(!items.length) return;
  const io = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if(entry.isIntersecting){
        entry.target.classList.add("in-view");
        io.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12 });
  items.forEach(el => io.observe(el));

  // catch elements rendered after initial observe (catalog re-renders)
  const mo = new MutationObserver(() => {
    document.querySelectorAll("[data-reveal]:not(.in-view)").forEach(el => io.observe(el));
  });
  const grid = document.getElementById("catalogGrid");
  if(grid) mo.observe(grid, { childList: true });
}

/* ---------- animated hero counters ---------- */
function wireCounters(){
  const els = document.querySelectorAll("[data-count]");
  if(!els.length) return;
  const io = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if(!entry.isIntersecting) return;
      const el = entry.target;
      const target = Number(el.dataset.count);
      let current = 0;
      const step = Math.max(1, Math.round(target / 40));
      const tick = () => {
        current = Math.min(target, current + step);
        el.textContent = current;
        if(current < target) requestAnimationFrame(tick);
        else el.dataset.animated = "1";
      };
      tick();
      io.unobserve(el);
    });
  }, { threshold: 0.6 });
  els.forEach(el => io.observe(el));
}
