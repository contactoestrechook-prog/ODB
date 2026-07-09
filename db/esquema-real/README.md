# Esquema real de la base ODB

Dump del esquema **real** de la base de producción al **2026-07-01**.
Fuente de verdad: **Supabase, proyecto `utemmsmuwocerhmuxrbs`** (schema `public`).

> ⚠️ `db/schema.sql` es el **diseño original** y está **desactualizado**: tiene 40
> tablas contra las 74 reales. Faltan ahí, entre otras: cheques, comprobantes,
> cuenta_corriente, recibo_medios/recibo_imputaciones, numeradores, descuentos,
> eventos, repartos, referidos, puntos_movimientos, canjes, acreditaciones,
> agente_tareas, sync_runs, envases, difusiones, solicitudes, etc.
> Para consultar cómo es la base HOY, usar estos archivos.

## Contenido

| Archivo | Qué tiene | Cantidad |
|---|---|---|
| `01-tipos.sql` | Enums de `public` | 13 |
| `02-tablas.sql` | `CREATE TABLE` + PK/UNIQUE/CHECK, secuencia standalone y FKs al final | 74 tablas, 131 FKs |
| `03-indices.sql` | Índices (sin `*_pkey` ni los que crean las UNIQUE constraints) | 60 |
| `04-funciones.sql` | Funciones `sql`/`plpgsql` (sin funciones C de extensiones) | 59 |
| `05-triggers.sql` | Triggers no internos | 4 |
| `06-vistas.sql` | Vistas | 2 |

Los archivos están pensados para correrse en orden (01 → 06) sobre una base
vacía con las extensiones `pg_trgm`, `unaccent` y `pgcrypto` habilitadas.
Única dependencia cruzada: `productos.nombre_normalizado` es una columna
generada que usa `quitar_tildes()` (definida en `04-funciones.sql`); si se
recrea desde cero, crear esa función antes de `02-tablas.sql`.

## Cómo regenerarlo

Con acceso al MCP de Supabase (o `psql` contra la base), consultar los
catálogos de Postgres y volcar el resultado:

1. **Tipos**: `pg_type` + `pg_enum` (nspname = 'public').
2. **Tablas**: columnas desde `pg_attribute`/`pg_attrdef` (con `format_type`,
   identity y columnas generadas); constraints con
   `pg_get_constraintdef(oid)` desde `pg_constraint` (PK/UNIQUE/CHECK junto a
   cada tabla, FKs al final).
3. **Índices**: `select indexdef from pg_indexes where schemaname='public'`,
   excluyendo `*_pkey` y los únicos que ya crean las UNIQUE constraints.
4. **Funciones**: `pg_get_functiondef(p.oid)` para `pg_proc` con lenguaje
   `sql`/`plpgsql` en `public` (traerlas de a pocas con limit/offset para no
   truncar).
5. **Triggers**: `pg_get_triggerdef(oid)` de `pg_trigger` con `not tgisinternal`.
6. **Vistas**: `pg_get_viewdef(viewname::regclass, true)` de `pg_views`.

Alternativa rápida con CLI: `supabase db dump --project-ref utemmsmuwocerhmuxrbs --schema public`.
