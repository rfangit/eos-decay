// ============================================================================
// MINIMAL MODEL — the damped self-stability map, run live in the browser
// ============================================================================
// Single-mode (one lambda):
//     x_{t+1} = -(1 + eta y_t) x_t
//     y_{t+1} =  (1 - eta lambda) y_t + eta * alpha (1 - z_t),   z = beta x^2/(2 alpha)
//
// Two-mode (two eigenvalues) — a more realistic reduced model. nabla_S spreads
// over two Hessian eigendirections with weights p1, p2 (p1+p2=1) and curvatures
// lambda1, lambda2. Each mode carries its own offset y_i; the total offset
// y = y1 + y2 drives the amplitude, and z uses the total y:
//     d_t   = alpha (1 - z_t),      z_t = beta x_t^2/(2 alpha)
//     y_{i,t+1} = (1 - eta lambda_i) y_{i,t} + eta p_i d_t
//     y_t   = sum_i y_{i,t}
//     x_{t+1} = -(1 + eta y_t) x_t
// Observable sharpness: S = 2/eta + y + (dS.u) x. Loss spike: x^2/eta.

export class MinimalModel {
  constructor() {
    this.reset();
    this.eta = 0.07;
    this.alpha = 1.0;
    this.beta = 50.0;
    this.dS_dot_u = 0.5;
    this.x0 = 0.05;
    this.y0 = 0.0;
    this.maxSteps = 3000;
    // Mode configuration. modes = [{ lambda, p }, ...]; p should sum to 1.
    this.modes = [{ lambda: 0.1, p: 1.0 }];
  }

  reset() {
    this.t = 0;
    this.x = 0;
    this.yModes = [];       // per-mode offsets
    this.history = [];      // [{ t, x, y, z, S, spike }]
  }

  configure({ eta, alpha, beta, dS_dot_u, x0, y0, maxSteps, modes }) {
    if (eta !== undefined)      this.eta = eta;
    if (alpha !== undefined)    this.alpha = alpha;
    if (beta !== undefined)     this.beta = beta;
    if (dS_dot_u !== undefined) this.dS_dot_u = dS_dot_u;
    if (x0 !== undefined)       this.x0 = x0;
    if (y0 !== undefined)       this.y0 = y0;
    if (maxSteps !== undefined) this.maxSteps = maxSteps;
    if (modes !== undefined)    this.modes = modes;
  }

  initialize() {
    this.reset();
    this.x = this.x0;
    // Split the initial total offset y0 across modes by their weight p.
    this.yModes = this.modes.map(m => m.p * this.y0);
    this.record();
  }

  totalY() { return this.yModes.reduce((s, v) => s + v, 0); }

  record() {
    const y = this.totalY();
    const z = this.beta * this.x * this.x / (2 * this.alpha);
    const S = 2 / this.eta + y + this.dS_dot_u * this.x;
    const spike = this.x * this.x / this.eta;
    this.history.push({ t: this.t, x: this.x, y, z, S, spike });
  }

  step() {
    const { eta, alpha, beta } = this;
    const y = this.totalY();
    const z = beta * this.x * this.x / (2 * alpha);
    const d = alpha * (1 - z);
    // Advance each mode's offset, then the shared amplitude with the total y.
    this.yModes = this.modes.map((m, i) =>
      (1 - eta * m.lambda) * this.yModes[i] + eta * m.p * d);
    this.x = -(1 + eta * y) * this.x;
    this.t += 1;
    this.record();
  }

  run() {
    this.initialize();
    for (let k = 0; k < this.maxSteps; k++) {
      this.step();
      if (!isFinite(this.x) || Math.abs(this.x) > 1e6) break;
    }
    return this.history;
  }

  seriesS()     { return this.history.map(h => ({ x: h.t, y: h.S })); }
  seriesSpike() { return this.history.map(h => ({ x: h.t, y: h.spike })); }
  seriesAbsX()  { return this.history.map(h => ({ x: h.t, y: Math.abs(h.x) })); }
  seriesEnv()   { return this.history.map(h => ({ x: h.t, y: 2 / this.eta + h.y })); }
}
