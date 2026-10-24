// Arqueo de stock (24/10/2026): lo que valida el API antes de tocar la base.
import { BadRequestException } from '@nestjs/common';
import { alcanceValido, mensajeDeError } from './arqueo.service';

const U = '7d1f2c3a-1b2c-4d5e-8f90-123456789abc';

describe('alcanceValido', () => {
  it('sin alcance es todo el local', () => {
    expect(alcanceValido(undefined)).toEqual({ tipo: 'todo' });
    expect(alcanceValido({ tipo: 'todo', ids: ['x'] })).toEqual({ tipo: 'todo' });
  });
  it('rubros: se quedan solo los ids válidos y hace falta al menos uno', () => {
    expect(alcanceValido({ tipo: 'categorias', ids: [U, 'nada', 3] })).toEqual({ tipo: 'categorias', ids: [U], nombres: undefined });
    expect(() => alcanceValido({ tipo: 'categorias', ids: ['nada'] })).toThrow(BadRequestException);
  });
  it('proveedor: exige un id válido', () => {
    expect(alcanceValido({ tipo: 'proveedor', id: U, nombre: 'Distrisur' })).toEqual({ tipo: 'proveedor', id: U, nombre: 'Distrisur' });
    expect(() => alcanceValido({ tipo: 'proveedor', id: "1' or 1=1" })).toThrow(BadRequestException);
  });
  it('un tipo desconocido no pasa', () => {
    expect(() => alcanceValido({ tipo: 'sql' })).toThrow(BadRequestException);
  });
});

describe('mensajeDeError', () => {
  it('saca el prefijo técnico de Postgres', () => {
    expect(mensajeDeError('ERROR:  P0001: Faltan 3 reconteos: recontalos')).toBe('Faltan 3 reconteos: recontalos');
    expect(mensajeDeError('El arqueo está aplicado')).toBe('El arqueo está aplicado');
    expect(mensajeDeError('')).toBe('No se pudo completar');
  });
});
