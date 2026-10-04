// Tells the checkout page whether a Stripe Checkout payment really went through.

const json = (status, body) => new Response(JSON.stringify(body), {status, headers: {"Content-Type": "application/json"}});

export default async (req) => {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return json(500, {error: "Card payments are not set up yet."});
  const id = new URL(req.url).searchParams.get("id") || "";
  if (!/^cs_[A-Za-z0-9_]+$/.test(id)) return json(400, {error: "Bad session id"});

  const r = await fetch("https://api.stripe.com/v1/checkout/sessions/" + id, {headers: {Authorization: "Bearer " + key}});
  const s = await r.json();
  if (!r.ok) return json(404, {error: "Payment not found"});
  return json(200, {paid: s.payment_status === "paid", orderId: s.client_reference_id, total: s.amount_total / 100});
};

export const config = {path: "/api/checkout-status"};
