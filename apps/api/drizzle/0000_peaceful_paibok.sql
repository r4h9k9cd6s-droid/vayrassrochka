CREATE TABLE "admin_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"admin_id" text NOT NULL,
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_trusted_devices" (
	"id" text PRIMARY KEY NOT NULL,
	"admin_id" text NOT NULL,
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admins" (
	"id" text PRIMARY KEY NOT NULL,
	"login" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" text DEFAULT 'owner' NOT NULL,
	"totp_secret" text NOT NULL,
	"backup_codes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"admin_id" text NOT NULL,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "complaints" (
	"id" text PRIMARY KEY NOT NULL,
	"installment_id" text NOT NULL,
	"user_id" text NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "contact_reports" (
	"id" text PRIMARY KEY NOT NULL,
	"installment_id" text NOT NULL,
	"user_id" text NOT NULL,
	"result" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feedback" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"text" text NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "installment_events" (
	"id" text PRIMARY KEY NOT NULL,
	"installment_id" text NOT NULL,
	"type" text NOT NULL,
	"date" text NOT NULL,
	"amount" integer,
	"segment_id" text,
	"voided_at" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "installments" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"title" text NOT NULL,
	"category" text DEFAULT 'other' NOT NULL,
	"icon" text DEFAULT 'bag' NOT NULL,
	"seller_type" text DEFAULT 'none' NOT NULL,
	"seller_id" text,
	"cost" integer NOT NULL,
	"down_payment" integer DEFAULT 0 NOT NULL,
	"term_months" integer NOT NULL,
	"monthly_payment" integer,
	"purchase_date" text NOT NULL,
	"payment_day" integer NOT NULL,
	"extra_terms" text DEFAULT '' NOT NULL,
	"published" boolean DEFAULT false NOT NULL,
	"feed_state" text DEFAULT 'visible' NOT NULL,
	"doubt_requests" integer DEFAULT 0 NOT NULL,
	"doubtful" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"trashed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"read_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "pot_payments" (
	"id" text PRIMARY KEY NOT NULL,
	"pot_id" text NOT NULL,
	"month" integer NOT NULL,
	"date" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pots" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"participants" integer NOT NULL,
	"contribution" integer NOT NULL,
	"payment_day" integer NOT NULL,
	"my_turn" integer NOT NULL,
	"start_date" text NOT NULL,
	"already_paid" integer DEFAULT 0 NOT NULL,
	"received" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_log" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_events" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seller_history" (
	"id" text PRIMARY KEY NOT NULL,
	"installment_id" text NOT NULL,
	"old_seller_id" text,
	"new_seller_id" text,
	"by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sellers" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"name_norm" text DEFAULT '' NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"login" text NOT NULL,
	"password_hash" text NOT NULL,
	"backup_code_hash" text NOT NULL,
	"backup_code_acked" boolean DEFAULT false NOT NULL,
	"theme" text DEFAULT 'auto' NOT NULL,
	"hide_amounts" boolean DEFAULT false NOT NULL,
	"push_enabled" boolean DEFAULT true NOT NULL,
	"reminder_time" text DEFAULT '09:00' NOT NULL,
	"timezone_offset_min" integer DEFAULT 180 NOT NULL,
	"avatar" text,
	"welcome_seen" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE UNIQUE INDEX "admins_login_uq" ON "admins" USING btree ("login");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_uq" ON "contact_reports" USING btree ("installment_id","user_id");--> statement-breakpoint
CREATE INDEX "events_inst_idx" ON "installment_events" USING btree ("installment_id");--> statement-breakpoint
CREATE INDEX "inst_user_idx" ON "installments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "inst_feed_idx" ON "installments" USING btree ("published","feed_state","created_at");--> statement-breakpoint
CREATE INDEX "notif_user_idx" ON "notifications" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pot_month_uq" ON "pot_payments" USING btree ("pot_id","month");--> statement-breakpoint
CREATE UNIQUE INDEX "pushlog_key_uq" ON "push_log" USING btree ("dedupe_key");--> statement-breakpoint
CREATE UNIQUE INDEX "push_endpoint_uq" ON "push_subscriptions" USING btree ("endpoint");--> statement-breakpoint
CREATE INDEX "rate_key_idx" ON "rate_events" USING btree ("key","created_at");--> statement-breakpoint
CREATE INDEX "sellers_phone_idx" ON "sellers" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "sellers_name_idx" ON "sellers" USING btree ("name_norm");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_login_uq" ON "users" USING btree ("login");