import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceArea,
  ReferenceLine,
} from 'recharts';
import { PageContainer } from '../components/PageContainer';
import { PageHeader } from '../components/PageHeader';
import { Panel, EmptyState } from '../components/Panel';
import { MetricCard } from '../components/MetricCard';
import { StatusBadge } from '../components/StatusBadge';
import { SignalTrace } from '../components/SignalTrace';
import { Play, Pause, Square, Gauge, Radio, AlertTriangle, Timer, ShieldCheck, ShieldAlert, Database } from 'lucide-react';
import {
  fetchCanDatasets,
  startCanReplay,
  pauseCanReplay,
  resumeCanReplay,
  stopCanReplay,
  openCanReplayStream,
  pollCanReplay,
  type CanDataset,
  type CanReplayEvent,
  type CanReplayWindowEvent,
} from '../../lib/api';
import { axisProps, chartColors, gridProps, tooltipProps } from '../components/chartTheme';

type ChartPoint = {
  windowStart: number;
  probability: number;
  frameRate: number;
  suspicious: boolean;
};

const MAX_POINTS = 120;

function SuspiciousDot(props: { cx?: number; cy?: number; payload?: ChartPoint }) {
  const { cx, cy, payload } = props;
  if (!payload?.suspicious || cx === undefined || cy === undefined) return null;
  return <circle cx={cx} cy={cy} r={3} fill={chartColors.danger} stroke="#0B0D0F" strokeWidth={1.5} />;
}

export default function VehicleMonitor() {
  const [datasets, setDatasets] = useState<CanDataset[]>([]);
  const [selectedCapture, setSelectedCapture] = useState<string>('');
  const [speed, setSpeed] = useState(1);
  const [replayId, setReplayId] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'running' | 'paused' | 'completed' | 'stopped'>('idle');
  const [points, setPoints] = useState<ChartPoint[]>([]);
  const [latest, setLatest] = useState<CanReplayWindowEvent | null>(null);
  const [alertCount, setAlertCount] = useState(0);
  const [progress, setProgress] = useState({ position: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const wasSuspiciousRef = useRef(false);
  // Captures use absolute (epoch) timestamps; show time relative to the first replayed window.
  const baseTsRef = useRef<number | null>(null);

  useEffect(() => {
    fetchCanDatasets()
      .then((res) => {
        setDatasets(res.datasets);
        if (res.datasets.length > 0) {
          setSelectedCapture(res.datasets[0].capture_id);
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  const pollTimerRef = useRef<number | null>(null);
  const fallbackTimerRef = useRef<number | null>(null);

  const closeStream = useCallback(() => {
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    if (pollTimerRef.current !== null) window.clearInterval(pollTimerRef.current);
    if (fallbackTimerRef.current !== null) window.clearTimeout(fallbackTimerRef.current);
    pollTimerRef.current = null;
    fallbackTimerRef.current = null;
  }, []);

  useEffect(() => () => closeStream(), [closeStream]);

  const handleStart = async () => {
    if (!selectedCapture) return;
    setError(null);
    setPoints([]);
    setAlertCount(0);
    setLatest(null);
    wasSuspiciousRef.current = false;
    baseTsRef.current = null;
    try {
      const res = await startCanReplay(selectedCapture, speed);
      setReplayId(res.replay_id);
      setStatus('running');
      setProgress({ position: 0, total: res.total_windows });

      const applyEvent = (data: CanReplayEvent) => {
        if (data.type === 'status') {
          setStatus(data.status);
          if (data.status === 'completed' || data.status === 'stopped') {
            closeStream();
          }
          return;
        }
        if (baseTsRef.current === null) baseTsRef.current = data.window_start_s;
        setLatest(data);
        setProgress({ position: data.position, total: data.total });
        const suspicious = data.prediction.classification === 'suspicious';
        if (suspicious && !wasSuspiciousRef.current) {
          setAlertCount((count) => count + 1);
        }
        wasSuspiciousRef.current = suspicious;
        setPoints((prev) => {
          const next = [
            ...prev,
            {
              windowStart: data.window_start_s - (baseTsRef.current ?? data.window_start_s),
              probability: data.prediction.probability,
              frameRate: data.features.frames_per_second,
              suspicious,
            },
          ];
          return next.length > MAX_POINTS ? next.slice(next.length - MAX_POINTS) : next;
        });
      };

      // Some proxies/tunnels buffer or drop server-sent events. If the stream delivers nothing
      // (or errors) before the first message, fall back to plain HTTP polling of the same queue.
      const startPolling = () => {
        eventSourceRef.current?.close();
        eventSourceRef.current = null;
        if (pollTimerRef.current !== null) return;
        let cursor = 0;
        let inFlight = false;
        pollTimerRef.current = window.setInterval(async () => {
          if (inFlight) return;
          inFlight = true;
          try {
            const batch = await pollCanReplay(res.replay_id, cursor);
            cursor = batch.last;
            batch.events.forEach(applyEvent);
          } catch {
            setError('Replay connection lost');
            closeStream();
          } finally {
            inFlight = false;
          }
        }, 400);
      };

      const source = openCanReplayStream(res.replay_id);
      eventSourceRef.current = source;
      let gotMessage = false;
      fallbackTimerRef.current = window.setTimeout(() => {
        if (!gotMessage) startPolling();
      }, 3000);
      source.onmessage = (evt) => {
        gotMessage = true;
        applyEvent(JSON.parse(evt.data));
      };
      source.onerror = () => {
        if (!gotMessage) {
          startPolling();
          return;
        }
        setError('Replay stream disconnected');
        closeStream();
      };
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handlePause = async () => {
    if (!replayId) return;
    await pauseCanReplay(replayId);
    setStatus('paused');
  };

  const handleResume = async () => {
    if (!replayId) return;
    await resumeCanReplay(replayId);
    setStatus('running');
  };

  const handleStop = async () => {
    if (!replayId) return;
    await stopCanReplay(replayId);
    setStatus('stopped');
    closeStream();
  };

  const selectedDataset = datasets.find((d) => d.capture_id === selectedCapture);
  const statusMap: Record<typeof status, Parameters<typeof StatusBadge>[0]['status']> = {
    idle: 'idle',
    running: 'processing',
    paused: 'warning',
    completed: 'success',
    stopped: 'idle',
  };

  const isActive = status === 'running' || status === 'paused';
  const rel = (ts: number) => ts - (baseTsRef.current ?? ts);
  const isSuspicious = latest?.prediction.classification === 'suspicious';
  const threshold = latest?.prediction.threshold ?? 0.5;
  const progressPct = progress.total > 0 ? (progress.position / progress.total) * 100 : 0;
  const frameSpark = points.slice(-30).map((p) => p.frameRate);
  const scoreSpark = points.slice(-30).map((p) => p.probability);

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Module 02 · CAN bus intrusion detection"
        title="Vehicle Monitor"
        description="Timed replay of recorded vehicle CAN traffic with live, window-by-window detection. Input is recorded-data replay, not a live vehicle feed."
        trace="can"
        actions={<StatusBadge status={statusMap[status]} label={status} />}
      />

      {/* Control deck */}
      <Panel className="mb-6" delay={0.05} padded={false} brackets>
        <div className="flex flex-wrap items-end gap-4 p-5">
          <div className="flex min-w-[240px] flex-1 flex-col gap-1.5">
            <label htmlFor="vm-source" className="label-mono">Recorded source</label>
            <select
              id="vm-source"
              value={selectedCapture}
              onChange={(e) => setSelectedCapture(e.target.value)}
              disabled={isActive}
              className="field"
            >
              {datasets.map((d) => (
                <option key={d.capture_id} value={d.capture_id}>
                  {d.capture_id} ({d.window_count} windows)
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="label-mono">Replay speed</span>
            <div className="flex rounded-lg border border-line-strong bg-surface-2 p-0.5">
              {[0.5, 1, 2, 5].map((s) => (
                <button
                  key={s}
                  onClick={() => setSpeed(s)}
                  disabled={isActive}
                  className={`relative h-8 rounded-md px-3 font-mono text-xs transition-colors ${
                    speed === s ? 'text-signal-ink' : 'text-ink-muted hover:text-ink'
                  }`}
                >
                  {speed === s && (
                    <motion.span layoutId="speedPill" className="absolute inset-0 rounded-md bg-signal" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />
                  )}
                  <span className="relative">{s}×</span>
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {!isActive ? (
              <button onClick={handleStart} disabled={!selectedCapture} className="btn btn-primary">
                <Play /> Start replay
              </button>
            ) : (
              <>
                {status === 'running' ? (
                  <button onClick={handlePause} className="btn btn-secondary">
                    <Pause /> Pause
                  </button>
                ) : (
                  <button onClick={handleResume} className="btn btn-primary">
                    <Play /> Resume
                  </button>
                )}
                <button onClick={handleStop} className="btn btn-danger">
                  <Square /> Stop
                </button>
              </>
            )}
          </div>
        </div>

        {/* Replay transport */}
        <div className="border-t border-line px-5 py-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="flex items-center gap-2 text-ink-dim">
              <Database className="h-3.5 w-3.5" />
              {selectedDataset ? (
                <>
                  <span className="font-mono text-ink-muted">{selectedDataset.capture_id}</span>
                  {selectedDataset.attack_types.length > 0 && (
                    <span>
                      · labelled segments:{' '}
                      {selectedDataset.attack_types.map((t) => (
                        <span key={t} className="mr-1 rounded border border-warn/30 bg-warn/10 px-1 font-mono text-[0.625rem] text-warn">
                          {t}
                        </span>
                      ))}
                    </span>
                  )}
                </>
              ) : (
                'No capture selected'
              )}
            </span>
            <span className="readout text-ink-dim">
              {progress.total > 0 ? `${progress.position} / ${progress.total} windows` : '— / —'}
            </span>
          </div>
          <div className="relative h-1.5 overflow-hidden rounded-full bg-surface-3">
            <motion.div
              className={`h-full ${isSuspicious ? 'bg-danger' : 'bg-signal'}`}
              animate={{ width: `${progressPct}%` }}
              transition={{ ease: 'linear', duration: 0.2 }}
            />
          </div>
        </div>

        <AnimatePresence>
          {error && (
            <motion.p
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden border-t border-danger/30 bg-danger/10 px-5 py-2 text-sm text-danger"
            >
              {error}
            </motion.p>
          )}
        </AnimatePresence>
      </Panel>

      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-4">
        {/* Bus verdict light */}
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
          className={`relative overflow-hidden rounded-xl border p-5 transition-colors duration-500 ${
            !latest ? 'border-line bg-surface' : isSuspicious ? 'border-danger/50 bg-danger/[0.07]' : 'border-ok/30 bg-ok/[0.04]'
          }`}
        >
          <p className="label-mono mb-4">Bus verdict</p>
          <AnimatePresence mode="wait">
            <motion.div
              key={!latest ? 'none' : isSuspicious ? 'sus' : 'ok'}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.25 }}
              className="flex items-center gap-4"
            >
              <div className="relative flex h-14 w-14 items-center justify-center">
                {latest && (
                  <span
                    className={`absolute inset-0 rounded-full ${isSuspicious ? 'bg-danger' : 'bg-ok'} animate-ping-soft`}
                    style={{ ['--ping-scale' as string]: 1.45 }}
                  />
                )}
                <div
                  className={`relative flex h-14 w-14 items-center justify-center rounded-full border ${
                    !latest
                      ? 'border-line-strong bg-surface-2 text-ink-dim'
                      : isSuspicious
                        ? 'border-danger/50 bg-danger/15 text-danger'
                        : 'border-ok/40 bg-ok/10 text-ok'
                  }`}
                >
                  {isSuspicious ? <ShieldAlert className="h-6 w-6" /> : <ShieldCheck className="h-6 w-6" />}
                </div>
              </div>
              <div>
                <p className={`font-display text-2xl font-bold tracking-tight ${!latest ? 'text-ink-dim' : isSuspicious ? 'text-danger' : 'text-ok'}`}>
                  {!latest ? 'NO SIGNAL' : isSuspicious ? 'SUSPICIOUS' : 'NORMAL'}
                </p>
                <p className="font-mono text-xs text-ink-dim">
                  {latest ? `t + ${rel(latest.window_start_s).toFixed(2)} s` : 'start a replay'}
                </p>
              </div>
            </motion.div>
          </AnimatePresence>
          <SignalTrace
            variant="can"
            className="mt-5 h-8"
            speed={isSuspicious ? 0.8 : 3}
            color={isSuspicious ? 'var(--danger)' : latest ? 'var(--ok)' : 'var(--line-strong)'}
            paused={status !== 'running'}
          />
        </motion.div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 lg:col-span-3">
          <MetricCard
            title="Frames / second"
            value={latest ? latest.features.frames_per_second : '--'}
            icon={Gauge}
            status="neutral"
            spark={frameSpark}
            delay={0.12}
          />
          <MetricCard
            title="Model score"
            value={latest ? latest.prediction.probability * 100 : '--'}
            decimals={1}
            suffix="%"
            icon={Radio}
            status={isSuspicious ? 'error' : 'success'}
            spark={scoreSpark}
            delay={0.16}
          />
          <MetricCard
            title="Alert episodes"
            value={alertCount}
            icon={AlertTriangle}
            status={alertCount > 0 ? 'warning' : 'neutral'}
            description={alertCount > 0 ? 'Rising edges into suspicious' : 'No alerts this run'}
            delay={0.2}
          />
        </div>
      </div>

      {/* Score chart */}
      <Panel
        eyebrow="Window-level detector output"
        title="Model score over time"
        delay={0.15}
        className="mb-6"
        actions={
          <div className="hidden items-center gap-4 text-xs sm:flex">
            <span className="flex items-center gap-1.5 text-ink-muted">
              <span className="h-0.5 w-3 rounded bg-signal" /> score
            </span>
            <span className="flex items-center gap-1.5 text-ink-muted">
              <span className="h-0.5 w-3 rounded bg-info" /> frames/s
            </span>
            <span className="flex items-center gap-1.5 text-ink-muted">
              <span className="h-0 w-3 border-t border-dashed border-danger" /> threshold
            </span>
          </div>
        }
      >
        {points.length > 0 ? (
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={points} margin={{ top: 8, right: 4, left: -12, bottom: 0 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="windowStart" {...axisProps} tickFormatter={(v: number) => `${v.toFixed(1)}s`} minTickGap={40} />
              <YAxis yAxisId="p" domain={[0, 1]} {...axisProps} tickFormatter={(v: number) => v.toFixed(1)} />
              <YAxis yAxisId="f" orientation="right" {...axisProps} width={44} />
              <Tooltip
                {...tooltipProps}
                labelFormatter={(v: number) => `t + ${Number(v).toFixed(2)} s`}
                formatter={(value: number, name: string) =>
                  name === 'probability' ? [value.toFixed(3), 'score'] : [value.toFixed(0), 'frames/s']
                }
              />
              <ReferenceArea yAxisId="p" y1={threshold} y2={1} fill={chartColors.danger} fillOpacity={0.05} />
              <ReferenceLine yAxisId="p" y={threshold} stroke={chartColors.danger} strokeDasharray="4 4" strokeOpacity={0.7} />
              <Line
                yAxisId="f"
                type="monotone"
                dataKey="frameRate"
                stroke={chartColors.info}
                strokeWidth={1.25}
                strokeOpacity={0.6}
                dot={false}
                isAnimationActive={false}
              />
              <Area
                yAxisId="p"
                type="monotone"
                dataKey="probability"
                stroke={chartColors.signal}
                strokeWidth={2}
                fill={chartColors.signal}
                fillOpacity={0.07}
                dot={<SuspiciousDot />}
                activeDot={{ r: 4, fill: chartColors.signal, stroke: '#0B0D0F', strokeWidth: 2 }}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <div className="relative flex h-[300px] items-center justify-center overflow-hidden rounded-lg border border-dashed border-line">
            <SignalTrace variant="can" className="absolute inset-x-0 top-1/2 h-16 -translate-y-1/2 opacity-10" speed={8} />
            <p className="relative font-mono text-xs text-ink-dim">
              <span className="text-signal">❯</span> awaiting replay stream<span className="animate-blink">_</span>
            </p>
          </div>
        )}
      </Panel>

      {/* Latest window readout */}
      {latest && (
        <Panel eyebrow="Latest window" title="Feature readout" delay={0} className="mb-6">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {Object.entries(latest.features)
              .slice(0, 12)
              .map(([k, v]) => (
                <div key={k} className="rounded-lg border border-line bg-surface-2 px-3 py-2.5">
                  <p className="label-mono truncate text-[0.625rem]" title={k}>{k.replace(/_/g, ' ')}</p>
                  <p className="readout mt-1 text-sm text-ink">{Number.isInteger(v) ? v : v.toFixed(4)}</p>
                </div>
              ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-ink-dim">
            <Timer className="h-3.5 w-3.5" />
            <span className="font-mono">
              window t + {rel(latest.window_start_s).toFixed(2)}–{rel(latest.window_end_s).toFixed(2)} s
            </span>
            <span>·</span>
            <span>
              ground truth:{' '}
              <span className={latest.ground_truth_positive ? 'text-warn' : 'text-ok'}>
                {latest.ground_truth_positive ? latest.attack_type : 'normal'}
              </span>
            </span>
          </div>
        </Panel>
      )}

      {datasets.length === 0 && !error && (
        <Panel>
          <EmptyState
            icon={<Database className="h-5 w-5" />}
            title="No recorded CAN captures are registered"
            hint="Run the dataset preparation scripts before starting a replay."
          />
        </Panel>
      )}
    </PageContainer>
  );
}
