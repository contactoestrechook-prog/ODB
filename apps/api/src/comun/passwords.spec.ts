import { createHash } from 'node:crypto';
import { hashClave, verificarClave, esLegacy } from './passwords';

// La migración a bcrypt es dual: los hashes sha256 legacy tienen que seguir
// validando hasta que todos los usuarios re-hasheen. Estos tests fijan ese contrato.

describe('hashing de claves (bcrypt con compatibilidad legacy)', () => {
  it('hashea con bcrypt (prefijo $2, salt incluido)', () => {
    const h = hashClave('MiClave123');
    expect(h.startsWith('$2')).toBe(true);
    expect(h).toHaveLength(60);
    // dos hashes de la misma clave difieren (salt aleatorio)
    expect(hashClave('MiClave123')).not.toBe(h);
  });

  it('verifica una clave correcta y rechaza una incorrecta (bcrypt)', () => {
    const h = hashClave('MiClave123');
    expect(verificarClave('MiClave123', h)).toBe(true);
    expect(verificarClave('otraClave', h)).toBe(false);
  });

  it('sigue validando hashes sha256 legacy (usuarios pre-migración)', () => {
    const legacy = createHash('sha256').update('ClaveVieja').digest('hex');
    expect(verificarClave('ClaveVieja', legacy)).toBe(true);
    expect(verificarClave('ClaveMala', legacy)).toBe(false);
  });

  it('marca como legacy solo los hashes que no son bcrypt', () => {
    expect(esLegacy(createHash('sha256').update('x').digest('hex'))).toBe(true);
    expect(esLegacy(hashClave('x'))).toBe(false);
    expect(esLegacy(null)).toBe(false);
    expect(esLegacy('')).toBe(false);
  });

  it('nunca valida contra un hash vacío o nulo', () => {
    expect(verificarClave('lo-que-sea', null)).toBe(false);
    expect(verificarClave('lo-que-sea', undefined)).toBe(false);
    expect(verificarClave('lo-que-sea', '')).toBe(false);
  });
});
