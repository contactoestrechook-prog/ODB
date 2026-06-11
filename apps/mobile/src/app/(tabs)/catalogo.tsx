import { useEffect, useState } from 'react';
import { FlatList, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { API, COLORES, pesos, useEstado, type Producto } from '../../lib/estado';

export default function Catalogo() {
  const { agregar } = useEstado();
  const [buscar, setBuscar] = useState('');
  const [productos, setProductos] = useState<Producto[]>([]);

  useEffect(() => {
    const timer = setTimeout(async () => {
      const res = await fetch(
        `${API}/productos?buscar=${encodeURIComponent(buscar)}&porPagina=30`,
      );
      if (res.ok) setProductos((await res.json()).items);
    }, 250);
    return () => clearTimeout(timer);
  }, [buscar]);

  return (
    <View style={est.pantalla}>
      <TextInput
        value={buscar}
        onChangeText={setBuscar}
        placeholder="Buscar entre 13.000 bebidas y fiambres…"
        placeholderTextColor="#999"
        style={est.buscador}
      />
      <FlatList
        data={productos}
        keyExtractor={(p) => p.sku}
        contentContainerStyle={{ padding: 12 }}
        renderItem={({ item: p }) => (
          <View style={est.fila}>
            {p.imagenUrl ? (
              <Image source={{ uri: p.imagenUrl }} style={est.miniatura} />
            ) : (
              <View style={[est.miniatura, est.miniaturaVacia]}>
                <Text style={est.miniaturaInicial}>{p.nombre[0]}</Text>
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={est.nombre}>
                {p.nombre} {p.esAlcohol ? <Text style={est.mas18}> +18</Text> : null}
              </Text>
              {p.descuento ? (
                <Text style={est.promo}>{p.descuento}</Text>
              ) : (
                <Text style={est.categoria}>{p.categoria}</Text>
              )}
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              {p.descuento && <Text style={est.tachado}>{pesos(p.precioLista)}</Text>}
              <Text style={[est.precio, p.descuento ? { color: COLORES.rojo } : null]}>
                {pesos(p.precio)}
              </Text>
              <Pressable onPress={() => agregar(p)} style={est.boton}>
                <Text style={est.botonTexto}>+ Agregar</Text>
              </Pressable>
            </View>
          </View>
        )}
      />
    </View>
  );
}

const est = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: COLORES.crema },
  buscador: {
    margin: 12, backgroundColor: COLORES.blanco, borderRadius: 24, paddingHorizontal: 18,
    paddingVertical: 12, fontSize: 14, borderWidth: 1.5, borderColor: COLORES.rojo, color: COLORES.negro,
  },
  fila: {
    flexDirection: 'row', backgroundColor: COLORES.blanco, borderRadius: 14,
    padding: 12, marginBottom: 8, gap: 10,
  },
  miniatura: { width: 52, height: 52, borderRadius: 10 },
  miniaturaVacia: { backgroundColor: COLORES.crema, alignItems: 'center', justifyContent: 'center' },
  miniaturaInicial: { fontSize: 20, fontWeight: '700', color: '#bbb' },
  nombre: { fontSize: 14, color: COLORES.negro, fontWeight: '500' },
  mas18: { fontSize: 10, color: COLORES.blanco, backgroundColor: COLORES.negro },
  categoria: { fontSize: 12, color: '#888', marginTop: 2 },
  promo: { fontSize: 12, color: COLORES.rojo, marginTop: 2, fontWeight: '600' },
  tachado: { fontSize: 11, color: '#999', textDecorationLine: 'line-through' },
  precio: { fontSize: 16, fontWeight: '700', color: COLORES.negro },
  boton: { backgroundColor: COLORES.negro, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 5, marginTop: 6 },
  botonTexto: { color: COLORES.blanco, fontSize: 12, fontWeight: '600' },
});
