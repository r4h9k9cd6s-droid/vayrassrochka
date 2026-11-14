import { useCallback, useEffect, useRef, useState } from 'react';

export class ApiError extends Error {
  constructor(public status: number, public code: string) {
    super(code);
  }
  get offline() {
    return this.status === 0;
  }
}

export async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'content-type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'offline');
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, data?.error ?? 'error');
  return data as T;
}

const ERRORS: Record<string, string> = {
  offline: 'Нет интернета. Ничего не сохранено.',
  unauthorized: 'Нужно войти.',
  wrong_credentials: 'Неверный логин, пароль или код.',
  login_taken: 'Такой логин уже занят.',
  invalid_input: 'Проверьте заполнение полей.',
  too_many_requests: 'Слишком часто. Попробуйте позже.',
  seller_required: 'Укажите название, адрес или телефон продавца.',
  rights_not_confirmed: 'Подтвердите, что вы вправе указать эти данные.',
  personal_not_publishable: 'Личную запись без продавца нельзя показать в ленте.',
  already_paid_too_many: 'Платежей внесено больше, чем в графике.',
  down_payment_too_big: 'Первый взнос больше стоимости.',
  no_open_payments: 'Платить больше нечего.',
  skip_not_allowed: 'Пропустить можно только просроченный или ближайший платёж.',
  month_not_payable: 'Вносить заранее нельзя: отмечаются просроченный и ближайший взносы.',
  already_answered: 'Вы уже отвечали.',
  own_record: 'Это ваша запись.',
  wrong_code: 'Неверный код.',
  code_required: 'Введите код из приложения.',
};
export const errorText = (e: unknown) => (e instanceof ApiError ? (ERRORS[e.code] ?? 'Что-то пошло не так. Попробуйте ещё раз.') : 'Что-то пошло не так.');

// --- простое хранилище последних ответов для офлайна -------------------------------------------
const PREFIX = 'vr:cache:';
interface Cached<T> { at: number; data: T }
export function cacheGet<T>(key: string): Cached<T> | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as Cached<T>) : null;
  } catch {
    return null;
  }
}
export function cacheSet<T>(key: string, data: T): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify({ at: Date.now(), data }));
  } catch {
    /* память переполнена — не страшно */
  }
}
export function cacheClear(): void {
  try {
    Object.keys(localStorage).filter((k) => k.startsWith(PREFIX)).forEach((k) => localStorage.removeItem(k));
  } catch {
    /* ignore */
  }
}

export interface Resource<T> {
  data: T | null;
  loading: boolean;
  error: ApiError | null;
  /** Если показаны сохранённые данные (нет сети): когда они были получены. */
  staleAt: number | null;
  reload: () => void;
}

/** Загружает данные; при отсутствии сети показывает последние сохранённые с отметкой «Обновлено …». */
export function useResource<T>(key: string | null, path: string | null, deps: unknown[] = []): Resource<T> {
  const [state, setState] = useState<Omit<Resource<T>, 'reload'>>({ data: null, loading: true, error: null, staleAt: null });
  const [tick, setTick] = useState(0);
  const seq = useRef(0);
  useEffect(() => {
    if (!path) return;
    const mine = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    api<T>('GET', path)
      .then((data) => {
        if (mine !== seq.current) return;
        if (key) cacheSet(key, data);
        setState({ data, loading: false, error: null, staleAt: null });
      })
      .catch((e: ApiError) => {
        if (mine !== seq.current) return;
        const c = key && e.offline ? cacheGet<T>(key) : null;
        setState(c ? { data: c.data, loading: false, error: null, staleAt: c.at } : { data: null, loading: false, error: e, staleAt: null });
      });
  }, [key, path, tick, ...deps]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}
