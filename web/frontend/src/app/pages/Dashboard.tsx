import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { PageContainer } from '../components/PageContainer';
import { PageHeader } from '../components/PageHeader';
import { Panel, EmptyState } from '../components/Panel';
import { MetricCard } from '../components/MetricCard';
import { StatusBadge } from '../components/StatusBadge';
import { TerminalLogs } from '../components/TerminalLogs';
import { PipelineDiagram } from '../components/PipelineDiagram';
import {
  Cpu,
  Activity,
  Zap,
  CheckCircle2,
  TrendingUp,
  Upload,
  Radar,
  ArrowUpRight,
  Keyboard,
  Mouse,
} from 'lucide-react';
import { Link } from 'react-router';
import { fetchHealth, fetchLogs } from '../../lib/api';

type ParsedLog = {
  timestamp: string;
  level: 'info' | 'success' | 'warning' | 'error';
  message: string;
};

type RecentPrediction = {
  time: string;
  result: string;
  confidence: number;
  isKeyboard: boolean;
};

const quickActions = [
  {
    title: 'Run Prediction',
    description: 'Test the model with controlled feature vectors',
    icon: Zap,
    path: '/predict',
    tag: 'USB',
  },
  {
    title: 'Live Demo',
    description: 'Classify your own keystrokes and mouse stream',
    icon: Activity,
    path: '/live-demo',
    tag: 'USB',
  },
  {
    title: 'Upload Model',
    description: 'Deploy a new .pt model artifact',
    icon: Upload,
    path: '/upload',
    tag: 'OPS',
  },
  {
    title: 'Vehicle Monitor',
    description: 'Replay recorded CAN traffic with live detection',
    icon: Radar,
    path: '/vehicle-monitor',
    tag: 'CAN',
  },
];

export default function Dashboard() {
  const [modelLoaded, setModelLoaded] = useState(false);
  const [apiOnline, setApiOnline] = useState(false);
  const [runtimeLogs, setRuntimeLogs] = useState<ParsedLog[]>([]);

  useEffect(() => {
    let isMounted = true;

    async function refresh() {
      try {
        const [health, logsRes] = await Promise.all([fetchHealth(), fetchLogs()]);
        if (!isMounted) {
          return;
        }

        setApiOnline(health.status === 'ok');
        setModelLoaded(Boolean(health.model_loaded));
        setRuntimeLogs(
          logsRes.logs.map((line) => {
            const tsMatch = line.match(/^\[(\d{2}:\d{2}:\d{2})\]/);
            const lvlMatch = line.match(/\[(INFO|WARN|RESULT|ERROR)\]/);
            const levelMap: Record<string, ParsedLog['level']> = {
              INFO: 'info',
              WARN: 'warning',
              RESULT: 'success',
              ERROR: 'error',
            };

            return {
              timestamp: tsMatch?.[1] || '--:--:--',
              level: levelMap[lvlMatch?.[1] || 'INFO'] || 'info',
              message: line.replace(/^\[[^\]]+\]\s*(\[(INFO|WARN|RESULT|ERROR)\]\s*)?/, ''),
            };
          })
        );
      } catch {
        if (!isMounted) {
          return;
        }
        setApiOnline(false);
      }
    }

    void refresh();
    const interval = setInterval(refresh, 4000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  const allPredictions = useMemo<RecentPrediction[]>(
    () =>
      runtimeLogs
        .filter((entry) => entry.message.includes('Device:'))
        .map((entry) => {
          const m = entry.message.match(/Device:\s*([^\(]+)\s*\((\d+(?:\.\d+)?)%\)/i);
          const result = (m?.[1] || 'Unknown').trim().toUpperCase();
          return {
            time: entry.timestamp,
            result,
            confidence: Number(m?.[2] || 0),
            isKeyboard: result.includes('KEY'),
          };
        }),
    [runtimeLogs]
  );

  const recentPredictions = useMemo(() => allPredictions.slice(-5).reverse(), [allPredictions]);
  const confidenceSpark = useMemo(() => allPredictions.slice(-24).map((p) => p.confidence), [allPredictions]);

  const predictionsToday = allPredictions.length;
  const keyboardCount = allPredictions.filter((p) => p.isKeyboard).length;
  const mouseCount = predictionsToday - keyboardCount;
  const keyboardShare = predictionsToday > 0 ? (keyboardCount / predictionsToday) * 100 : 50;
  const avgConfidence =
    recentPredictions.length > 0
      ? recentPredictions.reduce((acc, item) => acc + item.confidence, 0) / recentPredictions.length
      : 0;

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Module 01 · USB device identification"
        title="System Dashboard"
        description="Identify what is plugged in from how it talks — model health, prediction throughput and runtime telemetry at a glance."
        actions={
          <>
            <Link to="/live-demo" className="btn btn-secondary">
              <Activity /> Live demo
            </Link>
            <Link to="/predict" className="btn btn-primary">
              <Zap /> Run prediction
            </Link>
          </>
        }
      />

      {/* System health */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Model status"
          value={modelLoaded ? 'Active' : 'Not loaded'}
          icon={CheckCircle2}
          status={modelLoaded ? 'success' : 'warning'}
          description={modelLoaded ? 'Runtime model loaded' : 'Train or upload a model'}
          delay={0}
        />
        <MetricCard
          title="Backend API"
          value={apiOnline ? 'Online' : 'Offline'}
          icon={Activity}
          status={apiOnline ? 'success' : 'error'}
          description={apiOnline ? 'Connected to inference service' : 'Cannot reach API on :8000'}
          delay={0.06}
        />
        <MetricCard
          title="Predictions"
          value={predictionsToday}
          icon={TrendingUp}
          status="neutral"
          description="Derived from runtime logs"
          delay={0.12}
        />
        <MetricCard
          title="Avg confidence"
          value={avgConfidence}
          decimals={1}
          suffix="%"
          icon={Cpu}
          status="success"
          spark={confidenceSpark}
          description="Mean of the latest predictions"
          delay={0.18}
        />
      </div>

      {/* Pipeline */}
      <Panel
        eyebrow="How it works"
        title="Signal → verdict pipeline"
        className="mb-6"
        delay={0.2}
        brackets
        actions={<StatusBadge status={apiOnline ? 'processing' : 'idle'} label={apiOnline ? 'Live' : 'Standby'} size="sm" />}
      >
        <PipelineDiagram active={apiOnline} />
      </Panel>

      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Recent predictions */}
        <Panel
          eyebrow="Inference feed"
          title="Recent predictions"
          className="lg:col-span-2"
          delay={0.25}
          actions={
            <StatusBadge
              status={modelLoaded ? 'success' : 'warning'}
              label={modelLoaded ? 'Model loaded' : 'Model missing'}
              size="sm"
            />
          }
        >
          {recentPredictions.length > 0 ? (
            <>
              {/* device mix bar */}
              <div className="mb-5">
                <div className="mb-2 flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1.5 text-signal">
                    <Keyboard className="h-3.5 w-3.5" /> Keyboard <span className="readout">{keyboardCount}</span>
                  </span>
                  <span className="label-mono">Device mix</span>
                  <span className="flex items-center gap-1.5 text-info">
                    <span className="readout">{mouseCount}</span> Mouse <Mouse className="h-3.5 w-3.5" />
                  </span>
                </div>
                <div className="flex h-1.5 overflow-hidden rounded-full bg-surface-3">
                  <motion.div
                    className="h-full bg-signal"
                    initial={{ width: '50%' }}
                    animate={{ width: `${keyboardShare}%` }}
                    transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
                  />
                  <div className="h-full flex-1 bg-info" />
                </div>
              </div>

              <ul className="divide-y divide-line">
                {recentPredictions.map((pred, idx) => (
                  <motion.li
                    key={`${pred.time}-${idx}`}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.35, delay: 0.3 + idx * 0.06 }}
                    className="flex items-center justify-between gap-4 py-3"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`flex h-8 w-8 items-center justify-center rounded-md border ${
                          pred.isKeyboard ? 'border-signal/30 bg-signal/10 text-signal' : 'border-info/30 bg-info/10 text-info'
                        }`}
                      >
                        {pred.isKeyboard ? <Keyboard className="h-4 w-4" /> : <Mouse className="h-4 w-4" />}
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-ink">{pred.result}</p>
                        <p className="readout text-xs text-ink-dim">{pred.time}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="h-1.5 w-28 overflow-hidden rounded-full bg-surface-3 sm:w-40">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${pred.confidence}%` }}
                          transition={{ duration: 0.9, delay: 0.4 + idx * 0.06, ease: [0.16, 1, 0.3, 1] }}
                          className={`h-full ${pred.isKeyboard ? 'bg-signal' : 'bg-info'}`}
                        />
                      </div>
                      <span className="readout w-14 text-right text-sm text-ink">{pred.confidence.toFixed(1)}%</span>
                    </div>
                  </motion.li>
                ))}
              </ul>
            </>
          ) : (
            <EmptyState
              icon={<Activity className="h-5 w-5" />}
              title="No predictions yet"
              hint="Run a prediction or start the live demo — results stream in here automatically."
            />
          )}
        </Panel>

        {/* Quick actions */}
        <div className="flex flex-col gap-3">
          <p className="label-mono px-1">Quick actions</p>
          {quickActions.map((action, idx) => {
            const Icon = action.icon;
            return (
              <motion.div
                key={action.path}
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.45, delay: 0.3 + idx * 0.07, ease: [0.16, 1, 0.3, 1] }}
              >
                <Link
                  to={action.path}
                  className="group relative flex items-center gap-4 overflow-hidden rounded-xl border border-line bg-surface p-4 transition-all duration-300 hover:-translate-y-0.5 hover:border-signal/40"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-line-strong bg-surface-2 text-ink-muted transition-colors duration-300 group-hover:border-signal/40 group-hover:text-signal">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h4 className="text-[0.9375rem] transition-colors group-hover:text-signal">{action.title}</h4>
                      <span className="rounded border border-line-strong px-1 font-mono text-[0.5625rem] text-ink-dim">{action.tag}</span>
                    </div>
                    <p className="truncate text-xs text-ink-dim">{action.description}</p>
                  </div>
                  <ArrowUpRight className="h-4 w-4 shrink-0 text-ink-dim transition-all duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-signal" />
                  <span className="absolute inset-x-0 bottom-0 h-px origin-left scale-x-0 bg-signal transition-transform duration-500 group-hover:scale-x-100" />
                </Link>
              </motion.div>
            );
          })}
        </div>
      </div>

      <TerminalLogs logs={runtimeLogs} maxHeight="300px" />
    </PageContainer>
  );
}
