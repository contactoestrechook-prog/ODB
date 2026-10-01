// Kit de componentes del panel. Guía: app/ui/kit/LEEME.md.
//
// Se importa todo de acá:  import { Boton, Tarjeta, Monto } from '../ui/kit';
// Única excepción: <Pantalla> (usa la cabecera, que lee la sesión en el
// servidor) se importa de su archivo y solo desde page.tsx:
//   import { Pantalla } from '../ui/kit/Pantalla';
// Si estuviera acá, cualquier componente 'use client' que importe el kit
// arrastraría código de servidor y el build fallaría.

export { Boton, BotonLink, clasesBoton } from './Boton';
export type { VarianteBoton, TamanoBoton, PropsBoton, PropsBotonLink } from './Boton';

export { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from './Tarjeta';
export { Kpi } from './Kpi';
export type { TonoKpi } from './Kpi';

export { Campo, useCampo } from './Campo';
export { Entrada } from './Entrada';
export type { PropsEntrada } from './Entrada';
export { Selector } from './Selector';
export type { OpcionSelector, PropsSelector } from './Selector';
export { AreaTexto } from './AreaTexto';
export type { PropsAreaTexto } from './AreaTexto';
export { CLASES_ENTRADA } from './estilosCampo';

export { Etiqueta } from './Etiqueta';
export type { TonoEtiqueta } from './Etiqueta';
export { Aviso } from './Aviso';
export type { TonoAviso } from './Aviso';

export { Modal } from './Modal';
export type { AnchoModal } from './Modal';
export { Confirmar, useConfirmar } from './Confirmar';
export type { PropsConfirmar, CampoConfirmar, OpcionesConfirmar } from './Confirmar';

export { TablaResponsiva } from './TablaResponsiva';
export type { ColumnaTabla } from './TablaResponsiva';

export { Pestanas } from './Pestanas';
export type { OpcionPestana } from './Pestanas';
export { Chips, Chip } from './Chips';
export type { OpcionChip } from './Chips';

export { Vacio } from './Vacio';
export { Cargando, Girador } from './Cargando';
export { BarraInferior } from './BarraInferior';
export { Monto } from './Monto';

export { IconoAtencion, IconoCerrar, IconoError, IconoFlechaAbajo, IconoInfo, IconoOk, IconoVacio } from './iconos';

export { unir, FOCO, FOCO_ADENTRO, ROTULO } from './clases';
