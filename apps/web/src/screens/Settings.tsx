import { useEffect, useState } from 'react';
import { api, errorText } from '../api';
import { shareInvite } from '../invite';
import { navigate } from '../router';
import { useAuth, type Me } from '../store';
import { Btn, Field, Icons, Sheet } from '../ui';
import { BackupCodeView } from './Auth';

const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
const standalone = window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
let deferredPrompt: (Event & { prompt: () => Promise<void> }) | null = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e as typeof deferredPrompt; });

function b64ToBytes(s: string) {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function resizeAvatar(file: File): Promise<string> {
  const bmp = await createImageBitmap(file);
  const size = 192, c = document.createElement('canvas');
  c.width = c.height = size;
  const s = Math.min(bmp.width, bmp.height);
  c.getContext('2d')!.drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, size, size);
  return c.toDataURL('image/jpeg', 0.8);
}

export function SettingsScreen() {
  const { me, setMe, logout, toast } = useAuth();
  const [sheet, setSheet] = useState<'' | 'password' | 'code' | 'feedback' | 'delete' | 'ios'>('');
  const [code, setCode] = useState<string | null>(null);
  const [pushState, setPushState] = useState<'unknown' | 'on' | 'off' | 'unsupported' | 'denied'>('unknown');

  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) { setPushState('unsupported'); return; }
    if (Notification.permission === 'denied') { setPushState('denied'); return; }
    navigator.serviceWorker.ready.then((r) => r.pushManager.getSubscription()).then((s) => setPushState(s ? 'on' : 'off')).catch(() => setPushState('off'));
  }, []);

  if (!me) { navigate('/login', true); return null; }
  const patch = async (p: Partial<Me> & { timezoneOffsetMin?: number }) => {
    try { setMe((await api<{ user: Me }>('PATCH', '/api/me/settings', p)).user); } catch (e) { toast(errorText(e)); }
  };

  const enablePush = async () => {
    try {
      const { publicKey } = await api<{ publicKey: string | null }>('GET', '/api/push/public-key');
      if (!publicKey) return toast('Уведомления на сервере пока не настроены');
      if ((await Notification.requestPermission()) !== 'granted') return setPushState('denied');
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) });
      await api('POST', '/api/push/subscribe', sub.toJSON());
      await patch({ pushEnabled: true, timezoneOffsetMin: -new Date().getTimezoneOffset() });
      setPushState('on');
      toast('Уведомления включены');
    } catch (e) { toast(errorText(e)); }
  };
  const disablePush = async () => {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) { await api('POST', '/api/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => undefined); await sub.unsubscribe(); }
    setPushState('off');
  };
  const install = async () => {
    if (isIOS) return setSheet('ios');
    if (deferredPrompt) { await deferredPrompt.prompt(); deferredPrompt = null; } else toast('Откройте меню браузера и выберите «Установить приложение» или «Добавить на главный экран»');
  };

  return (
    <div className="page stack">
      <div className="row"><button className="btn g sm" onClick={() => history.back()} aria-label="Назад">{Icons.back}</button><h1>Настройки</h1></div>
      <div className="card row">
        <label style={{ cursor: 'pointer' }}>
          <div className="tile" style={{ borderRadius: 26, width: 52, height: 52, overflow: 'hidden' }}>{me.avatar ? <img src={me.avatar} alt="Фото профиля" width={52} height={52} /> : Icons.user}</div>
          <input type="file" accept="image/*" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) await patch({ avatar: await resizeAvatar(f) }); }} />
        </label>
        <div className="grow"><b>{me.login}</b><div className="muted">Нажмите на фото, чтобы сменить</div></div>
        {me.avatar && <Btn kind="g" sm onClick={() => patch({ avatar: null })}>Убрать</Btn>}
      </div>

      {!standalone && <div className="card stack"><b>Установка на главный экран</b><div className="muted">Так приложение открывается как обычное, быстрее и с уведомлениями (на iPhone уведомления работают только после установки).</div><Btn kind="o" onClick={install}>Установить приложение</Btn></div>}

      <div className="card stack"><b>Тема</b>
        <div className="pills">{([['auto', 'Авто'], ['light', 'Светлая'], ['dark', 'Тёмная']] as const).map(([id, l]) => <button key={id} className={`pill ${me.theme === id ? 'on' : ''}`} onClick={() => patch({ theme: id })}>{l}</button>)}</div>
        <div className="muted">Авто: светлая с 07:00 до 19:00, потом тёмная.</div></div>

      <div className="card stack"><b>Уведомления</b>
        {pushState === 'unsupported' && <div className="muted">Этот браузер не поддерживает уведомления.{isIOS && !standalone ? ' На iPhone сначала добавьте приложение на главный экран.' : ''}</div>}
        {pushState === 'denied' && <div className="banner">Уведомления запрещены в настройках браузера.</div>}
        {pushState === 'off' && <Btn onClick={enablePush}>Включить уведомления</Btn>}
        {pushState === 'on' && <><div className="muted">Включены: за день до платежа, в день платежа и о просрочке.</div><Btn kind="g" onClick={disablePush}>Выключить на этом устройстве</Btn></>}
        <Field label="Время напоминаний"><input className="input" type="time" value={me.reminderTime} onChange={(e) => e.target.value && patch({ reminderTime: e.target.value })} /></Field>
        <label className="check"><input type="checkbox" checked={me.pushEnabled} onChange={(e) => patch({ pushEnabled: e.target.checked })} />Присылать уведомления</label></div>

      <div className="card stack"><b>Безопасность</b>
        <Btn kind="g" onClick={() => setSheet('password')}>Сменить пароль</Btn>
        <Btn kind="g" onClick={() => setSheet('code')}>Получить новый резервный код</Btn>
        {!me.backupCodeAcked && <div className="banner">Вы ещё не подтвердили, что сохранили резервный код.</div>}</div>

      <div className="card stack">
        <Btn kind="g" onClick={async () => { const m = await shareInvite(); if (m) toast(m); }}>Позвать знакомых</Btn>
        <Btn kind="g" onClick={() => setSheet('feedback')}>Отзывы и предложения о приложении</Btn>
        <Btn kind="g" onClick={() => navigate('/welcome')}>О приложении</Btn></div>

      <Btn kind="o" onClick={async () => { await logout(); navigate('/', true); }}>Выйти</Btn>
      <Btn kind="danger" onClick={() => setSheet('delete')}>Удалить аккаунт</Btn>

      {sheet === 'password' && <PasswordSheet onClose={() => setSheet('')} />}
      {sheet === 'feedback' && <FeedbackSheet onClose={() => setSheet('')} />}
      {sheet === 'delete' && <DeleteSheet onClose={() => setSheet('')} />}
      {sheet === 'ios' && <Sheet title="Установка на iPhone" onClose={() => setSheet('')}><ol style={{ paddingLeft: 20 }}><li>Откройте сайт в Safari.</li><li>Нажмите «Поделиться» (квадрат со стрелкой).</li><li>Выберите «На экран “Домой”».</li></ol></Sheet>}
      {sheet === 'code' && (code ? <Sheet title="Новый резервный код" onClose={() => { setCode(null); setSheet(''); }}><BackupCodeView code={code} login={me.login} onDone={async () => { setCode(null); setSheet(''); const r = await api<{ user: Me }>('GET', '/api/me'); setMe(r.user); }} /></Sheet> : <RenewSheet onClose={() => setSheet('')} onCode={setCode} />)}
    </div>
  );
}

function RenewSheet({ onClose, onCode }: { onClose: () => void; onCode: (c: string) => void }) {
  const [pw, setPw] = useState(''); const [err, setErr] = useState('');
  return (
    <Sheet title="Новый резервный код" onClose={onClose}>
      <div className="muted">Старый код перестанет работать. Для подтверждения введите пароль.</div>
      <Field label="Пароль"><input className="input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" /></Field>
      {err && <div className="banner bad">! {err}</div>}
      <Btn block onClick={async () => { try { onCode((await api<{ backupCode: string }>('POST', '/api/me/backup-code/renew', { password: pw })).backupCode); } catch (e) { setErr(errorText(e)); } }}>Получить код</Btn>
    </Sheet>
  );
}
function PasswordSheet({ onClose }: { onClose: () => void }) {
  const { toast } = useAuth(); const [o, setO] = useState(''); const [n, setN] = useState(''); const [err, setErr] = useState('');
  return (
    <Sheet title="Сменить пароль" onClose={onClose}>
      <Field label="Старый пароль"><input className="input" type="password" value={o} onChange={(e) => setO(e.target.value)} autoComplete="current-password" /></Field>
      <Field label="Новый пароль" hint="Не короче 8 знаков"><input className="input" type="password" value={n} onChange={(e) => setN(e.target.value)} autoComplete="new-password" /></Field>
      {err && <div className="banner bad">! {err}</div>}
      <Btn block onClick={async () => { try { await api('POST', '/api/me/password', { oldPassword: o, newPassword: n }); toast('Пароль изменён'); onClose(); } catch (e) { setErr(errorText(e)); } }}>Сменить</Btn>
    </Sheet>
  );
}
function FeedbackSheet({ onClose }: { onClose: () => void }) {
  const { toast } = useAuth(); const [t, setT] = useState(''); const [err, setErr] = useState('');
  return (
    <Sheet title="Отзывы и предложения" onClose={onClose}>
      <div className="muted">Сообщение получит только владелец приложения. Оно нигде не публикуется.</div>
      <textarea className="input" value={t} onChange={(e) => setT(e.target.value)} maxLength={2000} aria-label="Ваш отзыв" />
      {err && <div className="banner bad">! {err}</div>}
      <Btn block disabled={!t.trim()} onClick={async () => { try { await api('POST', '/api/feedback', { text: t }); toast('Спасибо за отзыв!'); onClose(); } catch (e) { setErr(errorText(e)); } }}>Отправить</Btn>
    </Sheet>
  );
}
function DeleteSheet({ onClose }: { onClose: () => void }) {
  const { setMe } = useAuth(); const [pw, setPw] = useState(''); const [err, setErr] = useState('');
  return (
    <Sheet title="Удалить аккаунт" onClose={onClose}>
      <div className="muted">Личные данные, рассрочки и котёл будут удалены без возможности восстановления. Опубликованные в ленте записи останутся без привязки к вам.</div>
      <Field label="Пароль"><input className="input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
      {err && <div className="banner bad">! {err}</div>}
      <Btn kind="danger" block onClick={async () => { try { await api('DELETE', '/api/me', { password: pw }); setMe(null); navigate('/', true); } catch (e) { setErr(errorText(e)); } }}>Удалить навсегда</Btn>
    </Sheet>
  );
}
