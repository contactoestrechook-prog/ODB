import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { SECCIONES } from '../../manual/contenido';
import { GRUPOS, TITULOS } from '../../ui/Header';
import { apiFetch } from '../../../lib/api';

// El pase para hablar con MetoGroup (26/11/2026). La pantalla Mantenimiento lo pide
// al abrir y cada vez que el módulo avisa que se venció. Viaja con el manual TAL
// COMO ESTÁ PUBLICADO (temas y pantallas del menú): la API lo deja en la base para
// que el agente de MetoGroup lo lea antes de decir que algo no existe.

function manualPublicado() {
  const secciones = SECCIONES.map((s) => ({
    seccion: s.id,
    titulo: s.titulo,
    area: s.area,
    pantallas: s.pantallas,
    texto: [s.bajada, ...s.bloques.map((b) =>
      b.tipo === 'texto' ? b.texto
        : b.tipo === 'pasos' ? `${b.titulo ? `${b.titulo}:\n` : ''}${b.pasos.map((p, i) => `${i + 1}. ${p}`).join('\n')}`
        : b.tipo === 'ojo' ? `${b.titulo ?? 'Tener en cuenta'}:\n${b.puntos.map((p) => `- ${p}`).join('\n')}`
        : `${b.titulo ? `${b.titulo}:\n` : ''}${b.filas.map(([k, v]) => `- ${k}: ${v}`).join('\n')}`)].join('\n'),
  }));
  const pantallas = GRUPOS.flatMap((g) => g.items.map((i) => ({
    href: i.href,
    nombre: i.nombre ?? i.label,
    grupo: [g.titulo, i.familia].filter(Boolean).join(' › '),
    bajada: TITULOS[i.href]?.bajada ?? TITULOS[i.href.split('?')[0]]?.bajada ?? '',
  })));
  const version = createHash('sha256').update(JSON.stringify({ secciones, pantallas })).digest('hex').slice(0, 16);
  return { version, secciones, pantallas };
}

export async function POST() {
  const res = await apiFetch('/mantenimiento/metogroup/pase', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ manual: manualPublicado() }),
  }).catch(() => null);
  if (!res) return NextResponse.json({ message: 'La API no respondió' }, { status: 502 });
  const datos = await res.json().catch(() => ({ message: 'La API no respondió' }));
  return NextResponse.json(datos, { status: res.status });
}
