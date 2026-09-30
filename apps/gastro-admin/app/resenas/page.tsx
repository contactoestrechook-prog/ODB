"use client";

import { useEffect, useState } from "react";
import { api } from "../lib/api";

type Resena = {
  id: string;
  autor: string;
  rating: number;
  texto: string;
  idioma: string;
  respuesta_ia: string | null;
  respuesta_estado: "pendiente" | "borrador" | "aprobada" | "publicada" | "rechazada";
  creado_en: string;
};

const ETIQUETA_ESTADO: Record<Resena["respuesta_estado"], string> = {
  pendiente: "Sin respuesta",
  borrador: "Borrador IA",
  aprobada: "Aprobada — falta publicar",
  publicada: "Publicada",
  rechazada: "Rechazada",
};

export default function ResenasPage() {
  const [resenas, setResenas] = useState<Resena[]>([]);
  const [cargando, setCargando] = useState(true);
  const [nueva, setNueva] = useState({ autor: "", rating: 5, texto: "", idioma: "es" });
  const [ocupado, setOcupado] = useState<string | null>(null);

  async function cargar() {
    setCargando(true);
    setResenas(await api("/admin/resenas"));
    setCargando(false);
  }

  useEffect(() => { cargar(); }, []);

  async function cargarManual() {
    if (!nueva.autor || !nueva.texto) return;
    await api("/admin/resenas", { method: "POST", body: JSON.stringify(nueva) });
    setNueva({ autor: "", rating: 5, texto: "", idioma: "es" });
    cargar();
  }

  async function generar(id: string) {
    setOcupado(id);
    try {
      await api(`/admin/resenas/${id}/generar-respuesta`, { method: "POST" });
      cargar();
    } finally {
      setOcupado(null);
    }
  }

  async function aprobar(id: string, texto: string) {
    setOcupado(id);
    try {
      await api(`/admin/resenas/${id}/aprobar`, { method: "POST", body: JSON.stringify({ textoFinal: texto }) });
      cargar();
    } finally {
      setOcupado(null);
    }
  }

  async function marcarPublicada(id: string) {
    setOcupado(id);
    try {
      await api(`/admin/resenas/${id}/marcar-publicada`, { method: "POST" });
      cargar();
    } finally {
      setOcupado(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="display text-xl font-bold mb-3">Cargar reseña</h1>
        <p className="text-faint text-xs mb-3">
          Google Business Profile todavía no está conectado (falta que Damián autorice el acceso).
          Mientras tanto, se pega acá a mano.
        </p>
        <div className="rounded-xl border border-line bg-card p-4 flex flex-col gap-2">
          <input
            placeholder="Autor"
            value={nueva.autor}
            onChange={(e) => setNueva({ ...nueva, autor: e.target.value })}
            className="rounded-lg border border-line bg-transparent p-2 text-sm"
          />
          <div className="flex gap-2">
            <select
              value={nueva.rating}
              onChange={(e) => setNueva({ ...nueva, rating: Number(e.target.value) })}
              className="rounded-lg border border-line bg-transparent p-2 text-sm"
            >
              {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} ★</option>)}
            </select>
            <select
              value={nueva.idioma}
              onChange={(e) => setNueva({ ...nueva, idioma: e.target.value })}
              className="rounded-lg border border-line bg-transparent p-2 text-sm"
            >
              <option value="es">Español</option>
              <option value="pt">Português</option>
              <option value="en">English</option>
            </select>
          </div>
          <textarea
            placeholder="Texto de la reseña"
            value={nueva.texto}
            onChange={(e) => setNueva({ ...nueva, texto: e.target.value })}
            rows={2}
            className="rounded-lg border border-line bg-transparent p-2 text-sm"
          />
          <button onClick={cargarManual} className="text-sm font-semibold py-2 rounded-lg bg-gradient-to-br from-accent to-accent-2 text-[#1a1206]">
            Agregar
          </button>
        </div>
      </div>

      <div>
        <h2 className="display text-lg font-bold mb-3">Reseñas</h2>
        {cargando && <p className="text-faint text-sm">Cargando…</p>}
        <div className="flex flex-col gap-3">
          {resenas.map((r) => (
            <FilaResena
              key={r.id}
              resena={r}
              ocupado={ocupado === r.id}
              onGenerar={() => generar(r.id)}
              onAprobar={(texto) => aprobar(r.id, texto)}
              onMarcarPublicada={() => marcarPublicada(r.id)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function FilaResena({
  resena, ocupado, onGenerar, onAprobar, onMarcarPublicada,
}: {
  resena: Resena;
  ocupado: boolean;
  onGenerar: () => void;
  onAprobar: (texto: string) => void;
  onMarcarPublicada: () => void;
}) {
  const [texto, setTexto] = useState(resena.respuesta_ia ?? "");

  return (
    <div className="rounded-xl border border-line bg-card p-4">
      <div className="flex justify-between items-start gap-3 mb-2">
        <div>
          <p className="font-semibold text-sm">{resena.autor} · {"★".repeat(resena.rating)}</p>
          <p className="text-dim text-sm mt-1">&ldquo;{resena.texto}&rdquo;</p>
        </div>
        <span className="text-[10px] font-semibold px-2 py-1 rounded-md bg-card-2 text-faint whitespace-nowrap">
          {ETIQUETA_ESTADO[resena.respuesta_estado]}
        </span>
      </div>

      {resena.respuesta_estado === "pendiente" && (
        <button onClick={onGenerar} disabled={ocupado} className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-gradient-to-br from-accent to-accent-2 text-[#1a1206] disabled:opacity-60">
          {ocupado ? "Generando…" : "Generar respuesta con IA"}
        </button>
      )}

      {(resena.respuesta_estado === "borrador" || resena.respuesta_estado === "aprobada") && (
        <div className="flex flex-col gap-2 mt-2">
          <textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            rows={2}
            className="rounded-lg border border-line bg-transparent p-2 text-sm"
          />
          <div className="flex gap-2">
            {resena.respuesta_estado === "borrador" && (
              <button onClick={() => onAprobar(texto)} disabled={ocupado} className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-line">
                Aprobar
              </button>
            )}
            {resena.respuesta_estado === "aprobada" && (
              <button onClick={onMarcarPublicada} disabled={ocupado} className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-good/20 text-good">
                Ya la pegué en Google
              </button>
            )}
          </div>
        </div>
      )}

      {resena.respuesta_estado === "publicada" && (
        <p className="text-good text-xs mt-2">✓ Respondida: &ldquo;{resena.respuesta_ia}&rdquo;</p>
      )}
    </div>
  );
}
