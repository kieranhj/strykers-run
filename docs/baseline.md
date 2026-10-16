# Baseline: the original's frame rate and where its time goes

Measured 2026-10-16 with `tools/profile.mjs` on jsbeeb 2.5.0 (Master 128), the shipping build
(byte-identical to the STH disc), scripted play from `tools/playscript.mjs` seed 1. A "pass" is
one trip round `main_game_loop`; a field is 39,936 cycles (50 Hz, interlace off).

| Scenario | Passes/s | Mean pass | Fields per pass (count) |
|---|---|---|---|
| Frames 4000-5000: the start of the level, town (`build/strykers.ssd`) | 16.98 | 117,254 cycles = 2.94 fields | 2: 168, 3: 58, 4: 85, 5: 26, 6: 2 |
| Frames 16000-17000: further on, more enemies (`-Define DEBUG_LIVES`) | 15.07 | 132,180 cycles = 3.31 fields | 2: 143, 3: 41, 4: 32, 5: 62, 6: 21, 7: 1, 8: 1 |

The game never runs faster than one pass every two fields (25 Hz) and averages about 17 and
15 passes a second; a pass takes anything from 2 to 8 fields, which is the uneven speed.

## Where the time goes (percent of all cycles)

| | Frames 4000-5000 | Frames 16000-17000 |
|---|---|---|
| **Waiting** | **24.8** | **40.5** |
| `wait_for_timer_281a` (end of `update_movers`: a pass-length floor - spins until System VIA T2, restarted when `update_movers` began, shows 36,864 us gone, ~1.84 fields) | 12.54 | 33.55 |
| `check_if_raster_is_in_mover` (waits until the beam has just passed the mover, 0-32 lines below it, then redraws it: chasing the beam, ~half a field on average) | 11.60 | 4.31 |
| `wait_for_timer_1b7c` (`update_screen`: wait for the beam to reach the ground) | 0.66 | 2.59 |
| **MOS interrupt processing** (`irq1_handler` chains to the MOS on every IRQ) | 20.05 | 20.25 |
| `irq1_handler` itself (palette split) | 1.03 | 1.03 |
| MOS keyboard reads (`check_for_keypress`: OSBYTE &81, 8 a pass) | 1.73 | 1.53 |
| `unpack_column_of_sprite` (the zero-page sprite plotter) | 20.19 | 10.00 |
| collision checks (`check_for_mover_collision_*`) | 6.6 | 4.1 |
| `unbuffer_player` (restoring what was under the player) | 3.81 | 3.43 |
| everything else | ~22 | ~16 |

Full tables: `build/profile-baseline.json`, `build/profile-baseline-16000.json` (regenerate with
`node tools/profile.mjs build/strykers.ssd 4000 1000 --json ...`).

## What this says for step 2

- Roughly a quarter to two fifths of the CPU is spent waiting: chasing the beam so a mover is
  redrawn just after it has been displayed (it draws on the screen being shown, erasing by EOR),
  and holding each pass to at least ~1.84 fields. (Corrected 2026-10-16: `wait_for_timer_281a`
  is that floor, not a raster wait.) Drawing into a hidden buffer (double buffering in the Master's shadow RAM) removes the
  reason for every one of those waits - and the flicker.
- A fifth is the MOS's interrupt handling, entered on every interrupt the game takes, including
  its own User VIA timer interrupts for the palette split. Not yet broken down (keyboard scan,
  sound envelopes, the centisecond tick, unclaimed interrupts offered to the ROMs). Owning IRQ1V
  outright, as the port kit does, is the likely saving.
- The sprite plotter is the largest real work: 10-20%.
