"""
packdisc.py - the disc's files packed (ZX02) and laid out in load order, in place.

    python tools/packdisc.py IMAGE.ssd ZX02_EXE

Run on Baron's image by both build scripts (build.ps1, the Makefile). SRRUN (src/loader.6502)
loads each packed file at its catalogue load address and unpacks it, so this sets those
addresses and checks each stream against what it would overwrite:

    SCREEN  stream at &3000, unpacked to &2100 (SCREEN's code; MODE 7's screen at &7C00 above)
    DATAn   stream at &1900, unpacked into bank n + 3 from &8000 (no overlap)
    MGAME   stream ending at &5A80 (the loading picture's start), unpacked in place to &1900:
            the stream must land at or above &1900 + its in-place delta (dfs.in_place_delta)

!BOOT, SRRUN and INFO stay as they are, and so does every file of a disc whose SRRUN does not
unpack (no "ZX02" in it: the relocation test builds, src/loader.6502 PACK_FILES). Then the files
in the boot's order (!BOOT, SRRUN, SCREEN, DATA1-4, MGAME, INFO), so no load seeks back. Each stream is made by the compressor
built from tools/zx02src (v3, vendored; the kit's VENDORED.md) and checked by tools/zx02.py
unpacking it to the file; zx02.py makes the same bytes, at ~3 minutes a 16K file.
(KC, 2026-10-24: "do the file packing"; 81,424 bytes -> 48,415 on the plain disc.)
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import dfs  # noqa: E402

HOST = 0x30000                      # bits 16-17 of a DFS address: the host's (&FFFFxxxx)
GAME_LOAD, PICTURE = 0x1900, 0x5A80
LAYOUT = ["!BOOT", "SRRUN", "SCREEN", "DATA1", "DATA2", "DATA3", "DATA4", "MGAME", "INFO"]


def pack(path, exe):
    raw_img = Path(path).read_bytes()
    img = dfs.read_image(raw_img)
    packing = b"ZX02" in img.files["SRRUN"].data     # SRRUN unpacks (not the relocation test builds')
    report = []
    for name in ("SCREEN", "DATA1", "DATA2", "DATA3", "DATA4", "MGAME") if packing else ():
        f = img.files[name]
        raw = f.data
        packed = dfs.compress(raw, exe=exe, name=name)
        if name == "SCREEN":
            at, dest = 0x3000, 0x2100
            dfs.check_stream(name, at, packed, dest, raw, top=0x7C00)
        elif name == "MGAME":
            at, dest = PICTURE - len(packed), GAME_LOAD
            if GAME_LOAD + len(raw) > PICTURE:
                sys.exit(f"MGAME: {len(raw)} bytes from &1900 run into the loading picture at &5A80")
            dfs.check_stream(name, at, packed, dest, raw, top=PICTURE, in_place=True)
        else:
            at = GAME_LOAD
            dfs.check_stream(name, at, packed, 0x8000, raw, top=PICTURE)
        f.replace(packed, load=HOST | at)
        report.append(f"{name} {len(raw)} -> {len(packed)}")
    for name in LAYOUT:
        if name not in img.files:
            sys.exit(f"{path}: no {name}")
    Path(path).write_bytes(dfs.build_image(img.files, LAYOUT, img.title, img.cycle, img.opt))
    print("  packed: " + ", ".join(report) if packing else "  not packed (SRRUN loads the files as they are): laid out only")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    pack(sys.argv[1], Path(sys.argv[2]).resolve())
