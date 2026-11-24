const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'application/pdf',
]);
const DATE_FIELDS = ['issueDate', 'voucherDate', 'billDate', 'scheduleFrom', 'scheduleTo'];
const FIELD_NAMES = [
  'documentNumber',
  'issueDate',
  'voucherDate',
  'billNumber',
  'billDate',
  'workOrderNumber',
  'division',
  'department',
  'costCentre',
  'contractorName',
  'contractorAddress',
  'vendorCode',
  'pan',
  'gstin',
  'subject',
  'scheduleFrom',
  'scheduleTo',
  'grossAmount',
  'taxableValue',
  'netAmount',
];

const responseSchema = {
  type: 'OBJECT',
  properties: {
    documentType: { type: 'STRING', enum: ['work_order', 'monthly_bill', 'unknown'] },
    fields: {
      type: 'OBJECT',
      properties: Object.fromEntries(FIELD_NAMES.map((name) => [name, { type: 'STRING' }])),
      required: FIELD_NAMES,
    },
    confidence: {
      type: 'OBJECT',
      properties: Object.fromEntries(FIELD_NAMES.map((name) => [name, { type: 'NUMBER' }])),
    },
    attentionFields: { type: 'ARRAY', items: { type: 'STRING' } },
    lineItems: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          srNo: { type: 'STRING' },
          itemCode: { type: 'STRING' },
          description: { type: 'STRING' },
          uom: { type: 'STRING' },
          quantity: { type: 'STRING' },
          rate: { type: 'STRING' },
          grossAmount: { type: 'STRING' },
          confidence: { type: 'NUMBER' },
          attention: { type: 'BOOLEAN' },
        },
        required: [
          'srNo',
          'itemCode',
          'description',
          'uom',
          'quantity',
          'rate',
          'grossAmount',
          'confidence',
          'attention',
        ],
      },
    },
  },
  required: ['documentType', 'fields', 'confidence', 'attentionFields', 'lineItems'],
};

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
    body: JSON.stringify(body),
  };
}

function validAppsScriptUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' &&
      url.hostname === 'script.google.com' &&
      /^\/macros\/s\/[^/]+\/exec$/.test(url.pathname);
  } catch {
    return false;
  }
}

function matchesFileSignature(bytes, mimeType) {
  if (mimeType === 'application/pdf') {
    return bytes.length >= 5 && bytes.subarray(0, 5).toString('ascii') === '%PDF-';
  }
  if (mimeType === 'image/jpeg') {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 &&
      bytes[2] === 0xff;
  }
  return mimeType === 'image/png' && bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
}

function normalizeDocumentDates(extraction) {
  for (const field of DATE_FIELDS) {
    const raw = extraction.fields[field]?.trim() || '';
    if (!raw) continue;
    const match = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!match) {
      extraction.fields[field] = '';
      extraction.confidence[field] = 0;
      extraction.attentionFields.push(field);
      continue;
    }
    const [, dayText, monthText, yearText] = match;
    const day = Number(dayText);
    const month = Number(monthText);
    const year = Number(yearText);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (parsed.getUTCFullYear() !== year ||
        parsed.getUTCMonth() !== month - 1 ||
        parsed.getUTCDate() !== day) {
      extraction.fields[field] = '';
      extraction.confidence[field] = 0;
      extraction.attentionFields.push(field);
      continue;
    }
    extraction.fields[field] = `${yearText}-${monthText}-${dayText}`;
  }
  extraction.attentionFields = [...new Set(extraction.attentionFields)];
  return extraction;
}

function extractionPrompt() {
  return `Read the attached full document and extract the visible ERP data. Classify it as work_order when it is headed "Job / Work Order" or contains "Our Order No"; classify it as monthly_bill when headed "JobWork Voucher - Site" or it contains both "DocNo & Date" and "J.O.No."; otherwise use unknown.

Return every field in the required JSON schema. Do not infer or invent unreadable or absent values: use an empty string and confidence 0. For every date, transcribe exactly as DD/MM/YYYY (the server validates and converts it). Read Division, Department, Cost Centre, and the complete Contractor Name & Address block for contractor name, address, vendor code, PAN, and GSTIN. For work orders, read Our Order No & Dt, subject, commencement/completion dates, financial totals, and every table row. For monthly bills, read DocNo & Date, Bill No & Dt, J.O.No., Schedule From/To, financial totals, and every table row. Preserve each row separately with Sr No, Code/It.Code, description, UOM, quantity, rate, and gross amount; never replace distinct item codes with a summed quantity. Read all pages of PDFs. Mark low certainty and numbers affected by handwriting, ticks/checkmarks, stamps, or overlaps in attentionFields or the row attention flag. Do not count ticks or marks as part of numeric values.`;
}

async function fetchStoredDocument(apiUrl, sessionToken, fileId) {
  const payload = {
    action: 'getDocumentForExtraction',
    responseMode: 'json',
    sessionToken,
    fileId,
  };
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: new URLSearchParams({ payload: JSON.stringify(payload) }),
    redirect: 'follow',
  });
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error('Apps Script returned an unreadable document response.');
  }
  if (!response.ok || !result?.ok || !result.result) {
    throw new Error(result?.error || 'The stored document could not be read.');
  }
  return result.result;
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { error: 'Use POST to analyze a document.' });
  }

  let request;
  try {
    request = JSON.parse(event.body || '{}');
  } catch {
    return jsonResponse(400, { error: 'The extraction request is not valid JSON.' });
  }
  const sessionToken = typeof request.sessionToken === 'string'
    ? request.sessionToken
    : '';
  const fileId = typeof request.fileId === 'string' ? request.fileId : '';
  if (!sessionToken || sessionToken.length > 100 ||
      !/^[a-zA-Z0-9_-]{10,}$/.test(fileId)) {
    return jsonResponse(400, { error: 'Choose a valid uploaded document.' });
  }

  const apiUrl = process.env.ATTENDANCE_API_URL || '';
  const apiKey = process.env.GEMINI_API_KEY || '';
  if (!validAppsScriptUrl(apiUrl)) {
    return jsonResponse(503, { error: 'Document extraction is not configured on the server.' });
  }
  if (!apiKey) {
    return jsonResponse(503, { error: 'The document AI service is not configured on the server.' });
  }

  try {
    const document = await fetchStoredDocument(apiUrl, sessionToken, fileId);
    if (!ALLOWED_MIME_TYPES.has(document.mimeType) ||
        typeof document.base64 !== 'string' || !document.base64) {
      return jsonResponse(400, { error: 'Upload a JPG, JPEG, PNG, or PDF file.' });
    }
    const bytes = Buffer.from(document.base64, 'base64');
    if (!bytes.length || bytes.length > MAX_DOCUMENT_BYTES ||
        !matchesFileSignature(bytes, document.mimeType)) {
      return jsonResponse(400, { error: 'The stored file is too large or is not a valid supported document.' });
    }

    const aiResponse = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          contents: [{
            role: 'user',
            parts: [
              { text: extractionPrompt() },
              {
                inlineData: {
                  mimeType: document.mimeType,
                  data: document.base64,
                },
              },
            ],
          }],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema,
          },
        }),
      },
    );
    if (!aiResponse.ok) {
      return jsonResponse(502, {
        error: aiResponse.status === 429
          ? 'The AI service is busy or its usage limit was reached. Try again later.'
          : 'The AI service could not analyze this document. Try again or enter it manually.',
      });
    }
    const aiResult = await aiResponse.json();
    const candidateText = aiResult.candidates?.[0]?.content?.parts
      ?.map((part) => part.text || '')
      .join('');
    if (!candidateText) {
      return jsonResponse(502, { error: 'The AI service returned no document data.' });
    }
    let extraction;
    try {
      extraction = JSON.parse(candidateText);
    } catch {
      return jsonResponse(502, { error: 'The AI service returned invalid structured data.' });
    }
    if (!['work_order', 'monthly_bill', 'unknown'].includes(extraction.documentType) ||
        !extraction.fields || typeof extraction.fields !== 'object' ||
        !Array.isArray(extraction.lineItems)) {
      return jsonResponse(502, { error: 'The AI service returned incomplete document data.' });
    }
    extraction.fields = Object.fromEntries(
      FIELD_NAMES.map((name) => [name, String(extraction.fields[name] || '').trim()]),
    );
    extraction.confidence = Object.fromEntries(
      FIELD_NAMES.map((name) => {
        const confidence = Number(extraction.confidence?.[name]);
        return [name, Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0];
      }),
    );
    extraction.lineItems = extraction.lineItems.slice(0, 200).map((item) => ({
      srNo: String(item.srNo || '').trim(),
      itemCode: String(item.itemCode || '').trim(),
      description: String(item.description || '').trim(),
      uom: String(item.uom || '').trim(),
      quantity: String(item.quantity || '').trim(),
      rate: String(item.rate || '').trim(),
      grossAmount: String(item.grossAmount || '').trim(),
      confidence: Number.isFinite(Number(item.confidence))
        ? Math.min(1, Math.max(0, Number(item.confidence)))
        : 0,
      attention: item.attention === true,
    }));
    extraction.attentionFields = Array.isArray(extraction.attentionFields)
      ? extraction.attentionFields.filter((field) => FIELD_NAMES.includes(field))
      : [];
    normalizeDocumentDates(extraction);
    return jsonResponse(200, {
      extraction,
      document: {
        id: document.id,
        name: document.name,
        mimeType: document.mimeType,
      },
    });
  } catch (error) {
    return jsonResponse(502, {
      error: error instanceof Error
        ? error.message
        : 'Document extraction failed. Try again or enter it manually.',
    });
  }
}
