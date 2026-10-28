import type { UserDTO } from '@sprintwell/shared';
import { useState, type FormEvent } from 'react';
import { api, setToken } from '../lib/api';
import { usePublicConfig } from '../lib/config';
import { useMe, useNotice } from '../lib/hooks';
import { Button, Field, Icon } from './ui';

/**
 * Verify a GitLab account by pasting a personal access token with only the
 * read_user scope. Sprintwell asks GitLab whose token it is, then revokes it.
 * Works without an OAuth application on the GitLab server.
 */
export function GitlabVerify({ onDone, intro, submitLabel = 'Verify with GitLab' }: { onDone?(user: UserDTO): void; intro?: React.ReactNode; submitLabel?: string }) {
  const config = usePublicConfig();
  const { refresh } = useMe();
  const { notify } = useNotice();
  const [token, setTokenValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!config?.gitlab.enabled) return null;
  const host = new URL(config.gitlab.url).host;
  const createUrl = `${config.gitlab.url}/-/user_settings/personal_access_tokens?name=Sprintwell&scopes=read_user`;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ token: string | null; user: UserDTO; revoked: boolean }>('POST', '/api/auth/gitlab/token', { token: token.trim() });
      if (r.token) setToken(r.token);
      await refresh();
      setTokenValue('');
      notify(
        r.revoked
          ? `Verified as @${r.user.gitlab?.username}. Sprintwell has deleted the token in GitLab.`
          : `Verified as @${r.user.gitlab?.username}. Sprintwell did not keep the token; you can delete it in GitLab.`,
        'success',
      );
      onDone?.(r.user);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="gitlab-verify stack" onSubmit={submit}>
      {intro}
      <ol className="guide-steps small">
        <li>
          In GitLab ({host}), open{' '}
          <a href={createUrl} target="_blank" rel="noopener noreferrer">
            Edit profile → Access tokens <Icon name="external" size={12} />
            <span className="sr-only"> (opens in a new tab)</span>
          </a>{' '}
          and choose <strong>Add new token</strong>.
        </li>
        <li>
          Call it “Sprintwell”, set it to expire tomorrow, tick only <strong>read_user</strong>, and create it.
        </li>
        <li>Copy the token and paste it here.</li>
      </ol>
      <Field label="GitLab access token" hint="Sprintwell only asks GitLab whose token it is, then deletes it. It is never stored.">
        {(id, h) => <input id={id} aria-describedby={h} className="input" required autoComplete="off" spellCheck={false} value={token} onChange={(e) => setTokenValue(e.target.value)} placeholder="glpat-…" />}
      </Field>
      {error && (
        <p className="callout warn small" role="alert">
          {error}
        </p>
      )}
      <div>
        <Button type="submit" variant="primary" busy={busy}>
          <Icon name="key" size={16} /> {submitLabel}
        </Button>
      </div>
    </form>
  );
}
