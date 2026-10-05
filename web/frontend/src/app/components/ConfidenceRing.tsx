import { motion } from 'motion/react';
import { AnimatedNumber } from './AnimatedNumber';

interface ConfidenceRingProps {
  value: number;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  label?: string;
  showPercentage?: boolean;
  strokeWidth?: number;
  animated?: boolean;
  /** Override the level-based color. */
  color?: string;
}

const sizeConfig = {
  sm: { dimension: 64, fontSize: 'text-sm', labelSize: 'text-xs' },
  md: { dimension: 104, fontSize: 'text-xl', labelSize: 'text-xs' },
  lg: { dimension: 156, fontSize: 'text-3xl', labelSize: 'text-xs' },
  xl: { dimension: 196, fontSize: 'text-4xl', labelSize: 'text-sm' },
};

const TICKS = 48;

/** Instrument-style gauge: tick marks around a progress arc. */
export function ConfidenceRing({
  value,
  size = 'md',
  label,
  showPercentage = true,
  strokeWidth = 6,
  animated = true,
  color,
}: ConfidenceRingProps) {
  const config = sizeConfig[size];
  const dimension = config.dimension;
  const c = dimension / 2;
  const radius = c - strokeWidth - 8;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, value));
  const offset = circumference - (clamped / 100) * circumference;

  const levelColor = color ?? (clamped >= 90 ? 'var(--ok)' : clamped >= 75 ? 'var(--signal)' : clamped >= 60 ? 'var(--warn)' : 'var(--danger)');
  const litTicks = Math.round((clamped / 100) * TICKS);

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative" style={{ width: dimension, height: dimension }}>
        <svg width={dimension} height={dimension} className="-rotate-90">
          {/* outer tick ring */}
          {Array.from({ length: TICKS }).map((_, i) => {
            const a = (i / TICKS) * Math.PI * 2;
            const r1 = c - 2;
            const r2 = c - (i % 6 === 0 ? 7 : 5);
            return (
              <line
                key={i}
                x1={c + Math.cos(a) * r1}
                y1={c + Math.sin(a) * r1}
                x2={c + Math.cos(a) * r2}
                y2={c + Math.sin(a) * r2}
                strokeWidth={1}
                style={{
                  stroke: i < litTicks ? levelColor : 'var(--line-strong)',
                  transition: 'stroke 300ms ease',
                  transitionDelay: animated ? `${i * 12}ms` : '0ms',
                }}
              />
            );
          })}
          <circle cx={c} cy={c} r={radius} stroke="var(--surface-3)" strokeWidth={strokeWidth} fill="none" />
          <motion.circle
            cx={c}
            cy={c}
            r={radius}
            stroke={levelColor}
            strokeWidth={strokeWidth}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={circumference}
            initial={animated ? { strokeDashoffset: circumference } : false}
            animate={{ strokeDashoffset: offset }}
            transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1] }}
          />
        </svg>
        {showPercentage && (
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className={`readout font-semibold ${config.fontSize}`} style={{ color: levelColor }}>
              <AnimatedNumber value={clamped} decimals={1} suffix="%" />
            </span>
          </div>
        )}
      </div>
      {label && <span className={`label-mono ${config.labelSize}`}>{label}</span>}
    </div>
  );
}
