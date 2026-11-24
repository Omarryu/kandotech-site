/* ==========================================================================
   KANDOTECH — admin console
   ========================================================================== */

let draft = { products: [], categories: [], services: [], business: {}, home: {} };
let liveSnapshot = { products: [], categories: [], services: [], business: {}, home: {} };
let saveTimer = null;
let searchTerm = "";

document.addEventListener("DOMContentLoaded", init);

async function init(){
  wireLoginForm();
  wireLogout();
  wireTabs();
  wirePublishBar();
  wireAddButtons();
  wireHomeEditor();
  document.getElementById("adminSearch").addEventListener("input", e => {
    searchTerm = e.target.value.trim().toLowerCase();
    renderProducts();
  });

  const authed = await checkAuth();
  if(authed){
    showDashboard();
    await loadAdminCatalog();
  }else{
    showLogin();
  }
}

async function checkAuth(){
  try{
    const res = await fetch("/api/admin/check");
    return res.ok;
  }catch(e){ return false; }
}

function showLogin(){
  document.getElementById("loginScreen").hidden = false;
  document.getElementById("dashboard").hidden = true;
}
function showDashboard(){
  document.getElementById("loginScreen").hidden = true;
  document.getElementById("dashboard").hidden = false;
}

/* ---------- login / logout ---------- */
function wireLoginForm(){
  document.getElementById("loginForm").addEventListener("submit", async e => {
    e.preventDefault();
    const password = document.getElementById("loginPassword").value;
    const errorEl = document.getElementById("loginError");
    const submitBtn = e.target.querySelector("button[type=submit]");
    errorEl.textContent = "";
    submitBtn.disabled = true;
    submitBtn.textContent = "Logging in…";
    try{
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if(!res.ok){
        const data = await res.json().catch(() => ({}));
        errorEl.textContent = data.error || `Login failed (server said ${res.status}).`;
        console.error("Admin login failed:", res.status, data);
        return;
      }
      showDashboard();
      await loadAdminCatalog();
    }catch(e){
      errorEl.textContent = "Couldn't reach the server. Is it running at this same address?";
      console.error("Admin login error:", e);
    }finally{
      submitBtn.disabled = false;
      submitBtn.textContent = "Log in";
    }
  });
}

function wireLogout(){
  document.getElementById("logoutBtn").addEventListener("click", async () => {
    await fetch("/api/admin/logout", { method: "POST" });
    showLogin();
  });
}

/* ---------- load / save ---------- */
async function loadAdminCatalog(){
  const res = await fetch("/api/admin/catalog");
  const data = await res.json();
  draft = data.draft;
  liveSnapshot = data.live;
  renderProducts();
  renderCategories();
  renderServices();
  renderBusinessForm();
  renderHomeEditor();
  updatePublishBar();
}

function scheduleSave(){
  setSaveStatus("saving");
  updatePublishBar();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveDraft, 600);
}

async function saveDraft(){
  try{
    const res = await fetch("/api/admin/catalog", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    });
    if(!res.ok){
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || "save failed");
    }
    setSaveStatus("saved");
  }catch(e){
    setSaveStatus("error");
    showAdminToast(e.message || "Couldn't save your changes.");
  }
}

function setSaveStatus(state){
  const el = document.getElementById("saveStatus");
  el.classList.remove("saving", "error");
  if(state === "saving"){ el.textContent = "Saving…"; el.classList.add("saving"); }
  else if(state === "error"){ el.textContent = "Couldn't save — check connection"; el.classList.add("error"); }
  else{ el.textContent = "All changes saved"; }
}

/* ---------- publish / discard ---------- */
function wirePublishBar(){
  document.getElementById("publishBtn").addEventListener("click", async () => {
    const btn = document.getElementById("publishBtn");
    btn.disabled = true;
    btn.textContent = "Publishing…";
    try{
      await saveDraft();
      const res = await fetch("/api/admin/publish", { method: "POST" });
      if(!res.ok) throw new Error("publish failed");
      liveSnapshot = JSON.parse(JSON.stringify(draft));
      updatePublishBar();
      showAdminToast("Published — the live site updated instantly for everyone viewing it.");
    }catch(e){
      showAdminToast("Publish failed. Check your connection and try again.");
    }finally{
      btn.disabled = false;
      btn.textContent = "Publish changes to live site";
    }
  });

  document.getElementById("discardBtn").addEventListener("click", async () => {
    if(!confirm("Discard all unpublished draft changes? This can't be undone.")) return;
    const res = await fetch("/api/admin/discard", { method: "POST" });
    const data = await res.json();
    draft = data.draft;
    liveSnapshot = JSON.parse(JSON.stringify(draft));
    renderProducts();
    renderCategories();
    renderServices();
    renderBusinessForm();
    renderHomeEditor();
    updatePublishBar();
    showAdminToast("Draft reverted to match the live site.");
  });
}

function updatePublishBar(){
  const dirty = JSON.stringify(draft) !== JSON.stringify(liveSnapshot);
  const bar = document.querySelector(".publish-bar");
  bar.classList.toggle("dirty", dirty);
  document.getElementById("publishHeadline").textContent = dirty
    ? "You have unpublished changes"
    : "Draft matches live site";
  document.getElementById("publishSub").textContent = dirty
    ? "Publish to push these edits — including new images — to everyone viewing the site."
    : "Edits you make here only affect the draft until you publish.";
}

/* ---------- tabs ---------- */
function wireTabs(){
  document.querySelectorAll(".tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      document.querySelectorAll(".tab-panel").forEach(p => p.hidden = p.dataset.panel !== tab.dataset.tab);
    });
  });
}

/* ---------- products ---------- */
function renderProducts(){
  const el = document.getElementById("productTable");
  let items = draft.products;
  if(searchTerm){
    items = items.filter(p =>
      p.name.toLowerCase().includes(searchTerm) ||
      p.sku.toLowerCase().includes(searchTerm) ||
      p.cat.toLowerCase().includes(searchTerm)
    );
  }
  if(items.length === 0){
    el.innerHTML = `<div class="empty-state">No products match your search.</div>`;
    return;
  }
  // Pass each product's position in the FULL draft.products array (not the
  // filtered list) — edits always target that stable index, so renaming a
  // SKU can't orphan the other fields in the same row mid-edit.
  el.innerHTML = items.map(p => productRow(p, draft.products.indexOf(p))).join("");
  wireProductRowEvents(el);
}

function productRow(p, index){
  const catOptions = draft.categories.map(c =>
    `<option value="${c.id}" ${c.id === p.cat ? "selected" : ""}>${c.label}</option>`
  ).join("");
  const stockClass = p.stock === 0 ? "zero" : "";
  const uid = safeId(p.sku) + "-" + index;
  const media = Array.isArray(p.media) ? p.media : [];
  const coverContent = media.length ? mediaThumbHTML(p) : (ICONS[p.icon] || ICONS.port);
  return `
  <div class="product-row" data-index="${index}">
    <div class="product-row-main">
      <div class="thumb" title="Cover photo — shown in the catalog grid">
        ${coverContent}
      </div>
      <div class="field-stack">
        <label for="name-${uid}">Name</label>
        <input type="text" id="name-${uid}" data-field="name" data-index="${index}" value="${escapeAttr(p.name)}">
        <label class="sr-only" for="desc-${uid}">Description</label>
        <textarea id="desc-${uid}" data-field="desc" data-index="${index}" rows="2">${p.desc}</textarea>
        <label for="sku-${uid}" class="sr-only">SKU / item number</label>
        <input type="text" id="sku-${uid}" class="sku-input mono" data-field="sku" data-index="${index}" value="${escapeAttr(p.sku)}" placeholder="SKU / item number">
      </div>
      <div class="field-stack">
        <label for="cat-${uid}">Category</label>
        <select id="cat-${uid}" data-field="cat" data-index="${index}">${catOptions}</select>
        <span class="field-note">Stock <span class="stock-pill ${stockClass}">${p.stock} on hand</span></span>
      </div>
      <div class="field-stack">
        <label for="price-${uid}">Price (JMD)</label>
        <input type="number" id="price-${uid}" min="0" step="1" data-field="price" data-index="${index}" value="${p.price}">
      </div>
      <div class="field-stack">
        <label for="stock-${uid}">Stock qty</label>
        <input type="number" id="stock-${uid}" min="0" step="1" data-field="stock" data-index="${index}" value="${p.stock}">
      </div>
      <div class="row-actions">
        <button class="icon-danger" data-delete-index="${index}" title="Delete product" aria-label="Delete product">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0l-1 14a2 2 0 01-2 2H7a2 2 0 01-2-2L4 6" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </div>
    </div>

    <div class="media-strip">
      <span class="media-strip-label">Photos &amp; videos <span class="dim">(the first one is the cover photo shown in the catalog)</span></span>
      <div class="media-strip-items">
        ${media.map((m, i) => `
          <div class="media-chip ${i === 0 ? "is-cover" : ""}" data-media-index="${i}">
            ${m.type === "video"
              ? `<video src="${m.url}" muted></video><span class="media-chip-badge">▶</span>`
              : `<img src="${m.url}" alt="">`}
            ${i === 0 ? `<span class="media-chip-cover-tag">Cover</span>` : `<button class="media-chip-star" data-make-cover-index="${index}" data-media-idx="${i}" title="Make this the cover photo">★</button>`}
            <button class="media-chip-remove" data-remove-media-index="${index}" data-media-idx="${i}" aria-label="Remove this photo">&times;</button>
          </div>
        `).join("")}
        <label class="media-add-btn" for="media-file-${uid}">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14" stroke-linecap="round"/></svg>
          <input type="file" id="media-file-${uid}" accept="image/*,video/mp4,video/webm,video/quicktime" multiple data-media-for-index="${index}" class="sr-only">
        </label>
      </div>
    </div>
  </div>`;
}

function safeId(str){
  return String(str).replace(/[^a-zA-Z0-9_-]/g, "-");
}

function wireProductRowEvents(container){
  container.querySelectorAll("[data-field]").forEach(input => {
    const commitEvent = input.dataset.field === "sku" ? "change" : "input"; // validate SKU only once typing settles
    input.addEventListener(commitEvent, () => {
      const index = Number(input.dataset.index);
      const field = input.dataset.field;
      const product = draft.products[index];
      if(!product) return;
      let value = input.value;

      if(field === "price" || field === "stock") value = Math.max(0, Number(value) || 0);

      if(field === "sku"){
        const newSku = value.trim();
        if(!newSku){
          showAdminToast("SKU can't be empty — reverted.");
          input.value = product.sku;
          return;
        }
        const clash = draft.products.some((p, i) => i !== index && p.sku.toLowerCase() === newSku.toLowerCase());
        if(clash){
          showAdminToast(`SKU "${newSku}" is already used by another product — reverted.`);
          input.value = product.sku;
          return;
        }
        value = newSku;
      }

      product[field] = value;
      if(field === "stock"){
        const pill = container.querySelector(`[data-index="${index}"] .stock-pill`);
        if(pill){
          pill.textContent = `${value} on hand`;
          pill.classList.toggle("zero", Number(value) === 0);
        }
      }
      scheduleSave();
    });
  });

  container.querySelectorAll("[data-delete-index]").forEach(btn => {
    btn.addEventListener("click", () => {
      const index = Number(btn.dataset.deleteIndex);
      const product = draft.products[index];
      if(!confirm(`Delete "${product ? product.name : "this product"}"? This can't be undone.`)) return;
      draft.products.splice(index, 1);
      renderProducts();
      scheduleSave();
    });
  });

  container.querySelectorAll("[data-media-for-index]").forEach(fileInput => {
    fileInput.addEventListener("change", async () => {
      const files = Array.from(fileInput.files || []);
      if(!files.length) return;
      const index = Number(fileInput.dataset.mediaForIndex);
      const product = draft.products[index];
      if(!product) return;
      if(!Array.isArray(product.media)) product.media = [];

      let uploaded = 0;
      for(const file of files){
        try{
          const form = new FormData();
          form.append("image", file); // same field name the backend expects for any upload
          const res = await fetch("/api/admin/upload", { method: "POST", body: form });
          const data = await res.json();
          if(!res.ok) throw new Error(data.error || "Upload failed");
          product.media.push({ type: data.type || "image", url: data.url });
          uploaded++;
        }catch(e){
          showAdminToast(`"${file.name}" failed: ${e.message || "upload error"}`);
        }
      }
      if(uploaded){
        renderProducts();
        scheduleSave();
        showAdminToast(`Added ${uploaded} item${uploaded === 1 ? "" : "s"} to the gallery. Publish to make it live.`);
      }
      fileInput.value = "";
    });
  });

  container.querySelectorAll("[data-make-cover-index]").forEach(btn => {
    btn.addEventListener("click", () => {
      const index = Number(btn.dataset.makeCoverIndex);
      const idx = Number(btn.dataset.mediaIdx);
      const product = draft.products[index];
      if(!product || !Array.isArray(product.media)) return;
      const [item] = product.media.splice(idx, 1);
      product.media.unshift(item);
      renderProducts();
      scheduleSave();
    });
  });

  container.querySelectorAll("[data-remove-media-index]").forEach(btn => {
    btn.addEventListener("click", () => {
      const index = Number(btn.dataset.removeMediaIndex);
      const idx = Number(btn.dataset.mediaIdx);
      const product = draft.products[index];
      if(!product || !Array.isArray(product.media)) return;
      product.media.splice(idx, 1);
      renderProducts();
      scheduleSave();
    });
  });
}

function wireAddButtons(){
  document.getElementById("addProductBtn").addEventListener("click", () => {
    const sku = "NEW-" + Date.now().toString(36).toUpperCase();
    draft.products.unshift({
      sku, name: "New product", cat: (draft.categories[0] || {}).id || "", price: 0, stock: 0,
      desc: "", icon: "port", media: [],
    });
    searchTerm = "";
    document.getElementById("adminSearch").value = "";
    renderProducts();
    scheduleSave();
    const row = document.querySelector(`.product-row[data-index="0"] input[data-field="name"]`);
    if(row){ row.focus(); row.select(); }
  });

  document.getElementById("addCategoryBtn").addEventListener("click", () => {
    const id = "cat-" + Date.now().toString(36);
    draft.categories.push({ id, label: "New Category", blurb: "" });
    renderCategories();
    renderProducts(); // category dropdowns need refreshing
    scheduleSave();
  });

  document.getElementById("addServiceBtn").addEventListener("click", () => {
    const id = "svc-" + Date.now().toString(36);
    draft.services.push({ id, name: "New service", price: "Custom quote", desc: "" });
    renderServices();
    scheduleSave();
  });
}

/* ---------- categories ---------- */
function renderCategories(){
  const el = document.getElementById("categoryTable");
  if(draft.categories.length === 0){
    el.innerHTML = `<div class="empty-state">No categories yet.</div>`;
    return;
  }
  el.innerHTML = draft.categories.map(c => `
    <div class="simple-row" data-id="${c.id}">
      <input type="text" data-cfield="label" data-id="${c.id}" value="${escapeAttr(c.label)}" placeholder="Label" aria-label="Category label">
      <input type="text" value="${c.id}" disabled class="mono" style="opacity:.6;" aria-label="Category ID (not editable)">
      <input type="text" data-cfield="blurb" data-id="${c.id}" value="${escapeAttr(c.blurb || "")}" placeholder="Short description" aria-label="Category short description">
      <button class="icon-danger" data-cdelete="${c.id}" aria-label="Delete category ${escapeAttr(c.label)}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0l-1 14a2 2 0 01-2 2H7a2 2 0 01-2-2L4 6" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
    </div>
  `).join("");

  el.querySelectorAll("[data-cfield]").forEach(input => {
    input.addEventListener("input", () => {
      const cat = draft.categories.find(c => c.id === input.dataset.id);
      if(cat) cat[input.dataset.cfield] = input.value;
      scheduleSave();
    });
  });
  el.querySelectorAll("[data-cdelete]").forEach(btn => {
    btn.addEventListener("click", () => {
      const inUse = draft.products.some(p => p.cat === btn.dataset.cdelete);
      if(inUse && !confirm("Some products still use this category. Delete it anyway?")) return;
      draft.categories = draft.categories.filter(c => c.id !== btn.dataset.cdelete);
      renderCategories();
      renderProducts();
      scheduleSave();
    });
  });
}

/* ---------- services ---------- */
function renderServices(){
  const el = document.getElementById("serviceTable");
  if(draft.services.length === 0){
    el.innerHTML = `<div class="empty-state">No services yet.</div>`;
    return;
  }
  el.innerHTML = draft.services.map(s => `
    <div class="simple-row" data-id="${s.id}">
      <input type="text" data-sfield="name" data-id="${s.id}" value="${escapeAttr(s.name)}" placeholder="Service name" aria-label="Service name">
      <input type="text" data-sfield="price" data-id="${s.id}" value="${escapeAttr(s.price)}" placeholder="e.g. From J$5,000" aria-label="Service price">
      <textarea data-sfield="desc" data-id="${s.id}" rows="2" placeholder="Description" aria-label="Service description">${s.desc}</textarea>
      <button class="icon-danger" data-sdelete="${s.id}" aria-label="Delete service ${escapeAttr(s.name)}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0l-1 14a2 2 0 01-2 2H7a2 2 0 01-2-2L4 6" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
    </div>
  `).join("");

  el.querySelectorAll("[data-sfield]").forEach(input => {
    input.addEventListener("input", () => {
      const svc = draft.services.find(s => s.id === input.dataset.id);
      if(svc) svc[input.dataset.sfield] = input.value;
      scheduleSave();
    });
  });
  el.querySelectorAll("[data-sdelete]").forEach(btn => {
    btn.addEventListener("click", () => {
      draft.services = draft.services.filter(s => s.id !== btn.dataset.sdelete);
      renderServices();
      scheduleSave();
    });
  });
}

/* ---------- business info ---------- */
const DAYS = [
  { key: "monday", label: "Monday" },
  { key: "tuesday", label: "Tuesday" },
  { key: "wednesday", label: "Wednesday" },
  { key: "thursday", label: "Thursday" },
  { key: "friday", label: "Friday" },
  { key: "saturday", label: "Saturday" },
  { key: "sunday", label: "Sunday" },
];

function renderBusinessForm(){
  const el = document.getElementById("businessForm");
  if(!el) return;
  const b = draft.business || {};
  if(!b.hoursByDay) b.hoursByDay = {};
  const fields = [
    { key: "name",    label: "Full business name" },
    { key: "short",   label: "Short name (header logo)" },
    { key: "tagline", label: "Tagline" },
    { key: "address", label: "Address" },
    { key: "phone",   label: "Phone" },
    { key: "email",   label: "Email" },
  ];

  el.innerHTML = `
    ${fields.map(f => `
      <div class="field">
        <label for="biz-${f.key}">${f.label}</label>
        <input id="biz-${f.key}" type="text" data-bfield="${f.key}" value="${escapeAttr(b[f.key] || "")}">
      </div>
    `).join("")}

    <h4 class="hours-heading">Hours by day</h4>
    <p class="dim" style="margin:0 0 12px; font-size:.82rem;">Type a time range for each day, or "Closed" for days you're not open.</p>
    <div class="hours-grid">
      ${DAYS.map(d => `
        <div class="field">
          <label for="biz-hours-${d.key}">${d.label}</label>
          <input id="biz-hours-${d.key}" type="text" data-hfield="${d.key}" value="${escapeAttr(b.hoursByDay[d.key] || "")}" placeholder="e.g. 9:00am – 5:00pm or Closed">
        </div>
      `).join("")}
    </div>
  `;

  el.querySelectorAll("[data-bfield]").forEach(input => {
    input.addEventListener("input", () => {
      if(!draft.business) draft.business = {};
      draft.business[input.dataset.bfield] = input.value;
      scheduleSave();
    });
  });

  el.querySelectorAll("[data-hfield]").forEach(input => {
    input.addEventListener("input", () => {
      if(!draft.business) draft.business = {};
      if(!draft.business.hoursByDay) draft.business.hoursByDay = {};
      draft.business.hoursByDay[input.dataset.hfield] = input.value;
      scheduleSave();
    });
  });
}

/* ---------- helpers ---------- */
function escapeAttr(str){
  return String(str || "").replace(/"/g, "&quot;");
}

function showAdminToast(text){
  const stack = document.getElementById("adminToastStack");
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" style="color:var(--cyan); flex-shrink:0;"><path d="M20 6L9 17l-5-5" stroke-linecap="round" stroke-linejoin="round"/></svg><span>${text}</span>`;
  stack.appendChild(toast);
  setTimeout(() => {
    toast.classList.add("leaving");
    setTimeout(() => toast.remove(), 220);
  }, 3200);
}


/* ==========================================================================
   Home page editor (Home page tab)
   Scalar fields are bound by path, e.g. data-hpath="sections.2.heading",
   and written straight into draft.home. Structural changes (add/remove/move,
   uploads) re-render the editor; typing never does, so focus is kept.
   ========================================================================== */
const HOME_MAX_FLYERS = 24, HOME_MAX_SECTIONS = 30, HOME_MAX_HERO_CARDS = 3;

// Escapes everything that matters inside HTML text AND attributes.
function hx(v){
  return String(v == null ? "" : v)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function rid(prefix){ return prefix + "-" + Math.random().toString(36).slice(2, 8); }

function hField(label, path, value, o = {}){
  const id = "hp-" + path.replace(/\./g, "-");
  const hint = o.hint ? `<div class="hint">${hx(o.hint)}</div>` : "";
  let input;
  if(o.type === "textarea"){
    input = `<textarea id="${id}" data-hpath="${path}" rows="${o.rows || 3}" maxlength="${o.max || 600}">${hx(value)}</textarea>`;
  }else if(o.type === "select"){
    input = `<select id="${id}" data-hpath="${path}">${o.options.map(([v, l]) => `<option value="${v}"${v === value ? " selected" : ""}>${hx(l)}</option>`).join("")}</select>`;
  }else if(o.type === "date"){
    input = `<input id="${id}" type="date" data-hpath="${path}" value="${hx(value)}">`;
  }else{
    input = `<input id="${id}" type="text" data-hpath="${path}" value="${hx(value)}" maxlength="${o.max || 200}" placeholder="${hx(o.placeholder || "")}">`;
  }
  return `<div class="field"><label for="${id}">${hx(label)}</label>${input}${hint}</div>`;
}
function hCheck(label, path, checked){
  const id = "hp-" + path.replace(/\./g, "-");
  return `<label class="hcheck" for="${id}"><input id="${id}" type="checkbox" data-hpath="${path}"${checked ? " checked" : ""}> <span>${hx(label)}</span></label>`;
}
function hUploadButton(label, kind, extra = "", multiple = true){
  return `<label class="btn btn-ghost btn-sm hupload">${hx(label)}<input type="file" accept="image/*" ${multiple ? "multiple" : ""} hidden data-hupload="${kind}" ${extra}></label>`;
}
function hIconBtn(action, i, text, title, disabled){
  return `<button type="button" class="hbtn" data-haction="${action}" data-i="${i}" title="${hx(title)}" aria-label="${hx(title)}"${disabled ? " disabled" : ""}>${text}</button>`;
}

function ensureHomeShape(){
  if(!draft.home || typeof draft.home !== "object") draft.home = {};
  const h = draft.home;
  h.announcement = h.announcement || { enabled: false, text: "", linkText: "", linkUrl: "", until: "" };
  h.hero = h.hero || {};
  h.hero.cards = h.hero.cards || [];
  h.flyers = h.flyers || { title: "Flyers & promotions", intro: "", items: [] };
  h.flyers.items = h.flyers.items || [];
  h.sections = h.sections || [];
  return h;
}

function renderHomeEditor(){
  const root = document.getElementById("homeEditor");
  if(!root) return;
  const h = ensureHomeShape();
  const a = h.announcement, hero = h.hero, fl = h.flyers;

  const heroCards = hero.cards.map((c, i) => `
    <div class="hmedia">
      <img src="${hx(c.url)}" alt="">
      <input type="text" data-hpath="hero.cards.${i}.tag" value="${hx(c.tag)}" maxlength="80" placeholder="Label (optional)" aria-label="Picture ${i + 1} label">
      ${hIconBtn("hero-card-remove", i, "Remove", "Remove this picture")}
    </div>`).join("");

  const flyerCards = fl.items.map((f, i) => `
    <div class="hflyer">
      <img src="${hx(f.url)}" alt="">
      <input type="text" data-hpath="flyers.items.${i}.caption" value="${hx(f.caption)}" maxlength="140" placeholder="Caption (optional)" aria-label="Caption ${i + 1}">
      <input type="text" data-hpath="flyers.items.${i}.linkUrl" value="${hx(f.linkUrl)}" maxlength="500" placeholder="Link (optional) e.g. catalog.html" aria-label="Link ${i + 1}">
      <label class="hmini">Hide after <input type="date" data-hpath="flyers.items.${i}.until" value="${hx(f.until)}"></label>
      <div class="hrow-actions">
        ${hIconBtn("flyer-move-left", i, "←", "Move earlier", i === 0)}
        ${hIconBtn("flyer-move-right", i, "→", "Move later", i === fl.items.length - 1)}
        ${hIconBtn("flyer-remove", i, "Remove", "Remove this flyer")}
      </div>
    </div>`).join("");

  const sections = h.sections.map((s, i) => `
    <div class="hcard hsection">
      <div class="hsection-head">
        <strong>Section ${i + 1}</strong>
        ${hCheck("Show on site", `sections.${i}.visible`, s.visible !== false)}
        <span class="hrow-actions">
          ${hIconBtn("section-move-up", i, "↑", "Move up", i === 0)}
          ${hIconBtn("section-move-down", i, "↓", "Move down", i === h.sections.length - 1)}
          ${hIconBtn("section-remove", i, "Delete", "Delete this section")}
        </span>
      </div>
      ${hField("Small heading above the title (optional)", `sections.${i}.kicker`, s.kicker, { max: 60 })}
      ${hField("Title", `sections.${i}.heading`, s.heading, { max: 160 })}
      ${hField("Text", `sections.${i}.body`, s.body, { type: "textarea", rows: 5, max: 5000, hint: "Leave a blank line between paragraphs." })}
      <div class="field">
        <label>Picture (optional)</label>
        ${s.imageUrl
          ? `<div class="hsection-image"><img src="${hx(s.imageUrl)}" alt="">
               <div class="hrow-actions">${hUploadButton("Replace", "section-image", `data-i="${i}"`, false)}${hIconBtn("section-image-remove", i, "Remove picture", "Remove picture")}</div></div>`
          : hUploadButton("+ Add picture", "section-image", `data-i="${i}"`, false)}
      </div>
      ${s.imageUrl ? hField("Picture position", `sections.${i}.imageSide`, s.imageSide, { type: "select", options: [["right", "Right of the text"], ["left", "Left of the text"]] }) : ""}
      <div class="hgrid2">
        ${hField("Button 1 text", `sections.${i}.button1Text`, s.button1Text, { max: 40 })}
        ${hField("Button 1 link", `sections.${i}.button1Url`, s.button1Url, { placeholder: "e.g. about.html or https://…" })}
        ${hField("Button 2 text", `sections.${i}.button2Text`, s.button2Text, { max: 40 })}
        ${hField("Button 2 link", `sections.${i}.button2Url`, s.button2Url, { placeholder: "e.g. contact.html" })}
      </div>
    </div>`).join("");

  root.innerHTML = `
    <div class="hcard">
      <h3>Announcement bar</h3>
      <p class="dim">A colored bar across the top of every page — holiday hours, a sale, a notice. Visitors can close it.</p>
      ${hCheck("Show the announcement bar", "announcement.enabled", a.enabled)}
      ${hField("Message", "announcement.text", a.text, { max: 300, placeholder: "e.g. We're closed Monday for the holiday." })}
      <div class="hgrid2">
        ${hField("Link text (optional)", "announcement.linkText", a.linkText, { max: 60, placeholder: "e.g. See hours" })}
        ${hField("Link address (optional)", "announcement.linkUrl", a.linkUrl, { placeholder: "contact.html or https://…" })}
      </div>
      ${hField("Hide automatically after (optional)", "announcement.until", a.until, { type: "date" })}
    </div>

    <div class="hcard">
      <h3>Top banner</h3>
      <p class="dim">The big headline area at the top of the home page.</p>
      ${hField("Small line above the headline", "hero.eyebrow", hero.eyebrow, { max: 120 })}
      ${hField("Headline", "hero.headline", hero.headline, { max: 200, hint: "Put *stars* around a word to give it the colored highlight, e.g. Every port and *machine*." })}
      ${hField("Description", "hero.lead", hero.lead, { type: "textarea", rows: 3, max: 600 })}
      <div class="hgrid2">
        ${hField("First button text", "hero.primaryText", hero.primaryText, { max: 40 })}
        ${hField("First button link", "hero.primaryUrl", hero.primaryUrl, { placeholder: "catalog.html" })}
        ${hField("Second button text", "hero.secondaryText", hero.secondaryText, { max: 40 })}
        ${hField("Second button link", "hero.secondaryUrl", hero.secondaryUrl, { placeholder: "services.html" })}
      </div>
      <div class="field">
        <label>Banner pictures (up to ${HOME_MAX_HERO_CARDS})</label>
        <div class="hhint-line dim">The stacked pictures on the right of the banner. Leave empty to keep the default product pictures.</div>
        <div class="hmedia-row">${heroCards}</div>
        ${hero.cards.length < HOME_MAX_HERO_CARDS ? hUploadButton("+ Add picture", "hero-card") : ""}
      </div>
    </div>

    <div class="hcard">
      <h3>Flyers &amp; pictures</h3>
      <p class="dim">Upload flyers, posters or promo pictures. Visitors can tap one to see it full size. The whole section is hidden when there are none.</p>
      <div class="hgrid2">
        ${hField("Section title", "flyers.title", fl.title, { max: 80 })}
        ${hField("Short intro (optional)", "flyers.intro", fl.intro, { max: 300 })}
      </div>
      <div class="hflyer-grid">${flyerCards}</div>
      ${fl.items.length < HOME_MAX_FLYERS ? hUploadButton("+ Add flyers / pictures", "flyers") : ""}
      <div class="hhint-line dim">Tip: set a "Hide after" date on a promotion and it disappears by itself when it ends.</div>
    </div>

    <h3 class="hsections-title">Text sections</h3>
    <p class="dim" style="margin-top:0;">Announcements, paragraphs, anything you want to say — each with an optional picture and up to two buttons. They appear below the product categories.</p>
    ${sections}
    ${h.sections.length < HOME_MAX_SECTIONS ? `<button type="button" class="btn btn-primary btn-sm" data-haction="section-add">+ Add a section</button>` : ""}
  `;
}

function setPath(obj, path, value){
  const keys = path.split(".");
  let o = obj;
  for(let i = 0; i < keys.length - 1; i++){
    o = o[keys[i]];
    if(o == null) return;
  }
  o[keys[keys.length - 1]] = value;
}

// Big phone photos are shrunk before upload so the home page stays fast.
async function prepareHomeImage(file){
  if(!/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
  const MAX_SIDE = 1800;
  try{
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    if(scale === 1 && file.size < 1.5 * 1024 * 1024){ if(bmp.close) bmp.close(); return file; }
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
    if(bmp.close) bmp.close();
    const outType = file.type === "image/png" ? "image/webp" : file.type; // webp keeps transparency
    const blob = await new Promise(resolve => canvas.toBlob(resolve, outType, 0.88));
    if(!blob || blob.size >= file.size) return file;
    const ext = blob.type === "image/webp" ? ".webp" : (blob.type === "image/png" ? ".png" : ".jpg");
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ext, { type: blob.type });
  }catch(e){
    return file;
  }
}

async function uploadHomeImages(fileList){
  const urls = [];
  const files = Array.from(fileList || []);
  if(!files.length) return urls;
  showAdminToast(`Uploading ${files.length} image${files.length === 1 ? "" : "s"}…`);
  for(const original of files){
    try{
      if(!original.type.startsWith("image/")) throw new Error("only pictures can go here");
      const file = await prepareHomeImage(original);
      const form = new FormData();
      form.append("image", file);
      const res = await fetch("/api/admin/upload", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if(!res.ok) throw new Error(data.error || "upload failed");
      urls.push(data.url);
    }catch(e){
      showAdminToast(`"${hx(original.name)}" failed: ${hx(e.message || "upload error")}`);
    }
  }
  return urls;
}

function moveItem(list, i, delta){
  const j = i + delta;
  if(j < 0 || j >= list.length) return false;
  [list[i], list[j]] = [list[j], list[i]];
  return true;
}

async function openDraftPreview(){
  const w = window.open("about:blank", "_blank");
  clearTimeout(saveTimer);
  await saveDraft();
  if(w){ w.location.href = "index.html?preview=1"; }
  else{ showAdminToast("Your browser blocked the preview window — allow pop-ups for this site and try again."); }
}

function wireHomeEditor(){
  const root = document.getElementById("homeEditor");
  if(!root) return;
  document.getElementById("previewDraftBtn").addEventListener("click", openDraftPreview);

  root.addEventListener("input", e => {
    const t = e.target.closest("[data-hpath]");
    if(!t) return;
    setPath(ensureHomeShape(), t.dataset.hpath, t.type === "checkbox" ? t.checked : t.value);
    scheduleSave();
  });

  root.addEventListener("click", e => {
    const btn = e.target.closest("[data-haction]");
    if(!btn || btn.disabled) return;
    const h = ensureHomeShape();
    const i = Number(btn.dataset.i);
    let changed = true;
    switch(btn.dataset.haction){
      case "hero-card-remove": h.hero.cards.splice(i, 1); break;
      case "flyer-remove": h.flyers.items.splice(i, 1); break;
      case "flyer-move-left": changed = moveItem(h.flyers.items, i, -1); break;
      case "flyer-move-right": changed = moveItem(h.flyers.items, i, +1); break;
      case "section-move-up": changed = moveItem(h.sections, i, -1); break;
      case "section-move-down": changed = moveItem(h.sections, i, +1); break;
      case "section-image-remove": h.sections[i].imageUrl = ""; break;
      case "section-remove":
        if(!confirm("Delete this section? You can still use \"Discard draft changes\" before publishing.")) return;
        h.sections.splice(i, 1);
        break;
      case "section-add":
        h.sections.push({ id: rid("sec"), visible: true, kicker: "", heading: "New section", body: "", imageUrl: "", imageSide: "right", button1Text: "", button1Url: "", button2Text: "", button2Url: "" });
        break;
      default: changed = false;
    }
    if(changed){ renderHomeEditor(); scheduleSave(); }
  });

  root.addEventListener("change", async e => {
    const input = e.target.closest("[data-hupload]");
    if(!input || !input.files || !input.files.length) return;
    const h = ensureHomeShape();
    const kind = input.dataset.hupload;
    const index = Number(input.dataset.i);
    const files = Array.from(input.files);
    input.value = "";
    const urls = await uploadHomeImages(files);
    if(!urls.length) return;
    if(kind === "hero-card"){
      urls.slice(0, HOME_MAX_HERO_CARDS - h.hero.cards.length).forEach(url => h.hero.cards.push({ url, tag: "" }));
    }else if(kind === "flyers"){
      urls.slice(0, HOME_MAX_FLYERS - h.flyers.items.length).forEach(url => h.flyers.items.push({ id: rid("flyer"), url, caption: "", linkUrl: "", until: "" }));
    }else if(kind === "section-image" && h.sections[index]){
      h.sections[index].imageUrl = urls[0];
    }
    renderHomeEditor();
    scheduleSave();
    showAdminToast("Picture added. Publish to make it live.");
  });
}
