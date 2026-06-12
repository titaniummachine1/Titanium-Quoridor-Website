// ACE v11 reference run — mirror of `titanium ace-bench`.
// Usage: node acev10_ref_run.js [depth] [moveInt ...]
// Prints the same JSON shape as the Rust side; node counts must match
// EXACTLY if the Rust port is a faithful node-for-node mirror.

const { Quoridor, Search } = require("./acev11_engine.js");

const depth = parseInt(process.argv[2] || "8", 10);
const g = new Quoridor();
for (const a of process.argv.slice(3)) {
  const m = parseInt(a, 10);
  if (!Number.isNaN(m)) g.makeMove(m);
}
console.log("hash", g.hashLo >>> 0, g.hashHi >>> 0);

const s = new Search(g);
const t0 = Date.now();
const r = s.think(1e9, depth, true);
const ms = Date.now() - t0;
console.log(
  JSON.stringify({ move: r.move, score: r.score, depth: r.depth, nodes: r.nodes, ms })
);
