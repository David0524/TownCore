import './fonts';
import './globals.css';
import type { ReactNode } from 'react';
import { defaultTheme } from '@towncore/config';
import { networkCssVariables } from '@/lib/brand';
import { themeCssVariables } from '@/lib/theme';

// Baseline tokens: the network brand (locked elements) and the default theme. A town's layout
// injects its own theme variables after these, which override the defaults.
const baseline = networkCssVariables + themeCssVariables(defaultTheme);

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
