// Vercel Serverless Function — creates a Stripe Checkout Session for the cart.
// Deploy this repo to Vercel, then set STRIPE_SECRET_KEY as an environment
// variable in Project Settings → Environment Variables.
//
// Endpoint (once deployed): /api/create-checkout-session
// If you use this version, update js/checkout-config.js to point there.

const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const { items, customer } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: "Cart is empty" });
      return;
    }

    const site = `https://${req.headers.host}`;

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

    res.status(200).json({ url: session.url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};
