import type { MeetingView, TeamSnapshot, TeamSummaryDTO, UserDTO } from '@sprintwell/shared';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, getToken, setToken } from './api';
import { socket, type ConnectionState } from './socket';

// ---------------------------------------------------------------------------
// Notices (visible toasts + screen-reader announcements)
// ---------------------------------------------------------------------------

interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error' | 'success';
}

interface NoticeApi {
  notify(text: string, kind?: Toast['kind']): void;
  announce(text: string): void;
}

const NoticeContext = createContext<NoticeApi>({ notify: () => undefined, announce: () => undefined });

export function NoticeProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [spoken, setSpoken] = useState('');
  const next = useRef(1);
  const notify = useCallback((text: string, kind: Toast['kind'] = 'info') => {
    const id = next.current++;
    setToasts((t) => [...t.slice(-3), { id, text, kind }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 7000 : 4000);
  }, []);
  const announce = useCallback((text: string) => {
    // Clearing first makes repeated identical messages audible.
    setSpoken('');
    window.setTimeout(() => setSpoken(text), 50);
  }, []);
  const value = useMemo(() => ({ notify, announce }), [notify, announce]);
  return (
    <NoticeContext.Provider value={value}>
      {children}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {spoken}
      </div>
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            {t.text}
            <button type="button" className="toast-close" aria-label="Dismiss" onClick={() => setToasts((all) => all.filter((x) => x.id !== t.id))}>
              ×
            </button>
          </div>
        ))}
      </div>
    </NoticeContext.Provider>
  );
}

export const useNotice = () => useContext(NoticeContext);

// ---------------------------------------------------------------------------
// The signed-in person
// ---------------------------------------------------------------------------

interface MeState {
  user: UserDTO | null;
  teams: TeamSummaryDTO[];
  loading: boolean;
  refresh(): Promise<void>;
  /** Creates an anonymous identity with a display name if there is none yet. */
  ensureUser(displayName: string): Promise<UserDTO>;
  signOut(): Promise<void>;
}

const MeContext = createContext<MeState | null>(null);

export function MeProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserDTO | null>(null);
  const [teams, setTeams] = useState<TeamSummaryDTO[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      setTeams([]);
      setLoading(false);
      return;
    }
    try {
      const me = await api<{ user: UserDTO; teams: TeamSummaryDTO[] }>('GET', '/api/me');
      setUser(me.user);
      setTeams(me.teams);
    } catch {
      setUser(null);
      setTeams([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onToken = () => void refresh();
    window.addEventListener('sprintwell:token', onToken);
    return () => window.removeEventListener('sprintwell:token', onToken);
  }, [refresh]);

  const ensureUser = useCallback(
    async (displayName: string) => {
      if (user) return user;
      const r = await api<{ user: UserDTO; token: string }>('POST', '/api/session', { displayName });
      setToken(r.token);
      setUser(r.user);
      return r.user;
    },
    [user],
  );

  const signOut = useCallback(async () => {
    await api('POST', '/api/logout').catch(() => undefined);
    setToken(null);
  }, []);

  const value = useMemo(() => ({ user, teams, loading, refresh, ensureUser, signOut }), [user, teams, loading, refresh, ensureUser, signOut]);
  return <MeContext.Provider value={value}>{children}</MeContext.Provider>;
}

export function useMe(): MeState {
  const ctx = useContext(MeContext);
  if (!ctx) throw new Error('useMe outside MeProvider');
  return ctx;
}

// ---------------------------------------------------------------------------
// Team data
// ---------------------------------------------------------------------------

export interface TeamState {
  snap: TeamSnapshot | null;
  error: string | null;
  refresh(): Promise<void>;
}

export function useTeamData(teamId: string): TeamState {
  const [snap, setSnap] = useState<TeamSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inflight = useRef<Promise<void> | null>(null);
  const again = useRef(false);

  const refresh = useCallback(async () => {
    if (inflight.current) {
      again.current = true;
      return inflight.current;
    }
    const run = async () => {
      do {
        again.current = false;
        try {
          setSnap(await api<TeamSnapshot>('GET', `/api/teams/${teamId}`));
          setError(null);
        } catch (e) {
          setError((e as Error).message);
        }
      } while (again.current);
    };
    inflight.current = run().finally(() => (inflight.current = null));
    return inflight.current;
  }, [teamId]);

  useEffect(() => {
    setSnap(null);
    void refresh();
    const unsub = socket.subscribeTeam(teamId);
    const off = socket.on((msg) => {
      if (msg.t === 'team' && msg.teamId === teamId) void refresh();
    });
    // After a reconnect, catch up on anything missed.
    const offState = socket.onState((s) => {
      if (s === 'online') void refresh();
    });
    return () => {
      unsub();
      off();
      offState();
    };
  }, [teamId, refresh]);

  return { snap, error, refresh };
}

export interface TeamCtx {
  teamId: string;
  snap: TeamSnapshot;
  me: UserDTO;
  isAdmin: boolean;
  refresh(): Promise<void>;
  /** Display name for a user id, including people who have left. */
  name(id: string | null | undefined): string;
}

export const TeamContext = createContext<TeamCtx | null>(null);

export function useTeam(): TeamCtx {
  const ctx = useContext(TeamContext);
  if (!ctx) throw new Error('useTeam outside TeamContext');
  return ctx;
}

/** Wraps an API call with error toasts; resolves to undefined on failure. */
export function useAction() {
  const { notify } = useNotice();
  return useCallback(
    async <T,>(fn: () => Promise<T>, success?: string): Promise<T | undefined> => {
      try {
        const r = await fn();
        if (success) notify(success, 'success');
        return r;
      } catch (e) {
        notify((e as Error).message, 'error');
        return undefined;
      }
    },
    [notify],
  );
}

// ---------------------------------------------------------------------------
// Meetings
// ---------------------------------------------------------------------------

export function useMeeting(meetingId: string) {
  const [view, setView] = useState<MeetingView | null>(null);
  const [missing, setMissing] = useState(false);
  const offset = useRef(0);
  const { notify } = useNotice();

  useEffect(() => {
    setView(null);
    setMissing(false);
    const leave = socket.joinMeeting(meetingId);
    const off = socket.on((msg) => {
      if (msg.t === 'meeting' && msg.view.id === meetingId) {
        offset.current = msg.view.serverNow - Date.now();
        setView(msg.view);
      }
      if (msg.t === 'error' && msg.error === 'Meeting not found') setMissing(true);
    });
    return () => {
      off();
      leave();
    };
  }, [meetingId]);

  const send = useCallback(
    async (cmd: Record<string, unknown> & { type: string }): Promise<boolean> => {
      const r = await socket.command(meetingId, cmd);
      if (!r.ok && r.error) notify(r.error, 'error');
      return r.ok;
    },
    [meetingId, notify],
  );

  return { view, missing, send, serverOffset: offset };
}

/** Re-renders on an interval while `active`, returning the current server-adjusted time. */
export function useNow(active: boolean, offsetMs = 0, intervalMs = 250): number {
  const [now, setNow] = useState(() => Date.now() + offsetMs);
  useEffect(() => {
    setNow(Date.now() + offsetMs);
    if (!active) return;
    const t = window.setInterval(() => setNow(Date.now() + offsetMs), intervalMs);
    return () => window.clearInterval(t);
  }, [active, offsetMs, intervalMs]);
  return now;
}

export function useConnection(): ConnectionState {
  const [state, setState] = useState<ConnectionState>(socket.state);
  useEffect(() => socket.onState(setState), []);
  return state;
}

export function usePageTitle(title: string) {
  useEffect(() => {
    document.title = title ? `${title} · Sprintwell` : 'Sprintwell';
  }, [title]);
}
