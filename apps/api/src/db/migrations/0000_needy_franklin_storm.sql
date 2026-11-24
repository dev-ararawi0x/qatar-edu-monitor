CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "user_llm_settings" (
	"user_id" text PRIMARY KEY NOT NULL,
	"use_custom_config" boolean DEFAULT false NOT NULL,
	"provider" text,
	"model" text,
	"base_url" text,
	"fallback_models" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"encrypted_api_key" text,
	"language_preference" text DEFAULT 'auto' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_lms_credentials" (
	"user_id" text PRIMARY KEY NOT NULL,
	"lms_base_url" text NOT NULL,
	"encrypted_cookie" text NOT NULL,
	"cookie_names" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"session_status" text DEFAULT 'unverified' NOT NULL,
	"last_verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lms_classes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"lms_class_id" text NOT NULL,
	"title" text NOT NULL,
	"teacher_name" text,
	"href" text,
	"is_manual" boolean DEFAULT false NOT NULL,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lms_quizzes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"class_id" uuid NOT NULL,
	"lms_quiz_id" text NOT NULL,
	"lms_results_id" text,
	"title" text NOT NULL,
	"show_url" text,
	"display_url" text,
	"related_lesson_title" text,
	"is_timed" boolean DEFAULT false NOT NULL,
	"total_parts" integer,
	"status" text DEFAULT 'due_unsolved' NOT NULL,
	"summary_verified" boolean DEFAULT false NOT NULL,
	"paused_safely" boolean DEFAULT false NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_solved_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quiz_attempt_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quiz_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"part" integer NOT NULL,
	"question_header" text,
	"prompt_text" text,
	"points" text,
	"input_type" text,
	"choices" jsonb,
	"field_details" jsonb,
	"image_urls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ai_answer" jsonb,
	"user_override_answer" jsonb,
	"formatted_summary" text,
	"lms_recorded_answer" text,
	"confidence" double precision,
	"reasoning" text,
	"is_verified_on_lms" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "solve_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"total_jobs" integer DEFAULT 0 NOT NULL,
	"completed_jobs" integer DEFAULT 0 NOT NULL,
	"failed_jobs" integer DEFAULT 0 NOT NULL,
	"start_new_allowed" boolean DEFAULT false NOT NULL,
	"allow_timed" boolean DEFAULT false NOT NULL,
	"encrypted_cookie_override" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "solve_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"quiz_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"current_part" integer DEFAULT 0 NOT NULL,
	"total_parts" integer,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"next_run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" text,
	"error_code" text,
	"error_message" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_llm_settings" ADD CONSTRAINT "user_llm_settings_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_lms_credentials" ADD CONSTRAINT "user_lms_credentials_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lms_classes" ADD CONSTRAINT "lms_classes_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lms_quizzes" ADD CONSTRAINT "lms_quizzes_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lms_quizzes" ADD CONSTRAINT "lms_quizzes_class_id_lms_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."lms_classes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_attempt_questions" ADD CONSTRAINT "quiz_attempt_questions_quiz_id_lms_quizzes_id_fk" FOREIGN KEY ("quiz_id") REFERENCES "public"."lms_quizzes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_attempt_questions" ADD CONSTRAINT "quiz_attempt_questions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solve_batches" ADD CONSTRAINT "solve_batches_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solve_jobs" ADD CONSTRAINT "solve_jobs_batch_id_solve_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."solve_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solve_jobs" ADD CONSTRAINT "solve_jobs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solve_jobs" ADD CONSTRAINT "solve_jobs_quiz_id_lms_quizzes_id_fk" FOREIGN KEY ("quiz_id") REFERENCES "public"."lms_quizzes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lms_classes_user_class_uniq" ON "lms_classes" USING btree ("user_id","lms_class_id");--> statement-breakpoint
CREATE INDEX "lms_classes_user_idx" ON "lms_classes" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lms_quizzes_user_quiz_uniq" ON "lms_quizzes" USING btree ("user_id","lms_quiz_id");--> statement-breakpoint
CREATE INDEX "lms_quizzes_user_status_idx" ON "lms_quizzes" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "lms_quizzes_class_idx" ON "lms_quizzes" USING btree ("class_id");--> statement-breakpoint
CREATE UNIQUE INDEX "quiz_attempt_questions_quiz_part_uniq" ON "quiz_attempt_questions" USING btree ("quiz_id","part");--> statement-breakpoint
CREATE INDEX "quiz_attempt_questions_user_idx" ON "quiz_attempt_questions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "solve_batches_user_idx" ON "solve_batches" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "solve_jobs_active_quiz_uniq" ON "solve_jobs" USING btree ("quiz_id") WHERE "solve_jobs"."status" IN ('pending','running');--> statement-breakpoint
CREATE INDEX "solve_jobs_claim_idx" ON "solve_jobs" USING btree ("next_run_at","created_at") WHERE "solve_jobs"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "solve_jobs_user_status_idx" ON "solve_jobs" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "solve_jobs_batch_idx" ON "solve_jobs" USING btree ("batch_id");