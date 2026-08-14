# Why EOS Oscillations Decay — the ∇S website

A small static site presenting the finding that curvature along the sharpness
gradient $\nabla S$ is what drives edge-of-stability oscillation decay. Two
interactive widgets read your real `runs/` data directly (no conversion step —
the page parses `.npz` in the browser).

## Running

Static files + ES modules, so serve over HTTP (not `file://`):

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

Chart.js and MathJax load from CDNs, so the machine needs internet the first
time. (If you need a fully offline build, drop `chart.umd.js` next to the page
and point the `<script>` at it.)

## Files

| File                     | Role |
|--------------------------|------|
| `index.html`             | Page text, equations, both widgets' markup, boot calls. |
| `styles.css`             | Layout. |
| `npz.js`                 | Zero-dependency `.npz`/`.npy` reader (handles `np.savez` STORED and `savez_compressed` DEFLATE). |
| `charts.js`              | Chart.js wrappers: `OverlayChart`, `TrackChart`. |
| `widget_assumptions.js`  | **Widget 1** — assumption-ablation overlays. |
| `minimal_model.js`       | The live damped-map integrator. |
| `widget_minimal.js`      | **Widget 2** — minimal-model simulation. |
| `convert_runs.py`        | *Optional* npz→JSON converter (only if you ever want JSON instead of npz). |

## Data layout

Everything lives under `data/`. The files follow `RUNS_FORMAT.md` exactly.

```
data/
  true_gd.npz                       # Widget 1: always-on true-GD curve
  master_default.npz                # Widget 1: full master eq (all relaxed)
  master_no_rotation.npz            # Widget 1: shown when "rotation" imposed
  master_no_rotation_no_along_u.npz # Widget 1: shown when "along-u" imposed
  master_ignore_dS_perp.npz         # Widget 1: shown when "∇S null space" imposed
  cheb/
    coeff_track.npz                 # Widget 2 (Chebyshev): α,β,x0_seed,...
    true_gd.npz                     # Widget 2 (Chebyshev): overlay + seed fallback
  cifar/
    coeff_track.npz                 # Widget 2 (CIFAR)
    true_gd.npz
```

Just copy the relevant files out of your `runs/<TASK_TAG>/` into these paths.

## Widget 1 — checkbox → run mapping

All three boxes ticked = all assumptions relaxed = closest to true GD.
**Unticking a box re-imposes that assumption** and overlays the run where it is
active. Always visible: `true_gd` and `master_default`.

The mapping is a single config array at the top of `widget_assumptions.js`
(`ASSUMPTIONS`). Repoint `imposedFile` or relabel without touching logic:

| Checkbox (untick = impose)        | `imposedFile`                       |
|-----------------------------------|-------------------------------------|
| Eigenvectors rotate               | `master_no_rotation.npz`            |
| Keep along-$u$ term               | `master_no_rotation_no_along_u.npz` (placeholder until an isolated no-along-u run exists) |
| $\nabla S$ has curvature          | `master_ignore_dS_perp.npz`         |

You can also **drag `.npz` files onto the Widget 1 plot** to preview them
without editing `data/`.

## Widget 2 — task → folder mapping

Set in the `initMinimalWidget` call at the bottom of `index.html`:

```js
tasks: { 'Chebyshev': 'cheb', 'CIFAR-10': 'cifar' }
```

Each value is a subfolder of `data/` containing `coeff_track.npz` (+ optional
`true_gd.npz` for the overlay). Add a task by adding a folder and an entry here.

The widget reads `lr`, `alpha`, `beta`, `u_dot_dS`, `x0_seed`, `x_gd` from
`coeff_track.npz`. Clicking the α,β track freezes those coefficients at the
chosen step; the oscillation is always seeded from `x0_seed` and run from step 0.
$\lambda$ ranges over $[0, 2/\eta]$; the live note flags the $\lambda>2\eta\alpha$
decay threshold.

## Editing the text

All prose and equations are inline in `index.html` (MathJax `$...$` / `$$...$$`).
"# eos-decay" 
