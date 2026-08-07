// Netlify Function — creates a Stripe Checkout Session for the cart.
// Deploy this repo to Netlify, then set the STRIPE_SECRET_KEY environment
// variable in Site settings → Environment variables.
//
// Endpoint (once deployed): /.netlify/functions/create-checkout-session

const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  try {
    const body = JSON.parse(event.body);
    const { items, customer } = body;

    if (!Array.isArray(items) || items.length === 0) {
      return { statusCode: 400, body: JSON.stringify({ error: "Cart is empty" }) };
    }

    const site = process.env.URL || `https://${event.headers.host}`;

    const line_items = items.map((item) => ({
      price_data: {
        currency: "jmd",
        product_data: { name: `${item.name} (${item.sku})` },
        unit_amount: Math.round(item.price * 100), // Stripe expects the smallest currency unit
      },
      quantity: item.qty,
    }));

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items,
      customer_email: customer && customer.email ? customer.email : undefined,
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

    return {
      statusCode: 200,
      body: JSON.stringify({ url: session.url }),
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
