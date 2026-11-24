// ==========================================================================
// KANDOTECH — backend server
// Serves the storefront, the /admin console, the public catalog API,
// the password-protected admin API (draft/publish + image upload), a
// server-sent-events stream for real-time frontend updates, and the
// PayPal / Lynk / Stripe checkout endpoints (prices always come from the
// server's catalog), a saved-orders page at /admin/orders, automatic stock
// updates, and email receipts / new-order alerts.
//
//   cd server/backend
//   npm install
//   cp .env.example .env      (then edit ADMIN_PASSWORD and STRIPE_SECRET_KEY)
//   npm start
//
// Visit http://localhost:4242 for the storefront and
// http://localhost:4242/admin for the admin console.
// ==========================================================================

require("dotenv").config();
const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const multer = require("multer");

// --------------------------------------------------------------------------
// Never fail silently. Shared-hosting Node runners (like cPanel's Passenger-
// based Node.js Selector) often show a blank page with no useful message if
// the process crashes at startup — these two handlers make sure the real
// cause always lands in the app's error log instead of just vanishing.
// --------------------------------------------------------------------------
process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION — the server hit an unexpected error:", err);
});
process.on("unhandledRejection", (err) => {
  console.error("UNHANDLED PROMISE REJECTION:", err);
});

const app = express();
app.set("trust proxy", 1); // correct req.protocol/host behind a reverse proxy (cPanel, Render, etc.)

const ROOT = path.join(__dirname, "..", ".."); // the site root (index.html, css/, js/, assets/)

// --------------------------------------------------------------------------
// Where catalog data and uploaded images actually live.
//
// By default this is a folder inside the app itself — fine for local dev,
// and fine for hosts with a genuinely persistent filesystem (a VPS, or
// Namecheap-style shared hosting). It is NOT fine on hosts that rebuild the
// container from scratch on every deploy/restart (Render, Railway, most
// "PaaS" free tiers) — on those, set the DATA_DIR environment variable to
// point at an attached persistent disk (e.g. DATA_DIR=/var/data on Render),
// so admin edits and uploaded photos survive redeploys and restarts.
// See README.md → "Making your data actually persist" for setup steps.
// --------------------------------------------------------------------------
const SEED_DIR = path.join(__dirname, "seed");
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const LIVE_PATH = path.join(DATA_DIR, "live.json");
const DRAFT_PATH = path.join(DATA_DIR, "draft.json");
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
const INDEX_HTML = path.join(ROOT, "index.html");

console.log("=== Kandotech server starting ===");
console.log("Node version:", process.version);
console.log("__dirname:", __dirname);
console.log("Computed site ROOT:", ROOT);
console.log("Data directory:", DATA_DIR, process.env.DATA_DIR ? "(from DATA_DIR env var)" : "(default, not persistent on Render/Railway)");
console.log("index.html found at ROOT?", fs.existsSync(INDEX_HTML));

// First boot on a fresh/empty persistent disk: seed it from the committed
// defaults so the site isn't blank the first time this runs.
try {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  if (!fs.existsSync(LIVE_PATH)) {
    fs.copyFileSync(path.join(SEED_DIR, "live.json"), LIVE_PATH);
    console.log("Seeded live.json from defaults (first boot on this data directory).");
  }
  if (!fs.existsSync(DRAFT_PATH)) {
    fs.copyFileSync(LIVE_PATH, DRAFT_PATH);
    console.log("Seeded draft.json from live.json.");
  }
} catch (err) {
  console.error("Could not set up the data directory — check DATA_DIR permissions:", err.message);
}
console.log("live.json found?", fs.existsSync(LIVE_PATH));

const PORT = process.env.PORT || 4242;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "changeme";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

app.use(express.json({ limit: "2mb" }));
app.use(express.static(ROOT));
app.use("/assets/img/uploads", express.static(UPLOAD_DIR));

// --------------------------------------------------------------------------
// Diagnostics — open this URL in a browser to see exactly what the server
// sees on disk, instead of guessing from a blank page. Not authenticated on
// purpose (it reveals no secrets, only booleans/paths), but feel free to
// delete this route once your deployment is confirmed working.
// --------------------------------------------------------------------------
app.get("/__diagnostics", (req, res) => {
  let liveProductCount = null;
  try {
    liveProductCount = JSON.parse(fs.readFileSync(LIVE_PATH, "utf8")).products.length;
  } catch (err) {
    liveProductCount = `error reading live.json: ${err.message}`;
  }
  res.json({
    nodeVersion: process.version,
    dirname: __dirname,
    computedRoot: ROOT,
    dataDir: DATA_DIR,
    dataDirIsPersistent: !!process.env.DATA_DIR,
    indexHtmlExists: fs.existsSync(INDEX_HTML),
    cssExists: fs.existsSync(path.join(ROOT, "css", "style.css")),
    jsExists: fs.existsSync(path.join(ROOT, "js", "data.js")),
    liveJsonExists: fs.existsSync(LIVE_PATH),
    draftJsonExists: fs.existsSync(DRAFT_PATH),
    liveProductCount,
    uploadDirWritable: fs.existsSync(UPLOAD_DIR),
    envConfigured: {
      ADMIN_PASSWORD: ADMIN_PASSWORD !== "changeme",
      STRIPE_SECRET_KEY: !!process.env.STRIPE_SECRET_KEY,
      PAYPAL_CLIENT_ID: !!process.env.PAYPAL_CLIENT_ID,
      emailEnabled: MAIL_ENABLED,
      paypalMode: process.env.PAYPAL_CLIENT_ID ? (process.env.PAYPAL_ENV === "live" ? "live" : "sandbox") : "off",
      LYNK_ID: !!process.env.LYNK_ID,
    },
  });
});

// --------------------------------------------------------------------------
// tiny in-memory session store (fine for a single-admin small-business tool)
// --------------------------------------------------------------------------
const sessions = new Map(); // token -> expiry timestamp

function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  header.split(";").forEach((pair) => {
    const idx = pair.indexOf("=");
    if (idx === -1) return;
    out[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
  });
  return out;
}

function requireAdmin(req, res, next) {
  const token = parseCookies(req).kandotech_admin;
  const expiry = token && sessions.get(token);
  if (!expiry || expiry < Date.now()) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  sessions.set(token, Date.now() + SESSION_TTL_MS); // sliding expiry
  next();
}

// --------------------------------------------------------------------------
// data helpers
// --------------------------------------------------------------------------
function readJSON(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}
function writeJSON(p, data) {
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

// --------------------------------------------------------------------------
// server-sent events — notifies open browser tabs when the site is published
// --------------------------------------------------------------------------
let sseClients = [];

app.get("/api/events", (req, res) => {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.flushHeaders();
  res.write("retry: 3000\n\n");
  sseClients.push(res);
  req.on("close", () => {
    sseClients = sseClients.filter((c) => c !== res);
  });
});

function broadcastUpdate() {
  sseClients.forEach((res) => res.write(`event: update\ndata: ${Date.now()}\n\n`));
}

// --------------------------------------------------------------------------
// public API — the storefront reads from here
// --------------------------------------------------------------------------
app.get("/api/catalog", (req, res) => {
  // ?draft=1 lets a logged-in admin preview unpublished changes on the real site.
  const wantDraft = req.query.draft === "1" && isAdminSession(req);
  res.set("Cache-Control", "no-store");
  const body = withHomeDefaults(readJSON(wantDraft ? DRAFT_PATH : LIVE_PATH));
  if (wantDraft) body.preview = true; // lets the page know it is showing unpublished content
  res.json(body);
});

// --------------------------------------------------------------------------
// Editable home page content (announcement bar, hero text, flyers, sections).
// Stored under `home` in draft.json / live.json like everything else, so it
// follows the same draft -> publish flow. Missing pieces fall back to the
// original wording, so an existing site looks identical until you edit it.
// --------------------------------------------------------------------------
const DEFAULT_HOME = {
  announcement: { enabled: false, text: "", linkText: "", linkUrl: "", until: "" },
  hero: {
    eyebrow: "Old Harbour · St. Catherine · Jamaica",
    headline: "Every port, cable and *machine* your office actually runs on.",
    lead: "Kandotech stocks the parts IT techs reach for daily — adapters, patch cable, SFPs, power cords, drives, and refurbished desktops — plus the on-site services to install and support them.",
    primaryText: "Browse the catalog",
    primaryUrl: "catalog.html",
    secondaryText: "See our services",
    secondaryUrl: "services.html",
    cards: [],
  },
  flyers: { title: "Flyers & promotions", intro: "", items: [] },
  sections: [
    {
      id: "why-kandotech",
      visible: true,
      kicker: "Why Kandotech",
      heading: "Tested before it's listed, stocked for the job in front of you.",
      body: "Every pre-owned drive, adapter, and charger is checked working before it goes on the shelf. Based in Old Harbour, we support single offices and multi-location rollouts across Jamaica.",
      imageUrl: "",
      imageSide: "right",
      button1Text: "More about us",
      button1Url: "about.html",
      button2Text: "Get in touch",
      button2Url: "contact.html",
    },
  ],
};

function homeStr(obj, key, fallback, max) {
  return obj && typeof obj[key] === "string" ? obj[key].slice(0, max) : fallback;
}
// Links: http(s), mailto, tel, or a plain relative/site path. Anything else
// (javascript:, data:, etc.) is dropped.
function homeLink(v) {
  v = String(v == null ? "" : v).trim().slice(0, 500);
  if (!v || v.startsWith("//")) return "";
  const scheme = v.match(/^([a-z][a-z0-9+.-]*):/i);
  if (scheme) return ["http", "https", "mailto", "tel"].includes(scheme[1].toLowerCase()) ? v : "";
  return v;
}
// Images: only files uploaded through the console (assets/...) or https links.
function homeImage(v) {
  v = String(v == null ? "" : v).trim().slice(0, 500);
  if (/^\/?assets\/[\w\-./%]+$/i.test(v) && !v.includes("..")) return v;
  if (/^https:\/\/[^\s"'<>]+$/i.test(v)) return v;
  return "";
}
function homeDate(v) {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "";
}
function homeId(v, fallbackPrefix) {
  const cleaned = String(v || "").replace(/[^\w-]/g, "").slice(0, 40);
  return cleaned || `${fallbackPrefix}-${crypto.randomBytes(3).toString("hex")}`;
}

function sanitizeHome(h) {
  h = h && typeof h === "object" ? h : {};
  const D = DEFAULT_HOME;
  const a = h.announcement || {};
  const hero = h.hero || {};
  const fl = h.flyers || {};

  const cards = (Array.isArray(hero.cards) ? hero.cards : [])
    .map((c) => ({ url: homeImage(c && c.url), tag: homeStr(c, "tag", "", 80) }))
    .filter((c) => c.url)
    .slice(0, 3);

  const items = (Array.isArray(fl.items) ? fl.items : [])
    .map((i) => ({
      id: homeId(i && i.id, "flyer"),
      url: homeImage(i && i.url),
      caption: homeStr(i, "caption", "", 140),
      linkUrl: homeLink(i && i.linkUrl),
      until: homeDate(i && i.until),
    }))
    .filter((i) => i.url)
    .slice(0, 24);

  const rawSections = Array.isArray(h.sections) ? h.sections : D.sections;
  const sections = rawSections.slice(0, 30).map((s) => ({
    id: homeId(s && s.id, "sec"),
    visible: !(s && s.visible === false),
    kicker: homeStr(s, "kicker", "", 60),
    heading: homeStr(s, "heading", "", 160),
    body: homeStr(s, "body", "", 5000),
    imageUrl: homeImage(s && s.imageUrl),
    imageSide: s && s.imageSide === "left" ? "left" : "right",
    button1Text: homeStr(s, "button1Text", "", 40),
    button1Url: homeLink(s && s.button1Url),
    button2Text: homeStr(s, "button2Text", "", 40),
    button2Url: homeLink(s && s.button2Url),
  }));

  return {
    announcement: {
      enabled: !!a.enabled,
      text: homeStr(a, "text", "", 300),
      linkText: homeStr(a, "linkText", "", 60),
      linkUrl: homeLink(a.linkUrl),
      until: homeDate(a.until),
    },
    hero: {
      eyebrow: homeStr(hero, "eyebrow", D.hero.eyebrow, 120),
      headline: homeStr(hero, "headline", D.hero.headline, 200),
      lead: homeStr(hero, "lead", D.hero.lead, 600),
      primaryText: homeStr(hero, "primaryText", D.hero.primaryText, 40),
      primaryUrl: homeLink(typeof hero.primaryUrl === "string" ? hero.primaryUrl : D.hero.primaryUrl),
      secondaryText: homeStr(hero, "secondaryText", D.hero.secondaryText, 40),
      secondaryUrl: homeLink(typeof hero.secondaryUrl === "string" ? hero.secondaryUrl : D.hero.secondaryUrl),
      cards,
    },
    flyers: {
      title: homeStr(fl, "title", D.flyers.title, 80),
      intro: homeStr(fl, "intro", "", 300),
      items,
    },
    sections,
  };
}

// Deterministic shape: both draft and live always come out in the same key
// order, so the console's "unpublished changes" check stays accurate.
function withHomeDefaults(cat) {
  cat = cat || {};
  return {
    products: cat.products || [],
    categories: cat.categories || [],
    services: cat.services || [],
    business: cat.business || {},
    home: sanitizeHome(cat.home),
  };
}
function isAdminSession(req) {
  const token = parseCookies(req).kandotech_admin;
  const expiry = token && sessions.get(token);
  return !!(expiry && expiry >= Date.now());
}

// --------------------------------------------------------------------------
// admin auth
// --------------------------------------------------------------------------
app.post("/api/admin/login", (req, res) => {
  const { password } = req.body || {};
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Incorrect password" });
  }
  const token = crypto.randomBytes(24).toString("hex");
  sessions.set(token, Date.now() + SESSION_TTL_MS);
  res.setHeader(
    "Set-Cookie",
    `kandotech_admin=${token}; HttpOnly; Path=/; Max-Age=${SESSION_TTL_MS / 1000}; SameSite=Lax`
  );
  res.json({ ok: true });
});

app.post("/api/admin/logout", (req, res) => {
  const token = parseCookies(req).kandotech_admin;
  if (token) sessions.delete(token);
  res.setHeader("Set-Cookie", "kandotech_admin=; HttpOnly; Path=/; Max-Age=0");
  res.json({ ok: true });
});

app.get("/api/admin/check", requireAdmin, (req, res) => res.json({ ok: true }));

// --------------------------------------------------------------------------
// admin catalog (draft) — the console reads/writes here, never touching live
// --------------------------------------------------------------------------
app.get("/api/admin/catalog", requireAdmin, (req, res) => {
  res.json({
    draft: withHomeDefaults(readJSON(DRAFT_PATH)),
    live: withHomeDefaults(readJSON(LIVE_PATH)),
  });
});

app.put("/api/admin/catalog", requireAdmin, (req, res) => {
  const { products, categories, services, business, home } = req.body || {};
  if (!Array.isArray(products)) {
    return res.status(400).json({ error: "products must be an array" });
  }
  const skusSeen = new Set();
  for (const p of products) {
    const sku = (p.sku || "").trim().toLowerCase();
    if (!sku) return res.status(400).json({ error: "Every product needs a non-empty SKU." });
    if (skusSeen.has(sku)) {
      return res.status(400).json({ error: `Duplicate SKU "${p.sku}" — SKUs must be unique.` });
    }
    skusSeen.add(sku);
  }
  writeJSON(DRAFT_PATH, {
    products,
    categories: categories || [],
    services: services || [],
    business: business || {},
    // An older admin tab that doesn't know about `home` must not wipe it.
    home: sanitizeHome(home === undefined ? readJSON(DRAFT_PATH).home : home),
  });
  res.json({ ok: true, savedAt: Date.now() });
});

app.post("/api/admin/publish", requireAdmin, (req, res) => {
  const draft = readJSON(DRAFT_PATH);
  writeJSON(LIVE_PATH, draft);
  broadcastUpdate();
  res.json({ ok: true, publishedAt: Date.now() });
});

app.post("/api/admin/discard", requireAdmin, (req, res) => {
  const live = withHomeDefaults(readJSON(LIVE_PATH));
  writeJSON(DRAFT_PATH, live);
  res.json({ ok: true, draft: live });
});

// --------------------------------------------------------------------------
// image upload — used by the admin console's per-product image picker
// --------------------------------------------------------------------------
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || ".jpg";
    const safe = crypto.randomBytes(8).toString("hex");
    cb(null, `${Date.now()}-${safe}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 40 * 1024 * 1024 }, // 40MB — enough for a short product-demo clip
  fileFilter: (req, file, cb) => {
    const ok = /^image\/(png|jpe?g|webp|gif)$/.test(file.mimetype) ||
               /^video\/(mp4|webm|quicktime)$/.test(file.mimetype);
    cb(ok ? null : new Error("Only images (png/jpg/webp/gif) or videos (mp4/webm/mov) are allowed"), ok);
  },
});

app.post("/api/admin/upload", requireAdmin, upload.single("image"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  const relPath = `assets/img/uploads/${req.file.filename}`;
  const type = req.file.mimetype.startsWith("video/") ? "video" : "image";
  res.json({ url: relPath, type });
});

app.use((err, req, res, next) => {
  if (err) return res.status(400).json({ error: err.message });
  next();
});

// --------------------------------------------------------------------------
// Stripe Checkout session creation (unchanged behavior from the standalone
// server/express option, just folded into this single backend)
// --------------------------------------------------------------------------
if (process.env.STRIPE_SECRET_KEY) {
  const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

  app.post("/api/create-checkout-session", async (req, res) => {
    try {
      const { customer } = req.body;
      const { lines } = priceCart(req.body.items);
      const site = process.env.SITE_URL || `${req.protocol}://${req.get("host")}`;
      const line_items = lines.map((item) => ({
        price_data: {
          currency: "jmd",
          product_data: { name: `${item.name} (${item.sku})` },
          unit_amount: Math.round(item.price * 100),
        },
        quantity: item.qty,
      }));
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        line_items,
        customer_email: customer?.email,
        success_url: `${site}/success.html?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${site}/cancel.html`,
        metadata: {
          customer_name: customer?.name || "",
          customer_phone: customer?.phone || "",
          fulfilment: customer?.fulfilment || "",
          address: customer?.address || "",
          notes: customer?.notes || "",
        },
      });
      res.json({ url: session.url });
    } catch (err) {
      sendError(res, err);
    }
  });
} else {
  app.post("/api/create-checkout-session", (req, res) => {
    res.status(500).json({ error: "STRIPE_SECRET_KEY is not set on the server yet." });
  });
}

// --------------------------------------------------------------------------
// Orders: server-side pricing + order records.
//
// The browser's cart only tells us WHICH products (sku) and HOW MANY. Prices
// always come from the published catalog (live.json) on the server, so a
// customer can't edit the cart in their browser to pay less. Every order is
// saved to orders.json on the persistent disk and shows up at /admin/orders.
// --------------------------------------------------------------------------
const ORDERS_PATH = path.join(DATA_DIR, "orders.json");
try {
  if (!fs.existsSync(ORDERS_PATH)) writeJSON(ORDERS_PATH, []);
} catch (err) {
  console.error("Could not initialize orders.json (orders will fail until this is fixed):", err.message);
}

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

// Throws (rather than returning []) if orders.json is unreadable, so a
// corrupt file can never be silently overwritten with an empty list.
function loadOrders() {
  if (!fs.existsSync(ORDERS_PATH)) return [];
  return readJSON(ORDERS_PATH);
}
function saveOrders(orders) {
  const tmp = ORDERS_PATH + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(orders, null, 2));
  fs.renameSync(tmp, ORDERS_PATH); // atomic swap — never leaves a half-written file
}
function newOrderId(prefix) {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}${crypto.randomBytes(2).toString("hex").toUpperCase()}`;
}

function cleanCustomer(c) {
  c = c && typeof c === "object" ? c : {};
  const s = (v, n) => String(v == null ? "" : v).trim().slice(0, n);
  const customer = {
    name: s(c.name, 120),
    email: s(c.email, 160),
    phone: s(c.phone, 40),
    fulfilment: s(c.fulfilment, 20),
    address: s(c.address, 300),
    notes: s(c.notes, 500),
  };
  if (!customer.name || !customer.email || !customer.phone) {
    throw httpError(400, "Please fill in your name, email, and phone.");
  }
  return customer;
}

// Re-prices a cart from the published catalog. Only `sku` and `qty` from the
// browser are used; name and price are looked up here.
function priceCart(items) {
  if (!Array.isArray(items) || items.length === 0) throw httpError(400, "Cart is empty");
  if (items.length > 50) throw httpError(400, "Too many items in the cart.");
  const catalog = readJSON(LIVE_PATH);
  const bySku = new Map((catalog.products || []).map((p) => [String(p.sku).trim().toLowerCase(), p]));

  const wanted = new Map(); // sku -> total qty (merges accidental duplicate lines)
  for (const it of items) {
    const key = String((it && it.sku) || "").trim().toLowerCase();
    const qty = Number(it && it.qty);
    if (!bySku.has(key)) {
      throw httpError(400, "An item in your cart is no longer available. Please refresh the page and check your cart.");
    }
    if (!Number.isInteger(qty) || qty < 1 || qty > 999) throw httpError(400, "Invalid quantity in your cart.");
    wanted.set(key, (wanted.get(key) || 0) + qty);
  }

  const lines = [];
  let total = 0;
  for (const [key, qty] of wanted) {
    const p = bySku.get(key);
    const price = Number(p.price);
    if (!Number.isFinite(price) || price <= 0) {
      throw httpError(400, `"${p.name}" can't be purchased online right now. Please contact us.`);
    }
    if (!(qty <= Number(p.stock))) {
      throw httpError(400, Number(p.stock) > 0
        ? `Only ${p.stock} of "${p.name}" in stock. Please lower the quantity.`
        : `"${p.name}" is out of stock.`);
    }
    lines.push({ sku: p.sku, name: p.name, price, qty, lineTotal: price * qty });
    total += price * qty;
  }
  return { lines, total };
}

function sendError(res, err) {
  if (err && err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: "Something went wrong on our side. Please try again." });
}

// --------------------------------------------------------------------------
// Stock adjustment: when an order becomes paid, its quantities come off the
// stock count in BOTH live.json and draft.json (otherwise the next "Publish"
// from the admin console would put the old stock numbers back). Cancelling
// or refunding a paid order puts the stock back.
// --------------------------------------------------------------------------
function adjustStock(lines, direction) {
  const notes = [];
  for (const p of [LIVE_PATH, DRAFT_PATH]) {
    if (!fs.existsSync(p)) continue;
    const cat = readJSON(p);
    let changed = false;
    for (const l of lines) {
      const key = String(l.sku).trim().toLowerCase();
      const prod = (cat.products || []).find((x) => String(x.sku).trim().toLowerCase() === key);
      if (!prod) continue;
      const before = Number(prod.stock) || 0;
      const after = Math.max(0, before + direction * l.qty);
      if (direction < 0 && before < l.qty && p === LIVE_PATH) {
        notes.push(`"${l.name}": only ${before} in stock but ${l.qty} sold`);
      }
      if (after !== before) {
        prod.stock = after;
        changed = true;
      }
    }
    if (changed) writeJSON(p, cat);
  }
  broadcastUpdate(); // open storefront tabs refresh their stock labels
  return notes;
}

// Call after order.status has been changed (it does not save the order).
function applyStockForStatus(order) {
  try {
    const sold = order.status === "paid" || order.status === "fulfilled";
    const released = order.status === "cancelled" || order.status === "refunded";
    if (sold && !order.stockAdjusted) {
      const notes = adjustStock(order.items, -1);
      order.stockAdjusted = true;
      if (notes.length) order.stockNote = "Oversold — " + notes.join("; ");
      else delete order.stockNote;
    } else if (released && order.stockAdjusted) {
      adjustStock(order.items, +1);
      order.stockAdjusted = false;
      delete order.stockNote;
    }
  } catch (err) {
    console.error("Stock update failed for", order.id, err.message);
    order.stockNote = "Stock was NOT updated automatically — please adjust it in the catalog.";
  }
}

// --------------------------------------------------------------------------
// Email: receipts to customers + new-order alerts to you, over SMTP.
// Needs SMTP_USER and SMTP_PASS on the server (see README / Render env vars).
// Emails never block or break checkout — failures are logged and shown on
// the order in /admin/orders.
// --------------------------------------------------------------------------
let nodemailer = null;
try {
  nodemailer = require("nodemailer");
} catch (e) {
  console.warn("nodemailer is not installed — order emails are disabled.");
}
const SMTP_USER = process.env.SMTP_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || "";
const MAIL_ENABLED = !!(nodemailer && SMTP_USER && SMTP_PASS);
const MAIL_FROM = process.env.MAIL_FROM || `"${process.env.MAIL_FROM_NAME || "Kandotech Computer Systems Services"}" <${SMTP_USER}>`;
const ADMIN_NOTIFY_EMAIL = process.env.ADMIN_NOTIFY_EMAIL || SMTP_USER;
console.log("Email:", MAIL_ENABLED ? `enabled (SMTP ${process.env.SMTP_HOST || "smtp.zoho.com"}, alerts to ${ADMIN_NOTIFY_EMAIL})` : "not configured (set SMTP_USER and SMTP_PASS to send receipts)");

let mailTransport = null;
function getMailTransport() {
  if (!mailTransport) {
    const port = Number(process.env.SMTP_PORT || 465);
    mailTransport = nodemailer.createTransport({
      host: process.env.SMTP_HOST || "smtp.zoho.com",
      port,
      secure: port === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
  }
  return mailTransport;
}
function sendMail(to, msg) {
  return getMailTransport().sendMail({
    from: MAIL_FROM,
    to,
    replyTo: process.env.MAIL_REPLY_TO || undefined,
    subject: msg.subject,
    text: msg.text,
    html: msg.html,
  });
}

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function fmtJMD(n) {
  return "J$" + Number(n).toLocaleString("en-JM", { maximumFractionDigits: 0 });
}
function emailLayout(bizName, heading, bodyHtml) {
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#1a1a2e;line-height:1.5">
    <h2 style="margin:0 0 4px">${esc(heading)}</h2>
    <div style="color:#666;margin-bottom:16px">${esc(bizName)}</div>
    ${bodyHtml}
    <p style="color:#888;font-size:12px;margin-top:24px">This message was sent automatically by ${esc(bizName)}.</p>
  </div>`;
}

function buildOrderEmails(order, event) {
  let biz = {};
  try { biz = readJSON(LIVE_PATH).business || {}; } catch (e) { /* fall back to defaults */ }
  const bizName = biz.name || "Kandotech Computer Systems Services";
  const c = order.customer || {};
  const total = fmtJMD(order.totalJMD);

  const itemsText = order.items.map((i) => `  ${i.qty} x ${i.name} (${i.sku}) - ${fmtJMD(i.lineTotal)}`).join("\n");
  const itemsHtml =
    `<table style="width:100%;border-collapse:collapse;margin:12px 0">` +
    order.items.map((i) =>
      `<tr><td style="padding:6px 0;border-bottom:1px solid #eee">${i.qty} × ${esc(i.name)} <span style="color:#888">(${esc(i.sku)})</span></td>` +
      `<td style="padding:6px 0;border-bottom:1px solid #eee;text-align:right">${esc(fmtJMD(i.lineTotal))}</td></tr>`).join("") +
    `<tr><td style="padding:8px 0;font-weight:bold">Total</td><td style="padding:8px 0;font-weight:bold;text-align:right">${esc(total)}</td></tr></table>`;

  const howText = c.fulfilment === "delivery"
    ? `Delivery to: ${c.address || "(no address given)"}`
    : `Pickup${biz.address ? " at " + biz.address : ""}`;
  const contactText = [biz.phone, biz.email].filter(Boolean).join(" · ");
  const paidText = order.provider === "paypal"
    ? `Paid by PayPal (charged US$${order.paidUSD || order.usdTotal}, converted from ${total})`
    : "Paid via Lynk";

  let customer = null;
  if (event === "paypal_paid" || event === "lynk_paid") {
    customer = {
      subject: `Receipt for your ${bizName} order ${order.id}`,
      text: `Thank you for your order, ${c.name}!\n\nOrder ${order.id}\n${itemsText}\nTotal: ${total}\n${paidText}\n${howText}\n\nWe'll be in touch about ${c.fulfilment === "delivery" ? "delivery" : "pickup"}.${contactText ? "\nQuestions? " + contactText : ""}\n\n${bizName}`,
      html: emailLayout(bizName, "Thank you for your order!",
        `<p>Hi ${esc(c.name)}, we've received your payment.</p>
         <p><strong>Order ${esc(order.id)}</strong></p>${itemsHtml}
         <p>${esc(paidText)}<br>${esc(howText)}</p>
         <p>We'll be in touch about ${c.fulfilment === "delivery" ? "delivery" : "pickup"}.${contactText ? "<br>Questions? " + esc(contactText) : ""}</p>`),
    };
  } else if (event === "lynk_created") {
    const lynkId = process.env.LYNK_ID || "";
    const lynkName = process.env.LYNK_MERCHANT_NAME || bizName;
    customer = {
      subject: `Your ${bizName} order ${order.id} — complete your Lynk payment`,
      text: `Thanks for your order, ${c.name}!\n\nOrder ${order.id}\n${itemsText}\nTotal: ${total}\n\nTo complete it, send ${total} via Lynk to ${lynkId} (${lynkName}) and put ${order.id} in the note.\nWe'll confirm by email once the payment arrives.\n${howText}${contactText ? "\nQuestions? " + contactText : ""}\n\n${bizName}`,
      html: emailLayout(bizName, "Your order is reserved — payment needed",
        `<p>Hi ${esc(c.name)}, thanks for your order.</p>
         <p><strong>Order ${esc(order.id)}</strong></p>${itemsHtml}
         <p><strong>To complete it:</strong> send <strong>${esc(total)}</strong> via Lynk to <strong>${esc(lynkId)}</strong> (${esc(lynkName)}) and put <strong>${esc(order.id)}</strong> in the note.<br>We'll confirm by email once the payment arrives.</p>
         <p>${esc(howText)}${contactText ? "<br>Questions? " + esc(contactText) : ""}</p>`),
    };
  }

  let admin = null;
  if (event === "paypal_paid" || event === "lynk_created") {
    const siteUrl = process.env.SITE_URL ? `${process.env.SITE_URL.replace(/\/$/, "")}/admin/orders` : "";
    const headline = event === "paypal_paid" ? "PAID via PayPal" : "NEW — awaiting Lynk payment";
    admin = {
      subject: `New order ${order.id} — ${total} (${order.provider === "paypal" ? "PayPal" : "Lynk"})`,
      text: `${headline}\n\nOrder ${order.id}\nCustomer: ${c.name}\nEmail: ${c.email}\nPhone: ${c.phone}\n${howText}${c.notes ? "\nNotes: " + c.notes : ""}\n\n${itemsText}\nTotal: ${total}${order.stockNote ? "\n\nSTOCK WARNING: " + order.stockNote : ""}${siteUrl ? "\n\nManage orders: " + siteUrl : ""}`,
      html: emailLayout(bizName, headline,
        `<p><strong>Order ${esc(order.id)}</strong></p>
         <p>${esc(c.name)}<br>${esc(c.email)}<br>${esc(c.phone)}<br>${esc(howText)}${c.notes ? "<br>Notes: " + esc(c.notes) : ""}</p>${itemsHtml}
         ${order.stockNote ? `<p style="background:#fff3cd;padding:8px 12px;border-radius:6px"><strong>Stock warning:</strong> ${esc(order.stockNote)}</p>` : ""}
         ${siteUrl ? `<p><a href="${esc(siteUrl)}">Manage orders</a></p>` : ""}`),
    };
  }
  return { customer, admin };
}

// Fire-and-forget: sends in the background and records the result on the order.
function queueOrderEmail(orderId, event) {
  if (!MAIL_ENABLED) return;
  setImmediate(async () => {
    try {
      const order = loadOrders().find((o) => o.id === orderId);
      if (!order || (order.emails && order.emails[event])) return; // already sent
      const { customer, admin } = buildOrderEmails(order, event);
      if (customer && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((order.customer || {}).email || "")) {
        await sendMail(order.customer.email, customer);
      }
      if (admin && ADMIN_NOTIFY_EMAIL) await sendMail(ADMIN_NOTIFY_EMAIL, admin);
      const orders = loadOrders();
      const o = orders.find((x) => x.id === orderId);
      if (o) {
        o.emails = Object.assign({}, o.emails, { [event]: new Date().toISOString() });
        delete o.emailError;
        saveOrders(orders);
      }
    } catch (err) {
      console.error("Order email failed:", orderId, event, err.message);
      try {
        const orders = loadOrders();
        const o = orders.find((x) => x.id === orderId);
        if (o) { o.emailError = `${event}: ${err.message}`; saveOrders(orders); }
      } catch (e2) { /* nothing more we can do */ }
    }
  });
}

// --------------------------------------------------------------------------
// PayPal Orders v2 API (create + capture). PayPal does not reliably support
// checkout in JMD across account types, so by default this charges in USD,
// converting the JMD cart total using PAYPAL_JMD_USD_RATE. Update that rate
// periodically (Render -> Environment), or ask PayPal directly whether your
// specific business account can settle in JMD.
//
// PAYPAL_ENV must be set to "live" on the server to use real PayPal; any
// other value (or leaving it unset) uses PayPal's SANDBOX (test money only).
// --------------------------------------------------------------------------
const PAYPAL_ENABLED = !!(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
const PAYPAL_LIVE = process.env.PAYPAL_ENV === "live";
const PAYPAL_API_BASE = PAYPAL_LIVE ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
const PAYPAL_JMD_USD_RATE = Number(process.env.PAYPAL_JMD_USD_RATE || 0.0064); // update this periodically
console.log("PayPal:", PAYPAL_ENABLED ? (PAYPAL_LIVE ? "LIVE mode (real money)" : "SANDBOX mode (test money — set PAYPAL_ENV=live to take real payments)") : "not configured");

async function getPaypalAccessToken() {
  const auth = Buffer.from(
    `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`
  ).toString("base64");
  const res = await fetch(`${PAYPAL_API_BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error("Could not authenticate with PayPal (check PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET and that PAYPAL_ENV matches them)");
  const data = await res.json();
  return data.access_token;
}

if (PAYPAL_ENABLED) {
  app.post("/api/paypal/create-order", async (req, res) => {
    try {
      const { lines, total } = priceCart(req.body && req.body.items);
      const customer = cleanCustomer(req.body && req.body.customer);
      const usdTotal = Math.max(1, total * PAYPAL_JMD_USD_RATE).toFixed(2);
      const orderId = newOrderId("PP");

      const accessToken = await getPaypalAccessToken();
      const orderRes = await fetch(`${PAYPAL_API_BASE}/v2/checkout/orders`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          intent: "CAPTURE",
          purchase_units: [
            {
              reference_id: orderId,
              custom_id: orderId,
              description: `Kandotech order ${orderId} (${lines.length} item${lines.length === 1 ? "" : "s"}, converted from JMD)`,
              amount: { currency_code: "USD", value: usdTotal },
            },
          ],
        }),
      });
      const order = await orderRes.json();
      if (!orderRes.ok) throw new Error(order.message || "PayPal order creation failed");

      // Remember what this PayPal order is for, so capture can verify it.
      // Abandoned checkouts older than 3 days are dropped to keep the file tidy.
      const cutoff = Date.now() - 3 * 24 * 60 * 60 * 1000;
      const orders = loadOrders().filter(
        (o) => !(o.status === "pending_paypal" && Date.parse(o.createdAt) < cutoff)
      );
      orders.unshift({
        id: orderId,
        provider: "paypal",
        status: "pending_paypal",
        createdAt: new Date().toISOString(),
        totalJMD: total,
        usdTotal,
        jmdUsdRate: PAYPAL_JMD_USD_RATE,
        paypalOrderId: order.id,
        items: lines,
        customer,
      });
      saveOrders(orders);
      res.json({ id: order.id });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.post("/api/paypal/capture-order/:orderId", async (req, res) => {
    try {
      const paypalOrderId = String(req.params.orderId);

      // Only capture PayPal orders that THIS server created.
      let order = loadOrders().find((o) => o.paypalOrderId === paypalOrderId);
      if (!order) throw httpError(404, "Unknown order.");
      if (order.status === "paid" || order.status === "fulfilled") {
        return res.json({ status: "COMPLETED", id: order.paypalCaptureId, orderId: order.id });
      }

      const accessToken = await getPaypalAccessToken();
      const captureRes = await fetch(
        `${PAYPAL_API_BASE}/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}/capture`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );
      const capture = await captureRes.json();

      if (!captureRes.ok) {
        const already = (capture.details || []).some((d) => d.issue === "ORDER_ALREADY_CAPTURED");
        const existing = loadOrders().find((o) => o.paypalOrderId === paypalOrderId);
        if (already && existing && (existing.status === "paid" || existing.status === "fulfilled")) {
          return res.json({ status: "COMPLETED", id: existing.paypalCaptureId, orderId: existing.id });
        }
        throw new Error(capture.message || "PayPal capture failed");
      }

      const cap = capture.purchase_units?.[0]?.payments?.captures?.[0];
      const paidValue = cap?.amount?.value;
      const paidCurrency = cap?.amount?.currency_code;

      // Re-read orders after the network call, then verify what was actually paid.
      const orders = loadOrders();
      order = orders.find((o) => o.paypalOrderId === paypalOrderId);
      const ok =
        capture.status === "COMPLETED" &&
        cap && cap.status === "COMPLETED" &&
        paidCurrency === "USD" &&
        Number(paidValue) === Number(order.usdTotal);

      order.paypalCaptureId = cap ? cap.id : null;
      order.payerEmail = capture.payer?.email_address || null;
      if (ok) {
        order.status = "paid";
        order.paidAt = new Date().toISOString();
        order.paidUSD = paidValue;
        applyStockForStatus(order);
      } else {
        order.status = "payment_needs_review";
        order.reviewNote =
          `PayPal reported order ${capture.status}, capture ${cap ? cap.status : "none"}, ` +
          `amount ${paidValue} ${paidCurrency}; expected ${order.usdTotal} USD. Check PayPal activity before fulfilling.`;
        console.error("ORDER NEEDS REVIEW:", order.id, order.reviewNote);
      }
      saveOrders(orders);
      if (ok) queueOrderEmail(order.id, "paypal_paid");

      if (!ok) return res.status(402).json({ status: capture.status || "REVIEW", error: "Payment needs review", orderId: order.id });
      res.json({ status: "COMPLETED", id: order.paypalCaptureId, orderId: order.id });
    } catch (err) {
      sendError(res, err);
    }
  });
}

// --------------------------------------------------------------------------
// Lynk — Lynk's developer API is only issued after a LynkBiz merchant
// application is approved (see README), so there's no public self-serve
// endpoint to call yet. Until you have those credentials, this records the
// order as "awaiting confirmation" and shows the customer your Lynk ID to
// pay manually, the way most Jamaican small-business sites currently handle
// it. Swap this out for a real API call once Lynk issues you API access.
// --------------------------------------------------------------------------
const LYNK_ENABLED = !!process.env.LYNK_ID;

app.post("/api/orders/lynk", (req, res) => {
  try {
    if (!LYNK_ENABLED) throw httpError(500, "Lynk is not configured on the server yet.");
    const { lines, total } = priceCart(req.body && req.body.items);
    const customer = cleanCustomer(req.body && req.body.customer);
    const orders = loadOrders();
    const order = {
      id: newOrderId("LYNK"),
      provider: "lynk",
      createdAt: new Date().toISOString(),
      status: "pending_lynk_confirmation",
      totalJMD: total,
      items: lines,
      customer,
    };
    orders.unshift(order);
    saveOrders(orders);
    queueOrderEmail(order.id, "lynk_created");
    res.json({ ok: true, orderId: order.id, total });
  } catch (err) {
    sendError(res, err);
  }
});

// --------------------------------------------------------------------------
// public payment config — the checkout page uses this to decide which
// payment tabs to show, and never needs secret keys itself
// --------------------------------------------------------------------------
app.get("/api/payment-config", (req, res) => {
  res.json({
    stripeEnabled: !!process.env.STRIPE_SECRET_KEY,
    paypalEnabled: PAYPAL_ENABLED,
    paypalClientId: PAYPAL_ENABLED ? process.env.PAYPAL_CLIENT_ID : null,
    lynkEnabled: LYNK_ENABLED,
    lynkId: LYNK_ENABLED ? process.env.LYNK_ID : null,
    lynkName: process.env.LYNK_MERCHANT_NAME || "Kandotech Computer Systems Services",
  });
});

// --------------------------------------------------------------------------
// Orders for the admin: JSON API + a simple page at /admin/orders
// --------------------------------------------------------------------------
const ORDER_STATUSES = ["pending_lynk_confirmation", "paid", "fulfilled", "cancelled", "refunded", "payment_needs_review"];

app.get("/api/admin/orders", requireAdmin, (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    res.json({ orders: loadOrders() });
  } catch (err) {
    sendError(res, err);
  }
});

app.post("/api/admin/orders/:id/status", requireAdmin, (req, res) => {
  try {
    const status = req.body && req.body.status;
    if (!ORDER_STATUSES.includes(status)) throw httpError(400, "Invalid status.");
    const orders = loadOrders();
    const order = orders.find((o) => o.id === req.params.id);
    if (!order) throw httpError(404, "Order not found.");
    const previous = order.status;
    order.status = status;
    order.statusUpdatedAt = new Date().toISOString();
    applyStockForStatus(order);
    saveOrders(orders);
    if (status === "paid" && previous === "pending_lynk_confirmation") queueOrderEmail(order.id, "lynk_paid");
    res.json({ ok: true, order });
  } catch (err) {
    sendError(res, err);
  }
});

app.post("/api/admin/test-email", requireAdmin, async (req, res) => {
  if (!MAIL_ENABLED) return res.status(400).json({ error: "Email isn't configured. Set SMTP_USER and SMTP_PASS on the server." });
  try {
    await sendMail(ADMIN_NOTIFY_EMAIL, {
      subject: "Kandotech test email",
      text: "If you can read this, order emails are working.",
      html: "<p>If you can read this, order emails are working.</p>",
    });
    res.json({ ok: true, to: ADMIN_NOTIFY_EMAIL });
  } catch (err) {
    console.error("Test email failed:", err.message);
    res.status(502).json({ error: err.message });
  }
});

const ORDERS_PAGE_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Orders — Kandotech admin</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; font-family: system-ui, sans-serif; background:#0b0d1a; color:#e8ebf7; }
  header { display:flex; gap:16px; align-items:center; justify-content:space-between; padding:16px 24px; border-bottom:1px solid #252a45; flex-wrap:wrap; }
  header h1 { margin:0; font-size:20px; }
  a { color:#7dd3fc; }
  main { max-width:960px; margin:0 auto; padding:20px 24px 60px; }
  select, button { font:inherit; padding:8px 12px; border-radius:8px; border:1px solid #3a4170; background:#161a30; color:inherit; cursor:pointer; }
  button.primary { background:#7c3aed; border-color:#7c3aed; }
  .order { border:1px solid #252a45; background:#12152a; border-radius:12px; padding:16px; margin:14px 0; }
  .row { display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; align-items:center; }
  .id { font-weight:700; letter-spacing:.3px; }
  .badge { font-size:12px; padding:3px 10px; border-radius:99px; background:#252a45; }
  .badge.paid { background:#14532d; } .badge.fulfilled { background:#1e3a5f; }
  .badge.pending_lynk_confirmation, .badge.payment_needs_review { background:#78350f; }
  .muted { color:#9aa3c7; font-size:14px; }
  table { width:100%; border-collapse:collapse; margin:10px 0; font-size:14px; }
  td { padding:4px 0; border-bottom:1px solid #1d2140; } td:last-child { text-align:right; }
  .note { background:#451a03; border-radius:8px; padding:8px 12px; margin:8px 0; font-size:14px; }
  .actions { display:flex; gap:8px; flex-wrap:wrap; margin-top:10px; }
  .empty { text-align:center; padding:48px 0; }
</style></head><body>
<header><h1>Orders</h1>
  <div class="row" style="gap:10px">
    <select id="filter">
      <option value="todo">To do (new &amp; paid)</option>
      <option value="paid">Paid — to fulfil</option>
      <option value="fulfilled">Fulfilled</option>
      <option value="abandoned">Abandoned PayPal checkouts</option>
      <option value="all">All</option>
    </select>
    <button id="reload">Refresh</button>
    <button id="testmail">Send test email</button>
    <a href="/admin">← Back to catalog</a>
  </div>
</header>
<main id="list"><p class="muted">Loading…</p></main>
<script>
var orders = [];
var listEl = document.getElementById('list');
var filterEl = document.getElementById('filter');

function el(tag, props, kids) {
  var n = document.createElement(tag);
  Object.keys(props || {}).forEach(function (k) {
    if (k === 'text') n.textContent = props[k];
    else if (k === 'class') n.className = props[k];
    else n.setAttribute(k, props[k]);
  });
  (kids || []).forEach(function (c) { if (c) n.appendChild(c); });
  return n;
}
function jmd(n) { return 'J$' + Number(n).toLocaleString('en-JM', { maximumFractionDigits: 0 }); }
function matches(o, f) {
  if (f === 'all') return true;
  if (f === 'todo') return ['pending_lynk_confirmation', 'payment_needs_review', 'paid'].indexOf(o.status) !== -1;
  if (f === 'abandoned') return o.status === 'pending_paypal';
  return o.status === f;
}
function setStatus(id, status) {
  fetch('/api/admin/orders/' + encodeURIComponent(id) + '/status', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: status })
  }).then(function (r) { if (!r.ok) throw new Error('failed'); return load(); })
    .catch(function () { alert('Could not update the order. Are you still logged in?'); });
}
function render() {
  listEl.textContent = '';
  var shown = orders.filter(function (o) { return matches(o, filterEl.value); });
  if (!shown.length) { listEl.appendChild(el('p', { class: 'muted empty', text: 'No orders here yet.' })); return; }
  shown.forEach(function (o) {
    var c = o.customer || {};
    var card = el('div', { class: 'order' });
    card.appendChild(el('div', { class: 'row' }, [
      el('span', { class: 'id', text: o.id }),
      el('span', { class: 'badge ' + o.status, text: o.status.replace(/_/g, ' ') })
    ]));
    card.appendChild(el('div', { class: 'muted', text: new Date(o.createdAt).toLocaleString() + ' · ' + (o.provider === 'paypal' ? 'PayPal' : 'Lynk') }));
    card.appendChild(el('p', { text: [c.name, c.email, c.phone].filter(Boolean).join(' · ') }));
    var how = c.fulfilment === 'delivery' ? 'Delivery' + (c.address ? ': ' + c.address : '') : (c.fulfilment ? 'Pickup' : '');
    if (how) card.appendChild(el('div', { class: 'muted', text: how }));
    if (c.notes) card.appendChild(el('div', { class: 'muted', text: 'Notes: ' + c.notes }));
    if (o.reviewNote) card.appendChild(el('div', { class: 'note', text: o.reviewNote }));
    if (o.stockNote) card.appendChild(el('div', { class: 'note', text: o.stockNote }));
    if (o.emailError) card.appendChild(el('div', { class: 'note', text: 'Email problem — ' + o.emailError }));
    var table = el('table');
    (o.items || []).forEach(function (i) {
      table.appendChild(el('tr', {}, [
        el('td', { text: i.qty + ' × ' + i.name + ' (' + i.sku + ')' }),
        el('td', { text: jmd(i.lineTotal) })
      ]));
    });
    table.appendChild(el('tr', {}, [el('td', { text: 'Total' }), el('td', { text: jmd(o.totalJMD) + (o.paidUSD ? '  (paid US$' + o.paidUSD + ')' : '') })]));
    card.appendChild(table);
    var actions = el('div', { class: 'actions' });
    if (o.status === 'pending_lynk_confirmation') {
      var b = el('button', { class: 'primary', text: 'Confirm Lynk payment received' });
      b.onclick = function () { setStatus(o.id, 'paid'); };
      actions.appendChild(b);
    }
    if (o.status === 'paid') {
      var f = el('button', { class: 'primary', text: 'Mark fulfilled' });
      f.onclick = function () { setStatus(o.id, 'fulfilled'); };
      actions.appendChild(f);
    }
    if (o.status !== 'cancelled' && o.status !== 'refunded' && o.status !== 'pending_paypal') {
      var x = el('button', { text: 'Cancel' });
      x.onclick = function () { if (confirm('Cancel order ' + o.id + '?')) setStatus(o.id, 'cancelled'); };
      actions.appendChild(x);
    }
    if (actions.children.length) card.appendChild(actions);
    listEl.appendChild(card);
  });
}
function load() {
  return fetch('/api/admin/orders').then(function (r) {
    if (r.status === 401) { location.href = '/admin'; return null; }
    return r.json();
  }).then(function (d) { if (d) { orders = d.orders || []; render(); } });
}
filterEl.onchange = render;
document.getElementById('reload').onclick = load;
document.getElementById('testmail').onclick = function () {
  fetch('/api/admin/test-email', { method: 'POST' }).then(function (r) {
    return r.json().then(function (d) { alert(r.ok ? 'Test email sent to ' + d.to : 'Failed: ' + (d.error || r.status)); });
  }).catch(function () { alert('Could not reach the server.'); });
};
load();
</script></body></html>`;

app.get("/admin/orders", (req, res) => {
  const token = parseCookies(req).kandotech_admin;
  const expiry = token && sessions.get(token);
  if (!expiry || expiry < Date.now()) return res.redirect("/admin");
  res.set("Cache-Control", "no-store");
  res.type("html").send(ORDERS_PAGE_HTML);
});

// --------------------------------------------------------------------------
// admin console + SPA fallback
// --------------------------------------------------------------------------
app.get("/admin", (req, res) => res.sendFile(path.join(ROOT, "admin.html")));

// If we ever get here for a GET request, express.static didn't find a
// matching file — most commonly because ROOT is pointed at the wrong
// folder on this specific host. Show something actionable instead of a
// blank page or a bare "Cannot GET /".
app.get("*", (req, res) => {
  res.status(404).send(`
    <body style="font-family:sans-serif; max-width:640px; margin:60px auto; line-height:1.6;">
      <h2>Kandotech server is running, but couldn't find "${req.path}"</h2>
      <p>The server started fine, but it can't find your site's files at the folder it's currently
      looking in: <code>${ROOT}</code></p>
      <p>Visit <a href="/__diagnostics">/__diagnostics</a> for a full breakdown of what the server
      can and can't see on disk — that will show exactly what's missing.</p>
    </body>
  `);
});

app.listen(PORT, () => {
  console.log(`Kandotech server running at http://localhost:${PORT}`);
  console.log(`Admin console at      http://localhost:${PORT}/admin`);
  console.log(`Diagnostics at        http://localhost:${PORT}/__diagnostics`);
  if (ADMIN_PASSWORD === "changeme") {
    console.log("⚠  Set ADMIN_PASSWORD in server/backend/.env before deploying.");
  }
}).on("error", (err) => {
  console.error("SERVER FAILED TO START:", err.message);
});
