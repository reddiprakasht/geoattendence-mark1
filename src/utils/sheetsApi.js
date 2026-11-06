const apiUrl = import.meta.env.VITE_ATTENDANCE_API_URL?.trim();

export function requestSheetsApi(payload, timeoutMs = 30000) {
  if (!apiUrl) {
    return Promise.reject(
      new Error('Google Sheets is not configured. Follow the setup steps in README.md.'),
    );
  }

  let endpoint;
  try {
    endpoint = new URL(apiUrl);
  } catch {
    return Promise.reject(new Error('The Google Apps Script URL is invalid.'));
  }
  if (
    endpoint.protocol !== 'https:' ||
    endpoint.hostname !== 'script.google.com' ||
    !/^\/macros\/s\/[^/]+\/exec$/.test(endpoint.pathname)
  ) {
    return Promise.reject(new Error('Use the HTTPS web app URL from your Google Apps Script deployment.'));
  }

  return new Promise((resolve, reject) => {
    const nonce = window.crypto.randomUUID();
    const frameName = `sheets-api-${nonce}`;
    const iframe = document.createElement('iframe');
    const form = document.createElement('form');
    const input = document.createElement('input');
    let timeoutId;

    iframe.name = frameName;
    iframe.title = 'Google Sheets request';
    iframe.hidden = true;
    form.action = apiUrl;
    form.method = 'POST';
    form.target = frameName;
    form.hidden = true;
    input.type = 'hidden';
    input.name = 'payload';
    input.value = JSON.stringify({ ...payload, nonce });
    form.append(input);

    function cleanup() {
      window.removeEventListener('message', handleMessage);
      window.clearTimeout(timeoutId);
      form.remove();
      iframe.remove();
    }

    function handleMessage(event) {
      const message = event.data;
      const appsScriptOrigin =
        event.origin === 'https://script.google.com' ||
        event.origin === 'https://script.googleusercontent.com' ||
        /^https:\/\/[a-z0-9-]+-script\.googleusercontent\.com$/i.test(event.origin);
      if (event.source !== iframe.contentWindow && !appsScriptOrigin) return;
      if (
        !message ||
        message.type !== 'geoattendance-response' ||
        message.nonce !== nonce ||
        !message.response
      ) {
        return;
      }

      cleanup();
      if (message.response.ok) {
        resolve(message.response.result);
      } else {
        const unsupportedDocumentsAction =
          message.response.error === 'Unsupported request.' &&
          ['listDocuments', 'uploadDocument', 'getDocument', 'deleteDocument', 'assignDocument'].includes(payload.action);
        reject(new Error(
          unsupportedDocumentsAction
            ? 'Document storage is not enabled in the deployed Apps Script. Save the updated Code.gs, run prepareDocumentsFolder once to authorize Drive, then deploy a new version of the existing web app.'
            : message.response.error || 'Google Sheets request failed.',
        ));
      }
    }

    window.addEventListener('message', handleMessage);
    timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new Error(
        'Google Sheets did not respond. Check the Apps Script deployment URL and try again.',
      ));
    }, timeoutMs);

    document.body.append(iframe, form);
    form.submit();
  });
}

export function getSharedGeofence(sessionToken) {
  return requestSheetsApi({ action: 'getGeofence', sessionToken });
}

export function saveSharedGeofence(sessionToken, geofence) {
  return requestSheetsApi({ action: 'saveGeofence', sessionToken, geofence });
}

export function addWorkerAccount(sessionToken, account) {
  return requestSheetsApi({ action: 'addWorker', sessionToken, ...account });
}

export function getWorkerAccounts(sessionToken) {
  return requestSheetsApi({ action: 'getWorkers', sessionToken });
}

export function removeWorkerAccount(sessionToken, punchingNumber, adminPassword) {
  return requestSheetsApi({ action: 'removeWorker', sessionToken, punchingNumber, adminPassword });
}

export function listStoredDocuments(sessionToken, month) {
  return requestSheetsApi({ action: 'listDocuments', sessionToken, month });
}

export function uploadStoredDocument(sessionToken, document) {
  return requestSheetsApi(
    { action: 'uploadDocument', sessionToken, ...document },
    120000,
  );
}

export function getStoredDocument(sessionToken, fileId) {
  return requestSheetsApi({ action: 'getDocument', sessionToken, fileId });
}

export function assignStoredDocument(sessionToken, document) {
  return requestSheetsApi({ action: 'assignDocument', sessionToken, ...document });
}

export function deleteStoredDocument(
  sessionToken,
  month,
  fileId,
  category,
  workType,
  plant,
  contractor,
  adminPassword,
) {
  return requestSheetsApi({
    action: 'deleteDocument',
    sessionToken,
    month,
    fileId,
    category,
    workType,
    plant,
    contractor,
    adminPassword,
  });
}
