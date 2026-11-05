import { useEffect, useMemo } from 'react';
import {
  Circle,
  CircleMarker,
  MapContainer,
  Polygon,
  Polyline,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

const defaultCenter = [20, 0];

export default function GeofenceMap({
  latitude,
  longitude,
  radius,
  polygon,
  onPointAdd,
}) {
  const hasSelection =
    Number.isFinite(Number(latitude)) &&
    latitude !== '' &&
    latitude !== null &&
    Number.isFinite(Number(longitude)) &&
    longitude !== '' &&
    longitude !== null;
  const position = useMemo(
    () => (hasSelection ? [Number(latitude), Number(longitude)] : null),
    [hasSelection, latitude, longitude],
  );
  const initialCenter = position || defaultCenter;
  const initialZoom = position ? 16 : 2;
  const numericRadius = Number(radius);

  return (
    <div className="geofence-map-wrap">
      <MapContainer
        center={initialCenter}
        zoom={initialZoom}
        scrollWheelZoom
        className="geofence-map"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <MapClickHandler onPointAdd={onPointAdd} />
        {position && <MapCenter position={position} />}
        {position && (!polygon || polygon.length === 0) && (
          <>
            <Circle
              center={position}
              radius={Number.isFinite(numericRadius) && numericRadius > 0 ? numericRadius : 1}
              pathOptions={{ color: '#4f46e5', fillColor: '#4f46e5', fillOpacity: 0.18 }}
            />
            <CircleMarker
              center={position}
              radius={7}
              pathOptions={{ color: '#fff', weight: 2, fillColor: '#4f46e5', fillOpacity: 1 }}
            />
          </>
        )}
        {polygon?.length === 2 && (
          <Polyline
            positions={polygon.map(({ lat, lng }) => [lat, lng])}
            pathOptions={{ color: '#4f46e5', weight: 3, dashArray: '7 7' }}
          />
        )}
        {polygon?.length >= 3 && (
          <Polygon
            positions={polygon.map(({ lat, lng }) => [lat, lng])}
            pathOptions={{ color: '#4f46e5', fillColor: '#4f46e5', fillOpacity: 0.2 }}
          />
        )}
        {polygon?.map(({ lat, lng }, index) => (
          <CircleMarker
            key={`${lat},${lng},${index}`}
            center={[lat, lng]}
            radius={7}
            pathOptions={{ color: '#fff', weight: 2, fillColor: '#4f46e5', fillOpacity: 1 }}
          >
            <Tooltip permanent direction="top">
              {index + 1}
            </Tooltip>
          </CircleMarker>
        ))}
      </MapContainer>
      <p className="map-hint">
        Click around the factory perimeter to add boundary points. Add at least 3 points to enclose
        the area.
      </p>
    </div>
  );
}

function MapClickHandler({ onPointAdd }) {
  useMapEvents({
    click(event) {
      onPointAdd({ lat: event.latlng.lat, lng: event.latlng.lng });
    },
  });
  return null;
}

function MapCenter({ position }) {
  const map = useMap();

  useEffect(() => {
    map.panTo(position);
  }, [map, position]);

  return null;
}
