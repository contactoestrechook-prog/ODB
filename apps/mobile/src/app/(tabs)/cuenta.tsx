import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { pesos, useEstado } from '../../lib/estado';
import { apiPost } from '../../lib/api';
import { abrirVerificacion } from '../../lib/navegador';
import { C, LinearGradient, Ionicons, sombra, toque } from '../../lib/ui';
import MisSolicitudes from '../../lib/MisSolicitudes';

const fecha = (iso: string) =>
  new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

const BENEFICIOS: { icono: any; texto: string }[] = [
  { icono: 'pricetags', texto: 'Precios exclusivos de socio' },
  { icono: 'scan', texto: 'Comprá Fácil · pagá y salí sin caja' },
  { icono: 'bicycle', texto: 'Prioridad en envíos a domicilio' },
  { icono: 'star', texto: 'Puntos en cada compra' },
];

export default function Cuenta() {
  const router = useRouter();
  const { cliente, cuenta, notif, refrescarCuenta, marcarLeidas, cerrarSesion } = useEstado();
  const [tab, setTab] = useState<'cuenta' | 'mensajes' | 'notif'>('cuenta');
  const [aviso, setAviso] = useState<string | null>(null);
  const [verificando, setVerificando] = useState(false);

  useEffect(() => { refrescarCuenta(); }, []);
  useEffect(() => {
    if (tab === 'notif' && notif.noLeidas > 0) marcarLeidas();
  }, [tab, notif.noLeidas]);

  async function verificar() {
    if (!cliente?.token || verificando) return;
    toque();
    setVerificando(true);
    setAviso(null);
    try {
      const datos = await apiPost('/app/verificacion');
      if (datos?.url) {
        await abrirVerificacion(datos.url); // navegador in-app, no pierde la app
        setAviso('Completá la verificación en la pantalla que se abrió.');
      } else setAviso('No se pudo iniciar la verificación');
    } catch (e) { setAviso(e instanceof Error ? e.message : 'No se pudo iniciar la verificación'); }
    setVerificando(false);
  }

  if (!cliente?.token) {
    return (
      <View style={est.centro}>
        <View style={est.vacioIcono}><Ionicons name="person-outline" size={38} color={C.humo} /></View>
        <Text style={est.vacioTitulo}>Iniciá sesión</Text>
        <Text style={est.vacioTexto}>Entrá con tu cuenta para ver tu membresía, cuenta corriente y novedades.</Text>
        <Pressable onPress={() => { toque(); router.push('/'); }} style={est.vacioBoton}>
          <Text style={est.vacioBotonTxt}>Ir a iniciar sesión</Text>
        </Pressable>
      </View>
    );
  }

  const inicial = (cliente.nombre ?? 'O')[0].toUpperCase();

  return (
    <View style={est.pantalla}>
      {/* perfil */}
      <View style={est.perfil}>
        <View style={est.avatar}><Text style={est.avatarTxt}>{inicial}</Text></View>
        <View style={{ flex: 1 }}>
          <View style={est.nombreRow}>
            <Text style={est.perfilNombre}>{cliente.nombre ?? 'Cliente O.D.B'}</Text>
            {cliente.verificado && <Ionicons name="checkmark-circle" size={18} color={C.dorado} />}
          </View>
          <Text style={est.perfilSub}>DNI {cliente.dni}</Text>
        </View>
        {cliente.tipo ? (
          <View style={est.segChip}><Text style={est.segChipTxt}>{cliente.tipo}</Text></View>
        ) : null}
      </View>

      {/* pestañas */}
      <View style={est.pestanas}>
        {(['cuenta', 'mensajes', 'notif'] as const).map((t) => (
          <Pressable key={t} onPress={() => { toque(); setTab(t); }} style={[est.pestana, tab === t && est.pestanaActiva]}>
            <Text style={[est.pestanaTexto, tab === t && { color: '#fff' }]}>
              {t === 'cuenta' ? 'Cuenta' : t === 'mensajes' ? 'Mensajes' : 'Novedades'}
            </Text>
            {t === 'notif' && notif.noLeidas > 0 && (
              <View style={est.pestanaBadge}><Text style={est.pestanaBadgeTxt}>{notif.noLeidas}</Text></View>
            )}
          </Pressable>
        ))}
      </View>

      {tab === 'cuenta' ? (
        <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 6 }}>
          {/* ---- Membresía Comunidad ODB ---- */}
          {cliente.verificado ? (
            <LinearGradient colors={[C.negro, C.vino]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[est.socio, sombra(2)]}>
              <View style={est.socioTop}>
                <Text style={est.socioMarca}>COMUNIDAD ODB</Text>
                <Ionicons name="ribbon" size={22} color={C.dorado} />
              </View>
              <View style={est.socioTildes}>
                <View style={est.tilde}><Ionicons name="checkmark-circle" size={16} color="#5bbf86" /><Text style={est.tildeTxt}>Identidad verificada</Text></View>
                <View style={est.tilde}><Ionicons name="checkmark-circle" size={16} color="#5bbf86" /><Text style={est.tildeTxt}>Miembro Comunidad ODB</Text></View>
              </View>
              <View style={est.socioBenes}>
                {BENEFICIOS.map((b) => (
                  <View key={b.texto} style={est.beneChip}><Ionicons name={b.icono} size={13} color={C.dorado} /><Text style={est.beneChipTxt}>{b.texto.split(' · ')[0]}</Text></View>
                ))}
              </View>
              <View style={est.socioPie}>
                <View>
                  <Text style={est.socioPieLabel}>Puntos</Text>
                  <Text style={est.socioPuntos}>{(cliente.puntos ?? 0).toLocaleString('es-AR')}</Text>
                </View>
                <Text style={est.socioNum}>SOCIO O.D.B</Text>
              </View>
            </LinearGradient>
          ) : (
            <View style={[est.incentivo, sombra(1)]}>
              <View style={est.incTop}>
                <View style={est.incLock}><Ionicons name="lock-closed" size={18} color={C.dorado} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={est.incTitulo}>Activá tu membresía</Text>
                  <Text style={est.incSub}>Comunidad ODB · gratis</Text>
                </View>
              </View>
              <Text style={est.incLead}>Verificá tu identidad (DNI + rostro) y desbloqueás:</Text>
              <View style={{ gap: 9, marginBottom: 16 }}>
                {BENEFICIOS.map((b) => (
                  <View key={b.texto} style={est.incBene}><Ionicons name={b.icono} size={17} color={C.dorado} /><Text style={est.incBeneTxt}>{b.texto}</Text></View>
                ))}
              </View>
              <Pressable onPress={verificar} disabled={verificando}>
                <LinearGradient colors={[C.dorado, '#b08f54']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={est.incBoton}>
                  <Text style={est.incBotonTxt}>{verificando ? 'Abriendo…' : 'Verificar ahora · 1 minuto'}</Text>
                  <Ionicons name="arrow-forward" size={16} color={C.negro} />
                </LinearGradient>
              </Pressable>
              <Text style={est.incSocial}>Ya somos +2.300 socios en O.D.B</Text>
            </View>
          )}
          {aviso && <Text style={est.aviso}>{aviso}</Text>}

          {/* ---- Accesos: compras, puntos, favoritos ---- */}
          <View style={[est.menu, sombra(0)]}>
            {([
              { icono: 'bag-handle', label: 'Mis compras', sub: 'Historial y volver a comprar', ruta: '/compras' },
              { icono: 'star', label: 'Mis puntos', sub: `${(cliente.puntos ?? 0).toLocaleString('es-AR')} puntos · canjeá recompensas`, ruta: '/puntos' },
              { icono: 'heart', label: 'Favoritos', sub: 'Tus productos guardados', ruta: '/favoritos' },
              { icono: 'gift', label: 'Invitá y ganá', sub: 'Sumá 500 puntos por amigo', ruta: '/referidos' },
            ] as const).map((m, i) => (
              <Pressable key={m.ruta} onPress={() => { toque(); router.push(m.ruta as any); }} style={[est.menuFila, i > 0 && est.menuSep]}>
                <View style={est.menuIcono}><Ionicons name={m.icono as any} size={18} color={C.rojo} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={est.menuLabel}>{m.label}</Text>
                  <Text style={est.menuSub}>{m.sub}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={C.humo} />
              </Pressable>
            ))}
          </View>

          {/* ---- Cuenta corriente ---- */}
          {!cuenta?.habilitada ? (
            <View style={[est.tarjetaInfo, sombra(0)]}>
              <View style={est.infoIcono}><Ionicons name="wallet-outline" size={22} color={C.rojo} /></View>
              <Text style={est.infoTitulo}>Cuenta corriente no habilitada</Text>
              <Text style={est.infoTexto}>
                Si querés comprar a cuenta en O.D.B, pedilo en el local. Cuando te la habiliten,
                vas a ver tu saldo y movimientos acá.
              </Text>
            </View>
          ) : (
            <>
              <LinearGradient colors={[C.tinta, C.negro]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[est.tarjetaSaldo, sombra(2)]}>
                <View style={est.saldoTop}>
                  <Text style={est.saldoLabel}>Tu saldo</Text>
                  <Ionicons name="wallet" size={18} color={C.dorado} />
                </View>
                <Text style={est.saldoMonto}>{pesos(cuenta.saldo)}</Text>
                <Text style={est.saldoSub}>{cuenta.saldo > 0 ? 'es lo que debés a O.D.B' : 'estás al día ✓'}</Text>
                {cuenta.limite > 0 && (
                  <View style={est.barraWrap}>
                    <View style={est.barraFondo}>
                      <View style={[est.barraLlena, { width: `${Math.min((cuenta.saldo / cuenta.limite) * 100, 100)}%` }]} />
                    </View>
                    <Text style={est.limiteTexto}>Disponible {pesos(cuenta.disponible)} de {pesos(cuenta.limite)}</Text>
                  </View>
                )}
              </LinearGradient>

              <Text style={est.seccion}>Movimientos</Text>
              {cuenta.movimientos.length === 0 && <Text style={est.infoTexto}>Todavía no tenés movimientos.</Text>}
              {cuenta.movimientos.map((m, i) => {
                const esCargo = Number(m.debe) > 0;
                return (
                  <View key={i} style={[est.fila, sombra(0)]}>
                    <View style={[est.filaIcono, { backgroundColor: esCargo ? '#FBE9E7' : '#E6F2EC' }]}>
                      <Ionicons name={esCargo ? 'arrow-up' : 'arrow-down'} size={16} color={esCargo ? C.rojo : C.verde} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={est.filaConcepto}>{m.concepto}</Text>
                      <Text style={est.filaFecha}>{fecha(m.creado_en)}</Text>
                    </View>
                    <Text style={[est.filaMonto, { color: esCargo ? C.rojo : C.verde }]}>
                      {esCargo ? '+' : '−'}{pesos(esCargo ? m.debe : m.haber)}
                    </Text>
                  </View>
                );
              })}
            </>
          )}

          <Pressable
            onPress={() => { toque(); cerrarSesion(); router.replace('/'); }}
            style={est.salir}
          >
            <Ionicons name="log-out-outline" size={18} color={C.rojo} />
            <Text style={est.salirTxt}>Cerrar sesión</Text>
          </Pressable>
        </ScrollView>
      ) : tab === 'mensajes' ? (
        <MisSolicitudes />
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 6 }}>
          {notif.lista.length === 0 && (
            <View style={est.vacioNotif}>
              <Ionicons name="notifications-off-outline" size={34} color={C.humo} />
              <Text style={est.infoTexto}>No tenés novedades por ahora.</Text>
            </View>
          )}
          {notif.lista.map((n) => (
            <View key={n.id} style={[est.notif, sombra(0), !n.leida && est.notifNueva]}>
              <View style={est.notifTop}>
                {!n.leida && <View style={est.dot} />}
                <Text style={est.notifTitulo}>{n.titulo}</Text>
              </View>
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
  pantalla: { flex: 1, backgroundColor: C.crema },
  centro: { flex: 1, backgroundColor: C.crema, alignItems: 'center', justifyContent: 'center', padding: 32 },
  vacioIcono: { width: 80, height: 80, borderRadius: 40, backgroundColor: C.cremaProf, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  vacioTitulo: { fontSize: 18, fontWeight: '800', color: C.tinta, marginBottom: 6 },
  vacioTexto: { fontSize: 13.5, color: C.humo, textAlign: 'center', lineHeight: 20 },
  vacioBoton: { marginTop: 20, backgroundColor: C.rojo, borderRadius: 24, paddingHorizontal: 26, paddingVertical: 12 },
  vacioBotonTxt: { color: '#fff', fontWeight: '700', fontSize: 14 },
  perfil: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 12 },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: C.rojo, alignItems: 'center', justifyContent: 'center' },
  avatarTxt: { color: '#fff', fontWeight: '800', fontSize: 20 },
  nombreRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  perfilNombre: { fontSize: 16.5, fontWeight: '800', color: C.tinta },
  perfilSub: { fontSize: 12.5, color: C.humo, marginTop: 1 },
  segChip: { backgroundColor: C.cremaProf, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 5 },
  segChipTxt: { fontSize: 11, fontWeight: '700', color: C.tinta, textTransform: 'capitalize' },
  pestanas: { flexDirection: 'row', paddingHorizontal: 16, gap: 8, marginBottom: 8 },
  pestana: { flex: 1, flexDirection: 'row', gap: 6, paddingVertical: 11, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff', ...sombra(0) },
  pestanaActiva: { backgroundColor: C.negro },
  pestanaTexto: { fontSize: 13.5, fontWeight: '700', color: C.tinta },
  pestanaBadge: { backgroundColor: C.rojo, borderRadius: 9, minWidth: 18, height: 18, paddingHorizontal: 5, alignItems: 'center', justifyContent: 'center' },
  pestanaBadgeTxt: { color: '#fff', fontSize: 10.5, fontWeight: '800' },

  // socio (verificado)
  socio: { borderRadius: 22, padding: 20, marginBottom: 14, borderWidth: 1, borderColor: C.dorado },
  socioTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  socioMarca: { color: C.dorado, fontSize: 11, fontWeight: '700', letterSpacing: 2 },
  socioTildes: { gap: 7, marginBottom: 14 },
  tilde: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tildeTxt: { color: '#EDE4D6', fontSize: 13, fontWeight: '600' },
  socioBenes: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 16 },
  beneChip: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(201,169,110,0.14)', borderRadius: 10, paddingHorizontal: 9, paddingVertical: 5 },
  beneChipTxt: { color: '#E7D9BF', fontSize: 11, fontWeight: '600' },
  socioPie: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', borderTopWidth: 1, borderTopColor: 'rgba(201,169,110,0.25)', paddingTop: 14 },
  socioPieLabel: { color: '#8a7d6e', fontSize: 11 },
  socioPuntos: { color: C.dorado, fontSize: 22, fontWeight: '800' },
  socioNum: { color: '#6f655a', fontSize: 11, letterSpacing: 1, fontWeight: '700' },

  // incentivo (no verificado)
  incentivo: { backgroundColor: C.tinta, borderRadius: 22, padding: 20, marginBottom: 14, borderWidth: 1.5, borderColor: C.dorado, borderStyle: 'dashed' },
  incTop: { flexDirection: 'row', alignItems: 'center', gap: 11, marginBottom: 14 },
  incLock: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(201,169,110,0.16)', alignItems: 'center', justifyContent: 'center' },
  incTitulo: { color: C.crema, fontSize: 16, fontWeight: '800' },
  incSub: { color: C.humo, fontSize: 12, marginTop: 1 },
  incLead: { color: '#cfc4b8', fontSize: 13, marginBottom: 12, lineHeight: 18 },
  incBene: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  incBeneTxt: { color: '#E7DDD0', fontSize: 13.5 },
  incBoton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 24, paddingVertical: 13 },
  incBotonTxt: { color: C.negro, fontSize: 14.5, fontWeight: '800' },
  incSocial: { color: '#8a7d6e', fontSize: 11, textAlign: 'center', marginTop: 10 },
  aviso: { color: C.vino, fontSize: 12.5, marginBottom: 12, textAlign: 'center' },

  // menú de accesos
  menu: { backgroundColor: '#fff', borderRadius: 18, paddingHorizontal: 14, marginBottom: 14 },
  menuFila: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 },
  menuSep: { borderTopWidth: 1, borderTopColor: C.linea },
  menuIcono: { width: 38, height: 38, borderRadius: 12, backgroundColor: '#FBE9E7', alignItems: 'center', justifyContent: 'center' },
  menuLabel: { fontSize: 14.5, fontWeight: '700', color: C.tinta },
  menuSub: { fontSize: 12, color: C.humo, marginTop: 2 },
  salir: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, marginTop: 6, marginBottom: 24, borderRadius: 14, borderWidth: 1, borderColor: C.linea, backgroundColor: '#fff' },
  salirTxt: { fontSize: 14.5, fontWeight: '800', color: C.rojo },

  // saldo / cta cte
  tarjetaSaldo: { borderRadius: 22, padding: 22, marginBottom: 8 },
  saldoTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  saldoLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 12.5, fontWeight: '600' },
  saldoMonto: { color: '#fff', fontSize: 38, fontWeight: '800', marginTop: 4, letterSpacing: -1 },
  saldoSub: { color: 'rgba(255,255,255,0.65)', fontSize: 12.5, marginTop: 2 },
  barraWrap: { marginTop: 18 },
  barraFondo: { height: 7, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.2)', overflow: 'hidden' },
  barraLlena: { height: 7, borderRadius: 4, backgroundColor: C.dorado },
  limiteTexto: { color: 'rgba(255,255,255,0.7)', fontSize: 11.5, marginTop: 7 },
  tarjetaInfo: { backgroundColor: '#fff', borderRadius: 18, padding: 20 },
  infoIcono: { width: 44, height: 44, borderRadius: 14, backgroundColor: '#FBE9E7', alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  infoTitulo: { fontSize: 15.5, fontWeight: '800', color: C.tinta, marginBottom: 6 },
  infoTexto: { fontSize: 13, color: C.humo, lineHeight: 19 },
  seccion: { fontSize: 15, fontWeight: '800', color: C.tinta, marginTop: 20, marginBottom: 10 },
  fila: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 14, padding: 13, marginBottom: 9, gap: 12 },
  filaIcono: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  filaConcepto: { fontSize: 13.5, color: C.tinta, fontWeight: '600' },
  filaFecha: { fontSize: 11.5, color: C.humo, marginTop: 3 },
  filaMonto: { fontSize: 15.5, fontWeight: '800' },
  vacioNotif: { alignItems: 'center', gap: 12, marginTop: 50 },
  notif: { backgroundColor: '#fff', borderRadius: 14, padding: 15, marginBottom: 9 },
  notifNueva: { borderLeftWidth: 3, borderLeftColor: C.rojo },
  notifTop: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.rojo },
  notifTitulo: { fontSize: 14.5, fontWeight: '800', color: C.tinta },
  notifCuerpo: { fontSize: 13, color: '#5f554d', marginTop: 4, lineHeight: 18 },
});
