import { useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import * as Location from 'expo-location';
import { API, COLORES, pesos } from '../../lib/estado';
import { C, LinearGradient, Ionicons, sombra } from '../../lib/ui';
import MapaEntrega from '../../lib/MapaEntrega';

const PASOS_PICKUP = [
  { estado: 'recibido', label: 'Pedido recibido' },
  { estado: 'en_preparacion', label: 'Preparando tu pedido' },
  { estado: 'listo', label: 'Listo para retirar' },
  { estado: 'entregado', label: 'Entregado · ¡gracias!' },
];
const PASOS_DOM = [
  { estado: 'recibido', label: 'Pedido recibido' },
  { estado: 'en_preparacion', label: 'Preparando tu pedido' },
  { estado: 'en_camino', label: 'En camino a tu casa' },
  { estado: 'entregado', label: 'Entregado · ¡gracias!' },
];

const distTexto = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`);

export default function EstadoPedido() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [pedido, setPedido] = useState<any>(null);
  const [track, setTrack] = useState<any>(null);
  const [sinPermiso, setSinPermiso] = useState(false);

  useEffect(() => {
    let activo = true;
    let intervalo: any = null;
    async function cargar() {
      try {
        const [rp, rs] = await Promise.all([
          fetch(`${API}/app/pedidos/${id}`),
          fetch(`${API}/app/pedidos/${id}/seguimiento`),
        ]);
        if (!activo) return;
        let estado: string | undefined;
        if (rp.ok) { const p = await rp.json(); estado = p.estado; setPedido(p); }
        if (rs.ok) { const s = await rs.json(); setTrack((t: any) => ({ ...(t ?? {}), ...s })); }
        // estado terminal → dejamos de pollear (el pedido ya no cambia)
        if (estado && ['entregado', 'cancelado'].includes(estado) && intervalo) {
          clearInterval(intervalo); intervalo = null;
        }
      } catch {}
    }
    cargar();
    intervalo = setInterval(cargar, 5000);
    return () => { activo = false; if (intervalo) clearInterval(intervalo); };
  }, [id]);

  // Solo pick-up activo: el cliente reporta su posición para que le asignen estacionamiento.
  useEffect(() => {
    if (pedido?.canal !== 'pickup') return;
    if (['entregado', 'cancelado'].includes(pedido?.estado)) return;
    let activo = true;
    let timer: any;
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') { if (activo) setSinPermiso(true); return; }
        const tick = async () => {
          try {
            const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
            const r = await fetch(`${API}/app/pedidos/${id}/ubicacion`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ lat: loc.coords.latitude, lng: loc.coords.longitude }),
            });
            if (r.ok && activo) setTrack(await r.json());
          } catch {}
        };
        tick();
        timer = setInterval(tick, 10000);
      } catch { if (activo) setSinPermiso(true); }
    })();
    return () => { activo = false; if (timer) clearInterval(timer); };
  }, [id, pedido?.canal, pedido?.estado]);

  if (!pedido) {
    return (
      <View style={[est.pantalla, { justifyContent: 'center' }]}>
        <Text style={{ textAlign: 'center', color: '#888' }}>Cargando tu pedido…</Text>
      </View>
    );
  }

  async function pagar() {
    try {
      const r = await fetch(`${API}/app/pedidos/${id}/pago`, { method: 'POST' });
      const d = await r.json();
      if (r.ok && d.url) Linking.openURL(d.url);
    } catch {}
  }

  const esDom = pedido.canal === 'domicilio';
  const pasos = esDom ? PASOS_DOM : PASOS_PICKUP;
  const indiceActual = pasos.findIndex((p) => p.estado === pedido.estado);
  const activo = !['entregado', 'cancelado'].includes(pedido.estado);

  return (
    <ScrollView style={est.pantalla} contentContainerStyle={{ padding: 16 }}>
      {/* ---- Seguimiento ---- */}
      {esDom ? (
        activo && pedido.estado === 'en_camino' ? (
          <>
          <LinearGradient colors={[C.negro, C.vino]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[est.dom, sombra(2)]}>
            <View style={est.domTop}>
              <Ionicons name="bicycle" size={22} color={C.dorado} />
              <Text style={est.domTitulo}>Tu pedido va en camino</Text>
            </View>
            {track?.etaMin != null ? (
              <>
                <Text style={est.domEta}>~{track.etaMin} min</Text>
                <Text style={est.domDist}>a {distTexto(track.distancia_m)} de tu casa</Text>
              </>
            ) : (
              <Text style={est.domDist}>El repartidor está saliendo…</Text>
            )}
            {/* ruta repartidor → casa */}
            <View style={est.ruta}>
              <Ionicons name="storefront" size={16} color={C.dorado} />
              <View style={est.rutaLinea}><View style={est.moto}><Ionicons name="bicycle" size={13} color="#fff" /></View></View>
              <Ionicons name="home" size={16} color="#fff" />
            </View>
            {track?.repartidor?.nombre ? <Text style={est.domRep}>Lo lleva {track.repartidor.nombre}</Text> : null}
          </LinearGradient>
          <MapaEntrega repartidor={track?.repartidor} destino={track?.destino} height={200} />
          </>
        ) : activo ? (
          <View style={[est.llegando, sombra(1)]}>
            <Ionicons name="time" size={22} color={C.rojo} />
            <View style={{ flex: 1 }}>
              <Text style={est.llegandoT}>{pedido.estado === 'listo' ? 'Tu pedido está listo' : 'Preparando tu pedido'}</Text>
              <Text style={est.llegandoS}>Te avisamos cuando salga el repartidor a tu domicilio.</Text>
            </View>
          </View>
        ) : null
      ) : activo && track?.estacionamiento ? (
        <LinearGradient colors={[C.rojo, C.rojoOscuro]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[est.estac, sombra(2)]}>
          <Ionicons name="car-sport" size={30} color="#fff" />
          <Text style={est.estacLabel}>Estacioná en el</Text>
          <Text style={est.estacNum}>N° {track.estacionamiento}</Text>
          <Text style={est.estacSub}>Dejá el auto ahí y te llevamos el pedido 🍷</Text>
        </LinearGradient>
      ) : activo && track?.llegando ? (
        <View style={[est.llegando, sombra(1)]}>
          <Ionicons name="navigate" size={22} color={C.verde} />
          <View style={{ flex: 1 }}>
            <Text style={est.llegandoT}>Estás llegando</Text>
            <Text style={est.llegandoS}>Te asignamos un estacionamiento en un momento…</Text>
          </View>
        </View>
      ) : activo && track?.distancia_m != null ? (
        <View style={[est.llegando, sombra(1)]}>
          <Ionicons name="location" size={22} color={C.rojo} />
          <View style={{ flex: 1 }}>
            <Text style={est.llegandoT}>A {distTexto(track.distancia_m)} de {track.sucursal?.nombre ?? 'la sucursal'}</Text>
            <Text style={est.llegandoS}>Cuando llegues te asignamos un estacionamiento.</Text>
          </View>
        </View>
      ) : activo && sinPermiso ? (
        <View style={[est.llegando, sombra(0)]}>
          <Ionicons name="location-outline" size={22} color={C.humo} />
          <Text style={est.llegandoS}>Activá la ubicación para que te asignemos estacionamiento al llegar.</Text>
        </View>
      ) : null}

      {/* ---- QR de retiro / dirección de envío ---- */}
      {esDom ? (
        <View style={est.tarjeta}>
          <Text style={est.envioLabel}>Envío a domicilio</Text>
          <Text style={est.envioDir}>{pedido.destino_direccion ?? track?.destino?.direccion ?? 'Tu dirección'}</Text>
          <Text style={est.envioDesde}>Sale de {track?.sucursal?.nombre ?? 'O.D.B Central'}</Text>
        </View>
      ) : (
        <View style={est.tarjetaQr}>
          <Text style={est.qrLabel}>Mostrá este código al retirar</Text>
          <Text style={est.qr}>{pedido.qr_retiro}</Text>
          <Text style={est.sucursal}>
            {pedido.sucursal?.nombre}
            {pedido.sucursal?.direccion ? ` · ${pedido.sucursal.direccion}` : ''}
          </Text>
        </View>
      )}

      {activo && (pedido.estado === 'recibido' ? (
        <Pressable onPress={pagar} style={est.pagarBtn}>
          <Ionicons name="card" size={18} color="#fff" />
          <Text style={est.pagarTxt}>Pagar con Mercado Pago</Text>
        </Pressable>
      ) : (
        <View style={est.pagado}>
          <Ionicons name="checkmark-circle" size={18} color={C.verde} />
          <Text style={est.pagadoTxt}>Pago confirmado</Text>
        </View>
      ))}

      <View style={est.tarjeta}>
        {pedido.estado === 'cancelado' ? (
          <Text style={est.cancelado}>Pedido cancelado</Text>
        ) : (
          pasos.map((paso, i) => (
            <View key={paso.estado} style={est.paso}>
              <View style={[est.punto, i <= indiceActual ? est.puntoActivo : null, i === indiceActual ? est.puntoActual : null]} />
              <Text style={[est.pasoTexto, i <= indiceActual ? est.pasoTextoActivo : null]}>{paso.label}</Text>
            </View>
          ))
        )}
      </View>

      <View style={est.tarjeta}>
        {pedido.items?.map((i: any, j: number) => (
          <View key={j} style={est.itemFila}>
            <Text style={est.itemTexto}>{Math.round(Number(i.cantidad))}× {i.producto?.nombre}</Text>
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
  estac: { borderRadius: 20, padding: 22, alignItems: 'center', marginBottom: 12 },
  estacLabel: { color: 'rgba(255,255,255,0.85)', fontSize: 13, marginTop: 6 },
  estacNum: { color: '#fff', fontSize: 46, fontWeight: '800', letterSpacing: 1, marginTop: 2 },
  estacSub: { color: 'rgba(255,255,255,0.9)', fontSize: 13, marginTop: 4, textAlign: 'center' },
  dom: { borderRadius: 20, padding: 20, marginBottom: 12 },
  domTop: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  domTitulo: { color: '#fff', fontSize: 16, fontWeight: '800' },
  domEta: { color: '#fff', fontSize: 38, fontWeight: '800', marginTop: 8, letterSpacing: -1 },
  domDist: { color: 'rgba(255,255,255,0.8)', fontSize: 13, marginTop: 2 },
  ruta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16 },
  rutaLinea: { flex: 1, height: 2, backgroundColor: 'rgba(255,255,255,0.3)', borderRadius: 1, alignItems: 'center', justifyContent: 'center' },
  moto: { position: 'absolute', backgroundColor: C.rojo, width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  domRep: { color: C.dorado, fontSize: 13, fontWeight: '700', marginTop: 16 },
  llegando: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 12 },
  llegandoT: { fontSize: 15, fontWeight: '800', color: C.tinta },
  llegandoS: { fontSize: 12.5, color: C.humo, marginTop: 2, flex: 1, lineHeight: 17 },
  tarjetaQr: { backgroundColor: COLORES.negro, borderRadius: 18, padding: 20, alignItems: 'center', marginBottom: 12 },
  qrLabel: { color: '#aaa', fontSize: 12 },
  qr: { color: COLORES.blanco, fontSize: 22, fontWeight: '700', letterSpacing: 2, marginVertical: 8 },
  sucursal: { color: COLORES.crema, fontSize: 12 },
  envioLabel: { color: C.humo, fontSize: 12, fontWeight: '700' },
  envioDir: { color: C.tinta, fontSize: 16, fontWeight: '800', marginTop: 3 },
  envioDesde: { color: C.humo, fontSize: 12, marginTop: 3 },
  pagarBtn: { flexDirection: 'row', gap: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: '#009EE3', borderRadius: 16, padding: 15, marginBottom: 12 },
  pagarTxt: { color: '#fff', fontWeight: '800', fontSize: 15 },
  pagado: { flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E6F2EC', borderRadius: 16, padding: 13, marginBottom: 12 },
  pagadoTxt: { color: C.verde, fontWeight: '800', fontSize: 14 },
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
