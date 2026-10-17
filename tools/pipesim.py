import json, sys, collections
# pipesim.py PERPASS.json: frames late (shown for more than 2 fields) under three schemes, from each
# pass's measured logic and render cycles. One CPU: nothing runs at once; vsync every 39,936.
# Frame k flips at the first vsync at or after max(its render's end, the last flip + 2 fields).
F = 39936
d = json.load(open(sys.argv[1]))
L = [x['work'] - x['render'] for x in d]   # logic (with its interrupts)
R = [x['render'] for x in d]               # render, less its wait
n = len(d)
def vs(t): return -(-t // F) * F           # the first vsync at or after t

def now():   # decision 26: logic k+1 runs as soon as render k ends; render k+1 waits for flip k
    t = 0; flip = 0; flips = []
    for k in range(n):
        t += L[k]                          # logic k
        t = max(t, flip)                   # render k waits for the last frame's flip
        t += R[k]
        flip = vs(max(t, flip + 2 * F)) if k else vs(t)
        flips.append(flip)
    return flips

def ahead(depth):  # logic may run up to `depth` passes ahead of the render it feeds, filling the
    # wait; a render runs as soon as its frame's predecessor is shown and its logic is done; the
    # CPU never pre-empts what it is running
    t = 0; flip = 0; flips = []; lend = [0] * n; nl = 0; nr = 0; last_flip = -10**9
    while nr < n:
        can_render = nl > nr and t >= (flips[-1] if flips else 0)
        if can_render:
            t += R[nr]
            f = vs(max(t, flips[-1] + 2 * F)) if flips else vs(t)
            flips.append(f); nr += 1
        elif nl < n and nl - nr <= depth:
            t += L[nl]; lend[nl] = t; nl += 1
        else:
            t = max(t, flips[-1] if flips else t)   # idle until the flip
            if nl <= nr: t = max(t, lend[nl - 1] if nl else t)
    return flips

def report(name, flips):
    gaps = [flips[i] - flips[i - 1] for i in range(1, len(flips))]
    late = sum(1 for g in gaps if g > 2 * F)
    hist = collections.Counter(g // F for g in gaps)
    print(f"{name:28s} late frames {late:4d}   fields per frame {dict(sorted(hist.items()))}")
report('now (decision 26)', now())
report('logic 1 pass ahead', ahead(1))
report('logic 2 passes ahead', ahead(2))
