"""
ditherhills.py - the mountain sprites with their hill ranges dithered (DITHER_HILLS, an experiment).

    python tools/ditherhills.py [build/strykers.ssd] [--out src] [--show DIR]

The hills band is the mountain layer: MOUNTAINS_TWO (and on a real Master, where HAZEL picks the
records, MOUNTAINS_ONE too), 12-column sprites laid end to end at y 23. Each draws the snow and
three ridge lines over transparent colour 0, which the palette split shows as magenta below row
111. The ridges close the transparent pixels into regions in three tiers - far, mid, fore - and
this fills each tier with an ordered (Bayer 4x4) dither of its own colour in place of colour 0:

    far   blue (logical 4), 4/16
    mid   red  (logical 1), 2/16 (KC tried blue, 2026-10-22)
    fore  red  (logical 1), 6/16 (KC tried green, 2026-10-22)

(the mock KC chose, 2026-10-22: "Cool far, warm near"). Pixels the pattern leaves off stay colour
0, so the band keeps its magenta between the dots, and whatever the later layers draw goes over
it as before. The regions are found on the sprite tiled three times (as it is drawn, end to end)
and taken from the middle copy, so a region that runs over a sprite's edge is classed as a whole.
Pattern phase: x from the sprite's first pixel (12 columns is 24 pixels, a multiple of 4, so the
pattern runs on across sprites), y from the buffer row (the layer's y is fixed).

Reads the original sprites from the build (unflipped addresses, the sprite's bank) and writes them
re-encoded, one file each (src/hills_dither_one.6502, _two), in the sprites' own run-length format (docs/level-format.md): per column the previous
column's length, the runs, 0; after the last column &80 + its length. `scenery_sprite_0N_last`
is the last column's offset, for the flipped address tables. Checked by re-encoding the original
sprites to their own bytes, and by decoding what it writes.
"""
import argparse, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from worldmap import Build, Scenery, decode_column, SPLIT_ROW, ROWS  # noqa: E402

SPRITES = {4: "MOUNTAINS_ONE", 5: "MOUNTAINS_TWO"}
Y0 = 23                                 # the mountain layer's y (tools/worldmap.py's runs: all at 23)
B4 = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]
TIERS = [(4, 4), (1, 2), (1, 6)]        # (colour, density of 16): far, mid, fore (KC, 2026-10-22; tried: mid blue, fore green)
# a region's tier by its mean screen row (rows from the top): about 129 far, 145 mid, 166 fore in
# the mocks (tools/worldmap.py crops at columns 400 and 2000)
FAR_BELOW, MID_BELOW = 137, 156


def colours(i):
    """A pixel index's (left, right) logical colours: bits 5, 3, 1 the left, 4, 2, 0 the right."""
    left = (i >> 5 & 1) << 2 | (i >> 3 & 1) << 1 | (i >> 1 & 1)
    right = (i >> 4 & 1) << 2 | (i >> 2 & 1) << 1 | (i & 1)
    return left, right


def index(left, right):
    i = 0
    for b in range(3):
        i |= (left >> b & 1) << (2 * b + 1) | (right >> b & 1) << (2 * b)
    return i


def read_sprite(build, sc, s):
    bank = sc.banks[s]
    rd = lambda a: build.read(a, bank)  # noqa: E731
    a = sc.ulo[s] | sc.uhi[s] << 8
    start, cols = a, []
    while True:
        rows, nxt = decode_column(rd, a)
        cols.append(rows)
        if rd(nxt) & 0x80:
            return start, cols, bytes(rd(x) for x in range(start, nxt + 1))
        a = nxt


def encode(cols):
    out, last, offsets = bytearray(), 0, []
    for rows in cols:
        col = bytearray([last])
        i = 0
        while i < len(rows):
            j = i
            while j < len(rows) and rows[j] == rows[i] and j - i < 63:
                j += 1
            n, v = j - i, rows[i]
            col += bytes([0x80 | v]) if n == 1 else bytes([0x40 | v]) if n == 2 else bytes([0xC0 | v]) if n == 3 else bytes([n, v])
            i = j
        col.append(0)
        offsets.append(len(out))
        out += col
        last = len(col)
    out.append(0x80 | last)
    return bytes(out), offsets[-1]


def dither(cols):
    """The columns' indices with each hill tier's transparent pixels patterned."""
    W, H = len(cols), max(len(c) for c in cols)
    T = 3                               # tiles: the sprite end to end, regions from the middle one
    PX = 2 * W
    grid = [[0] * (PX * T) for _ in range(H)]
    for t in range(T):
        for c, rows in enumerate(cols):
            for r, i in enumerate(rows):
                L, R = colours(i)
                grid[r][t * PX + 2 * c], grid[r][t * PX + 2 * c + 1] = L, R
    tier = [[-1] * (PX * T) for _ in range(H)]
    seen = [[False] * (PX * T) for _ in range(H)]
    for r0 in range(H):
        for x0 in range(PX * T):
            if grid[r0][x0] or seen[r0][x0]:
                continue
            st, pts, top = [(r0, x0)], [], False
            seen[r0][x0] = True
            while st:
                r, x = st.pop()
                pts.append((r, x))
                top |= r == H - 1
                for dr, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    rr, xx = r + dr, x + dx
                    if 0 <= rr < H and 0 <= xx < PX * T and not grid[rr][xx] and not seen[rr][xx]:
                        seen[rr][xx] = True
                        st.append((rr, xx))
            mean = sum(ROWS - 1 - (Y0 + r) for r, _ in pts) / len(pts)      # screen row
            if top or mean < SPLIT_ROW:
                continue                # sky: open to the top, or above the split
            k = 0 if mean < FAR_BELOW else 1 if mean < MID_BELOW else 2
            for r, x in pts:
                tier[r][x] = k
    out = []
    for c, rows in enumerate(cols):
        new = []
        for r in range(len(rows)):
            px = []
            for h in range(2):
                x = PX + 2 * c + h
                v = grid[r][x]
                k = tier[r][x]
                if not v and k >= 0:
                    colour, t = TIERS[k]
                    if B4[(Y0 + r) % 4][(2 * c + h) % 4] < t:
                        v = colour
                px.append(v)
            new.append(index(*px))
        out.append(new)
    return out, tier, grid, PX


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("disc", nargs="?", default="build/strykers.ssd")
    ap.add_argument("--out", default="src", help="the directory for hills_dither_one.6502 and hills_dither_two.6502")
    ap.add_argument("--show", help="write each sprite tiled, before and after, as PNGs here")
    a = ap.parse_args()
    b = Build(a.disc)
    sc = Scenery(b)
    for s, name in SPRITES.items():
        fn = f"hills_dither_{name.split('_')[1].lower()}.6502"
        lines = [f"\\ {fn} - GENERATED by tools/ditherhills.py from {Path(a.disc).name}: do not edit.",
                 f"\\ DITHER_HILLS: {name} with its far, mid and fore hill ranges dithered (blue 4/16, red 2/16,",
                 "\\ red 6/16). Same format, width and y as the original (src/bank4.6502).", ""]
        start, cols, orig = read_sprite(b, sc, s)
        again, _ = encode(cols)
        if again != orig:
            sys.exit(f"sprite {s}: re-encoding the original does not give its bytes back")
        new, tier, grid, PX = dither(cols)
        data, last = encode(new)
        back = []
        a2 = 0
        while True:
            rows, nxt = decode_column(lambda x: data[x], a2)
            back.append(rows)
            if data[nxt] & 0x80:
                break
            a2 = nxt
        if back != new:
            sys.exit(f"sprite {s}: what was written does not decode to the dithered sprite")
        print(f"{name}: {len(cols)} columns, {len(orig)} bytes -> {len(data)} (+{len(data) - len(orig)})")
        lines.append(f".scenery_sprite_{s:02x}    \\ ({'SCENERY_' + name}, dithered)")
        for i in range(0, len(data), 16):
            lines.append("    EQUB " + ", ".join(f"&{v:02X}" for v in data[i:i + 16]))
        lines.append(f"scenery_sprite_{s:02x}_last = scenery_sprite_{s:02x} + {last}")
        (Path(a.out) / fn).write_text("\n".join(lines) + "\n", encoding="utf-8")
        print("wrote", Path(a.out) / fn)
        if a.show:
            from PIL import Image
            pal = {0: (255, 0, 255), 1: (255, 0, 0), 2: (0, 255, 0), 3: (255, 255, 0), 4: (0, 0, 255), 5: (255, 0, 255),
                   6: (0, 0, 0), 7: (255, 255, 255)}
            H = len(grid)
            for tag, cc in (("before", cols), ("after", new)):
                im = Image.new("RGB", (PX * 3, H))
                for t in range(3):
                    for c, rows in enumerate(cc):
                        for r, i in enumerate(rows):
                            for h, v in enumerate(colours(i)):
                                im.putpixel((t * PX + 2 * c + h, H - 1 - r), pal[v])
                Path(a.show).mkdir(parents=True, exist_ok=True)
                im.resize((PX * 3 * 4, H * 2), Image.NEAREST).save(Path(a.show) / f"{name.lower()}-{tag}.png")


if __name__ == "__main__":
    main()
