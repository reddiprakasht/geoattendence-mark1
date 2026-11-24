import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findPotentialBillDuplicates,
  findPotentialWorkOrderDuplicates,
  getBillingPeriod,
  groupLineItemsByUom,
  parseDocumentDate,
  workOrderMatchDiagnostics,
} from '../src/utils/documentData.js';

test('document dates accept only real DD/MM/YYYY values', () => {
  assert.equal(parseDocumentDate('23/04/2026'), '2026-04-23');
  assert.equal(parseDocumentDate('29/02/2024'), '2024-02-29');
  assert.equal(parseDocumentDate('29/02/2025'), '');
  assert.equal(parseDocumentDate('31/04/2026'), '');
  assert.equal(parseDocumentDate('2026-04-23'), '');
});

test('billing period uses the posting date before the schedule period', () => {
  assert.equal(getBillingPeriod({
    voucherDate: '31/10/2026',
    billDate: '28/10/2026',
    scheduleTo: '15/10/2026',
  }), '2026-10');
  assert.equal(getBillingPeriod({ scheduleTo: '15/09/2026' }), '2026-09');
});

test('line quantities aggregate by UOM without mixing units', () => {
  assert.deepEqual(groupLineItemsByUom([
    { uom: 'NOS', quantity: '4.00' },
    { uom: 'NOS', quantity: '3' },
    { uom: 'MT', quantity: '1.5' },
  ]), [
    { quantityType: 'NOS', quantity: 7 },
    { quantityType: 'MT', quantity: 1.5 },
  ]);
});

test('Work Order matching reports missing or conflicting secondary identifiers', () => {
  const workOrder = {
    number: '26-27/291',
    contractor: 'TGV Services',
    plant: '01 CAUSTIC',
    sourceData: {
      contractorName: 'TGV Services',
      vendorCode: '2457-04235',
      division: '01 CAUSTIC',
      costCentre: '1-1750 CAUSTIC SODA EVAPORATION',
    },
    lineItems: [{ itemCode: 'MLS0000022', uom: 'NOS' }],
  };
  assert.deepEqual(workOrderMatchDiagnostics(workOrder, {
    contractorName: 'TGV Services',
    vendorCode: '2457-04235',
    division: '01 CAUSTIC',
    costCentre: '1-1750 CAUSTIC SODA EVAPORATION',
  }, [{ itemCode: 'MLS0000022' }]), []);
  assert.deepEqual(workOrderMatchDiagnostics(workOrder, {
    contractorName: 'Another Contractor',
    vendorCode: '2457-99999',
    division: '11 CHLOROMETHANES',
    costCentre: '11-1300 CHLOROMETHANE THERMAL',
  }, [{ itemCode: 'ML00000021' }]), [
    'contractor code',
    'contractor',
    'division',
    'cost centre',
    'item code',
  ]);
});

test('duplicate detection covers order identity and voucher/bill period keys', () => {
  const order = {
    id: 'order-1',
    number: '26-27/291',
    contractor: 'TGV Services',
    sourceData: { contractorName: 'TGV Services', vendorCode: '2457-04235' },
    bills: [{
      id: 'bill-1',
      workOrderId: 'order-1',
      month: '2026-10',
      billNumber: '25',
      sourceData: { documentNumber: '26-27/10/416', billingPeriod: '2026-10' },
    }],
  };
  assert.equal(findPotentialWorkOrderDuplicates([order], '26-27/291', {
    vendorCode: '2457-04235',
  }).length, 1);
  assert.equal(findPotentialWorkOrderDuplicates([{
    number: '26-27/291',
    contractor: 'k-chalapathi-works',
    sourceData: {},
  }], '26-27/291', {
    contractorName: 'K.CHALAPATHI WORKS',
  }).length, 1);
  assert.equal(findPotentialBillDuplicates([order], '', {
    documentNumber: '26-27/10/416',
  }, '2026-10').length, 1);
  assert.equal(findPotentialBillDuplicates([order], 'order-1', {
    billNumber: '25',
  }, '2026-10').length, 1);
  assert.equal(findPotentialBillDuplicates([order], 'order-1', {
    billNumber: '25',
  }, '2026-11').length, 0);
});
