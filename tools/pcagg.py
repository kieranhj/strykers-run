import json, sys, collections, bisect
# pcagg.py PCPROF SYMBOLS [OUT.json] (tools/pcprof.mjs's PC.json): cycles a pass by the label at or below each PC, every bank,
# split by phase when the profile's keys carry one ("render:301234")
d = json.load(open(sys.argv[1])); n = d['passes']
bank_of = {'DATA1': 4, 'DATA2': 5, 'DATA3': 6, 'DATA4': 7}
labs = collections.defaultdict(list)   # bank (0 = main) -> [(addr, name)]
for sec in json.load(open(sys.argv[2]))['assemblies'][0]['sections']:
    name = sec.get('name') or ''
    if name.startswith('hazel_'):   # the compiled kinds in HAZEL, &C000-&DFFF (layer 4)
        for k, v in (sec.get('labels') or {}).items():
            if isinstance(v, dict) and isinstance(v.get('value'), int) and '.' not in k: labs['H'].append((v['value'], k))
        continue
    if name not in bank_of and not (name == 'MGAME' or name.startswith('moved_')): continue
    for k, v in (sec.get('labels') or {}).items():
        if not isinstance(v, dict) or not isinstance(v.get('value'), int) or '.' in k: continue
        a = v['value']
        if name in bank_of and 0x8000 <= a < 0xC000: labs[bank_of[name]].append((a, k))
        elif name not in bank_of and a < 0x8000: labs[0].append((a, k))
for b in labs:   # one name an address, not an "unused" one
    best = {}
    for a, k in labs[b]:
        if a not in best or (best[a].startswith('unused') and not k.startswith('unused')): best[a] = k
    labs[b] = sorted(best.items())
addrs = {b: [a for a, _ in L] for b, L in labs.items()}

def name_of(key):
    bank, a = key >> 16, key & 0xFFFF
    if 0xC000 <= a < 0xE000 and 'H' in addrs and addrs['H'] and a >= addrs['H'][0]:
        i = bisect.bisect_right(addrs['H'], a) - 1
        return labs['H'][i][1]
    if a >= 0xC000: return '(MOS)'
    b = bank if 0x8000 <= a < 0xC000 else 0
    i = bisect.bisect_right(addrs.get(b, []), a) - 1
    return labs[b][i][1] if i >= 0 else '?%04x' % a

out = collections.Counter(); byb = collections.defaultdict(collections.Counter)
for key, c in d['pc'].items():
    b, k = key.split(':') if ':' in key else ('all', key)
    nm = name_of(int(k)); out[nm] += c; byb[b][nm] += c
print('passes', n, 'cycles a pass', round(sum(out.values()) / n))
for b, cn in sorted(byb.items(), key=lambda x: -sum(x[1].values())):
    print('== %s %.0f' % (b, sum(cn.values()) / n))
    for k, v in cn.most_common():
        if v / n >= 1: print('   %-50s %8.0f' % (k, v / n))
if len(sys.argv) > 3:
    json.dump({b: {k: round(v / n, 1) for k, v in cn.items()} for b, cn in byb.items()}, open(sys.argv[3], 'w'))
