import { Platform } from 'react-native';

// En el celular real, reemplazar localhost por la IP de la máquina que corre la API
export const API = Platform.OS === 'web' ? 'http://localhost:3001' : 'http://192.168.0.10:3001';
