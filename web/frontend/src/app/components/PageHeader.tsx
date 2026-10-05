import { motion } from 'motion/react';
import type { ReactNode } from 'react';
import { SignalTrace } from './SignalTrace';

interface PageHeaderProps {
  eyebrow: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  trace?: 'pulse' | 'sine' | 'can';
  children?: ReactNode;
}

export function PageHeader({ eyebrow, title, description, actions, trace = 'pulse', children }: PageHeaderProps) {
  return (
    <motion.header
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
      className="mb-8"
    >
      <div className="mb-3 flex items-center gap-3">
        <span className="label-mono text-signal">{eyebrow}</span>
        <SignalTrace variant={trace} className="h-4 w-24 opacity-70" speed={4} strokeWidth={1.25} />
      </div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0 max-w-3xl">
          <h1 className="mb-2">{title}</h1>
          {description && <p className="text-[0.9375rem] leading-relaxed text-ink-muted">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </motion.header>
  );
}
