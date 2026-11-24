import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import type { FormEvent } from "react";
import { authClient } from "../lib/api.js";
import { ThemeToggle } from "../components/theme-toggle.js";
import { Button } from "../components/ui/button.js";
import { Input } from "../components/ui/input.js";
import { Label } from "../components/ui/label.js";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/card.js";

export const Route = createFileRoute("/login")({
  beforeLoad: async () => {
    const { data } = await authClient.getSession();
    if (data?.user) {
      throw redirect({ to: "/" });
    }
  },
  component: LoginPage,
});

type AuthMode = "signin" | "signup";

const MODE_COPY: Record<
  AuthMode,
  { title: string; description: string; submit: string; loading: string }
> = {
  signin: {
    title: "تسجيل الدخول",
    description: "أدخل بريدك الإلكتروني وكلمة المرور للمتابعة.",
    submit: "تسجيل الدخول",
    loading: "جارٍ تسجيل الدخول...",
  },
  signup: {
    title: "إنشاء حساب",
    description: "أنشئ حساباً جديداً للبدء باستخدام المنصة.",
    submit: "إنشاء الحساب",
    loading: "جارٍ إنشاء الحساب...",
  },
};

function LoginPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<AuthMode>("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const copy = MODE_COPY[mode];

  const switchMode = (next: AuthMode) => {
    setMode(next);
    setError(null);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError(null);

    const result =
      mode === "signin"
        ? await authClient.signIn.email({ email, password })
        : await authClient.signUp.email({ email, password, name });

    setLoading(false);

    if (result.error) {
      setError(result.error.message ?? "حدث خطأ غير متوقع. حاول مرة أخرى.");
      return;
    }

    await navigate({ to: "/" });
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background p-4">
      <div className="absolute end-4 top-4">
        <ThemeToggle />
      </div>
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">مراقب التعليم في قطر</CardTitle>
          <CardDescription>{copy.description}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-1 rounded-md bg-muted p-1">
            {(["signin", "signup"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => switchMode(m)}
                className={`rounded-sm px-3 py-1.5 text-sm font-medium transition-colors ${
                  mode === m
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {m === "signin" ? "تسجيل الدخول" : "حساب جديد"}
              </button>
            ))}
          </div>

          {error && (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          <form onSubmit={submit} className="flex flex-col gap-4">
            {mode === "signup" && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="name">الاسم</Label>
                <Input
                  id="name"
                  type="text"
                  autoComplete="name"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="الاسم الكامل"
                />
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email">البريد الإلكتروني</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                dir="ltr"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password">كلمة المرور</Label>
              <Input
                id="password"
                type="password"
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                required
                minLength={8}
                dir="ltr"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="8 أحرف على الأقل"
              />
            </div>

            <Button type="submit" disabled={loading} className="w-full">
              {loading ? copy.loading : copy.submit}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
