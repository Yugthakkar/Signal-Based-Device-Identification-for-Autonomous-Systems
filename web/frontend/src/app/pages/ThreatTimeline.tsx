import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { PageContainer } from '../components/PageContainer';
import { PageHeader } from '../components/PageHeader';
import { Panel, EmptyState } from '../components/Panel';
import { MetricCard } from '../components/MetricCard';
import { StatusBadge } from '../components/StatusBadge';
import { AlertTriangle, RefreshCcw, ScanSearch, ShieldAlert, Flame, HardDrive } from 'lucide-react';
import { fetchCanAlerts, fetchCanDatasets, runCanAnalysis, type CanAlert, type CanDataset } from '../../lib/api';

function severityFor(probability: number): 'error' | 'warning' {
  return probability >= 0.9 ? 'error' : 'warning';
}

/** One horizontal lane per capture; each alert episode is a mark at its position in the recording. */
function EpisodeStrip({ alerts, datasets }: { alerts: CanAlert[]; datasets: CanDataset[] }) {
  const [hovered, setHovered] = useState<string | null>(null);

  const lanes = useMemo(() => {
    const byCapture = new Map<string, CanAlert[]>();
    for (const a of alerts) {
      const list = byCapture.get(a.capture_id) ?? [];
      list.push(a);
      byCapture.set(a.capture_id, list);
    }
    return [...byCapture.entries()].map(([captureId, list]) => {
      const ds = datasets.find((d) => d.capture_id === captureId);
      const minStart = Math.min(...list.map((a) => a.window_start_s));
      const maxEnd = Math.max(...list.map((a) => a.window_end_s));
      const duration = ds?.duration_s ?? 0;
      // Relative timestamps fit inside the capture duration; absolute (epoch) ones don't,
      // so fall back to spanning the alerts themselves.
      const relative = duration > 0 && maxEnd <= duration * 1.01;
      const origin = relative ? 0 : minStart;
      const span = Math.max(relative ? duration : maxEnd - origin, 1);
      return { captureId, list, origin, span };
    });
  }, [alerts, datasets]);

  const hoveredAlert = alerts.find((a) => a.id === hovered);

  return (
    <div>
      <div className="space-y-3">
        {lanes.map((lane, laneIdx) => (
          <div key={lane.captureId} className="flex items-center gap-3">
            <span className="w-32 shrink-0 truncate font-mono text-xs text-ink-muted" title={lane.captureId}>
              {lane.captureId}
            </span>
            <div className="relative h-7 flex-1 rounded-md border border-line bg-bg">
              {/* quarter ticks */}
              {[25, 50, 75].map((p) => (
                <span key={p} className="absolute inset-y-0 w-px bg-line" style={{ left: `${p}%` }} />
              ))}
              {lane.list.map((a, i) => {
                const left = ((a.window_start_s - lane.origin) / lane.span) * 100;
                const width = Math.max(((a.window_end_s - a.window_start_s) / lane.span) * 100, 0.6);
                const high = severityFor(a.max_probability) === 'error';
                return (
                  <motion.button
                    key={a.id}
                    type="button"
                    aria-label={`${a.attack_type ?? 'unclassified'} at ${a.window_start_s.toFixed(1)}s`}
                    initial={{ scaleY: 0, opacity: 0 }}
                    animate={{ scaleY: 1, opacity: 1 }}
                    transition={{ duration: 0.4, delay: 0.1 + laneIdx * 0.08 + i * 0.015, ease: [0.16, 1, 0.3, 1] }}
                    onMouseEnter={() => setHovered(a.id)}
                    onMouseLeave={() => setHovered(null)}
                    onFocus={() => setHovered(a.id)}
                    onBlur={() => setHovered(null)}
                    className={`absolute inset-y-1 rounded-sm transition-all duration-150 ${
                      high ? 'bg-danger' : 'bg-warn'
                    } ${hovered === a.id ? 'opacity-100 ring-2 ring-ink/60' : 'opacity-80 hover:opacity-100'}`}
                    style={{ left: `min(${left}%, calc(100% - 3px))`, width: `${width}%`, minWidth: 3 }}
                  />
                );
              })}
            </div>
            <span className="readout w-14 shrink-0 text-right text-xs text-ink-dim">{lane.span.toFixed(0)}s</span>
          </div>
        ))}
      </div>
      <div className="mt-4 flex min-h-[1.5rem] flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-4 text-ink-dim">
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-danger" /> high (≥ 90%)</span>
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-warn" /> medium</span>
        </div>
        <AnimatePresence mode="wait">
          {hoveredAlert && (
            <motion.span
              key={hoveredAlert.id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="font-mono text-ink-muted"
            >
              {hoveredAlert.attack_type ?? 'unclassified'} · {(hoveredAlert.window_end_s - hoveredAlert.window_start_s).toFixed(2)}s long ·{' '}
              <span className="text-ink">{(hoveredAlert.max_probability * 100).toFixed(1)}%</span>
            </motion.span>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

export default function ThreatTimeline() {
  const [alerts, setAlerts] = useState<CanAlert[]>([]);
  const [datasets, setDatasets] = useState<CanDataset[]>([]);
  const [selectedCapture, setSelectedCapture] = useState<string>('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadAlerts = async () => {
    setIsRefreshing(true);
    try {
      const res = await fetchCanAlerts({ limit: 200 });
      setAlerts(res.alerts);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    void loadAlerts();
    fetchCanDatasets()
      .then((res) => {
        setDatasets(res.datasets);
        if (res.datasets.length > 0) setSelectedCapture(res.datasets[0].capture_id);
      })
      .catch(() => undefined);
  }, []);

  const handleAnalyze = async () => {
    if (!selectedCapture) return;
    setIsAnalyzing(true);
    setError(null);
    try {
      await runCanAnalysis(selectedCapture);
      await loadAlerts();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsAnalyzing(false);
    }
  };

  const highCount = alerts.filter((a) => severityFor(a.max_probability) === 'error').length;
  const captureCount = new Set(alerts.map((a) => a.capture_id)).size;
  const attackTypes = new Set(alerts.map((a) => a.attack_type ?? 'unclassified')).size;

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Module 02 · Incident review"
        title="Threat Timeline"
        description="Deduplicated alert episodes from offline analysis and live replay runs. Evidence is a measured timing deviation, not proof of an attack."
        trace="can"
        actions={
          <button onClick={() => void loadAlerts()} className="btn btn-secondary">
            <RefreshCcw className={isRefreshing ? 'animate-spin' : ''} /> Refresh
          </button>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard title="Episodes" value={alerts.length} icon={ShieldAlert} status={alerts.length ? 'warning' : 'neutral'} delay={0} />
        <MetricCard title="High severity" value={highCount} icon={Flame} status={highCount ? 'error' : 'neutral'} delay={0.05} />
        <MetricCard title="Captures hit" value={captureCount} icon={HardDrive} status="neutral" delay={0.1} />
        <MetricCard title="Attack types" value={attackTypes} icon={AlertTriangle} status="neutral" delay={0.15} />
      </div>

      {/* Analysis control */}
      <Panel className="mb-6" delay={0.1} eyebrow="Offline analysis" title="Scan a recorded capture">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex min-w-[240px] flex-1 flex-col gap-1.5">
            <label htmlFor="tt-source" className="label-mono">Run offline analysis on</label>
            <select id="tt-source" value={selectedCapture} onChange={(e) => setSelectedCapture(e.target.value)} className="field">
              {datasets.map((d) => (
                <option key={d.capture_id} value={d.capture_id}>
                  {d.capture_id}
                </option>
              ))}
            </select>
          </div>
          <button onClick={handleAnalyze} disabled={isAnalyzing || !selectedCapture} className="btn btn-primary">
            <ScanSearch className={isAnalyzing ? 'animate-pulse' : ''} />
            {isAnalyzing ? 'Analyzing…' : 'Run analysis'}
          </button>
        </div>
        {isAnalyzing && (
          <div className="relative mt-4 h-0.5 overflow-hidden rounded-full bg-surface-3">
            <span className="absolute inset-y-0 w-1/4 bg-signal animate-sweep" />
          </div>
        )}
        {error && <p className="mt-3 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
      </Panel>

      {alerts.length > 0 && (
        <Panel className="mb-6" delay={0.15} eyebrow="Position in recording" title="Episode map" brackets>
          <EpisodeStrip alerts={alerts} datasets={datasets} />
        </Panel>
      )}

      <Panel delay={0.2} padded={false} eyebrow="Alert log" title="Episodes">
        {alerts.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Capture</th>
                  <th>Suspected type</th>
                  <th>Window range (s)</th>
                  <th>Windows</th>
                  <th>Max score</th>
                  <th>Severity</th>
                  <th>Recorded</th>
                </tr>
              </thead>
              <tbody>
                {alerts.map((alert, idx) => {
                  const sev = severityFor(alert.max_probability);
                  return (
                    <motion.tr
                      key={alert.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: Math.min(idx * 0.02, 0.5) }}
                    >
                      <td className="font-mono text-xs text-ink">{alert.capture_id}</td>
                      <td className="text-ink">{alert.attack_type ?? 'unclassified'}</td>
                      <td className="readout text-xs">
                        {alert.window_start_s.toFixed(2)} – {alert.window_end_s.toFixed(2)}
                      </td>
                      <td className="readout">{alert.window_count}</td>
                      <td>
                        <div className="flex items-center gap-2">
                          <div className="h-1 w-14 overflow-hidden rounded-full bg-surface-3">
                            <div
                              className={`h-full ${sev === 'error' ? 'bg-danger' : 'bg-warn'}`}
                              style={{ width: `${alert.max_probability * 100}%` }}
                            />
                          </div>
                          <span className="readout text-ink">{(alert.max_probability * 100).toFixed(1)}%</span>
                        </div>
                      </td>
                      <td>
                        <StatusBadge status={sev} label={sev === 'error' ? 'High' : 'Medium'} size="sm" animated={false} />
                      </td>
                      <td className="text-xs text-ink-dim">{new Date(alert.created_at).toLocaleString()}</td>
                    </motion.tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon={<AlertTriangle className="h-5 w-5" />}
            title="No alerts yet"
            hint="Run an analysis above or start a replay from Vehicle Monitor."
          />
        )}
      </Panel>
    </PageContainer>
  );
}
