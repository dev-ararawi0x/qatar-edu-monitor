import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api } from "../../lib/api.js";
import { SOLVABLE_QUIZ_STATUSES } from "../../lib/jobs.js";
import { Badge } from "../../components/ui/badge.js";
import { Button, buttonVariants } from "../../components/ui/button.js";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card.js";
import { Skeleton } from "../../components/ui/skeleton.js";
import { quizStatusColor, quizStatusLabel } from "../../lib/status.js";

export const Route = createFileRoute("/_authed/")({
  component: DashboardPage,
});

interface QuizDto {
  id: string;
  title: string;
  status: string;
  totalParts: number | null;
  summaryVerified: boolean;
}

interface ClassDto {
  id: string;
  title: string;
  teacherName: string | null;
  isManual: boolean;
  quizzes: QuizDto[];
}

const SOLVABLE = SOLVABLE_QUIZ_STATUSES;

function DashboardPage() {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const classesQuery = useQuery({
    queryKey: ["classes"],
    queryFn: async () => {
      const res = await api.api.classes.$get();
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json() as Promise<{ classes: ClassDto[] }>;
    },
  });

  const syncMutation = useMutation({
    mutationFn: async () => {
      const res = await api.api.classes.sync.$post();
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
      }
      return res.json();
    },
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ["classes"] }),
  });

  const solveMutation = useMutation({
    mutationFn: async (payload: { quizIds?: string[]; allDue?: boolean }) => {
      const res = await api.api.jobs.batches.$post({ json: payload });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
      }
      return res.json();
    },
    onSuccess: () => {
      setSelected(new Set());
      void queryClient.invalidateQueries({ queryKey: ["classes"] });
      void queryClient.invalidateQueries({ queryKey: ["jobs"] });
    },
  });

  const classes = classesQuery.data?.classes ?? [];
  const allQuizzes = useMemo(
    () => classes.flatMap((c) => c.quizzes),
    [classes],
  );
  const solvableIds = allQuizzes
    .filter((q) => SOLVABLE.has(q.status))
    .map((q) => q.id);
  const selectedSolvable = [...selected].filter((id) =>
    solvableIds.includes(id),
  );

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAll = () =>
    setSelected((prev) =>
      prev.size === solvableIds.length ? new Set() : new Set(solvableIds),
    );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">لوحة المواد والاختبارات</h1>
          <p className="text-sm text-muted-foreground">
            {classesQuery.isLoading
              ? "جارٍ التحميل..."
              : `${classes.length} مادة • ${allQuizzes.length} اختبار`}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={toggleAll}>
            {selected.size === solvableIds.length && solvableIds.length > 0
              ? "إلغاء تحديد الكل"
              : "تحديد الكل القابل للحل"}
          </Button>
          <Button
            variant="outline"
            onClick={() => solveMutation.mutate({ allDue: true })}
            disabled={solveMutation.isPending || solvableIds.length === 0}
          >
            حل جميع المستحقات
          </Button>
          <Button
            onClick={() => solveMutation.mutate({ quizIds: selectedSolvable })}
            disabled={
              solveMutation.isPending ||
              selectedSolvable.length === 0 ||
              selectedSolvable.length !== selected.size
            }
          >
            {solveMutation.isPending
              ? "جارٍ الإرسال..."
              : `حل المحدد (${selectedSolvable.length})`}
          </Button>
          <Button
            variant="secondary"
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending}
          >
            {syncMutation.isPending ? "جارٍ المزامنة..." : "مزامنة"}
          </Button>
        </div>
      </div>

      {(syncMutation.isError || solveMutation.isError) && (
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {syncMutation.error?.message ?? solveMutation.error?.message}
        </div>
      )}
      {solveMutation.isSuccess && (
        <div className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          تمت إضافة المهام إلى الطابور — تابعها من صفحة «المهام الخلفية».
        </div>
      )}

      {classesQuery.isLoading && (
        <div className="grid gap-4 md:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
      )}

      {!classesQuery.isLoading && classes.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            لا توجد مواد بعد. اضغط «مزامنة» لجلب موادك من المنصة.
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {classes.map((cls) => (
          <Card key={cls.id}>
            <CardHeader>
              <CardTitle className="text-lg">{cls.title}</CardTitle>
              <CardDescription>
                {cls.teacherName ?? ""}
                {cls.isManual ? " • يدوية" : ""}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {cls.quizzes.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  لا توجد اختبارات.
                </p>
              )}
              {cls.quizzes.map((q) => {
                const canSolve = SOLVABLE.has(q.status);
                const canReview = q.status === "ready_for_review";
                return (
                  <div
                    key={q.id}
                    className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2"
                  >
                    <label className="flex min-w-0 flex-1 items-center gap-2">
                      <input
                        type="checkbox"
                        className="size-4 shrink-0"
                        checked={selected.has(q.id)}
                        disabled={!canSolve}
                        onChange={() => toggle(q.id)}
                      />
                      <span className="truncate text-sm">{q.title}</span>
                    </label>
                    <div className="flex items-center gap-2">
                      {canReview && (
                        <Link
                          to="/quizzes/$quizId"
                          params={{ quizId: q.id }}
                          className={buttonVariants({
                            variant: "outline",
                            size: "sm",
                          })}
                        >
                          مراجعة
                        </Link>
                      )}
                      <Badge className={quizStatusColor(q.status)}>
                        {quizStatusLabel(q.status)}
                      </Badge>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
