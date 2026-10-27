import { LEVEL_NAMES, LIMITS, RISK_CATEGORIES, riskBand, riskScore, type RiskDTO, type RiskLevel } from '@sprintwell/shared';
import { useState, type FormEvent } from 'react';
import { HowTo } from '../components/Guide';
import { Badge, Button, ConfirmButton, Empty, Field, Icon, Modal } from '../components/ui';
import { PAGE_GUIDES } from '../content/guides';
import { api } from '../lib/api';
import { useAction, usePageTitle, useTeam } from '../lib/hooks';

const CATEGORY_NAMES: Record<string, string> = {
  legal: 'Legal',
  ethical: 'Ethical',
  social: 'Social',
  professional: 'Professional',
  security: 'Security',
  technical: 'Technical',
  other: 'Other',
};

const bandTone = { low: 'good', medium: 'warn', high: 'bad' } as const;

export function RisksPage() {
  const { snap, name } = useTeam();
  const [editing, setEditing] = useState<RiskDTO | 'new' | null>(null);
  const [cell, setCell] = useState<{ l: number; i: number } | null>(null);
  usePageTitle('Risk register');
  const risks = [...snap.risks].sort((a, b) => riskScore(b.likelihood, b.impact) - riskScore(a.likelihood, a.impact));
  const shown = cell ? risks.filter((r) => r.likelihood === cell.l && r.impact === cell.i) : risks;
  const open = risks.filter((r) => r.status !== 'closed');

  return (
    <div className="page stack">
      <div className="row between wrap">
        <div>
          <h1>Risk register</h1>
          <p className="muted small">Identify project risks, rate likelihood and impact, and agree countermeasures. Review it regularly, for example during Sprint Planning.</p>
        </div>
        <Button variant="primary" onClick={() => setEditing('new')}>
          <Icon name="plus" /> Add risk
        </Button>
      </div>

      <HowTo id="risks" guide={PAGE_GUIDES.risks} />

      <div className="risk-layout">
        <section className="card" aria-labelledby="heat-h">
          <h2 id="heat-h">Heat map</h2>
          <p className="small muted">Open and mitigated risks. Select a cell to filter the table.</p>
          <div className="heatmap" role="group" aria-label="Risks by likelihood and impact">
            <div className="heat-axis-y" aria-hidden="true">
              Likelihood
            </div>
            {[3, 2, 1].map((l) => (
              <div key={l} className="heat-row">
                <span className="heat-label">
                  {LEVEL_NAMES[l]}
                </span>
                {[1, 2, 3].map((i) => {
                  const n = open.filter((r) => r.likelihood === l && r.impact === i).length;
                  const band = riskBand(riskScore(l, i));
                  const active = cell?.l === l && cell?.i === i;
                  return (
                    <button
                      key={i}
                      type="button"
                      className={`heat-cell heat-${band}${active ? ' active' : ''}`}
                      aria-pressed={active}
                      aria-label={`Likelihood ${LEVEL_NAMES[l]}, impact ${LEVEL_NAMES[i]}: ${n} risk${n === 1 ? '' : 's'} (${band})`}
                      onClick={() => setCell(active ? null : { l, i })}
                    >
                      {n || ''}
                    </button>
                  );
                })}
              </div>
            ))}
            <div className="heat-row heat-foot" aria-hidden="true">
              <span />
              {[1, 2, 3].map((i) => (
                <span key={i} className="heat-label">
                  {LEVEL_NAMES[i]}
                </span>
              ))}
            </div>
            <div className="heat-axis-x" aria-hidden="true">
              Impact
            </div>
          </div>
          {cell && (
            <Button small variant="ghost" onClick={() => setCell(null)}>
              Show all risks
            </Button>
          )}
        </section>

        <section aria-labelledby="table-h" className="risk-table-wrap">
          <h2 id="table-h" className="sr-only">
            Risks
          </h2>
          {shown.length === 0 ? (
            <Empty title="No risks recorded">Think about legal, ethical, social, professional and security risks as well as technical ones.</Empty>
          ) : (
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Risk</th>
                    <th scope="col">Category</th>
                    <th scope="col">Likelihood</th>
                    <th scope="col">Impact</th>
                    <th scope="col">Countermeasure</th>
                    <th scope="col">Owner</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.id}>
                      <th scope="row">
                        <button type="button" className="link-btn" onClick={() => setEditing(r)}>
                          {r.title}
                        </button>
                        {r.description && <span className="block small muted">{r.description}</span>}
                      </th>
                      <td>{CATEGORY_NAMES[r.category]}</td>
                      <td>{LEVEL_NAMES[r.likelihood]}</td>
                      <td>{LEVEL_NAMES[r.impact]}</td>
                      <td className="small">{r.countermeasure || <span className="muted">None yet</span>}</td>
                      <td>{r.ownerId ? name(r.ownerId) : <span className="muted">No owner</span>}</td>
                      <td>
                        <Badge tone={r.status === 'closed' ? 'neutral' : bandTone[riskBand(riskScore(r.likelihood, r.impact))]}>
                          {r.status === 'open' ? `${riskBand(riskScore(r.likelihood, r.impact))} · open` : r.status}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
      {editing && <RiskEditor risk={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function RiskEditor({ risk, onClose }: { risk: RiskDTO | null; onClose(): void }) {
  const { snap, teamId } = useTeam();
  const run = useAction();
  const [d, setD] = useState({
    title: risk?.title ?? '',
    description: risk?.description ?? '',
    category: risk?.category ?? 'technical',
    likelihood: risk?.likelihood ?? 2,
    impact: risk?.impact ?? 2,
    countermeasure: risk?.countermeasure ?? '',
    ownerId: risk?.ownerId ?? null,
    status: risk?.status ?? 'open',
  });
  const save = async (e: FormEvent) => {
    e.preventDefault();
    const ok = await run(() => (risk ? api('PATCH', `/api/teams/${teamId}/risks/${risk.id}`, d) : api('POST', `/api/teams/${teamId}/risks`, d)));
    if (ok) onClose();
  };
  const levels = [1, 2, 3] as RiskLevel[];
  return (
    <Modal open onClose={onClose} title={risk ? 'Edit risk' : 'Add a risk'}>
      <form onSubmit={save} className="stack">
        <Field label="Risk">{(id) => <input id={id} className="input" required maxLength={LIMITS.title} value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} placeholder="e.g. Personal data stored without consent" />}</Field>
        <Field label="Description (optional)">
          {(id) => <textarea id={id} className="input" rows={2} maxLength={LIMITS.longText} value={d.description} onChange={(e) => setD({ ...d, description: e.target.value })} />}
        </Field>
        <div className="row wrap">
          <Field label="Category">
            {(id) => (
              <select id={id} className="input" value={d.category} onChange={(e) => setD({ ...d, category: e.target.value as RiskDTO['category'] })}>
                {RISK_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_NAMES[c]}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Likelihood">
            {(id) => (
              <select id={id} className="input" value={d.likelihood} onChange={(e) => setD({ ...d, likelihood: Number(e.target.value) as RiskLevel })}>
                {levels.map((l) => (
                  <option key={l} value={l}>
                    {LEVEL_NAMES[l]}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Impact">
            {(id) => (
              <select id={id} className="input" value={d.impact} onChange={(e) => setD({ ...d, impact: Number(e.target.value) as RiskLevel })}>
                {levels.map((l) => (
                  <option key={l} value={l}>
                    {LEVEL_NAMES[l]}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
        <Field label="Countermeasure" hint="What will you do to reduce the likelihood or the impact?">
          {(id, h) => <textarea id={id} aria-describedby={h} className="input" rows={3} maxLength={LIMITS.longText} value={d.countermeasure} onChange={(e) => setD({ ...d, countermeasure: e.target.value })} />}
        </Field>
        <div className="row wrap">
          <Field label="Owner">
            {(id) => (
              <select id={id} className="input" value={d.ownerId ?? ''} onChange={(e) => setD({ ...d, ownerId: e.target.value || null })}>
                <option value="">No owner</option>
                {snap.team.members.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.displayName}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Status">
            {(id) => (
              <select id={id} className="input" value={d.status} onChange={(e) => setD({ ...d, status: e.target.value as RiskDTO['status'] })}>
                <option value="open">Open</option>
                <option value="mitigated">Mitigated</option>
                <option value="closed">Closed</option>
              </select>
            )}
          </Field>
        </div>
        <div className="row between">
          {risk ? (
            <ConfirmButton
              confirmLabel="Delete this risk"
              onConfirm={async () => {
                if (await run(() => api('DELETE', `/api/teams/${teamId}/risks/${risk.id}`))) onClose();
              }}
            >
              Delete
            </ConfirmButton>
          ) : (
            <span />
          )}
          <div className="row">
            <Button onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="primary">
              Save
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
