import { useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { API, COLORES, pesos, useEstado } from '../../lib/estado';

export default function Carrito() {
  const router = useRouter();
  const { carrito, agregar, quitar, vaciar, total, cliente } = useEstado();
  const [sucursales, setSucursales] = useState<{ id: string; nombre: string }[]>([]);
  const [sucursalId, setSucursalId] = useState('');
  const [pidiendo, setPidiendo] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API}/sucursales`)
      .then((r) => r.json())
      .then((s) => {
        setSucursales(s);
        if (s[0]) setSucursalId(s[0].id);
      })
      .catch(() => {});
  }, []);

  async function pedir() {
    if (!carrito.length || pidiendo) return;
    setPidiendo(true);
    setError(null);
    try {
      const res = await fetch(`${API}/app/pedidos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sucursalId,
          items: carrito.map((r) => ({ sku: r.sku, cantidad: r.cantidad })),
          dni: cliente?.dni || undefined,
        }),
      });
      const datos = await res.json();
      if (!res.ok) throw new Error(datos.message ?? 'No se pudo crear el pedido');
      vaciar();
      router.push(`/pedido/${datos.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
    setPidiendo(false);
  }

  return (
    <View style={est.pantalla}>
      <FlatList
        data={carrito}
        keyExtractor={(r) => r.sku}
        contentContainerStyle={{ padding: 12 }}
        ListEmptyComponent={
          <Text style={est.vacio}>Tu carrito está vacío. Sumá productos desde el catálogo o el inicio.</Text>
        }
        renderItem={({ item: r }) => (
          <View style={est.fila}>
            <View style={{ flex: 1 }}>
              <Text style={est.nombre}>{r.nombre}</Text>
              {r.descuento && <Text style={est.promo}>{r.descuento}</Text>}
            </View>
            <View style={est.cantidadCaja}>
              <Pressable onPress={() => quitar(r.sku)} style={est.botonCantidad}>
                <Text style={est.botonCantidadTexto}>−</Text>
              </Pressable>
              <Text style={est.cantidad}>{r.cantidad}</Text>
              <Pressable onPress={() => agregar(r)} style={[est.botonCantidad, { backgroundColor: COLORES.negro }]}>
                <Text style={[est.botonCantidadTexto, { color: COLORES.blanco }]}>+</Text>
              </Pressable>
            </View>
            <Text style={est.importe}>{pesos((Number(r.precio) || 0) * r.cantidad)}</Text>
          </View>
        )}
      />

      {carrito.length > 0 && (
        <View style={est.pie}>
          <View style={est.sucursales}>
            {sucursales.map((s) => (
              <Pressable
                key={s.id}
                onPress={() => setSucursalId(s.id)}
                style={[est.sucursal, sucursalId === s.id && est.sucursalActiva]}
              >
                <Text style={[est.sucursalTexto, sucursalId === s.id && { color: COLORES.blanco }]}>
                  {s.nombre}
                </Text>
              </Pressable>
            ))}
          </View>
          <View style={est.totalFila}>
            <Text style={est.totalLabel}>Total</Text>
            <Text style={est.total}>{pesos(total)}</Text>
          </View>
          {error && <Text style={est.error}>{error}</Text>}
          <Pressable onPress={pedir} disabled={pidiendo} style={est.botonPedir}>
            <Text style={est.botonPedirTexto}>
              {pidiendo ? 'Enviando…' : 'Pedir para retirar (pick-up)'}
            </Text>
          </Pressable>
          <Text style={est.nota}>
            Pagás con Mercado Pago al confirmar · te avisamos cuando esté listo
          </Text>
        </View>
      )}
    </View>
  );
}

const est = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: COLORES.crema },
  vacio: { textAlign: 'center', color: '#888', marginTop: 48, paddingHorizontal: 32, lineHeight: 20 },
  fila: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: COLORES.blanco,
    borderRadius: 14, padding: 12, marginBottom: 8, gap: 10,
  },
  nombre: { fontSize: 13, color: COLORES.negro, fontWeight: '500' },
  promo: { fontSize: 11, color: COLORES.rojo, marginTop: 2 },
  cantidadCaja: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  botonCantidad: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: COLORES.crema,
    alignItems: 'center', justifyContent: 'center',
  },
  botonCantidadTexto: { fontSize: 16, fontWeight: '700', color: COLORES.negro },
  cantidad: { width: 22, textAlign: 'center', fontWeight: '600', color: COLORES.negro },
  importe: { width: 76, textAlign: 'right', fontWeight: '700', color: COLORES.negro, fontSize: 13 },
  pie: { backgroundColor: COLORES.blanco, padding: 16, borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  sucursales: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  sucursal: {
    flex: 1, borderWidth: 1, borderColor: '#ddd', borderRadius: 18, paddingVertical: 8, alignItems: 'center',
  },
  sucursalActiva: { backgroundColor: COLORES.negro, borderColor: COLORES.negro },
  sucursalTexto: { fontSize: 12, color: COLORES.negro, fontWeight: '500' },
  totalFila: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 },
  totalLabel: { color: '#888', fontSize: 13 },
  total: { fontSize: 26, fontWeight: '700', color: COLORES.negro },
  error: { color: COLORES.rojoOscuro, fontSize: 12, marginBottom: 8 },
  botonPedir: { backgroundColor: COLORES.rojo, borderRadius: 26, padding: 15, alignItems: 'center' },
  botonPedirTexto: { color: COLORES.blanco, fontWeight: '700', fontSize: 15 },
  nota: { textAlign: 'center', color: '#999', fontSize: 11, marginTop: 8 },
});
