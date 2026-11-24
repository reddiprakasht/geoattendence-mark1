import { useEffect, useMemo, useRef, useState } from 'react';
import {
  extractStoredDocument,
  saveMonthlyBill,
  saveWorkOrder,
  uploadExtractionDocument,
} from '../utils/sheetsApi.js';
import {
  findPotentialBillDuplicates,
  findPotentialWorkOrderDuplicates,
  formatDocumentDate,
  getBillingPeriod,
  groupLineItemsByUom,
  lineItemToPayload,
  normalizeContractorKey,
  normalizeDocumentFields,
  normalizeMatchKey,
  parseDocumentDate,
  workOrderMatchDiagnostics,
} from '../utils/documentData.js';

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const ACCEPTED_TYPES = new Set(['image/jpeg', 'image/png', 'application/pdf']);
const MIME_TYPES_BY_EXTENSION = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  pdf: 'application/pdf',
};
const FIELD_LABELS = [
  ['documentNumber', 'Document / voucher number'],
  ['issueDate', 'Date of issue'],
  ['voucherDate', 'Voucher / posting date'],
  ['billNumber', 'Contractor bill number'],
  ['billDate', 'Contractor bill date'],
  ['workOrderNumber', 'J.O. / work order number'],
  ['division', 'Division'],
  ['department', 'Department'],
  ['costCentre', 'Cost centre'],
  ['contractorName', 'Contractor name'],
  ['contractorAddress', 'Contractor address'],
  ['vendorCode', 'Vendor code'],
  ['pan', 'PAN'],
  ['gstin', 'GSTIN'],
  ['subject', 'Subject / work description'],
  ['scheduleFrom', 'Schedule / billing from'],
  ['scheduleTo', 'Schedule / billing to'],
  ['grossAmount', 'Gross amount'],
  ['taxableValue', 'Taxable value'],
  ['netAmount', 'Net amount'],
];
const DATE_FIELDS = new Set([
  'issueDate',
  'voucherDate',
  'billDate',
  'scheduleFrom',
  'scheduleTo',
]);

function currentMonth() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function emptyFields() {
  return Object.fromEntries(FIELD_LABELS.map(([name]) => [name, '']));
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const separator = result.indexOf(',');
      if (separator < 0) {
        reject(new Error('The selected document could not be read.'));
        return;
      }
      resolve(result.slice(separator + 1));
    };
    reader.onerror = () => reject(new Error('The selected document could not be read.'));
    reader.readAsDataURL(file);
  });
}

function initialEditableFields(fields) {
  return Object.fromEntries(
    FIELD_LABELS.map(([name]) => [
      name,
      DATE_FIELDS.has(name) ? formatDocumentDate(fields?.[name]) : String(fields?.[name] || ''),
    ]),
  );
}

function validLineItems(lineItems) {
  return lineItems.every((item) => {
    const quantity = Number(String(item.quantity || '').replace(/,/g, ''));
    return String(item.itemCode || '').trim() &&
      String(item.uom || '').trim() &&
      Number.isFinite(quantity) && quantity > 0;
  });
}

function makeSourceData(fields, extraction, billingPeriod) {
  return {
    ...fields,
    ...(billingPeriod ? { billingPeriod } : {}),
    fieldConfidence: extraction.confidence || {},
    attentionFields: extraction.attentionFields || [],
    lineItemAttention: extraction.lineItems.map((item, index) =>
      item.attention ? index : -1).filter((index) => index >= 0),
  };
}

function inferBillSuggestions(workOrders, fields, lineItems) {
  const orderNumber = normalizeMatchKey(fields.workOrderNumber);
  if (orderNumber) {
    const exact = workOrders.filter(
      (workOrder) => normalizeMatchKey(workOrder.number) === orderNumber,
    );
    return exact.map((workOrder) => ({
      workOrder,
      mismatches: workOrderMatchDiagnostics(workOrder, fields, lineItems),
      exact: true,
    }));
  }
  const vendorCode = normalizeMatchKey(fields.vendorCode);
  const contractorName = normalizeContractorKey(fields.contractorName);
  const division = normalizeMatchKey(fields.division);
  const costCentre = normalizeMatchKey(fields.costCentre);
  const hasContractorFilter = Boolean(vendorCode || contractorName);
  const hasPlantFilter = Boolean(division || costCentre);
  return workOrders
    .filter((workOrder) => {
      const saved = workOrder.sourceData || {};
      const contractorMatches =
        (vendorCode && normalizeMatchKey(saved.vendorCode) === vendorCode) ||
        (contractorName &&
          normalizeContractorKey(saved.contractorName || workOrder.contractor) === contractorName);
      const plantMatches =
        (division && normalizeMatchKey(saved.division || workOrder.plant) === division) ||
        (costCentre && normalizeMatchKey(saved.costCentre) === costCentre);
      return (!hasContractorFilter || contractorMatches) &&
        (!hasPlantFilter || plantMatches) &&
        (hasContractorFilter || hasPlantFilter);
    })
    .map((workOrder) => ({
      workOrder,
      mismatches: workOrderMatchDiagnostics(workOrder, fields, lineItems),
      exact: false,
    }));
}

export default function DocumentIntake({ user, workOrders, onSaved }) {
  const fileInput = useRef(null);
  const [file, setFile] = useState(null);
  const [mimeType, setMimeType] = useState('');
  const [documentRef, setDocumentRef] = useState(null);
  const [documentType, setDocumentType] = useState('');
  const [fields, setFields] = useState(emptyFields);
  const [lineItems, setLineItems] = useState([]);
  const [confidence, setConfidence] = useState({});
  const [attentionFields, setAttentionFields] = useState([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [selectedWorkOrderId, setSelectedWorkOrderId] = useState('');
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [fileUrl, setFileUrl] = useState('');

  const isWorkOrder = documentType === 'work_order';
  const isMonthlyBill = documentType === 'monthly_bill';
  const billingPeriod = useMemo(() => getBillingPeriod(fields), [fields]);
  const suggestions = useMemo(
    () => isMonthlyBill ? inferBillSuggestions(workOrders, fields, lineItems) : [],
    [fields, isMonthlyBill, lineItems, workOrders],
  );
  const selectedWorkOrder = workOrders.find((item) => item.id === selectedWorkOrderId);
  const duplicateWorkOrders = isWorkOrder
    ? findPotentialWorkOrderDuplicates(workOrders, fields.documentNumber, fields)
    : [];
  const duplicateBills = isMonthlyBill
    ? findPotentialBillDuplicates(workOrders, selectedWorkOrderId, fields, billingPeriod)
    : [];
  const hasDuplicate = duplicateWorkOrders.length > 0 || duplicateBills.length > 0;

  async function handleFileChange(event) {
    const nextFile = event.target.files?.[0];
    if (!nextFile) return;
    const extension = nextFile.name.split('.').pop()?.toLowerCase() || '';
    const detectedMimeType = ACCEPTED_TYPES.has(nextFile.type)
      ? nextFile.type
      : MIME_TYPES_BY_EXTENSION[extension];
    setMessage('');
    setDocumentRef(null);
    setDocumentType('');
    setMimeType('');
    setFile(null);
    setFields(emptyFields());
    setLineItems([]);
    setSelectedWorkOrderId('');
    if (!detectedMimeType || !ACCEPTED_TYPES.has(detectedMimeType)) {
      setMessage('Choose a JPG, JPEG, PNG, or PDF file.');
      event.target.value = '';
      return;
    }
    if (!nextFile.size || nextFile.size > MAX_FILE_BYTES) {
      setMessage('Each document must be 8 MB or smaller.');
      event.target.value = '';
      return;
    }

    setFile(nextFile);
    setMimeType(detectedMimeType);
    setBusy(true);
    try {
      const base64 = await fileToBase64(nextFile);
      const stored = await uploadExtractionDocument(user.sessionToken, {
        name: nextFile.name,
        mimeType: detectedMimeType,
        month: currentMonth(),
        base64,
      });
      if (!stored || typeof stored.id !== 'string' ||
          stored.name !== nextFile.name || stored.mimeType !== detectedMimeType ||
          typeof stored.month !== 'string') {
        throw new Error('The stored document response was invalid.');
      }
      setDocumentRef(stored);
      const result = await extractStoredDocument(user.sessionToken, stored.id);
      if (!result?.extraction || !result.document ||
          result.document.id !== stored.id ||
          !['work_order', 'monthly_bill', 'unknown'].includes(result.extraction.documentType) ||
          !Array.isArray(result.extraction.lineItems)) {
        throw new Error('The document extraction response was invalid.');
      }
      setDocumentType(result.extraction.documentType);
      setFields(initialEditableFields(result.extraction.fields));
      setLineItems(result.extraction.lineItems.map((item) => ({
        srNo: String(item.srNo || ''),
        itemCode: String(item.itemCode || ''),
        description: String(item.description || ''),
        uom: String(item.uom || ''),
        quantity: String(item.quantity || ''),
        rate: String(item.rate || ''),
        grossAmount: String(item.grossAmount || ''),
        confidence: Number(item.confidence) || 0,
        attention: item.attention === true,
      })));
      setConfidence(result.extraction.confidence || {});
      setAttentionFields(result.extraction.attentionFields || []);

      if (result.extraction.documentType === 'monthly_bill') {
        const candidates = inferBillSuggestions(
          workOrders,
          initialEditableFields(result.extraction.fields),
          result.extraction.lineItems,
        );
        if (candidates.length === 1 && candidates[0].exact &&
            candidates[0].mismatches.length === 0) {
          setSelectedWorkOrderId(candidates[0].workOrder.id);
        }
      }
      if (result.extraction.documentType === 'unknown') {
        setMessage('Document type could not be determined. Check the original and continue using manual entry.');
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not analyze this document.');
    } finally {
      setBusy(false);
    }
  }

  function updateField(name, value) {
    setFields((current) => ({ ...current, [name]: value }));
  }

  function updateLineItem(index, name, value) {
    setLineItems((current) => current.map((item, itemIndex) =>
      itemIndex === index ? { ...item, [name]: value } : item));
  }

  function addLineItem() {
    setLineItems((current) => [...current, {
      srNo: String(current.length + 1),
      itemCode: '',
      description: '',
      uom: '',
      quantity: '',
      rate: '',
      grossAmount: '',
      confidence: 1,
      attention: false,
    }]);
  }

  function removeLineItem(index) {
    setLineItems((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }

  async function saveVerifiedDocument(event) {
    event.preventDefault();
    if (busy || !documentRef || !['work_order', 'monthly_bill'].includes(documentType)) return;
    if (hasDuplicate) {
      setMessage('Potential duplicate detected. This document cannot be saved until the existing record is reviewed.');
      return;
    }
    if (!validLineItems(lineItems)) {
      setMessage('Each line item needs an item code, UOM, and positive quantity.');
      return;
    }
    const normalizedFields = normalizeDocumentFields(fields);
    if (Object.entries(fields).some(([name, value]) =>
      DATE_FIELDS.has(name) && value && !normalizedFields[name])) {
      setMessage('Enter each date as a valid DD/MM/YYYY date.');
      return;
    }
    const payloadLineItems = lineItems.map(lineItemToPayload);
    const quantityItems = groupLineItemsByUom(lineItems);
    if (quantityItems.length === 0) {
      setMessage('Add at least one line item with a valid quantity and UOM.');
      return;
    }
    const sourceData = makeSourceData(normalizedFields, {
      confidence,
      attentionFields,
      lineItems,
    }, isMonthlyBill ? billingPeriod : '');
    setBusy(true);
    setMessage('');
    try {
      if (isWorkOrder) {
        if (!normalizedFields.documentNumber) {
          throw new Error('Enter the Work Order Number before saving.');
        }
        const response = await saveWorkOrder(user.sessionToken, {
          number: normalizedFields.documentNumber,
          category: 'ERP Work Order',
          plant: normalizedFields.division || normalizedFields.costCentre,
          contractor: normalizedFields.contractorName || normalizedFields.vendorCode,
          quantityItems,
          totalQuantity: quantityItems.length === 1 ? quantityItems[0].quantity : 0,
          startDate: normalizedFields.scheduleFrom || normalizedFields.issueDate,
          durationMonths: '',
          sourceData,
          lineItems: payloadLineItems,
          document: {
            id: documentRef.id,
            name: documentRef.name,
            mimeType: documentRef.mimeType,
            month: documentRef.month,
          },
        });
        if (!response?.saved || typeof response.id !== 'string') {
          throw new Error('The saved work order response was invalid.');
        }
      } else {
        if (!selectedWorkOrderId) {
          throw new Error('Select the matching Work Order before saving this bill.');
        }
        if (!normalizedFields.billNumber && !normalizedFields.documentNumber) {
          throw new Error('Enter a contractor bill number or voucher number before saving.');
        }
        if (!billingPeriod) {
          throw new Error('Enter a valid voucher, bill, or schedule date to determine the billing month.');
        }
        const response = await saveMonthlyBill(user.sessionToken, {
          workOrderId: selectedWorkOrderId,
          month: billingPeriod,
          billNumber: normalizedFields.billNumber || normalizedFields.documentNumber,
          quantityItems,
          quantity: quantityItems.length === 1 ? quantityItems[0].quantity : 0,
          sourceData,
          lineItems: payloadLineItems,
          document: {
            id: documentRef.id,
            name: documentRef.name,
            mimeType: documentRef.mimeType,
            month: documentRef.month,
          },
        });
        if (!response?.saved || typeof response.id !== 'string') {
          throw new Error('The saved monthly bill response was invalid.');
        }
      }
      setMessage(isWorkOrder ? 'Verified Work Order saved.' : 'Verified monthly bill saved.');
      setFile(null);
      setDocumentRef(null);
      setDocumentType('');
      setMimeType('');
      setFields(emptyFields());
      setLineItems([]);
      setSelectedWorkOrderId('');
      if (fileInput.current) fileInput.current.value = '';
      onSaved();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save the verified document.');
    } finally {
      setBusy(false);
    }
  }

  function confidenceClass(fieldName) {
    const score = Number(confidence[fieldName] || 0);
    return !fields[fieldName] || score < 0.75 || attentionFields.includes(fieldName)
      ? 'document-field-uncertain'
      : '';
  }

  useEffect(() => {
    if (!file) {
      setFileUrl('');
      return undefined;
    }
    const url = URL.createObjectURL(file);
    setFileUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  return (
    <section className="document-intake">
      <div className="document-intake-heading">
        <div>
          <h3>Import Work Order or Monthly Bill</h3>
          <p>Upload an ERP photo or PDF. Review every extracted value before it enters the ledger.</p>
        </div>
        <label className="document-intake-upload">
          <span>{busy ? 'Analyzing document…' : 'Choose document'}</span>
          <input
            ref={fileInput}
            type="file"
            accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf"
            disabled={busy}
            onChange={handleFileChange}
          />
        </label>
      </div>
      {message && (
        <p className={`admin-msg ${hasDuplicate ? 'message-error' : 'message-info'}`}
          role={hasDuplicate ? 'alert' : 'status'}>
          {message}
        </p>
      )}
      {file && (
        <div className="document-intake-layout">
          <section className="document-intake-source" aria-label="Uploaded document preview">
            <header>
              <strong>{file.name}</strong>
              <div>
                <button type="button" className="secondary-btn" onClick={() => setZoom((value) => Math.max(0.5, value - 0.25))}>−</button>
                <span>{Math.round(zoom * 100)}%</span>
                <button type="button" className="secondary-btn" onClick={() => setZoom((value) => Math.min(2, value + 0.25))}>+</button>
                <button type="button" className="secondary-btn" onClick={() => setRotation((value) => (value + 90) % 360)}>Rotate</button>
              </div>
            </header>
            <div className="document-intake-preview">
              {mimeType === 'application/pdf' ? (
                <iframe
                  src={fileUrl}
                  title={`Preview of ${file.name}`}
                  style={{ transform: `scale(${zoom}) rotate(${rotation}deg)` }}
                />
              ) : (
                <img
                  src={fileUrl}
                  alt={file.name}
                  style={{ transform: `scale(${zoom}) rotate(${rotation}deg)` }}
                />
              )}
            </div>
          </section>

          <section className="document-intake-review">
            {busy && <p role="status">Saving the original privately and reading the document…</p>}
            {!busy && documentType && (
              <>
                <h4>{isWorkOrder ? 'Work Order' : isMonthlyBill ? 'Monthly Bill / Voucher' : 'Unclassified document'}</h4>
                {documentType === 'unknown' && (
                  <p className="document-review-warning">The document header did not match a supported type. Use the existing manual form instead.</p>
                )}
                {documentType !== 'unknown' && (
                  <form onSubmit={saveVerifiedDocument}>
                    <p className="document-review-warning">
                      Amber fields are missing, low-confidence, or marked for visual review. Confirm dates, codes, and quantities against the document.
                    </p>
                    <div className="document-fields-grid">
                      {FIELD_LABELS.map(([name, label]) => (
                        <label key={name} className={confidenceClass(name)}>
                          <span>{label}{DATE_FIELDS.has(name) ? ' (DD/MM/YYYY)' : ''}</span>
                          <input
                            type="text"
                            value={fields[name]}
                            onChange={(event) => updateField(name, event.target.value)}
                            aria-invalid={!fields[name] || Number(confidence[name] || 0) < 0.75}
                          />
                        </label>
                      ))}
                    </div>
                    {isMonthlyBill && (
                      <div className="document-match-panel">
                        <label htmlFor="document-work-order-match">Matched Work Order:</label>
                        <select
                          id="document-work-order-match"
                          value={selectedWorkOrderId}
                          onChange={(event) => setSelectedWorkOrderId(event.target.value)}
                          required
                        >
                          <option value="">Select a Work Order</option>
                          {suggestions.map(({ workOrder, mismatches }) => (
                            <option key={workOrder.id} value={workOrder.id}>
                              {workOrder.number} — {workOrder.contractor} — {workOrder.plant}
                              {mismatches.length ? ` (check ${mismatches.join(', ')})` : ''}
                            </option>
                          ))}
                          {!suggestions.length && workOrders.map((workOrder) => (
                            <option key={workOrder.id} value={workOrder.id}>
                              {workOrder.number} — {workOrder.contractor} — {workOrder.plant}
                            </option>
                          ))}
                        </select>
                        {selectedWorkOrder && (
                          <small>
                            Billing period: {billingPeriod || 'needs a valid date'}; selected {selectedWorkOrder.number}.
                          </small>
                        )}
                        {suggestions.length > 1 && (
                          <p className="document-review-warning">
                            Multiple candidates match. Select the correct Work Order manually; no uncertain match is linked automatically.
                          </p>
                        )}
                        {normalizeMatchKey(fields.workOrderNumber) && !suggestions.length && (
                          <p className="document-review-warning">
                            No exact J.O.No. match was found. Select the correct Work Order manually.
                          </p>
                        )}
                        {suggestions.some((candidate) => candidate.mismatches.length > 0) && (
                          <p className="document-review-warning">
                            Secondary contractor, plant, cost-centre, or item-code checks need review before linking.
                          </p>
                        )}
                        {!normalizeMatchKey(fields.workOrderNumber) && (
                          <p className="document-review-warning">
                            J.O.No. is missing or unreadable. Suggestions use contractor and plant; select a Work Order manually.
                          </p>
                        )}
                      </div>
                    )}
                    <div className="document-line-items">
                      <div className="document-line-items-heading">
                        <h5>Extracted line items</h5>
                        <button type="button" className="secondary-btn" onClick={addLineItem}>Add row</button>
                      </div>
                      <div className="table-scroll">
                        <table>
                          <thead>
                            <tr>
                              <th>Sr No</th><th>Item Code</th><th>Description</th><th>UOM</th>
                              <th>Quantity</th><th>Rate</th><th>Gross</th><th>Review</th>
                            </tr>
                          </thead>
                          <tbody>
                            {lineItems.map((item, index) => (
                              <tr key={`${index}-${item.itemCode}`}>
                                {['srNo', 'itemCode', 'description', 'uom', 'quantity', 'rate', 'grossAmount'].map((name) => (
                                  <td key={name}>
                                    <input
                                      aria-label={`${name} row ${index + 1}`}
                                      value={item[name]}
                                      className={item.attention || item.confidence < 0.75 || !item[name]
                                        ? 'document-field-uncertain' : ''}
                                      onChange={(event) => updateLineItem(index, name, event.target.value)}
                                    />
                                  </td>
                                ))}
                                <td>
                                  {item.attention || item.confidence < 0.75
                                    ? <span className="document-review-flag">Check</span>
                                    : <span>OK</span>}
                                  <button type="button" className="secondary-btn" onClick={() => removeLineItem(index)}>Remove</button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                    {hasDuplicate && (
                      <div className="document-duplicate-warning" role="alert">
                        <strong>Possible duplicate — save blocked.</strong>
                        {duplicateWorkOrders.map((workOrder) => (
                          <span key={workOrder.id}>Work Order {workOrder.number} already exists for {workOrder.contractor}.</span>
                        ))}
                        {duplicateBills.map(({ workOrder, bill }) => (
                          <span key={bill.id}>Voucher / bill {bill.billNumber} already exists on {workOrder.number} for {bill.month}.</span>
                        ))}
                      </div>
                    )}
                    <button
                      type="submit"
                      disabled={busy || hasDuplicate || !validLineItems(lineItems) ||
                        (isMonthlyBill && !selectedWorkOrderId)}
                    >
                      {busy ? 'Saving…' : 'Confirm and Save'}
                    </button>
                  </form>
                )}
              </>
            )}
          </section>
        </div>
      )}
    </section>
  );
}
