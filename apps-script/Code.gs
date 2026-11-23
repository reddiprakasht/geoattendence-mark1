const WORKERS_SHEET = 'Workers';
const ATTENDANCE_SHEET = 'Attendance';
const WORK_ORDERS_SHEET = 'Work Orders';
const MONTHLY_BILLS_SHEET = 'Monthly Bills';
const WORK_ORDER_HEADERS = [
  'ID', 'Work Order Number', 'Category', 'Total Allotted Quantity', 'Start Date',
  'Duration Months', 'Document ID', 'Document Name', 'Document MIME Type', 'Created At',
  'Plant', 'Contractor', 'Status', 'Quantity Breakdown',
];
const MONTHLY_BILL_HEADERS = [
  'ID', 'Work Order ID', 'Billing Month', 'Bill Number', 'Billed Quantity',
  'Document ID', 'Document Name', 'Document MIME Type', 'Created At', 'Updated At', 'Quantity Breakdown',
];
const WORK_ORDER_CATEGORIES = ['Manpower', 'Online Steam Leakage'];
const MANPOWER_QUANTITY_TYPES = ['Fitter', 'Kalasi'];
const STEAM_LINE_QUANTITY_TYPES = ['2 Inch', '4 Inch', '6 Inch', '8 Inch', '10 Inch'];
const SESSION_TTL_SECONDS = 21600;
const PASSWORD_HASH_ITERATIONS = 10000;
const DOCUMENTS_FOLDER_NAME = 'GeoAttend Documents';
const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;
const DOCUMENT_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const DOCUMENT_WORK_TYPES = ['steam-line', 'manpower-supply', 'uncategorized'];
const DOCUMENT_PLANTS = [
  'power-plant',
  'brine-plant',
  'hcl-plant',
  'cell-house',
  'fatty-acid',
  'fussion-plant',
  'cms-mech',
  'cms-process',
];
const DOCUMENT_CONTRACTORS = [
  'k-chalapathi-works',
  'k-venkatamallapa-naidu',
  't-reddy-prakash',
  't-nagarajamma',
  'v-venkataramana',
  'k-siva-rani',
  'v-lakshmi-devi',
  'mahadeva-experts',
];

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

function prepareDocumentsFolder() {
  const properties = PropertiesService.getScriptProperties();
  const existingId = properties.getProperty('DOCUMENTS_FOLDER_ID');
  if (existingId) {
    const existingFolder = DriveApp.getFolderById(existingId);
    return 'Private document storage is ready: ' + existingFolder.getName();
  }

  const folder = DriveApp.createFolder(DOCUMENTS_FOLDER_NAME);
  properties.setProperty('DOCUMENTS_FOLDER_ID', folder.getId());
  return 'Private document storage is ready: ' + folder.getName();
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
  if (payload.action === 'workerAttendance') {
    if (session.role !== 'worker') throw new Error('Only worker accounts can view their attendance.');
    assertActiveWorker_(session);
    const dateKey = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    return getWorkerAttendance_(session, dateKey);
  }
  if (payload.action === 'workerAttendanceRange') {
    if (session.role !== 'worker') throw new Error('Only worker accounts can view their attendance.');
    assertActiveWorker_(session);
    return getWorkerAttendanceRange_(session, payload.startDate, payload.endDate);
  }
  if (payload.action === 'addWorker') {
    if (session.role !== 'admin') throw new Error('Only administrators can add worker accounts.');
    return addWorker_(payload);
  }
  if (payload.action === 'getWorkers') {
    if (session.role !== 'admin') throw new Error('Only administrators can view worker accounts.');
    return getWorkers_();
  }
  if (payload.action === 'assignWorker') {
    if (session.role !== 'admin') throw new Error('Only administrators can organize worker accounts.');
    assertActiveAdmin_(session);
    return assignWorker_(payload);
  }
  if (payload.action === 'removeWorker') {
    if (session.role !== 'admin') throw new Error('Only administrators can remove worker accounts.');
    verifyAdminPassword_(session, payload.adminPassword);
    return removeWorker_(payload);
  }
  if (payload.action === 'listDocuments') {
    if (session.role !== 'admin') throw new Error('Only administrators can view documents.');
    assertActiveAdmin_(session);
    return listDocuments_(payload.month);
  }
  if (payload.action === 'uploadDocument') {
    if (session.role !== 'admin') throw new Error('Only administrators can upload documents.');
    assertActiveAdmin_(session);
    return uploadDocument_(payload);
  }
  if (payload.action === 'assignDocument') {
    if (session.role !== 'admin') throw new Error('Only administrators can organize documents.');
    assertActiveAdmin_(session);
    return assignDocument_(payload);
  }
  if (payload.action === 'getDocument') {
    if (session.role !== 'admin') throw new Error('Only administrators can view documents.');
    assertActiveAdmin_(session);
    return getDocument_(payload.fileId);
  }
  if (payload.action === 'deleteDocument') {
    if (session.role !== 'admin') throw new Error('Only administrators can delete documents.');
    assertActiveAdmin_(session);
    verifyAdminPassword_(session, payload.adminPassword);
    return deleteDocument_(payload);
  }
  if (payload.action === 'listWorkOrders') {
    if (session.role !== 'admin') throw new Error('Only administrators can view work orders.');
    assertActiveAdmin_(session);
    return listWorkOrders_();
  }
  if (payload.action === 'saveWorkOrder') {
    if (session.role !== 'admin') throw new Error('Only administrators can add work orders.');
    assertActiveAdmin_(session);
    return saveWorkOrder_(payload);
  }
  if (payload.action === 'saveMonthlyBill') {
    if (session.role !== 'admin') throw new Error('Only administrators can manage monthly bills.');
    assertActiveAdmin_(session);
    return saveMonthlyBill_(payload);
  }
  if (payload.action === 'setWorkOrderStatus') {
    if (session.role !== 'admin') throw new Error('Only administrators can change work order status.');
    assertActiveAdmin_(session);
    return setWorkOrderStatus_(payload);
  }
  if (payload.action === 'deleteWorkOrder') {
    if (session.role !== 'admin') throw new Error('Only administrators can delete work orders.');
    assertActiveAdmin_(session);
    verifyAdminPassword_(session, payload.adminPassword);
    return deleteWorkOrder_(payload.workOrderId);
  }
  if (payload.action === 'deleteMonthlyBill') {
    if (session.role !== 'admin') throw new Error('Only administrators can delete monthly bills.');
    assertActiveAdmin_(session);
    verifyAdminPassword_(session, payload.adminPassword);
    return deleteMonthlyBill_(payload.billId);
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
    return getAttendanceRows_(payload.startDate, payload.endDate);
  }

  throw new Error('Unsupported request.');
}

function validateDocumentMonth_(month) {
  if (typeof month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new Error('Choose a valid document month.');
  }
  return month;
}

function assertActiveAdmin_(session) {
  const sheet = getWorkersSheet_();
  const headers = getHeaders_(sheet);
  const numberColumn = columnIndex_(headers, 'Punching Number');
  const nameColumn = columnIndex_(headers, 'Name');
  const roleColumn = columnIndex_(headers, 'Role');
  const hashColumn = columnIndex_(headers, 'Password Hash');
  const matches = sheet.getDataRange().getDisplayValues().slice(1).filter(function (row) {
    return row[numberColumn].trim() === session.punchingNumber;
  });
  if (
    matches.length !== 1 ||
    matches[0][roleColumn].trim().toLowerCase() !== 'admin' ||
    matches[0][nameColumn].trim() !== session.name ||
    matches[0][hashColumn] !== session.passwordHash
  ) {
    throw new Error('This administrator account is no longer active. Please sign in again.');
  }
}

function getDocumentsFolder_() {
  const folderId = PropertiesService.getScriptProperties().getProperty('DOCUMENTS_FOLDER_ID');
  if (!folderId) {
    throw new Error('Document storage is not ready. An administrator must run prepareDocumentsFolder in Apps Script.');
  }
  return DriveApp.getFolderById(folderId);
}

function getMonthFolder_(rootFolder, month, createIfMissing) {
  const folders = rootFolder.getFoldersByName(month);
  if (folders.hasNext()) return folders.next();
  return createIfMissing ? rootFolder.createFolder(month) : null;
}

function listDocuments_(monthValue) {
  const month = validateDocumentMonth_(monthValue);
  const monthFolder = getMonthFolder_(getDocumentsFolder_(), month, false);
  if (!monthFolder) return [];

  const files = monthFolder.getFiles();
  const documents = [];
  while (files.hasNext()) {
    const file = files.next();
    const mimeType = file.getMimeType();
    if (DOCUMENT_MIME_TYPES.indexOf(mimeType) < 0) continue;

    const metadata = parseDocumentMetadata_(file.getDescription());
    if (!metadata) continue;

    documents.push({
      id: file.getId(),
      name: file.getName(),
      category: metadata.category,
      workType: metadata.workType,
      plant: metadata.plant,
      contractor: metadata.contractor,
      mimeType: mimeType,
      size: file.getSize(),
      createdAt: file.getDateCreated().toISOString(),
    });
  }
  documents.sort(function (first, second) {
    return second.createdAt.localeCompare(first.createdAt);
  });
  return documents;
}

function uploadDocument_(payload) {
  const month = validateDocumentMonth_(payload.month);
  const category = payload.category;
  const workType = payload.workType;
  const plant = payload.plant;
  const contractor = payload.contractor;
  const name = typeof payload.name === 'string' ? payload.name.trim() : '';
  const mimeType = payload.mimeType;
  const encoded = payload.base64;
  if (category !== 'bill-copy' && category !== 'work-order') {
    throw new Error('Choose Bills or Work orders for this document.');
  }
  if (DOCUMENT_WORK_TYPES.indexOf(workType) < 0 || workType === 'uncategorized') {
    throw new Error('Choose Steam Line or Manpower Supply for this document.');
  }
  validateDocumentAssignments_(plant, contractor);
  if (!name || name.length > 180 || /[\u0000-\u001f\u007f]/.test(name)) {
    throw new Error('Choose a valid file name (up to 180 characters).');
  }
  if (DOCUMENT_MIME_TYPES.indexOf(mimeType) < 0) {
    throw new Error('Upload a JPG, PNG, WebP image, or PDF file.');
  }
  if (typeof encoded !== 'string' || !encoded ||
      encoded.length > 4 * Math.ceil(MAX_DOCUMENT_BYTES / 3)) {
    throw new Error('Each document must be smaller than 8 MB.');
  }

  let bytes;
  try {
    bytes = Utilities.base64Decode(encoded);
  } catch (error) {
    throw new Error('The selected document could not be read. Choose it again and retry.');
  }
  if (!bytes.length || bytes.length > MAX_DOCUMENT_BYTES) {
    throw new Error('Each document must be 8 MB or smaller.');
  }
  if (!matchesDocumentSignature_(bytes, mimeType)) {
    throw new Error('The file contents do not match a supported image or PDF type.');
  }

  const folder = getMonthFolder_(getDocumentsFolder_(), month, true);
  const blob = Utilities.newBlob(bytes, mimeType, name);
  const file = folder.createFile(blob);
  file.setDescription(formatDocumentMetadata_({
    category: category,
    workType: workType,
    plant: plant,
    contractor: contractor,
  }));
  return {
    id: file.getId(),
    name: file.getName(),
    category: category,
    workType: workType,
    plant: plant,
    contractor: contractor,
    mimeType: mimeType,
    size: file.getSize(),
    createdAt: file.getDateCreated().toISOString(),
  };
}

function parseDocumentMetadata_(description) {
  const value = typeof description === 'string' ? description : '';
  const match = value.match(
    /^geoattendance-category:(bill-copy|work-order)(?:;work-type:(steam-line|manpower-supply))?(?:;plant:([a-z0-9-]+);contractor:([a-z0-9-]+))?$/
  );
  if (!match) return null;
  return {
    category: match[1],
    workType: match[2] || 'uncategorized',
    plant: match[3] || 'uncategorized',
    contractor: match[4] || 'uncategorized',
  };
}

function validateDocumentAssignments_(plant, contractor) {
  if (DOCUMENT_PLANTS.indexOf(plant) < 0) {
    throw new Error('Choose a valid plant for this document.');
  }
  if (DOCUMENT_CONTRACTORS.indexOf(contractor) < 0) {
    throw new Error('Choose a valid contractor for this document.');
  }
}

function formatDocumentMetadata_(metadata) {
  return 'geoattendance-category:' + metadata.category +
    (metadata.workType ? ';work-type:' + metadata.workType : '') +
    (metadata.plant && metadata.contractor
      ? ';plant:' + metadata.plant + ';contractor:' + metadata.contractor
      : '');
}

function isLedgerDocumentReferenced_(fileId) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const references = [
    { sheet: spreadsheet.getSheetByName(WORK_ORDERS_SHEET), column: 7 },
    { sheet: spreadsheet.getSheetByName(MONTHLY_BILLS_SHEET), column: 6 },
  ];
  return references.some(function (reference) {
    const sheet = reference.sheet;
    return sheet && sheet.getLastRow() > 1 &&
      sheet.getRange(2, reference.column, sheet.getLastRow() - 1, 1)
        .getDisplayValues()
        .some(function (row) {
          return row[0] === fileId;
        });
  });
}

function matchesDocumentSignature_(bytes, mimeType) {
  if (mimeType === 'application/pdf') {
    return bytes.length >= 5 && bytes[0] === 37 && bytes[1] === 80 &&
      bytes[2] === 68 && bytes[3] === 70 && bytes[4] === 45;
  }
  if (mimeType === 'image/jpeg') {
    return bytes.length >= 3 && (bytes[0] & 255) === 255 &&
      (bytes[1] & 255) === 216 && (bytes[2] & 255) === 255;
  }
  if (mimeType === 'image/png') {
    return bytes.length >= 8 && (bytes[0] & 255) === 137 && bytes[1] === 80 &&
      bytes[2] === 78 && bytes[3] === 71 && bytes[4] === 13 &&
      bytes[5] === 10 && bytes[6] === 26 && bytes[7] === 10;
  }
  return mimeType === 'image/webp' && bytes.length >= 12 &&
    bytes[0] === 82 && bytes[1] === 73 && bytes[2] === 70 && bytes[3] === 70 &&
    bytes[8] === 87 && bytes[9] === 69 && bytes[10] === 66 && bytes[11] === 80;
}

function getDocument_(fileId) {
  if (typeof fileId !== 'string' || !/^[a-zA-Z0-9_-]{10,}$/.test(fileId)) {
    throw new Error('Choose a valid document.');
  }

  const rootFolder = getDocumentsFolder_();
  const monthFolders = rootFolder.getFolders();
  while (monthFolders.hasNext()) {
    const monthFolder = monthFolders.next();
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(monthFolder.getName())) continue;
    const files = monthFolder.getFiles();
    while (files.hasNext()) {
      const file = files.next();
      if (file.getId() !== fileId) continue;
      if (DOCUMENT_MIME_TYPES.indexOf(file.getMimeType()) < 0 ||
          file.getSize() > MAX_DOCUMENT_BYTES) {
        throw new Error('This document cannot be previewed in the app.');
      }
      return {
        id: file.getId(),
        name: file.getName(),
        mimeType: file.getMimeType(),
        base64: Utilities.base64Encode(file.getBlob().getBytes()),
      };
    }
  }
  throw new Error('That document could not be found.');
}

function deleteDocument_(payload) {
  const month = validateDocumentMonth_(payload.month);
  const fileId = payload.fileId;
  if (typeof fileId !== 'string' || !/^[a-zA-Z0-9_-]{10,}$/.test(fileId)) {
    throw new Error('Choose a valid document.');
  }

  const monthFolder = getMonthFolder_(getDocumentsFolder_(), month, false);
  if (!monthFolder) throw new Error('That document could not be found in the selected month.');
  const files = monthFolder.getFiles();
  while (files.hasNext()) {
    const file = files.next();
    if (file.getId() !== fileId) continue;

    const metadata = parseDocumentMetadata_(file.getDescription());
    if (
      DOCUMENT_MIME_TYPES.indexOf(file.getMimeType()) < 0 ||
      !metadata ||
      metadata.category !== payload.category ||
      metadata.workType !== payload.workType ||
      metadata.plant !== payload.plant ||
      metadata.contractor !== payload.contractor
    ) {
      throw new Error('This document does not belong to the selected document categories.');
    }
    if (isLedgerDocumentReferenced_(fileId)) {
      throw new Error('This document is linked to a work order or bill and cannot be deleted here.');
    }

    file.setTrashed(true);
    return { id: fileId, deleted: true };
  }
  throw new Error('That document could not be found in the selected month.');
}

function assignDocument_(payload) {
  const month = validateDocumentMonth_(payload.month);
  const fileId = payload.fileId;
  const category = payload.category;
  const workType = payload.workType;
  const plant = payload.plant;
  const contractor = payload.contractor;
  if (typeof fileId !== 'string' || !/^[a-zA-Z0-9_-]{10,}$/.test(fileId)) {
    throw new Error('Choose a valid document.');
  }
  if (category !== 'bill-copy' && category !== 'work-order') {
    throw new Error('Choose a valid document type.');
  }
  if (workType !== 'steam-line' && workType !== 'manpower-supply') {
    throw new Error('Choose a valid work type.');
  }
  validateDocumentAssignments_(plant, contractor);

  const monthFolder = getMonthFolder_(getDocumentsFolder_(), month, false);
  if (!monthFolder) throw new Error('That document could not be found in the selected month.');
  const files = monthFolder.getFiles();
  while (files.hasNext()) {
    const file = files.next();
    if (file.getId() !== fileId) continue;

    const metadata = parseDocumentMetadata_(file.getDescription());
    if (
      DOCUMENT_MIME_TYPES.indexOf(file.getMimeType()) < 0 ||
      !metadata ||
      metadata.category !== category
    ) {
      throw new Error('This file is not a supported document in the selected category.');
    }

    const updatedMetadata = {
      category: category,
      workType: workType,
      plant: plant,
      contractor: contractor,
    };
    file.setDescription(formatDocumentMetadata_(updatedMetadata));
    return Object.assign({
      id: file.getId(),
      name: file.getName(),
      mimeType: file.getMimeType(),
      size: file.getSize(),
      createdAt: file.getDateCreated().toISOString(),
    }, updatedMetadata);
  }
  throw new Error('That document could not be found in the selected month.');
}

function getWorkOrderSheets_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  return {
    workOrders: getLedgerSheet_(spreadsheet, WORK_ORDERS_SHEET, WORK_ORDER_HEADERS),
    bills: getLedgerSheet_(spreadsheet, MONTHLY_BILLS_SHEET, MONTHLY_BILL_HEADERS),
  };
}

function getLedgerSheet_(spreadsheet, name, headers) {
  let sheet = spreadsheet.getSheetByName(name);
  if (!sheet) sheet = spreadsheet.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    return sheet;
  }
  if (name === WORK_ORDERS_SHEET &&
      sheet.getLastColumn() === 10 &&
      headers.slice(0, 10).every(function (header, index) {
        return normalizeHeader_(sheet.getRange(1, index + 1).getDisplayValue()) ===
          normalizeHeader_(header);
      })) {
    sheet.getRange(1, 11, 1, 3).setValues([headers.slice(10)]);
  }
  if (name === WORK_ORDERS_SHEET &&
      sheet.getLastColumn() === 12 &&
      headers.slice(0, 12).every(function (header, index) {
        return normalizeHeader_(sheet.getRange(1, index + 1).getDisplayValue()) ===
          normalizeHeader_(header);
      })) {
    sheet.getRange(1, 13, 1, 1).setValue(headers[12]);
  }
  if (name === WORK_ORDERS_SHEET &&
      sheet.getLastColumn() === 13 &&
      headers.slice(0, 13).every(function (header, index) {
        return normalizeHeader_(sheet.getRange(1, index + 1).getDisplayValue()) ===
          normalizeHeader_(header);
      })) {
    sheet.getRange(1, 14, 1, 1).setValue(headers[13]);
  }
  if (name === WORK_ORDERS_SHEET &&
      sheet.getLastColumn() === 14 &&
      normalizeHeader_(sheet.getRange(1, 14).getDisplayValue()) === 'quantity type') {
    sheet.getRange(1, 14).setValue(headers[13]);
  }
  if (name === MONTHLY_BILLS_SHEET &&
      sheet.getLastColumn() === 10 &&
      headers.slice(0, 10).every(function (header, index) {
        return normalizeHeader_(sheet.getRange(1, index + 1).getDisplayValue()) ===
          normalizeHeader_(header);
      })) {
    sheet.getRange(1, 11, 1, 1).setValue(headers[10]);
  }
  if (name === MONTHLY_BILLS_SHEET &&
      sheet.getLastColumn() === 11 &&
      normalizeHeader_(sheet.getRange(1, 11).getDisplayValue()) === 'quantity type') {
    sheet.getRange(1, 11).setValue(headers[10]);
  }
  if (sheet.getLastColumn() !== headers.length ||
      headers.some(function (header, index) {
        return normalizeHeader_(sheet.getRange(1, index + 1).getDisplayValue()) !==
          normalizeHeader_(header);
      })) {
    throw new Error('The "' + name + '" tab headers do not match the required format.');
  }
  return sheet;
}

function readLedgerRows_(sheet) {
  if (sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn())
    .getValues()
    .map(function (values, index) {
      return { rowNumber: index + 2, values: values };
    })
    .filter(function (row) {
      return row.values.some(function (value) {
        return value !== '' && value !== null;
      });
    });
}

function ledgerDocument_(values, idIndex, nameIndex, mimeTypeIndex) {
  const id = String(values[idIndex] || '');
  const name = String(values[nameIndex] || '');
  const mimeType = String(values[mimeTypeIndex] || '');
  if (!id && !name && !mimeType) return null;
  if (!id || !name || DOCUMENT_MIME_TYPES.indexOf(mimeType) < 0) {
    throw new Error('A saved work order or bill has invalid document details.');
  }
  return { id: id, name: name, mimeType: mimeType };
}

function readLedgerQuantity_(value, fieldName) {
  const quantity = Number(value);
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1000000000000) {
    throw new Error('A saved ' + fieldName + ' must be a positive number.');
  }
  return quantity;
}

function parseQuantityItems_(value, category, fieldName) {
  if (!value) return [];
  let items;
  try {
    items = JSON.parse(String(value));
  } catch (error) {
    throw new Error('A saved ' + fieldName + ' has invalid quantity details.');
  }
  if (!Array.isArray(items)) throw new Error('A saved ' + fieldName + ' has invalid quantity details.');
  const validTypes = category === 'Manpower'
    ? MANPOWER_QUANTITY_TYPES
    : category === 'Online Steam Leakage'
      ? STEAM_LINE_QUANTITY_TYPES
      : MANPOWER_QUANTITY_TYPES.concat(STEAM_LINE_QUANTITY_TYPES);
  const seen = {};
  items.forEach(function (item) {
    if (!item || validTypes.indexOf(item.quantityType) < 0 ||
        !Number.isFinite(Number(item.quantity)) || Number(item.quantity) <= 0) {
      throw new Error('A saved ' + fieldName + ' has invalid quantity details.');
    }
    if (seen[item.quantityType]) {
      throw new Error('A ' + fieldName + ' cannot contain the same quantity type twice.');
    }
    seen[item.quantityType] = true;
  });
  return items.map(function (item) {
    return { quantityType: item.quantityType, quantity: Number(item.quantity) };
  });
}

function listWorkOrders_() {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheets = getWorkOrderSheets_();
    const billsByWorkOrder = {};
    readLedgerRows_(sheets.bills).forEach(function (row) {
      const values = row.values;
      const bill = {
        id: String(values[0] || ''),
        workOrderId: String(values[1] || ''),
        month: String(values[2] || ''),
        billNumber: String(values[3] || ''),
        quantity: readLedgerQuantity_(values[4], 'billed quantity'),
        document: ledgerDocument_(values, 5, 6, 7),
        createdAt: String(values[8] || ''),
        updatedAt: String(values[9] || ''),
        quantityItems: parseQuantityItems_(values[10], '', 'billed quantity'),
      };
      if (!/^[a-f0-9]{32}$/i.test(bill.id) ||
          !/^[a-f0-9]{32}$/i.test(bill.workOrderId) ||
          !/^\d{4}-(0[1-9]|1[0-2])$/.test(bill.month) ||
          !bill.billNumber) {
        throw new Error('A saved monthly bill has invalid details.');
      }
      if (!billsByWorkOrder[bill.workOrderId]) billsByWorkOrder[bill.workOrderId] = [];
      billsByWorkOrder[bill.workOrderId].push(bill);
    });

    const workOrders = readLedgerRows_(sheets.workOrders).map(function (row) {
      const values = row.values;
      const workOrder = {
        id: String(values[0] || ''),
        number: String(values[1] || ''),
        category: String(values[2] || ''),
        totalQuantity: readLedgerQuantity_(values[3], 'allotted quantity'),
        startDate: String(values[4] || ''),
        durationMonths: values[5] === '' || values[5] === null ? null : Number(values[5]),
        document: ledgerDocument_(values, 6, 7, 8),
        createdAt: String(values[9] || ''),
        plant: String(values[10] || ''),
        contractor: String(values[11] || ''),
        active: String(values[12] || '').trim().toLowerCase() !== 'inactive',
        quantityItems: parseQuantityItems_(values[13], String(values[2] || ''), 'allotted quantity'),
        bills: billsByWorkOrder[String(values[0] || '')] || [],
      };
      if (!/^[a-f0-9]{32}$/i.test(workOrder.id) ||
          !workOrder.number ||
          WORK_ORDER_CATEGORIES.indexOf(workOrder.category) < 0 ||
          (workOrder.plant && DOCUMENT_PLANTS.indexOf(workOrder.plant) < 0) ||
          (workOrder.contractor && DOCUMENT_CONTRACTORS.indexOf(workOrder.contractor) < 0) ||
          (workOrder.startDate && !/^\d{4}-\d{2}-\d{2}$/.test(workOrder.startDate)) ||
          (workOrder.durationMonths !== null &&
            (!Number.isInteger(workOrder.durationMonths) || workOrder.durationMonths < 1))) {
        throw new Error('A saved work order has invalid details.');
      }
      workOrder.consumedQuantity = workOrder.bills.reduce(function (total, bill) {
        return total + bill.quantity;
      }, 0);
      workOrder.remainingQuantity = Math.max(0, workOrder.totalQuantity - workOrder.consumedQuantity);
      if (workOrder.remainingQuantity <= 1e-9) workOrder.active = false;
      return workOrder;
    });
    if (Object.keys(billsByWorkOrder).some(function (workOrderId) {
      return !workOrders.some(function (workOrder) {
        return workOrder.id === workOrderId;
      });
    })) {
      throw new Error('A monthly bill refers to a work order that does not exist.');
    }
    workOrders.sort(function (first, second) {
      return first.number.localeCompare(second.number);
    });
    workOrders.forEach(function (workOrder) {
      workOrder.bills.sort(function (first, second) {
        return first.month.localeCompare(second.month) ||
          first.billNumber.localeCompare(second.billNumber);
      });
    });
    return { workOrders: workOrders };
  } finally {
    lock.releaseLock();
  }
}

function validateSubmittedQuantityItems_(quantityItems, category) {
  if (!Array.isArray(quantityItems) || quantityItems.length === 0) {
    throw new Error('Enter at least one separate quantity.');
  }
  const validTypes = category === 'Manpower'
    ? MANPOWER_QUANTITY_TYPES
    : STEAM_LINE_QUANTITY_TYPES;
  const seen = {};
  return quantityItems.map(function (item) {
    const quantityType = item && typeof item.quantityType === 'string'
      ? item.quantityType.trim()
      : '';
    const quantity = Number(item && item.quantity);
    if (validTypes.indexOf(quantityType) < 0) {
      throw new Error('Choose a valid quantity type.');
    }
    if (seen[quantityType]) {
      throw new Error('Do not add the same quantity type more than once.');
    }
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1000000000000) {
      throw new Error('Enter a positive quantity for each quantity type.');
    }
    seen[quantityType] = true;
    return { quantityType: quantityType, quantity: quantity };
  });
}

function validateWorkOrderFields_(payload) {
  const number = typeof payload.number === 'string' ? payload.number.trim() : '';
  const category = payload.category;
  const plant = typeof payload.plant === 'string' ? payload.plant.trim() : '';
  const contractor = typeof payload.contractor === 'string' ? payload.contractor.trim() : '';
  const quantityItems = validateSubmittedQuantityItems_(payload.quantityItems, category);
  const totalQuantity = quantityItems.reduce(function (total, item) {
    return total + item.quantity;
  }, 0);
  const startDate = typeof payload.startDate === 'string' ? payload.startDate.trim() : '';
  const durationMonths = payload.durationMonths === '' ||
    payload.durationMonths === null || payload.durationMonths === undefined
    ? null
    : Number(payload.durationMonths);
  if (!number || number.length > 100 || /[\u0000-\u001f\u007f]/.test(number)) {
    throw new Error('Enter a valid work order number (up to 100 characters).');
  }
  if (WORK_ORDER_CATEGORIES.indexOf(category) < 0) {
    throw new Error('Choose a valid category or service type.');
  }
  if (DOCUMENT_PLANTS.indexOf(plant) < 0) {
    throw new Error('Choose a valid plant.');
  }
  if (DOCUMENT_CONTRACTORS.indexOf(contractor) < 0) {
    throw new Error('Choose a valid contractor.');
  }
  if (!Number.isFinite(totalQuantity) || totalQuantity <= 0 ||
      totalQuantity > 1000000000000) {
    throw new Error('Enter a positive total allotted quantity.');
  }
  if (startDate && !isValidLedgerDate_(startDate)) {
    throw new Error('Choose a valid work order start date.');
  }
  if (durationMonths !== null &&
      (!Number.isInteger(durationMonths) || durationMonths < 1 || durationMonths > 120)) {
    throw new Error('Duration must be between 1 and 120 months.');
  }
  return {
    number: number,
    category: category,
    plant: plant,
    contractor: contractor,
    totalQuantity: totalQuantity,
    quantityItems: quantityItems,
    startDate: startDate,
    durationMonths: durationMonths,
  };
}

function isValidLedgerDate_(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return !isNaN(date.getTime()) &&
    Utilities.formatDate(date, 'UTC', 'yyyy-MM-dd') === value;
}

function appendLedgerRow_(sheet, values) {
  const targetRow = sheet.getLastRow() + 1;
  sheet.getRange(targetRow, 1, 1, values.length).setNumberFormat('@');
  sheet.getRange(targetRow, 1, 1, values.length).setValues([values]);
}

function uploadLedgerDocument_(document, category, workType, month) {
  if (!document) return null;
  if (!document || typeof document !== 'object') {
    throw new Error('Choose a valid document.');
  }
  const documentMonth = validateDocumentMonth_(document.month || month);
  const name = typeof document.name === 'string' ? document.name.trim() : '';
  const mimeType = document.mimeType;
  const encoded = document.base64;
  if (!name || name.length > 180 || /[\u0000-\u001f\u007f]/.test(name)) {
    throw new Error('Choose a valid file name (up to 180 characters).');
  }
  if (DOCUMENT_MIME_TYPES.indexOf(mimeType) < 0) {
    throw new Error('Upload a JPG, PNG, WebP image, or PDF file.');
  }
  if (typeof encoded !== 'string' || !encoded ||
      encoded.length > 4 * Math.ceil(MAX_DOCUMENT_BYTES / 3)) {
    throw new Error('Each document must be smaller than 8 MB.');
  }
  let bytes;
  try {
    bytes = Utilities.base64Decode(encoded);
  } catch (error) {
    throw new Error('The selected document could not be read. Choose it again and retry.');
  }
  if (!bytes.length || bytes.length > MAX_DOCUMENT_BYTES ||
      !matchesDocumentSignature_(bytes, mimeType)) {
    throw new Error('The file contents do not match a supported image or PDF type.');
  }
  const folder = getMonthFolder_(getDocumentsFolder_(), documentMonth, true);
  const file = folder.createFile(Utilities.newBlob(bytes, mimeType, name));
  file.setDescription(formatDocumentMetadata_({
    category: category,
    workType: workType,
  }));
  return {
    id: file.getId(),
    name: file.getName(),
    mimeType: mimeType,
  };
}

function saveWorkOrder_(payload) {
  const fields = validateWorkOrderFields_(payload);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheets = getWorkOrderSheets_();
    const existingNumbers = readLedgerRows_(sheets.workOrders).map(function (row) {
      return String(row.values[1] || '').trim().toLowerCase();
    });
    if (existingNumbers.indexOf(fields.number.toLowerCase()) >= 0) {
      throw new Error('That work order number already exists.');
    }
    const id = Utilities.getUuid().replace(/-/g, '');
    const currentMonth = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM');
    const document = uploadLedgerDocument_(
      payload.document,
      'work-order',
      fields.category === 'Manpower' ? 'manpower-supply' : 'steam-line',
      fields.startDate ? fields.startDate.slice(0, 7) : currentMonth,
    );
    appendLedgerRow_(sheets.workOrders, [
      id, fields.number, fields.category, fields.totalQuantity, fields.startDate,
      fields.durationMonths === null ? '' : fields.durationMonths,
      document ? document.id : '',
      document ? document.name : '',
      document ? document.mimeType : '',
      new Date().toISOString(),
      fields.plant,
      fields.contractor,
      'Active',
      JSON.stringify(fields.quantityItems),
    ]);
    return { saved: true, id: id };
  } finally {
    lock.releaseLock();
  }
}

function saveMonthlyBill_(payload) {
  const workOrderId = typeof payload.workOrderId === 'string' ? payload.workOrderId : '';
  const billId = typeof payload.billId === 'string' && payload.billId
    ? payload.billId
    : '';
  const month = validateDocumentMonth_(payload.month);
  const billNumber = typeof payload.billNumber === 'string' ? payload.billNumber.trim() : '';
  if (!/^[a-f0-9]{32}$/i.test(workOrderId) ||
      (billId && !/^[a-f0-9]{32}$/i.test(billId))) {
    throw new Error('Choose a valid work order and bill.');
  }
  if (!billNumber || billNumber.length > 100 ||
      /[\u0000-\u001f\u007f]/.test(billNumber)) {
    throw new Error('Enter a valid bill number or reference (up to 100 characters).');
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheets = getWorkOrderSheets_();
    const workOrderRows = readLedgerRows_(sheets.workOrders);
    const workOrderRow = workOrderRows.find(function (row) {
      return String(row.values[0] || '') === workOrderId;
    });
    if (!workOrderRow) throw new Error('The selected work order could not be found.');
    if (String(workOrderRow.values[12] || '').trim().toLowerCase() === 'inactive') {
      throw new Error('This work order is inactive. Activate it before entering a monthly bill.');
    }
    const workOrderCategory = String(workOrderRow.values[2] || '');
    const quantityItems = validateSubmittedQuantityItems_(payload.quantityItems, workOrderCategory);
    const quantity = quantityItems.reduce(function (total, item) {
      return total + item.quantity;
    }, 0);
    const totalQuantity = readLedgerQuantity_(workOrderRow.values[3], 'allotted quantity');
    const billRows = readLedgerRows_(sheets.bills);
    const previousRow = billId ? billRows.find(function (row) {
      return String(row.values[0] || '') === billId;
    }) : null;
    if (billId && !previousRow) throw new Error('The bill to edit could not be found.');
    const consumedByOthers = billRows.reduce(function (total, row) {
      return total + (
        String(row.values[1] || '') === workOrderId &&
        String(row.values[0] || '') !== billId
          ? readLedgerQuantity_(row.values[4], 'billed quantity')
          : 0
      );
    }, 0);
    const availableQuantity = Math.max(0, totalQuantity - consumedByOthers);
    if (quantity > availableQuantity + 1e-9) {
      throw new Error(
        'Billed quantity exceeds the remaining balance. Available quantity: ' +
        availableQuantity + '.',
      );
    }

    const document = payload.document
      ? uploadLedgerDocument_(
        payload.document,
        'bill-copy',
        workOrderCategory === 'Manpower' ? 'manpower-supply' : 'steam-line',
        month,
      )
      : ledgerDocument_(previousRow ? previousRow.values : ['', '', '', '', '', '', '', ''], 5, 6, 7);
    const id = billId || Utilities.getUuid().replace(/-/g, '');
    const now = new Date().toISOString();
    const values = [
      id,
      workOrderId,
      month,
      billNumber,
      quantity,
      document ? document.id : '',
      document ? document.name : '',
      document ? document.mimeType : '',
      previousRow ? previousRow.values[8] : now,
      now,
      JSON.stringify(quantityItems),
    ];
    if (previousRow) {
      sheets.bills.getRange(previousRow.rowNumber, 1, 1, values.length)
        .setNumberFormat('@');
      sheets.bills.getRange(previousRow.rowNumber, 1, 1, values.length).setValues([values]);
    } else {
      appendLedgerRow_(sheets.bills, values);
    }
    const consumedAfterSave = consumedByOthers + quantity;
    if (consumedAfterSave >= totalQuantity - 1e-9) {
      sheets.workOrders.getRange(workOrderRow.rowNumber, 13).setValue('Inactive');
    }
    return { saved: true, id: id };
  } finally {
    lock.releaseLock();
  }
}

function deleteMonthlyBill_(billId) {
  if (typeof billId !== 'string' || !/^[a-f0-9]{32}$/i.test(billId)) {
    throw new Error('Choose a valid bill to delete.');
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheets = getWorkOrderSheets_();
    const row = readLedgerRows_(sheets.bills).find(function (billRow) {
      return String(billRow.values[0] || '') === billId;
    });
    if (!row) throw new Error('The bill to delete could not be found.');
    const workOrderId = String(row.values[1] || '');
    sheets.bills.deleteRow(row.rowNumber);
    const workOrderRow = readLedgerRows_(sheets.workOrders).find(function (orderRow) {
      return String(orderRow.values[0] || '') === workOrderId;
    });
    if (workOrderRow) {
      const billRows = readLedgerRows_(sheets.bills).filter(function (billRow) {
        return String(billRow.values[1] || '') === workOrderId;
      });
      const consumedQuantity = billRows.reduce(function (total, billRow) {
        return total + readLedgerQuantity_(billRow.values[4], 'billed quantity');
      }, 0);
      const totalQuantity = readLedgerQuantity_(workOrderRow.values[3], 'allotted quantity');
      if (consumedQuantity < totalQuantity - 1e-9) {
        sheets.workOrders.getRange(workOrderRow.rowNumber, 13).setValue('Active');
      }
    }
    return { id: billId, deleted: true };
  } finally {
    lock.releaseLock();
  }
}

function setWorkOrderStatus_(payload) {
  const workOrderId = typeof payload.workOrderId === 'string' ? payload.workOrderId : '';
  const status = String(payload.status || '').trim().toLowerCase();
  if (!/^[a-f0-9]{32}$/i.test(workOrderId)) {
    throw new Error('Choose a valid work order.');
  }
  if (status !== 'active' && status !== 'inactive') {
    throw new Error('Choose a valid work order status.');
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheets = getWorkOrderSheets_();
    const workOrderRow = readLedgerRows_(sheets.workOrders).find(function (row) {
      return String(row.values[0] || '') === workOrderId;
    });
    if (!workOrderRow) throw new Error('The work order could not be found.');
    const billRows = readLedgerRows_(sheets.bills).filter(function (row) {
      return String(row.values[1] || '') === workOrderId;
    });
    const totalQuantity = readLedgerQuantity_(workOrderRow.values[3], 'allotted quantity');
    const consumedQuantity = billRows.reduce(function (total, row) {
      return total + readLedgerQuantity_(row.values[4], 'billed quantity');
    }, 0);
    if (status === 'active' && consumedQuantity >= totalQuantity - 1e-9) {
      throw new Error('A completed work order cannot be activated until its quantity is reopened.');
    }
    sheets.workOrders.getRange(workOrderRow.rowNumber, 13).setValue(
      status === 'active' ? 'Active' : 'Inactive',
    );
    return { id: workOrderId, status: status };
  } finally {
    lock.releaseLock();
  }
}

function deleteWorkOrder_(workOrderId) {
  if (!/^[a-f0-9]{32}$/i.test(workOrderId)) {
    throw new Error('Choose a valid work order to delete.');
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheets = getWorkOrderSheets_();
    const workOrderRow = readLedgerRows_(sheets.workOrders).find(function (row) {
      return String(row.values[0] || '') === workOrderId;
    });
    if (!workOrderRow) throw new Error('The work order to delete could not be found.');
    const billRows = readLedgerRows_(sheets.bills).filter(function (row) {
      return String(row.values[1] || '') === workOrderId;
    });
    billRows.sort(function (first, second) {
      return second.rowNumber - first.rowNumber;
    }).forEach(function (row) {
      sheets.bills.deleteRow(row.rowNumber);
    });
    sheets.workOrders.deleteRow(workOrderRow.rowNumber);
    return { id: workOrderId, deleted: true };
  } finally {
    lock.releaseLock();
  }
}

function addWorker_(payload) {
  const punchingNumber = String(payload.punchingNumber || '').trim();
  const name = String(payload.name || '').trim();
  const password = String(payload.password || '');
  const plant = String(payload.plant || '').trim();
  const contractor = String(payload.contractor || '').trim();
  if (!punchingNumber || punchingNumber.length > 100 || !name || name.length > 150) {
    throw new Error('Enter a valid worker name and punching number.');
  }
  if (DOCUMENT_PLANTS.indexOf(plant) < 0) {
    throw new Error('Choose a valid plant for the worker account.');
  }
  if (DOCUMENT_CONTRACTORS.indexOf(contractor) < 0) {
    throw new Error('Choose a valid contractor for the worker account.');
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
    const contractorColumn = ensureContractorColumn_(sheet, headers);
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
    row[contractorColumn] = contractor;
    const salt = Utilities.getUuid().replace(/-/g, '');
    row[passwordColumn] = '';
    row[hashColumn] = salt + ':' + derivePasswordHash_(password, salt);
    const target = sheet.getLastRow() + 1;
    sheet.getRange(target, 1, 1, row.length).setNumberFormat('@');
    sheet.getRange(target, 1, 1, row.length).setValues([row]);
  } finally {
    lock.releaseLock();
  }

  return {
    punchingNumber: punchingNumber,
    name: name,
    role: 'worker',
    plant: plant,
    contractor: contractor,
  };
}

function getWorkers_() {
  const sheet = getWorkersSheet_();
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const headers = getHeaders_(sheet);
    const plantColumn = ensurePlantColumn_(sheet, headers);
    const contractorColumn = ensureContractorColumn_(sheet, headers);
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
          contractor: (row[contractorColumn] || '').trim(),
        };
      });
    return { plantField: true, contractorField: true, workers: workers };
  } finally {
    lock.releaseLock();
  }
}

function assignWorker_(payload) {
  const punchingNumber = String(payload.punchingNumber || '').trim();
  const plant = String(payload.plant || '').trim();
  const contractor = String(payload.contractor || '').trim();
  if (!punchingNumber || punchingNumber.length > 100) {
    throw new Error('Choose a valid worker account.');
  }
  if (DOCUMENT_PLANTS.indexOf(plant) < 0) {
    throw new Error('Choose a valid plant for the worker account.');
  }
  if (DOCUMENT_CONTRACTORS.indexOf(contractor) < 0) {
    throw new Error('Choose a valid contractor for the worker account.');
  }

  const sheet = getWorkersSheet_();
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const headers = getHeaders_(sheet);
    const plantColumn = ensurePlantColumn_(sheet, headers);
    const contractorColumn = ensureContractorColumn_(sheet, headers);
    const numberColumn = columnIndex_(headers, 'Punching Number');
    const roleColumn = columnIndex_(headers, 'Role');
    const rows = sheet.getDataRange().getDisplayValues();
    const matches = rows.slice(1).map(function (row, index) {
      return { row: row, sheetRow: index + 2 };
    }).filter(function (entry) {
      return entry.row[numberColumn].trim() === punchingNumber &&
        entry.row[roleColumn].trim().toLowerCase() === 'worker';
    });
    if (matches.length !== 1) throw new Error('That worker account could not be found.');

    sheet.getRange(matches[0].sheetRow, plantColumn + 1).setValue(plant);
    sheet.getRange(matches[0].sheetRow, contractorColumn + 1).setValue(contractor);
    return { punchingNumber: punchingNumber, plant: plant, contractor: contractor };
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
  const eventType = payload.eventType;
  if (['IN', 'P1', 'P2', 'OUT'].indexOf(eventType) < 0) {
    throw new Error('Choose a valid attendance event.');
  }
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
    const existing = existingIndex >= 0 ? rows[existingIndex + 1] : [];
    const inTime = existing[7] || (existing[3] === 'Present' ? existing[4] : '');
    const p1Time = existing[8] || '';
    const p2Time = existing[9] || '';
    const outTime = existing[10] || '';

    if (eventType === 'IN' && inTime) throw new Error('IN has already been recorded today.');
    if (eventType !== 'IN' && !inTime) throw new Error('Record IN before this attendance event.');
    if (eventType !== 'IN' && outTime) throw new Error('OUT has already been recorded today.');
    if (eventType === 'P1' && p1Time) throw new Error('P1 has already been recorded today.');
    if (eventType === 'P2' && p2Time) throw new Error('P2 has already been recorded today.');
    if (eventType === 'OUT' && outTime) throw new Error('OUT has already been recorded today.');

    const updatedInTime = eventType === 'IN' ? time : inTime;
    const values = existing.slice(0, 11);
    while (values.length < 11) values.push('');
    values[0] = dateKey;
    values[1] = session.punchingNumber;
    values[2] = session.name;
    values[3] = 'Present';
    values[4] = updatedInTime;
    values[5] = eventType === 'IN' ? latitude : (existing[5] || '');
    values[6] = eventType === 'IN' ? longitude : (existing[6] || '');
    values[7] = updatedInTime;
    values[8] = eventType === 'P1' ? time : p1Time;
    values[9] = eventType === 'P2' ? time : p2Time;
    values[10] = eventType === 'OUT' ? time : outTime;

    if (existingIndex >= 0) sheet.getRange(existingIndex + 2, 1, 1, values.length).setValues([values]);
    else sheet.appendRow(values);

    return {
      dateKey: dateKey,
      inTime: values[7],
      p1Time: values[8],
      p2Time: values[9],
      outTime: values[10],
      status: values[10] ? 'Present' : 'Currently Inside',
    };
  } finally {
    lock.releaseLock();
  }
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

function verifyAdminPassword_(session, password) {
  if (typeof password !== 'string' || !password || password.length > 128) {
    throw new Error('Enter your administrator password.');
  }

  const cache = CacheService.getScriptCache();
  const attemptKey = 'remove-confirm:' + digest_(session.punchingNumber);
  const attempts = Number(cache.get(attemptKey) || 0);
  if (attempts >= 5) {
    throw new Error('Too many incorrect confirmations. Try again in 15 minutes.');
  }

  const sheet = getWorkersSheet_();
  const headers = getHeaders_(sheet);
  const numberColumn = columnIndex_(headers, 'Punching Number');
  const roleColumn = columnIndex_(headers, 'Role');
  const hashColumn = columnIndex_(headers, 'Password Hash');
  const matches = sheet.getDataRange().getDisplayValues().slice(1).filter(function (row) {
    return row[numberColumn].trim() === session.punchingNumber;
  });
  if (
    matches.length !== 1 ||
    matches[0][roleColumn].trim().toLowerCase() !== 'admin' ||
    !verifyPassword_(password, matches[0][hashColumn])
  ) {
    cache.put(attemptKey, String(attempts + 1), 900);
    throw new Error('Incorrect administrator password.');
  }

  cache.remove(attemptKey);
}

function getAttendanceRows_(startDate, endDate) {
  validateAttendanceRange_(startDate, endDate);

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const workerSheet = getWorkersSheet_();
    const workerHeaders = getHeaders_(workerSheet);
    const plantColumn = ensurePlantColumn_(workerSheet, workerHeaders);
    const contractorColumn = ensureContractorColumn_(workerSheet, workerHeaders);
    const workers = workerSheet.getDataRange().getDisplayValues();
    const numberColumn = columnIndex_(workerHeaders, 'Punching Number');
    const nameColumn = columnIndex_(workerHeaders, 'Name');
    const roleColumn = columnIndex_(workerHeaders, 'Role');
    if (numberColumn < 0 || nameColumn < 0 || roleColumn < 0) {
      throw new Error('The Workers tab is missing required columns.');
    }

    const records = new Map();
    const attendance = getAttendanceSheet_().getDataRange().getDisplayValues();
    attendance.slice(1).forEach(function (row) {
      if (row[0] < startDate || row[0] > endDate) return;
      const inTime = row[7] || (row[3] === 'Present' ? row[4] : '');
      if (!inTime) return;
      const days = records.get(row[1]) || {};
      days[row[0]] = {
        inTime: inTime,
        p1Time: row[8] || '',
        p2Time: row[9] || '',
        outTime: row[10] || '',
        status: row[10] ? 'Present' : 'Currently Inside',
      };
      records.set(row[1], days);
    });

    return workers.slice(1)
      .filter(function (row) {
        return row[numberColumn].trim() && row[nameColumn].trim() &&
          row[roleColumn].trim().toLowerCase() === 'worker';
      })
      .map(function (row) {
        const days = records.get(row[numberColumn].trim()) || {};
        return {
          punchingNumber: row[numberColumn].trim(),
          name: row[nameColumn].trim(),
          plant: (row[plantColumn] || '').trim(),
          contractor: (row[contractorColumn] || '').trim(),
          status: Object.keys(days).length ? 'Present' : 'Absent',
          time: days[startDate] ? days[startDate].inTime : '—',
          days: days,
        };
      });
  } finally {
    lock.releaseLock();
  }
}

function getWorkerAttendance_(session, dateKey) {
  const rows = getAttendanceSheet_().getDataRange().getDisplayValues();
  const row = rows.slice(1).find(function (attendanceRow) {
    return attendanceRow[0] === dateKey && attendanceRow[1] === session.punchingNumber;
  });
  if (!row) return { dateKey: dateKey, inTime: '', p1Time: '', p2Time: '', outTime: '', status: 'Absent' };
  const inTime = row[7] || (row[3] === 'Present' ? row[4] : '');
  const outTime = row[10] || '';
  return {
    dateKey: dateKey,
    inTime: inTime,
    p1Time: row[8] || '',
    p2Time: row[9] || '',
    outTime: outTime,
    status: inTime ? (outTime ? 'Present' : 'Currently Inside') : 'Absent',
  };
}

function getWorkerAttendanceRange_(session, startDate, endDate) {
  validateAttendanceRange_(startDate, endDate);
  const days = {};
  const attendance = getAttendanceSheet_().getDataRange().getDisplayValues();
  attendance.slice(1).forEach(function (row) {
    if (row[0] < startDate || row[0] > endDate ||
        row[1] !== session.punchingNumber) return;
    const inTime = row[7] || (row[3] === 'Present' ? row[4] : '');
    if (!inTime) return;
    days[row[0]] = {
      inTime: inTime,
      p1Time: row[8] || '',
      p2Time: row[9] || '',
      outTime: row[10] || '',
      status: row[10] ? 'Present' : 'Currently Inside',
    };
  });
  return {
    punchingNumber: session.punchingNumber,
    name: session.name,
    days: days,
  };
}

function validateAttendanceRange_(startDate, endDate) {
  function isValidDateKey_(dateKey) {
    return typeof dateKey === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(dateKey) &&
      Utilities.formatDate(new Date(dateKey + 'T00:00:00Z'), 'UTC', 'yyyy-MM-dd') === dateKey;
  }
  if (!isValidDateKey_(startDate) || !isValidDateKey_(endDate) ||
      startDate > endDate) {
    throw new Error('Choose a valid attendance date range.');
  }
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
  const headers = [
    'Date', 'Punching Number', 'Name', 'Status', 'Time', 'Latitude', 'Longitude',
    'IN', 'P1', 'P2', 'OUT',
  ];
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
  } else if (headers.slice(0, 7).some(function (header, index) {
    return normalizeHeader_(sheet.getRange(1, index + 1).getDisplayValue()) !==
      normalizeHeader_(header);
  })) {
    throw new Error('The Attendance tab headers do not match the required format.');
  } else {
    for (let index = 7; index < headers.length; index += 1) {
      const existingHeader = sheet.getRange(1, index + 1).getDisplayValue();
      if (existingHeader && normalizeHeader_(existingHeader) !== normalizeHeader_(headers[index])) {
        throw new Error('The Attendance tab headers do not match the required format.');
      }
      if (!existingHeader) sheet.getRange(1, index + 1).setValue(headers[index]);
    }
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

function ensurePlantColumn_(sheet) {
  const headers = getHeaders_(sheet);
  const plantColumn = columnIndex_(headers, 'Plant');
  if (plantColumn >= 0) return plantColumn;

  const newPlantColumn = sheet.getLastColumn();
  sheet.getRange(1, newPlantColumn + 1).setValue('Plant');
  return newPlantColumn;
}

function ensureContractorColumn_(sheet) {
  const headers = getHeaders_(sheet);
  const contractorColumn = columnIndex_(headers, 'Contractor');
  if (contractorColumn >= 0) return contractorColumn;

  const newContractorColumn = sheet.getLastColumn();
  sheet.getRange(1, newContractorColumn + 1).setValue('Contractor');
  return newContractorColumn;
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
