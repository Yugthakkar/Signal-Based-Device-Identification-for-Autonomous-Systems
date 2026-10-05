import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Car, Waves, Shuffle, Cog, Gauge, Pause, Play, Scan, ShieldAlert, ShieldCheck, ChevronLeft, ChevronRight, Route } from 'lucide-react';
import { PageContainer } from '../components/PageContainer';
import { PageHeader } from '../components/PageHeader';
import { Panel } from '../components/Panel';
import { StatusBadge } from '../components/StatusBadge';
import { BusScene, type BusSceneHandle, type CameraPreset } from '../components/BusScene';
import { fetchCanScenarios, type CanFrame, type CanScenariosResponse, type CanScenarioWindow } from '../../lib/api';

// One recorded 100 ms window is shown every WINDOW_PLAY_MS, i.e. half real-time speed.
const WINDOW_PLAY_MS = 200;
// The bus carries ~2,000 frames/s; draw one packet per this many real frames.
const VISUAL_DIVISOR = 90;
const HISTORY = 64;
const TICKER_ROWS = 9;

const SCENARIO_META: Record<string, { label: string; icon: typeof Car; blurb: string }> = {
  normal: { label: 'Normal driving', icon: Car, blurb: 'Recorded attack-free driving. Each ECU broadcasts its frames on a regular schedule.' },
  dos: { label: 'DoS flood', icon: Waves, blurb: 'Floods the bus with ID 0x000 — the highest priority — so genuine ECUs lose arbitration and fall silent.' },
  fuzzy: { label: 'Fuzzing', icon: Shuffle, blurb: 'Sprays frames with random IDs and random payloads to provoke unexpected behaviour.' },
  gear_spoof: { label: 'Gear spoof', icon: Cog, blurb: 'Repeats forged gear-position frames (ID 0x43F) to make the car report the wrong gear.' },
  rpm_spoof: { label: 'RPM spoof', icon: Gauge, blurb: 'Repeats forged engine-speed frames (ID 0x316) to fake the tachometer reading.' },
};

const FEATURES: { key: string; label: string; fmt: (v: number) => string }[] = [
  { key: 'frames_per_second', label: 'Frames / second', fmt: (v) => v.toFixed(0) },
  { key: 'unique_id_count', label: 'Unique CAN IDs', fmt: (v) => v.toFixed(0) },
  { key: 'id_entropy', label: 'ID entropy', fmt: (v) => v.toFixed(2) },
  { key: 'dominant_id_fraction', label: 'Dominant ID share', fmt: (v) => `${(v * 100).toFixed(0)}%` },
  { key: 'burst_fraction', label: 'Gaps under 1 ms', fmt: (v) => `${(v * 100).toFixed(0)}%` },
  { key: 'gap_min_ms', label: 'Smallest gap', fmt: (v) => `${v.toFixed(2)} ms` },
];

const TOUR: { title: string; body: string; preset: CameraPreset; scenario?: string }[] = [
  {
    title: 'One shared bus',
    body: 'Every ECU in the car broadcasts on the same two wires. A CAN frame carries an ID and data, but no sender address and no authentication — every node trusts what it hears.',
    preset: 'bus',
    scenario: 'normal',
  },
  {
    title: 'An attacker plugs in',
    body: 'The OBD-II diagnostic port sits directly on that bus. A device plugged in there can inject frames that look just like genuine ones. Red packets are frames the dataset marks as injected.',
    preset: 'attacker',
    scenario: 'dos',
  },
  {
    title: 'Slice traffic into 100 ms windows',
    body: 'The detector taps the bus and ignores payloads. Every 100 ms it summarises the traffic into 10 timing statistics: how fast frames arrive, how varied the IDs are, whether one ID dominates.',
    preset: 'detector',
  },
  {
    title: 'The model scores each window',
    body: 'A Random Forest trained on recorded traffic outputs the probability that the window contains injected frames. Above the threshold chosen on validation data, the window is flagged.',
    preset: 'detector',
  },
  {
    title: 'Verdict and alert',
    body: 'Consecutive flagged windows are merged into one alert episode and stored — that is what the Threat Timeline lists. Switch scenarios above to see how each attack changes the bus.',
    preset: 'overview',
  },
];

type HistoryPoint = { probability: number; suspicious: boolean; truth: boolean };
type TickerFrame = CanFrame & { seq: number };

export default function BusLab() {
  const sceneRef = useRef<BusSceneHandle>(null);
  const [data, setData] = useState<CanScenariosResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scenarioKey, setScenarioKey] = useState('normal');
  const [paused, setPaused] = useState(false);
  const [current, setCurrent] = useState<CanScenarioWindow | null>(null);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [ticker, setTicker] = useState<TickerFrame[]>([]);
  const [step, setStep] = useState(0);
  const [touring, setTouring] = useState(false);

  useEffect(() => {
    fetchCanScenarios()
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  const scenario = useMemo(() => data?.scenarios.find((s) => s.key === scenarioKey) ?? null, [data, scenarioKey]);

  // Per-feature mean of the normal clip: the reference each live value is compared against.
  const baseline = useMemo(() => {
    const normal = data?.scenarios.find((s) => s.key === 'normal');
    if (!normal || normal.windows.length === 0) return null;
    const out: Record<string, number> = {};
    for (const f of FEATURES) {
      out[f.key] = normal.windows.reduce((acc, w) => acc + w.features[f.key], 0) / normal.windows.length;
    }
    return out;
  }, [data]);

  // Playback: step through recorded windows and release recorded frames onto the 3D bus.
  useEffect(() => {
    if (!scenario || paused || scenario.windows.length === 0) return;
    sceneRef.current?.setAttack(scenario.key !== 'normal');

    let windowIdx = 0;
    let frameIdx = 0;
    let seq = 0;
    let budget = 0;
    let sinceWindow = WINDOW_PLAY_MS;
    let framesPerSecond = 0;
    let last = performance.now();
    const buffer: TickerFrame[] = [];

    const id = setInterval(() => {
      const now = performance.now();
      const dt = Math.min((now - last) / 1000, 0.25);
      last = now;

      sinceWindow += dt * 1000;
      if (sinceWindow >= WINDOW_PLAY_MS) {
        sinceWindow = 0;
        const w = scenario.windows[windowIdx % scenario.windows.length];
        windowIdx += 1;
        framesPerSecond = w.features.frames_per_second;
        const suspicious = w.classification === 'suspicious';
        setCurrent(w);
        setHistory((prev) => [...prev.slice(-(HISTORY - 1)), { probability: w.probability, suspicious, truth: w.ground_truth_positive }]);
        sceneRef.current?.setVerdict(suspicious ? 'suspicious' : 'normal');
      }

      if (scenario.frames.length > 0) {
        budget += (framesPerSecond / VISUAL_DIVISOR) * dt;
        let emitted = false;
        while (budget >= 1) {
          budget -= 1;
          const frame = scenario.frames[frameIdx % scenario.frames.length];
          frameIdx += 1;
          seq += 1;
          sceneRef.current?.emit(frame);
          buffer.push({ ...frame, seq });
          emitted = true;
        }
        if (emitted) {
          if (buffer.length > TICKER_ROWS) buffer.splice(0, buffer.length - TICKER_ROWS);
          setTicker([...buffer]);
        }
      }
    }, 50);

    return () => clearInterval(id);
  }, [scenario, paused]);

  // Guided tour (skipped on first render so the page opens on the overview shot)
  const tourReady = useRef(false);
  useEffect(() => {
    if (!tourReady.current) {
      tourReady.current = true;
      return;
    }
    const s = TOUR[step];
    sceneRef.current?.focus(s.preset);
    if (s.scenario) setScenarioKey(s.scenario);
  }, [step]);

  useEffect(() => {
    if (!touring) return;
    const id = setTimeout(() => {
      if (step >= TOUR.length - 1) setTouring(false);
      else setStep(step + 1);
    }, 8000);
    return () => clearTimeout(id);
  }, [touring, step]);

  const startTour = () => {
    setPaused(false);
    setStep(0);
    setTouring(true);
  };

  const suspicious = current?.classification === 'suspicious';
  const threshold = data?.threshold ?? 0.5;
  const meta = SCENARIO_META[scenarioKey];
  const flaggedShare = history.length ? history.filter((h) => h.suspicious).length / history.length : 0;

  return (
    <PageContainer maxWidth="2xl">
      <PageHeader
        eyebrow="Module 02 · Interactive explainer"
        title="3D Bus Lab"
        description="See inside the car's network. Pick an attack, watch real recorded frames travel the CAN bus, and watch the detector decide — window by window."
        trace="can"
        actions={
          <>
            <button onClick={() => setPaused((p) => !p)} className="btn btn-secondary" disabled={!data}>
              {paused ? <Play /> : <Pause />} {paused ? 'Resume' : 'Pause'}
            </button>
            <button onClick={startTour} className="btn btn-primary" disabled={!data}>
              <Route /> {touring ? 'Restart tour' : 'Play guided tour'}
            </button>
          </>
        }
      />

      {/* Scenario switch */}
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {Object.entries(SCENARIO_META).map(([key, m]) => {
          const active = key === scenarioKey;
          const available = data?.scenarios.some((s) => s.key === key);
          const attack = key !== 'normal';
          const Icon = m.icon;
          return (
            <button
              key={key}
              onClick={() => {
                setTouring(false);
                setScenarioKey(key);
              }}
              disabled={!available}
              aria-pressed={active}
              className={`group relative flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-all duration-200 disabled:opacity-40 ${
                active
                  ? attack
                    ? 'border-danger/60 bg-danger/10'
                    : 'border-ok/50 bg-ok/10'
                  : 'border-line bg-surface hover:-translate-y-0.5 hover:border-line-strong'
              }`}
            >
              <div
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition-colors ${
                  active ? (attack ? 'border-danger/50 text-danger' : 'border-ok/50 text-ok') : 'border-line-strong text-ink-muted group-hover:text-ink'
                }`}
              >
                <Icon className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className={`truncate text-sm font-semibold ${active ? 'text-ink' : 'text-ink-muted'}`}>{m.label}</p>
                <p className="label-mono text-[0.625rem]">{attack ? 'attack' : 'baseline'}</p>
              </div>
            </button>
          );
        })}
      </div>

      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* 3D stage */}
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className={`relative h-[520px] overflow-hidden rounded-xl border bg-bg transition-colors duration-500 lg:col-span-2 lg:h-[640px] ${
            suspicious ? 'border-danger/50' : 'border-line'
          }`}
        >
          <BusScene ref={sceneRef} className="h-full w-full" />

          {/* top-left: what is playing */}
          <div className="pointer-events-none absolute left-4 top-4 hidden max-w-xs rounded-lg border border-line bg-bg/85 p-3 backdrop-blur sm:block">
            <p className="label-mono mb-1">Now playing</p>
            <p className="text-sm font-semibold text-ink">{meta.label}</p>
            <p className="mt-1 text-xs leading-relaxed text-ink-muted">{meta.blurb}</p>
          </div>

          {/* top-right: legend */}
          <div className="pointer-events-none absolute right-4 top-4 hidden rounded-lg border border-line bg-bg/85 p-3 text-xs text-ink-muted backdrop-blur sm:block">
            <p className="mb-1.5 flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-signal" /> genuine frame
            </p>
            <p className="mb-1.5 flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-danger" /> injected frame
            </p>
            <p className="font-mono text-[0.625rem] text-ink-dim">1 dot ≈ {VISUAL_DIVISOR} frames · drag to orbit</p>
          </div>

          {/* bottom: tour caption */}
          <div className="absolute inset-x-4 bottom-4 rounded-lg border border-line bg-bg/90 p-4 backdrop-blur">
            <div className="mb-3 flex items-center gap-2">
              {TOUR.map((t, i) => (
                <button
                  key={t.title}
                  onClick={() => {
                    setTouring(false);
                    setStep(i);
                  }}
                  aria-label={`Step ${i + 1}: ${t.title}`}
                  className="group relative h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3"
                >
                  <span className={`absolute inset-0 rounded-full transition-colors ${i < step ? 'bg-signal/50' : i === step ? '' : 'group-hover:bg-line-strong'}`} />
                  {i === step && (
                    <motion.span
                      key={`${step}-${touring}`}
                      className="absolute inset-y-0 left-0 rounded-full bg-signal"
                      initial={{ width: touring ? '0%' : '100%' }}
                      animate={{ width: '100%' }}
                      transition={{ duration: touring ? 8 : 0, ease: 'linear' }}
                    />
                  )}
                </button>
              ))}
            </div>
            <div className="flex items-start gap-3">
              <button
                onClick={() => {
                  setTouring(false);
                  setStep((s) => Math.max(0, s - 1));
                }}
                disabled={step === 0}
                aria-label="Previous step"
                className="btn btn-ghost btn-sm h-8 w-8 shrink-0 px-0"
              >
                <ChevronLeft />
              </button>
              <AnimatePresence mode="wait">
                <motion.div
                  key={step}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.25 }}
                  className="min-h-[4.5rem] min-w-0 flex-1"
                >
                  <p className="mb-1 text-sm font-semibold text-ink">
                    <span className="mr-2 font-mono text-xs text-signal">0{step + 1}</span>
                    {TOUR[step].title}
                  </p>
                  <p className="text-xs leading-relaxed text-ink-muted sm:text-[0.8125rem]">{TOUR[step].body}</p>
                </motion.div>
              </AnimatePresence>
              <button
                onClick={() => {
                  setTouring(false);
                  setStep((s) => Math.min(TOUR.length - 1, s + 1));
                }}
                disabled={step === TOUR.length - 1}
                aria-label="Next step"
                className="btn btn-ghost btn-sm h-8 w-8 shrink-0 px-0"
              >
                <ChevronRight />
              </button>
            </div>
          </div>

          {error && (
            <div className="absolute inset-0 flex items-center justify-center bg-bg/80 p-6 text-center backdrop-blur-sm">
              <div className="max-w-sm">
                <p className="mb-1 font-semibold text-danger">Cannot load recorded scenarios</p>
                <p className="text-sm text-ink-muted">Start the backend (port 8000) with the CAN model trained, then reload. {error}</p>
              </div>
            </div>
          )}
        </motion.div>

        {/* Detector readout */}
        <div className="flex flex-col gap-6">
          <Panel eyebrow="Intrusion detector" title="Live verdict" delay={0.08} brackets actions={<StatusBadge status={paused ? 'idle' : 'processing'} label={paused ? 'Paused' : 'Scoring'} size="sm" />}>
            <div className="mb-5 flex items-center gap-4">
              <div
                className={`relative flex h-14 w-14 shrink-0 items-center justify-center rounded-full border transition-colors duration-300 ${
                  !current ? 'border-line-strong bg-surface-2 text-ink-dim' : suspicious ? 'border-danger/50 bg-danger/15 text-danger' : 'border-ok/40 bg-ok/10 text-ok'
                }`}
              >
                {suspicious ? <ShieldAlert className="h-6 w-6" /> : current ? <ShieldCheck className="h-6 w-6" /> : <Scan className="h-6 w-6" />}
              </div>
              <div>
                <p className={`font-display text-2xl font-bold tracking-tight transition-colors duration-300 ${!current ? 'text-ink-dim' : suspicious ? 'text-danger' : 'text-ok'}`}>
                  {!current ? 'WAITING' : suspicious ? 'SUSPICIOUS' : 'NORMAL'}
                </p>
                <p className="font-mono text-xs text-ink-dim">
                  {data?.selected_model ? data.selected_model.replace(/_/g, ' ') : 'model'} · 100 ms window
                </p>
              </div>
            </div>

            {/* score vs threshold */}
            <div className="mb-1 flex items-center justify-between">
              <span className="label-mono">Model score</span>
              <span className={`readout text-sm font-semibold ${suspicious ? 'text-danger' : 'text-ink'}`}>
                {current ? `${(current.probability * 100).toFixed(1)}%` : '--'}
              </span>
            </div>
            <div className="relative h-2.5 rounded-full bg-surface-3">
              <div
                className={`h-full rounded-full transition-all duration-200 ${suspicious ? 'bg-danger' : 'bg-ok'}`}
                style={{ width: `${(current?.probability ?? 0) * 100}%` }}
              />
              <span className="absolute -bottom-1 -top-1 w-px bg-ink" style={{ left: `${threshold * 100}%` }} />
            </div>
            <p className="mt-1.5 text-right font-mono text-[0.625rem] text-ink-dim">threshold {(threshold * 100).toFixed(1)}%</p>

            <div className="mt-3 flex items-center justify-between rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs">
              <span className="text-ink-dim">Dataset label for this window</span>
              <span className={`font-mono ${current?.ground_truth_positive ? 'text-danger' : 'text-ok'}`}>
                {!current ? '--' : current.ground_truth_positive ? `${(current.attack_fraction * 100).toFixed(0)}% injected` : 'no injection'}
              </span>
            </div>
          </Panel>

          <Panel eyebrow="What the model sees" title="Window features" delay={0.14} className="flex-1">
            <div className="space-y-3.5">
              {FEATURES.map((f) => {
                const value = current?.features[f.key];
                const base = baseline?.[f.key];
                const ratio = value !== undefined && base ? value / base : 1;
                const pos = Math.max(0, Math.min(1, ratio / 2)) * 100;
                const off = Math.abs(ratio - 1) > 0.25;
                return (
                  <div key={f.key}>
                    <div className="mb-1 flex items-baseline justify-between text-xs">
                      <span className="text-ink-muted">{f.label}</span>
                      <span className={`readout font-medium ${off ? 'text-danger' : 'text-ink'}`}>{value !== undefined ? f.fmt(value) : '--'}</span>
                    </div>
                    <div className="relative h-1.5 rounded-full bg-surface-3">
                      <div
                        className={`absolute inset-y-0 rounded-full transition-all duration-200 ${off ? 'bg-danger' : 'bg-ok'}`}
                        style={{ left: `${Math.min(50, pos)}%`, width: `${Math.max(Math.abs(pos - 50), 1.5)}%` }}
                      />
                      <span className="absolute -bottom-0.5 -top-0.5 left-1/2 w-px bg-ink-dim" />
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="mt-4 text-[0.6875rem] leading-relaxed text-ink-dim">
              Centre mark = average of the normal recording. Bars turn red when a value drifts more than 25% from it.
            </p>
          </Panel>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Raw frames */}
        <Panel eyebrow={`candump · ${scenario?.capture_id ?? '—'}`} title="Frames on the bus" delay={0.18} padded={false} className="bg-bg-2">
          <div className="h-[262px] overflow-hidden px-5 py-4 font-mono text-xs">
            <div className="mb-2 grid grid-cols-[4.5rem_3.5rem_2rem_1fr_4.5rem] gap-3 text-[0.625rem] uppercase tracking-wider text-ink-dim">
              <span>time</span>
              <span>id</span>
              <span>dlc</span>
              <span>data</span>
              <span className="text-right">source</span>
            </div>
            {ticker.map((f) => (
              <motion.div
                key={f.seq}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.15 }}
                className={`grid grid-cols-[4.5rem_3.5rem_2rem_1fr_4.5rem] gap-3 rounded px-1 py-[3px] ${f.injected ? 'bg-danger/10 text-danger' : 'text-ink-muted'}`}
              >
                <span className="text-ink-dim">+{(f.t * 1000).toFixed(1)}ms</span>
                <span className={f.injected ? '' : 'text-signal'}>0x{f.id.slice(-3).toUpperCase()}</span>
                <span>{f.dlc}</span>
                <span className="truncate">{f.data.join(' ').toUpperCase()}</span>
                <span className="text-right text-[0.625rem] uppercase tracking-wider">{f.injected ? 'injected' : 'ecu'}</span>
              </motion.div>
            ))}
            {ticker.length === 0 && (
              <p className="py-8 text-center text-ink-dim">
                <span className="text-signal">❯</span> waiting for frames<span className="animate-blink">_</span>
              </p>
            )}
          </div>
        </Panel>

        {/* Window history */}
        <Panel
          eyebrow={`Last ${HISTORY} windows`}
          title="Detector timeline"
          delay={0.22}
          actions={<span className="readout text-xs text-ink-muted">{(flaggedShare * 100).toFixed(0)}% flagged</span>}
        >
          <div className="relative h-36">
            <span className="absolute inset-x-0 border-t border-dashed border-ink-dim/60" style={{ bottom: `${threshold * 100}%` }} />
            <div className="flex h-full items-end gap-[3px]">
              {Array.from({ length: HISTORY }).map((_, i) => {
                const h = history[i - (HISTORY - history.length)];
                return (
                  <div key={i} className="flex h-full flex-1 items-end">
                    {h && (
                      <div
                        className={`w-full rounded-sm ${h.suspicious ? 'bg-danger' : 'bg-ok/70'}`}
                        style={{ height: `${Math.max(h.probability * 100, 3)}%` }}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          {/* dataset truth strip */}
          <div className="mt-2 flex gap-[3px]">
            {Array.from({ length: HISTORY }).map((_, i) => {
              const h = history[i - (HISTORY - history.length)];
              return <div key={i} className={`h-1 flex-1 rounded-sm ${!h ? 'bg-surface-3' : h.truth ? 'bg-danger/70' : 'bg-surface-3'}`} />;
            })}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-ink-dim">
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-danger" /> flagged by model</span>
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-ok/70" /> passed</span>
            <span className="flex items-center gap-1.5"><span className="h-1 w-3 rounded-sm bg-danger/70" /> dataset says injected</span>
            <span className="flex items-center gap-1.5"><span className="w-3 border-t border-dashed border-ink-dim" /> threshold</span>
          </div>
        </Panel>
      </div>

      <p className="rounded-lg border border-line bg-surface px-4 py-3 text-xs leading-relaxed text-ink-dim">
        <span className="font-semibold text-ink-muted">What is real here:</span> the windows, features, raw frames and injected-frame labels are
        recorded HCRL Car-Hacking data, and every score comes from the deployed model. You only choose which recording plays.{' '}
        <span className="font-semibold text-ink-muted">What is illustrative:</span> the car and which ECU sends each ID (the dataset does not
        publish that mapping, apart from 0x316 engine speed and 0x43F gear). Playback runs at half real-time speed.
      </p>
    </PageContainer>
  );
}
