import { promptImagen, HERRAMIENTAS_SCHEMAS } from './herramientas';

describe('Agente IA · toolkit', () => {
  it('expone las 7 herramientas del contrato', () => {
    const nombres = HERRAMIENTAS_SCHEMAS.map((h) => h.name);
    expect(nombres).toEqual([
      'create_product', 'update_stock', 'enrich_metadata', 'generate_image_prompt',
      'notify_admin', 'schedule_publication', 'request_human_review',
    ]);
  });

  it('cada herramienta tiene schema con required', () => {
    for (const h of HERRAMIENTAS_SCHEMAS) {
      expect(h.input_schema.type).toBe('object');
      expect(Array.isArray(h.input_schema.required)).toBe(true);
    }
  });

  it('promptImagen incluye el nombre del producto', () => {
    expect(promptImagen('Vino Malbec 750')).toContain('Vino Malbec 750');
    expect(promptImagen('X')).toContain('fondo blanco');
  });
});
