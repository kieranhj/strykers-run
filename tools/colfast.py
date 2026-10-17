import json, sys, collections
# colfast.py FC.json OPS.json [RUNNING_OPS.json]: the column renderer's per-column and per-part
# set-up, from tools/drawprof.mjs's labels, and the 25 Hz late frames if it were cut (a fast path
# for parts that are not clipped and cannot wrap round &8000), or the player's running frames
# compiled. FC is tools/fieldcost.mjs's passes, OPS tools/drawprof.mjs's draws, of the same game;
# RUNNING_OPS a drawprof run holding RIGHT, whose player kinds (sprite, flip, line) are the
# running frames. The new costs are estimates of loops not written: each says its own.
sys.path.insert(0, __file__.rsplit('\\', 1)[0].rsplit('/', 1)[0])
from fieldsim import replay, late

fc = {x['p']: x for x in json.load(open(sys.argv[1]))['passes']}
ops = json.load(open(sys.argv[2]))
# the running frames: the player's kinds holding RIGHT, all, or (TOP=N) the N with most bytes
running = set(); kind_size = {}
if len(sys.argv) > 3:
    kb = collections.Counter()
    for o in json.load(open(sys.argv[3])):
        if o['k'] == 'on' and o['slot'] == 0:
            for sp, fl, ln, b in o['partList']: kb[(sp, fl, ln)] += b; kind_size[(sp, fl, ln)] = max(kind_size.get((sp, fl, ln), 0), b)
    import os
    top = int(os.environ.get('TOP', '0')) or len(kb)
    running = {k for k, _ in kb.most_common(top)}
    sz = sum(kind_size[k] for k in running)
    print(f"compiled: {len(running)} kinds, {sz} bytes of sprite: ~{(sz * 19.4 + 40 * len(running)) / 1024:.1f}K of code "
          f"(draw ~12.4 bytes a sprite byte, restore 7, ~40 a kind's entries)")
passes = sorted(fc)
n = len(passes)
logic = [sum(fc[p]['logic'].values()) + sum(fc[p]['coll'].values()) + fc[p]['irq'] for p in passes]
def render(x): return sum(o['cyc'] for o in x['ops']) + x['book'] + x['colc'] + x['rlc'] + sum(k['cyc'] for k in x.get('cmp', []))
R0 = [render(fc[p]) for p in passes]
n0 = late(replay(logic, R0, 2), 2)[0]

# where a draw's and a restore's cycles go, by kind of label
LOOP = {'draw_column.byte', 'draw_column.part_byte', 'restore_block.byte', 'restore_block.part_byte'}
CELL = {'draw_column.cell', 'draw_column.data_same_page', 'draw_column.save_same_page', 'draw_column.in_ring', 'draw_column.last_cell',
        'restore_block.cell', 'restore_block.save_same_page', 'restore_block.in_ring', 'restore_block.last_cell'}
PART = {'ren_draw_sprite', 'ren_draw_sprite.known', 'ren_draw_sprite.clips', 'ren_draw_sprite.no_clip', 'ren_draw_sprite.flipped_in_ring',
        'raise_address', 'raise_address.up', 'raise_address.in_ring', 'mark_part', 'mark_part2', 'mark_part3', 'draw_mover.parts',
        'restore_block.each_part', 'restore_block.no_part', 'restore_block.header', 'restore_block.columns'}
def kind(label):
    if label in LOOP: return 'loop'
    if label in CELL: return 'cell'
    if label.startswith('draw_column') or label.startswith('restore_block'): return 'column'
    if label in PART: return 'part'
    return 'mover'
G = [('player', lambda s: s == 0), ('enemies', lambda s: 1 <= s <= 9), ('enemy helicopters', lambda s: s in (10, 11)), ('projectiles', lambda s: 12 <= s <= 23)]
print(f"{sys.argv[1]}: {n} passes; late frames now {n0}, render {sum(R0) / n:.0f} a pass")
print("  where the cycles go, a pass (bytes, columns, cells beyond a column's first, parts):")
for name, f in G:
    for k in ('on', 'off'):
        sel = [o for o in ops if o['k'] == k and f(o['slot'])]
        by = collections.Counter()
        for o in sel:
            for l, v in o['by'].items(): by[kind(l)] += v
        on = [o for o in ops if o['k'] == 'on' and f(o['slot'])]
        cols = sum(o['cols'] for o in on) / n; cells = sum(o['cells'] for o in on) / n - cols; parts = sum(o['parts'] for o in on) / n
        b = sum(o['bytes'] if k == 'on' else o['restored'] for o in sel) / n
        print(f"    {name:18s} {k:3s}: {' '.join(f'{x} {by[x] / n:5.0f}' for x in ('loop', 'column', 'cell', 'part', 'mover'))}"
              f"  | bytes {b:5.1f}, columns {cols:4.1f} ({by['column'] / n / max(cols, 0.01):3.0f} a column), cells {cells:4.1f}, parts {parts:3.1f}")

# options, as savings a pass
lastparts = {}
def compiled_op(o):
    if o['slot'] != 0: return False
    pl = o['partList'] if o['k'] == 'on' else lastpl.get(o['screen'], [])
    return bool(pl) and all((sp, fl, ln) in running for sp, fl, ln, b in pl)
def saving(p, opt, opts):
    s = 0
    for o in ops_by.get(p, []):
        if opt == 'fastcol':
            if 'compiled' in opts and o['slot'] == 0:
                pl = o['partList'] if o['k'] == 'on' else lastpl.get(o['screen'], [])
                tot = sum(b for sp, fl, ln, b in pl) or 1
                left = sum(b for sp, fl, ln, b in pl if (sp, fl, ln) not in running) / tot   # the share still drawn as now
                if o['k'] == 'on': s += left * (48 * o['cols'] + 6 * max(0, o['cells'] - o['cols']))
                else: s += left * 5 * lastcols.get((o['slot'], o['screen']), 0)
                continue
            # draw: a column's set-up (measured 131-164) to ~86: no ring tests (the part checked
            # once for a wrap), one header read, no 3-byte record (the restore walks the sprite's
            # headers again), the data pointer from the column pointer; a cell's crossing 6 less
            # without its ring test; restore: the sprite's headers in place of the records, ~5 less
            if o['k'] == 'on':
                if 'draw_column.have_j' in o['by']: continue          # clipped: the path as now
                s += 48 * o['cols'] + 6 * max(0, o['cells'] - o['cols'])
            else: s += 5 * lastcols.get((o['slot'], o['screen']), 0)
        elif opt == 'compiled':
            # the player's running frames as code per (sprite, flip, line), part by part (a part
            # outside the set is drawn as now): a pointer a cell row, LDY #o : LDA (p),Y : STA
            # save+n : AND #m : EOR #p : STA (p),Y, 21 a byte, ~80 a part (pointers, the bank's
            # stub); restore LDY #o : LDA save+n : STA (p),Y, 12 a byte, ~60 a part. A part's
            # cycles now: its share by bytes of the op's, less the mover's own set-up
            if o['slot'] != 0: continue
            pl = o['partList'] if o['k'] == 'on' else lastpl.get(o['screen'], [])
            tot = sum(b for sp, fl, ln, b in pl)
            if not tot: continue
            base = o['cyc'] - (mover_part(o) if o['k'] == 'on' else 0)
            for sp, fl, ln, b in pl:
                if (sp, fl, ln) not in running: continue
                s += base * b / tot - ((21 * b + 80) if o['k'] == 'on' else (12 * b + 60))
    return s
def mover_part(o):      # what stays: the mover's own set-up (draw_mover's tables, put_on, record_live)
    return sum(v for l, v in o['by'].items() if kind(l) == 'mover')
ops_by = collections.defaultdict(list)
lastcols, lastpl = {}, {}
for o in ops: ops_by[o['pass']].append(o)
def run(opts):
    lastcols.clear(); lastpl.clear()
    R = []
    for i, p in enumerate(passes):
        sv = 0
        for opt in opts: sv += saving(p, opt, opts)
        for o in ops_by.get(p, []):
            if o['k'] == 'on':
                lastcols[(o['slot'], o['screen'])] = o['cols']
                if o['slot'] == 0: lastpl[o['screen']] = o['partList']
        R.append(R0[i] - sv)
    return late(replay(logic, R, 2), 2)[0], sum(R) / n
if running:
    cov = [o for o in ops if o['k'] == 'on' and o['slot'] == 0]
    hb = sum(b for o in cov for sp, fl, ln, b in o['partList'] if (sp, fl, ln) in running)
    print(f"  the running frames: {len(running)} kinds; {100 * hb / max(1, sum(o['bytes'] for o in cov)):.0f}% of the player's bytes drawn")
for name, opts in (('a fast column path (not clipped, cannot wrap)', ['fastcol']),
                   ('the player\'s running frames compiled', ['compiled']) if running else None,
                   ('both', ['fastcol', 'compiled']) if running else None):
    if not name: continue
    nl, r = run(opts)
    print(f"  {name:48s} late {nl:3d}, render {r:6.0f} ({r - sum(R0) / n:+.0f})")
