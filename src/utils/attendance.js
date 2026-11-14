import { requestSheetsApi } from './sheetsApi.js';

export function getAttendanceRows(dateKey, sessionToken) {
  return requestSheetsApi({ action: 'attendance', startDate: dateKey, endDate: dateKey, sessionToken });
}

export function getAttendanceRange(startDate, endDate, sessionToken) {
  return requestSheetsApi({ action: 'attendance', startDate, endDate, sessionToken });
}

export function getWorkerAttendance(sessionToken) {
  return requestSheetsApi({ action: 'workerAttendance', sessionToken });
}

export function markWorkerAttendance(sessionToken, eventType, latitude, longitude) {
  return requestSheetsApi({
    action: 'markAttendance',
    sessionToken,
    eventType,
    latitude,
    longitude,
  });
}
