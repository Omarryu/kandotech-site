/* ==========================================================================
   KANDOTECH — cart state (localStorage-backed, shared across pages)
   ========================================================================== */

const Cart = {
  KEY: "kandotech_cart_v1",

  read(){
    try{
      const raw = localStorage.getItem(this.KEY);
      return raw ? JSON.parse(raw) : [];
    }catch(e){ return []; }
  },

  write(items){
    localStorage.setItem(this.KEY, JSON.stringify(items));
    document.dispatchEvent(new CustomEvent("cart:change", { detail: items }));
  },

  add(sku, qty = 1){
    const items = this.read();
    const existing = items.find(i => i.sku === sku);
    const product = PRODUCTS.find(p => p.sku === sku);
    if(!product) return;
    const maxQty = product.stock;
    if(existing){
      existing.qty = Math.min(existing.qty + qty, maxQty);
    }else{
      items.push({ sku, qty: Math.min(qty, maxQty) });
    }
    this.write(items);
  },

  setQty(sku, qty){
    let items = this.read();
    const product = PRODUCTS.find(p => p.sku === sku);
    if(qty <= 0){
      items = items.filter(i => i.sku !== sku);
    }else{
      const existing = items.find(i => i.sku === sku);
      if(existing) existing.qty = Math.min(qty, product ? product.stock : qty);
    }
    this.write(items);
  },

  remove(sku){
    this.write(this.read().filter(i => i.sku !== sku));
  },

  clear(){
    this.write([]);
  },

  count(){
    return this.read().reduce((sum, i) => sum + i.qty, 0);
  },

  lines(){
    return this.read().map(i => {
      const product = PRODUCTS.find(p => p.sku === i.sku);
      return product ? { ...i, product } : null;
    }).filter(Boolean);
  },

  subtotal(){
    return this.lines().reduce((sum, l) => sum + l.product.price * l.qty, 0);
  }
};

function formatJMD(amount){
  return "J$" + Number(amount).toLocaleString("en-JM", { maximumFractionDigits: 0 });
}
