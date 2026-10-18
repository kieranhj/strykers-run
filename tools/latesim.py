"""latesim.py - 25 Hz late frames replayed from tools/fieldcost.mjs runs, with parts of the render
recosted: what each candidate change would bring, on the measured passes.

    python tools/latesim.py FC.json [FC2.json ...]

The replay is tools/fieldsim.py's (one CPU, a vsync every 39,936 cycles, flips at least 2 fields
apart, the logic of the next pass in the wait for the flip). Each line is a what-if: its late
frames on each run. The costs a byte of the changes not built are estimates, written beside them.
"""
import json
import sys

sys.path.insert(0, __file__.rsplit('\\', 1)[0].rsplit('/', 1)[0])
from fieldsim import replay, late  # noqa: E402


def logic(x):
    return sum(x['logic'].values()) + sum(x['coll'].values()) + x['irq']


def ops_cost(x, f):
    return sum(f(o) for o in x['ops'])


def render(x, op=lambda o: o['cyc'], compact=True, book=1.0, cols=1.0):
    return (ops_cost(x, op) + x['book'] * book + (x['colc'] + x['rlc']) * cols
            + (sum(k['cyc'] for k in x['cmp']) if compact else 0))


def generic(o, draw, rest):
    """a generic draw or restore with `draw`/`rest` cycles a byte taken off"""
    if o['k'] == 'on':
        return max(0, o['cyc'] - draw * o['bytes'])
    return max(0, o['cyc'] - rest * o['bytes'])


def compiled(o, sel, draw=23, rest=12, part=300):
    """slots `sel` picks drawn as compiled code: draw/rest cycles a byte, part a call"""
    if not sel(o) or not o['bytes']:
        return o['cyc']
    return o['bytes'] * (draw if o['k'] == 'on' else rest) + part


HELI = (7, 8, 0x16, 0x19, 0x1A)


def heli_runs(o):
    if o['type'] & 0x7f not in HELI:
        return o['cyc']
    return max(0, o['cyc'] - o['bytes'] * 0.75 * (25 if o['k'] == 'on' else 6))


def heli_cut(o, draw, rest):
    """the helicopters' bodies (~88% of their bytes; ~85% of those unclipped) cheaper a byte"""
    if o['type'] & 0x7f not in HELI:
        return o['cyc']
    return max(0, o['cyc'] - o['bytes'] * 0.75 * (draw if o['k'] == 'on' else rest))


WHATIF = [
    ('measured', {}),
    ('no compaction in the frame', dict(compact=False)),
    ('generic 10 / 5 cheaper a byte', dict(op=lambda o: generic(o, 10, 5))),
    ('generic 20 / 10 cheaper a byte', dict(op=lambda o: generic(o, 20, 10))),
    ('generic 20 / 10 cheaper, no compaction', dict(op=lambda o: generic(o, 20, 10), compact=False)),
    ('player (slot 0) all compiled', dict(op=lambda o: compiled(o, lambda q: q['slot'] == 0))),
    ('slots 10-11 compiled', dict(op=lambda o: compiled(o, lambda q: q['slot'] in (10, 11)))),
    ('types 7, 8, &16, &19 compiled', dict(op=lambda o: compiled(o, lambda q: q['type'] & 0x7f in (7, 8, 0x16, 0x19)))),
    ('bookkeeping halved', dict(book=0.5)),
    ('player on foot (slot 0, type 0) all compiled', dict(op=lambda o: compiled(o, lambda q: q['slot'] == 0 and q['type'] & 0x7f == 0))),
    ('on foot compiled, generic 10 / 5, book 0.7', dict(op=lambda o: generic(o, 10, 5) if not (o['slot'] == 0 and o['type'] & 0x7f == 0) else compiled(o, lambda q: True), book=0.7, compact=False)),
    ('on foot compiled, generic 15 / 8, book 0.7', dict(op=lambda o: generic(o, 15, 8) if not (o['slot'] == 0 and o['type'] & 0x7f == 0) else compiled(o, lambda q: True), book=0.7, compact=False)),
    ('generic 15 / 8, book 0.7, no compaction', dict(op=lambda o: generic(o, 15, 8), book=0.7, compact=False)),
    # row-run kinds for the helicopters' bodies (unclipped, ~85% of their bytes; the body ~88% of a
    # helicopter's): draw ~38 a byte against ~63, restore ~23 against ~29
    ('heli bodies as row runs', dict(op=lambda o: heli_runs(o))),
    ('heli bodies as cached kind tables (20 / 7)', dict(op=lambda o: heli_cut(o, 20, 7))),
    ('heli bodies JIT-compiled (33 / 14)', dict(op=lambda o: heli_cut(o, 33, 14))),
    ('kind tables, generic 6 / 3, book 0.8, no compaction', dict(op=lambda o: generic(o, 6, 3) if o['type'] & 0x7f not in HELI else heli_cut(o, 20, 7), book=0.8, compact=False)),
    ('heli bodies as row runs, generic 6 / 3, book 0.8', dict(op=lambda o: generic(o, 6, 3) if o['type'] & 0x7f not in HELI else heli_runs(o), book=0.8, compact=False)),
    ('render 10% cheaper', dict(op=lambda o: o['cyc'] * 0.9, book=0.9, cols=0.9)),
    ('render 20% cheaper', dict(op=lambda o: o['cyc'] * 0.8, book=0.8, cols=0.8)),
    ('render 30% cheaper', dict(op=lambda o: o['cyc'] * 0.7, book=0.7, cols=0.7)),
]


def main():
    runs = []
    for path in sys.argv[1:]:
        fc = json.load(open(path))
        P = fc['passes']
        fl = [c for x in P for c in x['flips']]
        meas = sum(1 for i in range(1, len(fl)) if round((fl[i] - fl[i - 1]) / 39936) > 2)
        runs.append((path.rsplit('/', 1)[-1], P, meas))
    print('what-if'.ljust(44) + ''.join(n[:14].rjust(16) for n, _, _ in runs))
    print('the run itself'.ljust(44) + ''.join(str(m).rjust(16) for _, _, m in runs))
    for name, kw in WHATIF:
        row = []
        for _, P, _ in runs:
            L = [logic(x) for x in P]
            R = [render(x, **kw) for x in P]
            n = late(replay(L, R, 2), 2)[0]
            row.append(f"{n} ({sum(R) / len(R) / 1000:.1f}k)")
        print(name.ljust(44) + ''.join(r.rjust(16) for r in row))


if __name__ == '__main__':
    main()
