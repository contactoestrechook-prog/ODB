// Solo lectura. No imprime datos personales ni credenciales.
const {createClient}=require('@supabase/supabase-js');
const fs=require('fs');
const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_KEY||process.env.SUPABASE_KEY,{auth:{persistSession:false}});
async function pagina(tabla,campos,mod=q=>q){let all=[];for(let i=0;;i+=1000){const {data,error}=await mod(db.from(tabla).select(campos)).range(i,i+999);if(error)throw Error(`${tabla}: ${error.message}`);all.push(...data);if(data.length<1000)return all;}}
(async()=>{
 const prods=await pagina('productos','id,sku,nombre,unidades_pack,vendido_por_peso,stock(cantidad,sucursal_id)',q=>q.eq('activo',true).order('id'));
 const stock=p=>p.stock.reduce((s,r)=>s+Number(r.cantidad),0);
 const candidatos=prods.filter(p=>p.unidades_pack===1&&/\b(?:pack|caja|bulto|kit)\b|\bx\s*(?:[2-9]|[1-9]\d+)(?![\d.,]|\s*(?:ml|cc|l|kg|gr|g)\b)/i.test(p.nombre));
 const prec=[];for(let i=0;i<prods.length;i+=500){const {data,error}=await db.rpc('catalogo_precios',{p_ids:prods.slice(i,i+500).map(p=>p.id)});if(error)throw Error(`precios: ${error.message}`);prec.push(...data);}
 const m=new Map(prec.map(p=>[p.producto_id,p]));
 const suc=await db.from('sucursales').select('id,nombre,activa,pickup');if(suc.error)throw Error(suc.error.message);
 const cfg=await db.from('lineas_whatsapp').select('linea,activa,bot_activo,derivar_pagos_a,whatsapp_reparto,whatsapp_compras');if(cfg.error)throw Error(cfg.error.message);
 const cs=await pagina('bot_consultas_internas','area,creado_en,respondido_en,respuesta_admin,waha_msg_id,enviado_a',q=>q.order('creado_en'));
 const real=cs.filter(c=>c.enviado_a!=='banco-de-pruebas'); const now=Date.now();
 const result={fecha:new Date().toISOString(),catalogo:{activos:prods.length,packsDeclarados:prods.filter(p=>p.unidades_pack>1).length,porPeso:prods.filter(p=>p.vendido_por_peso).length,candidatosPresentacion:candidatos.length,conStockSinPrecio:prods.filter(p=>stock(p)>0&&!(Number(m.get(p.id)?.precio_final)>0)).length,preciosDecimales:prec.filter(p=>Number(p.precio_final)%1!==0).length,columnasPrecio:Object.keys(prec[0]||{}),stockNegativo:prods.filter(p=>p.stock.some(s=>Number(s.cantidad)<0)).length},sucursales:suc.data.map(s=>({nombre:s.nombre,activa:s.activa,pickup:s.pickup})),lineas:cfg.data.map(c=>({linea:c.linea,activa:c.activa,botActivo:c.bot_activo,adminConfigurado:!!c.derivar_pagos_a,repartoDistintoAdmin:!!c.whatsapp_reparto&&c.whatsapp_reparto!==c.derivar_pagos_a,comprasDistintoAdmin:!!c.whatsapp_compras&&c.whatsapp_compras!==c.derivar_pagos_a})),consultas:{total:real.length,pendientes:real.filter(c=>!c.respondido_en).length,pendientesMas24h:real.filter(c=>!c.respondido_en&&now-Date.parse(c.creado_en)>86400000).length,pendientesSinIdWhatsApp:real.filter(c=>!c.respondido_en&&!c.waha_msg_id).length,conRespuestaAdminNoCerradas:real.filter(c=>!c.respondido_en&&c.respuesta_admin).length}};
 fs.writeFileSync('../../docs/bot-atencion/auditoria-datos-2026-09-21.json',JSON.stringify(result,null,2));
 fs.writeFileSync('../../docs/bot-atencion/presentaciones-a-revisar.json',JSON.stringify(candidatos.map(p=>({sku:p.sku,nombre:p.nombre,unidades_pack:p.unidades_pack})),null,2));
 console.log(JSON.stringify(result,null,2));
})().catch(e=>{console.error(e.message);process.exitCode=1});
