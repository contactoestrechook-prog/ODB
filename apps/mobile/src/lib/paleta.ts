// Paleta premium ODB: ÚNICA fuente de colores de la app.
//
// Antes había dos paletas que no coincidían (COLORES en estado.tsx, con negro
// #000000 y crema #F0EBE2, y C en ui.tsx). Quedaron los valores de ui.tsx como
// canónicos. Vive en un módulo aparte, sin imports, porque ui.tsx importa de
// estado.tsx: si estado.tsx importara de ui.tsx se armaría un ciclo y, según qué
// archivo cargue primero, la paleta llegaría vacía.
//
// ui.tsx la re-exporta como `C` y estado.tsx como `COLORES` (alias histórico).
export const C = {
  rojo: '#B82D25',
  rojoOscuro: '#932A1F',
  vino: '#5A1A16',
  negro: '#1A1412',
  tinta: '#2A201C',
  blanco: '#FFFFFF',
  crema: '#F4EEE4',
  cremaProf: '#EBE3D6',
  humo: '#9B9088',
  linea: '#ECE4D7',
  dorado: '#C9A96E',
  verde: '#2F7A4F',
};
