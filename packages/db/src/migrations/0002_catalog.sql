CREATE TABLE "assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_id" uuid NOT NULL,
	"external_assessment_id" text NOT NULL,
	"title" text NOT NULL,
	"assessment_type" text,
	"due_at" timestamp with time zone,
	"source_status" text,
	"timed_quiz_status" text DEFAULT 'unknown' NOT NULL,
	"source_updated_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone NOT NULL,
	"safe_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assessments_timed_status_check" CHECK ("assessments"."timed_quiz_status" in ('yes','no','unknown'))
);
--> statement-breakpoint
CREATE TABLE "subjects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lms_connection_id" uuid NOT NULL,
	"external_subject_id" text NOT NULL,
	"name" text NOT NULL,
	"grade_label" text,
	"section_label" text,
	"source_updated_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subjects" ADD CONSTRAINT "subjects_lms_connection_id_lms_connections_id_fk" FOREIGN KEY ("lms_connection_id") REFERENCES "public"."lms_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "assessments_subject_external_unique" ON "assessments" USING btree ("subject_id","external_assessment_id");--> statement-breakpoint
CREATE INDEX "assessments_subject_due_idx" ON "assessments" USING btree ("subject_id","due_at");--> statement-breakpoint
CREATE UNIQUE INDEX "subjects_connection_external_unique" ON "subjects" USING btree ("lms_connection_id","external_subject_id");