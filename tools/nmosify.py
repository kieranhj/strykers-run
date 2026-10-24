"""nmosify.py - the 65SC12-only instructions turned into src/lib/nmos.6502's macros (decision 73).

    python tools/nmosify.py report          every CMOS instruction the annotated build reaches: the
                                            form chosen for each, and the ones left to do by hand
    python tools/nmosify.py report-all      the same, every site listed
    python tools/nmosify.py apply           the sources rewritten to the macros (MANUAL sites left)
    python tools/nmosify.py check           on a build without NMOS: each site's form still allowed
    python tools/nmosify.py check --nmos    on an NMOS build: what the forms newly read (flags, a zero
                                            register) as the NMOS code leaves it. Both are needed.

Reads build/annotated/src (`python tools/analyse.py --listing .. --symbols .. --disc .. annotate`, on
the flag set the forms are for: the Model B Lite build's). Each macro is the CMOS instruction itself
unless NMOS, so a build without NMOS is byte-identical; with NMOS it is the cheapest NMOS form the
state before the instruction allows:

  STZ    a register known 0 there (STZ_A/X/Y: free), else one dead there, with N and Z, loaded
         with 0 (STZ_LDA/LDX/LDY: +2 bytes, +2 cycles; the register then serves the STZs after it)
  BRA    a branch on a flag known there (BRA_EQ .. BRA_VS: free), else JMP (BRA_JMP: +1 byte)
  INC A / DEC A   C known (0 for INC, 1 for DEC) and C, V dead after: ADC/SBC #1 (+1 byte);
         C and V dead: CLC/SEC first (+2 bytes, +2 cycles); else X or Y dead: TAX INX TXA (+2, +4)
  PHX/PHY/PLX/PLY  A dead after (and N, Z for a push): through A (+1 byte, +2 cycles)

Anything else (TSB, TRB, BIT #, BIT zp,X, (zp)) is reported MANUAL and left alone. A site the
build does not assemble (another flag set's) has no annotation and is not seen.
"""
import re, sys, os, collections

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ANN = os.path.join(ROOT, 'build', 'annotated', 'src')
SRC = os.path.join(ROOT, 'src')

INS = re.compile(r'^(\s*)(STZ|BRA|INC\s+A\b|DEC\s+A\b|PHX|PHY|PLX|PLY|TSB|TRB|BIT|LDA|STA|ADC|SBC|AND|ORA|EOR|CMP|JMP)\b(.*)$', re.I)
BLOCK = ('IF', 'ELSE', 'ELIF', 'ENDIF', 'MACRO', 'ENDMACRO', 'FOR', 'NEXT', '{', '}')
COST = {'STZ_LDA': (2, 2), 'STZ_LDX': (2, 2), 'STZ_LDY': (2, 2), 'BRA_JMP': (1, 0),
        'INC_A_ADC': (1, 0), 'DEC_A_SBC': (1, 0), 'INC_A_CLC': (2, 2), 'DEC_A_SEC': (2, 2),
        'INC_A_X': (2, 4), 'DEC_A_X': (2, 4), 'INC_A_Y': (2, 4), 'DEC_A_Y': (2, 4),
        'PHX_A': (1, 2), 'PHY_A': (1, 2), 'PLX_A': (1, 2), 'PLY_A': (1, 2)}


def state(ann):
    i = ann.find(';|')
    if i < 0:
        return None
    s = ann[i + 2:]
    regs = dict(re.findall(r'\b([AXYCZNV])=(\S+)', s.split('|')[0]))
    m = re.search(r'in:(\S+) out:(\S+)', s)
    out = set() if not m or m.group(2) == '-' else set(m.group(2))
    return regs, out


def zero(v):
    return v is not None and re.match(r'\$00(?![0-9A-Fa-f.])', v) is not None


def operand(rest):
    code = rest.split('\\')[0].strip()
    if re.search(r',\s*X$', code, re.I):
        return code, 'X'
    if code.startswith('('):
        return code, 'ind'
    return code, ''


def is_cmos(mn, rest):
    code, mode = operand(rest)
    if mn in ('STZ', 'BRA', 'INC A', 'DEC A', 'PHX', 'PHY', 'PLX', 'PLY', 'TSB', 'TRB'):
        return True
    if mn == 'BIT':
        return code.startswith('#') or mode == 'X'
    if mn == 'JMP':
        return re.match(r'\(.*,\s*X\s*\)$', code, re.I) is not None
    return mode == 'ind' and not re.search(r'\)\s*,\s*Y$|,\s*X\s*\)$', code, re.I)


def choose(mn, rest, regs, out, run_zero):
    code, mode = operand(rest)
    if mn == 'STZ':
        if zero(regs.get('A')) or 'A' in run_zero:
            return 'STZ_A'
        if mode == '':
            if zero(regs.get('X')) or 'X' in run_zero:
                return 'STZ_X'
            if zero(regs.get('Y')) or 'Y' in run_zero:
                return 'STZ_Y'
        if {'N', 'Z'} & out:
            return None
        if 'A' not in out:
            return 'STZ_LDA'
        if mode == '' and 'X' not in out:
            return 'STZ_LDX'
        if mode == '' and 'Y' not in out:
            return 'STZ_LDY'
        return None
    if mn == 'BRA':
        for f, one, nought in (('Z', 'EQ', 'NE'), ('C', 'CS', 'CC'), ('N', 'MI', 'PL'), ('V', 'VS', 'VC')):
            if regs.get(f) == '1':
                return 'BRA_' + one
            if regs.get(f) == '0':
                return 'BRA_' + nought
        return 'BRA_JMP'
    if mn in ('INC A', 'DEC A'):
        inc = mn == 'INC A'
        cv_dead = not ({'C', 'V'} & out)
        if cv_dead and regs.get('C') == ('0' if inc else '1'):
            return 'INC_A_ADC' if inc else 'DEC_A_SBC'
        if cv_dead:
            return 'INC_A_CLC' if inc else 'DEC_A_SEC'
        if 'X' not in out:
            return 'INC_A_X' if inc else 'DEC_A_X'
        if 'Y' not in out:
            return 'INC_A_Y' if inc else 'DEC_A_Y'
        return None
    if mn in ('PHX', 'PHY'):
        return mn + '_A' if 'A' not in out and not ({'N', 'Z'} & out) else None
    if mn in ('PLX', 'PLY'):
        return mn + '_A' if 'A' not in out else None
    return None


def sites():
    for dirpath, _, files in os.walk(ANN):
        for f in sorted(files):
            if not f.endswith('.6502'):
                continue
            rel = os.path.relpath(os.path.join(dirpath, f), ANN).replace('\\', '/')
            src = os.path.join(SRC, rel)
            if not os.path.exists(src):
                continue
            # the annotated files end their lines \r\r\n: read raw, split on \n
            a_lines = [l.rstrip('\r') for l in open(os.path.join(dirpath, f), encoding='utf-8', newline='').read().split('\n')]
            s_lines = [l.rstrip('\r') for l in open(src, encoding='utf-8', newline='').read().split('\n')]
            run_zero = set()        # registers an STZ_LD? just zeroed, for the STZs straight after
            for n, (al, sl) in enumerate(zip(a_lines, s_lines), 1):
                code = sl.split('\\')[0].strip()
                st = state(al)
                if st is None:
                    if code.startswith('.') or code.upper().startswith(BLOCK):
                        run_zero = set()
                    continue
                m = INS.match(sl)
                mn = re.sub(r'\s+', ' ', m.group(2).upper()) if m else None
                if not m or not is_cmos(mn, m.group(3)):
                    run_zero = set()
                    continue
                regs, out = st
                form = choose(mn, m.group(3), regs, out, run_zero)
                yield rel, n, sl, mn, form, regs, out
                if mn != 'STZ' or form is None:
                    run_zero = set()
                elif form.startswith('STZ_LD'):
                    run_zero.add(form[-1])


BRA_FLAG = {'EQ': ('Z', '1'), 'NE': ('Z', '0'), 'CS': ('C', '1'), 'CC': ('C', '0'),
            'MI': ('N', '1'), 'PL': ('N', '0'), 'VS': ('V', '1'), 'VC': ('V', '0')}


def holds(form, operand_mode, regs, out, run_zero):
    """Whether a macro's NMOS form is right at a site, from the state before it. V is taken as dead
    everywhere but straight after a BIT (measured over the whole build, 2026-10-24: every BVC/BVS
    follows a BIT), so only the BRA_V* forms ask about it."""
    out = out - {'V'}
    if form in ('STZ_A', 'STZ_X', 'STZ_Y'):
        r = form[-1]
        return zero(regs.get(r)) or r in run_zero
    if form in ('STZ_LDA', 'STZ_LDX', 'STZ_LDY'):
        return not ({'N', 'Z', form[-1]} & out)
    if form.startswith('BRA_'):
        if form == 'BRA_JMP':
            return True
        f, v = BRA_FLAG[form[4:]]
        return regs.get(f) == v
    if form in ('INC_A_ADC', 'DEC_A_SBC'):
        return 'C' not in out and regs.get('C') == ('0' if form == 'INC_A_ADC' else '1')
    if form in ('INC_A_CLC', 'DEC_A_SEC'):
        return 'C' not in out
    if form in ('INC_A_X', 'DEC_A_X', 'INC_A_Y', 'DEC_A_Y'):
        return form[-1] not in out
    if form in ('PHX_A', 'PHY_A'):
        return not ({'A', 'N', 'Z'} & out)
    if form in ('PLX_A', 'PLY_A'):
        return 'A' not in out
    return None         # STZ_PHA, BVC_BIT6, BVS_BIT6: checked by hand only


def check():
    """Every macro site in the annotated build (one without NMOS: each macro there is its 65SC12
    instruction, so the state before it is the analysis's): does its form still hold? A site whose
    comment says (hand) was checked by reading its callers, where the analysis cannot see them."""
    macros = set(COST) | {'STZ_A', 'STZ_X', 'STZ_Y', 'STZ_PHA', 'BVC_BIT6', 'BVS_BIT6'} | {'BRA_' + k for k in BRA_FLAG} | {'BRA_JMP'}
    bad, hand, ok, unseen = [], 0, 0, 0
    for dirpath, _, files in os.walk(ANN):
        for f in sorted(files):
            rel = os.path.relpath(os.path.join(dirpath, f), ANN).replace('\\', '/')
            src = os.path.join(SRC, rel)
            if not f.endswith('.6502') or not os.path.exists(src):
                continue
            a_lines = [l.rstrip('\r') for l in open(os.path.join(dirpath, f), encoding='utf-8', newline='').read().split('\n')]
            s_lines = [l.rstrip('\r') for l in open(src, encoding='utf-8', newline='').read().split('\n')]
            run_zero = set()
            for n, (al, sl) in enumerate(zip(a_lines, s_lines), 1):
                code = sl.split('\\')[0].strip()
                word = code.split()[0] if code else ''
                st = state(al)
                if word not in macros:
                    if code and (st is not None or code.startswith('.') or code.upper().startswith(BLOCK)):
                        run_zero = set()
                    continue
                if st is None:
                    unseen += 1         # not assembled in this build
                    continue
                regs, out = st
                verdict = None if '(hand' in sl else holds(word, operand(code[len(word):])[1], regs, out, run_zero)
                if verdict is None:
                    hand += 1
                elif verdict:
                    ok += 1
                else:
                    bad.append(f"src/{rel}:{n}: {code[:60]}   [{' '.join(k + '=' + v for k, v in regs.items())} out:{''.join(sorted(out)) or '-'}]")
                if word.startswith('STZ_LD'):
                    run_zero.add(word[-1])
                elif not word.startswith('STZ_'):
                    run_zero = set()
    print(f"{ok} hold, {hand} checked by hand, {unseen} not in this build, {len(bad)} NO LONGER HOLD")
    for b in bad:
        print('  ' + b)
    return 1 if bad else 0


def check_nmos():
    """The other half, on an NMOS build's annotation: what each NMOS form reads that its 65SC12
    instruction did not - a flag (BRA_xx's branch, INC_A_ADC/DEC_A_SBC's C) or a register known 0
    (STZ_A/X/Y) - as the NMOS code really leaves it, other NMOS forms included (a CLC/ADC before a
    BRA_CS: render.6502's draw_column, 2026-10-24). The 65SC12 analysis cannot see these, since
    there the flag or register is not read and so may be anything."""
    bad, ok = [], 0
    for dirpath, _, files in os.walk(ANN):
        for f in sorted(files):
            rel = os.path.relpath(os.path.join(dirpath, f), ANN).replace('\\', '/')
            if not f.endswith('.6502'):
                continue
            for n, al in enumerate(open(os.path.join(dirpath, f), encoding='utf-8', newline='').read().split('\n'), 1):
                al = al.rstrip('\r')
                code = al.split(';|')[0].split('\\')[0].strip()
                word = code.split()[0] if code else ''
                st = state(al)
                if st is None:
                    continue
                regs = st[0]
                if '(hand' in al:
                    continue
                if word.startswith('BRA_') and word != 'BRA_JMP':
                    good = '| always |' in al
                elif word in ('STZ_A', 'STZ_X', 'STZ_Y'):
                    good = zero(regs.get(word[-1]))
                elif word in ('INC_A_ADC', 'DEC_A_SBC'):
                    good = regs.get('C') == ('0' if word == 'INC_A_ADC' else '1')
                else:
                    continue
                if good:
                    ok += 1
                else:
                    bad.append(f"src/{rel}:{n}: {code[:60]}   [{' '.join(k + '=' + v for k, v in regs.items())}]")
    print(f"NMOS build: {ok} hold, {len(bad)} DO NOT")
    for b in bad:
        print('  ' + b)
    return 1 if bad else 0


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    cmd = sys.argv[1] if len(sys.argv) > 1 else 'report'
    if cmd == 'check':
        sys.exit(check_nmos() if '--nmos' in sys.argv else check())
    found = list(sites())
    forms = collections.Counter(s[4] or 'MANUAL' for s in found)
    nbytes = sum(COST.get(s[4], (0, 0))[0] for s in found)
    print(f"{len(found)} sites; NMOS forms add at most {nbytes} bytes")
    for k, v in sorted(forms.items()):
        print(f"  {k:10s} {v}")
    for rel, n, sl, mn, form, regs, out in found:
        if form is None or cmd == 'report-all':
            st = ' '.join(k + '=' + v for k, v in regs.items())
            print(f"  {form or 'MANUAL':10s} src/{rel}:{n}: {sl.strip()[:64]}   [{st} out:{''.join(sorted(out)) or '-'}]")
    if cmd != 'apply':
        return
    edits = collections.defaultdict(dict)
    for rel, n, sl, mn, form, regs, out in found:
        if form:
            edits[rel][n] = (mn, form)
    for rel, e in edits.items():
        path = os.path.join(SRC, rel)
        text = open(path, encoding='utf-8', newline='').read()
        nl = '\r\n' if '\r\n' in text else '\n'
        lines = text.split(nl)
        for n, (mn, form) in e.items():
            l = lines[n - 1]
            pat = re.compile(r'^(\s*)' + mn.replace(' ', r'\s+') + (r'(?=\s|$)' if mn.endswith(' A') else r'\b'), re.I)
            new = pat.sub(lambda m: m.group(1) + form, l, count=1)
            assert new != l, (rel, n, l)
            grow = len(new) - len(l)
            mm = re.search(r'\S( {%d,})\\' % (grow + 1), new) if grow > 0 else None
            if mm:          # the comment keeps its column where the gap allows
                new = new[:mm.start(1)] + ' ' * (len(mm.group(1)) - grow) + new[mm.end(1):]
            lines[n - 1] = new
        open(path, 'w', encoding='utf-8', newline='').write(nl.join(lines))
    print(f"applied to {sum(len(e) for e in edits.values())} lines in {len(edits)} files")


main()
