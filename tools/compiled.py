"""
compiled.py - the player's commonest sprite parts as code (step 2 layer 4, KC 2026-10-17: "the
fast path + 8 commonest").

    python tools/compiled.py LAYER2.ssd [OUT_DIR]

Reads the mover sprites and the mask and pixel tables from a disc that still has the game's
run-length sprites (the layer 2 build, as tools/sprites.py does) and writes, into OUT_DIR (src/):
  compiled_bank5.6502, compiled_bank6.6502, compiled_bank7.6502 - each kind's draw and restore
      code, placed in the banks by size (each file ends where its bank's free space must hold it)
  compiled_table.6502 - for bank 4: the kinds (sprite, flip and line), their bank and entries, and
      PLAYER_SAVE_SIZE, the fixed save area they draw into (src/game.6502 puts it before the arena)

A kind is a sprite drawn with a flip and with its bottom row at a given line of a character
cell; render.6502 (ren_draw_sprite) calls one for the player's part when the part is not clipped.
Entry: zero page &C0/&C1 = the cell of the part's bottom row at its left (column j = 0). The code
works out a pointer for each character row the part reaches (each &280 lower round the 16K
screen), checks that no row it writes in the screen's last page runs past &7FFF (returning carry
set, having drawn nothing, if one would: the generic path draws it), then for each byte
    LDY #8 * j + line : LDA (row),Y : STA save + n : AND #mask : EOR #pixel : STA (row),Y
(LDA #pixel for an opaque byte; LDY shared by bytes with the same offset), and returns carry
clear. The restore code puts the saved bytes back the same way. Column c of n is at j = c, or
j = n - 1 - c flipped, as render.6502 draws it; the mask and pixel are the green tables' (the
player's colour) for the flip, as the game leaves them outside the scroll (asserted).
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import sprites  # noqa: E402

BS, NL = chr(92), chr(10)
# the kinds, by the bytes they drew holding RIGHT for 600 passes (tools/drawprof.mjs on 07ef49c,
# 2026-10-17; docs/step2-layer4-costing.md): (sprite, flipped, line of the bottom row)
KINDS = [(0x00, 0, 7), (0x09, 0, 5), (0x09, 0, 3), (0x09, 0, 4), (0x02, 0, 7), (0x03, 0, 7), (0x01, 0, 7), (0x04, 0, 7)]
# and the other 6 of the 14 it drew (KC 2026-10-17: "compile the other 6 running frames"), in HAZEL,
# which the MOS leaves paged in at &C000-&DFFF through play
KINDS_HAZEL = [(0x06, 0, 4), (0x07, 0, 4), (0x05, 0, 5), (0x08, 0, 3), (0x08, 0, 5), (0x05, 0, 3)]
# HAZEL from &C700: below it, &C300 on is read by the scroll's mountain layer as data (tools/hazelreach.mjs)
HAZEL_ORG = 0xC700
HAZEL_CARRY_A = 0xF80                  # bank 5's music area, &9300-&A27F (the tunes are unpacked over it)
HAZEL_CARRY_B = 0x300                  # in the start-up block, below the loading picture (main.6502 ASSERTs)
POINTERS = [0xC0, 0xC2, 0xC9, 0xCB]           # render.6502 scratch zero page, p0 the entry (not &C7: col_ptr, which the fallback needs)
# the room in each bank: from its content's end (the bench build's listing, 07ef49c: bank 5 &B663,
# 6 &B575, 7 &B713) to &BF00 (the shifted test builds keep a page free; main.6502 ASSERTs it)
FREE = {5: 0xBF00 - 0xB663, 6: 0xBF00 - 0xB575, 7: 0xBF00 - 0xB713}
SIZE = {"LDY": 2, "LDA (": 2, "STA (": 2, "LDA #": 2, "AND #": 2, "EOR #": 2, "CMP #": 2, "SBC #": 2, "ADC #": 2,
        "LDA &": 2, "STA &": 2, "LDA P": 3, "STA P": 3, "BCS": 2, "BCC": 2, "BNE": 2, "JMP": 3, "SEC": 1, "CLC": 1, "RTS": 1}


def size_of(lines):
    """the bytes the generated lines assemble to"""
    n = 0
    for ln in lines:
        s = ln.strip()
        if not s or s.startswith(".") or s.startswith(BS):
            continue
        n += next(v for k, v in SIZE.items() if s.startswith(k))
    return n


def kind_bytes(build, sprite, flipped, line):
    """[(row pointer q, Y, index)] for every byte the part draws, and its column count."""
    cols = sprite["straight"]            # (first row, [index, ...] bottom-up) per column
    n = len(cols)
    out = []
    for c, (fr, idx) in enumerate(cols):
        j = n - 1 - c if flipped else c
        for i, v in enumerate(idx):
            r = fr + i                   # rows up from the bottom row, which is at `line`
            t = line - r
            q = 0 if t >= 0 else (-t + 7) // 8
            out.append((q, 8 * j + t + 8 * q, v))
    return out, n


def save_groups(b, sp, kinds):
    """Save areas the kinds can share: two kinds conflict when their sprites are drawn in the same
    frame of the player (type 0: parts_of over every frame), since one draw's parts are saved at
    once; any others never have saves outstanding together (a screen's save is put back before its
    next drawing). Greedy colouring: -> {kind: group}."""
    frames = b.table("mover_types_animation_frame", 0x1C)
    together = set()
    for f in range(max(frames[0], 0x0E)):
        ps = [s for s, _ in sprites.parts_of(b, 0, f)]
        together |= {(x, y) for x in ps for y in ps if x != y}
    group = {}
    for k in kinds:
        used = {group[o] for o in group if (k[0], o[0]) in together}
        group[k] = next(g for g in range(len(kinds)) if g not in used)
    return group


def emit(disc, out_dir):
    b = sprites.Build(disc)
    sp = sprites.load_sprites(b)
    # the tables as render.6502 uses them for the player (green): unflipped &0440 / &04C0,
    # flipped &0400 / &0480; outside the scroll, change_pixel_tables has left KC (&14)
    pix = {0: b.main(0x0440, 64), 1: b.main(0x0400, 64)}
    msk = {0: b.main(0x04C0, 64), 1: b.main(0x0480, 64)}
    assert (pix[0][20], pix[1][40], pix[1][20], pix[0][40], pix[1][60], pix[0][60]) == (0x14, 0x14, 0x28, 0x28, 0x3C, 0x3C), "pixel tables not in the foreground palette"
    c = BS + " "
    kinds = KINDS + KINDS_HAZEL
    group = save_groups(b, sp, kinds)
    # each group's area is as big as its biggest kind's bytes
    built, gsize = [], {}
    for k, (s, fl, line) in enumerate(kinds):
        bytes_, n = kind_bytes(b, sp[s], fl, line)
        drawn = [(q, y, i) for q, y, i in bytes_ if not (msk[fl][i] == 0xFF and pix[fl][i] == 0)]
        g = group[(s, fl, line)]
        gsize[g] = max(gsize.get(g, 0), len(drawn))
        built.append((k, s, fl, line, bytes_, drawn))
    goff, off = {}, 0
    for g in sorted(gsize):
        goff[g] = off
        off += gsize[g]
    code = []
    for k, s, fl, line, bytes_, drawn in built:
        rows = max(q for q, _, _ in bytes_) + 1
        assert rows <= len(POINTERS), (s, fl, line, rows)
        assert all(0 <= y <= 255 for _, y, _ in bytes_)
        name = f"ck{k}_{s:02x}_{'f' if fl else 'u'}{line}"
        save = f"PLAYER_SAVE + {goff[group[(s, fl, line)]]}"
        d, r = [f".{name}_draw", c + f"sprite &{s:02X}{' flipped' if fl else ''}, bottom row at line {line}: {len(drawn)} bytes, {rows} character rows"], [f".{name}_restore"]
        def prologue(tag):               # each row &280 below the last, round the 16K screen
            out = []
            for q in range(1, rows):
                a, z = POINTERS[q - 1], POINTERS[q]
                out += [f"    LDA &{a:02X}", "    SEC", "    SBC #&80", f"    STA &{z:02X}", f"    LDA &{a + 1:02X}", "    SBC #&02",
                        "    CMP #&40", f"    BCS {name}_{tag}{q}", "    ADC #&40", f".{name}_{tag}{q}", f"    STA &{z + 1:02X}"]
            return out
        d += prologue("d")
        r += prologue("r")
        for q in range(rows):            # a row in the last page could run past &7FFF
            ymax = max([y for qq, y, _ in drawn if qq == q] or [0])
            if ymax > 7:
                p = POINTERS[q]
                d += [f"    LDA &{p + 1:02X}", "    CMP #&7F", f"    BNE {name}_ok{q}", f"    LDA &{p:02X}", f"    CMP #&{256 - ymax:02X}",
                      f"    BCC {name}_ok{q}", "    JMP compiled_unsafe", f".{name}_ok{q}"]
        lasty = None
        for nbyte, (q, y, i) in enumerate(sorted(drawn, key=lambda t: (t[1], t[0]))):
            p, m, x = POINTERS[q], msk[fl][i], pix[fl][i]
            if y != lasty:
                d.append(f"    LDY #&{y:02X}")
                r.append(f"    LDY #&{y:02X}")
                lasty = y
            d += [f"    LDA (&{p:02X}),Y", f"    STA {save} + {nbyte}"]
            if m == 0:
                d.append(f"    LDA #&{x:02X}")
            else:
                if m != 0xFF:
                    d.append(f"    AND #&{m:02X}")
                if x:
                    d.append(f"    EOR #&{x:02X}")
            d.append(f"    STA (&{p:02X}),Y")
            r += [f"    LDA {save} + {nbyte}", f"    STA (&{p:02X}),Y"]
        d += ["    CLC", "    RTS"]
        r += ["    RTS"]
        code.append((d + r, size_of(d + r), (s, fl, line, name)))
    nb = len(KINDS)
    # the banks' kinds: every assignment to banks 5-7, the one with the most slack (each bank also
    # has its exit, 2 bytes)
    import itertools
    banks = {5: [], 6: [], 7: []}
    best = None
    for assign in itertools.product(list(banks), repeat=nb):
        u = {bk: 2 for bk in banks}
        for (_, size, _), bk in zip(code[:nb], assign):
            u[bk] += size
        if all(u[bk] <= FREE[bk] for bk in banks):
            slack = min(FREE[bk] - u[bk] for bk in banks)
            if not best or slack > best[0]:
                best = (slack, assign, u)
    assert best, "the banks' kinds do not fit"
    _, assign, used = best
    table = []
    for (lines, _, (s, fl, line, name)), bk in zip(code[:nb], assign):
        banks[bk] += lines
        table.append((s, fl, line, bk, name))
    # HAZEL's kinds: from HAZEL_ORG on, carried in two parts - part A in bank 5's music area
    # (unpacked over it at start-up), part B in the game's start-up block - and copied in there
    pieces, room, size_a, size_b = {"a": [], "b": []}, {"a": HAZEL_CARRY_A - 2, "b": HAZEL_CARRY_B}, 0, 0
    for lines, size, (s, fl, line, name) in code[nb:]:
        part = "a" if size_a + size <= room["a"] else "b"
        assert part == "a" or size_b + size <= room["b"], "HAZEL's kinds do not fit their carriers"
        pieces[part] += lines
        if part == "a": size_a += size
        else: size_b += size
        table.append((s, fl, line, 0, name))
    assert HAZEL_ORG + size_a + 2 + size_b <= 0xE000
    head = [c + "GENERATED by tools/compiled.py from " + Path(disc).name + "; do not edit.",
            c + "The player's commonest sprite parts as code (step 2 layer 4): see the tool's docstring."]
    for bk, lines in banks.items():        # each bank's code, with its own exit for an unsafe row
        body = head + [c + f"Sideways bank {bk}: called through compiled_call (src/game.6502)."]
        body += [ln.replace("compiled_unsafe", f"compiled_unsafe_{bk}") for ln in lines]
        body += [f".compiled_unsafe_{bk}", "    SEC", "    RTS"]
        Path(out_dir, f"compiled_bank{bk}.6502").write_text(NL.join(body) + NL)
    for part in ("a", "b"):
        body = head + [c + f"HAZEL, part {part.upper()}: " + ("from HAZEL_ORG, carried in bank 5's music area" if part == "a" else "after part A, carried in the start-up block") + " (src/main.6502, src/game.6502 unpack_for_play)."]
        body += [ln.replace("compiled_unsafe", "compiled_unsafe_hazel") for ln in pieces[part]]
        if part == "a":
            body += [".compiled_unsafe_hazel", "    SEC", "    RTS"]
        Path(out_dir, f"compiled_hazel_{part}.6502").write_text(NL.join(body) + NL)
    tab = head + [c + "Bank 4: the kinds render.6502 looks up for the player's parts (bank 0: HAZEL, called",
                  c + "directly), and the save area: kinds whose sprites are never drawn together share theirs.",
                  f"COMPILED_KINDS = {len(table)}",
                  f"PLAYER_SAVE_SIZE = {off}",
                  f"HAZEL_ORG = &{HAZEL_ORG:04X}",
                  ".ck_sprite      EQUB " + ", ".join(f"&{s:02X}" for s, _, _, _, _ in table),
                  ".ck_flipline    EQUB " + ", ".join(f"&{(fl << 7) | ln:02X}" for _, fl, ln, _, _ in table) + "    " + BS + " flip << 7 | line",
                  ".ck_bank        EQUB " + ", ".join(f"&{bk:02X}" for _, _, _, bk, _ in table),
                  ".ck_draw_lo     EQUB " + ", ".join(f"LO({nm}_draw)" for *_, nm in table),
                  ".ck_draw_hi     EQUB " + ", ".join(f"HI({nm}_draw)" for *_, nm in table),
                  ".ck_restore_lo  EQUB " + ", ".join(f"LO({nm}_restore)" for *_, nm in table),
                  ".ck_restore_hi  EQUB " + ", ".join(f"HI({nm}_restore)" for *_, nm in table)]
    Path(out_dir, "compiled_table.6502").write_text(NL.join(tab) + NL)
    print(f"{len(table)} kinds, save area {off} bytes in {len(gsize)} shared areas; banks {used} of {FREE}; "
          f"HAZEL &{HAZEL_ORG:04X}: part A {size_a + 2} (of {HAZEL_CARRY_A}), part B {size_b} (of {HAZEL_CARRY_B})")


if __name__ == "__main__":
    emit(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else "src")
