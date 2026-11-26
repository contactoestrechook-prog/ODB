import type { Metadata, Viewport } from "next";
import { Figtree } from "next/font/google";
import "./globals.css";
import { BannerInstalarApp } from "./ui/BannerInstalarApp";
import { AvisoActualizacion } from "./ui/AvisoActualizacion";
import { ReportarProblema } from "./ui/ReportarProblema";
import { AvisoPedidosSinAviso } from "./ui/AvisoPedidosSinAviso";
import { AvisoPedidoNuevo } from "./ui/AvisoPedidoNuevo";
import { AvisoTeTocaArmar } from "./ui/AvisoTeTocaArmar";
import { AvisoConsultasArmado } from "./ui/AvisoConsultasArmado";
import { AvisoFiambreria } from "./ui/AvisoFiambreria";
import { AvisoPreguntaCliente } from "./ui/AvisoPreguntaCliente";
import { AvisoSonidoApagado } from "./ui/AvisoSonidoApagado";
import { PilaAvisos } from "./ui/PilaAvisos";
import { AvisoFacturaAMedias } from "./ui/AvisoFacturaAMedias";
import { cookies } from "next/headers";
import { datosDesdeToken, esEncerrado, rolesDesdeToken, sucursalDesdeToken } from "./lib/permisos";

// Quién puede tocar «Lo tomo» en «Llegó un pedido» (6/10/2026): los que pueden tomarlo y
// prepararlo. LA VENTANA Y LA ALARMA SALEN EN TODAS LAS MÁQUINAS CON SESIÓN, de cualquier rol
// y sucursal (regla con candado, 21/11/2026: «en todas las máquinas, sin excepción»).
const ATIENDEN_PEDIDOS = ["dueno", "gerente", "cajero", "deposito"];
// A quién se le puede asignar un armado y tiene más pantallas que Salón: le sale
// «Te toca armar» donde esté (los mismos roles que la API deja leer /salon/pedidos).
const PUEDEN_ARMAR = ["dueno", "gerente", "cajero", "deposito", "op_salon"];
// Del lado de la caja en la charla de un pedido: los que manejan los pedidos de
// todos (la misma lista que la API, salon/consultas.ts).
const MANEJAN_PEDIDOS = ["dueno", "gerente", "administrativo", "cajero"];
// Las preguntas de los clientes que el bot no sabe contestar (21/11/2026: «que no suene más
// en administración… que siempre suene a caja, con mucho sonido»): la caja, y los dueños y
// gerentes, que ven todo. Administrativo no: ya no le llegan.
const CONTESTAN_PREGUNTAS = ["dueno", "gerente", "cajero"];

// La letra del panel (decisión del dueño, octubre 2026): más suave que Arial y
// angosta, así no aparecen desbordes nuevos. next/font la sirve desde el mismo
// dominio (no pide nada a Google en el navegador) y la deja en --font-figtree,
// que globals.css usa como --font-sans.
const figtree = Figtree({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-figtree",
  display: "swap",
});

export const metadata: Metadata = {
  title: "O.D.B Premium Market",
  description: "Panel de gestión de O.D.B Premium Market",
  // PWA: con esto el panel se puede instalar como app (escritorio y celular)
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/icon-192.png",
    apple: "/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    title: "O.D.B",
    statusBarStyle: "black-translucent",
  },
};

// themeColor: el negro único del sistema (tinta). viewportFit 'cover': la app
// instalada en el iPhone dibuja también debajo de la barra de estado y del
// gesto de inicio; las barras usan env(safe-area-inset-*) para no quedar tapadas.
export const viewport: Viewport = {
  themeColor: "#141414",
  viewportFit: "cover",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const token = (await cookies()).get("odb_token")?.value;
  // todos sus roles (19/11/2026)
  const roles = rolesDesdeToken(token);
  const encerrado = esEncerrado(roles);
  return (
    <html lang="es" className={`${figtree.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        {/* op salón y fiambrería: solo su pantalla, sin avisos ni botones del resto del sistema (5/11/2026) */}
        {!encerrado && <AvisoPedidosSinAviso />}
        {children}
        {/* La pila de avisos de pedidos: en el celular baja debajo de la barra negra,
            a lo ancho; en escritorio, abajo a la derecha (arriba tapaba los botones
            de cada pantalla). La caja vacía no se ve ni frena los toques.
            Con una ventana abierta (una factura, un cobro) NO se esconde: sale encima y
            se achica a una solapa (26/11/2026, Juan Pablo: «que la consulta o pedido
            salga, esté donde esté»). Ver ui/PilaAvisos.tsx. */}
        <PilaAvisos className="pila-avisos pointer-events-none fixed inset-x-0 top-(--alto-barra-movil) z-aviso flex flex-col gap-2 px-3 pt-2 *:pointer-events-auto lg:inset-x-auto lg:bottom-4 lg:right-4 lg:top-auto lg:w-[21rem] lg:px-0 lg:pt-0">
          {/* lo que un cliente preguntó y el bot no sabe: suena en la caja hasta que alguien lo contesta (21/11/2026) */}
          {!encerrado && roles.some((r) => CONTESTAN_PREGUNTAS.includes(r)) && <AvisoPreguntaCliente sucursalId={sucursalDesdeToken(token)} />}
          {/* a quien le asignan un pedido para armar, en cualquier pantalla (21/11/2026) */}
          {!encerrado && roles.some((r) => PUEDEN_ARMAR.includes(r)) && <AvisoTeTocaArmar />}
          {/* lo que quien arma le pregunta a la caja, y los pedidos que devuelve (21/11/2026) */}
          {roles.some((r) => MANEJAN_PEDIDOS.includes(r)) && <AvisoConsultasArmado sucursalId={sucursalDesdeToken(token)} miId={datosDesdeToken(token).sub} />}
          {/* REGLA CON CANDADO (21/11/2026): en todas las máquinas con sesión, sin filtro de rol */}
          {token && <AvisoSonidoApagado />}
          {token && <AvisoPedidoNuevo sucursalId={sucursalDesdeToken(token)} puedeTomar={roles.some((r) => ATIENDEN_PEDIDOS.includes(r))} />}
          {/* la factura que quedó a medias (se salió, se cortó la luz): «Seguir» la deja como estaba (26/11/2026) */}
          {token && !encerrado && <AvisoFacturaAMedias />}
        </PilaAvisos>
        {/* fiambrería: la ventana de lo que tiene que preparar de cada pedido (19/11/2026) */}
        {roles.includes("fiambreria") && <AvisoFiambreria />}
        <AvisoActualizacion />
        <BannerInstalarApp />
        {!encerrado && <ReportarProblema />}
      </body>
    </html>
  );
}
