"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/client/api";
import type { Role } from "@/contracts/api";
import { RoleLoginCard } from "@/components/RoleLoginCard";
import { useToast } from "@/components/Toast";
import { setCachedMe } from "@/client/offline/db";

export default function LoginPage() {
  const router = useRouter();
  const { show } = useToast();
  const [loading, setLoading] = useState<Role | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastToken, setLastToken] = useState<string | null>(null);

  async function handleSelect(role: Role) {
    setLoading(role);
    setError(null);
    const result = await api.demoLogin(role);
    setLoading(null);
    if (!result.ok) {
      setError("Couldn't sign in. Try again.");
      return;
    }
    setLastToken(result.data.token);
    await setCachedMe(result.data.user);
    router.push("/orders");
  }

  async function copyToken() {
    if (!lastToken) {
      // Sign in first so there is a token to copy.
      const result = await api.demoLogin("adviser");
      if (!result.ok) return;
      setLastToken(result.data.token);
      await navigator.clipboard?.writeText(result.data.token);
    } else {
      await navigator.clipboard?.writeText(lastToken);
    }
    show("Token copied.", "success");
  }

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 bg-bg-canvas p-6">
      <h1 className="text-display">Order Desk</h1>
      <p className="text-body text-text-secondary">Sign in as</p>
      <div className="flex gap-4">
        <RoleLoginCard name="Amina" role="adviser" onSelect={handleSelect} disabled={loading !== null} />
        <RoleLoginCard name="Yusuf" role="owner" onSelect={handleSelect} disabled={loading !== null} />
      </div>
      {loading && <p className="text-body text-text-secondary">Signing in…</p>}
      {error && (
        <p role="alert" className="text-small text-danger-900">
          {error}
        </p>
      )}
      <p className="text-small text-text-secondary">Demo login — no password required.</p>
      <button type="button" onClick={copyToken} className="focus-ring text-small text-brand-600 hover:underline">
        Copy API token (for curl)
      </button>
    </main>
  );
}
