#!/bin/sh
# Pasa ODB al dominio de la empresa (odbpremiummarket.com.ar). Se corre desde la
# Mac cuando los registros A ya están cargados en DonWeb:
#   sistema / api / tienda / wa / n8n  →  172.233.20.11
# Qué hace: verifica el DNS, deja los dos juegos de direcciones (dominio y prueba),
# cambia las direcciones públicas que usa el sistema, recompila el panel, pide los
# candados HTTPS, mueve el aviso de WhatsApp al dominio y prueba todo.
set -eu
IP=172.233.20.11
DOM=odbpremiummarket.com.ar
SERVIDOR="${SERVIDOR:-root@$IP}"
LLAVE="${LLAVE:-$HOME/.ssh/odb_produccion}"
ssh_() { ssh -i "$LLAVE" -o IdentitiesOnly=yes -o BatchMode=yes -o ServerAliveInterval=15 "$SERVIDOR" "$@"; }

echo "== 1. DNS"
falta=0
for s in sistema api tienda wa n8n; do
  r=$(dig +short "$s.$DOM" @ns1.godns.net | tail -1); p=$(dig +short "$s.$DOM" | tail -1)
  printf "  %-30s DonWeb=%-15s público=%s\n" "$s.$DOM" "${r:-—}" "${p:-—}"
  [ "$r" = "$IP" ] || falta=1
done
[ $falta = 0 ] || { echo "Falta cargar o corregir registros en DonWeb (tienen que apuntar a $IP)."; exit 1; }

echo "== 2. direcciones del servidor"
cd "$(git rev-parse --show-toplevel)"
scp -q -i "$LLAVE" -o IdentitiesOnly=yes infra/servidor/hosts.env.dominio "$SERVIDOR:/srv/odb/hosts.env"
ssh_ "set -e; cd /srv/odb/secretos
  pon() { f=\$1; k=\$2; v=\$3; grep -q \"^\$k=\" \$f && sed -i \"s#^\$k=.*#\$k=\\\"\$v\\\"#\" \$f || echo \"\$k=\\\"\$v\\\"\" >> \$f; }
  pon api.env API_PUBLIC_URL https://api.$DOM
  pon api.env ADMIN_URL https://sistema.$DOM
  pon api.env ODB_PANEL_URL https://sistema.$DOM
  pon api.env WEB_PUBLIC_URL https://tienda.$DOM
  pon admin.env NEXT_PUBLIC_API_URL https://api.$DOM
  pon n8n.env N8N_HOST n8n.$DOM
  pon n8n.env WEBHOOK_URL https://n8n.$DOM/
  pon n8n.env N8N_EDITOR_BASE_URL https://n8n.$DOM/
  grep -E '^(API_PUBLIC_URL|ADMIN_URL|WEB_PUBLIC_URL)=' api.env"

echo "== 3. panel recompilado y servicios con las direcciones nuevas"
sh infra/servidor/publicar.sh api admin web proxy

echo "== 4. candados HTTPS (Caddy los pide solo; puede tardar un minuto)"
for s in sistema api tienda wa; do
  for i in $(seq 1 24); do
    c=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "https://$s.$DOM/" 2>/dev/null || true)
    [ -n "$c" ] && [ "$c" != 000 ] && break; sleep 5
  done
  printf "  https://%-28s %s\n" "$s.$DOM" "$c"
done

echo "== 5. aviso de WhatsApp al dominio"
ssh_ 'cd /srv/odb/secretos && python3 - <<"PY"
import json, urllib.request
env = {}
for l in open("api.env"):
    if "=" in l:
        k, v = l.rstrip("\n").split("=", 1); env[k] = v.strip("\"").replace("$$", "$")
W = env["WAHA_URL"].replace("http://waha:3000", "https://wa.odbpremiummarket.com.ar"); K = env["WAHA_API_KEY"]
def req(m, p, body=None):
    r = urllib.request.Request(W + p, method=m, data=json.dumps(body).encode() if body is not None else None,
        headers={"X-Api-Key": K, "Content-Type": "application/json"})
    return json.loads(urllib.request.urlopen(r, timeout=40).read() or b"null")
for s in req("GET", "/api/sessions"):
    cfg = s.get("config") or {}
    for w in cfg.get("webhooks") or []:
        if "/bot/waha" in w.get("url", ""):
            w["url"] = "https://api.odbpremiummarket.com.ar/bot/waha?" + w["url"].split("?", 1)[1]
    req("PUT", "/api/sessions/" + s["name"], {"name": s["name"], "config": cfg})
    print("  ", s["name"], "→", [w["url"] for w in cfg.get("webhooks") or []])
PY'

echo "== 6. prueba final"
curl -fsS --max-time 15 "https://api.$DOM/salud"; echo
echo "Listo. Falta afuera: Mercado Pago (las dos cuentas), Tiendanube y PedidosYa → https://api.$DOM"
