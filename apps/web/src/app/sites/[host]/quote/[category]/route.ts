import { submitQuote, type QuoteOutcome } from '@towncore/directory';
import { clientIp } from '@/lib/newsletter';
import { directoryMailDeps, sameOrigin } from '@/lib/owner';
import { resolveTown } from '@/lib/town';

type Ctx = { params: Promise<{ host: string; category: string }> };

// The quote-request form posts here (D-M6-9), then the reader goes back to the category page.
export async function POST(request: Request, { params }: Ctx) {
  const { host, category } = await params;
  const town = await resolveTown(decodeURIComponent(host));
  if (!town) return new Response(null, { status: 404 });
  const back = (s: QuoteOutcome['status']) =>
    new Response(null, {
      status: 303,
      headers: { Location: `/directory/${encodeURIComponent(category)}?quote=${s}#quote` },
    });
  const deps = directoryMailDeps();
  const form = await request.formData().catch(() => null);
  if (!deps || !form || !sameOrigin(request)) return back('unavailable');
  const field = (k: string) => String(form.get(k) ?? '');
  try {
    const result = await submitQuote(
      { ...deps, timezone: town.timezone },
      {
        townId: town.id,
        category,
        name: field('name'),
        email: field('email'),
        phone: field('phone'),
        message: field('message'),
        consent: field('consent') === 'yes',
        honeypot: field('website'),
        ip: clientIp(request),
      },
    );
    return back(result.status);
  } catch (error) {
    console.error('quote request failed', error);
    return back('unavailable');
  }
}
