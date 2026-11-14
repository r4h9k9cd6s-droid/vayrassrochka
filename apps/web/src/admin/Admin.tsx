import { useRef, useState } from 'react';
import { api, errorText, useResource } from '../api';
import { agoRu, money } from '../format';
import { match, usePath } from '../router';
import { Btn, Field, Link, Skeletons } from '../ui';

const REASONS: Record<string, string> = { personal_data: 'Персональные данные', wrong_seller: 'Неверный продавец', spam: 'Реклама или спам', other: 'Другое' };
interface Rec { id: string; title: string; cost: number; termMonths: number; feedState: string; doubtful: boolean; createdAt: string; extraTerms: string; seller: { id: string; type: string; name: string; address: string; phone: string; hidden: boolean } | null }

function Login({ onDone }: { onDone: () => void }) {
  const [login, setLogin] = useState(''); const [password, setPassword] = useState('');
  const [cells, setCells] = useState(['', '', '', '', '', '']); const [spare, setSpare] = useState(''); const [trust, setTrust] = useState(false); const [err, setErr] = useState('');
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const code = spare || cells.join('');
  const setCell = (i: number, v: string) => {
    const d = v.replace(/\D/g, '').slice(-1);
    setCells((c) => c.map((x, k) => (k === i ? d : x)));
    if (d && i < 5) refs.current[i + 1]?.focus();
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try { await api('POST', '/api/admin/login', { login, password, code, trustDevice: trust }); onDone(); } catch (x) { setErr(errorText(x)); }
  };
  return (
    <div className="admin" style={{ gridTemplateColumns: '1fr 1fr' }}>
      <aside style={{ justifyContent: 'center', padding: 48 }}><h1>ВайРассрочка</h1><div>Панель владельца</div></aside>
      <section style={{ alignSelf: 'center' }}>
        <form className="stack" onSubmit={submit}>
          <h1>Вход</h1>
          <Field label="Логин"><input className="input" value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="username" required /></Field>
          <Field label="Пароль"><input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></Field>
          <div><div className="muted">Код из приложения-аутентификатора</div>
            <div className="cells">{cells.map((c, i) => <input key={i} ref={(el) => { refs.current[i] = el; }} className="input" inputMode="numeric" value={c} aria-label={`Цифра ${i + 1}`} onChange={(e) => setCell(i, e.target.value)} onKeyDown={(e) => e.key === 'Backspace' && !c && i > 0 && refs.current[i - 1]?.focus()} />)}</div></div>
          <Field label="Или резервный код владельца"><input className="input" value={spare} onChange={(e) => setSpare(e.target.value)} /></Field>
          <label className="check"><input type="checkbox" checked={trust} onChange={(e) => setTrust(e.target.checked)} />Доверять этому устройству 30 дней</label>
          {err && <div className="banner bad" role="alert">! {err}</div>}
          <Btn block>Войти</Btn>
        </form>
      </section>
    </div>
  );
}

const MENU = [['', 'Обзор'], ['complaints', 'Жалобы'], ['sellers', 'Продавцы'], ['review', 'На проверке'], ['feedback', 'Отзывы о приложении'], ['log', 'Журнал и корзина']] as const;

export function AdminApp() {
  const path = usePath();
  const sub = match('/admin/:s', path)?.s ?? '';
  const me = useResource<{ admin: { login: string; role: string } }>(null, '/api/admin/me', [path === '/admin']);
  const [, force] = useState(0);
  if (me.loading) return <div className="page"><Skeletons n={1} /></div>;
  if (me.error || !me.data) return <Login onDone={() => { me.reload(); force((x) => x + 1); }} />;
  return (
    <div className="admin">
      <aside>
        <b style={{ padding: '0 14px 16px', fontSize: 18 }}>ВайРассрочка · панель</b>
        {MENU.map(([id, l]) => <Link key={id} to={`/admin${id ? '/' + id : ''}`} className={sub === id ? 'on' : ''}>{l}</Link>)}
        <div style={{ flex: 1 }} />
        <div className="muted" style={{ padding: '0 14px', color: '#bcd3c6' }}>{me.data.admin.login} · {me.data.admin.role === 'owner' ? 'Владелец' : 'Модератор'}</div>
        <a href="/admin" onClick={async (e) => { e.preventDefault(); await api('POST', '/api/admin/logout'); location.href = '/admin'; }}>Выйти</a>
      </aside>
      <section className="stack">
        {sub === '' && <Overview />}{sub === 'complaints' && <Complaints />}{sub === 'sellers' && <Sellers />}
        {sub === 'review' && <Review />}{sub === 'feedback' && <Feedback />}{sub === 'log' && <Log />}
      </section>
    </div>
  );
}

function RecordCard({ r }: { r: Rec }) {
  return (
    <div className="stack">
      <b>{r.title}</b>
      <div className="muted">{money(r.cost)} · {r.termMonths} мес. · {agoRu(r.createdAt)} · {r.feedState}{r.doubtful ? ' · данные под вопросом' : ''}</div>
      {r.seller ? <div>Продавец: <b>{r.seller.name || '—'}</b> ({r.seller.type === 'shop' ? 'магазин' : 'частное лицо'}) {r.seller.address} {r.seller.phone && `+${r.seller.phone}`}{r.seller.hidden && ' · скрыт'}</div> : <div>Без продавца</div>}
      {r.extraTerms && <div className="muted">Условия: {r.extraTerms}</div>}
    </div>
  );
}

function Overview() {
  const r = useResource<{ users: number; published: number; toDecide: { complaints: number; review: number; feedback: number } }>(null, '/api/admin/overview');
  if (!r.data) return <Skeletons n={2} />;
  return (<><h1>Обзор</h1>
    <div className="grid2" style={{ display: 'grid', gap: 12 }}><div className="card"><div className="muted">Пользователей</div><div className="big">{r.data.users}</div></div><div className="card"><div className="muted">Записей в ленте</div><div className="big">{r.data.published}</div></div></div>
    <div className="card stack"><h2>Требует решения</h2>
      <Link to="/admin/complaints">Жалобы: {r.data.toDecide.complaints}</Link><Link to="/admin/review">На проверке: {r.data.toDecide.review}</Link><Link to="/admin/feedback">Новые отзывы: {r.data.toDecide.feedback}</Link></div></>);
}

function Complaints() {
  const r = useResource<{ items: { installmentId: string; count: number; reasons: Record<string, number>; record: Rec }[] }>(null, '/api/admin/complaints');
  const [note, setNote] = useState('');
  const act = async (id: string, action: string) => { await api('POST', `/api/admin/complaints/${id}/resolve`, { action, note }); setNote(''); r.reload(); };
  return (<><h1>Жалобы</h1>{r.loading && <Skeletons />}{r.data?.items.length === 0 && <div className="muted">Открытых жалоб нет.</div>}
    {r.data?.items.map((c) => (
      <div key={c.installmentId} className="card stack"><div><b>Жалоб: {c.count}</b> · {Object.entries(c.reasons).map(([k, n]) => `${REASONS[k]} ×${n}`).join(', ')}</div>
        <RecordCard r={c.record} />
        <Field label="Заметка"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <div className="row" style={{ flexWrap: 'wrap' }}><Btn kind="g" onClick={() => act(c.installmentId, 'keep')}>Оставить</Btn><Btn kind="o" onClick={() => act(c.installmentId, 'hide')}>Скрыть из ленты</Btn><Btn kind="danger" onClick={() => act(c.installmentId, 'trash')}>В корзину</Btn></div>
        <SellerEditor id={c.installmentId} onDone={r.reload} /></div>))}</>);
}

function SellerEditor({ id, onDone }: { id: string; onDone: () => void }) {
  const [open, setOpen] = useState(false); const [f, setF] = useState({ type: 'shop' as 'shop' | 'person', name: '', address: '', phone: '' });
  if (!open) return <Btn kind="g" sm onClick={() => setOpen(true)} style={{ alignSelf: 'flex-start' }}>Изменить продавца</Btn>;
  return (
    <div className="stack card" style={{ background: 'var(--bg)' }}>
      <div className="pills">{(['shop', 'person'] as const).map((t) => <button key={t} className={`pill ${f.type === t ? 'on' : ''}`} onClick={() => setF({ ...f, type: t })}>{t === 'shop' ? 'Магазин' : 'Частное лицо'}</button>)}</div>
      <input className="input" placeholder="Название" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      <input className="input" placeholder="Адрес" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} />
      <input className="input" placeholder="Телефон" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
      <Btn onClick={async () => { await api('POST', `/api/admin/installments/${id}/seller`, { seller: f, returnToFeed: true }); setOpen(false); onDone(); }}>Сохранить и вернуть в ленту</Btn>
    </div>
  );
}

function Review() {
  const r = useResource<{ items: Rec[] }>(null, '/api/admin/review');
  return (<><h1>На проверке</h1><div className="muted">Записи, скрытые из ленты: данные продавца под вопросом, автор давно не заходил.</div>{r.loading && <Skeletons />}
    {r.data?.items.length === 0 && <div className="muted">Нечего проверять.</div>}
    {r.data?.items.map((x) => <div key={x.id} className="card stack"><RecordCard r={x} /><SellerEditor id={x.id} onDone={r.reload} />
      <div className="row"><Btn kind="g" onClick={async () => { await api('POST', `/api/admin/installments/${x.id}/state`, { state: 'visible' }); r.reload(); }}>Вернуть в ленту</Btn><Btn kind="danger" onClick={async () => { await api('POST', `/api/admin/installments/${x.id}/state`, { state: 'trash' }); r.reload(); }}>В корзину</Btn></div></div>)}</>);
}

function Sellers() {
  const [q, setQ] = useState('');
  const r = useResource<{ items: { id: string; type: string; name: string; address: string; phone: string; hidden: boolean }[] }>(null, `/api/admin/sellers?q=${encodeURIComponent(q)}`, [q]);
  const [merge, setMerge] = useState<string | null>(null);
  return (<><h1>Продавцы</h1><input className="input" placeholder="Поиск по названию или телефону" value={q} onChange={(e) => setQ(e.target.value)} />
    {r.data?.items.map((s) => (
      <div key={s.id} className="card stack"><div><b>{s.name || '—'}</b> · {s.type === 'shop' ? 'магазин' : 'частное лицо'}{s.hidden && ' · скрыт'}</div><div className="muted">{s.address} {s.phone && `+${s.phone}`}</div>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <Btn kind="g" sm onClick={async () => { const name = prompt('Название', s.name); if (name !== null) { await api('PATCH', `/api/admin/sellers/${s.id}`, { name }); r.reload(); } }}>Править</Btn>
          <Btn kind="g" sm onClick={async () => { await api('PATCH', `/api/admin/sellers/${s.id}`, { hidden: !s.hidden }); r.reload(); }}>{s.hidden ? 'Показать' : 'Скрыть'}</Btn>
          {merge === null ? <Btn kind="g" sm onClick={() => setMerge(s.id)}>Объединить с…</Btn> : merge === s.id ? <Btn kind="o" sm onClick={() => setMerge(null)}>Отмена</Btn> : <Btn sm onClick={async () => { if (confirm('Все записи переедут к этому продавцу, выбранный дубль удалится.')) { await api('POST', '/api/admin/sellers/merge', { fromId: merge, toId: s.id }); setMerge(null); r.reload(); } }}>Оставить этого, слить выбранный</Btn>}
        </div></div>))}</>);
}

function Feedback() {
  const r = useResource<{ items: { id: string; text: string; status: string; createdAt: string }[] }>(null, '/api/admin/feedback');
  const set = async (id: string, status: string) => { await api('PATCH', `/api/admin/feedback/${id}`, { status }); r.reload(); };
  return (<><h1>Отзывы о приложении</h1>{r.data?.items.length === 0 && <div className="muted">Пока нет.</div>}
    {r.data?.items.map((f) => <div key={f.id} className="card stack"><div style={{ whiteSpace: 'pre-wrap' }}>{f.text}</div><div className="muted">{agoRu(f.createdAt)} · {f.status}</div>
      <div className="row"><Btn kind="g" sm onClick={() => set(f.id, 'planned')}>Взять в план</Btn><Btn kind="g" sm onClick={() => set(f.id, 'closed')}>Закрыть</Btn></div></div>)}</>);
}

function Log() {
  const log = useResource<{ items: { id: string; action: string; targetType: string; targetId: string; before: unknown; after: unknown; createdAt: string }[] }>(null, '/api/admin/audit');
  const trash = useResource<{ items: (Rec & { trashedAt: string })[] }>(null, '/api/admin/trash');
  return (<><h1>Журнал и корзина</h1>
    <div className="card stack"><h2>Корзина (30 дней)</h2>{trash.data?.items.length === 0 && <div className="muted">Пусто.</div>}
      {trash.data?.items.map((x) => <div key={x.id} className="row between"><RecordCard r={x} /><Btn kind="g" sm onClick={async () => { await api('POST', `/api/admin/installments/${x.id}/state`, { state: 'visible' }); trash.reload(); }}>Восстановить</Btn></div>)}</div>
    <div className="card"><h2>Журнал решений</h2><table className="table"><thead><tr><th>Когда</th><th>Действие</th><th>Было → стало</th></tr></thead><tbody>
      {log.data?.items.map((l) => <tr key={l.id}><td>{new Date(l.createdAt).toLocaleString('ru-RU')}</td><td>{l.action}</td><td><code style={{ fontSize: 12 }}>{JSON.stringify(l.before)} → {JSON.stringify(l.after)}</code></td></tr>)}</tbody></table></div></>);
}
