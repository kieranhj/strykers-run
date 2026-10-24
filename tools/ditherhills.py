"""
ditherhills.py - the mountain sprites with their hill ranges dithered (DITHER_HILLS, an experiment).

    python tools/ditherhills.py [build/strykers.ssd] [--out src] [--show DIR]

The hills band is the mountain layer: MOUNTAINS_TWO and MOUNTAINS_ONE (which HAZEL's bytes pick,
each drawn as it is or flipped: BUGS #9; in jsbeeb, booted straight into the game, HAZEL is zeros
and only MOUNTAINS_TWO unflipped shows), 12-column sprites laid end to end at y 23. Each draws the
snow and three ridge lines over transparent colour 0, which the palette split shows as magenta
below row 111. The ridges close the transparent pixels into regions in three tiers - far, mid,
fore - and this fills each tier with an ordered (Bayer 4x4) dither of its own colour in place of
colour 0:

    far   blue (logical 4), 4/16
    mid   red  (logical 1), 6/16
    fore  red  (logical 1), 2/16

(KC, 2026-10-22, after trying the mock "Cool far, warm near" and several others: decision 64). Pixels the pattern leaves off stay colour
0, so the band keeps its magenta between the dots, and whatever the later layers draw goes over
it as before. The regions are found on the sprite tiled three times (as it is drawn, end to end)
and taken from the middle copy, so a region that runs over a sprite's edge is classed as a whole.
MOUNTAINS_ONE's lowest ridge is open at its upper end, which ran its bottom hill into the mid
range: WALLS closes it along the ridge's own line to the line it points at (not drawn; its pixels
take the tier above them; decision 71).
Pattern phase: x from the sprite's first pixel (12 columns is 24 pixels, a multiple of 4, so the
pattern runs on across sprites), y from the buffer row (the layer's y is fixed).

A flipped sprite is drawn from the same bytes mirrored (the flipped address tables point at its
last column, the pixel tables swap a byte's two pixels), which mirrors the pattern too: next to an
unflipped sprite it is out of phase and pixels pair up side by side. So each sprite is written
twice: dithered as it is, drawn unflipped, and with the pattern mirrored, drawn flipped (its
`scenery_sprite_0N_last`, the flipped tables' address), which puts the pattern back in phase
(decision 71).

Reads the original sprites from the build (unflipped addresses, the sprite's bank) and writes them
re-encoded in the sprites' own run-length format (docs/level-format.md): per column the previous
column's length, the runs, 0; after the last column &80 + its length. Checked by re-encoding the
original sprites to their own bytes, and by decoding what it writes. The four (2,675 bytes) are
more than any bank has free, so they are written packed (ZX02, tools/zx02.py, checked by
unpacking) in two streams: src/hills_dither_bank4.6502 (MOUNTAINS_ONE, its mirrored copy,
MOUNTAINS_TWO; bank 4, in sprite 3's and MOUNTAINS_ONE's room) and src/hills_dither_bank7.6502
(MOUNTAINS_TWO's mirrored copy; bank 7, where MOUNTAINS_ONE was). At start-up they are unpacked one
after the other into bank 5's carrier of ANDY's sprites, dead once they are copied into ANDY
(src/game.6502, unpack_hills), and drawn from there (decisions 70, 71).
"""
import argparse, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from worldmap import Build, Scenery, decode_column, SPLIT_ROW, ROWS  # noqa: E402
import zx02  # noqa: E402

SPRITES = {4: "MOUNTAINS_ONE", 5: "MOUNTAINS_TWO"}
# the unpacked block in order, by stream: (sprite, pattern mirrored)
STREAMS = {"bank4": [(4, False), (4, True), (5, False)], "bank7": [(5, True)]}
WALLS = {4: [((12, 50), (7, 45))]}     # (pixel x, row from the sprite's top): MOUNTAINS_ONE's lowest
                                        # ridge, open at (12, 50), on to the ridge it points at (decision 71)
Y0 = 23                                 # the mountain layer's y (tools/worldmap.py's runs: all at 23)
B4 = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]
TIERS = [(4, 4), (1, 6), (1, 2)]        # (colour, density of 16): far, mid, fore (KC, 2026-10-22, the last of several: see decision 64)
COLOUR_NAMES = {1: "red", 2: "green", 3: "yellow", 4: "blue", 5: "magenta", 6: "cyan", 7: "white"}
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


def decode(data):
    back, a = [], 0
    while True:
        rows, nxt = decode_column(lambda x: data[x], a)
        back.append(rows)
        if data[nxt] & 0x80:
            return back
        a = nxt


def dither(cols, walls=(), mirror=False):
    """The columns' indices with each hill tier's transparent pixels patterned. walls: segments
    (pixel x, row from the top) that close regions without being drawn; mirror: the pattern as a
    flipped draw wants it."""
    W, H = len(cols), max(len(c) for c in cols)
    T = 3                               # tiles: the sprite end to end, regions from the middle one
    PX = 2 * W
    grid = [[0] * (PX * T) for _ in range(H)]
    for t in range(T):
        for c, rows in enumerate(cols):
            for r, i in enumerate(rows):
                L, R = colours(i)
                grid[r][t * PX + 2 * c], grid[r][t * PX + 2 * c + 1] = L, R
    wall = set()
    for (x0, y0), (x1, y1) in walls:
        n = max(abs(x1 - x0), abs(y1 - y0))
        for k in range(n + 1):
            x, y = round(x0 + (x1 - x0) * k / n), round(y0 + (y1 - y0) * k / n)
            for t in range(T):
                if not grid[H - 1 - y][t * PX + x]:
                    wall.add((H - 1 - y, t * PX + x))
    tier = [[-1] * (PX * T) for _ in range(H)]
    seen = [[False] * (PX * T) for _ in range(H)]
    for r0 in range(H):
        for x0 in range(PX * T):
            if grid[r0][x0] or seen[r0][x0] or (r0, x0) in wall:
                continue
            st, pts, top = [(r0, x0)], [], False
            seen[r0][x0] = True
            while st:
                r, x = st.pop()
                pts.append((r, x))
                top |= r == H - 1
                for dr, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    rr, xx = r + dr, x + dx
                    if 0 <= rr < H and 0 <= xx < PX * T and not grid[rr][xx] and not seen[rr][xx] \
                            and (rr, xx) not in wall:
                        seen[rr][xx] = True
                        st.append((rr, xx))
            mean = sum(ROWS - 1 - (Y0 + r) for r, _ in pts) / len(pts)      # screen row
            if top or mean < SPLIT_ROW:
                continue                # sky: open to the top, or above the split
            k = 0 if mean < FAR_BELOW else 1 if mean < MID_BELOW else 2
            for r, x in pts:
                tier[r][x] = k
    for r, x in sorted(wall, reverse=True):     # a wall's pixels: the tier of the region above them
        tier[r][x] = tier[r + 1][x] if r + 1 < H else -1
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
                    p = PX - 1 - (2 * c + h) if mirror else 2 * c + h
                    if B4[(Y0 + r) % 4][p % 4] < t:
                        v = colour
                px.append(v)
            new.append(index(*px))
        out.append(new)
    return out, tier, grid, PX


def sprites(disc):
    """Each (sprite, mirrored)'s dithered columns, bytes and last column's offset; the originals' columns."""
    b = Build(disc)
    sc = Scenery(b)
    out, orig_cols = {}, {}
    for s, name in SPRITES.items():
        _, cols, orig = read_sprite(b, sc, s)
        again, _ = encode(cols)
        if again != orig:
            sys.exit(f"sprite {s}: re-encoding the original does not give its bytes back")
        orig_cols[s] = cols
        for mirror in (False, True):
            new = dither(cols, WALLS.get(s, ()), mirror)[0]
            data, last = encode(new)
            if decode(data) != new:
                sys.exit(f"sprite {s}: what was written does not decode to the dithered sprite")
            out[s, mirror] = new, data, last
        print(f"{name}: {len(cols)} columns, {len(orig)} bytes -> {len(out[s, False][1])}, mirrored {len(out[s, True][1])}",
              file=sys.stderr)
    return out, orig_cols


def unpacked(disc):
    """The block start-up unpacks into bank 5, in order."""
    out, _ = sprites(disc)
    return b"".join(out[k][1] for st in STREAMS.values() for k in st)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("disc", nargs="?", default="build/strykers.ssd")
    ap.add_argument("--out", default="src", help="the directory for hills_dither_bank4.6502 and hills_dither_bank7.6502")
    ap.add_argument("--show", help="write each sprite tiled, before and after, and a band with flips, as PNGs here")
    a = ap.parse_args()
    out, orig_cols = sprites(a.disc)
    head = ", ".join(f"{COLOUR_NAMES[c]} {t}/16" for c, t in TIERS)
    offset, where = 0, {}
    for k in (k for st in STREAMS.values() for k in st):
        where[k] = offset
        offset += len(out[k][1])
    for tag, stream in STREAMS.items():
        fn = f"hills_dither_{tag}.6502"
        data = b"".join(out[k][1] for k in stream)
        packed = zx02.compress(data)
        if zx02.decompress(packed) != data:
            sys.exit(f"{fn}: the packed stream does not unpack to the dithered sprites")
        what = ", ".join(SPRITES[s] + (" mirrored" if m else "") for s, m in stream)
        print(f"{fn}: {what}: {len(data)} bytes, packed {len(packed)}")
        lines = [f"\\ {fn} - GENERATED by tools/ditherhills.py from {Path(a.disc).name}: do not edit.",
                 f"\\ DITHER_HILLS: the mountain sprites with their far, mid and fore hill ranges dithered ({head}),",
                 "\\ each also with the pattern mirrored, for its flipped draws. Same format, width and y as the",
                 "\\ originals (src/bank4.6502). Packed (ZX02): unpacked at start-up into bank 5's carrier of ANDY's",
                 "\\ sprites (src/game.6502 unpack_hills; decisions 70, 71) and drawn from there.", "",
                 f".hills_packed_{tag}    \\ {what}: {len(data)} bytes unpacked"]
        for i in range(0, len(packed), 16):
            lines.append("    EQUB " + ", ".join(f"&{v:02X}" for v in packed[i:i + 16]))
        lines.append(f"hills_packed_{tag}_size = {len(packed)}")
        if tag == "bank4":
            lines += ["", "hills_unpacked = andy_load                  \\ where both streams are unpacked, in turn",
                      f"hills_unpacked_size = {offset}"]
            for s in SPRITES:
                lines.append(f"scenery_sprite_{s:02x} = hills_unpacked + {where[s, False]}   \\ ({'SCENERY_' + SPRITES[s]}, dithered)")
                lines.append(f"scenery_sprite_{s:02x}_last = hills_unpacked + {where[s, True] + out[s, True][2]}   "
                             "\\ the flipped draws' start: the mirrored copy's last column")
        (Path(a.out) / fn).write_text("\n".join(lines) + "\n", encoding="utf-8")
        print("wrote", Path(a.out) / fn)
    if a.show:
        from PIL import Image
        pal = {0: (255, 0, 255), 1: (255, 0, 0), 2: (0, 255, 0), 3: (255, 255, 0), 4: (0, 0, 255), 5: (255, 0, 255),
               6: (0, 0, 0), 7: (255, 255, 255)}
        Path(a.show).mkdir(parents=True, exist_ok=True)

        def paint(im, x0, cc, flip):
            for c, rows in enumerate(cc):
                for r, i in enumerate(rows):
                    for h, v in enumerate(colours(i)):
                        x = 2 * c + h
                        im.putpixel((x0 + (23 - x if flip else x), im.height - 1 - r), pal[v])
        for s, name in SPRITES.items():
            H = max(len(c) for c in orig_cols[s])
            for tag, cc in (("before", orig_cols[s]), ("after", out[s, False][0])):
                im = Image.new("RGB", (24 * 3, H))
                for t in range(3):
                    paint(im, 24 * t, cc, False)
                im.resize((im.width * 4, H * 2), Image.NEAREST).save(Path(a.show) / f"{name.lower()}-{tag}.png")
        # the band as the layer draws it, each sprite either way round: the flipped ones from their mirrored copies
        seq = [(5, 0), (4, 0), (5, 1), (4, 1), (4, 0), (5, 0), (5, 1), (4, 1), (5, 0), (4, 1), (5, 0), (5, 0)]
        H = max(len(c) for cc in orig_cols.values() for c in cc)
        im = Image.new("RGB", (24 * len(seq), H), (0, 255, 255))
        for k, (s, f) in enumerate(seq):
            paint(im, 24 * k, out[s, bool(f)][0], f)
        im.resize((im.width * 4, im.height * 4), Image.NEAREST).save(Path(a.show) / "band.png")


if __name__ == "__main__":
    main()
