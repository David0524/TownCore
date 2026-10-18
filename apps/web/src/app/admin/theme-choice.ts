// The admin's light/dark choice (owner, 2026-10-18: "add a dark mode like Resend"). System
// follows the computer's setting; the choice is kept in a cookie so pages render in it at once.
export const ADMIN_THEMES = ['system', 'light', 'dark'] as const;
export type AdminTheme = (typeof ADMIN_THEMES)[number];
export const ADMIN_THEME_COOKIE = 'tc_admin_theme';

export const adminThemeOf = (value: string | undefined): AdminTheme =>
  (ADMIN_THEMES as readonly string[]).includes(value ?? '') ? (value as AdminTheme) : 'system';
