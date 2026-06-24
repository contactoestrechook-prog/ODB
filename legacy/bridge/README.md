# Bridge legacy (MS Access) → Supabase

Agente que sincroniza el sistema viejo de ODB (`C:\service\climatizacion.mdb`) hacia la
base nueva (Supabase), **en un solo sentido** (legacy → Supabase). Así el equipo puede
seguir usando el sistema viejo mientras la capa nueva (web, app, panel) ve los mismos
datos actualizados.

Es el **módulo 2 del presupuesto** ("Sistema de stock inteligente · reemplazo del legacy
con sincronización en tiempo real vía API").

## Reglas de oro

- **Nunca abre ni escribe el `.mdb` vivo.** En cada corrida hace una **copia** y lee la
  copia (si se abriera el archivo de producción se podría trabar la caja o corromper la base).
- **Unidireccional.** El bridge solo lee de Access y escribe en Supabase. Jamás modifica Access.
- **Incremental.** Compara por hash contra `state.json` y manda a Supabase **solo lo que cambió**.

## Qué sincroniza

- **Productos**: nombre, rubro/categoría, costo, **precio de venta (lista Minorista)**,
  **stock (O.D.B Central)** y unidades por pack. Clave estable: `codigo_legacy`.
- **Clientes**: datos, condición IVA, **saldo de cuenta corriente**, reparto (día/zona/
  vendedor/barrio) y envases. Clave: `codigo_legacy`.

Cada corrida queda registrada en la tabla `sync_runs` (visible desde el panel).

## Instalación en la PC de ODB (Windows)

1. Instalar **Node.js 20 o 22** (https://nodejs.org).
2. Copiar esta carpeta `bridge/` a la PC, por ejemplo `C:\odb-bridge`.
3. Abrir una terminal en esa carpeta y correr:
   ```
   npm install
   ```
4. Configurar las variables de entorno (en la terminal, o con un `.env`/Task Scheduler):
   ```
   set SUPABASE_URL=https://utemmsmuwocerhmuxrbs.supabase.co
   set SUPABASE_SERVICE_KEY=<la service key del proyecto>   (NO compartir/commitear)
   set MDB_PATH=C:\service\climatizacion.mdb
   set SYNC_INTERVAL_MIN=10
   ```
5. **Probar una corrida**:
   ```
   node sync.mjs --once
   ```
   Debería decir cuántos productos/clientes leyó y cuántos actualizó.
6. **Dejarlo corriendo** (sincroniza cada `SYNC_INTERVAL_MIN` minutos):
   ```
   node sync.mjs
   ```

### Que arranque solo (recomendado)

Usar el **Programador de tareas de Windows**: crear una tarea que ejecute
`node C:\odb-bridge\sync.mjs --once` cada 10 minutos (o `node sync.mjs` al iniciar sesión
para que quede continuo). Alternativa robusta: instalarlo como servicio con
[NSSM](https://nssm.cc/).

## Variables

| Variable | Default | Qué es |
|---|---|---|
| `SUPABASE_URL` | — | URL del proyecto Supabase |
| `SUPABASE_SERVICE_KEY` | — | service key (bypassa RLS; **secreta**) |
| `MDB_PATH` | `../climatizacion_copia.mdb` | ruta al `.mdb` vivo (en ODB: `C:\service\climatizacion.mdb`) |
| `SYNC_INTERVAL_MIN` | `10` | minutos entre corridas |
| `STATE_FILE` | `./state.json` | cache de hashes para el sync incremental |
| `--once` | — | corre una sola vez y termina (ideal para Task Scheduler) |

## Pruebas

```
node --test      # tests de la lógica pura de mapeo/diff (map.test.mjs)
```

## Pendiente

- Los **otros `.mdb`** de `C:\service\` (códigos de barra EAN de fábrica) cuando se copien:
  hoy el bridge sincroniza desde `climatizacion.mdb` (el código interno de ODB ya viaja como
  `codigo_legacy`). Sumar el mapa EAN→producto cuando esté disponible.
- Fase 2 fiscal (AFIP WSAA/WSFE) — fuera del bridge.
