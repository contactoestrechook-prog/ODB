'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Aviso,
  Boton,
  Cargando,
  Etiqueta,
  ROTULO,
  Selector,
  TablaResponsiva,
  Tarjeta,
  TarjetaCabecera,
  Vacio,
  type TonoEtiqueta,
} from '../ui/kit';
import { fechaHora, numero, pesos } from '../lib/formato';
import { cantidadDelPozo, fechaCorta, lleva, pisaElSistemaViejo, type EntradaHistorial, type Grupo, type Presentacion, type Sucursal } from './datos';
import { ModalCargarPozo, ModalEditar, ModalMover, ModalPresentacion } from './modales';

// Fraccionar (pantalla completa 21/10/2026). Tres instancias: la mercadería
// ENTRA al pozo (por la factura, o a mano desde acá); en el local se ARMAN las
// presentaciones (docena, maple, cuarto kilo) y el sistema mueve el stock del
// pozo a la presentación; la caja VENDE lo armado como cualquier producto.
// Antes la pantalla solo armaba: no se podía sumar nada, cargar el pozo ni ver
// qué se había hecho.

type Dialogo =
  | { tipo: 'mover'; modo: 'armar' | 'abrir'; pozoId: string; presentacionId: string }
  | { tipo: 'cargar'; pozoId: string }
  | { tipo: 'presentacion'; pozoId: string | null }
  | { tipo: 'editar'; pozoId: string; presentacionId: string };

const CLAVE_SUCURSAL = 'odb.fraccionar.sucursal';

const TONO: Record<EntradaHistorial['tipo'], TonoEtiqueta> = { armado: 'info', apertura: 'neutro', carga: 'atencion' };
const QUE: Record<EntradaHistorial['tipo'], string> = { armado: 'Armado', apertura: 'Abierto al pozo', carga: 'Carga del pozo' };

export function Fraccionar({
  puedeConfigurar,
  puedeCargarPozo,
  sucursalDelUsuario = null,
}: {
  puedeConfigurar: boolean;
  puedeCargarPozo: boolean;
  /** la sucursal asignada al usuario (del token): la que se abre primero */
  sucursalDelUsuario?: string | null;
}) {
  const [grupos, setGrupos] = useState<Grupo[]>([]);
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [sucursalId, setSucursalId] = useState('');
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogo, setDialogo] = useState<Dialogo | null>(null);
  // el último "Listo" de cada grupo (va dentro de su tarjeta, donde se está mirando)
  const [avisos, setAvisos] = useState<Record<string, string>>({});
  const [avisoGeneral, setAvisoGeneral] = useState<string | null>(null);
  const [historial, setHistorial] = useState<EntradaHistorial[] | null>(null);
  const [errorHistorial, setErrorHistorial] = useState<string | null>(null);
  const [vuelta, setVuelta] = useState(0); // sube después de cada cambio: recarga el historial

  const cargar = useCallback(async () => {
    try {
      const res = await fetch('/api/fraccionar', { cache: 'no-store' });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.message ?? 'No se pudo cargar');
      setGrupos(d.grupos ?? []);
      const sucs: Sucursal[] = d.sucursales ?? [];
      setSucursales(sucs);
      setSucursalId((actual) => {
        if (actual && sucs.some((s) => s.id === actual)) return actual;
        let guardada: string | null = null;
        try {
          guardada = window.localStorage.getItem(CLAVE_SUCURSAL);
        } catch {
          // sin almacenamiento (ventana privada): sigue con las otras
        }
        // la que eligió la última vez; si no, la suya; si no, una que no
        // tome el stock del sistema viejo (ahí casi nada se puede mover)
        return (
          sucs.find((s) => s.id === guardada)?.id ??
          sucs.find((s) => s.id === sucursalDelUsuario)?.id ??
          sucs.find((s) => !s.sistemaViejo)?.id ??
          sucs[0]?.id ??
          ''
        );
      });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar');
    } finally {
      setCargando(false);
    }
  }, [sucursalDelUsuario]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  useEffect(() => {
    if (!sucursalId) return;
    let vigente = true;
    (async () => {
      try {
        const res = await fetch(`/api/fraccionar?recurso=historial&sucursalId=${encodeURIComponent(sucursalId)}`, { cache: 'no-store' });
        const d = await res.json().catch(() => ({}));
        if (!vigente) return;
        if (!res.ok) throw new Error(d.message ?? 'No se pudo traer el historial');
        setHistorial(Array.isArray(d) ? d : []);
        setErrorHistorial(null);
      } catch (e) {
        if (vigente) setErrorHistorial(e instanceof Error ? e.message : 'No se pudo traer el historial');
      }
    })();
    return () => {
      vigente = false;
    };
  }, [sucursalId, vuelta]);

  const elegirSucursal = (id: string) => {
    setSucursalId(id);
    setAvisos({});
    setHistorial(null);
    try {
      window.localStorage.setItem(CLAVE_SUCURSAL, id);
    } catch {
      // no se recuerda, no pasa nada
    }
  };

  const listo = (pozoId: string | null, texto: string) => {
    setDialogo(null);
    if (pozoId) setAvisos((a) => ({ ...a, [pozoId]: texto }));
    else setAvisoGeneral(texto);
    setVuelta((v) => v + 1);
    cargar();
  };

  const sucursal = sucursales.find((s) => s.id === sucursalId) ?? null;
  const grupoDe = (pozoId: string | null) => grupos.find((g) => g.pozo.id === pozoId) ?? null;
  const presentacionDe = (g: Grupo | null, id: string) => g?.presentaciones.find((p) => p.id === id) ?? null;

  // el diálogo abierto, con los datos frescos (después de recargar)
  const dGrupo = dialogo ? grupoDe(dialogo.pozoId) : null;
  const dPresentacion = dialogo && 'presentacionId' in dialogo ? presentacionDe(dGrupo, dialogo.presentacionId) : null;

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* el título "Fraccionar" ya lo pone la cabecera */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="min-w-0 text-sm text-tinta/70">
          Lo que entra a granel va al pozo; acá se arman las presentaciones (docenas, maples, cuartos) que vende la caja.
        </p>
        <div className="flex flex-col gap-2 sm:shrink-0 sm:flex-row sm:items-center">
          {sucursales.length > 1 && (
            <Selector
              value={sucursalId}
              onChange={(e) => elegirSucursal(e.target.value)}
              aria-label="Sucursal"
              className="sm:w-56"
              opciones={sucursales.map((s) => ({ valor: s.id, etiqueta: s.nombre }))}
            />
          )}
          {puedeConfigurar && grupos.length > 0 && sucursal && (
            <Boton variante="secundario" onClick={() => setDialogo({ tipo: 'presentacion', pozoId: null })}>
              Sumar fraccionable
            </Boton>
          )}
        </div>
      </div>

      {avisoGeneral && <Aviso tono="ok">{avisoGeneral}</Aviso>}
      {sucursal?.sistemaViejo && grupos.some((g) => pisaElSistemaViejo(sucursal, g.pozo) || g.presentaciones.some((p) => pisaElSistemaViejo(sucursal, g.pozo, p))) && (
        <Aviso tono="atencion" titulo={`${sucursal.nombre} todavía toma el stock del sistema viejo`}>
          Cada carga de la planilla del sistema viejo (la última, {sucursal.sistemaViejo.referencia}, el {fechaCorta(sucursal.sistemaViejo.fecha)}) le pisa el
          stock a los productos que trae, y no al pozo: lo que se armara o se abriera acá con esos productos terminaría con mercadería contada dos
          veces o perdida. Por eso acá no se mueven: mientras esta sucursal venda con el sistema viejo, se fracciona allá.
        </Aviso>
      )}
      {error && (
        <Aviso
          tono="error"
          titulo="No pude traer los fraccionables"
          accion={
            <Boton tamano="chico" variante="secundario" onClick={() => { setCargando(true); cargar(); }}>
              Reintentar
            </Boton>
          }
        >
          {error}
        </Aviso>
      )}

      {cargando ? (
        <Cargando bloque />
      ) : grupos.length === 0 && !error ? (
        <Vacio
          titulo="Todavía no hay nada para fraccionar"
          texto="Un fraccionable es un producto que entra a granel (el pozo: huevos por unidad, una horma por kilo) y se vende en presentaciones que se arman en el local."
          accion={
            puedeConfigurar && sucursal ? (
              <Boton onClick={() => setDialogo({ tipo: 'presentacion', pozoId: null })}>Sumar fraccionable</Boton>
            ) : (
              <p className="text-sm text-tinta/60">Lo configura gerencia.</p>
            )
          }
        />
      ) : (
        sucursal &&
        grupos.map((g) => (
          <TarjetaGrupo
            key={g.pozo.id}
            grupo={g}
            sucursal={sucursal}
            aviso={avisos[g.pozo.id]}
            puedeConfigurar={puedeConfigurar}
            puedeCargarPozo={puedeCargarPozo}
            onDialogo={setDialogo}
          />
        ))
      )}

      {sucursal && grupos.length > 0 && (
        <Historial sucursal={sucursal} entradas={historial} error={errorHistorial} onReintentar={() => setVuelta((v) => v + 1)} />
      )}

      {/* ---------------------------------------------------------- diálogos */}
      {dialogo?.tipo === 'mover' && dGrupo && dPresentacion && sucursal && (
        <ModalMover
          // al pasar de "armar" a "abrir el maple" se monta de nuevo: arranca en 1 y con el foco adentro
          key={`${dialogo.modo}-${dialogo.presentacionId}`}
          modo={dialogo.modo}
          grupo={dGrupo}
          presentacion={dPresentacion}
          sucursal={sucursal}
          puedeCargarPozo={puedeCargarPozo}
          onCerrar={() => setDialogo(null)}
          onListo={(t) => listo(dGrupo.pozo.id, t)}
          onCargarPozo={() => setDialogo({ tipo: 'cargar', pozoId: dGrupo.pozo.id })}
          onAbrirOtra={(p) => setDialogo({ tipo: 'mover', modo: 'abrir', pozoId: dGrupo.pozo.id, presentacionId: p.id })}
          sePuedeAbrir={(p) => !pisaElSistemaViejo(sucursal, dGrupo.pozo, p)}
        />
      )}
      {dialogo?.tipo === 'cargar' && dGrupo && sucursal && (
        <ModalCargarPozo grupo={dGrupo} sucursal={sucursal} onCerrar={() => setDialogo(null)} onListo={(t) => listo(dGrupo.pozo.id, t)} />
      )}
      {dialogo?.tipo === 'presentacion' && sucursal && (
        <ModalPresentacion
          grupo={dGrupo}
          grupos={grupos}
          sucursal={sucursal}
          onCerrar={() => setDialogo(null)}
          onListo={(t, pozoSku) => listo(grupos.find((g) => g.pozo.sku === pozoSku)?.pozo.id ?? null, t)}
        />
      )}
      {dialogo?.tipo === 'editar' && dGrupo && dPresentacion && (
        <ModalEditar
          grupo={dGrupo}
          presentacion={dPresentacion}
          sucursales={sucursales}
          onCerrar={() => setDialogo(null)}
          // si se quitó la última presentación, la tarjeta del pozo desaparece:
          // el "Listo" va arriba de todo para que se vea
          onListo={(t, { general } = {}) => listo(general ? null : dGrupo.pozo.id, t)}
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------ un fraccionable

function TarjetaGrupo({
  grupo,
  sucursal,
  aviso,
  puedeConfigurar,
  puedeCargarPozo,
  onDialogo,
}: {
  grupo: Grupo;
  sucursal: Sucursal;
  aviso?: string;
  puedeConfigurar: boolean;
  puedeCargarPozo: boolean;
  onDialogo: (d: Dialogo) => void;
}) {
  const { pozo, presentaciones } = grupo;
  const enPozo = Number(pozo.stock[sucursal.id] ?? 0);
  const chica = [...presentaciones].sort((a, b) => a.unidades - b.unidades)[0];
  const sinPozo = !!chica && Number(chica.alcanza[sucursal.id] ?? 0) === 0;
  const bloqueada = (p: Presentacion) => pisaElSistemaViejo(sucursal, pozo, p);
  const pozoBloqueado = pisaElSistemaViejo(sucursal, pozo);
  const cargaPozo = puedeCargarPozo && !pozoBloqueado;
  const todoBloqueado = presentaciones.length > 0 && presentaciones.every(bloqueada);
  // con el pozo vacío, la más chica de las que se pueden abrir para alimentarlo
  const paraAbrir = sinPozo
    ? [...presentaciones]
        .filter((p) => p.unidades > chica.unidades && Number(p.stock[sucursal.id] ?? 0) >= 1 && !bloqueada(p))
        .sort((a, b) => a.unidades - b.unidades)[0]
    : undefined;

  return (
    <Tarjeta relleno={false} aria-label={pozo.nombre}>
      <TarjetaCabecera
        titulo={pozo.nombre}
        sub={`${pozo.sku} · ${pozo.porPeso ? 'se cuenta en kilos' : 'se cuenta por unidad'}${pozo.activo ? '' : ' · dado de baja'}`}
      />

      {/* el pozo */}
      <div className="flex flex-wrap items-end justify-between gap-3 bg-crema-claro px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <p className={ROTULO}>En el pozo · {sucursal.nombre}</p>
          <p className="importe text-2xl font-semibold text-tinta">
            {numero(enPozo, pozo.porPeso || !Number.isInteger(enPozo) ? 3 : 0)}{' '}
            <span className="text-base font-medium text-tinta/70">{pozo.porPeso ? 'kg' : enPozo === 1 ? 'unidad' : 'unidades'}</span>
          </p>
        </div>
        {cargaPozo && (
          <Boton tamano="chico" variante="secundario" onClick={() => onDialogo({ tipo: 'cargar', pozoId: pozo.id })}>
            Cargar el pozo
          </Boton>
        )}
      </div>

      {/* el "Listo" de lo último que se hizo y, abajo, el pozo vacío con su
          salida: los dos a la vez (antes el Listo tapaba la oferta de abrir) */}
      {(aviso || (sinPozo && !todoBloqueado)) && (
        <div className="space-y-2 px-4 pt-3 sm:px-5">
          {aviso && <Aviso tono="ok">{aviso}</Aviso>}
          {sinPozo && !todoBloqueado && (
            <Aviso
              tono="atencion"
              accion={
                paraAbrir && (
                  <Boton
                    tamano="chico"
                    variante="secundario"
                    onClick={() => onDialogo({ tipo: 'mover', modo: 'abrir', pozoId: pozo.id, presentacionId: paraAbrir.id })}
                  >
                    Abrir {paraAbrir.nombre}
                  </Boton>
                )
              }
            >
              {enPozo > 0
                ? `En el pozo hay ${cantidadDelPozo(enPozo, pozo.porPeso)}: no alcanza para armar ninguna.`
                : enPozo < 0
                  ? `El pozo está en ${cantidadDelPozo(enPozo, pozo.porPeso)} (se vendió más de lo que entró): no se puede armar nada.`
                  : 'El pozo está vacío: no se puede armar nada.'}{' '}
              {paraAbrir
                ? `Abrí ${paraAbrir.nombre} (hay ${numero(paraAbrir.stock[sucursal.id] ?? 0)}) y pasalo al pozo${cargaPozo ? ', o cargá el pozo' : ''}.`
                : cargaPozo
                  ? enPozo < 0
                    ? `Cargá el pozo: al menos ${cantidadDelPozo(-enPozo, pozo.porPeso)} para dejarlo en cero.`
                    : 'Cargá el pozo (o esperá la factura del proveedor).'
                  : 'Se carga con la factura del proveedor, o lo carga depósito.'}
            </Aviso>
          )}
        </div>
      )}

      <ul className="divide-y divide-black/[0.06]">
        {presentaciones.map((p) => (
          <FilaPresentacion
            key={p.id}
            p={p}
            porPeso={pozo.porPeso}
            sucursal={sucursal}
            puedeConfigurar={puedeConfigurar}
            bloqueada={bloqueada(p)}
            onArmar={() => onDialogo({ tipo: 'mover', modo: 'armar', pozoId: pozo.id, presentacionId: p.id })}
            onAbrir={() => onDialogo({ tipo: 'mover', modo: 'abrir', pozoId: pozo.id, presentacionId: p.id })}
            onEditar={() => onDialogo({ tipo: 'editar', pozoId: pozo.id, presentacionId: p.id })}
          />
        ))}
      </ul>

      {/* al pie de la lista: sumar otra forma de venderlo (solo quien configura) */}
      {puedeConfigurar && (
        <div className="border-t border-black/[0.06] px-4 py-3 sm:px-5">
          <Boton tamano="chico" variante="secundario" onClick={() => onDialogo({ tipo: 'presentacion', pozoId: pozo.id })}>
            Sumar presentación
          </Boton>
        </div>
      )}
    </Tarjeta>
  );
}

function FilaPresentacion({
  p,
  porPeso,
  sucursal,
  puedeConfigurar,
  bloqueada,
  onArmar,
  onAbrir,
  onEditar,
}: {
  p: Presentacion;
  porPeso: boolean;
  sucursal: Sucursal;
  puedeConfigurar: boolean;
  /** la planilla del sistema viejo le pisa el stock en esta sucursal */
  bloqueada: boolean;
  onArmar: () => void;
  onAbrir: () => void;
  onEditar: () => void;
}) {
  const armadas = Number(p.stock[sucursal.id] ?? 0);
  const alcanza = Number(p.alcanza[sucursal.id] ?? 0);
  return (
    <li className="px-4 py-3 sm:px-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="break-words font-semibold text-tinta">{p.nombre}</p>
          <p className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-tinta/60">
            <span>{p.sku}</span>
            <span>lleva {lleva(p, porPeso)}</span>
            <span className="importe">{p.precio != null ? pesos(p.precio) : 'sin precio'}</span>
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="importe text-xl font-semibold text-tinta">{numero(armadas)}</p>
          <p className="text-xs text-tinta/60">armadas</p>
        </div>
      </div>
      {/* celular: "alcanza para" y Editar arriba, Armar / Abrir abajo a lo ancho;
          escritorio: todo en una fila */}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {bloqueada ? (
          <Etiqueta tono="atencion" className="order-1">
            Stock del sistema viejo
          </Etiqueta>
        ) : (
          <Etiqueta tono={alcanza > 0 ? 'neutro' : 'atencion'} className="order-1">
            {alcanza > 0 ? `Alcanza para ${numero(alcanza)}` : 'El pozo no alcanza'}
          </Etiqueta>
        )}
        {puedeConfigurar && (
          <Boton tamano="chico" variante="fantasma" onClick={onEditar} className="order-2 ml-auto sm:order-3 sm:ml-0" aria-label={`Editar ${p.nombre}`}>
            Editar
          </Boton>
        )}
        <div className="order-3 flex basis-full flex-wrap gap-2 sm:order-2 sm:ml-auto sm:basis-auto">
          <Boton tamano="chico" variante="secundario" onClick={onArmar} disabled={bloqueada} className="grow sm:grow-0">
            Armar
          </Boton>
          <Boton tamano="chico" variante="secundario" onClick={onAbrir} disabled={bloqueada || armadas < 1} className="grow sm:grow-0">
            Abrir y pasar al pozo
          </Boton>
        </div>
      </div>
    </li>
  );
}

// ------------------------------------------------------------------ historial

function Historial({
  sucursal,
  entradas,
  error,
  onReintentar,
}: {
  sucursal: Sucursal;
  entradas: EntradaHistorial[] | null;
  error: string | null;
  onReintentar: () => void;
}) {
  return (
    <Tarjeta relleno={false}>
      <TarjetaCabecera titulo={`Lo último en ${sucursal.nombre}`} sub="Lo que se armó, se abrió o se cargó al pozo, con quién y cuándo." />
      {error ? (
        <div className="p-4 sm:p-5">
          <Aviso tono="error" accion={<Boton tamano="chico" variante="secundario" onClick={onReintentar}>Reintentar</Boton>}>
            {error}
          </Aviso>
        </div>
      ) : entradas === null ? (
        <Cargando bloque />
      ) : (
        <TablaResponsiva
          sinMarco
          etiqueta={`Historial de fraccionamiento en ${sucursal.nombre}`}
          filas={entradas}
          claveFila="id"
          vacio={
            <Vacio
              titulo={`Todavía no se armó nada en ${sucursal.nombre}`}
              texto="Cada vez que alguien arme, abra una presentación o cargue el pozo, queda acá con su nombre."
            />
          }
          columnas={[
            {
              clave: 'que',
              titulo: 'Qué',
              principal: true,
              celda: (e) => (
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  <Etiqueta tono={TONO[e.tipo]}>{QUE[e.tipo]}</Etiqueta>
                  <span className="min-w-0 break-words">
                    {e.presentacion ? `${numero(e.paquetes)} × ${e.presentacion.nombre}` : e.pozo.nombre}
                    {e.motivo && <span className="text-tinta/60"> · {e.motivo}</span>}
                  </span>
                </div>
              ),
            },
            {
              clave: 'pozo',
              titulo: 'Pozo',
              importe: true,
              celda: (e) => `${e.tipo === 'armado' ? '−' : '+'}${cantidadDelPozo(e.unidades, e.pozo.porPeso, true)}`,
            },
            { clave: 'quien', titulo: 'Quién', celda: (e) => e.quien ?? '—' },
            { clave: 'cuando', titulo: 'Cuándo', celda: (e) => fechaHora(e.cuando) },
          ]}
          pie={<p className="text-xs text-tinta/60">Los movimientos completos de cada producto están en Stock › Movimientos.</p>}
        />
      )}
    </Tarjeta>
  );
}
