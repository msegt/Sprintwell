import { KERTH_ATTRIBUTION, KERTH_PRIME_DIRECTIVE, MEETING_INFO, PHASES, type MeetingKind } from '@sprintwell/shared';
import { GuideBody, Links } from '../components/Guide';
import { KIND_ORDER } from '../components/NewMeeting';
import { LINKS, MEETING_GUIDES, PAGE_GUIDES, PHASE_HINTS, type PageGuideId } from '../content/guides';
import { usePageTitle } from '../lib/hooks';

const PAGE_ORDER: PageGuideId[] = ['overview', 'backlog', 'sprint', 'events', 'charter', 'actions', 'risks', 'team'];

/** All in-app guidance on one page, e.g. to link from a course page. */
export function GuidePage() {
  usePageTitle('Guide');
  return (
    <div className="page narrow prose guide-page">
      <h1>Sprintwell guide</h1>
      <p className="lead">Short, practical instructions for each part of Sprintwell. The same guidance appears in each section of the app under “How this works”.</p>

      <nav aria-label="On this page" className="card guide-toc">
        <p className="guide-tips-title">Scrum events and practices</p>
        <ul>
          {KIND_ORDER.map((k) => (
            <li key={k}>
              <a href={`#event-${k}`}>{MEETING_INFO[k].name}</a>
            </li>
          ))}
        </ul>
        <p className="guide-tips-title">
          <a href="#reading">Where to read more</a>
        </p>
        <p className="guide-tips-title">Team pages</p>
        <ul>
          {PAGE_ORDER.map((p) => (
            <li key={p}>
              <a href={`#page-${p}`}>{PAGE_GUIDES[p].title}</a>
            </li>
          ))}
        </ul>
      </nav>

      <h2>Scrum events and practices</h2>
      {KIND_ORDER.map((k) => (
        <EventGuide key={k} kind={k} />
      ))}

      <h2>Team pages</h2>
      {PAGE_ORDER.map((p) => (
        <section key={p} id={`page-${p}`} className="guide-section" aria-labelledby={`page-${p}-h`}>
          <h3 id={`page-${p}-h`}>{PAGE_GUIDES[p].title}</h3>
          <GuideBody guide={PAGE_GUIDES[p]} full />
        </section>
      ))}

      <h2 id="reading">Where to read more</h2>
      <p>Sprintwell’s guidance is deliberately short. These sources go deeper. They are other organisations’ websites, checked in October 2026, so they may change.</p>
      <Links title="Scrum itself" links={[LINKS.scrumGuide, LINKS.scrumGuideEs, LINKS.scrumEvents, LINKS.scrumGlossary]} />
      <Links title="Backlogs and estimation" links={[LINKS.invest, LINKS.splitting, LINKS.definitionOfReady, LINKS.planningPoker]} />
      <Links title="Retrospectives and facilitation" links={[LINKS.retromat, LINKS.primeDirective, LINKS.oneTwoFourAll]} />
      <Links title="Pair and mob programming" links={[LINKS.pairing, LINKS.mobbing]} />

      <h2>The Retrospective Prime Directive</h2>
      <blockquote className="prime-directive">
        <p>{KERTH_PRIME_DIRECTIVE}</p>
        <footer>{KERTH_ATTRIBUTION}</footer>
      </blockquote>
    </div>
  );
}

function EventGuide({ kind }: { kind: MeetingKind }) {
  const guide = MEETING_GUIDES[kind];
  const phases = PHASES[kind];
  return (
    <section id={`event-${kind}`} className="guide-section" aria-labelledby={`event-${kind}-h`}>
      <h3 id={`event-${kind}-h`}>{guide.title}</h3>
      <p className="small muted">Timebox: {MEETING_INFO[kind].timebox}</p>
      <GuideBody guide={guide} full />
      {phases.length > 1 && (
        <div className="table-scroll">
          <table className="table">
            <caption className="sr-only">Steps in Sprintwell for {MEETING_INFO[kind].name}</caption>
            <thead>
              <tr>
                <th scope="col">Step in Sprintwell</th>
                <th scope="col">Facilitator</th>
                <th scope="col">Everyone</th>
                <th scope="col">Time</th>
              </tr>
            </thead>
            <tbody>
              {phases.map((p) => {
                const hint = PHASE_HINTS[kind][p.id];
                return (
                  <tr key={p.id}>
                    <th scope="row">{p.name}</th>
                    <td>{hint?.facilitator}</td>
                    <td>{hint?.everyone}</td>
                    <td>{hint?.minutes ? `${hint.minutes} min` : '–'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
