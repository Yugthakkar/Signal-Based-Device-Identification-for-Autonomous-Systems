import { useEffect, useState } from 'react';

type RasterEvent = { event_type: string; timestamp: number };

interface EventRasterProps {
  events: RasterEvent[];
  running: boolean;
  /** Seconds of history visible. */
  windowSeconds?: number;
}

const lanes = [
  { key: 'key', label: 'KEY', color: 'var(--signal)', match: (t: string) => t.startsWith('key') },
  { key: 'click', label: 'CLICK', color: 'var(--orange)', match: (t: string) => t === 'click' },
  { key: 'move', label: 'MOVE', color: 'var(--info)', match: (t: string) => t === 'mousemove' },
];

/**
 * Spike-raster of incoming HID events — the raw timing signal the model sees.
 * Each tick is one event; the strip scrolls left in real time.
 */
export function EventRaster({ events, running, windowSeconds = 12 }: EventRasterProps) {
  const [now, setNow] = useState(() => Date.now() / 1000);

  useEffect(() => {
    if (!running) return;
    let raf = 0;
    const tick = () => {
      setNow(Date.now() / 1000);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [running]);

  const W = 1000;
  const laneH = 28;
  const H = lanes.length * laneH;
  const start = now - windowSeconds;

  return (
    <div className="flex gap-3">
      <div className="flex flex-col justify-around py-0.5" style={{ height: H }}>
        {lanes.map((lane) => (
          <span key={lane.key} className="font-mono text-[0.625rem] tracking-wider" style={{ color: lane.color }}>
            {lane.label}
          </span>
        ))}
      </div>
      <div className="relative flex-1 overflow-hidden rounded-md border border-line bg-bg">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block w-full" style={{ height: H }}>
          {/* second gridlines */}
          {Array.from({ length: windowSeconds + 1 }).map((_, i) => {
            const sec = Math.ceil(start) + i;
            const x = ((sec - start) / windowSeconds) * W;
            return <line key={sec} x1={x} x2={x} y1={0} y2={H} stroke="var(--line)" strokeWidth={1} vectorEffect="non-scaling-stroke" />;
          })}
          {lanes.map((_, i) =>
            i > 0 ? (
              <line key={i} x1={0} x2={W} y1={i * laneH} y2={i * laneH} stroke="var(--line)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            ) : null
          )}
          {events.map((evt, i) => {
            if (evt.timestamp < start) return null;
            const laneIdx = lanes.findIndex((l) => l.match(evt.event_type));
            if (laneIdx < 0) return null;
            const x = ((evt.timestamp - start) / windowSeconds) * W;
            const age = now - evt.timestamp;
            return (
              <line
                key={`${evt.timestamp}-${i}`}
                x1={x}
                x2={x}
                y1={laneIdx * laneH + 5}
                y2={(laneIdx + 1) * laneH - 5}
                stroke={lanes[laneIdx].color}
                strokeWidth={age < 0.25 ? 3 : 1.75}
                strokeOpacity={Math.max(0.25, 1 - age / windowSeconds)}
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
        </svg>
        {/* playhead */}
        <div className="absolute inset-y-0 right-0 w-px bg-signal/70" />
      </div>
    </div>
  );
}
