import json, sys, collections
# fieldsim.py PER.json [--schedules a,b] [--worst N]: layer 4's schedules costed field by field from
# tools/fieldcost.mjs's passes (docs/step2-layer4-costing.md).
#
# Each measured pass p becomes two fields, 2p and 2p + 1 (h = 0, 1). A schedule says in which
# field(s) each part of the pass's logic runs: the key reads and pass lock ("top"), update_player,
# update_projectiles, the pass's three update_mover calls and its update_enemy_helicopter, and
# the scroll (a scroll still moves a whole CRTC character, so it happens on one field of the two).
# A part run in both fields costs the pass's measured cycles in each (half-size steps cost what a
# whole step does). A slot's change in pass p (fieldcost's `changed`) lands in the field(s) of the
# logic that wrote it (`writers`); a change of screen address alone, in the scroll's field.
#
# Frame k is drawn into the screen that showed frame k - 2, so it redraws every slot changed in
# fields k - 1 and k, and writes the scroll columns of both. A slot's redraw (take off + put on)
# costs what it cost on the nearest measured pass that redrew it; the renderer's bookkeeping is a
# fit to the measured passes (a + b * slots redrawn + c * columns); the slots the measured pass
# redrew for no change of its own (overlaps, the scroll's zone, the lives digit) are added to both
# of its frames. The interrupts are half a pass's a field. Each screen's save arena is modelled
# as the renderer keeps it: a block per mover drawn (its measured size) at the arena's top, freed
# when it comes off, and a compaction when the top + MAX_BLOCK would pass the end, costing what
# the measured compactions cost for the bytes they kept.
#
# The replay is pipesim's: one CPU, a vsync every 39,936 cycles; field k's logic, then its render
# (once frame k - 1 is shown: the hidden screen holds it until then), flipped at the first vsync
# at or after the render's end and at least one field after the last flip (two at 25 Hz). The
# next field's logic runs in the wait (decision 26). A frame shown for 2 fields or more is late.
F = 39936
ARENA, ARENA_END, MAX_BLOCK = 0x34D5, 0x4000, 0x2A0     # save_arena, save_arena_end, MAX_BLOCK
NO_COMPACT = False          # --no-compact: as if compaction cost nothing (done in a wait, or never needed)

def load(path):
    return json.load(open(path))['passes']

def pass_parts(x):
    L, C = x['logic'], x['coll']
    g = lambda *ks: sum(L.get(k, 0) + C.get(k, 0) for k in ks)
    return {'top': g('top', 'movers'), 'player': g('player', 'lives'), 'scroll': g('scroll', 'push'), 'proj': g('proj'),
            'um': [u['cyc'] for u in x['um']], 'eh': [u['cyc'] for u in x['eh']], 'irq': x['irq']}

class Passes:
    def __init__(self, d):
        self.d = d; n = self.n = len(d)
        self.parts = [pass_parts(x) for x in d]
        # each pass's redraws: slot -> (cycles, bytes) of its take off + put on
        self.redraw = []
        self.small = []          # cycles of put_on/take_off calls that drew nothing (bookkeeping)
        for x in d:
            r = {}; sm = 0
            for o in x['ops']:
                if o['bytes'] == 0 and not o.get('blk'): sm += o['cyc']; continue
                c, b, k = r.get(o['slot'], (0, 0, 0)); r[o['slot']] = (c + o['cyc'], b + o['bytes'], k + o.get('blk', 0))
            self.redraw.append(r); self.small.append(sm)
        cols = sum(x['col'] for x in d)
        self.col_cost = (sum(x['colc'] for x in d) + sum(x['rlc'] for x in d)) / max(1, cols)   # a column and its lives digit
        # the bookkeeping fit: book + the empty calls = a + b * slots redrawn + c * columns
        ys = [x['book'] + s for x, s in zip(d, self.small)]
        X = [(1, len(r), x['col']) for x, r in zip(d, self.redraw)]
        self.book = lstsq(X, ys)
        # compaction: cycles = a + b * the bytes it keeps
        cm = [k for x in d for k in x.get('cmp', [])]
        self.cmp_n = len(cm)
        self.cmp = fit_compaction(cm)
        # what each pass's frame redrew for no change of its own in it or the pass before
        self.extra = []
        for p in range(n):
            q = self.changed_set(p) | (self.changed_set(p - 1) if p else set())
            self.extra.append(set(self.redraw[p]) - q)

    def changed_set(self, p):
        return {s for s, m in enumerate(self.d[p]['changed']) if m}

    def cost(self, s, p):
        for dp in (0, 1, -1, 2, -2, 3, -3):
            q = p + dp
            if 0 <= q < self.n and s in self.redraw[q]: return self.redraw[q][s]
        return (0, 0, 0)              # not on the screen near then

def fit_compaction(cm):
    return lstsq([(1, k['after'] - ARENA) for k in cm], [k['cyc'] for k in cm]) if len(cm) > 2 else [sum(k['cyc'] for k in cm) / max(1, len(cm)), 0]

def lstsq(X, y):
    k = len(X[0])
    A = [[sum(r[i] * r[j] for r in X) for j in range(k)] for i in range(k)]
    b = [sum(r[i] * v for r, v in zip(X, y)) for i in range(k)]
    for i in range(k):              # Gauss-Jordan
        piv = max(range(i, k), key=lambda r: abs(A[r][i])); A[i], A[piv] = A[piv], A[i]; b[i], b[piv] = b[piv], b[i]
        for r in range(k):
            if r != i and A[i][i]:
                f = A[r][i] / A[i][i]; A[r] = [a - f * c for a, c in zip(A[r], A[i])]; b[r] -= f * b[i]
    return [b[i] / A[i][i] if A[i][i] else 0 for i in range(k)]

# a schedule: the fields (of 0, 1) each part runs in; scroll: 'h0', 'h1', 'alt' (scrolls take
# turns), 'player' (the player's first field)
SCHEDULES = {
    'option2': dict(desc='option 2: player, projectiles, scroll every field; soldiers on field 0, the helicopter on 1',
                    top=(0, 1), player=(0, 1), proj=(0, 1), um=((0,), (0,), (0,)), eh=(1,), scroll='alt'),
    'option2-s1': dict(desc='option 2, the soldiers split 2 + 1 with the helicopter',
                    top=(0, 1), player=(0, 1), proj=(0, 1), um=((0,), (0,), (1,)), eh=(1,), scroll='alt'),
    'option2-sc0': dict(desc='option 2, the scroll only on the soldiers\' field (0)',
                    top=(0, 1), player=(0, 1), proj=(0, 1), um=((0,), (0,), (0,)), eh=(1,), scroll='h0'),
    'option2-sc-alone': dict(desc='option 2, the scroll on field 0, every mover on field 1',
                    top=(0, 1), player=(0, 1), proj=(0, 1), um=((1,), (1,), (1,)), eh=(1,), scroll='h0'),
    'player-alt': dict(desc='projectiles every field; the player and its scroll on field 0, the movers on field 1',
                    top=(0, 1), player=(0,), proj=(0, 1), um=((1,), (1,), (1,)), eh=(1,), scroll='h0'),
    'full50': dict(desc='full 50 Hz: the whole pass every field (half-size steps)',
                    top=(0, 1), player=(0, 1), proj=(0, 1), um=((0, 1),) * 3, eh=(0, 1), scroll='alt'),
}

def build(P, sch):
    """-> per field: logic cycles, the set of slots changed, scroll (0/1), extras"""
    fields = []
    alt = 0
    for p in range(P.n):
        x, pt = P.d[p], P.parts[p]
        scrolled = x['scrolled'] > 0
        if sch['scroll'] == 'alt': sf = alt; alt ^= scrolled
        elif sch['scroll'] == 'player': sf = sch['player'][0]
        else: sf = int(sch['scroll'][1])
        fl = [dict(p=p, h=h, logic=pt['irq'] / 2, parts={}, ch=set(), scroll=0, extra=P.extra[p]) for h in (0, 1)]
        def add(h, name, c):
            fl[h]['logic'] += c; fl[h]['parts'][name] = fl[h]['parts'].get(name, 0) + c
        for h in (0, 1):
            if h in sch['top']: add(h, 'top', pt['top'])
            if h in sch['player']: add(h, 'player', pt['player'])
            if h in sch['proj']: add(h, 'proj', pt['proj'])
            for i, c in enumerate(pt['um']):
                if h in sch['um'][i]: add(h, 'soldiers', c)
            for c in pt['eh']:
                if h in sch['eh']: add(h, 'helicopter', c)
        if scrolled:
            add(sf, 'scroll', pt['scroll']); fl[sf]['scroll'] = x['scrolled']
        for s, m in enumerate(x['changed']):
            if not m: continue
            w = x['writers'][s]; hs = set()
            if m == 4 and scrolled: hs.add(sf)
            else:
                if w & 1: hs |= set(sch['player'])
                if w & 2: hs |= set(sch['proj'])
                if w & 4: hs |= set(sch['top'])
                if w & 8: hs.add(sf)
                for i in range(3):
                    if w & (16 << i): hs |= set(sch['um'][i])
                if w & 128: hs |= set(sch['eh'])
                if not hs: hs = {0, 1}
            for h in hs: fl[h]['ch'].add(s)
        fields += fl
    return fields

class Arena:
    """each screen's save arena as render.6502 keeps it: take off the player first, then the
    last slot down, a freed block giving its room back only if it is the arena's top; put on in
    slot order, the player last, each block at the top, compacting first if the top + MAX_BLOCK
    would pass the end"""
    def __init__(self, P):
        self.P = P; self.top = [ARENA, ARENA]; self.live = [{}, {}]; self.n = 0
    def frame(self, screen, D, blk):
        live = self.live[screen]; cyc = 0
        for s in sorted(D, key=lambda s: (s != 0, -s)):     # off: the player, then the last slot down
            if s in live:
                a, e = live.pop(s)
                if e == self.top[screen]: self.top[screen] = a
        for s in sorted(D, key=lambda s: (s == 0, s)):      # on: slot order, the player last
            b = blk(s)
            if not b: continue
            if self.top[screen] + MAX_BLOCK > ARENA_END:
                at = ARENA; self.n += 1
                for q, (a, e) in sorted(live.items(), key=lambda kv: kv[1][0]):
                    live[q] = (at, at + e - a); at += e - a
                cyc += 0 if NO_COMPACT else self.P.cmp[0] + self.P.cmp[1] * (at - ARENA)
                self.top[screen] = at
            live[s] = (self.top[screen], self.top[screen] + b); self.top[screen] += b
        return cyc

def renders(P, fields, pair=True):
    """frame k's render: the slots changed in fields k - 1 and k (pair) or k alone"""
    out = []
    a, b, c = P.book
    arena = Arena(P)
    for k, f in enumerate(fields):
        prevf = fields[k - 1] if k and pair else None
        D = set(f['ch']) | (prevf['ch'] if prevf else set()) | f['extra']
        cols = f['scroll'] + (prevf['scroll'] if prevf else 0)
        cyc = byt = 0
        for s in D:
            cc, bb, _ = P.cost(s, f['p']); cyc += cc; byt += bb
        book = a + b * len(D) + c * cols
        cmp = arena.frame(k % 2, D, lambda s: P.cost(s, f['p'])[2])
        out.append(dict(render=cyc + book + cols * P.col_cost + cmp, draw=cyc, bytes=byt, book=book, cols=cols, n=len(D), cmp=cmp))
    out_n = arena.n
    return out, out_n

def replay(L, R, gap):
    """flips under one CPU; gap = the fewest fields between flips"""
    t = 0; flips = []
    for k in range(len(L)):
        t += L[k]
        if flips: t = max(t, flips[-1])
        t += R[k]
        f = -(-t // F) * F
        if flips: f = max(f, flips[-1] + gap * F)
        flips.append(f)
    return flips

def late(flips, gap):
    gaps = [flips[i] - flips[i - 1] for i in range(1, len(flips))]
    return sum(1 for g in gaps if g > gap * F), collections.Counter(g // F for g in gaps), (flips[-1] - flips[0]) / 2e6

def validate(P):
    """the model at 25 Hz (a pass a frame, 2 fields a flip) against the measured renders"""
    flds = []
    for p in range(P.n):
        x, pt = P.d[p], P.parts[p]
        flds.append(dict(p=p, ch=P.changed_set(p), scroll=x['scrolled'], extra=P.extra[p],
                         logic=pt['top'] + pt['player'] + pt['scroll'] + pt['proj'] + sum(pt['um']) + sum(pt['eh']) + pt['irq']))
    R, ncmp = renders(P, flds)
    meas = [sum(o['cyc'] for o in x['ops']) + x['book'] + x['colc'] + x['rlc'] + sum(k['cyc'] for k in x.get('cmp', [])) for x in P.d]
    Lm = [f['logic'] for f in flds]
    n, h, sec = late(replay(Lm, meas, 2), 2)
    nm, hm, _ = late(replay(Lm, [r['render'] for r in R], 2), 2)
    print(f"model check at 25 Hz ({P.n} passes): render measured {sum(meas)/P.n:.0f} a pass, modelled {sum(r['render'] for r in R)/P.n:.0f}; "
          f"late frames from the measured renders {n}, from the modelled {nm}")
    print(f"  bookkeeping fit: {P.book[0]:.0f} + {P.book[1]:.0f} a slot redrawn + {P.book[2]:.0f} a column; a column with its lives digit {P.col_cost:.0f}")
    print(f"  compactions: measured {P.cmp_n}, modelled {ncmp}; a compaction {P.cmp[0]:.0f} + {P.cmp[1]:.1f} a byte kept")
    if 'flips' in P.d[0]:
        fl = [c for x in P.d for c in x['flips']]
        # the real flips, in fields (a vsync's cycle is the flip's, less the interrupt's few)
        g = [round((fl[i] - fl[i - 1]) / F) for i in range(1, len(fl))]
        print(f"  the run itself: {len(fl)} flips, shown for (fields) {dict(sorted(collections.Counter(g).items()))}, late {sum(1 for v in g if v > 2)}")
    B = [sum(o['bytes'] for o in x['ops']) for x in P.d]
    for lim, label in ((0, 'no late frames'), (P.n // 100, '1% late')):
        f, pb, fr = needed(Lm, meas, B, 2, lim)
        fmt = lambda v, s: 'none is enough' if v is None else s % v
        print(f"  at 25 Hz, for {label}: the render {fmt(f and 100 * f, '%.0f%% cheaper')}; or a byte drawn or restored {fmt(pb, '%.0f cycles cheaper')}; or the logic {fmt(fr, '%.0f cycles less a pass')}")
    big = sorted(range(P.n), key=lambda p: -abs(R[p]['render'] - meas[p]))[:3]
    print('  largest misses: ' + ', '.join(f"pass {P.d[p]['p']} {meas[p]} vs {R[p]['render']:.0f}" for p in big))

GROUPS = [('player', range(0, 1)), ('enemies', range(1, 10)), ('enemy helicopters', range(10, 12)),
          ('projectiles', range(12, 24)), ('allies, tank', range(24, 34))]

def report(P):
    """1 and 2 of the costing: the logic by group, the render by slot group and type"""
    n = P.n; d = P.d
    def avg(f): return sum(f(x) for x in d) / n
    lg = lambda k: avg(lambda x: x['logic'].get(k, 0)); cl = lambda k: avg(lambda x: x['coll'].get(k, 0))
    print("logic a pass (cycles, of which in collision and target searches):")
    for name, ks in (("top: keys, update_movers' loop, pass lock", ('top', 'movers')), ('update_player', ('player', 'lives')),
                     ('  its scroll (scroll_screen_*)', ('scroll',)), ('  its history_push', ('push',)), ('update_projectiles', ('proj',))):
        print(f"  {name:44s} {sum(lg(k) + cl(k) for k in ks):6.0f} ({sum(cl(k) for k in ks):.0f})")
    for tag, name in (('um', 'update_mover (soldiers)'), ('eh', 'update_enemy_helicopter')):
        calls = [u for x in d for u in x[tag]]
        print(f"  {name:44s} {sum(u['cyc'] for u in calls) / n:6.0f} ({sum(u['coll'] for u in calls) / n:.0f}): {len(calls) / n:.1f} calls a pass, "
              f"{sum(u['cyc'] for u in calls) / max(1, len(calls)):.0f} a call, max {max(u['cyc'] for u in calls)}")
        by = collections.defaultdict(list)
        for u in calls: by[u['type'] & 0x7F].append(u['cyc'])
        print('      by type: ' + ', '.join(f"&{k:02X} {sum(v)/len(v):.0f} x{len(v)}" for k, v in sorted(by.items(), key=lambda kv: -sum(kv[1]))[:8]))
    sc = [x for x in d if x['scrolled']]
    print(f"  interrupts {avg(lambda x: x['irq']):.0f}; on a scrolling pass ({len(sc)} of {n}) the scroll + push cost "
          f"{sum(x['logic'].get('scroll', 0) + x['logic'].get('push', 0) + x['coll'].get('scroll', 0) for x in sc) / max(1, len(sc)):.0f}")
    ops = [(x, o) for x in d for o in x['ops'] if o['bytes'] or o.get('blk')]
    print(f"render a pass: redraws {avg(lambda x: sum(o['cyc'] for o in x['ops'])):.0f}, bookkeeping {avg(lambda x: x['book']):.0f}, "
          f"columns {avg(lambda x: x['colc']):.0f} ({avg(lambda x: x['col']):.2f} a pass), lives digit {avg(lambda x: x['rlc']):.0f}, "
          f"compaction {avg(lambda x: sum(k['cyc'] for k in x.get('cmp', []))):.0f}")
    print(f"  {'by slot group':22s} {'on: bytes':>10s} {'cycles':>7s} {'off: bytes':>11s} {'cycles':>7s} {'a byte on/off':>14s}   redraw cycles: changed this pass / only the last")
    for name, rg in GROUPS:
        sel = [(x, o) for x, o in ops if o['slot'] in rg]
        on = [o for x, o in sel if o['k'] == 'on']; off = [o for x, o in sel if o['k'] == 'off']
        bo, co = sum(o['bytes'] for o in on), sum(o['cyc'] for o in on); bf, cf = sum(o['bytes'] for o in off), sum(o['cyc'] for o in off)
        new = sum(o['cyc'] for x, o in sel if x['changed'][o['slot']]); old = co + cf - new
        print(f"  {name:22s} {bo / n:10.1f} {co / n:7.0f} {bf / n:11.1f} {cf / n:7.0f} {co / max(1, bo):7.1f}/{cf / max(1, bf):<6.1f}   {new / n:6.0f} / {old / n:.0f}")
    by = collections.defaultdict(lambda: [0, 0, 0])
    for x, o in ops: e = by[o['type'] & 0x7F]; e[0] += o['bytes']; e[1] += o['cyc']; e[2] += 1
    print('  by type (bytes, cycles a pass, on + off): ' + ', '.join(f"&{k:02X} {v[0] / n:.0f}/{v[1] / n:.0f}" for k, v in sorted(by.items(), key=lambda kv: -kv[1][1])[:10]))

def pct(v, q):
    s = sorted(v); return s[min(len(s) - 1, int(q * len(s)))]

def needed(L, R, B, gap, lim=0):
    """the least render cut (a fraction), per-byte cut and per-field cut for at most lim late frames"""
    def ok(Lx, Rx): return late(replay(Lx, Rx, gap), gap)[0] <= lim
    def least(fn, hi, it=30):       # the least c in [0, hi] with fn(c), fn monotone; None if not even hi
        if not fn(hi): return None
        lo = 0
        for _ in range(it):
            mid = (lo + hi) / 2
            if fn(mid): hi = mid
            else: lo = mid
        return hi
    f = least(lambda c: ok(L, [x * (1 - c) for x in R]), 1.0)                      # render less a fraction c
    pb = least(lambda c: ok(L, [max(0, x - c * b) for x, b in zip(R, B)]), 200)     # c cycles less a byte
    fr = least(lambda c: ok([max(0, l - c) for l in L], R), 80000)                  # c cycles less every field's work
    return f, pb, fr

def catchup(L, R):
    """the variant that keeps the game at design speed: the logic runs a step a field (never more
    than a field ahead), a frame shows the newest state once the screen is free, so a heavy frame
    is shown 2 fields and the next catches up the steps between; its redraw (the union of the
    steps' changes) is taken as the sum of their frames' renders, capped at twice the largest"""
    n = len(L); t = 0; j = 0; flips = []; lag = 0
    while j < n:
        tgt = max(j + 1, int(t // F) + 1)
        k0 = j
        while j < min(tgt, n):
            t = max(t, (j - 1) * F); t += L[j]; j += 1
        lag = max(lag, t / F - j)
        if flips: t = max(t, flips[-1])
        rs = [R[i]['render'] for i in range(k0, j)]
        t += rs[0] if len(rs) == 1 else min(sum(rs), 2 * max(rs))
        f = -(-t // F) * F
        if flips: f = max(f, flips[-1] + F)
        flips.append(f)
    gaps = collections.Counter(round((flips[i] - flips[i - 1]) / F) for i in range(1, len(flips)))
    sec = (flips[-1] - flips[0]) / 2e6
    print(f"  catch-up variant: {n / sec:.1f} fields of game a second, {len(flips) / sec:.1f} frames a second; "
          f"fields a frame {dict(sorted(gaps.items()))}; the logic up to {lag:.1f} fields behind")

def run(P, name, sch, worst=5):
    fields = build(P, sch)
    R, ncmp = renders(P, fields)
    L = [f['logic'] for f in fields]; Rr = [r['render'] for r in R]; B = [r['bytes'] for r in R]
    W = [l + r for l, r in zip(L, Rr)]
    flips = replay(L, Rr, 1)
    nl, hist, sec = late(flips, 1)
    over = sum(1 for w in W if w > F)
    print(f"\n{name}: {sch['desc']}")
    print(f"  {len(fields)} fields: work a field mean {sum(W)/len(W):.0f} (logic {sum(L)/len(L):.0f}, render {sum(Rr)/len(Rr):.0f}), "
          f"median {pct(W, .5):.0f}, 90% {pct(W, .9):.0f}, 99% {pct(W, .99):.0f}, max {max(W):.0f}; over a field (39,936): {over}")
    print(f"  late frames {nl} of {len(flips) - 1}; fields a frame {dict(sorted(hist.items()))}; {len(fields) / sec:.1f} fields of game a second (50 at design speed); compactions {ncmp}")
    by = collections.Counter()
    for w in W:
        if w > F: by[min(6, int((w - F) // 10000))] += 1
    print('  over by: ' + ', '.join(f"{i*10}-{(i+1)*10 if i < 6 else ''}k {by[i]}" for i in range(7)))
    for k in sorted(range(len(W)), key=lambda k: -W[k])[:worst]:
        f = fields[k]; r = R[k]
        print(f"    field {k} (pass {P.d[f['p']]['p']}, {f['h']}): {W[k]:.0f} = logic {L[k]:.0f} ({', '.join(f'{a} {b:.0f}' for a, b in f['parts'].items())}) "
              f"+ render {r['render']:.0f} ({r['n']} slots, {r['bytes']} bytes, {r['cols']} columns{', compaction %.0f' % r['cmp'] if r['cmp'] else ''})")
    nr = late(replay([0] * len(L), Rr, 1), 1)[0]; nlg = late(replay(L, [0] * len(L), 1), 1)[0]
    R1, _ = renders(P, fields, pair=False)
    n1 = late(replay(L, [r['render'] for r in R1], 1), 1)[0]
    print(f"  bounds: late frames with no logic at all {nr}, with no render at all {nlg}; drawing only the field's own changes "
          f"(a single screen's work, mean render {sum(r['render'] for r in R1) / len(R1):.0f}) {n1}")
    catchup(L, R)
    need = {}
    for lim, label in ((0, 'no late frames'), (len(flips) // 100, '1% late')):
        f, pb, fr = needed(L, Rr, B, 1, lim); need[lim] = f
        print(f"  for {label}: the render {100 * f:.0f}% cheaper" if f is not None else f"  for {label}: no render cut is enough", end='')
        print(f"; or {pb:.0f} cycles less a byte drawn or restored (now ~{sum(r['draw'] for r in R)/max(1,sum(B)):.0f} a byte)" if pb is not None else '; no per-byte cut is enough', end='')
        print(f"; or {fr:.0f} less logic every field" if fr is not None else '; no logic cut is enough')
    SUMMARY.append((name, sum(W) / len(W), sum(L) / len(L), sum(Rr) / len(Rr), pct(W, .99), max(W), over, nl, len(fields) / sec,
                    need[0], need[len(flips) // 100], nr, n1))
    return fields, R

SUMMARY = []
def summary():
    print(f"\n{'schedule':18s} {'work':>6s} {'logic':>6s} {'render':>6s} {'99%':>7s} {'max':>7s} {'>field':>6s} {'late':>5s} {'game f/s':>8s} {'cut 0':>6s} {'cut 1%':>6s} {'no-logic':>8s} {'1-field':>7s}")
    for s in SUMMARY:
        print(f"{s[0]:18s} {s[1]:6.0f} {s[2]:6.0f} {s[3]:6.0f} {s[4]:7.0f} {s[5]:7.0f} {s[6]:6d} {s[7]:5d} {s[8]:8.1f} "
              f"{'-' if s[9] is None else '%.0f%%' % (100 * s[9]):>6s} {'-' if s[10] is None else '%.0f%%' % (100 * s[10]):>6s} {s[11]:8d} {s[12]:7d}")
    SUMMARY.clear()

if __name__ == '__main__':
    args = sys.argv[1:]
    names = list(SCHEDULES)
    if '--schedules' in args:
        i = args.index('--schedules'); names = args[i + 1].split(','); del args[i:i + 2]
    worst = 5
    if '--no-compact' in args: args.remove('--no-compact'); NO_COMPACT = True
    rep = '--report' in args
    if rep: args.remove('--report')
    if '--worst' in args:
        i = args.index('--worst'); worst = int(args[i + 1]); del args[i:i + 2]
    data = [load(p) for p in args]
    cmp = fit_compaction([k for d in data for x in d for k in x.get('cmp', [])])   # all the runs' compactions
    for path, d in zip(args, data):
        P = Passes(d); P.cmp = cmp
        print(f"=== {path}{' (compaction free)' if NO_COMPACT else ''}")
        if rep: report(P)
        validate(P)
        for nm in names: run(P, nm, SCHEDULES[nm], worst)
        summary()
