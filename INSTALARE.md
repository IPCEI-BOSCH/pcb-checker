# Instalare pe server propriu — PCB Checker & CAM (UPB)

Ghid pentru persoane fără experiență tehnică. Durează ~15 minute.

## Ce îți trebuie
- Un server sau calculator cu **Ubuntu 22.04/24.04** (minim 2 procesoare, 4 GB RAM, 20 GB disc).
- Acces la internet pe server.
- (Pentru conectarea cu contul UPB) acces la **Azure portal** al universității sau ajutorul departamentului IT.

## Pasul 1 — Descarcă și pornește instalarea
Deschide terminalul serverului și scrie:
```bash
git clone <adresa-depozitului-GitHub> pcb-checker
cd pcb-checker
chmod +x install.sh update.sh backup.sh
./install.sh
```
Scriptul instalează singur tot ce lipsește (Docker, Node.js), pune câteva întrebări simple, generează parolele, creează baza de date și pornește aplicația.

## Pasul Microsoft (conectare cu contul @upb.ro)
1. În **portal.azure.com** → *Microsoft Entra ID* → *App registrations* → *New registration*.
2. Nume: `PCB Checker`. Redirect URI (Web): `http://ADRESA-SERVERULUI:8000/auth/v1/callback`.
3. Copiază **Application (client) ID** și **Directory (tenant) ID**.
4. *Certificates & secrets* → *New client secret* → copiază **Value**.
5. Introdu cele trei valori când `install.sh` le cere (sau completează-le în `.env.selfhost` și rulează din nou `./install.sh`).

Doar conturile @upb.ro, @student.upb.ro și @cetti.ro pot intra. **Primul cont conectat devine Administrator General.**

## Opțional
- **Funcții AI** (citire text serigrafie, reguli propuse de AI): pune o cheie în `OPENAI_API_KEY` din `.env.selfhost`. Fără ea, restul aplicației (DRC, CAM, catalog, anti-plagiat) funcționează complet.
- **Google Drive / Sheets**: completează `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` (sau `GOOGLE_SERVICE_ACCOUNT_JSON`). Apoi `./update.sh`.

## Utilizare zilnică
| Ce vrei | Comandă |
|---|---|
| Actualizare la ultima versiune | `./update.sh` (face backup automat înainte) |
| Backup manual | `./backup.sh` → folderul `backups/` |
| Oprire | `docker compose -f selfhost/docker-compose.app.yml down` |

## HTTPS (recomandat pentru acces din afara laboratorului)
Pune serverul în spatele unui proxy cu certificat (ex. Caddy: `caddy reverse-proxy --from pcb.upb.ro --to :3000`), apoi actualizează adresele `PUBLIC_APP_URL` / `PUBLIC_API_URL` și Redirect URI-ul din Azure.

## Probleme frecvente
- **„Conectarea a eșuat”** → Redirect URI din Azure nu coincide exact cu cel afișat la finalul instalării.
- **Pagina nu se deschide** → verifică portul 3000 deschis în firewall: `sudo ufw allow 3000,8000/tcp`.
- **„Google Drive nu este configurat”** → cheile Google opționale lipsesc.

## Pentru dezvoltatori
- Aplicația funcționează identic pe Lovable și self-hosted: `src/lib/platform.server.ts` alege automat între serviciile Lovable și API-urile directe (Google, OpenAI-compatibil) după variabilele de mediu.
- Schema completă a bazei: `selfhost/sql/schema.sql` (generată din `drizzle/migrations`).
- Rulare locală: `bun install && bun run dev`.
