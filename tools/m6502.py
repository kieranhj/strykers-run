"""
m6502.py - the 65C02 (Master 128, Rockwell-less 65SC12-compatible subset) opcode table and a
one-instruction disassembler, used by disasm2baron.py and for poking at reference binaries.

The Master's CPU is a 65SC12: the 65C02 additions without the Rockwell bit instructions
(RMB/SMB/BBR/BBS), so those are deliberately absent. Undefined opcodes decode as None.
"""

# mode: (operand bytes, Baron operand template)
MODES = {
    'imp': (0, ''),
    'acc': (0, 'A'),
    'imm': (1, '#{}'),
    'zp':  (1, '{}'),
    'zpx': (1, '{},X'),
    'zpy': (1, '{},Y'),
    'izx': (1, '({},X)'),
    'izy': (1, '({}),Y'),
    'izp': (1, '({})'),
    'abs': (2, '{}'),
    'abx': (2, '{},X'),
    'aby': (2, '{},Y'),
    'ind': (2, '({})'),
    'iax': (2, '({},X)'),
    'rel': (1, '{}'),
}

_T = """
00 BRK imp 01 ORA izx 04 TSB zp  05 ORA zp  06 ASL zp  08 PHP imp 09 ORA imm 0a ASL acc
0c TSB abs 0d ORA abs 0e ASL abs 10 BPL rel 11 ORA izy 12 ORA izp 14 TRB zp  15 ORA zpx
16 ASL zpx 18 CLC imp 19 ORA aby 1a INC acc 1c TRB abs 1d ORA abx 1e ASL abx 20 JSR abs
21 AND izx 24 BIT zp  25 AND zp  26 ROL zp  28 PLP imp 29 AND imm 2a ROL acc 2c BIT abs
2d AND abs 2e ROL abs 30 BMI rel 31 AND izy 32 AND izp 34 BIT zpx 35 AND zpx 36 ROL zpx
38 SEC imp 39 AND aby 3a DEC acc 3c BIT abx 3d AND abx 3e ROL abx 40 RTI imp 41 EOR izx
45 EOR zp  46 LSR zp  48 PHA imp 49 EOR imm 4a LSR acc 4c JMP abs 4d EOR abs 4e LSR abs
50 BVC rel 51 EOR izy 52 EOR izp 55 EOR zpx 56 LSR zpx 58 CLI imp 59 EOR aby 5a PHY imp
5d EOR abx 5e LSR abx 60 RTS imp 61 ADC izx 64 STZ zp  65 ADC zp  66 ROR zp  68 PLA imp
69 ADC imm 6a ROR acc 6c JMP ind 6d ADC abs 6e ROR abs 70 BVS rel 71 ADC izy 72 ADC izp
74 STZ zpx 75 ADC zpx 76 ROR zpx 78 SEI imp 79 ADC aby 7a PLY imp 7c JMP iax 7d ADC abx
7e ROR abx 80 BRA rel 81 STA izx 84 STY zp  85 STA zp  86 STX zp  88 DEY imp 89 BIT imm
8a TXA imp 8c STY abs 8d STA abs 8e STX abs 90 BCC rel 91 STA izy 92 STA izp 94 STY zpx
95 STA zpx 96 STX zpy 98 TYA imp 99 STA aby 9a TXS imp 9c STZ abs 9d STA abx 9e STZ abx
a0 LDY imm a1 LDA izx a2 LDX imm a4 LDY zp  a5 LDA zp  a6 LDX zp  a8 TAY imp a9 LDA imm
aa TAX imp ac LDY abs ad LDA abs ae LDX abs b0 BCS rel b1 LDA izy b2 LDA izp b4 LDY zpx
b5 LDA zpx b6 LDX zpy b8 CLV imp b9 LDA aby ba TSX imp bc LDY abx bd LDA abx be LDX aby
c0 CPY imm c1 CMP izx c4 CPY zp  c5 CMP zp  c6 DEC zp  c8 INY imp c9 CMP imm ca DEX imp
cc CPY abs cd CMP abs ce DEC abs d0 BNE rel d1 CMP izy d2 CMP izp d5 CMP zpx d6 DEC zpx
d8 CLD imp d9 CMP aby da PHX imp dd CMP abx de DEC abx e0 CPX imm e1 SBC izx e4 CPX zp
e5 SBC zp  e6 INC zp  e8 INX imp e9 SBC imm ea NOP imp ec CPX abs ed SBC abs ee INC abs
f0 BEQ rel f1 SBC izy f2 SBC izp f5 SBC zpx f6 INC zpx f8 SED imp f9 SBC aby fa PLX imp
fd SBC abx fe INC abx
"""

OPS = {}
_tok = _T.split()
for i in range(0, len(_tok), 3):
    OPS[int(_tok[i], 16)] = (_tok[i + 1], _tok[i + 2])

# Opcodes that only exist on the 65C02/65SC12 (Baron needs cmos = TRUE for them).
CMOS_ONLY = {0x04, 0x0c, 0x12, 0x14, 0x1a, 0x1c, 0x32, 0x34, 0x3a, 0x3c, 0x52, 0x5a, 0x64,
             0x72, 0x74, 0x7a, 0x7c, 0x80, 0x89, 0x92, 0x9c, 0x9e, 0xb2, 0xd2, 0xda, 0xf2,
             0xfa}

# For each (mnemonic, abs-family mode) the zero-page form an assembler would pick instead,
# if the operand is below &100. An abs-encoded zp operand with one of these needs raw bytes.
ZP_FORM = {'abs': 'zp', 'abx': 'zpx', 'aby': 'zpy'}
_have = {(m, md) for (m, md) in OPS.values()}


def shrinks(mn, mode):
    """True if an assembler would encode `mn mode` with a zp operand in zero-page form."""
    z = ZP_FORM.get(mode)
    return z is not None and (mn, z) in _have


def length(op):
    e = OPS.get(op)
    return None if e is None else 1 + MODES[e[1]][0]


def decode(mem, pc):
    """(mnemonic, mode, operand value or None, length) for the instruction at pc in mem (a
    bytes-like indexed from 0 = address 0, or a dict)."""
    op = mem[pc]
    e = OPS.get(op)
    if e is None:
        return None
    mn, mode = e
    n = MODES[mode][0]
    if n == 0:
        v = None
    elif n == 1:
        v = mem[pc + 1]
        if mode == 'rel':
            v = (pc + 2 + (v - 256 if v >= 128 else v)) & 0xFFFF
    else:
        v = mem[pc + 1] | mem[pc + 2] << 8
    return mn, mode, v, n + 1


def text(mn, mode, v):
    if v is None:
        return mn + ('' if mode == 'imp' else ' A')
    w = 4 if MODES[mode][0] == 2 or mode == 'rel' else 2
    return mn + ' ' + MODES[mode][1].format('&%0*X' % (w, v))


if __name__ == '__main__':
    # python tools/m6502.py FILE LOADADDR START [END]  - disassemble a binary
    import sys
    data = open(sys.argv[1], 'rb').read()
    load = int(sys.argv[2], 16)
    mem = bytearray(65536)
    mem[load:load + len(data)] = data
    pc = int(sys.argv[3], 16)
    end = int(sys.argv[4], 16) if len(sys.argv) > 4 else load + len(data)
    while pc < end:
        d = decode(mem, pc)
        if d is None:
            print('&%04X %02X       ???' % (pc, mem[pc]))
            pc += 1
            continue
        mn, mode, v, n = d
        print('&%04X %-9s %s' % (pc, ' '.join('%02X' % b for b in mem[pc:pc + n]), text(mn, mode, v)))
        pc += n
