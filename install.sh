#!/usr/bin/env bash
# PCB Checker & CAM — one-command installer for Ubuntu/Debian (also works on most Linux with Docker).
# Usage:  curl -fsSL <repo>/install.sh | bash     or     ./install.sh
set -euo pipefail
cd "$(dirname "$0")"
G='\033[1;32m'; Y='\033[1;33m'; R='\033[1;31m'; N='\033[0m'
say(){ echo -e "${G}==>${N} $*"; }; warn(){ echo -e "${Y}!!${N} $*"; }; die(){ echo -e "${R}EROARE:${N} $*"; exit 1; }
ask(){ local p="$1" d="${2:-}" v; read -r -p "$p${d:+ [$d]}: " v </dev/tty || true; echo "${v:-$d}"; }

say "Instalare PCB Checker & CAM (UPB)"

# 1. Dependencies
need(){ command -v "$1" >/dev/null 2>&1; }
SUDO=""; [ "$(id -u)" -ne 0 ] && SUDO="sudo"
if ! need docker; then
  say "Instalez Docker (poate dura câteva minute)…"
  curl -fsSL https://get.docker.com | $SUDO sh
  $SUDO usermod -aG docker "$USER" || true
fi
need git || { $SUDO apt-get update -y && $SUDO apt-get install -y git; }
need openssl || { $SUDO apt-get install -y openssl; }
need node || { say "Instalez Node.js…"; curl -fsSL https://deb.nodesource.com/setup_22.x | $SUDO -E bash - && $SUDO apt-get install -y nodejs; }
DC="docker compose"; $DC version >/dev/null 2>&1 || DC="$SUDO docker compose"

# 2. Questions (only what cannot be guessed)
HOST_IP=$(hostname -I 2>/dev/null | awk '{print $1}'); HOST_IP=${HOST_IP:-localhost}
if [ ! -f .env.selfhost ]; then
  cp .env.selfhost.example .env.selfhost
  ADDR=$(ask "Adresa serverului (domeniu sau IP)" "$HOST_IP")
  APP_URL="http://$ADDR:3000"; API_URL="http://$ADDR:8000"
  echo; say "Conectare Microsoft 365 (Entra ID). Vezi README → 'Pasul Microsoft'. Lasă gol ca să completezi mai târziu."
  AZ_ID=$(ask "Application (client) ID"); AZ_SECRET=$(ask "Client secret"); AZ_TENANT=$(ask "Directory (tenant) ID")
  OPENAI=$(ask "Cheie OpenAI pentru funcțiile AI (opțional, Enter = fără)")

  # 3. Generate secrets & JWT keys
  JWT_SECRET=$(openssl rand -hex 32)
  mkjwt(){ node -e '
    const c=require("crypto"),[s,r]=process.argv.slice(1);
    const b=o=>Buffer.from(JSON.stringify(o)).toString("base64url");
    const h=b({alg:"HS256",typ:"JWT"}),p=b({role:r,iss:"supabase",iat:Math.floor(Date.now()/1e3),exp:Math.floor(Date.now()/1e3)+3153600000});
    console.log(h+"."+p+"."+c.createHmac("sha256",s).update(h+"."+p).digest("base64url"));' "$JWT_SECRET" "$1"; }
  ANON=$(mkjwt anon); SERVICE=$(mkjwt service_role)
  set_kv(){ local k="$1" v="$2" f="$3"; if grep -q "^$k=" "$f"; then sed -i "s|^$k=.*|$k=${v//|/\\|}|" "$f"; else echo "$k=$v" >> "$f"; fi; }
  set_kv PUBLIC_APP_URL "$APP_URL" .env.selfhost; set_kv PUBLIC_API_URL "$API_URL" .env.selfhost
  set_kv ANON_KEY "$ANON" .env.selfhost; set_kv SERVICE_ROLE_KEY "$SERVICE" .env.selfhost
  set_kv AZURE_CLIENT_ID "$AZ_ID" .env.selfhost; set_kv AZURE_CLIENT_SECRET "$AZ_SECRET" .env.selfhost
  [ -n "$AZ_TENANT" ] && set_kv AZURE_TENANT_URL "https://login.microsoftonline.com/$AZ_TENANT/v2.0" .env.selfhost
  set_kv OPENAI_API_KEY "$OPENAI" .env.selfhost
  echo "JWT_SECRET=$JWT_SECRET" > selfhost/.jwt
fi
set -a; . ./.env.selfhost; set +a
JWT_SECRET=$(grep ^JWT_SECRET= selfhost/.jwt | cut -d= -f2)

# 4. Backend (official self-hosted stack: Postgres, Auth, Storage, REST)
if [ ! -d selfhost/supabase ]; then
  say "Descarc serverul de date…"
  git clone --depth 1 https://github.com/supabase/supabase /tmp/sb-src
  cp -r /tmp/sb-src/docker selfhost/supabase && rm -rf /tmp/sb-src
  cp selfhost/supabase/.env.example selfhost/supabase/.env
  E=selfhost/supabase/.env
  PG=$(openssl rand -hex 16); DASH=$(openssl rand -hex 12)
  sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$PG|; s|^JWT_SECRET=.*|JWT_SECRET=$JWT_SECRET|; s|^ANON_KEY=.*|ANON_KEY=$ANON_KEY|; s|^SERVICE_ROLE_KEY=.*|SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY|; s|^DASHBOARD_PASSWORD=.*|DASHBOARD_PASSWORD=$DASH|; s|^SITE_URL=.*|SITE_URL=$PUBLIC_APP_URL|; s|^API_EXTERNAL_URL=.*|API_EXTERNAL_URL=$PUBLIC_API_URL|; s|^SUPABASE_PUBLIC_URL=.*|SUPABASE_PUBLIC_URL=$PUBLIC_API_URL|; s|^ADDITIONAL_REDIRECT_URLS=.*|ADDITIONAL_REDIRECT_URLS=$PUBLIC_APP_URL/auth|; s|^ENABLE_EMAIL_SIGNUP=.*|ENABLE_EMAIL_SIGNUP=false|" "$E"
  # Microsoft Entra ID provider for the auth service
  python3 - "$selfhost" <<'PY' || true
import re
p="selfhost/supabase/docker-compose.yml"; s=open(p).read()
if "GOTRUE_EXTERNAL_AZURE_ENABLED" not in s:
    s=s.replace("GOTRUE_SITE_URL: ${SITE_URL}","GOTRUE_SITE_URL: ${SITE_URL}\n      GOTRUE_EXTERNAL_AZURE_ENABLED: \"true\"\n      GOTRUE_EXTERNAL_AZURE_CLIENT_ID: ${AZURE_CLIENT_ID}\n      GOTRUE_EXTERNAL_AZURE_SECRET: ${AZURE_CLIENT_SECRET}\n      GOTRUE_EXTERNAL_AZURE_URL: ${AZURE_TENANT_URL}\n      GOTRUE_EXTERNAL_AZURE_REDIRECT_URI: ${API_EXTERNAL_URL}/auth/v1/callback",1)
    open(p,"w").write(s)
PY
  { echo "AZURE_CLIENT_ID=$AZURE_CLIENT_ID"; echo "AZURE_CLIENT_SECRET=$AZURE_CLIENT_SECRET"; echo "AZURE_TENANT_URL=$AZURE_TENANT_URL"; } >> "$E"
fi
say "Pornesc serverul de date…"
(cd selfhost/supabase && $DC up -d)
say "Aștept baza de date…"
for i in $(seq 1 60); do (cd selfhost/supabase && $DC exec -T db pg_isready -U postgres) >/dev/null 2>&1 && break; sleep 3; done
sleep 10

# 5. Schema (idempotent marker)
if ! (cd selfhost/supabase && $DC exec -T db psql -U postgres -tAc "select to_regclass('public.profiles')") | grep -q profiles; then
  say "Creez tabelele aplicației…"
  (cd selfhost/supabase && $DC exec -T db psql -U postgres -v ON_ERROR_STOP=0 -d postgres) < selfhost/sql/schema.sql >/tmp/pcb-schema.log 2>&1 || true
  grep -i "error" /tmp/pcb-schema.log | head -5 || true
fi

# 6. App
say "Construiesc și pornesc aplicația…"
$DC -f selfhost/docker-compose.app.yml --env-file .env.selfhost up -d --build

echo
say "GATA! Deschide în browser: ${PUBLIC_APP_URL}"
echo "  • Primul cont care se conectează devine Administrator General."
echo "  • Microsoft: în Azure adaugă Redirect URI: ${PUBLIC_API_URL}/auth/v1/callback"
echo "  • Actualizare ulterioară:  ./update.sh     Backup:  ./backup.sh"
[ -z "${AZURE_CLIENT_ID:-}" ] && warn "Conectarea Microsoft nu e configurată încă — completează AZURE_* în .env.selfhost și rulează din nou ./install.sh"
exit 0
