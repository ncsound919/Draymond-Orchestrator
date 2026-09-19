'use client';

import { Suspense } from 'react';
import dynamic from 'next/dynamic';

const VisualizerApp = dynamic(() => import('@/components/visualizer/VisualizerApp'), {
  ssr: false,
  loading: () => <div className="grid h-screen place-items-center bg-[#0b0b1a] text-white">LOADING CITY…</div>,
});

export default function VisualizerPage() {
  return (
    <Suspense fallback={null}>
      <VisualizerApp />
    </Suspense>
  );
}