// "Show me more of": the beats a reader follows, saved on this device only (no account, no
// cookie, never sent to us). Followed beats float to the top of the home sections and
// capsules through CSS order, keyed on <html data-follow="...">.

export const FOLLOW_KEY = 'follow';

/** Reads the saved beats; tolerates private mode and junk. */
export function readFollow(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(FOLLOW_KEY) ?? '[]');
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

export function writeFollow(beats: string[]): void {
  try {
    localStorage.setItem(FOLLOW_KEY, JSON.stringify(beats));
  } catch {
    // Storage blocked: the choice lasts for this page only.
  }
  applyFollow(beats);
}

export function applyFollow(beats: string[]): void {
  if (beats.length > 0) document.documentElement.dataset.follow = beats.join(' ');
  else delete document.documentElement.dataset.follow;
}

/**
 * Runs before first paint (an inline script in the town layout), so followed sections are
 * already in place when the page appears: no layout shift.
 */
export const followBootScript = `try{var f=JSON.parse(localStorage.getItem(${JSON.stringify(FOLLOW_KEY)})||'[]');if(Array.isArray(f)&&f.length)document.documentElement.dataset.follow=f.filter(function(x){return typeof x==='string'}).join(' ')}catch(e){}`;

/** CSS that floats each followed beat first, wherever a list marks its items. */
export function followCss(beats: readonly string[]): string {
  return beats
    .map((b) => `:root[data-follow~="${b}"] [data-follow-beat="${b}"]{order:-1}`)
    .join('');
}
