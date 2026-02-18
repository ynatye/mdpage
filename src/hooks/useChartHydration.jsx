import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import ChartBlock from '@/components/ChartBlock';
import { chartRoots, getChartData } from '@/lib/markdown';

/**
 * After HTML content renders into `containerRef`, find all `.mdpage-chart[data-chart]`
 * divs and hydrate them with React <ChartBlock> components.
 *
 * Cleans up (unmounts) old roots before mounting new ones.
 */
export function useChartHydration(containerRef, dependencies = []) {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chartDivs = Array.from(container.querySelectorAll('div.mdpage-chart[data-chart]'));

    // Unmount any existing roots in these divs before re-rendering
    chartDivs.forEach((div) => {
      const existing = chartRoots.get(div);
      if (existing) {
        try { existing.unmount(); } catch (_) {}
        chartRoots.delete(div);
      }
    });

    // Mount fresh ChartBlock roots
    chartDivs.forEach((div) => {
      const csvData = getChartData(div);
      if (!csvData) return;

      try {
        const root = createRoot(div);
        root.render(<ChartBlock csvData={csvData} />);
        chartRoots.set(div, root);
      } catch (err) {
        console.error('Error hydrating chart:', err);
        try {
          const root = createRoot(div);
          root.render(
            <div className="p-4 text-center text-destructive border border-dashed border-destructive/30">
              <div>⚠ Chart rendering error</div>
              <div className="text-sm mt-1">Check console for details</div>
            </div>
          );
          chartRoots.set(div, root);
        } catch (_) {}
      }
    });

    // Cleanup: unmount when the effect re-runs or component unmounts
    return () => {
      chartDivs.forEach((div) => {
        const root = chartRoots.get(div);
        if (root) {
          try { root.unmount(); } catch (_) {}
          chartRoots.delete(div);
        }
      });
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies);
}
