import { appIconRoute } from '@/lib/app-icon';

type Ctx = { params: Promise<{ host: string }> };

// 180px app icon for this town (see lib/app-icon.tsx).
export async function GET(_req: Request, { params }: Ctx) {
  return appIconRoute((await params).host, 180);
}
