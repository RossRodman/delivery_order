"use client";

import { useState } from "react";
import { formatUsd, parseUsdToCents } from "@/domain";
import type { CatalogProduct } from "@/contracts/api";

export function PriceEditRow({
  product,
  onSave,
}: {
  product: CatalogProduct;
  onSave: (unitPriceCents: number) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(formatUsd(product.unitPriceCents).replace("$", ""));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    const parsed = parseUsdToCents(text);
    if (parsed === null || parsed <= 0) {
      setError("Enter a dollar amount with up to 2 decimals.");
      return;
    }
    setSaving(true);
    const ok = await onSave(parsed);
    setSaving(false);
    if (ok) {
      setEditing(false);
      setError(null);
    } else {
      setError("Couldn't save the price. Try again.");
    }
  }

  return (
    <div className="flex items-center justify-between border-b border-border-default py-2 last:border-0">
      <span className="text-body">{product.name}</span>
      {editing ? (
        <div className="flex items-center gap-2">
          <input
            type="text"
            inputMode="decimal"
            aria-label={`${product.name} price`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="focus-ring w-24 rounded-md border border-border-default px-2 py-1 text-mono-num tabular-nums"
          />
          <button type="button" disabled={saving} onClick={handleSave} className="focus-ring text-body text-brand-600">
            Save
          </button>
          <button type="button" onClick={() => setEditing(false)} className="focus-ring text-body text-text-secondary">
            Cancel
          </button>
          {error && (
            <span role="alert" className="text-small text-danger-900">
              {error}
            </span>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <span className="tabular-nums text-mono-num">{formatUsd(product.unitPriceCents)}</span>
          <button type="button" onClick={() => setEditing(true)} className="focus-ring text-body text-brand-600">
            Edit
          </button>
        </div>
      )}
    </div>
  );
}
