'use client';

import { useState } from 'react';
import Link from 'next/link';

// El menú lateral por grupos que se abren y se cierran (Leandro, 24/10/2026:
// «repartir y clasificar bien el menú lateral, simplificarlo, y que haya
// subcategorías, está muy pesado»). Se ve un grupo abierto por vez: el de la
// pantalla en la que estás. Adentro, las entradas van por subcategoría.
// Lo usan la barra de escritorio y el cajón del celular.

export type ItemMenu = { href: string; label: string; icono: string; sub?: string; soloRoles?: string[] };
export type GrupoMenu = { titulo: string; icono: string; items: ItemMenu[] };

function Icono({ d, activo = false }: { d: string; activo?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className={`size-[18px] shrink-0 ${activo ? 'text-white' : 'text-white/55 group-hover:text-white/80'}`}
      fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
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
  const [abierto, setAbierto] = useState<string | null>(delActivo);
  const alto = movil ? 'min-h-11' : 'py-2';

  return (
    <div className="space-y-0.5">
      {grupos.map((g) => {
        // un grupo de una sola entrada (Inicio) va directo, sin desplegable
        if (g.items.length === 1 && g.items[0].label === g.titulo) {
          const i = g.items[0];
          const esActivo = i.href === activo;
          return (
            <Link key={g.titulo} href={i.href} onClick={onElegir} aria-current={esActivo ? 'page' : undefined}
              className={`group flex ${alto} items-center gap-3 rounded-xl px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 ${esActivo ? 'bg-marca font-semibold text-white' : 'font-medium text-white/85 hover:bg-white/[0.06] hover:text-white'}`}>
              <Icono d={iconos[i.icono]} activo={esActivo} />
              <span className="min-w-0 flex-1 truncate">{i.label}</span>
            </Link>
          );
        }

        const estaAbierto = abierto === g.titulo;
        const tieneActivo = g.titulo === delActivo;
        const totalPend = g.items.reduce((s, i) => s + (pendientes[i.href] ?? 0), 0);
        const subs: { sub: string; items: ItemMenu[] }[] = [];
        for (const i of g.items) {
          const s = i.sub ?? '';
          const ult = subs[subs.length - 1];
          if (ult && ult.sub === s) ult.items.push(i);
          else subs.push({ sub: s, items: [i] });
        }
        const idLista = `menu-${g.titulo.toLowerCase().replace(/\W+/g, '-')}`;

        return (
          <div key={g.titulo}>
            <button type="button" onClick={() => setAbierto(estaAbierto ? null : g.titulo)} aria-expanded={estaAbierto} aria-controls={idLista}
              className={`group flex w-full ${alto} items-center gap-3 rounded-xl px-3 text-left text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 ${tieneActivo ? 'text-white' : 'text-white/85 hover:bg-white/[0.06] hover:text-white'}`}>
              <Icono d={iconos[g.icono]} activo={tieneActivo} />
              <span className="min-w-0 flex-1 truncate">{g.titulo}</span>
              {!estaAbierto && totalPend > 0 && <Numero n={totalPend} />}
              <svg viewBox="0 0 24 24" className={`size-4 shrink-0 text-white/55 transition-transform ${estaAbierto ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>

            {estaAbierto && (
              <div id={idLista} className="mb-2 ml-[1.15rem] border-l border-white/10 pl-2">
                {subs.map((s) => (
                  <div key={s.sub || 'sin'} className="mt-1">
                    {s.sub && <p className="px-3 pt-1.5 pb-0.5 text-xs font-semibold uppercase tracking-[0.12em] text-white/55">{s.sub}</p>}
                    {s.items.map((i) => {
                      const esActivo = i.href === activo;
                      const n = pendientes[i.href] ?? 0;
                      return (
                        <Link key={i.href} href={i.href} onClick={onElegir} aria-current={esActivo ? 'page' : undefined}
                          className={`flex ${movil ? 'min-h-11' : 'py-1.5'} items-center gap-2 rounded-lg px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 ${esActivo ? 'bg-marca font-semibold text-white' : 'text-white/70 hover:bg-white/[0.06] hover:text-white'}`}>
                          <span className="min-w-0 flex-1 truncate">{i.label}</span>
                          {n > 0 && <Numero n={n} sobreRojo={esActivo} />}
                        </Link>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
