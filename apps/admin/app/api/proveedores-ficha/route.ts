import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

// Ficha de proveedores (27/10/2026): lista, ficha, contactos y documentos.
// Solo deja pasar estas acciones; la seguridad real está en el API (@Roles).
const API = process.env.API_URL ?? 'http://localhost:3001';
const BASE = '/proveedores-ficha';

async function token() {
  return (await cookies()).get('odb_token')?.value;
}

async function reenviar(ruta: string, init: RequestInit = {}) {
  const t = await token();
  const res = await fetch(`${API}${BASE}${ruta}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) },
    cache: 'no-store',
  });
  if (!res.ok) console.warn('[api/proveedores-ficha]', init.method ?? 'GET', ruta, '→', res.status);
  return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
}

const id = (v: unknown) => (typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v) ? v : null);

// GET            → la lista
// GET ?id=…      → la ficha
// GET ?documento=… → enlace para abrir el archivo
export async function GET(req: Request) {
  const u = new URL(req.url);
  const doc = id(u.searchParams.get('documento'));
  if (doc) return reenviar(`/documentos/${doc}/enlace`);
  const prov = id(u.searchParams.get('id'));
  if (prov) return reenviar(`/${prov}`);
  return reenviar('');
}

// POST multipart (archivo, proveedorId, tipo, nombre, vigenciaHasta) → sube un documento
// POST multipart (archivo, proveedorId, destino=logo) → sube el logo
// POST JSON { accion, … }:
//   crear | guardar {id, …campos} | activo {id, activo}
//   contacto {id, …} | editarContacto {contactoId, …} | borrarContacto {contactoId}
//   logoWeb {id} | sacarLogo {id} | borrarDocumento {documentoId}
export async function POST(req: Request) {
  if ((req.headers.get('content-type') ?? '').startsWith('multipart/form-data')) {
    const form = await req.formData();
    const prov = id(form.get('proveedorId'));
    const archivo = form.get('archivo');
    if (!prov || !archivo) return NextResponse.json({ message: 'Falta el archivo' }, { status: 400 });
    const fd = new FormData();
    fd.append('archivo', archivo as Blob);
    for (const k of ['tipo', 'nombre', 'vigenciaHasta']) {
      const v = form.get(k);
      if (typeof v === 'string' && v) fd.append(k, v);
    }
    const t = await token();
    // destino=logo: el logo de la marca; si no, un documento
    const destino = form.get('destino') === 'logo' ? 'logo' : 'documentos';
    const res = await fetch(`${API}${BASE}/${prov}/${destino}`, { method: 'POST', headers: t ? { Authorization: `Bearer ${t}` } : {}, body: fd });
    return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
  }

  const { accion, ...d } = await req.json().catch(() => ({}));
  const post = (ruta: string, body: unknown) => reenviar(ruta, { method: 'POST', body: JSON.stringify(body ?? {}) });
  switch (accion) {
    case 'crear':
      return post('', d);
    case 'guardar': {
      const p = id(d.id);
      if (!p) break;
      const { id: _id, ...campos } = d;
      return reenviar(`/${p}`, { method: 'PATCH', body: JSON.stringify(campos) });
    }
    case 'activo': {
      const p = id(d.id);
      if (!p) break;
      return post(`/${p}/activo`, { activo: d.activo === true });
    }
    case 'contacto': {
      const p = id(d.id);
      if (!p) break;
      const { id: _id, ...c } = d;
      return post(`/${p}/contactos`, c);
    }
    case 'editarContacto': {
      const c = id(d.contactoId);
      if (!c) break;
      const { contactoId: _c, ...resto } = d;
      return reenviar(`/contactos/${c}`, { method: 'PATCH', body: JSON.stringify(resto) });
    }
    case 'borrarContacto': {
      const c = id(d.contactoId);
      if (!c) break;
      return post(`/contactos/${c}/borrar`, {});
    }
    case 'logoWeb': {
      const p = id(d.id);
      if (!p) break;
      return post(`/${p}/logo/web`, {});
    }
    case 'sacarLogo': {
      const p = id(d.id);
      if (!p) break;
      return post(`/${p}/logo/sacar`, {});
    }
    case 'borrarDocumento': {
      const doc = id(d.documentoId);
      if (!doc) break;
      return post(`/documentos/${doc}/borrar`, {});
    }
  }
  return NextResponse.json({ message: 'Acción inválida' }, { status: 400 });
}
