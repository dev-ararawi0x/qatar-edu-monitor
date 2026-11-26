CREATE TABLE "answer_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_question_id" uuid NOT NULL,
	"answer_payload" jsonb NOT NULL,
	"explanation" text,
	"confidence" numeric(4, 3),
	"remote_save_status" text DEFAULT 'not_enabled' NOT NULL,
	"external_draft_id" text,
	"origin" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"reviewed_at" timestamp with time zone,
	"updated_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "answer_drafts_confidence_check" CHECK ("answer_drafts"."confidence" is null or ("answer_drafts"."confidence" >= 0 and "answer_drafts"."confidence" <= 1)),
	CONSTRAINT "answer_drafts_version_check" CHECK ("answer_drafts"."version" > 0),
	CONSTRAINT "answer_drafts_remote_status_check" CHECK ("answer_drafts"."remote_save_status" in ('not_enabled','not_started','pending','saved','ambiguous','failed')),
	CONSTRAINT "answer_drafts_origin_check" CHECK ("answer_drafts"."origin" in ('ai_generated','user_entered','edited'))
);
--> statement-breakpoint
CREATE TABLE "draft_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"draft_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"answer_payload" jsonb NOT NULL,
	"actor_type" text NOT NULL,
	"actor_user_id" text,
	"change_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "draft_revisions_actor_type_check" CHECK ("draft_revisions"."actor_type" in ('system','user'))
);
--> statement-breakpoint
ALTER TABLE "answer_drafts" ADD CONSTRAINT "answer_drafts_job_question_id_job_questions_id_fk" FOREIGN KEY ("job_question_id") REFERENCES "public"."job_questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answer_drafts" ADD CONSTRAINT "answer_drafts_updated_by_user_id_user_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_revisions" ADD CONSTRAINT "draft_revisions_draft_id_answer_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."answer_drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_revisions" ADD CONSTRAINT "draft_revisions_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "answer_drafts_question_unique" ON "answer_drafts" USING btree ("job_question_id");--> statement-breakpoint
CREATE UNIQUE INDEX "draft_revisions_draft_version_unique" ON "draft_revisions" USING btree ("draft_id","version");--> statement-breakpoint
CREATE INDEX "draft_revisions_draft_created_idx" ON "draft_revisions" USING btree ("draft_id","created_at");