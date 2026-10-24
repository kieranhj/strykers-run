"""
menublank.py - the release disc's MENU's blanking routine (src/menu.bas, its DATA lines), at &0900.

    python tools/menublank.py      -> its length, its three entries, the DATA lines for src/menu.bas

A two-pass assembler with labels for the few instructions it needs (KC, 2026-10-24: no garbage before
the menu's picture). CALL &900: the display (CRTC R8 &30) and cursor (R10 &20) off, the palette black,
&3000-&7FFF zeroed, the vsync event on (the ULA's MODE 1 value with the cursor off, &18, each field while
MODE 1's mode change clears the screen). CALL restore: the event off, EVNTV back. CALL show: at the next
vsync, the display on (R8 0). src/menu.bas carries the DATA and the CALL addresses this prints.
"""
ORG = 0x900
def build(lab):
    out, here, L = bytearray(), ORG, {}
    def emit(*b):
        out.extend(b)
    prog = [
        ("label", "start"),
        ("bytes", [0xA9, 0x08, 0x8D, 0x00, 0xFE, 0xA9, 0x30, 0x8D, 0x01, 0xFE]),     # R8 &30: display off
        ("bytes", [0xA9, 0x0A, 0x8D, 0x00, 0xFE, 0xA9, 0x20, 0x8D, 0x01, 0xFE]),     # R10 &20: cursor off
        ("bytes", [0xA9, 0x07]),                                                     # every palette entry black
        ("label", "black"),
        ("bytes", [0x8D, 0x21, 0xFE, 0x18, 0x69, 0x10]), ("bcc", "black"),
        ("bytes", [0xA9, 0x30, 0x85, 0x71, 0xA9, 0x00, 0x85, 0x70, 0xA8]),         # (&70) = &3000
        ("label", "clear"),
        ("bytes", [0x91, 0x70, 0xC8]), ("bne", "clear"), ("bytes", [0xE6, 0x71]), ("bpl", "clear"),
        ("bytes", [0xAD, 0x20, 0x02, 0x8D]), ("word", "save"), ("bytes", [0xAD, 0x21, 0x02, 0x8D]), ("word+1", "save"),
        ("bytes", [0xA9]), ("lo", "event"), ("bytes", [0x8D, 0x20, 0x02, 0xA9]), ("hi", "event"), ("bytes", [0x8D, 0x21, 0x02]),
        ("bytes", [0xA9, 0x0E, 0xA2, 0x04, 0x4C, 0xF4, 0xFF]),                      # OSBYTE 14,4
        ("label", "restore"),
        ("bytes", [0xA9, 0x0D, 0xA2, 0x04, 0x20, 0xF4, 0xFF, 0xAD]), ("word", "save"), ("bytes", [0x8D, 0x20, 0x02, 0xAD]),
        ("word+1", "save"), ("bytes", [0x8D, 0x21, 0x02, 0x60]),
        ("label", "event"),
        ("bytes", [0x48, 0xA9, 0x18, 0x8D, 0x20, 0xFE, 0x8D, 0x48, 0x02, 0x68, 0x60]),   # ULA MODE 1, cursor off
        ("label", "save"), ("bytes", [0, 0]),
        ("label", "show"),
        ("bytes", [0xA9, 0x13, 0x20, 0xF4, 0xFF, 0xA9, 0x08, 0x8D, 0x00, 0xFE, 0xA9, 0x00, 0x8D, 0x01, 0xFE, 0x60]),
    ]
    for kind, v in prog:
        pc = ORG + len(out)
        if kind == "label": L[v] = pc
        elif kind == "bytes": emit(*v)
        elif kind in ("bcc", "bne", "bpl"):
            op = {"bcc": 0x90, "bne": 0xD0, "bpl": 0x10}[kind]
            off = lab.get(v, pc) - (pc + 2); assert -128 <= off < 128; emit(op, off & 255)
        elif kind == "word": a = lab.get(v, 0); emit(a & 255, a >> 8)
        elif kind == "word+1": a = lab.get(v, 0) + 1; emit(a & 255, a >> 8)
        elif kind == "lo": emit(lab.get(v, 0) & 255)
        elif kind == "hi": emit(lab.get(v, 0) >> 8)
    return bytes(out), L


def main():
    code, L = build({})
    code, L2 = build(L)
    assert L == L2
    print(f"# {len(code)} bytes; CALL &{L['start']:X}, &{L['restore']:X}, &{L['show']:X}")
    for k, i in enumerate(range(0, len(code), 24)):
        print(f"{1000 + 10 * k} DATA " + ",".join(str(b) for b in code[i:i + 24]))


if __name__ == "__main__":
    main()
