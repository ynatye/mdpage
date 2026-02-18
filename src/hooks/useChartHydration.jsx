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
      try {
        const csvData = getChartData(div);
        if (!csvData) {
          console.warn('Chart div found but no data-chart attribute:', div);
          return;
        }

        const root = createRoot(div);
        root.render(<ChartBlock csvData={csvData} />);
        chartRoots.set(div, root);
      } catch (error) {
        console.error('Error hydrating chart:', error, div);
        // Render error state instead of leaving empty
        try {
          const root = createRoot(div);
          root.render(
            <div className="p-4 text-center text-destructive border border-dashed border-destructive/30 rounded-lg">
              <div>⚠️ Chart rendering error</div>
              <div className="text-sm mt-1">Check console for details</div>
            </div>
          );
          chartRoots.set(div, root);
        } catch (fallbackError) {
          console.error('Failed to render chart error state:', fallbackError);
        }
      }
    });

    // Cleanup function
    return () => {
      chartDivs.forEach(div => {
        try {
          const root = chartRoots.get(div);
          if (root) {
            root.unmount();
            chartRoots.delete(div);
          }
        } catch (error) {
          console.warn('Error cleaning up chart:', error);
          // Still try to remove from WeakMap
          chartRoots.delete(div);
        }
      });
    };
  }, dependencies);
}