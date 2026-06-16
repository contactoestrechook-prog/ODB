import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { API, useEstado } from '../lib/estado';
import { C, LinearGradient, Ionicons, sombra, toque } from '../lib/ui';

const fecha = (iso: string) => new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });

export default function Puntos() {
  const { cliente, setCliente } = useEstado();
  const [data, setData] = useState<any>(null);
  const [cargando, setCargando] = useState(true);
  const [canjeando, setCanjeando] = useState<string | null>(null);
  const [ultimo, setUltimo] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  async function cargar() {
    if (!cliente?.token) return;
    try {
      const r = await fetch(`${API}/mi/puntos`, { headers: { Authorization: `Bearer ${cliente.token}` } });
      if (r.ok) setData(await r.json());
    } catch {}
    setCargando(false);
  }
  useEffect(() => { cargar(); }, []);

  async function canjear(rec: any) {
    if (canjeando || !cliente?.token) return;
    setError(null);
    setCanjeando(rec.id);
    try {
      const res = await fetch(`${API}/mi/puntos/canjear`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${cliente.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ recompensaId: rec.id }),
      });
      const d = await res.json();
      if (res.ok && d.codigo) {
        toque();
        setUltimo(d);
        setCliente({ ...cliente, puntos: d.saldo });
        await cargar();
      } else setError(d.message ?? 'No se pudo canjear');
    } catch { setError('No se pudo canjear'); }
    setCanjeando(null);
  }

  if (cargando) return <View style={est.centro}><ActivityIndicator color={C.rojo} /></View>;
  if (!data) return <View style={est.centro}><Text style={est.humo}>No pudimos cargar tus puntos.</Text></View>;

  const prox = data.nivel?.proximo;

  return (
    <ScrollView style={est.pantalla} contentContainerStyle={{ padding: 16 }}>
      {/* hero */}
      <LinearGradient colors={[C.negro, C.vino]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[est.hero, sombra(2)]}>
        <View style={est.heroTop}>
          <Text style={est.heroLabel}>TUS PUNTOS</Text>
          <View style={est.nivelChip}><Ionicons name="ribbon" size={13} color={C.negro} /><Text style={est.nivelChipTxt}>{data.nivel?.nombre}</Text></View>
        </View>
        <Text style={est.heroPuntos}>{Number(data.saldo).toLocaleString('es-AR')}</Text>
        <Text style={est.heroGana}>{data.gana}</Text>
        {prox && (
          <View style={est.progWrap}>
            <View style={est.progFondo}>
              <View style={[est.progLleno, { width: `${Math.min(100, (data.acumulado / (data.acumulado + prox.faltan)) * 100)}%` }]} />
            </View>
            <Text style={est.progTxt}>Te faltan {prox.faltan.toLocaleString('es-AR')} para {prox.nombre}</Text>
          </View>
        )}
      </LinearGradient>

      {/* código recién canjeado */}
      {ultimo && (
        <View style={[est.codigoCard, sombra(1)]}>
          <Ionicons name="gift" size={24} color={C.verde} />
          <Text style={est.codigoTitulo}>¡Canje confirmado!</Text>
          <Text style={est.codigoSub}>{ultimo.recompensa}</Text>
          <View style={est.codigoBox}><Text style={est.codigoTxt}>{ultimo.codigo}</Text></View>
          <Text style={est.codigoNota}>Mostrá este código en O.D.B Central</Text>
        </View>
      )}
      {error && <Text style={est.error}>{error}</Text>}

      {/* recompensas */}
      <Text style={est.seccion}>Canjeá tus puntos</Text>
      {data.recompensas.map((rec: any) => (
        <View key={rec.id} style={[est.rec, sombra(0)]}>
          <Text style={est.recEmoji}>{rec.emoji}</Text>
          <View style={{ flex: 1 }}>
            <Text style={est.recNombre}>{rec.nombre}</Text>
            <Text style={est.recPuntos}>{rec.puntos.toLocaleString('es-AR')} puntos</Text>
          </View>
          <Pressable
            onPress={() => canjear(rec)}
            disabled={!rec.alcanza || canjeando === rec.id}
            style={[est.recBtn, !rec.alcanza && est.recBtnOff]}
          >
            <Text style={[est.recBtnTxt, !rec.alcanza && { color: C.humo }]}>
              {canjeando === rec.id ? '…' : rec.alcanza ? 'Canjear' : 'Te falta'}
            </Text>
          </Pressable>
        </View>
      ))}

      {/* canjes activos */}
      {data.canjes?.length > 0 && (
        <>
          <Text style={est.seccion}>Mis canjes</Text>
          {data.canjes.map((c: any, i: number) => (
            <View key={i} style={[est.fila, sombra(0)]}>
              <View style={{ flex: 1 }}>
                <Text style={est.filaConcepto}>{c.recompensa}</Text>
                <Text style={est.filaFecha}>Código {c.codigo} · {c.estado}</Text>
              </View>
              <Ionicons name={c.estado === 'entregado' ? 'checkmark-circle' : 'time'} size={20} color={c.estado === 'entregado' ? C.verde : C.dorado} />
            </View>
          ))}
        </>
      )}

      {/* movimientos */}
      <Text style={est.seccion}>Movimientos</Text>
      {data.movimientos.length === 0 && <Text style={est.humo}>Todavía no tenés movimientos de puntos.</Text>}
      {data.movimientos.map((m: any, i: number) => {
        const suma = m.puntos > 0;
        return (
          <View key={i} style={[est.fila, sombra(0)]}>
            <View style={[est.filaIcono, { backgroundColor: suma ? '#E6F2EC' : '#FBE9E7' }]}>
              <Ionicons name={suma ? 'add' : 'remove'} size={16} color={suma ? C.verde : C.rojo} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={est.filaConcepto}>{m.concepto}</Text>
              <Text style={est.filaFecha}>{fecha(m.creado_en)}</Text>
            </View>
            <Text style={[est.filaMonto, { color: suma ? C.verde : C.rojo }]}>{suma ? '+' : ''}{m.puntos}</Text>
          </View>
        );
      })}
    </ScrollView>
  );
}

const est = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: C.crema },
  centro: { flex: 1, backgroundColor: C.crema, alignItems: 'center', justifyContent: 'center' },
  humo: { color: C.humo, fontSize: 13 },
  hero: { borderRadius: 22, padding: 22, borderWidth: 1, borderColor: C.dorado },
  heroTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  heroLabel: { color: C.dorado, fontSize: 11, fontWeight: '700', letterSpacing: 2 },
  nivelChip: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: C.dorado, borderRadius: 12, paddingHorizontal: 9, paddingVertical: 4 },
  nivelChipTxt: { color: C.negro, fontSize: 12, fontWeight: '800' },
  heroPuntos: { color: '#fff', fontSize: 48, fontWeight: '800', marginTop: 8, letterSpacing: -1.5 },
  heroGana: { color: 'rgba(255,255,255,0.7)', fontSize: 13, marginTop: 2 },
  progWrap: { marginTop: 18 },
  progFondo: { height: 7, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.2)', overflow: 'hidden' },
  progLleno: { height: 7, borderRadius: 4, backgroundColor: C.dorado },
  progTxt: { color: 'rgba(255,255,255,0.75)', fontSize: 11.5, marginTop: 7 },
  codigoCard: { backgroundColor: '#fff', borderRadius: 18, padding: 20, alignItems: 'center', marginTop: 14 },
  codigoTitulo: { fontSize: 16, fontWeight: '800', color: C.tinta, marginTop: 6 },
  codigoSub: { fontSize: 13, color: C.humo, marginTop: 2, textAlign: 'center' },
  codigoBox: { backgroundColor: C.crema, borderRadius: 12, paddingHorizontal: 22, paddingVertical: 12, marginTop: 12, borderWidth: 1, borderColor: C.dorado, borderStyle: 'dashed' },
  codigoTxt: { fontSize: 24, fontWeight: '800', color: C.tinta, letterSpacing: 3 },
  codigoNota: { fontSize: 12, color: C.humo, marginTop: 10 },
  error: { color: C.vino, fontSize: 13, textAlign: 'center', marginTop: 12 },
  seccion: { fontSize: 15, fontWeight: '800', color: C.tinta, marginTop: 24, marginBottom: 10 },
  rec: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderRadius: 16, padding: 14, marginBottom: 9 },
  recEmoji: { fontSize: 26 },
  recNombre: { fontSize: 14, fontWeight: '700', color: C.tinta },
  recPuntos: { fontSize: 12.5, color: C.humo, marginTop: 2 },
  recBtn: { backgroundColor: C.rojo, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 9 },
  recBtnOff: { backgroundColor: C.cremaProf },
  recBtnTxt: { color: '#fff', fontSize: 13, fontWeight: '800' },
  fila: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 14, padding: 13, marginBottom: 9, gap: 12 },
  filaIcono: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  filaConcepto: { fontSize: 13.5, color: C.tinta, fontWeight: '600' },
  filaFecha: { fontSize: 11.5, color: C.humo, marginTop: 3 },
  filaMonto: { fontSize: 16, fontWeight: '800' },
});
