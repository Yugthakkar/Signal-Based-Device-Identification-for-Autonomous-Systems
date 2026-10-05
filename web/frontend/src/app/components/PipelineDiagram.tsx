import { motion } from 'motion/react';
import { Fragment } from 'react';
import { Cable, Timer, Sigma, BrainCircuit, ShieldCheck, type LucideIcon } from 'lucide-react';

type Stage = { icon: LucideIcon; title: string; detail: string };

const stages: Stage[] = [
  { icon: Cable, title: 'Capture', detail: 'USB-HID · CAN bus' },
  { icon: Timer, title: 'Window', detail: '5 s · 100 ms slices' },
  { icon: Sigma, title: 'Features', detail: 'inter-arrival timing' },
  { icon: BrainCircuit, title: 'Classify', detail: 'MLP · random forest' },
  { icon: ShieldCheck, title: 'Verdict', detail: 'device · threat score' },
];

function Connector({ index, active }: { index: number; active: boolean }) {
  return (
    <div className="relative hidden h-px flex-1 md:block" aria-hidden="true">
      <svg className="absolute inset-0 h-px w-full overflow-visible">
        <line x1="0" y1="0" x2="100%" y2="0" stroke="var(--line-strong)" strokeWidth="1" />
        {active && (
          <line
            x1="0" y1="0" x2="100%" y2="0"
            stroke="var(--signal)"
            strokeOpacity="0.55"
            strokeWidth="1"
            strokeDasharray="4 8"
            className="animate-dash"
          />
        )}
      </svg>
      {active && (
        <motion.span
          className="absolute -top-[3px] h-[7px] w-[7px] rounded-full bg-signal shadow-[0_0_10px_var(--signal)]"
          initial={{ left: '0%', opacity: 0 }}
          animate={{ left: ['0%', '100%'], opacity: [0, 1, 1, 0] }}
          transition={{ duration: 1.6, repeat: Infinity, delay: index * 0.4, ease: 'easeInOut', times: [0, 0.15, 0.85, 1] }}
        />
      )}
    </div>
  );
}

/** How a raw signal becomes a verdict — the core idea of the project, animated. */
export function PipelineDiagram({ active = true }: { active?: boolean }) {
  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-center md:gap-0">
      {stages.map((stage, i) => {
        const Icon = stage.icon;
        const last = i === stages.length - 1;
        return (
          <Fragment key={stage.title}>
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, delay: 0.15 + i * 0.08, ease: [0.16, 1, 0.3, 1] }}
              className={`group flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors duration-300 md:flex-col md:items-center md:px-4 md:py-3 md:text-center ${
                last ? 'border-signal/40 bg-signal/5' : 'border-line bg-surface-2 hover:border-line-strong'
              }`}
            >
              <div
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md border transition-transform duration-300 group-hover:scale-110 ${
                  last ? 'border-signal/40 text-signal' : 'border-line-strong text-ink-muted'
                }`}
              >
                <Icon className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-semibold text-ink">
                  <span className="mr-1.5 font-mono text-[0.6875rem] text-ink-dim">0{i + 1}</span>
                  {stage.title}
                </p>
                <p className="font-mono text-[0.6875rem] text-ink-dim">{stage.detail}</p>
              </div>
            </motion.div>
            {!last && <Connector index={i} active={active} />}
          </Fragment>
        );
      })}
    </div>
  );
}
