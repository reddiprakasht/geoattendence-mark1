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

const DOCUMENT_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const WORK_ORDER_CATEGORIES = ['Manpower', 'Online Steam Leakage'];
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

function getQuantityTypes(category) {
  return category === 'Manpower'
    ? MANPOWER_QUANTITY_TYPES
    : STEAM_LINE_QUANTITY_TYPES;
}

function getPlantLabel(value) {
  return WORK_ORDER_PLANTS.find((plant) => plant.value === value)?.label || 'Not assigned';
}

function getContractorLabel(value) {
  return WORK_ORDER_CONTRACTORS.find((contractor) => contractor.value === value)?.label ||
    'Not assigned';
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
      (workOrder.plant === '' || WORK_ORDER_PLANTS.some((plant) => plant.value === workOrder.plant)) &&
      (workOrder.contractor === '' ||
        WORK_ORDER_CONTRACTORS.some((contractor) => contractor.value === workOrder.contractor)) &&
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

function getRemainingQuantityItems(workOrder) {
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
  if (!workOrder.active) {
    return { label: 'Inactive', className: 'inactive' };
  }
  if (workOrder.remainingQuantity <= 1e-9) {
    return { label: 'Completed', className: 'completed' };
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
      quantityItems: new Map(),
    };
    current.quantity += bill.quantity;
    if (Array.isArray(bill.quantityItems)) {
      bill.quantityItems.forEach((item) => {
        current.quantityItems.set(
          item.quantityType,
          (current.quantityItems.get(item.quantityType) || 0) + item.quantity,
        );
      });
    }
    totalsByMonth.set(bill.month, current);
  });

  let billedSoFar = 0;
  return [...totalsByMonth.entries()]
    .sort(([firstMonth], [secondMonth]) => firstMonth.localeCompare(secondMonth))
    .map(([month, total]) => {
      billedSoFar += total.quantity;
      return {
        month,
        quantity: total.quantity,
        quantityItems: [...total.quantityItems.entries()].map(([quantityType, quantity]) => ({
          quantityType,
          quantity,
        })),
        remainingQuantity: Math.max(0, workOrder.totalQuantity - billedSoFar),
      };
    });
}

function formatBillingMonth(month) {
  return new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' })
    .format(new Date(`${month}-01T12:00:00`));
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
    quantityItems: [{ quantityType: '', quantity: '' }],
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
      workOrder.active && workOrder.remainingQuantity > 1e-9),
    [workOrders],
  );
  const selectedWorkOrder = workOrders.find(
    (workOrder) => workOrder.id === billForm.workOrderId,
  );
  const billWorkOrderOptions = workOrders.filter((workOrder) =>
    workOrder.active &&
    (workOrder.remainingQuantity > 1e-9 ||
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
  const billExceedsBalance = billForm.quantityItems.some((item) => item.quantity !== '') &&
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
        ? { quantityItems: [{ quantityType: '', quantity: '' }] }
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
      quantityItems: [...current.quantityItems, { quantityType: '', quantity: '' }],
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
    if (billForm.quantityItems.some((item) => !item.quantityType || !item.quantity)) {
      setMessage({ text: 'Choose a billed quantity type.', type: 'error' });
      return;
    }
    setSavingBill(true);
    setMessage({ text: editingBill ? 'Updating monthly bill...' : 'Saving monthly bill...', type: 'info' });
    try {
      const response = await saveMonthlyBill(user.sessionToken, {
        billId: editingBill?.id,
        workOrderId: billForm.workOrderId,
        month: billForm.month,
        billNumber: billForm.billNumber,
        quantityItems: billForm.quantityItems,
        quantity: billForm.quantityItems.reduce(
          (total, item) => total + (Number(item.quantity) || 0),
          0,
        ),
        document: null,
      });
      if (!response || response.saved !== true || typeof response.id !== 'string') {
        throw new Error('The saved monthly bill response was invalid.');
      }
      setBillForm({
        workOrderId: '',
        month: getLocalDateKey().slice(0, 7),
        billNumber: '',
        quantityItems: [{ quantityType: '', quantity: '' }],
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
      quantityItems: bill.quantityItems?.length
        ? bill.quantityItems.map((item) => ({ ...item, quantity: String(item.quantity) }))
        : [{ quantityType: '', quantity: String(bill.quantity) }],
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
      quantityItems: [{ quantityType: '', quantity: '' }],
    });
    setMessage({ text: '', type: 'info' });
  }

  async function changeWorkOrderStatus(workOrder) {
    if (user.role !== 'admin') return;
    const nextStatus = workOrder.active ? 'inactive' : 'active';
    if (nextStatus === 'active' && workOrder.remainingQuantity <= 1e-9) {
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
        {message.text && (
          <p className={`admin-msg message-${message.type}`} role="status" aria-live="polite">
            {message.text}
          </p>
        )}

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
            {WORK_ORDER_CATEGORIES.map((category) => (
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
                {WORK_ORDER_PLANTS.map((plant) => (
                  <option key={plant.value} value={plant.value}>{plant.label}</option>
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
                {WORK_ORDER_CONTRACTORS.map((contractor) => (
                  <option key={contractor.value} value={contractor.value}>{contractor.label}</option>
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
              {WORK_ORDER_PLANTS.map((plant) => (
                <option key={plant.value} value={plant.value}>{plant.label}</option>
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
              {WORK_ORDER_CONTRACTORS.map((contractor) => (
                <option key={contractor.value} value={contractor.value}>{contractor.label}</option>
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
                {workOrder.number} — {getPlantLabel(workOrder.plant)} — {getContractorLabel(workOrder.contractor)} — {formatQuantity(workOrder.remainingQuantity)} remaining
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
              <div className="work-order-quantity-row" key={index}>
                <select
                  aria-label={`Billed quantity type ${index + 1}`}
                  required
                  value={item.quantityType}
                  disabled={savingBill || !selectedWorkOrder}
                  onChange={(event) => updateBillQuantity(index, 'quantityType', event.target.value)}
                >
                  <option value="">Choose billed quantity type</option>
                  {selectedWorkOrder &&
                    getQuantityTypes(selectedWorkOrder.category).map((quantityType) => (
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
            Available to bill: {formatQuantity(availableQuantity)}
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
          <strong>{formatQuantity(workOrder.totalQuantity)}</strong>
          {workOrder.quantityItems?.length > 0 && (
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
                  <strong>{formatQuantity(monthlyTotal.quantity)}</strong>
                  {monthlyTotal.quantityItems.length > 0 && (
                    <small>{formatQuantityBreakdown(monthlyTotal.quantityItems)}</small>
                  )}
                </div>
              ))}
            </div>
          )}
        </td>
        <td>
          <strong>{formatQuantity(workOrder.consumedQuantity)}</strong>
          {consumedQuantityItems.length > 0 && (
            <small>{formatQuantityBreakdown(consumedQuantityItems)}</small>
          )}
        </td>
        <td>
          <strong>{formatQuantity(workOrder.remainingQuantity)}</strong>
          {remainingQuantityItems.length > 0 && (
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
              disabled={workOrder.remainingQuantity <= 1e-9 && workOrder.active}
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
                    {workOrder.startDate ? `Started ${workOrder.startDate}` : 'Start date not set'}
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
                              {formatQuantity(monthlyTotal.quantity)}
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
                            <td>{bill.billNumber}</td>
                            <td>
                              {formatQuantity(bill.quantity)}
                              {bill.quantityItems?.length > 0 && (
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
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
