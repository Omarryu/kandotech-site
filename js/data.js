/* ==========================================================================
   KANDOTECH — catalog data loader
   Replaces the old hardcoded js/products.js. The storefront now always
   reads the live catalog from the backend, and stays in sync in real time
   via a server-sent-events stream that fires whenever the admin console
   publishes changes.
   ========================================================================== */

let PRODUCTS = [];
let CATEGORIES = [];
let SERVICES = [];
let BUSINESS = {};

async function loadCatalog(){
  const res = await fetch("/api/catalog", { cache: "no-store" });
  if(!res.ok) throw new Error("Could not load catalog from server");
  const data = await res.json();
  PRODUCTS = data.products || [];
  CATEGORIES = data.categories || [];
  SERVICES = data.services || [];
  BUSINESS = data.business || {};
}

function connectLiveUpdates(onUpdate){
  try{
    const es = new EventSource("/api/events");
    es.addEventListener("update", async () => {
      try{
        await loadCatalog();
        onUpdate && onUpdate();
      }catch(e){ console.warn("Live update fetch failed", e); }
    });
    es.onerror = () => { /* browser auto-reconnects; nothing to do */ };
  }catch(e){
    console.warn("Live updates unavailable", e);
  }
}
