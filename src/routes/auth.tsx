import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CircuitBoard } from "lucide-react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { lovable } from "@/integrations/lovable/index";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/auth")({
  validateSearch: z.object({ error: z.string().optional() }),
  head: () => ({
    meta: [
      { title: "Conectare — PCB Checker UPB" },
      { name: "description", content: "Conectează-te cu contul Microsoft 365 al Universității POLITEHNICA București." },
      { property: "og:title", content: "Conectare — PCB Checker UPB" },
      { property: "og:description", content: "Autentificare cu contul universitar @upb.ro / @student.upb.ro." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const { error } = Route.useSearch();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(
    error === "domain" ? "Doar conturile @upb.ro, @student.upb.ro și @cetti.ro au acces." : null,
  );

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session && !error) navigate({ to: "/dashboard" });
    });
    const { data: sub } = supabase.auth.onAuthStateChange((ev, session) => {
      if (ev === "SIGNED_IN" && session) navigate({ to: "/dashboard" });
    });
    return () => sub.subscription.unsubscribe();
  }, [navigate, error]);

  const signIn = async () => {
    setBusy(true);
    setMsg(null);
    const res = await lovable.auth.signInWithOAuth("microsoft", {
      redirect_uri: `${window.location.origin}/auth`,
      extraParams: { prompt: "select_account" },
    });
    if (res.error) {
      setMsg("Conectarea a eșuat. Încearcă din nou.");
      setBusy(false);
      return;
    }
    if (res.redirected) return;
    navigate({ to: "/dashboard" });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background pcb-grid px-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-8 text-center shadow-xl">
        <CircuitBoard className="mx-auto h-8 w-8 text-primary" />
        <h1 className="mt-4 text-xl font-semibold text-card-foreground">PCB Checker & CAM</h1>
        <p className="mt-2 text-sm text-muted-foreground">Folosește contul universitar Microsoft 365.</p>
        <Button className="mt-6 w-full" size="lg" onClick={signIn} disabled={busy}>
          <svg viewBox="0 0 21 21" className="mr-2 h-4 w-4" aria-hidden>
            <rect x="1" y="1" width="9" height="9" fill="currentColor" opacity=".9" />
            <rect x="11" y="1" width="9" height="9" fill="currentColor" opacity=".7" />
            <rect x="1" y="11" width="9" height="9" fill="currentColor" opacity=".7" />
            <rect x="11" y="11" width="9" height="9" fill="currentColor" opacity=".5" />
          </svg>
          Conectare cu Microsoft 365
        </Button>
        {msg && <p className="mt-4 text-sm text-destructive">{msg}</p>}
        <p className="mt-6 text-xs text-muted-foreground">Acces permis: @upb.ro · @student.upb.ro · @cetti.ro</p>
      </div>
    </div>
  );
}
