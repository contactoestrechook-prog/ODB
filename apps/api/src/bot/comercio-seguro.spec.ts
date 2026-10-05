import { BotService } from './bot.service';
import { PedidosService } from '../pedidos/pedidos.service';
import { agruparItems, cantidadesIndividuales, confirmacionInequivoca, importesDeHerramienta, importesDelTexto, presentacionProducto } from './comercio';

function dbSimulada(tablas: Record<string, any> = {}) {
  const writes: any[] = [];
  const db: any = { writes, rpc: jest.fn(async () => ({ data: null, error: null })), from(tabla: string) {
    const res = tablas[tabla] ?? { data: null, error: null };
    const b: any = {};
    for (const k of ['select','eq','in','is','gte','lte','not','order','limit','range','ilike']) b[k] = () => b;
    for (const k of ['insert','update','upsert']) b[k] = (fila: any) => { writes.push({ tabla, operacion: k, fila }); return b; };
    b.single = b.maybeSingle = async () => res;
    b.then = (ok: any, err: any) => Promise.resolve(res).then(ok,err);
    return b;
  } };
  return db;
}
function servicio(db = dbSimulada()) { return new BotService(db, {} as any, {} as any, {} as any, {} as any); }
const respuesta = (text: string) => ({ stop_reason:'end_turn',content:[{type:'text',text}],usage:{input_tokens:1,output_tokens:1} });

describe('Regresiones de auditoría: contrato comercial', () => {
  beforeEach(() => { process.env.ANTHROPIC_API_KEY = 'test'; });
  it.each(['no confirmo','No, no confirmado','sí pero cambiá la cantidad','todavía no','pará','sí, agregá dos más'])('A01: %s no autoriza operaciones', texto => expect(confirmacionInequivoca(texto)).toBe(false));
  it.each(['sí','si dale confirmalo','confirmo','dale, hacelo'])('aceptación %s', texto => expect(confirmacionInequivoca(texto)).toBe(true));
  it('A02: resumen conversacional libre no permite crear sin cotización guardada', async () => {
    const db=dbSimulada();const s=servicio(db);
    await expect(s.crearPedido({telefono:'111',confirmacion:'sí',resumenPresentado:'1 Agua Total: $100 ¿Lo confirmo?'})).rejects.toThrow(/resumen verificable/);
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it('A02: la creación usa solamente la cotización guardada; ningún renglón del modelo', async () => {
    const db=dbSimulada({bot_cotizaciones:{data:{id:'q',resumen:'RESUMEN',tipo:'pickup'}}});
    db.rpc.mockResolvedValue({data:'pedido',error:null});
    const s=servicio(db);(s as any).pedidos={obtener:jest.fn(async()=>({qr_retiro:'PICKUP-1',total:100,estado:'recibido'}))};
    await s.crearPedido({telefono:'111',confirmacion:'sí',resumenPresentado:'RESUMEN',items:[{sku:'OTRO',cantidad:40}]});
    expect(db.rpc).toHaveBeenCalledWith('confirmar_cotizacion_bot',{p_id:'q',p_telefono:'111',p_linea:'pedidos',p_confirmacion:'sí'});
  });
  it('A03: renglones duplicados consultan stock por suma', async () => {
    const db=dbSimulada({sucursales:{data:{id:'st',nombre:'ST'}},productos:{data:{id:'p',sku:'X',nombre:'Agua',activo:true,unidades_pack:1,stock:[{sucursal_id:'st',cantidad:10}]}}});
    db.rpc.mockResolvedValue({data:[{precio_final:100}],error:null});
    const r=await servicio(db).cotizarPedido([{sku:'X',cantidad:6},{sku:'X',cantidad:6}]);
    expect(r.hayFaltantes).toBe(true);expect(r.renglones).toHaveLength(1);expect(r.renglones[0].cantidad).toBe(12);
  });
  it.each(['Agua 1.5L x6','Kit x3','Alfajores caja x6un','Vino x12'])('A04: %s requiere verificar contenido', nombre=>expect(presentacionProducto({nombre,unidades_pack:1}).presentacion).toBe('requiere_verificacion'));
  it.each(['Agua x500ml','Aceite x1.5L','Arroz x1kg'])('no confunde %s con pack', nombre=>expect(presentacionProducto({nombre,unidades_pack:1}).presentacion).toBe('catalogada'));
  it('A07: medio kilo se conserva al crear y no se admite en un artículo indivisible', async()=>{
    const db=dbSimulada({productos:{data:{id:'p',activo:true,vendido_por_peso:true}}});const s:any=new PedidosService(db,{} as any);
    s.sucursalPickupId=async()=>'st';s.crear=jest.fn(async()=>'p');s.obtener=async()=>({});
    await s.crearDesdeApp({items:[{sku:'QUESO',cantidad:0.5}]});expect(s.crear).toHaveBeenCalledWith(expect.objectContaining({items:[{producto_id:'p',cantidad:0.5}]}));
    const otro:any=new PedidosService(dbSimulada({productos:{data:{id:'p',activo:true,vendido_por_peso:false}}}),{} as any);
    await expect(otro.crearDesdeApp({items:[{sku:'BOTELLA',cantidad:0.5}]})).rejects.toThrow(/enteras/);
  });
  it('A09: decimales no se leen como parte entera suelta',()=>expect(cantidadesIndividuales('1,5 unidades y 2.5 botellas')).toEqual([1.5,2.5]));
  it('suma de fracciones no introduce error binario',()=>expect(agruparItems([{sku:'X',cantidad:0.1},{sku:'X',cantidad:0.2}])).toEqual([{sku:'X',cantidad:0.3}]));
  it.each([NaN,Infinity,0,-1])('rechaza cantidad inválida %s',cantidad=>expect(()=>agruparItems([{sku:'X',cantidad}])).toThrow());
  it('sólo campos monetarios de herramientas autorizan importes, conservando centavos',()=>{
    expect(importesDeHerramienta({sku:'1000',stock:999,total:1000.25,renglones:[{precioUnitario:50.5}]})).toEqual([100025,5050]);
    expect(importesDelTexto('Total $1.000,25 y $50,50')).toEqual([100025,5050]);
  });
  it('A08: precio inventado tras reformular una foto no sale al cliente',async()=>{
    const s=servicio();let vuelta=0;(s as any).claude={messages:{create:jest.fn(async()=>respuesta(++vuelta===1?'Veo dos botellas. ¿Querés el precio?':'Cuesta $999.999.'))}};
    jest.spyOn(s,'consultarInterno').mockResolvedValue({consultado:true,area:'local',avisoPorWhatsapp:true,aviso:''});
    const r:any=await s.charla({linea:'pedidos',telefono:'5491155510011',archivoBase64:'aW1hZ2Vu',mimeType:'image/jpeg'});
    // 23/9/2026: sin precio inventado, pero el cliente recibe el aviso (antes: silencio).
    // 5/10/2026: la consulta de respaldo no tiene tema → el genérico; mandó solo la
    // foto (nada más que contestar), así que el aviso va solo y una vez
    expect(r.respuesta).toBe('Ya te confirmo por acá.');expect(s.consultarInterno).toHaveBeenCalledTimes(1);
  });
  // 5/10/2026: la promesa del modelo se saca y el aviso lo pone el código, una vez
  it('A12: una promesa sin herramienta se convierte en consulta real y un solo aviso',async()=>{
    const s=servicio();let vuelta=0;(s as any).claude={messages:{create:jest.fn(async()=>respuesta(++vuelta===1?'No tengo ese dato.':'Ya te confirmo por acá.'))}};
    jest.spyOn(s,'consultarInterno').mockResolvedValue({consultado:true,area:'local',avisoPorWhatsapp:true,aviso:''});
    const r:any=await s.charla({linea:'pedidos',telefono:'5491155510022',mensaje:'¿Es cosecha 2020?'});
    // primer mensaje de la charla: el saludo y el aviso, una sola vez y al final
    expect(r.respuesta).toMatch(/^(Buen día|Buenas tardes|Buenas noches), te damos la bienvenida a O\.D\.B\.\n\nYa te confirmo por acá\.$/);expect(r.respuesta.match(/confirmo por acá/g)).toHaveLength(1);
    expect(r.respuesta).not.toMatch(/No tengo ese dato/);expect(s.consultarInterno).toHaveBeenCalledWith('pedidos','5491155510022','local','¿Es cosecha 2020?','',undefined,'');
  });
  it('A10: una consulta simultánea no oculta el código de un pedido creado',async()=>{
    const db=dbSimulada({bot_conversaciones:{data:{mensajes:[{role:'assistant',content:'RESUMEN'}]}}});const s=servicio(db);
    jest.spyOn(s,'crearPedido').mockResolvedValue({pedidoId:'p',codigoRetiro:'PICKUP-1',total:100,estado:'recibido',respuesta:'Pedido PICKUP-1 confirmado. Total: $100.'});
    jest.spyOn(s,'consultarInterno').mockResolvedValue({consultado:true,area:'local',avisoPorWhatsapp:true,aviso:''});
    (s as any).claude={messages:{create:jest.fn(async()=>({stop_reason:'tool_use',content:[{type:'tool_use',id:'1',name:'crear_pedido',input:{}},{type:'tool_use',id:'2',name:'consultar_interno',input:{area:'local',consulta:'¿Hay estacionamiento?'}}],usage:{input_tokens:1,output_tokens:1}}))}};
    const r:any=await s.charla({linea:'pedidos',telefono:'5491155510033',mensaje:'Sí, confirmo. ¿Hay estacionamiento?'});
    expect(r.respuesta).toContain('PICKUP-1');expect(s.consultarInterno).toHaveBeenCalled();
  });
  it('A13: un monto libre no genera ningún link',async()=>{
    const s=servicio();const pago=jest.fn();(s as any).mercadopago={crearLink:pago};
    const r=await (s as any).ejecutarHerramienta({id:'1',name:'generar_link_pago',input:{monto:1}},'111','pedidos');
    expect(r.is_error).toBe(true);expect(pago).not.toHaveBeenCalled();
  });
  it('A13: monto de link se obtiene del pedido propio, no del modelo',async()=>{
    const db=dbSimulada({pedidos:{data:{id:'p',total:18000,estado:'recibido',qr_retiro:'PICKUP-X'}}});const s=servicio(db);
    jest.spyOn(s,'identificarCliente').mockResolvedValue({clienteId:'c'} as any);const crear=jest.fn(async()=>({url:'https://pago.example'}));(s as any).pedidos={crearPreferenciaMP:crear};
    const r=await (s as any).ejecutarHerramienta({id:'1',name:'generar_link_pago',input:{codigo:'PICKUP-X',monto:1}},'111','pedidos');
    expect(crear).toHaveBeenCalledWith('p');expect(JSON.parse(r.content).monto).toBe(18000);
  });
});

describe('Regresiones de auditoría: respuesta del equipo',()=>{
  const cfg={bot_activo:true,derivar_pagos_a:'5491100011111',whatsapp_reparto:'5491100022222'};
  const consulta={id:'c',linea:'pedidos',telefono_cliente:'111',enviado_a:cfg.derivar_pagos_a,waha_msg_id:'C-VIEJA',creado_en:'2020-01-01'};
  function armar(consultas:any[]=[consulta],pagos:any[]=[]){const db=dbSimulada({lineas_whatsapp:{data:cfg},bot_consultas_internas:{data:consultas},bot_pagos_en_confirmacion:{data:pagos}});const s=servicio(db);const envios=jest.spyOn(s,'enviarPorWhatsapp').mockResolvedValue({enviado:true} as any);return {s,db,envios};}
  it('A06: reconoce el área que recibió la consulta',async()=>{
    const {s}=armar([{...consulta,enviado_a:cfg.whatsapp_reparto}]);const entregar=jest.spyOn(s as any,'llevarRespuestaDeConsulta').mockResolvedValue({contestado:true});
    await (s as any).respuestaDeAdministracion(cfg.whatsapp_reparto,{body:'Sí, llegamos',replyTo:{id:'C-VIEJA'}});expect(entregar).toHaveBeenCalled();
  });
  it('A11: cita desconocida nunca selecciona otra consulta',async()=>{
    const {s,envios}=armar();const entregar=jest.spyOn(s as any,'llevarRespuestaDeConsulta').mockResolvedValue({contestado:true});
    const r=await (s as any).respuestaDeAdministracion(cfg.derivar_pagos_a,{body:'Son seis',replyTo:{id:'OTRA'}});
    expect(r.contestado).toBe(false);expect(entregar).not.toHaveBeenCalled();expect(envios).toHaveBeenCalledWith(expect.objectContaining({to:cfg.derivar_pagos_a}));
  });
  it('una consulta antigua citada sigue atendible',async()=>{
    const {s}=armar();const entregar=jest.spyOn(s as any,'llevarRespuestaDeConsulta').mockResolvedValue({contestado:true});
    await (s as any).respuestaDeAdministracion(cfg.derivar_pagos_a,{body:'Son seis',replyTo:{id:'true_111_C-VIEJA'}});expect(entregar).toHaveBeenCalledWith(consulta,'Son seis',cfg.derivar_pagos_a,true);
  });
  it('A14: dos pagos sin cita no confirman a nadie',async()=>{
    const {s,db}=armar([],[{id:'p1'},{id:'p2'}]);const r=await (s as any).respuestaDeAdministracion(cfg.derivar_pagos_a,{body:'recibido'});
    expect(r.contestado).toBe(false);expect(db.writes.some(x=>x.fila.confirmado_en)).toBe(false);
  });
  it('A05: fallo de entrega no cierra la consulta ni inventa un envío',async()=>{
    const {s,db,envios}=armar();db.rpc.mockResolvedValue({data:[consulta],error:null});envios.mockResolvedValue({enviado:false} as any);
    const r=await (s as any).llevarRespuestaDeConsulta(consulta,'Son seis botellas',cfg.derivar_pagos_a,true);
    expect(r.contestado).toBe(false);expect(db.writes.some(x=>x.fila.respondido_en)).toBe(false);
    expect(db.writes.some(x=>x.fila.ultimo_error)).toBe(true);
  });
  it('entrega confirmada cierra y conserva texto exacto sin llamar al agente',async()=>{
    const {s,db}=armar();db.rpc.mockResolvedValue({data:[consulta],error:null});jest.spyOn(s,'respondeRegistrar').mockResolvedValue(undefined);const charla=jest.spyOn(s,'charla');
    const r=await (s as any).llevarRespuestaDeConsulta(consulta,'El pack trae seis botellas.',cfg.derivar_pagos_a,true);
    expect(r.contestado).toBe(true);expect(charla).not.toHaveBeenCalled();expect(db.writes.some(x=>x.fila.respondido_en)).toBe(true);
  });
  it('no repite automáticamente un envío cuyo resultado quedó incierto',async()=>{
    const {s,db,envios}=armar();db.rpc.mockResolvedValue({data:[{...consulta,envio_iniciado_en:new Date().toISOString()}],error:null});
    const r=await (s as any).llevarRespuestaDeConsulta(consulta,'Seis',cfg.derivar_pagos_a,true);expect(r.contestado).toBe(false);expect(envios).not.toHaveBeenCalled();
  });
});


describe('Entregas y archivos: fallos sin efectos ficticios', () => {
  it('un pago cuyo envío falla no se cierra ni se anota como enviado en el chat', async () => {
    const db=dbSimulada({lineas_whatsapp:{data:{bot_activo:true,derivar_pagos_a:'5491111111111'}},bot_pagos_en_confirmacion:{data:[{id:'p',linea:'pedidos',telefono_cliente:'222',waha_msg_id:'P'}]}});
    db.rpc.mockResolvedValue({data:[{id:'p'}],error:null}); const s=servicio(db);
    jest.spyOn(s,'enviarPorWhatsapp').mockResolvedValue({enviado:false} as any);
    const r=await (s as any).respuestaDeAdministracion('5491111111111',{body:'recibido',replyTo:{id:'P'}});
    expect(r.contestado).toBe(false);
    expect(db.writes.some(x=>x.fila.confirmado_en)).toBe(false);
    expect(db.writes.some(x=>x.tabla==='bot_conversaciones')).toBe(false);
  });
  it('un pago ya reservado por otra ejecución no vuelve a notificarse al cliente', async()=>{
    const db=dbSimulada({lineas_whatsapp:{data:{bot_activo:true,derivar_pagos_a:'5491111111111'}},bot_pagos_en_confirmacion:{data:[{id:'p',linea:'pedidos',telefono_cliente:'222'}]}});
    db.rpc.mockResolvedValue({data:[],error:null});const s=servicio(db);const enviar=jest.spyOn(s,'enviarPorWhatsapp').mockResolvedValue({enviado:true} as any);
    await (s as any).respuestaDeAdministracion('5491111111111',{body:'recibido'});
    expect(enviar.mock.calls.some(([p])=>p.to==='222')).toBe(false);
  });
  it('archiva en un bucket privado y firma el acceso por una hora',async()=>{
    const db=dbSimulada();const upload=jest.fn(async()=>({error:null}));const firma=jest.fn(async()=>({data:{signedUrl:'https://privado/firmado'}}));
    db.storage={from:jest.fn(()=>({upload,createSignedUrl:firma}))};
    await (servicio(db) as any).guardarAdjuntoPrivado('whatsapp/111/123.jpg',{base64:'AAAA',mime:'image/jpeg'});
    expect(db.storage.from).toHaveBeenCalledWith('bot-adjuntos');expect(firma).toHaveBeenCalledWith('whatsapp/111/123.jpg',3600);
  });
  it.each(['whatsapp/111/123.jpg','whatsapp/11282929475750@lid/1790860035812.jpeg','whatsapp/11282929475750@lid/1790860049466.oga'])('renovación acepta la ruta %s (también las @lid de los contactos nuevos)',async ruta=>{
    const db=dbSimulada();db.storage={from:jest.fn(()=>({createSignedUrl:jest.fn(async()=>({data:{signedUrl:'https://privado/firmado'}}))}))};
    await expect(servicio(db).renovarAdjunto(ruta)).resolves.toBeTruthy();
  });
  it.each(['../secreto','whatsapp/111/../../otro','whatsapp/111@lid/../otro','whatsapp/111@otro/123.jpg','publico/123.jpg','https://otro/archivo'])('renovación rechaza ruta %s',async ruta=>{
    await expect(servicio().renovarAdjunto(ruta)).rejects.toThrow(/inválida/);
  });
  it('checkout de medio kilo conserva el importe y el vínculo con el pedido',async()=>{
    const previo=process.env.MERCADOPAGO_ACCESS_TOKEN;process.env.MERCADOPAGO_ACCESS_TOKEN='test';
    const fetchMock=jest.spyOn(global,'fetch').mockResolvedValue({ok:true,json:async()=>({init_point:'https://pago.example',id:'pref'})} as any);
    try {
      const s=new PedidosService(dbSimulada(),{} as any);
      jest.spyOn(s,'obtener').mockResolvedValue({estado:'recibido',total:750.25,items:[{cantidad:0.5,precio_unitario:1500.5,producto:{nombre:'Queso'}}]} as any);
      await s.crearPreferenciaMP('pedido-peso');const b=JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
      expect(b.external_reference).toBe('pedido-peso');expect(b.items[0]).toMatchObject({quantity:1,unit_price:750.25});
    } finally {fetchMock.mockRestore(); if(previo===undefined) delete process.env.MERCADOPAGO_ACCESS_TOKEN;else process.env.MERCADOPAGO_ACCESS_TOKEN=previo;}
  });
});
