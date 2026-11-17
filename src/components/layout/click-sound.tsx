"use client";

import { useEffect } from "react";

/** Peak volume of the click (0..1). */
const VOLUME = 0.35;

/**
 * Plays a short "tk" tick on every press anywhere on the site. The sound is synthesised with
 * the Web Audio API (a burst of band-passed noise plus a quick high tone), so there is no audio
 * file to load. The audio context is created on the first press, as browsers require.
 */
export function ClickSound() {
  useEffect(() => {
    let ctx: AudioContext | null = null;
    let tick: AudioBuffer | null = null;

    const build = (c: AudioContext) => {
      const rate = c.sampleRate;
      const length = Math.round(rate * 0.035);
      const buffer = c.createBuffer(1, length, rate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i++) {
        const t = i / rate;
        const noise = (Math.random() * 2 - 1) * Math.exp(-t / 0.0035);
        const tone = Math.sin(2 * Math.PI * 2100 * t) * Math.exp(-t / 0.006) * 0.6;
        data[i] = (noise + tone) * 0.8;
      }
      return buffer;
    };

    const play = (e: PointerEvent) => {
      if (e.button !== 0) return;
      try {
        if (!ctx) {
          const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
          if (!Ctor) return;
          ctx = new Ctor();
          tick = build(ctx);
        }
        if (ctx.state === "suspended") void ctx.resume();
        const source = ctx.createBufferSource();
        source.buffer = tick;
        const band = ctx.createBiquadFilter();
        band.type = "bandpass";
        band.frequency.value = 3200;
        band.Q.value = 0.9;
        const gain = ctx.createGain();
        gain.gain.value = VOLUME;
        source.connect(band).connect(gain).connect(ctx.destination);
        source.start();
      } catch {
        // Audio is a nicety; never let it break a click.
      }
    };

    window.addEventListener("pointerdown", play, { capture: true, passive: true });
    return () => {
      window.removeEventListener("pointerdown", play, { capture: true });
      void ctx?.close();
    };
  }, []);

  return null;
}
