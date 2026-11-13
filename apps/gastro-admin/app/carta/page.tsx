"use client";

import { useState } from "react";
import { api } from "../lib/api";
import { pesos } from "../lib/formato";
import { Accion, Boton, Caja, Campo, Cargando, ErrorCarga, Hoja, Marca, Monto, Opciones, Seccion, Titulo, Vacio, useDatos } from "../ui";

type Categoria = { id: string; nombre: string; nombre_pt: string | null; nombre_en: string | null; orden: number };
type Corte = { id: string; nombre: string; activo: boolean };
type Item = {
  id: string; categoria_id: string; nombre: string; nombre_pt: string | null; nombre_en: string | null;
  descripcion: string | null; descripcion_pt: string | null; descripcion_en: string | null;
  precio: number; costo: number | null; imagen_url: string | null; alergenos: string[]; etiquetas: string[];
  activo: boolean; agotado: boolean; orden: number; tiempo_coccion_min: number | null; corte_id: string | null; gramos_porcion: number | null;
};
type Form = {
  id?: string; categoriaId: string; nombre: string; nombrePt: string; nombreEn: string; descripcion: string; descripcionPt: string; descripcionEn: string;
  precio: number | null; costo: number | null; imagenUrl: string; alergenos: string[]; etiquetas: string[];
  tiempoCoccionMin: number | null; corteId: string; gramosPorcion: number | null;
};

const ALERGENOS: Record<string, string> = {
  gluten: "Gluten", lacteos: "Lácteos", huevo: "Huevo", pescado: "Pescado", crustaceos: "Crustáceos", moluscos: "Moluscos",
  frutos_secos: "Frutos secos", mani: "Maní", soja: "Soja", sesamo: "Sésamo", mostaza: "Mostaza", apio: "Apio", sulfitos: "Sulfitos", altramuces: "Altramuces",
};
const ETIQUETAS: Record<string, string> = { sin_tacc: "Sin TACC", vegetariano: "Vegetariano", vegano: "Vegano", picante: "Picante" };
type Filtro = "todos" | "sin_traducir" | "sin_costo" | "sin_foto" | "agotados" | "ocultos";

const aForm = (i: Item): Form => ({
  id: i.id, categoriaId: i.categoria_id, nombre: i.nombre, nombrePt: i.nombre_pt ?? "", nombreEn: i.nombre_en ?? "",
  descripcion: i.descripcion ?? "", descripcionPt: i.descripcion_pt ?? "", descripcionEn: i.descripcion_en ?? "",
  precio: Number(i.precio), costo: i.costo != null ? Number(i.costo) : null, imagenUrl: i.imagen_url ?? "",
  alergenos: i.alergenos ?? [], etiquetas: i.etiquetas ?? [], tiempoCoccionMin: i.tiempo_coccion_min, corteId: i.corte_id ?? "", gramosPorcion: i.gramos_porcion,
});

export default function CartaAdminPage() {
  const cats = useDatos<Categoria[]>(() => api("/admin/carta/categorias"));
  const items = useDatos<Item[]>(() => api("/admin/carta/items"));
  const cortes = useDatos<Corte[]>(() => api("/admin/carne/cortes"));
  const [form, setForm] = useState<Form | null>(null);
  const [idioma, setIdioma] = useState<"es" | "pt" | "en">("es");
  const [texto, setTexto] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [catsAbierto, setCatsAbierto] = useState(false);

  const lista = items.datos ?? [];
  const cumple: Record<Filtro, (i: Item) => boolean> = {
    todos: () => true,
    sin_traducir: (i) => !i.nombre_pt || !i.nombre_en,
    sin_costo: (i) => i.costo == null,
    sin_foto: (i) => !i.imagen_url,
    agotados: (i) => i.agotado,
    ocultos: (i) => !i.activo,
  };
  const visibles = lista.filter((i) => cumple[filtro](i) && i.nombre.toLowerCase().includes(texto.trim().toLowerCase()));

  async function poner(id: string, cambio: Record<string, unknown>) {
    await api(`/admin/carta/items/${id}`, { method: "PUT", body: JSON.stringify(cambio) });
    await items.recargar();
  }
  async function guardar() {
    if (!form) return;
    if (!form.nombre.trim()) throw new Error("Falta el nombre");
    if (!form.precio) throw new Error("Falta el precio");
    if (!form.categoriaId) throw new Error("Elegí la categoría");
    const cuerpo = { ...form, corteId: form.corteId || null, imagenUrl: form.imagenUrl || null };
    if (form.id) await api(`/admin/carta/items/${form.id}`, { method: "PUT", body: JSON.stringify(cuerpo) });
    else await api("/admin/carta/items", { method: "POST", body: JSON.stringify(cuerpo) });
    setForm(null);
    await items.recargar();
  }
  async function traducir() {
    if (!form?.id) throw new Error("Guardá el plato primero");
    const t = await api(`/admin/carta/items/${form.id}/sugerir-traduccion`, { method: "POST" });
    setForm({ ...form, nombrePt: t.nombrePt, descripcionPt: t.descripcionPt, nombreEn: t.nombreEn, descripcionEn: t.descripcionEn });
  }
  const cambiar = (c: Partial<Form>) => setForm((f) => (f ? { ...f, ...c } : f));
  const alternar = (campo: "alergenos" | "etiquetas", clave: string) =>
    setForm((f) => (f ? { ...f, [campo]: f[campo].includes(clave) ? f[campo].filter((x) => x !== clave) : [...f[campo], clave] } : f));

  const nuevo = (): Form => ({
    categoriaId: cats.datos?.[0]?.id ?? "", nombre: "", nombrePt: "", nombreEn: "", descripcion: "", descripcionPt: "", descripcionEn: "",
    precio: null, costo: null, imagenUrl: "", alergenos: [], etiquetas: [], tiempoCoccionMin: null, corteId: "", gramosPorcion: null,
  });

  return (
    <div>
      <Titulo
        bajada="Lo que ve el cliente al escanear el QR: platos, precios, fotos, idiomas y alérgenos. El precio se carga en pesos; reales y dólares salen del cambio de la casa."
        acciones={
          <>
            <Boton variante="principal" onClick={() => { setIdioma("es"); setForm(nuevo()); }}>Agregar un plato</Boton>
            <Boton onClick={() => setCatsAbierto(true)}>Categorías</Boton>
          </>
        }
      >
        Carta
      </Titulo>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Buscar un plato" aria-label="Buscar un plato" className="campo !w-52" />
        <Opciones
          chico
          valor={filtro}
          alElegir={setFiltro}
          opciones={[
            { valor: "todos", texto: `Todos · ${lista.length}` },
            { valor: "sin_traducir", texto: `Sin traducir · ${lista.filter(cumple.sin_traducir).length}` },
            { valor: "sin_costo", texto: `Sin costo · ${lista.filter(cumple.sin_costo).length}` },
            { valor: "sin_foto", texto: `Sin foto · ${lista.filter(cumple.sin_foto).length}` },
            { valor: "agotados", texto: `Agotados · ${lista.filter(cumple.agotados).length}` },
            { valor: "ocultos", texto: `Ocultos · ${lista.filter(cumple.ocultos).length}` },
          ]}
        />
      </div>

      {items.error && <ErrorCarga error={items.error} reintentar={items.recargar} />}
      {(!items.datos || !cats.datos) && !items.error && <Cargando />}
      {items.datos && cats.datos && visibles.length === 0 && <Vacio>No hay platos con ese filtro.</Vacio>}

      {cats.datos?.map((c) => {
        const suyos = visibles.filter((i) => i.categoria_id === c.id);
        if (!suyos.length) return null;
        return (
          <Seccion key={c.id} titulo={c.nombre} bajada={[c.nombre_pt, c.nombre_en].filter(Boolean).join(" · ") || "Falta traducir el nombre de la categoría"}>
            <Caja>
              {suyos.map((i) => (
                <div key={i.id} className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2 border-b border-line last:border-b-0 ${i.activo ? "" : "opacity-55"}`}>
                  <button onClick={() => { setIdioma("es"); setForm(aForm(i)); }} className="flex-1 min-w-[180px] text-left">
                    <span className="block font-semibold text-[13.5px] underline decoration-line underline-offset-2">{i.nombre}</span>
                    <span className="flex flex-wrap items-center gap-1 mt-1">
                      {i.agotado && <Marca tono="mal">Agotado</Marca>}
                      {!i.activo && <Marca>Oculto</Marca>}
                      {(!i.nombre_pt || !i.nombre_en) && <Marca tono="ojo">Sin traducir</Marca>}
                      {i.etiquetas.map((e) => <Marca key={e} tono="bien">{ETIQUETAS[e] ?? e}</Marca>)}
                      {i.alergenos.length > 0 && <span className="text-faint text-[11.5px]">Tiene: {i.alergenos.map((a) => ALERGENOS[a] ?? a).join(", ").toLowerCase()}</span>}
                    </span>
                  </button>
                  <span className="text-right w-[108px]">
                    <span className="block num font-bold text-[13.5px]">{pesos(Number(i.precio))}</span>
                    <span className="block text-faint text-[11.5px] num">{i.costo != null ? `costo ${pesos(Number(i.costo))}` : "sin costo"}</span>
                  </span>
                  <span className="flex gap-1.5">
                    <Accion tamano="chico" hacer={() => poner(i.id, { agotado: !i.agotado })} haciendo="Cambiando…" listo="Hecho">{i.agotado ? "Volvió a haber" : "Se terminó"}</Accion>
                    <Accion tamano="chico" variante="suave" hacer={() => poner(i.id, { activo: !i.activo })} haciendo="Cambiando…" listo="Hecho">{i.activo ? "Ocultar" : "Mostrar"}</Accion>
                    <Boton tamano="chico" variante="principal" onClick={() => { setIdioma("es"); setForm(aForm(i)); }}>Cambiar</Boton>
                  </span>
                </div>
              ))}
            </Caja>
          </Seccion>
        );
      })}

      {form && (
        <Hoja
          titulo={form.id ? form.nombre || "Plato" : "Agregar un plato"}
          cerrar={() => setForm(null)}
          pie={
            <div className="flex flex-wrap items-center justify-between gap-2">
              {form.id ? (
                <Accion variante="peligro" tamano="chico" confirmar="¿Borrar el plato? Tocá de nuevo" haciendo="Borrando…" hacer={async () => { await api(`/admin/carta/items/${form.id}`, { method: "DELETE" }); setForm(null); await items.recargar(); }}>
                  Borrar
                </Accion>
              ) : <span />}
              <Accion hacer={guardar} variante="principal" tamano="grande" haciendo="Guardando…" listo="Guardado">Guardar el plato</Accion>
            </div>
          }
        >
          <div className="flex flex-col gap-3.5">
            <Campo etiqueta="Categoría">
              <select className="campo" value={form.categoriaId} onChange={(e) => cambiar({ categoriaId: e.target.value })}>
                {cats.datos?.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </Campo>

            <div>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <Opciones chico valor={idioma} alElegir={setIdioma} opciones={[{ valor: "es" as const, texto: "Español" }, { valor: "pt" as const, texto: `Portugués${form.nombrePt ? "" : " · falta"}` }, { valor: "en" as const, texto: `Inglés${form.nombreEn ? "" : " · falta"}` }]} />
                {form.id && <Accion tamano="chico" hacer={traducir} haciendo="Traduciendo…" listo="Revisá el texto">Proponer traducción con IA</Accion>}
              </div>
              {idioma === "es" && (
                <div className="flex flex-col gap-2.5">
                  <Campo etiqueta="Nombre"><input className="campo" value={form.nombre} onChange={(e) => cambiar({ nombre: e.target.value })} /></Campo>
                  <Campo etiqueta="Descripción"><textarea rows={2} className="campo" value={form.descripcion} onChange={(e) => cambiar({ descripcion: e.target.value })} /></Campo>
                </div>
              )}
              {idioma === "pt" && (
                <div className="flex flex-col gap-2.5">
                  <Campo etiqueta="Nombre en portugués"><input className="campo" value={form.nombrePt} onChange={(e) => cambiar({ nombrePt: e.target.value })} /></Campo>
                  <Campo etiqueta="Descripción en portugués"><textarea rows={2} className="campo" value={form.descripcionPt} onChange={(e) => cambiar({ descripcionPt: e.target.value })} /></Campo>
                </div>
              )}
              {idioma === "en" && (
                <div className="flex flex-col gap-2.5">
                  <Campo etiqueta="Nombre en inglés"><input className="campo" value={form.nombreEn} onChange={(e) => cambiar({ nombreEn: e.target.value })} /></Campo>
                  <Campo etiqueta="Descripción en inglés"><textarea rows={2} className="campo" value={form.descripcionEn} onChange={(e) => cambiar({ descripcionEn: e.target.value })} /></Campo>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Campo etiqueta="Precio, en pesos"><Monto valor={form.precio} alCambiar={(n) => cambiar({ precio: n })} /></Campo>
              <Campo etiqueta="Costo del plato, en pesos" ayuda="Lo que cuesta hacerlo. Sirve para saber qué deja."><Monto valor={form.costo} alCambiar={(n) => cambiar({ costo: n })} /></Campo>
            </div>
            {form.precio && form.costo != null && (
              <p className="text-[12.5px] text-dim -mt-1.5">Deja {pesos(form.precio - form.costo)} por plato ({Math.round(((form.precio - form.costo) / form.precio) * 100)} %).</p>
            )}

            <div>
              <p className="text-[12px] font-semibold text-dim mb-1.5">Alérgenos que tiene</p>
              <div className="flex flex-wrap gap-1">
                {Object.entries(ALERGENOS).map(([k, t]) => (
                  <button key={k} onClick={() => alternar("alergenos", k)} aria-pressed={form.alergenos.includes(k)} className={`h-[28px] px-2.5 rounded-md border text-[12px] font-semibold ${form.alergenos.includes(k) ? "bg-loss/15 border-loss/50 text-loss" : "bg-card border-line text-dim"}`}>
                    {t}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-[12px] font-semibold text-dim mb-1.5">Es</p>
              <div className="flex flex-wrap gap-1">
                {Object.entries(ETIQUETAS).map(([k, t]) => (
                  <button key={k} onClick={() => alternar("etiquetas", k)} aria-pressed={form.etiquetas.includes(k)} className={`h-[28px] px-2.5 rounded-md border text-[12px] font-semibold ${form.etiquetas.includes(k) ? "bg-good/15 border-good/50 text-good" : "bg-card border-line text-dim"}`}>
                    {t}
                  </button>
                ))}
              </div>
            </div>

            <Campo etiqueta="Foto del plato (dirección de la imagen)" ayuda="Pegá el link de la foto. Si queda vacío, el plato sale sin foto.">
              <input className="campo" inputMode="url" value={form.imagenUrl} onChange={(e) => cambiar({ imagenUrl: e.target.value })} />
            </Campo>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {form.imagenUrl && <img src={form.imagenUrl} alt="" className="w-full max-h-44 object-cover rounded-lg border border-line" />}

            <div className="grid grid-cols-3 gap-3">
              <Campo etiqueta="Minutos de cocción">
                <input type="number" min={0} className="campo num" value={form.tiempoCoccionMin ?? ""} onChange={(e) => cambiar({ tiempoCoccionMin: e.target.value ? Number(e.target.value) : null })} />
              </Campo>
              <Campo etiqueta="Corte de carne">
                <select className="campo" value={form.corteId} onChange={(e) => cambiar({ corteId: e.target.value })}>
                  <option value="">Ninguno</option>
                  {(cortes.datos ?? []).filter((c) => c.activo).map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                </select>
              </Campo>
              <Campo etiqueta="Gramos por porción">
                <input type="number" min={0} className="campo num" value={form.gramosPorcion ?? ""} onChange={(e) => cambiar({ gramosPorcion: e.target.value ? Number(e.target.value) : null })} />
              </Campo>
            </div>
          </div>
        </Hoja>
      )}

      {catsAbierto && <Categorias cats={cats.datos ?? []} recargar={cats.recargar} cerrar={() => setCatsAbierto(false)} />}
    </div>
  );
}

function Categorias({ cats, recargar, cerrar }: { cats: Categoria[]; recargar: () => Promise<void>; cerrar: () => void }) {
  const [nueva, setNueva] = useState("");
  return (
    <Hoja titulo="Categorías" bajada="El nombre en los tres idiomas. El orden es el de la carta." cerrar={cerrar}>
      {cats.map((c) => (
        <div key={c.id} className="py-2.5 border-b border-line">
          <div className="grid grid-cols-3 gap-2">
            {([["nombre", "Español", c.nombre], ["nombrePt", "Portugués", c.nombre_pt], ["nombreEn", "Inglés", c.nombre_en]] as const).map(([campo, etiqueta, valor]) => (
              <Campo key={campo} etiqueta={etiqueta}>
                <input
                  className="campo" defaultValue={valor ?? ""}
                  onBlur={async (e) => { if (e.target.value !== (valor ?? "")) { await api(`/admin/carta/categorias/${c.id}`, { method: "PUT", body: JSON.stringify({ [campo]: e.target.value }) }); await recargar(); } }}
                />
              </Campo>
            ))}
          </div>
        </div>
      ))}
      <p className="text-[11.5px] text-faint mt-2">Los cambios se guardan al salir de cada casilla.</p>
      <div className="flex items-end gap-2 mt-4">
        <Campo etiqueta="Categoría nueva" className="flex-1"><input className="campo" value={nueva} onChange={(e) => setNueva(e.target.value)} /></Campo>
        <Accion variante="principal" haciendo="Agregando…" listo="Agregada" hacer={async () => { if (!nueva.trim()) throw new Error("Poné el nombre"); await api("/admin/carta/categorias", { method: "POST", body: JSON.stringify({ nombre: nueva.trim(), orden: cats.length }) }); setNueva(""); await recargar(); }}>
          Agregar
        </Accion>
      </div>
    </Hoja>
  );
}
