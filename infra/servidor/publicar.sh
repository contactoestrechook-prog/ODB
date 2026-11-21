#!/bin/sh
# Publica ODB en el servidor propio desde una copia LIMPIA que contiene origin/main
# (misma regla que scripts/publicar.sh): manda el código, compila y levanta.
# Uso: infra/servidor/publicar.sh [servicios…]   (sin servicios: todos)
set -e
SERVIDOR="${SERVIDOR:-root@172.233.20.11}"
LLAVE="${LLAVE:-$HOME/.ssh/odb_produccion}"
cd "$(git rev-parse --show-toplevel)"
git fetch -q origin main
git merge-base --is-ancestor origin/main HEAD || { echo "CANDADO: esta copia no tiene todo origin/main"; exit 1; }
[ -z "$(git status --porcelain | grep -v 'node_modules$')" ] || { echo "CANDADO: hay cambios sin commitear"; exit 1; }
VERSION=$(git rev-parse --short HEAD)
# CANDADO DE LA ALARMA DE LOS PEDIDOS (Leandro, 21/11/2026: «todos los pop-ups de ODB de
# pedido hagan un ruido escandaloso en todas las máquinas, sin excepción, con candado»).
# Antes de mandar nada, las pruebas de la regla: si alguien bajó la alarma, le puso una
# excepción o sumó un aviso de pedido que no suena, no se publica. Sin dependencias en
# esta copia no se puede comprobar: tampoco se publica (enlazá apps/api/node_modules).
[ -d apps/api/node_modules ] || { echo "CANDADO: falta apps/api/node_modules en esta copia: no puedo correr el candado de la alarma (enlazalo desde ~/Projects/odb/apps/api/node_modules)"; exit 1; }
echo "Candado de la alarma de los pedidos…"
( cd apps/api && npx jest src/pedidos/alarma-escandalosa.spec.ts --silent ) >/tmp/candado-alarma-$$.log 2>&1 || { cat /tmp/candado-alarma-$$.log | tail -40; echo "CANDADO: la alarma de los pedidos no cumple la regla del 21/11/2026. No se publica."; exit 1; }
echo "Candado de la alarma: ok."
# ServerAliveInterval: la compilación tarda minutos sin escribir nada y la red de la
# Mac a veces se corta (21/10/2026 se colgó el primer envío)
ssh_() { ssh -i "$LLAVE" -o IdentitiesOnly=yes -o BatchMode=yes -o ServerAliveInterval=15 -o ServerAliveCountMax=8 "$SERVIDOR" "$@"; }
echo "Mandando el código $VERSION…"
# solo lo que se compila en el servidor (14 MB en vez de 26)
git archive --format=tar HEAD apps/api apps/admin apps/web infra | ssh_ "rm -rf /srv/odb/codigo.nuevo && mkdir -p /srv/odb/codigo.nuevo && tar -x -C /srv/odb/codigo.nuevo"
ssh_ "set -e; cd /srv/odb
  rm -rf codigo.anterior; [ -d codigo ] && mv codigo codigo.anterior; mv codigo.nuevo codigo
  cp codigo/infra/servidor/docker-compose.yml codigo/infra/servidor/Caddyfile .
  [ -f hosts.env ] || cp codigo/infra/servidor/hosts.env.ejemplo hosts.env
  export VERSION=$VERSION
  docker compose --env-file hosts.env build $*
  # EL EXAMEN DEL CHAT DE LA FACTURA (18/11/2026, Leandro: «Sí, que frene»). Si
  # cambió algo del chat (lo decide scripts/publicar.sh), la imagen recién
  # compilada rinde el examen ANTES de levantarse: las charlas reales, con la IA
  # de verdad y sin escribir nada (apps/api/src/compras/examen). Si no aprueba,
  # no se levanta: sigue corriendo la versión anterior y el código del servidor
  # vuelve al de antes. El resultado de cada examen queda en /srv/odb/examen-chat.log.
  if [ '${EXAMEN_CHAT:-no}' = si ]; then
    echo 'Tomando el examen del chat de la factura a la versión nueva (todavía sin levantar)…'
    docker compose --env-file hosts.env run --rm --no-deps -T api node dist/compras/examen/examen-chat.js > /tmp/examen-chat.log 2>&1 && APROBO=si || APROBO=no
    grep -v 'Nest\]' /tmp/examen-chat.log || true
    { echo; date '+%d/%m/%Y %H:%M'; grep -v 'Nest\]' /tmp/examen-chat.log; } >> /srv/odb/examen-chat.log
    if [ \"\$APROBO\" != si ]; then
      echo 'CANDADO: la versión nueva NO aprobó el examen del chat. No se levantó: sigue corriendo la anterior.'
      # el código del servidor vuelve al de la versión que sigue corriendo (si algo de esto falla, igual se frena)
      rm -rf codigo.rechazado; mv codigo codigo.rechazado || true; [ -d codigo.anterior ] && mv codigo.anterior codigo || true
      [ -d codigo ] && cp codigo/infra/servidor/docker-compose.yml codigo/infra/servidor/Caddyfile . 2>/dev/null || true
      exit 1
    fi
  fi
  docker compose --env-file hosts.env up -d --remove-orphans $*
  echo $VERSION > VERSION
  # cada publicación deja una imagen de ~1 GB por servicio: el 13/11/2026 había
  # 215 y el disco llegó al 100 % (la compilación falló). Quedan las que están en
  # uso y las de los últimos 3 días, para volver atrás.
  docker image prune -a -f --filter until=72h >/dev/null
  docker builder prune -f --filter until=72h >/dev/null
  df -h / | tail -1
  docker compose --env-file hosts.env ps --format 'table {{.Service}}\t{{.Status}}'"
echo "Publicado $VERSION en el servidor propio."
