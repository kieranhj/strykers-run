"""
compare.py - check the built disc's files byte for byte against the reference build.

    python tools/compare.py [build/strykers.ssd] [reference/sth/StrykersRun.ssd]

The reference is the Stairway to Hell disc (decision 1). Files are paired by name; a file in
the build with no reference partner (!BOOT, INFO) is listed but not compared. For each pair:
identical, or the first differing addresses (at the file's load address) and a count.
Exit status 0 only if every paired file is identical.
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Files the build makes that the reference has under the same name.
PAIRS = ['MGAME', 'DATA1', 'DATA2', 'DATA3', 'DATA4', 'SCREEN', 'SRRUN']


def catalogue(path):
    d = Path(path).read_bytes()
    n = d[256 + 5] // 8
    out = {}
    for i in range(n):
        name = d[8 + i * 8:8 + i * 8 + 7].decode('latin1').rstrip()
        dr = chr(d[8 + i * 8 + 7] & 0x7F)
        e = d[256 + 8 + i * 8:256 + 16 + i * 8]
        load = e[0] | e[1] << 8 | ((e[6] >> 2) & 3) << 16
        exe = e[2] | e[3] << 8 | ((e[6] >> 6) & 3) << 16
        ln = e[4] | e[5] << 8 | ((e[6] >> 4) & 3) << 16
        st = ((e[6] & 3) << 8) | e[7]
        key = name if dr == '$' else dr + '.' + name
        out[key] = dict(load=load, exec=exe, data=d[st * 256:st * 256 + ln])
    return out


def main():
    built = sys.argv[1] if len(sys.argv) > 1 else ROOT / 'build' / 'strykers.ssd'
    ref = sys.argv[2] if len(sys.argv) > 2 else ROOT / 'reference' / 'sth' / 'StrykersRun.ssd'
    b, r = catalogue(built), catalogue(ref)
    ok = True
    for name in sorted(b):
        if name not in PAIRS or name not in r:
            print(f'  {name:8} {len(b[name]["data"]):6} bytes  (no reference partner)')
            continue
        x, y = b[name]['data'], r[name]['data']
        load = b[name]['load'] & 0xFFFF
        diffs = [i for i in range(min(len(x), len(y))) if x[i] != y[i]]
        if not diffs and len(x) == len(y):
            print(f'  {name:8} {len(x):6} bytes  identical')
            continue
        ok = False
        print(f'  {name:8} DIFFERS: built {len(x)} bytes, reference {len(y)}; {len(diffs)} bytes differ')
        for i in diffs[:12]:
            print(f'           +&{i:04X} (&{load + i:04X}): built &{x[i]:02X} reference &{y[i]:02X}')
    for name in PAIRS:
        if name not in b:
            print(f'  {name:8} not built yet')
            ok = False
    print('ALL IDENTICAL' if ok else 'NOT IDENTICAL')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
