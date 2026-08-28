// src/components/visualizer/VisualizerApp.tsx
'use client';
import { useEffect, useRef, useState } from 'react';
import { Application } from 'pixi.js';
import { useVisualizerState } from './useSnapshot';
import { useEventsStream } from './useEventsStream';
import { useGameLoop } from './useGameLoop';
import { createScene, type SceneHandle } from './render/scene';
import { TopBar } from './hud/TopBar';
import { ShipLog } from './hud/ShipLog';
import { Inspector } from './hud/Inspector';
import { SchedulesRadar } from './hud/SchedulesRadar';
import type { Building } from './state/types';

export default function VisualizerApp() {
  const canvasRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SceneHandle | null>(null);
  const appRef = useRef<Application | null>(null);
  const { state, dispatchEvent, lastLoadedAt } = useVisualizerState();
  const [selected, setSelected] = useState<Building | null>(null);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    const host = canvasRef.current;
    if (!host) return;
    let app: Application | null = null;
    let scene: SceneHandle | null = null;
    let disposed = false;
    (async () => {
      const a = new Application();
      // init() must resolve before destroy() is safe (Pixi's ResizePlugin only
      // installs _cancelResize during init). Keep `app` null until ready so the
      // cleanup below never destroys a half-initialized instance.
      await a.init({
        width: host.clientWidth,
        height: host.clientHeight,
        background: 0x0b0b1a,
        antialias: true,
        resolution: window.devicePixelRatio || 1,
        autoDensity: true,
      });
      if (disposed || !host.isConnected) { a.destroy(true, { children: true, texture: true }); return; }
      app = a;
      host.appendChild(a.canvas);
      scene = createScene(a);
      scene.onBuildingClick((slug) => setSelected(stateRef.current.buildings[slug] ?? null));
      appRef.current = a;
      sceneRef.current = scene;
    })();
    return () => {
      disposed = true;
      scene?.destroy();
      if (app) app.destroy(true, { children: true, texture: true });
      appRef.current = null;
      sceneRef.current = null;
    };
  }, []);

  useEventsStream({ dispatchEvent, onReconnect: () => { /* snapshot poll interval covers drift */ } });
  useGameLoop((now) => {
    const scene = sceneRef.current;
    if (scene) scene.update(stateRef.current, now);
  });

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[#0b0b1a] text-white">
      <div ref={canvasRef} className="absolute inset-0" />
      <TopBar
        servicesUp={state.servicesUp}
        servicesTotal={state.servicesTotal}
        revenueUsd={state.revenueUsd}
        degraded={state.degraded}
        signalLost={state.signalLost}
        lastLoadedAt={lastLoadedAt}
      />
      <ShipLog entries={state.ticker} />
      <SchedulesRadar blips={state.radar} />
      {selected && <Inspector building={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}