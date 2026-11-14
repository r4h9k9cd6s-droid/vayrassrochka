import { useEffect, useId, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import type { Segment } from '@vayrassrochka/shared';
import { staleText, money as fmtMoney, plural } from './format';
import { navigate, usePath } from './router';
import { useAuth } from './store';

const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
const svg = (children: ReactNode, vb = '0 0 24 24') => <svg viewBox={vb} aria-hidden="true" {...S}>{children}</svg>;

export const Icons = {
  feed: svg(<><rect x="3" y="3" width="8" height="8" rx="2" /><rect x="13" y="3" width="8" height="8" rx="2" /><rect x="3" y="13" width="8" height="8" rx="2" /><rect x="13" y="13" width="8" height="8" rx="2" /></>),
  home: svg(<><path d="M4 11l8-7 8 7" /><path d="M6 10v10h12V10" /></>),
  list: svg(<><path d="M8 6h12M8 12h12M8 18h12" /><circle cx="4" cy="6" r="1" /><circle cx="4" cy="12" r="1" /><circle cx="4" cy="18" r="1" /></>),
  settings: svg(<><circle cx="12" cy="12" r="3" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" /></>),
  user: svg(<><circle cx="12" cy="8" r="4" /><path d="M4 21c1-4 4-6 8-6s7 2 8 6" /></>),
  eye: svg(<><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>),
  eyeOff: svg(<><path d="M3 3l18 18" /><path d="M10.6 6.1A9.6 9.6 0 0112 5c6 0 10 7 10 7a17 17 0 01-3.2 3.9M6.5 6.9C3.7 8.7 2 12 2 12s4 7 10 7c1.5 0 2.9-.4 4.1-1" /></>),
  down: svg(<path d="M6 9l6 6 6-6" />),
  up: svg(<path d="M6 15l6-6 6 6" />),
  back: svg(<path d="M15 5l-7 7 7 7" />),
  plus: svg(<path d="M12 5v14M5 12h14" />),
  minus: svg(<path d="M5 12h14" />),
  wa: svg(<><path d="M4 20l1.3-4.2A8 8 0 1112 20a8 8 0 01-3.8-1z" /><path d="M9 9c0 3 3 6 6 6l1-1.5-2-1-1 .7c-1-.4-2-1.4-2.3-2.4l.8-1-1-2z" /></>),
};

export type IconName = 'phone' | 'laptop' | 'console' | 'sofa' | 'kitchen' | 'bag';
const PRODUCT: Record<IconName, ReactNode> = {
  phone: svg(<><rect x="7" y="2.5" width="10" height="19" rx="2.5" /><path d="M11 18.5h2" /></>),
  laptop: svg(<><rect x="4" y="5" width="16" height="11" rx="2" /><path d="M2 20h20" /></>),
  console: svg(<><rect x="2.5" y="8" width="19" height="9" rx="4.5" /><path d="M7 10.5v4M5 12.5h4" /><circle cx="16" cy="12" r=".6" /><circle cx="18" cy="13.5" r=".6" /></>),
  sofa: svg(<><path d="M5 11V8a3 3 0 013-3h8a3 3 0 013 3v3" /><rect x="2.5" y="11" width="19" height="6" rx="2" /><path d="M5 17v2M19 17v2" /></>),
  kitchen: svg(<><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 12h18M12 3v18M8 7.5v1M16 16.500v1" /></>),
  bag: svg(<><path d="M5 8h14l-1 12H6L5 8z" /><path d="M9 8V6a3 3 0 016 0v2" /></>),
};
export function ProductTile({ icon, category }: { icon: string; category?: string }) {
  return <div className={`tile ${category === 'furniture' ? 'furniture' : ''}`}>{PRODUCT[(icon as IconName) in PRODUCT ? (icon as IconName) : 'bag']}</div>;
}

export function Money({ value, className }: { value: number; className?: string }) {
  const { me } = useAuth();
  return <span className={className}>{me?.hideAmounts ? '••••\u00a0₽' : fmtMoney(value)}</span>;
}

export function Btn({ kind, block, sm, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { kind?: 'o' | 'g' | 'danger'; block?: boolean; sm?: boolean }) {
  return <button {...p} className={`btn ${kind ?? ''} ${block ? 'block' : ''} ${sm ? 'sm' : ''} ${p.className ?? ''}`} />;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="field">
      <label className="field">
        <span>{label}</span>
        {children}
      </label>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

/** Поле суммы/числа с кнопками − и +. */
export function Stepper({ value, onChange, step = 1000, min = 0, max = 1e9, label, hint }: { value: number; onChange: (n: number) => void; step?: number; min?: number; max?: number; label: string; hint?: string }) {
  const clamp = (n: number) => Math.min(max, Math.max(min, Math.round(n)));
  const id = useId();
  return (
    <div className="field">
      <span id={id}>{label}</span>
      <div className="stepper">
        <Btn type="button" kind="g" aria-label={`${label}: меньше`} onClick={() => onChange(clamp(value - step))}>{Icons.minus}</Btn>
        <input className="input" inputMode="numeric" aria-labelledby={id} value={value || ''} placeholder="0" onChange={(e) => onChange(clamp(Number(e.target.value.replace(/\D/g, '')) || 0))} />
        <Btn type="button" kind="g" aria-label={`${label}: больше`} onClick={() => onChange(clamp(value + step))}>{Icons.plus}</Btn>
      </div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="sheet-back" onClick={onClose}>
      <div className="sheet stack" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="row between"><h2>{title}</h2><Btn kind="g" sm onClick={onClose} aria-label="Закрыть">✕</Btn></div>
        {children}
      </div>
    </div>
  );
}

/** Сегментная полоска. Красный и чёрный всегда дублируются подписью под полоской. */
export function SegmentBar({ segments, onSegment }: { segments: Segment[]; onSegment?: (s: Segment) => void }) {
  const has = (st: string) => segments.some((s) => s.status === st);
  return (
    <div>
      <div className="bar" role="img" aria-label={segments.map((s) => ({ paid: 'оплачен', overdue: 'просрочен', skipped: 'пропуск', upcoming: 'впереди' })[s.status]).join(', ')}>
        {segments.map((s) => {
          const grow = s.status === 'paid' ? Math.min(3, Math.max(0.25, s.paid / Math.max(1, s.planned))) : 1;
          return <i key={s.id} className={s.status} style={{ flex: grow }} onClick={onSegment ? () => onSegment(s) : undefined} />;
        })}
      </div>
      {(has('overdue') || has('skipped')) && (
        <div className="legend">
          {has('overdue') && <b className="bad">Просрочено</b>}
          {has('skipped') && <span><b>■</b> Пропуск по договорённости</span>}
        </div>
      )}
    </div>
  );
}

export function Skeletons({ n = 3 }: { n?: number }) {
  return <div className="stack" aria-busy="true" aria-label="Загрузка">{Array.from({ length: n }, (_, i) => <div key={i} className="skeleton" />)}</div>;
}
export const StaleNote = ({ at }: { at: number | null }) => (at ? <div className="banner" role="status">Нет интернета. {staleText(at)}</div> : null);

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="empty stack"><div style={{ fontWeight: 700, color: 'var(--text)' }}>{title}</div>{children}</div>;
}

export function Link({ to, children, className, ...rest }: { to: string; children: ReactNode; className?: string } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>) {
  return <a href={to} className={className} {...rest} onClick={(e) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); navigate(to); }}>{children}</a>;
}

export function Nav() {
  const path = usePath();
  const items = [
    { to: '/', label: 'Лента', icon: Icons.feed, on: path === '/' || path.startsWith('/feed') },
    { to: '/home', label: 'Главная', icon: Icons.home, on: path.startsWith('/home') },
    { to: '/installments', label: 'Рассрочки', icon: Icons.list, on: path.startsWith('/installments') || path.startsWith('/pots') },
  ];
  const { me } = useAuth();
  const links = items.map((i) => <Link key={i.to} to={i.to} className={i.on ? 'on' : ''} aria-current={i.on ? 'page' : undefined}><span className="ic">{i.icon}</span>{i.label}</Link>);
  return (
    <>
      <nav className="nav nav-side" aria-label="Разделы">
        <div style={{ fontWeight: 800, fontSize: 20, padding: '0 14px 16px' }}>ВайРассрочка</div>
        {links}
        <div className="spacer" />
        <Link to={me ? '/settings' : '/login'} className={path.startsWith('/settings') ? 'on' : ''}><span className="ic">{Icons.settings}</span>{me ? 'Настройки' : 'Войти'}</Link>
      </nav>
      <nav className="nav nav-bottom" aria-label="Разделы">{links}</nav>
    </>
  );
}

export function useOnline(): boolean {
  const [on, setOn] = useState(navigator.onLine);
  useEffect(() => {
    const u = () => setOn(true), d = () => setOn(false);
    window.addEventListener('online', u);
    window.addEventListener('offline', d);
    return () => { window.removeEventListener('online', u); window.removeEventListener('offline', d); };
  }, []);
  return on;
}

export const paymentsWord = (n: number) => `${n} ${plural(n, 'платёж', 'платежа', 'платежей')}`;
