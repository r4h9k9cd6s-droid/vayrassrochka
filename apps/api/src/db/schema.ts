import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

const id = () => text('id').primaryKey();
const created = () => timestamp('created_at', { mode: 'date' }).notNull().defaultNow();

export const users = pgTable(
  'users',
  {
    id: id(),
    login: text('login').notNull(), // в нижнем регистре
    passwordHash: text('password_hash').notNull(),
    backupCodeHash: text('backup_code_hash').notNull(),
    backupCodeAcked: boolean('backup_code_acked').notNull().default(false),
    theme: text('theme').notNull().default('auto'), // auto | light | dark
    hideAmounts: boolean('hide_amounts').notNull().default(false),
    pushEnabled: boolean('push_enabled').notNull().default(true),
    reminderTime: text('reminder_time').notNull().default('09:00'),
    timezoneOffsetMin: integer('timezone_offset_min').notNull().default(180), // Грозный: UTC+3
    avatar: text('avatar'),
    welcomeSeen: boolean('welcome_seen').notNull().default(false),
    createdAt: created(),
    lastSeenAt: timestamp('last_seen_at', { mode: 'date' }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { mode: 'date' }),
  },
  (t) => [uniqueIndex('users_login_uq').on(t.login)],
);

export const sessions = pgTable(
  'sessions',
  {
    id: id(), // sha256 токена
    userId: text('user_id').notNull(),
    createdAt: created(),
    expiresAt: timestamp('expires_at', { mode: 'date' }).notNull(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export const sellers = pgTable(
  'sellers',
  {
    id: id(),
    type: text('type').notNull(), // shop | person
    name: text('name').notNull().default(''),
    nameNorm: text('name_norm').notNull().default(''),
    address: text('address').notNull().default(''),
    phone: text('phone').notNull().default(''), // нормализован: 7XXXXXXXXXX
    hidden: boolean('hidden').notNull().default(false),
    createdAt: created(),
  },
  (t) => [index('sellers_phone_idx').on(t.phone), index('sellers_name_idx').on(t.nameNorm)],
);

export const installments = pgTable(
  'installments',
  {
    id: id(),
    userId: text('user_id'), // null после удаления аккаунта (запись обезличена)
    title: text('title').notNull(),
    category: text('category').notNull().default('other'), // electronics|appliances|furniture|auto|other
    icon: text('icon').notNull().default('bag'),
    sellerType: text('seller_type').notNull().default('none'), // shop | person | none
    sellerId: text('seller_id'),
    cost: integer('cost').notNull(),
    downPayment: integer('down_payment').notNull().default(0),
    termMonths: integer('term_months').notNull(),
    monthlyPayment: integer('monthly_payment'), // null = по умолчанию
    purchaseDate: text('purchase_date').notNull(),
    paymentDay: integer('payment_day').notNull(),
    extraTerms: text('extra_terms').notNull().default(''),
    published: boolean('published').notNull().default(false),
    // видимость в ленте: visible | hidden (скрыта владельцем) | review (на проверке) | trash
    feedState: text('feed_state').notNull().default('visible'),
    doubtRequests: integer('doubt_requests').notNull().default(0),
    doubtful: boolean('doubtful').notNull().default(false),
    createdAt: created(),
    updatedAt: timestamp('updated_at', { mode: 'date' }).notNull().defaultNow(),
    trashedAt: timestamp('trashed_at', { mode: 'date' }),
  },
  (t) => [index('inst_user_idx').on(t.userId), index('inst_feed_idx').on(t.published, t.feedState, t.createdAt)],
);

export const installmentEvents = pgTable(
  'installment_events',
  {
    id: id(),
    installmentId: text('installment_id').notNull(),
    type: text('type').notNull(), // payment | skip
    date: text('date').notNull(),
    amount: integer('amount'),
    segmentId: text('segment_id'),
    voidedAt: text('voided_at'),
    createdAt: created(),
  },
  (t) => [index('events_inst_idx').on(t.installmentId)],
);

export const sellerHistory = pgTable('seller_history', {
  id: id(),
  installmentId: text('installment_id').notNull(),
  oldSellerId: text('old_seller_id'),
  newSellerId: text('new_seller_id'),
  by: text('by').notNull(), // user:<id> | admin:<id>
  createdAt: created(),
});

export const contactReports = pgTable(
  'contact_reports',
  {
    id: id(),
    installmentId: text('installment_id').notNull(),
    userId: text('user_id').notNull(),
    result: text('result').notNull(), // yes | no
    createdAt: created(),
  },
  (t) => [uniqueIndex('contact_uq').on(t.installmentId, t.userId)],
);

export const notifications = pgTable(
  'notifications',
  {
    id: id(),
    userId: text('user_id').notNull(),
    kind: text('kind').notNull(), // check_seller | author_confirmed | author_fixed | payment_due | payment_overdue
    payload: jsonb('payload').notNull().default({}),
    createdAt: created(),
    readAt: timestamp('read_at', { mode: 'date' }),
  },
  (t) => [index('notif_user_idx').on(t.userId)],
);

export const complaints = pgTable('complaints', {
  id: id(),
  installmentId: text('installment_id').notNull(),
  userId: text('user_id').notNull(),
  reason: text('reason').notNull(), // personal_data | wrong_seller | spam | other
  status: text('status').notNull().default('open'), // open | closed
  note: text('note').notNull().default(''),
  createdAt: created(),
  resolvedAt: timestamp('resolved_at', { mode: 'date' }),
});

export const pots = pgTable('pots', {
  id: id(),
  userId: text('user_id').notNull(),
  name: text('name').notNull(),
  participants: integer('participants').notNull(),
  contribution: integer('contribution').notNull(),
  paymentDay: integer('payment_day').notNull(),
  myTurn: integer('my_turn').notNull(), // месяц получения, 1..participants
  startDate: text('start_date').notNull(),
  alreadyPaid: integer('already_paid').notNull().default(0), // взносов, внесённых до ведения в приложении
  received: boolean('received').notNull().default(false),
  createdAt: created(),
});

export const potPayments = pgTable(
  'pot_payments',
  {
    id: id(),
    potId: text('pot_id').notNull(),
    month: integer('month').notNull(), // номер месяца 1..N
    date: text('date').notNull(),
    createdAt: created(),
  },
  (t) => [uniqueIndex('pot_month_uq').on(t.potId, t.month)],
);

export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: id(),
    userId: text('user_id').notNull(),
    endpoint: text('endpoint').notNull(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    createdAt: created(),
  },
  (t) => [uniqueIndex('push_endpoint_uq').on(t.endpoint)],
);

export const pushLog = pgTable(
  'push_log',
  {
    id: id(),
    userId: text('user_id').notNull(),
    dedupeKey: text('dedupe_key').notNull(),
    kind: text('kind').notNull(),
    status: text('status').notNull(), // sent | failed | no_subscription
    attempts: integer('attempts').notNull().default(1),
    error: text('error'),
    createdAt: created(),
  },
  (t) => [uniqueIndex('pushlog_key_uq').on(t.dedupeKey)],
);

export const feedback = pgTable('feedback', {
  id: id(),
  userId: text('user_id'),
  text: text('text').notNull(),
  status: text('status').notNull().default('new'), // new | planned | closed
  createdAt: created(),
});

export const admins = pgTable(
  'admins',
  {
    id: id(),
    login: text('login').notNull(),
    passwordHash: text('password_hash').notNull(),
    role: text('role').notNull().default('owner'), // owner | moderator
    totpSecret: text('totp_secret').notNull(),
    backupCodes: jsonb('backup_codes').notNull().default([]), // хеши
    createdAt: created(),
  },
  (t) => [uniqueIndex('admins_login_uq').on(t.login)],
);

export const adminSessions = pgTable('admin_sessions', {
  id: id(),
  adminId: text('admin_id').notNull(),
  expiresAt: timestamp('expires_at', { mode: 'date' }).notNull(),
});

export const adminTrustedDevices = pgTable('admin_trusted_devices', {
  id: id(), // sha256 токена
  adminId: text('admin_id').notNull(),
  expiresAt: timestamp('expires_at', { mode: 'date' }).notNull(),
});

export const auditLog = pgTable('audit_log', {
  id: id(),
  adminId: text('admin_id').notNull(),
  action: text('action').notNull(),
  targetType: text('target_type').notNull(),
  targetId: text('target_id').notNull(),
  before: jsonb('before'),
  after: jsonb('after'),
  createdAt: created(),
});

export const rateEvents = pgTable(
  'rate_events',
  {
    id: id(),
    key: text('key').notNull(),
    createdAt: timestamp('created_at', { mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [index('rate_key_idx').on(t.key, t.createdAt)],
);

