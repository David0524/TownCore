'use client';

import { useState } from 'react';
import styles from './admin.module.css';
import { ADMIN_THEME_COOKIE, ADMIN_THEMES, type AdminTheme } from './theme-choice';

// The System / Light / Dark switch at the foot of the admin sidebar.

const LABELS: Record<AdminTheme, string> = { system: 'System', light: 'Light', dark: 'Dark' };

export function ThemeSwitch({ initial }: { initial: AdminTheme }) {
  const [theme, setTheme] = useState<AdminTheme>(initial);
  const choose = (next: AdminTheme) => {
    setTheme(next);
    document
      .querySelectorAll<HTMLElement>('[data-admin-theme]')
      .forEach((el) => (el.dataset.adminTheme = next));
    document.cookie = `${ADMIN_THEME_COOKIE}=${next}; path=/admin; max-age=31536000; samesite=lax`;
  };
  return (
    <div className={styles.themeSwitch} role="group" aria-label="Theme">
      {ADMIN_THEMES.map((t) => (
        <button key={t} type="button" aria-pressed={theme === t} onClick={() => choose(t)}>
          {LABELS[t]}
        </button>
      ))}
    </div>
  );
}
