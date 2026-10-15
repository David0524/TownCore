'use client';

import { useEffect, useState } from 'react';
import { ShareIcon } from './icons';
import styles from './phone.module.css';

const VISITS = 'visits';
const COUNTED = 'visit-counted';
const DISMISSED = 'home-screen-dismissed';

type InstallPrompt = Event & { prompt: () => Promise<void> };

function safe<T>(read: () => T, fallback: T): T {
  try {
    return read();
  } catch {
    return fallback;
  }
}

/**
 * "Put {Town} on your Home Screen" (docs/plans/M4b.md revision 5): shown on phones from the
 * second visit, never inside the installed app, and gone for good once dismissed. It floats
 * above the tab bar, so it never shifts the page. Counts are kept on this device only.
 */
export function HomeScreenCard({ townName }: { townName: string }) {
  const [show, setShow] = useState(false);
  const [install, setInstall] = useState<InstallPrompt | null>(null);
  const [ios, setIos] = useState(false);

  useEffect(() => {
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (standalone) return;
    // One visit per browser session.
    let visits = safe(() => Number(localStorage.getItem(VISITS) ?? '0'), 0);
    if (!safe(() => sessionStorage.getItem(COUNTED), null)) {
      visits += 1;
      safe(() => {
        localStorage.setItem(VISITS, String(visits));
        sessionStorage.setItem(COUNTED, '1');
      }, undefined);
    }
    if (visits < 2 || safe(() => localStorage.getItem(DISMISSED), null)) return;
    setIos(/iPhone|iPad|iPod/.test(navigator.userAgent));
    setShow(true);
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstall(e as InstallPrompt);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  if (!show) return null;
  const dismiss = () => {
    safe(() => localStorage.setItem(DISMISSED, '1'), undefined);
    setShow(false);
  };

  return (
    <aside
      className={`${styles.homeScreen} phone-only`}
      aria-labelledby="home-screen-h"
      data-testid="home-screen-card"
    >
      <div className={styles.homeScreenText}>
        <p id="home-screen-h" className={styles.homeScreenTitle}>
          Put {townName} on your Home Screen
        </p>
        <p className={styles.homeScreenHow}>
          {install ? (
            'One tap, and Today opens like an app.'
          ) : ios ? (
            <>
              Tap Share <ShareIcon size={15} /> then Add to Home Screen.
            </>
          ) : (
            'Open your browser menu, then Add to Home screen.'
          )}
        </p>
      </div>
      {install ? (
        <button
          type="button"
          className={styles.homeScreenAdd}
          onClick={async () => {
            await install.prompt();
            dismiss();
          }}
        >
          Add
        </button>
      ) : null}
      <button type="button" className={styles.homeScreenClose} onClick={dismiss}>
        Not now
      </button>
    </aside>
  );
}
