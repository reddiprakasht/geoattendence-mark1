const WORKERS_SHEET = 'Workers';
const ATTENDANCE_SHEET = 'Attendance';
const SESSION_TTL_SECONDS = 21600;
const PASSWORD_HASH_ITERATIONS = 10000;
const PLANTS = ['Plant 1', 'Plant 2'];

function doPost(event) {
  let payload = {};
  try {
    payload = JSON.parse(event.parameter.payload || '{}');
    const result = handleRequest_(payload);
    return responsePage_(payload.nonce, { ok: true, result: result });
  } catch (error) {
    return responsePage_(payload.nonce, {
      ok: false,
      error: error instanceof Error ? error.message : 'The request could not be completed.',
    });
  }
}

function prepareWorkerPasswords() {
  const sheet = getWorkersSheet_();
  const headers = getHeaders_(sheet);
  const numberColumn = columnIndex_(headers, 'Punching Number');
  const nameColumn = columnIndex_(headers, 'Name');
  const roleColumn = columnIndex_(headers, 'Role');
  const passwordColumn = columnIndex_(headers, 'Password');
  const hashColumn = columnIndex_(headers, 'Password Hash');
  const rowCount = sheet.getLastRow() - 1;
  if (rowCount < 1) return 'No worker accounts to prepare.';

  const rows = sheet.getRange(2, 1, rowCount, sheet.getLastColumn()).getDisplayValues();
  const punchingNumbers = new Set();
  const passwordHashes = rows.map(function (row) {
    const punchingNumber = row[numberColumn].trim();
    if (punchingNumber && punchingNumbers.has(punchingNumber)) {
      throw new Error('Punching numbers must be unique in the Workers tab.');
    }
    if (punchingNumber) punchingNumbers.add(punchingNumber);
    const password = row[passwordColumn].trim();
    if (!password) return [row[hashColumn]];
    if (!row[numberColumn].trim() || !row[nameColumn].trim() || !row[roleColumn].trim()) {
      throw new Error('Every account with a password needs a punching number, name, and role.');
    }

    const salt = Utilities.getUuid().replace(/-/g, '');
    return [salt + ':' + derivePasswordHash_(password, salt)];
  });

  sheet.getRange(2, hashColumn + 1, rowCount, 1).setValues(passwordHashes);
  sheet.getRange(2, passwordColumn + 1, rowCount, 1).clearContent();
  getAttendanceSheet_();
  return 'Passwords hashed and cleared from the Workers tab.';
}

function handleRequest_(payload) {
  if (!payload || typeof payload.action !== 'string') {
    throw new Error('Invalid request.');
  }

  if (payload.action === 'login') return login_(payload);

  const session = getSession_(payload.sessionToken);
  if (payload.action === 'markAttendance') {
    if (session.role !== 'worker') throw new Error('Only worker accounts can mark attendance.');
    return markAttendance_(session, payload);
  }
  if (payload.action === 'addWorker') {
    if (session.role !== 'admin') throw new Error('Only administrators can add worker accounts.');
    return addWorker_(payload);
  }
  if (payload.action === 'getWorkers') {
    if (session.role !== 'admin') throw new Error('Only administrators can view worker accounts.');
    return getWorkers_();
  }
  if (payload.action === 'removeWorker') {
    if (session.role !== 'admin') throw new Error('Only administrators can remove worker accounts.');
    return removeWorker_(payload);
  }
  if (payload.action === 'getGeofence') {
    const storedGeofence = PropertiesService.getScriptProperties().getProperty('SHARED_GEOFENCE');
    return storedGeofence ? JSON.parse(storedGeofence) : null;
  }
  if (payload.action === 'saveGeofence') {
    if (session.role !== 'admin') throw new Error('Only administrators can change the geofence.');
    return saveGeofence_(payload.geofence);
  }
  if (payload.action === 'attendance') {
    if (session.role !== 'admin') throw new Error('Only administrators can view attendance.');
    return getAttendanceRows_(payload.dateKey);
  }

  throw new Error('Unsupported request.');
}

function addWorker_(payload) {
  const punchingNumber = String(payload.punchingNumber || '').trim();
  const name = String(payload.name || '').trim();
  const password = String(payload.password || '');
  const plant = String(payload.plant || '').trim();
  if (!punchingNumber || punchingNumber.length > 100 || !name || name.length > 150) {
    throw new Error('Enter a valid worker name and punching number.');
  }
  if (PLANTS.indexOf(plant) < 0) {
    throw new Error('Choose Plant 1 or Plant 2 for the worker account.');
  }
  if (/[\u0000-\u001f\u007f]/.test(punchingNumber) || /[\u0000-\u001f\u007f]/.test(name)) {
    throw new Error('Name and punching number cannot contain control characters.');
  }
  if (password.length < 8 || password.length > 128) {
    throw new Error('Worker passwords must be between 8 and 128 characters.');
  }

  const sheet = getWorkersSheet_();
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const headers = getHeaders_(sheet);
    const plantColumn = ensurePlantColumn_(sheet, headers);
    const numberColumn = columnIndex_(headers, 'Punching Number');
    const nameColumn = columnIndex_(headers, 'Name');
    const roleColumn = columnIndex_(headers, 'Role');
    const passwordColumn = columnIndex_(headers, 'Password');
    const hashColumn = columnIndex_(headers, 'Password Hash');
    const accounts = sheet.getDataRange().getDisplayValues().slice(1);
    if (accounts.some(function (row) {
      return row[numberColumn].trim() === punchingNumber;
    })) {
      throw new Error('That punching number is already assigned.');
    }

    const row = Array(sheet.getLastColumn()).fill('');
    row[numberColumn] = punchingNumber;
    row[nameColumn] = name;
    row[roleColumn] = 'Worker';
    row[plantColumn] = plant;
    const salt = Utilities.getUuid().replace(/-/g, '');
    row[passwordColumn] = '';
    row[hashColumn] = salt + ':' + derivePasswordHash_(password, salt);
    const target = sheet.getLastRow() + 1;
    sheet.getRange(target, 1, 1, row.length).setNumberFormat('@');
    sheet.getRange(target, 1, 1, row.length).setValues([row]);
  } finally {
    lock.releaseLock();
  }

  return { punchingNumber: punchingNumber, name: name, role: 'worker', plant: plant };
}

function getWorkers_() {
  const sheet = getWorkersSheet_();
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const headers = getHeaders_(sheet);
    const plantColumn = ensurePlantColumn_(sheet, headers);
    const numberColumn = columnIndex_(headers, 'Punching Number');
    const nameColumn = columnIndex_(headers, 'Name');
    const roleColumn = columnIndex_(headers, 'Role');
    const workers = sheet.getDataRange().getDisplayValues().slice(1)
      .filter(function (row) {
        return row[numberColumn].trim() && row[nameColumn].trim() &&
          row[roleColumn].trim().toLowerCase() === 'worker';
      })
      .map(function (row) {
        return {
          punchingNumber: row[numberColumn].trim(),
          name: row[nameColumn].trim(),
          plant: (row[plantColumn] || '').trim(),
        };
      });
    return { plantField: true, workers: workers };
  } finally {
    lock.releaseLock();
  }
}

function removeWorker_(payload) {
  const punchingNumber = String(payload.punchingNumber || '').trim();
  if (!punchingNumber || punchingNumber.length > 100) {
    throw new Error('Choose a valid worker account to remove.');
  }

  const sheet = getWorkersSheet_();
  const headers = getHeaders_(sheet);
  const numberColumn = columnIndex_(headers, 'Punching Number');
  const roleColumn = columnIndex_(headers, 'Role');
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const rows = sheet.getDataRange().getDisplayValues();
    const matches = rows.slice(1).map(function (row, index) {
      return { row: row, sheetRow: index + 2 };
    }).filter(function (account) {
      return account.row[numberColumn].trim() === punchingNumber;
    });
    if (matches.length !== 1 ||
        matches[0].row[roleColumn].trim().toLowerCase() !== 'worker') {
      throw new Error('That worker account could not be found.');
    }

    sheet.deleteRow(matches[0].sheetRow);
  } finally {
    lock.releaseLock();
  }

  return { punchingNumber: punchingNumber };
}

function saveGeofence_(geofence) {
  if (!geofence || geofence.configured !== true ||
      typeof geofence.lat !== 'number' || geofence.lat < -90 || geofence.lat > 90 ||
      typeof geofence.lng !== 'number' || geofence.lng < -180 || geofence.lng > 180) {
    throw new Error('The factory boundary is invalid.');
  }

  if (Array.isArray(geofence.polygon) && geofence.polygon.length > 0) {
    if (!isValidPolygon_(geofence.polygon)) throw new Error('The factory boundary polygon is invalid.');
  } else if (typeof geofence.radius !== 'number' || !Number.isFinite(geofence.radius) ||
      geofence.radius <= 0) {
    throw new Error('The factory boundary radius is invalid.');
  }

  const savedGeofence = Object.assign({}, geofence);
  if (!Array.isArray(savedGeofence.polygon) || savedGeofence.polygon.length === 0) {
    delete savedGeofence.polygon;
  }
  PropertiesService.getScriptProperties().setProperty('SHARED_GEOFENCE', JSON.stringify(savedGeofence));
  return true;
}

function isValidPolygon_(polygon) {
  if (polygon.length < 3 || polygon.some(function (point) {
    return !point || typeof point.lat !== 'number' || !Number.isFinite(point.lat) ||
      point.lat < -90 || point.lat > 90 || typeof point.lng !== 'number' ||
      !Number.isFinite(point.lng) || point.lng < -180 || point.lng > 180;
  })) return false;

  const uniquePoints = new Set(polygon.map(function (point) {
    return point.lat + ',' + point.lng;
  }));
  if (uniquePoints.size < 3) return false;

  const doubledArea = polygon.reduce(function (area, point, index) {
    const nextPoint = polygon[(index + 1) % polygon.length];
    return area + point.lng * nextPoint.lat - nextPoint.lng * point.lat;
  }, 0);
  return Math.abs(doubledArea) > Number.EPSILON;
}

function login_(payload) {
  const punchingNumber = String(payload.punchingNumber || '').trim();
  const password = String(payload.password || '');
  if (!punchingNumber || !password || punchingNumber.length > 100 || password.length > 128) {
    throw new Error('Enter your punching number and password.');
  }

  const cache = CacheService.getScriptCache();
  const attemptKey = 'login:' + digest_(punchingNumber.toLowerCase());
  const attempts = Number(cache.get(attemptKey) || 0);
  if (attempts >= 8) throw new Error('Too many failed sign-in attempts. Try again in 15 minutes.');
  cache.put(attemptKey, String(attempts + 1), 900);

  const sheet = getWorkersSheet_();
  const headers = getHeaders_(sheet);
  const numberColumn = columnIndex_(headers, 'Punching Number');
  const nameColumn = columnIndex_(headers, 'Name');
  const roleColumn = columnIndex_(headers, 'Role');
  const hashColumn = columnIndex_(headers, 'Password Hash');
  const rows = sheet.getDataRange().getDisplayValues();
  const matches = rows.slice(1).filter(function (row) {
    return row[numberColumn].trim() === punchingNumber;
  });

  if (matches.length > 1) throw new Error('Duplicate punching numbers are configured. Contact your administrator.');
  const account = matches[0];
  if (!account || !verifyPassword_(password, account[hashColumn])) {
    throw new Error('Incorrect punching number or password.');
  }

  const role = account[roleColumn].trim().toLowerCase();
  if (role !== 'worker' && role !== 'admin') throw new Error('This account has an invalid role.');
  if (!account[nameColumn].trim()) throw new Error('This account has no name configured.');

  cache.remove(attemptKey);
  const token = Utilities.getUuid() + Utilities.getUuid();
  cache.put('session:' + token, JSON.stringify({
    name: account[nameColumn].trim(),
    role: role,
    punchingNumber: punchingNumber,
    passwordHash: account[hashColumn],
  }), SESSION_TTL_SECONDS);

  return { name: account[nameColumn].trim(), role: role, sessionToken: token };
}

function markAttendance_(session, payload) {
  assertActiveWorker_(session);
  const latitude = payload.latitude;
  const longitude = payload.longitude;
  if (typeof latitude !== 'number' || !Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
      typeof longitude !== 'number' || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new Error('A valid location is required to mark attendance.');
  }

  const storedGeofence = PropertiesService.getScriptProperties().getProperty('SHARED_GEOFENCE');
  if (!storedGeofence) throw new Error('Your administrator has not saved the factory boundary.');
  if (!isPointInGeofence_(latitude, longitude, JSON.parse(storedGeofence))) {
    throw new Error('You are outside the saved factory boundary.');
  }

  const timezone = Session.getScriptTimeZone();
  const now = new Date();
  const dateKey = Utilities.formatDate(now, timezone, 'yyyy-MM-dd');
  const time = Utilities.formatDate(now, timezone, 'HH:mm:ss');
  const sheet = getAttendanceSheet_();
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const rows = sheet.getDataRange().getDisplayValues();
    const existingIndex = rows.slice(1).findIndex(function (row) {
      return row[0] === dateKey && row[1] === session.punchingNumber;
    });
    const values = [
      dateKey,
      session.punchingNumber,
      session.name,
      'Present',
      time,
      latitude,
      longitude,
    ];
    if (existingIndex >= 0) {
      sheet.getRange(existingIndex + 2, 1, 1, values.length).setValues([values]);
    } else {
      sheet.appendRow(values);
    }
  } finally {
    lock.releaseLock();
  }

  return { dateKey: dateKey, time: time };
}

function assertActiveWorker_(session) {
  const sheet = getWorkersSheet_();
  const headers = getHeaders_(sheet);
  const numberColumn = columnIndex_(headers, 'Punching Number');
  const nameColumn = columnIndex_(headers, 'Name');
  const roleColumn = columnIndex_(headers, 'Role');
  const hashColumn = columnIndex_(headers, 'Password Hash');
  const matches = sheet.getDataRange().getDisplayValues().slice(1).filter(function (row) {
    return row[numberColumn].trim() === session.punchingNumber;
  });
  if (matches.length !== 1 ||
      matches[0][roleColumn].trim().toLowerCase() !== 'worker' ||
      matches[0][nameColumn].trim() !== session.name ||
      matches[0][hashColumn] !== session.passwordHash) {
    throw new Error('This worker account is no longer active. Please contact your administrator.');
  }
}

function isPointInGeofence_(latitude, longitude, geofence) {
  if (Array.isArray(geofence.polygon) && geofence.polygon.length > 0) {
    let inside = false;
    for (let index = 0, previousIndex = geofence.polygon.length - 1;
      index < geofence.polygon.length;
      previousIndex = index++) {
      const current = geofence.polygon[index];
      const previous = geofence.polygon[previousIndex];
      const cross = (latitude - previous.lat) * (current.lng - previous.lng) -
        (longitude - previous.lng) * (current.lat - previous.lat);
      if (Math.abs(cross) <= 1e-10 &&
          latitude >= Math.min(previous.lat, current.lat) - 1e-10 &&
          latitude <= Math.max(previous.lat, current.lat) + 1e-10 &&
          longitude >= Math.min(previous.lng, current.lng) - 1e-10 &&
          longitude <= Math.max(previous.lng, current.lng) + 1e-10) {
        return true;
      }

      const crossesLatitude = (current.lat > latitude) !== (previous.lat > latitude);
      if (crossesLatitude &&
          longitude < ((previous.lng - current.lng) * (latitude - current.lat)) /
            (previous.lat - current.lat) + current.lng) {
        inside = !inside;
      }
    }
    return inside;
  }

  const radians = Math.PI / 180;
  const latitudeDelta = (geofence.lat - latitude) * radians;
  const longitudeDelta = (geofence.lng - longitude) * radians;
  const value = Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(latitude * radians) * Math.cos(geofence.lat * radians) *
    Math.sin(longitudeDelta / 2) ** 2;
  const distance = 6371000 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
  return distance <= geofence.radius;
}

function getAttendanceRows_(dateKey) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateKey || ''))) {
    throw new Error('Choose a valid attendance date.');
  }

  const workers = getWorkersSheet_().getDataRange().getDisplayValues();
  const workerHeaders = workers[0].map(normalizeHeader_);
  const numberColumn = workerHeaders.indexOf('punching number');
  const nameColumn = workerHeaders.indexOf('name');
  const roleColumn = workerHeaders.indexOf('role');
  if (numberColumn < 0 || nameColumn < 0 || roleColumn < 0) {
    throw new Error('The Workers tab is missing required columns.');
  }

  const records = new Map();
  const attendance = getAttendanceSheet_().getDataRange().getDisplayValues();
  attendance.slice(1).forEach(function (row) {
    if (row[0] === dateKey) records.set(row[1], { status: row[3], time: row[4] });
  });

  return workers.slice(1)
    .filter(function (row) {
      return row[numberColumn].trim() && row[nameColumn].trim() &&
        row[roleColumn].trim().toLowerCase() === 'worker';
    })
    .map(function (row) {
      const record = records.get(row[numberColumn].trim());
      return {
        punchingNumber: row[numberColumn].trim(),
        name: row[nameColumn].trim(),
        status: record ? record.status : 'Absent',
        time: record ? record.time : '—',
      };
    });
}

function getSession_(token) {
  if (typeof token !== 'string' || !token || token.length > 100) {
    throw new Error('Your session expired. Please sign in again.');
  }
  const value = CacheService.getScriptCache().get('session:' + token);
  if (!value) throw new Error('Your session expired. Please sign in again.');
  return JSON.parse(value);
}

function verifyPassword_(password, storedHash) {
  const parts = String(storedHash || '').split(':');
  return parts.length === 2 &&
    derivePasswordHash_(password, parts[0]) === parts[1];
}

function derivePasswordHash_(password, salt) {
  let bytes = Utilities.newBlob(salt + ':' + password).getBytes();
  for (let i = 0; i < PASSWORD_HASH_ITERATIONS; i += 1) {
    bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes);
  }
  return bytes.map(function (byte) {
    return ('0' + ((byte + 256) % 256).toString(16)).slice(-2);
  }).join('');
}

function digest_(value) {
  return Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    value,
    Utilities.Charset.UTF_8
  ).map(function (byte) {
    return ('0' + ((byte + 256) % 256).toString(16)).slice(-2);
  }).join('');
}

function getWorkersSheet_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(WORKERS_SHEET);
  if (!sheet || sheet.getLastRow() < 1) {
    throw new Error('Create a Workers tab with the setup headers before using attendance.');
  }
  return sheet;
}

function getAttendanceSheet_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = spreadsheet.getSheetByName(ATTENDANCE_SHEET);
  if (!sheet) sheet = spreadsheet.insertSheet(ATTENDANCE_SHEET);
  const headers = ['Date', 'Punching Number', 'Name', 'Status', 'Time', 'Latitude', 'Longitude'];
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
  } else if (headers.some(function (header, index) {
    return normalizeHeader_(sheet.getRange(1, index + 1).getDisplayValue()) !==
      normalizeHeader_(header);
  })) {
    throw new Error('The Attendance tab headers do not match the required format.');
  }
  return sheet;
}

function getHeaders_(sheet) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn())
    .getDisplayValues()[0].map(normalizeHeader_);
  ['Punching Number', 'Name', 'Role', 'Password', 'Password Hash'].forEach(function (header) {
    if (headers.indexOf(normalizeHeader_(header)) < 0) {
      throw new Error('The Workers tab is missing the "' + header + '" column.');
    }
  });
  return headers;
}

function ensurePlantColumn_(sheet, headers) {
  const plantColumn = columnIndex_(headers, 'Plant');
  if (plantColumn >= 0) return plantColumn;

  const newPlantColumn = headers.length;
  sheet.getRange(1, newPlantColumn + 1).setValue('Plant');
  return newPlantColumn;
}

function columnIndex_(headers, name) {
  return headers.indexOf(normalizeHeader_(name));
}

function normalizeHeader_(value) {
  return String(value || '').trim().toLowerCase();
}

function responsePage_(nonce, response) {
  const message = JSON.stringify({
    type: 'geoattendance-response',
    nonce: nonce || '',
    response: response,
  }).replace(/</g, '\\u003c');
  return HtmlService.createHtmlOutput(
    '<!doctype html><script>window.top.postMessage(' + message + ',"*");</script>'
  ).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
