import Link from "next/link";

export function Footer() {
  return (
    <footer className="bg-ink text-crema/55 mt-24">
      <div className="max-w-7xl mx-auto px-5 lg:px-8 py-16">
        <div className="grid gap-12 md:grid-cols-[1.3fr_1fr_1fr_1.2fr]">
          <div>
            <div className="display text-3xl font-semibold text-crema">O.D.B</div>
            <div className="kicker text-dorado mt-1">Premium Market</div>
            <p className="mt-5 text-sm leading-relaxed text-crema/45 max-w-xs">
              Vinos, destilados, fiambrería de autor y almacén selecto. Curado con criterio, entregado con cuidado.
            </p>
          </div>

          <div>
            <p className="kicker text-crema/40 mb-4">Comprar</p>
            <ul className="space-y-2.5 text-sm">
              <li><Link href="/catalogo" className="hover:text-crema transition-colors">Catálogo completo</Link></li>
              <li><Link href="/catalogo?filtro=promo" className="hover:text-crema transition-colors">Ofertas</Link></li>
              <li><Link href="/cuenta" className="hover:text-crema transition-colors">Mi cuenta</Link></li>
            </ul>
          </div>

          <div>
            <p className="kicker text-crema/40 mb-4">Cómo recibís</p>
            <ul className="space-y-2.5 text-sm">
              <li>Envío a domicilio</li>
              <li>Retiro en el local</li>
              <li>Pago con Mercado Pago</li>
            </ul>
          </div>

          <div>
            <p className="kicker text-crema/40 mb-4">Comunidad ODB</p>
            <p className="text-sm leading-relaxed text-crema/45">
              Verificá tu identidad y accedé a precios de socio, prioridad en envíos y puntos en cada compra.
            </p>
            <Link href="/ingresar" className="inline-flex items-center gap-2 mt-4 text-sm text-dorado-claro hover:text-dorado transition-colors">
              Sumarme <span aria-hidden>→</span>
            </Link>
          </div>
        </div>

        <div className="rule mt-14 mb-6" />
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-crema/35">
          <p>© {new Date().getFullYear()} O.D.B Premium Market</p>
          <p className="tracking-wide">Beber con moderación · Prohibida su venta a menores de 18 años</p>
        </div>
      </div>
    </footer>
  );
}
