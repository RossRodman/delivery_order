"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { computeOrder, formatUsd, type ComputedOrder, type LineApproval } from "@/domain";
import { api } from "@/client/api";
import type { Catalog, LineView, OrderInput, OrderView, PriceChange } from "@/contracts/api";
import type { ApiError } from "@/client/api";
import { loadCatalog } from "@/client/offline/catalog";
import { getLocalOrder, getOutboxEntry, type OutboxIntent } from "@/client/offline/db";
import { saveLocalInput } from "@/client/offline/orders";
import { enqueue } from "@/client/offline/outbox";
import { onSyncChange } from "@/client/offline/sync";
import { useOnline } from "@/client/offline/useOnline";
import { useToast } from "@/components/Toast";

export interface EditableLine {
  id: string;
  productId: string;
  qty: number;
  discountCents: number;
  approval: LineApproval;
}

/** `computeOrder`'s result plus the lines it had to exclude because they no longer price validly. */
export interface UseOrderComputed extends ComputedOrder {
  /** Line ids whose discount now exceeds the (possibly changed) line value — never fed to the
   *  domain module, which would throw; shown as an error row instead (review M-2). */
  invalidLineIds: string[];
}

export interface UseOrderState {
  loading: boolean;
  catalog: Catalog | null;
  server: OrderView | null;
  dealerId: string;
  rate: number;
  lines: EditableLine[];
  computed: UseOrderComputed | null;
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
  const [queuedIntent, setQueuedIntent] = useState<OutboxIntent | null>(null);
  const isNewOrderRef = useRef(true);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { isOnline, syncNow } = useOnline();
  const { show } = useToast();

  const refreshQueuedIntent = useCallback(async () => {
    const entry = await getOutboxEntry(orderId);
    setQueuedIntent(entry?.intent ?? null);
  }, [orderId]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      // The signed-in user isn't known yet (useMe still resolving) — wait rather than fetch
      // under the wrong identity or write a local copy with no owner (review M-1).
      if (!meId) return;
      setLoading(true);
      const catalogData = await loadCatalog();
      if (cancelled) return;
      if (catalogData) setCatalog(catalogData);

      // Review m-6: a local copy that hasn't synced yet (queued save, or a save the server
      // rejected) wins over a fresh server read — the adviser's edits and the refusal are never
      // silently replaced by stale server data just because reopening the page happened to be
      // online.
      const localFirst = await getLocalOrder(orderId);
      if (localFirst && localFirst.userId === meId && localFirst.syncState !== "synced") {
        isNewOrderRef.current = !localFirst.server;
        applyLocalInput(localFirst.input, localFirst.server ?? undefined);
        if (localFirst.lastError) setError(localFirst.lastError);
        await refreshQueuedIntent();
        setLoading(false);
        return;
      }

      const orderResult = await api.getOrder(orderId);
      if (cancelled) return;
      if (orderResult.ok) {
        isNewOrderRef.current = false;
        applyServerOrder(orderResult.data);
        await saveLocalInput(orderId, inputFromView(orderResult.data), meId, {
          server: orderResult.data,
          syncState: "synced",
        });
      } else if (orderResult.error.code === "NETWORK") {
        // Offline: fall back to whatever we have cached for this order (only this user's copy).
        const local = localFirst && localFirst.userId === meId ? localFirst : undefined;
        if (local) {
          isNewOrderRef.current = !local.server;
          applyLocalInput(local.input, local.server ?? undefined);
        } else if (catalogData) {
          isNewOrderRef.current = true;
          setRateState(catalogData.globalRate);
        }
      } else {
        isNewOrderRef.current = true;
        if (catalogData) setRateState(catalogData.globalRate);
      }
      await refreshQueuedIntent();
      setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, meId]);

  useEffect(() => {
    // The sync engine (F7) runs in the background (online event / app start / manual "Sync
    // now") and may not be triggered by this component at all. When it finishes a pass, pick up
    // whatever it decided for this order: synced -> adopt the server snapshot; rejected -> the
    // order becomes editable again with the error surfaced (never silently dropped).
    return onSyncChange(() => {
      refreshQueuedIntent();
      getLocalOrder(orderId).then((local) => {
        if (!local || local.userId !== meId) return;
        if (local.syncState === "synced" && local.server) {
          applyServerOrder(local.server);
          setPriceChanges(local.priceChanges);
        } else if (local.syncState === "rejected") {
          applyLocalInput(local.input, local.server ?? undefined);
          setError(local.lastError);
        }
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, meId]);

  function inputFromView(view: OrderView): OrderInput {
    return {
      dealerId: view.dealer.id,
      rate: view.rate,
      lines: view.lines.map((l) => ({
        id: l.id,
        productId: l.product.id,
        qty: l.qty,
        discountCents: l.discountCents,
        clientUnitPriceCents: l.unitPriceCents,
      })),
    };
  }

  function applyServerOrder(view: OrderView) {
    setServer(view);
    setDealerIdState(view.dealer.id);
    setRateState(view.rate);
    setLines(view.lines.map(lineFromView));
  }

  function lineFromView(l: LineView): EditableLine {
    return {
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
    };
  }

  /** Applies a cached OrderInput (offline reopen, or m-6 unsynced-edits-win). `serverSnapshot`, if any, seeds approvals. */
  function applyLocalInput(input: OrderInput, serverSnapshot?: OrderView) {
    setServer(serverSnapshot ?? null);
    setDealerIdState(input.dealerId);
    setRateState(input.rate);
    const approvalByLineId = new Map((serverSnapshot?.lines ?? []).map((l) => [l.id, l.approval]));
    setLines(
      input.lines.map((l) => {
        const serverLine = (serverSnapshot?.lines ?? []).find((sl) => sl.id === l.id);
        const approvalStatus = approvalByLineId.get(l.id)?.status ?? "none";
        return {
          id: l.id,
          productId: l.productId,
          qty: l.qty,
          discountCents: l.discountCents,
          approval:
            approvalStatus === "approved" && serverLine
              ? {
                  status: "approved",
                  terms: {
                    productId: serverLine.product.id,
                    qty: serverLine.qty,
                    unitPriceCents: serverLine.unitPriceCents,
                    discountCents: serverLine.discountCents,
                  },
                }
              : { status: "none", terms: null },
        };
      }),
    );
  }

  const computed = useMemo<UseOrderComputed | null>(() => {
    if (!catalog || rate <= 0) return null;
    // Review M-2: a line whose discount no longer fits its (possibly just-lowered) price must
    // never reach `computeOrder`/`lineTotal`, which throws — it would crash the whole screen on
    // render. Such a line is set aside as "invalid" and shown with an actionable error instead.
    const invalidLineIds: string[] = [];
    const priced = lines
      .map((l) => {
        const product = catalog.products.find((p) => p.id === l.productId);
        if (!product) return null;
        const value = l.qty * product.unitPriceCents;
        if (l.discountCents > value) {
          invalidLineIds.push(l.id);
          return null;
        }
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
    if (priced.length === 0) {
      return { lines: [], totalUsdCents: 0, totalSdg: 0, blockingLineIds: [], canSave: false, invalidLineIds };
    }
    const result = computeOrder({ rate, lines: priced });
    return { ...result, canSave: result.canSave && invalidLineIds.length === 0, invalidLineIds };
  }, [catalog, rate, lines]);

  const buildInput = useCallback((): OrderInput | null => {
    if (!dealerId || rate <= 0) return null;
    return {
      dealerId,
      rate,
      lines: lines.map((l) => {
        // Review M-4: report the price the client last displayed for this line (from the cached
        // catalog) so the server's `priceChanges` can tell the adviser when it differs — never
        // used for money math server-side (R1).
        const product = catalog?.products.find((p) => p.id === l.productId);
        return {
          id: l.id,
          productId: l.productId,
          qty: l.qty,
          discountCents: l.discountCents,
          ...(product ? { clientUnitPriceCents: product.unitPriceCents } : {}),
        };
      }),
    };
  }, [dealerId, rate, lines, catalog]);

  /** A synthetic OrderView for rendering a locally queued (not-yet-synced) save read-only. */
  const localOrderView = useMemo<OrderView | null>(() => {
    if (!catalog || !computed) return null;
    const dealer = catalog.dealers.find((d) => d.id === dealerId);
    if (!dealer) return null;
    return {
      id: orderId,
      number: server?.number ?? 0,
      status: "saved",
      createdBy: server?.createdBy ?? { id: meId ?? "", name: "You" },
      dealer,
      rate,
      lines: lines.map((l, index) => {
        const product = catalog.products.find((p) => p.id === l.productId);
        // Looked up by id, not index: `computed.lines` omits invalid lines (M-2), so it is not
        // necessarily aligned 1:1 with `lines` any more.
        const c = computed.lines.find((cl) => cl.id === l.id);
        return {
          id: l.id,
          position: index,
          product: product ? { id: product.id, sku: product.sku, name: product.name } : { id: l.productId, sku: "", name: "" },
          qty: l.qty,
          unitPriceCents: product?.unitPriceCents ?? 0,
          discountCents: l.discountCents,
          lineValueCents: c?.lineValueCents ?? 0,
          lineTotalCents: c?.lineTotalCents ?? 0,
          discountBasisPoints: c?.discountBasisPoints ?? 0,
          classification: c?.classification ?? "sand",
          state: c?.state ?? "sand",
          approval: { status: l.approval.status, decidedBy: null, decidedAt: null },
        };
      }),
      totals: { usdCents: computed.totalUsdCents, sdg: computed.totalSdg },
      canSave: computed.canSave,
      blockingLineIds: computed.blockingLineIds,
      createdAt: server?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      savedAt: null,
    };
  }, [catalog, computed, dealerId, lines, meId, orderId, rate, server]);

  const isCreator = server ? server.createdBy.id === meId : true;
  const isMine = !server || isCreator;
  const canEdit = isMine && (!server || server.status === "draft") && queuedIntent !== "save";

  // Review M-4: tell the adviser, once, whenever the server reports a price that differs from
  // what was cached on this device (spec §6: "the user is told if it changed"). A ref (not state)
  // tracks what was already announced so the same batch isn't re-toasted on every re-render.
  const announcedPriceChangesRef = useRef<string>("");
  useEffect(() => {
    if (priceChanges.length === 0 || !catalog) return;
    const signature = JSON.stringify(priceChanges);
    if (signature === announcedPriceChangesRef.current) return;
    announcedPriceChangesRef.current = signature;
    priceChanges.forEach((pc) => {
      const product = catalog.products.find((p) => p.id === pc.productId);
      show(
        `Note: the price of ${product?.name ?? "a product"} changed from ${formatUsd(pc.clientUnitPriceCents)} to ${formatUsd(
          pc.serverUnitPriceCents,
        )}. Totals reflect the new price.`,
        "info",
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [priceChanges, catalog]);

  const runAutosave = useCallback(async () => {
    if (!meId) return;
    const input = buildInput();
    if (!input || input.lines.length === 0) return;
    await saveLocalInput(orderId, input, meId);
    if (!navigator.onLine) {
      await enqueue(orderId, "draft", input, meId);
      await refreshQueuedIntent();
      return;
    }
    const result = await api.putOrder(orderId, input);
    if (result.ok) {
      isNewOrderRef.current = false;
      setPriceChanges(result.data.priceChanges);
      setServer((prev) => ({ ...(prev ?? result.data), ...result.data }));
      await saveLocalInput(orderId, input, meId, { server: result.data, syncState: "synced" });
    } else if (result.error.code === "NETWORK") {
      await enqueue(orderId, "draft", input, meId);
      await refreshQueuedIntent();
    } else {
      // Review m-4: a non-network autosave failure (e.g. 422 after a price drop, 409 once
      // pending/saved) must not be swallowed — the adviser would otherwise believe the draft is
      // stored when it isn't.
      setError(result.error);
    }
  }, [buildInput, meId, orderId, refreshQueuedIntent]);

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
    if (!meId) return;
    const input = buildInput();
    if (!input) return;
    setSaving(true);
    setError(null);
    await saveLocalInput(orderId, input, meId);
    if (!navigator.onLine) {
      await enqueue(orderId, "save", input, meId);
      await refreshQueuedIntent();
      setSaving(false);
      return;
    }
    const result = await api.saveOrder(orderId, input);
    setSaving(false);
    if (result.ok) {
      applyServerOrder(result.data.order);
      setPriceChanges(result.data.priceChanges);
      await saveLocalInput(orderId, input, meId, { server: result.data.order, syncState: "synced" });
    } else if (result.error.code === "NETWORK") {
      await enqueue(orderId, "save", input, meId);
      await refreshQueuedIntent();
    } else {
      setError(result.error);
    }
  }

  async function requestApproval() {
    const input = buildInput();
    if (!input || !isOnline) return;
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
    if (!isOnline) return;
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
    isOnline,
    queued: queuedIntent === "save",
    localOrderView,
    setDealerId,
    setRate,
    addLine,
    removeLine,
    setQty,
    setDiscountCents,
    save,
    requestApproval,
    withdraw,
    syncNow,
    clearError: () => setError(null),
  };
}
