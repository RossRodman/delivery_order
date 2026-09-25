"use client";

import { useState } from "react";
import { MIN_RATE, formatRate } from "@/domain";

export interface RateInputProps {
  value: number;
  defaultValue?: number;
  onChange: (rate: number) => void;
  disabled?: boolean;
  label?: string;
  error?: string | null;
}

/**
 * Numeric rate input with the reset-to-8,000 behaviour (design.md §4.1, R5/AC3).
 * Typing is unrestricted; validation runs on blur/Enter only.
 */
export function RateInput({ value, defaultValue, onChange, disabled, label = "Order rate", error }: RateInputProps) {
  const [text, setText] = useState(String(value));
  const [flash, setFlash] = useState(false);
  const [helper, setHelper] = useState<string | null>(null);
  // Re-derive the displayed text when the external value changes for a reason other than our
  // own edits (e.g. loading a different order) — computed during render, not in an effect.
  const [syncedValue, setSyncedValue] = useState(value);
  if (value !== syncedValue) {
    setSyncedValue(value);
    setText(String(value));
  }

  function commit() {
    const parsed = Number(text.replace(/,/g, ""));
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < MIN_RATE) {
      onChange(MIN_RATE);
      setText(String(MIN_RATE));
      setFlash(true);
      setHelper(`Rate can't be below ${MIN_RATE.toLocaleString("en-US")} SDG/USD — reset to the minimum.`);
      setTimeout(() => setFlash(false), 400);
      setTimeout(() => setHelper(null), 4000);
      return;
    }
    onChange(parsed);
    setText(String(parsed));
  }

  return (
    <div className="flex flex-col gap-1">
      <label className="text-body text-text-secondary" htmlFor="rate-input">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          id="rate-input"
          type="text"
          inputMode="numeric"
          disabled={disabled}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
          }}
          className={`focus-ring w-32 rounded-md border px-2 py-1 text-mono-num tabular-nums transition ${
            flash ? "border-danger-500 ring-2 ring-danger-500" : "border-border-default"
          }`}
        />
        <span className="text-body text-text-secondary">SDG/USD</span>
      </div>
      {defaultValue !== undefined && defaultValue !== value && (
        <p className="text-small text-text-secondary">Today&apos;s default: {formatRate(defaultValue)}</p>
      )}
      {(helper || error) && (
        <p role="alert" className="text-small text-danger-900">
          {helper ?? error}
        </p>
      )}
    </div>
  );
}
