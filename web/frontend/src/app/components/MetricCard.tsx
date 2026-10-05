import { motion } from 'motion/react';
import { LucideIcon } from 'lucide-react';
import { ReactNode, useMemo } from 'react';
import { AnimatedNumber } from './AnimatedNumber';

type Status = 'success' | 'warning' | 'error' | 'neutral';

interface MetricCardProps {
  title: string;
  value: string | number;
  icon?: LucideIcon;
  trend?: {
    value: number;
    label: string;
  };
  description?: string;
  status?: Status;
  delay?: number;
  /** Suffix appended when `value` is numeric (it animates). */
  suffix?: string;
  decimals?: number;
  /** Optional recent values drawn as a sparkline under the readout. */
  spark?: number[];
  children?: ReactNode;
}

const statusTone: Record<Status, { text: string; dot: string; icon: string; stroke: string }> = {
  success: { text: 'text-ok', dot: 'bg-ok', icon: 'text-ok border-ok/25 bg-ok/10', stroke: 'var(--ok)' },
  warning: { text: 'text-warn', dot: 'bg-warn', icon: 'text-warn border-warn/25 bg-warn/10', stroke: 'var(--warn)' },
  error: { text: 'text-danger', dot: 'bg-danger', icon: 'text-danger border-danger/25 bg-danger/10', stroke: 'var(--danger)' },
  neutral: { text: 'text-signal', dot: 'bg-signal', icon: 'text-signal border-signal/25 bg-signal/10', stroke: 'var(--signal)' },
};

function Sparkline({ values, stroke }: { values: number[]; stroke: string }) {
  const d = useMemo(() => {
    if (values.length < 2) return '';
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    return values
      .map((v, i) => {
        const x = (i / (values.length - 1)) * 100;
        const y = 22 - ((v - min) / span) * 20;
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(' ');
  }, [values]);

  if (!d) return <div className="h-6" />;
  return (
    <svg viewBox="0 0 100 24" preserveAspectRatio="none" className="h-6 w-full" aria-hidden="true">
      <path d={d} fill="none" stroke={stroke} strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

export function MetricCard({
  title,
  value,
  icon: Icon,
  trend,
  description,
  status = 'neutral',
  delay = 0,
  suffix = '',
  decimals = 0,
  spark,
  children,
}: MetricCardProps) {
  const tone = statusTone[status];

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay, ease: [0.16, 1, 0.3, 1] }}
      whileHover={{ y: -2 }}
      className="group relative overflow-hidden rounded-xl border border-line bg-surface p-5 transition-colors duration-300 hover:border-line-strong"
    >
      {/* status hairline along the top edge */}
      <span className={`absolute inset-x-5 top-0 h-px ${tone.dot} opacity-50 transition-opacity group-hover:opacity-100`} />

      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="relative flex h-1.5 w-1.5">
            <span className={`absolute inline-flex h-full w-full rounded-full ${tone.dot} animate-ping-soft`} />
            <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${tone.dot}`} />
          </span>
          <p className="label-mono">{title}</p>
        </div>
        {Icon && (
          <div className={`flex h-8 w-8 items-center justify-center rounded-lg border ${tone.icon}`}>
            <Icon className="h-4 w-4" />
          </div>
        )}
      </div>

      <p className="readout text-[1.75rem] font-semibold leading-none text-ink">
        {typeof value === 'number' ? <AnimatedNumber value={value} decimals={decimals} suffix={suffix} /> : value}
      </p>

      {spark && spark.length > 1 && (
        <div className="mt-3">
          <Sparkline values={spark} stroke={tone.stroke} />
        </div>
      )}

      {trend && (
        <div className="mt-3 flex items-center gap-2 text-xs">
          <span className={`readout font-medium ${trend.value >= 0 ? 'text-ok' : 'text-danger'}`}>
            {trend.value >= 0 ? '+' : ''}
            {trend.value}%
          </span>
          <span className="text-ink-dim">{trend.label}</span>
        </div>
      )}

      {description && <p className="mt-3 text-xs text-ink-dim">{description}</p>}

      {children && <div className="mt-4">{children}</div>}
    </motion.div>
  );
}
