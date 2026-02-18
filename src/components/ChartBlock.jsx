import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

// Sky blue color palette for charts
const CHART_COLORS = [
  'hsl(199 89% 48%)', // Primary sky blue
  'hsl(199 89% 42%)', // Darker sky blue
  'hsl(199 89% 54%)', // Lighter sky blue
  'hsl(199 89% 36%)', // Much darker
  'hsl(199 89% 60%)', // Much lighter
  'hsl(199 89% 30%)', // Very dark
  'hsl(199 89% 66%)', // Very light
  'hsl(199 89% 24%)', // Darkest
];

function CustomTooltip({ active, payload, label }) {
  if (active && payload && payload.length) {
    return (
      <div className="bg-card text-card-foreground p-3 shadow-md border border-border">
        <p className="font-medium mb-1">{label}</p>
        {payload.map((entry, index) => (
          <p key={index} className="text-sm" style={{ color: entry.color }}>
            {entry.dataKey}: {entry.value}
          </p>
        ))}
      </div>
    );
  }
  return null;
}

function parseChartData(csvString) {
  try {
    const lines = csvString.trim().split('\n').map(l => l.trim()).filter(l => l);
    if (lines.length < 2) {
      console.warn('Chart data must have at least 2 lines (header + data)');
      return null;
    }

    const headers = lines[0].split(',').map(h => h.trim());
    if (headers.length < 2) {
      console.warn('Chart data must have at least 2 columns');
      return null;
    }

    const labelCol = headers[0];
    const datasetNames = headers.slice(1);

    const data = [];
    
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map(c => c.trim());
      
      // Skip empty rows
      if (cols.every(col => col === '')) continue;
      
      const item = { [labelCol]: cols[0] || `Row ${i}` };
      
      for (let d = 0; d < datasetNames.length; d++) {
        const value = cols[d + 1];
        // Handle various number formats and fallback to 0
        const numValue = value ? parseFloat(value.replace(/[,$%]/g, '')) : 0;
        item[datasetNames[d]] = isNaN(numValue) ? 0 : numValue;
      }
      
      data.push(item);
    }

    if (data.length === 0) {
      console.warn('No valid data rows found in chart');
      return null;
    }

    return { data, datasetNames, labelCol };
  } catch (error) {
    console.error('Error parsing chart data:', error);
    return null;
  }
}

export default function ChartBlock({ csvData }) {
  if (!csvData || typeof csvData !== 'string') {
    return (
      <div className="p-4 text-muted-foreground text-center border border-dashed border-muted-foreground/30">
        <div className="text-destructive">⚠️ No chart data provided</div>
        <div className="text-sm mt-1">Expected CSV format with headers</div>
      </div>
    );
  }

  const parsed = parseChartData(csvData);
  
  if (!parsed) {
    return (
      <div className="p-4 text-muted-foreground text-center border border-dashed border-destructive/30">
        <div className="text-destructive">⚠️ Invalid chart data</div>
        <div className="text-sm mt-1">Please check your CSV format: headers on first line, data rows below</div>
        <details className="mt-2 text-xs text-left">
          <summary className="cursor-pointer">Raw data</summary>
          <pre className="mt-1 p-2 bg-muted rounded text-xs overflow-auto">{csvData}</pre>
        </details>
      </div>
    );
  }

  const { data, datasetNames, labelCol } = parsed;

  return (
    <div className="w-full h-80">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          margin={{
            top: 20,
            right: 30,
            left: 20,
            bottom: 20,
          }}
        >
          <CartesianGrid 
            strokeDasharray="3 3" 
            className="opacity-30" 
            stroke="hsl(var(--muted-foreground))"
          />
          <XAxis 
            dataKey={labelCol}
            tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
            axisLine={{ stroke: 'hsl(var(--border))' }}
            tickLine={{ stroke: 'hsl(var(--border))' }}
          />
          <YAxis 
            tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
            axisLine={{ stroke: 'hsl(var(--border))' }}
            tickLine={{ stroke: 'hsl(var(--border))' }}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend 
            wrapperStyle={{
              fontSize: '13px',
              color: 'hsl(var(--muted-foreground))'
            }}
          />
          {datasetNames.map((name, index) => (
            <Bar 
              key={name}
              dataKey={name} 
              fill={CHART_COLORS[index % CHART_COLORS.length]}
              radius={[0, 0, 0, 0]}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}