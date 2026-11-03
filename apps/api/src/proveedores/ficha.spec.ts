import { aliasValido, cbuValido, cuentaCorriente, cuitLegible, cuitNormalizado, cumplimiento, emailValido, faltantes, leerConstanciaArca, telefonoValido, vencimientoPorPlazo } from './ficha';
import { dominioDe, iconosDelHtml } from './proveedores-ficha.service';
import { leerSitio } from './logos-semanal.service';

describe('CUIT', () => {
  it('acepta un CUIT real con o sin guiones y lo guarda en dígitos', () => {
    expect(cuitNormalizado('30-71696971-8')).toBe('30716969718');
    expect(cuitNormalizado('30705166923')).toBe('30705166923');
    expect(cuitNormalizado(' 20-24375888-3 ')).toBe('20243758883');
  });
  it('rechaza el dígito verificador mal, el largo mal y prefijos inexistentes', () => {
    expect(cuitNormalizado('30-71696971-0')).toBeNull();
    expect(cuitNormalizado('3071696971')).toBeNull();
    expect(cuitNormalizado('99716969718')).toBeNull();
    expect(cuitNormalizado('')).toBeNull();
  });
  it('se muestra con guiones', () => {
    expect(cuitLegible('30716969718')).toBe('30-71696971-8');
    expect(cuitLegible(null)).toBe('');
  });
});

describe('CBU y alias', () => {
  it('valida los dos verificadores', () => {
    expect(cbuValido('2850590940090418135201')).toBe('2850590940090418135201');
    expect(cbuValido('0170099 2200000677973 70')).toBe('0170099220000067797370');
    expect(cbuValido('2850590940090418135202')).toBeNull();
    expect(cbuValido('123')).toBeNull();
  });
  it('alias en mayúsculas, sin espacios', () => {
    expect(aliasValido('odb.premium.mp')).toBe('ODB.PREMIUM.MP');
    expect(aliasValido('con espacio')).toBeNull();
    expect(aliasValido('abc')).toBeNull();
  });
});

describe('contacto', () => {
  it('mail y teléfono', () => {
    expect(emailValido(' Ventas@Distri.com.ar ')).toBe('ventas@distri.com.ar');
    expect(emailValido('ventas@')).toBeNull();
    expect(telefonoValido('11 2345-6789')).toBe('11 2345-6789');
    expect(telefonoValido('4567')).toBeNull();
  });
});

describe('faltantes', () => {
  it('lista lo que falta en orden de importancia', () => {
    expect(faltantes({})).toEqual(['CUIT', 'WhatsApp', 'Dirección', 'Condición de IVA', 'Condición de pago', 'Plazo de entrega', 'Mail']);
    expect(faltantes({ cuit: '30716969718', telefono: '5491122812200', direccion: 'Castex 3601', condicion_iva: 'responsable_inscripto',
      condicion_pago: '30 días', lead_time_confirmado: true, email: 'a@b.com' })).toEqual(['Ingresos Brutos']);
    expect(faltantes({ cuit: '30716969718', telefono: '5491122812200', direccion: 'Castex 3601', condicion_iva: 'responsable_inscripto',
      iibb_regimen: 'convenio_multilateral', plazo_pago_dias: 30, lead_time_confirmado: true, email: 'a@b.com' })).toEqual([]);
  });
  it('al monotributista no le pide Ingresos Brutos y el plazo en días cuenta como condición de pago', () => {
    expect(faltantes({ condicion_iva: 'monotributo', plazo_pago_dias: 0 })).not.toContain('Ingresos Brutos');
    expect(faltantes({ condicion_iva: 'monotributo', plazo_pago_dias: 0 })).not.toContain('Condición de pago');
  });
});

describe('vencimiento por plazo', () => {
  it('suma los días a la emisión', () => {
    expect(vencimientoPorPlazo('2026-10-25', 30)).toBe('2026-11-24');
    expect(vencimientoPorPlazo('2026-12-20', 15)).toBe('2027-01-04');
    expect(vencimientoPorPlazo('2026-11-03', 0)).toBe('2026-11-03');
  });
  it('sin plazo o sin emisión no inventa nada', () => {
    expect(vencimientoPorPlazo('2026-11-03', null)).toBeNull();
    expect(vencimientoPorPlazo(null, 30)).toBeNull();
  });
});

describe('constancia de ARCA', () => {
  const juridica = `<soap:Envelope><soap:Body><ns2:getPersona_v2Response xmlns:ns2="http://a5.soap.ws.server.puc.sr/"><personaReturn>
    <datosGenerales><domicilioFiscal><codPostal>1832</codPostal><descripcionProvincia>BUENOS AIRES</descripcionProvincia>
    <direccion>AV  HIPOLITO YRIGOYEN 8230</direccion><localidad>LOMAS DE ZAMORA</localidad></domicilioFiscal>
    <estadoClave>ACTIVO</estadoClave><razonSocial>DISTRIBUIDORA DEL SUR SA</razonSocial><tipoPersona>JURIDICA</tipoPersona></datosGenerales>
    <datosRegimenGeneral><actividad><descripcionActividad>VENTA AL POR MAYOR DE BEBIDAS</descripcionActividad><orden>2</orden></actividad>
    <actividad><descripcionActividad>VENTA AL POR MAYOR DE ALIMENTOS</descripcionActividad><orden>1</orden></actividad>
    <impuesto><descripcionImpuesto>GANANCIAS SOCIEDADES</descripcionImpuesto><idImpuesto>10</idImpuesto></impuesto>
    <impuesto><descripcionImpuesto>IVA</descripcionImpuesto><idImpuesto>30</idImpuesto></impuesto></datosRegimenGeneral>
    </personaReturn></ns2:getPersona_v2Response></soap:Body></soap:Envelope>`;
  it('lee razón social, domicilio, IVA inscripto y la actividad principal', () => {
    expect(leerConstanciaArca(juridica)).toEqual({
      razonSocial: 'DISTRIBUIDORA DEL SUR SA', estado: 'ACTIVO', direccion: 'AV HIPOLITO YRIGOYEN 8230', localidad: 'LOMAS DE ZAMORA',
      provincia: 'BUENOS AIRES', condicionIva: 'responsable_inscripto', actividad: 'VENTA AL POR MAYOR DE ALIMENTOS', error: null,
    });
  });
  it('persona física en el monotributo, con la provincia como localidad si falta', () => {
    const d = leerConstanciaArca(`<personaReturn><datosGenerales><apellido>GOMEZ</apellido><nombre>RUBEN</nombre>
      <domicilioFiscal><descripcionProvincia>CIUDAD AUTONOMA BUENOS AIRES</descripcionProvincia><direccion>CASTEX 3601</direccion></domicilioFiscal>
      <estadoClave>ACTIVO</estadoClave></datosGenerales><datosMonotributo><categoriaMonotributo><descripcionCategoria>D LOCACIONES</descripcionCategoria></categoriaMonotributo>
      <impuesto><idImpuesto>20</idImpuesto></impuesto></datosMonotributo></personaReturn>`);
    expect(d.razonSocial).toBe('GOMEZ RUBEN');
    expect(d.condicionIva).toBe('monotributo');
    expect(d.localidad).toBe('CIUDAD AUTONOMA BUENOS AIRES');
  });
  it('devuelve el error de la constancia y el estado inactivo', () => {
    const d = leerConstanciaArca(`<personaReturn><datosGenerales><estadoClave>INACTIVO</estadoClave><razonSocial>X SA</razonSocial></datosGenerales>
      <errorConstancia><error>El contribuyente cuenta con domicilio fiscal no confirmado</error></errorConstancia></personaReturn>`);
    expect(d.estado).toBe('INACTIVO');
    expect(d.error).toBe('El contribuyente cuenta con domicilio fiscal no confirmado');
    expect(d.condicionIva).toBeNull();
  });
});

describe('cuenta corriente', () => {
  it('suma facturas, resta NC y pagos, con el saldo de cada momento', () => {
    const { movimientos, saldo } = cuentaCorriente([
      { id: 'f1', numero: '0001-00000010', tipo: 'factura', letra: 'A', monto: 100000, monto_pagado: 60000, fecha_emision: '2026-10-01', creado_en: '2026-10-01T10:00:00Z' },
      { id: 'n1', numero: '0001-00000002', tipo: 'nota_credito', letra: 'A', monto: 5000, monto_pagado: 0, fecha_emision: '2026-10-05', creado_en: '2026-10-05T10:00:00Z' },
      { id: 'f2', numero: '0001-00000011', tipo: 'factura', monto: 20000, monto_pagado: 0, fecha_emision: '2026-10-08', creado_en: '2026-10-08T10:00:00Z', estado: 'anulada' },
    ], [{ factura_id: 'f1', monto: 60000, medio: 'transferencia', creado_en: '2026-10-10T15:00:00Z' }]);
    expect(movimientos.map((m) => [m.fecha, m.detalle, m.saldo])).toEqual([
      ['2026-10-01', 'Factura A 0001-00000010', 100000],
      ['2026-10-05', 'NC A 0001-00000002', 95000],
      ['2026-10-10', 'Pago de 0001-00000010 · transferencia', 35000],
    ]);
    expect(saldo).toBe(35000);
  });
  it('una factura cargada ya pagada lleva el pago sin detalle el mismo día', () => {
    const { movimientos, saldo } = cuentaCorriente([
      { id: 'f1', numero: '12', tipo: 'factura', monto: 8000, monto_pagado: 8000, fecha_emision: '2026-10-20', creado_en: '2026-10-20T10:00:00Z', estado: 'pagada' },
    ], []);
    expect(movimientos).toHaveLength(2);
    expect(movimientos[1].detalle).toBe('Pago de Factura 12 (sin detalle)');
    expect(saldo).toBe(0);
  });
});

describe('cumplimiento', () => {
  it('a tiempo, días reales y faltantes', () => {
    const c = cumplimiento([
      { creado_en: '2026-10-01T09:00:00Z', enviada_en: '2026-10-01T10:00:00Z', recibida_en: '2026-10-03T10:00:00Z', fecha_entrega: '2026-10-03', entrega_faltantes: null },
      { creado_en: '2026-10-10T09:00:00Z', enviada_en: '2026-10-10T09:00:00Z', recibida_en: '2026-10-14T09:00:00Z', entrega_confirmada_para: '2026-10-12', entrega_faltantes: ['coca 2,25'] },
      { creado_en: '2026-10-20T09:00:00Z', recibida_en: '2026-10-21T09:00:00Z', entrega_faltantes: [] },
      { creado_en: '2026-10-25T09:00:00Z', recibida_en: null },
    ]);
    expect(c).toEqual({ recibidas: 3, conFecha: 2, aTiempo: 1, diasPromedio: 2.3, conFaltantes: 1 });
  });
});

describe('logo desde la web', () => {
  it('saca el dominio de lo que escriban', () => {
    expect(dominioDe('https://www.arcor.com/ar/')).toBe('www.arcor.com');
    expect(dominioDe('laserenisima.com.ar')).toBe('laserenisima.com.ar');
    expect(dominioDe('no tiene')).toBeNull();
    expect(dominioDe('')).toBeNull();
  });
  it('toma los íconos de la portada, el más grande primero', () => {
    const html = `<head><link rel="icon" href="/favicon-32.png" sizes="32x32"><link rel="apple-touch-icon" href="https://cdn.x.com/ati.png">
      <link rel="icon" type="image/png" sizes="192x192" href="img/logo-192.png"><link rel="stylesheet" href="a.css"></head>`;
    expect(iconosDelHtml(html, 'https://www.x.com/home/')).toEqual([
      'https://www.x.com/home/img/logo-192.png', 'https://cdn.x.com/ati.png', 'https://www.x.com/favicon-32.png',
    ]);
  });
});

describe('sitio oficial que contesta el modelo', () => {
  it('toma el último JSON y solo acepta un dominio', () => {
    expect(leerSitio('Busqué… es Arcor.\n{"web": "https://www.arcor.com/ar", "seguro": true, "motivo": "sitio de la marca"}'))
      .toEqual({ web: 'www.arcor.com', seguro: true, motivo: 'sitio de la marca' });
    expect(leerSitio('{"web": null, "seguro": false, "motivo": "nombre genérico"}').seguro).toBe(false);
    expect(leerSitio('{"web": "no sé", "seguro": true}')).toMatchObject({ web: null, seguro: false });
    expect(leerSitio('sin json').seguro).toBe(false);
  });
});
