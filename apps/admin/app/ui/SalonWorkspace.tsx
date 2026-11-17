'use client';

import { useState } from 'react';
import { Etiqueta, Pestanas } from './kit';
import { Armar } from './salon/Armar';
import { Stock } from './salon/Stock';
import { Puerta } from './salon/Puerta';
import type { Sucursal } from './salon/comun';

// SALÓN (op salón, 5/11/2026; rediseño del 17/11/2026: «pantalla digna»).
//  · Armar pedidos: para el op salón, los suyos (con la comanda en la mano, va
//    sumando al carro y se mide). Para los que mandan, la sala de control: qué
//    espera armador, quién arma qué y por dónde va, la mesa de retiro y la gente.
//  · Stock y ubicación: dónde está cada producto; se carga por categoría.
//  · Puerta de depósito: lo que baja con remito espera la factura; no suma al
//    stock hasta que administración lo confirma.
// Las piezas están en ./salon/.

type Vista = 'armar' | 'stock' | 'puerta';

export function SalonWorkspace({ proveedores, sucursales, sucursalPropia, verTodos }: {
  proveedores: { id: string; nombre: string }[];
  sucursales: Sucursal[];
  sucursalPropia: string | null;
  /** dueño, gerente, depósito, caja: ven los pedidos de todos */
  verTodos: boolean;
}) {
  const [vista, setVista] = useState<Vista>('armar');
  const [pendientes, setPendientes] = useState<number | undefined>(undefined);
  return (
    <div className="space-y-5">
      <Pestanas<Vista>
        etiquetaAccesible="Secciones del salón"
        valor={vista}
        onCambiar={setVista}
        aLoAncho={!verTodos}
        opciones={[
          { valor: 'armar', etiqueta: verTodos ? 'Armado de pedidos' : 'Armar pedidos', cuenta: pendientes },
          { valor: 'stock', etiqueta: 'Stock y ubicación' },
          { valor: 'puerta', etiqueta: 'Puerta de depósito' },
        ]}
      />
      {vista === 'armar' && <Armar verTodos={verTodos} sucursales={sucursales} onCuenta={setPendientes} irAStock={() => setVista('stock')} />}
      {vista === 'stock' && <Stock sucursalPropia={sucursalPropia} />}
      {vista === 'puerta' && <Puerta proveedores={proveedores} sucursales={sucursales} sucursalPropia={sucursalPropia} />}
    </div>
  );
}

// También lo usa Compras › Puerta de depósito (PuertaDepositoAdmin).
export function EstadoIngreso({ estado }: { estado: string }) {
  if (estado === 'ingresado') return <Etiqueta tono="ok">En stock</Etiqueta>;
  if (estado === 'rechazado') return <Etiqueta tono="error">Rechazado</Etiqueta>;
  return <Etiqueta tono="atencion" punto>Espera factura</Etiqueta>;
}
