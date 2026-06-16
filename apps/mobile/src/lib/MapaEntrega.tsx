import MapView, { Marker } from 'react-native-maps';

type Punto = { lat?: number | null; lng?: number | null } | null | undefined;

// Mapa de entrega (solo nativo). En el build del celular muestra el repartidor
// y el destino. En Android requiere la API key de Google Maps en app.json.
export default function MapaEntrega({ repartidor, destino, height = 200 }: { repartidor?: Punto; destino?: Punto; height?: number }) {
  const tieneDest = destino?.lat != null && destino?.lng != null;
  const tieneRep = repartidor?.lat != null && repartidor?.lng != null;
  if (!tieneDest && !tieneRep) return null;

  const lat = tieneRep && tieneDest ? (Number(repartidor!.lat) + Number(destino!.lat)) / 2 : Number((tieneDest ? destino : repartidor)!.lat);
  const lng = tieneRep && tieneDest ? (Number(repartidor!.lng) + Number(destino!.lng)) / 2 : Number((tieneDest ? destino : repartidor)!.lng);

  return (
    <MapView
      style={{ width: '100%', height, borderRadius: 16, marginBottom: 12 }}
      initialRegion={{ latitude: lat, longitude: lng, latitudeDelta: 0.03, longitudeDelta: 0.03 }}
      pointerEvents="none"
    >
      {tieneDest ? <Marker coordinate={{ latitude: Number(destino!.lat), longitude: Number(destino!.lng) }} title="Tu domicilio" /> : null}
      {tieneRep ? <Marker coordinate={{ latitude: Number(repartidor!.lat), longitude: Number(repartidor!.lng) }} title="Repartidor" pinColor="#B82D25" /> : null}
    </MapView>
  );
}
