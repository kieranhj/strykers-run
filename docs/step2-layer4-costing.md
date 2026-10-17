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

**Later the same day**, the options in the next section were costed. Row-major sprite data for
the player and the helicopters (about 8K) with compaction kept out of the frame clears 25 Hz:
- 4 late frames on seed 1 and 0 holding RIGHT;
- with the other movers' columns made cheaper and a delta redraw for movers that stay in place,
  1 and 0.

The same package brings option 2 to 3.7% late frames. Everything compiled brings it to 1.6% and
0.9%, but that is ~45K of code, more RAM than there is. So: fix 25 Hz first, with row-major data,
and revisit 50 Hz once those numbers are measured in a build.

## The heaviest frames: what makes them cheaper (KC: "we have the RAM")

Measured with `tools/drawprof.mjs` on the same games and build: every `put_on` and `take_off`, by
renderer label, and each byte drawn.

**Where a draw's cycles go**, a pass (seed 1 / holding RIGHT):

| | player | enemy helicopters | enemies |
|---|---|---|---|
| draw: cycles a byte, all told | 89 / 88 | 71 / 69 | 92 / 91 |
| of which the byte loops (`byte`, `part_byte`) | ~40 | ~40 | ~40 |
| restore: cycles a byte | 39 / 39 | 32 / 32 | 38 / 39 |
| a draw: parts, columns, cells, bytes | 3, 21, 25.6, 107 | 1.6, 19.4, 36.3, 183 | 2.5, 17.6, 20.2, 88 |
| bytes fully transparent / opaque / mixed | 0 / 38 / 62% | 0 / 38 / 62% | 0 / 41 / 59% |

**The player is drawn the slow way.** Its columns are short: 3 parts, 21 columns and about 5 bytes
a column. So the per-column work costs as much as the drawing itself: about 48 cycles a byte on
top of the loop's 40. That work is:
- reading the column's header;
- raising to its first row;
- writing the save block's 3-byte record;
- setting the data pointer, and the cell and next-column steps.

**No empty bytes are drawn.** Leading and trailing transparent bytes are trimmed from each
column at build time (`tools/sprites.py`), and no column has transparent bytes inside it: 0 of the
bytes drawn. 35-44% are fully opaque (mask 0), which need no read of the screen to combine, only
to save.

**Against the last drawing of the same slot on the same screen** (the last but one pass):
- **The helicopters** have always moved. 85% of their bytes land on an address they drew before,
  but only 30% with the same index.
- **The enemies, redrawn where they stood**, have 66% (seed 1) and 84% (holding RIGHT) of their
  bytes unchanged.
- **The player, redrawn in place**, has 20-42% unchanged.

**The player's sprite kinds** (sprite, flip, line in the cell):
- 54 kinds over 31 (sprite, flip) on seed 1, 1,956 bytes in all; 14 over 10 holding RIGHT.
- Its parts sit at only four lines in the cell (3, 4, 5, 7).

**The helicopters' kinds:** 12 (sprite, flip, line) kinds, 954 bytes, at lines 1, 2, 4 and 7 in
these games. But they fly at any height, so code per alignment would need 8 variants.

### The options

`tools/whatif.py` takes each option's estimated cost off the measured passes and replays them.
The 50 Hz figures come from `tools/fieldsim.py` on passes recosted the same way (`whatif.py
--out`). Each new loop's cost is an estimate, written beside the option in `whatif.py`.

**1. Compiled sprites, alignment-free.**
- **The form:** code per sprite row, not per column. A row is one screen line, its bytes 8 apart,
  so one pointer and `LDY #offset` reach the whole row, whatever the alignment. Stepping to the
  next row is about 25 cycles (a line up, or a cell crossing).
- **Per byte:** `LDY #o : LDA (row),Y : STA save+n : AND #m : EOR #p : STA (row),Y`, 21 cycles
  (19 opaque) against 88. Restoring is `LDY #o : LDA save+n : STA (row),Y`, 12 against 39.
- **The save area** must be fixed per slot and screen: the player's always is slot 0, and the
  enemy helicopters slots 10-11.
- **RAM:** about 13 bytes of code a byte drawn and 7 a byte restored, so ~20 a sprite byte. The
  player's 31 observed (sprite, flip) kinds would need ~25K, the 10 used holding RIGHT ~8K, and
  the helicopters' observed kinds ~20K.
- **The fallback:** a part that straddles the screen's wrap at `&8000` takes the generic path.

**2. Row-major sprite data**, the same row form as data:
- **Per byte:** its offset, mask and pixel, with the flip and colour applied at build time.
- **Draw:** `LDY off,X : LDA (row),Y : STA save,X : AND mask,X : EOR pix,X : STA (row),Y : DEX :
  BNE`, 33 cycles a byte (35 counted).
- **Restore:** `LDY off,X : LDA save,X : STA (row),Y : DEX : BNE`, 19 (22 counted).
- **RAM:** ~3 bytes a sprite byte plus a row header. The player's observed kinds need ~4.5K and
  the helicopters' ~3.3K.
- **Cost:** most of what compiling gains, at a sixth of the RAM.

**3. Compaction out of the frame.** Compact either arena in the wait for the flip, before it is
needed: the arenas are at `&34D5-&3FFF`, not displayed. Or make it faster: it moves 45.9 cycles a
byte kept, where a plain copy is ~13.

**4. A same-place redraw by delta.** A mover redrawn where it stood:
- skip its bytes whose index has not changed;
- recompute the others from the save block, which still holds the background: (saved AND mask)
  EOR pixel;
- fall back if anything else touched it (an overlap, the scroll's zone).

It suits standing enemies, which change their frame in place.

**5. Cheaper columns for the rest.** The per-column header, raise and record work precomputed or
dropped, taking 60 cycles a column off the draw and 30 off the restore. Restoring could walk the
sprite's geometry again instead of the records.

**25 Hz late frames** (shown 3+ fields; now 41 seed 1, 24 in the replay holding RIGHT) and the
render a pass (now 30.6k / 40.7k):

| option | seed 1 | holding RIGHT |
|---|---|---|
| compaction in the wait | 37 (-0.3k) | 22 (-0.1k) |
| player compiled | 10 (-6.3k) | **0** (-9.2k) |
| player row-major | 16 (-4.8k) | 1 (-6.9k) |
| helicopters compiled | 7 (-5.1k) | 1 (-6.1k) |
| helicopters row-major | 13 (-3.4k) | 2 (-3.9k) |
| same-place redraws by delta | 30 (-2.5k) | 16 (-4.0k) |
| every column 60 cheaper to draw | 26 (-1.7k) | 10 (-2.4k) |

The packages, replayed from the recosted passes (each draw recosted once, so the delta is not also
counted on the player or the helicopters):

| package | seed 1 | holding RIGHT |
|---|---|---|
| player and helicopters row-major, compaction in the wait | 4 (-8.3k) | 0 (-10.9k) |
| the same, with the rest's columns and delta | 1 (-9.6k) | 0 (-13.9k) |
| player compiled, helicopters row-major, compaction, the rest's columns, delta | **0** (-11.1k) | 0 (-16.1k) |
| everything compiled, the rest's columns, delta, compaction | 0 (-12.9k) | 0 (-18.3k) |

**50 Hz (option 2) on the recosted passes.** Late frames are out of 2,999 fields (seed 1) and
1,199 (holding RIGHT); option 2 is now 529 and 353:

| package | option 2 | player-alt | full 50 Hz |
|---|---|---|---|
| player compiled, compaction | 239 / 140 | 229 / 124 | 501 / 301 |
| player and helicopters row-major, compaction | 164 / 114 | 111 / 65 | 355 / 231 |
| player compiled, helicopters compiled, compaction | 94 / 61 | 67 / 45 | 225 / 144 |
| row-major both, the rest's columns, delta, compaction | 111 / 44 | 77 / 15 | 292 / 148 |
| player compiled, helicopters row-major, the rest's columns, delta, compaction | 81 / 28 | 56 / 12 | 250 / 113 |
| everything compiled, the rest's columns, delta, compaction | **47 / 11** | 37 / 2 | 168 / 69 |

With the last package, option 2 runs at 49.3 / 49.7 fields of game a second. A field's render is
then 14.0k / 16.2k against 23.5k / 30.3k, and the render alone makes 6 / 0 frames late.

**What this changes:**
- **At 25 Hz**, the player alone (compiled, or row-major at 4.5K) all but clears holding RIGHT (0-1
  late frames) and takes seed 1 from 41 to 10-16. Row-major for the player and the helicopters, with
  compaction in the wait, leaves 4 and 0 in under 8K of RAM.
- **50 Hz** needs nearly everything: about 1.6% of frames late on seed 1 and 0.9% holding RIGHT,
  with ~45K of compiled code that does not fit. With row-major data instead (~8K) it is 3.7% and
  3.7%.
- **The free RAM** in this build is about 11.5K by the catalogue lengths:
  - bank 5 ~2.5K, plus the 4.1K copy of ANDY's sprites once they are copied;
  - bank 6 ~2.7K;
  - bank 7 ~2.3K;
  - bank 4 is full.

  On top of that, HAZEL's 8K, if it can be paged during the render (to be measured: it hides the
  MOS's `&C000-&DFFF`), and ~3-4K from packing the front end's music.

## Row-major sprites: built, measured, set aside (branch `row-major-sprites`)

KC asked for all the sprite data row-major. The format that fits where the sprites are now (KC
chose it over offset + index a byte, which needs ~14K in banks 5-7):
- per chunk a length, then a stream read with X counting down;
- rows up from the bottom, each a header (last column << 4 | count - 1) and its indices leftwards;
- gaps padded with the transparent index 0.

**Size:** 7,906 bytes, against the column format's 7,750; the largest save block is 384 bytes, not
636.

**The loops:**
- **draw:** one pointer a row, Y stepping 8 (back 8 flipped), 46 cycles a byte;
- **restore:** the same stream walked again;
- **clipped parts**, and cells from `&7FA8` in the last page, go a byte at a time;
- **the screen-wrap test** is made once a cell, not once a row.

**Proved:** state and shown screen identical to `07ef49c`'s renderer, on 6,000 passes each of
seeds 1, 3 and 4 with CTRL, and against `DEBUG_FULLREDRAW` on seed 5.

**Measured (passbench, the same build flags): slower.**

| | the column format (`07ef49c`) | row-major |
|---|---|---|
| seed 1: passes/s, late frames of 1,498 | 24.70, 41 | 23.68, 166 |
| holding RIGHT: passes/s, late frames of 598 | 24.51, 26 | 23.17, 95 |
| render a pass (seed 1) | 30.6k | 37.1k |

Draw + restore a pass, seed 1 (`tools/drawprof.mjs`):

| | column format | row-major |
|---|---|---|
| player | 9.3k | 10.4k |
| enemies | 2.3k | 3.3k |
| enemy helicopters | 8.0k | 11.7k |
| projectiles | 2.0k | 2.3k |

**Why the estimate above was wrong:**
- **The rows are short.** It took the sprite set's average, 6.3 bytes a row. The player draws
  28 rows of ~3.8 bytes (against 21 columns of ~5), at ~60 cycles a row: the header decode, the
  row's end and start, a line up.
- **The byte loop costs more.** It keeps Y in zero page around the table lookups and steps it
  by 8: 46 cycles against the column loop's 40.
- **The restore costs more.** It has to decode the rows too: 53 cycles a byte for the player,
  against 39.
- **Clipped parts are frequent.** Movers at the screen's edges take the byte-at-a-time path,
  which is why the helicopters went from 8.0k to 11.7k a pass.

**Unbuilt fixes:** a clipped fast path, and each row's end marked by bit 7 of its last index.
Either would bring row-major back to about the column format's speed, not past it.

**Kept from the work, on `main`:** the tools read either format.

## The column format: a fast path, and the player's running frames compiled (costed)

KC, after the row-major result: "cost those wins. do we have a fast path for sprites that aren't
clipped and aren't going to hit the &8000 address wraparound?"

**Half of one.** `ren_draw_sprite` runs the per-column clip test only for a part that can clip
(`ds_clip`). But every step to the next column, and every cell crossing, tests the 16K ring, for
every part.

**Measured set-up** (`tools/colfast.py` on `tools/drawprof.mjs`'s labels, `07ef49c`):
- **drawing:** 131-164 cycles a column, besides the byte loops and cell crossings;
- **restoring:** 64-67 a column.

The player is drawn as 3 parts with 14-21 columns and few cells. 14% of the columns drawn are in
clipped draws: none of the player's, 22-32% of the helicopters'.

**The two wins:**
- **A fast column path**, for a part that is not clipped and cannot wrap (checked once for the
  part): no ring tests, one header read, no 3-byte record a column (the restore walks the
  sprite's headers again), the data pointer from the column pointer. About 86 cycles a column
  against 131-164: 48 less a column drawn, 6 less a cell, 5 less a column restored.
- **The player's running frames compiled**, part by part:
  - the form: code per (sprite, flip, line in the cell), a pointer a cell row, `LDY #o :
    LDA (p),Y : STA save+n : AND #m : EOR #p : STA (p),Y` (21 cycles a byte, ~80 a part with the
    bank's stub), restoring with `LDY #o : LDA save+n : STA (p),Y` (12 a byte, ~60 a part);
  - what it needs: the player's save area fixed per screen, and the code in banks 5-7, entered
    through a main-RAM stub;
  - the running frames are 14 kinds holding RIGHT (529 bytes of sprite), and on seed 1 they are
    72% of the player's bytes.

**25 Hz late frames** (now 41 on seed 1, 24 holding RIGHT), with the render change a pass:

| | RAM | seed 1 | holding RIGHT |
|---|---|---|---|
| fast column path | ~0.3K of code | 29 (-1.4k) | 13 (-2.0k) |
| running frames compiled, all 14 kinds | ~10.6K | 20 (-4.4k) | 1 (-8.9k) |
| the 8 commonest kinds (65% of the bytes holding RIGHT) | ~6.1K | 24 (-2.9k) | 5 (-5.8k) |
| fast path + all 14 compiled | ~10.9K | 15 (-5.2k) | 0 (-9.8k) |
| fast path + the 8 commonest | ~6.4K | 19 (-3.9k) | 1 (-7.0k) |

**RAM:** free in banks 5-7 is about 7.5K (bank 5 ~2.5K, bank 6 ~2.7K, bank 7 ~2.3K). The 8
commonest kinds fit; all 14 need HAZEL (to be measured) or the front end's music packed.

## Built: the player's 8 commonest parts compiled, `draw_column` trimmed (`e72c386`)

KC: "do the fast path + 8 commonest".

**The fast column path was not worth a path of its own.** Written out instruction by
instruction, its saving (costed above at 48 cycles a column) was about 10. On the common path the
ring tests were already on rare branches: only when a column's step crosses a page, and 4 cycles
a cell crossing. What a column pays for is its record in the save block and its pointers, which
every column needs. Two trims went into `draw_column` for every part:
- the record's count is written at once;
- the column's line is worked out once.

**The compiled kinds** (`tools/compiled.py`, `src/compiled_*.6502`):
- **which:** the player's 8 commonest (sprite, flip, line) kinds holding RIGHT. Sprite 0 at
  line 7, sprite 9 at lines 3, 4 and 5, sprites 1-4 at line 7; all unflipped.
- **the code:** a pointer a character row, then `LDY #o : LDA (row),Y : STA save+n : AND #m :
  EOR #p : STA (row),Y` (`LDA #p` for an opaque byte; `LDY` shared by bytes with the same
  offset). The restore is `LDA save+n : STA (row),Y`.
- **the size:** 6,010 bytes, in banks 5-7. Every placement was tried; `main.6502` now ASSERTs
  each bank's end, since the first build ran bank 7's code past `&BFFF` (`tools/hang.mjs` found
  it).
- **the entry:** `ren_draw_sprite` looks up the player's unclipped parts (`compiled_part`) and
  calls the kind through `compiled_call` in main RAM (`&33BB`). A row that could run past `&7FFF`
  gives up before drawing anything, and the generic path draws the part.
- **the saves:** go to a fixed 303-byte area per screen, `player_save` at `&34D5`, so the arena
  is now `&3604-&3FFF`. The save block gets an 11-byte entry marked by count - 1 = `&FF`, which
  `restore_block` hands to the kind's restore.
- **room in bank 4:** `save_game_zp`/`restore_game_zp` moved under ANDY (`src/render_zp.6502`,
  ROMSEL `&04` only).

**Proved:** state and shown screen identical to `07ef49c` over 6,000 passes on seeds 1 and 3 and
4 with CTRL, and to `DEBUG_FULLREDRAW` on seed 5. Both helicopter flights had no frame differing.
The front end passed 15 of 15.

**Measured:** jsbeeb 2.5.0, `-Shift 256 -ShiftEnd -Define DEBUG_LIVES`; late frames are shown 3+
fields.

| | `07ef49c` | `e72c386` | estimated (above) |
|---|---|---|---|
| seed 1: passes/s, late frames of 1,498 | 24.70, 41 | **24.84, 24** | 19 |
| holding RIGHT: passes/s, late frames of 598 | 24.51, 26 | **24.83, 10** | 1 |
| render a pass, seed 1 (fieldcost) | 30.6k | 28.5k | |
| render a pass, holding RIGHT (fieldcost) | 40.7k | 36.5k | |
| the player holding RIGHT: draw / restore a pass | 9.5k / 4.2k | 6.4k / 3.0k | |
| 50 Hz option 2 (fieldsim): late frames, seed 1 / RIGHT | 529 / 353 | 389 / 224 | |

**Why less than estimated:**
- the 8 kinds are only 65% of the player's bytes holding RIGHT; its other 6 running kinds are
  still drawn generically;
- finding the kind and the stub cost about 110 cycles a part;
- the trims came to about 10 cycles a column, not 48.

**Left at 25 Hz:**
- **seed 1:** for no late frames the render must be 32% cheaper; for 1% late, 6%.
- **holding RIGHT:** 6% and 1%.

**The RAM it took**, in the shipping build:
- 6,010 bytes of code in banks 5-7: bank 5 2,037, bank 6 2,169, bank 7 1,804;
- the 303-byte save area per screen, taken from the arena;
- 56 bytes of table and about 200 of code in bank 4.

**Left after it:**
- bank 5: 1K at `&8000` and 424 bytes at `&BE58`;
- bank 6: 530 at `&BDEE`;
- bank 7: 481 at `&BE1F`.

The shifted test builds keep a page free, so they have 256 less in each bank.
- bank 4: 295 above the sprites, 137 under ANDY;
- main RAM: 43 at `&33D5`;
- ANDY: 7;
- HAZEL: unused.

The other 6 kinds (~4.6K) need HAZEL or the front end's music packed.

## Built: all 14 running kinds compiled, 6 of them in HAZEL; the front end's tunes packed

KC: "compile the other 6 running frames. compress the frontend music to make space. you can use all
of hazel as we're not using DFS after boot." Decisions 29 and 30.

**What HAZEL turned out to be** (`tools/hazelwatch.mjs`, jsbeeb 2.5.0, Master 128, MOS 3.20):
- The MOS leaves ACCCON's Y bit set from the start of the game on, so HAZEL is paged in at
  `&C000-&DFFF` throughout play. The compiled kinds there are called directly, with no paging.
- After the start nothing writes HAZEL and no code runs there.
- The scroll reads HAZEL in two places:
  - **the mountain layer's data**, from `&C300` (BUGS #9: not the MOS ROM, as layer 3's brief
    assumed). It advances about a byte every 11-12 columns; `tools/hazelreach.mjs` saw
    `&C300-&C41B` by column 3,319, extrapolated to about `&C590` for the world. Left alone: the
    kinds start at `&C700`;
  - **a new scenery sprite's first column**, through stale table pointers (`mover_y_max`, often
    `&C9xx`). That was an original glitch, fixed first (BUGS #8, `b10d6b5`): state identical, the
    screens differing in those columns only (591 and 627 passes of 6,000, 5 to 11 bytes).

**The kinds:**
- the other 6 of the 14 the player drew holding RIGHT: sprites 6 and 7 at line 4, 5 at lines 3
  and 5, 8 at lines 3 and 5;
- 4,526 bytes of code at `&C700-&D8AD`;
- **carried on the disc in two parts.** Part A (3,817 bytes) sits in bank 5's music area, part B
  (709) in the start-up block. `unpack_for_play` (`src/game.6502`) copies both into HAZEL after
  `mgame_relocate`'s `*TAPE`, then unpacks the tunes over part A's carrier.
- **the save area:** kinds whose sprites never share a frame share one (`save_groups`). The 14
  kinds need 117 bytes a screen, against 303 for the 8, so the arena is `&354A-&3FFF`.

**The tunes** (`tools/packmusic.py`, ZX02, `src/lib/zx02depack.6502` forked from the kit):
- 3,968 bytes packed to 956, carried in the start-up block;
- unpacked to `&9300` at start-up, where the event handler expects them page-aligned. Checked byte
  for byte against `src/music.6502` after start-up.
- `MGAME` now loads to `&5A55`: 43 bytes below the loading picture at `&5A80` (ASSERTed).

**Proved** against the fix-only build (`b10d6b5`): state and shown screen identical over 6,000
passes on seeds 1 and 3 and 4 with CTRL, and to `DEBUG_FULLREDRAW` on seed 5. Both helicopter
flights had no frame differing, and the front end passed 15 of 15 (two games, back to the title).

**Measured:** passbench, `-Shift 256 -ShiftEnd -Define DEBUG_LIVES`; late frames are shown 3+ fields.

| | `e72c386` (8 kinds) | `b10d6b5` (the fix) | now (14 kinds) |
|---|---|---|---|
| holding RIGHT: passes/s, late frames of 598 | 24.83, 10 | 24.83, 10 | **25.00, 2** |
| seed 1: passes/s, late frames of 1,498 | 24.84, 24 | 24.85, 23 | **24.86, 22** |
| 25 Hz, no late frames: the render cheaper by (seed 1 / RIGHT) | 32% / 6% | | 28% / 1% |
| 50 Hz option 2 (fieldsim): late frames, seed 1 / RIGHT | 389 / 224 | | 364 / 200 |

Holding RIGHT is now all compiled for the player. Seed 1 gains less: the player there also stands,
jumps and turns left (flipped kinds), which are not compiled.

**RAM after it** (shipping build):
- **main RAM:** 31 bytes free at `&33E1`;
- **HAZEL:** `&C000-&C2FF` (768) and `&D8AE-&DFFF` (1,874) free; `&C300-&C6FF` kept for the
  mountains;
- **bank 4:** 235 bytes above, 137 under ANDY;
- **banks 5-7:** as before. The tunes' carrier area is music again after start-up.

## Tools

- **`tools/fieldcost.mjs DISC [--from P] [--passes N] [--seed S] [--hold RIGHT] --out PER.json`:** the
  per-pass measurement above. It stops the emulator at every pass, as passbench does, so it plays
  passbench's game exactly: 41 late frames of 1,500 flips on seed 1, as passbench reports.
- **`tools/fieldsim.py PER.json ... [--report] [--schedules a,b] [--worst N] [--no-compact]`:** the
  model and its check at 25 Hz. Schedules are entries in its `SCHEDULES` table.
- **`tools/drawprof.mjs DISC [--hold RIGHT] --out OPS.json`:** each draw and restore by renderer
  label, its parts, columns, cells, bytes and byte kinds, against the slot's last drawing on the
  same screen; the player's (sprite, flip, line) kinds.
- **`tools/whatif.py FC.json OPS.json [--out FC2.json KINDS]`:** the 25 Hz late frames with each
  option's estimated cost taken off. `--out` writes the passes recosted for `fieldsim.py`.
- **`tools/colfast.py FC.json OPS.json [RIGHT_OPS.json]`** (`TOP=N`): the column renderer's
  set-up by column, cell and part, and the 25 Hz late frames with a fast column path or the
  player's running frames compiled.
- **`tools/compiled.py LAYER2.ssd [src]`:** the compiled kinds' code, table and save area.
- **`tools/pcprof.mjs`, `tools/pcagg.py`, `tools/pccats.py`, `tools/budgetdata.py`:** the
  per-instruction profile, by label and by job, and the cycle budget page's data.
- **`tools/packmusic.py`:** the front end's tunes packed (ZX02) for the disc, checked by unpacking.
- **`tools/hazelwatch.mjs DISC [FRAMES]`, `tools/hazelreach.mjs DISC [PASSES]`:** what reads and
  writes HAZEL after the start; how far the mountain layer's reads go across the world.
- **`tools/hang.mjs DISC PASS`:** where a build that stops making passes first leaves its code.
- **`tools/screendiff.mjs A B [PASS] [SEED]`:** both builds played to a pass, both screens
  compared byte by byte.
- **`tools/singlebuf.mjs` fixed:** it changed keys at 400,000-cycle boundaries, not at each pass,
  so it played a slightly different game from passbench. The first versions of `fieldcost` did the
  same: they saw 31 late frames where passbench saw 41.
