#!/usr/bin/env bash
# Avisa por sistema, a una persona, que se arregló algo.
#
# La novedad del panel (publicar-novedad.sh) la ve todo el equipo una vez y
# sirve para "qué cambió en esta versión". Esto es otra cosa: le llega a la
# campanita de UNA persona y queda ahí hasta que la lee. Juan Pablo pidió que
# cada arreglo le llegue así, porque él no está mirando el panel todo el día y
# necesita enterarse de lo que se tocó en su operación.
#
# Uso:
#   scripts/avisar-arreglo.sh "Título corto" "Qué pasaba" "Qué hace ahora" ["Qué mirar"]
#
# Necesita ODB_DEPLOY_TOKEN (token de un dueño) y, opcional, ODB_AVISAR_A con
# el id del usuario (por defecto, Juan Pablo).
set -euo pipefail

TITULO="${1:-}"; shift || true
if [ -z "$TITULO" ]; then echo "Falta el título del aviso" >&2; exit 1; fi

API="${ODB_API_URL:-https://odb-api-production.up.railway.app}"
TOKEN="${ODB_DEPLOY_TOKEN:-}"
PARA="${ODB_AVISAR_A:-f30e4bf1-ea26-4235-916d-6e3bb588ce12}"  # Juan Pablo Fernandez
if [ -z "$TOKEN" ]; then echo "Falta ODB_DEPLOY_TOKEN en el entorno" >&2; exit 1; fi

DETALLE=$(printf '%s\n\n' "$@" | python3 -c 'import sys; print(sys.stdin.read().strip())')

curl -sS -X POST "$API/novedades/alertas" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "$(python3 -c 'import json,sys;print(json.dumps({"paraUsuario":sys.argv[1],"tipo":"arreglo","titulo":sys.argv[2],"detalle":sys.argv[3]}))' "$PARA" "$TITULO" "$DETALLE")" \
  | python3 -c 'import sys,json;d=json.load(sys.stdin);print("aviso enviado" if d.get("ok") else "NO se pudo enviar: "+str(d)[:200])'
