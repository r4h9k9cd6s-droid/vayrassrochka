import { useEffect, useState } from 'react';
import { CATEGORIES } from '@vayrassrochka/shared';
import { api, errorText, useResource } from '../api';
import { agoRu, dateRu, money, phonePretty, plural, waLink } from '../format';
import { shareInvite } from '../invite';
import { match, navigate, usePath } from '../router';
import { useAuth } from '../store';
import { Btn, Empty, Icons, Link, ProductTile, Sheet, Skeletons, StaleNote, Stepper } from '../ui';

interface Seller { type: 'shop' | 'person'; hidden?: boolean; name?: string; address?: string; phone?: string }
export interface FeedItem {
  id: string; title: string; icon: string; category: string; cost: number; downPayment: number; termMonths: number;
  monthlyPayment: number; purchaseDate: string; extraTerms: string; createdAt: string; doubtful: boolean;
  contacted: number; mine: boolean; myAnswer: 'yes' | 'no' | null; seller: Seller | null;
}
interface Filters { category: string; q: string; maxMonthly: number; term: string; sort: string }
const DEFAULTS: Filters = { category: '', q: '', maxMonthly: 0, term: '', sort: 'new' };

const TERMS = [['', 'Любой'], ['upto6', 'До 6 мес.'], ['6to12', '6–12 мес.'], ['over12', 'Больше 12']] as const;
const SORTS = [['new', 'Сначала новые'], ['monthly', 'Платёж меньше'], ['price', 'Цена меньше']] as const;
const REASONS = [['personal_data', 'Персональные данные в записи'], ['wrong_seller', 'Неверный продавец'], ['spam', 'Реклама или спам'], ['other', 'Другое']] as const;

const qs = (f: Filters, limit: number) => {
  const p = new URLSearchParams({ limit: String(limit), sort: f.sort });
  if (f.category) p.set('category', f.category);
  if (f.q.trim()) p.set('q', f.q.trim());
  if (f.maxMonthly > 0) p.set('maxMonthly', String(f.maxMonthly));
  if (f.term) p.set('term', f.term);
  return p.toString();
};

export function FeedCard({ item: initial, open: startOpen = false }: { item: FeedItem; open?: boolean }) {
  const { me, toast } = useAuth();
  const [item, setItem] = useState(initial);
  const [open, setOpen] = useState(startOpen);
  const [sellerOpen, setSellerOpen] = useState(false);
  const [complain, setComplain] = useState(false);
  useEffect(() => setItem(initial), [initial]);

  const answer = async (result: 'yes' | 'no') => {
    if (!me) return navigate('/login');
    try {
      const r = await api<{ item: FeedItem }>('POST', `/api/feed/${item.id}/contact`, { result });
      setItem(r.item);
    } catch (e) { toast(errorText(e)); }
  };
  const undo = async () => {
    try { setItem((await api<{ item: FeedItem }>('DELETE', `/api/feed/${item.id}/contact`)).item); } catch (e) { toast(errorText(e)); }
  };
  const complaint = async (reason: string) => {
    try { await api('POST', `/api/feed/${item.id}/complaint`, { reason }); toast('Спасибо, жалоба отправлена'); setComplain(false); } catch (e) { toast(errorText(e)); }
  };

  const s = item.seller;
  return (
    <article className="card stack">
      <button className="row" style={{ background: 'none', border: 0, padding: 0, textAlign: 'left', width: '100%', cursor: 'pointer' }} onClick={() => setOpen(!open)} aria-expanded={open}>
        <ProductTile icon={item.icon} category={item.category} />
        <div className="grow">
          <div style={{ fontWeight: 700 }}>{item.title}</div>
          <div className="muted">{item.termMonths} мес. · {agoRu(item.createdAt)}</div>
          {item.doubtful && <span className="tag">Данные продавца под вопросом</span>}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontWeight: 800 }}>{money(item.monthlyPayment)}<span className="muted">/мес</span></div>
          <div className="muted">{money(item.cost)}</div>
        </div>
      </button>

      {open && (
        <div className="stack">
          <hr className="hr" />
          <div className="row between"><span className="muted">Первый взнос</span><b>{money(item.downPayment)}</b></div>
          <div className="row between"><span className="muted">Дата покупки</span><b>{dateRu(item.purchaseDate, true)}</b></div>
          <div className="row between"><span className="muted">Условия</span><b>{item.termMonths} мес. по {money(item.monthlyPayment)}</b></div>
          {item.extraTerms && <div className="muted">{item.extraTerms}</div>}

          {s && (
            <button className="seller-btn" onClick={() => setSellerOpen(!sellerOpen)} aria-expanded={sellerOpen}>
              <span className="grow"><span className="muted" style={{ display: 'block' }}>Продавец</span><b>{s.hidden ? 'Данные для зарегистрированных' : (s.name || (s.type === 'shop' ? 'Магазин' : 'Частное лицо'))}</b></span>
              <span className="arrow">{sellerOpen ? Icons.up : Icons.down}</span>
            </button>
          )}
          {s && sellerOpen && (
            <div className="stack">
              {s.hidden ? (
                <div className="banner">Данные частных лиц видны только после входа. <Link to="/login">Войти</Link></div>
              ) : (
                <>
                  <div className="muted">{s.type === 'shop' ? 'Магазин' : 'Частное лицо'}</div>
                  {s.address && <div>{s.address}</div>}
                  {s.phone && (
                    <a className="btn g" href={waLink(s.phone)} target="_blank" rel="noopener noreferrer">{Icons.wa} {phonePretty(s.phone)}</a>
                  )}
                  {item.contacted > 0 && <div className="muted">Удалось связаться: {item.contacted} {plural(item.contacted, 'человек', 'человека', 'человек')}</div>}
                  {!item.mine && (
                    <div className="stack">
                      <b>Удалось связаться с продавцом?</b>
                      {item.myAnswer ? (
                        <div className="row">
                          <span className="muted grow">Ваш ответ: {item.myAnswer === 'yes' ? 'да, удалось' : 'нет, не удалось'}</span>
                          <Btn kind="g" sm onClick={undo}>Отменить ответ</Btn>
                        </div>
                      ) : (
                        <div className="row"><Btn kind="g" onClick={() => answer('yes')}>Да, удалось</Btn><Btn kind="g" onClick={() => answer('no')}>Нет, не удалось</Btn></div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
          {!item.mine && me && <button className="btn g sm" onClick={() => setComplain(true)} style={{ alignSelf: 'flex-start' }}>Пожаловаться на запись</button>}
          {item.mine && <div className="muted">Это ваша запись.</div>}
        </div>
      )}

      {complain && (
        <Sheet title="Пожаловаться на запись" onClose={() => setComplain(false)}>
          {REASONS.map(([id, label]) => <Btn key={id} block kind="o" onClick={() => complaint(id)}>{label}</Btn>)}
        </Sheet>
      )}
    </article>
  );
}

function FiltersSheet({ f, onApply, onClose }: { f: Filters; onApply: (f: Filters) => void; onClose: () => void }) {
  const [d, setD] = useState(f);
  return (
    <Sheet title="Фильтры" onClose={onClose}>
      <div className="stack">
        <div><div className="muted">Категория</div>
          <div className="pills">{[{ id: '', label: 'Все' }, ...CATEGORIES].map((c) => <button key={c.id} className={`pill ${d.category === c.id ? 'on' : ''}`} onClick={() => setD({ ...d, category: c.id })}>{c.label}</button>)}</div></div>
        <Stepper label="Платёж в месяц до" hint="0 — без ограничения" value={d.maxMonthly} step={1000} onChange={(n) => setD({ ...d, maxMonthly: n })} />
        <div><div className="muted">Срок</div>
          <div className="pills">{TERMS.map(([id, label]) => <button key={id} className={`pill ${d.term === id ? 'on' : ''}`} onClick={() => setD({ ...d, term: id })}>{label}</button>)}</div></div>
        <div><div className="muted">Сортировка</div>
          <div className="pills">{SORTS.map(([id, label]) => <button key={id} className={`pill ${d.sort === id ? 'on' : ''}`} onClick={() => setD({ ...d, sort: id })}>{label}</button>)}</div></div>
        <div className="row"><Btn kind="g" onClick={() => setD({ ...DEFAULTS })}>Сбросить</Btn><Btn className="grow" onClick={() => { onApply(d); onClose(); }}>Показать</Btn></div>
      </div>
    </Sheet>
  );
}

export function FeedScreen() {
  const { me, toast } = useAuth();
  const [f, setF] = useState<Filters>(DEFAULTS);
  const [limit, setLimit] = useState(20);
  const [filters, setFilters] = useState(false);
  const [newCount, setNewCount] = useState(0);
  const key = f === DEFAULTS && limit === 20 ? 'feed:main' : null;
  const res = useResource<{ items: FeedItem[]; total: number; serverTime: string }>(key, `/api/feed?${qs(f, limit)}`);
  const [since, setSince] = useState<string | null>(() => localStorage.getItem('vr:feed-since'));

  // «N новые покупки»: опрашиваем раз в минуту, отсчёт — от прошлого посещения.
  useEffect(() => {
    const t = setInterval(async () => {
      const s = localStorage.getItem('vr:feed-since') ?? new Date(Date.now() - 86400_000).toISOString();
      try { setNewCount((await api<{ count: number }>('GET', `/api/feed/new-count?since=${encodeURIComponent(s)}`)).count); } catch { /* нет сети */ }
    }, 60_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (res.data && !res.staleAt) {
      const prev = localStorage.getItem('vr:feed-since');
      if (prev) api<{ count: number }>('GET', `/api/feed/new-count?since=${encodeURIComponent(prev)}`).then((r) => setNewCount(r.count)).catch(() => undefined);
      localStorage.setItem('vr:feed-since', res.data.serverTime);
      setSince(res.data.serverTime);
    }
  }, [res.data?.serverTime]);
  void since;

  const items = res.data?.items ?? [];
  const filtered = f.category || f.q || f.maxMonthly || f.term;
  const invite = async () => { const m = await shareInvite(); if (m) toast(m); };

  return (
    <div className="page wide stack">
      <div className="row between"><h1>Лента</h1>{!me && <Btn sm kind="o" onClick={() => navigate('/login')}>Войти</Btn>}</div>
      <input className="input" type="search" placeholder="Поиск: товар или магазин" value={f.q} onChange={(e) => { setF({ ...f, q: e.target.value }); setLimit(20); }} aria-label="Поиск" />
      <div className="row">
        <div className="pills grow">{[{ id: '', label: 'Все' }, ...CATEGORIES].map((c) => <button key={c.id} className={`pill ${f.category === c.id ? 'on' : ''}`} onClick={() => { setF({ ...f, category: c.id }); setLimit(20); }}>{c.label}</button>)}</div>
        <Btn kind="g" sm onClick={() => setFilters(true)}>Фильтры</Btn>
      </div>
      {newCount > 0 && <button className="banner" style={{ border: 0, cursor: 'pointer' }} onClick={() => { setNewCount(0); res.reload(); }}>{newCount} {plural(newCount, 'новая покупка', 'новые покупки', 'новых покупок')}: показать</button>}
      <StaleNote at={res.staleAt} />
      {res.staleAt && <Btn kind="o" onClick={res.reload}>Повторить</Btn>}
      {res.loading && !res.data && <Skeletons />}
      {res.error && !res.data && <Empty title="Не удалось загрузить ленту"><Btn kind="o" onClick={res.reload}>Повторить</Btn></Empty>}
      {res.data && items.length === 0 && (filtered
        ? <Empty title="Ничего не найдено"><div>Попробуйте изменить поиск или фильтры.</div><Btn kind="g" onClick={() => setF(DEFAULTS)}>Сбросить фильтры</Btn></Empty>
        : <Empty title="Здесь появятся покупки в рассрочку"><Btn onClick={() => navigate(me ? '/installments/new' : '/login')}>Добавить рассрочку</Btn><Btn kind="g" onClick={invite}>Позвать знакомых</Btn></Empty>)}
      <div className="grid2 stack-grid" style={{ display: 'grid', gap: 12 }}>
        {items.map((i) => <FeedCard key={i.id} item={i} />)}
      </div>
      {res.data && res.data.total > items.length && <Btn kind="g" block onClick={() => setLimit(limit + 20)}>Показать ещё</Btn>}
      {res.data && items.length > 0 && <Btn kind="g" block onClick={invite}>Позвать знакомых</Btn>}
      {filters && <FiltersSheet f={f} onApply={(n) => { setF(n); setLimit(20); }} onClose={() => setFilters(false)} />}
    </div>
  );
}

/** Ссылка на конкретную покупку: сначала карточка, презентация — плашкой. */
export function FeedDetail() {
  const path = usePath();
  const id = match('/feed/:id', path)?.id ?? '';
  const { me } = useAuth();
  const res = useResource<{ item: FeedItem }>(`feed:${id}`, `/api/feed/${id}`);
  return (
    <div className="page stack">
      <Link to="/">← Лента</Link>
      {!me && <Link to="/welcome" className="banner">Что это за приложение?</Link>}
      {res.loading && !res.data && <Skeletons n={1} />}
      {res.error && <Empty title="Запись не найдена или скрыта" />}
      {res.data && <FeedCard item={res.data.item} open />}
    </div>
  );
}
