'use client';

import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Linking, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import { API, pesos, useEstado, type Producto } from '../../lib/estado';
import { C, LinearGradient, Ionicons, sombra, toque } from '../../lib/ui';

type Renglon = Producto & { cantidad: number };

export default function CompraFacil() {
  const router = useRouter();
  const { cliente } = useEstado();
  const [permiso, pedirPermiso] = useCameraPermissions();
  const [items, setItems] = useState<Renglon[]>([]);
  const [manual, setManual] = useState('');
  const [sucursalId, setSucursalId] = useState('');
  const [pagando, setPagando] = useState(false);
  const [esperando, setEsperando] = useState(false);
  const [resultado, setResultado] = useState<{ codigoSalida: string; total: number; descuento: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ultimoScan = useRef<{ codigo: string; ts: number }>({ codigo: '', ts: 0 });

  const esNativo = Platform.OS !== 'web';
  const total = items.reduce((s, r) => s + (Number(r.precio) || 0) * r.cantidad, 0);
  const unidades = items.reduce((s, r) => s + r.cantidad, 0);

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
    toque();
    const p = encontrados[0];
    setItems((c) => {
      const existe = c.find((r) => r.sku === p.sku);
      if (existe) return c.map((r) => (r.sku === p.sku ? { ...r, cantidad: r.cantidad + 1 } : r));
      return [...c, { ...p, cantidad: 1 }];
    });
    setManual('');
  }

  function quitar(sku: string) {
    setItems((c) => c.map((r) => (r.sku === sku ? { ...r, cantidad: r.cantidad - 1 } : r)).filter((r) => r.cantidad > 0));
  }

  async function pagar() {
    if (!items.length || pagando || !cliente?.token) return;
    toque();
    setPagando(true);
    setError(null);
    try {
      const res = await fetch(`${API}/app/compra-facil`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cliente.token}` },
        body: JSON.stringify({ sucursalId, items: items.map((r) => ({ sku: r.sku, cantidad: r.cantidad })) }),
      });
      const datos = await res.json();
      if (!res.ok) throw new Error(datos.message ?? 'No se pudo iniciar el pago');
      if (datos.url) await Linking.openURL(datos.url);
      const totalCompra = datos.total ?? total;
      setItems([]);
      setPagando(false);
      setEsperando(true);
      esperarPago(datos.id, totalCompra);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
      setPagando(false);
    }
  }

  // Tras pagar en MP, espera la acreditación para emitir el código de salida.
  function esperarPago(id: string, totalCompra: number) {
    if (!cliente?.token) return;
    let intentos = 0;
    const timer = setInterval(async () => {
      intentos++;
      try {
        const r = await fetch(`${API}/app/compra-facil/${id}/estado`, { headers: { Authorization: `Bearer ${cliente.token}` } });
        const d = await r.json();
        if (r.ok && d.estado === 'pagado' && d.codigoSalida) {
          clearInterval(timer);
          setEsperando(false);
          setResultado({ codigoSalida: d.codigoSalida, total: d.total ?? totalCompra, descuento: 0 });
        }
      } catch {}
      if (intentos >= 60) { clearInterval(timer); setEsperando(false); setError('No recibimos la confirmación del pago. Si pagaste, revisá Mis compras en un rato.'); }
    }, 3000);
  }

  // --- estados bloqueados ---
  if (!cliente?.token) {
    return (
      <Aviso icono="scan" titulo="Comprá Fácil"
        texto="Escaneá los productos en el local, pagá con Mercado Pago desde tu celular y salí sin pasar por la caja."
        cta="Iniciar sesión" onCta={() => router.push('/')} />
    );
  }
  if (!cliente.verificado) {
    return (
      <Aviso icono="shield-checkmark" titulo="Falta un paso"
        texto="Comprá Fácil es exclusivo para clientes con identidad verificada (DNI + rostro): es nuestro control de mayoría de edad. Verificate desde Inicio — lleva un minuto."
        cta="Ir a verificar" onCta={() => router.push('/')} />
    );
  }

  // --- esperando confirmación de pago ---
  if (esperando) {
    return (
      <View style={est.centro}>
        <ActivityIndicator size="large" color={C.rojo} />
        <Text style={est.esperandoT}>Esperando la confirmación del pago…</Text>
        <Text style={est.esperandoS}>Completá el pago en Mercado Pago. Apenas se acredite, te mostramos tu código de salida.</Text>
        <Pressable onPress={() => { setEsperando(false); }} style={est.botonSecundario}>
          <Text style={est.botonSecundarioTexto}>Cancelar</Text>
        </Pressable>
      </View>
    );
  }

  // --- pago aprobado ---
  if (resultado) {
    return (
      <View style={est.centro}>
        <LinearGradient colors={[C.negro, C.vino]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[est.tarjetaSalida, sombra(2)]}>
          <View style={est.checkCirc}><Ionicons name="checkmark" size={30} color="#fff" /></View>
          <Text style={est.salidaLabel}>¡Pago aprobado! Mostrá este código al salir</Text>
          <Text style={est.codigoSalida}>{resultado.codigoSalida}</Text>
          <Text style={est.salidaDetalle}>
            {pesos(resultado.total)}{resultado.descuento > 0 ? ` · ahorraste ${pesos(resultado.descuento)}` : ''}
          </Text>
        </LinearGradient>
        <Pressable onPress={() => { toque(); setResultado(null); }} style={est.botonSecundario}>
          <Ionicons name="scan" size={16} color={C.tinta} />
          <Text style={est.botonSecundarioTexto}>Nueva compra</Text>
        </Pressable>
      </View>
    );
  }

  // --- escaneo ---
  return (
    <View style={est.pantalla}>
      <View style={est.camaraWrap}>
        {esNativo && permiso?.granted ? (
          <CameraView style={StyleSheet.absoluteFill}
            barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'code128'] }}
            onBarcodeScanned={({ data }) => agregarPorCodigo(data)} />
        ) : (
          <View style={est.camaraFalsa}>
            <Ionicons name="barcode-outline" size={34} color="rgba(255,255,255,0.5)" />
            <Text style={est.camaraTexto}>
              {esNativo ? 'Permití el acceso a la cámara para escanear' : 'En el celular se abre la cámara para escanear'}
            </Text>
          </View>
        )}
        {/* marco de escaneo */}
        <View pointerEvents="none" style={est.marco}>
          <View style={[est.esquina, est.eTL]} /><View style={[est.esquina, est.eTR]} />
          <View style={[est.esquina, est.eBL]} /><View style={[est.esquina, est.eBR]} />
        </View>
        <View style={est.hint}><Ionicons name="scan-outline" size={13} color="#fff" /><Text style={est.hintTxt}>Apuntá al código de barras</Text></View>
      </View>

      <View style={est.manual}>
        <View style={[est.inputWrap, sombra(0)]}>
          <Ionicons name="keypad-outline" size={17} color={C.humo} />
          <TextInput value={manual} onChangeText={setManual} placeholder="O escribí el código…"
            placeholderTextColor={C.humo} keyboardType="number-pad" style={est.inputManual}
            onSubmitEditing={() => agregarPorCodigo(manual)} returnKeyType="done" />
        </View>
        <Pressable onPress={() => agregarPorCodigo(manual)} style={est.botonManual}>
          <Ionicons name="add" size={22} color="#fff" />
        </Pressable>
      </View>

      {error && <View style={est.errorBox}><Ionicons name="alert-circle" size={15} color={C.rojoOscuro} /><Text style={est.error}>{error}</Text></View>}

      <FlatList
        data={items} keyExtractor={(r) => r.sku} style={{ flex: 1 }}
        contentContainerStyle={{ padding: 14, paddingTop: 8 }}
        ListHeaderComponent={items.length > 0 ? <Text style={est.tuCarrito}>Tu compra · {unidades} {unidades === 1 ? 'ítem' : 'ítems'}</Text> : null}
        ListEmptyComponent={
          <View style={est.vacioWrap}>
            <Ionicons name="cart-outline" size={30} color={C.humo} />
            <Text style={est.vacio}>Escaneá tu primer producto para empezar</Text>
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
              <Text numberOfLines={1} style={est.filaNombre}>{r.nombre}</Text>
              <Text style={est.filaUnit}>{r.cantidad} × {pesos(r.precio)}</Text>
            </View>
            <Text style={est.filaPrecio}>{pesos((Number(r.precio) || 0) * r.cantidad)}</Text>
            <Pressable onPress={() => { toque(); quitar(r.sku); }} hitSlop={8} style={est.quitar}>
              <Ionicons name="close" size={15} color={C.humo} />
            </Pressable>
          </View>
        )}
      />

      {items.length > 0 && (
        <Pressable onPress={pagar} disabled={pagando} style={[est.botonPagar, sombra(1)]}>
          <Ionicons name="card" size={19} color="#fff" />
          <Text style={est.botonPagarTexto}>{pagando ? 'Procesando…' : `Pagar con Mercado Pago · ${pesos(total)}`}</Text>
        </Pressable>
      )}
    </View>
  );
}

function Aviso({ icono, titulo, texto, cta, onCta }: { icono: any; titulo: string; texto: string; cta: string; onCta: () => void }) {
  return (
    <View style={est.centro}>
      <View style={est.avisoIcono}><Ionicons name={icono} size={38} color={C.rojo} /></View>
      <Text style={est.tituloAviso}>{titulo}</Text>
      <Text style={est.textoAviso}>{texto}</Text>
      <Pressable onPress={() => { toque(); onCta(); }} style={est.avisoBoton}>
        <Text style={est.avisoBotonTxt}>{cta}</Text>
      </Pressable>
    </View>
  );
}

const est = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: C.crema },
  centro: { flex: 1, backgroundColor: C.crema, alignItems: 'center', justifyContent: 'center', padding: 32 },
  esperandoT: { fontSize: 17, fontWeight: '800', color: C.tinta, marginTop: 18, textAlign: 'center' },
  esperandoS: { fontSize: 13.5, color: C.humo, textAlign: 'center', lineHeight: 20, marginTop: 8 },
  avisoIcono: { width: 84, height: 84, borderRadius: 42, backgroundColor: '#FBE9E7', alignItems: 'center', justifyContent: 'center', marginBottom: 18 },
  tituloAviso: { fontSize: 21, fontWeight: '800', color: C.tinta, textAlign: 'center', marginBottom: 10 },
  textoAviso: { fontSize: 14, color: C.humo, textAlign: 'center', lineHeight: 21 },
  avisoBoton: { marginTop: 22, backgroundColor: C.rojo, borderRadius: 24, paddingHorizontal: 28, paddingVertical: 13 },
  avisoBotonTxt: { color: '#fff', fontWeight: '700', fontSize: 14.5 },
  camaraWrap: { height: 210, backgroundColor: C.negro, position: 'relative', overflow: 'hidden' },
  camaraFalsa: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 20 },
  camaraTexto: { color: 'rgba(255,255,255,0.6)', fontSize: 13, textAlign: 'center' },
  marco: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  esquina: { position: 'absolute', width: 36, height: 36, borderColor: '#fff' },
  eTL: { top: 56, left: 70, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 8 },
  eTR: { top: 56, right: 70, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 8 },
  eBL: { bottom: 56, left: 70, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 8 },
  eBR: { bottom: 56, right: 70, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 8 },
  hint: { position: 'absolute', bottom: 14, alignSelf: 'center', flexDirection: 'row', gap: 6, alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 6 },
  hintTxt: { color: '#fff', fontSize: 12, fontWeight: '600' },
  manual: { flexDirection: 'row', gap: 8, padding: 12, paddingBottom: 4 },
  inputWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fff', borderRadius: 16, paddingHorizontal: 14 },
  inputManual: { flex: 1, paddingVertical: 12, fontSize: 14.5, color: C.tinta },
  botonManual: { backgroundColor: C.negro, borderRadius: 16, width: 48, alignItems: 'center', justifyContent: 'center' },
  errorBox: { flexDirection: 'row', gap: 6, alignItems: 'center', paddingHorizontal: 16, paddingTop: 8 },
  error: { color: C.rojoOscuro, fontSize: 12.5, flex: 1 },
  tuCarrito: { fontSize: 13, color: C.humo, fontWeight: '600', marginBottom: 10 },
  vacioWrap: { alignItems: 'center', gap: 10, marginTop: 30 },
  vacio: { textAlign: 'center', color: C.humo, fontSize: 13.5 },
  fila: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 14, padding: 10, marginBottom: 8, gap: 11 },
  thumb: { width: 46, height: 46, borderRadius: 11, backgroundColor: C.cremaProf },
  thumbVacio: { alignItems: 'center', justifyContent: 'center' },
  thumbInicial: { fontSize: 20, fontWeight: '800', color: '#cabfae' },
  filaNombre: { fontSize: 13.5, color: C.tinta, fontWeight: '600' },
  filaUnit: { fontSize: 12, color: C.humo, marginTop: 2 },
  filaPrecio: { fontSize: 14, fontWeight: '800', color: C.tinta },
  quitar: { width: 26, height: 26, borderRadius: 13, backgroundColor: C.crema, alignItems: 'center', justifyContent: 'center' },
  botonPagar: { flexDirection: 'row', gap: 9, backgroundColor: '#009EE3', margin: 14, borderRadius: 26, padding: 16, alignItems: 'center', justifyContent: 'center' },
  botonPagarTexto: { color: '#fff', fontWeight: '800', fontSize: 15 },
  tarjetaSalida: { borderRadius: 24, padding: 28, alignItems: 'center', width: '100%' },
  checkCirc: { width: 56, height: 56, borderRadius: 28, backgroundColor: C.verde, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  salidaLabel: { color: 'rgba(255,255,255,0.75)', fontSize: 13, textAlign: 'center' },
  codigoSalida: { color: '#fff', fontSize: 40, fontWeight: '800', letterSpacing: 4, marginVertical: 12 },
  salidaDetalle: { color: C.dorado, fontSize: 14.5, fontWeight: '600' },
  botonSecundario: { marginTop: 18, flexDirection: 'row', gap: 7, alignSelf: 'center', backgroundColor: '#fff', borderRadius: 24, paddingHorizontal: 22, paddingVertical: 12, ...sombra(0) },
  botonSecundarioTexto: { color: C.tinta, fontWeight: '700', fontSize: 13.5 },
});
