CREATE TABLE "assessment_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"assessment_id" uuid NOT NULL,
	"lms_quiz_id" text NOT NULL,
	"lms_results_id" text NOT NULL,
	"timed_quiz_status" text DEFAULT 'unknown' NOT NULL,
	"source_status" text,
	"last_seen_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assessment_attempts_timed_status_check" CHECK ("assessment_attempts"."timed_quiz_status" in ('yes','no','unknown'))
);
--> statement-breakpoint
CREATE TABLE "job_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"external_question_id" text,
	"position" integer NOT NULL,
	"question_type" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"pause_reason" text,
	"question_fingerprint" text,
	"normalized_question" jsonb,
	"parser_version" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_questions_identity_check" CHECK ("job_questions"."external_question_id" is not null or "job_questions"."question_fingerprint" is not null),
	CONSTRAINT "job_questions_position_check" CHECK ("job_questions"."position" > 0),
	CONSTRAINT "job_questions_status_check" CHECK ("job_questions"."status" in ('pending','processing','draft_saved','manual_input_required','failed','skipped'))
);
--> statement-breakpoint
CREATE TABLE "solve_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"attempt_id" uuid NOT NULL,
	"lms_quiz_id" text NOT NULL,
	"lms_results_id" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"question_manifest_status" text DEFAULT 'pending' NOT NULL,
	"question_manifest_loaded_at" timestamp with time zone,
	"pause_reason" text,
	"last_error_code" text,
	"user_message" text,
	"current_question_position" integer,
	"total_questions" integer DEFAULT 0 NOT NULL,
	"completed_questions" integer DEFAULT 0 NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_by" text,
	"lease_expires_at" timestamp with time zone,
	"heartbeat_at" timestamp with time zone,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "solve_jobs_status_check" CHECK ("solve_jobs"."status" in ('queued','running','paused','completed','failed')),
	CONSTRAINT "solve_jobs_manifest_status_check" CHECK ("solve_jobs"."question_manifest_status" in ('pending','ready','failed')),
	CONSTRAINT "solve_jobs_counts_check" CHECK ("solve_jobs"."total_questions" >= 0 and "solve_jobs"."completed_questions" >= 0 and "solve_jobs"."completed_questions" <= "solve_jobs"."total_questions"),
	CONSTRAINT "solve_jobs_attempts_check" CHECK ("solve_jobs"."attempt_count" >= 0 and "solve_jobs"."max_attempts" > 0)
);
--> statement-breakpoint
CREATE TABLE "quota_buckets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"metric" text NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"limit_units" bigint NOT NULL,
	"reserved_units" bigint DEFAULT 0 NOT NULL,
	"consumed_units" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quota_buckets_nonnegative_check" CHECK ("quota_buckets"."limit_units" >= 0 and "quota_buckets"."reserved_units" >= 0 and "quota_buckets"."consumed_units" >= 0),
	CONSTRAINT "quota_buckets_period_check" CHECK ("quota_buckets"."period_end" > "quota_buckets"."period_start")
);
--> statement-breakpoint
CREATE TABLE "quota_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bucket_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"reference_type" text NOT NULL,
	"reference_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"units" bigint NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quota_events_units_check" CHECK ("quota_events"."units" > 0),
	CONSTRAINT "quota_events_type_check" CHECK ("quota_events"."event_type" in ('reserve','consume','release','adjust'))
);
--> statement-breakpoint
ALTER TABLE "assessment_attempts" ADD CONSTRAINT "assessment_attempts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_attempts" ADD CONSTRAINT "assessment_attempts_assessment_id_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_questions" ADD CONSTRAINT "job_questions_job_id_solve_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."solve_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solve_jobs" ADD CONSTRAINT "solve_jobs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solve_jobs" ADD CONSTRAINT "solve_jobs_attempt_id_assessment_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."assessment_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quota_buckets" ADD CONSTRAINT "quota_buckets_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quota_events" ADD CONSTRAINT "quota_events_bucket_id_quota_buckets_id_fk" FOREIGN KEY ("bucket_id") REFERENCES "public"."quota_buckets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quota_events" ADD CONSTRAINT "quota_events_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "assessment_attempts_identity_unique" ON "assessment_attempts" USING btree ("user_id","lms_quiz_id","lms_results_id");--> statement-breakpoint
CREATE INDEX "assessment_attempts_assessment_seen_idx" ON "assessment_attempts" USING btree ("assessment_id","last_seen_at");--> statement-breakpoint
CREATE UNIQUE INDEX "job_questions_job_position_unique" ON "job_questions" USING btree ("job_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "job_questions_external_unique" ON "job_questions" USING btree ("job_id","external_question_id") WHERE "job_questions"."external_question_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "job_questions_fingerprint_unique" ON "job_questions" USING btree ("job_id","question_fingerprint") WHERE "job_questions"."question_fingerprint" is not null;--> statement-breakpoint
CREATE INDEX "job_questions_job_position_idx" ON "job_questions" USING btree ("job_id","position");--> statement-breakpoint
CREATE INDEX "job_questions_job_status_idx" ON "job_questions" USING btree ("job_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "solve_jobs_active_tuple_unique" ON "solve_jobs" USING btree ("user_id","lms_quiz_id","lms_results_id") WHERE "solve_jobs"."status" in ('queued','running','paused');--> statement-breakpoint
CREATE INDEX "solve_jobs_queue_claim_idx" ON "solve_jobs" USING btree ("available_at","created_at") WHERE "solve_jobs"."status" = 'queued';--> statement-breakpoint
CREATE INDEX "solve_jobs_owner_created_idx" ON "solve_jobs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "solve_jobs_lease_recovery_idx" ON "solve_jobs" USING btree ("lease_expires_at") WHERE "solve_jobs"."status" = 'running';--> statement-breakpoint
CREATE UNIQUE INDEX "quota_buckets_user_metric_period_unique" ON "quota_buckets" USING btree ("user_id","metric","period_start");--> statement-breakpoint
CREATE UNIQUE INDEX "quota_events_user_idempotency_unique" ON "quota_events" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "quota_events_user_created_idx" ON "quota_events" USING btree ("user_id","created_at");