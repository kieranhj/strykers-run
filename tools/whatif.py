import json, sys
# whatif.py FC.json DP.json: 25 Hz late frames if the renderer's work were cut in the ways costed
# in docs/step2-layer4-costing.md ("The heaviest frames"). FC is tools/fieldcost.mjs's passes
# (logic, render, compactions), DP tools/drawprof.mjs's draws (the same game, so the same pass
# numbers): each option takes its saving off the pass's render, and the passes are replayed as
# tools/fieldsim.py does (one CPU, vsync every 39,936, flips 2 fields apart at least).
# The new costs a byte, column or part are estimates of loops not written: each says its own.
sys.path.insert(0, __file__.rsplit('\\', 1)[0].rsplit('/', 1)[0])
from fieldsim import replay, late, F

fc = {x['p']: x for x in json.load(open(sys.argv[1]))['passes']}
ops = json.load(open(sys.argv[2]))
by_pass = {}
for o in ops: by_pass.setdefault(o['pass'], []).append(o)
passes = sorted(fc)
def logic(x): return sum(x['logic'].values()) + sum(x['coll'].values()) + x['irq']
def render(x): return sum(o['cyc'] for o in x['ops']) + x['book'] + x['colc'] + x['rlc'] + sum(k['cyc'] for k in x.get('cmp', []))
Lm = [logic(fc[p]) for p in passes]
R0 = [render(fc[p]) for p in passes]
cmp = [sum(k['cyc'] for k in fc[p].get('cmp', [])) for p in passes]
kept = [sum(k['after'] - 0x34D5 for k in fc[p].get('cmp', [])) for p in passes]
n0 = late(replay(Lm, R0, 2), 2)[0]

def player(o): return o['slot'] == 0
def heli(o): return o['slot'] in (10, 11)
def any_(o): return True
def rest(o): return not player(o) and not heli(o)
def recost(sel, draw_byte, draw_part, rest_byte, rest_part, col=None):
    """a pass's saving if the draws `sel` picks cost draw_byte a byte + draw_part a part (and
    restoring rest_byte + rest_part); col: or keep the loop and take this off each column"""
    def f(p, k):
        s = 0
        for o in by_pass.get(p, []):
            if not sel(o): continue
            if col is not None:
                s += col[0] * o['cols'] if o['k'] == 'on' else 0
                continue
            if o['k'] == 'on': s += o['cyc'] - (draw_byte * o['bytes'] + draw_part * o['parts'])
            else: s += o['cyc'] - (rest_byte * o['restored'] + rest_part * 3)   # (3 parts at most: the player's)
        return s
    return f
def restore_cols(sel, per_col):
    """restores: the per-column records gone: per_col less for each column the draw drew"""
    last = {}
    def f(p, k):
        s = 0
        for o in by_pass.get(p, []):
            if sel(o) and o['k'] == 'on': s += per_col * o['cols']
        return s
    return f
def delta_same_place_op(o):
    per = o['cyc'] / o['bytes'] + 39
    return o['sameIdx'] * per + (o['same'] - o['sameIdx']) * max(0, per - 30)
def delta_same_place(p, k):
    """a mover redrawn where it was: its bytes with the same index skipped (draw + restore), the
    rest recomputed from the save block (~30 a byte against ~55 now)"""
    s = 0
    for o in by_pass.get(p, []):
        if o['k'] == 'on' and o.get('moved') == 0 and o['bytes']:
            per = o['cyc'] / o['bytes'] + 39       # this draw's cost a byte, and its restore's
            s += o['sameIdx'] * per + (o['same'] - o['sameIdx']) * max(0, per - 30)
    return s
OPTIONS = [
    ('compaction in the wait (none in a frame)', lambda p, k: cmp[k]),
    ('compaction 3.5x faster (13 cycles a byte kept)', lambda p, k: cmp[k] - (2559 + 13 * kept[k]) if cmp[k] else 0),
    # compiled code a sprite row (alignment-free: a row is one screen line, its bytes 8 apart;
    # ~25 cycles a row to step a line or cross a cell, ~5 rows a part, and a part's set-up)
    ('player compiled (draw 21 a byte + 200 a part, restore 12 + 120)', recost(player, 21, 200, 12, 120)),
    ('player row-major data (draw 35 + 120 a part, restore 22 + 80)', recost(player, 35, 120, 22, 80)),
    ('helicopters compiled (draw 21 + 200, restore 12 + 120)', recost(heli, 21, 200, 12, 120)),
    # row-major data: per byte its offset in the row, mask and pixel (the flip and colour applied
    # at build time); LDY off,X : LDA (s),Y : STA save,X : AND mask,X : EOR pix,X : STA (s),Y :
    # DEX : BNE = 33 a byte, ~25 a row; restore LDY : LDA save,X : STA (s),Y : DEX : BNE = 19
    ('helicopters row-major data (draw 35 + 120 a part, restore 22 + 80)', recost(heli, 35, 120, 22, 80)),
    ('every column 60 cycles cheaper to draw (records, raise precomputed)', recost(any_, 0, 0, 0, 0, col=(60,))),
    ('and 30 cheaper to restore', restore_cols(any_, 30)),
    ('same-place redraws by delta', delta_same_place),
    ('other movers: columns 60 cheaper to draw, 30 to restore', lambda p, k: recost(rest, 0, 0, 0, 0, col=(60,))(p, k) + restore_cols(rest, 30)(p, k)),
]
def run(names):
    R = list(R0)
    for i, p in enumerate(passes):
        for name, f in OPTIONS:
            if name in names: R[i] -= f(p, i)
    return late(replay(Lm, R, 2), 2)[0], sum(R) / len(R)
print(f"{sys.argv[1]}: {len(passes)} passes; late frames (3+ fields) now {n0}, render {sum(R0) / len(R0):.0f} a pass")
for name, f in OPTIONS:
    nl, r = run({name})
    print(f"  {name:66s} late {nl:3d}, render {r:6.0f} ({r - sum(R0) / len(R0):+.0f})")
O = {k: o[0] for k, o in zip(('cmpwait', 'cmpfast', 'pc', 'prm', 'hc', 'hrm', 'cols', 'rcols', 'delta', 'other'), OPTIONS)}
combos = [(name, {O[k] for k in ks.split()}) for name, ks in (
    ('compaction in the wait + player compiled', 'cmpwait pc'),
    ('+ helicopters compiled', 'cmpwait pc hc'),
    ('+ the other movers: columns cheaper, delta', 'cmpwait pc hc other delta'),
    ('compaction in the wait + player and helicopters row-major', 'cmpwait prm hrm'),
    ('+ the other movers: columns cheaper, delta', 'cmpwait prm hrm other delta'),
    ('player compiled, helicopters row-major, compaction, other columns, delta', 'cmpwait pc hrm other delta'))]
for name, s in combos:
    nl, r = run(s)
    print(f"  {name:66s} late {nl:3d}, render {r:6.0f} ({r - sum(R0) / len(R0):+.0f})")

# --out FC2.json [player,heli,cols,delta,compact]: FC with each draw and restore recosted as the
# options say (matched to DP's by pass, kind and slot), for tools/fieldsim.py to cost 50 Hz with
if '--out' in sys.argv:
    i = sys.argv.index('--out'); out = sys.argv[i + 1]
    use = set(sys.argv[i + 2].split(',')) if len(sys.argv) > i + 2 else {'player', 'heli', 'cols', 'delta', 'compact'}
    d = json.load(open(sys.argv[1]))
    lastcols = {}
    for x in d['passes']:
        dq = {}
        for o in by_pass.get(x['p'], []): dq.setdefault((o['k'], o['slot']), []).append(o)
        for o in x['ops']:
            q = dq.get((o['k'], o['slot']))
            if not q or not (o['bytes'] or o.get('blk')): continue
            a = q.pop(0)
            if a['k'] == 'on': lastcols[a['slot']] = a['cols']
            if ('player' in use and player(a)) or ('heli' in use and heli(a)):
                o['cyc'] = 21 * a['bytes'] + 200 * a['parts'] if a['k'] == 'on' else 12 * a['restored'] + 360
            elif ('playerrm' in use and player(a)) or ('helirm' in use and heli(a)):
                o['cyc'] = 35 * a['bytes'] + 120 * a['parts'] if a['k'] == 'on' else 22 * a['restored'] + 240
            elif 'cols' in use:
                o['cyc'] -= 60 * a['cols'] if a['k'] == 'on' else 30 * lastcols.get(a['slot'], 0)
            if 'delta' in use and a['k'] == 'on' and a.get('moved') == 0 and not player(a) and not heli(a):
                o['cyc'] = max(0, o['cyc'] - delta_same_place_op(a))
        if 'compact' in use: x['cmp'] = []
    json.dump(d, open(out, 'w'))
    print(f"wrote {out} ({', '.join(sorted(use))})")
