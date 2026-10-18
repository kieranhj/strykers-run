"""
worldmap.py - the whole world of Stryker's Run (Enhanced), drawn from a build's level data.

    python tools/worldmap.py [build/strykers.ssd] [--out DIR] [--columns N] [--scale S]
                             [--mos FILE] [--hazel FILE] [--json FILE] [--crop LEFT ...]

Reads the level straight from the built disc (MGAME, DATA1-DATA4) and its symbol dump
(build/strykers.symbols.json, beside the .ssd): every table by its label, nothing hard-coded
but the names. Writes, in DIR (default build/worldmap):

  world-background.png  every layer the scroll builds, column by column, end to end: clouds,
                        mountains, scenery two, scenery one, then the ground
  world-objects.png     the same with the movers at their starting places (their real sprites,
                        from the step 2 build's straight sprites; labels above), the enemy
                        helicopters each page brings, the helicopters (and tank) to board, and a
                        line at every trigger point (the player's x that adds a group of movers)
  world.json            (--json) every placement: scenery runs, movers, triggers, helicopters

How the world is built (docs/level-format.md has it all): the original builds the screen's new
right-hand column every time it scrolls right, in the 200-byte column_buffer (index 0 the bottom
row), from four layers on the right edge (edge_and_layer 7 to 4): clouds and mountains (1-byte
records), scenery two (3-byte: sprite|flip, x low, y), scenery one (2-byte: sprite|flip, x low);
then add_ground_to_column_buffer. This tool runs that same walk (scroll_screen_right's
layers_right) for columns 0 .. N-1, so a sprite starts in the first column after the last one in
its layer ended whose low byte is its record's x - exactly as the game places it. Column c is
the one built when viewport_right = c.

Two inputs are not in the build:
  - the MOS ROM's &E000-&E0FF, which picks each column's ground type (BUGS #1's family): --mos,
    default jsbeeb's master/mos3.20 (found as tools/jsbeeb_src.mjs finds jsbeeb), offset &2000
  - HAZEL &C300 on, the mountain layer's data (BUGS #9): --hazel FILE (bytes from &C300), else
    zeros, as jsbeeb has it. On a real Master it is whatever the DFS left there.
The ground's texture also reads zero page &0000-&001E (BUGS #1): &00/&01 is the screen start
(known for every column), &02 `count` (scroll_into_world's, then 0) and &03 `mover_to_update`
(&22 in observer mode, measured; it varies in play, which changes rows of the ground there),
&04-&1E the dead unpacker's bytes, with &05/&06 the `dummy_sprite` address set_sprite_address
leaves there (decision 34).

Pixels: each world column is one MODE 2 byte, two pixels; a MODE 2 pixel is drawn 2 px wide and
1 px tall (times --scale), as on screen. The palette is play's: colours 0-5 and 7 as MODE 2, 6 and
15 black (the game's two cyans, foreground and background), 8 white, 9 black, 10-14 their own
colours; logical 0 is cyan above the palette split and magenta below it (irq1_handler's
top/bottom palette values). --crop LEFT writes crop-LEFT.png: the 80 columns from LEFT, at the
screenshot's scale (tools/worldshots.mjs), for comparing with the emulator.
"""
import argparse
import json
import os
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, str(Path(__file__).parent))
import dfs  # noqa: E402

GAME_ORG = 0x0E00
ROWS = 200                      # column_buffer: index 0 is the bottom row of the screen
VIEW = 80                       # columns on screen
PLAYER_OFFSET = 0x26            # the player's x - viewport_left (start_game, kept by every scroll)
SPLIT_ROW = 111                 # first screen row (from the top) where logical 0 is the bottom colour (measured)
END_PLAYER_X = 0x1CED           # main_game_loop: the completion screen

SCENERY_NAMES = {
    0x00: "WHITE_GREEN_PILLBOX", 0x01: "GREEN_YELLOW_PILLBOX", 0x02: "LOW_GREEN_YELLOW_PILLBOX",
    0x03: "HELICOPTER", 0x04: "MOUNTAINS_ONE", 0x05: "MOUNTAINS_TWO", 0x06: "TREES_ONE",
    0x07: "SIGNPOST", 0x08: "RUNWAY", 0x09: "GRAVES", 0x0A: "LOW_RED_BUILDING",
    0x0B: "GRAVES_WITH_HELMETS", 0x0C: "SANDBAGS", 0x0D: "HIGH_RED_BUILDING",
    0x0E: "HEADQUARTERS_SIGN", 0x0F: "CONNING_TOWER", 0x10: "BRIDGE", 0x11: "OIL_DRUMS",
    0x12: "LOW_RUINS", 0x13: "WHITE_GREEN_PILLBOX_WITH_SKULL", 0x14: "HIGH_RUINS",
    0x15: "TREES_TWO", 0x16: "RED_BUILDING_WITH_DOOR", 0x17: "HANGER", 0x18: "CRANE",
    0x19: "GUN_ON_PILLBOX", 0x1A: "WRECKED_HELICOPTER", 0x1B: "CAMOUFLAGED_BASE",
    0x1C: "WHITE_GREEN_BUILDING_WITH_DOOR", 0x1D: "RUINED_GUN_EMPLACEMENT",
    0x1E: "RUINED_GUN_EMPLACEMENT_MIDDLE", 0x1F: "CAFE_RUINS", 0x20: "GREEN_TOWER_ONE",
    0x21: "RED_TOWER", 0x22: "RED_TOWER_BRIDGE", 0x23: "SLIM_RED_TOWER", 0x24: "JEEP",
    0x25: "STATUE", 0x26: "BIG_TANK_ONE", 0x27: "MOUNT_RUSHMORE", 0x28: "GREEN_TOWER_TWO",
    0x29: "HUGE_CRAFT_LEFT", 0x2A: "HUGE_CRAFT_MIDDLE", 0x2B: "HUGE_CRAFT_RIGHT",
    0x2C: "SHARK_PLANE", 0x2D: "CONNING_TOWER_TWO", 0x2E: "CLOUD_ONE", 0x2F: "CLOUD_TWO",
    0x30: "LOW_GREEN_TOWER", 0x31: "LOW_RED_TOWER", 0x32: "RED_TOWER_WITH_DOOR",
    0x33: "BIG_TANK_TWO", 0x34: "BIG_TANK_THREE", 0x35: "BIG_TANK_FOUR", 0x36: "BIG_HELICOPTER",
    0x37: "HUGE_GUN_EMPLACEMENT_LEFT", 0x38: "LOW_WHITE_TOWER", 0x39: "WOOD_LEFT",
    0x3A: "WOOD_MIDDLE_ONE", 0x3B: "WOOD_MIDDLE_TWO", 0x3C: "WOOD_RIGHT",
    0x3D: "HUGE_GUN_EMPLACEMENT_MIDDLE", 0x3E: "HUGE_GUN_EMPLACEMENT_RIGHT", 0x3F: "CINEMA_RUINS",
    0x40: "WATER_TANK", 0x41: "JAZZ_RUINS",
}
MOVER_NAMES = {
    0x00: "PLAYER", 0x01: "SOLDIER_WITH_RIFLE", 0x02: "OFFICER_WITH_PISTOL", 0x03: "TROOPER_WITH_RIFLE",
    0x04: "TROOPER_WITH_BAZOOKA", 0x05: "HELICOPTER_WITH_MISSILE", 0x06: "HELICOPTER",
    0x07: "HELICOPTER_WITH_SOLDIER", 0x08: "RED_HELICOPTER", 0x09: "MORTAR", 0x0A: "MACHINE_GUN",
    0x0B: "BLUE_CRAFT", 0x0C: "SAM", 0x0D: "SKELETON", 0x0E: "EXPLOSION", 0x0F: "BULLET",
    0x10: "GRENADE", 0x11: "BOMB", 0x12: "ROCKET", 0x13: "MINE", 0x14: "TANK", 0x15: "HEAVY_GUN",
    0x16: "GREEN_WHITE_HELICOPTER", 0x17: "GREEN_WHITE_CRAFT_ONE", 0x18: "GREEN_WHITE_CRAFT_TWO",
    0x19: "FLYING_SCOOTER", 0x1A: "GREEN_WHITE_HELICOPTER_WITH_MISSILE", 0x1B: "SHELL",
}
SHORT = {0x01: "rifle", 0x02: "officer", 0x03: "trooper", 0x04: "bazooka", 0x05: "heli+msl",
         0x06: "heli", 0x07: "heli+sol", 0x08: "red heli", 0x09: "mortar", 0x0A: "m.gun",
         0x0B: "blue craft", 0x0C: "SAM", 0x13: "MINE", 0x14: "TANK", 0x15: "heavy gun",
         0x16: "gw heli", 0x17: "gw craft1", 0x18: "gw craft2", 0x19: "scooter", 0x1A: "gw heli+msl"}

# play's palette: logical colour -> RGB (initialisation and irq1_handler; colour 0 is split)
MODE2_RGB = [(0, 0, 0), (255, 0, 0), (0, 255, 0), (255, 255, 0), (0, 0, 255), (255, 0, 255), (0, 255, 255), (255, 255, 255)]
PLAY_PALETTE = [MODE2_RGB[6], MODE2_RGB[1], MODE2_RGB[2], MODE2_RGB[3], MODE2_RGB[4], MODE2_RGB[5],
                MODE2_RGB[0], MODE2_RGB[7], MODE2_RGB[7], MODE2_RGB[0], MODE2_RGB[2], MODE2_RGB[3],
                MODE2_RGB[4], MODE2_RGB[5], MODE2_RGB[6], MODE2_RGB[0]]
BOTTOM_0 = MODE2_RGB[5]          # logical 0 below the split (start_game: bottom_palette_value &02)


def left_pixel(b):
    return (b >> 4 & 8) | (b >> 3 & 4) | (b >> 2 & 2) | (b >> 1 & 1)


def right_pixel(b):
    return (b >> 3 & 8) | (b >> 2 & 4) | (b >> 1 & 2) | (b & 1)


class Build:
    """The built disc as the game sees it in play: main RAM, the four sideways banks, ANDY."""

    def __init__(self, disc, mos=None, hazel=None):
        self.disc = Path(disc)
        files = dfs.read_image(self.disc).files
        doc = json.loads(self.disc.with_suffix(".symbols.json").read_text())
        self.sym, self.sections = {}, {}
        for sec in doc["assemblies"][0]["sections"]:
            if sec.get("name"):
                self.sections[sec["name"]] = sec
            for k, v in (sec.get("labels") or {}).items():
                if isinstance(v, dict) and isinstance(v.get("value"), int):
                    self.sym.setdefault(k, v["value"])
        self.main = bytearray(0x10000)
        mg = files["MGAME"].data
        self.main[GAME_ORG:GAME_ORG + len(mg)] = mg
        for name in ("moved_0004", "moved_0400", "moved_0880", "moved_0a20"):   # the copy-downs
            if name in self.sections and name + "_load" in self.sym:
                org, size = self.sections[name]["attributes"]["org"], self.sections[name]["size"]
                src = self.sym[name + "_load"]
                self.main[org:org + size] = self.main[src:src + size]
        self.bank = {}
        for n, f, org in ((4, "DATA1", 0x8000), (5, "DATA2", 0x8400), (6, "DATA3", 0x8000), (7, "DATA4", 0x8000)):
            b = bytearray(0x4000)
            d = files[f].data
            b[org - 0x8000:org - 0x8000 + len(d)] = d
            self.bank[n] = b
        self.andy = bytearray(0x1000)
        if "andy_load" in self.sym:
            src = self.sym["andy_load"] - 0x8400
            size = self.sections["andy_data"]["size"]
            self.andy[:size] = self.bank[5][0x400 + src:0x400 + src + size]
        self.hazel = bytearray(0x2000)                      # &C000-&DFFF
        self.hazel_source = "zeros (jsbeeb)"
        if hazel:
            h = Path(hazel).read_bytes()
            self.hazel[0x300:0x300 + len(h)] = h[:0x2000 - 0x300]
            self.hazel_source = str(hazel)
        self.mos, self.mos_source = self._mos(mos)

    @staticmethod
    def _mos(path):
        cands = [Path(path)] if path else []
        roots = [Path(os.environ["LOCALAPPDATA"]) / "npm-cache" / "_npx"] if os.environ.get("LOCALAPPDATA") else []
        roots.append(Path.home() / ".npm" / "_npx")
        for r in roots:
            if r.is_dir():
                cands += sorted(r.glob("*/node_modules/jsbeeb/public/roms/master/mos3.20"))
        for c in cands:
            if c.is_file():
                d = c.read_bytes()
                return d[0x2000:0x2100] if len(d) >= 0x4000 else d[:0x100], str(c)
        print("worldmap: no MOS ROM found (--mos): every column's ground type taken as 0", file=sys.stderr)
        return bytes(256), "none (ground type 0)"

    def T(self, name, n=1, off=0):
        a = self.sym[name] + off
        return list(self.main[a:a + n])

    def size(self, a, b):
        return self.sym[b] - self.sym[a]

    def read(self, addr, bank=4):
        """A byte as the scroll reads it: bank `bank` paged at &8000-&BFFF, HAZEL at &C000-&DFFF."""
        if addr < 0x8000:
            return self.main[addr]
        if addr < 0xC000:
            return self.bank[bank][addr - 0x8000]
        if addr < 0xE000:
            return self.hazel[addr - 0xC000]
        return self.mos[addr - 0xE000] if addr < 0xE100 else 0


def decode_column(read, addr):
    """The run-length column at addr: [index, ...] bottom-up, and the address after its 0."""
    y, rows = addr + 1, []
    while True:
        b = read(y)
        if b == 0:
            return rows, y + 1
        if b & 0x80:
            rows += [b & 0x3F] * (3 if b & 0x40 else 1)
            y += 1
        elif b & 0x40:
            rows += [b & 0x3F] * 2
            y += 1
        else:
            rows += [read(y + 1) & 0x3F] * b
            y += 2


class Scenery:
    """The scenery sprite tables and the pixel tables in their background state."""

    def __init__(self, b):
        n = b.size("scenery_sprite_banks", "flipped_scenery_sprite_addresses_low_table")
        self.n = n
        # indexed by any 7-bit sprite number, as the game does: past n, whatever bytes follow
        # (scenery_data_two's end runs on into the trigger table: sprite &7F, past the headquarters)
        self.banks = b.T("scenery_sprite_banks", 0x80)
        self.flo = b.T("flipped_scenery_sprite_addresses_low_table", 0x80)
        self.fhi = b.T("flipped_scenery_sprite_addresses_high_table", 0x80)
        self.ulo = b.T("unflipped_scenery_sprite_addresses_low_table", 0x80)
        self.uhi = b.T("unflipped_scenery_sprite_addresses_high_table", 0x80)
        self.width = b.T("scenery_sprite_width_table", 0x80)
        # &0400 flipped green, &0440 unflipped green, +&80 the masks; change_pixel_tables(&55)
        # makes the background's cyan colour 15, (&14) the foreground's colour 6
        self.pix_bg = self._tables(b, 0x55)
        self.pix_fg = self._tables(b, 0x14)
        self.mask = {0x00: list(b.main[0x0480:0x04C0]), 0x40: list(b.main[0x04C0:0x0500])}
        self.white = {0x00: list(b.main[0x0500:0x0540]), 0x40: list(b.main[0x0540:0x0580])}

    @staticmethod
    def _tables(b, v):
        t = {0x00: list(b.main[0x0400:0x0440]), 0x40: list(b.main[0x0440:0x0480])}
        t[0x40][0x14], t[0x00][0x28] = v, v
        t[0x00][0x14], t[0x40][0x28] = (v << 1) & 0xFF, (v << 1) & 0xFF
        t[0x00][0x3C] = t[0x40][0x3C] = ((v << 1) & 0xFF) ^ v
        return t


class Layer:
    """One right-edge scenery layer's state (edge_and_layer 4-7)."""

    def __init__(self, index, kind, addr, ypos):
        self.index, self.kind, self.addr = index, kind, addr   # kind: record size (1, 2 or 3)
        self.cur = None                 # the current column's address, None when idle
        self.flip = self.bank = self.y = self.sprite = None
        self.ypos = ypos
        self.run = None


class World:
    def __init__(self, build, columns):
        self.b, self.N = build, columns
        b = build
        self.sc = Scenery(b)
        self.bytes = np.zeros((columns, ROWS), dtype=np.uint8)   # [column, buffer row]
        self.runs = []                  # scenery placements
        self.layers_table = b.T("scenery_layers_table", 8)
        self.ypos = b.T("scenery_layers_y_positions", 8)
        self.mountains = b.T("mountains_table", 4)
        self.clouds = b.T("clouds_table", 4)
        self.clouds_y = b.T("clouds_y_table", 4)
        hi = b.T("initial_scenery_layer_addresses_high", 4)
        lo = b.T("initial_scenery_layer_addresses_low", 4)
        self.layers = [Layer(4 + i, self.layers_table[4 + i], hi[i] << 8 | lo[i], self.ypos) for i in range(4)]
        self.data_end = {}              # layer -> last data address read
        self.g_edge_bot = b.T("ground_edge_bottom_pixel_values", 4)
        self.g_edge_top = b.T("ground_edge_top_pixel_values", 4)
        self.g_edge_mask = b.T("ground_edge_masks", 4)
        self.g_pix = b.T("ground_pixel_values", 8)
        self.zp = bytearray(b.main[0:0x20])
        self.zp[3] = 0x22               # mover_to_update in observer mode (measured, jsbeeb 2.5.0)
        if "dummy_sprite" in b.sym:     # set_sprite_address leaves it at &05/&06 (decision 34)
            self.zp[5], self.zp[6] = b.sym["dummy_sprite"] & 0xFF, b.sym["dummy_sprite"] >> 8
        self.ground_types = []
        self.bridges, self.runways = [], []

    # -- the walk: scroll_screen_right's layers_right, edge_and_layer 7 down to 4 ------------
    def build(self):
        for c in range(self.N):
            col = bytearray(ROWS + 64)   # a little room above, as column_buffer has (&0300 + &C8 on)
            vr = c & 0xFF
            for L in reversed(self.layers):
                self.step(L, c, vr, col)
            self.ground(c, col)
            self.bytes[c] = np.frombuffer(bytes(col[:ROWS]), dtype=np.uint8)
        for L in self.layers:
            if L.run:
                L.run["end"] = self.N - 1
        return self

    def step(self, L, c, vr, col):
        b = self.b
        if L.cur is not None:           # check_for_scenery_when_scrolling_right
            rd = lambda a: b.read(a, L.bank)   # noqa: E731
            if L.flip == 0x00:          # flipped: backwards through the sprite
                back = rd(L.cur)
                L.cur = None if back == 0 else L.cur - back
            else:                        # forward
                _, nxt = decode_column(rd, L.cur)
                L.cur = None if rd(nxt) & 0x80 else nxt
            if L.cur is not None:
                self.draw(L, col)
                return
            L.run["end"] = c - 1
            L.run = None
            L.addr += L.kind
        self.consider(L, c, vr, col)

    def consider(self, L, c, vr, col):  # consider_adding_scenery_when_scrolling_right
        b = self.b
        a = L.addr
        self.data_end[L.index] = a
        if L.kind == 1:
            v = b.read(a)
            x = v & 3
            self.ypos[3] = self.ypos[7] = self.clouds_y[x]
            if a & 0x8000:
                sprite, start = self.mountains[x], True
            else:
                sprite, start = self.clouds[x], vr == v
        else:
            sprite, start = b.read(a), vr == b.read(a + 1)
        if not start:
            return
        s, flip = sprite & 0x7F, ((sprite & 0x80) >> 1) ^ 0x40
        y = b.read(a + 2) if L.kind == 3 else self.ypos[L.index]
        L.sprite, L.flip, L.y, L.bank = s, flip, y, self.sc.banks[s]
        L.cur = (self.sc.ulo[s] | self.sc.uhi[s] << 8) if flip else (self.sc.flo[s] | self.sc.fhi[s] << 8)
        L.run = {"layer": {1: "mountains" if a & 0x8000 else "clouds", 2: "scenery_one", 3: "scenery_two"}[L.kind],
                 "record": a, "sprite": s, "name": SCENERY_NAMES.get(s, f"&{s:02X}"), "flipped": flip == 0,
                 "y": y, "start": c, "end": None, "bank": L.bank, "width": self.sc.width[s]}
        self.runs.append(L.run)
        self.draw(L, col)

    def draw(self, L, col):             # add_column_of_scenery_sprite_to_column_buffer
        rows, _ = decode_column(lambda a: self.b.read(a, L.bank), L.cur)
        pix, msk = self.sc.pix_bg[L.flip], self.sc.mask[L.flip]
        y = L.y
        for i in rows:
            if y < len(col):
                col[y] = (col[y] & msk[i]) ^ pix[i]
            y += 1

    def ground(self, c, col):           # add_ground_to_column_buffer, Y = 1 (the right edge)
        t = self.b.mos[c & 0xFF] & 3
        self.ground_types.append(t)
        zp = self.zp
        ss = 0x4000 + (8 * (c + 1)) % 0x4000          # screen_start_address after this scroll
        zp[0], zp[1] = ss & 0xFF, ss >> 8
        zp[2] = max(0x4F - c, 0)                       # scroll_into_world's count
        result = t * t
        if col[9]:
            self.bridges.append(c)
            return
        if col[21]:
            self.runways.append(c)
            top = 0x13
        else:
            col[22] = self.g_edge_bot[t]
            col[23] = (col[23] & self.g_edge_mask[t]) ^ self.g_edge_top[t]
            top = 0x15
        for y in range(top, -1, -1):
            col[y] = self.g_pix[zp[result + y] & 7]


class Movers:
    """The movers' sprites (the step 2 build's straight format) and placements."""

    def __init__(self, build, scenery):
        b = self.b = build
        self.sc = scenery
        n = b.size("straight_sprite_lo", "straight_sprite_hi")
        self.lo = [b.bank[4][b.sym["straight_sprite_lo"] - 0x8000 + i] for i in range(n)]
        self.hi = [b.bank[4][b.sym["straight_sprite_hi"] - 0x8000 + i] for i in range(n)]
        self.ncols = [b.bank[4][b.sym["sprite_column_count"] - 0x8000 + i] for i in range(n)]
        T = b.T
        self.first = T("mover_types_first_sprite_animation_offsets", 0x40)
        self.parts = T("mover_types_parts", 0x1C)
        self.second = T("mover_types_second_sprite_offset", 0x1C)
        self.third = T("mover_types_third_sprite", 5)
        self.anim = T("animation_table", 0x100)
        self.yoff = T("sprites_y_offset", 0x40)
        self.width = T("mover_types_width_table", 0x1C)
        self.height = T("mover_types_height_table", 0x1C)

    def sprite(self, i):
        """[(first_row, [index, ...] bottom-up)] per column, or None."""
        if i >= len(self.lo):
            return None
        a = self.lo[i] | self.hi[i] << 8
        if a == 0:
            return None
        mem = (lambda x: self.b.andy[x - 0x8000]) if a < 0x9000 else (lambda x: self.b.bank[4][x - 0x8000])
        cols = []
        for _ in range(self.ncols[i] & 0x7F):
            fr, cnt = mem(a), mem(a + 1)
            idx = [mem(a + 2 + k) for k in range(cnt)]
            cols.append((fr, list(reversed(idx))))
            a += 2 + cnt
        return cols

    def parts_of(self, t, frame):       # plot_mover's choice of sprites (tools/sprites.py parts_of)
        out = [(self.anim[(frame + self.first[t]) & 0xFF], 0)]
        if self.parts[t] >= 2:
            return out
        y = self.yoff[(frame + self.second[t]) & 0xFF]
        out.append((self.anim[(frame + self.first[t + 0x1C]) & 0xFF], y))
        if self.parts[t] != 0:
            return out
        out.append((self.third[t], y + 8))
        return out

    def tables_for(self, tc, flip):     # get_mover_type_and_colour: white for most enemies
        white = tc & 0x80 and tc not in (0x85, 0x87) and tc < 0x95
        pix = self.sc.white[flip] if white else self.sc.pix_fg[flip]
        return pix, self.sc.mask[flip]

    def draw(self, world_bytes, tc, x, y, frame=0):
        """(world AND mask) EOR pixel, as the step 2 renderer draws (decision 24). Returns the
        top row drawn (buffer index), or None if nothing was."""
        t = tc & 0x7F
        flip = 0x00 if frame & 0x80 else 0x40
        pix, msk = self.tables_for(tc, flip)
        top = None
        for spr, raise_ in self.parts_of(t, frame & 0x3F):
            cols = self.sprite(spr)
            if not cols:
                continue
            n = len(cols)
            for c, (fr, idx) in enumerate(cols):
                j = c if flip else n - 1 - c
                wx = x + j
                if not 0 <= wx < world_bytes.shape[0]:
                    continue
                for k, i in enumerate(idx):
                    r = y + raise_ + fr + k
                    if 0 <= r < ROWS:
                        world_bytes[wx, r] = (int(world_bytes[wx, r]) & msk[i]) ^ pix[i]
                        top = r if top is None else max(top, r)
        return top


def placements(b):
    """Every mover the level places: [{kind, ...}], and the trigger points."""
    T = b.T
    # scroll_screen_right reads entry trigger_offset + 1, up to 37: the low table's 38th byte is
    # the high table's first (&FE), so entry 37 is &63FE, the sentinel no player x reaches;
    # entry 0 (&FEFF) is scroll_screen_left's. Entries 1-36 are the real trigger points.
    nt = b.size("trigger_points_x_low_table", "trigger_points_x_high_table") + 1
    tlo, thi = T("trigger_points_x_low_table", nt), T("trigger_points_x_high_table", nt)
    triggers = [tlo[i] | thi[i] << 8 for i in range(nt)]
    last = nt - 2                                   # the last real trigger point
    nm = b.size("new_movers_type", "new_movers_initial_x_low")
    mt, mxl, mxh = T("new_movers_type", nm), T("new_movers_initial_x_low", nm), T("new_movers_initial_x_high_and_flags", nm)
    out = []
    for r in range(nm):
        g = r // 3
        flags = mxh[r] & 0xC0
        xl = mxl[r]
        lo_ = max(xl - 0x1E, 0)
        hi_ = min(lo_ + 0x3C, 0xFF)
        base = (mxh[r] & 0x3F) << 8
        spawn = "start" if g < 3 else (f"T{g - 2}" if g - 2 <= last else None)
        out.append({"kind": "mover", "record": r, "group": g, "slot": (g % 3) + 1 + 3 * (r % 3),
                    "type": mt[r], "name": MOVER_NAMES.get(mt[r] & 0x7F, f"&{mt[r]:02X}"),
                    "enemy": bool(mt[r] & 0x80), "x": base | xl, "y": 0x18, "flags": flags,
                    "behaviour": {0x00: "stationary", 0x80: "stationary, lifts gun"}.get(flags, "patrols"),
                    "patrol": [base | lo_, base | hi_] if flags not in (0x00, 0x80) else None,
                    "spawned_at_player_x": triggers[g - 2] if 3 <= g <= last + 2 else (0x26 if g < 3 else None),
                    "spawn": spawn,
                    "replaced_at_player_x": triggers[g + 1] if g + 1 <= last else None})
    nh = b.size("player_helicopters_type", "player_helicopters_initial_x_low")
    ht, hxl, hxh = T("player_helicopters_type", nh), T("player_helicopters_initial_x_low", nh), T("player_helicopters_initial_x_high", nh)
    for i in range(nh):
        out.append({"kind": "boardable", "slot": 0x18 + i, "type": ht[i], "name": MOVER_NAMES.get(ht[i] & 0x7F, f"&{ht[i]:02X}"),
                    "x": hxl[i] | hxh[i] << 8, "y": 0x18})
    hx = T("enemy_helicopters_initial_x", 2)
    htypes = T("new_helicopter_types", b.size("new_helicopter_types", "movers_firing_cooldown"))
    stream = b.sym["enemy_helicopters_initial_x"]
    for p in range(0x1D + 1):
        for k in range(2):
            slot = 0x0A + k
            sel = b.main[stream + slot + p] & 7
            tc = htypes[sel]
            out.append({"kind": "enemy_helicopter", "page": p, "slot": slot, "type": tc,
                        "name": MOVER_NAMES.get(tc & 0x7F, f"&{tc:02X}"), "x": p << 8 | hx[k],
                        "y": [0x73, 0x92], "type_byte": stream + slot + p,
                        "patrol_low": [(hx[k] - 0x28) & 0xFF, (hx[k] - 0x28 + 0x64) & 0xFF],
                        "appears_at_viewport_right": p << 8})
    return triggers, out


# -- drawing --------------------------------------------------------------------------------
def to_image(bytes_, scale=1, split=SPLIT_ROW):
    """[column, buffer row] MODE 2 bytes -> RGB image, top row first, pixels 2 x 1 (x scale)."""
    n = bytes_.shape[0]
    rows = bytes_[:, ::-1].T                          # screen rows top-down, columns across
    lut_l = np.array([left_pixel(v) for v in range(256)], dtype=np.uint8)
    lut_r = np.array([right_pixel(v) for v in range(256)], dtype=np.uint8)
    pix = np.empty((ROWS, n * 2), dtype=np.uint8)
    pix[:, 0::2] = lut_l[rows]
    pix[:, 1::2] = lut_r[rows]
    pix[split:][pix[split:] == 0] = 16                # logical 0 below the split
    pal = np.array(PLAY_PALETTE + [BOTTOM_0], dtype=np.uint8)
    rgb = pal[pix]
    im = Image.fromarray(rgb, "RGB")
    return im.resize((n * 2 * 2 * scale, ROWS * scale), Image.NEAREST)


def font(size):
    try:
        return ImageFont.load_default(size=size)
    except TypeError:
        return ImageFont.load_default()


def ruler(width, ncols, cpx, top_pad=0):
    """A column ruler: ticks every 8 columns, longer every 64, labelled every 256."""
    h = 30
    im = Image.new("RGB", (width, h), (24, 24, 24))
    d = ImageDraw.Draw(im)
    f = font(11)
    for c in range(0, ncols + 1, 8):
        x = int(c * cpx)
        ln = 12 if c % 256 == 0 else 7 if c % 64 == 0 else 3
        d.line([(x, 0), (x, ln)], fill=(220, 220, 220))
        if c % 256 == 0:
            d.text((x + 2, 12), f"&{c:04X} {c}", fill=(255, 255, 255), font=f)
    return im


def compose(world_img, ncols, cpx, top=None):
    r = ruler(world_img.width, ncols, cpx)
    parts = ([top] if top else []) + [world_img, r]
    out = Image.new("RGB", (world_img.width, sum(p.height for p in parts)))
    y = 0
    for p in parts:
        out.paste(p, (0, y))
        y += p.height
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0], formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("disc", nargs="?", default="build/strykers.ssd")
    ap.add_argument("--out", default="build/worldmap")
    ap.add_argument("--columns", type=int, default=None,
                    help="world columns to draw (default: to the last the game can show, the player at the headquarters)")
    ap.add_argument("--scale", type=int, default=1)
    ap.add_argument("--mos", help="the Master's MOS 3.20 ROM (16K or jsbeeb's 128K image): ground types")
    ap.add_argument("--hazel", help="bytes for HAZEL from &C300 (the mountain layer's data); default zeros")
    ap.add_argument("--json", help="also write every placement here")
    ap.add_argument("--crop", type=int, nargs="*", default=[], help="viewport lefts to write 80-column crops for")
    ap.add_argument("--split", type=int, default=SPLIT_ROW, help="screen row the palette split takes effect")
    ap.add_argument("--observed", help="with --crop: a tools/worldshots.mjs directory; also writes crop-observed-LEFT.png, "
                                       "the background with the movers its shot-LEFT.json lists (but the player)")
    a = ap.parse_args()
    b = Build(a.disc, a.mos, a.hazel)
    ncols = a.columns or (END_PLAYER_X - PLAYER_OFFSET + VIEW)
    w = World(b, ncols).build()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    cpx = 4 * a.scale                                 # PNG pixels a column
    bg = to_image(w.bytes, a.scale, a.split)
    compose(bg, ncols, cpx).save(out / "world-background.png", optimize=True)

    triggers, objs = placements(b)
    mv = Movers(b, w.sc)
    ob = w.bytes.copy()
    labels = []
    for o in objs:
        if o["x"] >= ncols:
            continue
        if o["kind"] == "enemy_helicopter":
            y = (o["y"][0] + o["y"][1]) // 2
        else:
            y = o["y"]
        tp = mv.draw(ob, o["type"], o["x"], y)
        o["drawn"] = tp is not None
        labels.append((o, tp if tp is not None else y + 8))
    oi = to_image(ob, a.scale, a.split)
    band_h = 46
    band = Image.new("RGB", (oi.width, band_h), (16, 16, 40))
    db, do = ImageDraw.Draw(band), ImageDraw.Draw(oi)
    f = font(10)
    for i, t in enumerate(triggers):
        if not 0 < t < ncols:
            continue
        x = t * cpx
        for yy in range(0, oi.height, 6):
            do.line([(x, yy), (x, yy + 3)], fill=(255, 255, 0))
        db.line([(x, 0), (x, band_h)], fill=(255, 255, 0))
        db.text((x + 2, 2), f"T{i} x&{t:04X}", fill=(255, 255, 0), font=f)
        db.text((x + 2, 14), f"+group {i + 2}", fill=(255, 255, 0), font=f)
    db.text((4, 30), "yellow: trigger points (player x); labels: group/slot type; white = enemy, green = ally, "
                     "orange = board, red = enemy helicopter (height random &73-&92)", fill=(200, 200, 200), font=f)
    for o, tp in labels:
        x = o["x"] * cpx
        ytop = (ROWS - 1 - tp) * a.scale
        if o["kind"] == "mover":
            col = (255, 255, 255) if o["enemy"] else (0, 160, 0)
            txt = f"g{o['group']} {SHORT.get(o['type'] & 0x7F, o['name'].lower())}"
            if o["patrol"]:
                p0, p1 = o["patrol"]
                yb = (ROWS - 3) * a.scale
                do.line([(p0 * cpx, yb), (p1 * cpx + cpx, yb)], fill=col, width=a.scale)
        elif o["kind"] == "boardable":
            col, txt = (255, 140, 0), f"BOARD {SHORT.get(o['type'] & 0x7F, o['name'])}"
        else:
            col, txt = (255, 60, 60), f"p{o['page']} {SHORT.get(o['type'] & 0x7F, o['name'])}"
            y0 = (ROWS - 1 - o["y"][1] - 20) * a.scale
            y1 = (ROWS - 1 - o["y"][0]) * a.scale
            do.line([(x - 2, y0), (x - 2, y1)], fill=col, width=1)
        ty = max(ytop - 12 * a.scale, 0)
        do.rectangle([x, ty, x + len(txt) * 6, ty + 10], fill=(0, 0, 0))
        do.text((x + 1, ty), txt, fill=col, font=f)
    compose(oi, ncols, cpx, band).save(out / "world-objects.png", optimize=True)

    for left in a.crop:
        crop = w.bytes[left:left + VIEW]
        if crop.shape[0] < VIEW:
            continue
        im = to_image(crop, 1, a.split).resize((VIEW * 8, ROWS * 2), Image.NEAREST)
        im.save(out / f"crop-{left}.png")
        imo = to_image(ob[left:left + VIEW], 1, a.split).resize((VIEW * 8, ROWS * 2), Image.NEAREST)
        imo.save(out / f"crop-objects-{left}.png")
        shot = Path(a.observed) / f"shot-{left}.json" if a.observed else None
        if shot and shot.is_file():         # the movers the emulator had, where it had them
            seen = w.bytes[left:left + VIEW].copy()
            for m in json.loads(shot.read_text())["movers"]:
                if m["slot"] and m["x"] < ncols:
                    mv.draw(seen, m["type"], m["x"] - left, m["y"], m["frame"])
            to_image(seen, 1, a.split).resize((VIEW * 8, ROWS * 2), Image.NEAREST).save(out / f"crop-observed-{left}.png")

    used = {}
    for L in w.layers:
        used[L.index] = w.data_end.get(L.index)
    report = {"disc": str(b.disc), "columns": ncols, "mos": b.mos_source, "hazel": b.hazel_source,
              "layer_data_last_read": {k: f"&{v:04X}" if v is not None else None for k, v in used.items()},
              "runs": w.runs, "triggers": triggers, "objects": objs,
              "bridges": len(w.bridges), "runway_columns": len(w.runways)}
    if a.json:
        Path(a.json).write_text(json.dumps(report, indent=1))
    by = {}
    for r in w.runs:
        by[r["layer"]] = by.get(r["layer"], 0) + 1
    print(f"{ncols} columns: {', '.join(f'{k} {v}' for k, v in sorted(by.items()))} sprites placed; "
          f"{sum(1 for o in objs if o['kind'] == 'mover')} movers in groups of 3, {len(triggers) - 2} trigger points; "
          f"layer data read to {report['layer_data_last_read']}")
    print(f"MOS: {b.mos_source}; HAZEL: {b.hazel_source}")
    for p in ("world-background.png", "world-objects.png"):
        im = Image.open(out / p)
        print(f"wrote {out / p}: {im.width} x {im.height}")


if __name__ == "__main__":
    main()
