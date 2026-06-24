import MDBReader from 'mdb-reader';
import { readFileSync } from 'node:fs';
const r = new (MDBReader.default ?? MDBReader)(readFileSync('./climatizacion_copia.mdb'));
const T = n => r.getTable(n).getData();
const num = v => Number(String(v??'').replace(',','.'))||0;

const rep = T('repuestos');
const conPrecio = rep.filter(p=>num(p.pventa)>0).length;
const conStock = rep.filter(p=>num(p.CANTIDAD)>0).length;
const rubros = new Set(rep.map(p=>p.rubro).filter(Boolean));
console.log('PRODUCTOS (repuestos):', rep.length, '| con precio venta:', conPrecio, '| con stock>0:', conStock, '| rubros:', rubros.size);
console.log('  ej precios listas:', rep.slice(0,2).map(p=>({desc:String(p.descripcion).slice(0,18),costo:num(p.pcosto),pv1:num(p.pventa),pv2:num(p.pventa2),pv3:num(p.pventa3)})));

const sd = T('stockdep');
const codigosSD = new Set(sd.map(x=>x.codigo).filter(Boolean));
const deps = new Set(sd.map(x=>x.deposito).filter(Boolean));
console.log('STOCKDEP:', sd.length,'filas | códigos distintos:', codigosSD.size, '| depósitos:', [...deps]);

const cli = T('cliente');
const conEmail = cli.filter(c=>c.email && c.email.includes('@')).length;
const conCel = cli.filter(c=>c.celular && String(c.celular).length>5).length;
const conDeuda = cli.filter(c=>num(c.saldo)>0 || num(c.deuda)>0 || num(c.fiado)>0).length;
const zonas = new Set(cli.map(c=>c.zona).filter(Boolean));
const barrios = new Set(cli.map(c=>c.barrio).filter(Boolean));
const tipos = {}; cli.forEach(c=>{tipos[c.TIPO||'(sin)']=(tipos[c.TIPO||'(sin)']||0)+1});
console.log('CLIENTES:', cli.length, '| email:', conEmail, '| celular:', conCel, '| con cta cte:', conDeuda, '| zonas:', zonas.size, '| barrios:', barrios.size);
console.log('  tipos:', tipos);

const sal = T('salidas');
const fechas = sal.map(s=>new Date(s.FECHA)).filter(d=>!isNaN(d));
console.log('SALIDAS (ventas/egresos):', sal.length, '| rango:', new Date(Math.min(...fechas)).toISOString().slice(0,10),'→',new Date(Math.max(...fechas)).toISOString().slice(0,10));

const fi = T('facturaimp');
const conCae = fi.filter(f=>f.cae && String(f.cae).trim()).length;
console.log('FACTURAIMP:', fi.length, '| con CAE (AFIP):', conCae, '| ej cae:', fi.map(f=>String(f.cae||'').slice(0,16)).filter(Boolean).slice(0,3));
const vend = T('vendedor');
console.log('VENDEDOR/EMPLEADOS:', vend.length, '| con sueldo:', vend.filter(v=>num(v.sueldo)>0).length, '| nombres:', vend.map(v=>v.NOMBRE));
console.log('RUBROS (con utilidad):', T('rubro').slice(0,6).map(x=>`${x.rubro}/${x.UTILIDAD}`));
