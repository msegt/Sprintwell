import type { PairingMode, PairingView } from '@sprintwell/shared';
import { Avatar, Button, Icon } from '../components/ui';
import { useTeam } from '../lib/hooks';
import { useRoom } from './MeetingPage';

const MODES: Record<PairingMode, { name: string; roles: [string, string]; hint: string }> = {
  'driver-navigator': {
    name: 'Driver and navigator',
    roles: ['Driver', 'Navigator'],
    hint: 'The driver types and thinks about the detail; the navigator reviews, thinks ahead and keeps the bigger picture.',
  },
  'strong-style': {
    name: 'Strong-style',
    roles: ['Driver', 'Navigator'],
    hint: 'For an idea to go from your head into the computer, it must go through someone else’s hands. The navigator explains; the driver types.',
  },
  'ping-pong': {
    name: 'Ping-pong',
    roles: ['Writes the next failing test', 'Makes it pass, then refactors'],
    hint: 'One person writes a failing test, the other makes it pass and refactors, then you swap. Works well with test-driven development.',
  },
  mob: {
    name: 'Mob (ensemble)',
    roles: ['Driver', 'Next driver'],
    hint: 'The whole group works on one thing at one computer. The driver types; everyone else navigates. Rotate often.',
  },
};

export function PairingRoom() {
  const { view, send, ended } = useRoom();
  const { snap, name } = useTeam();
  const data = view.data as PairingView;
  const mode = MODES[data.mode];
  const n = data.participants.length;
  const driver = data.participants[data.driverIndex];
  const next = n > 1 ? data.participants[(data.driverIndex + 1) % n] : undefined;
  const running = view.timer.endsAt !== null;

  return (
    <div className="pairing-layout">
      <section className="card pair-now" aria-live="polite" aria-labelledby="now-h">
        <h2 id="now-h" className="sr-only">
          Current roles
        </h2>
        <div className="pair-roles">
          <div className="pair-role">
            <span className="eyebrow">{mode.roles[0]}</span>
            {driver && <Avatar id={driver} name={name(driver)} size={64} />}
            <strong>{driver ? name(driver) : '–'}</strong>
          </div>
          {next && (
            <div className="pair-role">
              <span className="eyebrow">{mode.roles[1]}</span>
              <Avatar id={next} name={name(next)} size={64} />
              <strong>{name(next)}</strong>
            </div>
          )}
        </div>
        <p className="small muted">{mode.hint}</p>
        {!ended && (
          <div className="row wrap center">
            <Button variant="primary" onClick={() => send({ type: 'startRotation' })}>
              <Icon name="play" /> {running ? 'Restart' : 'Start'} {Math.round(data.intervalSeconds / 60)} min
            </Button>
            <Button onClick={() => send({ type: 'rotate' })}>
              <Icon name="shuffle" /> Swap now
            </Button>
          </div>
        )}
        <p className="small muted">Rotations so far: {data.rotations}</p>
      </section>
      {!ended && (
        <section className="card stack" aria-labelledby="setup-h">
          <h2 id="setup-h">Set-up</h2>
          <label className="field">
            <span>Style</span>
            <select className="input" value={data.mode} onChange={(e) => send({ type: 'setMode', mode: e.target.value as PairingMode })}>
              {Object.entries(MODES).map(([id, m]) => (
                <option key={id} value={id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Minutes per rotation</span>
            <input
              className="input input-short"
              type="number"
              min={0.5}
              max={60}
              step={0.5}
              defaultValue={data.intervalSeconds / 60}
              key={data.intervalSeconds}
              onBlur={(e) => {
                const s = Math.round(Number(e.target.value) * 60);
                if (s >= 30 && s !== data.intervalSeconds) void send({ type: 'setInterval', seconds: s });
              }}
            />
          </label>
          <label className="check">
            <input type="checkbox" checked={data.autoRotate} onChange={(e) => send({ type: 'setAutoRotate', autoRotate: e.target.checked })} />
            Swap automatically when the time is up
          </label>
          <fieldset>
            <legend>Who is pairing (in rotation order)</legend>
            <div className="check-list">
              {snap.team.members.map((m) => (
                <label key={m.userId} className="check">
                  <input
                    type="checkbox"
                    checked={data.participants.includes(m.userId)}
                    onChange={(e) =>
                      send({ type: 'setParticipants', participants: e.target.checked ? [...data.participants, m.userId] : data.participants.filter((x) => x !== m.userId) })
                    }
                  />
                  {m.displayName}
                </label>
              ))}
            </div>
          </fieldset>
        </section>
      )}
    </div>
  );
}
