import { useRef, useState } from 'react';
import {
  FlatList, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { API, useEstado } from '../../lib/estado';
import { C, LinearGradient, Ionicons, sombra, toque } from '../../lib/ui';
import SomelierLottie from '../../lib/SomelierLottie';
import SomelierAvatar from '../../lib/SomelierAvatar';

type Mensaje = { rol: 'usuario' | 'somelier'; texto: string };

const SUGERENCIAS = [
  '¿Qué vino para un asado?',
  'Algo rico por menos de $15.000',
  '¿Qué tomo con sushi?',
  'Un espumante para regalar',
];

export default function Somelier() {
  const { cliente } = useEstado();
  const [mensajes, setMensajes] = useState<Mensaje[]>([
    {
      rol: 'somelier',
      texto: '¡Hola! Soy el Somelier ODB 🍷 Conozco cada botella de nuestra cava. ¿Para qué ocasión buscás vino?',
    },
  ]);
  const [texto, setTexto] = useState('');
  const [pensando, setPensando] = useState(false);
  const lista = useRef<FlatList>(null);

  async function enviar(t: string) {
    const limpio = t.trim();
    if (!limpio || pensando) return;
    toque();
    const nuevos: Mensaje[] = [...mensajes, { rol: 'usuario', texto: limpio }];
    setMensajes(nuevos);
    setTexto('');
    setPensando(true);
    try {
      const res = await fetch(`${API}/sommelier/charla`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(cliente?.token ? { Authorization: `Bearer ${cliente.token}` } : {}),
        },
        body: JSON.stringify({ mensajes: nuevos }),
      });
      const datos = await res.json();
      setMensajes((m) => [
        ...m,
        { rol: 'somelier', texto: res.ok ? datos.respuesta : `(${datos.message ?? 'Probá de nuevo'})` },
      ]);
    } catch {
      setMensajes((m) => [...m, { rol: 'somelier', texto: '(Sin conexión)' }]);
    }
    setPensando(false);
    setTimeout(() => lista.current?.scrollToEnd({ animated: true }), 100);
  }

  const soloSaludo = mensajes.length <= 1 && !pensando;

  return (
    <KeyboardAvoidingView style={est.pantalla} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {soloSaludo ? (
        <ScrollView contentContainerStyle={est.heroWrap}>
          <SomelierAvatar size={210}><SomelierLottie size={172} /></SomelierAvatar>
          <Text style={est.heroTitulo}>Somelier ODB</Text>
          <Text style={est.heroSub}>Conozco cada botella de nuestra cava.{'\n'}Decime la ocasión y te recomiendo.</Text>
        </ScrollView>
      ) : (
      <FlatList
        ref={lista}
        data={pensando ? [...mensajes, { rol: 'somelier' as const, texto: '…' }] : mensajes}
        keyExtractor={(_, i) => String(i)}
        contentContainerStyle={{ padding: 14, paddingBottom: 8 }}
        renderItem={({ item, index }) => {
          const esUsuario = item.rol === 'usuario';
          const escribiendo = pensando && index === mensajes.length;
          if (esUsuario) {
            return (
              <View style={est.filaUsuario}>
                <LinearGradient colors={[C.rojo, C.rojoOscuro]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[est.burbuja, est.burbujaUsuario]}>
                  <Text style={est.textoUsuario}>{item.texto}</Text>
                </LinearGradient>
              </View>
            );
          }
          return (
            <View style={est.filaSomelier}>
              <View style={est.avatar}><Ionicons name="wine" size={16} color="#fff" /></View>
              <View style={[est.burbuja, est.burbujaSomelier, sombra(0)]}>
                {escribiendo ? (
                  <Text style={est.escribiendo}>eligiendo de la cava…</Text>
                ) : (
                  <Text style={est.textoSomelier}>{item.texto}</Text>
                )}
              </View>
            </View>
          );
        }}
      />
      )}
      {soloSaludo && (
        <View style={est.chips}>
          {SUGERENCIAS.map((s) => (
            <Pressable key={s} onPress={() => enviar(s)} style={est.chip}>
              <Text style={est.chipTexto}>{s}</Text>
            </Pressable>
          ))}
        </View>
      )}
      <View style={[est.barra, sombra(1)]}>
        <TextInput
          value={texto}
          onChangeText={setTexto}
          placeholder="Preguntale al somelier…"
          placeholderTextColor={C.humo}
          style={est.input}
          onSubmitEditing={() => enviar(texto)}
          returnKeyType="send"
        />
        <Pressable onPress={() => enviar(texto)} style={est.botonEnviar} disabled={pensando}>
          <Ionicons name="arrow-up" size={20} color="#fff" />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const est = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: C.crema },
  heroWrap: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 24, paddingTop: 40 },
  heroTitulo: { fontSize: 22, fontWeight: '800', color: C.vino, marginTop: 6, letterSpacing: 0.3 },
  heroSub: { fontSize: 14, color: C.humo, textAlign: 'center', lineHeight: 21, marginTop: 8 },
  filaUsuario: { alignItems: 'flex-end', marginBottom: 10 },
  filaSomelier: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginBottom: 10, maxWidth: '88%' },
  avatar: { width: 30, height: 30, borderRadius: 15, backgroundColor: C.vino, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  burbuja: { borderRadius: 18, paddingVertical: 11, paddingHorizontal: 14 },
  burbujaUsuario: { maxWidth: '82%', borderBottomRightRadius: 5 },
  burbujaSomelier: { backgroundColor: '#fff', borderBottomLeftRadius: 5, flex: 1 },
  textoUsuario: { color: '#fff', fontSize: 14, lineHeight: 20 },
  textoSomelier: { color: C.tinta, fontSize: 14, lineHeight: 20 },
  escribiendo: { color: C.humo, fontSize: 14, fontStyle: 'italic' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 14, paddingBottom: 8 },
  chip: { backgroundColor: '#fff', borderWidth: 1, borderColor: C.linea, borderRadius: 18, paddingHorizontal: 13, paddingVertical: 8, ...sombra(0) },
  chipTexto: { color: C.vino, fontSize: 12.5, fontWeight: '600' },
  barra: { flexDirection: 'row', padding: 10, gap: 8, backgroundColor: '#fff', alignItems: 'center' },
  input: { flex: 1, backgroundColor: C.crema, borderRadius: 22, paddingHorizontal: 16, paddingVertical: 11, fontSize: 14.5, color: C.tinta },
  botonEnviar: { backgroundColor: C.rojo, borderRadius: 22, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
