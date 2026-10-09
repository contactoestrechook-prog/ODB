# ODB — reglas para trabajar en este proyecto

## Publicar a producción: UNA sola versión (9/10/2026)

Railway se queda con lo último que se sube. Si dos sesiones publican desde ramas
distintas, la segunda borra lo de la primera (pasó el 9/10: el panel salió de
una rama vieja y volvió la factura con el formato anterior).

- **`main` es producción.** Toda rama nueva sale de `origin/main` actualizado.
- **Antes de publicar:** `git merge origin/main` en tu rama, pruebas, commit.
- **Publicar SOLO con el candado:**
  `scripts/publicar.sh <copia de trabajo> <odb-api|odb-admin|odb-web> "<mensaje>"`
  Se niega si la copia no contiene todo `origin/main` o tiene cambios sin
  commitear. Después de publicar sube esa versión a `main`.
- Nunca `railway up` a mano contra odb-api, odb-admin u odb-web.
- Las ramas `release-1006` y `admin-multilinea` quedaron viejas: no publicar
  desde ellas.
