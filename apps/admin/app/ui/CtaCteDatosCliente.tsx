'use client';

import { Campo, Entrada } from './kit';

// Los datos de un cliente de cuenta corriente, en un solo formulario: lo usan
// la ficha (para corregirlos) y «Sumar cuenta» (para cargar uno nuevo).

export type DatosForm = { nombre: string; razonSocial: string; telefono: string; cuit: string; domicilio: string; email: string };
export const DATOS_VACIOS: DatosForm = { nombre: '', razonSocial: '', telefono: '', cuit: '', domicilio: '', email: '' };

/** Un celular argentino que sirve para WhatsApp: área + número, sin 0 ni 15 delante. Igual que la API. */
export function celularSirve(t: string): boolean {
  let d = t.replace(/\D/g, '');
  if (!d) return false;
  if (d.startsWith('549')) return d.length === 13;
  if (d.startsWith('54')) d = d.slice(2).replace(/^0/, '');
  else d = d.replace(/^0/, '');
  d = d.replace(/^(\d{2,4})15(\d{6,8})$/, '$1$2');
  return d.length === 10 && !d.startsWith('15');
}

export function CtaCteDatosCliente({ valor, onCambiar, deshabilitado }: { valor: DatosForm; onCambiar: (v: DatosForm) => void; deshabilitado?: boolean }) {
  const set = (k: keyof DatosForm) => (e: React.ChangeEvent<HTMLInputElement>) => onCambiar({ ...valor, [k]: e.target.value });
  const tel = valor.telefono.trim();
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Campo etiqueta="Nombre" obligatorio>
        <Entrada value={valor.nombre} onChange={set('nombre')} placeholder="Juan Pérez" disabled={deshabilitado} autoComplete="off" />
      </Campo>
      <Campo etiqueta="Razón social" ayuda="Si es una empresa: así lo saluda el resumen.">
        <Entrada value={valor.razonSocial} onChange={set('razonSocial')} placeholder="Distribuidora Sur SRL" disabled={deshabilitado} autoComplete="off" />
      </Campo>
      <Campo
        etiqueta="Celular"
        ayuda={tel ? 'Sirve para WhatsApp.' : 'Sin celular no recibe el resumen.'}
        error={tel && !celularSirve(tel) ? 'Así no le llega: código de área + número, sin el 15.' : undefined}
      >
        <Entrada value={valor.telefono} onChange={set('telefono')} placeholder="11 2345-6789" inputMode="tel" disabled={deshabilitado} />
      </Campo>
      <Campo etiqueta="CUIT">
        <Entrada value={valor.cuit} onChange={set('cuit')} placeholder="20-12345678-9" inputMode="numeric" disabled={deshabilitado} />
      </Campo>
      <Campo etiqueta="Domicilio">
        <Entrada value={valor.domicilio} onChange={set('domicilio')} placeholder="Calle 123, Canning" disabled={deshabilitado} />
      </Campo>
      <Campo etiqueta="Mail">
        <Entrada value={valor.email} onChange={set('email')} placeholder="nombre@mail.com" type="email" inputMode="email" disabled={deshabilitado} />
      </Campo>
    </div>
  );
}
