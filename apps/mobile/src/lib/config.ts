import { Platform } from 'react-native';

// En desarrollo (Expo Go / web local) se usa la API local; en un build real
// (EAS preview/producción, __DEV__ === false) se usa la API de producción.
// Para probar en el celular con Expo Go contra tu máquina, poné tu IP de LAN abajo.
const LOCAL = Platform.OS === 'web' ? 'http://localhost:3001' : 'http://192.168.0.10:3001';
const PROD = 'https://odb-api-production.up.railway.app';

export const API = __DEV__ ? LOCAL : PROD;
