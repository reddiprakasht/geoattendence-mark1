export function hasConfiguredGeofence(geofence) {
  if (isValidGeofencePolygon(geofence?.polygon)) {
    return geofence.configured === true;
  }

  return (
    geofence &&
    Number.isFinite(geofence.lat) &&
    geofence.lat >= -90 &&
    geofence.lat <= 90 &&
    Number.isFinite(geofence.lng) &&
    geofence.lng >= -180 &&
    geofence.lng <= 180 &&
    Number.isFinite(geofence.radius) &&
    geofence.radius > 0 &&
    (geofence.configured === true || geofence.lat !== 0 || geofence.lng !== 0)
  );
}

export function isValidGeofencePolygon(polygon) {
  if (!Array.isArray(polygon) || polygon.length < 3) return false;

  const points = polygon.map((point) => ({ lat: point?.lat, lng: point?.lng }));
  if (
    points.some(
      ({ lat, lng }) =>
        !Number.isFinite(lat) ||
        lat < -90 ||
        lat > 90 ||
        !Number.isFinite(lng) ||
        lng < -180 ||
        lng > 180,
    )
  ) {
    return false;
  }

  const uniquePoints = new Set(points.map(({ lat, lng }) => `${lat},${lng}`));
  if (uniquePoints.size < 3) return false;

  const doubledArea = points.reduce((area, point, index) => {
    const nextPoint = points[(index + 1) % points.length];
    return area + point.lng * nextPoint.lat - nextPoint.lng * point.lat;
  }, 0);
  return Math.abs(doubledArea) > Number.EPSILON;
}

export function isPointInGeofence(latitude, longitude, geofence) {
  if (isValidGeofencePolygon(geofence?.polygon)) {
    return isPointInPolygon(latitude, longitude, geofence.polygon);
  }

  return (
    hasConfiguredGeofence(geofence) &&
    getDistanceFromLatLonInMeters(latitude, longitude, geofence.lat, geofence.lng) <=
      geofence.radius
  );
}

function isPointInPolygon(latitude, longitude, polygon) {
  const point = { lat: latitude, lng: longitude };
  let inside = false;

  for (
    let index = 0, previousIndex = polygon.length - 1;
    index < polygon.length;
    previousIndex = index++
  ) {
    const current = polygon[index];
    const previous = polygon[previousIndex];

    if (isPointOnSegment(point, previous, current)) return true;

    const crossesLatitude = (current.lat > latitude) !== (previous.lat > latitude);
    if (
      crossesLatitude &&
      longitude <
        ((previous.lng - current.lng) * (latitude - current.lat)) /
          (previous.lat - current.lat) +
          current.lng
    ) {
      inside = !inside;
    }
  }

  return inside;
}

function isPointOnSegment(point, start, end) {
  const cross =
    (point.lat - start.lat) * (end.lng - start.lng) -
    (point.lng - start.lng) * (end.lat - start.lat);
  if (Math.abs(cross) > 1e-10) return false;

  return (
    point.lat >= Math.min(start.lat, end.lat) - 1e-10 &&
    point.lat <= Math.max(start.lat, end.lat) + 1e-10 &&
    point.lng >= Math.min(start.lng, end.lng) - 1e-10 &&
    point.lng <= Math.max(start.lng, end.lng) + 1e-10
  );
}

export function getDistanceFromLatLonInMeters(lat1, lon1, lat2, lon2) {
  const earthRadius = 6371000;
  const latitudeDelta = toRadians(lat2 - lat1);
  const longitudeDelta = toRadians(lon2 - lon1);
  const value =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(longitudeDelta / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function toRadians(degrees) {
  return degrees * (Math.PI / 180);
}
