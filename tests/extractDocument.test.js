import assert from 'node:assert/strict';
import test from 'node:test';
import { handler } from '../netlify/functions/extract-document.mjs';

const apiUrl = 'https://script.google.com/macros/s/test-deployment/exec';

function withServerConfiguration(run) {
  const previousUrl = process.env.ATTENDANCE_API_URL;
  const previousKey = process.env.GEMINI_API_KEY;
  process.env.ATTENDANCE_API_URL = apiUrl;
  process.env.GEMINI_API_KEY = 'test-secret';
  return Promise.resolve()
    .then(run)
    .finally(() => {
      if (previousUrl === undefined) delete process.env.ATTENDANCE_API_URL;
      else process.env.ATTENDANCE_API_URL = previousUrl;
      if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = previousKey;
    });
}

test('extraction requires Apps Script administrator validation before calling Gemini', async () => {
  await withServerConfiguration(async () => {
    const originalFetch = globalThis.fetch;
    let geminiCalled = false;
    globalThis.fetch = async (url) => {
      assert.equal(url, apiUrl);
      return new Response(JSON.stringify({
        ok: false,
        error: 'Your session expired.',
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    try {
      const response = await handler({
        httpMethod: 'POST',
        body: JSON.stringify({ sessionToken: 'expired-admin-token', fileId: '0123456789' }),
      });
      assert.equal(response.statusCode, 502);
      assert.match(JSON.parse(response.body).error, /session expired/i);
      assert.equal(geminiCalled, false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test('extraction validates stored file bytes and returns normalized DD/MM/YYYY dates', async () => {
  await withServerConfiguration(async () => {
    const originalFetch = globalThis.fetch;
    const imageBytes = Buffer.from([0xff, 0xd8, 0xff, 0x00]);
    const fields = {
      documentNumber: '26-27/291',
      issueDate: '23/04/2026',
      voucherDate: '',
      billNumber: '',
      billDate: '',
      workOrderNumber: '',
      division: '01 CAUSTIC',
      department: '',
      costCentre: '1-1750 CAUSTIC SODA EVAPORATION',
      contractorName: 'TGV Services',
      contractorAddress: '',
      vendorCode: '2457-04235',
      pan: '',
      gstin: '',
      subject: 'Maintenance',
      scheduleFrom: '20/03/2026',
      scheduleTo: '31/03/2027',
      grossAmount: '',
      taxableValue: '',
      netAmount: '',
    };
    const confidence = Object.fromEntries(Object.keys(fields).map((field) => [field, 0.95]));
    let calls = 0;
    globalThis.fetch = async (url, options) => {
      calls += 1;
      if (url === apiUrl) {
        const request = JSON.parse(new URLSearchParams(options.body).get('payload'));
        assert.equal(request.action, 'getDocumentForExtraction');
        assert.equal(request.sessionToken, 'admin-session-token');
        return new Response(JSON.stringify({
          ok: true,
          result: {
            id: '0123456789',
            name: 'work-order.jpg',
            mimeType: 'image/jpeg',
            base64: imageBytes.toString('base64'),
          },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      assert.match(url, /generativelanguage\.googleapis\.com/);
      assert.equal(options.headers['x-goog-api-key'], 'test-secret');
      const extraction = {
        documentType: 'work_order',
        fields,
        confidence,
        attentionFields: [],
        lineItems: [{
          srNo: '1',
          itemCode: 'MLS0000022',
          description: 'Repair',
          uom: 'NOS',
          quantity: '30',
          rate: '12',
          grossAmount: '360',
          confidence: 0.95,
          attention: false,
        }],
      };
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: JSON.stringify(extraction) }] } }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    try {
      const response = await handler({
        httpMethod: 'POST',
        body: JSON.stringify({ sessionToken: 'admin-session-token', fileId: '0123456789' }),
      });
      assert.equal(response.statusCode, 200);
      const result = JSON.parse(response.body);
      assert.equal(result.extraction.fields.issueDate, '2026-04-23');
      assert.equal(result.extraction.fields.scheduleTo, '2027-03-31');
      assert.equal(result.extraction.lineItems[0].itemCode, 'MLS0000022');
      assert.equal(calls, 2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
