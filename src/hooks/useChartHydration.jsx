import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import ChartBlock from '@/components/ChartBlock';
import { chartRoots, getChartData } from '@/lib/markdown';

export function useChartHydration(containerRef, dependencies = []) {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Clean up existing chart roots
    const chartDivs = container.querySelectorAll('div.mdpage-chart[data-chart]');
    chartDivs.forEach(div => {
      const existingRoot = chartRoots.get(div);
      if (existingRoot) {
        existingRoot.unmount();
        chartRoots.delete(div);
      }
    });

    // Create new chart components
    chartDivs.forEach(div => {
      const csvData = getChartData(div);
      if (!csvData) return;

      const root = createRoot(div);
      root.render(<ChartBlock csvData={csvData} />);
      chartRoots.set(div, root);
    });

    // Cleanup function
    return () => {
      chartDivs.forEach(div => {
        const root = chartRoots.get(div);
        if (root) {
          root.unmount();
          chartRoots.delete(div);
        }
      });
    };
  }, dependencies);
}