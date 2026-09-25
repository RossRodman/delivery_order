"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { computeOrder, type ComputedOrder, type LineApproval } from "@/domain";
import { api } from "@/client/api";
import type { Catalog, OrderInput, OrderView, PriceChange } from "@/contracts/api";
import type { ApiError } from "@/client/api";

export interface EditableLine {
  id: string;
  productId: string;
  qty: number;
  discountCents: number;
  approval: LineApproval;
}

export interface UseOrderState {
  loading: boolean;
  catalog: Catalog | null;
  server: OrderView | null;
  dealerId: string;
  rate: number;
  lines: EditableLine[];
  computed: ComputedOrder | null;
  saving: boolean;
  error: ApiError | null;
  priceChanges: PriceChange[];
  isCreator: boolean;
}

const AUTOSAVE_DEBOUNCE_MS = 800;

/** Order screen state (plan.md §7): local OrderInput + server snapshot, live-computed via domain. */
export function useOrder(orderId: string, meId: string | null) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [server, setServer] = useState<OrderView | null>(null);
  const [dealerId, setDealerIdState] = useState("");
  const [rate, setRateState] = useState(0);
  const [lines, setLines] = useState<EditableLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [priceChanges, setPriceChanges] = useState<PriceChange[]>([]);
  const isNewOrderRef = useRef(true);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const catalogResult = await api.catalog();
      if (cancelled) return;
      if (catalogResult.ok) {
        setCatalog(catalogResult.data);
      }

      const orderResult = await api.getOrder(orderId);
      if (cancelled) return;
      if (orderResult.ok) {
        isNewOrderRef.current = false;
        applyServerOrder(orderResult.data);
      } else {
        isNewOrderRef.current = true;
        if (catalogResult.ok) {
          setRateState(catalogResult.data.globalRate);
        }
      }
      setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [orderId]);

  function applyServerOrder(view: OrderView) {
    setServer(view);
    setDealerIdState(view.dealer.id);
    setRateState(view.rate);
    setLines(
      view.lines.map((l) => ({
        id: l.id,
        productId: l.product.id,
        qty: l.qty,
        discountCents: l.discountCents,
        approval: {
          status: l.approval.status,
          terms:
            l.approval.status === "approved"
              ? { productId: l.product.id, qty: l.qty, unitPriceCents: l.unitPriceCents, discountCents: l.discountCents }
              : null,
        },
      })),
    );
  }

  const computed = useMemo<ComputedOrder | null>(() => {
    if (!catalog || rate <= 0) return null;
    const priced = lines
      .map((l) => {
        const product = catalog.products.find((p) => p.id === l.productId);
        if (!product) return null;
        return {
          id: l.id,
          productId: l.productId,
          qty: l.qty,
          unitPriceCents: product.unitPriceCents,
          discountCents: l.discountCents,
          approval: l.approval,
        };
      })
      .filter((l): l is NonNullable<typeof l> => l !== null);
    if (priced.length === 0) return { lines: [], totalUsdCents: 0, totalSdg: 0, blockingLineIds: [], canSave: false };
    return computeOrder({ rate, lines: priced });
  }, [catalog, rate, lines]);

  const buildInput = useCallback((): OrderInput | null => {
    if (!dealerId || rate <= 0) return null;
    return {
      dealerId,
      rate,
      lines: lines.map((l) => ({ id: l.id, productId: l.productId, qty: l.qty, discountCents: l.discountCents })),
    };
  }, [dealerId, rate, lines]);

  const isCreator = server ? server.createdBy.id === meId : true;
  const isMine = !server || isCreator;
  const canEdit = isMine && (!server || server.status === "draft");

  const runAutosave = useCallback(async () => {
    const input = buildInput();
    if (!input || input.lines.length === 0) return;
    const result = await api.putOrder(orderId, input);
    if (result.ok) {
      isNewOrderRef.current = false;
      setPriceChanges(result.data.priceChanges);
      setServer((prev) => ({ ...(prev ?? result.data), ...result.data }));
    }
  }, [buildInput, orderId]);

  const runAutosaveRef = useRef(runAutosave);
  runAutosaveRef.current = runAutosave;

  const scheduleAutosave = useCallback(() => {
    if (!canEdit) return;
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => {
      autosaveTimer.current = null;
      runAutosaveRef.current();
    }, AUTOSAVE_DEBOUNCE_MS);
  }, [canEdit]);

  useEffect(() => {
    // Flush a pending debounced autosave immediately when the screen unmounts (e.g. the
    // adviser navigates away right after an edit) so the last change is never silently lost.
    return () => {
      if (autosaveTimer.current) {
        clearTimeout(autosaveTimer.current);
        autosaveTimer.current = null;
        runAutosaveRef.current();
      }
    };
  }, []);

  function setDealerId(id: string) {
    setDealerIdState(id);
    scheduleAutosave();
  }

  function setRate(value: number) {
    setRateState(value);
    scheduleAutosave();
  }

  function addLine(productId: string) {
    setLines((prev) => [
      ...prev,
      { id: crypto.randomUUID(), productId, qty: 1, discountCents: 0, approval: { status: "none", terms: null } },
    ]);
    scheduleAutosave();
  }

  function removeLine(id: string) {
    setLines((prev) => prev.filter((l) => l.id !== id));
    scheduleAutosave();
  }

  function voidApprovalIfChanged(line: EditableLine): LineApproval {
    if (line.approval.status === "approved" || line.approval.status === "pending") {
      return { status: "none", terms: null };
    }
    return line.approval;
  }

  function setQty(id: string, qty: number) {
    setLines((prev) =>
      prev.map((l) => (l.id === id ? { ...l, qty, approval: voidApprovalIfChanged(l) } : l)),
    );
    scheduleAutosave();
  }

  function setDiscountCents(id: string, discountCents: number) {
    setLines((prev) =>
      prev.map((l) => (l.id === id ? { ...l, discountCents, approval: voidApprovalIfChanged(l) } : l)),
    );
    scheduleAutosave();
  }

  async function save() {
    const input = buildInput();
    if (!input) return;
    setSaving(true);
    setError(null);
    const result = await api.saveOrder(orderId, input);
    setSaving(false);
    if (result.ok) {
      applyServerOrder(result.data.order);
      setPriceChanges(result.data.priceChanges);
    } else {
      setError(result.error);
    }
  }

  async function requestApproval() {
    const input = buildInput();
    if (!input) return;
    setSaving(true);
    setError(null);
    const result = await api.requestApproval(orderId, input);
    setSaving(false);
    if (result.ok) {
      applyServerOrder(result.data.order);
      setPriceChanges(result.data.priceChanges);
    } else {
      setError(result.error);
    }
  }

  async function withdraw() {
    setSaving(true);
    const result = await api.withdrawApproval(orderId);
    setSaving(false);
    if (result.ok) {
      applyServerOrder(result.data.order);
    } else {
      setError(result.error);
    }
  }

  return {
    loading,
    catalog,
    server,
    dealerId,
    rate,
    lines,
    computed,
    saving,
    error,
    priceChanges,
    isCreator,
    canEdit,
    setDealerId,
    setRate,
    addLine,
    removeLine,
    setQty,
    setDiscountCents,
    save,
    requestApproval,
    withdraw,
    clearError: () => setError(null),
  };
}
