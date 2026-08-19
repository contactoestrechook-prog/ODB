#!/usr/bin/env bash
# Publica en el panel qué incluye la actualización que se acaba de deployar.
# Cada persona lo ve una sola vez, con el botón "Actualizar ahora".
#
# Uso:
#   scripts/publicar-novedad.sh "Mesa de compras lee Excel" \
#       "Ahora se puede adjuntar la planilla del proveedor (Excel o CSV)" \
#       "El costeo aplica aumentos de lista con la herramienta, no de cabeza"
#
# Necesita: ODB_API_URL (default producción) y ODB_DEPLOY_TOKEN (token de un
# usuario dueño, cargado en el entorno; NUNCA en el repo).
set -euo pipefail

TITULO="${1:-}"; shift || true
if [ -z "$TITULO" ]; then echo "Falta el título de la novedad" >&2; exit 1; fi

API="${ODB_API_URL:-https://odb-api-production.up.railway.app}"
TOKEN="${ODB_DEPLOY_TOKEN:-}"
if [ -z "$TOKEN" ]; then echo "Falta ODB_DEPLOY_TOKEN en el entorno" >&2; exit 1; fi

# versión = fecha+hora, única por deploy
VERSION="$(date +%Y%m%d-%H%M)"

# el detalle son el resto de los argumentos, uno por viñeta
DETALLE=$(printf '%s\n' "$@" | python3 -c 'import sys,json;print(json.dumps([l.rstrip("\n") for l in sys.stdin if l.strip()]))')

curl -sS -X POST "$API/novedades" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "$(python3 -c 'import json,sys;print(json.dumps({"version":sys.argv[1],"titulo":sys.argv[2],"detalle":json.loads(sys.argv[3]),"requiereRecarga":True}))' "$VERSION" "$TITULO" "$DETALLE")" \
  | python3 -c 'import sys,json;d=json.load(sys.stdin);print("novedad publicada:", d.get("version"))'
