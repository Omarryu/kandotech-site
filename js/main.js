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
  showPreviewFlag();
  wireCartDrawer();
  wireGalleryOverlay();
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

  renderHome();
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

  const hoursList = document.getElementById("bizHoursList");
  if(hoursList && b.hoursByDay){
    const days = [
      ["monday", "Monday"], ["tuesday", "Tuesday"], ["wednesday", "Wednesday"],
      ["thursday", "Thursday"], ["friday", "Friday"], ["saturday", "Saturday"], ["sunday", "Sunday"],
    ];
    const todayKey = days[(new Date().getDay() + 6) % 7][0]; // getDay() is Sun-first; shift to Mon-first
    hoursList.innerHTML = days.map(([key, label]) => {
      const value = b.hoursByDay[key] || "Closed";
      const isToday = key === todayKey;
      return `<li class="${isToday ? "today" : ""}"><span>${label}</span><span>${value}</span></li>`;
    }).join("");
  }

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
  grid.querySelectorAll("[data-gallery-open]").forEach(el => {
    el.addEventListener("click", e => {
      if(e.target.closest("[data-add]")) return; // don't trigger gallery when adding to cart
      openGallery(el.dataset.galleryOpen);
    });
  });
}

/* ---------- media gallery lightbox ---------- */
let galleryState = { media: [], index: 0 };

function openGallery(sku){
  const p = PRODUCTS.find(x => x.sku === sku);
  if(!p || !p.media || !p.media.length) return;
  galleryState = { media: p.media, index: 0 };
  renderGallery();
  document.getElementById("galleryOverlay").classList.add("open");
}

function renderGallery(){
  const overlay = document.getElementById("galleryOverlay");
  const { media, index } = galleryState;
  const item = media[index];
  const content = item.type === "video"
    ? `<video src="${item.url}" controls autoplay class="gallery-media"></video>`
    : `<img src="${item.url}" alt="" class="gallery-media">`;
  overlay.innerHTML = `
    <button class="gallery-close" aria-label="Close">&times;</button>
    ${media.length > 1 ? `<button class="gallery-nav prev" aria-label="Previous">&#10094;</button>` : ""}
    ${content}
    ${media.length > 1 ? `<button class="gallery-nav next" aria-label="Next">&#10095;</button>` : ""}
    ${media.length > 1 ? `<div class="gallery-counter">${index + 1} / ${media.length}</div>` : ""}
  `;
  overlay.querySelector(".gallery-close").addEventListener("click", closeGallery);
  const prev = overlay.querySelector(".gallery-nav.prev");
  const next = overlay.querySelector(".gallery-nav.next");
  if(prev) prev.addEventListener("click", () => stepGallery(-1));
  if(next) next.addEventListener("click", () => stepGallery(1));
}

function stepGallery(delta){
  const len = galleryState.media.length;
  galleryState.index = (galleryState.index + delta + len) % len;
  renderGallery();
}

function closeGallery(){
  document.getElementById("galleryOverlay").classList.remove("open");
}

function wireGalleryOverlay(){
  const overlay = document.getElementById("galleryOverlay");
  if(!overlay) return;
  overlay.addEventListener("click", e => {
    if(e.target === overlay) closeGallery();
  });
  document.addEventListener("keydown", e => {
    if(!overlay.classList.contains("open")) return;
    if(e.key === "Escape") closeGallery();
    if(e.key === "ArrowLeft") stepGallery(-1);
    if(e.key === "ArrowRight") stepGallery(1);
  });
}


function productCard(p){
  const media = mediaThumbHTML(p);
  const mediaCount = (p.media || []).length;
  const stockLabel = p.stock === 0 ? `<span class="stock-flag out">Out of stock</span>`
    : p.stock <= 2 ? `<span class="stock-flag low">Only ${p.stock} left</span>`
    : `<span class="stock-flag">${p.stock} in stock</span>`;
  const catLabel = (CATEGORIES.find(c => c.id === p.cat) || {}).label || p.cat;
  const galleryBadge = mediaCount > 1
    ? `<button class="gallery-badge" data-gallery="${p.sku}" aria-label="View ${mediaCount} photos/videos">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="14" height="14" rx="2"/><path d="M21 8v10a2 2 0 01-2 2H9" stroke-linecap="round"/></svg>
        ${mediaCount}
      </button>`
    : "";
  return `
  <article class="card" data-reveal>
    <div class="card-media" ${mediaCount > 1 ? `data-gallery-open="${p.sku}"` : ""}>
      ${stockLabel}
      ${galleryBadge}
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
      <div class="cart-thumb">${mediaThumbHTML(l.product)}</div>
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
  const io = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if(entry.isIntersecting){
        entry.target.classList.add("in-view");
        io.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12 });

  function observeAll(){
    document.querySelectorAll("[data-reveal]:not(.in-view)").forEach(el => io.observe(el));
  }
  observeAll();

  // catch elements rendered after the initial pass (catalog re-renders, filtering, live updates)
  const grid = document.getElementById("catalogGrid");
  if(grid){
    const mo = new MutationObserver(observeAll);
    mo.observe(grid, { childList: true });
  }

  // Safety net: content must never stay invisible indefinitely, even if the
  // IntersectionObserver misses an element for some reason (zero-height
  // container at observe-time, a browser quirk, a re-render race, etc.).
  // This sweep just force-reveals anything still hidden after a beat.
  setInterval(() => {
    document.querySelectorAll("[data-reveal]:not(.in-view)").forEach(el => el.classList.add("in-view"));
  }, 400);
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


/* ==========================================================================
   Editable home page content (managed from the admin console -> Home page).
   Everything is built with DOM APIs / textContent, never innerHTML, so text
   typed into the console can't inject markup.
   ========================================================================== */
function hEl(tag, cls, text){
  const n = document.createElement(tag);
  if(cls) n.className = cls;
  if(text != null) n.textContent = text;
  return n;
}

// Only http(s), mailto, tel and plain site paths are allowed as links.
function homeSafeUrl(u){
  u = String(u || "").trim();
  if(!u || u.startsWith("//")) return "";
  const m = u.match(/^([a-z][a-z0-9+.-]*):/i);
  if(m && !["http", "https", "mailto", "tel"].includes(m[1].toLowerCase())) return "";
  return u;
}
function homeSafeImage(u){
  u = String(u || "").trim();
  return (/^\/?assets\//i.test(u) || /^https:\/\//i.test(u)) ? u : "";
}
function setHomeLink(a, text, url){
  const href = homeSafeUrl(url);
  if(!text || !href){ a.hidden = true; return; }
  a.hidden = false;
  a.textContent = text;
  a.setAttribute("href", href);
  if(/^https?:\/\//i.test(href)){ a.target = "_blank"; a.rel = "noopener"; }
  else { a.removeAttribute("target"); a.removeAttribute("rel"); }
}
// "Hide after" dates: visible through the end of that day (local time).
function homeStillActive(until){
  if(!until) return true;
  const end = new Date(until + "T23:59:59");
  return isNaN(end) ? true : new Date() <= end;
}
// *word* in the headline becomes the gradient-highlighted word.
function fillEmphasis(node, text){
  node.textContent = "";
  String(text || "").split(/(\*[^*]+\*)/).forEach(part => {
    if(!part) return;
    if(part.length > 2 && part.startsWith("*") && part.endsWith("*")){
      node.appendChild(hEl("span", "gradient-text", part.slice(1, -1)));
    }else{
      node.appendChild(document.createTextNode(part));
    }
  });
}
// Blank line = new paragraph; a single line break stays a line break.
function fillParagraphs(container, body){
  String(body || "").split(/\n{2,}/).forEach(chunk => {
    chunk = chunk.trim();
    if(!chunk) return;
    const p = document.createElement("p");
    chunk.split("\n").forEach((line, i) => {
      if(i) p.appendChild(document.createElement("br"));
      p.appendChild(document.createTextNode(line));
    });
    container.appendChild(p);
  });
}

function renderHome(){
  const home = (typeof HOME === "object" && HOME) || {};
  renderAnnouncement(home.announcement || {});
  renderHomeHero(home.hero);
  renderHomeFlyers(home.flyers);
  renderHomeSections(home.sections);
}

function renderAnnouncement(a){
  let bar = document.getElementById("announceBar");
  let dismissed = false;
  try{ dismissed = localStorage.getItem("kandotech_announce_dismissed") === a.text; }catch(e){}
  const active = a.enabled && a.text && homeStillActive(a.until) && (!dismissed || PREVIEW_SERVED);
  if(!active){ if(bar) bar.remove(); return; }
  if(!bar){
    bar = hEl("div", "announce-bar");
    bar.id = "announceBar";
    const header = document.querySelector("header.topbar");
    if(header) header.insertAdjacentElement("afterend", bar); else document.body.prepend(bar);
  }
  bar.textContent = "";
  const inner = hEl("div", "announce-inner");
  inner.appendChild(hEl("span", "announce-text", a.text));
  const link = hEl("a", "announce-link");
  setHomeLink(link, a.linkText, a.linkUrl);
  if(!link.hidden) inner.appendChild(link);
  const close = hEl("button", "announce-close", "×");
  close.type = "button";
  close.setAttribute("aria-label", "Dismiss announcement");
  close.addEventListener("click", () => {
    try{ localStorage.setItem("kandotech_announce_dismissed", a.text); }catch(e){}
    bar.remove();
  });
  bar.appendChild(inner);
  bar.appendChild(close);
}

let heroStackDefault = null;
function renderHomeHero(h){
  const title = document.getElementById("heroTitle");
  if(!title || !h) return;
  const eyebrow = document.getElementById("heroEyebrow");
  const lead = document.getElementById("heroLead");
  if(eyebrow) eyebrow.textContent = h.eyebrow || "";
  fillEmphasis(title, h.headline);
  if(lead) lead.textContent = h.lead || "";
  const primary = document.getElementById("heroPrimary");
  const secondary = document.getElementById("heroSecondary");
  if(primary) setHomeLink(primary, h.primaryText, h.primaryUrl);
  if(secondary) setHomeLink(secondary, h.secondaryText, h.secondaryUrl);

  const stack = document.getElementById("heroStack");
  if(stack){
    if(heroStackDefault === null) heroStackDefault = stack.innerHTML;
    const cards = (h.cards || []).filter(c => homeSafeImage(c.url));
    if(cards.length){
      stack.textContent = "";
      cards.forEach(c => {
        const card = hEl("div", "stack-card");
        const img = document.createElement("img");
        img.src = homeSafeImage(c.url);
        img.alt = c.tag || "";
        card.appendChild(img);
        if(c.tag) card.appendChild(hEl("div", "tag", c.tag));
        stack.appendChild(card);
      });
    }else{
      stack.innerHTML = heroStackDefault;
    }
  }
}

function renderHomeFlyers(f){
  const section = document.getElementById("homeFlyers");
  if(!section) return;
  const items = ((f && f.items) || []).filter(i => homeSafeImage(i.url) && homeStillActive(i.until));
  if(!items.length){ section.hidden = true; return; }
  section.hidden = false;
  document.getElementById("flyersTitle").textContent = f.title || "";
  const intro = document.getElementById("flyersIntro");
  intro.textContent = f.intro || "";
  intro.hidden = !f.intro;

  const grid = document.getElementById("flyerGrid");
  grid.textContent = "";
  items.forEach(item => {
    const card = hEl("figure", "flyer-card");
    const open = hEl("button", "flyer-open");
    open.type = "button";
    open.setAttribute("aria-label", "View larger: " + (item.caption || "flyer"));
    const img = document.createElement("img");
    img.src = homeSafeImage(item.url);
    img.alt = item.caption || "Flyer";
    img.loading = "lazy";
    open.appendChild(img);
    open.addEventListener("click", () => openFlyerLightbox(img.src, item.caption));
    card.appendChild(open);
    if(item.caption) card.appendChild(hEl("figcaption", "flyer-caption", item.caption));
    const more = hEl("a", "flyer-link");
    setHomeLink(more, "Learn more →", item.linkUrl);
    if(!more.hidden) card.appendChild(more);
    grid.appendChild(card);
  });
}

function openFlyerLightbox(src, caption){
  const old = document.getElementById("flyerLightbox");
  if(old) old.remove();
  const box = hEl("div", "flyer-lightbox");
  box.id = "flyerLightbox";
  const img = document.createElement("img");
  img.src = src;
  img.alt = caption || "Flyer";
  const close = hEl("button", "flyer-lightbox-close", "×");
  close.type = "button";
  close.setAttribute("aria-label", "Close");
  const shut = () => { box.remove(); document.removeEventListener("keydown", onKey); };
  const onKey = e => { if(e.key === "Escape") shut(); };
  box.addEventListener("click", e => { if(e.target !== img) shut(); });
  close.addEventListener("click", shut);
  document.addEventListener("keydown", onKey);
  box.appendChild(img);
  if(caption) box.appendChild(hEl("div", "flyer-lightbox-caption", caption));
  box.appendChild(close);
  document.body.appendChild(box);
}

function renderHomeSections(list){
  const wrap = document.getElementById("homeSections");
  if(!wrap) return;
  wrap.textContent = "";
  (list || []).forEach(s => {
    if(s.visible === false) return;
    const image = homeSafeImage(s.imageUrl);
    if(!s.heading && !s.body && !image) return;

    const section = document.createElement("section");
    section.className = "home-block" + (image ? " has-image side-" + (s.imageSide === "left" ? "left" : "right") : "");
    if(s.id) section.id = String(s.id).replace(/[^\w-]/g, "");
    const container = hEl("div", "container");
    const text = hEl("div", "home-block-text");
    if(s.kicker) text.appendChild(hEl("span", "kicker", s.kicker));
    if(s.heading) text.appendChild(hEl("h2", null, s.heading));
    fillParagraphs(text, s.body);

    const b1 = hEl("a", "btn btn-outline");
    const b2 = hEl("a", "btn btn-primary");
    setHomeLink(b1, s.button1Text, s.button1Url);
    setHomeLink(b2, s.button2Text, s.button2Url);
    if(!b1.hidden || !b2.hidden){
      const row = hEl("div", "home-block-buttons");
      if(!b1.hidden) row.appendChild(b1);
      if(!b2.hidden) row.appendChild(b2);
      text.appendChild(row);
    }

    if(image){
      const fig = hEl("div", "home-block-media");
      const img = document.createElement("img");
      img.src = image;
      img.alt = s.heading || "";
      img.loading = "lazy";
      fig.appendChild(img);
      container.appendChild(text);
      container.appendChild(fig);
    }else{
      container.classList.add("center");
      container.appendChild(text);
    }
    section.appendChild(container);
    wrap.appendChild(section);
  });
}

function showPreviewFlag(){
  if(!PREVIEW_SERVED || document.getElementById("previewFlag")) return;
  const flag = hEl("div", "preview-flag", "Draft preview — visitors can't see these changes until you publish");
  flag.id = "previewFlag";
  document.body.appendChild(flag);
}
