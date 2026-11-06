export function initializeStorage() {
  if (!localStorage.getItem('geofence')) {
    localStorage.setItem(
      'geofence',
      JSON.stringify({ lat: null, lng: null, radius: 100, configured: false }),
    );
  }

  if (!localStorage.getItem('attendance')) {
    const attendance = {};
    const legacyWorkers = JSON.parse(localStorage.getItem('workers') || '{}');
    if (Object.keys(legacyWorkers).length) {
      attendance[getLocalDateKey()] = legacyWorkers;
    }
    localStorage.setItem('attendance', JSON.stringify(attendance));
  }

  getAttendance();
}

export function getLocalDateKey(now = new Date()) {
  const localDate = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return localDate.toISOString().slice(0, 10);
}

export function getAttendanceRetentionStartDate(now = new Date()) {
  const year = now.getFullYear();
  const month = now.getMonth() - 3;
  const targetYear = year + Math.floor(month / 12);
  const targetMonth = ((month % 12) + 12) % 12;
  const day = Math.min(now.getDate(), new Date(targetYear, targetMonth + 1, 0).getDate());
  return getLocalDateKey(new Date(targetYear, targetMonth, day));
}

export function getGeofence() {
  return JSON.parse(localStorage.getItem('geofence'));
}

export function saveGeofence(geofence) {
  localStorage.setItem('geofence', JSON.stringify(geofence));
}

export function getAttendance() {
  const attendance = JSON.parse(localStorage.getItem('attendance')) || {};
  const retainedAttendance = retainAttendanceHistory(attendance);

  if (Object.keys(retainedAttendance).length !== Object.keys(attendance).length) {
    localStorage.setItem('attendance', JSON.stringify(retainedAttendance));
  }
  return retainedAttendance;
}

export function saveAttendance(attendance) {
  localStorage.setItem('attendance', JSON.stringify(retainAttendanceHistory(attendance)));
}

function retainAttendanceHistory(attendance) {
  const retentionStartDate = getAttendanceRetentionStartDate();
  return Object.fromEntries(
    Object.entries(attendance).filter(
      ([dateKey]) => !/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || dateKey >= retentionStartDate,
    ),
  );
}

export function getCurrentUser() {
  try {
    const user = JSON.parse(sessionStorage.getItem('currentUser'));
    if (
      !user ||
      typeof user.name !== 'string' ||
      !['worker', 'admin'].includes(user.role) ||
      typeof user.sessionToken !== 'string' ||
      !user.sessionToken
    ) {
      return null;
    }
    return user;
  } catch {
    return null;
  }
}

export function saveCurrentUser(user) {
  if (user) {
    sessionStorage.setItem('currentUser', JSON.stringify(user));
  } else {
    sessionStorage.removeItem('currentUser');
  }
}

export function isAdmin() {
  return getCurrentUser()?.role === 'admin';
}
