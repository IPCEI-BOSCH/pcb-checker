import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/reset-password")({
  head: () => ({ meta: [
    { title: "Resetare parolă — PCB Checker UPB" }, { name: "description", content: "Setează o parolă nouă pentru contul PCB Checker folosind linkul primit prin email." },
    { property: "og:title", content: "Resetare parolă — PCB Checker UPB" }, { property: "og:description", content: "Recuperarea securizată a contului PCB Checker." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }), component: ResetPassword,
});
function ResetPassword() {
  const [ready, setReady] = useState(false); const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState(""); const [busy, setBusy] = useState(false); const [done, setDone] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    const hashRecovery = new URLSearchParams(window.location.hash.slice(1)).get("type") === "recovery";
    const { data: listener } = supabase.auth.onAuthStateChange(event => { if (event === "PASSWORD_RECOVERY") setReady(true); });
    if (hashRecovery) supabase.auth.getUser().then(({ data }) => setReady(!!data.user));
    return () => listener.subscription.unsubscribe();
  }, []);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); if (!ready || password !== confirm || password.length < 8) return;
    setBusy(true); const { error } = await supabase.auth.updateUser({ password }); setBusy(false);
    if (error) setMessage("Parola nu a putut fi schimbată. Solicită un link nou dacă acesta a expirat.");
    else { setDone(true); await supabase.auth.signOut(); }
  };
  return <div className="flex min-h-screen items-center justify-center bg-background px-4"><div className="w-full max-w-sm space-y-4">
    <h1 className="text-xl font-semibold">Resetare parolă</h1>
    {done ? <p role="status">Parola a fost schimbată.</p> : ready ? <form onSubmit={submit} className="space-y-3">
      <div><Label htmlFor="new-password">Parolă nouă</Label><Input id="new-password" type="password" autoComplete="new-password" minLength={8} required value={password} onChange={e => setPassword(e.target.value)} /></div>
      <div><Label htmlFor="confirm-password">Confirmă parola</Label><Input id="confirm-password" type="password" autoComplete="new-password" required value={confirm} onChange={e => setConfirm(e.target.value)} /></div>
      <Button type="submit" disabled={busy || password.length < 8 || password !== confirm}>Salvează parola</Button>
    </form> : <p className="text-sm text-muted-foreground">Deschide linkul de resetare primit prin email; dacă a expirat, solicită unul nou.</p>}
    {message && <p role="status" className="text-sm text-destructive">{message}</p>}
    <Button asChild variant="outline"><Link to="/auth">Înapoi la conectare</Link></Button>
  </div></div>;
}