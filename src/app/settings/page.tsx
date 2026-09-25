"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { checkRate } from "@/domain";
import { api } from "@/client/api";
import { useMe } from "@/client/hooks/useMe";
import type { Catalog } from "@/contracts/api";
import { TopBar } from "@/components/TopBar";
import { RateInput } from "@/components/RateInput";
import { PriceEditRow } from "@/components/PriceEditRow";
import { Skeleton } from "@/components/Skeleton";
import { useToast } from "@/components/Toast";

export default function SettingsPage() {
  const router = useRouter();
  const me = useMe();
  const { show } = useToast();
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [rate, setRate] = useState(0);

  useEffect(() => {
    if (me.status !== "authenticated" || me.user.role !== "owner") return;
    api.catalog().then((result) => {
      if (result.ok) {
        setCatalog(result.data);
        setRate(result.data.globalRate);
      }
    });
  }, [me]);

  if (me.status === "loading") {
    return (
      <div className="p-6">
        <Skeleton rows={4} />
      </div>
    );
  }
  if (me.status === "unauthenticated") {
    router.push("/login");
    return null;
  }
  if (me.user.role !== "owner") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-body">You don&apos;t have permission to view this page.</p>
        <button type="button" onClick={() => router.push("/orders")} className="focus-ring text-brand-600 hover:underline">
          ← Orders
        </button>
      </div>
    );
  }

  async function saveRate(value: number) {
    const check = checkRate(value);
    if (!check.ok) return; // RateInput already reset to the minimum before calling us.
    const result = await api.updateGlobalRate(value);
    if (result.ok) {
      setRate(result.data.globalRate);
      show("Rate updated.", "success");
    } else {
      show(result.error.message, "error");
    }
  }

  async function savePrice(productId: string, unitPriceCents: number) {
    const result = await api.updateProductPrice(productId, unitPriceCents);
    if (result.ok) {
      setCatalog((prev) =>
        prev
          ? { ...prev, products: prev.products.map((p) => (p.id === productId ? result.data.product : p)) }
          : prev,
      );
      show("Price updated.", "success");
      return true;
    }
    show(result.error.message, "error");
    return false;
  }

  return (
    <div className="flex flex-1 flex-col gap-6 p-4">
      <TopBar user={me.user} title="Settings" />
      <section className="flex flex-col gap-2">
        <h2 className="text-h2">Global default rate</h2>
        <RateInput value={rate} onChange={saveRate} />
        <p className="text-small text-text-secondary">Existing saved orders keep the rate they were saved with.</p>
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="text-h2">Product prices</h2>
        <p className="text-small text-text-secondary">
          Price changes apply to new lines only; saved orders keep their original price.
        </p>
        {catalog === null ? (
          <Skeleton rows={4} />
        ) : (
          <div className="rounded-lg border border-border-default bg-bg-surface px-4">
            {catalog.products.map((product) => (
              <PriceEditRow key={product.id} product={product} onSave={(cents) => savePrice(product.id, cents)} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
