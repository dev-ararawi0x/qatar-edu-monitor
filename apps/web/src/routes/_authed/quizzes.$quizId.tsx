import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api.js";
import {
  editableFieldDetails,
  initialAnswerFields,
  questionImageUrl,
  type AnswerFields,
  type ReviewQuestion,
} from "../../lib/review.js";
import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card.js";
import { Skeleton } from "../../components/ui/skeleton.js";
import {
  quizStatusColor,
  quizStatusLabel,
} from "../../lib/status.js";

export const Route = createFileRoute("/_authed/quizzes/$quizId")({
  component: ReviewPage,
});

interface QuestionDto extends ReviewQuestion {
  aiAnswer: {
    kind?: string;
    confidence?: number;
    reasoning?: string;
    text?: string;
    selectedValue?: string;
    selectedValues?: string[];
    fields?: Record<string, string>;
    accompanyingText?: string;
  } | null;
  formattedSummary: string | null;
  lmsRecordedAnswer: string | null;
  isVerifiedOnLms: boolean;
}

interface QuizDetail {
  id: string;
  title: string;
  status: string;
  classTitle: string;
  totalParts: number | null;
  summaryVerified: boolean;
  pausedSafely: boolean;
  warnings: string[];
  questions: QuestionDto[];
}

function QuestionImage({
  quizId,
  part,
  index,
}: {
  quizId: string;
  part: number;
  index: number;
}) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    fetch(questionImageUrl(quizId, part, index), { credentials: "include" })
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error("img"))))
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      })
      .catch(() => setSrc(null));
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [quizId, part, index]);
  if (!src) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" className="max-h-64 rounded-md border" />
  );
}

function QuestionEditor({
  quizId,
  question,
  onSaved,
}: {
  quizId: string;
  question: QuestionDto;
  onSaved: () => void;
}) {
  const [fields, setFields] = useState<AnswerFields>(() =>
    initialAnswerFields(question),
  );
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      const res = await api.api.quizzes[":quizId"].questions[":part"].$patch({
        param: { quizId, part: String(question.part) },
        json: { fields },
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
      }
      return res.json();
    },
    onSuccess: () => {
      setDirty(false);
      setError(null);
      onSaved();
    },
    onError: (e) => setError(e.message),
  });

  const setField = (name: string, value: string | string[]) => {
    setFields((prev) => ({ ...prev, [name]: value }));
    setDirty(true);
  };

  const choices = question.choices ?? [];
  const fieldDetails = editableFieldDetails(question);

  const renderEditor = () => {
    if (question.inputType === "single_choice" && choices.length > 0) {
      const name = choices[0]?.fieldName ?? "answer";
      const current = String(fields[name] ?? "");
      return (
        <div className="space-y-1.5">
          {choices.map((c) => (
            <label key={c.value} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name={`${question.id}-${name}`}
                className="size-4"
                checked={current === c.value}
                onChange={() => setField(name, c.value)}
              />
              {c.label}
            </label>
          ))}
        </div>
      );
    }
    if (question.inputType === "multiple_choice" && choices.length > 0) {
      const name = choices[0]?.fieldName ?? "answer";
      const current = (fields[name] as string[] | undefined) ?? [];
      return (
        <div className="space-y-1.5">
          {choices.map((c) => (
            <label key={c.value} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4"
                checked={current.includes(c.value)}
                onChange={(e) =>
                  setField(
                    name,
                    e.target.checked
                      ? [...current, c.value]
                      : current.filter((v) => v !== c.value),
                  )
                }
              />
              {c.label}
            </label>
          ))}
        </div>
      );
    }
    // Generic field-details editor
    const names = [...new Set(fieldDetails.map((f) => f.name))];
    if (names.length === 0) {
      return (
        <p className="text-sm text-muted-foreground">
          لا توجد حقول قابلة للتعديل لهذا النوع من الأسئلة.
        </p>
      );
    }
    return (
      <div className="space-y-3">
        {names.map((name) => {
          const detail = fieldDetails.find((f) => f.name === name);
          const value = fields[name];
          const strValue = Array.isArray(value) ? value.join(", ") : (value ?? "");
          return (
            <div key={name} className="space-y-1">
              {detail?.contextLabel && (
                <div className="text-xs text-muted-foreground">
                  {detail.contextLabel}
                </div>
              )}
              <input
                className="flex h-9 w-full rounded-md border border-input bg-card px-3 text-sm"
                dir="auto"
                value={strValue}
                onChange={(e) => setField(name, e.target.value)}
                placeholder={name}
              />
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="space-y-3">
      {renderEditor()}
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button
        size="sm"
        variant="outline"
        disabled={!dirty || save.isPending}
        onClick={() => save.mutate()}
      >
        {save.isPending ? "جارٍ الحفظ..." : "حفظ التعديل على المنصة"}
      </Button>
    </div>
  );
}

function ReviewPage() {
  const { quizId } = Route.useParams();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);
  const [finishDone, setFinishDone] = useState(false);

  const quizQuery = useQuery({
    queryKey: ["quiz", quizId],
    queryFn: async () => {
      const res = await api.api.quizzes[":quizId"].$get({
        param: { quizId },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json() as Promise<QuizDetail>;
    },
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["quiz", quizId] });
    void queryClient.invalidateQueries({ queryKey: ["classes"] });
    void queryClient.invalidateQueries({ queryKey: ["jobs"] });
  };

  const reverify = useMutation({
    mutationFn: async () => {
      const res = await api.api.quizzes[":quizId"].reverify.$post({
        param: { quizId },
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
      }
      return res.json();
    },
    onSuccess: invalidate,
  });

  const finish = useMutation({
    mutationFn: async () => {
      const res = await api.api.quizzes[":quizId"].finish.$post({
        param: { quizId },
        json: { confirmFinish: true },
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
      }
      return res.json();
    },
    onSuccess: () => {
      setFinishDone(true);
      setConfirming(false);
      invalidate();
    },
    onError: (e) => {
      setFinishError(e.message);
      setConfirming(false);
    },
  });

  const quiz = quizQuery.data;
  const canFinish = quiz?.status === "ready_for_review" && !finishDone;

  const summary = useMemo(() => {
    if (!quiz) return null;
    return quiz.questions.map((q) => ({
      part: q.part,
      answer: q.lmsRecordedAnswer ?? q.formattedSummary ?? "—",
      verified: q.isVerifiedOnLms,
    }));
  }, [quiz]);

  if (quizQuery.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (!quiz) {
    return <p className="text-muted-foreground">الاختبار غير موجود.</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{quiz.title}</h1>
          <p className="text-sm text-muted-foreground">
            {quiz.classTitle}
            {quiz.totalParts ? ` • ${quiz.totalParts} أجزاء` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge className={quizStatusColor(quiz.status)}>
            {quizStatusLabel(quiz.status)}
          </Badge>
          {quiz.summaryVerified && (
            <Badge variant="secondary">الملخص متحقق</Badge>
          )}
        </div>
      </div>

      {(quiz.warnings ?? []).length > 0 && (
        <div className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {quiz.warnings.map((w, i) => (
            <div key={i}>{w}</div>
          ))}
        </div>
      )}

      {finishDone && (
        <div className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          تم تسليم الاختبار بنجاح.
        </div>
      )}
      {finishError && (
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {finishError}
        </div>
      )}

      {/* Summary strip */}
      {summary && summary.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">ملخص الإجابات المسجلة</CardTitle>
            <CardDescription>
              الإجابات كما سُجّلت في شاشة الملخص على المنصة.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {summary.map((s) => (
                <div
                  key={s.part}
                  className="rounded-md border border-border p-2 text-sm"
                >
                  <div className="mb-1 flex items-center justify-between">
                    <span className="font-medium">س{s.part}</span>
                    {s.verified && (
                      <Badge variant="secondary" className="text-[10px]">
                        متحقق
                      </Badge>
                    )}
                  </div>
                  <div className="line-clamp-2 text-muted-foreground">
                    {s.answer}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Questions */}
      <div className="space-y-4">
        {quiz.questions.map((q) => (
          <Card key={q.id}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">
                  {q.questionHeader ?? `سؤال ${q.part}`}
                  {q.points ? ` (${q.points})` : ""}
                </CardTitle>
                <Badge variant="outline">{q.inputType ?? ""}</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {q.promptText && (
                <p className="whitespace-pre-wrap text-sm">{q.promptText}</p>
              )}
              {q.imageUrls.map((_, i) => (
                <QuestionImage
                  key={i}
                  quizId={quizId}
                  part={q.part}
                  index={i}
                />
              ))}

              {q.aiAnswer && (
                <div className="rounded-md bg-muted/60 p-3 text-sm">
                  <div className="mb-1 font-medium">إجابة الذكاء الاصطناعي</div>
                  <div className="whitespace-pre-wrap text-muted-foreground">
                    {q.aiAnswer.text ??
                      q.aiAnswer.selectedValue ??
                      q.aiAnswer.selectedValues?.join("، ") ??
                      q.aiAnswer.accompanyingText ??
                      q.formattedSummary ??
                      "—"}
                  </div>
                  {q.aiAnswer.reasoning && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs text-muted-foreground">
                        التبرير
                        {q.aiAnswer.confidence != null &&
                          ` (ثقة: ${Math.round(q.aiAnswer.confidence * 100)}%)`}
                      </summary>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {q.aiAnswer.reasoning}
                      </p>
                    </details>
                  )}
                </div>
              )}

              <QuestionEditor
                quizId={quizId}
                question={q}
                onSaved={invalidate}
              />
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Actions */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 py-4">
          <Button
            variant="outline"
            onClick={() => reverify.mutate()}
            disabled={reverify.isPending}
          >
            {reverify.isPending ? "جارٍ التحقق..." : "إعادة التحقق من الملخص"}
          </Button>
          {canFinish && !confirming && (
            <Button onClick={() => setConfirming(true)}>
              تسليم الاختبار نهائياً
            </Button>
          )}
          {confirming && (
            <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm">
              <span>هل أنت متأكد من تسليم هذا الاختبار؟ لا يمكن التراجع.</span>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => finish.mutate()}
                disabled={finish.isPending}
              >
                {finish.isPending ? "جارٍ التسليم..." : "تأكيد التسليم"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setConfirming(false)}
              >
                إلغاء
              </Button>
            </div>
          )}
          {quiz.status === "finished" && (
            <span className="text-sm text-emerald-700">تم التسليم.</span>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
