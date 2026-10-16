# Bugs and quirks

Numbered, kept when fixed. Each says what was seen, on what, and what fixed it.

## 1. The ground's texture depends on where the mover sprites are (original behaviour; open)

Seen 2026-10-16 by the relocation test (tools/tracediff.mjs, jsbeeb 2.5.0): with the game
assembled a page lower, the ground drew different pixels. `add_ground_to_column_buffer` reads its
pattern with `LDA (result),Y` where `result` is 0, 1, 4 or 9 - so from &0000-&001C: the screen
start address, two counters, and the zero-page sprite unpacker, whose self-modified operand at
&0005/&0006 holds the address of the last mover sprite drawn. Move the sprites and the ground
changes. Harmless in the original (the pattern only has to look random), but any step 2 change that
moves sprite data or touches that zero page will change how the ground looks. Decide then whether
to keep it (and accept a different-looking ground) or replace it with a fixed texture.
The relocation test builds (`SHIFT` set) read the pattern from &0A00 instead, identical in both.

## 2. Drawing the player's legs reads past the end of the sprite (original behaviour; open)

Seen 2026-10-16 by the relocation test: unpacking `mover_sprite_00` (SPRITE_LEGS_ONE, the last
mover sprite, ending at &3FFF) with the column pointer advanced by clipping, the unpacker read on
past the sprite's last byte - into the screen at &4000 in the original layout, so what it drew
depended on the top-left of the screen at the time. Stopped at `unpack_column_of_sprite`, Y = &1F
from &3FE1 (jsbeeb 2.5.0, frame ~2458 of the lockstep script). Not yet understood why the column
count outruns the data; to look at in step 2, where the sprites will move and this will read
something else. The relocation test builds (`SHIFT` set) put the font after this sprite so the
overrun reads the same bytes in both.
