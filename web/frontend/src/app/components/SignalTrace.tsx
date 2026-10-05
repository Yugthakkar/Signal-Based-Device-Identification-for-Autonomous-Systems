import { useMemo } from 'react';

type TraceVariant = 'pulse' | 'sine' | 'can';

interface SignalTraceProps {
  variant?: TraceVariant;
  className?: string;
  color?: string;
  strokeWidth?: number;
  /** Seconds for one full loop of the trace. */
  speed?: number;
  /** Draw a faint baseline and a sweeping highlight. */
  decorated?: boolean;
  paused?: boolean;
}

const TILE = 200;
const HEIGHT = 40;

// One period of each waveform, sampled over [0, TILE). Values are in [-1, 1].
function sample(variant: TraceVariant, x: number): number {
  const t = x / TILE;
  switch (variant) {
    case 'sine':
      return Math.sin(t * Math.PI * 4) * 0.55 + Math.sin(t * Math.PI * 10) * 0.15;
    case 'can': {
      // Digital CAN-like frame bursts: square edges separated by idle bus.
      const bits = [0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 0, 0, 1, 1, 0, 1, 0, 1, 1, 0, 0, 0, 0, 0];
      const bit = bits[Math.floor(t * bits.length) % bits.length];
      return bit ? 0.6 : -0.6;
    }
    case 'pulse':
    default: {
      // Heartbeat-like signature spike, twice per tile.
      const p = (t * 2) % 1;
      if (p < 0.34) return Math.sin(p * 40) * 0.04;
      if (p < 0.38) return (p - 0.34) * -12;
      if (p < 0.42) return -0.48 + (p - 0.38) * 45;
      if (p < 0.46) return 1.32 - (p - 0.42) * 48;
      if (p < 0.5) return -0.6 + (p - 0.46) * 15;
      if (p < 0.62) return Math.sin((p - 0.5) * 26) * 0.22;
      return Math.sin(p * 30) * 0.03;
    }
  }
}

function buildPath(variant: TraceVariant): string {
  const step = variant === 'can' ? 0.5 : 1;
  const pts: string[] = [];
  for (let x = 0; x <= TILE * 2; x += step) {
    const y = HEIGHT / 2 - sample(variant, x % TILE) * (HEIGHT / 2 - 3);
    pts.push(`${x.toFixed(1)},${y.toFixed(2)}`);
  }
  return `M${pts.join(' L')}`;
}

/** A continuously scrolling oscilloscope trace. Pure SVG + CSS transform. */
export function SignalTrace({
  variant = 'pulse',
  className = '',
  color = 'var(--signal)',
  strokeWidth = 1.5,
  speed = 6,
  decorated = false,
  paused = false,
}: SignalTraceProps) {
  const d = useMemo(() => buildPath(variant), [variant]);
  // Callers may position the trace absolutely; only default to `relative` otherwise.
  const position = /\babsolute\b/.test(className) ? '' : 'relative';

  return (
    <div className={`${position} overflow-hidden ${className}`} aria-hidden="true">
      {decorated && (
        <div className="absolute inset-x-0 top-1/2 h-px bg-line" />
      )}
      <svg
        viewBox={`0 0 ${TILE * 2} ${HEIGHT}`}
        preserveAspectRatio="none"
        className="absolute inset-y-0 left-0 h-full w-[200%] animate-trace"
        style={{
          ['--trace-speed' as string]: `${speed}s`,
          animationPlayState: paused ? 'paused' : 'running',
        }}
      >
        <path
          d={d}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
      {decorated && !paused && (
        <div className="pointer-events-none absolute inset-y-0 left-0 w-1/4 animate-sweep bg-[linear-gradient(90deg,transparent,color-mix(in_oklab,var(--signal)_10%,transparent),transparent)]" />
      )}
    </div>
  );
}
