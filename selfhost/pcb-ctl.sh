#!/usr/bin/env bash
# ============================================================================
# PCB Checker & CAM — Administrare zilnică a serverului local
# Usage: ./selfhost/pcb-ctl.sh <status|logs|backup|restore|update|create-admin|doctor>
# ============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

G='\033[1;32m'; Y='\033[1;33m'; R='\033[1;31m'; N='\033[0m'
say(){ echo -e "${G}==>${N} $*"; }; warn(){ echo -e "${Y}!!${N} $*"; }; die(){ echo -e "${R}EROARE:${N} $*"; exit 1; }

DC="docker compose"; $DC version >/dev/null 2>&1 || DC="sudo docker compose"
SB="selfhost/supabase"
[ -d "$SB" ] || die "Stack-ul de date lipsește ($SB). Rulează întâi selfhost/install.sh"

db(){ (cd "$SB" && $DC exec -T db psql -U postgres -d postgres "$@"); }

cmd="${1:-help}"; shift || true
case "$cmd" in

status)
  say "Containere:"
  (cd "$SB" && $DC ps) || true
  $DC -f selfhost/docker-compose.app.yml ps 2>/dev/null || true
  echo
  say "Resurse:"
  docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}" 2>/dev/null | grep -i "pcb\|supabase\|NAME" || docker stats --no-stream | head -15
  echo
  say "Stocare arhive ZIP:"
  du -sh selfhost/supabase/volumes/storage 2>/dev/null || warn "volum de stocare negăsit local (verifică docker volume ls)"
  echo
  say "Predări în baza de date:"
  db -tAc "select count(*) || ' predări totale, ' || count(*) filter (where kind='OFFICIAL') || ' oficiale' from public.submissions" 2>/dev/null || warn "nu pot interoga baza"
  ;;

logs)
  say "Loguri (Ctrl+C pentru ieșire):"
  (cd "$SB" && $DC logs -f --tail=100) &
  $DC -f selfhost/docker-compose.app.yml logs -f --tail=100 2>/dev/null || wait
  ;;

backup)
  TS=$(date +%Y%m%d-%H%M%S)
  mkdir -p selfhost/backups
  OUT="selfhost/backups/pcb-backup-$TS.tar.gz"
  say "Dump PostgreSQL…"
  (cd "$SB" && $DC exec -T db pg_dump -U postgres -d postgres) > "selfhost/backups/db-$TS.sql"
  say "Arhivez fișierele ZIP ale studenților și .env…"
  tar -czf "$OUT" -C selfhost/backups "db-$TS.sql" -C "$PWD" \
    $( [ -d selfhost/supabase/volumes/storage ] && echo "selfhost/supabase/volumes/storage" ) \
    $( [ -f .env.selfhost ] && echo ".env.selfhost" ) 2>/dev/null || tar -czf "$OUT" -C selfhost/backups "db-$TS.sql"
  rm "selfhost/backups/db-$TS.sql"
  say "Backup creat: $OUT ($(du -h "$OUT" | cut -f1))"
  ;;

restore)
  [ $# -ge 1 ] || die "Usage: ./selfhost/pcb-ctl.sh restore <fisier_backup.tar.gz>"
  [ -f "$1" ] || die "Fișierul $1 nu există."
  warn "Restaurarea SUPRASCRIE baza de date și fișierele curente. Ctrl+C în 5s pentru anulare…"; sleep 5
  TMP=$(mktemp -d)
  tar -xzf "$1" -C "$TMP"
  SQL=$(find "$TMP" -name "db-*.sql" | head -1)
  [ -n "$SQL" ] || die "Arhiva nu conține dump SQL."
  say "Restaurez baza de date…"
  db -c "drop schema public cascade; create schema public;" >/dev/null
  db < "$SQL" >/dev/null
  if [ -d "$TMP/selfhost/supabase/volumes/storage" ]; then
    say "Restaurez fișierele ZIP…"
    mkdir -p selfhost/supabase/volumes/storage
    cp -r "$TMP/selfhost/supabase/volumes/storage/." selfhost/supabase/volumes/storage/
  fi
  [ -f "$TMP/.env.selfhost" ] && cp "$TMP/.env.selfhost" .env.selfhost
  rm -rf "$TMP"
  say "Restaurare completă. Repornesc aplicația…"
  $DC -f selfhost/docker-compose.app.yml --env-file .env.selfhost up -d || true
  ;;

update)
  say "Backup preventiv înainte de actualizare…"
  "$0" backup || warn "backup eșuat — continui pe riscul tău în 5s"; sleep 5
  say "git pull…"
  git pull --ff-only || die "git pull eșuat — rezolvă conflictele local"
  say "Reconstruiesc aplicația…"
  $DC -f selfhost/docker-compose.app.yml --env-file .env.selfhost up -d --build
  say "Aplic migrările SQL noi (schema e idempotentă)…"
  db < selfhost/sql/schema.sql >/dev/null 2>&1 || warn "unele instrucțiuni SQL au fost sarite (probabil deja aplicate)"
  say "Actualizare finalizată."
  ;;

create-admin)
  [ $# -ge 2 ] || die "Usage: ./selfhost/pcb-ctl.sh create-admin <email> <parolă>"
  EMAIL="$1"; PASS="$2"
  say "Creez/resetez contul $EMAIL…"
  db -tAc "select id from auth.users where email='$EMAIL'" | grep -q . && EXISTS=1 || EXISTS=0
  HASHED=$(db -tAc "select crypt('$PASS', gen_salt('bf'))")
  if [ "$EXISTS" = "1" ]; then
    db -c "update auth.users set encrypted_password='$HASHED', email_confirmed_at=coalesce(email_confirmed_at, now()) where email='$EMAIL';" >/dev/null
    UID_=$(db -tAc "select id from auth.users where email='$EMAIL'")
  else
    UID_=$(cat /proc/sys/kernel/random/uuid)
    db -c "insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
           values ('$UID_', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '$EMAIL', '$HASHED', now(), now(), now());" >/dev/null
    db -c "insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
           values ('$UID_', '$UID_', '$EMAIL', jsonb_build_object('sub','$UID_','email','$EMAIL'), 'email', now(), now(), now());" >/dev/null
  fi
  db -c "insert into public.profiles (id, email) values ('$UID_', '$EMAIL') on conflict (id) do nothing;" >/dev/null
  db -c "insert into public.user_roles (user_id, role) values ('$UID_', 'admin') on conflict (user_id, role) do nothing;" >/dev/null
  say "Gata. $EMAIL are rol de Administrator General și parola setată."
  ;;

doctor)
  say "Verific tabelele aplicației:"
  for t in profiles user_roles academic_years series groups students submissions project_files drc_reports drc_settings gradebook_columns layout_fingerprints layout_similarity_pairs integrity_alerts deadlines exam_tokens; do
    if db -tAc "select to_regclass('public.$t')" 2>/dev/null | grep -q "$t"; then echo "  ✓ $t"; else echo -e "  ${R}✗ $t LIPSEȘTE${N}"; fi
  done
  say "Verific funcțiile RLS:"
  for f in has_role can_view_group can_manage_group manages_series ensure_profile set_role redeem_exam_token; do
    if db -tAc "select proname from pg_proc where proname='$f'" 2>/dev/null | grep -q "$f"; then echo "  ✓ $f"; else echo -e "  ${R}✗ $f LIPSEȘTE${N}"; fi
  done
  say "Verific permisiunile pe volume:"
  [ -w selfhost/supabase/volumes ] && echo "  ✓ volumele sunt inscriptibile" || warn "volumele nu sunt inscriptibile de utilizatorul curent"
  say "Verific porturile:"
  for p in 80 443 3000 8000; do
    (echo > /dev/tcp/127.0.0.1/$p) 2>/dev/null && echo "  ✓ port $p răspunde" || echo "  – port $p liber/inactiv"
  done
  ;;

*)
  echo "PCB Checker — administrare server local"
  echo "Usage: ./selfhost/pcb-ctl.sh <comandă>"
  echo "  status              Stare containere, resurse, spațiu ZIP, număr predări"
  echo "  logs                Loguri în timp real"
  echo "  backup              Backup complet (.tar.gz în selfhost/backups/)"
  echo "  restore <fișier>    Restaurare completă din backup"
  echo "  update              git pull + rebuild + migrări SQL"
  echo "  create-admin <email> <parolă>   Creează/resetează un cont de profesor"
  echo "  doctor              Verifică tabele, funcții RLS, volume, porturi"
  ;;
esac
