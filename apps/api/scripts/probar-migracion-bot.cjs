// PostgreSQL WASM aislado. Requiere @electric-sql/pglite en un directorio de pruebas.
// PGLITE_MODULE=/ruta/node_modules/@electric-sql/pglite node scripts/probar-migracion-bot.cjs
const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const fs=require('fs');const assert=require('node:assert/strict');
(async()=>{
 const db=new PGlite();
 await db.exec(`
 create role anon; create role authenticated; create role service_role;
 create schema storage; create table storage.buckets(id text primary key,name text,public boolean);
 create type tipo_cliente as enum('nuevo','habitual','mayorista'); create type canal_venta as enum('pickup','domicilio','web');
 create type tipo_movimiento as enum('reserva','liberacion_reserva','venta','merma','ajuste','compra','devolucion','transferencia_entrada','transferencia_salida');
 create table clientes(id uuid primary key default gen_random_uuid(),telefono text,nombre text,tipo tipo_cliente,verificado boolean default false,mayorista boolean default false);
 create table sucursales(id uuid primary key,nombre text,activa boolean,pickup boolean);
 create table productos(id uuid primary key,sku text,nombre text,activo boolean,unidades_pack int,vendido_por_peso boolean,precio numeric);
 create table pedidos(id uuid primary key default gen_random_uuid(),canal canal_venta,sucursal_id uuid,cliente_id uuid,estado text,total numeric,qr_retiro text,reserva_stock boolean,destino_direccion text,notas text,entrega_fecha date,entrega_franja text);
 create table pedidos_items(pedido_id uuid,producto_id uuid,cantidad numeric,precio_unitario numeric);
 create table stock(producto_id uuid,sucursal_id uuid,cantidad numeric,primary key(producto_id,sucursal_id));
 create table movimientos_stock(id bigserial,producto_id uuid,sucursal_id uuid,tipo tipo_movimiento,cantidad numeric,motivo text,referencia_tipo text,referencia_id text,usuario_id uuid);
 create table bot_conversaciones(linea text,telefono text,mensajes jsonb);
 create function precio_vigente(p_producto_id uuid,p_fecha timestamptz default now(),p_segmento tipo_cliente default null,p_medio_pago text default null,p_verificado boolean default false,p_mayorista boolean default false)
 returns table(precio_lista numeric,precio_final numeric,descuento_id uuid,descuento_nombre text,descuento_comunidad boolean) language sql stable as $$
 select precio,case when p_mayorista then precio * 0.8 else precio end,null::uuid,null::text,false from productos where id=p_producto_id $$;
 `);
 const original=fs.readFileSync('../../db/esquema-real/04-funciones.sql','utf8');
 const start=original.indexOf('CREATE OR REPLACE FUNCTION public.registrar_movimiento(');
 const end=original.indexOf('CREATE OR REPLACE FUNCTION public.registrar_venta(',start);
 await db.exec(original.slice(start,end));
 const migracion=fs.readFileSync('../../db/migracion-bot-atencion-segura.sql','utf8');
 await db.exec(migracion); await db.exec(migracion); // reejecutable
 const suc='00000000-0000-0000-0000-000000000001', prod='00000000-0000-0000-0000-000000000002';
 await db.query('insert into sucursales values($1,$2,true,true)',[suc,'ST']);
 await db.query('insert into productos values($1,$2,$3,true,1,false,100)',[prod,'AGUA','Agua']);
 await db.query('insert into stock values($1,$2,10)',[prod,suc]);
 async function quote({cantidad=2,precio=100,tel='111',cliente=null,peso=false}={}){
  const items=[{producto_id:prod,sku:'AGUA',cantidad,precioUnitario:precio,unidades_pack:1,vendidoPorPeso:peso}];
  const r=await db.query(`insert into bot_cotizaciones(linea,telefono,cliente_id,sucursal_id,items,total,tipo,resumen) values('pedidos',$1,$2,$3,$4,$5,'pickup','resumen') returning id`,[tel,cliente,suc,JSON.stringify(items),cantidad*precio]);return r.rows[0].id;
 }
 const confirmar=(id,texto='sí',tel='111')=>db.query('select confirmar_cotizacion_bot($1,$2,$3,$4) id',[id,tel,'pedidos',texto]);
 const q=await quote();await assert.rejects(()=>confirmar(q,'no confirmo'),/confirmacion/);await assert.rejects(()=>confirmar(q,'sí','222'),/encontrada/);
 assert.equal((await db.query('select count(*)::int n from pedidos')).rows[0].n,0);
 const primero=await confirmar(q),segundo=await confirmar(q);assert.equal(primero.rows[0].id,segundo.rows[0].id);
 assert.equal((await db.query('select cantidad from stock')).rows[0].cantidad,'8');
 const qPrecio=await quote();await db.exec('update productos set precio=101');await assert.rejects(()=>confirmar(qPrecio),/precio cambio/);await db.exec('update productos set precio=100');
 const qStock=await quote({cantidad:9});await assert.rejects(()=>confirmar(qStock),/Stock insuficiente/);
 assert.equal((await db.query('select count(*)::int n from pedidos')).rows[0].n,1);assert.equal((await db.query('select cantidad from stock')).rows[0].cantidad,'8');
 const qPack=await quote();await db.exec('update productos set unidades_pack=6');await assert.rejects(()=>confirmar(qPack),/presentacion cambio/);await db.exec('update productos set unidades_pack=1,vendido_por_peso=true');
 const qPeso=await quote({cantidad:0.5,peso:true});await confirmar(qPeso);assert.equal((await db.query('select cantidad from stock')).rows[0].cantidad,'7.5');
 const cliente=(await db.query("insert into clientes(telefono,mayorista) values('333',true) returning id")).rows[0].id;
 const precio=(await db.query('select precio_final from catalogo_precios_bot($1,$2)',[[prod],cliente])).rows[0].precio_final;assert.equal(Number(precio),80);
 const qMayorista=await quote({cantidad:1,precio:80,tel:'333',cliente,peso:true});const pm=(await confirmar(qMayorista,'sí','333')).rows[0].id;assert.equal(Number((await db.query('select total from pedidos where id=$1',[pm])).rows[0].total),80);
 const consulta=(await db.query("insert into bot_consultas_internas(linea,telefono_cliente,gestion_version) values('pedidos','111',2) returning id")).rows[0].id;
 assert.equal((await db.query('select * from tomar_entrega_consulta_bot($1)',[consulta])).rows.length,1);assert.equal((await db.query('select * from tomar_entrega_consulta_bot($1)',[consulta])).rows.length,0);
 const pago=(await db.query("insert into bot_pagos_en_confirmacion(linea,telefono_cliente) values('pedidos','111') returning id")).rows[0].id;
 assert.equal((await db.query('select * from tomar_aviso_pago_bot($1)',[pago])).rows.length,1);
 assert.equal((await db.query('select * from tomar_aviso_pago_bot($1)',[pago])).rows.length,0);
 console.log('OK: migración reejecutable; negativas; aislamiento por chat; pedido idempotente; rollback por precio/stock; presentación; peso; precio mayorista; claim exclusivo.');
 await db.close();
})().catch(e=>{console.error(e);process.exitCode=1});
