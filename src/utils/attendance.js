import { requestSheetsApi } from './sheetsApi.js';
import { getLocalDateKey } from './storage.js';

export function getAttendanceBillingPeriod(dateKey = getLocalDateKey()) {
  const date = new Date(`${dateKey}T12:00:00`);
  const startMonth = new Date(date.getFullYear(), date.getMonth() - (date.getDate() < 16 ? 1 : 0), 1);
  return getAttendancePeriodForMonth(startMonth.getFullYear(), startMonth.getMonth() + 1);
}

export function getAttendancePeriodForMonth(year, month) {
  const start = new Date(year, month - 1, 16);
  const end = new Date(year, month, 15);
  return {
    startDate: getLocalDateKey(start),
    endDate: getLocalDateKey(end),
  };
}

export function getAttendanceDates(startDate, endDate) {
  const dates = [];
  if (!startDate || !endDate || startDate > endDate) return dates;
  const current = new Date(`${startDate}T12:00:00`);
  const last = new Date(`${endDate}T12:00:00`);
  while (current <= last) {
    dates.push(getLocalDateKey(current));
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

export function getShiftMinutes(inTime, outTime) {
  if (!inTime || !outTime) return 0;
  const toMinutes = (time) => {
    const [hours, minutes, seconds] = time.split(':').map(Number);
    return hours * 60 + minutes + seconds / 60;
  };
  const minutes = Math.floor(toMinutes(outTime) - toMinutes(inTime));
  return minutes > 0 ? minutes : 0;
}

export function formatShiftHours(minutes) {
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours} hr${hours === 1 ? '' : 's'} ${remainingMinutes} min${remainingMinutes === 1 ? '' : 's'}`;
}

export function getAttendanceSummary(days, dates, throughDate = getLocalDateKey()) {
  const eligibleDates = dates.filter((date) => date <= throughDate);
  const present = eligibleDates.filter((date) => Boolean(days[date]?.inTime)).length;
  const totalMinutes = eligibleDates.reduce(
    (total, date) => total + getShiftMinutes(days[date]?.inTime, days[date]?.outTime),
    0,
  );
  return {
    daysPresent: present,
    daysAbsent: eligibleDates.length - present,
    totalMinutes,
  };
}

export function getAttendanceRows(dateKey, sessionToken) {
  return requestSheetsApi({ action: 'attendance', startDate: dateKey, endDate: dateKey, sessionToken });
}

export function getAttendanceRange(startDate, endDate, sessionToken) {
  return requestSheetsApi({ action: 'attendance', startDate, endDate, sessionToken });
}

export function getWorkerAttendance(sessionToken) {
  return requestSheetsApi({ action: 'workerAttendance', sessionToken });
}

export function getWorkerAttendanceRange(startDate, endDate, sessionToken) {
  return requestSheetsApi({
    action: 'workerAttendanceRange',
    startDate,
    endDate,
    sessionToken,
  });
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
