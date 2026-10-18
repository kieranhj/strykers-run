"""latefr.py - every late frame in a tools/fieldcost.mjs run, and why it is late.

    python tools/latefr.py FC.json [--all]

A frame is late when it is shown 3 fields or more: the frame after it was not ready at the vsync 2
fields after it went up. The renderer draws pass k's frame once frame k-1 is shown (wait_for_flip),
so frame k is late when, from that flip, what is left of pass k's logic (it runs in the wait) and
its render do not fit in 2 fields (79,872 cycles). For each late frame this prints the pass whose
frame missed, the logic still running at the flip, the render by part (take off and put on by
slot and type, the scroll's columns, the lives digit, compaction, the bookkeeping) and the bytes.
"""
import json
import sys

FIELD = 39936
TYPES = {}   # filled from names if wanted


def main():
    fc = json.load(open(sys.argv[1]))
    passes = fc['passes']
    flips = []
    for x in passes:
        for c in x['flips']:
            flips.append((c, x['p']))
    late = []
    for i in range(1, len(flips)):
        g = round((flips[i][0] - flips[i - 1][0]) / FIELD)
        if g > 2:
            late.append((flips[i - 1][0], flips[i][0], g))
    by_p = {x['p']: x for x in passes}
    print(f"{sys.argv[1]}: {len(passes)} passes, {len(flips)} flips, {len(late)} late frames")
    tot = {}
    for f0, f1, g in late:
        # the pass whose render ran over the flip at f0 + 2 fields: the first render ending after f0
        k = next((x for x in passes if x.get('rend', 0) > f0), None)
        if k is None:
            continue
        t_render_start = k['rend'] - render_cost(k)
        logic_left = max(0, t_render_start - f0)
        r = render_parts(k)
        over = k['rend'] - (f0 + 2 * FIELD)
        line = (f"pass {k['p']}: shown {g} fields; over by {over}; logic after the flip {logic_left}; "
                f"render {render_cost(k)}: " + ", ".join(f"{a} {b}" for a, b in r.items()))
        print(line)
        ons = [o for o in k['ops'] if o['k'] == 'on' and o['cyc']]
        offs = [o for o in k['ops'] if o['k'] == 'off' and o['cyc']]
        print("    on:  " + "  ".join(f"s{o['slot']}/t{o['type'] & 0x7f:x} {o['bytes']}b {o['cyc']}" for o in ons))
        print("    off: " + "  ".join(f"s{o['slot']}/t{o['type'] & 0x7f:x} {o['bytes']}b {o['cyc']}" for o in offs))
        for a, b in r.items():
            tot[a] = tot.get(a, 0) + b
    if late:
        print("mean over the late frames: " + ", ".join(f"{a} {b // len(late)}" for a, b in tot.items()))


def render_cost(x):
    on = sum(o['cyc'] for o in x['ops'] if o['k'] == 'on')
    off = sum(o['cyc'] for o in x['ops'] if o['k'] == 'off')
    return on + off + x['colc'] + x['rlc'] + x['book'] + sum(c['cyc'] for c in x['cmp'])


def render_parts(x):
    return dict(on=sum(o['cyc'] for o in x['ops'] if o['k'] == 'on'),
                off=sum(o['cyc'] for o in x['ops'] if o['k'] == 'off'),
                cols=x['colc'], lives=x['rlc'], book=x['book'],
                compact=sum(c['cyc'] for c in x['cmp']),
                drawn=sum(o['bytes'] for o in x['ops'] if o['k'] == 'on'),
                restored=sum(o['bytes'] for o in x['ops'] if o['k'] == 'off'))


if __name__ == '__main__':
    main()
