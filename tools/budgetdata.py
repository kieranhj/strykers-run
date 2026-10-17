import json, sys, subprocess, collections
from pathlib import Path
# budgetdata.py OUT.json seed1:PHASE.json:PER.json right:PHASE.json:PER.json - the cycle budget page's
# data (the "Where the cycles go" artifact): per game, the groups a pass (tools/pccats.py over
# tools/pcagg.py's phases), the scenery split into built (logic, scroll) and written (render), a
# histogram of work a pass (4,000-cycle bins with an edge at 79,872) and averages for all passes,
# those that write a column and those that do not (tools/pcprof.mjs's PERPASS).
HERE = Path(__file__).parent
SUBS = {'move': 'Moving, animating and updating movers', 'walk': 'The logic’s sprite walk (walk_column)', 'keys': 'Reading the keyboard'}

def groups(phase_json):
    tmp = Path(phase_json).with_suffix('.cats.json')
    subprocess.run([sys.executable, str(HERE / 'pccats.py'), phase_json, str(tmp)], check=True, capture_output=True)
    c = json.load(open(tmp))
    out = {}
    def top(parts):
        parts = sorted(parts, key=lambda p: -p[2])
        head = [[n, ph, round(v)] for n, ph, v in parts[:14]]
        rest = parts[14:]
        if rest: head.append([f"{len(rest)} other labels", "", round(sum(v for _, _, v in rest))])
        return head
    logic = [k for k in ('move', 'walk', 'keys') if k in c]
    out['logic'] = {'total': sum(c[k]['total'] for k in logic), 'parts': top([p for k in logic for p in c[k]['parts']]),
                    'subs': [[SUBS[k], c[k]['total']] for k in logic]}
    for g in ('collide', 'scenery', 'irq', 'decide', 'restore', 'draw', 'wait'):
        x = c.get(g, {'total': 0, 'parts': []})
        out[g] = {'total': x['total'], 'parts': top(x['parts'])}
    built = sum(v for n, ph, v in c.get('scenery', {'parts': []})['parts'] if ph in ('logic', 'scroll'))
    written = sum(v for n, ph, v in c.get('scenery', {'parts': []})['parts'] if ph == 'render')
    return out, round(built), round(written)

def perpass(per_json):
    per = json.load(open(per_json))
    hist = [0] * 36
    for x in per: hist[min(35, max(0, (x['work'] + 128) // 4000))] += 1
    def avg(sel):
        n = len(sel)
        d = {k: round(sum(x[k] for x in sel) / max(1, n), 2) for k in ('work', 'render', 'scroll', 'irq', 'drawn', 'restored', 'drawsOn', 'offStale', 'onNew', 'byOverlap')}
        d['n'] = n; d['late'] = sum(1 for x in sel if x['work'] > 79872)
        return d
    return hist, {'all': avg(per), 'scroll': avg([x for x in per if x['columns']]), 'still': avg([x for x in per if not x['columns']])}

out = {}
for arg in sys.argv[2:]:
    name, ph, pp = arg.split(':', 2) if arg.count(':') == 2 else (arg.split(':')[0], *arg.split(':', 1)[1].rsplit(':', 1))
    g, built, written = groups(ph)
    hist, avgs = perpass(pp)
    out[name] = {'groups': g, 'scenery_built': built, 'scenery_written': written, 'hist': hist, 'pp': avgs}
json.dump(out, open(sys.argv[1], 'w'))
for k, v in out.items():
    print(k, {g: round(x['total']) for g, x in v['groups'].items()}, 'late passes', v['pp']['all']['late'], 'of', v['pp']['all']['n'])
