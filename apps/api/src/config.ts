export interface Config {
  port: number;
  databaseUrl: string;
  /** Публичный адрес сайта (для текста «Поделиться» и ссылок). */
  publicUrl: string;
  secureCookies: boolean;
  vapid: { publicKey: string; privateKey: string; subject: string } | null;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const pub = env.VAPID_PUBLIC_KEY;
  const priv = env.VAPID_PRIVATE_KEY;
  return {
    port: Number(env.PORT ?? 3000),
    databaseUrl: env.DATABASE_URL ?? 'postgres://localhost:5432/vayrassrochka',
    publicUrl: env.PUBLIC_URL ?? 'http://localhost:5173',
    secureCookies: env.COOKIE_SECURE === '1',
    vapid: pub && priv ? { publicKey: pub, privateKey: priv, subject: env.VAPID_SUBJECT ?? 'mailto:admin@example.invalid' } : null,
  };
}

export const testConfig: Config = {
  port: 0,
  databaseUrl: '',
  publicUrl: 'https://vayrassrochka.test',
  secureCookies: false,
  vapid: null,
};
