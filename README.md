# ODB — Outlet de Bebidas

Sistema integral de gestión y experiencia de cliente para ODB: control de stock multi-sucursal (2 sucursales), compras, POS con facturación ARCA, e-commerce vía Tienda Nube, pedidos por WhatsApp, pick-up con geolocalización y registro de clientes con validación biométrica (Didit/RENAPER).

## Estructura del proyecto

```
odb/
├── docs/
│   ├── ESPECIFICACION.md     # Especificación funcional completa (la biblia del proyecto)
│   └── ARQUITECTURA.md       # Stack, integraciones, decisiones técnicas
├── db/
│   └── schema.sql            # Esquema PostgreSQL completo
├── scripts/
│   └── importar-excel/       # Importador del Excel de 13.000 artículos
└── apps/
    ├── api/                  # Backend NestJS (a scaffoldear)
    ├── admin/                # Panel administrativo Next.js (a scaffoldear)
    ├── pos/                  # Caja offline-first (a scaffoldear)
    └── mobile/               # App cliente Expo/React Native (a scaffoldear)
```

## Hoja de ruta

| Fase | Alcance | Resultado |
|---|---|---|
| **1 — Núcleo** | Catálogo + stock 2 sucursales, POS con ARCA y Mercado Pago, proveedores y compras básicas, importación del Excel | El negocio opera con el sistema |
| **2 — Compras pro** | OC con aprobaciones y firmas, órdenes de pago, sugerencias de reposición, remitos por PDF (IA), estadísticas | El módulo administrativo "híper desarrollado" |
| **3 — Canal cliente** | Frontend de tienda sobre Tienda Nube, pick-up geolocalizado, WhatsApp Business | Venta online integrada |
| **4 — Diferenciales** | Biometría Didit, self-checkout, clasificación RFM de clientes, fidelización | Experiencia de cliente premium |

## Primeros pasos

1. Leer [docs/ESPECIFICACION.md](docs/ESPECIFICACION.md).
2. Crear el proyecto en Supabase y aplicar [db/schema.sql](db/schema.sql).
3. Copiar el Excel de artículos a `scripts/importar-excel/` y seguir su [README](scripts/importar-excel/README.md).
