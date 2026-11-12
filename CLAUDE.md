# ODB — reglas para trabajar en este proyecto

## Producción es el SERVIDOR PROPIO, no Railway (24/10/2026)

ODB se mudó a un servidor propio. Lo que usa la gente es:

- panel: `https://sistema.odbpremiummarket.com.ar`
- API: `https://api.odbpremiummarket.com.ar`
- tienda: `https://www.odbpremiummarket.com.ar`

(`panel.odbpremiummarket.com.ar` es la página del proveedor de hosting, no el
sistema.) Railway quedó de la mudanza: publicar ahí no le llega a nadie. El
24/10 una sesión publicó en Railway con el script viejo y en el panel «no
actualizó nada».

## Publicar a producción: UNA sola versión (9/10/2026)

Si dos sesiones publican desde ramas distintas, la segunda borra lo de la
primera (pasó el 9/10: el panel salió de una rama vieja y volvió la factura con
el formato anterior).

- **`main` es producción.** Toda rama nueva sale de `origin/main` actualizado.
- **Antes de publicar:** `git merge origin/main` en tu rama, pruebas, commit.
- **Publicar SOLO con el candado:**
  `scripts/publicar.sh <copia de trabajo> <api|admin|web>… "<mensaje>"`
  (ej.: `scripts/publicar.sh ~/Projects/odb-mirama api admin "Cuentas corrientes"`).
  Se niega si la copia no contiene todo `origin/main` o tiene cambios sin
  commitear. Publica en el servidor propio con `infra/servidor/publicar.sh`
  (manda el commit, compila con docker compose y levanta) y después sube esa
  versión a `main`.
- La copia es la RAÍZ del repositorio, no `apps/api`.
- Para ver que salió: una ruta nueva en `https://sistema.odbpremiummarket.com.ar/api/…`
  responde 401 (existe, pide sesión) y una inventada, 404.
- Nunca `railway up` ni `docker compose` a mano contra producción.
- Las ramas `release-1006` y `admin-multilinea` quedaron viejas: no publicar
  desde ellas.

## El manual siempre al día (10/11/2026)

Leandro: «necesito que el manual de uso odb esté siempre actualizado, que sea
muy inteligente y si lo que están pidiendo no existe en el sistema que lo
digan, que tienen que hablar con MetoGroup».

- `/manual` tiene «Preguntale al manual» (`apps/api/src/manual`). Contesta con
  tres cosas: el manual escrito, el menú del panel tal como está publicado y lo
  que se publicó en los últimos 60 días (`mantenimiento_trabajos`). Si un
  cambio reciente contradice al manual, manda el cambio. Si lo que preguntan no
  está en ninguna de las tres, dice que no existe y que hay que hablar con
  MetoGroup. Con «Pedírselo a MetoGroup» queda en Reportes del equipo y avisa
  por la campanita y por WhatsApp, igual que «Esto está mal».
- «Lo nuevo en el sistema» se arma solo con lo publicado en los últimos 30 días.
- **Quien cambia cómo se usa una pantalla cambia el manual en el mismo commit**
  (`apps/admin/app/manual/contenido.ts`). Cada paso tiene que ser algo que la
  pantalla hace hoy. `scripts/publicar.sh` avisa si se tocaron pantallas y el
  manual no.
- Una pantalla nueva entra en el menú (`GRUPOS` y `TITULOS` de
  `apps/admin/app/ui/Header.tsx`) con su bajada: de ahí sabe el manual que existe.

## Mantenimiento: cada commit entra solo al módulo (9/11/2026)

El panel tiene «Administración › Mantenimiento» (`/mantenimiento`): lo que
hizo MetoGroup cada mes contra las 6 h de abono. Lo carga
`scripts/mantenimiento-sync.mjs`, que corre solo al final de
`scripts/publicar.sh` (también a mano: `node scripts/mantenimiento-sync.mjs`).
Lee los commits de `origin/main` (sin merges ni autoguardados), así que el
mensaje del commit ES el registro que ve el dueño:

- Formato: `Área: qué se hizo, en castellano para el dueño (Nombre, d/m/aaaa: «sus palabras»)`.
  Lo de antes de los dos puntos es el título; el paréntesis dice quién lo pidió,
  cuándo y con qué palabras.
- Si fue idea nuestra: `(Propuesta de MetoGroup, d/m/aaaa)` → tipo «propuesta».
- El tipo (bug, arreglo, mejora, nuevo) y el área salen de reglas sobre el
  mensaje; el tiempo, de las sesiones de commits de ese día (estimación).
- Lo que pasa de 6 h por mes (desde `MANTENIMIENTO_DESDE`, 2026-11) se cotiza solo:
  `mantenimiento_cotizaciones`, a `MANTENIMIENTO_PRECIO_HORA` y `MANTENIMIENTO_MONEDA`
  (en apps/api/.env de ~/Projects/odb; sin precio no se cotiza). Va a Aprobaciones
  y a la campanita; la firma el dueño. Una cotización previa a un trabajo grande
  se carga a mano con `automatica = false`.
- Tabla `mantenimiento_trabajos` (db/migracion-mantenimiento.sql). Para corregir
  un trabajo mal clasificado, se edita su fila.
