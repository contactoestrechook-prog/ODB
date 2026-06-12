'use client';

import { useEffect, useRef, useState } from 'react';
import { FlatList, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { API, COLORES, pesos, useEstado, type Producto } from '../../lib/estado';

type Renglon = Producto & { cantidad: number };

export default function CompraFacil() {
  const { cliente } = useEstado();
  const [permiso, pedirPermiso] = useCameraPermissions();
  const [items, setItems] = useState<Renglon[]>([]);
  const [manual, setManual] = useState('');
  const [sucursalId, setSucursalId] = useState('');
  const [pagando, setPagando] = useState(false);
  const [resultado, setResultado] = useState<{ codigoSalida: string; total: number; descuento: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ultimoScan = useRef<{ codigo: string; ts: number }>({ codigo: '', ts: 0 });

  const esNativo = Platform.OS !== 'web';
  const total = items.reduce((s, r) => s + (Number(r.precio) || 0) * r.cantidad, 0);

  useEffect(() => {
    fetch(`${API}/sucursales`)
      .then((r) => r.json())
      .then((s) => s[0] && setSucursalId(s[0].id))
      .catch(() => {});
    if (esNativo && !permiso?.granted) pedirPermiso();
  }, []);

  async function agregarPorCodigo(codigo: string) {
    const limpio = codigo.trim();
    if (!limpio) return;
    // anti-rebote del escáner: el mismo código no se suma 2 veces por segundo
    if (ultimoScan.current.codigo === limpio && Date.now() - ultimoScan.current.ts < 2000) return;
    ultimoScan.current = { codigo: limpio, ts: Date.now() };

    const res = await fetch(`${API}/productos?buscar=${encodeURIComponent(limpio)}&porPagina=1`);
    if (!res.ok) return;
    const encontrados: Producto[] = (await res.json()).items;
    if (!encontrados.length) {
      setError(`No encontramos "${limpio}" en el catálogo`);
      return;
    }
    setError(null);
    const p = encontrados[0];
    setItems((c) => {
      const existe = c.find((r) => r.sku === p.sku);
      if (existe) return c.map((r) => (r.sku === p.sku ? { ...r, cantidad: r.cantidad + 1 } : r));
      return [...c, { ...p, cantidad: 1 }];
    });
    setManual('');
  }

  async function pagar() {
    if (!items.length || pagando || !cliente?.token) return;
    setPagando(true);
    setError(null);
    try {
      const res = await fetch(`${API}/app/compra-facil`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cliente.token}`,
        },
        body: JSON.stringify({
          sucursalId,
          items: items.map((r) => ({ sku: r.sku, cantidad: r.cantidad })),
        }),
      });
      const datos = await res.json();
      if (!res.ok) throw new Error(datos.message ?? 'No se pudo pagar');
      setResultado({ codigoSalida: datos.codigoSalida, total: datos.total, descuento: datos.descuento });
      setItems([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
    setPagando(false);
  }

  if (!cliente?.token) {
    return (
      <View style={est.centro}>
        <Text style={est.tituloAviso}>Comprá Fácil 🛒</Text>
        <Text style={est.textoAviso}>
          Escaneá los productos en el local, pagá con Mercado Pago desde tu celular y salí
          sin pasar por la caja. Iniciá sesión desde Inicio para usarlo.
        </Text>
      </View>
    );
  }

  if (!cliente.verificado) {
    return (
      <View style={est.centro}>
        <Text style={est.tituloAviso}>🛡 Falta un paso</Text>
        <Text style={est.textoAviso}>
          Comprá Fácil es exclusivo para clientes con identidad verificada (DNI + rostro): es
          nuestro control de mayoría de edad. Verificate desde la pestaña Inicio — lleva un minuto.
        </Text>
      </View>
    );
  }

  if (resultado) {
    return (
      <View style={est.centro}>
        <View style={est.tarjetaSalida}>
          <Text style={est.salidaLabel}>¡Pago aprobado! Mostrá este código al salir</Text>
          <Text style={est.codigoSalida}>{resultado.codigoSalida}</Text>
          <Text style={est.salidaDetalle}>
            {pesos(resultado.total)}
            {resultado.descuento > 0 ? ` · ahorraste ${pesos(resultado.descuento)}` : ''}
          </Text>
        </View>
        <Pressable onPress={() => setResultado(null)} style={est.botonSecundario}>
          <Text style={est.botonSecundarioTexto}>Nueva compra</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={est.pantalla}>
      {esNativo && permiso?.granted ? (
        <CameraView
          style={est.camara}
          barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'code128'] }}
          onBarcodeScanned={({ data }) => agregarPorCodigo(data)}
        />
      ) : (
        <View style={est.camaraFalsa}>
          <Text style={est.camaraTexto}>
            {esNativo ? 'Permití el acceso a la cámara para escanear' : 'En el celular, acá se abre la cámara para escanear'}
          </Text>
        </View>
      )}

      <View style={est.manual}>
        <TextInput
          value={manual}
          onChangeText={setManual}
          placeholder="O escribí el código de barras…"
          placeholderTextColor="#999"
          keyboardType="number-pad"
          style={est.inputManual}
          onSubmitEditing={() => agregarPorCodigo(manual)}
        />
        <Pressable onPress={() => agregarPorCodigo(manual)} style={est.botonManual}>
          <Text style={{ color: COLORES.blanco, fontWeight: '700' }}>+</Text>
        </Pressable>
      </View>

      {error && <Text style={est.error}>{error}</Text>}

      <FlatList
        data={items}
        keyExtractor={(r) => r.sku}
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 12 }}
        ListEmptyComponent={
          <Text style={est.vacio}>Escaneá tu primer producto para empezar</Text>
        }
        renderItem={({ item: r }) => (
          <View style={est.fila}>
            <Text style={est.filaNombre}>
              {r.cantidad}× {r.nombre}
            </Text>
            <Text style={est.filaPrecio}>{pesos((Number(r.precio) || 0) * r.cantidad)}</Text>
          </View>
        )}
      />

      {items.length > 0 && (
        <Pressable onPress={pagar} disabled={pagando} style={est.botonPagar}>
          <Text style={est.botonPagarTexto}>
            {pagando ? 'Procesando…' : `Pagar con Mercado Pago · ${pesos(total)}`}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

const est = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: COLORES.crema },
  centro: { flex: 1, backgroundColor: COLORES.crema, justifyContent: 'center', padding: 32 },
  tituloAviso: { fontSize: 22, fontWeight: '700', color: COLORES.negro, textAlign: 'center', marginBottom: 12 },
  textoAviso: { fontSize: 14, color: '#555', textAlign: 'center', lineHeight: 21 },
  camara: { height: 180 },
  camaraFalsa: { height: 120, backgroundColor: COLORES.negro, alignItems: 'center', justifyContent: 'center', padding: 16 },
  camaraTexto: { color: COLORES.crema, fontSize: 13, textAlign: 'center' },
  manual: { flexDirection: 'row', gap: 8, padding: 12, paddingBottom: 4 },
  inputManual: {
    flex: 1, backgroundColor: COLORES.blanco, borderRadius: 22, paddingHorizontal: 16,
    paddingVertical: 10, fontSize: 14, color: COLORES.negro, borderWidth: 1.5, borderColor: COLORES.rojo,
  },
  botonManual: { backgroundColor: COLORES.negro, borderRadius: 22, width: 44, alignItems: 'center', justifyContent: 'center' },
  error: { color: COLORES.rojoOscuro, fontSize: 12, paddingHorizontal: 16, paddingTop: 6 },
  vacio: { textAlign: 'center', color: '#888', marginTop: 32 },
  fila: {
    flexDirection: 'row', justifyContent: 'space-between', backgroundColor: COLORES.blanco,
    borderRadius: 12, padding: 12, marginBottom: 6,
  },
  filaNombre: { flex: 1, fontSize: 13, color: COLORES.negro, marginRight: 8 },
  filaPrecio: { fontSize: 13, fontWeight: '700', color: COLORES.negro },
  botonPagar: { backgroundColor: '#009EE3', margin: 12, borderRadius: 26, padding: 15, alignItems: 'center' },
  botonPagarTexto: { color: COLORES.blanco, fontWeight: '700', fontSize: 15 },
  tarjetaSalida: { backgroundColor: COLORES.negro, borderRadius: 20, padding: 24, alignItems: 'center' },
  salidaLabel: { color: '#aaa', fontSize: 13, textAlign: 'center' },
  codigoSalida: { color: COLORES.blanco, fontSize: 36, fontWeight: '700', letterSpacing: 3, marginVertical: 12 },
  salidaDetalle: { color: COLORES.crema, fontSize: 14 },
  botonSecundario: { marginTop: 16, alignSelf: 'center', borderWidth: 1, borderColor: COLORES.negro, borderRadius: 22, paddingHorizontal: 20, paddingVertical: 10 },
  botonSecundarioTexto: { color: COLORES.negro, fontWeight: '600', fontSize: 13 },
});
