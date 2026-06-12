# Cómo desplegar ODB

El sistema tiene 3 piezas + la base de datos (que ya está en la nube, no hay que desplegarla):

| Pieza | Carpeta | Qué es | Puerto |
|---|---|---|---|
| API | `apps/api` | NestJS — toda la lógica | 3001 |
| Admin | `apps/admin` | Next.js — panel interno | 3000 |
| App clientes | `apps/mobile` | Expo / React Native | — |
| Base de datos | — | Supabase (proyecto `utemmsmuwocerhmuxrbs`, ya operativo) | — |

## Requisitos del servidor

- Node.js 20 o superior (`node -v`)
- Salida a internet hacia `*.supabase.co` y `api.anthropic.com`

## 1. API

```bash
cd apps/api
npm install
npm run build
node dist/main.js          # producción: usar pm2 o systemd (ver abajo)
```

**Variables de entorno**: el archivo `apps/api/.env` debe existir con
`SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_SERVICE_KEY`, `JWT_SECRET` y
`ANTHROPIC_API_KEY` (Somelier, Analista, lector de listas e informe diario).
⚠️ Ese archivo tiene claves reales: no lo subas a ningún repositorio ni lo
compartas. En el zip de deploy ya viene incluido.

El informe diario se genera solo a las 7:00 (hora argentina) mientras la API
esté corriendo.

## 2. Admin

```bash
cd apps/admin
npm install
npm run build
API_URL=http://localhost:3001 npm start
```

Si la API corre en otra máquina, apuntá `API_URL` a esa dirección. El admin
escucha en el puerto 3000 — ponelo detrás de un proxy con HTTPS (Caddy o
nginx) si va a ser accesible desde afuera del local.

## 3. App de clientes (Expo)

```bash
cd apps/mobile
npm install
npx expo start          # desarrollo
```

Antes de publicarla, cambiá la constante `API` en `src/lib/estado.tsx` por la
URL pública de la API (hoy apunta a localhost). Para generar los binarios de
las tiendas se usa `eas build` (requiere cuenta gratuita en expo.dev).

## Mantener los procesos vivos (pm2)

```bash
npm install -g pm2
pm2 start "node dist/main.js" --name odb-api   --cwd apps/api
pm2 start "npm start"         --name odb-admin --cwd apps/admin
pm2 save && pm2 startup        # arranque automático al reiniciar el servidor
```

## Usuarios y permisos

Se administran desde el panel: **Usuarios** (último ítem del menú). Roles:
dueño, gerente, comprador, cajero, depósito. El PIN de firma y el límite de
aprobación habilitan a firmar órdenes de compra. Solo dueño/gerente entran a
esa pantalla, y lo que toca a un dueño lo maneja únicamente otro dueño.

## Pendientes externos para el 100 %

- Credenciales de Mercado Pago (pagos en la app y Comprá Fácil)
- Cuenta Didit (biometría / Comunidad ODB)
- Certificado ARCA del CUIT (facturación)
- Alta de partner en PedidosYa y Tienda Nube
- WhatsApp Business (envío del informe diario)
