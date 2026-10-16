# Step 2, layer 1: own the interrupt, lock the pass to vsync

Done 2026-10-16. Every number here was measured on **jsbeeb 2.5.0, Master 128 (MOS 3.20, Acorn
1770 DFS)**, through the headless harnesses in `tools/`, on 2026-10-16. "Before" is the
byte-identical build (tag `step1-identical`, built from 762a0d2's source), "after" is this
layer. Both play `tools/playscript.mjs` seed 1.

## Result

| | Before | After |
|---|---|---|
| Frames 4000-5000 (town), passes/s | 16.78 | **17.78** |
| mean pass | 2.98 fields | 2.81 fields |
| fields per pass | 2: 161, 3: 70, 4: 65, 5: 34, 6: 5 | 2: 176, 3: 81, 4: 88, 5: 10 |
| Frames 16000-17000 (`DEBUG_LIVES`), passes/s | 15.07 | **17.03** |
| mean pass | 3.31 fields | 2.94 fields |
| fields per pass | 2: 143, 3: 41, 4: 32, 5: 62, 6: 21, 7: 1, 8: 1 | 2: 165, 3: 75, 4: 70, 5: 17, 6: 13 |
| `tools/speed.mjs` (RIGHT held), passes/s | 13.52 | **16.58** |
| player x, pixels/s | 6.76 | 8.29 |
| time in interrupts, frames 4000-5000 | 21.0% | **10.6%** |
| time in interrupts, frames 16000-17000 | 18.6% | 10.0% |

Every pass is now a whole number of fields, starting at a vsync. About half still overrun their
2-field slot: what is left of the time is the drawing and the raster chases
(`check_if_raster_is_in_mover` 11-15%, `wait_for_timer_1b7c`, `update_player`'s vsync wait),
which are layer 2's and 3's. The lock's own wait (`wait_for_pass_slot`) is 15.8-17.0% of the
time; the original's floor (`wait_for_timer_281a`) was 14.0-33.6%.

Profiles: `build/base/profile-*.json`, `build/l1/profile-*.json`; interrupt profiles
`build/*/irq-*.json` (regenerate with the commands below; `build/` is not committed).

## 1. What the MOS's 20% was (measured before changing anything)

`tools/irqprofile.mjs` (new) follows every interrupt from the CPU's IRQ vector (`&E59E`) to its
RTI, and keys it by the VIA flags it actually cleared. **The MOS re-enables interrupts inside its
100 Hz tick** (`CLI` at `&E720` around its sound processing; the longest masked stretch in play
was 1,759 cycles, shorter than a tick), so interrupts nest and the tool keeps a stack, charging
each only its own cycles. Inside the MOS it charges the innermost subroutine called, which was
then identified in the MOS 3.20 ROM with `tools/m6502.py`.

Frames 4000-5000, before:

| Source | Per field | Mean | % of all cycles | What the MOS does with it |
|---|---|---|---|---|
| System VIA T1, the 100 Hz tick | 1.98 | 3,240 | **16.0** | see below |
| User VIA T1 (the game's palette split) | 0.97 | 1,165 | 2.8 | nothing it recognises: offers it to every paged ROM (service call 5, `&EE72`; ROMs 9-15 decline), then IRQ2V |
| System VIA CB1 (ADC end of conversion) | 1.86 | 288 | 1.3 | joystick conversions; the game never reads the ADC |
| System VIA CA1 (vsync) | 0.98 | 292 | 0.7 | vsync counter `&0240` (OSBYTE 19), flash timer, event 4; the game's own work is 127 of the 292 |
| System VIA CA2 (keyboard) | 0.01 | 968 | 0.02 | key-pressed interrupt |
| **Total** | | | **21.0** | |

The 100 Hz tick (`&E6D5`), by subroutine:

| MOS 3.20 routine | % of all cycles | What it is |
|---|---|---|
| `&F416`, `&F528`, `&F5D5`/`&F5E6` | 2.5 + 0.8 + 2.9 + 0.7 = **6.8** | sound: channel queues and envelopes (`&0800-&08FF`), and the SN76489 write with its settle loops |
| `&F8FF` -> KEYV -> `&F96C`, `&F91C`, `&F9A6`, `&F880` | 0.9 + 3.2 + 0.8 + 0.8 + 0.5 = **6.3** | the full keyboard matrix scan, every tick while any key is held (`&EC`/`&ED` non-zero and `&0242` set) |
| `&E60F` re-entered from the tick | 1.6 | the IRQ dispatcher again (ACIA/serial status) |
| `&E933`, `&E9EF` | 0.5 | printer buffer poll |
| the rest | ~0.8 | TIME, interval timer, INKEY countdown, ADC poll |

At frames 16000-17000 the shape is the same (18.6%; tick 13.6%, keyboard scan smaller because
the script holds keys less there).

## 2. What was built

**In play the game's `irq1_handler` keeps vsync and User VIA T1 from the MOS; the MOS keeps only
System VIA T1, for OSWORD 7 sound** (decision 14). The title, high scores, instructions and
define controls run under the MOS as before (KC: eventually everything, start with gameplay).

- `irq1_handler` (`src/game.6502`): the original's code, cycle for cycle up to the palette and
  T1 writes, then `INC field_count`; in play (`irq_owned` = `&FF`) it acknowledges CA1 itself
  and returns with `RTI`. **User VIA T1 always returns with `RTI`, title included** (decision
  15): the MOS only offered it to the ROMs. Anything else (in play, only System VIA T1) goes to
  the MOS as before.
- `take_irq_for_play` / `give_irq_back` (end of bank 5, size-neutral hooks in place of
  `prepare_to_start_game`'s `JMP start_game` and `title_screen`'s `JSR clear_title_screen`):
  seed the PRNG; save the MOS's CA2/CB1 enables and turn both off (keyboard read direct, ADC
  unused); `irq_owned` on; OSBYTE `&E9` clears bit 1 of the System VIA IRQ mask `&0279`;
  OSBYTE `&B2` zeroes `&0242`, the MOS's keyboard polling state, so its tick never scans. Each
  OSBYTE returns the old value, saved; `give_irq_back` puts all of it back in the reverse order.
  **Order matters**: a vsync handed to a MOS whose mask ignores it is never acknowledged, so
  `irq_owned` goes on before the mask goes off, and the mask comes back before `irq_owned` goes.
- Why the mask: `irq1_handler` decides to chain a tick to the MOS some 30 cycles before the MOS's
  dispatcher looks at the VIA, and the dispatcher tests vsync before T1. **The original loses
  that race in 12 fields of 1,000** (frames 4000-5000: the MOS takes the vsync, the game's
  handler never sees it, and that field has no palette split and no `game_over_cooldown` tick -
  BUGS.md #3). With the mask, 0 of 1,000.
- `field_count` (`&90`) counts every vsync in both modes: 1,000 fields stepped it exactly 1,000.
- **The pass is locked to 2 fields** (decision 18): `wait_for_timer_281a` now waits for
  `pass_start + 2` if the pass is inside its slot, or for the next field if it has overrun, then
  starts the next slot. `update_movers` no longer starts System VIA T2 as the old floor's
  stopwatch.
- `wait_for_vsync_2242` waits on `field_count` (OSBYTE 19 would hang once the MOS never sees
  vsync), then **delays 176 cycles** (decision 19): see section 3.
- **The keyboard is read straight from the System VIA** (decision 16): `check_for_keypress` is
  the kit's `keydown_inkey` (the same ten bytes the OSBYTE &81 call took), `keydown_int` is
  forked into `src/lib/keydown.6502`. The `keys` table keeps its INKEY numbers, so define
  controls (bank 5, still OSBYTE &81 and `&EC` under the MOS) is untouched.
- **A PRNG** (decision 17): `random`, a 16-bit xorshift (7, 9, 8), period 65,535, state in `&92`/
  `&93`, seeded `&7A31` at every game start (KC: a fixed seed, so a game replays exactly from its
  input). It replaces the four User VIA T2 reads that were random numbers: the helicopter height
  (`add_enemy_helicopters`), the soldier's crouch, `animate_stationery_mover`,
  `rnd_skewed_towards_right_of_world`. The T2 reads that are raster positions
  (`update_screen`, `check_if_raster_is_in_mover`) stay.

### Where it lives

- `&33B9-&33FF`, the 71 bytes the standard version's table left (`unused_33b9`), hold
  `keydown_int` (28), `random` (20), `irq_owned`, `pass_start`; padded to `&3400` so the font and
  the sprites do not move (BUGS #1, #2 look the same). The handler's growth is paid by the
  stopwatch and the floor it replaced. **3 bytes free** (`&33FD-&33FF`), 2026-10-16, from the
  listing. An `ASSERT` stops the build if the block overruns.
  A watch of every read and write of `&33B9-&33FF` over 28,500 frames of play, game overs and
  titles (`DEBUG_LIVES`, before the change) saw none.
- Zero page `&90`, `&92`, `&93`: a watch of `&90`, `&92`, `&93`, `&A2-&A6` and `&BC-&BF` from
  frame 300 to 30,000 saw no access to the first three (DFS and the NMI code use the others while
  loading).
- Bank 5 `&A3FA-&A463`, after everything else in the bank (its music is page-aligned).

## 3. Checks

- **Palette split** (`tools/split.mjs`: cycles from the System VIA CA1 flag rising to each
  `&FE21` write from `irq1_handler`, every field, frames 4000-5000): top write 124/125 cycles
  typical in both builds; bottom write 21,190/21,191 in both. Worst cases are earlier now (top
  393 against 606, bottom 22,997 against 25,090): less MOS ahead of the handler. **Scrolling
  fields** (`tools/splitscroll.mjs`, RIGHT held; `wait_for_vsync_2242` re-arms User VIA T1 after the vsync): the original
  re-arms at 420-430 cycles after vsync, putting the bottom write at ~21,504. Without the delay
  this layer's build re-armed at 250-260 (bottom ~21,312, 1.5 scanlines higher on those fields);
  with the 176-cycle delay it re-arms at 420-430 and the bottom write is at ~21,504 again.
  Screenshots at the start of the first game (`tools/frontend.mjs`) put the split in the same
  place in both builds.
- **Keys**: the MCP's `key_down` by name gave A 65, Z 97, RIGHT 121, LEFT 25, SHIFT 0, DELETE 89,
  CTRL 1, P 55, ESCAPE 112 - each the game's INKEY byte EOR `&FF`. Then on a Master at the BASIC
  prompt, `keydown_int` and OSBYTE &81 were run for all 128 key numbers with each of those keys
  held, with none, and with RIGHT+SHIFT: the same keys down every time.
- **Sound** (OSWORD 7 unchanged, through the MOS's tick; `tools/soundfx.mjs`): the game paused, each of the 8 effects
  injected through `play_sound` in turn, and the SN76489 writes for the next 150 fields
  captured in both builds. On every effect's own channel the bytes and their 10 ms tick spacing
  are identical (e.g. `&18`: 319 writes on channel 0). The only difference is on channel 2,
  where a sweep left playing by the game before the pause is at a different phase because the
  two games had diverged.
- **The front end** (`tools/frontend.mjs`, new; 14 checks, all pass in both builds):
  instructions; define controls writes `EF DE DD CC DC BB CA DA` for Q W E R T Y U I, after
  which E moves the player right and RIGHT does not; pause and unpause; ESCAPE with a score that
  ranks, the name entered; the music and sound toggles; a second game. In play `irq_owned` =
  `&FF`, `&0242` = 0, `&0279` = `&FD`, IER = `&42`; back on the title `&0242`, `&0279`, the IER and
  `&EC` are what they were on the first title (`&EC` still held the '1' that started the game
  during play, and the MOS cleared it within the first fields back).
- **The random sites' odds**: in the original over 20,000 frames the four sites read values that
  were close to uniform (`animate_stationery_mover`'s bit 5 set 49% of the time; the crouch's low
  nibble averaging 8.3), so a uniform PRNG keeps the odds.
- **Relocation**: `-Shift 256`, `-Shift 256 -ShiftEnd`, `-Shift 64` (with `DEBUG_LIVES`),
  `-Shift 256` and `-Release` all assemble; the control and the shifted build run in lockstep
  (`tools/lockstep.mjs`, `DEBUG_LIVES`): **30,000 frames identical**.

## 4. Rejected, and why

- **Taking the whole interrupt now** (the kit's `irq.6502`, no MOS at all): the game's sound is
  OSWORD 7 with ten envelopes, which only the MOS's tick plays. KC: chain T1 to the MOS for now;
  the final game wants its own driver, probably 50 Hz (100 Hz is not needed for this game).
- **Owning the front end too**: its music is MOS interval-timer events, its keys the MOS's `&EC`
  and OSBYTE &81 scans, and it uses OSBYTE 19. KC: eventually, but gameplay first.
- **Keeping OSBYTE 19 working by decrementing `&0240` in our vsync handler**: emulating MOS
  workspace; waiting on our own counter is the same wait without it.
- **No delay in `wait_for_vsync_2242`**: measured above, it moved the split 1.5 scanlines on
  scrolling fields; the brief says the split must look exactly as before.
- **An 8-bit generator**: the 16-bit xorshift costs the same 20 bytes with zero-page state.
- **Seeding from the title's field count**: KC chose a fixed seed (reproducible games).

## Measuring it again

```
node tools/profile.mjs build/strykers.ssd 4000 1000 --json OUT.json
node tools/profile.mjs build/strykers-debug_lives.ssd 16000 1000 --json OUT.json
node tools/irqprofile.mjs DISC.ssd 4000 1000 --json OUT.json
node tools/speed.mjs build/strykers.ssd
node tools/frontend.mjs build/strykers.ssd
node tools/split.mjs build/strykers.ssd 4000 1000
node tools/splitscroll.mjs build/strykers.ssd
node tools/soundfx.mjs DISC.ssd OUT.json        # then compare two builds' OUT.json per channel
```
