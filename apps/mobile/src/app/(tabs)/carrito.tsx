import { useEffect, useRef, useState } from 'react';
import {
  Keyboard, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { Image } from 'expo-image';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { guardarContacto, leerContacto, pesos, useEstado } from '../../lib/estado';
import { apiGet, apiPost } from '../../lib/api';
import { C, LinearGradient, Ionicons, sombra, toque } from '../../lib/ui';
import { formatearWhatsApp, nombreSucursal, normalizarWhatsApp, SUCURSAL_RETIRO } from '../../lib/formato';

type Campo = 'direccion' | 'nombre' | 'telefono';

export default function Carrito() {
  const router = useRouter();
  const { carrito, agregar, quitar, vaciar, total, cliente } = useEstado();
  const [central, setCentral] = useState<{ id: string; nombre: string; direccion?: string } | null>(null);
  const [modo, setModo] = useState<'pickup' | 'domicilio'>('pickup');
  const [direccion, setDireccion] = useState('');
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [nombre, setNombre] = useState('');
  const [telefono, setTelefono] = useState('');
  const [ubicando, setUbicando] = useState(false);
  const [pidiendo, setPidiendo] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // El formulario va dentro del scroll y el pie (total + botón) queda fijo; el
  // KeyboardAvoidingView sube el pie sobre el teclado (iOS) y al enfocar un
  // campo lo llevamos a la vista. keyboardVerticalOffset = alto del encabezado
  // de la pestaña, que el KeyboardAvoidingView no cuenta solo.
  const altoEncabezado = useHeaderHeight();
  const scroll = useRef<ScrollView>(null);
  const yTarjeta = useRef(0);
  const yCampo = useRef<Record<Campo, number>>({ direccion: 0, nombre: 0, telefono: 0 });
  const refNombre = useRef<TextInput>(null);
  const refTelefono = useRef<TextInput>(null);
  const refDireccion = useRef<TextInput>(null);

  const unidades = carrito.reduce((s, r) => s + r.cantidad, 0);
  const telNormalizado = normalizarWhatsApp(telefono);

  useEffect(() => {
    // Pick-up y domicilio: ambos salen de la sucursal central (Saint Thomas).
    apiGet('/sucursal-pickup', { auth: false })
      .then((s) => setCentral(s && s.id ? s : null))
      .catch(() => {});
  }, []);

  // Precarga nombre y WhatsApp: primero lo que tiene el perfil; si no, lo último
  // que se usó en este equipo. Nunca pisa lo que el cliente ya escribió.
  useEffect(() => {
    let vivo = true;
    leerContacto().then((g) => {
      if (!vivo) return;
      const telPerfil = cliente?.telefono ? normalizarWhatsApp(cliente.telefono) : null;
      const telGuardado = g?.telefono ? normalizarWhatsApp(g.telefono) : null;
      const tel = telPerfil ?? telGuardado;
      setNombre((n) => n || cliente?.nombre?.trim() || g?.nombre?.trim() || '');
      setTelefono((t) => t || (tel ? formatearWhatsApp(tel) : ''));
    });
    return () => { vivo = false; };
  }, [cliente?.dni, cliente?.nombre, cliente?.telefono]);

  // Lleva el campo a la parte de arriba de lo visible, después de que el teclado
  // terminó de abrir y la lista se achicó.
  function mostrarCampo(campo: Campo) {
    setTimeout(() => {
      const y = yTarjeta.current + yCampo.current[campo];
      scroll.current?.scrollTo({ y: Math.max(0, y - 40), animated: true });
    }, Platform.OS === 'ios' ? 320 : 150);
  }

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

  function frenar(mensaje: string, campo: Campo, ref: React.RefObject<TextInput | null>) {
    setError(mensaje);
    ref.current?.focus();
    mostrarCampo(campo);
  }

  async function pedir() {
    if (!carrito.length || pidiendo) return;
    if (modo === 'domicilio' && !direccion.trim()) return frenar('Ingresá la dirección de entrega.', 'direccion', refDireccion);
    if (nombre.trim().length < 2) return frenar('Decinos tu nombre para el pedido.', 'nombre', refNombre);
    const tel = normalizarWhatsApp(telefono);
    if (!tel) {
      return frenar(
        telefono.trim()
          ? 'Revisá tu WhatsApp: código de área y número, sin 0 ni 15 (ej.: 11 2345-6789).'
          : 'Dejanos tu WhatsApp: por ahí te avisamos cómo viene el pedido.',
        'telefono',
        refTelefono,
      );
    }
    Keyboard.dismiss();
    toque();
    setPidiendo(true);
    setError(null);
    const contacto = { nombre: nombre.trim(), telefono: tel };
    try {
      // con el token del cliente (si hay sesión) el pedido queda atribuido:
      // suma puntos e historial. El guest checkout sigue funcionando sin token.
      const datos = await apiPost('/app/pedidos', {
        tipo: modo,
        origen: 'app',
        contacto,
        items: carrito.map((r) => ({ sku: r.sku, cantidad: r.cantidad })),
        dni: cliente?.dni || undefined,
        ...(modo === 'domicilio'
          ? { destino: { direccion: direccion.trim(), lat: coords?.lat, lng: coords?.lng } }
          : {}),
      });
      guardarContacto(contacto);
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

  if (!carrito.length) {
    return (
      <View style={est.pantalla}>
        <View style={est.vacioWrap}>
          <View style={est.vacioIcono}><Ionicons name="cart-outline" size={40} color={C.humo} /></View>
          <Text style={est.vacioTitulo}>Tu carrito está vacío</Text>
          <Text style={est.vacioTexto}>Sumá productos desde el catálogo o el inicio.</Text>
          <Pressable onPress={() => { toque(); router.push('/catalogo'); }} style={est.vacioBoton}>
            <Text style={est.vacioBotonTxt}>Ver catálogo</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={est.pantalla}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={altoEncabezado}
    >
      <ScrollView
        ref={scroll}
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, paddingBottom: 24 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <Text style={est.encabezado}>{unidades} {unidades === 1 ? 'producto' : 'productos'} en tu carrito</Text>

        {carrito.map((r) => (
          <View key={r.sku} style={[est.fila, sombra(0)]}>
            {r.imagenUrl ? (
              <Image source={{ uri: r.imagenUrl }} style={est.thumb} contentFit="contain" transition={150} />
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
        ))}

        {/* ---- Entrega y datos de contacto ----
            Cada campo es hijo directo de la tarjeta: su onLayout da la y dentro
            de ella y, sumada a la de la tarjeta, la y en el scroll. */}
        <View style={[est.tarjeta, sombra(0)]} onLayout={(e) => { yTarjeta.current = e.nativeEvent.layout.y; }}>
          <Text style={est.tarjetaTitulo}>¿Cómo lo recibís?</Text>
          <View style={est.modos}>
            <Pressable onPress={() => { toque(); setModo('pickup'); setError(null); }} style={[est.modo, modo === 'pickup' && est.modoOn]}>
              <Ionicons name="storefront-outline" size={16} color={modo === 'pickup' ? '#fff' : C.tinta} />
              <Text style={[est.modoTxt, modo === 'pickup' && { color: '#fff' }]}>Retiro</Text>
            </Pressable>
            <Pressable onPress={() => { toque(); setModo('domicilio'); setError(null); }} style={[est.modo, modo === 'domicilio' && est.modoOn]}>
              <Ionicons name="bicycle-outline" size={16} color={modo === 'domicilio' ? '#fff' : C.tinta} />
              <Text style={[est.modoTxt, modo === 'domicilio' && { color: '#fff' }]}>A domicilio</Text>
            </Pressable>
          </View>

          {modo === 'pickup' ? (
            <View style={est.central}>
              <Ionicons name="storefront" size={16} color={C.rojo} />
              <View style={{ flex: 1 }}>
                <Text style={est.pieLabel}>Retirás en</Text>
                <Text style={est.centralNombre}>Sucursal {nombreSucursal(central?.nombre)}</Text>
                <Text style={est.centralDir}>{central?.direccion || SUCURSAL_RETIRO.direccion}</Text>
              </View>
              <Ionicons name="car-sport-outline" size={18} color={C.humo} />
            </View>
          ) : (
            <View onLayout={(e) => { yCampo.current.direccion = e.nativeEvent.layout.y; }}>
              <Text style={est.pieLabel}>Enviar a</Text>
              <View style={est.campo}>
                <Ionicons name="location" size={16} color={C.rojo} />
                <TextInput
                  ref={refDireccion}
                  value={direccion}
                  onChangeText={(v) => { setDireccion(v); setError(null); }}
                  onFocus={() => mostrarCampo('direccion')}
                  placeholder="Calle, número, piso/depto…"
                  placeholderTextColor={C.humo}
                  textContentType="fullStreetAddress"
                  autoComplete="street-address"
                  returnKeyType="next"
                  onSubmitEditing={() => refNombre.current?.focus()}
                  style={est.campoInput}
                />
              </View>
              <Pressable onPress={usarMiUbicacion} style={est.ubicBtn}>
                <Ionicons name={coords ? 'checkmark-circle' : 'navigate'} size={14} color={coords ? C.verde : C.rojo} />
                <Text style={est.ubicTxt}>{ubicando ? 'Ubicando…' : coords ? 'Ubicación tomada' : 'Usar mi ubicación'}</Text>
              </Pressable>
            </View>
          )}

          <Text style={[est.tarjetaTitulo, { marginTop: 6 }]}>¿A quién le avisamos?</Text>
          <View style={est.campo} onLayout={(e) => { yCampo.current.nombre = e.nativeEvent.layout.y; }}>
            <Ionicons name="person-outline" size={16} color={C.rojo} />
            <TextInput
              ref={refNombre}
              value={nombre}
              onChangeText={(v) => { setNombre(v); setError(null); }}
              onFocus={() => mostrarCampo('nombre')}
              placeholder="Tu nombre"
              placeholderTextColor={C.humo}
              textContentType="name"
              autoComplete="name"
              autoCapitalize="words"
              returnKeyType="next"
              onSubmitEditing={() => refTelefono.current?.focus()}
              style={est.campoInput}
            />
          </View>
          <View style={est.campo} onLayout={(e) => { yCampo.current.telefono = e.nativeEvent.layout.y; }}>
            <Ionicons name="logo-whatsapp" size={16} color={C.rojo} />
            <TextInput
              ref={refTelefono}
              value={telefono}
              onChangeText={(v) => { setTelefono(v); setError(null); }}
              onFocus={() => mostrarCampo('telefono')}
              onBlur={() => { if (telNormalizado) setTelefono(formatearWhatsApp(telNormalizado)); }}
              placeholder="WhatsApp (ej.: 11 2345-6789)"
              placeholderTextColor={C.humo}
              keyboardType="phone-pad"
              textContentType="telephoneNumber"
              autoComplete="tel"
              maxLength={22}
              returnKeyType="done"
              style={est.campoInput}
            />
          </View>
          <Text style={[est.ayuda, telNormalizado ? { color: C.verde } : null]}>
            {telNormalizado
              ? `Te escribimos al ${formatearWhatsApp(telNormalizado)} cuando haya novedades.`
              : 'Con código de área, sin 0 ni 15. Por ahí te avisamos cómo viene el pedido.'}
          </Text>
        </View>
      </ScrollView>

      <View style={[est.pie, sombra(2)]}>
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
    </KeyboardAvoidingView>
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
  // fondo blanco: con contain la foto no deja franjas de otro color
  thumb: { width: 64, height: 64, borderRadius: 14, backgroundColor: C.blanco },
  thumbVacio: { alignItems: 'center', justifyContent: 'center', backgroundColor: C.cremaProf },
  thumbInicial: { fontSize: 26, fontWeight: '800', color: '#cabfae' },
  nombre: { fontSize: 13.5, color: C.tinta, fontWeight: '600', lineHeight: 18 },
  precioUnit: { fontSize: 12, color: C.humo, marginTop: 2 },
  cantidadCaja: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 },
  botonCantidad: { width: 30, height: 30, borderRadius: 15, backgroundColor: C.crema, alignItems: 'center', justifyContent: 'center' },
  botonMas: { backgroundColor: C.rojo },
  cantidad: { minWidth: 18, textAlign: 'center', fontWeight: '800', color: C.tinta, fontSize: 15 },
  importe: { fontWeight: '800', color: C.tinta, fontSize: 14.5 },
  tarjeta: { backgroundColor: '#fff', borderRadius: 20, padding: 16, marginTop: 6 },
  tarjetaTitulo: { fontSize: 14, fontWeight: '800', color: C.tinta, marginBottom: 10 },
  pieLabel: { fontSize: 12, color: C.humo, fontWeight: '600', marginBottom: 6 },
  central: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.crema, borderRadius: 16, padding: 12, marginBottom: 14 },
  centralNombre: { fontSize: 14, fontWeight: '800', color: C.tinta },
  centralDir: { fontSize: 12, color: C.humo, marginTop: 1 },
  modos: { flexDirection: 'row', gap: 8, backgroundColor: C.crema, borderRadius: 16, padding: 4, marginBottom: 12 },
  modo: { flex: 1, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', borderRadius: 13, paddingVertical: 9 },
  modoOn: { backgroundColor: C.rojo },
  modoTxt: { fontSize: 13, fontWeight: '700', color: C.tinta },
  campo: { flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: C.crema, borderRadius: 14, paddingHorizontal: 12, marginBottom: 8 },
  campoInput: { flex: 1, minWidth: 0, paddingVertical: 11, fontSize: 14, color: C.tinta },
  ayuda: { fontSize: 11.5, color: C.humo, lineHeight: 16, marginTop: 2 },
  ubicBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', marginBottom: 14 },
  ubicTxt: { fontSize: 12.5, fontWeight: '700', color: C.rojo },
  pie: { backgroundColor: '#fff', padding: 18, paddingTop: 14, paddingBottom: 16, borderTopLeftRadius: 26, borderTopRightRadius: 26 },
  totalFila: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 },
  totalLabel: { color: C.humo, fontSize: 14, fontWeight: '600' },
  total: { fontSize: 28, fontWeight: '800', color: C.tinta, letterSpacing: -0.5 },
  error: { color: C.rojoOscuro, fontSize: 12.5, marginBottom: 8 },
  botonPedir: { flexDirection: 'row', gap: 8, borderRadius: 26, padding: 16, alignItems: 'center', justifyContent: 'center' },
  botonPedirTexto: { color: '#fff', fontWeight: '800', fontSize: 15.5 },
  nota: { textAlign: 'center', color: C.humo, fontSize: 11, marginTop: 8, lineHeight: 15 },
});
