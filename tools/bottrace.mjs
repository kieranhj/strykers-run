// bottrace.mjs - tools/humanbot.mjs's reasons pass by pass: from pass FROM to TO, every third pass, the view,
// the player's x and y, why the bot chose its keys (the branch: dodge, gun, fight, travel...), the keys, and
// the enemies and projectiles within 60 columns (ALL=1: every mover within 20). For finding where it goes wrong.
//
//   node tools/bottrace.mjs DISC.ssd FROM TO
import { loadMachineSession } from "./jsbeeb_src.mjs";
import { startWorldGame, toWorldPass, pressKeys } from "./playscript.mjs";
import { HumanBot, see } from "./humanbot.mjs";
const MS = await loadMachineSession();
const m = await startWorldGame(MS, process.argv[2]);
const bot = new HumanBot({ seed: 1 }); const [a, b] = [+process.argv[3], +process.argv[4]];
bot.trace = (p, st, why, k) => { if (p >= a && p <= b && p % 3 === 0) console.log(p, "view", st.view, "px", st.px, "py", st.py, why || "travel", JSON.stringify(k), st.movers.filter(o => Math.abs(o.dx) < (process.env.ALL ? 20 : 60) && (process.env.ALL || o.enemy || o.slot >= 0x0c)).map((o) => `${o.slot.toString(16)}:${o.type.toString(16)}@${o.dx}/${o.y}`).join(" ")); };
for (let p = 1; p <= b; p++) { if (await toWorldPass(m, p) !== "pass") break; pressKeys(m, bot.step(p, see(m))); }
