#!/bin/sh
# Copia las variables de Railway a /srv/odb/secretos/*.env del servidor propio,
# sin mostrarlas en pantalla ni dejarlas en el repo (21/10/2026).
# Uso (desde la Mac, con la CLI de railway logueada):
#   infra/servidor/variables-desde-railway.sh <modo>
#   modo «prueba»: el servidor nuevo convive con Railway → tareas apagadas
#                  (ODB_TAREAS=0), WhatsApp propio vacío, sin n8n de pedidos.
#   modo «final»:  la noche del cambio → tareas prendidas.
set -e
MODO="${1:?modo: prueba | final}"
PROY=b936767e-23e6-4290-9f13-732df0d015d3
SERVIDOR="${SERVIDOR:-root@172.233.20.11}"
LLAVE="${LLAVE:-$HOME/.ssh/odb_produccion}"
HOSTS="${HOSTS:-$(dirname "$0")/hosts.env.ejemplo}"
. "$HOSTS"
ssh_() { ssh -i "$LLAVE" -o IdentitiesOnly=yes -o BatchMode=yes "$SERVIDOR" "$@"; }
ssh_ 'install -d -m 700 /srv/odb/secretos'

vars() { railway variables -p "$PROY" -e production -s "$1" --json; }
# arma un .env: todas las de Railway menos las RAILWAY_*, y encima los cambios
escribir() { # $1 servicio de Railway, $2 archivo, $3 cambios (KEY=VAL por renglón)
  # Los valores de varias líneas (certificados de ARCA) van a archivos aparte
  # (secretos/archivos/, solo lectura para el contenedor) y la variable *_PEM
  # pasa a *_PATH. En el .env, «$» se escribe «$$» para que compose no lo
  # interprete. Todo se arma en el servidor: nada pasa por la pantalla.
  vars "$1" | CAMBIOS="$3" python3 -c '
import json, os, sys
d = json.load(sys.stdin)
d = {k: v for k, v in d.items() if not k.startswith("RAILWAY_")}
for linea in os.environ["CAMBIOS"].strip().splitlines():
    if "=" in linea:
        k, v = linea.split("=", 1); d[k.strip()] = v
archivos = {}
for k in list(d):
    if "\n" in str(d[k]):
        nombre = k.replace("_PEM", "_PATH") if "_PEM" in k else k + "_PATH"
        archivos[k + ".pem"] = str(d.pop(k))
        d[nombre] = "/run/secretos/" + k + ".pem"
lineas = []
for k in sorted(d):
    v = str(d[k]).replace("\\", "\\\\").replace("\"", "\\\"").replace("$", "$$")
    lineas.append(f"{k}=\"{v}\"")
print(json.dumps({"env": "\n".join(lineas) + "\n", "archivos": archivos}))
' | ssh_ "python3 -c '
import json, os, sys
d = json.load(sys.stdin)
os.umask(0o077)
open(\"/srv/odb/secretos/$2.env\", \"w\").write(d[\"env\"])
os.makedirs(\"/srv/odb/secretos/archivos\", mode=0o700, exist_ok=True)
for n, c in d[\"archivos\"].items():
    r = \"/srv/odb/secretos/archivos/\" + n
    open(r, \"w\").write(c); os.chown(r, 1000, 1000); os.chmod(r, 0o400)
os.chown(\"/srv/odb/secretos/archivos\", 1000, 1000)
print(len(d[\"env\"].splitlines()), \"variables,\", len(d[\"archivos\"]), \"archivos\")
'" | sed "s/^/  $2.env: /"
}

if [ "$MODO" = prueba ]; then TAREAS="ODB_TAREAS=0"; PEDIDOS_N8N="N8N_PEDIDOS_WEBHOOK_URL="; else TAREAS="ODB_TAREAS=1
ODB_AVISOS_PEDIDOS=1"; PEDIDOS_N8N=""; fi

escribir odb-api api "$TAREAS
$PEDIDOS_N8N
WAHA_URL=http://waha:3000
API_PUBLIC_URL=https://$HOST_API
ADMIN_URL=https://$HOST_PANEL
ODB_PANEL_URL=https://$HOST_PANEL
WEB_PUBLIC_URL=https://$HOST_TIENDA
TZ=America/Argentina/Buenos_Aires"
escribir odb-admin admin "API_URL=http://api:3001
NEXT_PUBLIC_API_URL=https://$HOST_API"
escribir odb-web web "API_URL=http://api:3001"
escribir waha-odb waha ""
escribir n8n-odb n8n "N8N_HOST=$HOST_N8N
WEBHOOK_URL=https://$HOST_N8N/
N8N_EDITOR_BASE_URL=https://$HOST_N8N/"
