import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  BookOpen,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Settings,
} from "lucide-react";
import { authClient } from "../lib/api.js";
import { cn } from "../lib/utils.js";
import { Button } from "./ui/button.js";
import { ThemeToggle } from "./theme-toggle.js";

const NAV_ITEMS = [
  { to: "/", label: "لوحة المواد", icon: LayoutDashboard, exact: true },
  { to: "/jobs", label: "المهام الخلفية", icon: ListChecks },
  { to: "/settings", label: "الإعدادات", icon: Settings },
] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { data: session } = authClient.useSession();

  const signOut = async () => {
    await authClient.signOut();
    await navigate({ to: "/login" });
  };

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="flex w-60 shrink-0 flex-col border-e border-border bg-card">
        <div className="flex h-14 items-center gap-2 border-b border-border px-4">
          <BookOpen className="size-5 text-primary" />
          <span className="font-bold">مراقب التعليم</span>
        </div>
        <nav className="flex-1 space-y-1 p-3">
          {NAV_ITEMS.map(({ to, label, icon: Icon, ...rest }) => {
            const active =
              "exact" in rest && rest.exact
                ? pathname === to
                : pathname === to || pathname.startsWith(`${to}/`);
            return (
              <Link
                key={to}
                to={to}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <Icon className="size-4" />
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-border p-3">
          <div className="mb-2 truncate px-1 text-xs text-muted-foreground">
            {session?.user?.name ?? session?.user?.email ?? ""}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2"
            onClick={signOut}
          >
            <LogOut className="size-4" />
            تسجيل الخروج
          </Button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b border-border bg-card px-6">
          <div className="text-sm text-muted-foreground">
            منصة قطر للتعليم والتعلّم
          </div>
          <ThemeToggle />
        </header>
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
