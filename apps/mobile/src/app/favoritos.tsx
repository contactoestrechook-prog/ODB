import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { API, useEstado, type Producto } from '../lib/estado';
import { C, TarjetaProducto, Ionicons } from '../lib/ui';

export default function Favoritos() {
  const { cliente, favoritos } = useEstado();
  const [productos, setProductos] = useState<Producto[]>([]);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    if (!cliente?.token) return;
    fetch(`${API}/mi/favoritos`, { headers: { Authorization: `Bearer ${cliente.token}` } })
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setProductos(d ?? []))
      .catch(() => {})
      .finally(() => setCargando(false));
  }, [cliente?.token]);

  // si destildás un corazón, desaparece en el acto (sin refetch)
  const visibles = productos.filter((p) => !p.id || favoritos.has(p.id));

  if (cargando) return <View style={est.centro}><ActivityIndicator color={C.rojo} /></View>;

  if (visibles.length === 0) {
    return (
      <View style={est.centro}>
        <Ionicons name="heart-outline" size={40} color={C.humo} />
        <Text style={est.vacioTitulo}>Sin favoritos todavía</Text>
        <Text style={est.vacioTxt}>Tocá el ♥ en cualquier producto para guardarlo acá y comprarlo más rápido.</Text>
      </View>
    );
  }

  return (
    <FlatList
      style={est.pantalla}
      data={visibles} key="fav-2" numColumns={2} keyExtractor={(p) => p.sku}
      columnWrapperStyle={{ gap: 12, paddingHorizontal: 16 }}
      contentContainerStyle={{ paddingVertical: 14, gap: 12 }}
      renderItem={({ item }) => <TarjetaProducto p={item} grid />}
    />
  );
}

const est = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: C.crema },
  centro: { flex: 1, backgroundColor: C.crema, alignItems: 'center', justifyContent: 'center', padding: 36, gap: 10 },
  vacioTitulo: { fontSize: 17, fontWeight: '800', color: C.tinta },
  vacioTxt: { fontSize: 13.5, color: C.humo, textAlign: 'center', lineHeight: 20 },
});
