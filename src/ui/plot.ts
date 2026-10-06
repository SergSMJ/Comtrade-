import Plotly from 'plotly.js-dist-min';
import { cssVar } from './dom';

export { Plotly };

export function baseLayout(): Partial<Plotly.Layout> {
  const fg = cssVar('--text') || '#1d2329';
  const grid = cssVar('--grid') || '#e3e7eb';
  return {
    paper_bgcolor: cssVar('--surface') || '#fff',
    plot_bgcolor: cssVar('--surface') || '#fff',
    font: { family: 'Inter, "Segoe UI", system-ui, sans-serif', size: 12, color: fg },
    margin: { l: 70, r: 20, t: 20, b: 40 },
    showlegend: true,
    legend: { orientation: 'h', y: -0.08, x: 0 },
    hoverlabel: { namelength: -1 },
    xaxis: { gridcolor: grid, zerolinecolor: grid },
    yaxis: { gridcolor: grid, zerolinecolor: grid },
  };
}

export const plotConfig: Partial<Plotly.Config> = {
  displaylogo: false,
  responsive: true,
  scrollZoom: true,
  modeBarButtonsToRemove: ['select2d', 'lasso2d'],
  toImageButtonOptions: { format: 'png', scale: 2 },
};

/** Побудова з явною висотою контейнера (інакше responsive-режим стискає графік). */
export function draw(div: HTMLElement, data: Plotly.Data[], layout: Partial<Plotly.Layout>): Promise<Plotly.PlotlyHTMLElement> {
  if (layout.height) div.style.height = `${layout.height}px`;
  return Plotly.react(div, data, layout, plotConfig);
}
