import React from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

// Sky-blue shades for chart series
const CHART_COLORS = [
  'hsl(199 89% 48%)',
  'hsl(199 89% 38%)',
  'hsl(199 89% 58%)',
  'hsl(199 89% 30%)',
  'hsl(199 89% 66%)',
  'hsl(199 89% 22%)',
  'hsl(199 89% 74%)',
  'hsl(199 89% 16%)',
];

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div
      className="bg-card text-card-foreground p-3 border border-border shadow"
      style={{ fontFamily: 'Geist Mono, monospace', fontSize: 13 }}
    >
      <p className="font-semibold mb-1">{label}</p>
      {payload.map((entry) => (
        <p key={entry.dataKey} className="text-sm" style={{ color: entry.fill }}>
          {entry.dataKey}: {entry.value}
        </p>
      ))}
    </div>
  );
}

function parseChartData(csvString) {
  const lines = csvString.trim().split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return null;

  const headers = lines[0].split(',').map((h) => h.trim());
  if (headers.length < 2) return null;

  const [labelCol, ...datasetNames] = headers;
  const data = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map((c) => c.trim());
    if (cols.every((c) => c === '')) continue;

    const item = { [labelCol]: cols[0] || `Row ${i}` };
    datasetNames.forEach((name, d) => {
      const raw = cols[d + 1] ?? '';
      const num = parseFloat(raw.replace(/[,$%]/g, ''));
      item[name] = isNaN(num) ? 0 : num;
    });
    data.push(item);
  }

  return data.length ? { data, datasetNames, labelCol } : null;
}

function ChartError({ title, children }) {
  return (
    <div className="p-4 text-muted-foreground text-center border border-dashed border-destructive/40">
      <div className="text-destructive font-medium">⚠ {title}</div>
      {children}
    </div>
  );
}

export default function ChartBlock({ csvData }) {
  if (!csvData || typeof csvData !== 'string') {
    return <ChartError title="No chart data provided">Expected CSV with headers on line 1</ChartError>;
  }

  let parsed;
  try {
    parsed = parseChartData(csvData);
  } catch (err) {
    console.error('Chart parse error:', err);
    parsed = null;
  }

  if (!parsed) {
    return (
      <ChartError title="Invalid chart data">
        <div className="text-sm mt-1">
          Format: <code>Label,Series1,Series2</code> on line 1, data rows below
        </div>
        <details className="mt-3 text-xs text-left">
          <summary className="cursor-pointer select-none">Show raw data</summary>
          <pre
            className="mt-2 p-2 bg-muted text-xs overflow-auto"
            style={{ fontFamily: 'Geist Mono, monospace' }}
          >
            {csvData}
          </pre>
        </details>
      </ChartError>
    );
  }

  const { data, datasetNames, labelCol } = parsed;
  const axisFill = 'hsl(var(--muted-foreground))';
  const axisStroke = 'hsl(var(--border))';

  return (
    <div className="w-full h-80">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={axisFill} opacity={0.2} />
          <XAxis
            dataKey={labelCol}
            tick={{ fontSize: 12, fill: axisFill, fontFamily: 'Geist Mono, monospace' }}
            axisLine={{ stroke: axisStroke }}
            tickLine={{ stroke: axisStroke }}
          />
          <YAxis
            tick={{ fontSize: 12, fill: axisFill, fontFamily: 'Geist Mono, monospace' }}
            axisLine={{ stroke: axisStroke }}
            tickLine={{ stroke: axisStroke }}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend
            wrapperStyle={{ fontSize: 13, color: axisFill, fontFamily: 'Geist Mono, monospace' }}
          />
          {datasetNames.map((name, i) => (
            <Bar
              key={name}
              dataKey={name}
              fill={CHART_COLORS[i % CHART_COLORS.length]}
              radius={[0, 0, 0, 0]}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
