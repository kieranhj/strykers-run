"""releasedisc.py - the release disc: both builds behind the original release's menu (docs/briefs/release-disc.md).

    python tools/releasedisc.py ORIGINAL.ssd REDUX.ssd OUT.ssd [--screen OUT.bin] [--machine "Model B"]
    python tools/releasedisc.py --extract REFERENCE.ssd      (once: src/mscreen.bin from the reference disc)

$.!BOOT (*EXEC: BASIC, CHAIN "MENU"), $.MENU (src/menu.bas, tokenised here), $.MSCREEN (the original
release's menu picture, src/mscreen.bin: the Stairway to Hell disc's MSCREEN, carried as SCREEN's
picture is in src/title_data.6502; its two choices redrawn here), then ORIGINAL's files in directory O
and REDUX's in R, each with its catalogue load and exec addresses. MENU picks one with *DIR and runs
that directory's !BOOT, which loads the rest by name from the current directory.

MSCREEN (13,224 bytes at &2F00) fills the screen's background, then copies its picture down from
&6270 a character row at a time: 19 rows of 312 bytes (columns 24-62 of MODE 1's 80), rows 29 up
to 11, the source 312 bytes lower each row. So a screen byte (row r, byte column c, line l) comes
from source &6270 - 256 - 312 * (29 - r) + (c - 24) * 8 + l, measured against the reference's own
screen in jsbeeb (2026-10-23: all 5,928 bytes). The choices' box is drawn in a narrow font of the
artist's; its letters are cut from the box's own lines, the ones it lacks drawn here in its style.
--screen writes the 20K screen the new MSCREEN draws (its copy and the box), for a look.
--machine names the machine the disc is for (Master unless given; KC, 2026-10-25: "Model B" and
"Master" in the screen's bottom right corner): white in the box's font on a black box of its own,
poked onto the screen by MENU (DATA after the blanking routine's) while the display is still off.
"""
import sys
from pathlib import Path

BS = "\\"
ROOT = Path(__file__).resolve().parent.parent

# --------------------------------------------------------------------------------------------
# DFS images


def catalogue(img):
    """A disc's files in their PHYSICAL order (ascending start sector: the builds lay them out in load
    order, tools/dfs.py layout), not the catalogue's (descending)."""
    n = img[256 + 5] // 8
    out = []
    for i in range(n):
        name = img[8 + 8 * i:15 + 8 * i].decode("latin1").rstrip()
        dr = chr(img[15 + 8 * i] & 0x7F)
        e = img[256 + 8 + 8 * i:256 + 16 + 8 * i]
        load = e[0] | e[1] << 8 | ((e[6] >> 2) & 3) << 16
        exe = e[2] | e[3] << 8 | ((e[6] >> 6) & 3) << 16
        ln = e[4] | e[5] << 8 | ((e[6] >> 4) & 3) << 16
        st = e[7] | (e[6] & 3) << 8
        out.append(dict(dir=dr, name=name, load=load, exec=exe, data=bytes(img[st * 256:st * 256 + ln]), start=st))
    return [{k: v for k, v in f.items() if k != "start"} for f in sorted(out, key=lambda f: f["start"])]


def file_of(img, name, dr="$"):
    for f in catalogue(img):
        if f["name"] == name and f["dir"] == dr:
            return f
    sys.exit(f"no {dr}.{name}")


def write_ssd(files, title, opt, sectors=800):
    if len(files) > 31:
        sys.exit(f"{len(files)} files: a DFS catalogue holds 31")
    img = bytearray(sectors * 256)
    sec, ents = 2, []
    for f in files:
        ln = len(f["data"])
        img[sec * 256:sec * 256 + ln] = f["data"]
        ents.append((sec, f))
        sec += (ln + 255) // 256
    if sec > sectors:
        sys.exit(f"the files need {sec} sectors of {sectors}")
    t = title.encode("latin1").ljust(12, b"\0")
    img[0:8], img[256:260] = t[:8], t[8:12]
    img[256 + 5] = 8 * len(ents)
    img[256 + 6] = (opt & 3) << 4 | (sectors >> 8) & 3
    img[256 + 7] = sectors & 255
    for i, (st, f) in enumerate(sorted(ents, key=lambda e: -e[0])):      # highest start sector first
        img[8 + 8 * i:15 + 8 * i] = f["name"].encode("latin1").ljust(7)
        img[15 + 8 * i] = ord(f["dir"])
        ln, load, exe = len(f["data"]), f["load"], f["exec"]
        img[256 + 8 + 8 * i:256 + 16 + 8 * i] = bytes([load & 255, load >> 8 & 255, exe & 255, exe >> 8 & 255,
            ln & 255, ln >> 8 & 255, (exe >> 16 & 3) << 6 | (ln >> 16 & 3) << 4 | (load >> 16 & 3) << 2 | st >> 8 & 3,
            st & 255])
    return bytes(img), sec

# --------------------------------------------------------------------------------------------
# BBC BASIC: just enough of a tokeniser for src/menu.bas (no line-number references: GOTO / GOSUB
# with a constant would need the &8D encoding)


KEYWORDS = {"AND": 0x80, "DIV": 0x81, "EOR": 0x82, "MOD": 0x83, "OR": 0x84, "ELSE": 0x8B, "THEN": 0x8C,
            "GET": 0xA5, "INKEY": 0xA6, "NOT": 0xAC, "TO": 0xB8, "CALL": 0xD6, "CHAIN": 0xD7, "CLS": 0xDB,
            "DATA": 0xDC, "END": 0xE0, "FOR": 0xE3, "IF": 0xE7, "MODE": 0xEB, "NEXT": 0xED, "VDU": 0xEF,
            "PRINT": 0xF1, "READ": 0xF3, "REM": 0xF4, "REPEAT": 0xF5, "UNTIL": 0xFD, "OSCLI": 0xFF}
LITERAL_AFTER = ("DATA", "REM")             # the rest of the line as it is


def tokenise(src):
    out = bytearray()
    for raw in src.splitlines():
        raw = raw.strip()
        if not raw or raw.startswith("#"):
            continue
        num, text = raw.split(" ", 1)
        body, i, quoted = bytearray(), 0, False
        text = text.strip()
        if text.startswith("*"):                           # a star command: the rest as it is
            body += text.encode("latin1")
        else:
            while i < len(text):
                ch = text[i]
                if ch == '"':
                    quoted = not quoted
                if not quoted and ch.isalpha() and ch.isupper():
                    word = next((k for k in sorted(KEYWORDS, key=len, reverse=True) if text.startswith(k, i)), None)
                    prev = text[i - 1] if i else " "
                    if word and not (prev.isalnum() and prev.islower()):
                        body.append(KEYWORDS[word])
                        i += len(word)
                        if word in LITERAL_AFTER:
                            body += text[i:].encode("latin1")
                            break
                        continue
                    while i < len(text) and (text[i].isalnum() or text[i] in "%$_"):   # a variable: as it is
                        body.append(ord(text[i]))
                        i += 1
                    continue
                body.append(ord(ch))
                i += 1
        n = int(num)
        out += bytes([13, n >> 8, n & 255, len(body) + 4]) + body
    return bytes(out + b"\r\xff")

# --------------------------------------------------------------------------------------------
# MSCREEN: its picture's pixels through its copy loop


ORG, SRC0, ROWS = 0x2F00, 0x6270, 19


def at(r, c, line):
    """The MSCREEN file offset of screen row r, byte column c, line (rows 11-29, columns 24-62)."""
    k = 29 - r
    if not (0 <= k < ROWS and 24 <= c < 63):
        raise ValueError((r, c))
    return SRC0 - 256 - 312 * k + (c - 24) * 8 + line - ORG


class Picture:
    def __init__(self, data):
        self.d = bytearray(data)

    def get(self, x, y):                                    # MODE 1: pixel p of a byte, bits 7-p and 3-p
        r, line = divmod(y, 8)
        c, p = divmod(x, 4)
        b = self.d[at(r, c, line)]
        return (b >> (7 - p) & 1) * 2 + (b >> (3 - p) & 1)

    def put(self, x, y, v):
        r, line = divmod(y, 8)
        c, p = divmod(x, 4)
        o = at(r, c, line)
        m = 0x88 >> p
        self.d[o] = self.d[o] & ~m & 255 | (0x80 >> p if v & 2 else 0) | (0x08 >> p if v & 1 else 0)


# The box's lines: their text, the top of a 10-row frame (cap height from row 1, x-height from row 3,
# baseline row 7, descenders 8-9) and where their words begin; the text white (colour 1) on black (0)
BOX_X0, BOX_X1 = 101, 216                                    # inside the box's black, left to right
LINES = {"choose": ("PLEASE CHOOSE", 175), "one": ("(1) Standard version", 195),
         "two": ("(2) Enhanced version", 206), "press": ("Press 1 or 2", 224)}
WORDS_X = 123                                               # where every line's first word starts

# The letters the box lacks, in its style (rows 0-9 of the frame)
DRAWN = {
    "g": ["", "", "", " ####", "#   #", "#   #", "#   #", " ####", "    #", " ### "],
    "l": ["", "# ", "# ", "# ", "# ", "# ", "# ", " #"],
    ",": ["", "", "", "", "", "", "", " #", "# "],
    "f": ["", "  ##", " #  ", "### ", " #  ", " #  ", " #  ", " #  "],
    "R": ["", "#### ", "#   #", "#   #", "#### ", "# #  ", "#  # ", "#   #"],
    "u": ["", "", "", "#   #", "#   #", "#   #", "#   #", " ####"],
    "x": ["", "", "", "#   #", " # # ", "  #  ", " # # ", "#   #"],
    "m": ["", "", "", " ## ## ", "#  #  #", "#  #  #", "#  #  #", "#  #  #"],
    "p": ["", "", "", "#### ", "#   #", "#   #", "#   #", "#### ", "#    ", "#    "],
    "M": ["", "#   #", "## ##", "# # #", "#   #", "#   #", "#   #", "#   #"],
    "B": ["", "#### ", "#   #", "#   #", "#### ", "#   #", "#   #", "#### "],
}
SPACE = 6                                                   # the box's word gap (5, and a letter's 1)


def font(pic):
    """Each letter the box's lines have, cut from them: columns of white, in order."""
    glyphs = {}
    for text, top in LINES.values():
        cols = [any(pic.get(x, y) == 1 for y in range(top, top + 10)) for x in range(BOX_X0, BOX_X1)]
        runs, x = [], 0
        while x < len(cols):
            if cols[x]:
                s = x
                while x < len(cols) and cols[x]:
                    x += 1
                runs.append((BOX_X0 + s, BOX_X0 + x))
            else:
                x += 1
        chars = text.replace(" ", "")
        if len(runs) != len(chars):
            sys.exit(f"MSCREEN: '{text}' cut into {len(runs)} letters, not {len(chars)}")
        for ch, (a, b) in zip(chars, runs):
            glyphs.setdefault(ch, [[pic.get(x, top + y) == 1 for x in range(a, b)] for y in range(10)])
    for ch, rows in DRAWN.items():
        w = max(len(r) for r in rows)
        glyphs[ch] = [[c == "#" for c in r.ljust(w)] for r in rows + [""] * (10 - len(rows))]
    return glyphs


def write_line(pic, glyphs, line, text):
    """Redraw a box line's words (its "(n) " stays): black from WORDS_X to the box's end, then the text."""
    _, top = LINES[line]
    for y in range(top, top + 10):
        for x in range(WORDS_X, BOX_X1):
            pic.put(x, y, 0)
    x = WORDS_X
    for ch in text:
        if ch == " ":
            x += SPACE
            continue
        g = glyphs.get(ch)
        if g is None:
            sys.exit(f"MSCREEN: no letter '{ch}'")
        for y, row in enumerate(g):
            for i, on in enumerate(row):
                if on:
                    pic.put(x + i, top + y, 1)
        x += len(g[0]) + 1
    if x - 1 > BOX_X1:
        sys.exit(f"MSCREEN: '{text}' runs {x - 1 - BOX_X1} pixels past the box")


def text_width(glyphs, text):
    return sum(SPACE if ch == " " else len(glyphs[ch][0]) + 1 for ch in text) - 1


# The machine's label: its box's right edge and bottom (exclusive), 8 pixels in from the screen's
# corner; the text's rows 1-7 of the frame (no descenders) with 2 lines of black above and below, 3
# pixels at the sides, the box widened left to a byte's edge so it is whole bytes
LABEL_X1, LABEL_Y1, LABEL_PAD = 312, 248, 3


def label_bytes(machine):
    """{screen address: byte} for the machine's label, MODE 1 at &3000 (MENU writes them)."""
    glyphs = font(Picture((ROOT / "src" / "mscreen.bin").read_bytes()))
    w = text_width(glyphs, machine)
    x0 = (LABEL_X1 - w - 2 * LABEL_PAD) // 4 * 4
    y0 = LABEL_Y1 - 11
    on = set()
    x = LABEL_X1 - LABEL_PAD - w
    for ch in machine:
        if ch == " ":
            x += SPACE
            continue
        g = glyphs.get(ch)
        if g is None:
            sys.exit(f"MSCREEN: no letter '{ch}'")
        for y, row in enumerate(g[1:8]):
            for i, v in enumerate(row):
                if v:
                    on.add((x + i, y0 + 2 + y))
        x += len(g[0]) + 1
    out = {}
    for y in range(y0, LABEL_Y1):
        for c in range(x0 // 4, LABEL_X1 // 4):
            b = 0
            for p in range(4):
                if (4 * c + p, y) in on:
                    b |= 0x08 >> p              # colour 1, white: the low bit of the pixel's pair
            out[0x3000 + (y >> 3) * 640 + c * 8 + (y & 7)] = b
    return out


def label_data(machine, first=2000):
    """MENU's DATA lines for the label: the runs of consecutive addresses, then each run's address,
    length and bytes (line 55 reads them)."""
    lab = sorted(label_bytes(machine).items())
    runs = []
    for a, b in lab:
        if runs and runs[-1][0] + len(runs[-1][1]) == a:
            runs[-1][1].append(b)
        else:
            runs.append((a, [b]))
    vals = [len(runs)]
    for a, bs in runs:
        vals += [a, len(bs)] + bs
    lines, n = [], first
    for i in range(0, len(vals), 16):
        lines.append(f"{n} DATA " + ",".join(map(str, vals[i:i + 16])))
        n += 10
    return lines


def mscreen(original):
    pic = Picture(original)
    glyphs = font(pic)
    write_line(pic, glyphs, "one", "Original, faster")       # KC, 2026-10-23: the brief's wording
    write_line(pic, glyphs, "two", "Redux, improved")       # KC, 2026-10-24
    return bytes(pic.d)


def screen_of(data):
    """The screen (&3000-&7FFF) the copy draws, for --screen (the background left 0)."""
    scr = bytearray(0x5000)
    for k in range(ROWS):
        for j in range(312):
            scr[0x7A40 - 256 - 640 * k + j - 0x3000] = data[SRC0 - 256 - 312 * k + j - ORG]
    return bytes(scr)

# --------------------------------------------------------------------------------------------


def main():
    args, shot = sys.argv[1:], None
    if args[:1] == ["--extract"]:
        data = file_of(Path(args[1]).read_bytes(), "MSCREEN")["data"]
        (ROOT / "src" / "mscreen.bin").write_bytes(data)
        print(f"wrote src/mscreen.bin: {len(data)} bytes")
        return
    if "--screen" in args:
        i = args.index("--screen")
        shot = args[i + 1]
        del args[i:i + 2]
    machine = "Master"
    if "--machine" in args:
        i = args.index("--machine")
        machine = args[i + 1]
        del args[i:i + 2]
    if len(args) != 3:
        sys.exit(__doc__)
    orig, redux = (Path(a).read_bytes() for a in args[:2])
    ms = mscreen((ROOT / "src" / "mscreen.bin").read_bytes())
    if shot:
        Path(shot).write_bytes(screen_of(ms))
    menu_src = (ROOT / "src" / "menu.bas").read_text()
    blank = sum(len(ln.split("DATA", 1)[1].split(",")) for ln in menu_src.splitlines() if ln[:1].isdigit() and " DATA " in ln)
    if blank != 126:                    # line 25 reads the blanking routine's 126; line 55 the label's after them
        sys.exit(f"src/menu.bas: {blank} DATA values before the label's, not 126")
    menu = tokenise(menu_src + "\n" + "\n".join(label_data(machine)) + "\n")
    files = [dict(dir="$", name="!BOOT", load=0, exec=0, data=b'*BASIC\rCHAIN "MENU"\r'),
             dict(dir="$", name="MENU", load=0x30E00, exec=0x38023, data=menu),      # BASIC: &FFFF0E00, &FFFF8023
             dict(dir="$", name="MSCREEN", load=0x2F00, exec=0x2F00, data=ms)]
    for dr, img in (("O", orig), ("R", redux)):
        for f in catalogue(img):
            files.append(dict(f, dir=dr))
    out, used = write_ssd(files, "STRYKERS RUN", 3)
    Path(args[2]).write_bytes(out)
    print(f"wrote {args[2]}: {len(files)} files, {used} sectors of 800; the menu's label '{machine}'")


if __name__ == "__main__":
    main()
