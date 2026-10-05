// Shared Recharts styling so every graph reads as one instrument panel.
export const chartColors = {
  signal: '#F2B84B', // amber — primary series
  info: '#5C8DB8', // steel blue — secondary series
  orange: '#E88A3A',
  ok: '#55B879',
  warn: '#F2B84B',
  danger: '#E05252',
  grid: '#22282E',
  axis: '#2A3036',
  tick: '#626A73',
  ink: '#E8EAED',
};

export const axisProps = {
  tick: { fontSize: 11, fill: chartColors.tick, fontFamily: 'JetBrains Mono, monospace' },
  stroke: chartColors.axis,
  tickLine: false,
  axisLine: { stroke: chartColors.axis },
};

export const gridProps = {
  stroke: chartColors.grid,
  strokeDasharray: '2 4',
  vertical: false,
};

export const tooltipProps = {
  contentStyle: {
    backgroundColor: '#1D2227',
    border: '1px solid #2A3036',
    borderRadius: 8,
    fontSize: 12,
    fontFamily: 'JetBrains Mono, monospace',
    color: chartColors.ink,
    boxShadow: '0 12px 32px rgb(0 0 0 / 0.45)',
  },
  labelStyle: { color: '#929AA3', marginBottom: 4 },
  itemStyle: { color: chartColors.ink },
  cursor: { stroke: '#2A3036', strokeWidth: 1 },
};
