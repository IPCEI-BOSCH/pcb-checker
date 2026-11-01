import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Check, CheckCircle2, Clipboard, CircuitBoard, Download, Loader2, Printer, Server, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { platformHealth } from "@/lib/maintenance.functions";

export const Route = createFileRoute("/selfhost")({
  head: () => ({
    meta: [
      { title: "Ghid Instalare Server Local — PCB Checker UPB" },
      {
        name: "description",
        content:
          "Kit complet de self-hosting PCB Checker & CAM: generator de configurație, ghid de instalare Linux/Windows, administrare, backup și diagnostic live.",
      },
      { property: "og:title", content: "Ghid Instalare Server Local — PCB Checker UPB" },
      { property: "og:description", content: "Instalează PCB Checker & CAM pe serverul propriu: Docker, PostgreSQL, Nginx, fără dependențe cloud." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SelfhostPage,
});

const REPO = "https://github.com/IPCEI-BOSCH/pcb-checker.git";

function randHex(bytes: number): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

function CopyBtn({ text, label = "Copiază", disabled = false }: { text: string; label?: string; disabled?: boolean }) {
  const [ok, setOk] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={disabled}
      className="h-7 gap-1 text-xs"
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setOk(true);
          setTimeout(() => setOk(false), 1500);
        });
      }}
    >
      {ok ? <Check className="h-3 w-3" /> : <Clipboard className="h-3 w-3" />} {ok ? "Copiat!" : label}
    </Button>
  );
}

function CodeBlock({ title, code }: { title?: string; code: string }) {
  return (
    <div className="rounded-md border border-border bg-muted/40">
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
        <span className="text-xs font-medium text-muted-foreground">{title ?? "terminal"}</span>
        <CopyBtn text={code} />
      </div>
      <pre className="overflow-x-auto p-3 text-xs leading-relaxed text-foreground">{code}</pre>
    </div>
  );
}

function download(name: string, content: string) {
  const blob = new Blob([content], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/* ---------------- Tab 1: Config generator ---------------- */

function ConfigGenerator() {
  const [netMode, setNetMode] = useState<"localhost" | "lan" | "domain">("lan");
  const [address, setAddress] = useState("192.168.1.100");
  const [httpPort, setHttpPort] = useState("443");
  const [maxUpload, setMaxUpload] = useState("500");
  const [adminEmail, setAdminEmail] = useState("profesor@upb.ro");
  const [domains, setDomains] = useState("@student.upb.ro,@upb.ro,@cetti.ro");
  const [azureId, setAzureId] = useState("");
  const [azureSecret, setAzureSecret] = useState("");
  const [azureTenant, setAzureTenant] = useState("");
  const [googleSa, setGoogleSa] = useState("");
  const [ollamaUrl, setOllamaUrl] = useState("");
  const [secrets, setSecrets] = useState<{ pg: string; jwt: string; session: string } | null>(null);
  const [generatedDate, setGeneratedDate] = useState("");
  useEffect(() => {
    setSecrets({ pg: randHex(16), jwt: randHex(32), session: randHex(32) });
    setGeneratedDate(new Date().toISOString().slice(0, 10));
  }, []);

  const base = useMemo(() => {
    if (netMode === "localhost") return "http://localhost:3000";
    if (netMode === "lan") return `https://${address}`;
    return `https://${address.replace(/^https?:\/\//, "")}`;
  }, [netMode, address]);

  const envFile = useMemo(
    () => secrets ? `# PCB Checker & CAM — configurație server local (generată ${generatedDate})
DEPLOYMENT_MODE=selfhost
VITE_DEPLOYMENT_MODE=selfhost
PUBLIC_APP_URL=${base}
PUBLIC_API_URL=${base}/api
APP_PORT=3000
NGINX_HTTP_PORT=${netMode === "localhost" ? "3000" : "80"}
NGINX_HTTPS_PORT=${httpPort}
MAX_UPLOAD_MB=${maxUpload}

# Secrete generate automat — NU le partaja
POSTGRES_PASSWORD=${secrets.pg}
JWT_SECRET=${secrets.jwt}
SESSION_SECRET=${secrets.session}

# Cheile backend (generate de install.sh la prima rulare)
ANON_KEY=
SERVICE_ROLE_KEY=

# Autentificare locală
ALLOWED_EMAIL_DOMAINS=${domains}
LAB_INVITE_CODE=

# Contul inițial de administrator (creat și din wizardul /setup)
ADMIN_EMAIL=${adminEmail}

# Microsoft Entra ID (opțional)
AZURE_CLIENT_ID=${azureId}
AZURE_CLIENT_SECRET=${azureSecret}
AZURE_TENANT_URL=${azureTenant ? `https://login.microsoftonline.com/${azureTenant}/v2.0` : ""}

# Google Sheets / Drive (opțional)
GOOGLE_SERVICE_ACCOUNT_JSON=${googleSa}

# Motor AI (opțional; gol = 100% geometric local)
OPENAI_API_KEY=${ollamaUrl ? "ollama" : ""}
OPENAI_BASE_URL=${ollamaUrl}
AI_MODEL=${ollamaUrl ? "qwen2.5-vl" : "gpt-4.1-mini"}

EXAM_MODE=0
` : "",
    [base, netMode, httpPort, maxUpload, secrets, generatedDate, domains, adminEmail, azureId, azureSecret, azureTenant, googleSa, ollamaUrl],
  );

  const composeFile = useMemo(
    () => `# Generat de PCB Checker — personalizat pentru ${netMode === "lan" ? `LAN ${address}` : netMode}
services:
  app:
    build:
      context: ..
      args:
        VITE_SUPABASE_URL: \${PUBLIC_API_URL}
        VITE_SUPABASE_PUBLISHABLE_KEY: \${ANON_KEY}
    restart: unless-stopped
    env_file: ../.env.selfhost
    volumes:
      - pcb_storage:/var/lib/pcb-checker/storage
    extra_hosts:
      - "host.docker.internal:host-gateway"

  nginx:
    image: nginx:alpine
    restart: unless-stopped
    ports:
      - "\${NGINX_HTTP_PORT:-80}:80"
      - "\${NGINX_HTTPS_PORT:-443}:443"
    volumes:
      - ./nginx.conf:/etc/nginx/conf.d/default.conf:ro
      - ./certs:/etc/nginx/certs:ro
    depends_on: [app]

volumes:
  pcb_storage:
`,
    [netMode, address],
  );

  const oneLiner = `git clone ${REPO} pcb-checker && cd pcb-checker && sudo bash selfhost/install.sh`;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-4">
        <div>
          <label className="text-xs font-medium text-muted-foreground">Mod de rețea</label>
          <div className="mt-1 grid grid-cols-3 gap-1 rounded-md bg-muted p-1 text-xs">
            {(
              [
                ["localhost", "Localhost (PC propriu)"],
                ["lan", "Server LAN laborator"],
                ["domain", "Domeniu public"],
              ] as const
            ).map(([k, l]) => (
              <button
                key={k}
                onClick={() => setNetMode(k)}
                className={`rounded px-2 py-1.5 ${netMode === k ? "bg-card text-foreground shadow" : "text-muted-foreground"}`}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
        {netMode !== "localhost" && (
          <div>
            <label className="text-xs font-medium text-muted-foreground">
              {netMode === "lan" ? "IP local al serverului" : "Domeniu (ex. pcb.cetti.ro)"}
            </label>
            <Input className="mt-1" value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Port HTTPS</label>
            <Input className="mt-1" value={httpPort} onChange={(e) => setHttpPort(e.target.value)} />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Arhivă ZIP max (MB)</label>
            <Input className="mt-1" value={maxUpload} onChange={(e) => setMaxUpload(e.target.value)} />
          </div>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Email administrator inițial</label>
          <Input className="mt-1" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Domenii de email acceptate (studenți)</label>
          <Input className="mt-1" value={domains} onChange={(e) => setDomains(e.target.value)} />
        </div>
        <details className="rounded-md border border-border p-3">
          <summary className="cursor-pointer text-sm font-medium text-card-foreground">Integrări opționale (Microsoft, Google, Ollama)</summary>
          <div className="mt-3 space-y-3">
            <Input placeholder="Azure Application (client) ID" value={azureId} onChange={(e) => setAzureId(e.target.value)} />
            <Input placeholder="Azure Client Secret" value={azureSecret} onChange={(e) => setAzureSecret(e.target.value)} />
            <Input placeholder="Azure Directory (tenant) ID" value={azureTenant} onChange={(e) => setAzureTenant(e.target.value)} />
            <Input placeholder="Google Service Account JSON (o linie)" value={googleSa} onChange={(e) => setGoogleSa(e.target.value)} />
            <Input placeholder="URL Ollama local (ex. http://192.168.1.20:11434/v1)" value={ollamaUrl} onChange={(e) => setOllamaUrl(e.target.value)} />
          </div>
        </details>
        <Button variant="outline" size="sm" onClick={() => setSecrets({ pg: randHex(16), jwt: randHex(32), session: randHex(32) })}>
          Regenerează secretele
        </Button>
      </div>

      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={!secrets} onClick={() => download(".env.selfhost", envFile)}>
            <Download className="mr-1 h-3 w-3" /> Descarcă .env
          </Button>
          <CopyBtn text={envFile} label="Copiază .env" disabled={!secrets} />
          <Button size="sm" variant="outline" onClick={() => download("docker-compose.yml", composeFile)}>
            <Download className="mr-1 h-3 w-3" /> docker-compose.yml
          </Button>
        </div>
        {secrets ? <CodeBlock title=".env.selfhost" code={envFile} /> : <p role="status" className="text-sm text-muted-foreground">Se pregătește configurația…</p>}
        <CodeBlock title="Comanda unică de instalare (pe server)" code={oneLiner} />
        <p className="text-xs text-muted-foreground">
          După clonare, copiază fișierul <code>.env.selfhost</code> descărcat în rădăcina proiectului înainte de a rula instalatorul — sau lasă{" "}
          <code>install.sh</code> să genereze totul interactiv.
        </p>
      </div>
    </div>
  );
}

/* ---------------- Tab 2: Install guide ---------------- */

function InstallGuide() {
  return (
    <div className="space-y-8">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={() => window.print()}>
          <Printer className="mr-1 h-3 w-3" /> Printează / Exportă PDF A4
        </Button>
      </div>

      <section>
        <h3 className="text-base font-semibold text-card-foreground">Scenariul A — Server Linux (Ubuntu 22.04/24.04 LTS, Debian 12, RHEL 9 / Rocky / Alma)</h3>
        <ol className="mt-3 list-decimal space-y-3 pl-5 text-sm text-card-foreground">
          <li>Conectează-te prin SSH la server și clonează repository-ul:</li>
        </ol>
        <CodeBlock code={`git clone ${REPO} pcb-checker\ncd pcb-checker`} />
        <ol start={2} className="mt-3 list-decimal space-y-3 pl-5 text-sm text-card-foreground">
          <li>Rulează instalatorul automat (instalează Docker dacă lipsește, generează parolele, creează baza de date și pornește totul):</li>
        </ol>
        <CodeBlock code="sudo bash selfhost/install.sh" />
        <ol start={3} className="mt-3 list-decimal space-y-3 pl-5 text-sm text-card-foreground">
          <li>
            Alege modul de rețea: <strong>(A)</strong> LAN/IP intern — se generează automat certificat TLS auto-semnat pentru IP-ul detectat;{" "}
            <strong>(B)</strong> domeniu public — HTTPS; <strong>(C)</strong> localhost pentru test pe propriul laptop.
          </li>
          <li>Deschide porturile în firewall:</li>
        </ol>
        <CodeBlock code={`# Ubuntu/Debian (ufw)\nsudo ufw allow 80,443/tcp && sudo ufw reload\n\n# RHEL/Rocky/Alma (firewalld)\nsudo firewall-cmd --permanent --add-service=http --add-service=https\nsudo firewall-cmd --reload`} />
        <ol start={5} className="mt-3 list-decimal space-y-3 pl-5 text-sm text-card-foreground">
          <li>
            Deschide din rețeaua laboratorului <code>https://&lt;IP-server&gt;</code>. La prima rulare vei fi direcționat către wizardul{" "}
            <code>/setup</code> care creează contul de administrator și structura UPB.
          </li>
        </ol>
      </section>

      <section>
        <h3 className="text-base font-semibold text-card-foreground">Scenariul B — Windows 10/11 sau Windows Server (PC din laborator)</h3>
        <ol className="mt-3 list-decimal space-y-3 pl-5 text-sm text-card-foreground">
          <li>Instalează <strong>Docker Desktop</strong> cu backend WSL2 (docker.com) și pornește-l.</li>
          <li>Deschide PowerShell în folderul proiectului și rulează:</li>
        </ol>
        <CodeBlock code={`Set-ExecutionPolicy -Scope Process Bypass\n.\\selfhost\\install.ps1`} />
        <ol start={3} className="mt-3 list-decimal space-y-3 pl-5 text-sm text-card-foreground">
          <li>Scriptul verifică Docker Desktop, generează <code>.env.selfhost</code>, construiește containerele și deschide browserul automat.</li>
          <li>Pentru acces de pe calculatoarele studenților din sală, permite portul în Windows Defender Firewall:</li>
        </ol>
        <CodeBlock code={`New-NetFirewallRule -DisplayName "PCB Checker HTTPS" -Direction Inbound -Protocol TCP -LocalPort 443 -Action Allow`} />
      </section>

      <section>
        <h3 className="text-base font-semibold text-card-foreground">Scenariul C — Dezvoltare locală (Node.js 20+ și PostgreSQL local, fără Docker)</h3>
        <CodeBlock
          code={`# 1. PostgreSQL 16 local: creează baza și aplică schema\ncreatedb pcb_checker\npsql pcb_checker < selfhost/sql/schema.sql\n\n# 2. Dependințe și pornire\nbun install   # sau npm install\ncp .env.selfhost.example .env.selfhost   # completează PUBLIC_API_URL și cheile\nbun run dev  # http://localhost:8080`}
        />
        <p className="mt-2 text-xs text-muted-foreground">
          Modul dezvoltare folosește același cod; pentru autentificare locală este necesar un server de auth compatibil (stack-ul Docker din
          scenariul A îl include).
        </p>
      </section>

      <section>
        <h3 className="text-base font-semibold text-card-foreground">Scenariul D — Integrări opționale, pas cu pas</h3>
        <div className="mt-3 space-y-4 text-sm text-card-foreground">
          <div>
            <p className="font-medium">D1. Microsoft Entra ID (conectare @upb.ro)</p>
            <ol className="mt-1 list-decimal space-y-1 pl-5 text-muted-foreground">
              <li>portal.azure.com → Microsoft Entra ID → App registrations → New registration (nume: PCB Checker).</li>
              <li>Redirect URI (Web): <code>https://&lt;serverul-tău&gt;/api/auth/v1/callback</code> (afișat exact la finalul instalării).</li>
              <li>Copiază Application (client) ID și Directory (tenant) ID; Certificates &amp; secrets → New client secret → copiază Value.</li>
              <li>Completează <code>AZURE_CLIENT_ID</code>, <code>AZURE_CLIENT_SECRET</code>, <code>AZURE_TENANT_URL</code> în <code>.env.selfhost</code> și rulează <code>./selfhost/pcb-ctl.sh update</code>.</li>
            </ol>
          </div>
          <div>
            <p className="font-medium">D2. Google Sheets Sync (cont de serviciu)</p>
            <ol className="mt-1 list-decimal space-y-1 pl-5 text-muted-foreground">
              <li>console.cloud.google.com → creează un proiect → activează Google Sheets API și Google Drive API.</li>
              <li>IAM → Service Accounts → Create → Keys → Add key (JSON) → descarcă <code>credentials.json</code>.</li>
              <li>Pune conținutul JSON pe o singură linie în <code>GOOGLE_SERVICE_ACCOUNT_JSON</code>.</li>
              <li>Partajează fiecare foaie Google Sheets cu email-ul contului de serviciu (Editor).</li>
            </ol>
          </div>
          <div>
            <p className="font-medium">D3. Motor AI local (Ollama) — 100% în rețeaua universității</p>
            <CodeBlock code={`# Pe un server din LAN cu GPU/CPU suficient\ncurl -fsSL https://ollama.com/install.sh | sh\nollama pull qwen2.5-vl\n\n# Sau profilul Docker inclus în kit\ndocker compose -f selfhost/docker-compose.yml --profile ai up -d\n\n# În .env.selfhost:\nOPENAI_BASE_URL=http://192.168.1.20:11434/v1\nOPENAI_API_KEY=ollama\nAI_MODEL=qwen2.5-vl`} />
            <p className="mt-1 text-xs text-muted-foreground">
              Fără motor AI, citirea serigrafiei rămâne funcțională prin matcher-ul vectorial local (5×7), iar regulile DRC se creează manual.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

/* ---------------- Tab 3: Administration manual ---------------- */

function AdminManual() {
  return (
    <div className="space-y-6">
      <section>
        <h3 className="text-base font-semibold text-card-foreground">Administrare zilnică — <code>pcb-ctl.sh</code></h3>
        <div className="mt-3 overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <tbody>
              {[
                ["./selfhost/pcb-ctl.sh status", "Stare containere, consum RAM/CPU, spațiu arhive ZIP, număr predări"],
                ["./selfhost/pcb-ctl.sh logs", "Loguri în timp real (Ctrl+C pentru ieșire)"],
                ["./selfhost/pcb-ctl.sh backup", "Arhivă completă .tar.gz în selfhost/backups/ (dump PostgreSQL + ZIP-uri + .env)"],
                ["./selfhost/pcb-ctl.sh restore <fișier.tar.gz>", "Restaurare completă bază de date + fișiere din backup"],
                ["./selfhost/pcb-ctl.sh update", "git pull + rebuild fără pierdere de date + migrări SQL noi"],
                ["./selfhost/pcb-ctl.sh create-admin <email> <parolă>", "Creează sau resetează parola unui cont de profesor"],
                ["./selfhost/pcb-ctl.sh doctor", "Verifică tabelele, funcțiile RLS și permisiunile pe volume"],
              ].map(([cmd, desc]) => (
                <tr key={cmd} className="border-b border-border last:border-0">
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-foreground">{cmd}</td>
                  <td className="px-3 py-2 text-muted-foreground">{desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h3 className="text-base font-semibold text-card-foreground">Backup automat zilnic (cron, ora 03:00)</h3>
        <CodeBlock code={`# crontab -e (ca root sau utilizatorul care rulează Docker)\n0 3 * * * /opt/pcb-checker/selfhost/pcb-ctl.sh backup >> /var/log/pcb-backup.log 2>&1`} />
        <p className="mt-2 text-xs text-muted-foreground">
          Copiază periodic folderul <code>selfhost/backups/</code> pe un alt calculator sau NAS — un backup pe același disc nu protejează la
          defectarea serverului.
        </p>
      </section>

      <section>
        <h3 className="text-base font-semibold text-card-foreground">Mutarea serverului pe alt calculator</h3>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-card-foreground">
          <li>Pe serverul vechi: <code>./selfhost/pcb-ctl.sh backup</code>.</li>
          <li>Pe serverul nou: clonează repository-ul și rulează <code>sudo bash selfhost/install.sh</code> (poți sări peste întrebări).</li>
          <li>Copiază arhiva de backup și rulează <code>./selfhost/pcb-ctl.sh restore backup-….tar.gz</code>.</li>
          <li>Actualizează <code>PUBLIC_APP_URL</code> în <code>.env.selfhost</code> dacă adresa s-a schimbat, apoi <code>./selfhost/pcb-ctl.sh update</code>.</li>
        </ol>
      </section>

      <section>
        <h3 className="text-base font-semibold text-card-foreground">Arhivarea la final de semestru</h3>
        <p className="mt-2 text-sm text-card-foreground">
          Din aplicație: <strong>Administrare → Mentenanță &amp; Arhivare → Arhivă de semestru</strong> — un singur ZIP cu catalogul de note (CSV),
          rapoartele DRC (JSON), matricea de integritate, istoricul notelor și termenele. Fișierele Gerber rămân în stocarea serverului; arhiva
          conține căile și hash-urile SHA-256 ale acestora. Complementar, <code>pcb-ctl.sh backup</code> păstrează totul, inclusiv ZIP-urile
          originale.
        </p>
      </section>
    </div>
  );
}

/* ---------------- Tab 4: Live diagnostics ---------------- */

const TROUBLESHOOTING: { p: string; s: string }[] = [
  { p: "Eroare „permission denied" + "” la Docker (docker.sock)", s: "Adaugă utilizatorul în grupul docker: sudo usermod -aG docker $USER, apoi reloghează-te. Sau rulează instalatorul cu sudo." },
  { p: "Portul 80/443 ocupat de Apache/Nginx existent", s: "Oprește serviciul vechi (sudo systemctl stop apache2) sau schimbă NGINX_HTTP_PORT/NGINX_HTTPS_PORT în .env.selfhost." },
  { p: "413 Request Entity Too Large la încărcarea arhivelor mari", s: "Nginx limitează uploadul. Kitul setează client_max_body_size 500M; dacă ai proxy propriu, crește limita și acolo. Verifică MAX_UPLOAD_MB." },
  { p: "Avertisment certificat auto-semnat în browser (LAN)", s: "Normal pentru IP-uri de laborator: acceptă excepția sau distribuie certificatul selfhost/certs/server.crt stațiilor. Web Workers și WebCrypto necesită context securizat (HTTPS sau localhost)." },
  { p: "Pagina nu se deschide din altă sală", s: "Verifică firewall-ul serverului (ufw/firewalld) și că PUBLIC_APP_URL din .env.selfhost corespunde adresei accesate." },
  { p: "Conectarea Microsoft eșuează", s: "Redirect URI-ul din Azure trebuie să coincidă exact cu cel afișat de install.sh la final. Verifică AZURE_TENANT_URL." },
  { p: "Tabele lipsă / erori la pornire", s: "Rulează ./selfhost/pcb-ctl.sh doctor; reaplică schema: docker exec -i <db> psql -U postgres < selfhost/sql/schema.sql" },
  { p: "Discul s-a umplut cu arhive ZIP", s: "pcb-ctl.sh status arată spațiul ocupat. Arhivează semestrul (Mentenanță → Arhivă de semestru), apoi șterge anii vechi din Istoric." },
  { p: "AI-ul nu răspunde (Ollama)", s: "Verifică că OPENAI_BASE_URL e accesibil din container (host.docker.internal sau IP LAN) și că modelul e descărcat: ollama list." },
  { p: "Am uitat parola de administrator", s: "./selfhost/pcb-ctl.sh create-admin profesor@upb.ro ParolaNoua — resetează instant, fără email." },
];

function Diagnostics() {
  const [health, setHealth] = useState<Awaited<ReturnType<typeof platformHealth>> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [browser, setBrowser] = useState<{ workers: boolean; secure: boolean; webcrypto: boolean } | null>(null);

  useEffect(() => {
    setBrowser({
      workers: typeof Worker !== "undefined",
      secure: window.isSecureContext,
      webcrypto: !!crypto.subtle,
    });
    platformHealth()
      .then(setHealth)
      .catch((e) => setErr((e as Error).message));
  }, []);

  return (
    <div className="space-y-6">
      <section>
        <h3 className="text-base font-semibold text-card-foreground">Starea serverului curent</h3>
        {err && (
          <p className="mt-2 text-sm text-muted-foreground">
            Diagnosticul live necesită autentificare ca membru al personalului. <Link to="/auth" className="underline">Conectează-te</Link> și revino.
          </p>
        )}
        {!health && !err && (
          <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Se verifică…
          </p>
        )}
        {health && (
          <ul className="mt-3 space-y-2 text-sm">
            {health.checks.map((c) => (
              <li key={c.name} className="flex items-start gap-2">
                {c.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-primary" /> : <XCircle className="mt-0.5 h-4 w-4 text-destructive" />}
                <span className="text-card-foreground">
                  {c.name} <span className="text-muted-foreground">— {c.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
        {browser && (
          <ul className="mt-3 space-y-2 border-t border-border pt-3 text-sm">
            {(
              [
                ["Web Workers (DRC paralel în browser)", browser.workers],
                ["Context securizat HTTPS/localhost", browser.secure],
                ["WebCrypto (hash SHA-256, chei)", browser.webcrypto],
              ] as const
            ).map(([n, ok]) => (
              <li key={n} className="flex items-start gap-2">
                {ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-primary" /> : <XCircle className="mt-0.5 h-4 w-4 text-destructive" />}
                <span className="text-card-foreground">{n}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="text-base font-semibold text-card-foreground">Cele mai frecvente 10 probleme și soluțiile lor</h3>
        <div className="mt-3 space-y-2">
          {TROUBLESHOOTING.map((t, i) => (
            <details key={i} className="rounded-md border border-border p-3">
              <summary className="cursor-pointer text-sm font-medium text-card-foreground">
                {i + 1}. {t.p}
              </summary>
              <p className="mt-2 text-sm text-muted-foreground">{t.s}</p>
            </details>
          ))}
        </div>
      </section>
    </div>
  );
}

/* ---------------- Page ---------------- */

function SelfhostPage() {
  return (
    <div className="min-h-screen bg-background pcb-grid">
      <div className="mx-auto max-w-5xl px-4 py-10">
        <div className="flex items-center gap-3">
          <Server className="h-7 w-7 text-primary" />
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Instalare &amp; Administrare Server Local</h1>
            <p className="text-sm text-muted-foreground">
              Self-Host Kit — rulează PCB Checker &amp; CAM pe serverul laboratorului, complet independent de cloud.
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <CircuitBoard className="h-5 w-5 text-muted-foreground" />
            <Link to="/auth" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
              ← Conectare
            </Link>
          </div>
        </div>

        <Tabs defaultValue="config" className="mt-8">
          <TabsList className="grid w-full grid-cols-2 md:grid-cols-4">
            <TabsTrigger value="config">Generator configurație</TabsTrigger>
            <TabsTrigger value="guide">Ghid de instalare</TabsTrigger>
            <TabsTrigger value="admin">Administrare &amp; Backup</TabsTrigger>
            <TabsTrigger value="diag">Diagnostic live</TabsTrigger>
          </TabsList>
          <TabsContent value="config" className="mt-6 rounded-lg border border-border bg-card p-6">
            <ConfigGenerator />
          </TabsContent>
          <TabsContent value="guide" className="mt-6 rounded-lg border border-border bg-card p-6">
            <InstallGuide />
          </TabsContent>
          <TabsContent value="admin" className="mt-6 rounded-lg border border-border bg-card p-6">
            <AdminManual />
          </TabsContent>
          <TabsContent value="diag" className="mt-6 rounded-lg border border-border bg-card p-6">
            <Diagnostics />
          </TabsContent>
        </Tabs>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Manualul complet este și în repository: <code>selfhost/INSTALL_GUIDE_RO.md</code>
        </p>
      </div>
    </div>
  );
}
