# Kit del panel ODB

Guía para migrar las pantallas al rediseño (octubre 2026). Todo lo que hace falta para que una pantalla se vea igual que el resto, entre en el ancho del celular y use la letra nueva está acá.

- Componentes: `app/ui/kit/` (un archivo por componente). Se importan de `../ui/kit` (o la ruta relativa que corresponda).
- Formatos (plata, fechas): `app/lib/formato.ts`.
- Tokens (colores, sombras, capas): `app/globals.css`, bloque `@theme`.
- Rutas sin flotantes (login y compañía): `app/lib/rutas.ts`.

```tsx
import { Boton, Tarjeta, TablaResponsiva, Monto } from '../ui/kit';
import { Pantalla } from '../ui/kit/Pantalla'; // solo en page.tsx (ver abajo)
import { pesos, fecha } from '../lib/formato';
```

> **`<Pantalla>` no está en `index.ts`.** Usa la cabecera, que lee la sesión en el servidor. Si estuviera en el índice, cualquier componente `'use client'` que importe el kit arrastraría código de servidor y el build fallaría. Se importa directo desde `kit/Pantalla`, y solo en `page.tsx`.

---

## 1. Reglas de estilo

### Prohibido en las pantallas

| No | Sí |
|---|---|
| `text-[11px]`, `text-[13px]` y cualquier `text-[Npx]` | La escala: `text-xs` (12 px) es el piso |
| Colores en hex: `bg-[#B82D25]`, `text-[#932A1F]`, `bg-[#F0EBE2]`… | Los tokens: `bg-marca`, `text-marca-hondo`, `bg-crema`… |
| `text-black/40`, `/45`, `/50`, `/35`… (13 grises distintos) | Tres niveles: `text-tinta`, `text-tinta/70`, `text-tinta/60` |
| Verdes, ámbares y celestes de Tailwind (`emerald-700`, `amber-500`, `sky-…`, `red-700`) | `ok`, `atencion`, `info`, `marca-hondo` |
| `bg-black` o `neutral-800` como botón | `<Boton>`; el negro ya no es botón |
| `font-black` | `font-bold` como máximo |
| `rounded`, `rounded-md`, `rounded-lg` | `rounded-full` (botones, chips), `rounded-xl` (campos, imágenes), `rounded-2xl` (tarjetas, modales) |
| `shadow-lg`, `shadow-xl`, `shadow-[0_20px_60px…]` | `shadow-tarjeta` o `shadow-flotante` |
| `min-h-screen`, `h-screen`, `max-h-[92vh]` | `min-h-dvh`, `h-dvh`, `max-h-[92dvh]` |
| `z-[90]`, `z-50` sueltos en flotantes | La escala de capas (`z-modal`, `z-aviso`…) |
| `confirm()`, `alert()`, `prompt()` | `useConfirmar()` |
| `fixed inset-0` a mano para una ventana | `<Modal>` |
| `<table>` suelta | `<TablaResponsiva>` |
| `const pesos = …` propio | `pesos()` de `formato.ts` o `<Monto>` |
| Emojis o glifos como ícono de botón (✕ ✓ ⚠ 🖨) | Un SVG de línea (ver `kit/iconos.tsx`) o solo texto |

La única excepción a la letra: la etiqueta térmica de `VerificadorPrecios.tsx` sigue en Arial (estilo en línea), y el ticket de Caja en monoespaciada.

### Botones: rojo y verde

- **Rojo (`primario`)**: la acción principal de la zona. Una sola por tarjeta o por modal: Guardar, Cobrar, Emitir, Enviar.
- **Verde (`ok`)**: **solo** para aprobar o acreditar plata: Aprobar pago, Acreditar, Firmar la cobranza. Nada más es verde.
- **Blanco con borde (`secundario`)**: Cancelar, Volver, Exportar, Imprimir, Reintentar.
- **`fantasma`**: acciones livianas dentro de listas (Ver, Editar).
- **`peligro`** (borde y texto rojos): Anular, Borrar, Rechazar. No es sólido, para no confundirse con el primario.
- **Negro: nunca.**

### Colores (tokens de `@theme`)

| Token | Para qué | Ojo |
|---|---|---|
| `marca` `#B82D25` | Acción principal, foco, ítem activo del menú | No para datos normales: si todo es rojo, el rojo deja de avisar |
| `marca-hondo` `#932A1F` | Hover del rojo y **texto de error** | |
| `marca-suave` `#F7E9E7` | Fondo de error o alerta | Reemplaza `#FDF3F2` y `bg-[#B82D25]/10` |
| `tinta` `#141414` | Texto principal y el **único negro**: menú, barra del celular, flotantes | |
| `tinta-2` `#1F1B18` | Tarjetas sobre fondo oscuro (Inicio, mientras siga oscura) | |
| `crema` `#F0EBE2` | Fondo de la app (ya lo tiene `<body>`) | |
| `crema-claro` `#F7F4EE` | Fondo de campos y hover de filas | |
| `crema-hondo` `#E6DFD3` | Divisor sobre crema, chip inactivo, contador | |
| `dorado` `#C9A96E` | Acento **solo sobre oscuro** (premium, mayorista) | Sobre claro da 2,2:1: nunca texto sobre claro |
| `dorado-hondo` `#7A5E2E` | Texto dorado sobre claro | |
| `ok` / `ok-suave` | Cobrado, acreditado, aprobado | |
| `atencion` / `atencion-suave` | Pendiente, por vencer | No usar `#B77B00` como texto (3,6:1) |
| `info` / `info-suave` | Informativo, en camino | |

**Grises de texto (tres, no trece):**

| Nivel | Clase | Contraste sobre blanco |
|---|---|---|
| Principal | `text-tinta` | 18,4:1 |
| Secundario | `text-tinta/70` | 6,8:1 |
| Apagado (el mínimo para texto) | `text-tinta/60` | 4,8:1 |

`text-tinta/40` solo para placeholders y campos desactivados. Sobre fondo oscuro: `text-white`, `text-white/70` y `text-white/55` como mínimo (nunca `/30`).

**Bordes (dos):** divisor `border-black/[0.06]`; borde de control (campos, botón secundario) `border-black/15`.

### Radios, sombras y espacios

- Radios: botones y chips `rounded-full`; campos e imágenes `rounded-xl`; tarjetas y modales `rounded-2xl`; hoja inferior `rounded-t-3xl`.
- Sombras: `shadow-tarjeta` (tarjetas) y `shadow-flotante` (modales, menús desplegables, flotantes).
- Página: `px-4 sm:px-6 lg:px-8` (lo pone `<Pantalla>`).
- Tarjeta: `p-4 sm:p-5`. Entre bloques: `space-y-4 sm:space-y-6` (lo pone `<Pantalla>` entre sus hijos). Fila de lista: `px-4 py-3`. Formularios: `gap-3`.
- Alto táctil en el celular: botones y campos `min-h-11` (44 px); chips `min-h-9`. Los componentes del kit ya lo cumplen.
- Foco visible (con teclado): contorno rojo de 2 px separado del borde, `FOCO` de `kit/clases.ts` (`focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marca`, 6:1 sobre blanco). Dentro de una fila con scroll, donde el de afuera queda cortado: `FOCO_ADENTRO` (contorno hacia adentro). Campos: borde `marca` entero más el halo `ring-4 ring-marca/15`. Sobre oscuro (menú): `ring-2 ring-white/50`. **No** usar solo `ring-marca/15` en botones: da 1,3:1 y no se ve.
- Al tocar: `active:scale-[0.98]` (ya está en botones y chips).

### Escala tipográfica (Figtree)

| Tamaño | Clase | Uso | Peso |
|---|---|---|---|
| 12 px | `text-xs` | Piso. Rótulos, chips, ayudas | 500/600 |
| 14 px | `text-sm` | Texto de trabajo, tablas, botones | 400/500 |
| 16 px | `text-base` | Campos en el celular, títulos de tarjeta | 600 |
| 18 px | `text-lg` | Títulos de modal y de sección | 600 |
| 20 px | `text-xl` | h1 de pantalla, KPI en el celular | 700 |
| 24 px | `text-2xl` | KPI en escritorio | 600 |
| 36–48 px | `text-4xl` / `text-5xl` | Solo el total de Caja y el precio del verificador | 700 |

- Rótulo en mayúsculas (cabecera de tabla, etiqueta de KPI): `text-xs font-semibold uppercase tracking-[0.08em] text-tinta/60` (está como `ROTULO` en `kit/clases.ts`).
- **Importes**: siempre con la clase `importe` (cifras del mismo ancho y sin cortar en dos renglones). `<Monto>` ya la pone.
- Los campos miden 16 px en el celular aunque tengan `text-sm`: lo fuerza `globals.css` (si no, el iPhone agranda la página al tocarlos). No hace falta hacer nada.

### Capas (z-index)

Una sola escala. Clases: `z-contenido` (10), `z-barra-inferior` (30), `z-barra` (40), `z-cajon` (50), `z-modal` (60), `z-aviso` (70), `z-toast` (80). Variables: `--z-index-*`.

- Algo `sticky` que tiene que quedar debajo de la barra negra del celular: `sticky top-(--alto-barra-movil) lg:top-0`.
- Algo fijo abajo: respetar el gesto del iPhone con `pb-[max(0.75rem,env(safe-area-inset-bottom))]`. Mejor: usar `<BarraInferior>`.

---

## 2. Componentes

Todos menos `Modal` y `Confirmar` aceptan `className` **para ubicarlos** (márgenes, ancho, grilla), no para cambiarles el estilo: las clases no se pisan entre sí (ver `unir` en Utilidades).

Servidor o cliente: `Campo`, `Entrada`, `Selector`, `AreaTexto`, `Modal`, `Confirmar`/`useConfirmar` y `BarraInferior` son componentes de cliente. El resto sirve en los dos; pero un `onClick` solo se puede pasar desde un componente `'use client'` (en una `page.tsx` usá `href`).

### `<Pantalla>` — el marco de cada page.tsx

```ts
{ activo: string; ancho?: 'angosto' | 'normal' | 'ancho'; titulo?: string; bajada?: string; sinCabecera?: boolean; className?: string; children }
```

- `activo`: la ruta de la sección (marca el menú y elige el título de `TITULOS` en `Header.tsx`).
- `ancho`: `angosto` = `max-w-3xl` (formularios), `normal` = `max-w-5xl` (por defecto), `ancho` = `max-w-7xl` (tablas anchas, tableros).
- `titulo`/`bajada`: pisan los de la sección (fichas: "Malbec Reserva 750").
- Pone `min-h-dvh bg-crema lg:pl-64`, el menú, la cabecera, `px-4 sm:px-6 lg:px-8`, `pb-24 lg:pb-10` (lugar para "Esto está mal") y `space-y-4 sm:space-y-6` entre hijos.

```tsx
// antes
<main className="min-h-screen bg-[#F0EBE2] lg:pl-64">
  <Header activo="/ventas" />
  <div className="max-w-5xl mx-auto p-6"><VentasWorkspace … /></div>
</main>

// después
<Pantalla activo="/ventas">
  <VentasWorkspace … />
</Pantalla>
```

Si la pantalla tenía su propio `<h1>` y la ruta ya está en `TITULOS`, sacalo: el título lo pone la cabecera (en el celular, la barra negra).

### `<Boton>`, `<BotonLink>`, `clasesBoton()`

```ts
Boton: props de <button> + { variante?: 'primario' | 'secundario' | 'fantasma' | 'peligro' | 'ok'; tamano?: 'chico' | 'normal';
         cargando?: boolean; anchoCompleto?: boolean; icono?: ReactNode; iconoDerecha?: ReactNode }
BotonLink: props de <Link> + las mismas opciones (sin cargando)
clasesBoton({ variante, tamano, anchoCompleto, className }): string   // para <a download> o <label> de archivo
```

- Por defecto `type="button"`; para enviar un formulario, `type="submit"`.
- `cargando`: ruedita, desactivado y `aria-busy`.
- `normal`: 44 px en el celular, 40 en escritorio. `chico`: 36/32 px, con la zona táctil estirada a 44 en el celular.
- Foco: contorno rojo (verde en `ok`), solo con teclado.

```tsx
<Boton onClick={guardar} cargando={guardando}>Guardar</Boton>
<Boton variante="secundario" onClick={cerrar}>Cancelar</Boton>
<Boton variante="ok" onClick={aprobar}>Aprobar pago</Boton>
<Boton variante="peligro" tamano="chico" onClick={anular}>Anular</Boton>
<BotonLink href="/compras?nueva=1">Nueva orden</BotonLink>
<label className={clasesBoton({ variante: 'secundario' })}>Subir foto<input type="file" className="sr-only" onChange={…} /></label>
```

- Para el `<label>` de archivo, el input va con `sr-only`, **no** con `hidden`: con `hidden` no se llega con el teclado. `clasesBoton` ya dibuja el contorno de foco cuando lo tiene el input de adentro.

### `<Tarjeta>`, `<TarjetaCabecera>`, `<TarjetaCuerpo>`

```ts
Tarjeta: props de <section> + { relleno?: boolean }       // relleno p-4 sm:p-5 (por defecto true)
TarjetaCabecera: { titulo; sub?; accion?; nivel?: 2 | 3; className? }
TarjetaCuerpo: props de <div>                               // p-4 sm:p-5
```

```tsx
<Tarjeta>Contenido simple</Tarjeta>

<Tarjeta relleno={false}>
  <TarjetaCabecera titulo="Cheques en cartera" sub="12 por $3.450.000" accion={<Boton tamano="chico">Cargar cheque</Boton>} />
  <TarjetaCuerpo>…</TarjetaCuerpo>
</Tarjeta>
```

### `<Kpi>`

```ts
{ etiqueta: ReactNode; valor: ReactNode; sub?: ReactNode; tono?: 'neutro' | 'ok' | 'atencion' | 'error' | 'info'; className? }
```

El tono pinta solo la cifra. La cifra se corta con "…" antes de salirse.

```tsx
<div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
  <Kpi etiqueta="Facturado hoy" valor={<Monto valor={resumen.facturado} />} sub={`${resumen.tickets} tickets`} />
  <Kpi etiqueta="Por cobrar" valor={<Monto valor={porCobrar} />} tono="atencion" />
</div>
```

### `<Campo>` + `<Entrada>`, `<Selector>`, `<AreaTexto>`

```ts
Campo: { etiqueta: ReactNode; ayuda?: ReactNode; error?: ReactNode; obligatorio?: boolean; id?: string; className?; children }
Entrada: props de <input> + { prefijo?: ReactNode; sufijo?: ReactNode; invalido?: boolean }
Selector: props de <select> + { opciones?: { valor; etiqueta; deshabilitada? }[]; vacio?: string; invalido?: boolean }
AreaTexto: props de <textarea> + { invalido?: boolean }        // rows=4 por defecto
CLASES_ENTRADA: string    // las clases de un <input> del kit, para un campo suelto en una page.tsx
```

- Dentro de `<Campo>`, el control toma solo el `id`, la ayuda/el error (`aria-describedby`), `aria-invalid` y `required` (si `obligatorio`).
- El `error` queda enlazado al campo (el lector de pantalla lo lee al enfocarlo), no se anuncia solo: si el error aparece al tocar Guardar, mostrá además un `<Aviso tono="error">`.
- Un solo control por `<Campo>` (el `id` es uno).
- 44 px de alto y 16 px de letra en el celular; 40 px y 14 px en escritorio.
- `className` va a la caja de afuera (en `Entrada` con prefijo/sufijo y en `Selector`, la caja es un `div`).

```tsx
<div className="grid gap-3 sm:grid-cols-2">
  <Campo etiqueta="CUIT" ayuda="Sin guiones" obligatorio>
    <Entrada inputMode="numeric" value={cuit} onChange={(e) => setCuit(e.target.value)} />
  </Campo>
  <Campo etiqueta="Importe" error={errorImporte}>
    <Entrada prefijo="$" inputMode="decimal" value={importe} onChange={…} />
  </Campo>
  <Campo etiqueta="Sucursal">
    <Selector vacio="Todas" opciones={sucursales.map((s) => ({ valor: s.id, etiqueta: s.nombre }))} value={suc} onChange={…} />
  </Campo>
  <Campo etiqueta="Nota" className="sm:col-span-2"><AreaTexto value={nota} onChange={…} /></Campo>
</div>
```

Campo sin rótulo visible (un buscador): `<Entrada aria-label="Buscar cheque" … />`.

### `<Etiqueta>` — chip de estado

```ts
{ tono?: 'ok' | 'atencion' | 'error' | 'info' | 'neutro'; punto?: boolean; className?; children }
```

```tsx
<Etiqueta tono="ok">Acreditado</Etiqueta>
<Etiqueta tono="atencion" punto>Pendiente</Etiqueta>
```

Un mismo medio o estado lleva **el mismo tono en todas las pantallas** (Getnet, Clover y Mercado Pago no cambian de color según la pantalla).

### `<Aviso>`

```ts
{ tono?: 'ok' | 'atencion' | 'error' | 'info' | 'neutro'; titulo?: ReactNode; accion?: ReactNode; className?; children? }
```

Los de error se anuncian enseguida (`role="alert"`). Reemplaza los `<p className="text-red-700">`, los `bg-[#EAF2E9]` y compañía.

```tsx
{error && <Aviso tono="error" titulo="No pude consultar la API" accion={<Boton tamano="chico" variante="secundario" onClick={reintentar}>Reintentar</Boton>}>{error}</Aviso>}
<Aviso tono="ok">Se guardó el cambio.</Aviso>
```

### `<Modal>`

```ts
{ abierto: boolean; onCerrar: () => void; titulo: ReactNode; descripcion?: ReactNode; pie?: ReactNode;
  ancho?: 'chico' | 'normal' | 'ancho'; bloquearCierre?: boolean; cerrarAlTocarAfuera?: boolean; sinRelleno?: boolean; children }
```

- Celular: hoja que sube desde abajo (`rounded-t-3xl`). Desde `sm`: ventana centrada. Alto máximo 90% de la pantalla visible (`dvh`).
- Cabecera y pie fijos; el medio scrollea. ✕ de 44 px, Escape y toque afuera cierran (salvo `bloquearCierre`, mientras se guarda).
- El foco queda adentro (Tab y Mayús+Tab dan la vuelta) y al cerrar vuelve al botón que lo abrió, también si un campo del modal tiene `autoFocus`. Se monta en `<body>` (no lo corta ningún `overflow` del padre).
- Mientras está abierto, la página de atrás no scrollea y se esconden los flotantes ("Esto está mal", instalar, actualización).
- En el celular, los botones del pie se reparten el ancho.
- `cerrarAlTocarAfuera={false}` en formularios largos (un toque perdido haría perder lo cargado).

```tsx
<Modal
  abierto={abierto}
  onCerrar={() => setAbierto(false)}
  titulo="Recibir la orden #1234"
  descripcion="Distribuidora del Sur · 12 renglones"
  bloquearCierre={guardando}
  pie={<>
    <Boton variante="secundario" onClick={() => setAbierto(false)}>Cancelar</Boton>
    <Boton onClick={recibir} cargando={guardando}>Recibir</Boton>
  </>}
>
  …
</Modal>
```

### `<Confirmar>` y `useConfirmar()` — en lugar de confirm/alert/prompt

```ts
Confirmar: { abierto; titulo; children?; textoConfirmar?; textoCancelar?; variante?: 'primario' | 'peligro' | 'ok';
             campo?: { etiqueta; placeholder?; obligatorio?; multilinea?; valorInicial? }; soloAceptar?: boolean;
             onConfirmar: (texto: string) => void | Promise<void>; onCancelar: () => void }

useConfirmar(): { confirmar(op): Promise<boolean>; pedirTexto(op & { campo }): Promise<string | null>; avisar(op): Promise<void>; dialogo: ReactNode }
// op = { titulo; texto?; textoConfirmar?; textoCancelar?; variante? }
```

La forma más corta de migrar: casi no cambia la lógica. Si se pide uno nuevo antes de contestar el anterior (doble toque), el anterior se da por cancelado (`false` / `null`).

```tsx
const { confirmar, pedirTexto, avisar, dialogo } = useConfirmar();

// antes: if (!confirm('¿Anular la factura?')) return;
if (!(await confirmar({ titulo: '¿Anular la factura?', texto: 'Se emite una nota de crédito por el total.', variante: 'peligro', textoConfirmar: 'Anular' }))) return;

// antes: const motivo = prompt('Motivo del rechazo');
const motivo = await pedirTexto({ titulo: 'Rechazar el pago', campo: { etiqueta: 'Motivo', obligatorio: true, multilinea: true }, variante: 'peligro', textoConfirmar: 'Rechazar' });
if (motivo === null) return;

// antes: alert('Listo');
await avisar({ titulo: 'Listo', texto: 'Se guardó el cambio.' });

return <>{/* … la pantalla … */}{dialogo}</>;   // ¡no olvidarse de {dialogo}!
```

### `<TablaResponsiva>` — en lugar de cada `<table>`

```ts
{ columnas: ColumnaTabla<T>[]; filas: T[]; claveFila: keyof T | ((fila, i) => Key);
  tarjetaMovil?: (fila, i) => ReactNode; hrefFila?: (fila) => string; vacio?: ReactNode; pie?: ReactNode;
  sinMarco?: boolean; etiqueta?: string; className? }

ColumnaTabla<T> = { clave: string; titulo: ReactNode; celda: (fila, i) => ReactNode;
  alinear?: 'izquierda' | 'centro' | 'derecha'; importe?: boolean; principal?: boolean; acciones?: boolean;
  ocultarEnMovil?: boolean; ancho?: string; claseCelda?: string }
```

- **Celular** (hasta `md`): una tarjeta por fila. Arriba, las columnas `principal` (si no hay, la primera); abajo, el resto como "rótulo: dato" en dos columnas; al final, las `acciones` en una fila que se acomoda sola. Nada se sale del ancho.
- **Desde `md`**: tabla con scroll lateral propio, encabezado en rótulo, importes a la derecha con `importe`.
- `importe: true` para plata y cantidades; `acciones: true` para la columna de botones (con `titulo: ''`).
- `hrefFila`: la tarjeta entera es un enlace en el celular; en escritorio, la columna principal.
- `tarjetaMovil` reemplaza solo los **datos** de la tarjeta: las columnas `acciones` van siempre abajo, fuera de la tarjeta y fuera del enlace. No pongas botones dentro de `tarjetaMovil`.
- Las dos vistas están a la vez en la página (una escondida): si una celda tiene un **campo editable**, armá `tarjetaMovil` para no tener dos campos con el mismo estado.
- Sin filas muestra `vacio` (o un `<Vacio>` genérico): pasale uno que diga qué hacer.
- Ya trae su caja blanca; dentro de una `<Tarjeta relleno={false}>`, usá `sinMarco`.

```tsx
<TablaResponsiva
  etiqueta="Cheques en cartera"
  filas={cheques}
  claveFila="id"
  vacio={<Vacio titulo="No hay cheques en cartera" texto="Los que cobres en Caja aparecen acá." />}
  columnas={[
    { clave: 'numero', titulo: 'N°', celda: (c) => c.numero, principal: true },
    { clave: 'librador', titulo: 'Librador', celda: (c) => c.librador },
    { clave: 'banco', titulo: 'Banco', celda: (c) => c.banco, ocultarEnMovil: true },
    { clave: 'vence', titulo: 'Vence', celda: (c) => fecha(c.vence) },
    { clave: 'estado', titulo: 'Estado', celda: (c) => <Etiqueta tono={TONO[c.estado]}>{c.estado}</Etiqueta> },
    { clave: 'importe', titulo: 'Importe', celda: (c) => <Monto valor={c.importe} />, importe: true },
    { clave: 'acciones', titulo: '', acciones: true, celda: (c) => <>
      <Boton tamano="chico" variante="secundario" onClick={() => depositar(c)}>Depositar</Boton>
      <Boton tamano="chico" variante="peligro" onClick={() => rechazar(c)}>Rechazar</Boton>
    </> },
  ]}
  pie={<div className="flex justify-between"><span className="text-tinta/60">Total</span><Monto valor={total} className="font-semibold" /></div>}
/>
```

**El parche viejo de tablas** (`main table { display: block; white-space: nowrap }` en `globals.css`) **sigue vivo** para las tablas sin migrar; las del kit lo esquivan (`.tabla-kit`). Se borra en el mismo deploy en que se migre la última de las 46 tablas; si se borra antes, las tablas anchas estiran la página.

### `<Pestanas>`, `<Chips>`, `<Chip>`

```ts
Pestanas: { opciones: { valor; etiqueta; cuenta?; href? }[]; valor; onCambiar?; etiquetaAccesible?; aLoAncho?: boolean; className? }
Chips:    { opciones: { valor; etiqueta; cuenta?; href? }[]; valor; onCambiar?; etiquetaAccesible?; desplazable?: boolean; className? }
Chip:     props de <button> + { activo?; cuenta?; href?; children }     // filtros que se prenden de a varios
```

- Pestañas: fila subrayada en rojo; en el celular scrollea de costado (nunca se parte ni se sale). `aLoAncho` solo si está directo en `<Pantalla>` (llega de borde a borde).
- Pestañas con `href` en **todas** las opciones: es navegación. Se arma como `<nav>` con enlaces (la activa lleva `aria-current="page"`) y sirve en una `page.tsx`.
- Pestañas sin `href`, con `onCambiar`: pestañas de verdad (`role="tablist"`). Con el teclado, Tab entra a la activa y las flechas, Inicio y Fin pasan de una a otra. Solo desde un componente `'use client'`.
- Chips: el activo es tinta con texto blanco (es un estado, no un botón). Bajan de renglón; `desplazable` para una sola fila con scroll (lleva 4 px de aire para que se vea el foco). Un nombre larguísimo se corta con "…".
- Chips con `href` (filtro en la URL) se arman con `<Link>`: así sirven en una `page.tsx`.

```tsx
<Pestanas valor={vista} onCambiar={setVista} opciones={[
  { valor: 'cartera', etiqueta: 'En cartera', cuenta: 12 },
  { valor: 'depositados', etiqueta: 'Depositados' },
]} />
<Chips valor={medio} onCambiar={setMedio} opciones={[{ valor: 'todos', etiqueta: 'Todos' }, { valor: 'getnet', etiqueta: 'Getnet', cuenta: 4 }]} />
```

### `<Vacio>`, `<Cargando>`, `<Girador>`

```ts
Vacio: { titulo: ReactNode; texto?: ReactNode; accion?: ReactNode; icono?: ReactNode; className? }
Cargando: { texto?: string /* 'Cargando…' */; bloque?: boolean; className? }
Girador: { className? }     // la ruedita sola, hereda el color del texto
```

El vacío siempre dice qué hacer, nunca solo "Sin datos".

```tsx
{cargando ? <Cargando bloque /> : items.length === 0 ? (
  <Vacio titulo="No hay pedidos para preparar" texto="Los pedidos web y de PedidosYa aparecen acá." />
) : …}
```

### `<BarraInferior>` — Cobrar / Guardar siempre a mano

```ts
{ children; resumen?: ReactNode; etiqueta?: string; className? }
```

- Celular: fija abajo, respeta el gesto del iPhone y reserva al final un lugar que mide lo mismo que la barra (no tapa nada, aunque el resumen ocupe dos renglones). Sin `resumen`, los botones se reparten el ancho.
- Desde `lg`: flota pegada al pie del contenido.
- Mientras está, se esconde "Esto está mal" y el cartel de instalar sube por encima.

```tsx
<BarraInferior resumen={<><p className="text-xs text-tinta/60">Total</p><p className="text-lg font-semibold"><Monto valor={total} /></p></>}>
  <Boton onClick={cobrar} cargando={cobrando}>Cobrar</Boton>
</BarraInferior>
```

### `<Monto>` y `app/lib/formato.ts`

```ts
Monto: { valor: unknown; decimales?: boolean; corto?: boolean; diferencia?: boolean; vacio?: string; className? }
```

```tsx
<Monto valor={venta.total} />                    // $1.234.567
<Monto valor={factura.total} decimales />        // $1.234.567,50
<Monto valor={cierre.diferencia} diferencia />   // +$1.200 (verde) / -$800 (rojo) / $0
<Monto valor={kpi} corto />                      // $1,2M (el completo queda en el title)
```

Funciones (puras, sirven en servidor y cliente):

| Función | Ejemplo |
|---|---|
| `pesos(v, { decimales?, signo?, vacio? })` | `pesos(1234567)` → `$1.234.567`; `pesos(-1234)` → `-$1.234`; `pesos(null)` → `—` |
| `pesosCorto(v)` | `$950`, `$12k`, `$1,5k`, `$1,2M`, `$3,4MM` |
| `numero(v, decimales = 0)` | `numero(1234)` → `1.234` |
| `porcentaje(v, decimales = 0, { fraccion?, signo? })` | `porcentaje(12.5, 1)` → `12,5%`; `porcentaje(0.125, 1, { fraccion: true })` → `12,5%` |
| `cuit(v)` | `20-12345678-9` |
| `fecha(v, estilo = 'normal')` | `normal` `05/10/26` · `corta` `05/10` · `completa` `05/10/2026` · `larga` `5 de octubre de 2026` · `dia` `lunes 5 de octubre` |
| `hora(v)` | `14:05` |
| `fechaHora(v, { conAnio? })` | `05/10, 14:05` |
| `hoyISO()`, `fechaISO(v)`, `diasAtrasISO(n)` | `2026-10-05` (día de Buenos Aires, para filtros de la API) |
| `hace(v)` | `recién`, `hace 5 min`, `hace 3 h`, `ayer`, `hace 4 días` (solo en componentes de cliente) |
| `aNumero(v)`, `aFecha(v)` | Convierten lo que llega de la API (texto o número) |

Al migrar una copia vieja de `pesos`:

- `pesos()` devuelve `—` si no hay número (en plata, "no sé" no es "cero"). Si la copia vieja hacía `Number(n) || 0`, usá **`pesos(n ?? 0)`** para que la pantalla siga mostrando `$0`.
- Los negativos salen `-$1.234` (antes algunas pantallas mostraban `$-1.234`).
- Las fechas se arman en hora de Buenos Aires y pieza por pieza: el servidor (UTC) y el navegador escriben lo mismo. Una fecha sola (`2026-10-05`) se toma al mediodía y no se corre al día anterior. `new Date().toISOString().slice(0, 10)` da el día de Londres después de las 21 h: usá `hoyISO()`.

---

### Utilidades e íconos

```ts
unir(...clases)        // une clases salteando las vacías: unir('px-4', activo && 'bg-marca', className)
FOCO, FOCO_ADENTRO     // el contorno de foco del kit, para un botón o enlace que no sea <Boton>
ROTULO                 // rótulo en mayúsculas: 'text-xs font-semibold uppercase tracking-[0.08em] text-tinta/60'
CLASES_ENTRADA         // las clases de un <input> del kit, para un campo suelto en una page.tsx
useCampo()             // el id, la ayuda y el error del <Campo> que envuelve (para armar un control propio)
IconoCerrar, IconoFlechaAbajo, IconoOk, IconoAtencion, IconoError, IconoInfo, IconoVacio   // { className? }, size-5 por defecto
```

`unir` no resuelve choques: dos clases del mismo tipo (`bg-crema` y `bg-crema-claro`) no se pisan por el orden en que se escriben; gana la que el CSS imprime después. Para estados, elegí **una** clase con un `?:` o usá variantes (`disabled:`, `aria-invalid:`), que siempre ganan.

---

## 3. Receta para migrar una pantalla

1. `page.tsx`: `<main>` + `<Header>` + `<div max-w…>` → `<Pantalla activo="…" ancho="…">`. Sacá el `<h1>` propio si la ruta está en `TITULOS`.
2. Copias de `pesos`/`fecha` → `formato.ts` o `<Monto>`.
3. Cada `<table>` → `<TablaResponsiva>`.
4. Cada `fixed inset-0` → `<Modal>`; cada `confirm/alert/prompt` → `useConfirmar()`.
5. Botones → `<Boton>` con la variante que corresponde (rojo/verde según la regla).
6. Cajas blancas → `<Tarjeta>`; cifras grandes → `<Kpi>`; mensajes → `<Aviso>`; chips de estado → `<Etiqueta>`; filtros → `<Chips>`; pestañas → `<Pestanas>`; "Cargando…" → `<Cargando>`; listas vacías → `<Vacio>`.
7. Barras fijas abajo (Cobrar, Guardar) → `<BarraInferior>`.
8. Buscá en el archivo y dejá en cero: `text-[`, `#` dentro de `className`, `text-black`, `rounded-lg`, `min-h-screen`, `vh]`, `font-black`, `bg-black`.
9. Filas `flex` con varias cosas: `flex-wrap` o `min-w-0` en lo que se puede achicar (los nombres con `truncate` o `break-words`).
10. Verificá **a 375 px**: `document.documentElement.scrollWidth <= 375` y `innerWidth === 375` en cada ruta tocada; ningún campo de menos de 16 px; después `npx tsc --noEmit` y `npm run build`.
11. Si cambió lo que ve la gente, actualizá `app/manual/contenido.ts`; al deployar, la novedad con `scripts/publicar-novedad.sh`.

### Reemplazos frecuentes

| Antes | Después |
|---|---|
| `bg-[#B82D25]`, `text-[#B82D25]` | `bg-marca`, `text-marca` |
| `hover:bg-[#932A1F]`, `hover:bg-[#9e251e]` | `hover:bg-marca-hondo` (o `<Boton>`) |
| `text-[#932A1F]`, `text-red-700` (errores) | `text-marca-hondo` (o `<Aviso tono="error">`) |
| `bg-[#FDF3F2]`, `bg-[#B82D25]/10` | `bg-marca-suave` |
| `bg-[#F0EBE2]` | `bg-crema` (en `<main>` ya no hace falta: lo pone `<Pantalla>`) |
| `bg-[#FBF7EE]`, `bg-[#F5F1EA]`, `bg-[#FBF9F6]` | `bg-crema-claro` |
| `bg-[#EDE6DA]`, `bg-[#ECE5DD]`, `border-[#D9D2C5]` | `bg-crema-hondo` / `border-crema-hondo` |
| `bg-[#141414]`, `bg-[#121212]`, `bg-black`, `text-[#141414]`, `text-black` | `bg-tinta`, `text-tinta` |
| `text-[#8A6D3B]`, `text-[#6B5320]` | `text-dorado-hondo` |
| `text-black/40`, `/45`, `/50` | `text-tinta/60` |
| `text-black/55`, `/60`, `/65`, `/70` | `text-tinta/70` |
| `border-black/5`, `/[0.04]`, `/[0.05]` | `border-black/[0.06]` |
| `border-black/10` en campos | `border-black/15` |
| `text-emerald-700`, `bg-emerald-50` | `text-ok`, `bg-ok-suave` |
| `text-amber-700`, `bg-amber-50` | `text-atencion`, `bg-atencion-suave` |
| `text-[10px]`, `text-[11px]`, `text-[12px]` | `text-xs` |
| `text-[13px]`, `text-[12.5px]`, `text-[13.5px]` | `text-sm` |
| `text-[15px]`, `text-[16px]`, `text-[17px]` | `text-base` |
| `shadow-[0_20px_60px_-25px…]`, `shadow-2xl` | `shadow-flotante` |
| `z-[90]`, `z-[70]`, `z-50` (flotantes y ventanas) | `z-aviso`, `z-modal` |

---

## 4. Lo que todavía no está

- El parche global de tablas (se borra con la última tabla migrada, ver arriba).
- `<Icono nombre>` único (hoy los íconos del menú están en `ICONOS` de `Header.tsx` y los del kit en `kit/iconos.tsx`, exportados desde el índice).
- Un mapa único medio de pago → tono para las `<Etiqueta>` (Getnet, Clover, Mercado Pago, efectivo).
- `<PantallaAcceso>` para login, recuperar y cambiar la clave.
- Inicio pasa a clara en otra etapa.
