CREATE TABLE "integration_rate_limit_state" (
	"bucket_key" text PRIMARY KEY NOT NULL,
	"tokens" numeric(12, 4) NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"blocked_until" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "lms_account_leases" (
	"lms_connection_id" uuid PRIMARY KEY NOT NULL,
	"owner_token" uuid NOT NULL,
	"worker_id" text NOT NULL,
	"lease_expires_at" timestamp with time zone NOT NULL,
	"heartbeat_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lms_account_leases" ADD CONSTRAINT "lms_account_leases_lms_connection_id_lms_connections_id_fk" FOREIGN KEY ("lms_connection_id") REFERENCES "public"."lms_connections"("id") ON DELETE cascade ON UPDATE no action;