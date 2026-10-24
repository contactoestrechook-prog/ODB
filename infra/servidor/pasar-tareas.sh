#!/bin/sh
# Paso 5 de la mudanza: las tareas programadas (avisos a administración, ARCA,
# recordatorios, vigías, difusiones) pasan de Railway al servidor propio, SIN
# que corran nunca en los dos a la vez (misma base: se duplicarían avisos y
# comprobantes). Requiere que Railway deje publicar.
#   1. Railway: ODB_TAREAS=0 en odb-api y publicar esta versión (que entiende
#      ODB_TAREAS) con scripts/publicar.sh → main queda en esta versión.
#   2. Confirmar en los registros de Railway que arrancó la versión nueva.
#   3. Servidor propio: ODB_TAREAS=1, ODB_AVISOS_PEDIDOS=1 y el aviso de
#      «pedido listo» a n8n (N8N_PEDIDOS_WEBHOOK_URL, el de Railway).
# WAHA sigue siendo la de Railway hasta vincular las líneas por QR (paso 4).
set -eu
PROY=b936767e-23e6-4290-9f13-732df0d015d3
SERVIDOR="${SERVIDOR:-root@172.233.20.11}"
LLAVE="${LLAVE:-$HOME/.ssh/odb_produccion}"
ssh_() { ssh -i "$LLAVE" -o IdentitiesOnly=yes -o BatchMode=yes -o ServerAliveInterval=15 "$SERVIDOR" "$@"; }
cd "$(git rev-parse --show-toplevel)"
DIR_ODB="${DIR_ODB:-/Users/leandroalonso/Projects/odb}"

echo "== 1. Railway: tareas apagadas y versión nueva"
(cd "$DIR_ODB" && railway variables -p "$PROY" -e production -s odb-api --set ODB_TAREAS=0 --skip-deploys)
COPIA=$(pwd)
# scripts/publicar.sh publica en el servidor propio desde el 24/10/2026; este paso es para Railway
(cd "$COPIA" && rm -f node_modules apps/*/node_modules && railway up "$COPIA" --path-as-root -p "$PROY" -e production -s odb-api -d -m "Tareas apagadas en Railway: pasan al servidor propio")
echo "Esperando que Railway arranque la versión nueva…"
VER=$(git rev-parse --short HEAD)
for i in $(seq 1 60); do
  if (cd "$DIR_ODB" && railway logs -p "$PROY" -e production -s odb-api --lines 200 2>/dev/null) | grep -q "Nest application successfully started"; then
    dep=$(cd "$DIR_ODB" && railway deployment list -p "$PROY" -e production -s odb-api 2>/dev/null | sed -n 2p)
    echo "  último deploy: $dep"
    case "$dep" in *SUCCESS*) break;; esac
  fi
  sleep 15
done
echo "  ¿Arrancó la versión $VER con ODB_TAREAS=0? Confirmar en los registros antes de seguir."
printf "Escribí SI para prender las tareas en el servidor propio: "; read r; [ "$r" = SI ] || exit 1

echo "== 2. Servidor propio: tareas prendidas"
N8N=$(cd "$DIR_ODB" && railway variables -p "$PROY" -e production -s odb-api --json | python3 -c 'import json,sys; print(json.load(sys.stdin).get("N8N_PEDIDOS_WEBHOOK_URL",""))')
ssh_ "set -e; cd /srv/odb/secretos
  pon() { k=\$1; v=\$2; grep -q \"^\$k=\" api.env && sed -i \"s#^\$k=.*#\$k=\\\"\$v\\\"#\" api.env || echo \"\$k=\\\"\$v\\\"\" >> api.env; }
  pon ODB_TAREAS 1
  pon ODB_AVISOS_PEDIDOS 1
  pon N8N_PEDIDOS_WEBHOOK_URL '$N8N'
  cd /srv/odb && docker compose --env-file hosts.env up -d --force-recreate api
  sleep 40; docker compose --env-file hosts.env logs api --since 1m 2>&1 | grep -iE 'error|started' | tail -3"
echo "Listo: las tareas corren en el servidor propio."
