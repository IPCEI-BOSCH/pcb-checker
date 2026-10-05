import { createFileRoute, Link, Outlet, redirect, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { CircuitBoard, History as HistoryIcon, ClipboardCheck, FileCheck2, FolderOpen, Grid3x3, SlidersHorizontal, LayoutDashboard, LogOut, Settings2, Table2, UserPlus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AuthContext, ROLE_LABELS, type AppRole } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw redirect({ to: "/auth" });
  },
  component: Layout,
});

function Layout() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("no_user");
      const { data, error } = await supabase.rpc("ensure_profile");
      if (error) throw error;
      return { user: u.user, roles: (data ?? []) as AppRole[] };
    },
    retry: false,
  });

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((ev) => {
      if (ev === "SIGNED_OUT") navigate({ to: "/auth", replace: true });
    });
    return () => sub.subscription.unsubscribe();
  }, [navigate]);

  useEffect(() => {
    if (q.error) {
      const domain = String((q.error as Error).message).includes("domain_not_allowed");
      supabase.auth.signOut().then(() => navigate({ to: "/auth", search: domain ? { error: "domain" } : {}, replace: true }));
    }
  }, [q.error, navigate]);

  const ctx = useMemo(() => {
    if (!q.data) return null;
    const roles = q.data.roles;
    return {
      user: q.data.user,
      roles,
      has: (...r: AppRole[]) => r.some((x) => roles.includes(x)),
      isStaff: roles.some((r) => r !== "student"),
    };
  }, [q.data]);

  if (!ctx) {
    return <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">Se încarcă…</div>;
  }

  const signOut = async () => {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  const nav = [
    { to: "/dashboard", label: "Panou", icon: LayoutDashboard, show: true },
    { to: "/self-check", label: "Self-Check & Predare", icon: FileCheck2, show: ctx.has("student") || !ctx.isStaff },
    { to: "/enroll", label: "Înscriere grupă", icon: UserPlus, show: ctx.has("student") || !ctx.isStaff },
    { to: "/review", label: "Evaluare grupe", icon: ClipboardCheck, show: ctx.has("admin", "series_manager", "instructor") },
    { to: "/files", label: "Dosarele proiectului", icon: FolderOpen, show: true },
    { to: "/gradebook", label: "Catalog & Sincronizare", icon: Table2, show: ctx.isStaff },
    { to: "/rules", label: "Reguli & Setări", icon: SlidersHorizontal, show: ctx.has("admin", "series_manager") },
    { to: "/cam", label: "Generator CAM", icon: Grid3x3, show: ctx.has("admin", "series_manager", "instructor", "cam_tech") },
    { to: "/history", label: "Istoric pe ani", icon: HistoryIcon, show: ctx.isStaff },
    { to: "/insights", label: "Statistici & Integritate", icon: ShieldAlert, show: ctx.isStaff },
    { to: "/admin", label: "Administrare", icon: Settings2, show: ctx.has("admin", "series_manager") },
  ] as const;

  return (
    <AuthContext.Provider value={ctx}>
      <div className="flex min-h-screen bg-background">
        <aside className="hidden w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex">
          <div className="flex items-center gap-2 px-5 py-5 font-mono text-sm font-semibold text-sidebar-foreground">
            <CircuitBoard className="h-5 w-5 text-sidebar-primary" /> PCB_CHECKER
          </div>
          <nav className="flex-1 space-y-1 px-3">
            {nav.filter((n) => n.show).map((n) => (
              <Link
                key={n.to}
                to={n.to}
                className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                activeProps={{ className: "bg-sidebar-accent text-sidebar-accent-foreground" }}
              >
                <n.icon className="h-4 w-4" /> {n.label}
              </Link>
            ))}
          </nav>
          <div className="border-t border-sidebar-border p-4">
            <div className="truncate text-sm text-sidebar-foreground">{ctx.user.email}</div>
            <div className="mt-1 flex flex-wrap gap-1">
              {ctx.roles.length ? ctx.roles.map((r) => (
                <span key={r} className="rounded bg-sidebar-accent px-1.5 py-0.5 text-[10px] text-sidebar-accent-foreground">{ROLE_LABELS[r]}</span>
              )) : <span className="text-[10px] text-muted-foreground">Fără rol atribuit</span>}
            </div>
            <Button variant="ghost" size="sm" className="mt-3 w-full justify-start" onClick={signOut}>
              <LogOut className="mr-2 h-4 w-4" /> Deconectare
            </Button>
            <ThemeToggle />
          </div>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between border-b border-border px-4 py-3 md:hidden">
            <span className="font-mono text-sm font-semibold text-foreground">PCB_CHECKER</span>
            <div className="flex gap-1 overflow-x-auto">
              {nav.filter((n) => n.show).map((n) => (
                <Link key={n.to} to={n.to} className="rounded p-2 text-muted-foreground" activeProps={{ className: "text-primary" }} aria-label={n.label}>
                  <n.icon className="h-4 w-4" />
                </Link>
              ))}
              <ThemeToggle compact />
              <button onClick={signOut} className="p-2 text-muted-foreground" aria-label="Deconectare"><LogOut className="h-4 w-4" /></button>
            </div>
          </div>
          <main className="mx-auto w-full max-w-7xl flex-1 p-4 md:p-8">
            <Outlet />
          </main>
        </div>
      </div>
      <Toaster />
    </AuthContext.Provider>
  );
}
