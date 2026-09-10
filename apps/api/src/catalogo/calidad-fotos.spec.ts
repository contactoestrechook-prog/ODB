import { leerVeredicto, tipoDeImagen, INSTRUCCION } from './calidad-fotos';

describe('leerVeredicto', () => {
  it('lee el JSON pelado', () => {
    expect(leerVeredicto('{"sirve": false, "motivo": "se ve la mesa de madera"}'))
      .toEqual({ sirve: false, motivo: 'se ve la mesa de madera' });
  });

  it('lee el JSON aunque venga con texto o en bloque de código alrededor', () => {
    expect(leerVeredicto('```json\n{"sirve": true, "motivo": "packshot limpio"}\n```').sirve).toBe(true);
    expect(leerVeredicto('Acá va: {"sirve": false, "motivo": "una mano"} listo').sirve).toBe(false);
  });

  // Borrar una foto buena es peor que dejar una fea: ante la duda, se queda.
  it('ante una respuesta ilegible, la foto se queda', () => {
    for (const basura of ['', null, undefined, 'no sé', '{roto', '{"motivo":"algo"}', '{"sirve":"si"}']) {
      expect(leerVeredicto(basura as any).sirve).toBe(true);
    }
  });

  it('recorta motivos larguísimos', () => {
    expect(leerVeredicto(`{"sirve": false, "motivo": "${'x'.repeat(400)}"}`).motivo).toHaveLength(120);
  });
});

describe('tipoDeImagen', () => {
  it('reconoce jpeg, png, webp y gif por sus primeros bytes', () => {
    expect(tipoDeImagen(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(12)]))).toBe('image/jpeg');
    expect(tipoDeImagen(Buffer.concat([Buffer.from('\x89PNG\r\n\x1a\n', 'binary'), Buffer.alloc(12)]))).toBe('image/png');
    const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(4)]);
    expect(tipoDeImagen(webp)).toBe('image/webp');
    expect(tipoDeImagen(Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(12)]))).toBe('image/gif');
  });

  it('lo que no es una imagen conocida no se manda', () => {
    expect(tipoDeImagen(Buffer.from('<html><body>404</body></html>'))).toBeNull();
    expect(tipoDeImagen(Buffer.alloc(3))).toBeNull();
  });
});

describe('INSTRUCCION', () => {
  // El error que hubo que corregir: nombrar el rubro hacía que el modelo
  // rechazara una lámpara y un huevo Kinder "por no ser vino".
  it('no nombra el rubro de la tienda y aclara que el rubro no importa', () => {
    expect(INSTRUCCION).not.toMatch(/vinos y almac/i);
    expect(INSTRUCCION).toMatch(/cualquier rubro vale/i);
  });
});
