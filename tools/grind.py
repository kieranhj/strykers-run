"""
grind.py - the bookkeeping and the gate of the micro-optimisation grind (the beeb-micro-grind skill,
.claude/skills/beeb-micro-grind/SKILL.md). Nothing here decides what is better code: the
evaluation workflow's agents do that. This cuts the work up, keeps the record, and proves.

    python tools/grind.py windows [--size 32] [--offset 0] [--profile A.json ...] [--all]
        the annotated sources (tools/analyse.py annotate, build/annotated/) cut into windows of
        SIZE consecutive instructions, each weighted by its measured cycles a pass (pcprof
        PCPROF= files of the build the annotation read), hottest first; windows already
        evaluated (docs/grind/seen.txt) are left out unless --all. Writes build/grind/windows.json
        and build/grind/w/<id>.txt
    python tools/grind.py add RESULT.json
        the evaluation workflow's result into the ledger, docs/grind/ledger.jsonl: each candidate
        with its skeptics' votes, approved or refuted; its windows into seen.txt
    python tools/grind.py queue                  the approved candidates not yet tried, best first
    python tools/grind.py apply ID ... | revert ID ...
    python tools/grind.py gate [--quick]
        build the control (HEAD, in a worktree; cached by commit) and the test (the working tree),
        run grind_config.CHECKS, measure both (MEASURE): a JSON verdict on stdout
    python tools/grind.py run [--batch 4] [--max N]
        the queue, serially: apply a batch, gate it, commit it if it passes and is no slower,
        else bisect it down to the candidates that fail; every outcome in the ledger. Refuses to
        run on main
    python tools/grind.py report                 docs/grind/README.md, from the ledger

The project's own facts (protected code, generated files, the builds, the checks) are in
tools/grind_config.py.
"""
import argparse, collections, hashlib, json, os, re, shutil, subprocess, sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'tools'))
import grind_config as CFG  # noqa: E402

GRIND = ROOT / 'build' / 'grind'
LEDGER = ROOT / 'docs' / 'grind' / 'ledger.jsonl'
SEEN = ROOT / 'docs' / 'grind' / 'seen.txt'
BS = chr(92)


# ---------------------------------------------------------------- the ledger
def load():
    if not LEDGER.exists():
        return []
    return [json.loads(l) for l in LEDGER.read_text(encoding='utf-8').splitlines() if l.strip()]


def save(cands):
    LEDGER.parent.mkdir(parents=True, exist_ok=True)
    LEDGER.write_text(''.join(json.dumps(c, ensure_ascii=False) + '\n' for c in cands), encoding='utf-8')


def find(cands, cid):
    for c in cands:
        if c['id'] == cid:
            return c
    sys.exit('no candidate ' + cid)


# ---------------------------------------------------------------- windows
def lines_of(path):
    """A file's lines, whatever its line endings (the annotator writes CRLF in text mode on
    Windows, so its lines end CR CR LF)."""
    t = Path(path).read_bytes().decode('utf-8').replace(chr(13), '')
    L = t.split(chr(10))
    while L and not L[-1].strip():          # trailing blank lines: the annotator adds one
        L.pop()
    return L


def code_of(line):
    return line.split(BS)[0].strip()


def breaks_run(line):
    """A source line that is not an instruction: does it end a run of instructions? Labels,
    comments, blank lines, equates, scopes and ASSERTs do not; data, conditional assembly,
    sections, includes and macros do."""
    c = code_of(line.split(';|')[0])
    if not c or c.startswith('.') or c in ('{', '}') or re.match(r'^[A-Za-z_][\w.]*\s*=', c):
        return False
    if c.upper().startswith(('ASSERT', 'PRINT')):
        return False
    return True


def read_dbg():
    """(file, line) -> (segment name, run address) from the debug file tools/analyse.py wrote."""
    dbg = ROOT / 'build' / 'dataflow-in' / 'game.dbg'
    files, segs, spans, out = {}, {}, {}, {}
    rec = re.compile(r'(\w+)=("[^"]*"|[^,]*)')
    lines = []
    for l in dbg.read_text(encoding='utf-8').splitlines():
        kind, _, rest = l.partition('\t')
        f = {k: v.strip('"') for k, v in rec.findall(rest)}
        if kind == 'file':
            files[f['id']] = f['name'].replace(BS, '/')
        elif kind == 'seg':
            segs[f['id']] = (f['name'], int(f['start'], 16))
        elif kind == 'span':
            spans[f['id']] = (f['seg'], int(f['start']), int(f['size']))
        elif kind == 'line' and 'span' in f:
            lines.append(f)
    for f in lines:
        name = files.get(f['file'], '')
        i = name.find('src/')
        if i < 0:
            continue
        for sp in f['span'].split('+'):
            if sp in spans:
                seg, start, size = spans[sp]
                sname, sbase = segs[seg]
                out.setdefault((name[i:], int(f['line'])), []).append((sname, sbase + start, size))
    return out


def heat_of(profiles):
    """address key (bank << 16 | addr for &8000-&BFFF, else addr) -> cycles a pass, the wait for
    the flip left out, averaged over the profiles."""
    total = collections.Counter()
    for p in profiles:
        d = json.loads(Path(p).read_text())
        for k, v in d['pc'].items():
            phase, a = k.split(':')
            if phase != 'wait':
                total[int(a)] += v / d['passes'] / len(profiles)
    return total


def protected_lines():
    out = collections.defaultdict(dict)       # file -> {line: why}
    for p in CFG.PROTECT:
        L = lines_of(ROOT / p['file'])
        s = next(i for i, l in enumerate(L) if l.split()[:1] == ['.' + p['frm']])
        e = next(i for i in range(s, len(L)) if p['to'] in code_of(L[i]))
        for i in range(s, e + 1):
            out[p['file']][i + 1] = p['why']
    return out


def cmd_windows(a):
    dbg = read_dbg()
    heat = heat_of(a.profile) if a.profile else collections.Counter()
    prot = protected_lines()
    for (f, n), places in dbg.items():
        for seg, addr, size in places:
            for seg_p, lo, hi, why in CFG.PROTECT_BYTES:
                if seg == seg_p and addr <= hi and addr + size - 1 >= lo:
                    prot[f][n] = why
    seen = set(SEEN.read_text().split()) if SEEN.exists() and not a.all else set()
    ann_root = ROOT / 'build' / 'annotated'
    (GRIND / 'w').mkdir(parents=True, exist_ok=True)
    for old in (GRIND / 'w').glob('*.txt'):
        old.unlink()
    wins, skipped = [], collections.Counter()
    for ann in sorted(ann_root.rglob('*.6502')):
        rel = 'src/' + ann.relative_to(ann_root / 'src').as_posix()
        if rel in CFG.GENERATED:
            skipped['generated'] += 1
            continue
        A = lines_of(ann)
        S = lines_of(ROOT / rel)
        assert len(A) == len(S), (rel, len(A), len(S), 'the annotation is not of this source: annotate again')
        runs, run = [], []
        for i, l in enumerate(A):
            if ';|' in l:
                run.append(i + 1)
            elif breaks_run(l) and run:
                runs.append(run)
                run = []
        if run:
            runs.append(run)

        def cyc(n):
            t = 0.0
            for seg, addr, size in dbg.get((rel, n), ()):
                bank = CFG.SEGMENT_BANK.get(seg)
                t += heat.get((bank << 16 | addr) if bank and 0x8000 <= addr < 0xC000 else addr, 0)
            return t
        for run in runs:
            starts = list(range(0, len(run), a.size))
            if a.offset and len(run) > a.size:
                starts = [0] + list(range(a.offset, len(run), a.size))
            for k, s in enumerate(starts):
                e = (starts[k + 1] if k + 1 < len(starts) else len(run)) - 1
                first, last = run[s], run[e]
                if all(n in prot[rel] for n in run[s:e + 1]):
                    skipped['protected'] += 1
                    continue
                raw = '\n'.join(S[first - 1:last])
                wid = hashlib.sha1((rel + '\n' + raw).encode()).hexdigest()[:12]
                if wid in seen:
                    skipped['seen'] += 1
                    continue
                h = sum(cyc(n) for n in run[s:e + 1])
                body = []
                for n in range(first, last + 1):
                    c = cyc(n)
                    mark = 'PROTECTED ' if n in prot[rel] else ''
                    body.append(f"{n:5d} {'%8.1f' % c if c else ' ' * 8} {mark}{A[n - 1]}")
                why = sorted({prot[rel][n] for n in range(first, last + 1) if n in prot[rel]})
                head = [f"window {wid}: {rel} lines {first}-{last}, {e - s + 1} instructions, "
                        f"{h:,.1f} cycles a pass measured (wait excluded)"]
                head += [f"PROTECTED lines: {w}" for w in why]
                (GRIND / 'w' / f'{wid}.txt').write_text('\n'.join(head + [''] + body) + '\n', encoding='utf-8')
                wins.append(dict(id=wid, file=rel, first=first, last=last, n=e - s + 1, heat=round(h, 1),
                                 path=str((GRIND / 'w' / f'{wid}.txt').relative_to(ROOT)).replace(BS, '/')))
    wins.sort(key=lambda w: -w['heat'])
    (GRIND / 'windows.json').write_text(json.dumps(wins, indent=1))
    hot = [w for w in wins if w['heat'] > 0]
    tot = sum(w['heat'] for w in wins)
    print(f"{len(wins)} windows ({len(hot)} that ran in the profiles, {tot:,.0f} cycles a pass between them); "
          f"left out: {dict(skipped)} -> build/grind/windows.json")
    for frac in (0.5, 0.9, 0.99):
        acc, k = 0, 0
        for w in hot:
            acc += w['heat']
            k += 1
            if acc >= frac * tot:
                break
        print(f"  {int(frac * 100)}% of those cycles in the hottest {k} windows")


# ---------------------------------------------------------------- candidates
def from_dir(d):
    """A round as the evaluation workflow left it on disk: each optimiser's opt-<window>.json and
    each skeptic's skeptic-<window>-<i>-<lens>.json (i counts the optimiser's candidates)."""
    d = Path(d)
    rnd = int(re.sub(r'\D', '', d.name) or 0)
    cands, wins = [], set()
    for f in sorted(d.glob('opt-*.json')):
        got = json.loads(f.read_text(encoding='utf-8')).get('candidates', [])
        wins.add(f.stem[4:])
        for i, c in enumerate(got):
            wins.add(c.get('window', ''))
            c['skeptics'] = []
            for v in sorted(d.glob(f"skeptic-{c.get('window')}-{i}-*.json")):
                try:
                    vote = json.loads(v.read_text(encoding='utf-8'))
                except ValueError as e:     # an agent's hand-written JSON (a 6502 comment's \)
                    print(f"{v.name}: {e}; vote skipped (the workflow's own result has it)")
                    continue
                vote['lens'] = v.stem.rsplit('-', 1)[1]
                c['skeptics'].append(vote)
            cands.append(c)
    return dict(round=rnd, windows=sorted(w for w in wins if w), candidates=cands)


def cmd_add(a):
    p = Path(a.result)
    res = from_dir(p) if p.is_dir() else json.loads(p.read_text(encoding='utf-8'))
    cands = load()
    n = max([int(c['id'][1:]) for c in cands] or [0])
    have = {(c['file'], c['old'], c['new']) for c in cands}
    added = collections.Counter()
    for c in res.get('candidates', []):
        key = (c['file'], c['old'], c['new'])
        if key in have:
            added['duplicate'] += 1
            continue
        have.add(key)
        n += 1
        votes = c.get('skeptics', [])
        refuted = sum(1 for v in votes if v.get('refuted'))
        # approved only with at least two skeptics heard and fewer than half of them refuting
        status = 'unreviewed' if len(votes) < 2 else 'refuted' if refuted * 2 >= len(votes) else 'approved'
        c = dict(id=f'G{n:04d}', round=res.get('round'), status=status, **c)
        cands.append(c)
        added[c['status']] += 1
    save(cands)
    seen = set(SEEN.read_text().split()) if SEEN.exists() else set()
    seen |= set(res.get('windows', []))
    SEEN.write_text('\n'.join(sorted(seen)) + '\n')
    print(f"ledger: {dict(added)}; {len(cands)} candidates in all; {len(seen)} windows seen")


def score(c):
    cl = c.get('claim', {})
    return (cl.get('cycles_a_pass', 0), cl.get('bytes', 0))


def queue(cands):
    return sorted([c for c in cands if c['status'] == 'approved'], key=score, reverse=True)


def cmd_queue(a):
    for c in queue(load()):
        cl = c.get('claim', {})
        print(f"{c['id']} {c['file']}:{c['line']} ~{cl.get('cycles_a_pass', 0):.1f} cycles a pass, "
              f"{cl.get('bytes', 0)} bytes  {c.get('summary', '')[:80]}")


def _swap(c, old, new):
    p = ROOT / c['file']
    raw = p.read_bytes().decode('utf-8')
    nl = '\r\n' if '\r\n' in raw else '\n'
    o, n = old.replace('\r\n', '\n').replace('\n', nl), new.replace('\r\n', '\n').replace('\n', nl)
    hits = [m.start() for m in re.finditer(re.escape(o), raw)]
    if not hits:
        return False
    at = min(hits, key=lambda h: abs(raw.count(nl, 0, h) + 1 - c.get('line', 0)))
    p.write_bytes((raw[:at] + n + raw[at + len(o):]).encode('utf-8'))
    return True


def apply(c):
    return _swap(c, c['old'], c['new'])


def revert(c):
    return _swap(c, c['new'], c['old'])


def cmd_apply(a, undo=False):
    cands = load()
    for cid in a.ids:
        c = find(cands, cid)
        ok = revert(c) if undo else apply(c)
        print(f"{cid}: {'reverted' if undo else 'applied'}" if ok else f"{cid}: its text is not in {c['file']}")


# ---------------------------------------------------------------- building, proving, measuring
def sh(argv, cwd=ROOT, env=None, timeout=None):
    return subprocess.run(argv, cwd=cwd, env=env, capture_output=True, text=True, timeout=timeout)


def build(where, kind):
    args, image = CFG.BUILDS[kind]
    env = dict(os.environ)
    env.setdefault('BARON', str(ROOT / 'bin' / ('baron.exe' if os.name == 'nt' else 'baron')))
    if os.name == 'nt':
        r = sh(['powershell', '-NoProfile', '-Command', f'& .\\build.ps1 {args}'], cwd=where, env=env)
    else:
        mk = {'-Shift 256': 'SHIFT=256', '-ShiftEnd': 'SHIFTEND=1', '-Release': 'release'}
        margs = [v for k, v in mk.items() if k in args]
        m = re.search(r'-Define (\S+)', args)
        margs += [f'DEFINES={m[1]}'] if m else []
        r = sh(['make'] + margs, cwd=where, env=env)
    out = Path(where) / 'build' / f'{image}.ssd'
    if r.returncode or not out.exists() or (os.name == 'nt' and 'Built' not in r.stdout + r.stderr):
        return None, (r.stdout + r.stderr)[-2000:]
    return out, ''


def stash(src, dst):
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy(src, dst)
    shutil.copy(src.with_suffix('.symbols.json'), dst.with_suffix('.symbols.json'))
    return dst


def build_set(where, into):
    """Every build of grind_config.BUILDS in `where`, the images kept in `into`; None if one fails."""
    imgs = {}
    for kind in CFG.BUILDS:
        out, err = build(where, kind)
        if not out:
            return None, f'{kind} does not assemble: {err}'
        imgs[kind] = stash(out, into / f'{kind}.ssd')
    return imgs, ''


def measure(img):
    out = {}
    for name, argv in CFG.MEASURE:
        per = GRIND / f'per-{abs(hash((str(img), name)))}.json'
        env = dict(os.environ, PERPASS=str(per))
        r = sh([x.replace('{bench}', str(img)) for x in argv], env=env)
        d = json.loads(per.read_text())
        out[name] = round(sum(x['work'] for x in d) / len(d), 1)
        per.unlink()
    return out


def control(rev='HEAD'):
    head = sh(['git', 'rev-parse', '--short', rev]).stdout.strip()
    into = GRIND / f'ctl-{head}'
    done = into / 'done.json'
    if done.exists():
        return json.loads(done.read_text())
    wt = GRIND / 'wt'
    sh(['git', 'worktree', 'remove', '--force', str(wt)])
    r = sh(['git', 'worktree', 'add', '--force', '--detach', str(wt), head])
    if r.returncode:
        sys.exit('worktree: ' + r.stderr)
    try:
        imgs, err = build_set(wt, into)
        if not imgs:
            sys.exit('the control does not build: ' + err)
    finally:
        sh(['git', 'worktree', 'remove', '--force', str(wt)])
    res = dict(commit=head, images={k: str(v) for k, v in imgs.items()}, work=measure(imgs['bench']))
    done.write_text(json.dumps(res, indent=1))
    return res


def judge(kind, out):
    last = [l for l in out.strip().splitlines() if l.strip()][-1:] or ['']
    if kind == 'frontend':
        return bool(re.search(r': 0 failed', out)), last[0][:200]
    try:
        d = json.loads(last[0])
    except ValueError:
        return False, last[0][:200]
    if kind == 'passlock':
        ok = d.get('identical') and d.get('stalledAt') is None and d.get('screenPassesIdentical') == d.get('passes')
        return bool(ok), f"passes {d.get('passes')}, identical {d.get('identical')}, screen {d.get('screenPassesIdentical')}, first screen diff {d.get('screenFirstDiffPass')}"
    if kind == 'helilock':
        return d.get('boarded') and d.get('framesDiffering') == 0, f"boarded {d.get('boarded')}, frames differing {d.get('framesDiffering')}"
    if kind == 'ok':
        return bool(d.get('ok')), json.dumps(d)[:200]
    return False, 'unknown check'


def gate(quick=False, rev='HEAD'):
    ctl = control(rev)
    imgs, err = build_set(ROOT, GRIND / 'test')
    if not imgs:
        return dict(ok=False, why=err, control=ctl['commit'])
    I = dict(ctl=ctl['images']['bench'], test=str(imgs['bench']), full=str(imgs['full']), ship=str(imgs['ship']))
    checks = [c for c in CFG.CHECKS if not quick or c[0] in CFG.QUICK]

    def run(c):
        name, argv, kind = c
        r = sh([x.format(**I) for x in argv])
        ok, what = judge(kind, r.stdout)
        return name, ok, what
    with ThreadPoolExecutor(CFG.PARALLEL) as ex:
        res = list(ex.map(run, checks))
    ok = all(r[1] for r in res)
    out = dict(ok=ok, control=ctl['commit'], checks=[dict(name=n, ok=o, what=w) for n, o, w in res])
    if ok:
        work = measure(imgs['bench'])
        out['work'] = work
        out['saved'] = {k: round(ctl['work'][k] - work[k], 1) for k in work}
    return out


def cmd_gate(a):
    print(json.dumps(gate(a.quick, a.control), indent=1))


# ---------------------------------------------------------------- the serial run
TRAILER = os.environ.get('GRIND_TRAILER', 'Co-Authored-By: Claude <noreply@anthropic.com>').replace('\\n', '\n')


def log(msg):
    print(msg, flush=True)
    with open(GRIND / 'run.log', 'a', encoding='utf-8') as f:
        f.write(msg + '\n')


def verdict(v):
    """A candidate that failed its gate alone, by cause (round 1: 7 of 13 'failed' were out of
    room, 3 clashed with a change kept before them, 1 of 11 'slower' gained nothing)."""
    why = v.get('why', '')
    if not v['ok']:
        if re.search(r'Duplicate symbol|Undefined symbol', why):
            return 'stale'                  # a change kept before it took its label or its callee
        if 'overruns' in why:
            return 'no room'                # its region's ASSERT: worth trying again with more room
        return 'failed'
    if all(abs(s) <= CFG.NOISE for s in v['saved'].values()):
        return 'no gain'
    return 'slower'


def try_batch(cands, batch):
    """Apply `batch`, gate it; keep (commit) or bisect. Returns the candidates kept."""
    live = []
    for c in batch:
        if apply(c):
            live.append(c)
        else:
            c['status'] = 'stale'
            c['note'] = 'its text was no longer in the source when its turn came'
    save(cands)
    if not live:
        return []
    ids = ' '.join(c['id'] for c in live)
    log(f'gate: {ids}')
    v = gate()
    # kept if every check passes, neither game is slower, and something is gained: cycles on a
    # game, or bytes claimed (the build's ASSERTs and the checks have held, so they are real)
    # (identical code measures within NOISE of its control: the two builds' stamps differ)
    gain = v['ok'] and (any(s > CFG.NOISE for s in v['saved'].values())
                        or any(c.get('claim', {}).get('bytes', 0) > 0 for c in live))
    if v['ok'] and gain and all(s >= -CFG.NOISE for s in v['saved'].values()):
        for c in live:
            c['status'] = 'accepted'
            c['measured'] = dict(batch=ids, saved=v['saved'])
        save(cands)
        msg = (f"Grind: {ids}: {v['saved'].get('seed 1', 0):+.1f} / {v['saved'].get('RIGHT', 0):+.1f} cycles a pass saved\n\n"
               + '\n'.join(f"{c['id']} {c['file']}:{c['line']}: {c.get('summary', '')}" for c in live)
               + f"\n\nGated by tools/grind.py against {v['control']}: " + '; '.join(f"{x['name']} ok" for x in v['checks'])
               + f"\nMeasured (pcprof work a pass): {v['work']}\n\n{TRAILER}\n")
        sh(['git', 'add', '-A', 'src', str(LEDGER)])
        r = subprocess.run(['git', 'commit', '-q', '-F', '-'], cwd=ROOT, input=msg, text=True, capture_output=True)
        log(f"  kept {ids}: saved {v['saved']} ({r.stdout.strip() or 'committed'})")
        return live
    for c in live:
        revert(c)
    if len(live) == 1:
        c = live[0]
        c['status'] = verdict(v)
        c['gate'] = v
        save(cands)
        log(f"  {c['id']}: {c['status']}: " + ('; '.join(f"{x['name']}: {x['what']}" for x in v.get('checks', []) if not x['ok']) or v.get('why', '') or str(v.get('saved'))))
        return []
    log(f"  batch {ids} {'failed' if not v['ok'] else 'not faster'}: bisecting")
    h = len(live) // 2
    return try_batch(cands, live[:h]) + try_batch(cands, live[h:])


def cmd_run(a):
    if sh(['git', 'branch', '--show-current']).stdout.strip() in ('main', 'master'):
        sys.exit('grind.py run commits as it goes: run it on a branch (git checkout -b grind-<date>)')
    if sh(['git', 'status', '--porcelain', 'src']).stdout.strip():
        sys.exit('src/ has uncommitted changes: commit or stash them first')
    GRIND.mkdir(parents=True, exist_ok=True)
    if a.retry:                             # e.g. --retry 'no room' once a region has grown
        cands = load()
        for c in cands:
            if c['status'] in a.retry:
                c['note'] = f"was {c['status']}; retried"
                c['status'] = 'approved'
        save(cands)
    done = 0
    while a.max is None or done < a.max:
        cands = load()
        q = queue(cands)
        if not q:
            log('the queue is empty')
            break
        batch, used = [], set()
        for c in q:                         # one candidate per file region at a time
            span = (c['file'], c.get('line', 0) // 40)
            if span in used:
                continue
            used.add(span)
            batch.append(c)
            if len(batch) >= a.batch:
                break
        try_batch(cands, batch)
        done += len(batch)
    cmd_report(a)


# ---------------------------------------------------------------- the record
def cmd_report(a):
    cands = load()
    by = collections.Counter(c['status'] for c in cands)
    acc = [c for c in cands if c['status'] == 'accepted']
    lines = ['# The micro-optimisation grind', '',
             'GENERATED by `tools/grind.py report` from `ledger.jsonl`; the method is the beeb-micro-grind',
             'skill (`.claude/skills/beeb-micro-grind/SKILL.md`). Every candidate an optimiser proposed, what',
             'its skeptics said, and what the gate found. Savings are pcprof work a pass on passbench\'s two',
             'games (seed 1, holding RIGHT), measured per batch against its control.', '',
             f"Candidates: {len(cands)} - " + ', '.join(f'{k} {v}' for k, v in sorted(by.items())), '',
             '| Id | Where | Status | Claimed | Measured (batch) | What |', '|---|---|---|---|---|---|']
    for c in cands:
        cl = c.get('claim', {})
        m = c.get('measured', {}).get('saved', '')
        lines.append(f"| {c['id']} | `{c['file']}:{c.get('line', '')}` | {c['status']} | "
                     f"{cl.get('cycles_a_pass', 0):.1f} cyc/pass, {cl.get('bytes', 0)} B | {m} | {c.get('summary', '').replace('|', '/')} |")
    (LEDGER.parent / 'README.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')
    print(f"docs/grind/README.md: {len(cands)} candidates, {len(acc)} accepted")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    s = p.add_subparsers(dest='cmd', required=True)
    w = s.add_parser('windows')
    w.add_argument('--size', type=int, default=32)
    w.add_argument('--offset', type=int, default=0)
    w.add_argument('--profile', nargs='*', default=[])
    w.add_argument('--all', action='store_true')
    s.add_parser('add').add_argument('result')
    s.add_parser('queue')
    s.add_parser('apply').add_argument('ids', nargs='+')
    s.add_parser('revert').add_argument('ids', nargs='+')
    g = s.add_parser('gate')
    g.add_argument('--quick', action='store_true')
    g.add_argument('--control', default='HEAD', help='the commit to prove against (e.g. HEAD^1 for a merge)')
    r = s.add_parser('run')
    r.add_argument('--batch', type=int, default=4)
    r.add_argument('--max', type=int)
    r.add_argument('--retry', nargs='*', default=[], help="statuses to queue again, e.g. 'no room'")
    s.add_parser('report')
    a = p.parse_args()
    {'windows': cmd_windows, 'add': cmd_add, 'queue': cmd_queue, 'apply': cmd_apply,
     'revert': lambda a: cmd_apply(a, True), 'gate': cmd_gate, 'run': cmd_run, 'report': cmd_report}[a.cmd](a)


if __name__ == '__main__':
    main()
