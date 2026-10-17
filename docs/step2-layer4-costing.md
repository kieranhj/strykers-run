# Step 2, layer 4: costing option 2 (50 Hz for the cheap things)

2026-10-17. Nothing was built; this is a measurement and a model. Everything below was measured
on **jsbeeb 2.5.0, Master 128 (MOS 3.20)**, build `07ef49c` made with `-Shift 256 -ShiftEnd
-Define DEBUG_LIVES` (`build/l4/bench.ssd`). Every run plays passbench's games, with keys changed
by pass:
- **seed 1**: passes 500-2000;
- **holding RIGHT**: passes 50-650.

The tools are `tools/fieldcost.mjs` (the measurement) and `tools/fieldsim.py` (the model).

**Option 2**, as costed:
- The scroll, the player and the projectiles step every field, in half-size steps.
- The other movers update on alternate fields, staggered so each field carries about half.
- A frame is rendered every field, double-buffered.
- The game runs at the design speed (decision 12): one original pass of movement every 2 fields.

## The answer

Option 2 does not fit, and neither does full 50 Hz or any variant tried. A frame is late if it
is shown 2 fields or more. Over 1,500 passes (3,000 fields) of seed 1 and 600 passes (1,200
fields) holding RIGHT:

| schedule | mean field work (seed 1 / RIGHT) | fields over 39,936 | late frames | game speed, fields a second (50 wanted) |
|---|---|---|---|---|
| now, 25 Hz (for reference) | a pass: 48.2k / 58.2k against 79,872 | - | 41 of 1,499 / 26 of 599 (3+ fields) | 49.4 / 49.0 |
| option 2 | 35.3k / 41.2k | 1,095 / 576 | **529 of 2,999 / 353 of 1,199** | 42.1 / 38.0 |
| full 50 Hz (the whole pass every field) | 41.7k / 48.7k | 1,484 / 771 | 802 / 483 | 38.9 / 35.2 |
| best variant (`player-alt`: the player on alternate fields) | 32.6k / 36.9k | 997 / 433 | 483 / 309 | 42.7 / 39.4 |

The render is what does not fit, not the logic:
- **With no logic at all**, option 2's renders alone make 412 frames late (seed 1) and 331
  (holding RIGHT).
- **With no render at all**, the logic alone makes none late.
- **For no late frames**, option 2 needs the render **69-77% cheaper**.
- **For 1% late frames**, it needs the render 56% cheaper.

The 25 Hz build needs far less:
- for no late frames, 36% cheaper (seed 1) and 14% (holding RIGHT);
- for 1% late, 12% and 8%.

Per byte, 1% late at 50 Hz needs each byte drawn or restored 64-68 cycles cheaper. A byte costs
about 62 cycles all told today, so even free bytes would not be enough.

**The reason:** the double buffer. Frame k is drawn into the screen that showed frame k - 2, so
it must redraw everything that changed in the last *two* fields. A mover updated every other
field has changed in one of any two consecutive fields, so it is redrawn on **every** frame.
Halving how often movers update halves the logic, but hardly touches the render:
- **seed 1**: a field's render averages 23.5k under option 2, against 30.6k for a pass now;
- **holding RIGHT**: 30.3k against 40.7k.

That render must now fit in one field, beside the logic.

## How it was measured

`tools/fieldcost.mjs` profiles every pass, by context: the routine entered and the stack depth
when it was entered. The interrupts are counted apart. For each pass it records:
- **the logic**, by group, with the collision and target searches inside each counted apart.
  Each `update_mover` and `update_enemy_helicopter` call is recorded with its slot and type.
- **the render**: each `put_on` and `take_off` (slot, type, bytes, cycles, the save block's
  size), each compaction, the scroll columns, the lives digit, and the bookkeeping left over.
- **each slot's state at render**, what of it changed since the last pass, and which logic wrote
  the change (`writers`: player, projectiles, top, scroll, each of the 3 mover updates, the
  helicopter update).

`tools/fieldsim.py` turns each measured pass into two fields under a schedule:
- **Logic:** each part of the pass runs in the field or fields the schedule gives it, at the
  pass's measured cost. A half-size step is costed as a whole step: the searches run every step.
- **Changes:** a slot's change lands in the field of the logic that wrote it. A change of screen
  address alone lands in the scroll's field.
- **Redraws:** frame k redraws what changed in fields k - 1 and k. Each slot costs its redraw on
  the nearest measured pass that drew it.
- **Bookkeeping** is a fit to the measured passes: 5,056 + 700 a slot redrawn + 404 a column (seed 1).
- **Each scroll column** costs 4,195 cycles a screen, with its lives digit.
- **The save arenas** are modelled as `render.6502` keeps them: blocks at the top, a freed block
  giving room back only if it is the topmost, and compaction when the top plus `MAX_BLOCK` would
  pass the end. A compaction costs 2,559 + 45.9 a byte kept, fitted to all 28 measured compactions.
- **The replay** is pipesim's: one CPU and a vsync every 39,936 cycles. The next field's logic
  runs in the wait for the flip (decision 26), and a frame flips at least a field after the last.

**The model, checked at 25 Hz** (a pass a frame, 2 fields between flips):

| | seed 1 | holding RIGHT |
|---|---|---|
| late frames in the run itself (its flips) | 41 (passbench: 41 of 1,498) | 26 |
| replaying the measured renders | 41 | 24 |
| replaying the modelled renders | 42 | 28 |
| render a pass, measured / modelled | 30,590 / 31,669 | 40,749 / 41,947 |
| compactions, measured / modelled | 26 / 24 | 2 / 2 |

The model runs 3% heavy on the render. Two reasons, both of which make it a little pessimistic:
- the redraws that a pass made for no change of its own (overlaps, the scroll's zone, the lives
  digit) are added to both of its frames;
- the interrupts are charged to the logic even when they land in a wait.

On the other side, the prebuilt scroll column (RAM for cycles 1) is costed as measured. At 50 Hz
the waits are shorter, so it would succeed less often, and the scroll would cost more.

## 1. The logic, by object group

Cycles a pass. The figures in brackets are the part spent in collision and target searches.

| | seed 1 | holding RIGHT |
|---|---|---|
| top (keys, `update_movers`' own loop, the pass lock) | 1,522 | 1,500 |
| `update_player`, less its scroll | 1,784 (639) | 2,472 (1,109) |
| its scroll (`scroll_screen_*`) | 1,494 | 2,418 |
| its `history_push` | 349 | 497 |
| `update_projectiles` | 2,772 (1,394) | 560 (162) |
| `update_mover` (3 calls a pass) | 2,038 (1,260): 679 a call, max 13,239 | 3,008 (1,726): 1,003 a call, max 12,962 |
| `update_enemy_helicopter` (1 a pass) | 5,797 (4,060), max 16,947 | 5,770 (4,100), max 14,871 |
| interrupts | 1,828 | 1,204 |
| **total** | **17,584** | **17,429** |

**The scroll:** the scroll and push cost 6.9k on a scrolling pass (seed 1; 400 of the 1,500
passes scroll) and 6.3k holding RIGHT (278 of 600).

**The enemy helicopter** is the largest single item: 5.8k a call, 70% of it in its target
searches. By type:
- `&16` (green and white helicopter): 6.5k a call;
- `&19` (the scooter): 5.1k.

**The soldiers** cost 0.3-2.1k a call by type (`&01` soldier with rifle 1.4-2.1k).

**Half a pass of logic a field.** The logic is the easy part: no field is late on logic alone in
any split. The field means below are seed 1, with holding RIGHT in brackets:

| split | field 0 | field 1 | 99% / max |
|---|---|---|---|
| option 2: soldiers on field 0, the helicopter on 1 | 9.9k (9.6k) | 13.7k (12.4k) | 33k / 43k |
| soldiers 2 + 1 with the helicopter | 9.0k | 14.7k | 36k / 46k |
| the scroll only on the soldiers' field | 10.9k (11.1k) | 12.8k (10.9k) | 32k / 43k |
| the scroll alone on field 0, every mover on field 1 | 8.8k | 14.8k | 32k / 42k |
| full 50 Hz | 15.7k | 15.8k | 38k / 52k |

## 2. The render, by mover

Each figure is bytes or cycles a pass. "Changed this pass / only the last" splits the redraw
cycles into movers that changed in this pass's logic, and those changed only in the pass before
(the other screen catching up: what a single screen would not redraw).

**Seed 1:**

| slots | drawn: bytes | cycles | restored: bytes | cycles | cycles a byte, on / off | changed this pass / only the last |
|---|---|---|---|---|---|---|
| player (0) | 73.0 | 6,378 | 72.9 | 2,822 | 87 / 39 | 4,650 / 4,550 |
| enemies (1-9) | 17.7 | 1,644 | 17.8 | 682 | 93 / 38 | 800 / 1,526 |
| enemy helicopters (10-11) | 77.7 | 5,449 | 77.5 | 2,466 | 70 / 32 | 3,968 / 3,946 |
| projectiles (12-23) | 9.7 | 1,355 | 9.7 | 567 | 140 / 58 | 1,885 / 37 |
| allies, tank (24-33) | 0 | 0 | 0 | 0 | | |

**Seed 1, the rest of the render:**
- redraws 21.5k;
- bookkeeping 6.5k;
- scroll columns 1.9k (0.53 a pass);
- the lives digit 0.4k;
- compaction 0.3k (26 calls of up to 37k cycles each).

**Seed 1, by type** (bytes / cycles a pass):
- `&00` the player 146 / 9.2k
- `&16` 107 / 5.5k
- `&19` 49 / 2.4k
- `&01` 21 / 1.4k
- `&0E` explosions 11 / 0.7k

**Holding RIGHT:**

| slots | drawn: bytes | cycles | restored: bytes | cycles | changed this pass / only the last |
|---|---|---|---|---|---|
| player | 107.7 | 9,405 | 107.7 | 4,179 | 6,769 / 6,815 |
| enemies | 47.5 | 4,352 | 47.5 | 1,848 | 1,594 / 4,606 |
| enemy helicopters | 95.7 | 6,600 | 96.3 | 3,033 | 4,793 / 4,841 |
| projectiles | 0.4 | 68 | 0.4 | 27 | 90 / 5 |

**Holding RIGHT, the rest of the render:**
- redraws 29.7k;
- bookkeeping 7.1k;
- columns 3.2k (0.93 a pass);
- the lives digit 0.7k.

**The double buffer:** about half of the player's and the helicopters' redraw is the other screen
catching up. `tools/singlebuf.mjs` on seed 1 gives the same split, 118 bytes drawn a pass for
changed movers against 60 for the catch-up.

**A field's render when only the field's movers change** (the simulation, option 2):

| | seed 1 | holding RIGHT |
|---|---|---|
| double-buffered: each frame redraws two fields of changes | 23.5k | 30.3k |
| drawing only the field's own changes (a single screen's work) | 18.7k | 22.1k |
| a pass's render now | 30.6k | 40.7k |

**Compaction** is lumpy. A compaction costs up to 37k cycles, nearly a field, and the worst
fields of every schedule have one. With every frame redrawing 2 fields of changes, the arenas
compact more often: 155 times in 3,000 fields against 26 in 1,500 passes. The tables below give
each schedule with and without it.

## 3. The simulation, field by field

**The schedules:**
- **`option2`:** the player, the projectiles and the key reads every field. The pass's 3 soldier
  updates on field 0 and its helicopter update on field 1. The scroll falls on either field
  (scrolls take turns).
- **`option2-s1`:** the soldiers split 2 + 1 with the helicopter.
- **`option2-sc0`:** the scroll only on the soldiers' field.
- **`option2-sc-alone`:** the scroll alone on field 0, every mover on field 1.
- **`player-alt`:** the projectiles every field; the player and its scroll on field 0, the movers
  on field 1.
- **`full50`:** the whole pass every field.

**The scroll cannot be halved.** It moves the CRTC start by a character, one byte column (2 MODE
2 pixels), so at 50 Hz it still moves a whole column, on one of a pass's two fields.

**The columns:**
- **work** is a field's work (logic + render; the mean is in cycles);
- **99% / max** are the 99th percentile and the largest field's work;
- **late** is frames shown 2 fields or more;
- **game f/s** is fields of game a second (50 is the design speed);
- **cut 0 / cut 1%** is how much cheaper the render must be for no late frames, or for 1%;
- **no-logic** is the late frames with the logic taken away;
- **1-field** is the late frames when only the field's own changes are drawn.

**Seed 1, 3,000 fields:**

| schedule | work (logic + render) | 99% / max | over a field | late | game f/s | cut 0 / cut 1% | no-logic | 1-field |
|---|---|---|---|---|---|---|---|---|
| option2 | 35,285 (11,830 + 23,455) | 98.7k / 140k | 1,095 | 529 | 42.1 | 77% / 56% | 412 | 300 |
| option2-s1 | 35,297 | 99.1k / 148k | 1,092 | 533 | 42.0 | 77% / 56% | 418 | 307 |
| option2-sc0 | 35,285 | 94.7k / 140k | 1,062 | 514 | 42.3 | 76% / 55% | 426 | 304 |
| option2-sc-alone | 35,309 | 99.0k / 149k | 1,075 | 526 | 42.2 | 76% / 55% | 426 | 292 |
| player-alt | 32,565 (10,938 + 21,627) | 98.1k / 144k | 997 | 483 | 42.7 | 74% / 53% | 420 | 161 |
| full50 | 41,717 (15,748 + 25,969) | 102k / 149k | 1,484 | 802 | 38.9 | 88% / 67% | 634 | 508 |

**Holding RIGHT, 1,200 fields:**

| schedule | work (logic + render) | 99% / max | over a field | late | game f/s | cut 0 / cut 1% | no-logic | 1-field |
|---|---|---|---|---|---|---|---|---|
| option2 | 41,233 (10,980 + 30,253) | 99.5k / 129k | 576 | 353 | 38.0 | 69% / 56% | 331 | 189 |
| option2-s1 | 41,266 | 99.7k / 137k | 565 | 356 | 37.9 | 69% / 55% | 330 | 192 |
| option2-sc0 | 41,228 | 95.7k / 119k | 546 | 344 | 38.4 | 60% / 53% | 320 | 178 |
| option2-sc-alone | 41,252 | 95.3k / 127k | 525 | 337 | 38.6 | 60% / 53% | 310 | 174 |
| player-alt | 36,929 (9,744 + 27,185) | 93.4k / 122k | 433 | 309 | 39.4 | 61% / 53% | 285 | 92 |
| full50 | 48,694 (15,369 + 33,325) | 101k / 138k | 771 | 483 | 35.2 | 74% / 64% | 446 | 302 |

**With compaction free** (`--no-compact`: as if the arenas never compacted inside a frame), the
late frames are:
- **option2:** 451 (seed 1) and 328 (holding RIGHT); for 1% late, the render 49% / 46% cheaper;
- **player-alt:** 379 and 264;
- **full50:** 735 and 459.

**Where the fields go over** (option 2, seed 1), by how much past a field:

| over by | fields |
|---|---|
| 0-10k | 497 |
| 10-20k | 305 |
| 20-30k | 138 |
| 30-40k | 64 |
| 40-50k | 39 |
| 50-60k | 26 |
| 60k+ | 26 |

**The worst fields** are the late-pass clusters already known at 25 Hz:
- a big helicopter, the scooter, the player and the enemies all changing while the view scrolls;
- 700-1,000 bytes redrawn and a column written, often with a compaction;
- for example field 2,301 (pass 1,651): logic 33k + render 107k (compaction 34k).

**The catch-up variant**, `fieldsim`'s `catchup`, is not in the tables. It keeps the game at
design speed and lets frames slip:
- the logic runs a step every field;
- a frame shows the newest state once its screen is free;
- a heavy frame stays up for 2 fields or more, and the next one draws the steps between.

It holds 50 fields of game a second, but at 34 frames a second (seed 1) and 29 (holding RIGHT),
and it is unstable under load. Catching up costs logic, which delays the render, so more steps
pile up: frames stay up for 3-12 fields and the logic falls up to 6 fields behind. That is worse
than today's steady 25 Hz, where no frame stays up more than 3 fields.

## 4. What it would take

**Option 2** needs the render 56% cheaper for 1% late frames, and 69-77% for none (60-76% for the
best variants). No logic cut is enough on its own.

**Against what is known:**
- **Compiled sprites:** estimated 1-2.5k a pass.
- **Free compaction:** takes the 1% figure to 46-49%.
- **Drawing only the field's own changes**, a single screen (each frame redrawing one field's
  changes, not two): still 92-307 late frames under option 2 and its variants. And a single screen races the beam, which the
  double buffer was built to avoid (decisions 11, 21).

**The variants change little.** Putting the scroll on its own field, or the player on alternate
fields, saves 15-46 late frames:
- the render is the same whichever field the logic lands in;
- the player on alternate fields (`player-alt`) is the best, because the player is redrawn half
  as often, but then the player, the thing the eye follows, moves at 25 Hz again.

**Full 50 Hz** is worse: 802 late frames on seed 1, 483 holding RIGHT.

## Recommendation

**Stay at 25 Hz.** Do not build option 2, any variant of it, or full 50 Hz with this renderer.
To make 50 Hz possible, the render would need to cost less than half of what it does, every frame
and in the worst frames. Nothing measured or estimated in layer 3 comes near that.

**Reconsider the work cap instead.** Decision 11's 50 Hz target should become **a steady 25 Hz**,
the original's design rate (decision 12), with the time left over spent on the 25 Hz late frames.
For those the targets are small:

| for | seed 1 | holding RIGHT |
|---|---|---|
| no late frames | render 36% cheaper, or 27 cycles less a byte | render 14% cheaper, or 13 cycles less a byte |
| 1% late frames | render 12% cheaper, or 8 cycles less a byte | render 8% cheaper, or 6 cycles less a byte |

The heaviest of those frames are the same clusters, so the levers are:
- the helicopter's update (5.8k a call, 70% of it in its searches);
- compaction out of the frame (done in the wait, or avoided);
- the per-byte cost of the big movers.

Changing the target is KC's decision: it would be a new row in `docs/decisions.md`, replacing
decision 11's.

## Tools

- **`tools/fieldcost.mjs DISC [--from P] [--passes N] [--seed S] [--hold RIGHT] --out PER.json`:** the
  per-pass measurement above. It stops the emulator at every pass, as passbench does, so it plays
  passbench's game exactly: 41 late frames of 1,500 flips on seed 1, as passbench reports.
- **`tools/fieldsim.py PER.json ... [--report] [--schedules a,b] [--worst N] [--no-compact]`:** the
  model and its check at 25 Hz. Schedules are entries in its `SCHEDULES` table.
- **`tools/singlebuf.mjs` fixed:** it changed keys at 400,000-cycle boundaries, not at each pass,
  so it played a slightly different game from passbench. The first versions of `fieldcost` did the
  same: they saw 31 late frames where passbench saw 41.
