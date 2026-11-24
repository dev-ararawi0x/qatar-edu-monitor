import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "../../lib/api.js";
import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card.js";
import { Input } from "../../components/ui/input.js";
import { Label } from "../../components/ui/label.js";

export const Route = createFileRoute("/_authed/settings")({
  component: SettingsPage,
});

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    return body.error?.message ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

function CredentialsSection() {
  const queryClient = useQueryClient();
  const [cookie, setCookie] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const statusQuery = useQuery({
    queryKey: ["credentials", "status"],
    queryFn: async () => {
      const res = await api.api.credentials.status.$get();
      if (!res.ok) throw new Error(await readError(res));
      return res.json();
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await api.api.credentials.cookie.$put({
        json: {
          cookie,
          ...(baseUrl.trim() ? { lmsBaseUrl: baseUrl.trim() } : {}),
        },
      });
      if (!res.ok) throw new Error(await readError(res));
      return res.json();
    },
    onSuccess: () => {
      setCookie("");
      setMessage("تم حفظ الكوكيز والتحقق منها.");
      void queryClient.invalidateQueries({ queryKey: ["credentials"] });
    },
    onError: (e) => setMessage(e.message),
  });

  const verifyMutation = useMutation({
    mutationFn: async () => {
      const res = await api.api.credentials.verify.$post();
      if (!res.ok) throw new Error(await readError(res));
      return res.json();
    },
    onSuccess: (data) => {
      setMessage(
        data.verified
          ? "الجلسة فعّالة."
          : "الجلسة منتهية الصلاحية — حدّث الكوكيز.",
      );
      void queryClient.invalidateQueries({ queryKey: ["credentials"] });
    },
    onError: (e) => setMessage(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await api.api.credentials.cookie.$delete();
      if (!res.ok) throw new Error(await readError(res));
      return res.json();
    },
    onSuccess: () => {
      setMessage("تم حذف الكوكيز المحفوظة.");
      void queryClient.invalidateQueries({ queryKey: ["credentials"] });
    },
    onError: (e) => setMessage(e.message),
  });

  const status = statusQuery.data;

  return (
    <Card>
      <CardHeader>
        <CardTitle>جلسة منصة التعليم (Cookies)</CardTitle>
        <CardDescription>
          احفظ كوكيز جلستك في منصة قطر للتعليم. تُشفَّر الكوكيز في قاعدة البيانات
          ولا تُعرض مرة أخرى.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {statusQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">جارٍ التحميل...</p>
        ) : status ? (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <Badge
              variant={
                status.sessionStatus === "active" ? "default" : "destructive"
              }
            >
              {status.sessionStatus === "active"
                ? "الجلسة فعّالة"
                : status.sessionStatus === "expired"
                  ? "الجلسة منتهية"
                  : "غير مُتحقق"}
            </Badge>
            {status.hasStoredCookie && (
              <span className="text-muted-foreground">
                الكوكيز المحفوظة: {status.cookieNames.join("، ") || "—"}
              </span>
            )}
            {status.lastVerifiedAt && (
              <span className="text-muted-foreground">
                آخر تحقق: {new Date(status.lastVerifiedAt).toLocaleString("ar")}
              </span>
            )}
          </div>
        ) : null}

        <div className="space-y-2">
          <Label htmlFor="lms-cookie">رأس الكوكيز (Cookie header)</Label>
          <textarea
            id="lms-cookie"
            dir="ltr"
            rows={3}
            value={cookie}
            onChange={(e) => setCookie(e.target.value)}
            placeholder="session_id=...; _qeducation_session=..."
            className="flex w-full rounded-md border border-input bg-card px-3 py-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="lms-base-url">رابط المنصة (اختياري)</Label>
          <Input
            id="lms-base-url"
            dir="ltr"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://qeducation.edu.gov.qa"
          />
        </div>

        {message && <p className="text-sm text-muted-foreground">{message}</p>}

        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={!cookie.trim() || saveMutation.isPending}
          >
            {saveMutation.isPending ? "جارٍ الحفظ..." : "حفظ والتحقق"}
          </Button>
          <Button
            variant="outline"
            onClick={() => verifyMutation.mutate()}
            disabled={!status?.hasStoredCookie || verifyMutation.isPending}
          >
            إعادة التحقق
          </Button>
          <Button
            variant="destructive"
            onClick={() => deleteMutation.mutate()}
            disabled={!status?.hasStoredCookie || deleteMutation.isPending}
          >
            حذف الكوكيز
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

interface LlmSettings {
  source: string;
  useCustomConfig: boolean;
  provider: string;
  model: string;
  hasCustomApiKey: boolean;
  baseUrl: string | null;
  fallbackModels: string[];
  languagePreference: string;
}

function LlmSection() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    useCustomConfig: false,
    provider: "gemini",
    model: "",
    apiKey: "",
    baseUrl: "",
    fallbackModels: "",
    languagePreference: "auto",
  });
  const [message, setMessage] = useState<string | null>(null);

  const settingsQuery = useQuery({
    queryKey: ["settings", "llm"],
    queryFn: async () => {
      const res = await api.api.settings.llm.$get();
      if (!res.ok) throw new Error(await readError(res));
      return res.json() as Promise<LlmSettings>;
    },
  });

  useEffect(() => {
    const s = settingsQuery.data;
    if (!s) return;
    setForm({
      useCustomConfig: s.useCustomConfig,
      provider: s.provider || "gemini",
      model: s.model ?? "",
      apiKey: "",
      baseUrl: s.baseUrl ?? "",
      fallbackModels: (s.fallbackModels ?? []).join(", "),
      languagePreference: s.languagePreference ?? "auto",
    });
  }, [settingsQuery.data]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await api.api.settings.llm.$put({
        json: {
          useCustomConfig: form.useCustomConfig,
          provider: form.provider,
          model: form.model || undefined,
          ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {}),
          baseUrl: form.baseUrl || undefined,
          fallbackModels: form.fallbackModels
            .split(",")
            .map((m) => m.trim())
            .filter(Boolean),
          languagePreference: form.languagePreference as "auto" | "ar" | "en",
        },
      });
      if (!res.ok) throw new Error(await readError(res));
      return res.json();
    },
    onSuccess: () => {
      setForm((f) => ({ ...f, apiKey: "" }));
      setMessage("تم حفظ إعدادات الذكاء الاصطناعي.");
      void queryClient.invalidateQueries({ queryKey: ["settings", "llm"] });
    },
    onError: (e) => setMessage(e.message),
  });

  const s = settingsQuery.data;

  return (
    <Card>
      <CardHeader>
        <CardTitle>إعدادات الذكاء الاصطناعي</CardTitle>
        <CardDescription>
          {s?.source === "server"
            ? "تُستخدم إعدادات الخادم الافتراضية. فعّل التخصيص لإدخال مفتاحك الخاص."
            : "تُستخدم إعداداتك المخصصة المحفوظة بشكل مشفر."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.useCustomConfig}
            onChange={(e) =>
              setForm((f) => ({ ...f, useCustomConfig: e.target.checked }))
            }
            className="size-4"
          />
          استخدام إعدادات مخصصة (مفتاح API خاص بي)
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>المزوّد</Label>
            <select
              value={form.provider}
              onChange={(e) => setForm((f) => ({ ...f, provider: e.target.value }))}
              className="flex h-9 w-full rounded-md border border-input bg-card px-3 text-sm"
            >
              <option value="gemini">Gemini</option>
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic</option>
              <option value="mock">Mock (للاختبار)</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label>النموذج</Label>
            <Input
              dir="ltr"
              value={form.model}
              onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
              placeholder="gemini-2.0-flash"
            />
          </div>
          <div className="space-y-2">
            <Label>مفتاح API {s?.hasCustomApiKey ? "(محفوظ)" : ""}</Label>
            <Input
              dir="ltr"
              type="password"
              value={form.apiKey}
              onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
              placeholder={s?.hasCustomApiKey ? "••••••••" : "sk-..."}
            />
          </div>
          <div className="space-y-2">
            <Label>الرابط الأساسي (اختياري)</Label>
            <Input
              dir="ltr"
              value={form.baseUrl}
              onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))}
            />
          </div>
          <div className="space-y-2">
            <Label>النماذج الاحتياطية (مفصولة بفاصلة)</Label>
            <Input
              dir="ltr"
              value={form.fallbackModels}
              onChange={(e) =>
                setForm((f) => ({ ...f, fallbackModels: e.target.value }))
              }
            />
          </div>
          <div className="space-y-2">
            <Label>لغة الإجابات</Label>
            <select
              value={form.languagePreference}
              onChange={(e) =>
                setForm((f) => ({ ...f, languagePreference: e.target.value }))
              }
              className="flex h-9 w-full rounded-md border border-input bg-card px-3 text-sm"
            >
              <option value="auto">تلقائي</option>
              <option value="ar">العربية</option>
              <option value="en">English</option>
            </select>
          </div>
        </div>

        {message && <p className="text-sm text-muted-foreground">{message}</p>}

        <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
          {saveMutation.isPending ? "جارٍ الحفظ..." : "حفظ الإعدادات"}
        </Button>
      </CardContent>
    </Card>
  );
}

function SettingsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-2xl font-bold">الإعدادات</h1>
      <CredentialsSection />
      <LlmSection />
    </div>
  );
}
