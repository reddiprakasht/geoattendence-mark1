import { useEffect, useState } from 'react';
import { getAttendanceRows } from '../utils/attendance.js';
import { hasConfiguredGeofence, isValidGeofencePolygon } from '../utils/geofence.js';
import { parseGoogleMapsLocation } from '../utils/googleMaps.js';
import {
  addWorkerAccount,
  getWorkerAccounts,
  getSharedGeofence,
  removeWorkerAccount,
  saveSharedGeofence,
} from '../utils/sheetsApi.js';
import GeofenceMap from './GeofenceMap.jsx';
import {
  getAttendanceRetentionStartDate,
  getGeofence,
  getLocalDateKey,
  isAdmin,
  saveGeofence,
} from '../utils/storage.js';

const PLANTS = ['Plant 1', 'Plant 2'];

export default function AdminDashboard({ user, onLogout }) {
  const [geofence, setGeofenceForm] = useState(getGeofence());
  const [polygonPoints, setPolygonPoints] = useState(() =>
    Array.isArray(geofence?.polygon) ? geofence.polygon : [],
  );
  const [geofenceMessage, setGeofenceMessage] = useState({
    text: hasConfiguredGeofence(geofence)
      ? 'A geofence boundary is configured.'
      : 'Set and save the office boundary before workers can mark attendance.',
    type: hasConfiguredGeofence(geofence) ? 'success' : 'info',
  });
  const [googleMapsInput, setGoogleMapsInput] = useState('');
  const [attendanceDate, setAttendanceDate] = useState(() => getLocalDateKey());
  const [attendanceRows, setAttendanceRows] = useState([]);
  const [attendanceMessage, setAttendanceMessage] = useState({
    text: 'Loading attendance...',
    type: 'info',
  });
  const [attendanceLoading, setAttendanceLoading] = useState(false);
  const [workerAccount, setWorkerAccount] = useState({
    name: '',
    punchingNumber: '',
    password: '',
  });
  const [accountMessage, setAccountMessage] = useState({ text: '', type: 'info' });
  const [accountSaving, setAccountSaving] = useState(false);
  const [workerAccounts, setWorkerAccounts] = useState([]);
  const [workersLoading, setWorkersLoading] = useState(true);
  const [removingWorker, setRemovingWorker] = useState('');
  const [plantFilter, setPlantFilter] = useState('all');
  const [workerStatusFilter, setWorkerStatusFilter] = useState('all');
  const [plantSupportReady, setPlantSupportReady] = useState(false);

  useEffect(() => {
    loadAttendance(getLocalDateKey());
    loadSharedBoundary();
    loadWorkerAccounts();
  }, []);

  function updateGeofenceField(field, value) {
    setGeofenceForm((current) => ({ ...current, [field]: value }));
  }

  function addFencePoint(point) {
    setPolygonPoints((current) => [...current, point]);
    setGeofenceMessage({
      text: `Boundary point ${polygonPoints.length + 1} added. Add at least 3 points, then save the area.`,
      type: 'info',
    });
  }

  function importGoogleMapsLocation(event) {
    event.preventDefault();
    if (!ensureAdmin()) return;

    const location = parseGoogleMapsLocation(googleMapsInput);
    if (!location) {
      setGeofenceMessage({
        text: 'Could not find coordinates. In Google Maps, long-press the location, copy its coordinates, then paste them here.',
        type: 'error',
      });
      return;
    }

    setGeofenceForm((current) => ({ ...current, ...location }));
    addFencePoint(location);
    setGeofenceMessage({
      text: 'Google Maps location added as a boundary point.',
      type: 'success',
    });
  }

  const googleMapsUrl =
    geofence.lat !== null &&
    geofence.lat !== undefined &&
    geofence.lat !== '' &&
    Number.isFinite(Number(geofence.lat)) &&
    geofence.lng !== null &&
    geofence.lng !== undefined &&
    geofence.lng !== '' &&
    Number.isFinite(Number(geofence.lng))
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${geofence.lat},${geofence.lng}`)}`
      : 'https://www.google.com/maps';

  async function loadSharedBoundary() {
    if (!ensureAdmin()) return;
    try {
      const sharedGeofence = await getSharedGeofence(user.sessionToken);
      if (sharedGeofence) {
        setGeofenceForm(sharedGeofence);
        setPolygonPoints(Array.isArray(sharedGeofence.polygon) ? sharedGeofence.polygon : []);
        setGeofenceMessage({
          text: 'The shared factory boundary is configured.',
          type: 'success',
        });
      } else if (hasConfiguredGeofence(geofence)) {
        setGeofenceMessage({
          text: 'A boundary exists only on this device. Save it to share with workers.',
          type: 'info',
        });
      }
    } catch (error) {
      setGeofenceMessage({
        text: error instanceof Error ? error.message : 'Could not load the shared boundary.',
        type: 'error',
      });
    }
  }

  async function saveBoundary(event) {
    event.preventDefault();
    if (!ensureAdmin()) return;

    const sharingExistingCircle =
      polygonPoints.length === 0 &&
      hasConfiguredGeofence(geofence) &&
      !isValidGeofencePolygon(geofence.polygon);
    if (!isValidGeofencePolygon(polygonPoints) && !sharingExistingCircle) {
      setGeofenceMessage({
        text: 'Add at least 3 different boundary points, or configure a valid circular boundary.',
        type: 'error',
      });
      return;
    }

    let nextGeofence;
    if (sharingExistingCircle) {
      const circleGeofence = { ...geofence };
      delete circleGeofence.polygon;
      nextGeofence = { ...circleGeofence, configured: true };
    } else {
      const center = polygonPoints.reduce(
        (total, point) => ({ lat: total.lat + point.lat, lng: total.lng + point.lng }),
        { lat: 0, lng: 0 },
      );
      nextGeofence = {
        ...geofence,
        lat: center.lat / polygonPoints.length,
        lng: center.lng / polygonPoints.length,
        polygon: polygonPoints,
        configured: true,
      };
    }
    setGeofenceMessage({ text: 'Saving the shared factory boundary...', type: 'info' });
    try {
      await saveSharedGeofence(user.sessionToken, nextGeofence);
      saveGeofence(nextGeofence);
      setGeofenceForm(nextGeofence);
      setGeofenceMessage({ text: 'Factory boundary saved successfully for all devices.', type: 'success' });
    } catch (error) {
      setGeofenceMessage({
        text: error instanceof Error ? error.message : 'Could not save the shared factory boundary.',
        type: 'error',
      });
    }
  }

  function useCurrentLocation() {
    if (!ensureAdmin()) return;
    if (!navigator.geolocation) {
      setGeofenceMessage({
        text: 'Geolocation is not supported by your browser.',
        type: 'error',
      });
      return;
    }

    setGeofenceMessage({
      text: 'Getting your location... Allow location access when prompted.',
      type: 'info',
    });
    navigator.geolocation.getCurrentPosition(
      (position) => {
        addFencePoint({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
        setGeofenceForm((current) => ({
          ...current,
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        }));
        setGeofenceMessage({
          text: 'Your location was added as a boundary point.',
          type: 'success',
        });
      },
      () => {
        setGeofenceMessage({
          text: 'Could not get your location. Allow location access or add a point on the map.',
          type: 'error',
        });
      },
    );
  }

  async function loadAttendance(dateKey) {
    if (!ensureAdmin()) return;
    setAttendanceLoading(true);
    setAttendanceRows([]);
    setAttendanceMessage({ text: '', type: 'info' });
    try {
      const rows = await getAttendanceRows(dateKey, user.sessionToken);
      setAttendanceRows(rows);
    } catch (error) {
      setAttendanceMessage({
        text: error instanceof Error ? error.message : 'Could not load attendance.',
        type: 'error',
      });
    } finally {
      setAttendanceLoading(false);
    }
  }

  function refreshAttendance() {
    loadAttendance(attendanceDate);
  }

  function changeAttendanceDate(dateKey) {
    const minDate = getAttendanceRetentionStartDate();
    const maxDate = getLocalDateKey();
    if (dateKey < minDate || dateKey > maxDate) return;
    setAttendanceDate(dateKey);
    loadAttendance(dateKey);
  }

  function navigateAttendanceDate(days) {
    const date = new Date(`${attendanceDate}T12:00:00`);
    date.setDate(date.getDate() + days);
    changeAttendanceDate(getLocalDateKey(date));
  }

  function updateWorkerAccount(field, value) {
    setWorkerAccount((current) => ({ ...current, [field]: value }));
  }

  async function createWorkerAccount(event) {
    event.preventDefault();
    if (!ensureAdmin()) return;
    if (!plantSupportReady) {
      setAccountMessage({
        text: 'Update the Apps Script deployment to enable plant assignments before creating worker accounts.',
        type: 'error',
      });
      return;
    }
    if (!PLANTS.includes(plantFilter)) {
      setAccountMessage({
        text: 'Choose Plant 1 or Plant 2 in the plant dropdown before creating a worker.',
        type: 'error',
      });
      return;
    }

    const account = {
      name: workerAccount.name.trim(),
      punchingNumber: workerAccount.punchingNumber.trim(),
      password: workerAccount.password,
      plant: plantFilter,
    };
    if (!account.name || !account.punchingNumber || !account.password) {
      setAccountMessage({ text: 'Complete all worker account fields.', type: 'error' });
      return;
    }
    if (account.password.length < 8) {
      setAccountMessage({ text: 'Use a worker password with at least 8 characters.', type: 'error' });
      return;
    }

    setAccountSaving(true);
    setAccountMessage({ text: 'Creating worker account...', type: 'info' });
    try {
      await addWorkerAccount(user.sessionToken, account);
      setWorkerAccount({ name: '', punchingNumber: '', password: '' });
      setAccountMessage({
        text: `Worker account created for ${account.name}. Give them their punching number and password.`,
        type: 'success',
      });
      await loadWorkerAccounts();
    } catch (error) {
      setAccountMessage({
        text: error instanceof Error ? error.message : 'Could not create the worker account.',
        type: 'error',
      });
    } finally {
      setAccountSaving(false);
    }
  }

  async function loadWorkerAccounts() {
    if (!ensureAdmin()) return;
    setWorkersLoading(true);
    setPlantSupportReady(false);
    try {
      const response = await getWorkerAccounts(user.sessionToken);
      if (!response || response.plantField !== true || !Array.isArray(response.workers)) {
        throw new Error(
          'Plant assignments are not enabled in the Apps Script deployment. Update Code.gs and deploy a new version.',
        );
      }
      const accounts = response.workers;
      if (accounts.some((account) =>
        !account ||
        typeof account.name !== 'string' ||
        typeof account.punchingNumber !== 'string' ||
        typeof account.plant !== 'string'
      )) {
        throw new Error('The worker list response was invalid. Contact your administrator.');
      }
      setWorkerAccounts(accounts);
      setPlantSupportReady(true);
    } catch (error) {
      setAccountMessage({
        text: error instanceof Error ? error.message : 'Could not load worker accounts.',
        type: 'error',
      });
    } finally {
      setWorkersLoading(false);
    }
  }

  async function deleteWorkerAccount(account) {
    if (!ensureAdmin()) return;
    const confirmed = window.confirm(
      `Remove ${account.name} (${account.punchingNumber})? They will no longer be able to sign in.`,
    );
    if (!confirmed) return;

    setRemovingWorker(account.punchingNumber);
    setAccountMessage({ text: `Removing ${account.name}...`, type: 'info' });
    try {
      await removeWorkerAccount(user.sessionToken, account.punchingNumber);
      setWorkerAccounts((current) =>
        current.filter((worker) => worker.punchingNumber !== account.punchingNumber),
      );
      setAccountMessage({
        text: `${account.name} was removed. Their existing attendance records are retained.`,
        type: 'success',
      });
    } catch (error) {
      setAccountMessage({
        text: error instanceof Error ? error.message : 'Could not remove the worker account.',
        type: 'error',
      });
    } finally {
      setRemovingWorker('');
    }
  }

  function ensureAdmin() {
    if (isAdmin()) return true;
    window.alert('Only an authenticated admin can perform this action.');
    onLogout();
    return false;
  }

  const attendanceStatusByPunchingNumber = new Map(
    attendanceRows.map((row) => [row.punchingNumber, row.status]),
  );
  const attendanceUnavailable = attendanceLoading || attendanceMessage.type === 'error';

  function getWorkerAttendanceStatus(punchingNumber) {
    if (attendanceLoading) return 'Loading...';
    if (attendanceMessage.type === 'error') return 'Unavailable';
    return attendanceStatusByPunchingNumber.get(punchingNumber) === 'Present'
      ? 'Present'
      : 'Absent';
  }

  const filteredWorkerAccounts = workerAccounts.filter((account) => {
    const matchesPlant =
      plantFilter === 'all' ||
      (plantFilter === 'unassigned'
        ? !account.plant
        : account.plant === plantFilter);
    if (!matchesPlant || workerStatusFilter === 'all' || attendanceUnavailable) {
      return matchesPlant;
    }

    const isPresent = getWorkerAttendanceStatus(account.punchingNumber) === 'Present';
    return workerStatusFilter === 'present' ? isPresent : !isPresent;
  });

  return (
    <section className="admin-page">
      <header className="admin-header">
        <div>
          <p className="eyebrow">Operations</p>
          <h1>Admin Dashboard</h1>
        </div>
        <button className="back-btn" type="button" onClick={onLogout}>
          Logout
        </button>
      </header>

      <nav className="admin-nav" aria-label="Admin sections">
        <a href="#geofence-panel" className="nav-pill">
          Geofence
        </a>
        <a href="#attendance-panel" className="nav-pill">
          Attendance
        </a>
        <a href="#security-panel" className="nav-pill">
          Accounts
        </a>
      </nav>

      <div className="stats-grid">
        <div className="stat-card">
          <span className="stat-label">Location status</span>
          <strong>{hasConfiguredGeofence(geofence) ? 'Configured' : 'Needs setup'}</strong>
        </div>
        <div className="stat-card">
          <span className="stat-label">Present on selected date</span>
          <strong>{attendanceRows.filter((row) => row.status === 'Present').length} workers</strong>
        </div>
        <div className="stat-card">
          <span className="stat-label">Security</span>
          <strong>Admin access</strong>
        </div>
      </div>

      <div className="admin-panels">
        <section id="geofence-panel" className="panel-card">
          <div className="panel-heading">
            <h2>Geofence Setup</h2>
            <span className="panel-tag">Office boundary</span>
          </div>
          <form onSubmit={saveBoundary}>
            <p className="section-copy">
              Mark the factory perimeter on the map. Attendance is accepted only inside the saved
              area. An existing circular boundary can be saved without adding points.
            </p>
            <GeofenceMap
              latitude={geofence.lat}
              longitude={geofence.lng}
              radius={geofence.radius}
              polygon={polygonPoints}
              onPointAdd={addFencePoint}
            />
            <div className="boundary-tools">
              <span className="boundary-count">
                {polygonPoints.length} point{polygonPoints.length === 1 ? '' : 's'} selected
              </span>
              <div className="boundary-actions">
                <button
                  className="secondary-btn"
                  type="button"
                  onClick={() => setPolygonPoints((current) => current.slice(0, -1))}
                  disabled={polygonPoints.length === 0}
                >
                  Undo last point
                </button>
                <button
                  className="secondary-btn"
                  type="button"
                  onClick={() => setPolygonPoints([])}
                  disabled={polygonPoints.length === 0}
                >
                  Clear points
                </button>
              </div>
            </div>
            <div className="google-maps-picker">
              <a
                className="google-maps-link"
                href={googleMapsUrl}
                target="_blank"
                rel="noreferrer"
              >
                Open Google Maps
              </a>
              <p className="map-hint">
                Paste a coordinate or Google Maps link to add that location as a boundary point.
              </p>
              <label htmlFor="google-maps-location">
                Add boundary point from Google Maps:
              </label>
              <input
                id="google-maps-location"
                type="text"
                inputMode="text"
                autoComplete="off"
                placeholder="e.g. 17.3850, 78.4867"
                value={googleMapsInput}
                onChange={(event) => setGoogleMapsInput(event.target.value)}
              />
              <button
                className="secondary-btn"
                type="button"
                onClick={importGoogleMapsLocation}
              >
                Add location as point
              </button>
            </div>
            <div className="button-row">
              <button type="submit">Save Factory Area</button>
              <button className="secondary-btn" type="button" onClick={useCurrentLocation}>
                Use my current location
              </button>
            </div>
            <p className={`admin-msg message-${geofenceMessage.type}`} role="status" aria-live="polite">
              {geofenceMessage.text}
            </p>
          </form>
        </section>

        <section id="attendance-panel" className="panel-card">
          <div className="panel-heading">
            <h2>Attendance History</h2>
            <span className="panel-tag">Past 3 months</span>
          </div>
          <div className="date-row">
            <div className="attendance-date-controls">
              <button
                className="secondary-btn date-nav-btn"
                type="button"
                onClick={() => navigateAttendanceDate(-1)}
                disabled={attendanceDate <= getAttendanceRetentionStartDate()}
                aria-label="Previous day"
              >
                Previous
              </button>
              <input
                id="attendance-date"
                aria-label="Attendance date"
                type="date"
                min={getAttendanceRetentionStartDate()}
                max={getLocalDateKey()}
                value={attendanceDate}
                onChange={(event) => changeAttendanceDate(event.target.value)}
              />
              <button
                className="secondary-btn date-nav-btn"
                type="button"
                onClick={() => navigateAttendanceDate(1)}
                disabled={attendanceDate >= getLocalDateKey()}
                aria-label="Next day"
              >
                Next
              </button>
            </div>
            <button
              className="secondary-btn refresh-btn"
              type="button"
              onClick={refreshAttendance}
              disabled={attendanceLoading}
            >
              Refresh List
            </button>
          </div>
          <p className={`admin-msg message-${attendanceMessage.type}`} role="status" aria-live="polite">
            {attendanceLoading ? 'Loading attendance...' : attendanceMessage.text}
          </p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Status</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                {attendanceRows.map((row) => (
                  <tr key={row.punchingNumber}>
                    <td>{row.name}</td>
                    <td className={row.status === 'Present' ? 'status-present' : 'status-absent'}>
                      {row.status}
                    </td>
                    <td>{row.time}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section id="security-panel" className="panel-card">
          <div className="panel-heading">
            <h2>Worker Accounts</h2>
            <span className="panel-tag">Administrator</span>
          </div>
          <p className="section-copy">
            Create worker sign-in details here. Their punching number and password will be checked
            against the private Workers sheet. Passwords are stored as salted hashes. All plants
            use the same factory geofence.
          </p>
          <div className="worker-account-controls">
            <div>
              <label htmlFor="plant-filter">Plant filter / new worker plant:</label>
              <select
                id="plant-filter"
                value={plantFilter}
                onChange={(event) => setPlantFilter(event.target.value)}
              >
                <option value="all">All plants</option>
                {PLANTS.map((plant) => (
                  <option key={plant} value={plant}>{plant}</option>
                ))}
                <option value="unassigned">Unassigned</option>
              </select>
            </div>
            <div>
              <label htmlFor="worker-status-filter">Attendance status:</label>
              <select
                id="worker-status-filter"
                value={workerStatusFilter}
                onChange={(event) => setWorkerStatusFilter(event.target.value)}
              >
                <option value="all">Present and absent</option>
                <option value="present">Present</option>
                <option value="absent">Absent</option>
              </select>
            </div>
            <p className="map-hint">
              New workers use the selected plant. Attendance status is based on the selected date
              in Attendance History.
              {attendanceLoading ? ' Loading attendance...' : ''}
              {!attendanceLoading && attendanceMessage.type === 'error'
                ? ' Attendance status could not be loaded.'
                : ''}
            </p>
          </div>
          <div className="table-scroll">
            <table className="worker-account-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Punching Number</th>
                  <th>Plant</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredWorkerAccounts.map((account) => (
                  <tr key={account.punchingNumber}>
                    <td>{account.name}</td>
                    <td>{account.punchingNumber}</td>
                    <td>{account.plant || 'Unassigned'}</td>
                    <td className={
                      attendanceUnavailable
                        ? ''
                        : getWorkerAttendanceStatus(account.punchingNumber) === 'Present'
                          ? 'status-present'
                          : 'status-absent'
                    }>
                      {getWorkerAttendanceStatus(account.punchingNumber)}
                    </td>
                    <td>
                      <button
                        className="danger-btn"
                        type="button"
                        onClick={() => deleteWorkerAccount(account)}
                        disabled={Boolean(removingWorker)}
                      >
                        {removingWorker === account.punchingNumber ? 'Removing...' : 'Remove'}
                      </button>
                    </td>
                  </tr>
                ))}
                {!workersLoading && filteredWorkerAccounts.length === 0 && (
                  <tr>
                    <td colSpan="5">
                      {workerAccounts.length === 0
                        ? 'No worker accounts have been added.'
                        : 'No workers match this plant.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {workersLoading && <p className="section-copy">Loading worker accounts...</p>}
          <form onSubmit={createWorkerAccount}>
            <label htmlFor="worker-name">Worker name:</label>
            <input
              id="worker-name"
              type="text"
              autoComplete="off"
              maxLength={150}
              value={workerAccount.name}
              onChange={(event) => updateWorkerAccount('name', event.target.value)}
            />
            <label htmlFor="worker-punching-number">Worker punching number:</label>
            <input
              id="worker-punching-number"
              type="text"
              inputMode="text"
              autoComplete="off"
              maxLength={100}
              value={workerAccount.punchingNumber}
              onChange={(event) => updateWorkerAccount('punchingNumber', event.target.value)}
            />
            <label htmlFor="worker-password">Worker password (at least 8 characters):</label>
            <input
              id="worker-password"
              type="password"
              autoComplete="new-password"
              maxLength={128}
              value={workerAccount.password}
              onChange={(event) => updateWorkerAccount('password', event.target.value)}
            />
            <button type="submit" disabled={accountSaving || !plantSupportReady}>
              {accountSaving ? 'Creating account...' : 'Create Worker Account'}
            </button>
            <p className={`admin-msg message-${accountMessage.type}`} role="status" aria-live="polite">
              {accountMessage.text}
            </p>
          </form>
        </section>
      </div>
    </section>
  );
}
