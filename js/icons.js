/* ==========================================================================
   KANDOTECH — lightweight icon set (stroke style, matches pin/connector motif)
   ========================================================================== */

const ICONS = {
  port: `<svg class="pico" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="16" width="26" height="16" rx="2"/><path d="M32 20h6l4 4-4 4h-6" stroke-linejoin="round"/><path d="M12 22v0M17 22v0M22 22v0M27 22v0" stroke-width="3" stroke-linecap="round"/></svg>`,
  cable: `<svg class="pico" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 24c4-10 12-10 16 0s12 10 16 0" stroke-linecap="round"/><rect x="4" y="20" width="8" height="8" rx="2"/><rect x="36" y="20" width="8" height="8" rx="2"/></svg>`,
  lan: `<svg class="pico" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2"><rect x="14" y="6" width="20" height="14" rx="2"/><path d="M18 20v6h-6v6M30 20v6h6v6M24 20v12" stroke-linecap="round"/><rect x="12" y="32" width="8" height="8" rx="1.5"/><rect x="28" y="32" width="8" height="8" rx="1.5"/></svg>`,
  sfp: `<svg class="pico" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2"><rect x="8" y="17" width="30" height="14" rx="2"/><path d="M38 21l6 3-6 3" stroke-linejoin="round"/><path d="M13 21v10M18 21v10" stroke-width="2.4" stroke-linecap="round"/></svg>`,
  power: `<svg class="pico" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2"><path d="M24 6v16" stroke-linecap="round"/><path d="M14 14a14 14 0 1 0 20 0" stroke-linecap="round"/></svg>`,
  mouse: `<svg class="pico" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2"><rect x="14" y="8" width="20" height="32" rx="10"/><path d="M24 8v14" /></svg>`,
  pins: `<svg class="pico" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 14v20M16 14v20M22 14v20M28 14v20M34 14v20M38 14v20" stroke-linecap="round"/></svg>`,
  scanner: `<svg class="pico" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 14V8h8M40 14V8h-8M8 34v6h8M40 34v6h-8" stroke-linecap="round" stroke-linejoin="round"/><path d="M14 24h20" stroke-width="3" stroke-linecap="round"/></svg>`,
  computer: `<svg class="pico" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="10" width="36" height="22" rx="2"/><path d="M18 40h12M24 32v8" stroke-linecap="round"/></svg>`,
};

/* ==========================================================================
   Shared product media helpers — products now carry a `media` array
   ([{type:"image"|"video", url}, ...]) instead of a single `img` string,
   so photos and short videos can both be attached per product.
   ========================================================================== */

function primaryMedia(product){
  return (product.media && product.media.length) ? product.media[0] : null;
}

function mediaThumbHTML(product){
  const m = primaryMedia(product);
  if(!m) return ICONS[product.icon] || ICONS.port;
  const alt = String(product.name || "").replace(/"/g, "&quot;");
  if(m.type === "video"){
    return `<video src="${m.url}" muted playsinline preload="metadata"></video>`;
  }
  return `<img src="${m.url}" alt="${alt}" loading="lazy">`;
}
