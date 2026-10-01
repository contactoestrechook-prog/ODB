import { Pantalla } from '../ui/kit/Pantalla';
import { Aviso, Etiqueta, TablaResponsiva, Tarjeta, TarjetaCabecera } from '../ui/kit';
import { pesos } from '../lib/formato';
import { apiFetch } from '../../lib/api';
import { PromosWorkspace } from '../ui/PromosWorkspace';
import { BotonPromo } from '../ui/BotonPromo';

export const dynamic = 'force-dynamic';

export default async function Promociones() {
  let descuentos: any[] = [];
  let segmentosData: any = { ticketGeneral: 0, segmentos: [] };
  let filtros: any = { categorias: [], marcas: [] };
  let candidatos: any[] = [];
  let error: string | null = null;
  try {
    const [rd, rs, rf, rc] = await Promise.all([
      apiFetch('/descuentos'),
      apiFetch('/descuentos/segmentos'),
      apiFetch('/catalogo/filtros'),
      apiFetch('/estadisticas/promocionables'),
    ]);
    if (!rd.ok) throw new Error(`API respondió ${rd.status}`);
    descuentos = await rd.json();
    if (rs.ok) segmentosData = await rs.json();
    if (rf.ok) filtros = await rf.json();
    if (rc.ok) candidatos = await rc.json();
  } catch (e) {
    error = e instanceof Error ? e.message : 'Error desconocido';
  }

  const orden = { vigente: 0, programado: 1, vencido: 2, inactivo: 3 } as const;
  descuentos.sort((a, b) => (orden[a.estado as keyof typeof orden] ?? 9) - (orden[b.estado as keyof typeof orden] ?? 9));

  return (
    <Pantalla activo="/promociones">
      {error ? (
        <Aviso tono="error">No pude consultar la API ({error}).</Aviso>
      ) : (
        <>
          <PromosWorkspace
            descuentos={descuentos}
            segmentos={segmentosData.segmentos}
            ticketGeneral={segmentosData.ticketGeneral}
            categorias={filtros.categorias}
            marcas={filtros.marcas}
          />

          {candidatos.length > 0 && (
            <Tarjeta relleno={false}>
              <TarjetaCabecera
                titulo="Ideales para promocionar"
                sub="hay que moverlos y el margen banca el descuento"
              />
              <TablaResponsiva
                sinMarco
                etiqueta="Ideales para promocionar"
                filas={candidatos}
                claveFila="sku"
                columnas={[
                  {
                    clave: 'producto',
                    titulo: 'Producto',
                    principal: true,
                    celda: (p: any) => (
                      <>
                        <p className="break-words text-sm">{p.nombre}</p>
                        <p className="text-xs font-normal text-tinta/60">
                          {p.sku} · {p.stockTotal} u. · <span className="importe">{pesos(p.capital)}</span> inmovilizados
                        </p>
                      </>
                    ),
                  },
                  {
                    clave: 'motivos',
                    titulo: 'Motivos',
                    celda: (p: any) => (
                      <div className="flex flex-wrap gap-1 md:justify-end">
                        {p.motivos.map((m: string) => (
                          <Etiqueta key={m} tono={m.startsWith('vence') ? 'atencion' : 'neutro'}>
                            {m}
                          </Etiqueta>
                        ))}
                      </div>
                    ),
                  },
                  {
                    clave: 'margen',
                    titulo: 'Margen',
                    importe: true,
                    celda: (p: any) => <span className="text-xs text-tinta/60">margen {Math.round(p.margenPct)} %</span>,
                  },
                  {
                    clave: 'acciones',
                    titulo: '',
                    acciones: true,
                    celda: (p: any) => <BotonPromo sku={p.sku} nombre={p.nombre} porcentaje={p.descuentoSugerido} />,
                  },
                ]}
              />
            </Tarjeta>
          )}
        </>
      )}
    </Pantalla>
  );
}
