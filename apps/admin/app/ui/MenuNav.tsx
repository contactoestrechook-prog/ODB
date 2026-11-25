'use client';

import { useState } from 'react';
import Link from 'next/link';
import { InstalarApp } from './InstalarApp';

// El menú lateral. 24/10/2026: grupos que se abren y se cierran. 17/11/2026
// (Leandro: «está muy muy cargado, hay que reducirlo con criterio, y que haya
// sub menú»): adentro de cada grupo, lo que es de una misma familia va en un
// SUBMENÚ que se abre en el lugar (Stock › Stock, Inventario, Arqueo,
// Fraccionar). Se ve un grupo abierto por vez y un submenú abierto por vez: los
// de la pantalla en la que estás. Lo usan la barra de escritorio y el cajón del
// celular.

// label: cómo se lee adentro de su submenú («Todos»); nombre: cómo se llama
// suelta, fuera del menú (el manual dice «Abrir Base de clientes»)
// soloPermiso: entradas que ve solo quien tiene ese permiso propio (usuarios.permisos, 25/11/2026)
export type ItemMenu = { href: string; label: string; nombre?: string; icono: string; familia?: string; soloRoles?: string[]; soloPermiso?: string };
export type GrupoMenu = { titulo: string; icono: string; items: ItemMenu[] };

type Entrada = { tipo: 'enlace'; item: ItemMenu } | { tipo: 'familia'; titulo: string; items: ItemMenu[] };

/** Junta las pantallas seguidas de una misma familia. Una familia que (para
 *  este rol) quedó con una sola pantalla se muestra como entrada suelta. */
function entradasDe(items: ItemMenu[]): Entrada[] {
  const out: Entrada[] = [];
  for (const i of items) {
    const ult = out[out.length - 1];
    if (i.familia && ult?.tipo === 'familia' && ult.titulo === i.familia) ult.items.push(i);
    else if (i.familia) out.push({ tipo: 'familia', titulo: i.familia, items: [i] });
    else out.push({ tipo: 'enlace', item: i });
  }
  return out.map((e) => (e.tipo === 'familia' && e.items.length === 1 ? { tipo: 'enlace', item: e.items[0] } : e));
}

// Sobre el negro: texto white/70, rótulos e íconos apagados white/55 (6,2:1 de
// contraste, el mínimo que se lee); nada por debajo de eso.
function Icono({ d, activo = false }: { d: string; activo?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className={`size-[18px] shrink-0 ${activo ? 'text-white' : 'text-white/55 group-hover:text-white/80'}`}
      fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

function Flecha({ abierta, lado = false }: { abierta: boolean; lado?: boolean }) {
  // grupos: flecha hacia abajo; submenús: flecha al costado que baja al abrir
  const giro = lado ? (abierta ? 'rotate-90' : '') : abierta ? 'rotate-180' : '';
  return (
    <svg viewBox="0 0 24 24" className={`${lado ? 'size-3.5' : 'size-4'} shrink-0 text-white/55 transition-transform motion-reduce:transition-none ${giro}`}
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={lado ? 'M9 6l6 6-6 6' : 'M6 9l6 6 6-6'} />
    </svg>
  );
}

function Numero({ n, sobreRojo = false }: { n: number; sobreRojo?: boolean }) {
  return (
    <span className={`importe rounded-full px-2 text-xs font-semibold leading-5 ${sobreRojo ? 'bg-white text-marca' : 'bg-marca text-white'}`} title={`${n} esperando tu aprobación`}>
      {n}
    </span>
  );
}

const FOCO = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50';

export function MenuNav({
  grupos,
  iconos,
  activo,
  pendientes = {},
  movil = false,
  onElegir,
}: {
  grupos: GrupoMenu[];
  iconos: Record<string, string>;
  activo: string;
  pendientes?: Record<string, number>;
  /** En el celular las filas son más altas (dedo). */
  movil?: boolean;
  onElegir?: () => void;
}) {
  const delActivo = grupos.find((g) => g.items.some((i) => i.href === activo))?.titulo ?? null;
  const familiaActiva = (() => {
    for (const g of grupos) {
      const i = g.items.find((x) => x.href === activo);
      if (i?.familia) return `${g.titulo}›${i.familia}`;
    }
    return null;
  })();
  const [abierto, setAbierto] = useState<string | null>(delActivo);
  const [familia, setFamilia] = useState<string | null>(familiaActiva);
  const fila = movil ? 'min-h-11' : 'py-2';
  const filaEntrada = movil ? 'min-h-11' : 'py-1.5';
  const filaHoja = movil ? 'min-h-10' : 'py-1';

  const enlace = (i: ItemMenu, hoja = false) => {
    const esActivo = i.href === activo;
    const n = pendientes[i.href] ?? 0;
    return (
      <Link key={i.href} href={i.href} onClick={onElegir} aria-current={esActivo ? 'page' : undefined}
        className={`flex ${hoja ? filaHoja : filaEntrada} items-center gap-2 rounded-lg px-3 ${hoja ? 'text-[13px]' : 'text-sm'} transition-colors ${FOCO} ${
          esActivo ? 'bg-marca font-semibold text-white' : `${hoja ? 'text-white/65' : 'text-white/75'} hover:bg-white/[0.06] hover:text-white`
        }`}>
        <span className="min-w-0 flex-1 truncate">{i.label}</span>
        {n > 0 && <Numero n={n} sobreRojo={esActivo} />}
      </Link>
    );
  };

  return (
    <div className="space-y-0.5">
      {grupos.map((g) => {
        // un grupo de una sola entrada (Inicio) va directo, sin desplegable
        if (g.items.length === 1 && g.items[0].label === g.titulo) {
          const i = g.items[0];
          const esActivo = i.href === activo;
          return (
            <Link key={g.titulo} href={i.href} onClick={onElegir} aria-current={esActivo ? 'page' : undefined}
              className={`group flex ${fila} items-center gap-3 rounded-xl px-3 text-sm transition-colors ${FOCO} ${esActivo ? 'bg-marca font-semibold text-white' : 'font-medium text-white/85 hover:bg-white/[0.06] hover:text-white'}`}>
              <Icono d={iconos[i.icono]} activo={esActivo} />
              <span className="min-w-0 flex-1 truncate">{i.label}</span>
            </Link>
          );
        }

        const estaAbierto = abierto === g.titulo;
        const tieneActivo = g.titulo === delActivo;
        const totalPend = g.items.reduce((s, i) => s + (pendientes[i.href] ?? 0), 0);
        const idLista = `menu-${g.titulo.toLowerCase().replace(/\W+/g, '-')}`;

        return (
          <div key={g.titulo}>
            <button type="button" onClick={() => setAbierto(estaAbierto ? null : g.titulo)} aria-expanded={estaAbierto} aria-controls={idLista}
              className={`group flex w-full ${fila} items-center gap-3 rounded-xl px-3 text-left text-sm font-medium transition-colors ${FOCO} ${tieneActivo ? 'text-white' : 'text-white/85 hover:bg-white/[0.06] hover:text-white'}`}>
              <Icono d={iconos[g.icono]} activo={tieneActivo} />
              <span className="min-w-0 flex-1 truncate">{g.titulo}</span>
              {!estaAbierto && totalPend > 0 && <Numero n={totalPend} />}
              <Flecha abierta={estaAbierto} />
            </button>

            {estaAbierto && (
              <div id={idLista} className="mt-0.5 mb-2 ml-[1.15rem] space-y-0.5 border-l border-white/10 pl-2">
                {entradasDe(g.items).map((e) => {
                  if (e.tipo === 'enlace') return enlace(e.item);
                  const clave = `${g.titulo}›${e.titulo}`;
                  const abierta = familia === clave;
                  const conActivo = clave === familiaActiva;
                  const pend = e.items.reduce((s, i) => s + (pendientes[i.href] ?? 0), 0);
                  const idSub = `${idLista}-${e.titulo.toLowerCase().replace(/\W+/g, '-')}`;
                  return (
                    <div key={clave}>
                      <button type="button" onClick={() => setFamilia(abierta ? null : clave)} aria-expanded={abierta} aria-controls={idSub}
                        className={`flex w-full ${filaEntrada} items-center gap-2 rounded-lg px-3 text-left text-sm transition-colors ${FOCO} ${
                          conActivo ? 'font-medium text-white' : 'text-white/75 hover:bg-white/[0.06] hover:text-white'
                        }`}>
                        <span className="min-w-0 flex-1 truncate">{e.titulo}</span>
                        {!abierta && pend > 0 && <Numero n={pend} />}
                        <Flecha abierta={abierta} lado />
                      </button>
                      {abierta && (
                        <div id={idSub} className="mt-0.5 mb-1 ml-3 space-y-0.5 border-l border-white/10 pl-2">
                          {e.items.map((i) => enlace(i, true))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * El pie del menú: el manual a la vista (lo abre cualquiera, sin importar el
 * rol) y «Mi cuenta» plegado, con los avisos, la contraseña, instalar la app y
 * cerrar sesión. Antes eran cinco renglones fijos.
 */
export function PieMenu({
  iconos,
  activo,
  nombre,
  avisosCelular = false,
  movil = false,
  onElegir,
}: {
  iconos: Record<string, string>;
  activo: string;
  /** El nombre de quien entró, para que «Mi cuenta» diga de quién es. */
  nombre?: string | null;
  avisosCelular?: boolean;
  movil?: boolean;
  onElegir?: () => void;
}) {
  const [abierto, setAbierto] = useState(activo === '/avisos' || activo === '/cambiar-clave');
  const fila = `group flex w-full ${movil ? 'min-h-11' : 'py-2'} items-center gap-3 rounded-xl px-3 text-left text-sm transition-colors ${FOCO}`;
  const filaCuenta = `group flex w-full ${movil ? 'min-h-11' : 'py-1.5'} items-center gap-3 rounded-lg px-3 text-left text-[13px] transition-colors ${FOCO}`;
  const estado = (href: string) => (activo === href ? 'bg-white/[0.08] text-white' : 'text-white/70 hover:bg-white/[0.06] hover:text-white');

  return (
    <div className="space-y-0.5">
      <Link href="/manual" onClick={onElegir} aria-current={activo === '/manual' ? 'page' : undefined} className={`${fila} ${estado('/manual')}`}>
        <Icono d={iconos.manual} />
        <span className="min-w-0 flex-1 truncate">Manual del sistema</span>
      </Link>
      <button type="button" onClick={() => setAbierto((v) => !v)} aria-expanded={abierto} aria-controls="menu-cuenta"
        className={`${fila} text-white/70 hover:bg-white/[0.06] hover:text-white`}>
        <Icono d={iconos.cuenta} />
        <span className="min-w-0 flex-1 truncate">
          {nombre ? (
            <>
              {nombre} <span className="text-white/55">· Mi cuenta</span>
            </>
          ) : (
            'Mi cuenta'
          )}
        </span>
        <Flecha abierta={abierto} />
      </button>
      {abierto && (
        <div id="menu-cuenta" className="mt-0.5 ml-[1.15rem] space-y-0.5 border-l border-white/10 pl-2">
          {avisosCelular && (
            <Link href="/avisos" onClick={onElegir} aria-current={activo === '/avisos' ? 'page' : undefined} className={`${filaCuenta} ${estado('/avisos')}`}>
              <Icono d={iconos.celular} />
              Avisos en el celular
            </Link>
          )}
          <Link href="/cambiar-clave" onClick={onElegir} aria-current={activo === '/cambiar-clave' ? 'page' : undefined} className={`${filaCuenta} ${estado('/cambiar-clave')}`}>
            <Icono d={iconos.clave} />
            Cambiar mi contraseña
          </Link>
          <InstalarApp />
          <a href="/api/salir" className={`${filaCuenta} text-white/70 hover:bg-white/[0.06] hover:text-white`}>
            <Icono d={iconos.salir} />
            Cerrar sesión
          </a>
        </div>
      )}
    </div>
  );
}
