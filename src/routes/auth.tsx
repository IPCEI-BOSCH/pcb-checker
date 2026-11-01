import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CircuitBoard, Server } from "lucide-react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { lovable } from "@/integrations/lovable/index";
import { supabase } from "@/integrations/supabase/client";
import { checkInviteCode } from "@/lib/setup.functions";

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

const SELF_HOST = import.meta.env["VITE_SELF_HOSTED"] === "true";
const ALLOWED = ["@student.upb.ro", "@upb.ro", "@cetti.ro"];

function AuthPage() {
  const navigate = useNavigate();
  const { error } = Route.useSearch();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(
    error === "domain" ? "Doar conturile @upb.ro, @student.upb.ro și @cetti.ro au acces." : null,
  );
  const [tab, setTab] = useState<"microsoft" | "local" | "signup">("microsoft");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [invite, setInvite] = useState("");

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
    // Self-hosted: Microsoft Entra ID directly through the auth server ("azure" provider).
    if (SELF_HOST) {
      const { error: e } = await supabase.auth.signInWithOAuth({
        provider: "azure",
        options: { redirectTo: `${window.location.origin}/auth`, scopes: "email openid profile", queryParams: { prompt: "select_account" } },
      });
      if (e) {
        setMsg("Conectarea a eșuat. Încearcă din nou.");
        setBusy(false);
      }
      return;
    }
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

  const localSignIn = async () => {
    setBusy(true);
    setMsg(null);
    const { error: e } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    if (e) {
      setMsg("Email sau parolă incorectă.");
      setBusy(false);
    }
  };

  const localSignUp = async () => {
    const em = email.trim().toLowerCase();
    if (!ALLOWED.some((d) => em.endsWith(d))) {
      setMsg("Doar adresele @student.upb.ro, @upb.ro și @cetti.ro sunt acceptate.");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const inv = await checkInviteCode({ data: { code: invite } });
      if (!inv.ok) {
        setMsg("Codul de înrolare de laborator este incorect.");
        return;
      }
      const { error: e } = await supabase.auth.signUp({
        email: em,
        password,
        options: { data: { full_name: fullName.trim() } },
      });
      if (e) setMsg(e.message.includes("already") ? "Există deja un cont cu acest email." : e.message);
      else setMsg("Cont creat. Te poți autentifica acum.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background pcb-grid px-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-8 text-center shadow-xl">
        <CircuitBoard className="mx-auto h-8 w-8 text-primary" />
        <h1 className="mt-4 text-xl font-semibold text-card-foreground">Conectare la PCB Checker &amp; CAM</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {SELF_HOST ? "Server local UPB — autentificare Microsoft sau cont local." : "Folosește contul universitar Microsoft 365."}
        </p>

        {SELF_HOST && (
          <div className="mt-5 grid grid-cols-3 gap-1 rounded-md bg-muted p-1 text-xs">
            {(
              [
                ["microsoft", "Microsoft"],
                ["local", "Cont local"],
                ["signup", "Cont nou"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                onClick={() => {
                  setTab(k);
                  setMsg(null);
                }}
                className={`rounded px-2 py-1.5 ${tab === k ? "bg-card text-foreground shadow" : "text-muted-foreground"}`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {(!SELF_HOST || tab === "microsoft") && (
          <Button className="mt-6 w-full" size="lg" onClick={signIn} disabled={busy}>
            <svg viewBox="0 0 21 21" className="mr-2 h-4 w-4" aria-hidden>
              <rect x="1" y="1" width="9" height="9" fill="currentColor" opacity=".9" />
              <rect x="11" y="1" width="9" height="9" fill="currentColor" opacity=".7" />
              <rect x="1" y="11" width="9" height="9" fill="currentColor" opacity=".7" />
              <rect x="11" y="11" width="9" height="9" fill="currentColor" opacity=".5" />
            </svg>
            Conectare cu Microsoft 365
          </Button>
        )}

        {SELF_HOST && tab !== "microsoft" && (
          <div className="mt-5 space-y-3 text-left">
            {tab === "signup" && (
              <Input placeholder="Nume complet" value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" />
            )}
            <Input placeholder="email@student.upb.ro" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
            <Input
              placeholder="Parolă (min. 8 caractere)"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={tab === "signup" ? "new-password" : "current-password"}
            />
            {tab === "signup" && (
              <Input placeholder="Cod de înrolare laborator (dacă profesorul a dat unul)" value={invite} onChange={(e) => setInvite(e.target.value)} />
            )}
            <Button className="w-full" onClick={tab === "local" ? localSignIn : localSignUp} disabled={busy || !email || password.length < 8}>
              {tab === "local" ? "Autentificare" : "Creează contul"}
            </Button>
          </div>
        )}

        {msg && <p className={`mt-4 text-sm ${msg.startsWith("Cont creat") ? "text-primary" : "text-destructive"}`}>{msg}</p>}
        <p className="mt-6 text-xs text-muted-foreground">Acces permis: @upb.ro · @student.upb.ro · @cetti.ro</p>
        <Link to="/selfhost" className="mt-3 inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:underline">
          <Server className="h-3 w-3" /> Ghid Instalare Server Local (Self-Host Kit)
        </Link>
      </div>
    </div>
  );
}
