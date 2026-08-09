'use client';

import { useState, useTransition } from 'react';
import { createMissionCheckout } from '../actions';

export interface CheckoutTierProps {
  id: string;
  name: string;
  priceCents: number;
  billing: string;
}

/**
 * Client-side checkout buttons for a service line. Each tier button creates a
 * Stripe Checkout session via the server action and redirects to the payment URL.
 */
export default function ServiceCheckoutButtons({
  serviceId,
  tiers,
}: {
  serviceId: string;
  tiers: CheckoutTierProps[];
}) {
  const [busyTier, setBusyTier] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleCheckout(tier: CheckoutTierProps) {
    setBusyTier(tier.id);
    setError(null);
    startTransition(async () => {
      try {
        const res = await createMissionCheckout({
          serviceId: serviceId as never,
          tierId: tier.id,
        });
        if (res.ok && res.url) {
          window.location.href = res.url;
        } else {
          setError(res.error ?? 'Checkout failed');
        }
      } catch {
        setError('Checkout failed');
      } finally {
        setBusyTier(null);
      }
    });
  }

  return (
    <div className="space-y-1.5">
      {tiers.map((tier) => {
        const busy = isPending && busyTier === tier.id;
        const price = `$${(tier.priceCents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
        return (
          <button
            key={tier.id}
            type="button"
            onClick={() => handleCheckout(tier)}
            disabled={isPending}
            className="inline-flex w-full items-center justify-between gap-2 rounded-lg border border-emerald-500/30 px-3 py-2 text-sm text-emerald-400 transition-colors hover:bg-emerald-500/10 hover:border-emerald-500/50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span className="truncate">{tier.name}</span>
            <span className="flex items-center gap-2">
              <span className="font-mono text-xs text-gray-400">
                {price}
                {tier.billing.includes('month') ? '/mo' : ''}
              </span>
              <span className="font-mono text-[10px] uppercase tracking-wider opacity-60">
                {busy ? '…' : 'Checkout'}
              </span>
            </span>
          </button>
        );
      })}
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
