CREATE TABLE "auth_login_limits" (
	"owner_id" uuid PRIMARY KEY NOT NULL,
	"window_started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "auth_login_limits_attempt_check" CHECK ("auth_login_limits"."attempts" BETWEEN 0 AND 20)
);
--> statement-breakpoint
CREATE TABLE "auth_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"credential_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "auth_sessions_token_unique" UNIQUE("token_hash"),
	CONSTRAINT "auth_sessions_hash_check" CHECK ("auth_sessions"."token_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "auth_sessions_lifetime_check" CHECK ("auth_sessions"."expires_at" > "auth_sessions"."created_at" AND "auth_sessions"."credential_version">0)
);
--> statement-breakpoint
CREATE TABLE "local_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"credential_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "local_accounts_id_owner_unique" UNIQUE("id","owner_id"),
	CONSTRAINT "local_accounts_owner_username_unique" UNIQUE("owner_id","username"),
	CONSTRAINT "local_accounts_username_check" CHECK ("local_accounts"."username" ~ '^[a-z0-9][a-z0-9_.-]{2,63}$'),
	CONSTRAINT "local_accounts_hash_check" CHECK ("local_accounts"."password_hash" ~ '^scrypt-v1[$][a-f0-9]{32}[$][a-f0-9]{128}$'),
	CONSTRAINT "local_accounts_role_check" CHECK ("local_accounts"."role" IN ('viewer','operator')),
	CONSTRAINT "local_accounts_version_check" CHECK ("local_accounts"."credential_version" > 0)
);
--> statement-breakpoint
ALTER TABLE "auth_login_limits" ADD CONSTRAINT "auth_login_limits_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_account_fk" FOREIGN KEY ("account_id","owner_id") REFERENCES "public"."local_accounts"("id","owner_id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
ALTER TABLE "local_accounts" ADD CONSTRAINT "local_accounts_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE restrict ON UPDATE restrict;--> statement-breakpoint
CREATE INDEX "auth_sessions_owner_expiry_idx" ON "auth_sessions" USING btree ("owner_id","expires_at");
