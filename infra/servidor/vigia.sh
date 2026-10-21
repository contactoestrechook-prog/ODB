#!/bin/sh
# Vigía del servidor de ODB (21/10/2026). ISO 27001 A.8.16 (monitoreo).
# Cada 5 minutos: servicios sanos, disco, memoria, candado HTTPS y WhatsApp.
# Si algo falla, avisa al celular por ntfy (app gratis, sin cuenta: se suscribe
# al tema que está en /srv/odb/secretos/alertas.env como NTFY_TOPIC). No manda
# datos de clientes: solo qué falla. Avisa una vez por problema y cuando vuelve.
# Esto NO reemplaza un vigía EXTERNO: si se cae el servidor entero, este no avisa.
set -u
cd /srv/odb || exit 1
[ -f secretos/alertas.env ] && . ./secretos/alertas.env
ESTADO=/var/lib/odb-vigia; mkdir -p "$ESTADO"
problemas=""
anotar() { problemas="$problemas
- $1"; }

# servicios
for s in api admin web proxy waha; do
  st=$(docker inspect -f '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' "odb-$s-1" 2>/dev/null || echo "no existe")
  case "$st" in running*unhealthy*|exited*|dead*|restarting*|"no existe") anotar "servicio $s: $st";; esac
done
# disco y memoria
uso=$(df --output=pcent / | tail -1 | tr -dc 0-9); [ "${uso:-0}" -ge 85 ] && anotar "disco al $uso%"
disp=$(awk '/MemAvailable/{a=$2}/MemTotal/{t=$2}END{printf "%d", a*100/t}' /proc/meminfo); [ "${disp:-100}" -le 8 ] && anotar "memoria disponible $disp%"
# candado HTTPS del servidor (Caddy lo renueva solo; avisa si falla la renovación)
if [ -f hosts.env ]; then . ./hosts.env
  fin=$(echo | timeout 10 openssl s_client -servername "$HOST_API" -connect 127.0.0.1:443 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)
  if [ -n "$fin" ]; then dias=$(( ( $(date -d "$fin" +%s) - $(date +%s) ) / 86400 )); [ "$dias" -le 14 ] && anotar "el candado HTTPS vence en $dias días"; fi
  curl -fsS -o /dev/null --max-time 10 "https://$HOST_API/salud" --resolve "$HOST_API:443:127.0.0.1" || anotar "el servidor no responde /salud"
fi
# WhatsApp (la sesión que usa el servidor, donde esté)
if grep -q '^WAHA_URL=' secretos/api.env; then
  W=$(grep '^WAHA_URL=' secretos/api.env | cut -d= -f2- | tr -d '"'); K=$(grep '^WAHA_API_KEY=' secretos/api.env | cut -d= -f2- | tr -d '"')
  [ "$W" = "http://waha:3000" ] && W="https://$HOST_WAHA"
  ses=$(curl -fsS --max-time 15 -H "X-Api-Key: $K" "$W/api/sessions" 2>/dev/null | tr ',' '\n' | grep -c '"status":"WORKING"')
  [ "${ses:-0}" -ge 1 ] || anotar "WhatsApp: ninguna sesión conectada"
fi

firma=$(printf '%s' "$problemas" | md5sum | cut -c1-12)
anterior=$(cat "$ESTADO/firma" 2>/dev/null || echo "")
avisar() { [ -n "${NTFY_TOPIC:-}" ] && curl -fsS -o /dev/null --max-time 15 -H "Title: $1" -H "Priority: $2" -d "$3" "https://ntfy.sh/$NTFY_TOPIC" || true; logger -t odb-vigia "$1: $3"; }
if [ -n "$problemas" ] && [ "$firma" != "$anterior" ]; then
  avisar "ODB: algo anda mal" high "Servidor odb-produccion:$problemas"
elif [ -z "$problemas" ] && [ -n "$anterior" ] && [ "$anterior" != "$(printf '' | md5sum | cut -c1-12)" ]; then
  avisar "ODB: todo en orden otra vez" default "Servidor odb-produccion: se resolvió lo que había avisado."
fi
echo "$firma" > "$ESTADO/firma"
