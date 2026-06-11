import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { API, COLORES, pesos } from '../../lib/estado';

const PASOS = [
  { estado: 'recibido', label: 'Pedido recibido' },
  { estado: 'en_preparacion', label: 'Preparando tu pedido' },
  { estado: 'listo', label: 'Listo para retirar' },
  { estado: 'entregado', label: 'Entregado · ¡gracias!' },
];

export default function EstadoPedido() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [pedido, setPedido] = useState<any>(null);

  useEffect(() => {
    let activo = true;
    async function cargar() {
      try {
        const res = await fetch(`${API}/app/pedidos/${id}`);
        if (res.ok && activo) setPedido(await res.json());
      } catch {}
    }
    cargar();
    const intervalo = setInterval(cargar, 5000);
    return () => {
      activo = false;
      clearInterval(intervalo);
    };
  }, [id]);

  if (!pedido) {
    return (
      <View style={[est.pantalla, { justifyContent: 'center' }]}>
        <Text style={{ textAlign: 'center', color: '#888' }}>Cargando tu pedido…</Text>
      </View>
    );
  }

  const indiceActual = PASOS.findIndex((p) => p.estado === pedido.estado);

  return (
    <ScrollView style={est.pantalla} contentContainerStyle={{ padding: 16 }}>
      <View style={est.tarjetaQr}>
        <Text style={est.qrLabel}>Mostrá este código al retirar</Text>
        <Text style={est.qr}>{pedido.qr_retiro}</Text>
        <Text style={est.sucursal}>
          {pedido.sucursal?.nombre}
          {pedido.sucursal?.direccion ? ` · ${pedido.sucursal.direccion}` : ''}
        </Text>
      </View>

      <View style={est.tarjeta}>
        {pedido.estado === 'cancelado' ? (
          <Text style={est.cancelado}>Pedido cancelado</Text>
        ) : (
          PASOS.map((paso, i) => (
            <View key={paso.estado} style={est.paso}>
              <View
                style={[
                  est.punto,
                  i <= indiceActual ? est.puntoActivo : null,
                  i === indiceActual ? est.puntoActual : null,
                ]}
              />
              <Text style={[est.pasoTexto, i <= indiceActual ? est.pasoTextoActivo : null]}>
                {paso.label}
              </Text>
            </View>
          ))
        )}
      </View>

      <View style={est.tarjeta}>
        {pedido.items?.map((i: any, j: number) => (
          <View key={j} style={est.itemFila}>
            <Text style={est.itemTexto}>
              {Math.round(Number(i.cantidad))}× {i.producto?.nombre}
            </Text>
            <Text style={est.itemPrecio}>{pesos(Number(i.cantidad) * Number(i.precio_unitario))}</Text>
          </View>
        ))}
        <View style={[est.itemFila, est.totalFila]}>
          <Text style={est.totalTexto}>Total</Text>
          <Text style={est.totalTexto}>{pesos(pedido.total)}</Text>
        </View>
      </View>
    </ScrollView>
  );
}

const est = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: COLORES.crema },
  tarjetaQr: { backgroundColor: COLORES.negro, borderRadius: 18, padding: 20, alignItems: 'center', marginBottom: 12 },
  qrLabel: { color: '#aaa', fontSize: 12 },
  qr: { color: COLORES.blanco, fontSize: 22, fontWeight: '700', letterSpacing: 2, marginVertical: 8 },
  sucursal: { color: COLORES.crema, fontSize: 12 },
  tarjeta: { backgroundColor: COLORES.blanco, borderRadius: 18, padding: 18, marginBottom: 12 },
  paso: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  punto: { width: 14, height: 14, borderRadius: 7, backgroundColor: '#ddd' },
  puntoActivo: { backgroundColor: COLORES.negro },
  puntoActual: { backgroundColor: COLORES.rojo, transform: [{ scale: 1.25 }] },
  pasoTexto: { color: '#999', fontSize: 14 },
  pasoTextoActivo: { color: COLORES.negro, fontWeight: '600' },
  cancelado: { color: COLORES.rojoOscuro, fontWeight: '600', textAlign: 'center' },
  itemFila: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  itemTexto: { color: COLORES.negro, fontSize: 13, flex: 1 },
  itemPrecio: { color: COLORES.negro, fontSize: 13, fontWeight: '600' },
  totalFila: { borderTopWidth: 1, borderTopColor: '#eee', marginTop: 8, paddingTop: 10 },
  totalTexto: { fontSize: 16, fontWeight: '700', color: COLORES.negro },
});
