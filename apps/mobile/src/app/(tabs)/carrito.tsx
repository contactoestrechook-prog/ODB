import { useEffect, useState } from 'react';
import { FlatList, Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { pesos, useEstado } from '../../lib/estado';
import { apiGet, apiPost } from '../../lib/api';
import { C, LinearGradient, Ionicons, sombra, toque } from '../../lib/ui';

export default function Carrito() {
  const router = useRouter();
  const { carrito, agregar, quitar, vaciar, total, cliente } = useEstado();
  const [central, setCentral] = useState<{ id: string; nombre: string; direccion?: string } | null>(null);
  const [modo, setModo] = useState<'pickup' | 'domicilio'>('pickup');
  const [direccion, setDireccion] = useState('');
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [ubicando, setUbicando] = useState(false);
  const [pidiendo, setPidiendo] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unidades = carrito.reduce((s, r) => s + r.cantidad, 0);

  useEffect(() => {
    // Pick-up y domicilio: ambos salen de la sucursal central (Suc Sant Thomas).
    apiGet('/sucursal-pickup', { auth: false })
      .then((s) => setCentral(s && s.id ? s : null))
      .catch(() => {});
  }, []);

  async function usarMiUbicacion() {
    if (ubicando) return;
    toque();
    setUbicando(true);
    setError(null);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') { setError('Necesitamos permiso de ubicación para el envío.'); setUbicando(false); return; }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      setCoords({ lat: loc.coords.latitude, lng: loc.coords.longitude });
      try {
        const g = await Location.reverseGeocodeAsync({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
        const a = g[0];
        if (a) setDireccion([a.street, a.streetNumber, a.city].filter(Boolean).join(' '));
      } catch {}
    } catch { setError('No pudimos obtener tu ubicación.'); }
    setUbicando(false);
  }

  async function pedir() {
    if (!carrito.length || pidiendo) return;
    if (modo === 'domicilio' && !direccion.trim()) { setError('Ingresá la dirección de entrega.'); return; }
    toque();
    setPidiendo(true);
    setError(null);
    try {
      // con el token del cliente (si hay sesión) el pedido queda atribuido:
      // suma puntos e historial. El guest checkout sigue funcionando sin token.
      const datos = await apiPost('/app/pedidos', {
        tipo: modo,
        items: carrito.map((r) => ({ sku: r.sku, cantidad: r.cantidad })),
        dni: cliente?.dni || undefined,
        ...(modo === 'domicilio'
          ? { destino: { direccion: direccion.trim(), lat: coords?.lat, lng: coords?.lng } }
          : {}),
      });
      vaciar();
      // abrir el checkout de Mercado Pago (si está configurado)
      try {
        const pd = await apiPost(`/app/pedidos/${datos.id}/pago`, undefined, { auth: false });
        if (pd?.url) await Linking.openURL(pd.url);
      } catch {}
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
        contentContainerStyle={{ padding: 16, paddingBottom: 24 }}
        ListHeaderComponent={
          carrito.length > 0 ? (
            <Text style={est.encabezado}>{unidades} {unidades === 1 ? 'producto' : 'productos'} en tu carrito</Text>
          ) : null
        }
        ListEmptyComponent={
          <View style={est.vacioWrap}>
            <View style={est.vacioIcono}><Ionicons name="cart-outline" size={40} color={C.humo} /></View>
            <Text style={est.vacioTitulo}>Tu carrito está vacío</Text>
            <Text style={est.vacioTexto}>Sumá productos desde el catálogo o el inicio.</Text>
            <Pressable onPress={() => { toque(); router.push('/catalogo'); }} style={est.vacioBoton}>
              <Text style={est.vacioBotonTxt}>Ver catálogo</Text>
            </Pressable>
          </View>
        }
        renderItem={({ item: r }) => (
          <View style={[est.fila, sombra(0)]}>
            {r.imagenUrl ? (
              <Image source={{ uri: r.imagenUrl }} style={est.thumb} contentFit="cover" transition={150} />
            ) : (
              <View style={[est.thumb, est.thumbVacio]}><Text style={est.thumbInicial}>{(r.nombre ?? '?')[0]}</Text></View>
            )}
            <View style={{ flex: 1 }}>
              <Text numberOfLines={2} style={est.nombre}>{r.nombre}</Text>
              <Text style={est.precioUnit}>{pesos(r.precio)} c/u</Text>
              <View style={est.cantidadCaja}>
                <Pressable onPress={() => { toque(); quitar(r.sku); }} style={est.botonCantidad}>
                  <Ionicons name={r.cantidad === 1 ? 'trash-outline' : 'remove'} size={15} color={C.tinta} />
                </Pressable>
                <Text style={est.cantidad}>{r.cantidad}</Text>
                <Pressable onPress={() => { toque(); agregar(r); }} style={[est.botonCantidad, est.botonMas]}>
                  <Ionicons name="add" size={15} color="#fff" />
                </Pressable>
              </View>
            </View>
            <Text style={est.importe}>{pesos((Number(r.precio) || 0) * r.cantidad)}</Text>
          </View>
        )}
      />

      {carrito.length > 0 && (
        <View style={[est.pie, sombra(2)]}>
          <View style={est.modos}>
            <Pressable onPress={() => { toque(); setModo('pickup'); }} style={[est.modo, modo === 'pickup' && est.modoOn]}>
              <Ionicons name="storefront-outline" size={16} color={modo === 'pickup' ? '#fff' : C.tinta} />
              <Text style={[est.modoTxt, modo === 'pickup' && { color: '#fff' }]}>Retiro</Text>
            </Pressable>
            <Pressable onPress={() => { toque(); setModo('domicilio'); }} style={[est.modo, modo === 'domicilio' && est.modoOn]}>
              <Ionicons name="bicycle-outline" size={16} color={modo === 'domicilio' ? '#fff' : C.tinta} />
              <Text style={[est.modoTxt, modo === 'domicilio' && { color: '#fff' }]}>A domicilio</Text>
            </Pressable>
          </View>

          {modo === 'pickup' ? (
            <>
              <Text style={est.pieLabel}>Retirás en</Text>
              <View style={est.central}>
                <Ionicons name="storefront" size={16} color={C.rojo} />
                <View style={{ flex: 1 }}>
                  <Text style={est.centralNombre}>{central?.nombre ?? 'Suc Sant Thomas'}</Text>
                  {central?.direccion ? <Text style={est.centralDir}>{central.direccion}</Text> : null}
                </View>
                <Ionicons name="car-sport-outline" size={18} color={C.humo} />
              </View>
            </>
          ) : (
            <>
              <Text style={est.pieLabel}>Enviar a</Text>
              <View style={est.dirWrap}>
                <Ionicons name="location" size={16} color={C.rojo} />
                <TextInput value={direccion} onChangeText={setDireccion} placeholder="Calle, número, piso/depto…" placeholderTextColor={C.humo} style={est.dirInput} />
              </View>
              <Pressable onPress={usarMiUbicacion} style={est.ubicBtn}>
                <Ionicons name={coords ? 'checkmark-circle' : 'navigate'} size={14} color={coords ? C.verde : C.rojo} />
                <Text style={est.ubicTxt}>{ubicando ? 'Ubicando…' : coords ? 'Ubicación tomada' : 'Usar mi ubicación'}</Text>
              </Pressable>
            </>
          )}
          <View style={est.totalFila}>
            <Text style={est.totalLabel}>Total</Text>
            <Text style={est.total}>{pesos(total)}</Text>
          </View>
          {error && <Text style={est.error}>{error}</Text>}
          <Pressable onPress={pedir} disabled={pidiendo}>
            <LinearGradient colors={[C.rojo, C.rojoOscuro]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={est.botonPedir}>
              <Ionicons name={modo === 'domicilio' ? 'bicycle' : 'bag-check'} size={18} color="#fff" />
              <Text style={est.botonPedirTexto}>{pidiendo ? 'Enviando…' : modo === 'domicilio' ? 'Pedir a domicilio' : 'Pedir para retirar'}</Text>
            </LinearGradient>
          </Pressable>
          <Text style={est.nota}>{modo === 'domicilio' ? 'Pagás con Mercado Pago · seguí al repartidor en vivo' : 'Pagás con Mercado Pago al confirmar · te avisamos cuando esté listo'}</Text>
        </View>
      )}
    </View>
  );
}

const est = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: C.crema },
  encabezado: { fontSize: 13, color: C.humo, fontWeight: '600', marginBottom: 12 },
  vacioWrap: { alignItems: 'center', marginTop: 70, paddingHorizontal: 32 },
  vacioIcono: { width: 84, height: 84, borderRadius: 42, backgroundColor: C.cremaProf, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  vacioTitulo: { fontSize: 18, fontWeight: '800', color: C.tinta },
  vacioTexto: { fontSize: 13.5, color: C.humo, textAlign: 'center', lineHeight: 20, marginTop: 6 },
  vacioBoton: { marginTop: 20, backgroundColor: C.rojo, borderRadius: 24, paddingHorizontal: 26, paddingVertical: 12 },
  vacioBotonTxt: { color: '#fff', fontWeight: '700', fontSize: 14 },
  fila: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 18, padding: 12, marginBottom: 10, gap: 12 },
  thumb: { width: 64, height: 64, borderRadius: 14, backgroundColor: C.cremaProf },
  thumbVacio: { alignItems: 'center', justifyContent: 'center' },
  thumbInicial: { fontSize: 26, fontWeight: '800', color: '#cabfae' },
  nombre: { fontSize: 13.5, color: C.tinta, fontWeight: '600', lineHeight: 18 },
  precioUnit: { fontSize: 12, color: C.humo, marginTop: 2 },
  cantidadCaja: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 },
  botonCantidad: { width: 30, height: 30, borderRadius: 15, backgroundColor: C.crema, alignItems: 'center', justifyContent: 'center' },
  botonMas: { backgroundColor: C.rojo },
  cantidad: { minWidth: 18, textAlign: 'center', fontWeight: '800', color: C.tinta, fontSize: 15 },
  importe: { fontWeight: '800', color: C.tinta, fontSize: 14.5 },
  pie: { backgroundColor: '#fff', padding: 18, paddingBottom: 22, borderTopLeftRadius: 26, borderTopRightRadius: 26 },
  pieLabel: { fontSize: 12, color: C.humo, fontWeight: '600', marginBottom: 8 },
  central: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.crema, borderRadius: 16, padding: 12, marginBottom: 14 },
  centralNombre: { fontSize: 14, fontWeight: '800', color: C.tinta },
  centralDir: { fontSize: 12, color: C.humo, marginTop: 1 },
  modos: { flexDirection: 'row', gap: 8, backgroundColor: C.crema, borderRadius: 16, padding: 4, marginBottom: 12 },
  modo: { flex: 1, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', borderRadius: 13, paddingVertical: 9 },
  modoOn: { backgroundColor: C.rojo },
  modoTxt: { fontSize: 13, fontWeight: '700', color: C.tinta },
  dirWrap: { flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: C.crema, borderRadius: 14, paddingHorizontal: 12, marginBottom: 8 },
  dirInput: { flex: 1, paddingVertical: 11, fontSize: 14, color: C.tinta },
  ubicBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', marginBottom: 14 },
  ubicTxt: { fontSize: 12.5, fontWeight: '700', color: C.rojo },
  totalFila: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 },
  totalLabel: { color: C.humo, fontSize: 14, fontWeight: '600' },
  total: { fontSize: 28, fontWeight: '800', color: C.tinta, letterSpacing: -0.5 },
  error: { color: C.rojoOscuro, fontSize: 12.5, marginBottom: 8 },
  botonPedir: { flexDirection: 'row', gap: 8, borderRadius: 26, padding: 16, alignItems: 'center', justifyContent: 'center' },
  botonPedirTexto: { color: '#fff', fontWeight: '800', fontSize: 15.5 },
  nota: { textAlign: 'center', color: C.humo, fontSize: 11, marginTop: 10, lineHeight: 15 },
});
