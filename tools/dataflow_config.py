"""
dataflow_config.py - what beebgame's dataflow analyses need to know about
Stryker's Run (tools/analyse.py passes it as --config). beebgame's
tools/dataflow/gamecfg.py documents every field; anything left out keeps its
default there. Set up 2026-10-16 at commit 0e7101e.

THE BUILD IT READS. tools/analyse.py defaults to build/strykers.lst,
build/strykers.symbols.json and build/strykers.ssd (`.\\build.ps1`, or `make`).
The disc is the shipping one: every SECTION with a filename is on it whole
(MGAME, DATA1-DATA4, SCREEN, SRRUN, !BOOT, INFO), so the converter takes each
section's bytes from it.

SIDEWAYS BANKS. DATA1, DATA3 and DATA4 are all at &8000 and DATA2 at &8400
(banks 4-7). Each SECTION becomes its own segment, and model.py takes a
segment's bank from its file name (seg_DATA1.bin ...), so each is a bank of
its own: a JSR to a sideways address resolves to the bank of the calling code
if that bank has an instruction there, else to the bank whose symbol the
source line names, else to every bank that has one (joined; sound if one of
them is the bank paged in). ROMSEL writes are I/O: paged bytes are forgotten
across them and across calls that may make them. andy_data (ANDY's sprites,
nested in DATA2, copied to &8000 of ANDY at start-up) is another segment.

COPIED-DOWN CODE. game.6502's rephased nested SECTIONs (moved_0004 at &0004,
moved_0400 at &0400, moved_0880 at &0880) and main.6502's mgame_stub are
segments of their own at their run addresses, so the sprite column unpacker
and the copied-down tables are analysed where they run. Their bytes come from
MGAME's disc file at the offset they are carried at: tools/baron_dbg.py was
extended for nested SECTIONs (a stack of sections; the carried bytes; the
size of an elided EQUB line) - upstream's converter ended every section at
the first ENDSECTION and lost the rest of MGAME. The copy loops themselves are
not modelled as copies: the analysis does not know &0004-&0077 holds what
moved_0004 says until start-up has run, which matters only for code that
reads those bytes as data before the copy.

SELF-MODIFYING CODE (the disassembly's `actually` notes): stores into an
instruction's operand (a direct store the analysis can see) make that
operand unknown rather than the placeholder assembled there (`LDA &FFFF,Y`).
"""

# The sources whose findings are reported: everything under src/.
GAME_DIR = 'src'

# Every interrupt-context entry the game installs (grep irq1v / evntv in src):
#   irq1_handler                      game.6502, IRQ1V from start-up; owns vsync
#                                     in play (irq_owned, decision 14)
#   title_screen_irq1_handler         bank5.6502, IRQ1V on the title screen
#   title_screen_music_event_handler  bank5.6502, EVNTV (interval timer event)
#   high_score_music_event_handler    bank5.6502, EVNTV (interval timer event)
# The analysis has ONE interrupt for the whole program. Two contexts, chosen
# by the environment's DATAFLOW_CONTEXT:
#   'all' (default)  all four: sound for every line of the program.
#   'play'           irq1_handler only: sound only for code that runs in play,
#                    when the title handler is unhooked (prepare_to_start_game
#                    puts IRQ1V back) and events are off (OSBYTE 13), so no
#                    music handler runs. The title handler's writes (&89-&8C,
#                    title_screen_cooldown ...) share zero page with play's
#                    variables, so in 'all' those are never known anywhere.
import os as _os
CONTEXT = _os.environ.get('DATAFLOW_CONTEXT', 'all')
if CONTEXT == 'play':
    ISR_ROOTS = ('irq1_handler',)
else:
    ISR_ROOTS = ('irq1_handler', 'title_screen_irq1_handler',
                 'title_screen_music_event_handler', 'high_score_music_event_handler')

# ---- the interrupt's exits into the MOS (tools/isr_model.py) ---------------
# Upstream takes an interrupt with any exit it cannot follow to read and write
# ALL memory; every handler here ends in the MOS, so no memory byte was ever
# known. ISR_MODEL replaces that (in the analysis's process; tools/dataflow is
# unmodified): each site below is the MOS, which returns having touched only
# MOS_WORKSPACE. Any other unknown exit or pointer store in the interrupt
# still means all memory, with a note naming it. A site the interrupt no longer
# reaches stops the run. Sites are file:line, found from a label and the text of
# the instruction after it (_at), so moving code does not stale them: until
# 2521688 they were line numbers, and moving the music out of bank5.6502 broke
# the run.
ISR_MODEL = True


def _at(path, label, code):
    """'path:line' of the first line after .label whose code (before any comment)
    contains `code`."""
    lines = open(path, encoding='utf-8').read().splitlines()
    start = next(i for i, l in enumerate(lines) if l.split()[:1] == ['.' + label])
    for i in range(start, len(lines)):
        if code in lines[i].split(chr(92))[0]:
            return '%s:%d' % (path, i + 1)
    raise ValueError('%s: no %r after .%s' % (path, code, label))


ISR_MOS_EXITS = {
    # leave_irq1_handler's JMP &FFFF: the previous IRQ1V (the MOS), its operand
    # written at start-up (STA previous_irq1_vector_low, STA leave_irq1_handler + 7).
    _at('src/game.6502', 'leave_irq1_handler', 'JMP &FFFF'):
        'leave_irq1_handler: JMP &FFFF (previous IRQ1V) to the MOS',
    # (Until 2521688 leave_irq1_handler_owned's STA irq_accumulator was listed too:
    # analysis.py took it as an unknown exit at 0670ca9, and the PLX before it at
    # 0e7101e. At 2521688 it no longer does, so the site went.)
}
if CONTEXT != 'play':
    ISR_MOS_EXITS.update({
        _at('src/bank5.6502', 'title_screen_irq1_handler', 'JMP (previous_irq1_vector_for_title_screen_low)'): 'title handler: JMP (previous IRQ1V) - irq1_handler, '
                              'itself a root, or the MOS',
        _at('src/bank5.6502', 'write_timer_block', 'JMP (wordv)'): 'write_timer_block: JMP (wordv), OSWORD 4 (reads timer_block)',
        _at('src/bank5.6502', 'high_score_play_sound', 'JMP (wordv)'): 'high_score_play_sound: JMP (wordv), OSWORD 7 SOUND (reads its block)',
    })

# What the MOS's interrupt path (IRQ, the 100 Hz tick, events, buffers, the
# OSWORD 4/7 the music handlers make) may read and write, inclusive ranges.
# ASSUMPTION, from the BBC/Master memory map, not measured: zero page &E2-&FF
# is the MOS's, except &F8/&F9, which the original game kept mover state in
# while the MOS's interrupts ran through play (it never turned them off), so
# the MOS does not write them; page 2 (vectors, OS variables, buffer
# pointers); page 3 above the game's column buffer (&0300-&03C7 is the
# game's; the keyboard buffer is &03E0-); &0800-&087F (sound workspace and
# buffers); &0A00-&0AFF (RS423/cassette buffers); &0D00-&0DFF (NMI and paged
# ROM workspace). The Master's private RAM is outside the analysis's
# universe. The stack page is never tracked anyway.
MOS_WORKSPACE = (
    (0x00E2, 0x00F7), (0x00FA, 0x00FF),
    (0x0200, 0x02FF), (0x03C8, 0x03FF),
    (0x0800, 0x087F), (0x0A00, 0x0AFF), (0x0D00, 0x0DFF),
)

# Stores through pointers in the interrupt, and what they can hit (inclusive).
ISR_POINTER_STORES = {} if CONTEXT == 'play' else {
    # plot_title_screen_character: reached in the interrupt only from
    # update_scrolltext's initialise_scrolltext_buffer, which points
    # text_screen_address at scrolltext_buffer (&89EE, 24 bytes; generous)
    _at('src/bank5.6502', 'plot_title_screen_character_row_loop', 'STA (text_screen_address),Y'): (0x89EE, 0x8AFF),
    # (scroll_scrolltext's STA (target_address),Y went at decision 57: the interrupt runs scroll_pixel,
    # and update_scrolltext is called only at the title's start-up.)
}

# Bytes a handler pushes on entry and pulls back before it leaves, so the
# interrupted code never sees them change (checked by hand at 0e7101e):
# result_low/high &C5/&C6, multiplicand &C7, multiplier_low/high &C8/&C9,
# &CA, &CB, &CD, text_screen_address &CE/&CF, font_address &8550/&8551,
# text_colour (an operand) &855D.
ISR_PRESERVES = {
    'title_screen_irq1_handler': (0xC5, 0xC6, 0xC7, 0xC8, 0xC9, 0xCA, 0xCB, 0xCD,
                                  0xCE, 0xCF, 0x8550, 0x8551, 0x855D),
}

# Pointers the interrupt reads only its own data through. The music handlers
# read (music_address),Y, but zero-page equates under &100 are not given
# symbols by tools/baron_dbg.py, so a name here would match nothing (the
# reads stay "all memory": liveness only, not ranges).
ISR_DATA_POINTERS = ()

# Zero-page pointers the game writes the SCREEN through. None listed: the
# renderer's pointers (&9C/&9D, &C0-&CD) are also used for save blocks and
# workspace, and (as above) zero-page equates have no symbols to match.
SCREEN_POINTERS = ()

# No inline-operand helpers, no object model.
INLINE_HELPERS = {}
OBJECTS = None

# patterns.py's const_var looks for variables in these segments. A Baron build
# has one segment per SECTION and its zero page in no segment, so none.
VAR_SEGMENTS = ()
