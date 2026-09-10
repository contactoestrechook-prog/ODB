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


# Cada caso: los turnos del comprador, y qué tiene que pasar al final.
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
        'turnos': [
            'Tengo una lista de 80 vinos de Mosquita Muerta. A la columna costo hay que '
            'dividirla por 1.21 y multiplicarla por 1.24, y al resultado un 10% de descuento. '
            'Los primeros: Malbec x6 63.000, Blend x6 58.000, Rose x6 55.000, Cabernet x6 61.000, '
            'Extra Brut x6 71.000, Torrontes x6 52.000, Syrah x6 59.000, Pinot x6 67.000.',
            'los primeros 30 dale',
            'dale, arrancá',
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


def correr():
    if not TOKEN:
        print('Falta ODB_DEPLOY_TOKEN en el entorno', file=sys.stderr)
        return 2

    fallas = 0
    for caso in CASOS:
        print(f"\n=== {caso['nombre']}")
        mensajes, dichas = [], []
        for i, turno in enumerate(caso['turnos']):
            mensajes.append({'rol': 'usuario', 'texto': turno})
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
                for dato in caso['no_repreguntar']:
                    if normalizar(dato) in normalizar(respuesta) and '?' in respuesta:
                        print(f'    ✗ vuelve a preguntar por "{dato}", que ya le contestaron')
                        fallas += 1

    print(f"\n{'TODO BIEN' if not fallas else str(fallas) + ' PROBLEMAS'}")
    return 1 if fallas else 0


if __name__ == '__main__':
    sys.exit(correr())
