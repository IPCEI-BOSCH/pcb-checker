import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CheckCircle2, ChevronLeft, ChevronRight, CircuitBoard, Loader2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { createFirstAdmin, seedUpbStructure, setupHealth, setupStatus } from "@/lib/setup.functions";

export const Route = createFileRoute("/setup")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Configurare inițială — PCB Checker UPB" },
      { name: "description", content: "Wizard de configurare la prima rulare a serverului local PCB Checker & CAM." },
      { property: "og:title", content: "Configurare inițială — PCB Checker UPB" },
      { property: "og:description", content: "Wizard de configurare la prima rulare a serverului local." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SetupWizard,
});

type Health = Awaited<ReturnType<typeof setupHealth>>;

const STEPS = ["Sănătate sistem", "Cont administrator", "Structură UPB", "Integrări opționale", "Finalizare"];

function SetupWizard() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [status, setStatus] = useState<Awaited<ReturnType<typeof setupStatus>> | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [healthErr, setHealthErr] = useState<string | null>(null);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [setupToken, setSetupToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [seedResult, setSeedResult] = useState<string | null>(null);
  const [workersOk, setWorkersOk] = useState<boolean | null>(null);

  useEffect(() => {
    setupStatus()
      .then((s) => {
        setStatus(s);
        if (!s.needsSetup && s.mode !== "selfhost") navigate({ to: "/auth" });
      })
      .catch(() => setStatus(null));
    setWorkersOk(typeof Worker !== "undefined");
  }, [navigate]);

  useEffect(() => {
    if (step === 0 && !health) {
      setupHealth()
        .then(setHealth)
        .catch((e) => setHealthErr((e as Error).message));
    }
  }, [step, health]);

  const createAdmin = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await createFirstAdmin({ data: { fullName, email, password, setupToken } });
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
      if (error) throw new Error("Cont creat, dar autentificarea a eșuat: " + error.message);
      setStep(2);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const seed = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await seedUpbStructure();
      setSeedResult(`An universitar ${r.year}: ${r.seriesCreated} serii noi create (grupele 431–434 incluse).`);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const allOk = health?.checks.every((c) => c.ok) ?? false;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background pcb-grid px-4 py-10">
      <div className="w-full max-w-2xl rounded-lg border border-border bg-card p-8 shadow-xl">
        <div className="flex items-center gap-2">
          <CircuitBoard className="h-6 w-6 text-primary" />
          <h1 className="text-lg font-semibold text-card-foreground">Configurare inițială — server local</h1>
        </div>

        <ol className="mt-6 flex flex-wrap gap-2 text-xs">
          {STEPS.map((s, i) => (
            <li
              key={s}
              className={`rounded-full px-3 py-1 ${
                i === step ? "bg-primary text-primary-foreground" : i < step ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
              }`}
            >
              {i + 1}. {s}
            </li>
          ))}
        </ol>

        <div className="mt-6 min-h-[280px]">
          {step === 0 && (
            <div>
              <h2 className="font-medium text-card-foreground">Pasul 1 — Verificare sănătate sistem</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Verificăm conexiunea la baza de date, tabelele aplicației, stocarea fișierelor și suportul browserului.
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                {health?.diagnostics.detail ?? status?.diagnostics.detail}
                {" "}Google Drive, Sheets și AI sunt opționale; lipsa cheilor nu blochează pornirea sau verificarea geometrică locală.
              </p>
              <ul className="mt-4 space-y-2 text-sm">
                {health?.checks.map((c) => (
                  <li key={c.name} className="flex items-start gap-2">
                    {c.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-primary" /> : <XCircle className="mt-0.5 h-4 w-4 text-destructive" />}
                    <span className="text-card-foreground">
                      {c.name} <span className="text-muted-foreground">— {c.detail}</span>
                    </span>
                  </li>
                ))}
                <li className="flex items-start gap-2">
                  {workersOk ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-primary" /> : <XCircle className="mt-0.5 h-4 w-4 text-destructive" />}
                  <span className="text-card-foreground">
                    Web Workers în browser <span className="text-muted-foreground">— {workersOk ? "disponibili (DRC paralel)" : "indisponibili"}</span>
                  </span>
                </li>
              </ul>
              {!health && !healthErr && (
                <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Se verifică…
                </p>
              )}
              {healthErr && <p className="mt-4 text-sm text-destructive">{healthErr}</p>}
              {health && !allOk && (
                <p className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                  Unele verificări au eșuat. Pe server, rulează <code>./pcb-ctl.sh doctor</code> sau reaplică <code>selfhost/sql/schema.sql</code>.
                </p>
              )}
            </div>
          )}

          {step === 1 && (
            <div>
              <h2 className="font-medium text-card-foreground">Pasul 2 — Contul principal de profesor (Administrator General)</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Cont local cu parolă criptată (bcrypt) în baza de date a serverului — funcționează imediat, fără configurare Microsoft.
              </p>
              <div className="mt-4 max-w-sm space-y-3">
                <Input placeholder="Nume complet" value={fullName} onChange={(e) => setFullName(e.target.value)} />
                <Input placeholder="email@upb.ro / @cetti.ro" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                <Input placeholder="Parolă (min. 8 caractere)" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
                <Input placeholder="Cod de instalare (SETUP_TOKEN din .env pe server)" value={setupToken} onChange={(e) => setSetupToken(e.target.value)} />
                <Button onClick={createAdmin} disabled={busy || fullName.length < 2 || !email.includes("@") || password.length < 8}>
                  {busy ? "Se creează…" : "Creează contul de administrator"}
                </Button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div>
              <h2 className="font-medium text-card-foreground">Pasul 3 — Anul universitar, seriile și grupele</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Creează automat anul universitar curent, seriile A–D cu grupele 431–434 și varianta SMT implicită. Regulile DRC standard
                CETTI sunt deja încorporate; le poți ajusta ulterior din „Reguli &amp; Setări".
              </p>
              <Button className="mt-4" onClick={seed} disabled={busy || !!seedResult}>
                {busy ? "Se populează…" : "Populează structura standard UPB ETTI"}
              </Button>
              {seedResult && <p className="mt-3 text-sm text-primary">{seedResult}</p>}
              <p className="mt-3 text-xs text-muted-foreground">Poți sări acest pas și să creezi seriile manual din Administrare.</p>
            </div>
          )}

          {step === 3 && (
            <div>
              <h2 className="font-medium text-card-foreground">Pasul 4 — Integrări externe (opțional, configurabile ulterior)</h2>
              <ul className="mt-4 space-y-3 text-sm text-card-foreground">
                <li>
                  <strong>Microsoft Entra ID / Google OAuth</strong> — completează <code>AZURE_CLIENT_ID</code>, <code>AZURE_CLIENT_SECRET</code>,{" "}
                  <code>AZURE_TENANT_URL</code> în <code>.env.selfhost</code> și repornește stack-ul. Fără ele, autentificarea locală
                  email+parolă rămâne complet funcțională.
                </li>
                <li>
                  <strong>Google Sheets Sync</strong> — adaugă <code>GOOGLE_SERVICE_ACCOUNT_JSON</code> (sau tripletele OAuth) în{" "}
                  <code>.env.selfhost</code>. Partajează foile de calcul cu email-ul contului de serviciu.
                </li>
                <li>
                  <strong>Motor AI (OCR serigrafie &amp; reguli AI)</strong> — implicit <em>Dezactivat (100% geometric local)</em>. Pentru AI local
                  în rețeaua universității: <code>OPENAI_BASE_URL=http://&lt;server-ollama&gt;:11434/v1</code>,{" "}
                  <code>OPENAI_API_KEY=ollama</code>, <code>AI_MODEL=qwen2.5-vl</code>. Sau pornește profilul Ollama:{" "}
                  <code>docker compose --profile ai up -d</code>.
                </li>
              </ul>
              <p className="mt-4 text-xs text-muted-foreground">
                Detalii pas cu pas: pagina „Ghid Instalare Server Local" (/selfhost), tabul „Ghid de instalare".
              </p>
            </div>
          )}

          {step === 4 && (
            <div className="text-center">
              <CheckCircle2 className="mx-auto h-12 w-12 text-primary" />
              <h2 className="mt-4 text-lg font-medium text-card-foreground">Serverul este pregătit!</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Contul de administrator este activ, structura academică este creată. Studenții se pot înregistra cu adresa instituțională
                {status?.labInviteRequired ? " și codul de înrolare de laborator" : ""}.
              </p>
              <Button className="mt-6" size="lg" onClick={() => navigate({ to: "/dashboard" })}>
                Deschide tabloul de bord
              </Button>
            </div>
          )}

          {msg && <p className="mt-4 text-sm text-destructive">{msg}</p>}
        </div>

        <div className="mt-6 flex justify-between border-t border-border pt-4">
          <Button variant="ghost" size="sm" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
            <ChevronLeft className="mr-1 h-4 w-4" /> Înapoi
          </Button>
          {step !== 1 && step !== 4 && (
            <Button variant="ghost" size="sm" onClick={() => setStep((s) => Math.min(4, s + 1))} disabled={step === 0 && !health}>
              {step === 2 || step === 3 ? "Sari peste / Continuă" : "Continuă"} <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
