#!/bin/sh
# Backups CIFRADOS de ODB fuera de Akamai (21/10/2026). ISO 27001 A.8.13.
# La base de datos está en Supabase (con sus propios backups); acá se guarda lo
# que vive en el servidor: la sesión de WhatsApp, n8n, el proxy (certificados) y
# la configuración con sus secretos. restic cifra TODO antes de mandarlo: el
# destino nunca ve datos en claro. La clave del repositorio la guarda el dueño
# fuera del servidor (sin ella el backup no se puede leer: no se recupera).
#
# Configuración: /srv/odb/secretos/backup.env (600), con:
#   RESTIC_REPOSITORY=s3:https://<proveedor>/<balde>/odb
#   RESTIC_PASSWORD=<clave larga del dueño>
#   AWS_ACCESS_KEY_ID=...  AWS_SECRET_ACCESS_KEY=...
# Uso: backup.sh            → copia de hoy + limpieza (7 diarias, 4 semanales, 6 mensuales)
#      backup.sh probar      → restaura la última copia en /tmp y la compara (A.8.13: probar)
set -eu
ENV=/srv/odb/secretos/backup.env
[ -f "$ENV" ] || { echo "Falta $ENV: backups sin configurar"; exit 2; }
set -a; . "$ENV"; set +a
VOLS=/var/lib/docker/volumes
ORIGENES="/srv/odb/secretos /srv/odb/docker-compose.yml /srv/odb/Caddyfile /srv/odb/hosts.env $VOLS/odb_waha-sesiones $VOLS/odb_n8n-datos $VOLS/odb_caddy-datos"

restic snapshots >/dev/null 2>&1 || restic init

if [ "${1:-}" = probar ]; then
  DESTINO=$(mktemp -d /tmp/odb-restauracion.XXXXXX)
  restic restore latest --target "$DESTINO" >/dev/null
  for o in $ORIGENES; do
    [ -e "$o" ] || continue
    diff -rq "$o" "$DESTINO$o" >/dev/null 2>&1 && echo "ok: $o" || echo "DISTINTO (normal si cambió desde la copia): $o"
  done
  rm -rf "$DESTINO"
  exit 0
fi

# n8n escribe su base sqlite en caliente: se copia igual (n8n la recupera); la
# sesión de WhatsApp idem. Si alguna vez hace falta consistencia estricta, parar
# esos dos contenedores un minuto alrededor de la copia.
restic backup --tag diaria --exclude-caches $ORIGENES 2>&1 | tail -3
restic forget --prune --keep-daily 7 --keep-weekly 4 --keep-monthly 6 2>&1 | tail -2
restic check --read-data-subset=5% 2>&1 | tail -1
