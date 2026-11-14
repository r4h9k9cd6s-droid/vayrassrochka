import { useEffect, useRef, useState } from 'react';
import { CATEGORIES, ICONS, guessProduct, defaultMonthlyPayment } from '@vayrassrochka/shared';
import { api, errorText, useResource } from '../api';
import { money, todayISO } from '../format';
import { match, navigate, usePath } from '../router';
import { useAuth } from '../store';
import { Btn, Field, Icons, ProductTile, Stepper } from '../ui';
import type { InstView } from './Installments';

interface Form {
  title: string; category: string; icon: string; iconManual: boolean; sellerType: 'shop' | 'person' | 'none';
  sellerName: string; sellerAddress: string; sellerPhone: string;
  cost: number; downPayment: number; termMonths: number; monthly: number; monthlyManual: boolean;
  purchaseDate: string; paymentDay: number; extraTerms: string; published: boolean; rights: boolean; ongoing: boolean; alreadyPaid: number;
}
const EMPTY = (): Form => ({
  title: '', category: 'other', icon: 'bag', iconManual: false, sellerType: 'shop', sellerName: '', sellerAddress: '', sellerPhone: '',
  cost: 0, downPayment: 0, termMonths: 6, monthly: 0, monthlyManual: false, purchaseDate: todayISO(), paymentDay: Math.min(28, new Date().getDate()),
  extraTerms: '', published: true, rights: false, ongoing: false, alreadyPaid: 0,
});
const DRAFT = 'vr:draft:installment';
const looksLikePersonName = (s: string) => /^[А-ЯЁ][а-яё]+(\s+[А-ЯЁ][а-яё.]*){1,2}$/.test(s.trim());

export function InstallmentForm() {
  const path = usePath();
  const editId = match('/installments/:id/edit', path)?.id ?? null;
  const { toast } = useAuth();
  const existing = useResource<InstView>(null, editId ? `/api/installments/${editId}` : null);
  const [f, setF] = useState<Form>(() => {
    if (editId) return EMPTY();
    try { const d = localStorage.getItem(DRAFT); if (d) return { ...EMPTY(), ...JSON.parse(d) }; } catch { /* ignore */ }
    return EMPTY();
  });
  const [saveState, setSaveState] = useState<'' | 'draft' | 'saving'>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [suggest, setSuggest] = useState<{ id: string; name: string; address: string; phone: string }[]>([]);
  const loaded = useRef(false);

  useEffect(() => {
    const v = existing.data;
    if (!editId || !v || loaded.current) return;
    loaded.current = true;
    const i = v.installment, s = v.state;
    setF({
      title: i.title, category: i.category, icon: i.icon, iconManual: true, sellerType: i.sellerType as Form['sellerType'],
      sellerName: i.seller?.name ?? '', sellerAddress: i.seller?.address ?? '', sellerPhone: i.seller?.phone ?? '',
      cost: s.cost, downPayment: s.downPayment, termMonths: s.initialTermMonths, monthly: i.monthlyPayment ?? s.regularPayment, monthlyManual: i.monthlyPayment !== null,
      purchaseDate: i.purchaseDate, paymentDay: i.paymentDay, extraTerms: i.extraTerms, published: i.published, rights: i.published, ongoing: false, alreadyPaid: 0,
    });
  }, [existing.data, editId]);

  const set = <K extends keyof Form>(patch: Pick<Form, K> | Partial<Form>) => setF((p) => ({ ...p, ...patch }));
  const auto = f.cost > f.downPayment ? defaultMonthlyPayment(f.cost, f.downPayment, f.termMonths) : 0;
  const monthly = f.monthlyManual ? f.monthly : auto;

  // Черновик (только новая запись) и подсказки продавцов.
  useEffect(() => {
    if (editId) return;
    const t = setTimeout(() => { try { localStorage.setItem(DRAFT, JSON.stringify(f)); setSaveState('draft'); } catch { /* ignore */ } }, 600);
    setSaveState('saving');
    return () => clearTimeout(t);
  }, [f, editId]);
  useEffect(() => {
    if (f.sellerType === 'none' || f.sellerName.trim().length < 2) { setSuggest([]); return; }
    const t = setTimeout(() => {
      api<{ items: typeof suggest }>('GET', `/api/sellers/suggest?q=${encodeURIComponent(f.sellerName)}&type=${f.sellerType}`).then((r) => setSuggest(r.items)).catch(() => setSuggest([]));
    }, 300);
    return () => clearTimeout(t);
  }, [f.sellerName, f.sellerType]);

  const onTitle = (title: string) => {
    const g = guessProduct(title);
    set(f.iconManual ? { title } : { title, icon: g.icon, category: g.category });
  };
  const personal = f.sellerType === 'none';
  const publish = f.published && !personal;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError('');
    const body = {
      title: f.title, category: f.category, icon: f.icon, sellerType: f.sellerType,
      ...(personal ? {} : { seller: { name: f.sellerName, address: f.sellerAddress, phone: f.sellerPhone } }),
      cost: f.cost, downPayment: f.downPayment, termMonths: f.termMonths,
      monthlyPayment: f.monthlyManual && f.monthly !== auto ? f.monthly : null,
      purchaseDate: f.purchaseDate, paymentDay: f.paymentDay, extraTerms: f.extraTerms,
      published: publish, rightsConfirmed: publish && f.rights,
      ...(!editId && f.ongoing && f.alreadyPaid > 0 ? { alreadyPaidCount: Math.min(f.alreadyPaid, f.termMonths) } : {}),
    };
    try {
      const r = editId ? await api<InstView>('PATCH', `/api/installments/${editId}`, body) : await api<InstView>('POST', '/api/installments', body);
      try { localStorage.removeItem(DRAFT); } catch { /* ignore */ }
      toast(editId ? 'Сохранено' : 'Рассрочка добавлена');
      navigate(`/installments/${r.installment.id}`, true);
    } catch (err) { setError(errorText(err)); setBusy(false); }
  };

  return (
    <div className="page stack">
      <div className="row"><button className="btn g sm" type="button" onClick={() => history.back()} aria-label="Назад">{Icons.back}</button><h1 className="grow" style={{ fontSize: 24 }}>{editId ? 'Изменить рассрочку' : 'Новая рассрочка'}</h1></div>
      {!editId && <div className="muted" role="status">{saveState === 'saving' ? 'Сохраняем черновик…' : saveState === 'draft' ? 'Черновик сохранён на этом устройстве' : ''}</div>}
      <form className="stack" onSubmit={submit}>
        <Field label="Товар"><input className="input" value={f.title} onChange={(e) => onTitle(e.target.value)} required maxLength={120} placeholder="Например, iPhone 15" /></Field>
        <div className="row"><ProductTile icon={f.icon} category={f.category} />
          <div className="grow"><div className="muted">Ярлык определился по названию — можно сменить</div>
            <div className="pills">{ICONS.map((i) => <button type="button" key={i} className={`pill ${f.icon === i ? 'on' : ''}`} onClick={() => set({ icon: i, iconManual: true })}>{{ phone: 'Телефон', laptop: 'Ноутбук', console: 'Консоль', sofa: 'Диван', kitchen: 'Кухня', bag: 'Другое' }[i]}</button>)}</div></div></div>
        <Field label="Категория"><select className="input" value={f.category} onChange={(e) => set({ category: e.target.value })}>{CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></Field>

        <div><div className="muted">Продавец</div>
          <div className="pills">{([['shop', 'Магазин'], ['person', 'Частное лицо'], ['none', 'Без продавца (личная запись)']] as const).map(([id, l]) => <button type="button" key={id} className={`pill ${f.sellerType === id ? 'on' : ''}`} onClick={() => set({ sellerType: id })}>{l}</button>)}</div></div>
        {!personal && (
          <div className="stack">
            <Field label="Название" hint={f.sellerType === 'person' ? 'Только публичные данные: то, что человек сам публикует для рекламы. Домашний адрес и личные номера не вводите.' : 'Нужно указать хотя бы одно: название, адрес или телефон.'}>
              <input className="input" value={f.sellerName} onChange={(e) => set({ sellerName: e.target.value })} autoComplete="off" />
            </Field>
            {suggest.length > 0 && <div className="stack">{suggest.map((s) => <button type="button" key={s.id} className="btn g" style={{ justifyContent: 'flex-start' }} onClick={() => { set({ sellerName: s.name, sellerAddress: s.address, sellerPhone: s.phone }); setSuggest([]); }}>{s.name}{s.address ? ` · ${s.address}` : ''}</button>)}</div>}
            {f.sellerType === 'shop' && looksLikePersonName(f.sellerName) && <div className="banner">Похоже на имя человека. Это частное лицо? <button type="button" className="btn g sm" onClick={() => set({ sellerType: 'person' })}>Переключить</button></div>}
            <Field label="Адрес (необязательно)"><input className="input" value={f.sellerAddress} onChange={(e) => set({ sellerAddress: e.target.value })} /></Field>
            <Field label="Телефон"><input className="input" inputMode="tel" value={f.sellerPhone} onChange={(e) => set({ sellerPhone: e.target.value })} placeholder="+7 ..." /></Field>
          </div>
        )}

        <Stepper label="Стоимость, ₽" value={f.cost} step={1000} onChange={(n) => set({ cost: n })} />
        <Stepper label="Первый взнос, ₽" value={f.downPayment} step={1000} onChange={(n) => set({ downPayment: n })} />
        <Stepper label="Срок, месяцев" value={f.termMonths} step={1} min={1} max={120} onChange={(n) => set({ termMonths: n })} />
        <Stepper label="Платёж в месяц, ₽" value={monthly} step={500} hint={f.monthlyManual ? 'Вы изменили платёж вручную' : `Считается: (стоимость − взнос) ÷ срок = ${money(auto)}`} onChange={(n) => set({ monthly: n, monthlyManual: true })} />
        {f.monthlyManual && <button type="button" className="btn g sm" onClick={() => set({ monthlyManual: false })}>Посчитать автоматически</button>}
        <Field label="Дата покупки"><input className="input" type="date" value={f.purchaseDate} onChange={(e) => set({ purchaseDate: e.target.value })} required /></Field>
        {!editId && (
          <div className="card stack">
            <label className="check"><input type="checkbox" checked={f.ongoing} onChange={(e) => set({ ongoing: e.target.checked })} /><span><b>Рассрочка уже идёт</b><div className="muted">Вы уже вносили платежи по ней до того, как добавили её сюда.</div></span></label>
            {f.ongoing && <Stepper label="Уже внесено платежей" value={f.alreadyPaid} step={1} min={0} max={f.termMonths} hint="Прошлые платежи отметятся оплаченными по графику. Первый взнос указывается отдельно выше." onChange={(n) => set({ alreadyPaid: n })} />}
          </div>
        )}
        <Stepper label="День платежа (число месяца)" value={f.paymentDay} step={1} min={1} max={31} onChange={(n) => set({ paymentDay: n })} />
        <Field label="Дополнительные условия" hint="Только условия сделки. Личные данные не вводите."><textarea className="input" value={f.extraTerms} onChange={(e) => set({ extraTerms: e.target.value })} maxLength={500} /></Field>

        <div className="card stack">
          <label className="check"><input type="checkbox" checked={publish} disabled={personal} onChange={(e) => set({ published: e.target.checked })} /><span><b>Показать в ленте</b><div className="muted">{personal ? 'Личная запись в ленту не публикуется. Позже можно сделать публичной, указав продавца.' : 'Будут видны только товар, продавец и условия. Ваше имя и платежи не показываются.'}</div></span></label>
          {publish && <label className="check"><input type="checkbox" checked={f.rights} onChange={(e) => set({ rights: e.target.checked })} /><span>Я подтверждаю, что имею право указать эти данные</span></label>}
        </div>
        {error && <div className="banner bad" role="alert">! {error}</div>}
        <Btn block disabled={busy || f.cost < 1 || (publish && !f.rights)}>{editId ? 'Сохранить' : 'Добавить рассрочку'}</Btn>
      </form>
    </div>
  );
}
