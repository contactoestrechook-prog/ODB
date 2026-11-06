// Las claves VAPID de los avisos al celular (6/11/2026): las genera y las guarda en
// el Vault de Supabase (celular_guardar_claves, db/migracion-avisos-celular.sql).
// No las muestra. Si ya hay claves, no las toca (cambiarlas deja sin avisos a todos
// los aparatos hasta que los vuelvan a activar): para eso, --rotar.
//
//   node --env-file=apps/api/.env scripts/avisos-claves.mjs [--rotar]
// (usa SUPABASE_URL y SUPABASE_SERVICE_KEY, las mismas de la API)
import { generateKeyPairSync } from 'node:crypto';

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
if (!URL || !KEY) { console.error('Faltan SUPABASE_URL y SUPABASE_SERVICE_KEY'); process.exit(2); }
const rpc = async (fn, body) => {
  const r = await fetch(`${URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const t = await r.text();
  if (!r.ok) throw new Error(`${fn}: ${r.status} ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
};

const ya = await rpc('celular_claves', {});
const hay = (Array.isArray(ya) ? ya[0] : ya)?.publica;
if (hay && !process.argv.includes('--rotar')) { console.log('Ya hay claves de avisos en el Vault: no se tocan.'); process.exit(0); }

// P-256: la pública va «sin comprimir» (0x04 + x + y) y la privada es d, las dos en base64url
const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const pub = publicKey.export({ format: 'jwk' }), priv = privateKey.export({ format: 'jwk' });
const b64 = (s) => Buffer.from(s, 'base64url');
const publica = Buffer.concat([Buffer.from([4]), b64(pub.x), b64(pub.y)]).toString('base64url');
await rpc('celular_guardar_claves', { p_publica: publica, p_privada: priv.d });
console.log(`Claves de avisos guardadas en el Vault${hay ? ' (rotadas: hay que volver a activar los avisos en cada aparato)' : ''}.`);
