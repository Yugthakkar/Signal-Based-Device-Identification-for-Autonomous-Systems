import { motion } from 'motion/react';
import type { ReactNode } from 'react';

interface PanelProps {
  title?: ReactNode;
  /** Small mono tag shown above the title, e.g. "CH-01". */
  eyebrow?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  delay?: number;
  /** Instrument-style corner brackets. */
  brackets?: boolean;
  padded?: boolean;
}

export function Panel({
  title,
  eyebrow,
  actions,
  children,
  className = '',
  bodyClassName = '',
  delay = 0,
  brackets = false,
  padded = true,
}: PanelProps) {
  const hasHeader = title || eyebrow || actions;

  return (
    <motion.section
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay, ease: [0.16, 1, 0.3, 1] }}
      className={`group/panel relative rounded-xl border border-line bg-surface transition-colors duration-300 hover:border-line-strong ${className}`}
    >
      {brackets && <CornerBrackets />}
      {hasHeader && (
        <header className="flex items-center justify-between gap-4 border-b border-line px-5 py-3.5">
          <div className="min-w-0">
            {eyebrow && <p className="label-mono mb-0.5">{eyebrow}</p>}
            {title && <h3 className="truncate">{title}</h3>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={`${padded ? 'p-5' : ''} ${bodyClassName}`}>{children}</div>
    </motion.section>
  );
}

export function CornerBrackets() {
  const base = 'pointer-events-none absolute h-2.5 w-2.5 border-signal/60 transition-all duration-300 group-hover/panel:border-signal';
  return (
    <>
      <span className={`${base} -left-px -top-px rounded-tl-xl border-l border-t`} />
      <span className={`${base} -right-px -top-px rounded-tr-xl border-r border-t`} />
      <span className={`${base} -bottom-px -left-px rounded-bl-xl border-b border-l`} />
      <span className={`${base} -bottom-px -right-px rounded-br-xl border-b border-r`} />
    </>
  );
}

/** Centered empty-state used inside panels. */
export function EmptyState({ icon, title, hint }: { icon?: ReactNode; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
      {icon && (
        <div className="flex h-12 w-12 items-center justify-center rounded-full border border-line-strong bg-surface-2 text-ink-dim">
          {icon}
        </div>
      )}
      <p className="text-sm font-medium text-ink-muted">{title}</p>
      {hint && <p className="max-w-sm text-xs text-ink-dim">{hint}</p>}
    </div>
  );
}
