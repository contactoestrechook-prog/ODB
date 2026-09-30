// Evaluación del modelo real con herramientas simuladas. No escribe en BD ni WhatsApp.
// Ejecutar desde apps/api: node --env-file=.env scripts/evaluar-atencion.cjs
const Anthropic = require('@anthropic-ai/sdk').default;
const { SYSTEM_PEDIDOS, HERRAMIENTAS_PEDIDOS, MODELO_BOT } = require('../dist/bot/agente-bot');
const client = new Anthropic();
const casos = [
  { nombre: 'consulta sin dato', mensaje: '¿Cuántas unidades trae el kit Negroni?', desconocido: true },
  { nombre: 'stock puntual', mensaje: '¿Tenés agua Villavicencio de 1,5 litros?' },
  { nombre: '18 botellas en packs reales', mensaje: 'Quiero 18 botellas de agua Villavicencio de 1,5 litros. ¿Cuánto sale?', pack: 6 },
];
(async () => {
 for (const c of casos) {
  const messages = [{ role: 'user', content: c.mensaje }];
  const usadas = []; let respuesta = ''; let silencio = false;
  for (let vuelta = 0; vuelta < 5; vuelta++) {
   const r = await client.messages.create({ model: MODELO_BOT, max_tokens: 2000, system: SYSTEM_PEDIDOS, tools: HERRAMIENTAS_PEDIDOS, messages });
   messages.push({ role: 'assistant', content: r.content });
   const calls = r.content.filter(b => b.type === 'tool_use');
   if (!calls.length) { respuesta = r.content.filter(b => b.type === 'text').map(b => b.text).join('\n'); break; }
   const results = [];
   for (const b of calls) {
    usadas.push({ herramienta: b.name, argumentos: b.input });
    let data;
    if (b.name === 'identificar_cliente') data = { existe: false, mayorista: false };
    else if (b.name === 'buscar_productos') data = { items: c.desconocido ? [{ sku:'KIT', nombre:'Negroni KIT Campari Pack x3un', presentacion:'requiere_verificacion', unidad:'Contenido no verificado. Consultar al local.' }] : [{ sku:'AGUA', nombre:'Agua Villavicencio 1,5 L', precio:c.pack?6000:1000, unidadesPorVenta:c.pack||1, presentacion:'catalogada', unidad:c.pack?'pack de 6: precio y stock por pack':'una botella', stock:'Saint Thomas: 20' }] };
    else if (b.name === 'cotizar_pedido') { const cantidad=b.input.items[0].cantidad; data={total:cantidad*6000,renglones:[{sku:'AGUA',cantidad,unidadesPorVenta:6,unidadesIndividuales:cantidad*6,precioUnitario:6000,subtotal:cantidad*6000,alcanzaElStock:true}],hayFaltantes:false}; }
    else if (b.name === 'consultar_interno') { silencio=true;data={consultado:true,aviso:'No enviar mensaje hasta que responda el área'}; }
    else data={error:'Herramienta no habilitada en esta evaluación. No hubo ninguna acción real.'};
    results.push({type:'tool_result',tool_use_id:b.id,content:JSON.stringify(data)});
   }
   if (silencio) break;
   messages.push({role:'user',content:results});
  }
  console.log(JSON.stringify({caso:c.nombre,respuesta,silencio,herramientas:usadas}));
 }
})().catch(e=>{console.error(JSON.stringify({error:e.status||'error',detalle:String(e.message).slice(0,200)}));process.exitCode=1});
