CREATE TABLE "lms_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"status" text DEFAULT 'unverified' NOT NULL,
	"cookie_ciphertext" "bytea",
	"cookie_nonce" "bytea",
	"cookie_auth_tag" "bytea",
	"key_version" integer,
	"credential_expires_at" timestamp with time zone,
	"last_validated_at" timestamp with time zone,
	"last_rotated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "lms_connections_status_check" CHECK ("lms_connections"."status" in ('unverified','valid','expired','blocked','revoked','unknown')),
	CONSTRAINT "lms_connections_encrypted_all_or_none" CHECK ((("lms_connections"."cookie_ciphertext" is null and "lms_connections"."cookie_nonce" is null and "lms_connections"."cookie_auth_tag" is null and "lms_connections"."key_version" is null) or ("lms_connections"."cookie_ciphertext" is not null and "lms_connections"."cookie_nonce" is not null and "lms_connections"."cookie_auth_tag" is not null and "lms_connections"."key_version" is not null)))
);
--> statement-breakpoint
ALTER TABLE "lms_connections" ADD CONSTRAINT "lms_connections_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lms_connections_user_id_unique" ON "lms_connections" USING btree ("user_id");