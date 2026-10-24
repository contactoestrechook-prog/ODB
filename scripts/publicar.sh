#!/bin/sh
# PUBLICAR A PRODUCCIÓN, CON CANDADO.
#
# 9/10/2026, Leandro: «hay dos versiones distintas, ¿por qué?». Cada sesión
# publicaba desde su rama y producción se quedaba con lo último que se subía:
# a las 14:18 el panel salió de una rama sin la factura nueva y volvió el
# formato viejo.
#
# 24/10/2026: ODB ya no corre en Railway, corre en el SERVIDOR PROPIO
# (sistema.odbpremiummarket.com.ar y api.odbpremiummarket.com.ar). Este script
# seguía subiendo a Railway y lo publicado no llegaba a nadie («no actualizó
# nada… ¿qué Railway?»). Ahora publica en el servidor propio con
# infra/servidor/publicar.sh.
#
# Regla: a producción solo sube una copia que CONTIENE todo origin/main y está
# limpia. Después de publicar, esa versión se sube a main (para que la próxima
# sesión parta de ella).
#
# Uso: scripts/publicar.sh <copia de trabajo> <servicio…> "<mensaje>"
#   servicio: api | admin | web   (también se aceptan odb-api, odb-admin, odb-web)
#   ej.: scripts/publicar.sh ~/Projects/odb-mirama api admin "Cuentas corrientes"
set -e
[ $# -ge 3 ] || { echo "Uso: scripts/publicar.sh <copia> <api|admin|web>… \"<mensaje>\""; exit 1; }
COPIA="$1"; shift
# el último argumento es el mensaje; lo del medio, los servicios
SERVICIOS=""
while [ $# -gt 1 ]; do
  case "$1" in
    api|odb-api) SERVICIOS="$SERVICIOS api" ;;
    admin|odb-admin) SERVICIOS="$SERVICIOS admin" ;;
    web|odb-web) SERVICIOS="$SERVICIOS web" ;;
    *) echo "Servicio desconocido: $1 (api, admin o web)"; exit 1 ;;
  esac
  shift
done
MENSAJE="$1"
[ -n "$SERVICIOS" ] && [ -n "$MENSAJE" ] || { echo "Uso: scripts/publicar.sh <copia> <api|admin|web>… \"<mensaje>\""; exit 1; }

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
COMMIT=$(git rev-parse --short HEAD)
echo "Publicando$SERVICIOS desde $COMMIT en el servidor propio: $MENSAJE"
# manda el código (git archive del commit), compila con docker compose y levanta
sh infra/servidor/publicar.sh $SERVICIOS
# lo publicado pasa a ser main
git push origin HEAD:main
echo "Publicado$SERVICIOS desde $COMMIT y main quedó en $COMMIT."
echo "Verificá en https://sistema.odbpremiummarket.com.ar (panel) y https://api.odbpremiummarket.com.ar (API)."
