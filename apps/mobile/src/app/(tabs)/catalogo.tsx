import { useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { API, useEstado, type Producto } from '../../lib/estado';
import { C, TarjetaProducto, Ionicons, sombra } from '../../lib/ui';

type Cat = { id: string; nombre: string };

export default function Catalogo() {
  const { cliente } = useEstado();
  const [buscar, setBuscar] = useState('');
  const [productos, setProductos] = useState<Producto[]>([]);
  const [cats, setCats] = useState<Cat[]>([]);
  const [catSel, setCatSel] = useState<string>('');
  const [cargando, setCargando] = useState(false);

  useEffect(() => {
    fetch(`${API}/catalogo/filtros`).then((r) => r.json()).then((d) => setCats(d.categorias ?? [])).catch(() => {});
  }, []);

  useEffect(() => {
    setCargando(true);
    const timer = setTimeout(async () => {
      const qs = `buscar=${encodeURIComponent(buscar)}${catSel ? `&categoriaId=${catSel}` : ''}&porPagina=40`;
      const res = await fetch(`${API}/productos?${qs}`, { headers: cliente?.token ? { Authorization: `Bearer ${cliente.token}` } : {} });
      if (res.ok) setProductos((await res.json()).items);
      setCargando(false);
    }, 250);
    return () => clearTimeout(timer);
  }, [buscar, catSel, cliente?.token]);

  return (
    <View style={est.pantalla}>
      {/* buscador */}
      <View style={est.barra}>
        <View style={[est.buscador, sombra(0)]}>
          <Ionicons name="search" size={18} color={C.humo} />
          <TextInput value={buscar} onChangeText={setBuscar} placeholder="Buscar bebidas, fiambres, almacén…" placeholderTextColor={C.humo} style={est.input} />
          {buscar.length > 0 && (
            <Pressable onPress={() => setBuscar('')}><Ionicons name="close-circle" size={18} color={C.humo} /></Pressable>
          )}
        </View>
      </View>

      {/* filtros por categoría */}
      <View style={{ height: 46 }}>
        <FlatList
          horizontal showsHorizontalScrollIndicator={false}
          data={[{ id: '', nombre: 'Todo' }, ...cats]} keyExtractor={(c) => c.id || 'all'}
          contentContainerStyle={{ paddingHorizontal: 16, gap: 8, alignItems: 'center' }}
          renderItem={({ item }) => {
            const activo = catSel === item.id;
            return (
              <Pressable onPress={() => setCatSel(item.id)} style={[est.pill, activo && est.pillActiva]}>
                <Text style={[est.pillTxt, activo && { color: '#fff' }]}>{item.nombre}</Text>
              </Pressable>
            );
          }}
        />
      </View>

      {/* grilla */}
      <FlatList
        data={productos} key="grid-2" numColumns={2} keyExtractor={(p) => p.sku}
        columnWrapperStyle={{ gap: 12, paddingHorizontal: 16 }}
        contentContainerStyle={{ paddingBottom: 24, paddingTop: 6, gap: 12 }}
        renderItem={({ item }) => <TarjetaProducto p={item} grid />}
        ListEmptyComponent={<Text style={est.vacio}>{cargando ? 'Buscando…' : 'Sin resultados.'}</Text>}
      />
    </View>
  );
}

const est = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: C.crema },
  barra: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8, backgroundColor: C.crema },
  buscador: { flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: '#fff', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 4 },
  input: { flex: 1, paddingVertical: 11, fontSize: 14.5, color: C.tinta },
  pill: { backgroundColor: '#fff', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, ...sombra(0) },
  pillActiva: { backgroundColor: C.rojo },
  pillTxt: { fontSize: 13, fontWeight: '600', color: C.tinta },
  vacio: { textAlign: 'center', color: C.humo, marginTop: 40, fontSize: 14 },
});
