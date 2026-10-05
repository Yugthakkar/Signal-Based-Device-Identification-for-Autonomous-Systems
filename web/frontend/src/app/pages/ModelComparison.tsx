import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { PageContainer } from '../components/PageContainer';
import { PageHeader } from '../components/PageHeader';
import { Panel, EmptyState } from '../components/Panel';
import { StatusBadge } from '../components/StatusBadge';
import { AnimatedNumber } from '../components/AnimatedNumber';
import { BarChart3, Crown } from 'lucide-react';
import { fetchCanModelInfo, type CanModelInfo } from '../../lib/api';
import { axisProps, chartColors, gridProps, tooltipProps } from '../components/chartTheme';

function pct(value: number | undefined): string {
  return value === undefined ? '--' : `${(value * 100).toFixed(2)}%`;
}

/** random_forest → "Random Forest", residual_mlp → "Residual MLP" */
function modelName(raw: string): string {
  return raw
    .split('_')
    .map((w) => (['mlp', 'svm', 'lstm', 'cnn'].includes(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

const metricKeys = [
  { key: 'precision', label: 'Precision', color: chartColors.signal },
  { key: 'recall', label: 'Recall', color: chartColors.info },
  { key: 'f1', label: 'F1', color: chartColors.ok },
  { key: 'pr_auc', label: 'PR-AUC', color: chartColors.orange },
] as const;

function ConfusionMatrix({ matrix }: { matrix: number[][] }) {
  const max = Math.max(...matrix.flat(), 1);
  const cells = [
    { r: 0, c: 0, label: 'TN', good: true },
    { r: 0, c: 1, label: 'FP', good: false },
    { r: 1, c: 0, label: 'FN', good: false },
    { r: 1, c: 1, label: 'TP', good: true },
  ];

  return (
    <div className="grid grid-cols-[auto_1fr_1fr] gap-2 text-sm">
      <span />
      <span className="label-mono pb-1 text-center">Pred. normal</span>
      <span className="label-mono pb-1 text-center">Pred. suspicious</span>
      {[0, 1].map((r) => (
        <div key={r} className="contents">
          <span className="label-mono flex items-center pr-2">{r === 0 ? 'Actual normal' : 'Actual suspicious'}</span>
          {cells
            .filter((cell) => cell.r === r)
            .map((cell, i) => {
              const value = matrix[cell.r][cell.c];
              // log intensity so a handful of errors is still visible next to 20k hits
              const intensity = Math.log10(1 + value) / Math.log10(1 + max);
              const color = cell.good ? 'var(--signal)' : 'var(--danger)';
              return (
                <motion.div
                  key={cell.label}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.2 + (r * 2 + i) * 0.08, ease: [0.16, 1, 0.3, 1] }}
                  whileHover={{ scale: 1.03 }}
                  className="relative flex aspect-[5/3] flex-col items-center justify-center rounded-lg border"
                  style={{
                    background: `color-mix(in oklab, ${color} ${Math.round(6 + intensity * 26)}%, var(--surface-2))`,
                    borderColor: `color-mix(in oklab, ${color} ${Math.round(15 + intensity * 35)}%, transparent)`,
                  }}
                >
                  <span className="absolute left-2 top-1.5 font-mono text-[0.625rem] text-ink-dim">{cell.label}</span>
                  <span className="readout text-2xl font-semibold text-ink">
                    <AnimatedNumber value={value} />
                  </span>
                </motion.div>
              );
            })}
        </div>
      ))}
    </div>
  );
}

export default function ModelComparison() {
  const [info, setInfo] = useState<CanModelInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchCanModelInfo()
      .then(setInfo)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  const report = info?.training_report;
  const validationModels = report ? Object.entries(report.validation) : [];

  const chartData = useMemo(
    () =>
      validationModels.map(([name, m]) => ({
        name: modelName(name),
        precision: m.precision * 100,
        recall: m.recall * 100,
        f1: m.f1 * 100,
        pr_auc: m.pr_auc * 100,
        errors: m.confusion_matrix[0][1] + m.confusion_matrix[1][0],
        chosen: name === report?.chosen_model,
      })),
    [validationModels, report?.chosen_model]
  );

  // Metrics cluster near 100%, so zoom the axis to where the differences live.
  const minMetric = chartData.length
    ? Math.min(...chartData.flatMap((d) => [d.precision, d.recall, d.f1, d.pr_auc]))
    : 0;
  const yFloor = Math.max(0, Math.floor(minMetric - 0.5));

  const totalRows = report ? report.rows.train + report.rows.validation + report.rows.test : 0;

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Module 02 · Evaluation"
        title="Model Comparison"
        description="Saved evaluation results for the CAN binary intrusion detector — timing-only features, per-capture chronological split."
        trace="sine"
        actions={<StatusBadge status={info?.model_loaded ? 'success' : 'warning'} label={info?.model_loaded ? 'Model loaded' : 'Unavailable'} />}
      />

      {error && <p className="mb-4 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}

      {/* Deployed model spec strip */}
      <Panel className="mb-6" delay={0.05} padded={false} brackets>
        <div className="grid grid-cols-2 divide-line md:grid-cols-4 md:divide-x">
          {[
            { label: 'Schema', value: info?.schema ?? '--' },
            { label: 'Selected model', value: info?.selected_model ? modelName(info.selected_model) : '--' },
            { label: 'Decision threshold', value: info?.threshold?.toFixed(4) ?? '--' },
            { label: 'Feature count', value: String(info?.feature_columns?.length ?? '--') },
          ].map((item, i) => (
            <motion.div
              key={item.label}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 + i * 0.05 }}
              className="p-5"
            >
              <p className="label-mono mb-1.5">{item.label}</p>
              <p className="readout truncate text-lg font-semibold text-ink">{item.value}</p>
            </motion.div>
          ))}
        </div>
      </Panel>

      {report ? (
        <>
          <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-5">
            {/* Metric chart */}
            <Panel
              eyebrow={`Validation · y-axis from ${yFloor}%`}
              title="Candidate models"
              className="lg:col-span-3"
              delay={0.1}
              actions={
                <div className="hidden flex-wrap items-center gap-3 text-xs sm:flex">
                  {metricKeys.map((m) => (
                    <span key={m.key} className="flex items-center gap-1.5 text-ink-muted">
                      <span className="h-2 w-2 rounded-sm" style={{ background: m.color }} /> {m.label}
                    </span>
                  ))}
                </div>
              }
            >
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={chartData} margin={{ top: 8, right: 4, left: -8, bottom: 0 }} barCategoryGap="22%" barGap={3}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="name" {...axisProps} />
                  <YAxis domain={[yFloor, 100]} {...axisProps} tickFormatter={(v: number) => `${v.toFixed(1)}`} allowDataOverflow />
                  <Tooltip
                    {...tooltipProps}
                    cursor={{ fill: 'rgba(255,255,255,0.03)' }}
                    formatter={(v: number, name: string) => [`${v.toFixed(3)}%`, metricKeys.find((m) => m.key === name)?.label ?? name]}
                  />
                  {metricKeys.map((m, i) => (
                    <Bar key={m.key} dataKey={m.key} fill={m.color} radius={[3, 3, 0, 0]} animationDuration={900} animationBegin={i * 120}>
                      {chartData.map((d) => (
                        <Cell key={d.name} fillOpacity={d.chosen ? 1 : 0.45} />
                      ))}
                    </Bar>
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </Panel>

            {/* Errors per model */}
            <Panel eyebrow="FP + FN on validation" title="Misclassifications" className="lg:col-span-2" delay={0.15}>
              <div className="space-y-4">
                {chartData.map((d, i) => {
                  const maxErr = Math.max(...chartData.map((x) => x.errors), 1);
                  return (
                    <div key={d.name}>
                      <div className="mb-1.5 flex items-center justify-between text-sm">
                        <span className={`flex items-center gap-1.5 ${d.chosen ? 'text-ink' : 'text-ink-muted'}`}>
                          {d.chosen && <Crown className="h-3.5 w-3.5 text-signal" />}
                          {d.name}
                        </span>
                        <span className="readout text-ink">{d.errors}</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-surface-3">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${(d.errors / maxErr) * 100}%` }}
                          transition={{ duration: 0.9, delay: 0.3 + i * 0.1, ease: [0.16, 1, 0.3, 1] }}
                          className={`h-full rounded-full ${d.chosen ? 'bg-signal' : 'bg-ink-dim'}`}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="mt-5 text-xs text-ink-dim">Lower is better. All candidates score above 99% on F1, so raw error counts separate them more clearly.</p>
            </Panel>
          </div>

          {/* Validation table */}
          <Panel
            eyebrow="Validation split"
            title="Detailed comparison"
            className="mb-6"
            delay={0.2}
            padded={false}
            actions={
              <span className="rounded border border-signal/30 bg-signal/10 px-2 py-0.5 font-mono text-[0.6875rem] text-signal">
                chosen: {modelName(report.chosen_model)}
              </span>
            }
          >
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Model</th>
                    <th>Precision</th>
                    <th>Recall</th>
                    <th>F1</th>
                    <th>PR-AUC</th>
                    <th>Threshold</th>
                  </tr>
                </thead>
                <tbody>
                  {validationModels.map(([name, metrics]) => {
                    const chosen = name === report.chosen_model;
                    return (
                      <tr key={name} className={chosen ? 'bg-signal/[0.04]' : ''}>
                        <td className="font-medium text-ink">
                          <span className="flex items-center gap-2">
                            {chosen && <span className="h-1.5 w-1.5 rounded-full bg-signal" />}
                            {modelName(name)}
                            {chosen && <span className="font-mono text-[0.625rem] uppercase tracking-wider text-signal">deployed</span>}
                          </span>
                        </td>
                        <td className="readout">{pct(metrics.precision)}</td>
                        <td className="readout">{pct(metrics.recall)}</td>
                        <td className="readout">{pct(metrics.f1)}</td>
                        <td className="readout">{pct(metrics.pr_auc)}</td>
                        <td className="readout text-xs text-ink-dim">{metrics.threshold.toFixed(4)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Test performance */}
            <Panel eyebrow="Held-out test" title="Test performance" delay={0.25}>
              <div className="mb-5 grid grid-cols-2 gap-3">
                {metricKeys.map((m) => {
                  const v = report.test[m.key];
                  return (
                    <div key={m.key} className="rounded-lg border border-line bg-surface-2 p-3.5">
                      <div className="mb-2 flex items-center gap-2">
                        <span className="h-2 w-2 rounded-sm" style={{ background: m.color }} />
                        <span className="label-mono">{m.label}</span>
                      </div>
                      <p className="readout text-xl font-semibold text-ink">
                        <AnimatedNumber value={v * 100} decimals={2} suffix="%" />
                      </p>
                    </div>
                  );
                })}
              </div>

              {/* Dataset split */}
              <p className="label-mono mb-2">Dataset split · {totalRows.toLocaleString()} windows</p>
              <div className="mb-2 flex h-2 overflow-hidden rounded-full">
                {(['train', 'validation', 'test'] as const).map((split, i) => (
                  <motion.div
                    key={split}
                    initial={{ width: 0 }}
                    animate={{ width: `${(report.rows[split] / totalRows) * 100}%` }}
                    transition={{ duration: 0.9, delay: 0.3 + i * 0.1, ease: [0.16, 1, 0.3, 1] }}
                    className={['bg-signal', 'bg-info', 'bg-orange'][i]}
                  />
                ))}
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs">
                {(['train', 'validation', 'test'] as const).map((split, i) => (
                  <div key={split}>
                    <p className="flex items-center gap-1.5 capitalize text-ink-muted">
                      <span className={`h-1.5 w-1.5 rounded-full ${['bg-signal', 'bg-info', 'bg-orange'][i]}`} />
                      {split}
                    </p>
                    <p className="readout text-ink">{report.rows[split].toLocaleString()}</p>
                    <p className="text-ink-dim">{report.positive_windows[split].toLocaleString()} suspicious</p>
                  </div>
                ))}
              </div>
              <p className="mt-4 text-xs text-ink-dim">
                Chronological per-capture split (60/20/20). Test performance measures within-recording generalization, not new vehicles.
              </p>
            </Panel>

            {/* Confusion matrix */}
            <Panel eyebrow="Held-out test" title="Confusion matrix" delay={0.3} brackets>
              <ConfusionMatrix matrix={report.test.confusion_matrix} />
              <p className="mt-4 text-xs text-ink-dim">
                Cell shading is log-scaled so rare errors stay visible next to thousands of correct windows.
              </p>
            </Panel>
          </div>
        </>
      ) : (
        !error && (
          <Panel>
            <EmptyState
              icon={<BarChart3 className="h-5 w-5" />}
              title="No saved training report found"
              hint="Train the CAN model to populate this comparison."
            />
          </Panel>
        )
      )}
    </PageContainer>
  );
}
