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
ssh_() { ssh -i "$LLAVE" -o IdentitiesOnly=yes -o BatchMode=yes "$SERVIDOR" "$@"; }
echo "Mandando el código $VERSION…"
git archive --format=tar HEAD | ssh_ "rm -rf /srv/odb/codigo.nuevo && mkdir -p /srv/odb/codigo.nuevo && tar -x -C /srv/odb/codigo.nuevo"
ssh_ "set -e; cd /srv/odb
  rm -rf codigo.anterior; [ -d codigo ] && mv codigo codigo.anterior; mv codigo.nuevo codigo
  cp codigo/infra/servidor/docker-compose.yml codigo/infra/servidor/Caddyfile .
  [ -f hosts.env ] || cp codigo/infra/servidor/hosts.env.ejemplo hosts.env
  export VERSION=$VERSION
  docker compose --env-file hosts.env build $*
  docker compose --env-file hosts.env up -d --remove-orphans $*
  echo $VERSION > VERSION
  docker image prune -f >/dev/null
  docker compose --env-file hosts.env ps --format 'table {{.Service}}\t{{.Status}}'"
echo "Publicado $VERSION en el servidor propio."
