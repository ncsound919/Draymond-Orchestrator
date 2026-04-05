'use client';

import { useState } from 'react';

interface Props {
  productId: string;
  price: number;
}

type State = 'idle' | 'loading' | 'error';

export default function DownloadButtons({ productId, price }: Props) {
  const [state, setState] = useState<State>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  async function handleDownload() {
    setState('loading');
    setErrorMsg('');

    try {
      const res = await fetch('/api/downloads/signed-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_id: productId }),
      });

      const data = await res.json();

      if (!res.ok) {
        // 402 = payment required, 404 = no purchase found
        if (res.status === 402 || res.status === 404) {
          // Redirect to purchase / Stripe checkout
          window.location.href = '/checkout?product=' + encodeURIComponent(productId);
          return;
        }
        throw new Error(data.error || 'Failed to get download link');
      }

      // Validate the URL scheme before using it
      try {
        const downloadUrl = new URL(data.url);
        if (downloadUrl.protocol !== 'https:') {
          throw new Error('Invalid download URL');
        }
      } catch {
        throw new Error('Invalid download URL received');
      }

      // Trigger download via temporary anchor
      const a = document.createElement('a');
      a.href = data.url;
      a.download = data.filename || 'download.exe';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setState('idle');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Something went wrong');
      setState('error');
    }
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <button
        onClick={handleDownload}
        disabled={state === 'loading'}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-yellow-500 hover:bg-yellow-400 disabled:opacity-50 disabled:cursor-not-allowed text-[#0a0a0a] font-semibold text-sm transition-colors whitespace-nowrap"
      >
        {state === 'loading' ? (
          <>
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Verifying...
          </>
        ) : (
          <>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Buy &amp; Download
          </>
        )}
      </button>

      {state === 'error' && (
        <p className="text-xs text-red-400 text-right max-w-[180px]">{errorMsg}</p>
      )}

      <p className="text-xs text-white/25">${price} &middot; one-time purchase</p>
    </div>
  );
}
