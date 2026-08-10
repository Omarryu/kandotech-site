// ==========================================================================
// KANDOTECH — backend server
// Serves the storefront, the /admin console, the public catalog API,
// the password-protected admin API (draft/publish + image upload), a
// server-sent-events stream for real-time frontend updates, and the
// Stripe Checkout session endpoint.
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
  res.json(readJSON(LIVE_PATH));
});

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
    draft: readJSON(DRAFT_PATH),
    live: readJSON(LIVE_PATH),
  });
});

app.put("/api/admin/catalog", requireAdmin, (req, res) => {
  const { products, categories, services, business } = req.body || {};
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
  const live = readJSON(LIVE_PATH);
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
      const { items, customer } = req.body;
      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: "Cart is empty" });
      }
      const site = process.env.SITE_URL || `${req.protocol}://${req.get("host")}`;
      const line_items = items.map((item) => ({
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
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });
} else {
  app.post("/api/create-checkout-session", (req, res) => {
    res.status(500).json({ error: "STRIPE_SECRET_KEY is not set on the server yet." });
  });
}

// --------------------------------------------------------------------------
// PayPal Orders v2 API (create + capture). PayPal does not reliably support
// checkout in JMD across account types, so by default this charges in USD,
// converting the JMD cart total using PAYPAL_JMD_USD_RATE from .env. Update
// that rate periodically, or ask PayPal directly whether your specific
// business account can settle in JMD if you'd rather charge JMD outright.
// --------------------------------------------------------------------------
const PAYPAL_ENABLED = !!(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
const PAYPAL_API_BASE =
  process.env.PAYPAL_ENV === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
const PAYPAL_JMD_USD_RATE = Number(process.env.PAYPAL_JMD_USD_RATE || 0.0064); // update this periodically

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
  if (!res.ok) throw new Error("Could not authenticate with PayPal");
  const data = await res.json();
  return data.access_token;
}

if (PAYPAL_ENABLED) {
  app.post("/api/paypal/create-order", async (req, res) => {
    try {
      const { items } = req.body;
      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: "Cart is empty" });
      }
      const jmdTotal = items.reduce((sum, i) => sum + i.price * i.qty, 0);
      const usdTotal = Math.max(1, jmdTotal * PAYPAL_JMD_USD_RATE).toFixed(2);

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
              amount: { currency_code: "USD", value: usdTotal },
              description: `Kandotech order (${items.length} item${items.length === 1 ? "" : "s"}, converted from JMD)`,
            },
          ],
        }),
      });
      const order = await orderRes.json();
      if (!orderRes.ok) throw new Error(order.message || "PayPal order creation failed");
      res.json({ id: order.id });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/paypal/capture-order/:orderId", async (req, res) => {
    try {
      const accessToken = await getPaypalAccessToken();
      const captureRes = await fetch(
        `${PAYPAL_API_BASE}/v2/checkout/orders/${req.params.orderId}/capture`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );
      const capture = await captureRes.json();
      if (!captureRes.ok) throw new Error(capture.message || "PayPal capture failed");
      res.json({ status: capture.status, id: capture.id });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
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
const ORDERS_PATH = path.join(DATA_DIR, "orders.json");
try {
  if (!fs.existsSync(ORDERS_PATH)) writeJSON(ORDERS_PATH, []);
} catch (err) {
  console.error("Could not initialize orders.json (Lynk orders will fail until this is fixed):", err.message);
}

app.post("/api/orders/lynk", (req, res) => {
  if (!LYNK_ENABLED) return res.status(500).json({ error: "Lynk is not configured on the server yet." });
  const { items, customer } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "Cart is empty" });
  }
  const total = items.reduce((sum, i) => sum + i.price * i.qty, 0);
  const orders = readJSON(ORDERS_PATH);
  const order = {
    id: "LYNK-" + Date.now().toString(36).toUpperCase(),
    createdAt: new Date().toISOString(),
    status: "pending_lynk_confirmation",
    total,
    items,
    customer,
  };
  orders.unshift(order);
  writeJSON(ORDERS_PATH, orders);
  res.json({ ok: true, orderId: order.id, total });
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
