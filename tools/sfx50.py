"""sfx50.py - fit 50 Hz ramp scripts for src/lib/sfx50.6502 to sound effects captured from the
MOS (tools/sfxcapture.mjs), and write them out as a source file.

    python tools/sfx50.py CAPTURE.json OUT.6502 [--show] [--no-pad-end]

The capture holds, per effect, the SN76489 writes by MOS centisecond tick from the SOUND call.
For each effect this replays the writes on its own channel (the chip's channel, from the
effect's SOUND block below), samples the channel once a field (every second tick), and splits
what it hears into ramps: N fields over which the period and the volume change by a fixed step
a field, each starting from its own sampled values so errors never build up. A ramp is kept as
long as every field it covers is within tolerance (period: 3% or 2, whichever is more; volume:
1 step).

An effect ends where its channel goes silent for good, or after MAX_FIELDS for a silent tone
(a sweep that only sets the pitch of noise mode 3, which takes tone 2's period).

THE LAST FIELD (2026-10-25). src/lib/sfx50.6502 silences a channel in the same tick that outputs
its last field (sfx_tick: the output, then DEC sfx_n reaching 0, then sfx_next_ramp finding the
end), so that field sounded for microseconds: every effect was a field (20 ms) shorter than the
MOS played it, from decision 25 to 2026-10-25. Each effect's last ramp now gets one more field
(or, at 255, a one-field ramp of its last values), so the field cut is one past the MOS's;
--no-pad-end makes the bytes shipped before. Found by beeb-port-kit's lib/test/sfx50_test.mjs.

The output, per effect, ramps of 6 bytes: fields (0 ends the effect: the channel is silenced),
period low and high (noise: the noise control in the low byte), period step (signed, a field),
volume (amplitude 0-15, times 16, plus 8 so the driver's shift rounds) and volume step (signed, sixteenths a field). Then a table of
the effects' channels (0-2 tone, 3 noise) and addresses.
"""
import json
import sys
from pathlib import Path

NL = "\n"
BS = chr(92)

# The game's SOUND blocks (src/game.6502 sound_data_0880): channel, amplitude, pitch, duration.
# The MOS's channel C is the chip's tone 3 - C, and 0 is the noise (here 3).
EFFECTS = [
    (0x00, 0x10, "explosion: noise (soldier, helicopter, grenade)"),
    (0x08, 0x11, "exploding soldier, grenade: tone 2 sweep, silent (the noise's pitch)"),
    (0x10, 0x11, "exploding helicopter: tone 2 sweep, silent (the noise's pitch)"),
    (0x18, 0x13, "firing grenade"),
    (0x20, 0x12, "firing bullet"),
    (0x28, 0x12, "player landing"),
    (0x30, 0x13, "player jumping"),
    (0x38, 0x10, "exploding grenade: noise"),
]
MAX_FIELDS = 24             # a silent sweep is only heard through the noise it drives


def chip_channel(sound_channel):
    return 3 if sound_channel & 3 == 0 else 3 - (sound_channel & 3)


def samples(writes, ch):
    """The channel's (period or noise control, amplitude) once a field: after ticks 1, 3, 5..."""
    period, att, latch, out, k = 0x3FF if ch < 3 else 0, 15, None, [], 0
    last = max([t for t, _ in writes] + [0])
    for t in range(last + 2):
        while k < len(writes) and writes[k][0] == t:
            v = writes[k][1]
            k += 1
            if v & 0x80:
                c, vol = (v >> 5) & 3, v & 0x10
                latch = (c, vol)
                if c != ch:
                    continue
                if vol:
                    att = v & 15
                elif ch == 3:
                    period = v & 7
                else:
                    period = (period & 0x3F0) | (v & 15)
            elif latch == (ch, 0) and ch < 3:
                period = (period & 15) | ((v & 63) << 4)
        if t % 2 == 1:
            out.append((period, 15 - att))
    return out


def trim(s):
    """Up to where the channel goes silent for good; a silent sweep, MAX_FIELDS."""
    if all(a == 0 for _, a in s):
        return s[:MAX_FIELDS]
    end = max(i for i, (_, a) in enumerate(s) if a > 0) + 1
    return s[:end]


def fits(s, i, j, noise):
    """Does one ramp from field i through j (inclusive) cover every field within tolerance?"""
    n = j - i
    p0, a0 = s[i]
    dp = round((s[j][0] - p0) / n) if n else 0
    dv = round(16 * (s[j][1] - a0) / n) if n else 0
    if not -128 <= dp <= 127 or not -128 <= dv <= 127:
        return None
    for k in range(i, j + 1):
        p, a = s[k]
        pp = p0 + dp * (k - i)
        aa = (a0 * 16 + 8 + dv * (k - i)) >> 4
        if noise and p != p0:
            return None
        if abs(pp - p) > max(2, 0.03 * p) or abs(aa - a) > 1:
            return None
    return dp, dv


def ramps(s, noise):
    out, i = [], 0
    while i < len(s):
        j, best = i, (0, 0)
        while j + 1 < len(s) and j + 1 - i < 255:
            r = fits(s, i, j + 1, noise)
            if r is None:
                break
            j, best = j + 1, r
        out.append((j - i + 1, s[i][0], best[0], s[i][1], best[1]))
        i = j + 1
    return out


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    show = "--show" in sys.argv
    pad_end = "--no-pad-end" not in sys.argv
    capture, outfile = args
    effects = json.loads(Path(capture).read_text())["effects"]
    c = BS + " "
    lines = [c + Path(outfile).name + " - GENERATED by tools/sfx50.py from " + Path(capture).name + "; do not edit.",
             c + "The game's sound effects as 50 Hz ramps for src/lib/sfx50.6502 (step 2 layer 3,",
             c + "decision 25), fitted to the MOS's own playing of each (tools/sfxcapture.mjs).",
             c + "Each ramp: fields, period (low, high), period step, amplitude * 16 + 8, amplitude step."]
    if pad_end:
        lines.append(c + "Each effect's last ramp is a field longer than the MOS's playing: the driver silences a")
        lines.append(c + "channel in the tick that outputs its last field (tools/sfx50.py, THE LAST FIELD).")
    total = 0
    for off, chan, what in EFFECTS:
        ch = chip_channel(chan)
        s = trim(samples(effects[str(off)], ch))
        rs = ramps(s, ch == 3)
        if pad_end and rs:
            n, p, dp, a, dv = rs[-1]
            if n < 255:
                rs[-1] = (n + 1, p, dp, a, dv)
            else:
                rs.append((1, p + dp * n, 0, (a * 16 + 8 + dv * n) >> 4, 0))
        total += 6 * len(rs) + 1
        lines.append("")
        lines.append(f".sfx_effect_{off:02x}{' ' * 20}{c}{what}: chip channel {ch}, {len(s)} fields")
        for n, p, dp, a, dv in rs:
            lines.append(f"    EQUB {n}, &{p & 255:02X}, &{p >> 8:02X}, {dp & 255}, &{a * 16 + 8:02X}, {dv & 255}"
                         f"{' ' * 4}{c}period {p} {dp:+d}, amplitude {a} {dv / 16:+.2f}")
        lines.append("    EQUB 0")
        if show:
            # what the ramps play, against what the MOS played
            got = []
            for n, p, dp, a, dv in rs:
                for k in range(n):
                    got.append((p + dp * k, (a * 16 + 8 + dv * k) >> 4))
            print(f"&{off:02X} ch {ch}: {len(rs)} ramps for {len(s)} fields")
            print("  MOS:   " + " ".join(f"{p}/{a}" for p, a in s[:40]))
            print("  ramps: " + " ".join(f"{p}/{a}" for p, a in got[:40]))
    lines.append("")
    # sfx_effect_channel: read by nothing (play_sound takes the channel from the SOUND block); kept
    # where flags-off builds have it, its 8 bytes the gameplay builds' 4 more effects (decision 69)
    lines.append("IF GAMEPLAY_SHIELD = 0")
    lines.append(".sfx_effect_channel")
    lines.append("    EQUB " + ", ".join(str(chip_channel(chan)) for _, chan, _ in EFFECTS))
    lines.append("ENDIF")
    extra = [f"sfx_effect_{off:02x}" for off in EXTRA]
    for half in ("lo", "hi"):
        lines.append(f".sfx_effect_{half}")
        lines.append("    EQUB " + ", ".join(f"{half.upper()}(sfx_effect_{off:02x})" for off, _, _ in EFFECTS))
        lines.append("IF GAMEPLAY_SHIELD" + " " * 18 + c + "src/sfx_gameplay.6502's, effects 8-11 (requests 9-12)")
        lines.append("    EQUB " + ", ".join(f"{half.upper()}({e})" for e in extra))
        lines.append("ENDIF")
    Path(outfile).write_text(NL.join(lines) + NL)
    print(f"wrote {outfile}: {len(EFFECTS)} effects, {total + 3 * len(EFFECTS)} bytes")


EXTRA = (0x40, 0x48, 0x50, 0x58)   # decision 69: the gameplay builds' own, hand-written in src/sfx_gameplay.6502


if __name__ == "__main__":
    main()
