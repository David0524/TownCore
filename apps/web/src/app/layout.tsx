import './fonts';
import './globals.css';
import type { Viewport } from 'next';
import type { ReactNode } from 'react';
import { defaultTheme } from '@towncore/config';
import { themeCssVariables } from '@/lib/theme';

// Baseline tokens from the default theme. A town's layout injects its own theme variables
// after these, which override them.
const baseline = themeCssVariables(defaultTheme);

// Lets the phone tab bar sit above the home indicator (env(safe-area-inset-bottom)).
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <style dangerouslySetInnerHTML={{ __html: baseline }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
