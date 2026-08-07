// Plain Node/Express backend — use this if you're hosting Kandotech yourself
// (a VPS, Render, Railway, etc.) instead of Netlify or Vercel.
//
//   npm init -y
//   npm install express stripe cors dotenv
//   node server.js
//
// Then set CHECKOUT_CONFIG.createSessionEndpoint in js/checkout-config.js
// to "http://your-domain:4242/create-checkout-session".

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const app = express();
app.use(cors());
app.use(express.json());

const SITE_URL = process.env.SITE_URL || "http://localhost:5500";

app.post("/create-checkout-session", async (req, res) => {
  try {
    const { items, customer } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "Cart is empty" });
    }

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
      success_url: `${SITE_URL}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${SITE_URL}/cancel.html`,
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

const PORT = process.env.PORT || 4242;
app.listen(PORT, () => console.log(`Kandotech payment server running on port ${PORT}`));
