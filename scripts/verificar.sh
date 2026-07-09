#!/usr/bin/env bash
# Verificación total de ODB — lo mismo que corre el CI, para correr local antes
# de tocar producción:  ./scripts/verificar.sh
# Sale con código != 0 si algo falla.

set -uo pipefail
RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
FALLOS=()

paso() {
  local nombre="$1"; shift
  printf '\n\033[1m▶ %s\033[0m\n' "$nombre"
  if (cd "$RAIZ/$1" && eval "$2"); then
    printf '\033[32m✓ %s\033[0m\n' "$nombre"
  else
    printf '\033[31m✗ %s\033[0m\n' "$nombre"
    FALLOS+=("$nombre")
  fi
}

paso "API · build"        apps/api    "npx nest build"
paso "API · tests"        apps/api    "npx jest --silent"
# E2E: necesita apps/api/.env con Supabase; si no está, se salta
if [ -f "$RAIZ/apps/api/.env" ]; then
  paso "API · E2E"        apps/api    "npx jest --silent --config ./test/jest-e2e.json"
else
  printf '\n\033[33m⚠ API · E2E salteado (falta apps/api/.env)\033[0m\n'
fi
paso "Panel · tsc"        apps/admin  "npx tsc --noEmit"
paso "Panel · build"      apps/admin  "npm run build > /dev/null"
paso "Tienda · tsc"       apps/web    "npx tsc --noEmit"
paso "Tienda · build"     apps/web    "npm run build > /dev/null"
paso "Móvil · tsc"        apps/mobile "npx tsc --noEmit"

echo
if [ ${#FALLOS[@]} -eq 0 ]; then
  printf '\033[1;32m━━ TODO VERDE ━━\033[0m\n'
else
  printf '\033[1;31m━━ FALLARON: %s ━━\033[0m\n' "${FALLOS[*]}"
  exit 1
fi
