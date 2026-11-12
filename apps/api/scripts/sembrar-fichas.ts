// SIEMBRA DE LAS FICHAS DE ARTÍCULO (11/11/2026).
//
// Arma proveedor_articulos desde todo lo ya registrado (compras_historial),
// factura por factura en orden de fecha, con el mismo código que usa la API al
// registrar. Se corre una vez, después de aplicar db/migracion-fichas-articulo.sql.
// Volver a correrlo arma la tabla de cero y deja lo mismo.
//
//   cd apps/api && npx ts-node --transpile-only scripts/sembrar-fichas.ts [ruta al .env]
import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { FichaArticuloService } from '../src/compras/ficha-articulo.service';

const rutaEnv = process.argv[2] ?? '.env';
const env = Object.fromEntries(readFileSync(rutaEnv, 'utf8').split('\n').map((l) => l.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map((m) => [m![1], m![2].replace(/^["']|["']$/g, '')]));
if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) { console.error('Faltan SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(2); }
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

new FichaArticuloService(db)
  .sembrar()
  .then((r) => { console.log(`Fichas sembradas: ${r.fichas} artículos de ${r.proveedores} proveedores, desde ${r.renglones} renglones registrados.`); process.exit(0); })
  .catch((e) => { console.error(e); process.exit(1); });
