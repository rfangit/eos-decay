// ============================================================================
// WIDGET 1 — assumption ablation overlays
// ============================================================================
// Always shows: true GD and the full master equation.
// Three checkboxes, each labelled by an ASSUMPTION. All ticked by default =
// all assumptions relaxed = closest to true GD. UNticking a box re-imposes that
// assumption, which swaps in the run where that assumption is active.
//
// Editable mapping: which npz file each checkbox controls. Point these at your
// exported runs. `imposedFile` is the run shown when the box is UNticked
// (assumption imposed). When ticked, that curve is hidden (the default master
// already represents "all relaxed").

import { loadNPZ, arr } from './npz.js';
import { OverlayChart, RUN_COLORS } from './charts.js';

// ── CONFIG: relabel / repoint here without touching logic ────────────────────
const ASSUMPTIONS = [
  {
    id: 'rotation',
    label: 'no rotation',
    imposedFile: 'master_no_rotation.npz',
    color: RUN_COLORS.no_rotation,
    imposedLabel: 'no rotation',
  },
  {
    id: 'along_u',
    label: '∇S·u = 0',
    // No isolated "no along-u only" run yet — point at the combined run for now.
    imposedFile: 'master_no_rotation_no_along_u.npz',
    color: RUN_COLORS.no_along_u,
    imposedLabel: '∇S·u = 0',
  },
  {
    id: 'nablaS',
    label: 'H∇S = 0',
    imposedFile: 'master_ignore_dS_perp.npz',
    color: RUN_COLORS.ignore_dS_perp,
    imposedLabel: 'H∇S = 0',
  },
];

const ALWAYS = [
  { file: 'true_gd.npz',        label: 'true GD',          color: RUN_COLORS.true_gd,        width: 2.2, order: -1 },
  { file: 'master_default.npz', label: 'full equations',   color: RUN_COLORS.master_default, width: 1.8, dashed: false },
];

export function initAssumptionsWidget(prefix, { dataDir = 'data', tasks = {} } = {}) {
  const el = id => document.getElementById(`${prefix}-${id}`);
  let runs = {};        // filename -> npz
  let chart = null;
  let observable = 'S';  // 'S' or 'loss_spike'
  const taskKeys = Object.keys(tasks);
  let currentDir = taskKeys.length ? `${dataDir}/${tasks[taskKeys[0]]}` : dataDir;

  async function loadAll() {
    runs = {};
    const files = [...ALWAYS.map(a => a.file), ...ASSUMPTIONS.map(a => a.imposedFile)];
    const unique = [...new Set(files)];
    const status = el('status');
    for (const f of unique) {
      try {
        runs[f] = await loadNPZ(`${currentDir}/${f}`);
      } catch (e) {
        runs[f] = null;
        console.warn(`Widget1: could not load ${f}:`, e.message);
      }
    }
    if (status) {
      const missing = unique.filter(f => !runs[f]);
      status.textContent = missing.length
        ? `Loaded ${unique.length - missing.length}/${unique.length} runs. Missing: ${missing.join(', ')}`
        : `Loaded ${unique.length} runs from ${currentDir}/.`;
      status.style.color = missing.length ? '#c0392b' : '#888';
    }
    redraw();
  }

  function seriesFrom(npz, key) {
    if (!npz) return null;
    const step = arr(npz, 'step');
    if (!step) return null;
    let val;
    if (key === 'absx') {
      const x = arr(npz, 'x');
      if (!x) return null;
      val = x.map(Math.abs);
    } else {
      val = arr(npz, key);
    }
    if (!val) return null;
    return step.map((s, i) => ({ x: s, y: val[i] }));
  }

  function redraw() {
    const datasets = [];

    // Always-on curves.
    for (const a of ALWAYS) {
      const pts = seriesFrom(runs[a.file], observable);
      if (pts) datasets.push({ label: a.label, points: pts, color: a.color, width: a.width, dashed: a.dashed, order: a.order });
    }

    // Each box, when TICKED, shows the curve for removing that assumption.
    // Unticking hides it.
    for (const a of ASSUMPTIONS) {
      const ticked = el(`chk-${a.id}`).checked;   // ticked = show ablation curve
      if (ticked) {
        const pts = seriesFrom(runs[a.imposedFile], observable);
        if (pts) datasets.push({ label: a.imposedLabel, points: pts, color: a.color, width: 1.6, dashed: true });
      }
    }

    chart.setDatasets(datasets);
  }

  function boot() {
    chart = new OverlayChart(`${prefix}-chart`, { yLabel: 'sharpness S', yType: 'linear' });

    for (const a of ASSUMPTIONS) {
      const chk = el(`chk-${a.id}`);
      if (chk) chk.addEventListener('change', redraw);
    }
    const obsSel = el('observable');
    if (obsSel) obsSel.addEventListener('change', () => {
      observable = obsSel.value;
      // Amplitude and loss spike both start at 0 → linear. Sharpness sits near 2/η.
      chart.setYType('linear');
      chart.chart.options.scales.y.title.text =
        observable === 'absx' ? 'oscillation amplitude |x|'
        : observable === 'loss_spike' ? 'loss spike  x²/η'
        : 'sharpness S';
      redraw();
    });

    // Optional: drag-and-drop npz files to preview without a data/ folder.
    const drop = el('dropzone');
    if (drop) wireDrop(drop);

    // Task selector — mirrors Widget 2's tasks.
    const taskSel = el('task');
    if (taskSel && taskKeys.length) {
      taskSel.innerHTML = '';
      for (const k of taskKeys) {
        const opt = document.createElement('option'); opt.value = k; opt.textContent = k; taskSel.appendChild(opt);
      }
      taskSel.addEventListener('change', () => {
        currentDir = `${dataDir}/${tasks[taskSel.value]}`;
        loadAll();
      });
    }

    loadAll();
  }

  async function wireDrop(drop) {
    const { parseNPZBuffer } = await import('./npz.js');
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('drag'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('drag'));
    drop.addEventListener('drop', async e => {
      e.preventDefault(); drop.classList.remove('drag');
      for (const file of e.dataTransfer.files) {
        if (!file.name.endsWith('.npz')) continue;
        try { runs[file.name] = await parseNPZBuffer(await file.arrayBuffer()); }
        catch (err) { console.warn('drop parse failed', file.name, err); }
      }
      el('status').textContent = `Loaded ${Object.keys(runs).filter(k=>runs[k]).length} runs (incl. dropped).`;
      redraw();
    });
  }

  boot();
  return { redraw, runs };
}
