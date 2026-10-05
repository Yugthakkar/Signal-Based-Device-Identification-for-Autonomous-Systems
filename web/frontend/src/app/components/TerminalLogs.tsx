import { motion } from 'motion/react';
import { Terminal, Copy, Check } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

interface LogEntry {
  timestamp: string;
  level: 'info' | 'success' | 'warning' | 'error';
  message: string;
}

interface TerminalLogsProps {
  logs: LogEntry[];
  maxHeight?: string;
  title?: string;
}

const levelStyle = {
  info: 'text-signal',
  success: 'text-ok',
  warning: 'text-warn',
  error: 'text-danger',
};

const levelTag = {
  info: 'INFO',
  success: 'RSLT',
  warning: 'WARN',
  error: 'ERR ',
};

export function TerminalLogs({
  logs,
  maxHeight = '400px',
  title = 'Runtime Terminal',
}: TerminalLogsProps) {
  const [copied, setCopied] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const seenRef = useRef(0);

  // Keep the newest line in view, like a real tail -f.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [logs.length]);

  const firstNew = seenRef.current;
  useEffect(() => {
    seenRef.current = logs.length;
  }, [logs.length]);

  const copyToClipboard = () => {
    const text = logs
      .map((log) => `[${log.timestamp}] ${log.level.toUpperCase()}: ${log.message}`)
      .join('\n');
    void navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
      className="overflow-hidden rounded-xl border border-line bg-bg-2"
    >
      <div className="flex items-center justify-between border-b border-line bg-surface px-4 py-2.5">
        <div className="flex items-center gap-3">
          <div className="flex gap-1.5" aria-hidden="true">
            <span className="h-2.5 w-2.5 rounded-full bg-line-strong" />
            <span className="h-2.5 w-2.5 rounded-full bg-line-strong" />
            <span className="h-2.5 w-2.5 rounded-full bg-line-strong" />
          </div>
          <div className="flex items-center gap-2">
            <Terminal className="h-3.5 w-3.5 text-signal" />
            <span className="font-mono text-xs text-ink-muted">{title}</span>
          </div>
          <span className="rounded border border-line-strong px-1.5 py-px font-mono text-[0.625rem] text-ink-dim">
            {logs.length} lines
          </span>
        </div>
        <button
          onClick={copyToClipboard}
          className="btn btn-ghost btn-sm h-7 px-2 text-xs"
        >
          {copied ? <Check className="text-ok" /> : <Copy />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <div
        ref={scrollRef}
        className="overflow-y-auto p-4 font-mono text-xs leading-relaxed"
        style={{ maxHeight }}
      >
        {logs.map((log, index) => (
          <motion.div
            key={index}
            initial={index >= firstNew ? { opacity: 0, x: -6 } : false}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.25, delay: index >= firstNew ? Math.min((index - firstNew) * 0.03, 0.6) : 0 }}
            className="flex gap-3 rounded px-1 py-0.5 hover:bg-surface"
          >
            <span className="shrink-0 text-ink-dim">{log.timestamp}</span>
            <span className={`shrink-0 font-semibold ${levelStyle[log.level]}`}>{levelTag[log.level]}</span>
            <span className="break-all text-ink-muted">{log.message}</span>
          </motion.div>
        ))}
        <div className="flex gap-3 px-1 py-0.5 text-ink-dim">
          <span className="text-signal">❯</span>
          <span className="inline-block h-3.5 w-1.5 translate-y-0.5 bg-signal animate-blink" />
        </div>
      </div>
    </motion.div>
  );
}
