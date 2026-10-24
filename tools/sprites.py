"""
sprites.py - the mover sprites, converted from the game's run-length format into a straight
column format for the masked renderer (step 2 layer 3, option A1), and measured.

    python tools/sprites.py stats  [build/strykers.ssd]
    python tools/sprites.py emit   [build/strykers.ssd] [src/sprite_columns.6502]
    python tools/sprites.py straight [build/strykers.ssd] [src/sprite_straight.6502] [src/sprite_andy.6502]

Every command reads a disc that still has the game's run-length mover sprites, which layer 3
removed: the layer 2 build (the tag step2-layer2-shadow-double-buffer). Reads the built disc and its symbol dump (the .ssd's .symbols.json): MGAME (main RAM from
&0E00, the copied-down &0400 block via moved_0400_load) and DATA1 (sideways bank 4 from &8000).
The run-length format (src/game.6502 unpack_column_of_sprite): a column is a header byte, then
entries - 1x...... runs of 1 or 3, 01...... of 2, 00nnnnnn then an index byte: a run of n - then
0; after the 0 a negative byte ends the sprite, anything else heads the next column. Rows run
upwards from the sprite's screen address (its bottom row). Each byte's low 6 bits index the pixel
and mask tables (&0440 and &04C0 unflipped green; the mask depends only on the flip).

The straight format, per sprite: per column the first row drawn (rows up from the bottom) and the
count, leading and trailing transparent bytes (mask &FF, pixel 0) trimmed, then the index bytes
top-down, so one Y register indexes the data, the screen's character cell and the save block
together. The columns follow one another; a flipped sprite's are placed from the right
(render.6502's ren_draw_sprite).

stats: per-sprite and per-mover-type sizes, including each type's largest save-under (the sum
over its parts of the bytes drawn, in its largest frame) and largest save block (render.6502's
layout: a 4-byte header, then a 3-byte record and 8 bytes a cell for each column), which sizes
MAX_BLOCK. 636 bytes at most, on the step2-layer2-shadow-double-buffer build, 2026-10-17.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import dfs  # noqa: E402

GAME_ORG = 0x0E00
BS, NL = chr(92), chr(10)          # a backslash and a newline, for the generated source


class Build:
    def __init__(self, disc):
        self.disc = Path(disc)
        self.files = dfs.game_files(self.disc)          # unpacked on a packed disc (tools/packdisc.py)
        doc = json.loads(self.disc.with_suffix(".symbols.json").read_text())
        self.sym = {}
        for sec in doc["assemblies"][0]["sections"]:
            for k, v in (sec.get("labels") or {}).items():
                if isinstance(v, dict) and isinstance(v.get("value"), int):
                    self.sym.setdefault(k, v["value"])
        self.mgame = self.files["MGAME"].data
        self.bank4 = self.files["DATA1"].data
        moved = self.sym["moved_0400_load"] - GAME_ORG

        def main(addr, n=1):
            if 0x0400 <= addr < 0x0800:                     # the copied-down block
                off = moved + addr - 0x0400
            else:
                off = addr - GAME_ORG
            return self.mgame[off:off + n]
        self.main = main
        self.pix = main(0x0440, 64)
        self.msk = main(0x04C0, 64)

    def table(self, name, n):
        return list(self.main(self.sym[name], n))

    def sprite_bytes(self, addr):
        if addr >= 0x8000:
            return self.bank4[addr - 0x8000:]
        return self.mgame[addr - GAME_ORG:]

    def transparent(self, i):
        return self.msk[i] == 0xFF and self.pix[i] == 0


def decode(data):
    """[[index, ...] per column, bottom-up], and the run-length data's length."""
    y, cols = 1, []
    while True:
        rows = []
        while True:
            b = data[y]
            if b == 0:
                y += 1
                break
            if b & 0x80:
                run, idx, y = (3 if b & 0x40 else 1), b & 0x3F, y + 1
            elif b & 0x40:
                run, idx, y = 2, b & 0x3F, y + 1
            else:
                run, idx, y = b, data[y + 1] & 0x3F, y + 2
            rows += [idx] * run
        cols.append(rows)
        if data[y] & 0x80:
            return cols, y + 1
        y += 1


def straight(build, cols):
    """[(first_row, [index, ...])] per column, transparent ends trimmed."""
    out = []
    for rows in cols:
        lo, hi = 0, len(rows)
        while lo < hi and build.transparent(rows[lo]):
            lo += 1
        while hi > lo and build.transparent(rows[hi - 1]):
            hi -= 1
        out.append((lo, rows[lo:hi]))
    return out


def load_sprites(build):
    n = build.sym["unflipped_mover_sprite_addresses_high_table"] - build.sym["unflipped_mover_sprite_addresses_low_table"]
    lo = build.table("unflipped_mover_sprite_addresses_low_table", n)
    hi = build.table("unflipped_mover_sprite_addresses_high_table", n)
    sprites = {}
    for i in range(n):
        addr = lo[i] | hi[i] << 8
        if addr < 0x3000:                                    # the unused entries
            continue
        cols, rle = decode(build.sprite_bytes(addr))
        sprites[i] = {"addr": addr, "cols": cols, "rle": rle, "straight": straight(build, cols)}
    return sprites


def parts_of(build, mtype, frame):
    """[(sprite, rows up)] for a mover type and frame, as plot_mover chooses them."""
    T = lambda name, n=0x40: build.table(name, n)  # noqa: E731
    first = T("mover_types_first_sprite_animation_offsets")
    parts = T("mover_types_parts", 0x1C)
    second = T("mover_types_second_sprite_offset", 0x1C)
    third = T("mover_types_third_sprite", 5)
    anim = T("animation_table", 0x100)
    yoff = T("sprites_y_offset", 0x40)
    out = [(anim[(frame + first[mtype]) & 0xFF], 0)]
    if parts[mtype] >= 2:
        return out
    y = yoff[(frame + second[mtype]) & 0xFF]
    out.append((anim[(frame + first[mtype + 0x1C]) & 0xFF], y))
    if parts[mtype] != 0:
        return out
    out.append((third[mtype], y + 8))
    return out


def stats(disc):
    b = Build(disc)
    sprites = load_sprites(b)
    total = sum(sum(len(c) for _, c in s["straight"]) for s in sprites.values())
    cols = sum(len(s["straight"]) for s in sprites.values())
    rle = sum(s["rle"] for s in sprites.values())
    where = {"bank 4": 0, "main": 0}
    for s in sprites.values():
        where["bank 4" if s["addr"] >= 0x8000 else "main"] += s["rle"]
    print(f"{len(sprites)} mover sprites: run-length {rle} bytes ({where}); straight {total} index bytes "
          f"in {cols} columns (+{2 * cols} column headers, +{2 * cols} column pointers)")
    frames = b.table("mover_types_animation_frame", 0x1C)
    def block(sp):          # render.6502's save block: a 3-byte record a column, 8 bytes a cell (the worst line)
        return sum(8 * ((len(c) + 7 + 7) // 8) + 3 for _, c in sprites[sp]["straight"] if c)
    print("type  parts  frames  largest save-under (bytes drawn)  columns  largest save block")
    for t in range(0x1C):
        nf = max(frames[t], 0x0E if t < 5 else 0)           # soldiers' and the player's special frames
        best, worst_block = (0, 0, 0), 0
        for f in range(nf):
            ps = parts_of(b, t, f)
            if any(sp not in sprites for sp, _ in ps):
                continue
            size = sum(sum(len(c) for _, c in sprites[sp]["straight"]) for sp, _ in ps)
            ncol = max(len(sprites[sp]["straight"]) for sp, _ in ps)
            best = max(best, (size, f, ncol))
            worst_block = max(worst_block, 4 + sum(block(sp) for sp, _ in ps))   # + the 4-byte header
        print(f"  {t:02X}  {len(parts_of(b, t, 0))}      {nf:2}      {best[0]:4} (frame {best[1]:X})                  {best[2]:2}       {worst_block:4}")


def emit(disc, out):
    """src/sprite_columns.6502: generated from the build, checked in (the sprite data never changes)."""
    b = Build(disc)
    sprites = load_sprites(b)
    n = max(sprites) + 1
    counts = [len(sprites[i]["cols"]) if i in sprites else 0 for i in range(n)]
    c = BS + " "
    lines = [c + f"sprite_columns.6502 - GENERATED by tools/sprites.py emit from {Path(disc).name}; do not edit.",
             c + "Included in sideways bank 4 (src/main.6502). The mover sprites' column counts, by sprite",
             c + "number (unflipped_mover_sprite_addresses_*_table; 0 = unused): what walk_column needs to",
             c + "leave the bytes unpack_column_of_sprite would have left (step 2 layer 3, option C).",
             ".sprite_column_count"]
    for i in range(0, n, 16):
        lines.append("    EQUB " + ", ".join(f"&{v:02X}" for v in counts[i:i + 16]) + f"    {c}&{i:02X}")
    Path(out).write_text(NL.join(lines) + NL)
    print(f"wrote {out}: {n} sprites")



UNUSED = (0x30, 0x31, 0x32)     # table entries that point at leftovers, never drawn (src/game.6502)
ANDY_SIZE = 0x1000


def emit_straight(disc, out_bank4, out_andy):
    """The straight format, for the masked renderer (step 2 layer 3, option A1).

    Per sprite, its columns in order: the first row drawn (rows up from the sprite's bottom
    row), the count, then the index bytes TOP-DOWN (so one Y register indexes the data, the
    screen's character cell and the save buffer together: render.6502 draw_column). The
    sprites fill ANDY (&8000-&8FFF, src/sprite_andy.6502, copied in at start-up) and then
    sideways bank 4 (src/sprite_straight.6502, which also has the pointer tables)."""
    b = Build(disc)
    sprites = load_sprites(b)
    n = max(sprites) + 1
    c = BS + " "
    head = [c + "GENERATED by tools/sprites.py straight from " + Path(disc).name + "; do not edit.",
            c + "The mover sprites in the masked renderer's straight format (step 2 layer 3, option A1):",
            c + "per column the first row drawn (up from the bottom), the count, then the pixel/mask",
            c + "table indices top-down. Decoded from the game's run-length data."]
    andy, bank4, where, used = [], [], {}, 0
    for i in range(n):
        if i not in sprites or i in UNUSED:
            continue
        body = []
        for fr, idx in sprites[i]["straight"]:
            body += [fr, len(idx)] + list(reversed(idx))
        target = andy if used + len(body) <= ANDY_SIZE else bank4
        if target is andy:
            used += len(body)
        where[i] = "andy" if target is andy else "bank 4"
        target.append(f".straight_{i:02x}")
        for k in range(0, len(body), 16):
            target.append("    EQUB " + ", ".join(f"&{v:02X}" for v in body[k:k + 16]))
    ptr = [f"straight_{i:02x}" if i in where else "0" for i in range(n)]
    tables = [".straight_sprite_lo"] + ["    EQUB " + ", ".join(f"LO({p})" for p in ptr[k:k + 8]) for k in range(0, n, 8)]
    tables += [".straight_sprite_hi"] + ["    EQUB " + ", ".join(f"HI({p})" for p in ptr[k:k + 8]) for k in range(0, n, 8)]
    Path(out_bank4).write_text(NL.join(head + [c + "Sideways bank 4: the pointer tables, then the sprites ANDY had no room for."]
                                       + tables + bank4) + NL)
    Path(out_andy).write_text(NL.join(head + [c + f"ANDY (&8000-&8FFF): {used} bytes."] + andy) + NL)
    print(f"wrote {out_bank4} ({sum(1 for v in where.values() if v == 'bank 4')} sprites) and "
          f"{out_andy} ({sum(1 for v in where.values() if v == 'andy')} sprites, {used} bytes)")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "stats"
    disc = sys.argv[2] if len(sys.argv) > 2 else "build/strykers.ssd"
    if cmd == "stats":
        stats(disc)
    elif cmd == "straight":
        emit_straight(disc, sys.argv[3] if len(sys.argv) > 3 else "src/sprite_straight.6502",
                      sys.argv[4] if len(sys.argv) > 4 else "src/sprite_andy.6502")
    elif cmd == "emit":
        emit(disc, sys.argv[3] if len(sys.argv) > 3 else "src/sprite_columns.6502")
    else:
        sys.exit(f"unknown command {cmd}")
