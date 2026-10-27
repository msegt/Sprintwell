import { useState } from 'react';
import '../styles/gitlab.css';
import { api } from '../lib/api';
import { usePublicConfig } from '../lib/config';
import { useAction } from '../lib/hooks';
import { Button, Icon } from './ui';

/**
 * Starts "Sign in with GitLab". The browser goes to GitLab, then comes back to
 * /auth/gitlab/callback, which finishes signing in and returns to `returnTo`.
 * Renders nothing when this server has no GitLab sign-in configured.
 */
export function GitlabButton({ purpose = 'signin', returnTo, children, variant = 'secondary', small }: { purpose?: 'signin' | 'grant'; returnTo?: string; children?: React.ReactNode; variant?: 'primary' | 'secondary'; small?: boolean }) {
  const config = usePublicConfig();
  const run = useAction();
  const [busy, setBusy] = useState(false);
  if (!config?.gitlab.enabled) return null;
  return (
    <Button
      variant={variant}
      small={small}
      busy={busy}
      className="gitlab-btn"
      onClick={async () => {
        setBusy(true);
        const r = await run(() => api<{ url: string; nonce: string }>('POST', '/api/auth/gitlab/start', { purpose, returnTo: returnTo ?? window.location.pathname }));
        if (r) {
          rememberNonce(new URL(r.url).searchParams.get('state') ?? '', r.nonce);
          window.location.assign(r.url);
        } else setBusy(false);
      }}
    >
      <Icon name="key" size={16} /> {children ?? 'Sign in with GitLab'}
    </Button>
  );
}

const NONCE_KEY = 'sprintwell.gitlab.nonce.';

/** Keeps the sign-in nonce in this browser until GitLab sends the person back. */
function rememberNonce(state: string, nonce: string): void {
  for (const store of [() => sessionStorage, () => localStorage]) {
    try {
      store().setItem(NONCE_KEY + state, nonce);
      return;
    } catch {
      /* try the next storage */
    }
  }
}

export function takeNonce(state: string): string {
  for (const store of [() => sessionStorage, () => localStorage]) {
    try {
      const v = store().getItem(NONCE_KEY + state);
      if (v) {
        store().removeItem(NONCE_KEY + state);
        return v;
      }
    } catch {
      /* storage blocked */
    }
  }
  return '';
}
