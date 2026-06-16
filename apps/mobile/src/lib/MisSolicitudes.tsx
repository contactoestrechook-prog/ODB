import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { API, useEstado } from './estado';
import { C, Ionicons, sombra, toque } from './ui';

type Solicitud = {
  id: string; tipo: string; asunto: string; mensaje: string; estado: string;
  respuesta?: string | null; respondido_en?: string | null; creado_en: string;
};

const TIPOS: { k: string; label: string; icon: any }[] = [
  { k: 'consulta', label: 'Consulta', icon: 'help-circle-outline' },
  { k: 'devolucion', label: 'Devolución', icon: 'swap-horizontal-outline' },
  { k: 'pedido', label: 'Pedido especial', icon: 'gift-outline' },
  { k: 'reclamo', label: 'Reclamo', icon: 'alert-circle-outline' },
];
const ESTADO: Record<string, { txt: string; bg: string; fg: string }> = {
  abierta: { txt: 'Abierta', bg: '#FAEEDA', fg: '#854F0B' },
  en_proceso: { txt: 'En proceso', bg: '#E6F1FB', fg: '#185FA5' },
  resuelta: { txt: 'Resuelta', bg: '#E6F2EC', fg: '#2F7A4F' },
  cerrada: { txt: 'Cerrada', bg: '#EDE7DD', fg: '#6f655a' },
};
const fecha = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';

export default function MisSolicitudes() {
  const { cliente } = useEstado();
  const [lista, setLista] = useState<Solicitud[]>([]);
  const [cargando, setCargando] = useState(true);
  const [tipo, setTipo] = useState('consulta');
  const [asunto, setAsunto] = useState('');
  const [mensaje, setMensaje] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const auth = cliente?.token ? { Authorization: `Bearer ${cliente.token}` } : undefined;

  async function cargar() {
    if (!auth) return;
    try {
      const r = await fetch(`${API}/mi/solicitudes`, { headers: auth });
      if (r.ok) setLista(await r.json());
    } catch {}
    setCargando(false);
  }
  useEffect(() => { cargar(); }, []);

  async function enviar() {
    if (!mensaje.trim() || enviando || !auth) return;
    toque();
    setEnviando(true);
    setError(null);
    try {
      const r = await fetch(`${API}/mi/solicitudes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth },
        body: JSON.stringify({ tipo, asunto, mensaje }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.message ?? 'No se pudo enviar');
      setMensaje(''); setAsunto(''); setOk(true);
      setTimeout(() => setOk(false), 2500);
      cargar();
    } catch (e) { setError(e instanceof Error ? e.message : 'Error'); }
    setEnviando(false);
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 6 }}>
      {/* formulario */}
      <View style={[est.form, sombra(0)]}>
        <Text style={est.titulo}>Escribinos</Text>
        <Text style={est.sub}>Una devolución, una consulta, lo que necesites. Te respondemos por acá.</Text>
        <View style={est.tipos}>
          {TIPOS.map((t) => {
            const on = tipo === t.k;
            return (
              <Pressable key={t.k} onPress={() => { toque(); setTipo(t.k); }} style={[est.tipo, on && est.tipoOn]}>
                <Ionicons name={t.icon} size={15} color={on ? '#fff' : C.tinta} />
                <Text style={[est.tipoTxt, on && { color: '#fff' }]}>{t.label}</Text>
              </Pressable>
            );
          })}
        </View>
        <TextInput value={asunto} onChangeText={setAsunto} placeholder="Asunto (opcional)" placeholderTextColor={C.humo} style={est.input} />
        <TextInput value={mensaje} onChangeText={setMensaje} placeholder="Contanos…" placeholderTextColor={C.humo} multiline style={[est.input, est.area]} />
        {error && <Text style={est.error}>{error}</Text>}
        {ok && <Text style={est.ok}>¡Enviado! Te respondemos a la brevedad ✓</Text>}
        <Pressable onPress={enviar} disabled={enviando} style={est.boton}>
          <Ionicons name="paper-plane" size={16} color="#fff" />
          <Text style={est.botonTxt}>{enviando ? 'Enviando…' : 'Enviar'}</Text>
        </Pressable>
      </View>

      {/* historial */}
      <Text style={est.seccion}>Tus mensajes</Text>
      {cargando ? (
        <ActivityIndicator color={C.rojo} style={{ marginTop: 16 }} />
      ) : lista.length === 0 ? (
        <Text style={est.vacio}>Todavía no enviaste ninguna consulta.</Text>
      ) : (
        lista.map((s) => {
          const e = ESTADO[s.estado] ?? ESTADO.abierta;
          const t = TIPOS.find((x) => x.k === s.tipo);
          return (
            <View key={s.id} style={[est.card, sombra(0)]}>
              <View style={est.cardTop}>
                <View style={est.cardTipo}>
                  <Ionicons name={(t?.icon ?? 'chatbubble-outline') as any} size={15} color={C.vino} />
                  <Text style={est.cardAsunto}>{s.asunto || t?.label}</Text>
                </View>
                <View style={[est.badge, { backgroundColor: e.bg }]}><Text style={[est.badgeTxt, { color: e.fg }]}>{e.txt}</Text></View>
              </View>
              <Text style={est.cardMsg}>{s.mensaje}</Text>
              <Text style={est.cardFecha}>{fecha(s.creado_en)}</Text>
              {s.respuesta ? (
                <View style={est.resp}>
                  <View style={est.respTop}><Ionicons name="storefront" size={13} color={C.rojo} /><Text style={est.respLabel}>Respuesta de O.D.B</Text></View>
                  <Text style={est.respTxt}>{s.respuesta}</Text>
                </View>
              ) : null}
            </View>
          );
        })
      )}
      <View style={{ height: 20 }} />
    </ScrollView>
  );
}

const est = StyleSheet.create({
  form: { backgroundColor: '#fff', borderRadius: 18, padding: 18, marginBottom: 18 },
  titulo: { fontSize: 17, fontWeight: '800', color: C.tinta },
  sub: { fontSize: 12.5, color: C.humo, marginTop: 3, lineHeight: 18 },
  tipos: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14, marginBottom: 12 },
  tipo: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: C.crema, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 8 },
  tipoOn: { backgroundColor: C.rojo },
  tipoTxt: { fontSize: 12.5, fontWeight: '600', color: C.tinta },
  input: { backgroundColor: C.crema, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14.5, color: C.tinta, marginBottom: 10 },
  area: { minHeight: 90, textAlignVertical: 'top' },
  error: { color: C.rojoOscuro, fontSize: 12.5, marginBottom: 8 },
  ok: { color: C.verde, fontSize: 12.5, marginBottom: 8, fontWeight: '600' },
  boton: { flexDirection: 'row', gap: 8, backgroundColor: C.rojo, borderRadius: 24, paddingVertical: 13, alignItems: 'center', justifyContent: 'center' },
  botonTxt: { color: '#fff', fontWeight: '800', fontSize: 14.5 },
  seccion: { fontSize: 15, fontWeight: '800', color: C.tinta, marginBottom: 10 },
  vacio: { color: C.humo, fontSize: 13.5, marginTop: 8 },
  card: { backgroundColor: '#fff', borderRadius: 14, padding: 15, marginBottom: 10 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 7 },
  cardTipo: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  cardAsunto: { fontSize: 14, fontWeight: '700', color: C.tinta, flex: 1 },
  badge: { borderRadius: 9, paddingHorizontal: 9, paddingVertical: 4 },
  badgeTxt: { fontSize: 11, fontWeight: '700' },
  cardMsg: { fontSize: 13, color: '#5f554d', lineHeight: 18 },
  cardFecha: { fontSize: 11, color: C.humo, marginTop: 6 },
  resp: { marginTop: 12, backgroundColor: C.crema, borderRadius: 12, padding: 12, borderLeftWidth: 3, borderLeftColor: C.rojo },
  respTop: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  respLabel: { fontSize: 11.5, fontWeight: '800', color: C.rojo },
  respTxt: { fontSize: 13, color: C.tinta, lineHeight: 18 },
});
