import { useEffect, useState } from 'react';
import { Icon } from '../components/ui';
import { api } from '../lib/api';
import { usePageTitle } from '../lib/hooks';

interface PublicConfig {
  appName: string;
  version: string;
  donationUrl: string;
  sourceUrl: string;
}

function useConfig(): PublicConfig | null {
  const [config, setConfig] = useState<PublicConfig | null>(null);
  useEffect(() => {
    api<PublicConfig>('GET', '/api/config').then(setConfig, () => undefined);
  }, []);
  return config;
}

export function SupportPage() {
  const config = useConfig();
  usePageTitle('Support Sprintwell');
  return (
    <div className="page narrow stack">
      <h1>Support Sprintwell</h1>
      <p className="lead">Every feature is free while Sprintwell grows. Donations pay for hosting and development time.</p>
      {config?.donationUrl ? (
        <p>
          <a className="btn btn-primary" href={config.donationUrl} target="_blank" rel="noopener noreferrer">
            <Icon name="heart" /> Make a donation
          </a>
        </p>
      ) : (
        <p className="muted">This server has no donation link configured yet.</p>
      )}
      <section className="card">
        <h2>Where Sprintwell is heading</h2>
        <p>The plan is for the core to stay free and open source, including for education. Possible paid extras for organisations include:</p>
        <ul>
          <li>Sync with GitHub and Jira</li>
          <li>Single sign-on and organisation administration</li>
          <li>Longer-term analytics such as team health trends</li>
        </ul>
        <p className="small muted">None of these exist yet, and the list may change.</p>
      </section>
      <section className="card">
        <h2>Open source</h2>
        <p>
          Sprintwell is licensed under the GNU Affero General Public License v3.0. You may run, study, change and share it. If you run a modified version for other people, you must
          offer them its source code.
        </p>
        {config?.sourceUrl && (
          <p>
            <a href={config.sourceUrl} target="_blank" rel="noopener noreferrer">
              Source code <Icon name="external" size={14} />
            </a>
          </p>
        )}
        {config && <p className="small muted">Version {config.version}</p>}
      </section>
    </div>
  );
}

export function PrivacyPage() {
  usePageTitle('Privacy');
  return (
    <div className="page narrow prose">
      <h1>Privacy</h1>
      <p className="callout">
        This page describes what the Sprintwell software stores. Whoever runs this server is responsible for its privacy notice; organisations should adapt this text and check it against
        their own data-protection obligations.
      </p>
      <h2>What is stored</h2>
      <ul>
        <li>The display name you choose. No email address or password is needed.</li>
        <li>
          If you sign in with GitLab: your GitLab user id, username and name, and the access tokens GitLab issues, stored encrypted. Disconnect GitLab from your profile at any time.
        </li>
        <li>An activity log of what each person does in a team (for example “wrote a story”, “took part in the Daily Scrum”), with the time.</li>
        <li>A random sign-in token kept in your browser; the server stores only a one-way hash of it.</li>
        <li>Your team memberships and the content your team creates: stories, sprints, the team charter, actions, risks and meeting content such as cards, votes and notes.</li>
        <li>Basic server logs (for example IP addresses) for security and troubleshooting, kept by the server operator.</li>
      </ul>
      <h2>Who can see it</h2>
      <ul>
        <li>Team content is visible to members of that team only. Anyone with a valid invite link can join, so share it with care and regenerate it if it leaks.</li>
        <li>
          If a teacher created your team as part of a class, the class’s teaching staff can also see all of the team’s content and its activity log, read-only, and download it. Teams
          show the class name at the top of every page.
        </li>
        <li>The activity log never records the text of retrospective cards, anonymous cards, check-ins, dot votes, the safety check or the values of Planning Poker votes.</li>
        <li>In anonymous retrospectives, other people never see who wrote a card. The server still records the author so you can edit your own cards.</li>
        <li>Planning Poker votes are hidden from everyone else until the facilitator reveals them.</li>
      </ul>
      <h2>Your choices</h2>
      <ul>
        <li>Download your data or delete it from your profile page at any time.</li>
        <li>Team members can export all team data as JSON, and meeting summaries as Markdown.</li>
        <li>Admins can delete a team and everything in it.</li>
      </ul>
      <p>
        Sprintwell sets no advertising or tracking cookies, and it uses browser storage only to remember who you are.
      </p>
    </div>
  );
}
