import { useRef, useState } from 'react';
import {
  FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { API, COLORES } from '../../lib/estado';

type Mensaje = { rol: 'usuario' | 'somelier'; texto: string };

const SUGERENCIAS = [
  '¿Qué vino para un asado?',
  'Algo rico por menos de $15.000',
  '¿Qué tomo con sushi?',
];

export default function Somelier() {
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
    const nuevos: Mensaje[] = [...mensajes, { rol: 'usuario', texto: limpio }];
    setMensajes(nuevos);
    setTexto('');
    setPensando(true);
    try {
      const res = await fetch(`${API}/sommelier/charla`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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

  return (
    <KeyboardAvoidingView
      style={est.pantalla}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <FlatList
        ref={lista}
        data={pensando ? [...mensajes, { rol: 'somelier' as const, texto: 'eligiendo de la cava…' }] : mensajes}
        keyExtractor={(_, i) => String(i)}
        contentContainerStyle={{ padding: 14 }}
        renderItem={({ item }) => (
          <View style={[est.burbuja, item.rol === 'usuario' ? est.burbujaUsuario : est.burbujaSomelier]}>
            <Text style={item.rol === 'usuario' ? est.textoUsuario : est.textoSomelier}>{item.texto}</Text>
          </View>
        )}
      />
      {mensajes.length <= 1 && (
        <View style={est.chips}>
          {SUGERENCIAS.map((s) => (
            <Pressable key={s} onPress={() => enviar(s)} style={est.chip}>
              <Text style={est.chipTexto}>{s}</Text>
            </Pressable>
          ))}
        </View>
      )}
      <View style={est.barra}>
        <TextInput
          value={texto}
          onChangeText={setTexto}
          placeholder="Preguntale al somelier…"
          placeholderTextColor="#999"
          style={est.input}
          onSubmitEditing={() => enviar(texto)}
        />
        <Pressable onPress={() => enviar(texto)} style={est.botonEnviar}>
          <Text style={{ color: COLORES.blanco, fontWeight: '600' }}>➤</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const est = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: COLORES.crema },
  burbuja: { maxWidth: '82%', borderRadius: 16, padding: 12, marginBottom: 8 },
  burbujaUsuario: { alignSelf: 'flex-end', backgroundColor: COLORES.rojo, borderBottomRightRadius: 4 },
  burbujaSomelier: { alignSelf: 'flex-start', backgroundColor: COLORES.blanco, borderBottomLeftRadius: 4 },
  textoUsuario: { color: COLORES.blanco, fontSize: 14, lineHeight: 20 },
  textoSomelier: { color: COLORES.negro, fontSize: 14, lineHeight: 20 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 14, paddingBottom: 6 },
  chip: { borderWidth: 1, borderColor: COLORES.rojo, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 },
  chipTexto: { color: COLORES.rojo, fontSize: 12 },
  barra: { flexDirection: 'row', padding: 10, gap: 8, backgroundColor: COLORES.blanco },
  input: {
    flex: 1, backgroundColor: COLORES.crema, borderRadius: 22, paddingHorizontal: 16,
    paddingVertical: 10, fontSize: 14, color: COLORES.negro,
  },
  botonEnviar: {
    backgroundColor: COLORES.rojo, borderRadius: 22, width: 44, alignItems: 'center', justifyContent: 'center',
  },
});
