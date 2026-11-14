// Создание владельца: npm run admin:create -w @vayrassrochka/api -- <логин>
// Пароль вводится в терминале (не сохраняется нигде, кроме защищённого хеша).
// Секрет для приложения-аутентификатора и резервные коды печатаются один раз.
import { createInterface } from 'node:readline';
import { generateSecret, generateURI } from 'otplib';
import { loadConfig } from '../config.js';
import { createPostgresDb, schema } from '../db/index.js';
import { generateBackupCode, hashBackupCode, hashSecret, newId, normalizeLogin } from '../security.js';

const login = normalizeLogin(process.argv[2] ?? '');
if (!login) {
  console.error('Укажите логин: npm run admin:create -w @vayrassrochka/api -- <логин>');
  process.exit(1);
}
const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q: string) => new Promise<string>((res) => rl.question(q, res));
const password = await ask('Пароль (не короче 12 знаков): ');
rl.close();
if (password.length < 12) {
  console.error('Пароль слишком короткий.');
  process.exit(1);
}
const { db, close } = await createPostgresDb(loadConfig().databaseUrl);
const secret = generateSecret();
const codes = Array.from({ length: 8 }, () => generateBackupCode());
await db.insert(schema.admins).values({
  id: newId(),
  login,
  passwordHash: await hashSecret(password),
  role: 'owner',
  totpSecret: secret,
  backupCodes: await Promise.all(codes.map(hashBackupCode)),
});
console.log('\nВладелец создан.');
console.log('Добавьте в приложение-аутентификатор (Google Authenticator и т. п.) по ссылке или вручную:');
console.log(generateURI({ issuer: 'ВайРассрочка', label: login, secret }));
console.log('Секрет:', secret);
console.log('\nРезервные коды владельца (сохраните, показываются один раз):');
for (const c of codes) console.log('  ', c);
await close();
