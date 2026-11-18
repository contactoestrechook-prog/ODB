#!/bin/sh
# LA CUENTA DE LA FACTURA, COPIADA A LA API (18/11/2026).
#
# El original es apps/admin/app/lib/tabla-factura.ts (la pantalla). La API se
# construye con otro contexto de Docker y no puede importarlo, así que viaja una
# copia: con ella el chat de la factura prueba cada cambio con la MISMA cuenta
# que la pantalla antes de contestar.
#
#   scripts/copiar-cuenta-factura.sh              copia el original a la API
#   scripts/copiar-cuenta-factura.sh --comprobar  sale con 1 si las dos no son iguales
set -e
RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
ORIGEN="$RAIZ/apps/admin/app/lib/tabla-factura.ts"
DESTINO="$RAIZ/apps/api/src/compras/panel/tabla-factura.ts"
armar() {
  printf '%s\n' \
    '// ============================================================' \
    '// COPIA. NO EDITAR ACÁ. El original es apps/admin/app/lib/tabla-factura.ts;' \
    '// después de tocarlo se corre scripts/copiar-cuenta-factura.sh. Un test' \
    '// (cuenta-factura-copia.spec.ts) y el candado de scripts/publicar.sh frenan' \
    '// si esta copia y el original no son iguales.' \
    '// ============================================================'
  cat "$ORIGEN"
}
if [ "$1" = "--comprobar" ]; then
  [ -f "$DESTINO" ] || { echo "Falta la copia de la cuenta de la factura en la API: corré scripts/copiar-cuenta-factura.sh"; exit 1; }
  armar | cmp -s - "$DESTINO" || { echo "La cuenta de la factura de la pantalla y su copia en la API NO son iguales: corré scripts/copiar-cuenta-factura.sh"; exit 1; }
  exit 0
fi
mkdir -p "$(dirname "$DESTINO")"
armar > "$DESTINO"
echo "Copiada la cuenta de la factura a ${DESTINO#$RAIZ/}"
