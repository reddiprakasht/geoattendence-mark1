import { useEffect, useState } from 'react';
import {
  getWorkerAttendance,
  markWorkerAttendance,
} from '../utils/attendance.js';
import { hasConfiguredGeofence, isPointInGeofence } from '../utils/geofence.js';
import { getSharedGeofence } from '../utils/sheetsApi.js';

const EMPTY_RECORD = {
  inTime: '',
  p1Time: '',
  p2Time: '',
  outTime: '',
  status: 'Absent',
};

function formatTotalHours(inTime, outTime) {
  if (!inTime || !outTime) return '';
  const toSeconds = (time) => {
    const [hours, minutes, seconds] = time.split(':').map(Number);
    return hours * 3600 + minutes * 60 + seconds;
  };
  const totalMinutes = Math.floor((toSeconds(outTime) - toSeconds(inTime)) / 60);
  if (totalMinutes < 0) return '';
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours} hr${hours === 1 ? '' : 's'} ${minutes} min${minutes === 1 ? '' : 's'}`;
}

export default function WorkerDashboard({ user, onLogout }) {
  const [geofence, setGeofence] = useState(null);
  const [boundaryLoading, setBoundaryLoading] = useState(true);
  const [recordLoading, setRecordLoading] = useState(true);
  const [recordReady, setRecordReady] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [record, setRecord] = useState(EMPTY_RECORD);
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

    return () => {
      active = false;
    };
  }, [user.sessionToken]);

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
  const totalHours = formatTotalHours(record.inTime, record.outTime);
  const actions = [
    { type: 'IN', disabled: allPillsDisabled || hasIn },
    { type: 'P1', disabled: allPillsDisabled || !hasIn || Boolean(record.p1Time) },
    { type: 'P2', disabled: allPillsDisabled || !hasIn || Boolean(record.p2Time) },
    { type: 'OUT', disabled: allPillsDisabled || !hasIn },
  ];

  return (
    <section>
      <button className="back-btn" type="button" onClick={onLogout}>
        Back to Login / Logout
      </button>
      <h1>Worker Dashboard</h1>
      <p>Welcome, {user.name}!</p>
      <p className="muted">
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
