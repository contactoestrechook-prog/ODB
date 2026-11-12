import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { SECCIONES } from '../../manual/contenido';
import { GRUPOS, TITULOS } from '../../ui/Header';
import { puedeVer, recibeAvisosCelular, rolDesdeToken } from '../../lib/permisos';

const API = process.env.API_URL ?? 'http://localhost:3001';

// El manual que contesta (10/11/2026). La pregunta viaja a la API con el manual
// y el menú TAL COMO ESTÁN PUBLICADOS: si mañana se suma una pantalla o una
// sección, el asistente ya la conoce, sin copiar nada a mano. Lo publicado en
// los últimos días lo agrega la API (Mantenimiento).

function manualEnTexto(): string {
  return SECCIONES.map((s) => {
    const cuerpo = s.bloques.map((b) =>
      b.tipo === 'texto' ? b.texto
        : b.tipo === 'pasos' ? `${b.titulo ? `${b.titulo}:\n` : ''}${b.pasos.map((p, i) => `${i + 1}. ${p}`).join('\n')}`
        : b.tipo === 'ojo' ? `${b.titulo ?? 'Tener en cuenta'}:\n${b.puntos.map((p) => `- ${p}`).join('\n')}`
        : `${b.titulo ? `${b.titulo}:\n` : ''}${b.filas.map(([k, v]) => `- ${k}: ${v}`).join('\n')}`,
    ).join('\n');
    return `## [${s.id}] ${s.titulo} (área: ${s.area})\n${s.bajada}\n${cuerpo}`;
  }).join('\n\n');
}

function pantallasPara(rol: string | null) {
  const delMenu = GRUPOS.flatMap((g) => g.items.map((i) => {
    const ruta = i.href.split('?')[0];
    return {
      href: i.href,
      nombre: i.label,
      grupo: [g.titulo, i.sub].filter(Boolean).join(' › '),
      bajada: TITULOS[ruta]?.bajada ?? '',
      puede: puedeVer(rol, ruta) && (!i.soloRoles || i.soloRoles.includes(String(rol))),
    };
  }));
  // las de abajo del menú, las de cada persona (12/11/2026: «Avisos en el celular»)
  const delPie = [
    { href: '/manual', nombre: 'Manual del sistema', puede: true },
    { href: '/avisos', nombre: 'Avisos en el celular', puede: puedeVer(rol, '/avisos') && recibeAvisosCelular(rol) },
    { href: '/cambiar-clave', nombre: 'Cambiar mi contraseña', puede: true },
  ].map((p) => ({ ...p, grupo: 'Abajo del menú (tu cuenta)', bajada: TITULOS[p.href]?.bajada ?? '' }));
  return [...delMenu, ...delPie];
}

async function api(ruta: string, init: RequestInit = {}) {
  const token = (await cookies()).get('odb_token')?.value;
  const res = await fetch(`${API}${ruta}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    cache: 'no-store',
  });
  const datos = await res.json().catch(() => ({ message: 'La API no respondió' }));
  return NextResponse.json(datos, { status: res.status });
}

// Lo nuevo: lo que se publicó en los últimos 30 días
export async function GET() {
  return api('/manual/novedades');
}

// { accion: 'preguntar', pregunta, historial } | { accion: 'pedir', pregunta, respuesta }
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  if (b?.accion === 'pedir') {
    return api('/manual/pedir', { method: 'POST', body: JSON.stringify({ pregunta: b.pregunta, respuesta: b.respuesta }) });
  }
  if (b?.accion !== 'preguntar') return NextResponse.json({ message: 'Acción inválida' }, { status: 400 });
  const rol = rolDesdeToken((await cookies()).get('odb_token')?.value);
  return api('/manual/preguntar', {
    method: 'POST',
    body: JSON.stringify({
      pregunta: b.pregunta,
      historial: Array.isArray(b.historial) ? b.historial.slice(-4) : [],
      manual: manualEnTexto(),
      secciones: SECCIONES.map((s) => s.id),
      pantallas: pantallasPara(rol),
    }),
  });
}
