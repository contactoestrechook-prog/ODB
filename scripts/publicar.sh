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
# EL MANUAL AL DÍA (Leandro, 10/11/2026: «necesito que el manual de uso odb esté
# siempre actualizado»). El asistente del manual ya ve lo publicado, pero el
# manual escrito lo cambia quien cambia la pantalla: si se tocan pantallas del
# panel y no apps/admin/app/manual/contenido.ts, avisa (no frena).
CAMBIADOS=$(git diff --name-only origin/main HEAD)
if echo "$CAMBIADOS" | grep -qE '^apps/admin/app/(ui/.*\.tsx|.*/page\.tsx)$' \
  && ! echo "$CAMBIADOS" | grep -q '^apps/admin/app/manual/contenido.ts$'; then
  echo "AVISO MANUAL: cambiaron pantallas del panel y no el manual (apps/admin/app/manual/contenido.ts)."
  echo "  Si cambió cómo se usa algo, sumalo al manual en el próximo commit."
fi
# EL REPASO DE FACTURAS (11/11/2026): si cambió la carga de facturas, antes de
# publicar se vuelven a pasar las facturas ya registradas por este código
# (apps/api/scripts/repasar-fichas.ts: solo lee, sin IA, unos segundos). Frena
# si la memoria del artículo deja MAL un renglón que venía bien. Si no se puede
# correr (copia sin .env o sin dependencias), avisa y sigue.
if echo "$CAMBIADOS" | grep -qE '^apps/(api/src/(compras|listas)/|api/scripts/repasar-fichas|admin/app/lib/|admin/app/ui/(ComprasWorkspace|TablaFactura|AsistenteFactura))'; then
  RAIZ=$(pwd)
  ENV_REPASO="$RAIZ/apps/api/.env"; [ -f "$ENV_REPASO" ] || ENV_REPASO="$HOME/Projects/odb/apps/api/.env"
  NM_REPASO="$RAIZ/apps/api/node_modules"; [ -d "$NM_REPASO" ] || NM_REPASO="$HOME/Projects/odb/apps/api/node_modules"
  if [ -f "$ENV_REPASO" ] && [ -x "$NM_REPASO/.bin/ts-node" ]; then
    echo "Repasando las facturas registradas contra este código…"
    SALIDA_REPASO="${TMPDIR:-/tmp}/odb-repaso-facturas.log"
    set +e
    (cd "$RAIZ/apps/api" && NODE_PATH="$NM_REPASO" "$NM_REPASO/.bin/ts-node" --transpile-only --skip-project \
      --compiler-options '{"module":"commonjs","target":"es2021","esModuleInterop":true}' \
      scripts/repasar-fichas.ts "$ENV_REPASO") > "$SALIDA_REPASO" 2>&1
    REPASO=$?
    set -e
    grep -E "facturas registradas|entrarían solos|la ficha dejaría mal|LO DEJÓ MAL" "$SALIDA_REPASO" || true
    if [ "$REPASO" -eq 1 ]; then
      echo "CANDADO: con este código la memoria del artículo deja mal renglones que venían bien. No se publica."
      grep -E "^  ! " "$SALIDA_REPASO" || true
      echo "  (el repaso completo quedó en $SALIDA_REPASO)"
      exit 1
    fi
    [ "$REPASO" -eq 0 ] || echo "AVISO: el repaso de facturas no se pudo correr (salida $REPASO): mirá $SALIDA_REPASO. La publicación sigue."
  else
    echo "AVISO: no se repasaron las facturas registradas (falta apps/api/.env o las dependencias de la API)."
  fi
fi
echo "Publicando$SERVICIOS desde $COMMIT en el servidor propio: $MENSAJE"
# manda el código (git archive del commit), compila con docker compose y levanta
sh infra/servidor/publicar.sh $SERVICIOS
# lo publicado pasa a ser main
git push origin HEAD:main
echo "Publicado$SERVICIOS desde $COMMIT y main quedó en $COMMIT."
# lo publicado entra solo al módulo Mantenimiento (9/11/2026); si falla, la publicación igual quedó
node scripts/mantenimiento-sync.mjs || echo "AVISO: no se cargó el trabajo en Mantenimiento (correr: node scripts/mantenimiento-sync.mjs)"
echo "Verificá en https://sistema.odbpremiummarket.com.ar (panel) y https://api.odbpremiummarket.com.ar (API)."
