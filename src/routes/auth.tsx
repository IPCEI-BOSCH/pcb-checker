import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CircuitBoard, Server } from "lucide-react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GoogleMark } from "@/components/GoogleMark";
import { lovable } from "@/integrations/lovable/index";
import { supabase } from "@/integrations/supabase/client";
import { checkInviteCode } from "@/lib/setup.functions";
import { AUTH_DESTINATION_KEY, safeAuthDestination } from "@/lib/auth-policy";

export const Route = createFileRoute("/auth")({
  validateSearch: z.object({ error: z.string().optional(), redirect: z.string().optional() }),
  head: () => ({ meta: [
    { title: "Conectare — PCB Checker UPB" },
    { name: "description", content: "Conectare PCB Checker cu Microsoft universitar, Google sau email și parolă." },
    { property: "og:title", content: "Conectare — PCB Checker UPB" },
    { property: "og:description", content: "Conturile universitare sunt preferate; conturile alternative sunt acceptate." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }), component: AuthPage,
});
const SELF_HOST = import.meta.env["VITE_SELF_HOSTED"] === "true";
function AuthPage() {
  const navigate = useNavigate();
  const { error, redirect } = Route.useSearch();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(error ? "Conectarea nu a fost finalizată. Încearcă din nou." : null);
  const [notice, setNotice] = useState(false);
  const [tab, setTab] = useState<"local" | "signup" | "forgot">("local");
  const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState(""); const [invite, setInvite] = useState("");
  useEffect(() => {
    if (redirect) sessionStorage.setItem(AUTH_DESTINATION_KEY, safeAuthDestination(redirect));
    supabase.auth.getUser().then(({ data }) => { if (data.user && !error) navigate({ to: safeAuthDestination(sessionStorage.getItem(AUTH_DESTINATION_KEY)) }); });
  }, [navigate, redirect, error]);
  const social = async (provider: "microsoft" | "google" | "lovable") => {
    setBusy(true); setMsg(null); setNotice(false);
    try {
      if (SELF_HOST) {
        const { error: e } = await supabase.auth.signInWithOAuth({ provider: provider === "microsoft" ? "azure" : "google", options: { redirectTo: `${window.location.origin}/auth`, scopes: "email openid profile", queryParams: { prompt: "select_account" } } });
        if (e) throw e; return;
      }
      const res = await lovable.auth.signInWithOAuth(provider, { redirect_uri: `${window.location.origin}/auth`, extraParams: { prompt: "select_account" } });
      if (res.error) throw res.error;
      if (res.redirected) return;
      navigate({ to: safeAuthDestination(sessionStorage.getItem(AUTH_DESTINATION_KEY)) });
    } catch { setMsg("Conectarea a eșuat. Încearcă din nou sau folosește emailul și parola."); setBusy(false); }
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setMsg(null); setNotice(false);
    const em = email.trim().toLowerCase();
    try {
      if (tab === "forgot") {
        const { error: err } = await supabase.auth.resetPasswordForEmail(em, { redirectTo: `${window.location.origin}/reset-password` });
        if (err) throw err;
        setNotice(true); setMsg("Dacă adresa are cont, vei primi un link pentru resetarea parolei.");
      } else if (tab === "signup") {
        if (SELF_HOST) { const inv = await checkInviteCode({ data: { code: invite } }); if (!inv.ok) throw new Error("invite"); }
        const { data, error: err } = await supabase.auth.signUp({ email: em, password, options: { emailRedirectTo: `${window.location.origin}/auth`, data: { full_name: fullName.trim() } } });
        if (err) throw err;
        if (data.session) navigate({ to: "/dashboard" });
        else { setNotice(true); setMsg("Verifică emailul și confirmă adresa înainte de autentificare."); }
      } else {
        const { error: err } = await supabase.auth.signInWithPassword({ email: em, password });
        if (err) throw err;
        navigate({ to: safeAuthDestination(sessionStorage.getItem(AUTH_DESTINATION_KEY)) });
      }
    } catch (err) {
      setMsg(err instanceof Error && err.message === "invite" ? "Codul de înrolare este incorect." : tab === "local" ? "Email sau parolă incorectă, ori adresă încă neconfirmată." : "Cererea nu a putut fi finalizată. Verifică datele și încearcă din nou.");
    } finally { setBusy(false); }
  };
  return <div className="flex min-h-screen items-center justify-center bg-background pcb-grid px-4 py-8">
    <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6 text-center shadow-xl">
      <CircuitBoard className="mx-auto h-8 w-8 text-primary" /><h1 className="mt-4 text-xl font-semibold text-card-foreground">PCB Checker &amp; CAM</h1>
      <p className="mt-2 text-sm text-muted-foreground">Cont universitar preferat: @upb.ro · @student.upb.ro · @cetti.ro</p>
      <div className="mt-5 space-y-2">
        <Button className="w-full" onClick={() => social("microsoft")} disabled={busy}>Continuă cu Microsoft 365</Button>
        <Button className="google-sign-in w-full gap-[10px] px-3" onClick={() => social("google")} disabled={busy}><GoogleMark />Continuă cu Google</Button>
        {!SELF_HOST && <Button variant="outline" className="w-full" onClick={() => social("lovable")} disabled={busy}>Continuă cu Lovable</Button>}
      </div>
      <div className="mt-5 flex justify-center gap-2 border-b border-border pb-2">
        <Button size="sm" variant={tab === "local" ? "secondary" : "ghost"} onClick={() => { setTab("local"); setMsg(null); }}>Email și parolă</Button>
        <Button size="sm" variant={tab === "signup" ? "secondary" : "ghost"} onClick={() => { setTab("signup"); setMsg(null); }}>Cont nou</Button>
      </div>
      <form onSubmit={submit} className="mt-4 space-y-3 text-left">
        {tab === "signup" && <div><Label htmlFor="full-name">Nume complet</Label><Input id="full-name" required value={fullName} onChange={e => setFullName(e.target.value)} autoComplete="name" /></div>}
        <div><Label htmlFor="auth-email">Email</Label><Input id="auth-email" required type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" /></div>
        {tab !== "forgot" && <div><Label htmlFor="auth-password">Parolă</Label><Input id="auth-password" required minLength={tab === "signup" ? 8 : undefined} type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete={tab === "signup" ? "new-password" : "current-password"} /></div>}
        {tab === "signup" && SELF_HOST && <div><Label htmlFor="invite">Cod laborator</Label><Input id="invite" value={invite} onChange={e => setInvite(e.target.value)} /></div>}
        <Button type="submit" className="w-full" disabled={busy}>{tab === "forgot" ? "Trimite link de resetare" : tab === "signup" ? "Creează contul" : "Autentificare"}</Button>
      </form>
      {tab === "local" && <Button variant="link" size="sm" onClick={() => { setTab("forgot"); setMsg(null); }}>Ai uitat parola?</Button>}
      {msg && <p role="status" className={`mt-3 text-sm ${notice ? "text-success" : "text-destructive"}`}>{msg}</p>}
      <p className="mt-4 text-xs text-muted-foreground">Sunt acceptate și adrese personale. Conturile noi primesc rolul Student; grupa este validată de îndrumător.</p>
      <Link to="/selfhost" className="mt-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline"><Server className="h-3 w-3" />Ghid instalare server local</Link>
    </div>
  </div>;
}
