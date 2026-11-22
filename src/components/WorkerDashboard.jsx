import { useEffect, useState } from 'react';
import {
  formatShiftHours,
  getAttendanceBillingPeriod,
  getAttendanceDates,
  getAttendanceSummary,
  getShiftMinutes,
  getWorkerAttendance,
  getWorkerAttendanceRange,
  markWorkerAttendance,
} from '../utils/attendance.js';
import { hasConfiguredGeofence, isPointInGeofence } from '../utils/geofence.js';
import { getSharedGeofence } from '../utils/sheetsApi.js';
import { getLocalDateKey } from '../utils/storage.js';

const EMPTY_RECORD = {
  inTime: '',
  p1Time: '',
  p2Time: '',
  outTime: '',
  status: 'Absent',
};

export default function WorkerDashboard({ user, onLogout }) {
  const [geofence, setGeofence] = useState(null);
  const [boundaryLoading, setBoundaryLoading] = useState(true);
  const [recordLoading, setRecordLoading] = useState(true);
  const [recordReady, setRecordReady] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [record, setRecord] = useState(EMPTY_RECORD);
  const [periodAttendance, setPeriodAttendance] = useState(null);
  const [periodAttendanceLoading, setPeriodAttendanceLoading] = useState(true);
  const [periodAttendanceMessage, setPeriodAttendanceMessage] = useState('');
  const billingPeriod = getAttendanceBillingPeriod();
  const attendanceDates = getAttendanceDates(billingPeriod.startDate, billingPeriod.endDate);
  const todayDate = getLocalDateKey();
  const [message, setMessage] = useState({
    text: "Loading the shared factory boundary and today's attendance...",
    type: 'info',
  });

  useEffect(() => {
    let active = true;
    getSharedGeofence(user.sessionToken)
      .then((sharedGeofence) => {
        if (!active) return;
        setGeofence(sharedGeofence);
        if (!hasConfiguredGeofence(sharedGeofence)) {
          setMessage({
            text: 'Your administrator has not saved a shared factory boundary yet.',
            type: 'error',
          });
        } else {
          setMessage((current) => current.type === 'error'
            ? current
            : { text: '', type: 'info' });
        }
      })
      .catch((error) => {
        if (!active) return;
        setMessage({
          text: error instanceof Error ? error.message : 'Could not load the factory boundary.',
          type: 'error',
        });
      })
      .finally(() => {
        if (active) setBoundaryLoading(false);
      });

    getWorkerAttendance(user.sessionToken)
      .then((todayRecord) => {
        if (active) {
          setRecord(todayRecord || EMPTY_RECORD);
          setRecordReady(true);
        }
      })
      .catch((error) => {
        if (!active) return;
        setMessage({
          text: error instanceof Error ? error.message : "Could not load today's attendance.",
          type: 'error',
        });
      })
      .finally(() => {
        if (active) setRecordLoading(false);
      });

    setPeriodAttendanceLoading(true);
    setPeriodAttendanceMessage('');
    getWorkerAttendanceRange(
      billingPeriod.startDate,
      billingPeriod.endDate,
      user.sessionToken,
    )
      .then((attendance) => {
        if (!attendance || typeof attendance !== 'object' ||
            typeof attendance.punchingNumber !== 'string' ||
            typeof attendance.name !== 'string' ||
            !attendance.days || typeof attendance.days !== 'object') {
          throw new Error('The personal attendance register response is invalid.');
        }
        if (active) setPeriodAttendance(attendance);
      })
      .catch((error) => {
        if (!active) return;
        setPeriodAttendanceMessage(
          error instanceof Error ? error.message : 'Could not load your attendance period.',
        );
      })
      .finally(() => {
        if (active) setPeriodAttendanceLoading(false);
      });

    return () => {
      active = false;
    };
  }, [user.sessionToken, billingPeriod.startDate, billingPeriod.endDate]);

  function markEvent(eventType) {
    if (!user.sessionToken || user.role !== 'worker') {
      setMessage({ text: 'Please log in again to mark attendance.', type: 'error' });
      onLogout();
      return;
    }

    if (!hasConfiguredGeofence(geofence)) {
      setMessage({
        text: 'Your administrator has not saved the factory boundary yet.',
        type: 'error',
      });
      return;
    }

    if (!navigator.geolocation) {
      setMessage({ text: 'Geolocation is not supported by your browser.', type: 'error' });
      return;
    }

    setSubmitting(true);
    setMessage({ text: 'Checking your GPS location...', type: 'info' });
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        if (!isPointInGeofence(latitude, longitude, geofence)) {
          setMessage({ text: 'Failed: You are outside the factory boundary.', type: 'error' });
          setSubmitting(false);
          return;
        }

        try {
          const updatedRecord = await markWorkerAttendance(
            user.sessionToken,
            eventType,
            latitude,
            longitude,
          );
          setRecord(updatedRecord);
          setPeriodAttendance((current) => current && updatedRecord.dateKey
            ? {
              ...current,
              days: { ...current.days, [updatedRecord.dateKey]: updatedRecord },
            }
            : current);
          setMessage({ text: `${eventType} recorded successfully.`, type: 'success' });
        } catch (error) {
          setMessage({
            text: error instanceof Error ? error.message : 'Could not save your attendance.',
            type: 'error',
          });
        } finally {
          setSubmitting(false);
        }
      },
      () => {
        setMessage({ text: 'Location access denied or unavailable.', type: 'error' });
        setSubmitting(false);
      },
    );
  }

  const hasIn = Boolean(record.inTime);
  const hasOut = Boolean(record.outTime);
  const allPillsDisabled =
    boundaryLoading ||
    recordLoading ||
    !recordReady ||
    submitting ||
    hasOut ||
    user.role !== 'worker' ||
    !user.sessionToken ||
    !hasConfiguredGeofence(geofence);
  const totalHours = formatShiftHours(getShiftMinutes(record.inTime, record.outTime));
  const actions = [
    { type: 'IN', disabled: allPillsDisabled || hasIn },
    { type: 'P1', disabled: allPillsDisabled || !hasIn || Boolean(record.p1Time) },
    { type: 'P2', disabled: allPillsDisabled || !hasIn || Boolean(record.p2Time) },
    { type: 'OUT', disabled: allPillsDisabled || !hasIn },
  ];

  return (
    <section className="worker-page">
      <header className="worker-header">
        <div>
          <p className="eyebrow">Worker portal</p>
          <h1>Worker Dashboard</h1>
          <p>Welcome, {user.name}!</p>
        </div>
        <button className="back-btn" type="button" onClick={onLogout}>
          Logout
        </button>
      </header>
      <p className="muted worker-helper">
        Record each attendance event while inside the factory boundary.
      </p>
      <div className="button-row attendance-action-row" aria-label="Attendance actions">
        {actions.map(({ type, disabled }) => (
          <button
            key={type}
            className={record[`${type.toLowerCase()}Time`] ? 'secondary-btn' : ''}
            type="button"
            onClick={() => markEvent(type)}
            disabled={disabled}
          >
            {type}
          </button>
        ))}
      </div>
      <section className="worker-attendance" aria-label="Your attendance register">
        <div className="panel-heading">
          <h2>Attendance Register</h2>
          <span className="panel-tag">
            {billingPeriod.startDate} – {billingPeriod.endDate}
          </span>
        </div>
        <p className="admin-msg" role="status" aria-live="polite">
          {periodAttendanceLoading
            ? 'Loading attendance...'
            : periodAttendanceMessage}
        </p>
        <div className="table-scroll">
          <table className="attendance-register-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Punching No.</th>
                {attendanceDates.map((date) => (
                  <th key={date} title={date}>
                    {new Date(`${date}T12:00:00`).getDate()}
                  </th>
                ))}
                <th>PERIOD SUMMARY</th>
              </tr>
            </thead>
            <tbody>
              {periodAttendance && (
                <tr>
                  <td>{periodAttendance.name}</td>
                  <td>{periodAttendance.punchingNumber}</td>
                  {attendanceDates.map((date) => {
                    const day = periodAttendance.days[date] || {};
                    const isFutureDate = date > todayDate;
                    const isPresent = Boolean(day.inTime);
                    const isToday = date === todayDate;
                    const details = [
                      `IN: ${day.inTime || 'Not Marked'}`,
                      `P1: ${day.p1Time || 'Not Marked'}`,
                      `P2: ${day.p2Time || 'Not Marked'}`,
                      `OUT: ${day.outTime || 'Not Marked'}`,
                      `Total Hours: ${day.inTime && day.outTime
                        ? formatShiftHours(getShiftMinutes(day.inTime, day.outTime))
                        : day.inTime && isToday ? 'Currently Inside' : day.inTime ? 'Not Available' : '—'}`,
                    ].join('\n');
                    return (
                      <td
                        key={date}
                        className={`register-day-cell ${isFutureDate ? '' : isPresent ? 'status-present' : 'status-absent'}`}
                        title={isFutureDate ? 'Future date' : details}
                        aria-label={`${date}: ${isFutureDate ? 'Not applicable' : isPresent ? 'Present. ' + details : 'Absent'}`}
                      >
                        {isFutureDate ? '—' : isPresent ? (
                          <span className="register-day-content">
                            <strong>P</strong>
                            <span className="register-day-times">
                              <span>IN {day.inTime.slice(0, 5)}</span>
                              <span>
                                OUT {day.outTime
                                  ? day.outTime.slice(0, 5)
                                  : isToday ? 'Inside' : '—'}
                              </span>
                            </span>
                          </span>
                        ) : 'A'}
                      </td>
                    );
                  })}
                  {(() => {
                    const summary = getAttendanceSummary(periodAttendance.days, attendanceDates);
                    return (
                      <td className="register-summary-cell">
                        <span>Days Present: {summary.daysPresent}</span>
                        <span>Days Absent: {summary.daysAbsent}</span>
                        <span>Total Hours: {formatShiftHours(summary.totalMinutes)}</span>
                      </td>
                    );
                  })()}
                </tr>
              )}
              {!periodAttendanceLoading && !periodAttendance && (
                <tr>
                  <td colSpan={3 + attendanceDates.length}>
                    {periodAttendanceMessage || 'Attendance is unavailable.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      <p className="attendance-current-status" role="status">
        {recordLoading
          ? 'Loading attendance...'
          : !recordReady
            ? 'Attendance unavailable'
          : hasIn && !hasOut
            ? 'Currently Inside'
            : hasOut
              ? `Shift complete${totalHours ? ` - Total Working Hours: ${totalHours}` : ''}`
              : 'Not marked in'}
      </p>
      <p className={`worker-msg message-${message.type}`} role="status" aria-live="polite">
        {message.text}
      </p>
      <button className="back-btn" type="button" onClick={onLogout}>
        Back to Login / Logout
      </button>
    </section>
  );
}
