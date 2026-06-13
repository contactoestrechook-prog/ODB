import { useState } from 'react';
import {
  FlatList, Image, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { API, COLORES, pesos, useEstado, type Producto } from '../../lib/estado';

const SECCION_POR_TIPO: Record<string, { titulo: string; query: string }> = {
  vip: { titulo: 'Selección premium para vos', query: 'buscar=&orden=nombre_asc&porPagina=10&filtro=' },
  frecuente: { titulo: 'Tus categorías de siempre', query: 'porPagina=10' },
  mayorista: { titulo: 'Para tu negocio', query: 'porPagina=10' },
  ocasional: { titulo: 'Precios que te van a gustar', query: 'filtro=promo&porPagina=10' },
  nuevo: { titulo: 'Los favoritos de ODB', query: 'porPagina=10' },
};

const ETIQUETA_TIPO: Record<string, string> = {
  vip: 'Cliente black',
  frecuente: 'Cliente frecuente',
  mayorista: 'Mayorista',
  ocasional: 'Cazador de ofertas',
  nuevo: 'Bienvenido',
};

function Tarjeta({ p }: { p: Producto }) {
  const { agregar } = useEstado();
  return (
    <View style={est.tarjeta}>
      {p.imagenUrl ? (
        <Image source={{ uri: p.imagenUrl }} style={est.foto} />
      ) : (
        <View style={[est.foto, est.fotoVacia]}>
          <Text style={est.fotoInicial}>{p.nombre[0]}</Text>
        </View>
      )}
      <Text numberOfLines={2} style={est.tarjetaNombre}>{p.nombre}</Text>
      {p.descuentoComunidad && (
        <Text style={est.chipComunidad}>🔒 Comunidad ODB</Text>
      )}
      {p.descuento ? (
        <View>
          <Text style={est.precioTachado}>{pesos(p.precioLista)}</Text>
          <Text style={est.precioPromo}>{pesos(p.precio)}</Text>
        </View>
      ) : (
        <Text style={est.precio}>{pesos(p.precio)}</Text>
      )}
      <Pressable onPress={() => agregar(p)} style={est.botonAgregar}>
        <Text style={est.botonAgregarTexto}>Agregar</Text>
      </Pressable>
    </View>
  );
}

export default function Inicio() {
  const { cliente, setCliente, cuenta, notif } = useEstado();
  const router = useRouter();
  const [modo, setModo] = useState<'login' | 'registro'>('login');
  const [dni, setDni] = useState('');
  const [nombre, setNombre] = useState('');
  const [clave, setClave] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [promos, setPromos] = useState<Producto[]>([]);
  const [paraVos, setParaVos] = useState<Producto[]>([]);
  const [cargado, setCargado] = useState(false);

  async function autenticar() {
    if (cargando) return;
    setCargando(true);
    setError(null);
    try {
      const ruta = modo === 'login' ? '/app/login' : '/app/registro';
      const res = await fetch(`${API}${ruta}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(modo === 'login' ? { dni, clave } : { dni, nombre, clave }),
      });
      const datos = await res.json();
      if (!res.ok) throw new Error(datos.message ?? 'No se pudo entrar');
      setCliente({
        dni: datos.cliente.dni,
        tipo: datos.cliente.tipo,
        nombre: datos.cliente.nombre,
        puntos: datos.cliente.puntos,
        verificado: datos.cliente.verificado,
        token: datos.token,
      });
      cargarSecciones(datos.cliente.tipo, datos.token);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
    setCargando(false);
  }

  async function verificarIdentidad() {
    if (!cliente?.token) return;
    setAviso(null);
    const res = await fetch(`${API}/app/verificacion`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cliente.token}` },
    });
    const datos = await res.json();
    if (res.ok && datos.url) {
      Linking.openURL(datos.url);
      setAviso('Completá la verificación en la pantalla que se abrió. Al terminar, tu cuenta queda verificada sola.');
    } else {
      setAviso(datos.message ?? 'No se pudo iniciar la verificación');
    }
  }

  async function cargarSecciones(tipo: string, token?: string) {
    const seccion = SECCION_POR_TIPO[tipo] ?? SECCION_POR_TIPO.nuevo;
    // con token de cliente verificado, el catálogo incluye precios Comunidad ODB
    const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
    const [rp, rv] = await Promise.all([
      fetch(`${API}/productos?filtro=promo&porPagina=10`, { headers }),
      fetch(`${API}/productos?${seccion.query}`, { headers }),
    ]);
    if (rp.ok) setPromos((await rp.json()).items);
    if (rv.ok) setParaVos((await rv.json()).items);
    setCargado(true);
  }

  if (!cliente) {
    return (
      <ScrollView style={est.pantallaCrema}>
        <View style={est.cajaLogin}>
          <Text style={est.logo}>O.D.B</Text>
          <Text style={est.subtitulo}>Premium Market</Text>

          <View style={est.pestanas}>
            {(['login', 'registro'] as const).map((m) => (
              <Pressable
                key={m}
                onPress={() => { setModo(m); setError(null); }}
                style={[est.pestana, modo === m && est.pestanaActiva]}
              >
                <Text style={[est.pestanaTexto, modo === m && { color: COLORES.blanco }]}>
                  {m === 'login' ? 'Entrar' : 'Crear cuenta'}
                </Text>
              </Pressable>
            ))}
          </View>

          {modo === 'registro' && (
            <TextInput
              value={nombre}
              onChangeText={setNombre}
              placeholder="Tu nombre"
              style={est.input}
              placeholderTextColor="#999"
            />
          )}
          <TextInput
            value={dni}
            onChangeText={setDni}
            placeholder="DNI"
            keyboardType="number-pad"
            style={est.input}
            placeholderTextColor="#999"
          />
          <TextInput
            value={clave}
            onChangeText={setClave}
            placeholder="Clave (mínimo 6 caracteres)"
            secureTextEntry
            style={est.input}
            placeholderTextColor="#999"
          />

          {error && <Text style={est.error}>{error}</Text>}

          <Pressable onPress={autenticar} disabled={cargando} style={est.botonPrimario}>
            <Text style={est.botonPrimarioTexto}>
              {cargando ? 'Un momento…' : modo === 'login' ? 'Entrar' : 'Crear mi cuenta'}
            </Text>
          </Pressable>
          <Pressable onPress={() => { setCliente({ dni: '', tipo: 'nuevo' }); cargarSecciones('nuevo'); }}>
            <Text style={est.link}>Seguir sin cuenta (solo mirar)</Text>
          </Pressable>
        </View>
      </ScrollView>
    );
  }

  if (!cargado) cargarSecciones(cliente.tipo, cliente.token);

  return (
    <ScrollView style={est.pantallaCrema}>
      <View style={est.bannerRojo}>
        <Text style={est.bannerHola}>
          {cliente.nombre ? `Hola, ${cliente.nombre}` : cliente.dni ? `Hola, DNI ${cliente.dni}` : '¡Hola!'}
        </Text>
        <View style={est.chipNegro}>
          <Text style={est.chipNegroTexto}>{ETIQUETA_TIPO[cliente.tipo] ?? cliente.tipo}</Text>
        </View>
      </View>

      {cliente.token && !cliente.verificado && (
        <Pressable onPress={verificarIdentidad} style={est.bannerVerificar}>
          <Text style={est.bannerVerificarTexto}>
            🛡 Verificá tu identidad (DNI + rostro) y sumate a la Comunidad ODB: promos
            exclusivas, Comprá Fácil y retiro sin caja →
          </Text>
        </Pressable>
      )}
      {cliente.verificado && (
        <View style={est.bannerVerificado}>
          <Text style={est.bannerVerificadoTexto}>
            ✓ Sos de la Comunidad ODB · precios exclusivos activos
          </Text>
        </View>
      )}
      {aviso && <Text style={est.aviso}>{aviso}</Text>}

      {/* alerta de cuenta corriente / novedades */}
      {notif.noLeidas > 0 && (
        <Pressable onPress={() => router.push('/cuenta' as any)} style={est.bannerNotif}>
          <Text style={est.bannerNotifTexto}>
            🔔 {notif.lista.find((n) => !n.leida)?.titulo ?? `Tenés ${notif.noLeidas} novedades`} →
          </Text>
        </Pressable>
      )}
      {cuenta?.habilitada && cuenta.saldo > 0 && notif.noLeidas === 0 && (
        <Pressable onPress={() => router.push('/cuenta' as any)} style={est.bannerCuenta}>
          <Text style={est.bannerCuentaTexto}>
            💳 Tu saldo en cuenta corriente: {pesos(cuenta.saldo)} →
          </Text>
        </Pressable>
      )}

      <Text style={est.tituloSeccion}>Ofertas de la semana</Text>
      <FlatList
        horizontal
        data={promos}
        keyExtractor={(p) => p.sku}
        renderItem={({ item }) => <Tarjeta p={item} />}
        contentContainerStyle={{ paddingHorizontal: 12 }}
        showsHorizontalScrollIndicator={false}
      />

      <Text style={est.tituloSeccion}>{(SECCION_POR_TIPO[cliente.tipo] ?? SECCION_POR_TIPO.nuevo).titulo}</Text>
      <FlatList
        horizontal
        data={paraVos}
        keyExtractor={(p) => 'pv-' + p.sku}
        renderItem={({ item }) => <Tarjeta p={item} />}
        contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 24 }}
        showsHorizontalScrollIndicator={false}
      />
    </ScrollView>
  );
}

const est = StyleSheet.create({
  pantallaCrema: { flex: 1, backgroundColor: COLORES.crema },
  cajaLogin: { margin: 24, marginTop: 48, backgroundColor: COLORES.blanco, borderRadius: 20, padding: 24 },
  logo: { fontSize: 32, fontWeight: '700', letterSpacing: 4, textAlign: 'center', color: COLORES.negro },
  subtitulo: { textAlign: 'center', color: COLORES.rojo, fontWeight: '600', marginBottom: 16 },
  pestanas: { flexDirection: 'row', backgroundColor: COLORES.crema, borderRadius: 22, padding: 4, marginBottom: 16 },
  pestana: { flex: 1, paddingVertical: 9, borderRadius: 18, alignItems: 'center' },
  pestanaActiva: { backgroundColor: COLORES.negro },
  pestanaTexto: { fontSize: 13, fontWeight: '600', color: COLORES.negro },
  input: {
    borderWidth: 1, borderColor: '#ddd', borderRadius: 12, padding: 12, fontSize: 15,
    marginBottom: 10, color: COLORES.negro, backgroundColor: COLORES.blanco,
  },
  error: { color: COLORES.rojoOscuro, fontSize: 12, marginBottom: 10 },
  botonPrimario: { backgroundColor: COLORES.rojo, borderRadius: 24, padding: 14, alignItems: 'center', marginTop: 4 },
  botonPrimarioTexto: { color: COLORES.blanco, fontWeight: '600' },
  link: { textAlign: 'center', color: '#888', fontSize: 12, marginTop: 14, textDecorationLine: 'underline' },
  bannerRojo: { backgroundColor: COLORES.rojo, padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  bannerHola: { color: COLORES.blanco, fontSize: 16, fontWeight: '600', flex: 1, marginRight: 8 },
  chipNegro: { backgroundColor: COLORES.negro, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  chipNegroTexto: { color: COLORES.blanco, fontSize: 11, fontWeight: '600' },
  bannerVerificar: { backgroundColor: COLORES.negro, padding: 12, paddingHorizontal: 16 },
  bannerVerificarTexto: { color: COLORES.crema, fontSize: 12, lineHeight: 17 },
  bannerVerificado: { backgroundColor: '#2F5233', padding: 8, paddingHorizontal: 16 },
  bannerVerificadoTexto: { color: COLORES.blanco, fontSize: 12, fontWeight: '600' },
  aviso: { margin: 12, marginBottom: 0, fontSize: 12, color: COLORES.rojoOscuro, paddingHorizontal: 4 },
  bannerNotif: { backgroundColor: COLORES.rojo, padding: 12, paddingHorizontal: 16, marginTop: 1 },
  bannerNotifTexto: { color: COLORES.blanco, fontSize: 13, fontWeight: '600' },
  bannerCuenta: { backgroundColor: COLORES.negro, padding: 12, paddingHorizontal: 16, marginTop: 1 },
  bannerCuentaTexto: { color: COLORES.crema, fontSize: 13, fontWeight: '600' },
  tituloSeccion: { fontSize: 16, fontWeight: '600', color: COLORES.negro, margin: 16, marginBottom: 8 },
  tarjeta: { backgroundColor: COLORES.blanco, borderRadius: 14, padding: 12, width: 150, marginHorizontal: 4 },
  foto: { width: '100%', height: 90, borderRadius: 10, marginBottom: 8 },
  fotoVacia: { backgroundColor: COLORES.crema, alignItems: 'center', justifyContent: 'center' },
  fotoInicial: { fontSize: 32, fontWeight: '700', color: '#bbb' },
  tarjetaNombre: { fontSize: 12, color: COLORES.negro, minHeight: 32 },
  chipComunidad: {
    fontSize: 10, color: COLORES.blanco, backgroundColor: COLORES.negro,
    alignSelf: 'flex-start', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2, marginTop: 4,
  },
  precio: { fontSize: 15, fontWeight: '700', color: COLORES.negro, marginTop: 6 },
  precioTachado: { fontSize: 11, color: '#999', textDecorationLine: 'line-through', marginTop: 4 },
  precioPromo: { fontSize: 15, fontWeight: '700', color: COLORES.rojo },
  botonAgregar: { backgroundColor: COLORES.negro, borderRadius: 14, paddingVertical: 6, alignItems: 'center', marginTop: 8 },
  botonAgregarTexto: { color: COLORES.blanco, fontSize: 12, fontWeight: '600' },
});
