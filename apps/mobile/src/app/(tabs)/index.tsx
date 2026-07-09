import { useEffect, useState } from 'react';
import { FlatList, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { pesos, useEstado, type Producto } from '../../lib/estado';
import { apiGet, apiPost } from '../../lib/api';
import { abrirVerificacion } from '../../lib/navegador';
import { C, sombra, TarjetaProducto, Seccion, CategoriaChip, LinearGradient, Ionicons } from '../../lib/ui';

// Segundo carrusel del home. Usa el feed con precio (filtro=promo) pero la
// página 2, para mostrar productos distintos a "Ofertas de la semana" (que es
// la página 1) y nunca artículos sin precio cargado.
const SECCION_POR_TIPO: Record<string, { titulo: string; sub: string; query: string }> = {
  vip: { titulo: 'Selección premium para vos', sub: 'Elegidos por tu perfil', query: 'filtro=promo&porPagina=10&pagina=2' },
  frecuente: { titulo: 'Tus infaltables', sub: 'Lo que más comprás', query: 'filtro=promo&porPagina=10&pagina=2' },
  mayorista: { titulo: 'Para tu negocio', sub: 'Precios por volumen', query: 'filtro=promo&porPagina=10&pagina=2' },
  ocasional: { titulo: 'Precios que te van a gustar', sub: 'Ofertas pensadas para vos', query: 'filtro=promo&porPagina=10&pagina=2' },
  nuevo: { titulo: 'Los favoritos de ODB', sub: 'Lo más elegido', query: 'filtro=promo&porPagina=10&pagina=2' },
};
const ETIQUETA_TIPO: Record<string, string> = {
  vip: 'Cliente Black', frecuente: 'Cliente frecuente', mayorista: 'Mayorista', ocasional: 'Cazador de ofertas', nuevo: 'Bienvenido',
};
const CATEGORIAS: [string, string][] = [
  ['🍷', 'Vinos'], ['🍺', 'Cervezas'], ['🥃', 'Whisky'], ['🧀', 'Fiambres'],
  ['🥤', 'Gaseosas'], ['🛒', 'Almacén'], ['🍫', 'Golosinas'], ['🧊', 'Hielo'],
];

// "DD/MM/AAAA" -> "AAAA-MM-DD" (o undefined si no es válida)
function isoNacimiento(v: string): string | undefined {
  const m = v.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return undefined;
  return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

export default function Inicio() {
  const { cliente, setCliente, cuenta, notif, sesionExpirada, limpiarAvisoSesion } = useEstado();
  const router = useRouter();
  const [modo, setModo] = useState<'login' | 'registro'>('login');
  const [dni, setDni] = useState('');
  const [nombre, setNombre] = useState('');
  const [nacimiento, setNacimiento] = useState('');
  const [clave, setClave] = useState('');
  const [codigoReferido, setCodigoReferido] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [promos, setPromos] = useState<Producto[]>([]);
  const [paraVos, setParaVos] = useState<Producto[]>([]);
  const [cargado, setCargado] = useState(false);

  // Carga las secciones del home cuando hay cliente (en efecto, no en render).
  useEffect(() => {
    if (cliente && !cargado) cargarSecciones(cliente.tipo, cliente.token);
  }, [cliente, cargado]);

  async function autenticar() {
    if (cargando) return;
    setCargando(true);
    setError(null);
    limpiarAvisoSesion();
    try {
      const ruta = modo === 'login' ? '/app/login' : '/app/registro';
      const datos = await apiPost(ruta,
        modo === 'login'
          ? { dni, clave }
          : { dni, nombre, clave, fechaNacimiento: isoNacimiento(nacimiento), codigoReferido: codigoReferido.trim() || undefined },
        { auth: false });
      setCliente({ dni: datos.cliente.dni, tipo: datos.cliente.tipo, nombre: datos.cliente.nombre, puntos: datos.cliente.puntos, verificado: datos.cliente.verificado, token: datos.token });
      cargarSecciones(datos.cliente.tipo, datos.token);
    } catch (e) { setError(e instanceof Error ? e.message : 'Error'); }
    setCargando(false);
  }

  async function verificarIdentidad() {
    if (!cliente?.token) return;
    setAviso(null);
    try {
      const datos = await apiPost('/app/verificacion');
      if (datos?.url) {
        // navegador in-app: el cliente no pierde el contexto de la app
        await abrirVerificacion(datos.url);
        setAviso('Completá la verificación en la pantalla que se abrió.');
      } else setAviso('No se pudo iniciar la verificación');
    } catch (e) { setAviso(e instanceof Error ? e.message : 'No se pudo iniciar la verificación'); }
  }

  async function cargarSecciones(tipo: string, token?: string) {
    const seccion = SECCION_POR_TIPO[tipo] ?? SECCION_POR_TIPO.nuevo;
    const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
    try {
      const [p, v] = await Promise.all([
        apiGet('/productos?filtro=promo&porPagina=10', { auth: false, headers }),
        apiGet(`/productos?${seccion.query}`, { auth: false, headers }),
      ]);
      setPromos(p.items);
      setParaVos(v.items);
    } catch {
      // sin red: los carruseles quedan vacíos y el banner global avisa
    }
    setCargado(true);
  }

  // ---------- LOGIN ----------
  if (!cliente) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: C.crema }} contentContainerStyle={{ flexGrow: 1 }}>
        <LinearGradient colors={[C.negro, C.rojo]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={est.loginHero}>
          <Image source={require('../../assets/odb-logo-blanco.png')} style={est.loginLogoImg} resizeMode="contain" />
          <Text style={est.loginTagline}>Bebidas, fiambrería y almacén.{'\n'}Tu pedido, a un toque.</Text>
        </LinearGradient>

        <View style={[est.loginCard, sombra(2)]}>
          {sesionExpirada && (
            <View style={est.avisoSesion}>
              <Ionicons name="time-outline" size={16} color={C.rojoOscuro} />
              <Text style={est.avisoSesionTxt}>Tu sesión expiró. Ingresá de nuevo.</Text>
            </View>
          )}
          <View style={est.pestanas}>
            {(['login', 'registro'] as const).map((m) => (
              <Pressable key={m} onPress={() => { setModo(m); setError(null); }} style={[est.pestana, modo === m && est.pestanaActiva]}>
                <Text style={[est.pestanaTexto, modo === m && { color: '#fff' }]}>{m === 'login' ? 'Entrar' : 'Crear cuenta'}</Text>
              </Pressable>
            ))}
          </View>
          {modo === 'registro' && <Campo icono="person-outline" value={nombre} onChange={setNombre} placeholder="Tu nombre" />}
          {modo === 'registro' && <Campo icono="calendar-outline" value={nacimiento} onChange={setNacimiento} placeholder="Cumpleaños DD/MM/AAAA (opcional)" keyboard="number-pad" />}
          {modo === 'registro' && <Campo icono="gift-outline" value={codigoReferido} onChange={setCodigoReferido} placeholder="Código de invitación (opcional)" />}
          <Campo icono="card-outline" value={dni} onChange={setDni} placeholder="DNI" keyboard="number-pad" />
          <Campo icono="lock-closed-outline" value={clave} onChange={setClave} placeholder="Clave (mín. 6)" secure />
          {error && <Text style={est.error}>{error}</Text>}
          <Pressable onPress={autenticar} disabled={cargando} style={({ pressed }) => [est.botonPrimario, pressed && { opacity: 0.85 }]}>
            <Text style={est.botonPrimarioTexto}>{cargando ? 'Un momento…' : modo === 'login' ? 'Entrar' : 'Crear mi cuenta'}</Text>
          </Pressable>
          <Pressable onPress={() => { setCliente({ dni: '', tipo: 'nuevo' }); cargarSecciones('nuevo'); }}>
            <Text style={est.link}>Explorar sin cuenta →</Text>
          </Pressable>
        </View>
      </ScrollView>
    );
  }

  // ---------- HOME ----------
  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.crema }} showsVerticalScrollIndicator={false}>
      <LinearGradient colors={[C.negro, C.vino]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={est.hero}>
        <View style={est.heroTop}>
          <View>
            <View style={est.heroNombreRow}>
              <Text style={est.heroHola}>{cliente.nombre ? `Hola, ${cliente.nombre.split(' ')[0]}` : '¡Hola!'} 👋</Text>
              {cliente.verificado && <Ionicons name="checkmark-circle" size={18} color={C.dorado} />}
            </View>
            <View style={est.heroChip}><Text style={est.heroChipTxt}>{ETIQUETA_TIPO[cliente.tipo] ?? cliente.tipo}</Text></View>
          </View>
          {cliente.token != null && (
            <Pressable onPress={() => router.push('/cuenta' as any)} style={est.heroPuntos}>
              <Ionicons name="star" size={14} color={C.dorado} />
              <Text style={est.heroPuntosTxt}>{cliente.puntos ?? 0}</Text>
            </Pressable>
          )}
        </View>
        <Pressable onPress={() => router.push('/catalogo' as any)} style={est.heroBuscar}>
          <Ionicons name="search" size={18} color={C.humo} />
          <Text style={est.heroBuscarTxt}>Buscar entre miles de productos…</Text>
        </Pressable>
      </LinearGradient>

      {/* categorías */}
      <FlatList
        horizontal showsHorizontalScrollIndicator={false} data={CATEGORIAS} keyExtractor={(c) => c[1]}
        style={est.catsLista} contentContainerStyle={{ paddingHorizontal: 18, paddingVertical: 4 }}
        renderItem={({ item }) => <CategoriaChip emoji={item[0]} label={item[1]} onPress={() => router.push('/catalogo' as any)} />}
      />

      {/* Comunidad */}
      {cliente.token && !cliente.verificado && (
        <Pressable onPress={verificarIdentidad} style={est.comunidadWrap}>
          <LinearGradient colors={[C.tinta, C.vino]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[est.comunidad, sombra(1)]}>
            <Ionicons name="shield-checkmark" size={26} color={C.dorado} />
            <View style={{ flex: 1 }}>
              <Text style={est.comunidadT}>Sumate a la Comunidad ODB</Text>
              <Text style={est.comunidadS}>Precios exclusivos, Comprá Fácil, prioridad en envíos a domicilio y puntos.</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#fff" />
          </LinearGradient>
        </Pressable>
      )}
      {cliente.verificado && (
        <View style={est.comunidadOk}>
          <Ionicons name="checkmark-circle" size={16} color={C.verde} />
          <Text style={est.comunidadOkTxt}>Sos Comunidad ODB · precios exclusivos activos</Text>
        </View>
      )}
      {aviso && <Text style={est.aviso}>{aviso}</Text>}

      {/* alertas cuenta */}
      {notif.noLeidas > 0 && (
        <Pressable onPress={() => router.push('/cuenta' as any)} style={[est.alerta, { backgroundColor: C.rojo }]}>
          <Ionicons name="notifications" size={16} color="#fff" />
          <Text style={est.alertaTxt}>{notif.lista.find((n) => !n.leida)?.titulo ?? `Tenés ${notif.noLeidas} novedades`}</Text>
          <Ionicons name="chevron-forward" size={16} color="#fff" />
        </Pressable>
      )}
      {cuenta?.habilitada && cuenta.saldo > 0 && notif.noLeidas === 0 && (
        <Pressable onPress={() => router.push('/cuenta' as any)} style={[est.alerta, { backgroundColor: C.tinta }]}>
          <Ionicons name="card" size={16} color="#fff" />
          <Text style={est.alertaTxt}>Saldo en cuenta corriente: {pesos(cuenta.saldo)}</Text>
          <Ionicons name="chevron-forward" size={16} color="#fff" />
        </Pressable>
      )}

      {promos.length > 0 && <>
        <Seccion titulo="🔥 Ofertas de la semana" sub="Aprovechá antes de que se agoten" />
        <FlatList horizontal showsHorizontalScrollIndicator={false} data={promos} keyExtractor={(p) => p.sku}
          contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 6 }} renderItem={({ item }) => <TarjetaProducto p={item} />} />
      </>}

      {paraVos.length > 0 && <>
        <Seccion titulo={(SECCION_POR_TIPO[cliente.tipo] ?? SECCION_POR_TIPO.nuevo).titulo} sub={(SECCION_POR_TIPO[cliente.tipo] ?? SECCION_POR_TIPO.nuevo).sub} />
        <FlatList horizontal showsHorizontalScrollIndicator={false} data={paraVos} keyExtractor={(p) => 'pv-' + p.sku}
          contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 6 }} renderItem={({ item }) => <TarjetaProducto p={item} />} />
      </>}

      <View style={{ height: 28 }} />
    </ScrollView>
  );
}

function Campo({ icono, value, onChange, placeholder, keyboard, secure }: any) {
  return (
    <View style={est.campo}>
      <Ionicons name={icono} size={18} color={C.humo} />
      <TextInput value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={C.humo}
        keyboardType={keyboard} secureTextEntry={secure} style={est.campoInput} autoCapitalize="none" />
    </View>
  );
}

const est = StyleSheet.create({
  loginHero: { paddingTop: 72, paddingBottom: 48, paddingHorizontal: 28, alignItems: 'center', borderBottomLeftRadius: 32, borderBottomRightRadius: 32 },
  loginLogoImg: { width: 210, height: 132 },
  loginTagline: { color: 'rgba(255,255,255,0.8)', textAlign: 'center', marginTop: 18, lineHeight: 21, fontSize: 14 },
  loginCard: { margin: 20, marginTop: -28, backgroundColor: '#fff', borderRadius: 24, padding: 22 },
  pestanas: { flexDirection: 'row', backgroundColor: C.crema, borderRadius: 24, padding: 4, marginBottom: 18 },
  pestana: { flex: 1, paddingVertical: 11, borderRadius: 20, alignItems: 'center' },
  pestanaActiva: { backgroundColor: C.rojo },
  pestanaTexto: { fontSize: 14, fontWeight: '700', color: C.tinta },
  campo: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: C.linea, borderRadius: 14, paddingHorizontal: 14, marginBottom: 11, backgroundColor: '#fff' },
  campoInput: { flex: 1, paddingVertical: 13, fontSize: 15, color: C.tinta },
  error: { color: C.rojoOscuro, fontSize: 13, marginBottom: 10 },
  avisoSesion: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#FBE9E7', borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12, marginBottom: 12 },
  avisoSesionTxt: { color: C.rojoOscuro, fontSize: 13, fontWeight: '600', flex: 1 },
  botonPrimario: { backgroundColor: C.rojo, borderRadius: 16, paddingVertical: 15, alignItems: 'center', marginTop: 6, ...sombra(1) },
  botonPrimarioTexto: { color: '#fff', fontWeight: '800', fontSize: 15 },
  link: { textAlign: 'center', color: C.humo, fontSize: 13, marginTop: 16, fontWeight: '600' },

  hero: { paddingTop: 64, paddingBottom: 22, paddingHorizontal: 18, borderBottomLeftRadius: 28, borderBottomRightRadius: 28 },
  heroTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  heroNombreRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  heroHola: { color: '#fff', fontSize: 23, fontWeight: '800', letterSpacing: -0.3 },
  heroChip: { alignSelf: 'flex-start', backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4, marginTop: 7 },
  heroChipTxt: { color: '#fff', fontSize: 11, fontWeight: '700', letterSpacing: 0.3 },
  heroPuntos: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(0,0,0,0.25)', borderRadius: 14, paddingHorizontal: 11, paddingVertical: 7 },
  heroPuntosTxt: { color: '#fff', fontWeight: '800', fontSize: 13 },
  heroBuscar: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fff', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, marginTop: 18 },
  heroBuscarTxt: { color: C.humo, fontSize: 14 },
  catsLista: { marginTop: 16 },
  comunidadWrap: { paddingHorizontal: 18, marginTop: 18 },
  comunidad: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 18, padding: 16 },
  comunidadT: { color: '#fff', fontWeight: '800', fontSize: 14 },
  comunidadS: { color: 'rgba(255,255,255,0.75)', fontSize: 11.5, marginTop: 2, lineHeight: 16 },
  comunidadOk: { flexDirection: 'row', alignItems: 'center', gap: 7, marginHorizontal: 18, marginTop: 16, backgroundColor: '#E7F1EA', borderRadius: 12, padding: 11 },
  comunidadOkTxt: { color: C.verde, fontSize: 12.5, fontWeight: '700' },
  aviso: { marginHorizontal: 18, marginTop: 12, fontSize: 12.5, color: C.rojoOscuro },
  alerta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 18, marginTop: 14, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12 },
  alertaTxt: { color: '#fff', fontSize: 13, fontWeight: '600', flex: 1 },
});
