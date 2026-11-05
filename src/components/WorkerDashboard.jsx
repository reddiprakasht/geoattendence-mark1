import { useEffect, useState } from 'react';
import { markWorkerPresent } from '../utils/attendance.js';
import { hasConfiguredGeofence, isPointInGeofence } from '../utils/geofence.js';
import { getSharedGeofence } from '../utils/sheetsApi.js';

export default function WorkerDashboard({ user, onLogout }) {
  const [geofence, setGeofence] = useState(null);
  const [boundaryLoading, setBoundaryLoading] = useState(true);
  const [message, setMessage] = useState({
    text: 'Loading the shared factory boundary...',
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
          setMessage({ text: '', type: 'info' });
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

    return () => {
      active = false;
    };
  }, [user.sessionToken]);

  async function markPresent() {
    if (!hasConfiguredGeofence(geofence)) {
      setMessage({
        text: 'Error: Admin has not set the geofence boundary yet.',
        type: 'error',
      });
      return;
    }

    if (!navigator.geolocation) {
      setMessage({
        text: 'Geolocation is not supported by your browser.',
        type: 'error',
      });
      return;
    }

    setMessage({ text: 'Checking your GPS location...', type: 'info' });
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const isInside = isPointInGeofence(
          position.coords.latitude,
          position.coords.longitude,
          geofence,
        );

        if (!isInside) {
          setMessage({
            text: 'Failed: You are outside the factory boundary.',
            type: 'error',
          });
          return;
        }

        if (!user.sessionToken || user.role !== 'worker') {
          setMessage({
            text: 'Please log in again to mark attendance.',
            type: 'error',
          });
          onLogout();
          return;
        }

        markWorkerPresent(
          user.sessionToken,
          position.coords.latitude,
          position.coords.longitude,
        )
          .then(() => {
            setMessage({
              text: 'Success! Marked Present inside the factory boundary.',
              type: 'success',
            });
          })
          .catch((error) => {
            setMessage({
              text: error instanceof Error ? error.message : 'Could not save your attendance.',
              type: 'error',
            });
          });
      },
      () => {
        setMessage({
          text: 'Location access denied or unavailable.',
          type: 'error',
        });
      },
    );
  }

  return (
    <section>
      <button className="back-btn" type="button" onClick={onLogout}>
        Back to Login / Logout
      </button>
      <h1>Worker Dashboard</h1>
      <p>Welcome, {user.name}!</p>
      <p className="muted">
        Click below to verify your location and mark your presence within the office boundary.
      </p>
      <button
        type="button"
        onClick={markPresent}
        disabled={boundaryLoading || !hasConfiguredGeofence(geofence)}
      >
        Mark Present
      </button>
      <p className={`worker-msg message-${message.type}`} role="status" aria-live="polite">
        {message.text}
      </p>
      <button className="back-btn" type="button" onClick={onLogout}>
        Back to Login / Logout
      </button>
    </section>
  );
}
