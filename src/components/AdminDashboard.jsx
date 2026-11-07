import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getAttendanceRows } from '../utils/attendance.js';
import { hasConfiguredGeofence, isValidGeofencePolygon } from '../utils/geofence.js';
import { parseGoogleMapsLocation } from '../utils/googleMaps.js';
import {
  addWorkerAccount,
  assignStoredDocument,
  deleteStoredDocument,
  getStoredDocument,
  getWorkerAccounts,
  getSharedGeofence,
  listStoredDocuments,
  removeWorkerAccount,
  saveSharedGeofence,
  uploadStoredDocument,
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
const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;
const DOCUMENT_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const DOCUMENT_PLANTS = [
  { value: 'power-plant', label: 'POWER PLANT' },
  { value: 'brine-plant', label: 'BRINE PLANT' },
  { value: 'hcl-plant', label: 'HCL PLANT' },
  { value: 'cell-house', label: 'CELL HOUSE' },
  { value: 'fatty-acid', label: 'FATTY ACID' },
  { value: 'fussion-plant', label: 'FUSSION PLANT' },
  { value: 'cms-mech', label: 'CMS MECH' },
  { value: 'cms-process', label: 'CMS PROCESS' },
];
const DOCUMENT_CONTRACTORS = [
  { value: 'k-chalapathi-works', label: 'K.CHALAPATHI WORKS' },
  { value: 'k-venkatamallapa-naidu', label: 'K. VENKATAMALLAPA NAIDU' },
  { value: 't-reddy-prakash', label: 'T.REDDY PRAKASH' },
  { value: 't-nagarajamma', label: 'T.NAGARAJAMMA' },
  { value: 'v-venkataramana', label: 'V.VENKATARAMANA' },
  { value: 'k-siva-rani', label: 'K.SIVA RANI' },
  { value: 'v-lakshmi-devi', label: 'V.LAKSHMI DEVI' },
  { value: 'mahadeva-experts', label: 'MAHADEVA EXPERTS' },
];

export default function AdminDashboard({ user, onLogout }) {
  const [activeSection, setActiveSection] = useState('attendance');
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
  const [removalTarget, setRemovalTarget] = useState(null);
  const [removalPassword, setRemovalPassword] = useState('');
  const [removalError, setRemovalError] = useState('');
  const [plantFilter, setPlantFilter] = useState('all');
  const [workerStatusFilter, setWorkerStatusFilter] = useState('all');
  const [plantSupportReady, setPlantSupportReady] = useState(false);
  const [documentMonth, setDocumentMonth] = useState(() => getLocalDateKey().slice(0, 7));
  const [documentCategory, setDocumentCategory] = useState('bill-copy');
  const [documentWorkType, setDocumentWorkType] = useState('steam-line');
  const [documentPlantFilter, setDocumentPlantFilter] = useState('all');
  const [documentContractorFilter, setDocumentContractorFilter] = useState('all');
  const [documentUploadPlant, setDocumentUploadPlant] = useState('');
  const [documentUploadContractor, setDocumentUploadContractor] = useState('');
  const [documents, setDocuments] = useState([]);
  const [documentsLoading, setDocumentsLoading] = useState(false);
  const [documentMessage, setDocumentMessage] = useState({ text: '', type: 'info' });
  const [documentUploading, setDocumentUploading] = useState(false);
  const [previewingDocument, setPreviewingDocument] = useState('');
  const [documentPreview, setDocumentPreview] = useState(null);
  const [documentPreviewError, setDocumentPreviewError] = useState('');
  const [documentDeleteTarget, setDocumentDeleteTarget] = useState(null);
  const [documentDeletePassword, setDocumentDeletePassword] = useState('');
  const [documentDeleteError, setDocumentDeleteError] = useState('');
  const [deletingDocument, setDeletingDocument] = useState(false);
  const [documentAssignmentTarget, setDocumentAssignmentTarget] = useState(null);
  const [documentAssignmentWorkType, setDocumentAssignmentWorkType] = useState('steam-line');
  const [documentAssignmentPlant, setDocumentAssignmentPlant] = useState('');
  const [documentAssignmentContractor, setDocumentAssignmentContractor] = useState('');
  const [documentAssignmentError, setDocumentAssignmentError] = useState('');
  const [assigningDocument, setAssigningDocument] = useState(false);
  const documentFileInput = useRef(null);
  const documentCameraInput = useRef(null);
  const [documentFile, setDocumentFile] = useState(null);

  useEffect(() => {
    loadAttendance(getLocalDateKey());
    loadSharedBoundary();
    loadWorkerAccounts();
  }, []);

  useEffect(() => {
    if (!removalTarget || removingWorker) return undefined;

    function handleDialogKeyDown(event) {
      if (event.key === 'Escape') closeRemovalDialog();
    }

    window.addEventListener('keydown', handleDialogKeyDown);
    return () => window.removeEventListener('keydown', handleDialogKeyDown);
  }, [removalTarget, removingWorker]);

  useEffect(() => {
    if (activeSection !== 'documents') return undefined;
    let active = true;
    setDocumentsLoading(true);
    setDocumentMessage({ text: '', type: 'info' });
    listStoredDocuments(user.sessionToken, documentMonth)
      .then((response) => {
        if (!Array.isArray(response) || response.some((document) =>
          !document ||
          typeof document.id !== 'string' ||
          typeof document.name !== 'string' ||
          !['bill-copy', 'work-order'].includes(document.category) ||
          !['steam-line', 'manpower-supply', 'uncategorized'].includes(document.workType) ||
          ![...DOCUMENT_PLANTS.map((plant) => plant.value), 'uncategorized'].includes(document.plant) ||
          ![...DOCUMENT_CONTRACTORS.map((contractor) => contractor.value), 'uncategorized'].includes(document.contractor) ||
          !DOCUMENT_MIME_TYPES.includes(document.mimeType) ||
          typeof document.size !== 'number' ||
          typeof document.createdAt !== 'string'
        )) {
          throw new Error('The saved documents response was invalid.');
        }
        if (active) setDocuments(response);
      })
      .catch((error) => {
        if (active) {
          setDocuments([]);
          setDocumentMessage({
            text: error instanceof Error ? error.message : 'Could not load saved documents.',
            type: 'error',
          });
        }
      })
      .finally(() => {
        if (active) setDocumentsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [activeSection, documentMonth, user.sessionToken]);

  useEffect(() => {
    if (!documentPreview) return undefined;

    function handlePreviewKeyDown(event) {
      if (event.key === 'Escape') setDocumentPreview(null);
    }

    window.addEventListener('keydown', handlePreviewKeyDown);
    return () => window.removeEventListener('keydown', handlePreviewKeyDown);
  }, [documentPreview]);

  useEffect(() => {
    if (!documentDeleteTarget || deletingDocument) return undefined;

    function handleDeleteKeyDown(event) {
      if (event.key === 'Escape') closeDocumentDeleteDialog();
    }

    window.addEventListener('keydown', handleDeleteKeyDown);
    return () => window.removeEventListener('keydown', handleDeleteKeyDown);
  }, [documentDeleteTarget, deletingDocument]);

  useEffect(() => {
    if (!documentAssignmentTarget || assigningDocument) return undefined;

    function handleAssignmentKeyDown(event) {
      if (event.key === 'Escape') closeDocumentAssignmentDialog();
    }

    window.addEventListener('keydown', handleAssignmentKeyDown);
    return () => window.removeEventListener('keydown', handleAssignmentKeyDown);
  }, [documentAssignmentTarget, assigningDocument]);

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

  async function uploadDocument(event) {
    event.preventDefault();
    if (!ensureAdmin()) return;

    const file = documentFile;
    if (!file) {
      setDocumentMessage({ text: 'Choose a bill copy or work order to upload.', type: 'error' });
      return;
    }
    if (file.size > MAX_DOCUMENT_BYTES) {
      setDocumentMessage({ text: 'Each document must be 8 MB or smaller.', type: 'error' });
      return;
    }
    if (!DOCUMENT_MIME_TYPES.includes(file.type)) {
      setDocumentMessage({
        text: 'Choose a JPG, PNG, WebP image, or PDF file.',
        type: 'error',
      });
      return;
    }
    if (!documentUploadPlant || !documentUploadContractor) {
      setDocumentMessage({
        text: 'Choose a plant and contractor before uploading.',
        type: 'error',
      });
      return;
    }

    setDocumentUploading(true);
    setDocumentMessage({ text: 'Uploading document...', type: 'info' });
    try {
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          if (typeof reader.result !== 'string') {
            reject(new Error('The selected document could not be read.'));
            return;
          }
          resolve(reader.result.slice(reader.result.indexOf(',') + 1));
        };
        reader.onerror = () => reject(reader.error || new Error('The selected document could not be read.'));
        reader.readAsDataURL(file);
      });
      const savedDocument = await uploadStoredDocument(user.sessionToken, {
        month: documentMonth,
        category: documentCategory,
        workType: documentWorkType,
        plant: documentUploadPlant,
        contractor: documentUploadContractor,
        name: file.name,
        mimeType: file.type,
        base64,
      });
      if (
        savedDocument &&
        typeof savedDocument.id === 'string' &&
        typeof savedDocument.name === 'string' &&
        (
          savedDocument.plant !== documentUploadPlant ||
          savedDocument.contractor !== documentUploadContractor
        )
      ) {
        throw new Error(
          'The document may already be saved, but the deployed Apps Script did not return its plant and contractor assignments. Update apps-script/Code.gs and deploy a new web app version, then check this month before uploading again to avoid a duplicate.',
        );
      }
      if (
        !savedDocument ||
        typeof savedDocument.id !== 'string' ||
        typeof savedDocument.name !== 'string' ||
        !['bill-copy', 'work-order'].includes(savedDocument.category) ||
        savedDocument.workType !== documentWorkType ||
        savedDocument.plant !== documentUploadPlant ||
        savedDocument.contractor !== documentUploadContractor ||
        !DOCUMENT_MIME_TYPES.includes(savedDocument.mimeType) ||
        typeof savedDocument.size !== 'number' ||
        typeof savedDocument.createdAt !== 'string'
      ) {
        throw new Error('The saved document response was invalid.');
      }
      setDocuments((current) => [savedDocument, ...current]);
      setDocumentMessage({ text: `${file.name} was saved for ${documentMonth}.`, type: 'success' });
      if (documentFileInput.current) documentFileInput.current.value = '';
      if (documentCameraInput.current) documentCameraInput.current.value = '';
      setDocumentFile(null);
    } catch (error) {
      setDocumentMessage({
        text: error instanceof Error ? error.message : 'Could not upload the document.',
        type: 'error',
      });
    } finally {
      setDocumentUploading(false);
    }
  }

  async function openDocumentPreview(document) {
    if (!ensureAdmin()) return;

    setPreviewingDocument(document.id);
    setDocumentPreviewError('');
    try {
      const content = await getStoredDocument(user.sessionToken, document.id);
      if (
        !content ||
        content.id !== document.id ||
        content.name !== document.name ||
        content.mimeType !== document.mimeType ||
        typeof content.base64 !== 'string' ||
        !content.base64
      ) {
        throw new Error('The document preview response was invalid.');
      }
      setDocumentPreview({
        ...document,
        dataUrl: `data:${content.mimeType};base64,${content.base64}`,
      });
    } catch (error) {
      setDocumentPreviewError(
        error instanceof Error ? error.message : 'Could not open this document.',
      );
    } finally {
      setPreviewingDocument('');
    }
  }

  function openDocumentAssignmentDialog(document) {
    if (!ensureAdmin()) return;
    setDocumentAssignmentTarget(document);
    setDocumentAssignmentWorkType(
      document.workType === 'manpower-supply' ? 'manpower-supply' : 'steam-line',
    );
    setDocumentAssignmentPlant(
      document.plant === 'uncategorized' ? '' : document.plant,
    );
    setDocumentAssignmentContractor(
      document.contractor === 'uncategorized' ? '' : document.contractor,
    );
    setDocumentAssignmentError('');
  }

  function closeDocumentAssignmentDialog() {
    if (assigningDocument) return;
    setDocumentAssignmentTarget(null);
    setDocumentAssignmentError('');
  }

  async function saveDocumentAssignment(event) {
    event.preventDefault();
    if (!ensureAdmin() || !documentAssignmentTarget) return;

    setAssigningDocument(true);
    setDocumentAssignmentError('');
    try {
      const updatedDocument = await assignStoredDocument(user.sessionToken, {
        month: documentMonth,
        fileId: documentAssignmentTarget.id,
        category: documentAssignmentTarget.category,
        workType: documentAssignmentWorkType,
        plant: documentAssignmentPlant,
        contractor: documentAssignmentContractor,
      });
      if (
        !updatedDocument ||
        updatedDocument.id !== documentAssignmentTarget.id ||
        updatedDocument.category !== documentAssignmentTarget.category ||
        updatedDocument.workType !== documentAssignmentWorkType ||
        updatedDocument.plant !== documentAssignmentPlant ||
        updatedDocument.contractor !== documentAssignmentContractor
      ) {
        throw new Error('The document assignment response was invalid.');
      }

      setDocuments((current) => current.map((document) =>
        document.id === updatedDocument.id ? { ...document, ...updatedDocument } : document,
      ));
      setDocumentAssignmentTarget(null);
      setDocumentMessage({
        text: `${updatedDocument.name} was organized successfully.`,
        type: 'success',
      });
    } catch (error) {
      setDocumentAssignmentError(
        error instanceof Error ? error.message : 'Could not organize the document.',
      );
    } finally {
      setAssigningDocument(false);
    }
  }

  function openDocumentDeleteDialog(document) {
    if (!ensureAdmin()) return;
    setDocumentDeleteTarget(document);
    setDocumentDeletePassword('');
    setDocumentDeleteError('');
  }

  function closeDocumentDeleteDialog() {
    if (deletingDocument) return;
    setDocumentDeleteTarget(null);
    setDocumentDeletePassword('');
    setDocumentDeleteError('');
  }

  async function confirmDocumentDeletion(event) {
    event.preventDefault();
    if (!ensureAdmin() || !documentDeleteTarget) return;

    setDeletingDocument(true);
    setDocumentDeleteError('');
    try {
      const result = await deleteStoredDocument(
        user.sessionToken,
        documentMonth,
        documentDeleteTarget.id,
        documentDeleteTarget.category,
        documentDeleteTarget.workType,
        documentDeleteTarget.plant,
        documentDeleteTarget.contractor,
        documentDeletePassword,
      );
      if (!result || result.id !== documentDeleteTarget.id || result.deleted !== true) {
        throw new Error('The document deletion response was invalid.');
      }

      setDocuments((current) =>
        current.filter((document) => document.id !== documentDeleteTarget.id),
      );
      setDocumentMessage({
        text: `${documentDeleteTarget.name} was moved to Google Drive trash.`,
        type: 'success',
      });
      setDocumentDeleteTarget(null);
      setDocumentDeletePassword('');
    } catch (error) {
      setDocumentDeleteError(
        error instanceof Error ? error.message : 'Could not delete the document.',
      );
    } finally {
      setDeletingDocument(false);
    }
  }

  function openRemovalDialog(account) {
    if (!ensureAdmin()) return;
    setRemovalTarget(account);
    setRemovalPassword('');
    setRemovalError('');
  }

  function closeRemovalDialog() {
    if (removingWorker) return;
    setRemovalTarget(null);
    setRemovalPassword('');
    setRemovalError('');
  }

  async function confirmWorkerRemoval(event) {
    event.preventDefault();
    if (!ensureAdmin() || !removalTarget) return;

    const account = removalTarget;
    setRemovingWorker(account.punchingNumber);
    setRemovalError('');
    try {
      await removeWorkerAccount(user.sessionToken, account.punchingNumber, removalPassword);
      setWorkerAccounts((current) =>
        current.filter((worker) => worker.punchingNumber !== account.punchingNumber),
      );
      setAccountMessage({
        text: `${account.name} was removed. Their existing attendance records are retained.`,
        type: 'success',
      });
      setRemovalTarget(null);
      setRemovalPassword('');
    } catch (error) {
      setRemovalError(error instanceof Error ? error.message : 'Could not remove the worker account.');
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
  const filteredDocuments = documents.filter(
    (document) =>
      document.category === documentCategory &&
      document.workType === documentWorkType &&
      (documentPlantFilter === 'all' || document.plant === documentPlantFilter) &&
      (documentContractorFilter === 'all' ||
        document.contractor === documentContractorFilter),
  );
  const documentCategoryLabel = documentCategory === 'bill-copy' ? 'bill copy' : 'work order';
  const documentWorkTypeLabels = {
    'steam-line': 'Steam Line',
    'manpower-supply': 'Manpower Supply',
    uncategorized: 'Uncategorized',
  };
  const documentWorkTypeLabel = documentWorkTypeLabels[documentWorkType];
  const documentPlantLabel = (value) =>
    DOCUMENT_PLANTS.find((plant) => plant.value === value)?.label || 'Uncategorized';
  const documentContractorLabel = (value) =>
    DOCUMENT_CONTRACTORS.find((contractor) => contractor.value === value)?.label ||
    'Uncategorized';

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
        <button
          id="geofence-tab"
          type="button"
          className={`nav-pill ${activeSection === 'geofence' ? 'active' : ''}`}
          aria-pressed={activeSection === 'geofence'}
          aria-controls="admin-content-panel"
          onClick={() => setActiveSection('geofence')}
        >
          Geofence
        </button>
        <button
          id="attendance-tab"
          type="button"
          className={`nav-pill ${activeSection === 'attendance' ? 'active' : ''}`}
          aria-pressed={activeSection === 'attendance'}
          aria-controls="admin-content-panel"
          onClick={() => setActiveSection('attendance')}
        >
          Attendance
        </button>
        <button
          id="accounts-tab"
          type="button"
          className={`nav-pill ${activeSection === 'accounts' ? 'active' : ''}`}
          aria-pressed={activeSection === 'accounts'}
          aria-controls="admin-content-panel"
          onClick={() => setActiveSection('accounts')}
        >
          Accounts
        </button>
        <button
          id="documents-tab"
          type="button"
          className={`nav-pill ${activeSection === 'documents' ? 'active' : ''}`}
          aria-pressed={activeSection === 'documents'}
          aria-controls="admin-content-panel"
          onClick={() => setActiveSection('documents')}
        >
          Documents
        </button>
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

      <section
        id="admin-content-panel"
        className="admin-panels"
        aria-labelledby={`${activeSection}-tab`}
      >
        {activeSection === 'geofence' && <section className="panel-card">
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
        </section>}

        {activeSection === 'attendance' && <section className="panel-card">
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
        </section>}

        {activeSection === 'accounts' && <section className="panel-card">
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
                        onClick={() => openRemovalDialog(account)}
                        disabled={Boolean(removingWorker)}
                      >
                        Remove
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
        </section>}

        {activeSection === 'documents' && <section className="panel-card">
          <div className="panel-heading">
            <h2>Monthly Documents</h2>
            <span className="panel-tag">Bills &amp; work orders</span>
          </div>
          <p className="section-copy">
            Upload and view private bill copies and work orders here. Documents are stored securely
            and organized by month; only administrators can access them.
          </p>
          <div className="document-category-nav" role="group" aria-label="Document category">
            <button
              type="button"
              className={`nav-pill ${documentCategory === 'bill-copy' ? 'active' : ''}`}
              aria-pressed={documentCategory === 'bill-copy'}
              onClick={() => setDocumentCategory('bill-copy')}
            >
              Bill Copies
            </button>
            <button
              type="button"
              className={`nav-pill ${documentCategory === 'work-order' ? 'active' : ''}`}
              aria-pressed={documentCategory === 'work-order'}
              onClick={() => setDocumentCategory('work-order')}
            >
              Work Orders
            </button>
          </div>
          <div className="document-work-type-nav" role="group" aria-label="Work type">
            <button
              type="button"
              className={`nav-pill ${documentWorkType === 'steam-line' ? 'active' : ''}`}
              aria-pressed={documentWorkType === 'steam-line'}
              onClick={() => setDocumentWorkType('steam-line')}
            >
              Steam Line
            </button>
            <button
              type="button"
              className={`nav-pill ${documentWorkType === 'manpower-supply' ? 'active' : ''}`}
              aria-pressed={documentWorkType === 'manpower-supply'}
              onClick={() => setDocumentWorkType('manpower-supply')}
            >
              Manpower Supply
            </button>
            <button
              type="button"
              className={`nav-pill ${documentWorkType === 'uncategorized' ? 'active' : ''}`}
              aria-pressed={documentWorkType === 'uncategorized'}
              onClick={() => setDocumentWorkType('uncategorized')}
            >
              Uncategorized
            </button>
          </div>
          <form className="document-upload-form" onSubmit={uploadDocument}>
            <p className="document-upload-label">
              {documentWorkType === 'uncategorized'
                ? 'Select Steam Line or Manpower Supply before uploading a document.'
                : `Upload a ${documentWorkTypeLabel} ${documentCategoryLabel} for ${documentMonth}`}
            </p>
            <label htmlFor="document-upload-plant">Plant:</label>
            <select
              id="document-upload-plant"
              value={documentUploadPlant}
              disabled={documentUploading}
              required
              onChange={(event) => setDocumentUploadPlant(event.target.value)}
            >
              <option value="">Choose plant</option>
              {DOCUMENT_PLANTS.map((plant) => (
                <option key={plant.value} value={plant.value}>{plant.label}</option>
              ))}
            </select>
            <label htmlFor="document-upload-contractor">Contractor:</label>
            <select
              id="document-upload-contractor"
              value={documentUploadContractor}
              disabled={documentUploading}
              required
              onChange={(event) => setDocumentUploadContractor(event.target.value)}
            >
              <option value="">Choose contractor</option>
              {DOCUMENT_CONTRACTORS.map((contractor) => (
                <option key={contractor.value} value={contractor.value}>{contractor.label}</option>
              ))}
            </select>
            <label htmlFor="document-file">Choose an image or PDF (8 MB max):</label>
            <input
              ref={documentFileInput}
              id="document-file"
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              disabled={documentUploading}
              onChange={(event) => setDocumentFile(event.target.files?.[0] || null)}
            />
            <input
              ref={documentCameraInput}
              className="document-camera-input"
              type="file"
              accept="image/*"
              capture="environment"
              aria-label="Take a document photo with the camera"
              disabled={documentUploading}
              onChange={(event) => setDocumentFile(event.target.files?.[0] || null)}
            />
            <button
              className="document-camera-button"
              type="button"
              disabled={documentUploading}
              onClick={() => documentCameraInput.current?.click()}
            >
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M4 7.5h3l1.5-2h7l1.5 2h3A1.5 1.5 0 0 1 21.5 9v9a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 18V9A1.5 1.5 0 0 1 4 7.5Z" />
                <circle cx="12" cy="13" r="3.5" />
              </svg>
              Take photo
            </button>
            {documentFile && (
              <p className="document-selected-file" aria-live="polite">
                Selected: {documentFile.name}
              </p>
            )}
            <button
              type="submit"
              disabled={
                documentUploading ||
                documentWorkType === 'uncategorized' ||
                !documentUploadPlant ||
                !documentUploadContractor
              }
            >
              {documentUploading
                ? 'Uploading...'
                : `Upload ${documentWorkTypeLabel} ${documentCategoryLabel}`}
            </button>
          </form>
          <p className={`admin-msg message-${documentMessage.type}`} role="status" aria-live="polite">
            {documentMessage.text}
          </p>
          {documentPreviewError && (
            <p className="admin-msg message-error" role="alert">
              {documentPreviewError}
            </p>
          )}
          <div className="document-filters">
            <div>
              <label htmlFor="document-plant-filter">Filter by plant:</label>
              <select
                id="document-plant-filter"
                value={documentPlantFilter}
                onChange={(event) => setDocumentPlantFilter(event.target.value)}
              >
                <option value="all">All plants</option>
                {DOCUMENT_PLANTS.map((plant) => (
                  <option key={plant.value} value={plant.value}>{plant.label}</option>
                ))}
                <option value="uncategorized">Uncategorized</option>
              </select>
            </div>
            <div>
              <label htmlFor="document-contractor-filter">Filter by contractor:</label>
              <select
                id="document-contractor-filter"
                value={documentContractorFilter}
                onChange={(event) => setDocumentContractorFilter(event.target.value)}
              >
                <option value="all">All contractors</option>
                {DOCUMENT_CONTRACTORS.map((contractor) => (
                  <option key={contractor.value} value={contractor.value}>{contractor.label}</option>
                ))}
                <option value="uncategorized">Uncategorized</option>
              </select>
            </div>
          </div>
          <div className="document-month-picker">
            <label htmlFor="document-month">Choose month:</label>
            <input
              id="document-month"
              type="month"
              value={documentMonth}
              disabled={documentUploading}
              onChange={(event) => {
                if (event.target.value) setDocumentMonth(event.target.value);
              }}
            />
          </div>
          {documentsLoading ? (
            <p className="section-copy">Loading documents for {documentMonth}...</p>
          ) : filteredDocuments.length > 0 ? (
            <div
              className="document-list"
              aria-label={`${documentCategory === 'bill-copy' ? 'Bill copies' : 'Work orders'} for ${documentMonth}`}
            >
              {filteredDocuments.map((document) => (
                <article className="document-card" key={document.id}>
                  <div className="document-card-copy">
                    <span className="document-category">
                      {documentWorkTypeLabels[document.workType]} · {documentPlantLabel(document.plant)} ·{' '}
                      {documentContractorLabel(document.contractor)}
                    </span>
                    <strong title={document.name}>
                      {document.name}
                      <span className="document-file-category">
                        {document.category === 'bill-copy' ? 'Bill copy' : 'Work order'}
                      </span>
                    </strong>
                    <span className="document-meta">
                      {new Date(document.createdAt).toLocaleDateString()} ·{' '}
                      {document.size < 1024 * 1024
                        ? `${Math.max(1, Math.round(document.size / 1024))} KB`
                        : `${(document.size / (1024 * 1024)).toFixed(1)} MB`}
                    </span>
                  </div>
                  <div className="document-actions">
                    {(document.workType === 'uncategorized' ||
                      document.plant === 'uncategorized' ||
                      document.contractor === 'uncategorized') && (
                      <button
                        className="secondary-btn document-view-btn"
                        type="button"
                        onClick={() => openDocumentAssignmentDialog(document)}
                        disabled={Boolean(assigningDocument)}
                      >
                        Organize
                      </button>
                    )}
                    <button
                      className="secondary-btn document-view-btn"
                      type="button"
                      onClick={() => openDocumentPreview(document)}
                      disabled={Boolean(previewingDocument) || Boolean(deletingDocument)}
                    >
                      {previewingDocument === document.id ? 'Opening...' : 'View'}
                    </button>
                    <button
                      className="danger-btn document-delete-btn"
                      type="button"
                      onClick={() => openDocumentDeleteDialog(document)}
                      disabled={Boolean(deletingDocument) || Boolean(previewingDocument)}
                    >
                      Delete
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            !documentMessage.text && (
              <p className="document-empty">
                No {documentWorkTypeLabel.toLowerCase()} {documentCategory === 'bill-copy' ? 'bill copies' : 'work orders'} saved for {documentMonth} yet.
                Upload one above to add it here.
              </p>
            )
          )}
        </section>}
      </section>
      {removalTarget && createPortal(
        <div
          className="confirm-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeRemovalDialog();
          }}
        >
          <section
            className="confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="remove-worker-title"
            aria-describedby="remove-worker-description"
          >
            <h2 id="remove-worker-title">Confirm worker removal</h2>
            <p id="remove-worker-description">
              Remove {removalTarget.name} ({removalTarget.punchingNumber})? Enter your administrator
              password to confirm. Their attendance history will be retained.
            </p>
            <form onSubmit={confirmWorkerRemoval}>
              <label htmlFor="remove-worker-password">Administrator password</label>
              <input
                id="remove-worker-password"
                type="password"
                autoComplete="current-password"
                maxLength={128}
                autoFocus
                required
                value={removalPassword}
                onChange={(event) => {
                  setRemovalPassword(event.target.value);
                  setRemovalError('');
                }}
              />
              {removalError && (
                <p className="admin-msg message-error" role="alert">
                  {removalError}
                </p>
              )}
              <div className="confirm-dialog-actions">
                <button
                  className="secondary-btn"
                  type="button"
                  onClick={closeRemovalDialog}
                  disabled={Boolean(removingWorker)}
                >
                  Cancel
                </button>
                <button type="submit" className="danger-confirm-btn" disabled={Boolean(removingWorker)}>
                  {removingWorker ? 'Removing...' : 'Confirm removal'}
                </button>
              </div>
            </form>
          </section>
        </div>,
        document.body,
      )}
      {documentAssignmentTarget && createPortal(
        <div
          className="confirm-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeDocumentAssignmentDialog();
          }}
        >
          <section
            className="confirm-dialog document-assignment-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="organize-document-title"
          >
            <h2 id="organize-document-title">Organize document</h2>
            <p>{documentAssignmentTarget.name}</p>
            <form onSubmit={saveDocumentAssignment}>
              <label htmlFor="assign-document-work-type">Work type</label>
              <select
                id="assign-document-work-type"
                value={documentAssignmentWorkType}
                onChange={(event) => setDocumentAssignmentWorkType(event.target.value)}
                required
              >
                <option value="steam-line">Steam Line</option>
                <option value="manpower-supply">Manpower Supply</option>
              </select>
              <label htmlFor="assign-document-plant">Plant</label>
              <select
                id="assign-document-plant"
                value={documentAssignmentPlant}
                onChange={(event) => setDocumentAssignmentPlant(event.target.value)}
                required
              >
                <option value="">Choose plant</option>
                {DOCUMENT_PLANTS.map((plant) => (
                  <option key={plant.value} value={plant.value}>{plant.label}</option>
                ))}
              </select>
              <label htmlFor="assign-document-contractor">Contractor</label>
              <select
                id="assign-document-contractor"
                value={documentAssignmentContractor}
                onChange={(event) => setDocumentAssignmentContractor(event.target.value)}
                required
              >
                <option value="">Choose contractor</option>
                {DOCUMENT_CONTRACTORS.map((contractor) => (
                  <option key={contractor.value} value={contractor.value}>{contractor.label}</option>
                ))}
              </select>
              {documentAssignmentError && (
                <p className="admin-msg message-error" role="alert">
                  {documentAssignmentError}
                </p>
              )}
              <div className="confirm-dialog-actions">
                <button
                  className="secondary-btn"
                  type="button"
                  onClick={closeDocumentAssignmentDialog}
                  disabled={assigningDocument}
                >
                  Cancel
                </button>
                <button type="submit" disabled={assigningDocument || !documentAssignmentPlant || !documentAssignmentContractor}>
                  {assigningDocument ? 'Saving...' : 'Save categories'}
                </button>
              </div>
            </form>
          </section>
        </div>,
        document.body,
      )}
      {documentDeleteTarget && createPortal(
        <div
          className="confirm-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeDocumentDeleteDialog();
          }}
        >
          <section
            className="confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-document-title"
            aria-describedby="delete-document-description"
          >
            <h2 id="delete-document-title">Delete saved document?</h2>
            <p id="delete-document-description">
              Move {documentDeleteTarget.name} to Google Drive trash? Enter your administrator
              password to confirm. You can restore it from Drive trash.
            </p>
            <form onSubmit={confirmDocumentDeletion}>
              <label htmlFor="delete-document-password">Administrator password</label>
              <input
                id="delete-document-password"
                type="password"
                autoComplete="current-password"
                maxLength={128}
                autoFocus
                required
                value={documentDeletePassword}
                onChange={(event) => {
                  setDocumentDeletePassword(event.target.value);
                  setDocumentDeleteError('');
                }}
              />
              {documentDeleteError && (
                <p className="admin-msg message-error" role="alert">
                  {documentDeleteError}
                </p>
              )}
              <div className="confirm-dialog-actions">
                <button
                  className="secondary-btn"
                  type="button"
                  onClick={closeDocumentDeleteDialog}
                  disabled={deletingDocument}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="danger-confirm-btn"
                  disabled={deletingDocument}
                >
                  {deletingDocument ? 'Deleting...' : 'Confirm delete'}
                </button>
              </div>
            </form>
          </section>
        </div>,
        document.body,
      )}
      {documentPreview && createPortal(
        <div
          className="confirm-overlay document-preview-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setDocumentPreview(null);
          }}
        >
          <section
            className="document-preview-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="document-preview-title"
          >
            <header className="document-preview-header">
              <h2 id="document-preview-title">{documentPreview.name}</h2>
              <button
                className="secondary-btn document-close-btn"
                type="button"
                onClick={() => setDocumentPreview(null)}
                aria-label="Close document preview"
              >
                Close
              </button>
            </header>
            {documentPreview.mimeType === 'application/pdf' ? (
              <iframe
                className="document-pdf-preview"
                src={documentPreview.dataUrl}
                title={`Preview of ${documentPreview.name}`}
              />
            ) : (
              <img
                className="document-image-preview"
                src={documentPreview.dataUrl}
                alt={documentPreview.name}
              />
            )}
            <a
              className="document-download"
              href={documentPreview.dataUrl}
              download={documentPreview.name}
            >
              Download document
            </a>
          </section>
        </div>,
        document.body,
      )}
    </section>
  );
}
