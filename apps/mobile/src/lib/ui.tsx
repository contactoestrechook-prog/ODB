import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import Ionicons from '@expo/vector-icons/Ionicons';
import { API, pesos, useEstado, type Producto } from './estado';

// Paleta premium ODB
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

export const sombra = (n = 1) => ({
  shadowColor: '#3a2a14',
  shadowOpacity: 0.10 + n * 0.02,
  shadowRadius: 8 + n * 4,
  shadowOffset: { width: 0, height: 3 + n * 2 },
  elevation: 2 + n * 2,
});

const toque = () => { try { Haptics.selectionAsync(); } catch {} };

export function descuentoPct(p: Producto): number | null {
  if (p.descuento && p.precioLista && p.precio && Number(p.precio) < Number(p.precioLista)) {
    return Math.round((1 - Number(p.precio) / Number(p.precioLista)) * 100);
  }
  return null;
}

// ---- Tarjeta de producto premium ----
export function TarjetaProducto({ p, ancho = 168, grid = false }: { p: Producto; ancho?: number; grid?: boolean }) {
  const { agregar, cliente, esFavorito, alternarFavorito } = useEstado();
  const pct = descuentoPct(p);
  const sinStock = p.stockTotal != null && p.stockTotal <= 0;
  const fav = esFavorito(p.id);
  const [avisado, setAvisado] = useState(false);

  const agregarCarrito = () => { toque(); agregar(p); };
  const tocarFav = () => { toque(); alternarFavorito(p.id); };
  const avisarme = async () => {
    if (!cliente?.token || !p.id) return;
    toque(); setAvisado(true);
    try {
      await fetch(`${API}/mi/avisos/${p.id}`, { method: 'POST', headers: { Authorization: `Bearer ${cliente.token}` } });
    } catch {}
  };

  return (
    <View style={[est.card, grid ? { flex: 1, marginRight: 0 } : { width: ancho }, sombra(1)]}>
      <View style={est.imgWrap}>
        {p.imagenUrl ? (
          <Image source={{ uri: p.imagenUrl }} style={est.img} contentFit="cover" transition={200} />
        ) : (
          <View style={[est.img, est.imgVacia]}>
            <Text style={est.imgInicial}>{(p.nombre ?? '?')[0]}</Text>
          </View>
        )}
        {sinStock ? (
          <View style={est.sinStockTag}><Text style={est.sinStockTxt}>Sin stock</Text></View>
        ) : pct != null ? (
          <View style={est.badgeOff}><Text style={est.badgeOffTxt}>-{pct}%</Text></View>
        ) : null}
        {p.descuentoComunidad && (
          <View style={est.badgeComunidad}><Ionicons name="lock-closed" size={11} color="#fff" /></View>
        )}
        {cliente && (
          <Pressable onPress={tocarFav} style={est.favBtn} hitSlop={8}>
            <Ionicons name={fav ? 'heart' : 'heart-outline'} size={17} color={fav ? C.rojo : '#fff'} />
          </Pressable>
        )}
        {sinStock ? (
          cliente && (
            <Pressable onPress={avisarme} style={[est.fab, est.fabAviso]} hitSlop={8}>
              <Ionicons name={avisado ? 'checkmark' : 'notifications-outline'} size={18} color="#fff" />
            </Pressable>
          )
        ) : (
          <Pressable onPress={agregarCarrito} style={est.fab} hitSlop={8}>
            <Ionicons name="add" size={22} color="#fff" />
          </Pressable>
        )}
      </View>
      <View style={est.cardBody}>
        <Text numberOfLines={2} style={est.cardNombre}>{p.nombre}</Text>
        {sinStock && avisado ? (
          <Text style={est.avisadoTxt}>Te avisamos cuando vuelva ✓</Text>
        ) : pct != null ? (
          <View style={est.precioRow}>
            <Text style={est.precioPromo}>{pesos(p.precio)}</Text>
            <Text style={est.precioTach}>{pesos(p.precioLista)}</Text>
          </View>
        ) : (
          <Text style={est.precio}>{pesos(p.precio)}</Text>
        )}
      </View>
    </View>
  );
}

// ---- Encabezado de sección ----
export function Seccion({ titulo, sub }: { titulo: string; sub?: string }) {
  return (
    <View style={est.seccion}>
      <Text style={est.seccionTitulo}>{titulo}</Text>
      {sub && <Text style={est.seccionSub}>{sub}</Text>}
    </View>
  );
}

// ---- Chip de categoría ----
export function CategoriaChip({ emoji, label, onPress, activo }: { emoji: string; label: string; onPress?: () => void; activo?: boolean }) {
  return (
    <Pressable onPress={() => { toque(); onPress?.(); }} style={[est.cat, activo && est.catActiva]}>
      <Text style={est.catEmoji}>{emoji}</Text>
      <Text style={[est.catLabel, activo && { color: '#fff' }]}>{label}</Text>
    </Pressable>
  );
}

export { LinearGradient, Ionicons, toque };

const est = StyleSheet.create({
  card: { backgroundColor: C.blanco, borderRadius: 20, marginRight: 12, overflow: 'hidden' },
  imgWrap: { position: 'relative' },
  img: { width: '100%', height: 130, backgroundColor: C.cremaProf },
  imgVacia: { alignItems: 'center', justifyContent: 'center' },
  imgInicial: { fontSize: 38, fontWeight: '800', color: '#cabfae' },
  badgeOff: { position: 'absolute', top: 8, left: 8, backgroundColor: C.rojo, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  badgeOffTxt: { color: '#fff', fontSize: 12, fontWeight: '800' },
  sinStockTag: { position: 'absolute', top: 8, left: 8, backgroundColor: 'rgba(26,20,18,0.78)', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  sinStockTxt: { color: '#fff', fontSize: 11, fontWeight: '700' },
  badgeComunidad: { position: 'absolute', bottom: 8, left: 8, backgroundColor: C.negro, borderRadius: 12, padding: 5 },
  favBtn: { position: 'absolute', top: 8, right: 8, backgroundColor: 'rgba(0,0,0,0.32)', width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  fab: { position: 'absolute', bottom: -14, right: 10, backgroundColor: C.rojo, width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', ...sombra(1) },
  fabAviso: { backgroundColor: C.negro },
  avisadoTxt: { fontSize: 12, color: C.verde, fontWeight: '700', marginTop: 8 },
  cardBody: { padding: 12, paddingTop: 18 },
  cardNombre: { fontSize: 13, color: C.tinta, fontWeight: '600', minHeight: 34, lineHeight: 17 },
  precio: { fontSize: 17, fontWeight: '800', color: C.tinta, marginTop: 6 },
  precioRow: { marginTop: 6, flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  precioPromo: { fontSize: 17, fontWeight: '800', color: C.rojo },
  precioTach: { fontSize: 12, color: C.humo, textDecorationLine: 'line-through' },
  seccion: { paddingHorizontal: 18, marginTop: 22, marginBottom: 10 },
  seccionTitulo: { fontSize: 19, fontWeight: '800', color: C.tinta, letterSpacing: -0.3 },
  seccionSub: { fontSize: 13, color: C.humo, marginTop: 1 },
  cat: { alignItems: 'center', justifyContent: 'center', backgroundColor: C.blanco, borderRadius: 16, paddingVertical: 10, paddingHorizontal: 14, marginRight: 10, minWidth: 76, ...sombra(0) },
  catActiva: { backgroundColor: C.rojo },
  catEmoji: { fontSize: 24 },
  catLabel: { fontSize: 11, fontWeight: '600', color: C.tinta, marginTop: 4 },
});
