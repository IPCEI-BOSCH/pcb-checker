# ============================================================================
# PCB Checker & CAM — Instalator Windows 10/11 / Windows Server
# Necesită: Docker Desktop cu WSL2 pornit. Rulare: PowerShell în folderul proiectului
#   Set-ExecutionPolicy -Scope Process Bypass
#   .\selfhost\install.ps1
# ============================================================================
$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)

function Say($m)  { Write-Host "==> $m" -ForegroundColor Green }
function Warn($m) { Write-Host "!!  $m" -ForegroundColor Yellow }
function Die($m)  { Write-Host "EROARE: $m" -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host "  PCB CHECKER & CAM — Instalare Server Local (Windows)" -ForegroundColor Cyan
Write-Host ""

# 1. Docker Desktop
Say "Verific Docker Desktop…"
try { docker version | Out-Null } catch { Die "Docker Desktop nu rulează. Instalează-l de pe docker.com și pornește-l, apoi reia scriptul." }
docker compose version | Out-Null

# 2. Mod rețea
$hostIp = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notlike "*Loopback*" -and $_.IPAddress -notlike "169.254.*" } | Select-Object -First 1).IPAddress
if (-not $hostIp) { $hostIp = "localhost" }
Write-Host ""
Write-Host "Unde va fi accesibil serverul?"
Write-Host "  A) Rețea locală LAN (laborator) — IP detectat: $hostIp"
Write-Host "  B) Domeniu public (ex. pcb.cetti.ro)"
Write-Host "  C) Localhost — test pe acest PC (port 3000)"
$mode = (Read-Host "Alege [A/B/C] (implicit A)"); if (-not $mode) { $mode = "A" }

$addr = $hostIp; $scheme = "https"
switch ($mode.ToUpper()) {
  "B" { $addr = Read-Host "Domeniul public"; $scheme = "https" }
  "C" { $addr = "localhost"; $scheme = "http" }
  default { $a = Read-Host "IP-ul serverului în rețea (implicit $hostIp)"; if ($a) { $addr = $a } }
}
if ($scheme -eq "https") { $appUrl = "https://$addr"; $apiUrl = "https://$addr/api" }
else { $appUrl = "http://${addr}:3000"; $apiUrl = "http://${addr}:8000" }

# 3. .env.selfhost
function RandHex($n) { -join ((1..$n) | ForEach-Object { "{0:x2}" -f (Get-Random -Max 256) }) }
if (-not (Test-Path ".env.selfhost")) {
  Copy-Item ".env.selfhost.example" ".env.selfhost"
  $azId = Read-Host "Microsoft Entra — Application (client) ID (Enter = mai târziu)"
  $azSecret = Read-Host "Microsoft Entra — Client secret"
  $azTenant = Read-Host "Microsoft Entra — Directory (tenant) ID"
  $jwt = RandHex 32; $pg = RandHex 16
  (Get-Content ".env.selfhost") `
    -replace "^PUBLIC_APP_URL=.*", "PUBLIC_APP_URL=$appUrl" `
    -replace "^PUBLIC_API_URL=.*", "PUBLIC_API_URL=$apiUrl" `
    -replace "^AZURE_CLIENT_ID=.*", "AZURE_CLIENT_ID=$azId" `
    -replace "^AZURE_CLIENT_SECRET=.*", "AZURE_CLIENT_SECRET=$azSecret" |
    Set-Content ".env.selfhost"
  if ($azTenant) { Add-Content ".env.selfhost" "AZURE_TENANT_URL=https://login.microsoftonline.com/$azTenant/v2.0" }
  Add-Content ".env.selfhost" "DEPLOYMENT_MODE=selfhost`nVITE_DEPLOYMENT_MODE=selfhost`nPOSTGRES_PASSWORD=$pg"
  Set-Content "selfhost\.jwt" "JWT_SECRET=$jwt"
  Warn "Cheile ANON_KEY/SERVICE_ROLE_KEY (JWT) se generează cel mai sigur cu install.sh pe Linux sau cu: node selfhost\mkjwt.mjs"
}

# 4. Certificat TLS auto-semnat (LAN)
if ($scheme -eq "https" -and -not (Test-Path "selfhost\certs\server.crt")) {
  Say "Generez certificat TLS auto-semnat pentru $addr…"
  New-Item -ItemType Directory -Force -Path "selfhost\certs" | Out-Null
  docker run --rm -v "${PWD}\selfhost\certs:/certs" alpine/openssl `
    req -x509 -newkey rsa:2048 -nodes -days 825 `
    -keyout /certs/server.key -out /certs/server.crt `
    -subj "/CN=$addr/O=UPB PCB Checker" `
    -addext "subjectAltName=IP:$addr,DNS:$addr,DNS:localhost,IP:127.0.0.1"
  Warn "Certificat auto-semnat: browserul va afișa un avertisment — acceptă excepția."
}

# 5. Backend + aplicație
Say "Pornesc stack-ul de date (PostgreSQL 16, Auth, Storage)…"
if (-not (Test-Path "selfhost\supabase")) {
  git clone --depth 1 https://github.com/supabase/supabase "$env:TEMP\sb-src"
  Copy-Item -Recurse "$env:TEMP\sb-src\docker" "selfhost\supabase"
  Remove-Item -Recurse -Force "$env:TEMP\sb-src"
  Copy-Item "selfhost\supabase\.env.example" "selfhost\supabase\.env"
  Warn "Completează POSTGRES_PASSWORD, JWT_SECRET, ANON_KEY, SERVICE_ROLE_KEY în selfhost\supabase\.env (vezi INSTALL_GUIDE_RO.md)."
}
docker compose -f selfhost\supabase\docker-compose.yml --env-file selfhost\supabase\.env up -d
Say "Aștept PostgreSQL…"
for ($i = 0; $i -lt 40; $i++) {
  docker compose -f selfhost\supabase\docker-compose.yml --env-file selfhost\supabase\.env exec -T db pg_isready -U postgres 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) { break }
  Start-Sleep 3
}
Start-Sleep 10

Say "Aplic schema aplicației…"
Get-Content selfhost\sql\schema.sql | docker compose -f selfhost\supabase\docker-compose.yml --env-file selfhost\supabase\.env exec -T db psql -U postgres -d postgres 2>$null | Out-Null

Say "Construiesc și pornesc aplicația…"
if ($scheme -eq "https") { docker compose -f selfhost\docker-compose.yml --env-file .env.selfhost up -d --build }
else { docker compose -f selfhost\docker-compose.app.yml --env-file .env.selfhost up -d --build }

Write-Host ""
Write-Host "  INSTALARE FINALIZATĂ" -ForegroundColor Green
Write-Host "  Acces:        $appUrl"
Write-Host "  Prima rulare: $appUrl/setup"
Write-Host ""
Start-Process $appUrl
