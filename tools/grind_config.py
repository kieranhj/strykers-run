"""
grind_config.py - what tools/grind.py (the beeb-micro-grind skill) needs to know about Stryker's
Run: which code it must not touch, which sources are generated, and how to build and prove it.

Every entry says why. A window that overlaps a protected range is still shown to the optimisers,
with those lines marked PROTECTED, so they see the context but may not change them; a window that
is all protected is dropped.
"""

# Sources written by a generator: never edited by hand, so never grind windows (a better pattern
# there is a change to the generator, which the skill handles as a separate kind of candidate).
GENERATED = (
    'src/compiled_bank5.6502', 'src/compiled_bank6.6502', 'src/compiled_bank7.6502',
    'src/compiled_hazel_a.6502', 'src/compiled_hazel_b.6502', 'src/compiled_table.6502',
    'src/sprite_andy.6502', 'src/sprite_straight.6502', 'src/sprite_columns.6502',
    'src/sfx_data.6502', 'src/lives_digits.6502', 'src/music_packed.6502',
)

# Lines that must not change, by label: from the line of `.from` to the first line after it whose
# code contains `to` (inclusive).
PROTECT = (
    dict(file='src/game.6502', frm='irq1_handler', to='LDA top_palette_value',
         why='raster timing: the cycles from the vsync interrupt to the User VIA T1 write and the '
             'palette writes place the palette split (decision 22, tools/split.mjs); a cycle saved '
             'here moves the split'),
    dict(file='src/game.6502', frm='not_vsync_2ed0', to='STA ula_palette',
         why='raster timing: the bottom palette write when T1 fires (decision 22)'),
    dict(file='src/game.6502', frm='wait_for_vsync_2242', to='RTS',
         why='OSBYTE 19\'s returned registers (BUGS #5) and the T1 re-arm after a vsync wait are '
             'timed from the vsync'),
)

# Byte ranges that must not change, by SECTION (the debug file's segment) and run address: what
# the build reads as data although it assembles as code.
PROTECT_BYTES = (
    ('moved_0004', 0x0004, 0x001C,
     'BUGS #1: in the shipping build the ground\'s texture is read from &0000-&001C, so these '
     'bytes of the zero-page sprite unpacker are the ground. The proofs use the -Shift builds, '
     'which read it from &0A00, so they would not see a change here'),
)

# Where a SECTION's code runs: the bank pcprof keys its addresses by (bank << 16 | address, for
# &8000-&BFFF), or None for main RAM, zero page and HAZEL.
SEGMENT_BANK = {'DATA1': 4, 'DATA2': 5, 'DATA3': 6, 'DATA4': 7}

# The builds, as (build.ps1 arguments, the image they make). 'bench' is what every proof and
# measurement runs on; 'full' its DEBUG_FULLREDRAW twin (the oracle); 'ship' the shipping build
# (the front end check); the rest only have to assemble.
BUILDS = {
    'bench': ('-Shift 256 -ShiftEnd -Define DEBUG_LIVES', 'strykers-shift256end-debug_lives'),
    'full': ('-Shift 256 -ShiftEnd -Define DEBUG_LIVES,DEBUG_FULLREDRAW',
             'strykers-shift256end-debug_lives-debug_fullredraw'),
    'ship': ('', 'strykers'),
    'shift': ('-Shift 256 -Define DEBUG_LIVES', 'strykers-shift256-debug_lives'),
    'release': ('-Release', 'strykers'),
}

# The gate: every check a batch must pass (tools/ harnesses; at most 4 emulators at once). Each
# is (name, argv with {ctl}/{test}/{full}/{ship} for the images, what passing looks like).
CHECKS = (
    ('state+screen seed 1', ['node', 'tools/passlock.mjs', '{ctl}', '{test}', '6000', '1', '--screen'], 'passlock'),
    ('state+screen seed 3', ['node', 'tools/passlock.mjs', '{ctl}', '{test}', '4000', '3', '--screen'], 'passlock'),
    ('oracle seed 5', ['node', 'tools/passlock.mjs', '{full}', '{test}', '4000', '5', '--screen'], 'passlock'),
    ('helicopter 5', ['node', 'tools/helilock.mjs', '{ctl}', '{test}', '3000', '5'], 'helilock'),
    ('helicopter 2', ['node', 'tools/helilock.mjs', '{ctl}', '{test}', '3000', '2'], 'helilock'),
    ('front end', ['node', 'tools/frontend.mjs', '{ship}'], 'frontend'),
)
QUICK = ('state+screen seed 1',)
PARALLEL = 4

# The measurement: pcprof's per-pass work (cycles, the wait for the flip excluded) on passbench's
# two games, the same game whatever the build's speed. Deterministic, so a difference is exact.
MEASURE = (
    ('seed 1', ['node', 'tools/pcprof.mjs', '{bench}', '--detail', '--passes', '1500']),
    ('RIGHT', ['node', 'tools/pcprof.mjs', '{bench}', '--detail', '--hold', 'RIGHT', '--from', '50', '--passes', '600']),
)

# A difference this small (cycles a pass) is not a saving: the gate's dry run on an unchanged
# tree measured 0.1 on both games (2026-10-17, 2521688), from the builds' stamps.
NOISE = 1.0
