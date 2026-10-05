import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { PageContainer } from '../components/PageContainer';
import { PageHeader } from '../components/PageHeader';
import { Panel } from '../components/Panel';
import { StatusBadge } from '../components/StatusBadge';
import { ConfidenceRing } from '../components/ConfidenceRing';
import { SignalTrace } from '../components/SignalTrace';
import { Play, RefreshCw, Keyboard, Mouse, Crosshair } from 'lucide-react';
import { fetchModelInfo, predictWithFeatures } from '../../lib/api';

const defaultFeatures = [
  'event_rate',
  'avg_time_gap',
  'std_time_gap',
  'burst_density',
  'avg_packet_size',
  'movement_speed',
  'click_frequency',
  'key_press_rate',
];

type PredictionResult = {
  prediction: 'KEYBOARD' | 'MOUSE';
  confidence: number;
  probabilities: {
    keyboard: number;
    mouse: number;
  };
  processingTime: number;
};

export default function RunPrediction() {
  const [isLoading, setIsLoading] = useState(false);
  const [modelLoaded, setModelLoaded] = useState(false);
  const [featureColumns, setFeatureColumns] = useState<string[]>(defaultFeatures);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PredictionResult | null>(null);
  const [features, setFeatures] = useState<Record<string, string>>({});

  useEffect(() => {
    let isMounted = true;

    async function loadModelInfo() {
      try {
        const info = await fetchModelInfo();
        if (!isMounted) {
          return;
        }

        const columns = info.feature_columns.length > 0 ? info.feature_columns : defaultFeatures;
        setModelLoaded(info.model_loaded);
        setFeatureColumns(columns);
        setFeatures((prev) => {
          const next: Record<string, string> = {};
          for (const col of columns) {
            next[col] = prev[col] ?? '0';
          }
          return next;
        });
      } catch {
        if (!isMounted) {
          return;
        }
        setError('Unable to load model metadata. Check backend connectivity.');
      }
    }

    void loadModelInfo();

    return () => {
      isMounted = false;
    };
  }, []);

  const featureFields = useMemo(
    () =>
      featureColumns.map((name) => ({
        name,
        label: name
          .split('_')
          .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
          .join(' '),
      })),
    [featureColumns]
  );

  const vector = featureColumns.map((name) => Number(features[name] ?? 0) || 0);
  // Log-scaled magnitudes so wildly different units still read on one strip.
  const logMagnitudes = vector.map((v) => Math.log10(1 + Math.abs(v)));
  const maxMagnitude = Math.max(...logMagnitudes, 1e-9);
  const magnitudes = logMagnitudes.map((l) => l / maxMagnitude);

  const handleRunPrediction = async () => {
    setIsLoading(true);
    setResult(null);
    setError(null);

    try {
      const t0 = performance.now();
      const payload = await predictWithFeatures(vector);
      const t1 = performance.now();

      const probs = payload.prediction.probabilities;
      const keyboardProb = Object.entries(probs).find(([k]) => k.toLowerCase().includes('key'))?.[1] ?? 0;
      const mouseProb = Object.entries(probs).find(([k]) => k.toLowerCase().includes('mouse'))?.[1] ?? 0;

      setResult({
        prediction: payload.prediction.device.toUpperCase().includes('KEY') ? 'KEYBOARD' : 'MOUSE',
        confidence: payload.prediction.confidence * 100,
        probabilities: {
          keyboard: keyboardProb * 100,
          mouse: mouseProb * 100,
        },
        processingTime: Math.max(1, t1 - t0),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Prediction request failed');
    } finally {
      setIsLoading(false);
    }
  };

  const handleFeatureChange = (name: string, value: string) => {
    setFeatures((prev) => ({ ...prev, [name]: value }));
  };

  const handleReset = () => {
    setFeatures(featureColumns.reduce<Record<string, string>>((acc, name) => ({ ...acc, [name]: '0' }), {}));
    setResult(null);
  };

  const isKeyboard = result?.prediction === 'KEYBOARD';
  const resultColor = isKeyboard ? 'var(--signal)' : 'var(--info)';

  return (
    <PageContainer maxWidth="2xl">
      <PageHeader
        eyebrow="Module 01 · Controlled inference"
        title="Run Prediction"
        description="Feed a hand-crafted timing feature vector to the classifier and inspect exactly how it decides."
        actions={<StatusBadge status={modelLoaded ? 'success' : 'warning'} label={modelLoaded ? 'Model loaded' : 'Model unavailable'} />}
      >
        {error && (
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-4 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </motion.p>
        )}
      </PageHeader>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Left column: input */}
        <div className="flex flex-col gap-6">
          <Panel
            eyebrow={`${featureFields.length} channels`}
            title="Feature input"
            delay={0.05}
            actions={
              <button onClick={handleReset} className="btn btn-ghost btn-sm">
                <RefreshCw /> Reset
              </button>
            }
          >
            <div className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2">
              {featureFields.map((feature, idx) => (
                <motion.div
                  key={feature.name}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.35, delay: 0.1 + idx * 0.035 }}
                >
                  <label htmlFor={`f-${feature.name}`} className="mb-1.5 flex items-center justify-between text-ink-muted">
                    <span>{feature.label}</span>
                    <span className="font-mono text-[0.625rem] text-ink-dim">f{String(idx).padStart(2, '0')}</span>
                  </label>
                  <input
                    id={`f-${feature.name}`}
                    type="number"
                    step="any"
                    value={features[feature.name] ?? '0'}
                    onChange={(e) => handleFeatureChange(feature.name, e.target.value)}
                    className="field"
                  />
                </motion.div>
              ))}
            </div>

            <button
              onClick={handleRunPrediction}
              disabled={isLoading || !modelLoaded}
              className="btn btn-primary btn-lg mt-6 w-full"
            >
              {isLoading ? (
                <>
                  <RefreshCw className="animate-spin" />
                  Running inference…
                </>
              ) : (
                <>
                  <Play />
                  Run prediction
                </>
              )}
            </button>
          </Panel>

          {/* Feature vector preview */}
          <Panel eyebrow="Tensor preview" title="Feature vector" delay={0.12} className="bg-bg-2">
            <div className="mb-4 flex h-16 items-end gap-1" aria-hidden="true">
              {magnitudes.map((m, i) => (
                <motion.div
                  key={i}
                  className="flex-1 rounded-t-sm bg-signal/70"
                  initial={false}
                  animate={{ height: `${Math.max(4, m * 100)}%` }}
                  transition={{ type: 'spring', stiffness: 260, damping: 24 }}
                />
              ))}
            </div>
            <pre className="overflow-x-auto rounded-lg border border-line bg-bg p-3 text-xs leading-relaxed text-ink-muted">
              <span className="text-ink-dim">x = </span>
              <span className="text-signal">[</span>
              {vector.map((v, i) => (
                <span key={i}>
                  <span className="text-ink">{v}</span>
                  {i < vector.length - 1 && <span className="text-ink-dim">, </span>}
                </span>
              ))}
              <span className="text-signal">]</span>
            </pre>
          </Panel>
        </div>

        {/* Right column: results */}
        <div>
          <AnimatePresence mode="wait">
            {!result && !isLoading && (
              <motion.div
                key="placeholder"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="relative flex h-full min-h-[420px] flex-col items-center justify-center overflow-hidden rounded-xl border border-dashed border-line-strong bg-surface/50 p-12 text-center"
              >
                <SignalTrace variant="sine" className="absolute inset-x-0 top-1/2 h-24 -translate-y-1/2 opacity-15" speed={10} decorated />
                <div className="relative mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-line-strong bg-surface-2">
                  <Crosshair className="h-6 w-6 text-ink-dim" />
                </div>
                <p className="relative font-medium text-ink-muted">Awaiting input</p>
                <p className="relative mt-1 max-w-xs text-sm text-ink-dim">
                  Configure the feature channels and run a prediction to see the classification.
                </p>
              </motion.div>
            )}

            {isLoading && (
              <motion.div
                key="loading"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex min-h-[420px] flex-col items-center justify-center rounded-xl border border-line bg-surface p-8 text-center"
              >
                <SignalTrace variant="pulse" className="mb-6 h-12 w-56" speed={1.6} strokeWidth={2} />
                <p className="font-medium text-ink">Processing features…</p>
                <p className="mt-1 text-sm text-ink-dim">Running inference through the model</p>
              </motion.div>
            )}

            {result && (
              <motion.div
                key="result"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
                className="flex flex-col gap-6"
              >
                {/* Result hero */}
                <Panel brackets padded={false}>
                  <div className="flex flex-col items-center gap-6 p-8 sm:flex-row sm:justify-between">
                    <div className="text-center sm:text-left">
                      <p className="label-mono mb-3">Classification result</p>
                      <motion.div
                        initial={{ scale: 0.85, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ delay: 0.15, type: 'spring', stiffness: 260, damping: 18 }}
                        className="flex items-center justify-center gap-3 sm:justify-start"
                      >
                        <div
                          className="flex h-12 w-12 items-center justify-center rounded-lg border"
                          style={{ color: resultColor, borderColor: `color-mix(in oklab, ${resultColor} 40%, transparent)`, background: `color-mix(in oklab, ${resultColor} 10%, transparent)` }}
                        >
                          {isKeyboard ? <Keyboard className="h-6 w-6" /> : <Mouse className="h-6 w-6" />}
                        </div>
                        <h2 className="font-display text-4xl font-bold tracking-tight" style={{ color: resultColor }}>
                          {result.prediction}
                        </h2>
                      </motion.div>
                      <p className="mt-3 text-sm text-ink-dim">
                        Signal signature matches a {isKeyboard ? 'keyboard' : 'mouse'} HID device.
                      </p>
                    </div>
                    <ConfidenceRing value={Math.round(result.confidence * 10) / 10} size="lg" label="Confidence" />
                  </div>
                </Panel>

                {/* Probability distribution */}
                <Panel eyebrow="Softmax output" title="Probability distribution" delay={0.08}>
                  <div className="space-y-5">
                    {[
                      { label: 'Keyboard', value: result.probabilities.keyboard, color: 'bg-signal', text: 'text-signal', Icon: Keyboard },
                      { label: 'Mouse', value: result.probabilities.mouse, color: 'bg-info', text: 'text-info', Icon: Mouse },
                    ].map((row, i) => (
                      <div key={row.label}>
                        <div className="mb-2 flex items-center justify-between">
                          <span className="flex items-center gap-2 text-sm text-ink-muted">
                            <row.Icon className={`h-4 w-4 ${row.text}`} /> {row.label}
                          </span>
                          <span className={`readout text-sm font-semibold ${row.text}`}>{row.value.toFixed(1)}%</span>
                        </div>
                        <div className="relative h-2.5 overflow-hidden rounded-full bg-surface-3">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${row.value}%` }}
                            transition={{ duration: 1, delay: 0.25 + i * 0.1, ease: [0.16, 1, 0.3, 1] }}
                            className={`h-full rounded-full ${row.color}`}
                          />
                          {/* 50% decision line */}
                          <span className="absolute inset-y-0 left-1/2 w-px bg-ink-dim/50" />
                        </div>
                      </div>
                    ))}
                  </div>
                </Panel>

                {/* Metadata */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="rounded-xl border border-line bg-surface p-4">
                    <p className="label-mono mb-1">Round-trip latency</p>
                    <p className="readout text-xl font-semibold text-ink">{result.processingTime.toFixed(1)} ms</p>
                  </div>
                  <div className="rounded-xl border border-line bg-surface p-4">
                    <p className="label-mono mb-1">Model version</p>
                    <p className="readout text-xl font-semibold text-ink">v2.3.1</p>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </PageContainer>
  );
}
