#!/usr/bin/env bash
# ============================================================================
# PCB Checker & CAM — Instalator automat pentru server local (self-host)
# Ubuntu 22.04/24.04 LTS · Debian 12 · RHEL 9 / Rocky / AlmaLinux
# Usage:  sudo bash selfhost/install.sh
# ============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

G='\033[1;32m'; Y='\033[1;33m'; R='\033[1;31m'; C='\033[1;36m'; B='\033[1m'; N='\033[0m'
say(){  echo -e "${G}==>${N} $*"; }
warn(){ echo -e "${Y}!!${N}  $*"; }
die(){  echo -e "${R}EROARE:${N} $*"; exit 1; }
ask(){  local p="$1" d="${2:-}" v; read -r -p "$p${d:+ [$d]}: " v </dev/tty || true; echo "${v:-$d}"; }

clear
echo -e "${C}${B}"
echo "  ┌──────────────────────────────────────────────────────────┐"
echo "  │   PCB CHECKER & CAM — Instalare Server Local (UPB)       │"
echo "  │   PostgreSQL 16 · Auth · Storage · Nginx · Docker        │"
echo "  └──────────────────────────────────────────────────────────┘"
echo -e "${N}"

# ---------------------------------------------------------------- 0. Pre-flight
say "Verific pre-condițiile…"
RAM_MB=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo 2>/dev/null || echo 4096)
DISK_GB=$(df -BG . | awk 'NR==2 {gsub(/G/,"",$4); print $4}')
[ "$RAM_MB" -lt 1800 ] && warn "RAM: ${RAM_MB} MB (recomandat minim 2 GB)"
[ "${DISK_GB:-20}" -lt 10 ] && warn "Disc liber: ${DISK_GB} GB (recomandat minim 20 GB)"
echo "    RAM: ${RAM_MB} MB · Disc liber: ${DISK_GB} GB"

SUDO=""; [ "$(id -u)" -ne 0 ] && SUDO="sudo"
need(){ command -v "$1" >/dev/null 2>&1; }

# ---------------------------------------------------------------- 1. Docker
if ! need docker; then
  say "Instalez Docker Engine (poate dura câteva minute)…"
  curl -fsSL https://get.docker.com | $SUDO sh
  $SUDO usermod -aG docker "${SUDO_USER:-$USER}" || true
fi
DC="docker compose"; $DC version >/dev/null 2>&1 || DC="$SUDO docker compose"
$DC version >/dev/null 2>&1 || die "Docker Compose plugin lipsește. Instalează-l: https://docs.docker.com/compose/install/"
need git || { $SUDO apt-get update -y 2>/dev/null && $SUDO apt-get install -y git 2>/dev/null || $SUDO dnf install -y git; }
need openssl || { $SUDO apt-get install -y openssl 2>/dev/null || $SUDO dnf install -y openssl; }
need node || { say "Instalez Node.js…"; curl -fsSL https://deb.nodesource.com/setup_22.x | $SUDO -E bash - && $SUDO apt-get install -y nodejs; }

# ---------------------------------------------------------------- 2. Mod rețea (A/B/C)
HOST_IP=$(hostname -I 2>/dev/null | awk '{print $1}'); HOST_IP=${HOST_IP:-127.0.0.1}
echo
echo -e "${B}Unde va fi accesibil serverul?${N}"
echo "  A) Rețea locală LAN / IP intern (laborator) — IP detectat: $HOST_IP"
echo "  B) Domeniu public / subdomeniu universitar (ex. pcb.cetti.ro)"
echo "  C) Localhost — test pe propriul laptop (port 3000)"
MODE=$(ask "Alege [A/B/C]" "A")

ADDR="$HOST_IP"; SCHEME="https"; APP_PORT=3000
case "${MODE^^}" in
  B) ADDR=$(ask "Domeniul public" "pcb.cetti.ro"); SCHEME="https" ;;
  C) ADDR="localhost"; SCHEME="http" ;;
  *) ADDR=$(ask "IP-ul serverului în rețea" "$HOST_IP"); SCHEME="https" ;;
esac

if [ "$SCHEME" = "https" ]; then
  APP_URL="https://$ADDR"; API_URL="https://$ADDR/api"
else
  APP_URL="http://$ADDR:$APP_PORT"; API_URL="http://$ADDR:8000"
fi

# ---------------------------------------------------------------- 3. .env.selfhost
if [ ! -f .env.selfhost ]; then
  cp .env.selfhost.example .env.selfhost
  echo
  say "Integrări opționale (Enter = configurez mai târziu)"
  AZ_ID=$(ask "Microsoft Entra — Application (client) ID")
  AZ_SECRET=$(ask "Microsoft Entra — Client secret")
  AZ_TENANT=$(ask "Microsoft Entra — Directory (tenant) ID")
  OPENAI=$(ask "Cheie OpenAI-compatibilă pentru AI (sau 'ollama' pentru motor local)")

  JWT_SECRET=$(openssl rand -hex 32)
  PG_PASS=$(openssl rand -hex 16)
  mkjwt(){ node -e '
    const c=require("crypto"),[s,r]=process.argv.slice(1);
    const b=o=>Buffer.from(JSON.stringify(o)).toString("base64url");
    const h=b({alg:"HS256",typ:"JWT"}),p=b({role:r,iss:"supabase",iat:Math.floor(Date.now()/1e3),exp:Math.floor(Date.now()/1e3)+3153600000});
    console.log(h+"."+p+"."+c.createHmac("sha256",s).update(h+"."+p).digest("base64url"));' "$JWT_SECRET" "$1"; }
  ANON=$(mkjwt anon); SERVICE=$(mkjwt service_role)

  set_kv(){ local k="$1" v="$2" f="$3"; if grep -q "^$k=" "$f"; then sed -i "s|^$k=.*|$k=${v//|/\\|}|" "$f"; else echo "$k=$v" >> "$f"; fi; }
  set_kv DEPLOYMENT_MODE selfhost .env.selfhost
  set_kv VITE_DEPLOYMENT_MODE selfhost .env.selfhost
  set_kv PUBLIC_APP_URL "$APP_URL" .env.selfhost
  set_kv PUBLIC_API_URL "$API_URL" .env.selfhost
  set_kv POSTGRES_PASSWORD "$PG_PASS" .env.selfhost
  set_kv ANON_KEY "$ANON" .env.selfhost
  set_kv SERVICE_ROLE_KEY "$SERVICE" .env.selfhost
  set_kv AZURE_CLIENT_ID "$AZ_ID" .env.selfhost
  set_kv AZURE_CLIENT_SECRET "$AZ_SECRET" .env.selfhost
  [ -n "$AZ_TENANT" ] && set_kv AZURE_TENANT_URL "https://login.microsoftonline.com/$AZ_TENANT/v2.0" .env.selfhost
  if [ "$OPENAI" = "ollama" ]; then
    set_kv OPENAI_API_KEY "ollama" .env.selfhost
    set_kv OPENAI_BASE_URL "http://host.docker.internal:11434/v1" .env.selfhost
    set_kv AI_MODEL "qwen2.5-vl" .env.selfhost
  else
    set_kv OPENAI_API_KEY "$OPENAI" .env.selfhost
  fi
  echo "JWT_SECRET=$JWT_SECRET" > selfhost/.jwt
  chmod 600 .env.selfhost selfhost/.jwt
fi
set -a; . ./.env.selfhost; set +a
JWT_SECRET=$(grep ^JWT_SECRET= selfhost/.jwt | cut -d= -f2)

# ---------------------------------------------------------------- 4. Certificat TLS (LAN)
if [ "$SCHEME" = "https" ] && [ ! -f selfhost/certs/server.crt ]; then
  say "Generez certificat TLS auto-semnat pentru $ADDR (LAN)…"
  mkdir -p selfhost/certs
  openssl req -x509 -newkey rsa:2048 -nodes -days 825 \
    -keyout selfhost/certs/server.key -out selfhost/certs/server.crt \
    -subj "/CN=$ADDR/O=UPB PCB Checker" \
    -addext "subjectAltName=IP:$ADDR,DNS:$ADDR,DNS:localhost,IP:127.0.0.1" 2>/dev/null
  warn "Certificat auto-semnat: browserul va afișa un avertisment — acceptă excepția sau distribuie selfhost/certs/server.crt stațiilor."
fi

# ---------------------------------------------------------------- 5. Backend (Postgres + Auth + Storage)
if [ ! -d selfhost/supabase ]; then
  say "Descarc stack-ul de date (PostgreSQL 16, Auth, Storage — open source, fără cloud)…"
  git clone --depth 1 https://github.com/supabase/supabase /tmp/sb-src
  cp -r /tmp/sb-src/docker selfhost/supabase && rm -rf /tmp/sb-src
  cp selfhost/supabase/.env.example selfhost/supabase/.env
  E=selfhost/supabase/.env
  DASH=$(openssl rand -hex 12)
  sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$POSTGRES_PASSWORD|; s|^JWT_SECRET=.*|JWT_SECRET=$JWT_SECRET|; s|^SETUP_TOKEN=.*|SETUP_TOKEN=$(openssl rand -hex 16)|; s|^ANON_KEY=.*|ANON_KEY=$ANON_KEY|; s|^SERVICE_ROLE_KEY=.*|SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY|; s|^DASHBOARD_PASSWORD=.*|DASHBOARD_PASSWORD=$DASH|; s|^SITE_URL=.*|SITE_URL=$PUBLIC_APP_URL|; s|^API_EXTERNAL_URL=.*|API_EXTERNAL_URL=$PUBLIC_API_URL|; s|^SUPABASE_PUBLIC_URL=.*|SUPABASE_PUBLIC_URL=$PUBLIC_API_URL|; s|^ADDITIONAL_REDIRECT_URLS=.*|ADDITIONAL_REDIRECT_URLS=$PUBLIC_APP_URL/auth|; s|^ENABLE_EMAIL_SIGNUP=.*|ENABLE_EMAIL_SIGNUP=true|; s|^ENABLE_EMAIL_AUTOCONFIRM=.*|ENABLE_EMAIL_AUTOCONFIRM=true|" "$E"
  python3 - <<'PY' || true
import re
p="selfhost/supabase/docker-compose.yml"; s=open(p).read()
if "GOTRUE_EXTERNAL_AZURE_ENABLED" not in s:
    s=s.replace("GOTRUE_SITE_URL: ${SITE_URL}","GOTRUE_SITE_URL: ${SITE_URL}\n      GOTRUE_EXTERNAL_AZURE_ENABLED: \"true\"\n      GOTRUE_EXTERNAL_AZURE_CLIENT_ID: ${AZURE_CLIENT_ID}\n      GOTRUE_EXTERNAL_AZURE_SECRET: ${AZURE_CLIENT_SECRET}\n      GOTRUE_EXTERNAL_AZURE_URL: ${AZURE_TENANT_URL}\n      GOTRUE_EXTERNAL_AZURE_REDIRECT_URI: ${API_EXTERNAL_URL}/auth/v1/callback",1)
    open(p,"w").write(s)
PY
  { echo "AZURE_CLIENT_ID=${AZURE_CLIENT_ID:-}"; echo "AZURE_CLIENT_SECRET=${AZURE_CLIENT_SECRET:-}"; echo "AZURE_TENANT_URL=${AZURE_TENANT_URL:-}"; } >> "$E"
fi
say "Pornesc baza de date și serviciile de autentificare/stocare…"
(cd selfhost/supabase && $DC up -d)
say "Aștept PostgreSQL…"
for i in $(seq 1 60); do (cd selfhost/supabase && $DC exec -T db pg_isready -U postgres) >/dev/null 2>&1 && break; sleep 3; done
sleep 10

# ---------------------------------------------------------------- 6. Schema
if ! (cd selfhost/supabase && $DC exec -T db psql -U postgres -tAc "select to_regclass('public.profiles')") | grep -q profiles; then
  say "Creez tabelele aplicației (schema idempotentă)…"
  (cd selfhost/supabase && $DC exec -T db psql -U postgres -v ON_ERROR_STOP=0 -d postgres) < selfhost/sql/schema.sql >/tmp/pcb-schema.log 2>&1 || true
  grep -i "error" /tmp/pcb-schema.log | head -5 || true
fi

# ---------------------------------------------------------------- 7. App + Nginx
say "Construiesc și pornesc aplicația…"
if [ "$SCHEME" = "https" ]; then
  $DC -f selfhost/docker-compose.yml --env-file .env.selfhost up -d --build
else
  $DC -f selfhost/docker-compose.app.yml --env-file .env.selfhost up -d --build
fi

# ---------------------------------------------------------------- 8. Final
echo
echo -e "${G}${B}┌──────────────────────────────────────────────────────────────┐"
echo "│                    INSTALARE FINALIZATĂ                      │"
echo "└──────────────────────────────────────────────────────────────┘${N}"
echo
echo -e "  ${B}Acces în rețea:${N}      $APP_URL"
echo -e "  ${B}Prima rulare:${N}        $APP_URL/setup  (wizard: cont admin + structură UPB)"
echo -e "  ${B}Ghid în aplicație:${N}   $APP_URL/selfhost"
echo
echo -e "  ${B}Administrare zilnică:${N}"
echo "    ./selfhost/pcb-ctl.sh status | logs | backup | restore | update | doctor"
echo "    ./selfhost/pcb-ctl.sh create-admin <email> <parolă>"
echo
[ -z "${AZURE_CLIENT_ID:-}" ] && warn "Microsoft Entra ID nu e configurat — autentificarea locală email+parolă funcționează; pentru conturi UPB completează AZURE_* în .env.selfhost și rulează ./selfhost/pcb-ctl.sh update"
[ -n "${AZURE_CLIENT_ID:-}" ] && echo "  Microsoft: adaugă în Azure Redirect URI: $API_URL/auth/v1/callback"
echo
