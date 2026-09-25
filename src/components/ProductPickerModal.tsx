"use client";

import { useState } from "react";
import { formatUsd } from "@/domain";
import type { CatalogProduct } from "@/contracts/api";

export function ProductPickerModal({
  products,
  onAdd,
  onClose,
}: {
  products: CatalogProduct[];
  onAdd: (productId: string) => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState("");

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div className="w-full max-w-sm rounded-lg bg-bg-surface p-6 shadow-lg">
        <h2 className="text-h2 mb-4">Add product</h2>
        <select
          autoFocus
          aria-label="Select a product"
          className="focus-ring mb-4 w-full rounded-md border border-border-default px-2 py-1.5 text-body"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
        >
          <option value="">Select a product…</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} — {formatUsd(p.unitPriceCents)}
            </option>
          ))}
        </select>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="focus-ring rounded-md px-3 py-1.5 text-body">
            Cancel
          </button>
          <button
            type="button"
            disabled={!selected}
            onClick={() => {
              onAdd(selected);
              onClose();
            }}
            className="focus-ring rounded-md bg-brand-600 px-3 py-1.5 text-body text-white disabled:opacity-50"
          >
            Add
          </button>
        </div>
      </div>
    </div>
  );
}
