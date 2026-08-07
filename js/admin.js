/* ==========================================================================
   KANDOTECH — admin console
   ========================================================================== */

let draft = { products: [], categories: [], services: [], business: {} };
let liveSnapshot = { products: [], categories: [], services: [], business: {} };
let saveTimer = null;
let searchTerm = "";

document.addEventListener("DOMContentLoaded", init);

async function init(){
  wireLoginForm();
  wireLogout();
  wireTabs();
  wirePublishBar();
  wireAddButtons();
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
    if(!res.ok) throw new Error("save failed");
    setSaveStatus("saved");
  }catch(e){
    setSaveStatus("error");
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
  el.innerHTML = items.map(p => productRow(p)).join("");
  wireProductRowEvents(el);
}

function productRow(p){
  const catOptions = draft.categories.map(c =>
    `<option value="${c.id}" ${c.id === p.cat ? "selected" : ""}>${c.label}</option>`
  ).join("");
  const thumbContent = p.img
    ? `<img src="${p.img}" alt="">`
    : (ICONS[p.icon] || ICONS.port);
  const stockClass = p.stock === 0 ? "zero" : "";
  const uid = safeId(p.sku);
  return `
  <div class="product-row" data-sku="${p.sku}">
    <div class="thumb" data-upload="${p.sku}">
      ${thumbContent}
      <label class="sr-only" for="file-${uid}">Upload photo for ${escapeAttr(p.name)}</label>
      <input type="file" id="file-${uid}" accept="image/*" data-file-for="${p.sku}">
    </div>
    <div class="field-stack">
      <label for="name-${uid}">Name</label>
      <input type="text" id="name-${uid}" data-field="name" data-sku="${p.sku}" value="${escapeAttr(p.name)}">
      <label class="sr-only" for="desc-${uid}">Description</label>
      <textarea id="desc-${uid}" data-field="desc" data-sku="${p.sku}" rows="2">${p.desc}</textarea>
      <span class="sku-tag">${p.sku}</span>
    </div>
    <div class="field-stack">
      <label for="cat-${uid}">Category</label>
      <select id="cat-${uid}" data-field="cat" data-sku="${p.sku}">${catOptions}</select>
      <span class="field-note">Stock <span class="stock-pill ${stockClass}">${p.stock} on hand</span></span>
    </div>
    <div class="field-stack">
      <label for="price-${uid}">Price (JMD)</label>
      <input type="number" id="price-${uid}" min="0" step="1" data-field="price" data-sku="${p.sku}" value="${p.price}">
    </div>
    <div class="field-stack">
      <label for="stock-${uid}">Stock qty</label>
      <input type="number" id="stock-${uid}" min="0" step="1" data-field="stock" data-sku="${p.sku}" value="${p.stock}">
    </div>
    <div class="row-actions">
      <button class="icon-danger" data-delete="${p.sku}" title="Delete product" aria-label="Delete product">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0l-1 14a2 2 0 01-2 2H7a2 2 0 01-2-2L4 6" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
    </div>
  </div>`;
}

function safeId(str){
  return String(str).replace(/[^a-zA-Z0-9_-]/g, "-");
}

function wireProductRowEvents(container){
  container.querySelectorAll("[data-field]").forEach(input => {
    input.addEventListener("input", () => {
      const sku = input.dataset.sku;
      const field = input.dataset.field;
      const product = draft.products.find(p => p.sku === sku);
      if(!product) return;
      let value = input.value;
      if(field === "price" || field === "stock") value = Math.max(0, Number(value) || 0);
      product[field] = value;
      if(field === "stock"){
        const pill = container.querySelector(`[data-sku="${sku}"] .stock-pill`);
        if(pill){
          pill.textContent = `${value} on hand`;
          pill.classList.toggle("zero", Number(value) === 0);
        }
      }
      scheduleSave();
    });
  });

  container.querySelectorAll("[data-delete]").forEach(btn => {
    btn.addEventListener("click", () => {
      const sku = btn.dataset.delete;
      const product = draft.products.find(p => p.sku === sku);
      if(!confirm(`Delete "${product ? product.name : sku}"? This can't be undone.`)) return;
      draft.products = draft.products.filter(p => p.sku !== sku);
      renderProducts();
      scheduleSave();
    });
  });

  container.querySelectorAll(".thumb").forEach(thumb => {
    thumb.addEventListener("click", () => {
      thumb.querySelector("input[type=file]").click();
    });
  });

  container.querySelectorAll("[data-file-for]").forEach(fileInput => {
    fileInput.addEventListener("change", async () => {
      const file = fileInput.files[0];
      if(!file) return;
      const sku = fileInput.dataset.fileFor;
      const thumb = fileInput.closest(".thumb");
      thumb.style.opacity = ".5";
      try{
        const form = new FormData();
        form.append("image", file);
        const res = await fetch("/api/admin/upload", { method: "POST", body: form });
        const data = await res.json();
        if(!res.ok) throw new Error(data.error || "Upload failed");
        const product = draft.products.find(p => p.sku === sku);
        product.img = data.url;
        renderProducts();
        scheduleSave();
        showAdminToast("Image uploaded. Publish to make it live.");
      }catch(e){
        showAdminToast(e.message || "Image upload failed.");
        thumb.style.opacity = "1";
      }
    });
  });
}

function wireAddButtons(){
  document.getElementById("addProductBtn").addEventListener("click", () => {
    const sku = "NEW-" + Date.now().toString(36).toUpperCase();
    draft.products.unshift({
      sku, name: "New product", cat: (draft.categories[0] || {}).id || "", price: 0, stock: 0,
      desc: "", icon: "port",
    });
    searchTerm = "";
    document.getElementById("adminSearch").value = "";
    renderProducts();
    scheduleSave();
    const row = document.querySelector(`.product-row[data-sku="${sku}"] input[data-field="name"]`);
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
