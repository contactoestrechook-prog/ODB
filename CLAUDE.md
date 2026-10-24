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
