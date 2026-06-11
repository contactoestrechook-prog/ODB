import Link from 'next/link';

const tabs = [
  { href: '/ventas', label: 'Ventas' },
  { href: '/productos', label: 'Productos' },
  { href: '/stock', label: 'Stock' },
  { href: '/promociones', label: 'Promociones' },
  { href: '/compras', label: 'Compras' },
  { href: '/listas', label: 'Listas' },
  { href: '/cierres', label: 'Cierres' },
  { href: '/caja', label: 'Caja' },
  { href: '/sommelier', label: 'Somelier' },
  { href: '/analista', label: 'Analista' },
];

export function Header({ activo }: { activo: string }) {
  return (
    <header className="bg-black px-6 py-3 flex items-center justify-between">
      <h1 className="text-white tracking-widest font-medium">
        O.D.B{' '}
        <span className="text-[#F0EBE2]/70 text-sm tracking-normal font-normal">
          · Panel administrativo
        </span>
      </h1>
      <nav className="flex gap-4 text-sm">
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
