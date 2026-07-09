import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { pesos, useEstado, type Producto } from '../lib/estado';
import { apiGet } from '../lib/api';
import { C, TarjetaProducto, Ionicons, sombra, toque } from '../lib/ui';

const fecha = (iso: string) =>
  new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

type ItemCompra = { sku: string; nombre: string; cantidad: number; producto: Producto | null };
type Compra = { tipo: 'pedido' | 'compra'; id: string; fecha: string; estado: string; canal: string; total: number; items: ItemCompra[] };

const CANAL: Record<string, string> = {
  pickup: 'Retiro en local', domicilio: 'Envío a domicilio', self_checkout: 'Comprá Fácil',
  mostrador: 'En el local', web: 'Web', whatsapp: 'WhatsApp', pedidosya: 'PedidosYa',
};

export default function Compras() {
  const router = useRouter();
  const { cliente, agregarVarios } = useEstado();
  const [compras, setCompras] = useState<Compra[]>([]);
  const [frecuentes, setFrecuentes] = useState<Producto[]>([]);
  const [cargando, setCargando] = useState(true);
  const [aviso, setAviso] = useState<string | null>(null);

  useEffect(() => {
    if (!cliente?.token) return;
    Promise.all([
      apiGet<Compra[]>('/mi/compras').catch(() => []),
      apiGet<Producto[]>('/mi/frecuentes').catch(() => []),
    ])
      .then(([c, f]) => { setCompras(c ?? []); setFrecuentes(f ?? []); })
      .catch(() => {})
      .finally(() => setCargando(false));
  }, [cliente?.token]);

  function recomprar(items: ItemCompra[]) {
    const validos = items
      .filter((i) => i.producto && Number(i.producto.precio) > 0)
      .map((i) => ({ p: i.producto as Producto, cantidad: i.cantidad }));
    if (!validos.length) { setAviso('Esos productos ya no están disponibles.'); return; }
    toque();
    agregarVarios(validos);
    router.push('/carrito');
  }

  if (cargando) return <View style={est.centro}><ActivityIndicator color={C.rojo} /></View>;

  return (
    <ScrollView style={est.pantalla} contentContainerStyle={{ paddingBottom: 24 }}>
      {/* frecuentes */}
      {frecuentes.length > 0 && (
        <View style={{ marginTop: 14 }}>
          <Text style={est.seccion}>Tus infaltables</Text>
          <FlatList
            horizontal showsHorizontalScrollIndicator={false}
            data={frecuentes} keyExtractor={(p) => p.sku}
            contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
            renderItem={({ item }) => <TarjetaProducto p={item} ancho={150} />}
          />
        </View>
      )}

      <Text style={est.seccion}>Historial de compras</Text>
      {aviso && <Text style={est.aviso}>{aviso}</Text>}
      {compras.length === 0 && (
        <View style={est.vacio}>
          <Ionicons name="receipt-outline" size={34} color={C.humo} />
          <Text style={est.vacioTxt}>Todavía no tenés compras registradas.</Text>
        </View>
      )}

      {compras.map((c) => (
        <View key={c.tipo + c.id} style={[est.card, sombra(0)]}>
          <View style={est.cardTop}>
            <View style={est.cardIcono}>
              <Ionicons name={c.canal === 'domicilio' ? 'bicycle' : c.canal === 'self_checkout' ? 'scan' : 'storefront'} size={16} color={C.rojo} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={est.cardCanal}>{CANAL[c.canal] ?? 'Compra'}</Text>
              <Text style={est.cardFecha}>{fecha(c.fecha)}</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={est.cardTotal}>{pesos(c.total)}</Text>
              {c.tipo === 'pedido' && <Text style={est.estado}>{c.estado}</Text>}
            </View>
          </View>

          <Text numberOfLines={2} style={est.items}>
            {c.items.map((i) => `${i.cantidad}× ${i.nombre}`).join(' · ')}
          </Text>

          <Pressable onPress={() => recomprar(c.items)} style={est.recomprar}>
            <Ionicons name="refresh" size={15} color={C.rojo} />
            <Text style={est.recomprarTxt}>Volver a comprar</Text>
          </Pressable>
        </View>
      ))}
    </ScrollView>
  );
}

const est = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: C.crema },
  centro: { flex: 1, backgroundColor: C.crema, alignItems: 'center', justifyContent: 'center' },
  seccion: { fontSize: 16, fontWeight: '800', color: C.tinta, paddingHorizontal: 16, marginTop: 18, marginBottom: 10 },
  aviso: { color: C.vino, fontSize: 12.5, paddingHorizontal: 16, marginBottom: 8 },
  vacio: { alignItems: 'center', gap: 12, marginTop: 40 },
  vacioTxt: { color: C.humo, fontSize: 13.5 },
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 15, marginHorizontal: 16, marginBottom: 10 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  cardIcono: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#FBE9E7', alignItems: 'center', justifyContent: 'center' },
  cardCanal: { fontSize: 14, fontWeight: '700', color: C.tinta },
  cardFecha: { fontSize: 11.5, color: C.humo, marginTop: 2 },
  cardTotal: { fontSize: 15.5, fontWeight: '800', color: C.tinta },
  estado: { fontSize: 11, color: C.humo, marginTop: 2, textTransform: 'capitalize' },
  items: { fontSize: 12.5, color: '#5f554d', marginTop: 11, lineHeight: 18 },
  recomprar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, marginTop: 13, borderWidth: 1.3, borderColor: C.rojo, borderRadius: 12, paddingVertical: 9 },
  recomprarTxt: { color: C.rojo, fontSize: 13.5, fontWeight: '800' },
});
