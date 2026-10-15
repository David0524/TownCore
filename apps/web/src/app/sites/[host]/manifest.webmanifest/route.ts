import { webManifest } from '@/lib/app-icon';
import { themeFor } from '@/lib/theme';
import { resolveTown } from '@/lib/town';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ host: string }> };

// Web app manifest, so a reader can put the town's site on their Home Screen.
export async function GET(_req: Request, { params }: Ctx) {
  const town = await resolveTown((await params).host);
  if (!town) return new Response('Not found', { status: 404 });
  return new Response(JSON.stringify(webManifest(town, themeFor(town))), {
    headers: {
      'Content-Type': 'application/manifest+json; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
