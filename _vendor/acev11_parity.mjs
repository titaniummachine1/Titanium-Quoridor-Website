// ACE v11 parity: JS reference vs Rust port — move/score/depth/nodes must match EXACTLY.
import { createRequire } from "module";
import { execFileSync } from "child_process";
const require = createRequire(import.meta.url);
const { Quoridor, Search } = require("./acev11_engine.js");

function algToAce(t) {
  const col = t.charCodeAt(0) - 97, row = t.charCodeAt(1) - 49;
  if (t.length > 2) {
    const slot = (7 - row) * 8 + col;
    return (t[2] === "h" ? 100 : 200) + slot;
  }
  return (8 - row) * 9 + col;
}

const cases = [
  { name: "startpos", moves: [], depths: [4, 6, 8] },
  { name: "mid-wallfight", moves: ["e2","e8","e3","e7","e4","e6","e3h","e6h","c3h","c6h","g3h","g6h","a3h","e4v","h3v"], depths: [4, 6] },
  { name: "open-jumps", moves: ["e2","e8","e3","e7","e4","e6","e5","e4"], depths: [4, 6] },
  { name: "deep-line", moves: ["e2","e8","e3","e7","e4","e6","d1h","d6h","f4","f6h","f5","e5","d5","c5v","d4","c3v","d3","e4","c1v","f4","f1h","h1v","h2h","g3v"], depths: [4, 6] },
];

let fail = 0;
for (const c of cases) {
  const ints = c.moves.map(algToAce);
  for (const d of c.depths) {
    const g = new Quoridor();
    for (const m of ints) g.makeMove(m);
    const s = new Search(g);
    const r = s.think(1e9, d, true);
    const js = { move: r.move, score: r.score, depth: r.depth, nodes: r.nodes };

    const out = execFileSync("../engine/target/release/titanium",
      ["ace-bench", String(d), ...ints.map(String)], { encoding: "utf8" });
    const rust = JSON.parse(out.trim().split("\n").pop());

    const ok = js.move === rust.move && js.score === rust.score &&
               js.depth === rust.depth && js.nodes === rust.nodes;
    if (!ok) fail++;
    console.log(`${ok ? "OK  " : "FAIL"} ${c.name} d${d}  js=${JSON.stringify(js)} rust=move:${rust.move},score:${rust.score},depth:${rust.depth},nodes:${rust.nodes}`);
  }
}


// ---- RaceProof coverage: burn hands down with legal wall placements ----
function burnWalls(count) {
  const g = new Quoridor();
  const ints = [];
  for (let i = 0; i < count; i++) {
    let placed = false;
    for (let m = 100; m < 300 && !placed; m++) {
      const type = m < 200 ? 0 : 1, slot = m % 100;
      if (slot > 63) continue;
      if (g.wallLegal(type, slot)) { g.makeMove(m); ints.push(m); placed = true; }
    }
    if (!placed) throw new Error("no legal wall");
  }
  return { g, ints };
}

const raceCases = [
  { name: "race-endgame (wl 0/0)", burn: 20, depths: [99] },
  { name: "last-wall (wl 1/0... gate)", burn: 19, depths: [4, 6] },
  { name: "two-left (wl 1/1)", burn: 18, depths: [4, 6] },
];

let fail2 = 0;
for (const c of raceCases) {
  const { ints } = burnWalls(c.burn);
  for (const d of c.depths) {
    const g2 = new Quoridor();
    for (const m of ints) g2.makeMove(m);
    const s = new Search(g2);
    const r = s.think(1e9, d === 99 ? 30 : d, true);
    const js = { move: r.move, score: r.score, depth: r.depth, nodes: r.nodes };

    const out = execFileSync("../engine/target/release/titanium",
      ["ace-bench", String(d === 99 ? 30 : d), ...ints.map(String)], { encoding: "utf8" });
    const rust = JSON.parse(out.trim().split("\n").pop());

    const ok = js.move === rust.move && js.score === rust.score &&
               js.depth === rust.depth && js.nodes === rust.nodes;
    if (!ok) fail2++;
    console.log(`${ok ? "OK  " : "FAIL"} ${c.name} d${d}  js=${JSON.stringify(js)} rust=move:${rust.move},score:${rust.score},depth:${rust.depth},nodes:${rust.nodes}`);
  }
}
process.exit(fail + fail2 ? 1 : 0);
