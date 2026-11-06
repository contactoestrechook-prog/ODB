// AVISOS AL CELULAR (Web Push) — 6/11/2026
// Lo que se le muestra a la persona en el celular, armado a partir del aviso de la
// campanita (alertas_internas). Sin acceso a la base: se prueba solo.

export type Aviso = { titulo: string; cuerpo?: string; url?: string; tag?: string };

export type AlertaCampanita = {
  id: string;
  para_usuario: string | null;
  tipo: string;
  titulo: string | null;
  detalle: string | null;
  referencia: any;
};

// Sin cortar a la mitad y sin el emoji del principio («🔴 Proveedor…»).
export const corto = (s: unknown, n: number) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
};
export const sinEmoji = (s: unknown) => String(s ?? '').replace(/^[^\p{L}\p{N}¿¡$]+/u, '').trim();

// A qué pantalla lleva el aviso al tocarlo. Primero el enlace del propio aviso
// (el mismo que muestra la campanita); si no tiene, la pantalla donde se resuelve.
export function urlDe(tipo: string, referencia: any): string {
  const link = String(referencia?.link ?? '').trim();
  if (/^\/(?![/\\])/.test(link)) return link;
  if (tipo === 'pago') return '/clientes'; // Cobros a ingresar
  if (tipo === 'whatsapp_caido' || tipo === 'bot_caido') return '/responde'; // el estado de las líneas
  return '/inicio#avisos'; // abre la campanita
}

export const avisoDe = (a: AlertaCampanita): Aviso => ({
  titulo: corto(sinEmoji(a.titulo) || 'O.D.B', 70),
  cuerpo: corto(a.detalle, 180),
  url: urlDe(a.tipo, a.referencia),
  tag: `alerta-${a.id}`,
});

// Lo que llegó de noche, en uno solo por persona.
export function resumenDeNoche(lista: AlertaCampanita[]): Aviso {
  if (lista.length === 1) return avisoDe(lista[0]);
  const titulos = lista.slice(0, 3).map((a) => sinEmoji(a.titulo)).join(' · ');
  return {
    titulo: `Te llegaron ${lista.length} avisos a la noche`,
    cuerpo: corto(titulos + (lista.length > 3 ? ` y ${lista.length - 3} más` : ''), 180),
    url: '/inicio#avisos',
    tag: 'avisos-noche',
  };
}
