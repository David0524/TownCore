import { loadEnv } from '@towncore/config';
import { handleStripeEvent } from '@towncore/directory';
import { db } from '@/lib/db';
import { stripe } from '@/lib/stripe';

// Stripe → here (M6 PR D). Served only on the admin host (proxy.ts). The signature is checked
// with Stripe's own helper against STRIPE_WEBHOOK_SECRET; unsigned or tampered requests get a
// 400 and are never stored. A handling error returns 500 so Stripe retries.
export async function POST(request: Request) {
  const client = stripe();
  const secret = loadEnv().STRIPE_WEBHOOK_SECRET;
  if (!client || !secret) return new Response('Stripe is not configured', { status: 503 });
  const body = await request.text();
  let event;
  try {
    event = client.webhooks.constructEvent(
      body,
      request.headers.get('stripe-signature') ?? '',
      secret,
    );
  } catch {
    return new Response('Bad signature', { status: 400 });
  }
  if (event.livemode) return new Response('Live mode is not enabled', { status: 400 });
  try {
    const result = await handleStripeEvent(db(), event);
    return Response.json({ received: true, result });
  } catch (error) {
    console.error(`Stripe event ${event.id} failed`, error);
    return new Response('Handling failed', { status: 500 });
  }
}
