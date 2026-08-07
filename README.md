# Kandotech Computer Systems Services — website + admin console

A full storefront (catalog, cart, Stripe checkout) backed by a small Node
server that also runs a password-protected **admin console** at `/admin`.
Edit products, categories, and services there — including uploading new
photos — and hit **Publish** to push changes to the live site instantly,
with connected browsers updating in real time (no refresh needed).

## How it fits together

```
index.html, checkout.html, success.html, cancel.html   ← the storefront
admin.html                                              ← the admin console
css/, js/                                               ← shared frontend code
assets/img/                                              product photos
  └── uploads/                                            images you upload from /admin land here

server/backend/            ← run this. It serves everything above, plus:
  server.js                   API + admin auth + image upload + Stripe
  data/
    live.json                  what the public site reads
    draft.json                  what the admin console edits
  package.json, .env.example

server/netlify/, server/vercel/, server/express/
  Legacy checkout-only options from before the admin console existed.
  Keep reading below for why these no longer cover the full feature set.
```

**Why one server now, not serverless functions:** the admin console needs
to read and write JSON files and hold open a live-update connection.
Netlify/Vercel serverless functions run on ephemeral, read-only
filesystems — perfect for the old "just create a Stripe session" job, not
for a real admin backend. So the recommended path now is running
`server/backend` on a normal always-on Node host: **Render, Railway, a
VPS, or your own machine.** The Netlify/Vercel folders are left in place
only if you want checkout without the admin console.

## Run it locally

```bash
cd server/backend
npm install
cp .env.example .env
# edit .env: set ADMIN_PASSWORD, and STRIPE_SECRET_KEY if you want checkout to work
npm start
```

Then open:
- **http://localhost:4242** — the storefront
- **http://localhost:4242/admin** — the admin console (log in with `ADMIN_PASSWORD`)

## Troubleshooting

**Admin login button does nothing / no error appears:**
1. Open your browser's DevTools (F12) → Console tab, then try logging in
   again. Any real error will now show up there — the login button also
   shows "Logging in…" while it works, so if it just resets instantly
   with no message, that's a strong sign of a wrong password.
2. **Most common cause:** the server was already running when you edited
   `.env`. Environment variables are only read once, at startup —
   `Ctrl+C` the server and run `npm start` again after any `.env` change.
3. Double-check there's no extra space or stray quote around the value in
   `.env` — it should look exactly like `ADMIN_PASSWORD=yourpassword`,
   no quotes needed.
4. Hard-refresh the admin page (Ctrl+Shift+R / Cmd+Shift+R) in case your
   browser cached an older version of the page.
5. Make sure you're on the same address the server printed
   (`http://localhost:4242/admin`), not a different port or `file://`.

## Using the admin console

- **Products tab** — every field (name, description, category, price,
  stock) is editable inline and autosaves to the **draft** a moment after
  you stop typing. Click a product's thumbnail to upload a new photo —
  it uploads immediately and updates the draft.
- **Categories / Services tabs** — same idea, for the filter categories
  and the service cards on the quote-request section.
- **Publish changes to live site** — the big button at the top. Nothing
  you edit is visible to customers until you click this. Once you do,
  every open browser tab on the storefront updates automatically within
  a second or two — no one needs to refresh.
- **Discard draft changes** — reverts the draft back to whatever is
  currently live, in case you want to back out of edits you haven't
  published yet.
- Uploaded images that never get published just sit unused in
  `assets/img/uploads/` — harmless, but feel free to delete files there
  you decide not to use.

## Deploying so it stays running

Pick one of these (both have free tiers as of writing — check current
pricing before committing):

**Render**
1. Push this folder to a GitHub repo.
2. New → Web Service → connect the repo → set root directory to
   `server/backend`, build command `npm install`, start command `npm start`.
3. Add environment variables `ADMIN_PASSWORD` and `STRIPE_SECRET_KEY`.
4. Deploy. Your site and `/admin` are both served from the URL Render gives you.

**Railway**
1. Push to GitHub, then "Deploy from repo" in Railway, root directory
   `server/backend`.
2. Add the same environment variables under the Variables tab.
3. Railway builds and starts it automatically (`npm install` + `npm start`).

Either way, **note that uploaded images and catalog edits are stored on
that server's own disk.** Most free/starter tiers on Render and Railway
persist disk across deploys but wipe it if you switch plans or move
regions — check your provider's current disk-persistence guarantees, and
consider a paid persistent volume once you're relying on this for real
inventory.

## Payment setup

The checkout page shows a tab per payment method you've configured — if
none are set up, it tells the customer so instead of failing silently.
Enable any combination of the three below by editing `server/backend/.env`
and restarting the server (`Ctrl+C` then `npm start`).

### Card payments (Stripe)

1. Create a Stripe account at stripe.com.
2. Developers → API keys → copy your **secret key** (starts `sk_`).
3. In `server/backend/.env`, set `STRIPE_SECRET_KEY=sk_...`.
4. Restart the server. The "Card" tab appears automatically.
5. Test with card `4242 4242 4242 4242`, any future expiry, any CVC.
6. When you're ready for real payments, switch to your **live** secret key.

### PayPal

1. Go to developer.paypal.com and log in with your PayPal account.
2. Apps & Credentials → Create App. This gives you a **Client ID** and
   **Client Secret** — while testing, use the Sandbox ones shown by default.
3. In `.env`, set `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` to those
   values, and leave `PAYPAL_ENV=sandbox` for now.
4. Restart the server. The "PayPal" tab appears on checkout.
5. Test by clicking the PayPal button and logging in with a **Sandbox
   buyer account** (developer.paypal.com → Sandbox → Accounts — PayPal
   creates test buyer/seller accounts for you automatically).
6. **Important:** PayPal checkout doesn't reliably support JMD, so PayPal
   orders are charged in USD, converted from your JMD cart total using
   `PAYPAL_JMD_USD_RATE` in `.env`. Update that rate periodically to match
   the real exchange rate. If you want to double-check whether your
   specific PayPal business account can actually settle in JMD, ask
   PayPal support directly — this varies by account type and wasn't
   something I could confirm generically.
7. When ready to go live: create a live PayPal app, swap in those
   credentials, and set `PAYPAL_ENV=live`.

### Lynk

Heads up on how this one works: Lynk's developer API isn't publicly
self-serve like Stripe's or PayPal's. You have to apply for a **LynkBiz**
merchant account and then separately **request API access**, which Lynk
issues directly (with its own documentation) once approved — there's
no public sandbox to build against ahead of time.

So for now, the Lynk option on checkout uses the same **manual-confirmation
pattern** most Jamaican small-business sites use until they have that API
access: the customer sees your Lynk ID, sends the payment themselves in
the Lynk app, and clicks "I've sent payment" — which logs the order as
`pending_lynk_confirmation` in `server/backend/data/orders.json`. You then
confirm the payment arrived (checking the LynkBiz app) and follow up with
the customer to fulfil the order.

To turn this on:
1. Sign up for LynkBiz: lynk.us/lynkbiz-jamdex-form
2. Once approved, set `LYNK_ID` in `.env` to your Lynk ID or registered
   phone number, and `LYNK_MERCHANT_NAME` to your business name.
3. Restart the server. The "Lynk" tab appears on checkout.

**Upgrading to a real-time Lynk integration later:** once Lynk approves
your API access request and sends you their private documentation, the
place to wire it in is `server/backend/server.js` — replace the
`/api/orders/lynk` handler with real calls to whatever endpoints Lynk
gives you (likely a payment-request creation call plus a webhook or
status-check for confirmation). Send me their docs when you have them and
I can help build that integration properly.

### Viewing orders

Right now there's no dedicated admin UI for orders — Stripe and PayPal
payments show up in their own dashboards, and Lynk's manual orders land in
`server/backend/data/orders.json` as plain JSON. If you end up relying on
the Lynk flow a lot, a natural next step is adding an "Orders" tab to
`/admin` that reads that file — ask if you'd like that built out.

## Security notes

- `ADMIN_PASSWORD` is a single shared password, not a full user system —
  fine for one shop owner, not meant for multiple staff accounts with
  different permissions.
- Sessions are stored in memory and reset if the server restarts (you'll
  just need to log in again).
- Always run the admin console over HTTPS in production (Render/Railway
  give you this by default) so the password isn't sent in the clear.
- PayPal and Lynk secrets/IDs live only in `.env` on the server — the
  browser only ever receives the public Client ID, never your PayPal
  secret.

## Editing catalog structure

Products, categories, and services all live in
`server/backend/data/live.json` (and `draft.json` for in-progress edits).
You generally shouldn't need to hand-edit these — use `/admin` — but the
shapes are:

```js
// product
{ sku:"KCSS15", name:"...", cat:"adapters", price:4500, stock:1,
  img:"assets/img/benfei-dp-vga.png", desc:"..." }

// category
{ id:"adapters", label:"Video Adapters", blurb:"Port-to-port converters" }

// service
{ id:"network-audit", name:"...", price:"Custom quote", desc:"..." }
```

## Contact form

The contact form on the homepage still just shows a confirmation message
locally — wire it to [Formspree](https://formspree.io) or add
`data-netlify="true"` if you deploy the storefront half separately via
Netlify. See `js/main.js` → `wireContactForm`.

## Local preview without the backend

You can still open `index.html` directly or serve the folder statically,
but the storefront will show a "Can't reach the backend" message since it
now always loads its catalog from `/api/catalog`. Run
`cd server/backend && npm start` and visit `http://localhost:4242`
instead.
