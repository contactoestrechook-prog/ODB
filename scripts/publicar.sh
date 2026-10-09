#!/bin/sh
# PUBLICAR A PRODUCCIÓN, CON CANDADO (9/10/2026).
#
# Leandro: «hay dos versiones distintas, ¿por qué?». Cada sesión publicaba
# desde su rama y Railway se queda con lo último que se sube: a las 14:18 el
# panel salió de una rama sin la factura nueva y volvió el formato viejo.
#
# Regla: a producción solo sube una copia que CONTIENE todo origin/main y está
# limpia. Después de publicar, esa versión se sube a main (para que la próxima
# sesión parta de ella).
#
# Uso: scripts/publicar.sh <copia de trabajo> <servicio> "<mensaje>"
#   servicio: odb-api | odb-admin | odb-web
set -e
COPIA="$1"; SERVICIO="$2"; MENSAJE="$3"
PROYECTO=b936767e-23e6-4290-9f13-732df0d015d3
[ -n "$COPIA" ] && [ -n "$SERVICIO" ] && [ -n "$MENSAJE" ] || { echo "Uso: scripts/publicar.sh <copia> <odb-api|odb-admin|odb-web> \"<mensaje>\""; exit 1; }
case "$SERVICIO" in odb-api|odb-admin|odb-web) ;; *) echo "Servicio desconocido: $SERVICIO"; exit 1;; esac

cd "$COPIA"
git fetch -q origin main
if ! git merge-base --is-ancestor origin/main HEAD; then
  echo "CANDADO: esta copia NO tiene todo lo que está en main (origin/main $(git rev-parse --short origin/main))."
  echo "Publicarla borraría cambios de otros. Hacé primero:  git merge origin/main  (y probá)."
  exit 1
fi
SUCIOS=$(git status --porcelain | grep -v ' node_modules$' | grep -v '^?? .*node_modules' || true)
if [ -n "$SUCIOS" ]; then
  echo "CANDADO: hay cambios sin commitear; lo publicado tiene que ser exactamente un commit."
  echo "$SUCIOS"; exit 1
fi
# railway up no indexa con los enlaces de node_modules
rm -f node_modules apps/api/node_modules apps/admin/node_modules apps/web/node_modules
COMMIT=$(git rev-parse --short HEAD)
railway up "$COPIA" --path-as-root -p "$PROYECTO" -e production -s "$SERVICIO" -d -m "$MENSAJE ($COMMIT)"
# lo publicado pasa a ser main
git push origin HEAD:main
echo "Publicado $SERVICIO desde $COMMIT y main quedó en $COMMIT."
