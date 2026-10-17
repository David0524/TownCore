import { appIconRoute } from '@/lib/app-icon';

type Ctx = { params: Promise<{ host: string }> };

// 512px maskable app icon for this town: the art inside Android's circle crop (lib/app-icon.tsx).
export async function GET(_req: Request, { params }: Ctx) {
  return appIconRoute((await params).host, 512, true);
}
