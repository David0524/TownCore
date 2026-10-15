CREATE TABLE "thread_reads" (
	"thread_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"read_at" timestamp with time zone NOT NULL,
	CONSTRAINT "thread_reads_thread_id_staff_id_pk" PRIMARY KEY("thread_id","staff_id")
);
--> statement-breakpoint
ALTER TABLE "thread_reads" ADD CONSTRAINT "thread_reads_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_reads" ADD CONSTRAINT "thread_reads_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "threads_status_recent_idx" ON "threads" USING btree ("status","last_message_at");--> statement-breakpoint
CREATE INDEX "threads_domain_idx" ON "threads" USING btree ("domain_id");--> statement-breakpoint
CREATE INDEX "threads_assignee_idx" ON "threads" USING btree ("assignee_id");