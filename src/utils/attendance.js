import { requestSheetsApi } from './sheetsApi.js';

export function getAttendanceRows(dateKey, sessionToken) {
  return requestSheetsApi({ action: 'attendance', dateKey, sessionToken });
}

export function markWorkerPresent(sessionToken, latitude, longitude) {
  return requestSheetsApi({
    action: 'markAttendance',
    sessionToken,
    latitude,
    longitude,
  });
}
