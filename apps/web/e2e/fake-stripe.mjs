// A stand-in for the Stripe API in e2e (owner, 2026-10-17: self-serve booking verified end to
// end in test mode). The web server's Stripe client points here (STRIPE_API_BASE); nothing ever
// reaches Stripe. It answers Checkout session creation with a local "checkout page" URL and keeps
// what it was sent, for the specs to read at /__sessions.
import { createServer } from 'node:http';

const port = Number(process.argv[2] ?? 3199);
const sessions = [];

/** Stripe's form encoding ("line_items[0][price_data][unit_amount]=4900") back into objects. */
function decode(body) {
  const out = {};
  for (const [key, value] of new URLSearchParams(body)) {
    const path = key.replace(/\]/g, '').split('[');
    let node = out;
    path.forEach((part, i) => {
      if (i === path.length - 1) node[part] = value;
      else node = node[part] ??= /^\d+$/.test(path[i + 1]) ? [] : {};
    });
  }
  return out;
}

createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => {
    const json = (status, data) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    };
    if (req.method === 'GET' && req.url === '/__sessions') return json(200, sessions);
    if (req.method === 'GET' && req.url?.startsWith('/pay/')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end('<!doctype html><title>Test checkout</title><h1>Test checkout</h1>');
    }
    if (req.method === 'POST' && req.url === '/v1/checkout/sessions') {
      const id = `cs_fake_${sessions.length + 1}_${Date.now()}`;
      const params = decode(body);
      sessions.push({ id, params });
      return json(200, {
        id,
        object: 'checkout.session',
        mode: params.mode,
        url: `http://127.0.0.1:${port}/pay/${id}`,
      });
    }
    json(404, { error: { type: 'invalid_request_error', message: `No fake for ${req.url}` } });
  });
}).listen(port, '127.0.0.1');
