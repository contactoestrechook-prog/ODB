import { RepartidoresService } from './repartidores.service';

// La autorización para la guardia del barrio la lee alguien de afuera: el
// vencimiento del seguro va como se lee acá ("30/09/2026"), no como lo guarda
// la base ("2026-09-30").

function armar(pedido: any) {
  const q: any = { select: () => q, eq: () => q, maybeSingle: () => Promise.resolve({ data: pedido, error: null }) };
  return new RepartidoresService({ from: () => q } as any);
}

describe('autorización para la guardia', () => {
  it('el vencimiento del seguro sale en dd/mm/aaaa y del día pactado', async () => {
    const svc = armar({
      id: 'p-1', destino_direccion: 'El Venado II lote 312', notas: null, forma_pago: null,
      repartidor: { nombre: 'Ezequiel Romero', dni: null, telefono: null },
      vehiculo: { tipo: 'moto', marca: 'Honda', modelo: 'Wave', patente: 'A123BCD', seguro_compania: 'Federación Patronal', seguro_poliza: 'FP-998877', seguro_vencimiento: '2026-09-30' },
    });
    const { texto } = await svc.autorizacion('p-1');
    expect(texto).toContain('Seguro: Federación Patronal — Póliza FP-998877 — Vence 30/09/2026');
    expect(texto).not.toContain('2026-09-30');
  });
});
