import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { useNotice } from '../lib/hooks';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({
  variant = 'secondary',
  small,
  busy,
  children,
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; small?: boolean; busy?: boolean }) {
  return (
    <button type="button" {...rest} className={`btn btn-${variant}${small ? ' btn-small' : ''} ${className}`} disabled={rest.disabled || busy} aria-busy={busy || undefined}>
      {children}
    </button>
  );
}

/** Accessible modal built on the native <dialog> element (focus trapping and Esc for free). */
export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose(): void; title: string; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={`modal${wide ? ' modal-wide' : ''}`}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      {open && (
        <div className="modal-body">
          <div className="modal-head">
            <h2 id={titleId}>{title}</h2>
            <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
              <Icon name="close" />
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}

export function Field({ label, hint, children, id }: { label: ReactNode; hint?: ReactNode; children: (id: string, describedBy?: string) => ReactNode; id?: string }) {
  const auto = useId();
  const fid = id ?? auto;
  const hintId = hint ? `${fid}-hint` : undefined;
  return (
    <div className="field">
      <label htmlFor={fid}>{label}</label>
      {hint && (
        <p className="hint" id={hintId}>
          {hint}
        </p>
      )}
      {children(fid, hintId)}
    </div>
  );
}

const AVATAR_COLOURS = ['#0e7c6b', '#7a4bc2', '#c2410c', '#1d4ed8', '#a21caf', '#15803d', '#b45309', '#0369a1'];

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return ((parts[0]![0] ?? '') + (parts.length > 1 ? (parts[parts.length - 1]![0] ?? '') : '')).toUpperCase();
}

function colourFor(id: string): string {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLOURS[h % AVATAR_COLOURS.length]!;
}

export function Avatar({ id, name, size = 32, online, badge }: { id: string; name: string; size?: number; online?: boolean; badge?: ReactNode }) {
  return (
    <span className={`avatar${online === false ? ' avatar-away' : ''}`} style={{ width: size, height: size, background: colourFor(id), fontSize: size * 0.4 }} title={name}>
      <span aria-hidden="true">{initials(name)}</span>
      {badge && <span className="avatar-badge">{badge}</span>}
    </span>
  );
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'info' }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <p className="empty-title">{title}</p>
      {children && <div className="empty-body">{children}</div>}
    </div>
  );
}

export function CopyButton({ text, label = 'Copy', copiedLabel = 'Copied' }: { text: string; label?: string; copiedLabel?: string }) {
  const [copied, setCopied] = useState(false);
  const { notify } = useNotice();
  return (
    <Button
      small
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 2000);
        } catch {
          notify('Copying is blocked in this browser. Select the text and copy it instead.', 'error');
        }
      }}
    >
      <Icon name={copied ? 'check' : 'copy'} /> {copied ? copiedLabel : label}
    </Button>
  );
}

/** Text that turns into an input when edited; saves on Enter or blur, cancels on Escape. */
export function InlineEdit({ value, onSave, label, multiline, maxLength = 500 }: { value: string; onSave(v: string): void | Promise<unknown>; label: string; multiline?: boolean; maxLength?: number }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  if (!editing) {
    return (
      <button type="button" className="inline-edit" onClick={() => setEditing(true)} aria-label={`${label}: ${value}. Edit`}>
        {value}
      </button>
    );
  }
  const commit = async () => {
    setEditing(false);
    const v = draft.trim();
    if (v && v !== value) await onSave(v);
    else setDraft(value);
  };
  const common = {
    className: 'input',
    value: draft,
    autoFocus: true,
    maxLength,
    'aria-label': label,
    onChange: (e: { target: { value: string } }) => setDraft(e.target.value),
    onBlur: commit,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !(multiline && e.shiftKey)) {
        e.preventDefault();
        void commit();
      }
      if (e.key === 'Escape') {
        setDraft(value);
        setEditing(false);
      }
    },
  };
  return multiline ? <textarea rows={2} {...common} /> : <input {...common} />;
}

/** Two-step confirmation without browser dialogs. */
export function ConfirmButton({ children, confirmLabel = 'Are you sure?', onConfirm, variant = 'danger', small = true }: { children: ReactNode; confirmLabel?: string; onConfirm(): void; variant?: Variant; small?: boolean }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), 4000);
    return () => window.clearTimeout(t);
  }, [armed]);
  return armed ? (
    <Button
      variant={variant}
      small={small}
      onClick={() => {
        setArmed(false);
        onConfirm();
      }}
    >
      {confirmLabel}
    </Button>
  ) : (
    <Button variant="ghost" small={small} onClick={() => setArmed(true)}>
      {children}
    </Button>
  );
}

const PATHS: Record<string, string> = {
  close: 'M6 6l12 12M18 6L6 18',
  copy: 'M9 9h10v10H9zM5 15V5h10',
  check: 'M5 12l5 5L20 7',
  plus: 'M12 5v14M5 12h14',
  up: 'M12 19V5M5 12l7-7 7 7',
  down: 'M12 5v14M19 12l-7 7-7-7',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  edit: 'M4 20h4L19 9l-4-4L4 16v4z',
  play: 'M7 5l12 7-12 7z',
  pause: 'M8 5v14M16 5v14',
  stop: 'M6 6h12v12H6z',
  users: 'M16 19v-1a4 4 0 00-4-4H7a4 4 0 00-4 4v1M9.5 10a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM21 19v-1a4 4 0 00-3-3.9M15 3.1a3.5 3.5 0 010 6.8',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  external: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
  star: 'M12 4l2.5 5 5.5.8-4 3.9.9 5.5-4.9-2.6-4.9 2.6.9-5.5-4-3.9 5.5-.8z',
  heart: 'M12 20s-7-4.4-7-10a4 4 0 017-2.6A4 4 0 0119 10c0 5.6-7 10-7 10z',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  back: 'M19 12H5M11 18l-6-6 6-6',
  shuffle: 'M4 7h4l8 10h4M4 17h4l2.5-3M14 7h6M17 4l3 3-3 3M17 14l3 3-3 3',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 100-6 3 3 0 000 6z',
  link: 'M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1',
  flag: 'M5 21V4h11l-2 4 2 4H5',
  timer: 'M12 8v5l3 2M9 2h6M12 22a8 8 0 100-16 8 8 0 000 16z',
  info: 'M12 22a10 10 0 100-20 10 10 0 000 20zM12 16v-4M12 8h.01',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4M8 14h3',
  sun: 'M12 16a4 4 0 100-8 4 4 0 000 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  present: 'M3 4h18M5 4v10h14V4M12 14v4M8 21l4-3 4 3M9 10l2-2 2 2 3-3',
  loop: 'M4 12a8 8 0 0114-5.3L20 9M20 4v5h-5M20 12a8 8 0 01-14 5.3L4 15M4 20v-5h5',
  cards: 'M7 3h9a2 2 0 012 2v12a2 2 0 01-2 2H7a2 2 0 01-2-2V5a2 2 0 012-2zM11.5 8l2 3-2 3-2-3z',
  pair: 'M8 11a3 3 0 100-6 3 3 0 000 6zM16 11a3 3 0 100-6 3 3 0 000 6zM2 20v-1a4 4 0 014-4h4a4 4 0 014 4v1M14 15h4a4 4 0 014 4v1',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  list: 'M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01',
  book: 'M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2zM4 5v16M8 7h7',
};

export function Icon({ name, size = 18, label }: { name: keyof typeof PATHS | string; size?: number; label?: string }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <path d={PATHS[name] ?? ''} />
    </svg>
  );
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mmss = `${String(m).padStart(h ? 2 : 1, '0')}:${String(s).padStart(2, '0')}`;
  return h ? `${h}:${mmss}` : mmss;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function relativeDays(iso: string): string {
  const days = Math.round((new Date(`${iso}T23:59:59`).getTime() - Date.now()) / 86_400_000);
  if (days > 1) return `${days} days left`;
  if (days === 1) return '1 day left';
  if (days === 0) return 'Ends today';
  return `Ended ${-days} day${days === -1 ? '' : 's'} ago`;
}
