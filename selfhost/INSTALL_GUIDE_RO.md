# PCB Checker & CAM — Manual complet de instalare și administrare pe server propriu

**Public țintă:** administratori de sistem și cadre didactice UPB/CETTI, fără experiență DevOps.
**Durata tipică:** 15 minute pe un server curat.
**Rezultat:** aplicația rulează 100% pe serverul vostru (PostgreSQL 16 + Auth + Storage + Nginx, toate open-source, în containere Docker), fără nicio dependență de servicii cloud externe.

---

## 1. Cerințe minime

| Resursă | Minim | Recomandat |
|---|---|---|
| CPU | 2 nuclee | 4 nuclee |
| RAM | 2 GB | 4 GB |
| Disc | 20 GB | 100 GB (arhivele ZIP ale studenților cresc) |
| OS | Ubuntu 22.04/24.04, Debian 12, RHEL 9 / Rocky / Alma, Windows 10/11 + Docker Desktop | Ubuntu 24.04 LTS |
| Rețea | acces internet la instalare | poate rula apoi complet offline (mod examen) |

---

## 2. Instalare automată — Linux (Scenariul A)

```bash
git clone https://github.com/IPCEI-BOSCH/pcb-checker.git pcb-checker
cd pcb-checker
sudo bash selfhost/install.sh
```

Instalatorul:
1. verifică RAM/disc/porturi și instalează Docker + Node.js dacă lipsesc;
2. te întreabă modul de rețea:
   - **(A) LAN / IP intern** — generează automat certificat TLS auto-semnat (SubjectAltName pe IP-ul serverului și localhost) și pornește Nginx cu HTTPS;
   - **(B) Domeniu public** (ex. `pcb.cetti.ro`) — HTTPS pe domeniu;
   - **(C) Localhost** — test pe laptop, `http://localhost:3000`;
3. generează parole criptografice (`POSTGRES_PASSWORD`, `JWT_SECRET`, cheile API) în `.env.selfhost`;
4. pornește stack-ul de date (PostgreSQL 16 + server de autentificare + stocare fișiere), așteaptă să fie sănătos și aplică `selfhost/sql/schema.sql` (idempotent);
5. construiește și pornește aplicația.

La final primești un chenar cu URL-ul de acces și comenzile de administrare.

### Prima rulare — wizardul `/setup`
Deschide URL-ul afișat. Vei fi direcționat automat către wizardul în 5 pași:
1. **Sănătate sistem** — bife verzi pentru PostgreSQL, tabele, stocare, Web Workers;
2. **Cont administrator** — nume, email instituțional (@upb.ro / @cetti.ro), parolă locală (criptată bcrypt, funcționează instant, fără Microsoft);
3. **Structură UPB** — un click creează anul universitar curent, seriile A–D și grupele 431–434;
4. **Integrări opționale** — Microsoft Entra ID, Google Sheets, motor AI (pot fi sărite);
5. **Finalizare** — intră în tabloul de bord.

### Firewall
```bash
# Ubuntu/Debian
sudo ufw allow 80,443/tcp && sudo ufw reload
# RHEL/Rocky/Alma
sudo firewall-cmd --permanent --add-service=http --add-service=https && sudo firewall-cmd --reload
```

---

## 3. Instalare pe Windows 10/11 / Windows Server (Scenariul B)

1. Instalează **Docker Desktop** (backend WSL2) de pe docker.com și pornește-l.
2. Deschide **PowerShell** în folderul proiectului:
   ```powershell
   Set-ExecutionPolicy -Scope Process Bypass
   .\selfhost\install.ps1
   ```
3. Scriptul verifică Docker, generează `.env.selfhost`, construiește containerele și deschide browserul.
4. Pentru acces de pe calculatoarele studenților:
   ```powershell
   New-NetFirewallRule -DisplayName "PCB Checker HTTPS" -Direction Inbound -Protocol TCP -LocalPort 443 -Action Allow
   ```

> Notă: pe Windows, generarea cheilor JWT (ANON_KEY/SERVICE_ROLE_KEY) este cea mai sigură prin `install.sh` rulat în WSL2 sau pe un server Linux; vezi secțiunea 7.

---

## 4. Dezvoltare locală fără Docker (Scenariul C)

```bash
createdb pcb_checker
psql pcb_checker < selfhost/sql/schema.sql
bun install            # sau npm install
cp .env.selfhost.example .env.selfhost   # completează adresele și cheile
bun run dev            # http://localhost:8080
```

---

## 5. Autentificare pe serverul local

Trei metode, simultan:

1. **Cont local (email + parolă)** — activ imediat, fără configurare. Parolele sunt criptate bcrypt în PostgreSQL. Studenții se înregistrează din pagina de conectare (tab „Cont nou"); doar domeniile din `ALLOWED_EMAIL_DOMAINS` sunt acceptate. Dacă setezi `LAB_INVITE_CODE` în `.env.selfhost`, înregistrarea cere acel cod (util în rețele fără server de email).
2. **Microsoft Entra ID** (@upb.ro / @student.upb.ro / @cetti.ro) — vezi 6.1.
3. **Resetare parolă de către profesor** — în laborator offline, profesorul resetează parola unui student din **Catalog → click pe student → Resetare parolă**, sau din terminal: `./selfhost/pcb-ctl.sh create-admin <email> <parolă-nouă>`.

---

## 6. Integrări opționale (Scenariul D)

### 6.1 Microsoft Entra ID
1. portal.azure.com → Microsoft Entra ID → App registrations → New registration (nume: `PCB Checker`).
2. Redirect URI (Web): `https://<serverul-tău>/api/auth/v1/callback` (afișat exact la finalul instalării).
3. Copiază **Application (client) ID** și **Directory (tenant) ID**; Certificates & secrets → New client secret → copiază **Value**.
4. Completează `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_TENANT_URL` în `.env.selfhost`, apoi `./selfhost/pcb-ctl.sh update`.

### 6.2 Google Sheets / Drive
1. console.cloud.google.com → proiect nou → activează **Google Sheets API** și **Google Drive API**.
2. IAM → Service Accounts → Create → Keys → Add key (JSON).
3. Pune conținutul JSON pe o linie în `GOOGLE_SERVICE_ACCOUNT_JSON` (sau folosește tripletele OAuth `GOOGLE_CLIENT_ID/SECRET/REFRESH_TOKEN`).
4. Partajează foile de calcul cu email-ul contului de serviciu (drept Editor).

### 6.3 Motor AI local (Ollama) — fără internet, fără costuri
```bash
# Varianta 1: profilul Docker inclus în kit
docker compose -f selfhost/docker-compose.yml --profile ai up -d
docker exec -it $(docker ps -qf name=ollama) ollama pull qwen2.5-vl

# Varianta 2: server Ollama dedicat în LAN
curl -fsSL https://ollama.com/install.sh | sh && ollama pull qwen2.5-vl
```
Apoi în `.env.selfhost`:
```
OPENAI_BASE_URL=http://<server-ollama>:11434/v1
OPENAI_API_KEY=ollama
AI_MODEL=qwen2.5-vl
```
Fără motor AI, aplicația rămâne complet funcțională: DRC, CAM, catalog, anti-plagiat și citirea vectorială locală a serigrafiei nu au nevoie de AI.

---

## 7. Administrare zilnică — `pcb-ctl.sh`

| Comandă | Ce face |
|---|---|
| `./selfhost/pcb-ctl.sh status` | containere, RAM/CPU, spațiu ocupat de arhivele ZIP, număr de predări |
| `./selfhost/pcb-ctl.sh logs` | loguri în timp real |
| `./selfhost/pcb-ctl.sh backup` | arhivă `.tar.gz` în `selfhost/backups/` (dump PostgreSQL + ZIP-uri + `.env`) |
| `./selfhost/pcb-ctl.sh restore <fișier>` | restaurare completă din backup |
| `./selfhost/pcb-ctl.sh update` | `git pull` + rebuild fără pierdere de date + migrări SQL noi (cu backup preventiv) |
| `./selfhost/pcb-ctl.sh create-admin <email> <parolă>` | creează sau resetează parola unui cont de profesor |
| `./selfhost/pcb-ctl.sh doctor` | verifică tabelele, funcțiile RLS (`has_role`, `can_view_group`, `can_manage_group`, `manages_series`, `ensure_profile`), volumele și porturile |

### Backup automat zilnic (cron, ora 03:00)
```bash
crontab -e
0 3 * * * /opt/pcb-checker/selfhost/pcb-ctl.sh backup >> /var/log/pcb-backup.log 2>&1
```
Copiază periodic `selfhost/backups/` pe un NAS/alt calculator.

### Mutarea serverului pe alt calculator
1. Server vechi: `./selfhost/pcb-ctl.sh backup`.
2. Server nou: clone + `sudo bash selfhost/install.sh`.
3. Copiază arhiva și `./selfhost/pcb-ctl.sh restore pcb-backup-….tar.gz`.
4. Actualizează `PUBLIC_APP_URL` dacă adresa s-a schimbat, apoi `pcb-ctl.sh update`.

### Arhivare la final de semestru
Din aplicație: **Administrare → Mentenanță & Arhivare → Arhivă de semestru** (ZIP cu catalog note CSV, rapoarte DRC JSON, matrice integritate, istoric note, termene). Complementar, `pcb-ctl.sh backup` păstrează totul, inclusiv arhivele Gerber originale.

---

## 8. Depanare — cele mai frecvente 10 probleme

1. **„permission denied" la docker.sock** → `sudo usermod -aG docker $USER`, relogare; sau rulează cu `sudo`.
2. **Portul 80/443 ocupat (Apache/Nginx vechi)** → `sudo systemctl stop apache2` sau schimbă `NGINX_HTTP_PORT`/`NGINX_HTTPS_PORT`.
3. **413 Request Entity Too Large la ZIP-uri mari** → kitul setează `client_max_body_size 500M`; dacă ai proxy propriu, crește limita și acolo.
4. **Avertisment certificat auto-semnat pe IP de LAN** → normal; acceptă excepția sau distribuie `selfhost/certs/server.crt`. HTTPS (sau localhost) este necesar pentru Web Workers/WebCrypto.
5. **Pagina nu se deschide din altă sală** → firewall (`ufw allow 80,443/tcp`) și `PUBLIC_APP_URL` corect.
6. **Conectarea Microsoft eșuează** → Redirect URI din Azure trebuie să coincidă exact cu cel afișat de instalator.
7. **Tabele lipsă / erori la pornire** → `./selfhost/pcb-ctl.sh doctor`, apoi reaplică schema.
8. **Disc plin cu arhive ZIP** → `pcb-ctl.sh status` arată spațiul; arhivează semestrul și șterge anii vechi din Istoric.
9. **AI-ul nu răspunde (Ollama)** → verifică `OPENAI_BASE_URL` din container (`host.docker.internal` sau IP LAN) și `ollama list`.
10. **Parolă de administrator uitată** → `./selfhost/pcb-ctl.sh create-admin profesor@upb.ro ParolaNoua`.

---

## 9. Arhitectură (pentru dezvoltatori)

- Același cod rulează pe Lovable Cloud și self-hosted: `src/lib/platform.server.ts` alege automat serviciile după variabilele de mediu (`DEPLOYMENT_MODE`, `LOVABLE_API_KEY`, cheile Google/OpenAI).
- Stack self-hosted: **Nginx** (reverse proxy, TLS, upload 500 MB) → **TanStack Start (Node 20)** → **PostgreSQL 16 + GoTrue Auth + Storage** (stack oficial open-source, pornit din `selfhost/supabase/`).
- Schema completă și idempotentă: `selfhost/sql/schema.sql` (generată din `drizzle/migrations/`, fără extensii proprietare cloud).
- Fișierele Gerber/ZIP: volum persistent `pcb_storage` (`/var/lib/pcb-checker/storage`), cu verificare SHA-256 la predarea oficială.
- Pagina din aplicație `/selfhost` (Ghid Instalare Server Local) conține generatorul interactiv de configurație, acest ghid și diagnosticul live.
