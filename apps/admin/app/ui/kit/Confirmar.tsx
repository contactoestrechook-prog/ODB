'use client';

import { useCallback, useRef, useState, type ReactNode } from 'react';
import { Boton } from './Boton';
import { Campo } from './Campo';
import { AreaTexto } from './AreaTexto';
import { Entrada } from './Entrada';
import { Modal } from './Modal';

export type CampoConfirmar = {
  etiqueta: string;
  placeholder?: string;
  /** No deja confirmar con el campo vacío. */
  obligatorio?: boolean;
  /** true: varias líneas (un motivo largo). */
  multilinea?: boolean;
  valorInicial?: string;
};

export type PropsConfirmar = {
  abierto: boolean;
  titulo: ReactNode;
  /** El texto que explica qué pasa si confirma. */
  children?: ReactNode;
  textoConfirmar?: string;
  textoCancelar?: string;
  /** Color del botón de confirmar: primario (rojo), peligro (anular, borrar) u ok (aprobar plata). */
  variante?: 'primario' | 'peligro' | 'ok';
  /** Pide un texto antes de confirmar (el motivo de un rechazo). Llega en onConfirmar. */
  campo?: CampoConfirmar;
  /** true: sin botón de cancelar (un aviso que solo se acepta). */
  soloAceptar?: boolean;
  /** Si devuelve una promesa, el botón queda "cargando" hasta que termine. */
  onConfirmar: (texto: string) => void | Promise<void>;
  onCancelar: () => void;
};

/**
 * Reemplaza a confirm(), alert() y prompt(): misma pregunta, pero con el
 * diseño del panel, botones de 44 px y sin bloquear la página.
 * Para usarlo con await, está useConfirmar() acá abajo.
 */
export function Confirmar({
  abierto,
  titulo,
  children,
  textoConfirmar = 'Confirmar',
  textoCancelar = 'Cancelar',
  variante = 'primario',
  campo,
  soloAceptar = false,
  onConfirmar,
  onCancelar,
}: PropsConfirmar) {
  const [texto, setTexto] = useState(campo?.valorInicial ?? '');
  const [trabajando, setTrabajando] = useState(false);
  const falta = Boolean(campo?.obligatorio) && texto.trim() === '';

  const confirmar = async () => {
    if (falta || trabajando) return;
    const r = onConfirmar(texto.trim());
    if (r && typeof (r as Promise<void>).then === 'function') {
      setTrabajando(true);
      try {
        await r;
      } finally {
        setTrabajando(false);
      }
    }
  };

  return (
    <Modal
      abierto={abierto}
      onCerrar={soloAceptar ? () => void confirmar() : onCancelar}
      titulo={titulo}
      ancho="chico"
      bloquearCierre={trabajando}
      pie={
        <>
          {!soloAceptar && (
            <Boton variante="secundario" onClick={onCancelar} disabled={trabajando}>
              {textoCancelar}
            </Boton>
          )}
          <Boton variante={variante} onClick={() => void confirmar()} cargando={trabajando} disabled={falta}>
            {textoConfirmar}
          </Boton>
        </>
      }
    >
      {children && <div className="text-sm leading-relaxed text-tinta/80">{children}</div>}
      {campo && (
        <form
          className={children ? 'mt-4' : undefined}
          onSubmit={(e) => {
            e.preventDefault();
            void confirmar();
          }}
        >
          <Campo etiqueta={campo.etiqueta} obligatorio={campo.obligatorio}>
            {campo.multilinea ? (
              <AreaTexto value={texto} onChange={(e) => setTexto(e.target.value)} placeholder={campo.placeholder} autoFocus rows={3} />
            ) : (
              <Entrada value={texto} onChange={(e) => setTexto(e.target.value)} placeholder={campo.placeholder} autoFocus />
            )}
          </Campo>
        </form>
      )}
    </Modal>
  );
}

type Pedido = Omit<PropsConfirmar, 'abierto' | 'onConfirmar' | 'onCancelar' | 'children'> & {
  texto?: ReactNode;
  resolver: (valor: string | null) => void;
};

export type OpcionesConfirmar = Omit<Pedido, 'resolver' | 'campo' | 'soloAceptar'>;

/**
 * Para reemplazar confirm()/alert()/prompt() sin reescribir la lógica:
 *
 *   const { confirmar, pedirTexto, avisar, dialogo } = useConfirmar();
 *   if (!(await confirmar({ titulo: '¿Anular la factura?', variante: 'peligro', textoConfirmar: 'Anular' }))) return;
 *   const motivo = await pedirTexto({ titulo: 'Rechazar', campo: { etiqueta: 'Motivo', obligatorio: true } });
 *   await avisar({ titulo: 'Listo', texto: 'Se guardó el cambio.' });
 *   …
 *   return <>{…}{dialogo}</>;
 */
export function useConfirmar() {
  const [pedido, setPedido] = useState<Pedido | null>(null);
  // cada pedido lleva su número: así el campo de texto arranca vacío cada vez
  const [vez, setVez] = useState(0);
  // el pedido que está esperando respuesta: si llega otro antes (un doble
  // toque), el primero se contesta "cancelado" en vez de quedar colgado
  const pendiente = useRef<Pedido | null>(null);

  const abrir = useCallback((p: Pedido) => {
    pendiente.current?.resolver(null);
    pendiente.current = p;
    setVez((v) => v + 1);
    setPedido(p);
  }, []);

  const confirmar = useCallback(
    (op: OpcionesConfirmar) => new Promise<boolean>((resolver) => abrir({ ...op, resolver: (v) => resolver(v !== null) })),
    [abrir],
  );
  const pedirTexto = useCallback(
    (op: OpcionesConfirmar & { campo: CampoConfirmar }) => new Promise<string | null>((resolver) => abrir({ ...op, resolver })),
    [abrir],
  );
  const avisar = useCallback(
    (op: Omit<OpcionesConfirmar, 'textoCancelar'>) =>
      new Promise<void>((resolver) => abrir({ textoConfirmar: 'Entendido', ...op, soloAceptar: true, resolver: () => resolver() })),
    [abrir],
  );

  const terminar = (valor: string | null) => {
    if (pedido && pendiente.current === pedido) pendiente.current = null;
    pedido?.resolver(valor);
    setPedido(null);
  };

  const dialogo = (
    <Confirmar
      key={vez}
      abierto={pedido !== null}
      titulo={pedido?.titulo ?? ''}
      textoConfirmar={pedido?.textoConfirmar}
      textoCancelar={pedido?.textoCancelar}
      variante={pedido?.variante}
      campo={pedido?.campo}
      soloAceptar={pedido?.soloAceptar}
      onConfirmar={(t) => terminar(t)}
      onCancelar={() => terminar(null)}
    >
      {pedido?.texto}
    </Confirmar>
  );

  return { confirmar, pedirTexto, avisar, dialogo };
}
