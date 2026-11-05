export function parseGoogleMapsLocation(input) {
  const text = input.trim();
  if (!text) return null;

  const url = getUrl(text);
  if (url) {
    const placeCoordinates = url.pathname.match(
      /!3d(-?\d{1,2}(?:\.\d+)?)!4d(-?\d{1,3}(?:\.\d+)?)/,
    );
    if (placeCoordinates) {
      return validateCoordinates(placeCoordinates[1], placeCoordinates[2]);
    }

    const pathCoordinates = url.pathname.match(
      /@(-?\d{1,2}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)/,
    );
    if (pathCoordinates) {
      return validateCoordinates(pathCoordinates[1], pathCoordinates[2]);
    }

    for (const key of ['query', 'q', 'll', 'center', 'destination', 'daddr']) {
      const location = parseCoordinatePair(url.searchParams.get(key) || '');
      if (location) return location;
    }
  }

  return parseCoordinatePair(text);
}

function getUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null;
  } catch {
    return null;
  }
}

function parseCoordinatePair(value) {
  const match = value.match(
    /^\s*\(?\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*\)?\s*$/,
  );
  return match ? validateCoordinates(match[1], match[2]) : null;
}

function validateCoordinates(latitudeValue, longitudeValue) {
  const lat = Number(latitudeValue);
  const lng = Number(longitudeValue);
  if (
    !Number.isFinite(lat) ||
    lat < -90 ||
    lat > 90 ||
    !Number.isFinite(lng) ||
    lng < -180 ||
    lng > 180
  ) {
    return null;
  }
  return { lat, lng };
}
