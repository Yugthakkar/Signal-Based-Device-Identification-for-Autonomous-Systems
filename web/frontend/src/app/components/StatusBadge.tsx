import { motion } from 'motion/react';
import { CheckCircle2, AlertCircle, AlertTriangle, Loader2, Circle } from 'lucide-react';

type StatusType = 'idle' | 'loading' | 'success' | 'warning' | 'error' | 'processing';

interface StatusBadgeProps {
  status: StatusType;
  label?: string;
  size?: 'sm' | 'md' | 'lg';
  showIcon?: boolean;
  animated?: boolean;
}

const statusConfig = {
  idle: {
    icon: Circle,
    color: 'bg-surface-2 text-ink-muted border-line-strong',
    label: 'Idle',
  },
  loading: {
    icon: Loader2,
    color: 'bg-signal/10 text-signal border-signal/30',
    label: 'Loading',
    animate: true,
  },
  success: {
    icon: CheckCircle2,
    color: 'bg-ok/10 text-ok border-ok/30',
    label: 'Success',
  },
  warning: {
    icon: AlertTriangle,
    color: 'bg-warn/10 text-warn border-warn/30',
    label: 'Warning',
  },
  error: {
    icon: AlertCircle,
    color: 'bg-danger/10 text-danger border-danger/30',
    label: 'Error',
  },
  processing: {
    icon: Loader2,
    color: 'bg-signal/10 text-signal border-signal/30',
    label: 'Processing',
    animate: true,
  },
};

const sizeConfig = {
  sm: {
    badge: 'px-2 py-0.5 text-[0.6875rem]',
    icon: 'w-3 h-3',
  },
  md: {
    badge: 'px-2.5 py-1 text-xs',
    icon: 'w-3.5 h-3.5',
  },
  lg: {
    badge: 'px-3 py-1.5 text-sm',
    icon: 'w-4 h-4',
  },
};

export function StatusBadge({
  status,
  label,
  size = 'md',
  showIcon = true,
  animated = true,
}: StatusBadgeProps) {
  const config = statusConfig[status];
  const sizeClass = sizeConfig[size];
  const Icon = config.icon;

  return (
    <motion.div
      key={`${status}-${label ?? ''}`}
      initial={animated ? { opacity: 0, scale: 0.92 } : false}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
      className={`inline-flex items-center gap-1.5 rounded-full border font-mono font-medium uppercase tracking-wider ${config.color} ${sizeClass.badge}`}
    >
      {showIcon && (
        <Icon
          className={`${sizeClass.icon} ${'animate' in config && config.animate ? 'animate-spin' : ''}`}
        />
      )}
      <span>{label || config.label}</span>
    </motion.div>
  );
}
