// Creates a Stripe Checkout page for a cart and returns its URL.
// Prices are recalculated here from orders.vgs, so a customer cannot change what they pay.
// Needs the STRIPE_SECRET_KEY environment variable (set in Netlify, never in the website files).

const STRIPE = "https://api.stripe.com/v1";

// Same rules as parseVGS in app.js, reduced to what pricing needs.
function parseVGS(text) {
  const out = {business: {}, products: []};
  let cur = null;
  text.split(/\r?\n/).forEach(raw => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const sec = line.match(/^\[(\w+)\]$/);
    if (sec) {
      if (sec[1] === "product") { cur = {}; out.products.push(cur); }
      else if (sec[1] === "business") cur = out.business;
      else cur = null;
      return;
    }
    const c = line.indexOf(":");
    if (!cur || c < 1) return;
    cur[line.slice(0, c).trim().toLowerCase()] = line.slice(c + 1).trim();
  });
  return out;
}

const json = (status, body) => new Response(JSON.stringify(body), {status, headers: {"Content-Type": "application/json"}});
const cents = n => Math.round(Number(n) * 100);
const clip = (s, n) => String(s == null ? "" : s).slice(0, n);

export default async (req) => {
  if (req.method !== "POST") return json(405, {error: "Use POST"});
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return json(500, {error: "Card payments are not set up yet (missing STRIPE_SECRET_KEY)."});

  let body;
  try { body = await req.json(); } catch (e) { return json(400, {error: "Bad request"}); }
  const origin = new URL(req.url).origin;

  // Load the live catalog from this same site
  let cat;
  try {
    const r = await fetch(origin + "/orders.vgs");
    if (!r.ok) throw new Error("HTTP " + r.status);
    cat = parseVGS(await r.text());
  } catch (e) { return json(500, {error: "Could not load the product list."}); }

  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length || items.length > 200) return json(400, {error: "Your cart is empty."});

  const lineItems = [];
  let sub = 0;
  for (const it of items) {
    const p = cat.products.find(x => Number(x.id) === Number(it.id));
    const qty = Number(it.qty);
    if (!p || !Number.isInteger(qty) || qty < 1 || qty > 999 || !["case", "each"].includes(it.type)) {
      return json(400, {error: "Something in your cart is no longer available. Please refresh and try again."});
    }
    const isCase = it.type === "case";
    const unit = cents(isCase ? p.case_price : p.each);
    if (!(unit > 0)) return json(400, {error: p.name + " has no price set."});
    sub += unit * qty;
    lineItems.push({name: p.name + (isCase ? " (case of " + (p.case_qty || 1) + ")" : " (each)"), unit, qty});
  }

  const b = cat.business, delivery = body.fulfillment !== "pickup";
  const base = cents(b.delivery_fee || 0), freeOver = b.free_delivery_over ? cents(b.free_delivery_over) : Infinity, minD = cents(b.min_delivery_order || 0);
  if (delivery && minD && sub < minD) return json(400, {error: "Delivery orders have a $" + (minD / 100).toFixed(2) + " minimum."});
  if (delivery && base && sub < freeOver) lineItems.push({name: "Delivery", unit: base, qty: 1});

  const c = body.customer || {};
  const orderId = clip(body.orderId, 40);
  const form = new URLSearchParams({
    mode: "payment",
    success_url: origin + "/checkout.html?paid={CHECKOUT_SESSION_ID}",
    cancel_url: origin + "/checkout.html?canceled=1",
    client_reference_id: orderId,
    "payment_intent_data[description]": "Order " + orderId,
    "metadata[order_id]": orderId,
    "metadata[name]": clip(c.name, 200),
    "metadata[business]": clip(c.business, 200),
    "metadata[phone]": clip(c.phone, 50),
    "metadata[fulfillment]": delivery ? "delivery" : "pickup",
    "metadata[date]": clip(body.date, 20),
    "metadata[time]": clip(body.time, 40),
    "metadata[address]": clip(body.address, 500),
    "metadata[notes]": clip(body.notes, 500)
  });
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.email || "")) form.set("customer_email", c.email);
  lineItems.forEach((l, i) => {
    form.set(`line_items[${i}][quantity]`, String(l.qty));
    form.set(`line_items[${i}][price_data][currency]`, "usd");
    form.set(`line_items[${i}][price_data][unit_amount]`, String(l.unit));
    form.set(`line_items[${i}][price_data][product_data][name]`, clip(l.name, 250));
  });

  const r = await fetch(STRIPE + "/checkout/sessions", {
    method: "POST",
    headers: {Authorization: "Bearer " + key, "Content-Type": "application/x-www-form-urlencoded"},
    body: form
  });
  const s = await r.json();
  if (!r.ok) { console.error("Stripe error", s); return json(502, {error: "The payment page could not be opened. Please try again."}); }
  return json(200, {url: s.url, id: s.id});
};

export const config = {path: "/api/checkout"};
