"""unlocksim.py PERPASS.json [...] (tools/pcprof.mjs's PERPASS= output)

The game unlocked from 25 Hz: each measured pass's logic and render replayed (one CPU, vsync every
39,936 cycles) with the flip at the first vsync after the render ends and at least MIN fields after
the last flip. Logic k+1 runs as soon as render k ends (decision 26); render k+1 waits only for flip
k, since until then the hidden screen is the one about to be shown. As pipesim.py, but MIN varies."""
import json, sys, collections
F = 39936
def vs(t): return -(-t // F) * F
for path in sys.argv[1:]:
    d = json.load(open(path))
    L = [x['work'] - x['render'] for x in d]
    R = [x['render'] for x in d]
    n = len(d)
    print(f"== {path}: {n} passes; work a pass mean {sum(L) / n + sum(R) / n:,.0f} (logic {sum(L) / n:,.0f}, render {sum(R) / n:,.0f})")
    for mn in (2, 1):
        t = 0; flip = 0; flips = []; busy = 0
        for k in range(n):
            t += L[k]
            t = max(t, flip)
            t += R[k]
            flip = vs(max(t, flip + mn * F)) if k else vs(t)
            flips.append(flip)
        gaps = [(flips[i] - flips[i - 1]) // F for i in range(1, n)]
        secs = (flips[-1] - flips[0]) / 2_000_000
        hist = dict(sorted(collections.Counter(gaps).items()))
        print(f"  flip at least {mn} field{'s' if mn > 1 else ' '} apart: {(n - 1) / secs:5.2f} frames (passes) a second; fields a frame {hist}")
    work = [L[k] + R[k] for k in range(n)]
    print(f"  no vsync at all (the CPU flat out): {2_000_000 * n / sum(work):5.2f} passes a second")
