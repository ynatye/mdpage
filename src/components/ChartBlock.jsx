import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

// Shadcn-inspired color palette using CSS variables
const CHART_COLORS = [
  'hsl(var(--primary))',
  'hsl(221.2 83.2% 53.3%)', // Blue
  'hsl(142.1 76.2% 36.3%)', // Green  
  'hsl(38.8 92.1% 50.3%)', // Amber
  'hsl(0 84.2% 60.2%)', // Red
  'hsl(262.1 83.3% 57.8%)', // Purple
  'hsl(336.6 80.7% 57.8%)', // Pink
  'hsl(188.4 82.5% 39.2%)', // Cyan
];

function CustomTooltip({ active, payload, label }) {
  if (active && payload && payload.length) {
    return (
      <div className="bg-card text-card-foreground p-3 rounded-lg shadow-md border border-border">
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
  const lines = csvString.trim().split('\n').map(l => l.trim()).filter(l => l);
  if (lines.length < 2) return null;

  const headers = lines[0].split(',').map(h => h.trim());
  const labelCol = headers[0];
  const datasetNames = headers.slice(1);

  const data = [];
  
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(c => c.trim());
    const item = { [labelCol]: cols[0] };
    
    for (let d = 0; d < datasetNames.length; d++) {
      item[datasetNames[d]] = parseFloat(cols[d + 1]) || 0;
    }
    
    data.push(item);
  }

  return { data, datasetNames, labelCol };
}

export default function ChartBlock({ csvData }) {
  const parsed = parseChartData(csvData);
  
  if (!parsed) {
    return (
      <div className="p-4 text-muted-foreground text-center">
        Invalid chart data
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
              radius={[2, 2, 0, 0]}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}