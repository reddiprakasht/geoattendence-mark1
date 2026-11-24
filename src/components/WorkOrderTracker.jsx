import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  deleteMonthlyBill,
  deleteWorkOrder,
  getStoredDocument,
  listWorkOrders,
  saveMonthlyBill,
  saveWorkOrder,
  setWorkOrderStatus,
} from '../utils/sheetsApi.js';
import { getLocalDateKey } from '../utils/storage.js';
import DocumentIntake from './DocumentIntake.jsx';
import { formatDocumentDate } from '../utils/documentData.js';

const DOCUMENT_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const WORK_ORDER_CATEGORIES = ['Manpower', 'Online Steam Leakage', 'ERP Work Order'];
const MANUAL_WORK_ORDER_CATEGORIES = ['Manpower', 'Online Steam Leakage'];
const MANPOWER_QUANTITY_TYPES = ['Fitter', 'Kalasi'];
const STEAM_LINE_QUANTITY_TYPES = ['2 Inch', '4 Inch', '6 Inch', '8 Inch', '10 Inch'];
const WORK_ORDER_PLANTS = [
  { value: 'power-plant', label: 'POWER PLANT' },
  { value: 'brine-plant', label: 'BRINE PLANT' },
  { value: 'hcl-plant', label: 'HCL PLANT' },
  { value: 'cell-house', label: 'CELL HOUSE' },
  { value: 'fatty-acid', label: 'FATTY ACID' },
  { value: 'fussion-plant', label: 'FUSSION PLANT' },
  { value: 'cms-mech', label: 'CMS MECH' },
  { value: 'cms-process', label: 'CMS PROCESS' },
];
const WORK_ORDER_CONTRACTORS = [
  { value: 'k-chalapathi-works', label: 'K.CHALAPATHI WORKS' },
  { value: 'k-venkatamallapa-naidu', label: 'K. VENKATAMALLAPA NAIDU' },
  { value: 't-reddy-prakash', label: 'T.REDDY PRAKASH' },
  { value: 't-nagarajamma', label: 'T.NAGARAJAMMA' },
  { value: 'v-venkataramana', label: 'V.VENKATARAMANA' },
  { value: 'k-siva-rani', label: 'K.SIVA RANI' },
  { value: 'v-lakshmi-devi', label: 'V.LAKSHMI DEVI' },
  { value: 'mahadeva-experts', label: 'MAHADEVA EXPERTS' },
];
const EMPTY_WORK_ORDER = {
  number: '',
  category: WORK_ORDER_CATEGORIES[0],
  plant: '',
  contractor: '',
  quantityItems: [{ quantityType: '', quantity: '' }],
  startDate: '',
  durationMonths: '',
};

function getQuantityTypes(category, workOrder) {
  if (category === 'ERP Work Order') {
    return [...new Set((workOrder?.lineItems || []).map((item) => item.uom).filter(Boolean))];
  }
  return category === 'Manpower' ? MANPOWER_QUANTITY_TYPES : STEAM_LINE_QUANTITY_TYPES;
}

function getPlantLabel(value) {
  return WORK_ORDER_PLANTS.find((plant) => plant.value === value)?.label || value || 'Not assigned';
}

function getContractorLabel(value) {
  return WORK_ORDER_CONTRACTORS.find((contractor) => contractor.value === value)?.label ||
    value ||
    'Not assigned';
}

function hasRemainingQuantity(workOrder) {
  return Array.isArray(workOrder.lineItems) && workOrder.lineItems.length
    ? workOrder.lineItems.some((item) => Number(item.remainingQuantity) > 1e-9)
    : workOrder.remainingQuantity > 1e-9;
}

function getIssuedQuantityItems(workOrder) {
  if (workOrder.lineItems?.length) {
    const totals = new Map();
    workOrder.lineItems.forEach((item) => {
      totals.set(item.uom, (totals.get(item.uom) || 0) + item.quantity);
    });
    return [...totals.entries()].map(([quantityType, quantity]) => ({ quantityType, quantity }));
  }
  return workOrder.quantityItems || [];
}

function isDocument(value) {
  return value === null || (
    value &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    DOCUMENT_MIME_TYPES.includes(value.mimeType)
  );
}

function isWorkOrderResponse(value) {
  return value &&
    Array.isArray(value.workOrders) &&
    value.workOrders.every((workOrder) =>
      workOrder &&
      typeof workOrder.id === 'string' &&
      typeof workOrder.number === 'string' &&
      WORK_ORDER_CATEGORIES.includes(workOrder.category) &&
      Array.isArray(workOrder.quantityItems) &&
      typeof workOrder.active === 'boolean' &&
      typeof workOrder.plant === 'string' &&
      typeof workOrder.contractor === 'string' &&
      Number.isFinite(workOrder.totalQuantity) &&
      Number.isFinite(workOrder.consumedQuantity) &&
      Number.isFinite(workOrder.remainingQuantity) &&
      (workOrder.startDate === '' || /^\d{4}-\d{2}-\d{2}$/.test(workOrder.startDate)) &&
      (workOrder.durationMonths === null ||
        (Number.isInteger(workOrder.durationMonths) && workOrder.durationMonths > 0)) &&
      isDocument(workOrder.document) &&
      Array.isArray(workOrder.bills) &&
      workOrder.bills.every((bill) =>
        bill &&
        typeof bill.id === 'string' &&
        typeof bill.workOrderId === 'string' &&
        typeof bill.month === 'string' &&
        /^\d{4}-(0[1-9]|1[0-2])$/.test(bill.month) &&
        typeof bill.billNumber === 'string' &&
        Number.isFinite(bill.quantity) &&
        Array.isArray(bill.quantityItems) &&
        isDocument(bill.document)
      )
    );
}

function formatQuantity(quantity) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(quantity);
}

function formatQuantityBreakdown(quantityItems) {
  if (!Array.isArray(quantityItems) || quantityItems.length === 0) return '';
  return quantityItems
    .map((item) => `${item.quantityType}: ${formatQuantity(item.quantity)}`)
    .join('  |  ');
}

function getConsumedQuantityItems(workOrder) {
  const totalsByType = new Map();
  workOrder.bills.forEach((bill) => {
    if (bill.approvalStatus && bill.approvalStatus !== 'approved') return;
    if (Array.isArray(bill.lineItems) && bill.lineItems.length) {
      bill.lineItems.forEach((item) => {
        totalsByType.set(item.uom, (totalsByType.get(item.uom) || 0) + item.quantity);
      });
      return;
    }
    if (!Array.isArray(bill.quantityItems)) return;
    bill.quantityItems.forEach((item) => {
      totalsByType.set(
        item.quantityType,
        (totalsByType.get(item.quantityType) || 0) + item.quantity,
      );
    });
  });
  return [...totalsByType.entries()].map(([quantityType, quantity]) => ({
    quantityType,
    quantity,
  }));
}

function getLineItemQuantityTotals(lineItems) {
  const totalsByUom = new Map();
  lineItems.forEach((item) => {
    totalsByUom.set(item.uom, (totalsByUom.get(item.uom) || 0) + item.quantity);
  });
  return [...totalsByUom.entries()].map(([quantityType, quantity]) => ({
    quantityType,
    quantity,
  }));
}

function getRemainingQuantityItems(workOrder) {
  if (workOrder.lineItems?.length) {
    const remainingByType = new Map();
    workOrder.lineItems.forEach((item) => {
      remainingByType.set(
        item.uom,
        (remainingByType.get(item.uom) || 0) + Number(item.remainingQuantity || 0),
      );
    });
    return [...remainingByType.entries()].map(([quantityType, quantity]) => ({
      quantityType,
      quantity,
    }));
  }
  if (!Array.isArray(workOrder.quantityItems)) return [];
  const consumedByType = new Map(
    getConsumedQuantityItems(workOrder).map((item) => [item.quantityType, item.quantity]),
  );
  return workOrder.quantityItems.map((item) => ({
    quantityType: item.quantityType,
    quantity: Math.max(0, item.quantity - (consumedByType.get(item.quantityType) || 0)),
  }));
}

function getWorkOrderStatus(workOrder) {
  if (!hasRemainingQuantity(workOrder)) {
    return { label: 'Completed', className: 'completed' };
  }
  if (!workOrder.active) {
    return { label: 'Inactive', className: 'inactive' };
  }
  if (workOrder.lineItems?.length) {
    const hasLowItem = workOrder.lineItems.some((item) =>
      Number(item.remainingQuantity) <= Number(item.quantity) * 0.3);
    if (hasLowItem) return { label: 'Low Balance', className: 'low' };
  }
  if (workOrder.remainingQuantity <= workOrder.totalQuantity * 0.3) {
    return { label: 'Low Balance', className: 'low' };
  }
  return { label: 'Active', className: 'active' };
}

function getMonthlyBillTotals(workOrder) {
  const totalsByMonth = new Map();
  workOrder.bills.forEach((bill) => {
    const current = totalsByMonth.get(bill.month) || {
      quantity: 0,
      legacyQuantity: 0,
      hasErpLineItems: false,
      quantityItems: new Map(),
    };
    if (bill.approvalStatus && bill.approvalStatus !== 'approved') return;
    if (bill.lineItems?.length) {
      current.hasErpLineItems = true;
      bill.lineItems.forEach((item) => {
        current.quantityItems.set(
          item.uom,
          (current.quantityItems.get(item.uom) || 0) + item.quantity,
        );
      });
    } else {
      current.legacyQuantity += bill.quantity;
      if (Array.isArray(bill.quantityItems)) {
        bill.quantityItems.forEach((item) => {
          current.quantityItems.set(
            item.quantityType,
            (current.quantityItems.get(item.quantityType) || 0) + item.quantity,
          );
        });
      }
    }
    totalsByMonth.set(bill.month, current);
  });

  let billedSoFar = 0;
  return [...totalsByMonth.entries()]
    .sort(([firstMonth], [secondMonth]) => firstMonth.localeCompare(secondMonth))
    .map(([month, total]) => {
      const quantity = total.hasErpLineItems
        ? total.quantityItems.size === 1
          ? [...total.quantityItems.values()][0]
          : 0
        : total.legacyQuantity;
      billedSoFar += quantity;
      return {
        month,
        quantity,
        quantityItems: [...total.quantityItems.entries()].map(([quantityType, quantity]) => ({
          quantityType,
          quantity,
        })),
        remainingQuantity: workOrder.lineItems?.length
          ? workOrder.lineItems.length && new Set(workOrder.lineItems.map((item) => item.uom)).size > 1
            ? 0
            : Math.max(0, workOrder.totalQuantity - billedSoFar)
          : Math.max(0, workOrder.totalQuantity - billedSoFar),
      };
    });
}

function formatBillingMonth(month) {
  return new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' })
    .format(new Date(`${month}-01T12:00:00`));
}

function addQuantityItems(target, items) {
  items.forEach((item) => {
    target.set(item.quantityType, (target.get(item.quantityType) || 0) + item.quantity);
  });
}

function getWorkOrderKpis(workOrders, month) {
  const issued = new Map();
  const completed = new Map();
  const remaining = new Map();
  const monthly = new Map();
  const byPlant = new Map();
  const byCostCentre = new Map();
  const byContractor = new Map();

  workOrders.forEach((workOrder) => {
    const issuedItems = getIssuedQuantityItems(workOrder);
    addQuantityItems(issued, issuedItems);
    addQuantityItems(completed, getConsumedQuantityItems(workOrder));
    addQuantityItems(remaining, getRemainingQuantityItems(workOrder));
    const plantKey = workOrder.plant || 'Unassigned';
    const plantItems = byPlant.get(plantKey) || new Map();
    addQuantityItems(plantItems, issuedItems);
    byPlant.set(plantKey, plantItems);
    const costCentreKey = workOrder.sourceData?.costCentre || 'Unassigned';
    const costCentreItems = byCostCentre.get(costCentreKey) || new Map();
    addQuantityItems(costCentreItems, issuedItems);
    byCostCentre.set(costCentreKey, costCentreItems);
    const contractorKey = workOrder.contractor || 'Unassigned';
    const contractorItems = byContractor.get(contractorKey) || new Map();
    addQuantityItems(contractorItems, issuedItems);
    byContractor.set(contractorKey, contractorItems);
    workOrder.bills.forEach((bill) => {
      if (bill.month !== month || bill.approvalStatus && bill.approvalStatus !== 'approved') return;
      if (bill.lineItems?.length) {
        addQuantityItems(monthly, bill.lineItems.map((item) => ({
          quantityType: item.uom,
          quantity: item.quantity,
        })));
      } else {
        addQuantityItems(monthly, bill.quantityItems || []);
      }
    });
  });

  const formatMap = (map) => [...map.entries()]
    .map(([quantityType, quantity]) => ({ quantityType, quantity }));
  const formatBreakdown = (map) => formatQuantityBreakdown(formatMap(map)) || '—';
  return {
    totalWorkOrders: workOrders.length,
    issued: formatBreakdown(issued),
    completed: formatBreakdown(completed),
    remaining: formatBreakdown(remaining),
    monthly: formatBreakdown(monthly),
    byPlant: [...byPlant.entries()].map(([label, quantities]) => ({
      label: label || 'Unassigned',
      quantities: formatBreakdown(quantities),
    })),
    byCostCentre: [...byCostCentre.entries()].map(([label, quantities]) => ({
      label: label || 'Unassigned',
      quantities: formatBreakdown(quantities),
    })),
    byContractor: [...byContractor.entries()].map(([label, quantities]) => ({
      label: label || 'Unassigned',
      quantities: formatBreakdown(quantities),
    })),
  };
}

export default function WorkOrderTracker({ user }) {
  const [workOrders, setWorkOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [message, setMessage] = useState({ text: '', type: 'info' });
  const [workOrderForm, setWorkOrderForm] = useState(EMPTY_WORK_ORDER);
  const [savingWorkOrder, setSavingWorkOrder] = useState(false);
  const [billForm, setBillForm] = useState({
    workOrderId: '',
    month: getLocalDateKey().slice(0, 7),
    billNumber: '',
    quantityItems: [{ quantityType: '', quantity: '', itemCode: '' }],
  });
  const [editingBill, setEditingBill] = useState(null);
  const [savingBill, setSavingBill] = useState(false);
  const [expandedWorkOrderId, setExpandedWorkOrderId] = useState('');
  const [previewingDocumentId, setPreviewingDocumentId] = useState('');
  const [documentPreview, setDocumentPreview] = useState(null);
  const [previewError, setPreviewError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [deletingBill, setDeletingBill] = useState(false);
  const [workOrderSearchDraft, setWorkOrderSearchDraft] = useState('');
  const [workOrderSearchQuery, setWorkOrderSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [plantFilter, setPlantFilter] = useState('all');
  const [contractorFilter, setContractorFilter] = useState('all');
  const [workOrderDeleteTarget, setWorkOrderDeleteTarget] = useState(null);
  const [workOrderDeletePassword, setWorkOrderDeletePassword] = useState('');
  const [workOrderDeleteError, setWorkOrderDeleteError] = useState('');
  const [deletingWorkOrder, setDeletingWorkOrder] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    listWorkOrders(user.sessionToken)
      .then((response) => {
        if (!isWorkOrderResponse(response)) {
          throw new Error('The saved work order ledger response was invalid.');
        }
        if (active) setWorkOrders(response.workOrders);
      })
      .catch((error) => {
        if (active) {
          setWorkOrders([]);
          setMessage({
            text: error instanceof Error ? error.message : 'Could not load work orders.',
            type: 'error',
          });
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [reloadKey, user.sessionToken]);

  useEffect(() => {
    if (!documentPreview && !deleteTarget && !workOrderDeleteTarget) return undefined;
    function handleDialogKeyDown(event) {
      if (event.key === 'Escape') {
        setDocumentPreview(null);
        if (!deletingBill) setDeleteTarget(null);
        if (!deletingWorkOrder) setWorkOrderDeleteTarget(null);
      }
    }
    window.addEventListener('keydown', handleDialogKeyDown);
    return () => window.removeEventListener('keydown', handleDialogKeyDown);
  }, [deletingBill, deletingWorkOrder, documentPreview, deleteTarget, workOrderDeleteTarget]);

  const activeWorkOrders = useMemo(
    () => workOrders.filter((workOrder) =>
      workOrder.active && hasRemainingQuantity(workOrder)),
    [workOrders],
  );
  const selectedWorkOrder = workOrders.find(
    (workOrder) => workOrder.id === billForm.workOrderId,
  );
  const billWorkOrderOptions = workOrders.filter((workOrder) =>
    workOrder.active &&
    (hasRemainingQuantity(workOrder) ||
      (editingBill && workOrder.id === billForm.workOrderId)),
  );
  const availableQuantity = selectedWorkOrder
    ? selectedWorkOrder.remainingQuantity +
      (editingBill?.workOrderId === selectedWorkOrder.id ? editingBill.quantity : 0)
    : 0;
  const billQuantity = billForm.quantityItems.reduce(
    (total, item) => total + (Number(item.quantity) || 0),
    0,
  );
  const billExceedsBalance = selectedWorkOrder?.category === 'ERP Work Order'
    ? [...new Set(billForm.quantityItems.map((item) =>
      `${item.itemCode}|${item.quantityType}`))].some((key) => {
      const [itemCode, uom] = key.split('|');
      const requested = billForm.quantityItems.reduce((total, item) =>
        item.itemCode === itemCode && item.quantityType === uom
          ? total + (Number(item.quantity) || 0)
          : total, 0);
      const original = selectedWorkOrder.lineItems.find((item) =>
        item.itemCode === itemCode && item.uom === uom);
      const editingQuantity = editingBill?.lineItems?.reduce((total, item) =>
        item.itemCode === itemCode && item.uom === uom ? total + item.quantity : total, 0) || 0;
      return requested > (Number(original?.remainingQuantity || 0) + editingQuantity) + 1e-9;
    })
    : billForm.quantityItems.some((item) => item.quantity !== '') &&
      billQuantity > availableQuantity + 1e-9;
  const filteredWorkOrders = useMemo(() => {
    const query = workOrderSearchQuery.trim().toLowerCase();
    return workOrders.filter((workOrder) => {
      if (query && !workOrder.number.toLowerCase().includes(query)) return false;
      if (plantFilter !== 'all' && workOrder.plant !== plantFilter) return false;
      if (contractorFilter !== 'all' && workOrder.contractor !== contractorFilter) return false;
      if (statusFilter !== 'all') {
        const status = getWorkOrderStatus(workOrder).label.toLowerCase();
        if (statusFilter === 'active' && (status !== 'active' && status !== 'low balance')) return false;
        if (statusFilter === 'inactive' && status !== 'inactive') return false;
      }
      return true;
    });
  }, [workOrders, workOrderSearchQuery, plantFilter, contractorFilter, statusFilter]);
  const kpis = useMemo(
    () => getWorkOrderKpis(workOrders, getLocalDateKey().slice(0, 7)),
    [workOrders],
  );
  const plantFilterOptions = useMemo(() => [...new Set([
    ...WORK_ORDER_PLANTS.map((plant) => plant.value),
    ...workOrders.map((workOrder) => workOrder.plant).filter(Boolean),
  ])], [workOrders]);
  const contractorFilterOptions = useMemo(() => [...new Set([
    ...WORK_ORDER_CONTRACTORS.map((contractor) => contractor.value),
    ...workOrders.map((workOrder) => workOrder.contractor).filter(Boolean),
  ])], [workOrders]);

  function updateWorkOrderForm(field, value) {
    setWorkOrderForm((current) => ({
      ...current,
      [field]: value,
      ...(field === 'category'
        ? { quantityItems: [{ quantityType: '', quantity: '' }] }
        : {}),
    }));
  }

  function updateWorkOrderQuantity(index, field, value) {
    setWorkOrderForm((current) => ({
      ...current,
      quantityItems: current.quantityItems.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [field]: value } : item),
    }));
  }

  function addWorkOrderQuantity() {
    setWorkOrderForm((current) => ({
      ...current,
      quantityItems: [...current.quantityItems, { quantityType: '', quantity: '' }],
    }));
  }

  function removeWorkOrderQuantity(index) {
    setWorkOrderForm((current) => ({
      ...current,
      quantityItems: current.quantityItems.length === 1
        ? current.quantityItems
        : current.quantityItems.filter((_, itemIndex) => itemIndex !== index),
    }));
  }

  function updateBillForm(field, value) {
    setBillForm((current) => ({
      ...current,
      [field]: value,
      ...(field === 'workOrderId'
        ? { quantityItems: [{ quantityType: '', quantity: '', itemCode: '' }] }
        : {}),
    }));
  }

  function updateBillQuantity(index, field, value) {
    setBillForm((current) => ({
      ...current,
      quantityItems: current.quantityItems.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [field]: value } : item),
    }));
  }

  function addBillQuantity() {
    setBillForm((current) => ({
      ...current,
      quantityItems: [...current.quantityItems, { quantityType: '', quantity: '', itemCode: '' }],
    }));
  }

  function removeBillQuantity(index) {
    setBillForm((current) => ({
      ...current,
      quantityItems: current.quantityItems.length === 1
        ? current.quantityItems
        : current.quantityItems.filter((_, itemIndex) => itemIndex !== index),
    }));
  }

  function reloadLedger() {
    setReloadKey((current) => current + 1);
  }

  async function submitWorkOrder(event) {
    event.preventDefault();
    if (user.role !== 'admin') {
      setMessage({ text: 'Only administrators can add work orders.', type: 'error' });
      return;
    }
    setSavingWorkOrder(true);
    setMessage({ text: 'Saving work order...', type: 'info' });
    try {
      const response = await saveWorkOrder(user.sessionToken, {
        number: workOrderForm.number,
        category: workOrderForm.category,
        plant: workOrderForm.plant,
        contractor: workOrderForm.contractor,
        quantityItems: workOrderForm.quantityItems,
        totalQuantity: workOrderForm.quantityItems.reduce(
          (total, item) => total + (Number(item.quantity) || 0),
          0,
        ),
        startDate: workOrderForm.startDate,
        durationMonths: workOrderForm.durationMonths,
        document: null,
      });
      if (!response || response.saved !== true || typeof response.id !== 'string') {
        throw new Error('The saved work order response was invalid.');
      }
      setWorkOrderForm(EMPTY_WORK_ORDER);
      setMessage({ text: 'Work order added.', type: 'success' });
      reloadLedger();
    } catch (error) {
      setMessage({
        text: error instanceof Error ? error.message : 'Could not save the work order.',
        type: 'error',
      });
    } finally {
      setSavingWorkOrder(false);
    }
  }

  async function submitBill(event) {
    event.preventDefault();
    if (user.role !== 'admin') {
      setMessage({ text: 'Only administrators can manage monthly bills.', type: 'error' });
      return;
    }
    if (!selectedWorkOrder || billExceedsBalance) {
      setMessage({
        text: !selectedWorkOrder
          ? 'Choose an active work order.'
          : `Billed quantity exceeds the available balance of ${formatQuantity(availableQuantity)}.`,
        type: 'error',
      });
      return;
    }
    const isErpBill = selectedWorkOrder?.category === 'ERP Work Order';
    if (billForm.quantityItems.some((item) =>
      !item.quantityType || !item.quantity || (isErpBill && !item.itemCode))) {
      setMessage({ text: 'Choose a billed quantity type.', type: 'error' });
      return;
    }
    setSavingBill(true);
    setMessage({ text: editingBill ? 'Updating monthly bill...' : 'Saving monthly bill...', type: 'info' });
    try {
      const lineItems = isErpBill
        ? billForm.quantityItems.map((item, index) => {
          const original = selectedWorkOrder.lineItems.find((lineItem) =>
            lineItem.itemCode === item.itemCode && lineItem.uom === item.quantityType);
          const previous = editingBill?.lineItems?.find((lineItem) =>
            lineItem.itemCode === item.itemCode && lineItem.uom === item.quantityType);
          return {
            srNo: String(index + 1),
            itemCode: item.itemCode,
            description: previous?.description || original?.description || '',
            uom: item.quantityType,
            quantity: Number(item.quantity),
            rate: previous?.rate ?? null,
            grossAmount: previous?.grossAmount ?? null,
          };
        })
        : [];
      const quantitiesByType = new Map();
      billForm.quantityItems.forEach((item) => {
        quantitiesByType.set(
          item.quantityType,
          (quantitiesByType.get(item.quantityType) || 0) + (Number(item.quantity) || 0),
        );
      });
      const quantityItems = [...quantitiesByType.entries()].map(([quantityType, quantity]) => ({
        quantityType,
        quantity,
      }));
      const response = await saveMonthlyBill(user.sessionToken, {
        billId: editingBill?.id,
        workOrderId: billForm.workOrderId,
        month: billForm.month,
        billNumber: billForm.billNumber,
        quantityItems,
        quantity: quantityItems.length === 1 ? quantityItems[0].quantity : 0,
        sourceData: editingBill?.sourceData || {},
        lineItems,
        document: null,
      });
      if (!response || response.saved !== true || typeof response.id !== 'string') {
        throw new Error('The saved monthly bill response was invalid.');
      }
      setBillForm({
        workOrderId: '',
        month: getLocalDateKey().slice(0, 7),
        billNumber: '',
        quantityItems: [{ quantityType: '', quantity: '', itemCode: '' }],
      });
      setEditingBill(null);
      setMessage({
        text: editingBill ? 'Monthly bill updated.' : 'Monthly bill added.',
        type: 'success',
      });
      reloadLedger();
    } catch (error) {
      setMessage({
        text: error instanceof Error ? error.message : 'Could not save the monthly bill.',
        type: 'error',
      });
    } finally {
      setSavingBill(false);
    }
  }

  function editBill(workOrder, bill) {
    setEditingBill({ ...bill, workOrderId: workOrder.id });
    setBillForm({
      workOrderId: workOrder.id,
      month: bill.month,
      billNumber: bill.billNumber,
      quantityItems: bill.lineItems?.length
        ? bill.lineItems.map((item) => ({
          itemCode: item.itemCode,
          quantityType: item.uom,
          quantity: String(item.quantity),
        }))
        : bill.quantityItems?.length
        ? bill.quantityItems.map((item) => ({ ...item, quantity: String(item.quantity) }))
        : [{ quantityType: '', quantity: String(bill.quantity), itemCode: '' }],
    });
    setExpandedWorkOrderId(workOrder.id);
    setMessage({ text: '', type: 'info' });
  }

  function cancelBillEdit() {
    setEditingBill(null);
    setBillForm({
      workOrderId: '',
      month: getLocalDateKey().slice(0, 7),
      billNumber: '',
      quantityItems: [{ quantityType: '', quantity: '', itemCode: '' }],
    });
    setMessage({ text: '', type: 'info' });
  }

  async function changeWorkOrderStatus(workOrder) {
    if (user.role !== 'admin') return;
    const nextStatus = workOrder.active ? 'inactive' : 'active';
    if (nextStatus === 'active' && !hasRemainingQuantity(workOrder)) {
      setMessage({
        text: 'Completed work orders remain inactive until the billed quantity is corrected.',
        type: 'error',
      });
      return;
    }
    try {
      const response = await setWorkOrderStatus(
        user.sessionToken,
        workOrder.id,
        nextStatus,
      );
      if (!response || response.id !== workOrder.id || response.status !== nextStatus) {
        throw new Error('The work order status response was invalid.');
      }
      setMessage({
        text: `Work order ${workOrder.number} marked ${nextStatus}.`,
        type: 'success',
      });
      reloadLedger();
    } catch (error) {
      setMessage({
        text: error instanceof Error ? error.message : 'Could not change work order status.',
        type: 'error',
      });
    }
  }

  function openWorkOrderDeleteDialog(workOrder) {
    setWorkOrderDeleteTarget(workOrder);
    setWorkOrderDeletePassword('');
    setWorkOrderDeleteError('');
  }

  async function confirmWorkOrderDeletion(event) {
    event.preventDefault();
    if (!workOrderDeleteTarget) return;
    setDeletingWorkOrder(true);
    setWorkOrderDeleteError('');
    try {
      const response = await deleteWorkOrder(
        user.sessionToken,
        workOrderDeleteTarget.id,
        workOrderDeletePassword,
      );
      if (!response ||
          response.id !== workOrderDeleteTarget.id ||
          response.deleted !== true) {
        throw new Error('The work order deletion response was invalid.');
      }
      setWorkOrderDeleteTarget(null);
      setWorkOrderDeletePassword('');
      setMessage({ text: 'Work order and its monthly bills deleted.', type: 'success' });
      reloadLedger();
    } catch (error) {
      setWorkOrderDeleteError(
        error instanceof Error ? error.message : 'Could not delete the work order.',
      );
    } finally {
      setDeletingWorkOrder(false);
    }
  }

  function openBillDeleteDialog(workOrder, bill) {
    setDeleteTarget({ workOrder, bill });
    setDeletePassword('');
    setDeleteError('');
  }

  async function confirmBillDeletion(event) {
    event.preventDefault();
    if (!deleteTarget) return;
    setDeletingBill(true);
    setDeleteError('');
    try {
      const response = await deleteMonthlyBill(
        user.sessionToken,
        deleteTarget.bill.id,
        deletePassword,
      );
      if (!response ||
          response.id !== deleteTarget.bill.id ||
          response.deleted !== true) {
        throw new Error('The monthly bill deletion response was invalid.');
      }
      if (editingBill?.id === deleteTarget.bill.id) cancelBillEdit();
      setDeleteTarget(null);
      setDeletePassword('');
      setMessage({ text: 'Monthly bill deleted and balance recalculated.', type: 'success' });
      reloadLedger();
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : 'Could not delete the monthly bill.');
    } finally {
      setDeletingBill(false);
    }
  }

  async function openDocumentPreview(file) {
    setPreviewingDocumentId(file.id);
    setPreviewError('');
    try {
      const content = await getStoredDocument(user.sessionToken, file.id);
      if (!content ||
          content.id !== file.id ||
          content.name !== file.name ||
          content.mimeType !== file.mimeType ||
          typeof content.base64 !== 'string' ||
          !content.base64) {
        throw new Error('The document preview response was invalid.');
      }
      setDocumentPreview({
        ...file,
        dataUrl: `data:${content.mimeType};base64,${content.base64}`,
      });
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : 'Could not open this document.');
    } finally {
      setPreviewingDocumentId('');
    }
  }

  return (
    <>
      <section className="panel-card work-order-tracker">
        <div className="panel-heading">
          <h2>Work Order &amp; Billing Quantities</h2>
          <span className="panel-tag">30% low-balance alert</span>
        </div>
        <p className="section-copy">
          Track contract quantities and monthly bills. Remaining balances are calculated from the
          saved bill ledger; bills cannot exceed the available work order quantity.
        </p>
        <div className="work-order-kpi-grid" aria-label="Work order quantity summary">
          {[
            ['Total Work Orders', String(kpis.totalWorkOrders)],
            ['Issued Quantity', kpis.issued],
            ['Completed Quantity', kpis.completed],
            ['Remaining Quantity', kpis.remaining],
            ['Monthly Completed', kpis.monthly],
          ].map(([label, value]) => (
            <div className="work-order-kpi" key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
        <div className="work-order-breakdowns">
          <section>
            <h4>Division-wise issued quantities</h4>
            {kpis.byPlant.length
              ? <ul>{kpis.byPlant.map((item) => <li key={item.label}><strong>{item.label}</strong><span>{item.quantities}</span></li>)}</ul>
              : <p>No work order quantities yet.</p>}
          </section>
          <section>
            <h4>Cost Centre-wise issued quantities</h4>
            {kpis.byCostCentre.length
              ? <ul>{kpis.byCostCentre.map((item) => <li key={item.label}><strong>{item.label}</strong><span>{item.quantities}</span></li>)}</ul>
              : <p>No work order quantities yet.</p>}
          </section>
          <section>
            <h4>Contractor-wise issued quantities</h4>
            {kpis.byContractor.length
              ? <ul>{kpis.byContractor.map((item) => <li key={item.label}><strong>{item.label}</strong><span>{item.quantities}</span></li>)}</ul>
              : <p>No work order quantities yet.</p>}
          </section>
        </div>
        {message.text && (
          <p className={`admin-msg message-${message.type}`} role="status" aria-live="polite">
            {message.text}
          </p>
        )}

        <DocumentIntake user={user} workOrders={workOrders} onSaved={reloadLedger} />

        <form className="document-upload-form work-order-form" onSubmit={submitWorkOrder}>
          <h3>Add Work Order</h3>
          <label htmlFor="work-order-number">Work order number:</label>
          <input
            id="work-order-number"
            type="text"
            maxLength={100}
            required
            value={workOrderForm.number}
            disabled={savingWorkOrder}
            onChange={(event) => updateWorkOrderForm('number', event.target.value)}
          />
          <label htmlFor="work-order-category">Category / service type:</label>
          <select
            id="work-order-category"
            required
            value={workOrderForm.category}
            disabled={savingWorkOrder}
            onChange={(event) => updateWorkOrderForm('category', event.target.value)}
          >
            {MANUAL_WORK_ORDER_CATEGORIES.map((category) => (
              <option key={category} value={category}>{category}</option>
            ))}
          </select>
          <div className="work-order-form-grid">
            <div>
              <label htmlFor="work-order-plant">Plant:</label>
              <select
                id="work-order-plant"
                required
                value={workOrderForm.plant}
                disabled={savingWorkOrder}
                onChange={(event) => updateWorkOrderForm('plant', event.target.value)}
              >
                <option value="">Choose plant</option>
                {plantFilterOptions.map((plant) => (
                  <option key={plant} value={plant}>{getPlantLabel(plant)}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="work-order-contractor">Contractor:</label>
              <select
                id="work-order-contractor"
                required
                value={workOrderForm.contractor}
                disabled={savingWorkOrder}
                onChange={(event) => updateWorkOrderForm('contractor', event.target.value)}
              >
                <option value="">Choose contractor</option>
                {contractorFilterOptions.map((contractor) => (
                  <option key={contractor} value={contractor}>{getContractorLabel(contractor)}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="work-order-quantity-list">
            <label>Separate quantities:</label>
            {workOrderForm.quantityItems.map((item, index) => (
              <div className="work-order-quantity-row" key={index}>
                <select
                  aria-label={`Quantity type ${index + 1}`}
                  required
                  value={item.quantityType}
                  disabled={savingWorkOrder}
                  onChange={(event) => updateWorkOrderQuantity(index, 'quantityType', event.target.value)}
                >
                  <option value="">Choose quantity type</option>
                  {getQuantityTypes(workOrderForm.category).map((quantityType) => (
                    <option key={quantityType} value={quantityType}>{quantityType}</option>
                  ))}
                </select>
                <input
                  aria-label={`Quantity ${index + 1}`}
                  type="number"
                  min="0.001"
                  step="any"
                  required
                  placeholder="Quantity"
                  value={item.quantity}
                  disabled={savingWorkOrder}
                  onChange={(event) => updateWorkOrderQuantity(index, 'quantity', event.target.value)}
                />
                {workOrderForm.quantityItems.length > 1 && (
                  <button type="button" className="secondary-btn" onClick={() => removeWorkOrderQuantity(index)}>
                    Remove
                  </button>
                )}
              </div>
            ))}
            <button type="button" className="secondary-btn" onClick={addWorkOrderQuantity}>
              Add another quantity
            </button>
          </div>
          <div className="work-order-form-grid">
            <div>
              <label htmlFor="work-order-start-date">Start date (optional):</label>
              <input
                id="work-order-start-date"
                type="date"
                value={workOrderForm.startDate}
                disabled={savingWorkOrder}
                onChange={(event) => updateWorkOrderForm('startDate', event.target.value)}
              />
            </div>
            <div>
              <label htmlFor="work-order-duration">Duration in months (optional):</label>
              <input
                id="work-order-duration"
                type="number"
                min="1"
                max="120"
                step="1"
                value={workOrderForm.durationMonths}
                disabled={savingWorkOrder}
                onChange={(event) => updateWorkOrderForm('durationMonths', event.target.value)}
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={
              savingWorkOrder ||
              !workOrderForm.plant ||
              !workOrderForm.contractor ||
              workOrderForm.quantityItems.some((item) =>
                !item.quantityType || !item.quantity)
            }
          >
            {savingWorkOrder ? 'Saving work order...' : 'Add Work Order'}
          </button>
        </form>
        <div className="work-order-filters" aria-label="Work order filters">
          <div>
            <label htmlFor="work-order-status-filter">Status:</label>
            <select
              id="work-order-status-filter"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              <option value="all">All statuses</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
          <div>
            <label htmlFor="work-order-plant-filter">Plant:</label>
            <select
              id="work-order-plant-filter"
              value={plantFilter}
              onChange={(event) => setPlantFilter(event.target.value)}
            >
              <option value="all">All plants</option>
              {plantFilterOptions.map((plant) => (
                <option key={plant} value={plant}>{getPlantLabel(plant)}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="work-order-contractor-filter">Contractor:</label>
            <select
              id="work-order-contractor-filter"
              value={contractorFilter}
              onChange={(event) => setContractorFilter(event.target.value)}
            >
              <option value="all">All contractors</option>
              {contractorFilterOptions.map((contractor) => (
                <option key={contractor} value={contractor}>{getContractorLabel(contractor)}</option>
              ))}
            </select>
          </div>
        </div>

        <form className="document-upload-form work-order-form" onSubmit={submitBill}>
          <h3>{editingBill ? 'Edit Monthly Bill' : 'Add Monthly Bill'}</h3>
          <label htmlFor="monthly-bill-work-order">Work order:</label>
          <select
            id="monthly-bill-work-order"
            required
            value={billForm.workOrderId}
            disabled={savingBill || billWorkOrderOptions.length === 0}
            onChange={(event) => updateBillForm('workOrderId', event.target.value)}
          >
            <option value="">Choose an active work order</option>
            {billWorkOrderOptions.map((workOrder) => (
              <option key={workOrder.id} value={workOrder.id}>
                {workOrder.number} — {getPlantLabel(workOrder.plant)} — {getContractorLabel(workOrder.contractor)} — {workOrder.lineItems?.length
                  ? formatQuantityBreakdown(getRemainingQuantityItems(workOrder))
                  : formatQuantity(workOrder.remainingQuantity)} remaining
              </option>
            ))}
          </select>
          <div className="work-order-form-grid">
            <div>
              <label htmlFor="monthly-bill-month">Billing month:</label>
              <input
                id="monthly-bill-month"
                type="month"
                required
                value={billForm.month}
                disabled={savingBill}
                onChange={(event) => updateBillForm('month', event.target.value)}
              />
            </div>
            <div>
              <label htmlFor="monthly-bill-number">Bill number / reference:</label>
              <input
                id="monthly-bill-number"
                type="text"
                maxLength={100}
                required
                value={billForm.billNumber}
                disabled={savingBill}
                onChange={(event) => updateBillForm('billNumber', event.target.value)}
              />
            </div>
          </div>
          <div className="work-order-quantity-list">
            <label>Separate billed quantities:</label>
            {billForm.quantityItems.map((item, index) => (
                <div
                  className={`work-order-quantity-row ${selectedWorkOrder?.category === 'ERP Work Order' ? 'work-order-quantity-row-erp' : ''}`}
                  key={index}
                >
                  {selectedWorkOrder?.category === 'ERP Work Order' && (
                    <select
                      aria-label={`Billed item code ${index + 1}`}
                      value={item.itemCode || ''}
                      disabled={savingBill}
                      onChange={(event) => {
                        const itemCode = event.target.value;
                        const lineItem = selectedWorkOrder.lineItems.find((candidate) =>
                          candidate.itemCode === itemCode);
                        updateBillQuantity(index, 'itemCode', itemCode);
                        if (lineItem) updateBillQuantity(index, 'quantityType', lineItem.uom);
                      }}
                    >
                      <option value="">Choose item code</option>
                      {[...new Set(selectedWorkOrder.lineItems.map((lineItem) => lineItem.itemCode))]
                        .map((itemCode) => (
                          <option key={itemCode} value={itemCode}>{itemCode}</option>
                        ))}
                    </select>
                  )}
                <select
                  aria-label={`Billed quantity type ${index + 1}`}
                  required
                  value={item.quantityType}
                  disabled={savingBill || !selectedWorkOrder}
                  onChange={(event) => updateBillQuantity(index, 'quantityType', event.target.value)}
                >
                  <option value="">Choose billed quantity type</option>
                  {selectedWorkOrder &&
                    getQuantityTypes(selectedWorkOrder.category, selectedWorkOrder).map((quantityType) => (
                      <option key={quantityType} value={quantityType}>{quantityType}</option>
                    ))}
                </select>
                <input
                  aria-label={`Billed quantity ${index + 1}`}
                  type="number"
                  min="0.001"
                  step="any"
                  required
                  placeholder="Quantity"
                  value={item.quantity}
                  disabled={savingBill}
                  onChange={(event) => updateBillQuantity(index, 'quantity', event.target.value)}
                />
                {billForm.quantityItems.length > 1 && (
                  <button type="button" className="secondary-btn" onClick={() => removeBillQuantity(index)}>
                    Remove
                  </button>
                )}
              </div>
            ))}
            <button type="button" className="secondary-btn" disabled={!selectedWorkOrder} onClick={addBillQuantity}>
              Add another billed quantity
            </button>
          </div>
          <p className={`work-order-availability ${billExceedsBalance ? 'message-error' : ''}`}>
            Available to bill: {selectedWorkOrder?.category === 'ERP Work Order'
              ? formatQuantityBreakdown(getRemainingQuantityItems(selectedWorkOrder))
              : formatQuantity(availableQuantity)}
          </p>
          {billExceedsBalance && (
            <p className="admin-msg message-error" role="alert">
              This quantity exceeds the available work order balance.
            </p>
          )}
          {selectedWorkOrder && (
            <div className="work-order-assignment">
              <strong>Plant:</strong> {getPlantLabel(selectedWorkOrder.plant)}
              <span>Contractor:</span> {getContractorLabel(selectedWorkOrder.contractor)}
            </div>
          )}
          <div className="work-order-form-actions">
            <button
              type="submit"
              disabled={
                savingBill ||
                billWorkOrderOptions.length === 0 ||
                !billForm.workOrderId ||
                billForm.quantityItems.some((item) =>
                  !item.quantityType || !item.quantity) ||
                billExceedsBalance
              }
            >
              {savingBill ? 'Saving bill...' : editingBill ? 'Save Bill Changes' : 'Add Monthly Bill'}
            </button>
            {editingBill && (
              <button
                className="secondary-btn"
                type="button"
                disabled={savingBill}
                onClick={cancelBillEdit}
              >
                Cancel Edit
              </button>
            )}
          </div>
          {billWorkOrderOptions.length === 0 && (
            <p className="work-order-availability">
              Add a work order with a remaining balance before entering a bill.
            </p>
          )}
        </form>

        <div className="panel-heading work-order-summary-heading">
          <h3>Work Order Summary</h3>
          <span className="panel-tag">{filteredWorkOrders.length} of {workOrders.length} shown</span>
        </div>
        <form
          className="work-order-search"
          onSubmit={(event) => {
            event.preventDefault();
            setWorkOrderSearchQuery(workOrderSearchDraft);
          }}
        >
          <label htmlFor="work-order-search">Search work order number:</label>
          <div className="work-order-search-controls">
            <input
              id="work-order-search"
              type="search"
              value={workOrderSearchDraft}
              onChange={(event) => setWorkOrderSearchDraft(event.target.value)}
              placeholder="Enter work order number"
            />
            <button
              type="button"
              onClick={() => setWorkOrderSearchQuery(workOrderSearchDraft)}
            >
              Search
            </button>
            {workOrderSearchQuery && (
              <button
                className="secondary-btn"
                type="button"
                onClick={() => {
                  setWorkOrderSearchDraft('');
                  setWorkOrderSearchQuery('');
                }}
              >
                Clear
              </button>
            )}
          </div>
        </form>
        {loading ? (
          <p className="document-empty">Loading work order ledger...</p>
        ) : workOrders.length === 0 ? (
          <p className="document-empty">No work orders yet. Add a work order above to begin.</p>
        ) : filteredWorkOrders.length === 0 ? (
          <p className="document-empty">No work order matches that number.</p>
        ) : (
          <div className="table-scroll">
            <table className="work-order-summary-table">
              <thead>
                <tr>
                  <th>Work Order No.</th>
                  <th>Category</th>
                  <th>Plant</th>
                  <th>Contractor</th>
                  <th>Total Qty</th>
                  <th>Monthly Billing</th>
                  <th>Billed So Far</th>
                  <th>Remaining Balance</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredWorkOrders.map((workOrder) => {
                  const status = getWorkOrderStatus(workOrder);
                  const expanded = expandedWorkOrderId === workOrder.id;
                  return (
                    <FragmentRows
                      key={workOrder.id}
                      workOrder={workOrder}
                      status={status}
                      expanded={expanded}
                      previewingDocumentId={previewingDocumentId}
                      onToggle={() => setExpandedWorkOrderId(expanded ? '' : workOrder.id)}
                      onPreview={openDocumentPreview}
                      onEditBill={editBill}
                      onDeleteBill={openBillDeleteDialog}
                      onChangeStatus={changeWorkOrderStatus}
                      onDeleteWorkOrder={openWorkOrderDeleteDialog}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {previewError && <p className="admin-msg message-error" role="alert">{previewError}</p>}
      </section>

      {workOrderDeleteTarget && createPortal(
        <div
          className="confirm-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !deletingWorkOrder) {
              setWorkOrderDeleteTarget(null);
            }
          }}
        >
          <section
            className="confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-work-order-title"
          >
            <h2 id="delete-work-order-title">Delete work order?</h2>
            <p>
              Delete work order {workOrderDeleteTarget.number}, including all of its monthly bills.
              This cannot be undone.
            </p>
            <form onSubmit={confirmWorkOrderDeletion}>
              <label htmlFor="delete-work-order-password">Administrator password:</label>
              <input
                id="delete-work-order-password"
                type="password"
                autoComplete="current-password"
                maxLength={128}
                required
                autoFocus
                value={workOrderDeletePassword}
                disabled={deletingWorkOrder}
                onChange={(event) => {
                  setWorkOrderDeletePassword(event.target.value);
                  setWorkOrderDeleteError('');
                }}
              />
              {workOrderDeleteError && (
                <p className="admin-msg message-error" role="alert">
                  {workOrderDeleteError}
                </p>
              )}
              <div className="confirm-dialog-actions">
                <button
                  className="secondary-btn"
                  type="button"
                  disabled={deletingWorkOrder}
                  onClick={() => setWorkOrderDeleteTarget(null)}
                >
                  Cancel
                </button>
                <button
                  className="danger-confirm-btn"
                  type="submit"
                  disabled={deletingWorkOrder}
                >
                  {deletingWorkOrder ? 'Deleting...' : 'Delete Work Order'}
                </button>
              </div>
            </form>
          </section>
        </div>,
        document.body,
      )}

      {deleteTarget && createPortal(
        <div
          className="confirm-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !deletingBill) setDeleteTarget(null);
          }}
        >
          <section
            className="confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-monthly-bill-title"
          >
            <h2 id="delete-monthly-bill-title">Delete monthly bill?</h2>
            <p>
              Delete bill {deleteTarget.bill.billNumber} from work order{' '}
              {deleteTarget.workOrder.number}? Its quantity will be returned to the balance. The
              uploaded copy remains in Documents.
            </p>
            <form onSubmit={confirmBillDeletion}>
              <label htmlFor="delete-monthly-bill-password">Administrator password:</label>
              <input
                id="delete-monthly-bill-password"
                type="password"
                autoComplete="current-password"
                maxLength={128}
                required
                autoFocus
                value={deletePassword}
                disabled={deletingBill}
                onChange={(event) => {
                  setDeletePassword(event.target.value);
                  setDeleteError('');
                }}
              />
              {deleteError && <p className="admin-msg message-error" role="alert">{deleteError}</p>}
              <div className="confirm-dialog-actions">
                <button
                  className="secondary-btn"
                  type="button"
                  disabled={deletingBill}
                  onClick={() => setDeleteTarget(null)}
                >
                  Cancel
                </button>
                <button
                  className="danger-confirm-btn"
                  type="submit"
                  disabled={deletingBill}
                >
                  {deletingBill ? 'Deleting...' : 'Confirm Delete'}
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
            aria-labelledby="work-order-document-preview-title"
          >
            <header className="document-preview-header">
              <h2 id="work-order-document-preview-title">{documentPreview.name}</h2>
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
    </>
  );
}

function FragmentRows({
  workOrder,
  status,
  expanded,
  previewingDocumentId,
  onToggle,
  onPreview,
  onEditBill,
  onDeleteBill,
  onChangeStatus,
  onDeleteWorkOrder,
}) {
  const monthlyTotals = getMonthlyBillTotals(workOrder);
  const consumedQuantityItems = getConsumedQuantityItems(workOrder);
  const remainingQuantityItems = getRemainingQuantityItems(workOrder);
  const issuedQuantityItems = getIssuedQuantityItems(workOrder);
  const workOrderData = workOrder.sourceData || {};

  return (
    <>
      <tr className="work-order-summary-row">
        <td>
          <button
            className="work-order-expand-btn"
            type="button"
            aria-expanded={expanded}
            onClick={onToggle}
          >
            <span aria-hidden="true">{expanded ? '−' : '+'}</span>
            {workOrder.number}
          </button>
        </td>
        <td>{workOrder.category}</td>
        <td>{getPlantLabel(workOrder.plant)}</td>
        <td>{getContractorLabel(workOrder.contractor)}</td>
        <td>
          <strong>{workOrder.lineItems?.length
            ? formatQuantityBreakdown(issuedQuantityItems)
            : formatQuantity(workOrder.totalQuantity)}</strong>
          {!workOrder.lineItems?.length && workOrder.quantityItems?.length > 0 && (
            <small>{formatQuantityBreakdown(workOrder.quantityItems)}</small>
          )}
        </td>
        <td>
          {monthlyTotals.length === 0 ? (
            <span className="work-order-monthly-empty">No billing yet</span>
          ) : (
            <div className="work-order-monthly-list">
              {monthlyTotals.map((monthlyTotal) => (
                <div className="work-order-monthly-item" key={monthlyTotal.month}>
                  <span>{formatBillingMonth(monthlyTotal.month)}</span>
                  <strong>{monthlyTotal.quantity > 0
                    ? formatQuantity(monthlyTotal.quantity)
                    : 'Various units'}</strong>
                  {monthlyTotal.quantityItems.length > 0 && (
                    <small>{formatQuantityBreakdown(monthlyTotal.quantityItems)}</small>
                  )}
                </div>
              ))}
            </div>
          )}
        </td>
        <td>
          <strong>{workOrder.lineItems?.length
            ? formatQuantityBreakdown(consumedQuantityItems) || '0'
            : formatQuantity(workOrder.consumedQuantity)}</strong>
          {!workOrder.lineItems?.length && consumedQuantityItems.length > 0 && (
            <small>{formatQuantityBreakdown(consumedQuantityItems)}</small>
          )}
        </td>
        <td>
          <strong>{workOrder.lineItems?.length
            ? formatQuantityBreakdown(remainingQuantityItems) || '0'
            : formatQuantity(workOrder.remainingQuantity)}</strong>
          {!workOrder.lineItems?.length && remainingQuantityItems.length > 0 && (
            <small>{formatQuantityBreakdown(remainingQuantityItems)}</small>
          )}
        </td>
        <td>
          <span className={`work-order-status ${status.className}`}>{status.label}</span>
        </td>
        <td>
          <div className="work-order-actions">
            <button
              className="secondary-btn"
              type="button"
              onClick={() => onChangeStatus(workOrder)}
              disabled={!hasRemainingQuantity(workOrder) && workOrder.active}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                {workOrder.active ? (
                  <path d="M12 3v9m6.36-5.36a9 9 0 1 1-12.72 0" />
                ) : (
                  <path d="M5 12.5 9.5 17 19 7.5" />
                )}
              </svg>
              {workOrder.active ? 'Deactivate' : 'Activate'}
            </button>
            <button
              className="danger-btn"
              type="button"
              onClick={() => onDeleteWorkOrder(workOrder)}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5" />
              </svg>
              Delete
            </button>
          </div>
        </td>
      </tr>
      {expanded && (
        <tr className="work-order-ledger-row">
          <td colSpan="10">
            <div className="work-order-ledger">
              <div className="work-order-ledger-heading">
                <div>
                  <strong>Monthly bill history</strong>
                  <span>
                    {workOrder.startDate
                      ? `Started ${formatDocumentDate(workOrder.startDate)}`
                      : 'Start date not set'}
                    {workOrder.durationMonths ? ` · ${workOrder.durationMonths} months` : ''}
                  </span>
                </div>
                {workOrder.document && (
                  <button
                    className="secondary-btn document-view-btn"
                    type="button"
                    disabled={Boolean(previewingDocumentId)}
                    onClick={() => onPreview(workOrder.document)}
                  >
                    {previewingDocumentId === workOrder.document.id ? 'Opening...' : 'View Work Order'}
                  </button>
                )}
              </div>
              {workOrder.bills.length === 0 ? (
                <p className="document-empty">No monthly bills have been entered.</p>
              ) : (
                <>
                  <div className="table-scroll">
                    <table className="work-order-bill-table">
                      <thead>
                        <tr>
                          <th>Billing Month</th>
                          <th>Monthly Billed Qty</th>
                          <th>Remaining After Month</th>
                        </tr>
                      </thead>
                      <tbody>
                        {monthlyTotals.map((monthlyTotal) => (
                          <tr key={monthlyTotal.month}>
                            <td>{formatBillingMonth(monthlyTotal.month)}</td>
                            <td>
                              {monthlyTotal.quantity > 0
                                ? formatQuantity(monthlyTotal.quantity)
                                : 'Various units'}
                              {monthlyTotal.quantityItems.length > 0 && (
                                <small>{formatQuantityBreakdown(monthlyTotal.quantityItems)}</small>
                              )}
                            </td>
                            <td>{formatQuantity(monthlyTotal.remainingQuantity)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="table-scroll">
                    <table className="work-order-bill-table">
                      <thead>
                        <tr>
                          <th>Billing Month</th>
                          <th>Bill No. / Reference</th>
                          <th>Billed Qty</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {workOrder.bills.map((bill) => (
                          <tr key={bill.id}>
                            <td>{formatBillingMonth(bill.month)}</td>
                            <td>
                              {bill.billNumber}
                              {bill.sourceData?.documentNumber && (
                                <small>Voucher: {bill.sourceData.documentNumber}</small>
                              )}
                              {bill.sourceData?.billDate && (
                                <small>Bill date: {formatDocumentDate(bill.sourceData.billDate)}</small>
                              )}
                              {bill.sourceData?.voucherDate && (
                                <small>Voucher date: {formatDocumentDate(bill.sourceData.voucherDate)}</small>
                              )}
                            </td>
                            <td>
                              {bill.lineItems?.length
                                ? formatQuantityBreakdown(getLineItemQuantityTotals(bill.lineItems))
                                : formatQuantity(bill.quantity)}
                              {bill.lineItems?.length > 0 && (
                                <small>{bill.lineItems.map((item) =>
                                  `${item.srNo ? `${item.srNo}. ` : ''}${item.itemCode}: ${formatQuantity(item.quantity)} ${item.uom}` +
                                  `${item.rate === null ? '' : ` @ ${item.rate}`}` +
                                  `${item.grossAmount === null ? '' : ` / ${item.grossAmount}`}`).join(' | ')}</small>
                              )}
                              {!bill.lineItems?.length && bill.quantityItems?.length > 0 && (
                                <span>
                                  {' — '}
                                  {bill.quantityItems.map((item) =>
                                    `${item.quantityType}: ${formatQuantity(item.quantity)}`).join(', ')}
                                </span>
                              )}
                            </td>
                            <td>
                              <div className="work-order-bill-actions">
                                <button
                                  className="secondary-btn"
                                  type="button"
                                  onClick={() => onEditBill(workOrder, bill)}
                                >
                                  Edit
                                </button>
                                <button
                                  className="danger-btn"
                                  type="button"
                                  onClick={() => onDeleteBill(workOrder, bill)}
                                >
                                  Delete
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
              {workOrder.lineItems?.length > 0 && (
                <div className="table-scroll work-order-item-progress">
                  <table className="work-order-bill-table">
                    <thead>
                      <tr>
                        <th>Sr No</th><th>Item Code</th><th>Description</th><th>UOM</th>
                        <th>Original Issued</th><th>Approved Completed</th><th>Remaining</th>
                        <th>Rate</th><th>Gross</th>
                      </tr>
                    </thead>
                    <tbody>
                      {workOrder.lineItems.map((item, index) => (
                        <tr key={`${item.itemCode}-${item.uom}-${index}`}>
                          <td>{item.srNo}</td>
                          <td>{item.itemCode}</td>
                          <td>{item.description}</td>
                          <td>{item.uom}</td>
                          <td>{formatQuantity(item.quantity)}</td>
                          <td>{formatQuantity(item.completedQuantity || 0)}</td>
                          <td>{formatQuantity(item.remainingQuantity || 0)}</td>
                          <td>{item.rate ?? '—'}</td>
                          <td>{item.grossAmount ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {(workOrderData.division || workOrderData.department ||
                workOrderData.costCentre || workOrderData.contractorName ||
                workOrderData.vendorCode || workOrderData.pan || workOrderData.gstin ||
                workOrderData.subject || workOrderData.scheduleTo) && (
                <dl className="work-order-source-details">
                  {[
                    ['Division', workOrderData.division],
                    ['Department', workOrderData.department],
                    ['Cost Centre', workOrderData.costCentre],
                    ['Contractor', workOrderData.contractorName],
                    ['Contractor Address', workOrderData.contractorAddress],
                    ['Vendor Code', workOrderData.vendorCode],
                    ['PAN', workOrderData.pan],
                    ['GSTIN', workOrderData.gstin],
                    ['Subject', workOrderData.subject],
                    ['Issue Date', formatDocumentDate(workOrderData.issueDate)],
                    ['Voucher Date', formatDocumentDate(workOrderData.voucherDate)],
                    ['Commencement', formatDocumentDate(workOrderData.scheduleFrom)],
                    ['Completion', formatDocumentDate(workOrderData.scheduleTo)],
                    ['Gross', workOrderData.grossAmount],
                    ['Taxable Value', workOrderData.taxableValue],
                    ['Net Amount', workOrderData.netAmount],
                  ].filter(([, value]) => value).map(([label, value]) => (
                    <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
                  ))}
                </dl>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
