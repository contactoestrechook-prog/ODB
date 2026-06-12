import Link from 'next/link';

const tabs = [
  { href: '/ventas', label: 'Ventas' },
  { href: '/estadisticas', label: 'Estadísticas' },
  { href: '/informes', label: 'Informe' },
  { href: '/productos', label: 'Productos' },
  { href: '/stock', label: 'Stock' },
  { href: '/promociones', label: 'Promociones' },
  { href: '/compras', label: 'Compras' },
  { href: '/listas', label: 'Listas' },
  { href: '/clientes', label: 'Clientes' },
  { href: '/deposito', label: 'Depósito' },
  { href: '/cierres', label: 'Cierres' },
  { href: '/caja', label: 'Caja' },
  { href: '/salida', label: 'Salida' },
  { href: '/sommelier', label: 'Somelier' },
  { href: '/analista', label: 'Analista' },
];

export function Header({ activo }: { activo: string }) {
  return (
    <header className="bg-black px-6 py-3 flex items-center justify-between gap-4">
      <h1 className="text-white tracking-widest font-medium whitespace-nowrap">
        O.D.B
      </h1>
      <nav className="flex gap-4 text-sm overflow-x-auto whitespace-nowrap py-1">
        {tabs.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className={
              t.href === activo
                ? 'text-white border-b-2 border-[#B82D25] pb-0.5'
                : 'text-[#F0EBE2]/70 hover:text-white'
            }
          >
            {t.label}
          </Link>
        ))}
        <a href="/api/salir" className="text-[#F0EBE2]/50 hover:text-white" title="Cerrar sesión">
          Salir
        </a>
      </nav>
    </header>
  );
}
