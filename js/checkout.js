/* ==========================================================================
   KANDOTECH — checkout page behavior
   ========================================================================== */

let paymentConfig = { stripeEnabled: false, paypalEnabled: false, lynkEnabled: false };

document.addEventListener("DOMContentLoaded", async () => {
  try{
    await loadCatalog();
  }catch(e){
    document.getElementById("checkoutItems").innerHTML =
      `<div class="empty-state">Can't reach the backend server. Make sure it's running and you're viewing this page at its address.</div>`;
    document.getElementById("payBtn").disabled = true;
    return;
  }
  renderOrder();
  wireFulfilToggle();
  document.getElementById("payBtn").addEventListener("click", startCardPayment);
  document.getElementById("lynkConfirmBtn").addEventListener("click", confirmLynkPayment);

  await loadPaymentConfig();
  wirePayTabs();
});

/* ---------- order summary ---------- */
function renderOrder(){
  const lines = Cart.lines();
  const itemsEl = document.getElementById("checkoutItems");
  const payBtn = document.getElementById("payBtn");

  if(lines.length === 0){
    itemsEl.innerHTML = `<div class="empty-state">Your cart is empty. <a href="catalog.html" style="color:var(--cyan)">Browse the catalog →</a></div>`;
    payBtn.disabled = true;
  }else{
    itemsEl.innerHTML = lines.map(l => `
      <div class="cart-row" style="border:1px solid var(--border); border-radius:12px; padding:14px; background:var(--panel);">
        <div class="cart-thumb">${mediaThumbHTML(l.product)}</div>
        <div class="cart-row-info">
          <div class="name">${l.product.name}</div>
          <div class="price">${formatJMD(l.product.price)} × ${l.qty} = ${formatJMD(l.product.price * l.qty)}</div>
        </div>
      </div>
    `).join("");
    payBtn.disabled = false;
  }

  const subtotal = Cart.subtotal();
  document.getElementById("sumCount").textContent = Cart.count();
  document.getElementById("sumSubtotal").textContent = formatJMD(subtotal);
  document.getElementById("sumTotal").textContent = formatJMD(subtotal);
  document.getElementById("lynkAmount").textContent = formatJMD(subtotal);
}

function wireFulfilToggle(){
  const select = document.getElementById("fulfil");
  const addressField = document.getElementById("addressField");
  const toggle = () => { addressField.style.display = select.value === "delivery" ? "flex" : "none"; };
  select.addEventListener("change", toggle);
  toggle();
}

/* ---------- shared: read + validate customer details ---------- */
function getCustomerDetails(){
  const name = document.getElementById("fullName").value.trim();
  const email = document.getElementById("email").value.trim();
  const phone = document.getElementById("phone").value.trim();
  if(!name || !email || !phone) return null;
  return {
    name, email, phone,
    fulfilment: document.getElementById("fulfil").value,
    address: document.getElementById("address").value.trim(),
    notes: document.getElementById("notes").value.trim(),
  };
}

function cartItemsPayload(){
  return Cart.lines().map(l => ({ sku: l.sku, name: l.product.name, price: l.product.price, qty: l.qty }));
}

function setStatus(text, color){
  const status = document.getElementById("payStatus");
  status.style.color = color || "var(--text-dim)";
  status.textContent = text;
}

/* ---------- payment method tabs ---------- */
async function loadPaymentConfig(){
  try{
    const res = await fetch("/api/payment-config");
    paymentConfig = await res.json();
  }catch(e){
    console.warn("Could not load payment config", e);
  }

  document.querySelectorAll(".pay-tab").forEach(tab => {
    const method = tab.dataset.method;
    const enabled = method === "card" ? paymentConfig.stripeEnabled
      : method === "paypal" ? paymentConfig.paypalEnabled
      : method === "lynk" ? paymentConfig.lynkEnabled
      : false;
    tab.hidden = !enabled;
  });

  const anyEnabled = paymentConfig.stripeEnabled || paymentConfig.paypalEnabled || paymentConfig.lynkEnabled;
  if(!anyEnabled){
    document.getElementById("payTabs").hidden = true;
    setStatus("No payment method is set up yet. See README.md to enable Stripe, PayPal, or Lynk.", "var(--amber)");
    document.querySelectorAll(".pay-panel").forEach(p => p.hidden = true);
    return;
  }

  // activate the first enabled tab
  const firstEnabled = [...document.querySelectorAll(".pay-tab")].find(t => !t.hidden);
  if(firstEnabled) selectPayTab(firstEnabled.dataset.method);

  if(paymentConfig.paypalEnabled) initPaypalButtons();
  if(paymentConfig.lynkEnabled){
    document.getElementById("lynkIdDisplay").textContent = paymentConfig.lynkId;
  }
}

function wirePayTabs(){
  document.querySelectorAll(".pay-tab").forEach(tab => {
    tab.addEventListener("click", () => selectPayTab(tab.dataset.method));
  });
}

function selectPayTab(method){
  document.querySelectorAll(".pay-tab").forEach(t => t.classList.toggle("active", t.dataset.method === method));
  document.querySelectorAll(".pay-panel").forEach(p => p.hidden = p.dataset.methodPanel !== method);
  setStatus("");
}

/* ---------- card (Stripe) ---------- */
async function startCardPayment(){
  const payBtn = document.getElementById("payBtn");
  const customer = getCustomerDetails();
  if(!customer){
    setStatus("Please fill in your name, email, and phone before paying.", "var(--danger)");
    return;
  }
  if(Cart.lines().length === 0) return;

  payBtn.disabled = true;
  payBtn.textContent = "Redirecting to secure payment…";
  setStatus("");

  try{
    const res = await fetch(CHECKOUT_CONFIG.createSessionEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customer, items: cartItemsPayload(), currency: BUSINESS.currency }),
    });
    if(!res.ok) throw new Error("Bad response from server");
    const data = await res.json();
    if(!data.url) throw new Error("No checkout URL returned");
    window.location.href = data.url; // Stripe-hosted checkout page
  }catch(err){
    payBtn.disabled = false;
    payBtn.textContent = "Pay with card";
    setStatus(
      "Payments aren't set up yet. Add your Stripe secret key to server/backend/.env " +
      "(STRIPE_SECRET_KEY=sk_...) and restart the server — see README.md for the full steps.",
      "var(--amber)"
    );
    console.error("Checkout error:", err);
  }
}

/* ---------- PayPal ---------- */
function initPaypalButtons(){
  if(!paymentConfig.paypalClientId) return;
  const script = document.createElement("script");
  script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(paymentConfig.paypalClientId)}&currency=USD`;
  script.onload = renderPaypalButtons;
  script.onerror = () => setStatus("Couldn't load PayPal. Check your connection and try again.", "var(--danger)");
  document.body.appendChild(script);
}

function renderPaypalButtons(){
  if(!window.paypal) return;
  window.paypal.Buttons({
    style: { layout: "vertical", color: "gold", shape: "rect", label: "paypal" },

    createOrder: async () => {
      const customer = getCustomerDetails();
      if(!customer){
        setStatus("Please fill in your name, email, and phone before paying.", "var(--danger)");
        throw new Error("Missing customer details");
      }
      const res = await fetch("/api/paypal/create-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: cartItemsPayload(), customer }),
      });
      const data = await res.json();
      if(!res.ok) throw new Error(data.error || "Could not start PayPal checkout");
      return data.id;
    },

    onApprove: async (data) => {
      setStatus("Confirming payment with PayPal…");
      const res = await fetch(`/api/paypal/capture-order/${data.orderID}`, { method: "POST" });
      const capture = await res.json();
      if(!res.ok || capture.status !== "COMPLETED"){
        setStatus("PayPal couldn't complete the payment. No charge was made — try again.", "var(--danger)");
        return;
      }
      Cart.clear();
      window.location.href = "success.html?provider=paypal";
    },

    onError: (err) => {
      console.error("PayPal error:", err);
      setStatus("Something went wrong with PayPal. No charge was made.", "var(--danger)");
    },
  }).render("#paypalButtonContainer");
}

/* ---------- Lynk (manual confirmation) ---------- */
async function confirmLynkPayment(){
  const btn = document.getElementById("lynkConfirmBtn");
  const customer = getCustomerDetails();
  if(!customer){
    setStatus("Please fill in your name, email, and phone before confirming.", "var(--danger)");
    return;
  }
  if(Cart.lines().length === 0) return;

  btn.disabled = true;
  btn.textContent = "Recording your order…";

  try{
    const res = await fetch("/api/orders/lynk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customer, items: cartItemsPayload() }),
    });
    const data = await res.json();
    if(!res.ok) throw new Error(data.error || "Could not record the order");
    Cart.clear();
    window.location.href = `pending.html?order=${encodeURIComponent(data.orderId)}&amount=${encodeURIComponent(formatJMD(data.total))}`;
  }catch(err){
    btn.disabled = false;
    btn.textContent = "I've sent payment via Lynk";
    setStatus(err.message || "Couldn't record the order. Check your connection and try again.", "var(--danger)");
    console.error("Lynk order error:", err);
  }
}
