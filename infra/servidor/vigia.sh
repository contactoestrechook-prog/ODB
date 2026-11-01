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
for s in api admin web proxy waha waha-gows; do
  st=$(docker inspect -f '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' "odb-$s-1" 2>/dev/null || echo "no existe")
  case "$st" in running*unhealthy*|exited*|dead*|restarting*|"no existe") anotar "servicio $s: $st";; esac
done
# disco y memoria
uso=$(df --output=pcent / | tail -1 | tr -dc 0-9); [ "${uso:-0}" -ge 85 ] && anotar "disco al $uso%"
disp=$(awk '/MemAvailable/{a=$2}/MemTotal/{t=$2}END{printf "%d", a*100/t}' /proc/meminfo); [ "${disp:-100}" -le 8 ] && anotar "memoria disponible $disp%"
# candado HTTPS del servidor (Caddy lo renueva solo; avisa si falla la renovación)
# hosts.env se LEE, no se ejecuta: tiene «HOST_API=a, b» sin comillas y sh cortaba
# ahí con «HOST_API: parameter not set» (el vigía no corrió del 22/10 al 1/11/2026)
host() { grep "^$1=" hosts.env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' | cut -d, -f1 | tr -d ' '; }
HOST_API=$(host HOST_API); HOST_WAHA=$(host HOST_WAHA)
if [ -n "$HOST_API" ]; then
  fin=$(echo | timeout 10 openssl s_client -servername "$HOST_API" -connect 127.0.0.1:443 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)
  if [ -n "$fin" ]; then dias=$(( ( $(date -d "$fin" +%s) - $(date +%s) ) / 86400 )); [ "$dias" -le 14 ] && anotar "el candado HTTPS vence en $dias días"; fi
  curl -fsS -o /dev/null --max-time 10 "https://$HOST_API/salud" --resolve "$HOST_API:443:127.0.0.1" || anotar "el servidor no responde /salud"
fi
# WhatsApp: cada sesión de cada WAHA (el de siempre con NOWEB y el de la línea
# general con GOWS, 1/11/2026), preguntando adentro del contenedor (no tiene curl).
for c in waha waha-gows; do
  docker inspect "odb-$c-1" >/dev/null 2>&1 || continue
  lista=$(docker exec "odb-$c-1" node -e 'fetch("http://127.0.0.1:3000/api/sessions?all=true",{headers:{"X-Api-Key":process.env.WAHA_API_KEY||process.env.WHATSAPP_API_KEY||""}}).then(r=>r.json()).then(j=>j.forEach(s=>console.log(s.name+" "+s.status))).catch(()=>console.log("? sin-respuesta"))' 2>/dev/null)
  [ -n "$lista" ] || { anotar "WhatsApp ($c): no contesta"; continue; }
  echo "$lista" | while read -r nombre st; do [ "$st" = "WORKING" ] || echo "$nombre $st"; done > "$ESTADO/caidas-$c"
  while read -r nombre st; do anotar "WhatsApp ($c): la sesión $nombre está $st"; done < "$ESTADO/caidas-$c"
  # CONECTADA PERO SORDA: figura WORKING y WhatsApp le manda mensajes que no
  # puede descifrar, así que al bot no le llega nada (30/10, 31/10 y 1/11/2026).
  # Solo se ve en el registro del contenedor. 3 o más en 15 minutos = avisar.
  docker logs --since 15m "odb-$c-1" 2>&1 | grep 'failed to decrypt message' | grep -o 'session:[a-z0-9_-]*' | sort | uniq -c | while read -r n ses; do
    [ "$n" -ge 3 ] && echo "${ses#session:} $n"
  done > "$ESTADO/sordas-$c"
  while read -r nombre n; do anotar "WhatsApp ($c): la sesión $nombre está conectada pero no puede leer los mensajes ($n en 15 min): hay que volver a vincularla"; done < "$ESTADO/sordas-$c"
done

firma=$(printf '%s' "$problemas" | md5sum | cut -c1-12)
anterior=$(cat "$ESTADO/firma" 2>/dev/null || echo "")
avisar() { [ -n "${NTFY_TOPIC:-}" ] && curl -fsS -o /dev/null --max-time 15 -H "Title: $1" -H "Priority: $2" -d "$3" "https://ntfy.sh/$NTFY_TOPIC" || true; logger -t odb-vigia "$1: $3"; }
if [ -n "$problemas" ] && [ "$firma" != "$anterior" ]; then
  avisar "ODB: algo anda mal" high "Servidor odb-produccion:$problemas"
elif [ -z "$problemas" ] && [ -n "$anterior" ] && [ "$anterior" != "$(printf '' | md5sum | cut -c1-12)" ]; then
  avisar "ODB: todo en orden otra vez" default "Servidor odb-produccion: se resolvió lo que había avisado."
fi
echo "$firma" > "$ESTADO/firma"
