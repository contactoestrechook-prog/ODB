-- «NO HAY ESE SABOR; DE ESE HAY ESTOS» (Leandro, 20/11/2026, simulacro: «si el
-- cliente ya me avisa que quiere limón y el empleado va y chequea que no hay, de
-- qué manera se le puede avisar al cliente que no hay ese sabor y cuáles sí»).
--
-- Un segundo tipo de cambio con el cliente, al lado del «Tengo parecido»: la
-- VARIEDAD. Mismo producto (p. ej. «Aromatizante Saphirus Textil VARIOS»), otra
-- fragancia, sabor o color. Quien arma anota cuál pidió el cliente (limón) y
-- cuáles hay (lavanda, coco); al cliente le llega «… de limón no hay. De ese
-- tenemos: lavanda y coco. ¿Cuál querés?». Lo que elige cambia la aclaración del
-- renglón en las notas del pedido (no cambia producto ni precio); con «ninguno»
-- sale del pedido (decidir_reemplazo con no, como un parecido rechazado).
--
-- Solo agrega columnas: la API de antes las ignora. Aplicar ANTES de publicar la
-- API que las escribe. APLICADA por MCP en utemmsmuwocerhmuxrbs (variedades).
alter table public.pedidos_reemplazos
  add column if not exists tipo text not null default 'parecido',
  add column if not exists pedida text,
  add column if not exists variedades text[],
  add column if not exists elegida text;

do $$ begin
  alter table public.pedidos_reemplazos add constraint pedidos_reemplazos_tipo_check check (tipo in ('parecido', 'variedad'));
exception when duplicate_object then null; end $$;

comment on column public.pedidos_reemplazos.tipo is 'parecido: va otro producto · variedad: el mismo producto en otra fragancia, sabor o color (20/11/2026)';
comment on column public.pedidos_reemplazos.pedida is 'variedad: la que pidió el cliente y no hay (limón)';
comment on column public.pedidos_reemplazos.variedades is 'variedad: las que hay y se le ofrecen';
comment on column public.pedidos_reemplazos.elegida is 'variedad: la que eligió el cliente (o quien arma, si se lo dijo por otro lado)';
