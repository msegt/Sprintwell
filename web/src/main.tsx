import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, Route, Routes, useLocation } from 'react-router';
import { useEffect } from 'react';
import { Avatar, Icon } from './components/ui';
import { MeProvider, NoticeProvider, useConnection, useMe } from './lib/hooks';
import { GuidePage } from './pages/GuidePage';
import { HomePage } from './pages/Home';
import { JoinPage } from './pages/Join';
import { ProfilePage } from './pages/Profile';
import { GitlabCallbackPage } from './pages/GitlabCallback';
import { PrivacyPage, SupportPage } from './pages/Support';
import { TeamLayout } from './pages/TeamLayout';
import { OverviewPage } from './pages/Overview';
import { BacklogPage } from './pages/Backlog';
import { SprintPage } from './pages/Sprint';
import { MeetingsPage } from './pages/Meetings';
import { CharterPage } from './pages/Charter';
import { ActionsPage } from './pages/Actions';
import { RisksPage } from './pages/Risks';
import { SettingsPage } from './pages/Settings';
import { MeetingPage } from './meetings/MeetingPage';
import '@fontsource-variable/inter';
import '@fontsource-variable/bricolage-grotesque';
import './styles.css';
import './theme.css';

function Shell() {
  const { user } = useMe();
  const connection = useConnection();
  const location = useLocation();
  useEffect(() => {
    // Move focus to the main region on navigation so screen readers announce the new page.
    document.getElementById('main')?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }, [location.pathname]);
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="topbar">
        <Link to="/" className="brand" aria-label="Sprintwell home">
          <img src="/favicon.svg" alt="" width={28} height={28} />
          <span>Sprintwell</span>
        </Link>
        <nav className="topnav" aria-label="Site">
          <Link to="/guide">Guide</Link>
          <Link to="/support">
            <Icon name="heart" size={16} /> <span className="hide-sm">Support the project</span>
            <span className="sr-only sm-only-label">Support the project</span>
          </Link>
          {user && (
            <Link to="/me" className="me-link">
              <Avatar id={user.id} name={user.displayName} size={30} />
              <span className="sr-only">Your profile: </span>
              <span className="hide-sm">{user.displayName}</span>
            </Link>
          )}
        </nav>
      </header>
      {user && connection === 'offline' && (
        <div className="offline-banner" role="status">
          Reconnecting… Changes will sync when the connection is back.
        </div>
      )}
      <main id="main" tabIndex={-1}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/join/:code" element={<JoinPage />} />
          <Route path="/me" element={<ProfilePage />} />
          <Route path="/auth/gitlab/callback" element={<GitlabCallbackPage />} />
          <Route path="/guide" element={<GuidePage />} />
          <Route path="/support" element={<SupportPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/t/:teamId" element={<TeamLayout />}>
            <Route index element={<OverviewPage />} />
            <Route path="backlog" element={<BacklogPage />} />
            <Route path="sprint" element={<SprintPage />} />
            <Route path="events" element={<MeetingsPage />} />
            <Route path="charter" element={<CharterPage />} />
            <Route path="actions" element={<ActionsPage />} />
            <Route path="risks" element={<RisksPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="m/:meetingId" element={<MeetingPage />} />
          </Route>
          <Route
            path="*"
            element={
              <div className="page narrow">
                <h1>Page not found</h1>
                <p>
                  <Link to="/">Go to your teams</Link>
                </p>
              </div>
            }
          />
        </Routes>
      </main>
      <footer className="footer">
        <span>Sprintwell is free, open-source software (AGPL-3.0).</span>
        <Link to="/guide">Guide</Link>
        <Link to="/privacy">Privacy</Link>
        <Link to="/support">
          <Icon name="heart" size={14} /> Donate
        </Link>
      </footer>
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <NoticeProvider>
        <MeProvider>
          <Shell />
        </MeProvider>
      </NoticeProvider>
    </BrowserRouter>
  </StrictMode>,
);
