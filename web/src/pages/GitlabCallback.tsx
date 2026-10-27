import type { UserDTO } from '@sprintwell/shared';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { api, setToken } from '../lib/api';
import { useMe, usePageTitle } from '../lib/hooks';

/** GitLab sends people back here after they approve (or cancel) signing in. */
export function GitlabCallbackPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { refresh } = useMe();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);
  usePageTitle('Signing in with GitLab');

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const code = params.get('code');
    const state = params.get('state');
    if (params.get('error') || !code || !state) {
      setError(params.get('error') === 'access_denied' ? 'You cancelled signing in with GitLab.' : 'GitLab did not complete the sign-in.');
      return;
    }
    api<{ token: string | null; user: UserDTO; returnTo: string }>('POST', '/api/auth/gitlab/callback', { code, state }).then(
      async (r) => {
        if (r.token) setToken(r.token);
        await refresh();
        navigate(r.returnTo || '/', { replace: true });
      },
      (e: Error) => setError(e.message),
    );
  }, [params, navigate, refresh]);

  return (
    <div className="page narrow">
      {error ? (
        <>
          <h1>Signing in with GitLab did not work</h1>
          <p role="alert">{error}</p>
          <p>
            <Link to="/">Back to Sprintwell</Link>
          </p>
        </>
      ) : (
        <p aria-busy="true">Signing you in with GitLab…</p>
      )}
    </div>
  );
}
