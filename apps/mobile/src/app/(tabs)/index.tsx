import { useState } from 'react';
import {
  FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
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
      <Text numberOfLines={2} style={est.tarjetaNombre}>{p.nombre}</Text>
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
  const { cliente, setCliente } = useEstado();
  const [dni, setDni] = useState('');
  const [promos, setPromos] = useState<Producto[]>([]);
  const [paraVos, setParaVos] = useState<Producto[]>([]);
  const [cargado, setCargado] = useState(false);

  async function identificar() {
    if (!dni.trim()) return;
    const res = await fetch(`${API}/app/perfil/${encodeURIComponent(dni.trim())}`);
    const perfil = res.ok ? await res.json() : { tipo: 'nuevo' };
    setCliente({ dni: dni.trim(), tipo: perfil.tipo, nombre: perfil.nombre, puntos: perfil.puntos });
    cargarSecciones(perfil.tipo);
  }

  async function cargarSecciones(tipo: string) {
    const seccion = SECCION_POR_TIPO[tipo] ?? SECCION_POR_TIPO.nuevo;
    const [rp, rv] = await Promise.all([
      fetch(`${API}/productos?filtro=promo&porPagina=10`),
      fetch(`${API}/productos?${seccion.query}`),
    ]);
    if (rp.ok) setPromos((await rp.json()).items);
    if (rv.ok) setParaVos((await rv.json()).items);
    setCargado(true);
  }

  if (!cliente) {
    return (
      <View style={est.pantallaCrema}>
        <View style={est.cajaLogin}>
          <Text style={est.logo}>O.D.B</Text>
          <Text style={est.subtitulo}>Premium Market</Text>
          <Text style={est.texto}>
            Ingresá tu DNI para ver precios y ofertas pensadas para vos. La verificación de
            identidad (DNI + rostro) llega con el registro completo.
          </Text>
          <TextInput
            value={dni}
            onChangeText={setDni}
            placeholder="Tu DNI"
            keyboardType="number-pad"
            style={est.input}
            placeholderTextColor="#999"
          />
          <Pressable onPress={identificar} style={est.botonPrimario}>
            <Text style={est.botonPrimarioTexto}>Entrar</Text>
          </Pressable>
          <Pressable onPress={() => { setCliente({ dni: '', tipo: 'nuevo' }); cargarSecciones('nuevo'); }}>
            <Text style={est.link}>Seguir sin identificarme</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (!cargado) cargarSecciones(cliente.tipo);

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
  cajaLogin: { margin: 24, marginTop: 64, backgroundColor: COLORES.blanco, borderRadius: 20, padding: 24 },
  logo: { fontSize: 32, fontWeight: '700', letterSpacing: 4, textAlign: 'center', color: COLORES.negro },
  subtitulo: { textAlign: 'center', color: COLORES.rojo, fontWeight: '600', marginBottom: 16 },
  texto: { color: '#555', fontSize: 13, lineHeight: 19, marginBottom: 16, textAlign: 'center' },
  input: {
    borderWidth: 1, borderColor: '#ddd', borderRadius: 12, padding: 12, fontSize: 16,
    marginBottom: 12, color: COLORES.negro, backgroundColor: COLORES.blanco,
  },
  botonPrimario: { backgroundColor: COLORES.rojo, borderRadius: 24, padding: 14, alignItems: 'center' },
  botonPrimarioTexto: { color: COLORES.blanco, fontWeight: '600' },
  link: { textAlign: 'center', color: '#888', fontSize: 12, marginTop: 14, textDecorationLine: 'underline' },
  bannerRojo: { backgroundColor: COLORES.rojo, padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  bannerHola: { color: COLORES.blanco, fontSize: 16, fontWeight: '600' },
  chipNegro: { backgroundColor: COLORES.negro, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  chipNegroTexto: { color: COLORES.blanco, fontSize: 11, fontWeight: '600' },
  tituloSeccion: { fontSize: 16, fontWeight: '600', color: COLORES.negro, margin: 16, marginBottom: 8 },
  tarjeta: { backgroundColor: COLORES.blanco, borderRadius: 14, padding: 12, width: 150, marginHorizontal: 4 },
  tarjetaNombre: { fontSize: 12, color: COLORES.negro, minHeight: 32 },
  precio: { fontSize: 15, fontWeight: '700', color: COLORES.negro, marginTop: 6 },
  precioTachado: { fontSize: 11, color: '#999', textDecorationLine: 'line-through', marginTop: 4 },
  precioPromo: { fontSize: 15, fontWeight: '700', color: COLORES.rojo },
  botonAgregar: { backgroundColor: COLORES.negro, borderRadius: 14, paddingVertical: 6, alignItems: 'center', marginTop: 8 },
  botonAgregarTexto: { color: COLORES.blanco, fontSize: 12, fontWeight: '600' },
});
