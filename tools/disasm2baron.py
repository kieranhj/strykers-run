"""
disasm2baron.py - turn the annotated Stryker's Run (Enhanced) disassembly into Baron source.

ONE-SHOT. This was run once to create src/game.6502 and src/bank4..7.6502; from then on those
files are the source of truth and are edited by hand. Re-running it overwrites them, so it
refuses to unless given --force. It is kept so the conversion can be audited and repeated
against a corrected disassembly.

    python tools/disasm2baron.py [--force]

What it does:
  * Splits the disassembly into the game binary and the four sideways RAM files.
  * Applies CORRECTIONS: typos in the disassembly's addresses and hex columns, and the bytes
    where the reference build (the Stairway to Hell disc's MGAME, decision 1) differs.
  * Re-decodes every instruction from its hex bytes (tools/m6502.py), so the source assembles
    to exactly those bytes; the text mnemonic is only a cross-check.
  * Labels: every "; name" line becomes .name (duplicated names get an _xxxx address suffix).
  * Operands become symbols where the disassembly gives one:
      - branch, JMP, JSR and absolute operands that land in the program: label (+ offset)
      - a name the disassembly's comment gives for an address that has no label of its own
        (self-modified operands, the high byte of a pair) becomes a symbol defined at that
        address, in the instruction that holds it: `name = * + 1`
      - fixed workspace outside the program (column_buffer, player_buffer...): constants
      - zero page: the comment's name, as a constant (src/zp.6502), where it is unambiguous
      - immediates commented "&XXXX = name": LO(name) / HI(name)
      - hardware and MOS addresses: the names in src/os.6502
  * An absolute instruction whose operand is in zero page (an assembler would shrink it) is
    emitted as raw bytes with the instruction in the comment.
  * The three blocks the game copies down at start-up become rephased nested sections.
Data stays as EQUB; Phase 2 symbolises the pointer tables by hand.
"""
import re
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import m6502  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DISASM = ROOT / 'reference' / 'strykers-run-enhanced-disassembly.txt'
SRC = ROOT / 'src'

# (exact text at the start of a line, replacement). Each must match exactly once.
CORRECTIONS = [
    # typos in the disassembly (checked against both the Disc999 and STH discs)
    ('&19d0 85 c5    STA &cd', '&19d0 85 cd    STA &cd'),
    ('&2187 20 f1 21 JSR', '&2188 20 f1 21 JSR'),
    ('&2287 9e 52 12 STZ', '&2287 9e 57 12 STZ'),
    ('&2402 a6 c3    LDX', '&2403 a6 c3    LDX'),
    ('&3c98 09 80    ORA', '&2c98 09 80    ORA'),
    ('&2d0e 99 00 82 STA', '&2d0f 99 00 82 STA'),
    ('&3367 48 06 36 42 12 60 66 66 66 66 66 66', '&3367 48 06 36 42 12 60 6c 6c 6c 6c 6c 6c'),
    # reference build (STH MGAME): interlace off. The disassembly (and Disc999) have &01.
    ('&4169 01 ; R8: Interlace and delay register',
     '&4169 00 ; R8: Interlace and delay register                     # STH build: &00; disassembly: &01'),
]

# The disassembly's own sections: (name, first line text, bank, org, filename, load)
FILES = [
    ('game',  'Game disassembly', None, 0x0E00),
    ('bank4', '; data1 ',         4, 0x8000),
    ('bank6', '; data2',          6, 0x8000),
    ('bank7', '; data3',          7, 0x8000),
    ('bank5', '; data4',          5, 0x8400),
]

# Address -> name for hardware/MOS operands (must match src/os.6502)
OSNAMES = {}
for line in (SRC / 'os.6502').read_text().splitlines():
    m = re.match(r'^(\w+)\s*=\s*&([0-9A-Fa-f]+)', line)
    if m:
        OSNAMES.setdefault(int(m.group(2), 16), m.group(1))

RX_INS = re.compile(r'^\s*&([0-9a-f]{4}) ((?:[0-9a-f]{2} ){1,3})\s*([A-Z]{3})\b(.*)$')
RX_DAT = re.compile(r'^\s*&([0-9a-f]{4}) ((?:[0-9a-f]{2} ?)+)(.*)$')
RX_LAB = re.compile(r'^\s*; ([A-Za-z_][A-Za-z0-9_]*)\s*(\(.*?\))?\s*(\*\*\*)?\s*(#.*)?$')
RX_MOVE = re.compile(r'^# &([0-9a-f]{4}) - &([0-9a-f]{4}) is moved to &([0-9a-f]{4}) - &([0-9a-f]{4})')
RX_NAMEREF = re.compile(r'^\s*([A-Za-z_][A-Za-z0-9_]*)(?:\s*([+-])\s*(&?[0-9a-fA-F]+))?\s*$')
NOT_NAMES = {'OSBYTE', 'OSWORD', 'OSWRCH', 'OSCLI', 'OSFILE', 'LEFT', 'RIGHT', 'ESCAPE', 'A', 'X', 'Y'}


def parse_num(s):
    return int(s[1:], 16) if s.startswith('&') else int(s)


def comment_name(comment):
    """'; name' or '; name + 3' in an operand comment -> (name, offset) or None."""
    c = comment.split('#')[0].split('***')[0].strip()
    if not c.startswith(';'):
        return None
    c = c[1:].strip()
    if '=' in c or ':' in c:
        return None
    m = RX_NAMEREF.match(c)
    if not m or m.group(1) in NOT_NAMES or m.group(1).upper() == m.group(1):
        return None
    off = 0
    if m.group(2):
        off = parse_num(m.group(3)) * (1 if m.group(2) == '+' else -1)
    return m.group(1), off


class Item:
    """One emitted line: an instruction, a data run, a label, a comment or a section marker."""
    def __init__(self, kind, **kw):
        self.kind = kind
        self.__dict__.update(kw)


def load_lines():
    text = DISASM.read_text(encoding='latin1').split('\n')
    for old, new in CORRECTIONS:
        hits = [i for i, l in enumerate(text) if l.startswith(old)]
        if len(hits) != 1:
            sys.exit(f'correction {old!r} matched {len(hits)} lines')
        i = hits[0]
        text[i] = new + text[i][len(old):]
    return text


def split_files(text):
    starts = []
    for name, marker, bank, org in FILES:
        hits = [i for i, l in enumerate(text) if l.startswith(marker)]
        if len(hits) != 1:
            sys.exit(f'section marker {marker!r} matched {len(hits)} lines')
        starts.append(hits[0])
    out = {}
    for k, (name, marker, bank, org) in enumerate(FILES):
        nxt = sorted(s for s in starts if s > starts[k])
        end = nxt[0] if nxt else len(text)
        out[name] = (starts[k], text[starts[k]:end])
    return out


def parse(name, base, lines):
    """-> list of Items in text order, with .space set to the runtime address space."""
    items = []
    pending_labels = []
    reloc = None         # (load_lo, run_lo, run_hi) while inside a moved block
    for n, raw in enumerate(lines, base + 1):
        line = raw.rstrip()
        m = RX_MOVE.match(line)
        if m:
            load_lo, load_hi, run_lo, run_hi = (int(g, 16) for g in m.groups())
            if reloc:
                items.append(Item('reloc_close', line=n))
            reloc = (load_lo, run_lo, run_hi)
            items.append(Item('reloc_open', load=load_lo, run=run_lo, run_hi=run_hi, line=n))
            continue
        mi = RX_INS.match(line)
        md = None if mi else RX_DAT.match(line)
        if mi or md:
            addr = int((mi or md).group(1), 16)
            if reloc and not (reloc[1] <= addr <= reloc[2]):
                items.append(Item('reloc_close', line=n))
                reloc = None
            for lab, extra in pending_labels:
                items.append(Item('label', name=lab, addr=addr, extra=extra, line=n))
            pending_labels = []
            if mi:
                bs = [int(b, 16) for b in mi.group(2).split()]
                rest = mi.group(4)
                items.append(Item('ins', addr=addr, bytes=bs, mn=mi.group(3), rest=rest, line=n))
            else:
                bs = [int(b, 16) for b in md.group(2).split()]
                items.append(Item('data', addr=addr, bytes=bs, rest=md.group(3), line=n))
            continue
        ml = RX_LAB.match(line)
        if ml and not line.strip().startswith('; data'):
            extra = ' '.join(x for x in (ml.group(2), ml.group(3), ml.group(4)) if x)
            pending_labels.append((ml.group(1), extra))
            continue
        # any other line: keep as a comment (blank lines too)
        items.append(Item('comment', text=line, line=n))
    if reloc:
        items.append(Item('reloc_close', line=len(lines) + base))
    # Labels not followed by any address become comments.
    for lab, extra in pending_labels:
        items.append(Item('comment', text='; ' + lab + (' ' + extra if extra else ''), line=0))
    return items


def build_tables(files):
    """Global label table: space -> {addr: [names]}; also the byte map of each file."""
    labels = []          # (file, addr, name, item)
    counts = defaultdict(int)
    for fname, items in files.items():
        for it in items:
            if it.kind == 'label':
                counts[it.name] += 1
    for fname, items in files.items():
        for it in items:
            if it.kind == 'label':
                if counts[it.name] > 1:
                    it.name = f'{it.name}_{it.addr:04x}'
                labels.append((fname, it.addr, it.name, it))
    return labels


def space_of(fname):
    return 'game' if fname == 'game' else fname


def main():
    if (SRC / 'game.6502').exists() and '--force' not in sys.argv:
        sys.exit('src/game.6502 exists and is hand-maintained now; pass --force to overwrite')
    text = load_lines()
    parts = split_files(text)
    files = {name: parse(name, base, lines) for name, (base, lines) in parts.items()}
    # &46E0-&46FF: the disassembly's 'unused' tail is, in the reference build, MGAME's own
    # copy-down stub - main.6502 carries it as code.
    files['game'] = [it for it in files['game']
                     if not (it.kind in ('ins', 'data', 'label') and it.addr >= 0x46E0)]
    labels = build_tables(files)

    # Byte extents per file: which addresses each file's code/data occupies (runtime space)
    occupied = {f: {} for f in files}       # addr -> item
    for f, items in files.items():
        for it in items:
            if it.kind in ('ins', 'data'):
                for k in range(len(it.bytes)):
                    a = it.addr + k
                    if a in occupied[f]:
                        print(f'warning: {f} &{a:04x} defined twice (line {it.line})')
                    occupied[f][a] = it
    # load-address view of the moved blocks (the game's init code copies from there)
    moved = []           # (load_lo, run_lo, run_hi, label name)
    for it in files['game']:
        if it.kind == 'reloc_open':
            moved.append((it.load, it.run, it.run_hi, f'moved_{it.run:04x}_load'))

    lab_by_file = defaultdict(dict)         # file -> addr -> first label name
    names_global = {}
    for f, a, nm, it in labels:
        lab_by_file[f].setdefault(a, nm)
        names_global[nm] = (f, a)
    sorted_labs = {f: sorted(d.items()) for f, d in lab_by_file.items()}

    # ---- names from operand comments ----
    # Collect (name, address) claims per file group. game + banks share one assembly.
    claims = defaultdict(set)        # name -> {(space, addr)}
    zp_claims = defaultdict(set)     # name -> {addr}
    for f, items in files.items():
        for it in items:
            if it.kind != 'ins':
                continue
            d = m6502.decode(bytes(it.bytes) + b'\0\0', 0)
            if d is None:
                continue
            mn, mode, v, n = d
            cp = it.rest.find(';')
            cn = comment_name(it.rest[cp:]) if cp >= 0 else None
            if not cn or mode in ('imp', 'acc', 'imm', 'rel'):
                continue
            nm, off = cn
            target = v - off
            if m6502.MODES[mode][0] == 1:
                zp_claims[nm].add(target)
            else:
                claims[nm].add((f, target))

    def owner_file(f, v):
        """Which file's bytes hold runtime address v, seen from code in file f."""
        if v in occupied[f]:
            return f
        if v in occupied['game'] and v < 0x8000:
            return 'game'
        return None

    # Symbols to define inside instructions/data (name -> (file, addr)), and constants.
    inner = {}
    consts = {}
    for nm, cl in claims.items():
        if nm in names_global or nm in OSNAMES.values():
            continue
        if len(cl) != 1:
            continue
        (f, a), = cl
        of = owner_file(f, a)
        if of is not None:
            if a not in lab_by_file[of]:
                inner[nm] = (of, a)
        elif a >= 0x100 and a not in OSNAMES:
            consts[nm] = a
    zp_consts = {}
    for nm, s in zp_claims.items():
        if len(s) == 1 and nm not in names_global and nm not in inner and nm not in consts:
            (a,) = s
            if not any(lo <= a <= hi for (_, lo, hi, _) in moved):
                zp_consts[nm] = a
    inner_at = defaultdict(list)   # (file, addr) -> [names]
    for nm, (f, a) in inner.items():
        inner_at[(f, a)].append(nm)

    def sym_for(f, v, cn, allow_offset=True):
        """Best symbolic expression for absolute address v used by code in file f."""
        if cn:
            nm, off = cn
            for cand in (nm,):
                ref = None
                if cand in names_global:
                    lf, la = names_global[cand]
                    if (lf == f or lf == 'game' or f == 'game') and la + off == v and owner_file(f, la) == lf:
                        ref = cand
                if cand in inner and inner[cand][1] + off == v:
                    ref = cand
                if cand in consts and consts[cand] + off == v:
                    ref = cand
                if ref:
                    return ref + (f' + {off}' if off > 0 else f' - {-off}' if off < 0 else '')
        if v in OSNAMES:
            return OSNAMES[v]
        in_init = f == 'game' and 0x4000 <= cur_addr[0] < 0x4700
        for (lo, rlo, rhi, lname) in moved:
            if lo <= v <= lo + (rhi - rlo) and in_init:
                return f'{lname} + &{v - lo:02X}' if v != lo else lname
        if 0x4000 <= v < 0x8000 and not in_init:
            return None          # the screen (&4000-&7FFF), not the init code under it
        of = owner_file(f, v)
        if of is None:
            return None
        if v in lab_by_file[of]:
            return lab_by_file[of][v]
        if not allow_offset:
            return None
        # nearest label at or below v in the same file and the same contiguous run
        best = None
        for a, nm in sorted_labs[of]:
            if a <= v:
                best = (a, nm)
            else:
                break
        if best is None:
            return None
        a, nm = best
        # must be contiguous bytes from a to v in that file
        if all((x in occupied[of]) for x in range(a, v + 1)):
            return f'{nm} + {v - a}'
        return None

    def fmt_hex(v, w):
        return '&%0*X' % (w, v)

    stats = defaultdict(int)

    def emit_file(f, items):
        out = []
        bank = next(b for (n, _, b, _) in FILES if n == f)
        org = next(o for (n, _, _, o) in FILES if n == f)
        indent = '    '
        pc = None
        first = True
        for it in items:
            if it.kind == 'comment':
                t = it.text
                if not t.strip():
                    out.append('')
                elif t.startswith(';') or t.startswith('#'):
                    out.append('\\ ' + t)
                else:
                    out.append('\\ ' + t.strip())
                continue
            if it.kind == 'reloc_open':
                out.append('')
                out.append(f'.moved_{it.run:04x}_load     \\ carried in the file at &{it.load:04X}, '
                           f'copied to &{it.run:04X}-&{it.run_hi:04X} at start-up')
                out.append(f'SECTION moved_{it.run:04x}, org = &{it.run:04X}, cmos = TRUE')
                pc_save[0] = pc
                pc = it.run
                continue
            if it.kind == 'reloc_close':
                out.append('ENDSECTION')
                out.append('')
                pc = None
                continue
            if it.kind == 'label':
                if pc is not None and it.addr != pc:
                    out.append(f'\\ !!! gap: expected &{pc:04X}')
                    stats['gap'] += 1
                out.append(f'.{it.name}' + (f'    \\ {it.extra}' if it.extra else ''))
                continue
            if pc is not None and it.addr != pc:
                if it.addr > pc and it.addr - pc < 0x200 and False:
                    pass
                out.append(f'    ASSERT * = &{it.addr:04X}    \\ !!! discontinuity')
                stats['discontinuity'] += 1
            pc = it.addr
            cur_addr[0] = it.addr
            # symbols defined at addresses inside this item
            for k in range(len(it.bytes)):
                for nm in inner_at.get((f, it.addr + k), []):
                    out.append(f'{nm} = * + {k}' if k else f'{nm} = *')
            if it.kind == 'data':
                rest = it.rest.strip()
                body = 'EQUB ' + ', '.join('&%02X' % b for b in it.bytes)
                out.append(indent + body + ('    \\ ' + rest.lstrip(';').strip() if rest else ''))
                pc += len(it.bytes)
                continue
            # instruction
            bs = it.bytes
            d = m6502.decode(bytes(bs) + b'\0\0', 0)
            if d is None or d[3] != len(bs) or d[0] != it.mn:
                stats['badins'] += 1
                out.append(indent + 'EQUB ' + ', '.join('&%02X' % b for b in bs) +
                           f'    \\ !!! does not decode as {it.mn}: {it.rest.strip()}')
                pc += len(bs)
                continue
            mn, mode, v, n = d
            if mode == 'rel':
                v = (it.addr + 2 + (bs[1] - 256 if bs[1] >= 128 else bs[1])) & 0xFFFF
            rest = it.rest
            # split the text after the mnemonic into operand text and comment
            cpos = rest.find(';')
            mc = re.search(r';|\s{2,}(#|\*\*\*)', rest)
            comment = rest[mc.start():].strip() if mc else ''
            cn = comment_name(rest[cpos:]) if cpos >= 0 else None
            # drop a leading "; name" that only repeats the operand's symbol
            mcn = re.match(r';\s*[A-Za-z_]\w*(\s*[+-]\s*&?[0-9a-fA-F]+)?\s*', comment)
            if mcn and cn:
                comment = comment[mcn.end():].strip()
            comment = comment.lstrip(';').strip()
            if comment.startswith('#'):
                comment = comment[1:].strip()
            comment = comment.replace('*** #', '***')
            opw = m6502.MODES[mode][0]
            operand = None
            raw = False
            if v is None:
                operand = ''
            elif mode == 'imm':
                operand = '#' + fmt_hex(v, 2)
                m = re.search(r';\s*&([0-9a-f]{4}) = ([A-Za-z_]\w*)', rest)
                if m:
                    full = int(m.group(1), 16)
                    s = sym_for(f, full, (m.group(2), 0))
                    if s and (full & 0xFF) == v:
                        operand = f'#LO({s})'
                        stats['imm_sym'] += 1
                    elif s and (full >> 8) == v:
                        operand = f'#HI({s})'
                        stats['imm_sym'] += 1
            elif mode == 'rel':
                s = sym_for(f, v, cn)
                if s is None:
                    s = fmt_hex(v, 4)
                    stats['rel_num'] += 1
                operand = s
            elif opw == 1:
                s = None
                if cn and cn[0] in zp_consts and zp_consts[cn[0]] + cn[1] == v:
                    s = cn[0] + (f' + {cn[1]}' if cn[1] else '')
                elif v in OSNAMES:
                    s = OSNAMES[v]
                elif f == 'game' or True:
                    for (lo, rlo, rhi, lname) in moved:
                        if rlo <= v <= rhi and rhi < 0x100:
                            s = sym_for('game', v, cn)
                if s is None:
                    s = fmt_hex(v, 2)
                    stats['zp_num'] += 1
                else:
                    stats['zp_sym'] += 1
                operand = m6502.MODES[mode][1].format(s)
            else:
                if v < 0x100 and m6502.shrinks(mn, mode):
                    raw = True
                s = sym_for(f, v, cn)
                if s is None:
                    s = fmt_hex(v, 4)
                    stats['abs_num'] += 1
                else:
                    stats['abs_sym'] += 1
                operand = m6502.MODES[mode][1].format(s)
            line = mn + (' ' + operand if operand else '')
            if mode == 'acc':
                line = mn + ' A'
            if raw:
                out.append(indent + f'EQUB &{bs[0]:02X} : EQUW {s}    \\ {line} - absolute, not zero page' +
                           (f'  {comment}' if comment else ''))
                stats['raw_abs_zp'] += 1
            else:
                out.append((indent + f'{line:<32}' + ('\\ ' + comment if comment else '')).rstrip())
            pc += len(bs)
        return out

    pc_save = [None]
    cur_addr = [0]
    SRC.mkdir(exist_ok=True)
    header = ('\\ {name}.6502 - {what}\n'
              '\\\n'
              '\\ Created once by tools/disasm2baron.py from reference/strykers-run-enhanced-disassembly.txt\n'
              '\\ (lines starting "\\ " carry the disassembly\'s annotations). Hand-maintained from here on.\n'
              '\\ This file is INCLUDEd inside its SECTION by src/main.6502.\n\n')
    whats = {
        'game': 'the main game binary (MGAME), assembled at &0E00',
        'bank4': 'sideways RAM bank 4 (DATA1): scenery and mover sprites',
        'bank5': 'sideways RAM bank 5 (DATA2, from &8400): title screen, high scores, music',
        'bank6': 'sideways RAM bank 6 (DATA3): scenery sprites',
        'bank7': 'sideways RAM bank 7 (DATA4): scenery sprites',
    }
    for f, items in files.items():
        body = emit_file(f, items)
        (SRC / f'{f}.6502').write_text(header.format(name=f, what=whats[f]) + '\n'.join(body) + '\n')

    # zero page and fixed workspace constants
    zl = ['\\ zp.6502 - zero page names and fixed workspace outside the program.',
          '\\',
          '\\ Created once by tools/disasm2baron.py from the disassembly\'s operand comments: the game',
          '\\ reuses zero page freely, so one address often has several names, each the one the',
          '\\ disassembly uses in that routine. Hand-maintained from here on.', '',
          '\\ ---- zero page ----']
    for nm, a in sorted(zp_consts.items(), key=lambda x: (x[1], x[0])):
        zl.append(f'{nm:<44} = &{a:02X}')
    zl += ['', '\\ ---- fixed workspace (not part of any file) ----']
    for nm, a in sorted(consts.items(), key=lambda x: (x[1], x[0])):
        zl.append(f'{nm:<44} = &{a:04X}')
    (SRC / 'zp.6502').write_text('\n'.join(zl) + '\n')
    print(dict(stats))
    print(f'labels {len(labels)}, inner symbols {len(inner)}, zp names {len(zp_consts)}, '
          f'workspace constants {len(consts)}')


if __name__ == '__main__':
    main()
