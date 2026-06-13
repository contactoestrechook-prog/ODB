import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { COLORES, pesos, useEstado } from '../../lib/estado';

const fecha = (iso: string) =>
  new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

export default function Cuenta() {
  const { cliente, cuenta, notif, refrescarCuenta, marcarLeidas } = useEstado();
  const [tab, setTab] = useState<'cuenta' | 'notif'>('cuenta');

  // al entrar, refresca y (si está en notificaciones) marca leídas
  useEffect(() => {
    refrescarCuenta();
  }, []);
  useEffect(() => {
    if (tab === 'notif' && notif.noLeidas > 0) marcarLeidas();
  }, [tab, notif.noLeidas]);

  if (!cliente?.token) {
    return (
      <View style={est.centro}>
        <Text style={est.vacioTitulo}>Iniciá sesión</Text>
        <Text style={est.vacioTexto}>Entrá con tu cuenta para ver tu cuenta corriente y novedades.</Text>
      </View>
    );
  }

  return (
    <View style={est.pantalla}>
      {/* pestañas */}
      <View style={est.pestanas}>
        {(['cuenta', 'notif'] as const).map((t) => (
          <Pressable key={t} onPress={() => setTab(t)} style={[est.pestana, tab === t && est.pestanaActiva]}>
            <Text style={[est.pestanaTexto, tab === t && { color: COLORES.blanco }]}>
              {t === 'cuenta' ? 'Mi cuenta' : 'Novedades'}
              {t === 'notif' && notif.noLeidas > 0 ? `  ${notif.noLeidas}` : ''}
            </Text>
          </Pressable>
        ))}
      </View>

      {tab === 'cuenta' ? (
        <ScrollView contentContainerStyle={{ padding: 16 }}>
          {!cuenta?.habilitada ? (
            <View style={est.tarjetaInfo}>
              <Text style={est.infoTitulo}>Cuenta corriente no habilitada</Text>
              <Text style={est.infoTexto}>
                Si querés comprar a cuenta en O.D.B, pedilo en el local. Cuando te la habiliten,
                vas a ver tu saldo y movimientos acá.
              </Text>
            </View>
          ) : (
            <>
              {/* tarjeta de saldo */}
              <View style={est.tarjetaSaldo}>
                <Text style={est.saldoLabel}>Tu saldo</Text>
                <Text style={est.saldoMonto}>{pesos(cuenta.saldo)}</Text>
                {cuenta.saldo > 0 ? (
                  <Text style={est.saldoSub}>es lo que debés a O.D.B</Text>
                ) : (
                  <Text style={est.saldoSub}>estás al día ✓</Text>
                )}
                {cuenta.limite > 0 && (
                  <View style={est.barraWrap}>
                    <View style={est.barraFondo}>
                      <View
                        style={[
                          est.barraLlena,
                          { width: `${Math.min((cuenta.saldo / cuenta.limite) * 100, 100)}%` },
                        ]}
                      />
                    </View>
                    <Text style={est.limiteTexto}>
                      Disponible {pesos(cuenta.disponible)} de {pesos(cuenta.limite)}
                    </Text>
                  </View>
                )}
              </View>

              <Text style={est.seccion}>Movimientos</Text>
              {cuenta.movimientos.length === 0 && (
                <Text style={est.infoTexto}>Todavía no tenés movimientos.</Text>
              )}
              {cuenta.movimientos.map((m, i) => {
                const esCargo = Number(m.debe) > 0;
                return (
                  <View key={i} style={est.fila}>
                    <View style={{ flex: 1 }}>
                      <Text style={est.filaConcepto}>{m.concepto}</Text>
                      <Text style={est.filaFecha}>{fecha(m.creado_en)}</Text>
                    </View>
                    <Text style={[est.filaMonto, { color: esCargo ? COLORES.rojo : '#2F5233' }]}>
                      {esCargo ? '+' : '−'}{pesos(esCargo ? m.debe : m.haber)}
                    </Text>
                  </View>
                );
              })}
            </>
          )}
        </ScrollView>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16 }}>
          {notif.lista.length === 0 && (
            <Text style={est.infoTexto}>No tenés novedades por ahora.</Text>
          )}
          {notif.lista.map((n) => (
            <View key={n.id} style={[est.notif, !n.leida && est.notifNueva]}>
              <Text style={est.notifTitulo}>{n.titulo}</Text>
              <Text style={est.notifCuerpo}>{n.cuerpo}</Text>
              <Text style={est.filaFecha}>{fecha(n.creado_en)}</Text>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const est = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: COLORES.crema },
  centro: { flex: 1, backgroundColor: COLORES.crema, alignItems: 'center', justifyContent: 'center', padding: 32 },
  vacioTitulo: { fontSize: 18, fontWeight: '700', color: COLORES.negro, marginBottom: 8 },
  vacioTexto: { fontSize: 13, color: '#777', textAlign: 'center', lineHeight: 19 },
  pestanas: { flexDirection: 'row', backgroundColor: COLORES.blanco, padding: 6, gap: 6 },
  pestana: { flex: 1, paddingVertical: 10, borderRadius: 18, alignItems: 'center', backgroundColor: COLORES.crema },
  pestanaActiva: { backgroundColor: COLORES.negro },
  pestanaTexto: { fontSize: 13, fontWeight: '600', color: COLORES.negro },
  tarjetaSaldo: { backgroundColor: COLORES.negro, borderRadius: 18, padding: 20, marginBottom: 8 },
  saldoLabel: { color: '#bbb', fontSize: 12 },
  saldoMonto: { color: COLORES.blanco, fontSize: 34, fontWeight: '700', marginTop: 2 },
  saldoSub: { color: '#bbb', fontSize: 12, marginTop: 2 },
  barraWrap: { marginTop: 16 },
  barraFondo: { height: 6, borderRadius: 3, backgroundColor: '#333', overflow: 'hidden' },
  barraLlena: { height: 6, borderRadius: 3, backgroundColor: COLORES.rojo },
  limiteTexto: { color: '#bbb', fontSize: 11, marginTop: 6 },
  tarjetaInfo: { backgroundColor: COLORES.blanco, borderRadius: 16, padding: 18 },
  infoTitulo: { fontSize: 15, fontWeight: '700', color: COLORES.negro, marginBottom: 6 },
  infoTexto: { fontSize: 13, color: '#777', lineHeight: 19 },
  seccion: { fontSize: 14, fontWeight: '700', color: COLORES.negro, marginTop: 18, marginBottom: 8 },
  fila: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: COLORES.blanco,
    borderRadius: 12, padding: 14, marginBottom: 8,
  },
  filaConcepto: { fontSize: 13, color: COLORES.negro, fontWeight: '500' },
  filaFecha: { fontSize: 11, color: '#999', marginTop: 3 },
  filaMonto: { fontSize: 15, fontWeight: '700' },
  notif: { backgroundColor: COLORES.blanco, borderRadius: 12, padding: 14, marginBottom: 8 },
  notifNueva: { borderLeftWidth: 3, borderLeftColor: COLORES.rojo },
  notifTitulo: { fontSize: 14, fontWeight: '700', color: COLORES.negro },
  notifCuerpo: { fontSize: 13, color: '#555', marginTop: 3, lineHeight: 18 },
});
