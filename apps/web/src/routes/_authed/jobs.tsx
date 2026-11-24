import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api.js";
import {
  ACTIVE_BATCH_STATUSES,
  ACTIVE_JOB_STATUSES,
  jobsRefetchInterval,
  type BatchDto,
} from "../../lib/jobs.js";
import { Badge } from "../../components/ui/badge.js";
import { Button, buttonVariants } from "../../components/ui/button.js";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card.js";
import { Progress } from "../../components/ui/progress.js";
import { Skeleton } from "../../components/ui/skeleton.js";
import {
  BATCH_STATUS_LABELS,
  jobStatusColor,
  jobStatusLabel,
} from "../../lib/status.js";

export const Route = createFileRoute("/_authed/jobs")({
  component: JobsPage,
});

function JobsPage() {
  const queryClient = useQueryClient();

  const batchesQuery = useQuery({
    queryKey: ["jobs", "batches"],
    queryFn: async () => {
      const res = await api.api.jobs.batches.$get();
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json() as Promise<{ batches: BatchDto[] }>;
    },
    // Smart polling: only poll while any batch/job is active.
    refetchInterval: jobsRefetchInterval,
  });

  const cancelBatch = useMutation({
    mutationFn: async (batchId: string) => {
      const res = await api.api.jobs.batches[":batchId"].cancel.$post({
        param: { batchId },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ["jobs"] }),
  });

  const cancelJob = useMutation({
    mutationFn: async (jobId: string) => {
      const res = await api.api.jobs.jobs[":jobId"].cancel.$post({
        param: { jobId },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ["jobs"] }),
  });

  const retryJob = useMutation({
    mutationFn: async (jobId: string) => {
      const res = await api.api.jobs.jobs[":jobId"].retry.$post({
        param: { jobId },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ["jobs"] }),
  });

  const batches = batchesQuery.data?.batches ?? [];
  const hasActive = batches.some(
    (b) =>
      ACTIVE_BATCH_STATUSES.has(b.status) ||
      b.jobs.some((j) => ACTIVE_JOB_STATUSES.has(j.status)),
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">المهام الخلفية</h1>
          <p className="text-sm text-muted-foreground">
            {hasActive
              ? "توجد مهام قيد التنفيذ — يتم التحديث تلقائياً."
              : "لا توجد مهام نشطة حالياً."}
          </p>
        </div>
        {hasActive && (
          <span className="relative flex size-3">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75" />
            <span className="relative inline-flex size-3 rounded-full bg-blue-500" />
          </span>
        )}
      </div>

      {batchesQuery.isLoading && (
        <div className="space-y-4">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-48" />
          ))}
        </div>
      )}

      {!batchesQuery.isLoading && batches.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            لا توجد دفعات بعد. اذهب إلى لوحة المواد وأضف اختبارات إلى الطابور.
          </CardContent>
        </Card>
      )}

      {batches.map((batch) => {
        const batchActive = ACTIVE_BATCH_STATUSES.has(batch.status);
        return (
          <Card key={batch.id}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base">
                    دفعة #{batch.id.slice(0, 8)}
                  </CardTitle>
                  <CardDescription>
                    {new Date(batch.createdAt).toLocaleString("ar")} —{" "}
                    {batch.completedJobs}/{batch.totalJobs} مكتمل
                    {batch.failedJobs > 0 && ` • ${batch.failedJobs} فشل`}
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Badge>{BATCH_STATUS_LABELS[batch.status] ?? batch.status}</Badge>
                  {batchActive && (
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => cancelBatch.mutate(batch.id)}
                    >
                      إلغاء الدفعة
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {batch.jobs.map((job) => {
                const pct =
                  job.totalParts && job.totalParts > 0
                    ? Math.round((job.currentPart / job.totalParts) * 100)
                    : job.status === "completed"
                      ? 100
                      : 0;
                return (
                  <div
                    key={job.id}
                    className="rounded-md border border-border p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">
                          {job.quizTitle}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {job.currentPart > 0 &&
                            `الجزء ${job.currentPart}${job.totalParts ? `/${job.totalParts}` : ""} • `}
                          محاولات: {job.attempts}
                          {job.errorMessage && ` • ${job.errorMessage}`}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {job.status === "completed" && (
                          <Link
                            to="/quizzes/$quizId"
                            params={{ quizId: job.quizId }}
                            className={buttonVariants({
                              variant: "outline",
                              size: "sm",
                            })}
                          >
                            مراجعة
                          </Link>
                        )}
                        {(job.status === "failed" ||
                          job.status === "cancelled") && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => retryJob.mutate(job.id)}
                          >
                            إعادة
                          </Button>
                        )}
                        {ACTIVE_JOB_STATUSES.has(job.status) && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => cancelJob.mutate(job.id)}
                          >
                            إلغاء
                          </Button>
                        )}
                        <Badge className={jobStatusColor(job.status)}>
                          {jobStatusLabel(job.status)}
                        </Badge>
                      </div>
                    </div>
                    {(job.status === "running" || job.status === "pending") && (
                      <Progress value={pct} className="mt-2" />
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
