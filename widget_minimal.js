// ============================================================================
// WIDGET 2 — the minimal nabla-S model, live
// ============================================================================
// Loads a task's coeff_track.npz (real alpha(t), beta(t)) and true_gd.npz. The
// reader picks a task, clicks the alpha/beta track to freeze coefficients at a
// step, and slides lambda (log scale, weighted to small lambda). A "two
// eigenvalues" tickbox switches to a two-mode reduced model with a second
// lambda and a mode-weight slider. Everything runs live in-browser and overlays
// the real trajectory.
//
// Requires coeff_track.npz for a task (that's where alpha, beta, x0_seed, and
// u_dot_dS live). If a task lacks it, the widget says so rather than breaking.

import { loadNPZ, arr, scalar } from './npz.js';
import { MinimalModel } from './minimal_model.js';
import { OverlayChart, TrackChart, RUN_COLORS } from './charts.js';

// ── Two-eigenvalue defaults (tune these) ─────────────────────────────────────
// When "two eigenvalues" is on, mode 2 gets lambda2 and weight p2; mode 1 takes
// the main lambda slider with weight (1 - p2). Baked defaults you can adjust.
const TWO_MODE_DEFAULTS = {
  lambda2_frac: 0.1,   // lambda2 as a fraction of the main lambda (slow second mode)
  p2: 0.3,             // weight on the second mode (mode 1 gets 1 - p2)
};

export function initMinimalWidget(prefix, { dataDir = 'data', tasks = {} } = {}) {
  const el = id => document.getElementById(`${prefix}-${id}`);
  const model = new MinimalModel();
  const modelRef = new MinimalModel();   // always-on lambda = 0 reference
  let simChart = null, trackChart = null;
  let track = null, trueRun = null;
  let eta = 0.07, selStep = 0, lambda = 0.1, maxLambda = 2 / 0.07;
  let coeffAlpha = null, coeffBeta = null;   // per-step arrays (real or reconstructed)
  let twoMode = false, lambda2Frac = TWO_MODE_DEFAULTS.lambda2_frac, p2 = TWO_MODE_DEFAULTS.p2;
  let plotSteps = Infinity;                  // per-task cap on how many steps to plot

  const taskKeys = Object.keys(tasks);
  let currentTask = taskKeys[0] || null;

  // A task value may be a plain folder string, or { folder, plotSteps } to cap
  // how many steps are simulated/plotted for that task.
  const taskFolder = k => (typeof tasks[k] === 'string' ? tasks[k] : tasks[k].folder);
  const taskCap    = k => (typeof tasks[k] === 'string' ? Infinity : (tasks[k].plotSteps ?? Infinity));

  // ── Log lambda slider, weighted to small lambda ────────────────────────────
  // Slider t in [0,1000] -> lambda in [LMIN, maxLambda] on a log scale, so most
  // of the travel sits at small lambda (near the decay threshold).
  const LMIN = 1e-3;
  function sliderToLambda(v) {
    const t = v / 1000;
    return LMIN * Math.pow(maxLambda / LMIN, t);
  }
  function lambdaToSlider(l) {
    const t = Math.log(Math.max(l, LMIN) / LMIN) / Math.log(maxLambda / LMIN);
    return Math.round(Math.max(0, Math.min(1, t)) * 1000);
  }
  function setLambdaFromReal(l) {
    lambda = Math.max(LMIN, Math.min(maxLambda, l));
    el('lambdaSlider').value = lambdaToSlider(lambda);
  }

  async function loadTask(taskKey) {
    currentTask = taskKey;
    const dir = `${dataDir}/${taskFolder(taskKey)}`;
    plotSteps = taskCap(taskKey);
    const status = el('status');

    // Prefer coeff_track.npz (real per-step alpha, beta, seed, u_dot_dS). If it's
    // absent, reconstruct alpha, beta from true_gd.npz's trajectory: alpha comes
    // from g_eff = h(z) + y^2/alpha, and beta from z = beta x^2/(2 alpha). This
    // lets any task with a true_gd.npz drive Widget 2.
    track = await loadNPZ(`${dir}/coeff_track.npz`).catch(() => null);
    trueRun = await loadNPZ(`${dir}/true_gd.npz`).catch(() => null);

    let alpha, beta, steps, reconstructed = false;
    if (track) {
      eta = scalar(track, 'lr') || 0.07;
      alpha = arr(track, 'alpha'); beta = arr(track, 'beta');
      steps = alpha.map((_, i) => i);
    } else if (trueRun) {
      const rec = reconstructCoeffs(trueRun);
      if (!rec) {
        simChart.setDatasets([]); trackChart.setData([], [], []);
        if (status) { status.textContent = `${taskKey}: true_gd.npz lacks z/y/g_eff — cannot get α, β.`; status.style.color = '#c0392b'; }
        return;
      }
      eta = rec.eta; alpha = rec.alpha; beta = rec.beta; steps = rec.steps;
      track = trueRun;       // seed + step count come from the same file
      reconstructed = true;
    } else {
      simChart.setDatasets([]); trackChart.setData([], [], []);
      if (status) { status.textContent = `${taskKey}: no coeff_track.npz or true_gd.npz in ${dir}/.`; status.style.color = '#c0392b'; }
      return;
    }

    // Apply the per-task plotting cap.
    const cap = Math.min(steps.length, plotSteps);
    if (cap < steps.length) {
      alpha = alpha.slice(0, cap); beta = beta.slice(0, cap); steps = steps.slice(0, cap);
    }

    maxLambda = 2 / eta;
    coeffAlpha = alpha; coeffBeta = beta;   // stash for pickAlpha/pickBeta
    trackChart.setData(steps, alpha, beta);

    selStep = Math.min(steps.length - 1, Math.floor(steps.length * 0.15));
    trackChart.select(selStep);           // triggers onSelect -> resim

    setLambdaFromReal(6 * eta * (alpha[selStep] || 1.0));   // mid-ish default
    if (status) {
      status.textContent = `${taskKey}: η=${eta.toFixed(4)}, ${steps.length} steps, 2/η=${maxLambda.toFixed(1)}.`
        + (reconstructed ? ' (α,β reconstructed from true_gd.npz)' : '');
      status.style.color = '#888';
    }
    updateLambdaReadout();
    resim();
  }

  // Reconstruct per-step alpha, beta from a true_gd.npz trajectory.
  function reconstructCoeffs(run) {
    const z = arr(run, 'z'), y = arr(run, 'y'), x = arr(run, 'x'), ge = arr(run, 'g_eff');
    const lr = scalar(run, 'lr');
    if (!z || !y || !x || !ge || lr == null) return null;
    const h = zz => { const c = Math.max(zz, 1e-12); return c - Math.log(c) - 1; };
    const n = z.length;
    const alpha = new Array(n), beta = new Array(n);
    // Robust central values to fill in noisy/degenerate steps.
    const aVals = [], bVals = [];
    for (let i = 0; i < n; i++) {
      const denom = ge[i] - h(z[i]);
      const a = Math.abs(denom) > 1e-9 ? (y[i] * y[i]) / denom : NaN;
      const b = Math.abs(x[i]) > 1e-8 ? a * (2 * z[i] / (x[i] * x[i])) : NaN;
      alpha[i] = a; beta[i] = b;
      if (isFinite(a) && a > 0) aVals.push(a);
      if (isFinite(b) && b > 0) bVals.push(b);
    }
    const median = xs => { const s = [...xs].sort((p, q) => p - q); return s.length ? s[s.length >> 1] : 1; };
    const aMed = median(aVals), bMed = median(bVals);
    for (let i = 0; i < n; i++) {
      if (!isFinite(alpha[i]) || alpha[i] <= 0) alpha[i] = aMed;
      if (!isFinite(beta[i])  || beta[i]  <= 0) beta[i]  = bMed;
    }
    return { eta: lr, alpha, beta, steps: z.map((_, i) => i) };
  }

  function updateLambdaReadout() {
    el('lambdaValue').textContent = lambda.toFixed(3);
    const thr = 2 * eta * pickAlpha();
    const note = el('lambdaNote');
    if (note) {
      note.textContent = lambda > thr
        ? `λ > 2ηα ≈ ${thr.toFixed(3)} → decay`
        : `λ < 2ηα ≈ ${thr.toFixed(3)} → grows`;
      note.style.color = lambda > thr ? '#27ae60' : '#c0392b';
    }
    const l2 = el('lambda2Value');
    if (l2) l2.textContent = (lambda * lambda2Frac).toFixed(3);
    const p2v = el('p2Value');
    if (p2v) p2v.textContent = p2.toFixed(2);
  }

  function pickAlpha() { return coeffAlpha ? coeffAlpha[selStep] : 1.0; }
  function pickBeta()  { return coeffBeta  ? coeffBeta[selStep]  : 50.0; }
  function pickDSu()   { const v = track && arr(track, 'u_dot_dS'); return v ? v[selStep] : 0.5; }
  function seedX0() {
    // x_0 pulled straight from the data: physical onset seed x0_seed if present
    // and nonzero, else the largest |x| the true run reaches. No invented values.
    const s = track && scalar(track, 'x0_seed');
    if (s !== null && isFinite(s) && s !== 0) return Math.abs(s);
    const xg = (track && arr(track, 'x_gd')) || (trueRun && arr(trueRun, 'x'));
    if (xg) return Math.max(...xg.map(Math.abs));
    return 0.05;
  }

  function currentModes() {
    if (!twoMode) return [{ lambda, p: 1.0 }];
    return [
      { lambda,               p: 1 - p2 },
      { lambda: lambda * lambda2Frac, p: p2 },
    ];
  }

  function resim() {
    if (!track) return;
    const cfgBase = {
      eta, alpha: pickAlpha(), beta: pickBeta(),
      dS_dot_u: pickDSu(),
      x0: seedX0(), y0: 0,
      maxSteps: (coeffAlpha || []).length || 3000,
    };

    // Main model with the chosen lambda(s).
    model.configure({ ...cfgBase, modes: currentModes() });
    model.run();

    // Always-on lambda = 0 reference (no curvature) — shows why lambda matters.
    modelRef.configure({ ...cfgBase, modes: [{ lambda: 0, p: 1.0 }] });
    modelRef.run();

    const observable = el('observable') ? el('observable').value : 'S';
    const pick = (m) => observable === 'absx' ? m.seriesAbsX()
                      : observable === 'loss_spike' ? m.seriesSpike()
                      : m.seriesS();
    const datasets = [];

    // Real trajectory overlay in the same observable (clamped to the plot cap).
    if (trueRun) {
      const stepR = arr(trueRun, 'step');
      let yv;
      if (observable === 'absx')            yv = (arr(trueRun, 'x') || []).map(Math.abs);
      else if (observable === 'loss_spike') yv = arr(trueRun, 'loss_spike');
      else                                  yv = arr(trueRun, 'S');
      if (stepR && yv) {
        const pts = [];
        for (let i = 0; i < stepR.length && stepR[i] < plotSteps; i++) pts.push({ x: stepR[i], y: yv[i] });
        datasets.push({ label: 'true GD', color: RUN_COLORS.true_gd, width: 1.4, points: pts });
      }
    }

    // lambda = 0 reference (grey, dashed) — plotted under the main curve.
    // Clamp its display range to a few times the true-GD span so a blow-up on a
    // stiff task can't squash the axis; the growing trend stays visible.
    let refPts = pick(modelRef);
    if (trueRun) {
      const tvals = (observable === 'absx' ? (arr(trueRun, 'x') || []).map(Math.abs)
                   : observable === 'loss_spike' ? (arr(trueRun, 'loss_spike') || [])
                   : (arr(trueRun, 'S') || [])).filter(isFinite);
      if (tvals.length) {
        const lo = Math.min(...tvals), hi = Math.max(...tvals), span = (hi - lo) || 1;
        const cap = hi + 3 * span, floor = lo - 3 * span;
        refPts = refPts.map(p => ({ x: p.x, y: Math.max(floor, Math.min(cap, p.y)) }));
      }
    }
    datasets.push({ label: 'λ = 0 (no curvature)', color: '#9aa0a6', width: 1.4, dashed: true, points: refPts });

    // The chosen-lambda model.
    const modeLabel = twoMode
      ? `minimal model (λ₁=${lambda.toFixed(3)}, λ₂=${(lambda * lambda2Frac).toFixed(3)})`
      : `minimal model (λ=${lambda.toFixed(3)})`;
    datasets.push({ label: modeLabel, color: RUN_COLORS.minimal, width: 1.8, points: pick(model) });

    simChart.setYType('linear');
    const yTitle = observable === 'absx' ? 'oscillation amplitude |x|'
                 : observable === 'loss_spike' ? 'loss spike  x²/η'
                 : 'sharpness S';
    simChart.chart.options.scales.y.title.text = yTitle;
    simChart.setDatasets(datasets);
  }

  function boot() {
    simChart   = new OverlayChart(`${prefix}-simChart`, { yLabel: 'sharpness S', yType: 'linear' });
    trackChart = new TrackChart(`${prefix}-trackChart`, (step) => {
      selStep = step; el('stepValue').textContent = step; updateLambdaReadout(); resim();
    });

    el('lambdaSlider').addEventListener('input', () => {
      lambda = sliderToLambda(parseFloat(el('lambdaSlider').value));
      updateLambdaReadout(); resim();
    });

    const obs = el('observable');
    if (obs) obs.addEventListener('change', resim);

    // Two-eigenvalue toggle + its controls (shown only when on).
    const twoChk = el('twoMode');
    if (twoChk) twoChk.addEventListener('change', () => {
      twoMode = twoChk.checked;
      const box = el('twoModeControls');
      if (box) box.style.display = twoMode ? 'flex' : 'none';
      updateLambdaReadout(); resim();
    });
    const l2s = el('lambda2Slider');
    if (l2s) l2s.addEventListener('input', () => {
      // lambda2 as a fraction of lambda1, from 0.01x to 1x, log-ish.
      lambda2Frac = Math.max(0.01, Math.min(1, parseFloat(l2s.value) / 100));
      updateLambdaReadout(); resim();
    });
    const p2s = el('p2Slider');
    if (p2s) p2s.addEventListener('input', () => {
      p2 = Math.max(0, Math.min(1, parseFloat(p2s.value) / 100));
      updateLambdaReadout(); resim();
    });

    // Task selector.
    const taskSel = el('task');
    if (taskSel) {
      taskSel.innerHTML = '';
      for (const k of taskKeys) {
        const opt = document.createElement('option'); opt.value = k; opt.textContent = k; taskSel.appendChild(opt);
      }
      taskSel.addEventListener('change', () => loadTask(taskSel.value));
    }

    // Initialise two-mode control defaults in the DOM.
    if (l2s) l2s.value = Math.round(lambda2Frac * 100);
    if (p2s) p2s.value = Math.round(p2 * 100);

    if (currentTask) loadTask(currentTask);
  }

  boot();
  return { resim };
}
