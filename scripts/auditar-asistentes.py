#!/usr/bin/env python3
"""Audita los asistentes conversando con ellos, no mirando la pantalla.

La auditoría del 9/9/2026 recorrió las 55 rutas del panel, la web y la app
buscando errores de consola, pedidos fallidos y textos rotos. No encontró que el
analista de compras repetía el mismo mensaje para siempre, porque para verlo hay
que HABLARLE: la pantalla estaba perfecta, la conversación no llevaba a ningún
lado.

Corre conversaciones armadas contra el analista y verifica lo que un asistente
no puede hacer nunca:

  1. repetir un mensaje que ya dijo (deja al usuario sin salida);
  2. volver a preguntar un dato que el usuario ya contestó;
  3. contestar sin números cuando el usuario le dio todo y le dijo que avance;
  4. quedarse sin contestar;
  5. tardar más de dos minutos en un turno (el comprador está con el proveedor);
  6. contestar "no alcancé / no llegué / no tengo ningún costo": eso es no contestar.

La tercera corrida del 10/9 dio "TODO BIEN" y no lo estaba: en la lista larga,
dos turnos de casi tres minutos devolvieron "no alcancé a calcular nada" y solo
el tercero mostró números. Se miraba solo el último turno. Ahora se mira cada uno.

Uso:  ODB_DEPLOY_TOKEN=... python3 scripts/auditar-asistentes.py
      (opcional ODB_API_URL; por defecto, producción)
"""
import json
import os
import re
import sys
import time
import unicodedata
import urllib.request
import base64

API = os.environ.get('ODB_API_URL', 'https://odb-api-production.up.railway.app')
TOKEN = os.environ.get('ODB_DEPLOY_TOKEN', '')


def normalizar(t):
    t = unicodedata.normalize('NFD', t or '').lower()
    t = ''.join(c for c in t if not unicodedata.combining(c))
    return re.sub(r'[^a-z0-9]+', ' ', t).strip()


def charlar(mensajes, timeout=290):
    pedido = urllib.request.Request(
        API + '/compras/mesa/charla', method='POST',
        headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + TOKEN},
        data=json.dumps({'mensajes': mensajes}).encode())
    t0 = time.time()
    with urllib.request.urlopen(pedido, timeout=timeout) as r:
        return json.loads(r.read()), time.time() - t0


def planilla_mosquita(renglones=80):
    """Una planilla como la que adjuntó Leandro (Mosquita Ago-26): producto,
    presentación y costo. CSV para no depender de nada; el analista lee igual
    Excel y CSV."""
    varietales = ['Malbec', 'Blend', 'Rosé', 'Cabernet', 'Extra Brut', 'Torrontés', 'Syrah', 'Pinot Noir']
    lineas = ['Producto;Presentacion;Costo']
    for i in range(renglones):
        v = varietales[i % len(varietales)]
        lineas.append(f'Mosquita Muerta {v} linea {i // len(varietales) + 1};caja x6;{52000 + (i * 713) % 19000}')
    return base64.b64encode('\n'.join(lineas).encode('utf-8')).decode()


# Cada caso: los turnos del comprador, y qué tiene que pasar al final.
# Un turno es un texto, o (texto, adjunto) con el adjunto en base64.
CASOS = [
    {
        'nombre': 'Le contesta todo y le dice que avance',
        'turnos': [
            'Mosquita Muerta, lista de agosto. Tres renglones, precio de bulto sin IVA: '
            'Malbec caja x6 a 63.000, La Mosca Blend caja x6 a 58.000, Sapo de Otro Pozo '
            'Extra Brut caja x6 a 71.000. Compramos 10 bultos de cada uno. Hay 29% de '
            'impuestos internos y 10% de descuento.',
            'el 29% va como costo. NO hay costo de flete ni plazo. preparame la propuesta, dale',
        ],
        'pide_numeros': True,
        'no_repreguntar': ['flete', 'plazo', 'percepcion'],
    },
    {
        'nombre': 'Le pide una lista larga y después le dice con cuántos arranca',
        # El caso real: planilla adjunta de 80 renglones con la fórmula dictada.
        'turnos': [
            ('a la columna costo hay q dividirla por 1.21 y hacerla por 1.24. Al resultado hacerle un 10% de descuento',
             {'imagenBase64': planilla_mosquita(80), 'mimeType': 'text/csv', 'nombreArchivo': 'Mosquita Ago-26.csv'}),
            'los primeros 30 dale',
            'dale, seguí con los que siguen',
        ],
        'pide_numeros': True,
        'no_repreguntar': [],
    },
    {
        'nombre': 'Insiste tres veces con lo mismo',
        'turnos': ['dale', 'dale', 'dale'],
        'pide_numeros': False,
        'no_repreguntar': [],
    },
]



# ─── Asistente de compras de la tienda (/asistente/charla, público) ───
# Además de lo de arriba, tiene que mostrar productos reales: una respuesta que
# solo pregunta y no muestra nada es no ayudar a comprar.
def charlar_tienda(mensajes, timeout=120):
    pedido = urllib.request.Request(
        API + '/asistente/charla', method='POST',
        headers={'Content-Type': 'application/json'},
        data=json.dumps({'mensajes': mensajes}).encode())
    t0 = time.time()
    with urllib.request.urlopen(pedido, timeout=timeout) as r:
        return json.loads(r.read()), time.time() - t0


CASOS_TIENDA = [
    {'nombre': 'Tienda: una picada para 6', 'turnos': ['una picada para 6 personas'], 'pide_productos': True},
    {'nombre': 'Tienda: refina lo anterior', 'turnos': ['un malbec para regalar', 'más barato, hasta 10000'], 'pide_productos': True},
    {'nombre': 'Tienda: insiste con lo mismo', 'turnos': ['dale', 'dale', 'dale'], 'pide_productos': False},
]


def correr_tienda():
    fallas = 0
    for caso in CASOS_TIENDA:
        print(f"\n=== {caso['nombre']}")
        mensajes, dichas = [], []
        for i, texto in enumerate(caso['turnos']):
            mensajes.append({'rol': 'usuario', 'texto': texto})
            try:
                d, seg = charlar_tienda(mensajes)
            except urllib.error.HTTPError as e:
                print(f'  turno {i+1}: NO CONTESTÓ (HTTP {e.code}: {e.read().decode("utf-8","replace")[:160]})'); fallas += 1; break
            except Exception as e:
                print(f'  turno {i+1}: NO CONTESTÓ ({repr(e)[:80]})'); fallas += 1; break
            msj = (d.get('mensaje') or '').strip()
            grupos = d.get('grupos') or []
            n = sum(len(g.get('items') or []) for g in grupos)
            mensajes.append({'rol': 'asistente', 'texto': msj})
            TRANSCRIPCION.append(f"### {caso['nombre']} · turno {i+1} ({seg:.0f}s)\n> {texto}\n\n{msj}\n" + ''.join(f"- {g.get('titulo')}: " + ', '.join(f"{it.get('nombre')} ${it.get('precio')}" for it in (g.get('items') or [])) + '\n' for g in grupos))
            print(f'  turno {i+1} ({seg:.0f}s): {len(grupos)} grupos, {n} productos · {msj[:90]}')
            if not msj: print('    ✗ contestó vacío'); fallas += 1
            if seg > 60: print(f'    ✗ tardó {seg:.0f} s: una compra guiada no puede hacer esperar tanto'); fallas += 1
            if normalizar(msj) in dichas: print('    ✗ REPITIÓ un mensaje'); fallas += 1
            dichas.append(normalizar(msj))
            if caso['pide_productos'] and n == 0: print('    ✗ no mostró ningún producto'); fallas += 1
            for g in grupos:
                for it in g.get('items') or []:
                    if not it.get('sku') or it.get('precio') is None: print(f"    ✗ producto sin sku o sin precio: {it.get('nombre')}"); fallas += 1
    return fallas

TRANSCRIPCION = []


def correr():
    fallas = correr_tienda()
    if not TOKEN:
        print('\n(sin ODB_DEPLOY_TOKEN: no se audita el analista de compras, solo la tienda)')
        CASOS_ANALISTA = []
    else:
        CASOS_ANALISTA = CASOS
    for caso in CASOS_ANALISTA:
        print(f"\n=== {caso['nombre']}")
        mensajes, dichas = [], []
        for i, turno in enumerate(caso['turnos']):
            texto, adjunto = (turno if isinstance(turno, tuple) else (turno, None))
            mensajes.append({'rol': 'usuario', 'texto': texto, **(adjunto or {})})
            try:
                d, seg = charlar(mensajes)
            except urllib.error.HTTPError as e:
                cuerpo = e.read().decode('utf-8', 'replace')[:200]
                print(f'  turno {i+1}: NO CONTESTÓ (HTTP {e.code}: {cuerpo})')
                fallas += 1
                break
            except Exception as e:
                print(f'  turno {i+1}: NO CONTESTÓ ({repr(e)[:80]})')
                fallas += 1
                break
            respuesta = (d.get('respuesta') or '').strip()
            mensajes.append({'rol': 'analista', 'texto': respuesta})
            TRANSCRIPCION.append(f"### {caso['nombre']} · turno {i+1} ({seg:.0f}s)\n> {texto}\n\n{respuesta}\n")
            print(f'  turno {i+1} ({seg:.0f}s): {respuesta[:110]}…')

            if not respuesta:
                print('    ✗ contestó vacío')
                fallas += 1
            if seg > 120:
                print(f'    ✗ tardó {seg:.0f} s: más de dos minutos para un turno')
                fallas += 1
            if re.search(r'no (alcanc|llegu)|ningun costo (calculado|cerrado)|no tengo (todavia )?ningun costo', normalizar(respuesta)):
                print('    ✗ contestó que no calculó nada: eso es no contestar')
                fallas += 1
            if normalizar(respuesta) in dichas:
                print('    ✗ REPITIÓ un mensaje que ya había dicho')
                fallas += 1
            dichas.append(normalizar(respuesta))

            # Desde que el comprador le pasó precios, cada turno tiene que traer
            # números, no solo el último.
            if caso['pide_numeros'] and not re.search(r'\d[\d.]{3,}', respuesta):
                print('    ✗ ya tenía precios y no mostró ni un número')
                fallas += 1

            if i == len(caso['turnos']) - 1:
                preguntas = [f for f in re.split(r'(?<=[?.!\n])', respuesta) if f.strip().endswith('?')]
                for dato in caso['no_repreguntar']:
                    if any(normalizar(dato) in normalizar(f) for f in preguntas):
                        print(f'    ✗ vuelve a preguntar por "{dato}", que ya le contestaron')
                        fallas += 1

    destino = os.environ.get('AUDITORIA_TRANSCRIPCION')
    if destino:
        with open(destino, 'w', encoding='utf-8') as f:
            f.write('\n'.join(TRANSCRIPCION))
        print(f'\ntranscripción completa en {destino}')
    print(f"\n{'TODO BIEN' if not fallas else str(fallas) + ' PROBLEMAS'}")
    return 1 if fallas else 0


if __name__ == '__main__':
    sys.exit(correr())
