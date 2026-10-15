'use client';

import { useActionState } from 'react';
import styles from '../admin.module.css';
import { requestLoginLink, type LoginState } from '../actions';

export function LoginForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(requestLoginLink, null);
  return (
    <form action={action} className={styles.form}>
      <label htmlFor="email">Email</label>
      <input id="email" name="email" type="email" autoComplete="email" required />
      <div className={styles.actions}>
        <button className={styles.button} type="submit" disabled={pending}>
          Email me a sign-in link
        </button>
      </div>
      {state ? (
        <p role="status" className={styles.notice}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
