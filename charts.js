// ============================================================================
// CHARTS — thin Chart.js wrappers for the two nabla-S widgets
// ============================================================================
// Chart.js is loaded globally from the CDN (see index.html).

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

// A small, distinguishable palette for overlaid runs.
export const RUN_COLORS = {
  true_gd:                 '#111111',
  master_default:          '#c0392b',
  no_rotation:             '#2980b9',
  no_along_u:              '#27ae60',
  ignore_dS_perp:          '#8e44ad',
  minimal:                 '#e67e22',
};

// ── Multi-line overlay chart (Widget 1: sharpness / loss-spike overlays) ──────
export class OverlayChart {
  constructor(canvasId, { yLabel = '', yType = 'linear' } = {}) {
    const ctx = document.getElementById(canvasId).getContext('2d');
    this.chart = new Chart(ctx, {
      type: 'line',
      data: { datasets: [] },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        parsing: false, normalized: true,
        interaction: { mode: 'nearest', axis: 'x', intersect: false },
        scales: {
          x: { type: 'linear', title: { display: true, text: 'step', font: { family: FONT } } },
          y: { type: yType, title: { display: !!yLabel, text: yLabel, font: { family: FONT } } },
        },
        plugins: {
          legend: { display: true, position: 'top', labels: { font: { family: FONT, size: 12 }, usePointStyle: true, boxHeight: 6 } },
          tooltip: { enabled: true },
        },
        elements: { point: { radius: 0 } },
      },
    });
  }

  /** datasets: [{ key, label, points:[{x,y}], color, dashed, width }] */
  setDatasets(datasets) {
    this.chart.data.datasets = datasets.map(d => ({
      label: d.label,
      data: d.points,
      borderColor: d.color,
      backgroundColor: d.color,
      borderWidth: d.width ?? 1.6,
      borderDash: d.dashed ? [5, 4] : [],
      pointRadius: 0,
      tension: 0,
      order: d.order ?? 0,
    }));
    this.chart.update('none');
  }

  setYType(type) { this.chart.options.scales.y.type = type; this.chart.update('none'); }
  clear() { this.chart.data.datasets = []; this.chart.update('none'); }
}

// ── Coefficient-track chart with a draggable vertical selector (Widget 2) ─────
// Plots alpha(t) and beta(t) on twin axes and lets the user click to drop a
// vertical line, returning the selected step.
export class TrackChart {
  constructor(canvasId, onSelect) {
    const ctx = document.getElementById(canvasId).getContext('2d');
    this.onSelect = onSelect;
    this.selStep = 0;

    // Vertical-line plugin drawn at the selected step.
    const selPlugin = {
      id: 'selLine',
      afterDraw: (chart) => {
        const x = chart.scales.x.getPixelForValue(this.selStep);
        const { top, bottom } = chart.chartArea;
        const c = chart.ctx;
        c.save();
        c.strokeStyle = '#e67e22'; c.lineWidth = 2; c.setLineDash([4, 3]);
        c.beginPath(); c.moveTo(x, top); c.lineTo(x, bottom); c.stroke();
        c.restore();
      },
    };

    this.chart = new Chart(ctx, {
      type: 'line',
      data: { datasets: [
        { label: 'α (sharpening)', data: [], borderColor: '#2980b9', backgroundColor: '#2980b9',
          borderWidth: 1.6, pointRadius: 0, yAxisID: 'yA', tension: 0 },
        { label: 'β = ‖∇S⊥‖²',   data: [], borderColor: '#c0392b', backgroundColor: '#c0392b',
          borderWidth: 1.6, pointRadius: 0, yAxisID: 'yB', tension: 0 },
      ]},
      options: {
        responsive: true, maintainAspectRatio: false, animation: false, parsing: false,
        scales: {
          x:  { type: 'linear', title: { display: true, text: 'step', font: { family: FONT } } },
          yA: { type: 'linear', position: 'left',  title: { display: true, text: 'α', color: '#2980b9', font: { family: FONT } } },
          yB: { type: 'linear', position: 'right', title: { display: true, text: 'β', color: '#c0392b', font: { family: FONT } },
                grid: { drawOnChartArea: false } },
        },
        plugins: { legend: { display: true, position: 'top', labels: { font: { family: FONT, size: 12 }, usePointStyle: true, boxHeight: 6 } } },
        onClick: (evt) => {
          const xScale = this.chart.scales.x;
          const val = xScale.getValueForPixel(evt.x ?? evt.native.offsetX);
          this.select(Math.round(val));
        },
      },
      plugins: [selPlugin],
    });
  }

  setData(steps, alpha, beta) {
    this.chart.data.datasets[0].data = steps.map((s, i) => ({ x: s, y: alpha[i] }));
    this.chart.data.datasets[1].data = steps.map((s, i) => ({ x: s, y: beta[i] }));
    this.chart.update('none');
  }

  select(step) {
    const data = this.chart.data.datasets[0].data;
    if (!data.length) return;
    const lo = data[0].x, hi = data[data.length - 1].x;
    this.selStep = Math.max(lo, Math.min(hi, step));
    this.chart.update('none');
    if (this.onSelect) this.onSelect(this.selStep);
  }
}
