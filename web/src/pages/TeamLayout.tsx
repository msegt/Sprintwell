import { useCallback, useMemo } from 'react';
import { Link, NavLink, Outlet, useParams } from 'react-router';
import { Icon } from '../components/ui';
import { TeamContext, useMe, useTeamData, type TeamCtx } from '../lib/hooks';
import '../styles/classes.css';

const TABS = [
  ['', 'Overview'],
  ['events', 'Events'],
  ['backlog', 'Backlog'],
  ['sprint', 'Sprint'],
  ['charter', 'Charter'],
  ['actions', 'Actions'],
  ['risks', 'Risks'],
  ['activity', 'Activity'],
  ['settings', 'Team'],
] as const;

export function TeamLayout() {
  const { teamId = '' } = useParams();
  const { user, loading } = useMe();
  const { snap, error, refresh } = useTeamData(teamId);

  const name = useCallback(
    (id: string | null | undefined) => {
      if (!id) return 'Unassigned';
      return snap?.team.members.find((m) => m.userId === id)?.displayName ?? 'Former member';
    },
    [snap],
  );

  const ctx = useMemo<TeamCtx | null>(
    () => (snap && user ? { teamId, snap, me: user, isAdmin: snap.team.myRole === 'admin', readOnly: snap.team.myRole === 'coach', refresh, name } : null),
    [teamId, snap, user, refresh, name],
  );

  if (!loading && !user) {
    return (
      <div className="page narrow">
        <h1>Join this team first</h1>
        <p>Ask a teammate for the team’s invite link. If you use Sprintwell on another device, sign in with a code from your profile there.</p>
        <Link to="/">Go to the home page</Link>
      </div>
    );
  }
  if (error && !snap) {
    return (
      <div className="page narrow">
        <h1>Team not available</h1>
        <p>{error}</p>
        <Link to="/">Back to your teams</Link>
      </div>
    );
  }
  if (!ctx) return <div className="page" aria-busy="true" aria-label="Loading team" />;

  return (
    <TeamContext.Provider value={ctx}>
      <div className="team-head">
        <div className="team-head-inner">
          <p className="team-name">
            {ctx.snap.team.name}
            {ctx.snap.team.classInfo && (
              <span className="team-class small">
                {' '}
                · {ctx.readOnly ? <Link to={`/c/${ctx.snap.team.classInfo.id}`}>{ctx.snap.team.classInfo.name}</Link> : ctx.snap.team.classInfo.name}
              </span>
            )}
          </p>
          <nav aria-label="Team" className="tabs">
            {TABS.map(([path, label]) => (
              <NavLink key={path} to={path ? `/t/${teamId}/${path}` : `/t/${teamId}`} end={path === ''} className={({ isActive }) => `tab${isActive ? ' tab-active' : ''}`}>
                {label}
              </NavLink>
            ))}
          </nav>
        </div>
      </div>
      {ctx.readOnly && (
        <div className="coach-banner" role="note">
          <Icon name="eye" size={16} /> You are viewing this team as teaching staff. You can see everything and manage membership on the Team tab, but you cannot change the team’s work or take part in its events.
        </div>
      )}
      <Outlet />
    </TeamContext.Provider>
  );
}
