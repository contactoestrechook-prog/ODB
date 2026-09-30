"use client";

import { useEffect, useState } from "react";
import { api } from "../lib/api";

type Contacto = {
  id: string;
  telefono: string;
  nombre: string | null;
  creado_en: string;
  mesa: { numero: number; sector: string | null } | null;
};
type ResumenClientes = { total: number; ultimos30Dias: number };

export default function ClientesPage() {
  const [contactos, setContactos] = useState<Contacto[]>([]);
  const [resumen, setResumen] = useState<ResumenClientes | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    Promise.all([api("/admin/clientes"), api("/admin/clientes/resumen")]).then(([c, r]) => {
      setContactos(c);
      setResumen(r);
      setCargando(false);
    });
  }, []);

  if (cargando) return <p className="text-faint text-sm">Cargando…</p>;

  return (
    <div>
      <h1 className="display text-xl font-bold mb-1">Base de clientes</h1>
      <p className="text-faint text-xs mb-5">
        Capturados con el canje "WhatsApp → café de cortesía". En un negocio de turistas, esta lista es el único activo de cliente que queda — acá se venden los vinos de autor y las encuestas.
      </p>

      <div className="grid grid-cols-2 gap-3 mb-6">
        <div className="rounded-xl border border-line bg-card p-3">
          <p className="text-[10.5px] text-faint font-semibold uppercase tracking-wide">Total</p>
          <p className="text-xl font-bold mt-1 font-mono tabular-nums text-good">{resumen?.total ?? 0}</p>
        </div>
        <div className="rounded-xl border border-line bg-card p-3">
          <p className="text-[10.5px] text-faint font-semibold uppercase tracking-wide">Últimos 30 días</p>
          <p className="text-xl font-bold mt-1 font-mono tabular-nums">{resumen?.ultimos30Dias ?? 0}</p>
        </div>
      </div>

      {contactos.length === 0 && (
        <p className="text-faint text-sm">Todavía no hay contactos. En cuanto el primer cliente canjee su café, aparece acá.</p>
      )}

      <div className="flex flex-col gap-2">
        {contactos.map((c) => (
          <div key={c.id} className="flex items-center justify-between gap-3 rounded-xl border border-line bg-card p-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">{c.nombre || "Sin nombre"}</p>
              <p className="text-faint text-[10.5px]">
                {new Date(c.creado_en).toLocaleDateString("es-AR")}
                {c.mesa ? ` · Mesa ${c.mesa.numero}${c.mesa.sector ? ` (${c.mesa.sector})` : ""}` : ""}
              </p>
            </div>
            <a
              href={`https://wa.me/${c.telefono}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-xs font-bold text-good whitespace-nowrap"
            >
              {c.telefono} ↗
            </a>
          </div>
        ))}
      </div>
    </div>
  );
}
