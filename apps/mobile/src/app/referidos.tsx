import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { useEstado } from '../lib/estado';
import { apiGet } from '../lib/api';
import { C, LinearGradient, Ionicons, sombra, toque } from '../lib/ui';

const COMO = [
  { icono: 'share-social', txt: 'Compartí tu código con un amigo' },
  { icono: 'person-add', txt: 'Se registra en la app con tu código' },
  { icono: 'bag-check', txt: 'Cuando hace su 1ª compra, ¡ganan los dos!' },
];

export default function Referidos() {
  const { cliente } = useEstado();
  const [data, setData] = useState<any>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    if (!cliente?.token) return;
    apiGet('/mi/referidos')
      .then(setData)
      .catch(() => {})
      .finally(() => setCargando(false));
  }, [cliente?.token]);

  async function compartir() {
    if (!data?.codigo) return;
    toque();
    try {
      await Share.share({
        message: `¡Sumate a O.D.B Premium Market! Usá mi código ${data.codigo} al registrarte en la app y ganamos puntos los dos 🍷`,
      });
    } catch {}
  }

  if (cargando) return <View style={est.centro}><ActivityIndicator color={C.rojo} /></View>;
  if (!data) return <View style={est.centro}><Text style={est.humo}>No pudimos cargar tus referidos.</Text></View>;

  return (
    <ScrollView style={est.pantalla} contentContainerStyle={{ padding: 16 }}>
      {/* código + compartir */}
      <LinearGradient colors={[C.negro, C.vino]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[est.hero, sombra(2)]}>
        <Ionicons name="gift" size={26} color={C.dorado} />
        <Text style={est.heroTitulo}>Invitá y ganá {data.recompensaReferrer} puntos</Text>
        <Text style={est.heroSub}>Tu amigo arranca con {data.recompensaReferido} puntos de bienvenida</Text>
        <View style={est.codigoBox}><Text style={est.codigoTxt}>{data.codigo}</Text></View>
        <Pressable onPress={compartir} style={est.compartir}>
          <Ionicons name="share-social" size={17} color={C.negro} />
          <Text style={est.compartirTxt}>Compartir mi código</Text>
        </Pressable>
      </LinearGradient>

      {/* stats */}
      <View style={est.stats}>
        <View style={[est.stat, sombra(0)]}><Text style={est.statNum}>{data.invitados}</Text><Text style={est.statLbl}>Invitados</Text></View>
        <View style={[est.stat, sombra(0)]}><Text style={est.statNum}>{data.acreditados}</Text><Text style={est.statLbl}>Compraron</Text></View>
        <View style={[est.stat, sombra(0)]}><Text style={[est.statNum, { color: C.verde }]}>{data.puntosGanados}</Text><Text style={est.statLbl}>Puntos</Text></View>
      </View>

      {/* cómo funciona */}
      <Text style={est.seccion}>Cómo funciona</Text>
      {COMO.map((c, i) => (
        <View key={i} style={est.paso}>
          <View style={est.pasoNum}><Text style={est.pasoNumTxt}>{i + 1}</Text></View>
          <Ionicons name={c.icono as any} size={18} color={C.rojo} />
          <Text style={est.pasoTxt}>{c.txt}</Text>
        </View>
      ))}

      {/* lista de invitados */}
      {data.lista?.length > 0 && (
        <>
          <Text style={est.seccion}>Tus invitados</Text>
          {data.lista.map((r: any, i: number) => (
            <View key={i} style={[est.fila, sombra(0)]}>
              <View style={[est.filaIcono, { backgroundColor: r.estado === 'acreditado' ? '#E6F2EC' : C.cremaProf }]}>
                <Ionicons name={r.estado === 'acreditado' ? 'checkmark' : 'time-outline'} size={16} color={r.estado === 'acreditado' ? C.verde : C.humo} />
              </View>
              <Text style={est.filaNombre}>{r.nombre}</Text>
              <Text style={[est.filaEstado, r.estado === 'acreditado' && { color: C.verde }]}>
                {r.estado === 'acreditado' ? `+${data.recompensaReferrer}` : 'esperando 1ª compra'}
              </Text>
            </View>
          ))}
        </>
      )}
    </ScrollView>
  );
}

const est = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: C.crema },
  centro: { flex: 1, backgroundColor: C.crema, alignItems: 'center', justifyContent: 'center' },
  humo: { color: C.humo, fontSize: 13 },
  hero: { borderRadius: 22, padding: 22, alignItems: 'center', borderWidth: 1, borderColor: C.dorado },
  heroTitulo: { color: '#fff', fontSize: 19, fontWeight: '800', marginTop: 8, textAlign: 'center' },
  heroSub: { color: 'rgba(255,255,255,0.7)', fontSize: 13, marginTop: 4, textAlign: 'center' },
  codigoBox: { backgroundColor: 'rgba(201,169,110,0.15)', borderRadius: 14, paddingHorizontal: 26, paddingVertical: 14, marginTop: 16, borderWidth: 1, borderColor: C.dorado, borderStyle: 'dashed' },
  codigoTxt: { fontSize: 28, fontWeight: '800', color: C.dorado, letterSpacing: 4 },
  compartir: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: C.dorado, borderRadius: 24, paddingVertical: 13, paddingHorizontal: 28, marginTop: 16 },
  compartirTxt: { color: C.negro, fontSize: 14.5, fontWeight: '800' },
  stats: { flexDirection: 'row', gap: 10, marginTop: 14 },
  stat: { flex: 1, backgroundColor: '#fff', borderRadius: 16, paddingVertical: 16, alignItems: 'center' },
  statNum: { fontSize: 24, fontWeight: '800', color: C.tinta },
  statLbl: { fontSize: 11.5, color: C.humo, marginTop: 3 },
  seccion: { fontSize: 15, fontWeight: '800', color: C.tinta, marginTop: 24, marginBottom: 12 },
  paso: { flexDirection: 'row', alignItems: 'center', gap: 11, marginBottom: 13 },
  pasoNum: { width: 24, height: 24, borderRadius: 12, backgroundColor: C.negro, alignItems: 'center', justifyContent: 'center' },
  pasoNumTxt: { color: '#fff', fontSize: 12, fontWeight: '800' },
  pasoTxt: { flex: 1, fontSize: 13.5, color: C.tinta, lineHeight: 19 },
  fila: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderRadius: 14, padding: 13, marginBottom: 9 },
  filaIcono: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  filaNombre: { flex: 1, fontSize: 14, fontWeight: '600', color: C.tinta },
  filaEstado: { fontSize: 12, color: C.humo, fontWeight: '700' },
});
