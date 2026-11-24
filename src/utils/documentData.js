const DATE_FIELDS = new Set([
  'issueDate',
  'voucherDate',
  'billDate',
  'scheduleFrom',
  'scheduleTo',
]);

export function formatDocumentDate(value) {
  const isoMatch = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) return `${isoMatch[3]}/${isoMatch[2]}/${isoMatch[1]}`;
  return String(value || '');
}

export function parseDocumentDate(value) {
  const match = String(value || '').trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return '';
  const [, dayText, monthText, yearText] = match;
  const day = Number(dayText);
  const month = Number(monthText);
  const year = Number(yearText);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day) return '';
  return `${yearText}-${monthText}-${dayText}`;
}

export function getBillingPeriod(fields) {
  const dateValue = fields.voucherDate || fields.billDate || fields.scheduleTo;
  const isoDate = parseDocumentDate(dateValue);
  return isoDate ? isoDate.slice(0, 7) : '';
}

export function groupLineItemsByUom(lineItems) {
  const totals = new Map();
  lineItems.forEach((item) => {
    const uom = String(item.uom || '').trim();
    const quantity = Number(String(item.quantity || '').replace(/,/g, ''));
    if (!uom || !Number.isFinite(quantity) || quantity <= 0) return;
    totals.set(uom, (totals.get(uom) || 0) + quantity);
  });
  return [...totals.entries()].map(([quantityType, quantity]) => ({
    quantityType,
    quantity,
  }));
}

export function lineItemToPayload(item) {
  const quantity = Number(String(item.quantity || '').replace(/,/g, ''));
  const parseOptionalAmount = (value) => {
    const text = String(value || '').replace(/[,\s\u20b9]/g, '');
    if (!text) return null;
    const number = Number(text);
    return Number.isFinite(number) && number >= 0 ? number : null;
  };
  return {
    srNo: String(item.srNo || '').trim(),
    itemCode: String(item.itemCode || '').trim(),
    description: String(item.description || '').trim(),
    uom: String(item.uom || '').trim(),
    quantity,
    rate: parseOptionalAmount(item.rate),
    grossAmount: parseOptionalAmount(item.grossAmount),
  };
}

export function normalizeDocumentFields(fields) {
  return Object.fromEntries(
    Object.entries(fields).map(([name, value]) => [
      name,
      DATE_FIELDS.has(name) ? parseDocumentDate(value) : String(value || '').trim(),
    ]),
  );
}

export function normalizeMatchKey(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function normalizeContractorKey(value) {
  return normalizeMatchKey(value).replace(/[^a-z0-9]/g, '');
}

export function workOrderMatchDiagnostics(workOrder, fields, lineItems) {
  const metadata = workOrder.sourceData || {};
  const mismatches = [];
  const billVendor = normalizeMatchKey(fields.vendorCode);
  const orderVendor = normalizeMatchKey(metadata.vendorCode);
  if (billVendor && (!orderVendor || billVendor !== orderVendor)) {
    mismatches.push('contractor code');
  }
  const billContractor = normalizeContractorKey(fields.contractorName);
  const orderContractor = normalizeContractorKey(metadata.contractorName || workOrder.contractor);
  if (billContractor && (!orderContractor || billContractor !== orderContractor)) {
    mismatches.push('contractor');
  }
  const billDivision = normalizeMatchKey(fields.division);
  const orderDivision = normalizeMatchKey(metadata.division || workOrder.plant);
  if (billDivision && (!orderDivision || billDivision !== orderDivision)) {
    mismatches.push('division');
  }
  const billCostCentre = normalizeMatchKey(fields.costCentre);
  const orderCostCentre = normalizeMatchKey(metadata.costCentre);
  if (billCostCentre && (!orderCostCentre || billCostCentre !== orderCostCentre)) {
    mismatches.push('cost centre');
  }
  const orderCodes = new Set((workOrder.lineItems || [])
    .map((item) => normalizeMatchKey(item.itemCode))
    .filter(Boolean));
  const billCodes = lineItems
    .map((item) => normalizeMatchKey(item.itemCode))
    .filter(Boolean);
  if (billCodes.length && (!orderCodes.size || billCodes.some((code) => !orderCodes.has(code)))) {
    mismatches.push('item code');
  }
  return mismatches;
}

export function findPotentialWorkOrderDuplicates(workOrders, number, fields) {
  const key = normalizeMatchKey(number);
  const vendorCode = normalizeMatchKey(fields.vendorCode);
  const contractorName = normalizeContractorKey(fields.contractorName);
  return workOrders.filter((workOrder) => {
    if (normalizeMatchKey(workOrder.number) !== key) return false;
    const savedData = workOrder.sourceData || {};
    const savedVendorCode = normalizeMatchKey(savedData.vendorCode);
    const sameVendorCode = vendorCode && savedVendorCode === vendorCode;
    const sameContractor = contractorName &&
      normalizeContractorKey(savedData.contractorName || workOrder.contractor) === contractorName;
    return Boolean(sameVendorCode || sameContractor);
  });
}

export function findPotentialBillDuplicates(workOrders, workOrderId, fields, billingPeriod) {
  const voucherNumber = normalizeMatchKey(fields.documentNumber);
  const billNumber = normalizeMatchKey(fields.billNumber);
  return workOrders.flatMap((workOrder) =>
    (workOrder.bills || [])
      .filter((bill) => {
        const savedData = bill.sourceData || {};
        const sameVoucher = voucherNumber &&
          normalizeMatchKey(savedData.documentNumber) === voucherNumber;
        const samePeriodBill = workOrder.id === workOrderId &&
          billNumber && normalizeMatchKey(bill.billNumber) === billNumber &&
          normalizeMatchKey(savedData.billingPeriod || bill.month) ===
            normalizeMatchKey(billingPeriod);
        return Boolean(sameVoucher || samePeriodBill);
      })
      .map((bill) => ({ workOrder, bill })),
  );
}
