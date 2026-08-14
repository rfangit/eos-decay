#!/usr/bin/env python3
"""
Optional: convert runs/<TASK_TAG>/*.npz into JSON for the website.

You do NOT need this — the site reads .npz directly in the browser. This is only
here in case you ever prefer JSON (e.g. to hand-inspect, diff, or trim arrays).

Usage:
    python convert_runs.py runs/cheb3-20_w50_lr0.07 data/cheb
    python convert_runs.py runs/cheb3-20_w50_lr0.07 data --flat   # for Widget 1

Writes one .json per .npz with the same basename. Arrays become plain lists;
scalars become numbers; 2-D arrays become lists of lists.
"""
import sys
import os
import json
import numpy as np


def npz_to_dict(path):
    z = np.load(path, allow_pickle=True)
    out = {}
    for k in z.files:
        v = z[k]
        if v.ndim == 0:
            out[k] = v.item()
        else:
            out[k] = v.tolist()
    return out


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    flat = "--flat" in sys.argv
    if len(args) != 2:
        print(__doc__)
        sys.exit(1)
    src, dst = args
    os.makedirs(dst, exist_ok=True)

    npzs = [f for f in os.listdir(src) if f.endswith(".npz")]
    if flat:
        # Widget 1 wants the master_*/true_gd files at the top level of dst.
        keep = {"true_gd.npz"} | {f for f in npzs if f.startswith("master_")}
        npzs = [f for f in npzs if f in keep]

    for f in sorted(npzs):
        d = npz_to_dict(os.path.join(src, f))
        out_path = os.path.join(dst, f[:-4] + ".json")
        with open(out_path, "w") as fh:
            json.dump(d, fh)
        print(f"wrote {out_path}  ({len(d)} keys)")


if __name__ == "__main__":
    main()
