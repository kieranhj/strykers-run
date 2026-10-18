# Brief: the level editor, v1 (PLAN)

Decision 41 (KC, 2026-10-18) and KC's answers the same day. The format it edits is
`docs/level-format.md`; `tools/worldmap.py` already reads and draws it.

## What it is

A Python PyGame app, `tools/leveledit.py`. It edits a JSON level file and exports source, a
generated include (`src/level_data.6502`, made like the other generated sources). The build checks
the include.

```
┌─ title: level file, length in columns, room meter (bytes used / room: scenery, movers, craft) ──┐
│ whole-world strip with the view's rectangle; click to jump; the HQ marker at the end            │
│ ruler; under it, each page's two enemy helicopter types, and the mover density bar              │
├──────────────────────────────────────────────────────────────────────┬──────────────────────────┤
│ the view: the real picture (worldmap.py's renderer), 1x / 1/2 / 1/4  │ swatch: Scenery / Movers │
│ trigger lines, patrol bars, selection                                │ / Craft; thumbnails,     │
│                                                                      │ names, size and cost,    │
│                                                                      │ kind filter, search      │
├──────────────────────────────────────────────────────────────────────┤ properties of the        │
│ validation bar: the build's checks, live                             │ selection                │
└──────────────────────────────────────────────────────────────────────┴──────────────────────────┘
```

## v1's controls

- **View:** cursor keys scroll a column (with SHIFT, a screen); dragging the background scrolls.
  Zoom is 1x, 1/2 or 1/4. You can jump to a column, or to the next or previous trigger or mover.
  Toggles show or hide the front layer, back layer, movers, triggers, patrols, clouds, mountains
  and ground.
- **Placing:** pick from the swatch, then click in the view. Placements snap to columns. A
  placement that breaks a rule is refused, with the reason in the status bar. The rules:
  - no overlap within a layer;
  - no gap over 255 columns;
  - y plus the sprite's height at most 200;
  - bridges and runways only in the back layer, at their y;
  - mover density within the slots;
  - the room.
- **Editing:**
  - select, drag (x; y in the back layer), Delete;
  - F flips; L moves to the other layer (refused if it breaks a rule);
  - undo and redo, with a deep history, covering column inserts and pastes.
- **Length and large edits:** drag the HQ (a placed scenery object; the completion point follows
  it); insert or delete columns at the cursor (everything to the right shifts); copy and paste a
  range of columns with its scenery and movers.
- **Scenery:** existing sprites only. A layer is a stacking choice: the front layer (scenery one)
  is at y `&17` and drawn over the back; the back layer (scenery two) takes any y.
- **Movers:** placed from the swatch. The properties panel has a behaviour dropdown (stationary,
  lifts its gun, patrol), and patrols get a drag handle clipped to their 256-column page. Movers
  stand at y `&18`. Triggers and the groups of 3 are worked out by the editor, not placed. A
  placement the slots can't bring in is refused, and the density bar shows how full each stretch
  is.
- **Enemy helicopters:** each page's two types, from icons on the ruler strip. Positions and
  heights are v1.1.
- **Boardable craft:** placed from the swatch, 10 at most.
- **Fixed in v1:** the player's start (x `&26`, view at column 0). The clouds, ground and
  mountains stay as now.
- **Testing:**
  - *Build only:* export, then build the `.ssd`.
  - *Observer mode:* boot the build in observer mode (`tools/observer.mjs` proves the keys).
  - *Play from here:* start the game with the player at the view's column. This needs a debug
    start column in the source (debug builds only).

## Export and the build's check

The exported include holds:
- scenery one and two, as chained x-low records;
- the triggers;
- the three `new_movers_*` tables;
- the craft;
- the helicopter types;
- the completion point.

The original's slips are fixed in it: the craft at 13,000, scenery two's missing sentinel, and
scenery one's half record. The build checks left-scroll consistency (gaps under 256, the width
table) and the tables' sizes, failing on any error.

Import reads today's level out of `src/game.6502` once, into the first JSON file. An exported
original level must build the same game as today's source, apart from the fixed slips, and the
gates prove it. New levels are experimental. Code changes are always proved against the original
level.

## Open

- **Chained or absolute scenery records:** recommended chained for v1 (no code, RAM or cycles);
  KC to decide.
- **Room** is found when it's needed (KC).
- **The code changes v1 needs:** the generated include in place of the hand tables; the
  completion point from the include; the helicopter types out of scenery one's bytes into their
  own table; and the debug start column. Each is proved against the original level.
