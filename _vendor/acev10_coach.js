
(function () {
  "use strict";

  /* ======== pure coaching logic (DOM-free; exported as CoachLogic for tests) ======== */
  var MATE_C = typeof MATE !== "undefined" ? MATE : 100000;

  function winProb(scoreCp) { return 1 / (1 + Math.exp(-scoreCp / 400)); }

  function classify(lossCp) {
    if (lossCp < 80) return { key: "ok", mark: "", label: "Good move" };
    if (lossCp < 200) return { key: "inaccuracy", mark: "?!", label: "Inaccuracy" };
    if (lossCp <= 400) return { key: "mistake", mark: "?", label: "Mistake" };
    return { key: "blunder", mark: "??", label: "Blunder" };
  }

  function cellName(c) { return "abcdefghi"[c % 9] + (9 - ((c / 9) | 0)); }
  function moveName(m) {
    if (m < 100) return cellName(m);
    var slot = m % 100, r = (slot / 8) | 0, c = slot % 8;
    return "wall " + "abcdefgh"[c] + (8 - r) + (m < 200 ? "h" : "v");
  }

  /* tiny independent board model: derived ONLY from the move list + move encoding
     (no engine internals; bits N=1 S=2 W=4 E=8 like the rules of the game itself) */
  var DELTA_C = [-9, 9, -1, 1]; // N S W E
  function newModel() {
    return { pawn: [76, 4], wl: [10, 10], turn: 0,
             blocked: new Uint8Array(81), hw: new Uint8Array(64), vw: new Uint8Array(64) };
  }
  function setWall(md, type, slot, on) {
    var r = (slot / 8) | 0, c = slot % 8, a = r * 9 + c;
    if (type === 0) {
      md.hw[slot] = on ? 1 : 0;
      if (on) { md.blocked[a] |= 2; md.blocked[a + 1] |= 2; md.blocked[a + 9] |= 1; md.blocked[a + 10] |= 1; }
      else { md.blocked[a] &= ~2; md.blocked[a + 1] &= ~2; md.blocked[a + 9] &= ~1; md.blocked[a + 10] &= ~1; }
    } else {
      md.vw[slot] = on ? 1 : 0;
      if (on) { md.blocked[a] |= 8; md.blocked[a + 9] |= 8; md.blocked[a + 1] |= 4; md.blocked[a + 10] |= 4; }
      else { md.blocked[a] &= ~8; md.blocked[a + 9] &= ~8; md.blocked[a + 1] &= ~4; md.blocked[a + 10] &= ~4; }
    }
  }
  function applyModel(md, m) {
    if (m < 100) md.pawn[md.turn] = m;
    else if (m < 200) { setWall(md, 0, m - 100, true); md.wl[md.turn]--; }
    else { setWall(md, 1, m - 200, true); md.wl[md.turn]--; }
    md.turn ^= 1;
  }
  function buildModel(moves) {
    var md = newModel();
    for (var i = 0; i < moves.length; i++) applyModel(md, moves[i]);
    return md;
  }
  function wallFitsM(md, type, slot) {
    if (md.hw[slot] || md.vw[slot]) return false;
    var r = (slot / 8) | 0, c = slot % 8;
    if (type === 0) return !(c > 0 && md.hw[slot - 1]) && !(c < 7 && md.hw[slot + 1]);
    return !(r > 0 && md.vw[slot - 8]) && !(r < 7 && md.vw[slot + 8]);
  }
  var BQ_C = new Int16Array(81), BD_C = new Uint8Array(81);
  function bfsDist(md, player) { // steps to goal row, walls only (same metric as the engine eval)
    var goal = player === 0 ? 0 : 8, start = md.pawn[player];
    if (((start / 9) | 0) === goal) return 0;
    BD_C.fill(255);
    var head = 0, tail = 0;
    BD_C[start] = 0; BQ_C[tail++] = start;
    while (head < tail) {
      var u = BQ_C[head++], du = BD_C[u] + 1, r = (u / 9) | 0, c = u % 9, b = md.blocked[u];
      for (var d = 0; d < 4; d++) {
        if (b & (1 << d)) continue;
        if ((d === 0 && r === 0) || (d === 1 && r === 8) || (d === 2 && c === 0) || (d === 3 && c === 8)) continue;
        var v = u + DELTA_C[d];
        if (BD_C[v] <= du) continue;
        if (((v / 9) | 0) === goal) return du;
        BD_C[v] = du; BQ_C[tail++] = v;
      }
    }
    return 255; // sealed — impossible after legal moves
  }
  function worstWallCut(md, victim) {
    // strongest legal wall (for the side to move in md) against victim's path; returns steps added
    if (md.wl[md.turn] <= 0) return 0;
    var base = bfsDist(md, victim), worst = 0;
    for (var type = 0; type < 2; type++) {
      for (var slot = 0; slot < 64; slot++) {
        if (!wallFitsM(md, type, slot)) continue;
        setWall(md, type, slot, true);
        var dv = bfsDist(md, victim);
        if (dv !== 255 && dv - base > worst && bfsDist(md, 1 - victim) !== 255) worst = dv - base;
        setWall(md, type, slot, false);
      }
    }
    return worst;
  }
  // engine-fact extraction for one candidate move in the position reached by baseMoves
  function factsFor(baseMoves, move) {
    var md = buildModel(baseMoves);
    var me = md.turn, opp = 1 - me;
    var d0 = bfsDist(md, me), e0 = bfsDist(md, opp);
    applyModel(md, move);
    var d1 = bfsDist(md, me), e1 = bfsDist(md, opp);
    return {
      move: move, isWall: move >= 100,
      d0: d0, e0: e0, d1: d1, e1: e1,
      myGain: d0 - d1,                  // how much the move shortened my path
      oppHurt: e1 - e0,                 // how much it lengthened the opponent's
      exposure: worstWallCut(md, me),   // worst single wall reply against my path
      wallsLeft: md.wl[me]              // my walls left after the move
    };
  }
  function whyLine(hu, en) {
    if (!en || hu.move === en.move) return "This is exactly what the engine would play.";
    var enN = moveName(en.move);
    if (hu.isWall && hu.oppHurt <= 0)
      return "Your wall does not slow the engine at all (still " + hu.e1 + " steps to its goal)" +
             (en.isWall ? "; " + enN + " would have added +" + en.oppHurt + " to its path." :
                          "; " + enN + " makes progress instead of spending a wall.");
    if (hu.exposure - en.exposure >= 2)
      return "Your move shortened your path by " + hu.myGain + " but leaves it exposed: one wall reply can now add +" +
             hu.exposure + " to your route; after " + enN + " the worst wall adds only +" + en.exposure + ".";
    if (en.oppHurt - hu.oppHurt >= 2)
      return enN + " would have lengthened the engine's path by +" + en.oppHurt +
             " (your move: +" + Math.max(0, hu.oppHurt) + ").";
    if (!en.isWall && en.myGain - hu.myGain >= 1)
      return "Your move shortened your path by " + hu.myGain + "; " + enN + " gets you closer (" +
             en.d1 + " vs " + hu.d1 + " steps to goal).";
    return "After your move: you " + hu.d1 + ", engine " + hu.e1 + " steps to goal. After " + enN +
           ": you " + en.d1 + ", engine " + en.e1 + ".";
  }

  /* ---- instant narration (AI-vs-AI teacher): a one-line comment computed from path
     facts ALONE, so every exhibition move gets commentary immediately, even before
     the deep analysis (which adds the graded verdict) has finished. Never empty. */
  function narrate(f) {
    var n = moveName(f.move);
    if (!f.isWall) {
      if (f.d1 === 0) return n + ": steps onto the goal row — game over.";
      if (f.myGain > 0) return n + ": advances along the shortest path (" + f.d1 + " to go" +
        (f.exposure >= 2 ? ", though one wall reply could add +" + f.exposure : "") + ").";
      return n + ": repositions without progress (still " + f.d1 + " steps to goal).";
    }
    if (f.oppHurt > 0) return n + ": +" + f.oppHurt + " to the opponent's path" +
      (f.myGain < 0 ? " at a cost of +" + (-f.myGain) + " to its own" : "") +
      " (" + f.wallsLeft + " wall" + (f.wallsLeft === 1 ? "" : "s") + " left).";
    return n + ": a wall that does not slow the opponent right now — prophylaxis or a waste.";
  }

  /* ======== Coach v2 pure logic (learning-science mechanisms) ========
     (b) SPACED REPETITION, SM-2-lite. Mechanism: the spacing effect — re-testing a
     mistake at expanding intervals, just before it would be forgotten, strengthens
     long-term retention far more than immediate massed repetition. Intervals are
     measured in GAMES (1 -> 3 -> 7). "Success" = solving the puzzle within two
     tries; success climbs the ladder, a failure (lapse) resets it to 1, and an
     item that clears the 7-game rung is retired. */
  var SRS_STEPS = [1, 3, 7];
  function srsNew(posKey, moves, played, best, loss, gamesNow) {
    return { k: posKey, moves: moves, played: played, best: best, loss: loss,
             streak: 0, interval: SRS_STEPS[0], due: gamesNow + SRS_STEPS[0],
             lapses: 0, retired: false, created: gamesNow };
  }
  function srsUpdate(item, success, gamesNow) {
    if (success) {
      item.streak = (item.streak || 0) + 1;
      if (item.streak >= SRS_STEPS.length) { item.retired = true; return item; } // cleared 1,3,7
      item.interval = SRS_STEPS[item.streak];   // 1st success -> 3 games out, 2nd -> 7
    } else {
      item.streak = 0; item.lapses = (item.lapses || 0) + 1;
      item.interval = SRS_STEPS[0];             // lapse: back to a 1-game interval
    }
    item.due = gamesNow + item.interval;
    return item;
  }
  function srsDue(items, gamesNow) {
    return items.filter(function (it) { return !it.retired && it.due <= gamesNow; });
  }

  /* (c) DESIRABLE DIFFICULTY (adaptive strength). Mechanism: learning is maximized
     when the task sits just beyond the learner's comfort zone — here a human win
     rate held near 50-60%. We nudge ONLY the engine's time budget (a transparent,
     honestly displayed handicap); evaluations, grading and rules are never bent. */
  function adaptBudget(ms, winRate) {
    var next = ms;
    if (winRate > 0.60) next = Math.round(ms * 1.5);       // player cruising -> engine thinks longer
    else if (winRate < 0.50) next = Math.round(ms / 1.5);  // player struggling -> engine thinks less
    if (next < 40) next = 40;        // floor: still a real opponent
    if (next > 10000) next = 10000;  // cap: matches the "Insane" preset
    return next;
  }

  /* ======== Coach v3 pure logic — "Skill Accelerator" (COACH_V3_LOGIC) ========
     Six mechanisms, each tagged with the learning-science principle it
     implements. Everything in this section is DOM-free and exported on
     CoachLogic so test_coach3.js and gen_drills.js run the EXACT code the
     browser runs. */

  /* (1) ERROR TAXONOMY — principle: DIAGNOSIS BEFORE REMEDY. Deliberate practice
     starts by naming the weakness; "play more" is the slowest teacher. Every
     graded mistake is classified from the same path facts the WHY templates use
     (factsFor), so the diagnosis is cheap, explainable, and identical offline
     (gen_drills.js mining) and online (the weakness radar). Precedence is fixed:
     the first matching rule wins, making the classifier deterministic. */
  var TAXONOMY = [
    { key: "ENDGAME_RACE_ERR", label: "Endgame races",
      tip: "With all walls spent the game is pure arithmetic: count both paths, mind the jump, walk the shortest line." },
    { key: "WALL_WASTE", label: "Wasted walls",
      tip: "A wall that adds nothing to the opponent's path is a lost tempo AND a lost wall. Count the +steps before placing." },
    { key: "WRONG_SIDE_WALL", label: "Wrong-side walls",
      tip: "Right idea, wrong slot. Compare neighbouring slots' +steps before committing — one is usually worth 2 more." },
    { key: "MISSED_CUT", label: "Missed cuts",
      tip: "When one wall adds 2+ steps to the opponent and wins you the race, it beats every pawn move." },
    { key: "MISSED_DEFENSE", label: "Unguarded chokepoints",
      tip: "Before racing ask: what is the worst wall the opponent can drop on MY path next move? Guard or pass it first." },
    { key: "RACE_TEMPO", label: "Tempo judgment",
      tip: "Every move is one tempo. Run when running wins; disrupt when it does not; never do half of each." }
  ];
  function catIndex(key) {
    for (var ci = 0; ci < TAXONOMY.length; ci++) if (TAXONOMY[ci].key === key) return ci;
    return -1;
  }
  // hu/en = factsFor(played)/factsFor(engine's best); myWalls/oppWalls = hands BEFORE the move
  function classifyError(hu, en, myWalls, oppWalls) {
    if (myWalls === 0 && oppWalls === 0) return "ENDGAME_RACE_ERR";          // hands empty: pure race arithmetic
    if (hu.isWall && hu.oppHurt <= 0) return "WALL_WASTE";                   // wall with no path effect
    if (hu.isWall && en && en.isWall && en.oppHurt - hu.oppHurt >= 2)
      return "WRONG_SIDE_WALL";                                              // walled, but the good slot was elsewhere
    if (!hu.isWall && en && en.isWall && en.oppHurt >= 2 && en.d1 < en.e1)
      return "MISSED_CUT";                                                   // a race-winning cut existed; you moved
    if (en && hu.exposure - en.exposure >= 2) return "MISSED_DEFENSE";       // left your own chokepoint open
    return "RACE_TEMPO";                                                     // tempo/race misjudgment (incl. moved-when-wall-needed)
  }

  /* (2) DRILL MATERIAL — data/*.jsonl records are raw states, but every loader
     in the app replays MOVE LISTS, so we synthesize a state-faithful
     pseudo-game: makeMove validates nothing, so teleporting pawn moves and
     direct wall drops are mechanically fine, and wall OWNERSHIP is not part of
     Quoridor state — only the hand counts are. Pad no-ops and teleports come
     FIRST and walls LAST, so the engine's repetition window (which reaches back
     only to the last wall ply) cannot see the synthetic prefix. */
  function hexWalls(s) { // 16 hex chars -> 64 wall bits (datagen.js bit order)
    var a = new Uint8Array(64);
    for (var hi = 0; hi < 16; hi++) {
      var v = parseInt(s.charAt(hi), 16);
      a[4 * hi] = v & 1; a[4 * hi + 1] = (v >> 1) & 1; a[4 * hi + 2] = (v >> 2) & 1; a[4 * hi + 3] = (v >> 3) & 1;
    }
    return a;
  }
  function synthMoves(pos) { // {p0,p1,w0,w1,t,hw,vw} -> replayable move list (or null)
    var hw = hexWalls(pos.hw), vw = hexWalls(pos.vw), wallMoves = [], s, i;
    for (s = 0; s < 64; s++) { if (hw[s]) wallMoves.push(100 + s); if (vw[s]) wallMoves.push(200 + s); }
    var n0 = 10 - pos.w0, n1 = 10 - pos.w1;
    if (n0 < 0 || n1 < 0 || wallMoves.length !== n0 + n1) return null; // not a game-derived record
    var A = [], B = [];
    if (pos.p0 !== 76) A.push(pos.p0);              // teleport before walls
    if (pos.p1 !== 4) B.push(pos.p1);
    for (i = 0; i < n0; i++) A.push(wallMoves[i]);  // ownership arbitrary; only counts matter
    for (i = n0; i < n0 + n1; i++) B.push(wallMoves[i]);
    var c0 = Math.max(A.length, B.length + (pos.t === 1 ? 1 : 0));
    var c1 = c0 - (pos.t === 1 ? 1 : 0);
    while (A.length < c0) A.unshift(76);            // no-op pad on the start square
    while (B.length < c1) B.unshift(4);
    var out = [];
    for (i = 0; i < c0; i++) { out.push(A[i]); if (i < c1) out.push(B[i]); }
    return out;
  }
  function drillTier(pos) { // backward-curriculum tiers, by walls still IN HAND
    var hand = pos.w0 + pos.w1;
    if (hand === 0) return 0;   // L1 pure races (ground truth = race arithmetic)
    if (hand === 1) return 1;   // L2 one-wall endings
    if (hand <= 3) return 2;    // L3 two/three-wall endings
    if (hand <= 12) return 3;   // L4 wall-fight middlegames
    return 4;                   // L5 openings (most walls in hand)
  }
  /* drill pack loader. file:// forbids fetch, so the pack ships as drills.js (a
     sibling <script src> file setting window.QuoridorDrills); quoridor.html and
     drills.js MUST travel together. Everything degrades politely without it. */
  function drillRow(row) { // [catIdx, tier, p0, p1, w0, w1, t, hw, vw, sc, best, aux]
    if (!row || row.length < 12) return null;
    var cat = TAXONOMY[row[0]];
    if (!cat) return null;
    if (typeof row[7] !== "string" || row[7].length !== 16 ||
        typeof row[8] !== "string" || row[8].length !== 16) return null;
    if (typeof row[10] !== "number") return null;
    return { cat: cat.key, tier: row[1],
             pos: { p0: row[2], p1: row[3], w0: row[4], w1: row[5], t: row[6], hw: row[7], vw: row[8] },
             sc: row[9], best: row[10], aux: row[11] };
  }
  function drillIndex(pack) {
    var idx = { ok: false, n: 0, all: [], byCat: {}, byTier: [[], [], [], [], []] }, i, d;
    for (i = 0; i < TAXONOMY.length; i++) idx.byCat[TAXONOMY[i].key] = [];
    if (!pack || !Array.isArray(pack.drills)) return idx;  // graceful fallback: empty index
    for (i = 0; i < pack.drills.length; i++) {
      d = drillRow(pack.drills[i]);
      if (!d || d.tier < 0 || d.tier > 4) continue;
      idx.byCat[d.cat].push(d); idx.byTier[d.tier].push(d); idx.all.push(d); idx.n++;
    }
    idx.ok = idx.n > 0;
    return idx;
  }

  /* (3) BACKWARD CURRICULUM — principle: endgames-first (classic chess pedagogy:
     Capablanca taught endings before openings). Endgame drills have few pieces,
     near-ground-truth verdicts and instant feedback — ideal early learning;
     wall-fights and openings come once the arithmetic is automatic. Advance on
     >= 80% over the last 10 attempts at the level. */
  var CUR_LEVELS = [
    { name: "L1 pure races", tier: 0 },
    { name: "L2 one-wall endings", tier: 1 },
    { name: "L3 two-wall endings", tier: 2 },
    { name: "L4 wall-fight middlegames", tier: 3 },
    { name: "L5 openings", tier: 4 }
  ];
  function curriculumAdvance(hist) { // hist: 0/1 results, most recent LAST
    if (!hist || hist.length < 10) return false;
    var s = 0, last = hist.slice(-10);
    for (var i = 0; i < last.length; i++) s += last[i] ? 1 : 0;
    return s >= 8;
  }
  /* exact fastest pawn step for L1 instant verdicts (race arithmetic ground
     truth; real engine jump rules via genPawnMoves) */
  var RBG_G = null;
  function raceBestGain(moves) {
    if (typeof Quoridor === "undefined") return 1;
    if (!RBG_G) RBG_G = new Quoridor();
    RBG_G.loadState({ moves: moves });
    var buf = new Int16Array(16), n = RBG_G.genPawnMoves(buf, 0), best = -99, i, f;
    for (i = 0; i < n; i++) { f = factsFor(moves, buf[i]); if (f.myGain > best) best = f.myGain; }
    return best;
  }

  /* (4) SNAP JUDGMENT — principle: perceptual CHUNKING. Masters evaluate
     positions at a glance because they have judged tens of thousands; flashing
     a position, forcing a fast call and giving instant feedback trains exactly
     that recognition loop. Difficulty self-adjusts: the score margin SHRINKS
     while you are accurate (subtler positions) and widens when you miss. */
  var SNAP_MIN = 80, SNAP_MAX = 800;
  function snapAdjust(margin, hist) {
    var next = margin;
    if (hist && hist.length >= 6) {
      var last = hist.slice(-10), s = 0, i;
      for (i = 0; i < last.length; i++) s += last[i] ? 1 : 0;
      var acc = s / last.length;
      if (acc >= 0.8) next = margin * 0.75;        // accurate -> harder (smaller margin)
      else if (acc <= 0.55) next = margin / 0.75;  // missing -> clearer positions
    }
    next = Math.round(next);
    if (next < SNAP_MIN) next = SNAP_MIN;
    if (next > SNAP_MAX) next = SNAP_MAX;
    return next;
  }
  function snapPick(all, margin, rnd) { // prefer |sc| in [margin, 3*margin]
    if (!all || !all.length) return null;
    var band = [], loose = [], i, a;
    for (i = 0; i < all.length; i++) {
      a = Math.abs(all[i].sc);
      if (a >= margin && a <= margin * 3) band.push(all[i]);
      else if (a >= margin) loose.push(all[i]);
    }
    var pool = band.length ? band : (loose.length ? loose : all);
    return pool[(rnd() * pool.length) | 0];
  }
  function snapVerdictWho(sc, stm, answer) { // sc is from the side-to-move's view
    var winner = sc > 0 ? stm : 1 - stm;
    return answer === winner;
  }

  /* (5) RATING ESTIMATE — principle: VISIBLE PROGRESS sustains motivation
     (goal-gradient effect). HONESTY NOTE, do not delete: this is a LOCAL
     ladder. The engine's level is mapped from its time budget as
       elo(ms) = 1800 + 60 * log2(ms / 4000)
     where the 1800 anchor for "Max" is ARBITRARY and the ~60-Elo-per-doubling
     slope is eyeballed from this project's own gauntlet history (each ~2x
     speed/time bundle scored 55-61%, i.e. +35..+75 Elo). The number is
     comparable to itself across days — NOT to FIDE, Lichess or anything else. */
  function engineEloOfMs(ms) {
    if (!ms || ms <= 0) ms = 400;
    return Math.round(1800 + 60 * (Math.log(ms / 4000) / Math.LN2));
  }
  function eloExpected(rp, re) { return 1 / (1 + Math.pow(10, (re - rp) / 400)); }
  function ratingUpdate(rating, engElo, score, gamesPlayed) {
    var k = gamesPlayed < 10 ? 48 : 24; // provisional fast, then steady
    return Math.round(rating + k * (score - eloExpected(rating, engElo)));
  }

  /* (6) INTERLEAVING — principle: interleaved practice (mixing item types)
     feels harder but measurably beats massed blocks for retention/transfer. */
  function interleave(pools) { // round-robin across pools, consuming them
    var out = [], more = true, i;
    while (more) {
      more = false;
      for (i = 0; i < pools.length; i++) if (pools[i].length) { out.push(pools[i].shift()); more = true; }
    }
    return out;
  }

  var Logic = { winProb: winProb, classify: classify, cellName: cellName, moveName: moveName,
                buildModel: buildModel, applyModel: applyModel, bfsDist: bfsDist,
                worstWallCut: worstWallCut, factsFor: factsFor, whyLine: whyLine,
                narrate: narrate, srsNew: srsNew, srsUpdate: srsUpdate, srsDue: srsDue,
                adaptBudget: adaptBudget, SRS_STEPS: SRS_STEPS,
                // Coach v3 (skill accelerator)
                TAXONOMY: TAXONOMY, catIndex: catIndex, classifyError: classifyError,
                setWall: setWall, wallFitsM: wallFitsM, newModel: newModel,
                hexWalls: hexWalls, synthMoves: synthMoves, drillTier: drillTier,
                drillRow: drillRow, drillIndex: drillIndex,
                CUR_LEVELS: CUR_LEVELS, curriculumAdvance: curriculumAdvance, raceBestGain: raceBestGain,
                snapAdjust: snapAdjust, snapPick: snapPick, snapVerdictWho: snapVerdictWho,
                SNAP_MIN: SNAP_MIN, SNAP_MAX: SNAP_MAX,
                engineEloOfMs: engineEloOfMs, eloExpected: eloExpected, ratingUpdate: ratingUpdate,
                interleave: interleave };
  if (typeof window !== "undefined") window.CoachLogic = Logic;
  else if (typeof global !== "undefined") global.CoachLogic = Logic;
  if (typeof document === "undefined") return; // Node test path: pure logic only

  /* ======== DOM ======== */
  var CB = window.CoachBridge;
  if (!CB || typeof Quoridor === "undefined" || typeof Search === "undefined") return;
  function $(id) { return document.getElementById(id); }

  var st = document.createElement("style");
  st.id = "coachstyle";
  st.textContent = [
    "#coachtoggle { font-size: 13px; color: var(--dim); display: inline-flex; align-items: center; gap: 5px; cursor: pointer; user-select: none; }",
    "#coachtoggle input { accent-color: var(--wallpre); cursor: pointer; }",
    "#boardrow { display: flex; gap: 10px; align-items: stretch; }",
    "#evalbar { width: 13px; border-radius: 6px; background: #463338; position: relative; overflow: hidden; border: 1px solid #4a5260; display: none; }",
    "body.coach-on #evalbar { display: block; }",
    "#evalfill { position: absolute; bottom: 0; left: 0; width: 100%; height: 50%; background: linear-gradient(180deg, #8cc7f2, var(--p0)); transition: height 0.6s ease; }",
    "#evalmid { position: absolute; top: 50%; left: 0; width: 100%; height: 0; border-top: 1px dashed rgba(255,255,255,0.4); }",
    "#evalbar.analyzing #evalfill { opacity: 0.55; }",
    "#coachpanel { display: none; margin-top: 12px; width: 100%; max-width: calc(var(--cell) * 12.5 + 60px); background: #232830; border: 1px solid #3a414c; border-radius: 10px; padding: 10px 14px; font-size: 13px; line-height: 1.45; }",
    "body.coach-on #coachpanel { display: block; }",
    "#coachhead { display: flex; justify-content: space-between; color: var(--dim); font-size: 11px; letter-spacing: 1px; margin-bottom: 6px; }",
    "#coachstatus { color: var(--wall); }",
    ".sevbadge { display: inline-block; padding: 1px 8px; border-radius: 10px; font-weight: 600; font-size: 12px; margin-right: 8px; }",
    ".sev-best, .sev-ok { background: rgba(126,201,126,0.16); color: var(--wallpre); }",
    ".sev-inaccuracy { background: rgba(232,176,74,0.16); color: var(--wall); }",
    ".sev-mistake { background: rgba(224,123,57,0.18); color: #e09a6a; }",
    ".sev-blunder { background: rgba(217,106,106,0.18); color: var(--wallbad); }",
    ".dimtext { color: var(--dim); }",
    "#coachfb .why { margin-top: 5px; }",
    "#coachfb .better { margin-top: 4px; color: var(--dim); }",
    "#coachfb .better b { color: var(--wallpre); }",
    "#coachretry { display: block; margin-top: 8px; padding: 4px 12px; font-size: 12px; background: #4a3338; border-color: #7a4a52; }",
    "#coachreview h4 { font-size: 11px; color: var(--dim); letter-spacing: 1px; margin: 10px 0 4px; }",
    ".revitem { display: block; width: 100%; text-align: left; margin: 3px 0; padding: 5px 9px; font-size: 12px; background: #2b3038; }",
    ".revitem b { color: var(--txt); }",
    ".coachhint { z-index: 4; pointer-events: none; border-radius: 4px; }",
    ".coachhint.wall { border: 2px dashed var(--wallpre); box-shadow: 0 0 8px rgba(126,201,126,0.5); }",
    ".coachhint.cell { border: 2px dashed var(--wallpre); border-radius: 8px; }",
    /* AI-vs-AI: the teacher panel + eval bar are visible even with Coach unchecked */
    "body.ai-on #evalbar { display: block; }",
    "body.ai-on #coachpanel { display: block; }",
    ".coachhint.guess { border-color: var(--wall); box-shadow: 0 0 8px rgba(232,176,74,0.5); }",
    ".pvghost { z-index: 5; pointer-events: none; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 13px; color: #fff; text-shadow: 0 1px 2px #000; }",
    ".pvghost.pawn0 { border: 2px dashed var(--p0); border-radius: 50%; margin: 13%; background: rgba(90,169,230,0.3); }",
    ".pvghost.pawn1 { border: 2px dashed var(--p1); border-radius: 50%; margin: 13%; background: rgba(230,106,106,0.3); }",
    ".pvghost.wallg { border: 2px dashed var(--wallbad); border-radius: 4px; background: rgba(217,106,106,0.25); }",
    "#coachshow { display: inline-block; margin-top: 8px; margin-left: 8px; padding: 4px 12px; font-size: 12px; }",
    "#coachretry { display: inline-block; }",
    "#guessbar button, #pzbar button { margin: 6px 6px 0 0; font-size: 12px; padding: 3px 10px; }",
    "#adaptline { margin-top: 6px; font-size: 11px; color: var(--dim); }",
    "#coachopts { margin-top: 8px; padding-top: 8px; border-top: 1px solid #3a414c; display: none; flex-wrap: wrap; gap: 12px; align-items: center; font-size: 12px; color: var(--dim); }",
    "body.coach-on #coachopts { display: flex; }",
    "#coachopts label { display: inline-flex; gap: 4px; align-items: center; cursor: pointer; user-select: none; }",
    "#coachopts input { accent-color: var(--wallpre); cursor: pointer; }",
    "#trainbtn { font-size: 12px; padding: 3px 10px; }",
    "#trainbtn .due { color: var(--wall); font-weight: 600; }"
  ].join("\n");
  document.head.appendChild(st);

  var controls = document.querySelector(".controls");
  var lab = document.createElement("label");
  lab.id = "coachtoggle";
  lab.innerHTML = '<input type="checkbox" id="coachchk"> Coach';
  controls.appendChild(lab);

  var board = $("board");
  var row = document.createElement("div");
  row.id = "boardrow";
  board.parentNode.insertBefore(row, board);
  var bar = document.createElement("div");
  bar.id = "evalbar";
  bar.innerHTML = '<div id="evalfill"></div><div id="evalmid"></div>';
  bar.title = "win probability (you)";
  row.appendChild(bar);
  row.appendChild(board);

  var panel = document.createElement("div");
  panel.id = "coachpanel";
  var defaultFbHtml = '<span class="dimtext">Make a move — I will grade it and show what the engine preferred.</span>';
  panel.innerHTML = '<div id="coachhead"><span>COACH</span><span id="coachstatus"></span></div>' +
                    '<div id="coachfb">' + defaultFbHtml + '</div>' +
                    '<div id="coachreview"></div>' +
                    '<div id="adaptline"></div>' +
                    '<div id="coachopts">' +
                    '<label title="Retrieval practice: commit your move before seeing the engine\'s choice, then both are graded">' +
                    '<input type="checkbox" id="guesschk"> Guess first</label>' +
                    '<label title="Desirable difficulty: nudges the engine\'s think time toward a 50-60% human win rate (handicap shown here)">' +
                    '<input type="checkbox" id="adaptchk"> Adaptive strength</label>' +
                    '<button id="trainbtn" title="Spaced repetition: your past mistakes come back as puzzles when they are due">Train <span class="due" id="traindue"></span></button>' +
                    '</div>';
  row.parentNode.insertBefore(panel, row.nextSibling);

  // ghost placement shared by hints, guess markers and PV steps.
  // Takes an ENGINE move id; maps to VIEW coords via the bridge (board-flip aware).
  function placeGhost(el, m) {
    var v = CB.viewMove ? CB.viewMove(m) : m;
    if (v < 100) {
      var r = (v / 9) | 0, c = v % 9;
      el.style.gridRow = String(2 * r + 1); el.style.gridColumn = String(2 * c + 1);
    } else {
      var slot = v % 100, wr = (slot / 8) | 0, wc = slot % 8;
      if (v < 200) { el.style.gridRow = String(2 * wr + 2); el.style.gridColumn = (2 * wc + 1) + " / span 3"; }
      else { el.style.gridRow = (2 * wr + 1) + " / span 3"; el.style.gridColumn = String(2 * wc + 2); }
    }
    return v;
  }

  // better-move hint overlay (grid coordinates mirror the UI's gridPos/addWallEl)
  var hintNode = null, hintTimer = 0;
  function clearHint() {
    if (hintNode) { hintNode.remove(); hintNode = null; }
    if (hintTimer) { clearTimeout(hintTimer); hintTimer = 0; }
  }
  function showHint(m) {
    clearHint();
    var el = document.createElement("div");
    var v = CB.viewMove ? CB.viewMove(m) : m;
    el.className = "coachhint " + (v < 100 ? "cell" : "wall");
    placeGhost(el, m);
    board.appendChild(el);
    hintNode = el;
    hintTimer = setTimeout(clearHint, 4000);
  }

  /* (d) ELABORATION — refutation animation. Mechanism: elaborative feedback (seeing
     WHY an answer is wrong, not just that it is wrong) builds richer memory traces.
     "Show me" rewinds to the blunder and plays the punishment line as numbered
     ghost steps on the real board. Pure overlay: game state is never touched. */
  var pvSeq = 0, pvEng = null, pvNodes = [], pvTimers = [];
  function clearPv() {
    pvSeq++;
    pvTimers.forEach(clearTimeout); pvTimers = [];
    pvNodes.forEach(function (n) { n.remove(); }); pvNodes = [];
  }
  function pvGhost(m, mover, label) {
    var el = document.createElement("div");
    var v = CB.viewMove ? CB.viewMove(m) : m;
    el.className = "pvghost " + (v < 100 ? "pawn" + mover : "wallg");
    placeGhost(el, m);
    el.textContent = label;
    board.appendChild(el);
    pvNodes.push(el);
  }
  // 2-3 quick engine probes with yields between them (main thread, ~250ms each);
  // degrades gracefully: whatever portion of the PV exists by then is animated.
  function pvCompute(moves, plies, cb) {
    var my = ++pvSeq, acc = [];
    if (!pvEng) {
      try { var g = new Quoridor(); pvEng = { g: g, s: new Search(g) }; } catch (e) { return; }
    }
    function step() {
      if (my !== pvSeq) return;          // superseded / cleared
      if (acc.length >= plies) { cb(acc); return; }
      pvEng.g.loadState({ moves: moves.concat(acc) });
      if (pvEng.g.winner() >= 0) { cb(acc); return; }
      var r;
      try { r = pvEng.s.think(250, 30, true); } catch (e) { cb(acc); return; }
      if (!r.move) { cb(acc); return; }
      acc.push(r.move);
      pvTimers.push(setTimeout(step, 30));
    }
    pvTimers.push(setTimeout(step, 30));
  }
  function animatePv(baseMoves, seq) {
    var mover = baseMoves.length % 2;
    for (var i = 0; i < seq.length; i++) {
      (function (idx, mv, who) {
        pvTimers.push(setTimeout(function () { pvGhost(mv, who, String(idx + 1)); }, 650 * idx));
      })(i, seq[i], mover);
      mover ^= 1;
    }
    pvTimers.push(setTimeout(clearPv, 650 * seq.length + 2800));
  }
  function showRefutation(e) {
    if (CB.moves().length > e.ply) CB.restore(e.ply);   // rewind to just before the blunder
    var after = e.moves.concat([e.move]);
    pvCompute(after, 3, function (pv) {
      animatePv(e.moves, [e.move].concat(pv));          // step 1 = the blunder, 2-4 = punishment
      $("coachfb").innerHTML = '<span class="dimtext">Watch the board: <b>1</b> is your move, ' +
        'the following steps show how the engine punishes it. Then find a better move.</span>';
    });
  }

  /* ======== background analysis (own worker; sliced like ponderLoop; token-guarded) ======== */
  var ANALYZE_MS = 1200, SLICE_MS = 150, MAXD = 30;
  var coachOn = false;
  var token = 1;             // analysis epoch; bumped on new game / undo / restore / load / toggle-off
  var results = {};          // key -> latest {ply, token, move, score, depth, winner, done}
  var queue = [];            // jobs waiting: ply numbers, or {key, moves} for explicit lines
  var running = null;        // key being analyzed right now
  var pendingJudge = null;   // {ply, move}: move awaiting verdict (human, or either AI in exhibition)
  var record = [];           // graded moves this game (for the post-game review)
  function cbAiMode() { return !!(CB.aiMode && CB.aiMode()); }
  function analysisOn() { return coachOn || cbAiMode(); } // AI exhibition narrates even with Coach off

  var cworker = null, cworkerTried = false;
  function makeCoachWorker() {
    try {
      var glue = [
        "var CG=new Quoridor();var CS=new Search(CG);var cur=0;",
        "function slice(d,spent){",
        "  if(d.token!==cur)return;",
        "  CG.loadState({moves:d.moves});",
        "  var w=CG.winner();",
        "  if(w>=0){self.postMessage({ply:d.ply,token:d.token,winner:w,done:true});return;}",
        "  var r=CS.think(d.sliceMs,d.maxDepth,true);", // sliced full analysis; TT accumulates
        "  spent+=d.sliceMs;",
        "  var done=spent>=d.totalMs||r.depth>=d.maxDepth||r.score>MATE-200||r.score<-(MATE-200);",
        "  self.postMessage({ply:d.ply,token:d.token,move:r.move,score:r.score,depth:r.depth,done:done});",
        "  if(!done)setTimeout(function(){slice(d,spent);},0);",
        "}",
        "self.onmessage=function(ev){var d=ev.data;cur=d.token;",
        "  if(d.type==='analyze')setTimeout(function(){slice(d,0);},0);};"
      ].join("\n");
      var src = document.getElementById("enginecode").textContent + "\n" + glue;
      var w = new Worker(URL.createObjectURL(new Blob([src], { type: "text/javascript" })));
      w.onmessage = function (ev) { onResult(ev.data); };
      w.onerror = function () {
        try { w.terminate(); } catch (e) {}
        if (cworker === w) cworker = null;
        if (running !== null) { running = null; pump(); }
      };
      return w;
    } catch (e) { return null; }
  }
  function getWorker() {
    if (!cworkerTried) { cworkerTried = true; cworker = makeCoachWorker(); }
    return cworker;
  }

  // main-thread fallback (degraded): short slices, yields, and defers to a thinking engine
  var fbToken = 0, fbState = null;
  function fallbackRun(job) {
    if (!fbState) {
      try { var g = new Quoridor(); fbState = { g: g, s: new Search(g) }; }
      catch (e) { if (running === job.ply) running = null; return; }
    }
    var myTok = ++fbToken, spent = 0;
    function slice() {
      if (myTok !== fbToken || job.token !== token) return;
      if (CB.busy() && !CB.hasWorker()) { setTimeout(slice, 250); return; } // engine owns the main thread
      fbState.g.loadState({ moves: job.moves });
      var w = fbState.g.winner();
      if (w >= 0) { onResult({ ply: job.ply, token: job.token, winner: w, done: true }); return; }
      var r = fbState.s.think(90, job.maxDepth, true);
      spent += 90;
      var done = spent >= job.totalMs || r.depth >= job.maxDepth || r.score > MATE_C - 200 || r.score < -(MATE_C - 200);
      onResult({ ply: job.ply, token: job.token, move: r.move, score: r.score, depth: r.depth, done: done });
      if (!done) setTimeout(slice, 40);
    }
    setTimeout(slice, 40);
  }

  function qKey(q) { return typeof q === "number" ? q : q.key; }
  function neededKey(k, cur) {
    if (typeof k === "string") { // explicit-line jobs (guess grading / puzzle grading)
      if (pendingGuess && k === pendingGuess.lineKey) return true;
      if (Puzzle.active && Puzzle.needs(k)) return true;
      return false;
    }
    if (k === cur) return true; // current position: eval bar + next baseline
    if (pendingJudge && (k === pendingJudge.ply || k === pendingJudge.ply + 1)) return true;
    return false;
  }
  function ensureJob(ply) {
    if (!analysisOn()) return;
    if (results[ply] && results[ply].done) { return; }
    if (running === ply || queue.indexOf(ply) >= 0) return;
    queue.push(ply);
    pump();
  }
  function ensureJobLine(key, moves) { // analyze an explicit move list (not a game prefix)
    if (!analysisOn()) return;
    if (results[key] && results[key].done) { // cached: notify consumers directly
      tryRevealGuess();
      if (Puzzle.active) Puzzle.onResult(results[key]);
      return;
    }
    if (running === key) return;
    for (var i = 0; i < queue.length; i++) if (qKey(queue[i]) === key) return;
    queue.push({ key: key, moves: moves.slice() });
    pump();
  }
  function pump() {
    if (!analysisOn() || running !== null || !queue.length) { refreshStatus(); return; }
    var cur = CB.moves().length;
    queue = queue.filter(function (q) { return neededKey(qKey(q), cur); });
    queue.sort(function (a, b) { // numeric plies ascending (baselines before judges), lines last
      var ka = qKey(a), kb = qKey(b);
      if (typeof ka === "number" && typeof kb === "number") return ka - kb;
      if (typeof ka === "number") return -1;
      if (typeof kb === "number") return 1;
      return 0;
    });
    if (!queue.length) { refreshStatus(); return; }
    var q = queue.shift(), key = qKey(q);
    running = key;
    var job = { type: "analyze", ply: key, token: token,
                moves: typeof q === "number" ? CB.moves().slice(0, q) : q.moves,
                sliceMs: SLICE_MS, totalMs: queue.length ? 700 : ANALYZE_MS, maxDepth: MAXD };
    var w = getWorker();
    if (w) {
      try { w.postMessage(job); refreshStatus(); return; } catch (e) { cworker = null; }
    }
    fallbackRun(job);
    refreshStatus();
  }
  function onResult(r) {
    if (r.token !== token) return; // stale epoch
    results[r.ply] = r;
    if (r.done && running === r.ply) running = null;
    if (r.ply === CB.moves().length && !CB.over()) updateBar(r);
    tryJudge();
    tryRevealGuess();
    if (Puzzle.active) Puzzle.onResult(r);
    if (r.done) pump();
  }

  /* ======== eval bar ======== */
  function isTerm(r) { return typeof r.winner === "number" && r.winner >= 0; }
  function setBarP(p, analyzing) {
    $("evalfill").style.height = (p * 100).toFixed(1) + "%";
    bar.title = (cbAiMode() ? "P0 (bottom) wins " : "you win ") + Math.round(p * 100) + "%";
    bar.classList.toggle("analyzing", !!analyzing);
  }
  function updateBar(r) {
    if (isTerm(r)) { setBarP(r.winner === CB.human() ? 1 : 0, false); return; }
    var sHuman = (r.ply % 2) === CB.human() ? r.score : -r.score; // turn at ply k is k%2
    setBarP(winProb(sHuman), !r.done);
  }
  function updateBarTerminal() {
    var mv = CB.moves();
    if (!mv.length) return;
    setBarP(((mv.length - 1) % 2) === CB.human() ? 1 : 0, false); // winner = mover of the final move
  }

  /* ======== judging + feedback ======== */
  function tryJudge() {
    if (!pendingJudge) return;
    var base = results[pendingJudge.ply], after = results[pendingJudge.ply + 1];
    if (!base || !base.done || !after || !after.done) return;
    var pj = pendingJudge;
    pendingJudge = null;
    judge(pj, base, after);
  }
  function judge(pj, base, after) {
    var mover = pj.ply % 2;     // side that played; equals CB.human() in normal coach games
    var bestScore = base.score; // mover to move at base -> already mover's perspective
    var newScoreMover = isTerm(after) ? (after.winner === mover ? MATE_C : -MATE_C) : -after.score;
    var loss = Math.max(0, bestScore - newScoreMover);
    var isBest = pj.move === base.move;
    if (isBest) loss = 0;
    var sev = isBest ? { key: "best", mark: "!", label: "Best move" } : classify(loss);
    var baseMoves = CB.moves().slice(0, pj.ply);
    var why;
    try {
      var hu = factsFor(baseMoves, pj.move);
      var en = !isBest && base.move ? factsFor(baseMoves, base.move) : null;
      why = whyLine(hu, en);
      if (hu.isWall && hu.wallsLeft <= 2 && loss >= 200)
        why += " You have only " + hu.wallsLeft + " wall" + (hu.wallsLeft === 1 ? "" : "s") + " left.";
    } catch (e) { why = ""; }
    var entry = { ply: pj.ply, move: pj.move, loss: loss, best: base.move, sev: sev, why: why,
                  mover: mover, moves: baseMoves };
    record.push(entry);
    // (b) spaced repetition: the human's mistakes/blunders become future puzzles
    if (coachOn && !cbAiMode() && mover === CB.human()) {
      captureSrs(entry);
      v3Graded(entry); // Coach v3 (1): every graded human move feeds the weakness radar
    }
    showFeedback(entry);
    if (CB.over()) renderReview();
  }
  function showFeedback(e) {
    var fb = $("coachfb");
    var ai = cbAiMode();
    var lossTxt = e.loss > 1000 ? "−10+" : "−" + (e.loss / 100).toFixed(1);
    var side = ai ? '<span class="dimtext">' + (e.mover === 0 ? "P0 (bottom): " : "P1 (top): ") + '</span>' : "";
    var html = '<span class="sevbadge sev-' + e.sev.key + '">' + e.sev.label +
               (e.sev.mark ? " " + e.sev.mark : "") + '</span>' + side + '<b>' + moveName(e.move) + '</b>' +
               (e.loss >= 80 ? ' <span class="dimtext">(' + lossTxt + ')</span>' : "");
    if (e.sev.key !== "best" && e.best && e.best !== e.move)
      html += '<div class="better">Engine preferred <b>' + moveName(e.best) + '</b> (highlighted on the board)</div>';
    if (e.why) html += '<div class="why">' + e.why + '</div>';
    fb.innerHTML = html;
    if (e.sev.key === "blunder" && !ai && e.mover === CB.human()) {
      var btn = document.createElement("button");
      btn.id = "coachretry";
      btn.textContent = "Retry that move";
      btn.addEventListener("click", function () { CB.restore(e.ply); });
      fb.appendChild(btn);
      // (d) elaboration: animate the refutation so the player sees WHY it fails
      var sm = document.createElement("button");
      sm.id = "coachshow";
      sm.textContent = "Show me why";
      sm.addEventListener("click", function () { showRefutation(e); });
      fb.appendChild(sm);
    }
    if (e.sev.key !== "best" && e.best && e.best !== e.move) showHint(e.best);
  }

  /* ======== post-game review ======== */
  function renderReview() {
    var rv = $("coachreview");
    var ai = cbAiMode();
    var worst = record.filter(function (e) { return e.loss >= 80 && (ai || e.mover === CB.human()); })
                      .sort(function (a, b) { return b.loss - a.loss; }).slice(0, 3);
    if (!worst.length) {
      rv.innerHTML = record.length ? '<h4>GAME REVIEW</h4><div class="dimtext">No significant errors — clean game.</div>' : "";
      return;
    }
    rv.innerHTML = '<h4>GAME REVIEW — worst moves (click one to replay from there)</h4>';
    worst.forEach(function (e) {
      var b = document.createElement("button");
      b.className = "revitem";
      var who = ai ? (e.mover === 0 ? "P0 move " : "P1 move ") : "your move ";
      b.innerHTML = who + (((e.ply / 2) | 0) + 1) + ": <b>" + moveName(e.move) + "</b> " + e.sev.mark +
                    " (" + (e.loss > 1000 ? "−10+" : "−" + (e.loss / 100).toFixed(1)) + ") · better: <b>" +
                    moveName(e.best) + "</b>";
      b.addEventListener("click", function () { CB.restore(e.ply); });
      rv.appendChild(b);
    });
  }

  /* ======== Coach v2 state (persisted; all features inert unless Coach is ON) ======== */
  var LS2 = "quoridor_coach2", LSRS = "quoridor_srs_v1";
  var S2 = { guess: false, adaptive: false, ms: 400, recent: [], games: 0 };
  try {
    var s2raw = JSON.parse(localStorage.getItem(LS2) || "null");
    if (s2raw && typeof s2raw === "object" && !Array.isArray(s2raw)) {
      S2.guess = !!s2raw.guess; S2.adaptive = !!s2raw.adaptive;
      if (typeof s2raw.ms === "number" && s2raw.ms >= 40 && s2raw.ms <= 10000) S2.ms = s2raw.ms;
      if (Array.isArray(s2raw.recent)) S2.recent = s2raw.recent.slice(-8);
      if (typeof s2raw.games === "number" && s2raw.games >= 0) S2.games = s2raw.games;
    }
  } catch (e) {}
  var SRS = [];
  try {
    var sraw = JSON.parse(localStorage.getItem(LSRS) || "null");
    if (Array.isArray(sraw)) SRS = sraw.filter(function (it) {
      return it && Array.isArray(it.moves) && typeof it.best === "number" && typeof it.due === "number";
    });
  } catch (e) {}
  function saveS2() { try { localStorage.setItem(LS2, JSON.stringify(S2)); } catch (e) {} }
  function saveSrs() {
    if (SRS.length > 40) SRS = SRS.filter(function (it) { return !it.retired; }).slice(-40); // bound storage
    try { localStorage.setItem(LSRS, JSON.stringify(SRS)); } catch (e) {}
  }
  function refreshTrainBadge() {
    var d = srsDue(SRS, S2.games).length;
    $("traindue").textContent = "(" + d + " due)";
  }
  function refreshAdapt() {
    var el = $("adaptline");
    if (!coachOn || !S2.adaptive) { el.textContent = ""; return; }
    var n = S2.recent.length, w = 0;
    for (var i = 0; i < n; i++) w += S2.recent[i];
    // honesty requirement: the handicap is stated outright, never hidden
    el.textContent = "Adaptive strength ON — engine gets " + S2.ms + " ms/move (overrides the Strength selector)" +
                     (n ? " · your recent record: " + w + "/" + n : "") + ".";
  }
  // (b) capture material for spaced repetition: mistakes (?) and blunders (??)
  function captureSrs(entry) {
    if (entry.loss < 200 || !entry.best || entry.best === entry.move) return;
    var key = entry.moves.join(",");
    for (var i = 0; i < SRS.length; i++) if (SRS[i].k === key) return; // one item per position
    SRS.push(srsNew(key, entry.moves.slice(), entry.move, entry.best, Math.round(entry.loss), S2.games));
    saveSrs(); refreshTrainBadge();
  }
  // one bump of the game counter per finished human game (drives SRS due dates + adaptivity)
  var gameCounted = false;
  function onGameEnd() {
    if (gameCounted || cbAiMode() || Puzzle.active || Trainer.active) return;
    gameCounted = true;
    v3GameEnd();       // Coach v3 (5): rating estimate vs the engine's ms ladder
    sessionGameDone(); // Coach v3 (6): daily-session epilogue (no-op outside a session)
    S2.games++;                              // the SRS clock ticks in games, not days
    if (S2.adaptive && coachOn) {            // (c) desirable difficulty: nudge the time budget
      var mv = CB.moves();
      if (mv.length) {
        S2.recent.push(((mv.length - 1) % 2) === CB.human() ? 1 : 0);
        if (S2.recent.length > 8) S2.recent.shift();
        var w = 0;
        for (var i = 0; i < S2.recent.length; i++) w += S2.recent[i];
        S2.ms = adaptBudget(S2.ms, w / S2.recent.length);
      }
    }
    saveS2(); refreshAdapt(); refreshTrainBadge();
  }

  /* ======== (a) GUESS FIRST — retrieval practice / hypercorrection ========
     Mechanism: the testing effect — committing to an answer BEFORE seeing the
     correct one produces stronger learning than passive study; and hypercorrection
     — errors made with confidence, then corrected by immediate feedback, are the
     best-remembered corrections of all. The player's click is held as a committed
     guess; the engine's preferred move is revealed only afterwards; both are
     graded; the player then chooses which move to actually play. */
  var pendingGuess = null, guessSkip = null, guessNode = null, guessTimer = 0;
  function clearGuess(drop) {
    if (guessTimer) { clearTimeout(guessTimer); guessTimer = 0; }
    if (guessNode) { guessNode.remove(); guessNode = null; }
    if (drop) pendingGuess = null;
  }
  function drawGuessGhost() {
    if (guessNode) { guessNode.remove(); guessNode = null; }
    if (!pendingGuess) return;
    var el = document.createElement("div");
    var v = CB.viewMove ? CB.viewMove(pendingGuess.move) : pendingGuess.move;
    el.className = "coachhint guess " + (v < 100 ? "cell" : "wall");
    placeGhost(el, pendingGuess.move);
    board.appendChild(el);
    guessNode = el;
  }
  CB.beforeMove = function (m) {
    if (!coachOn || !S2.guess || Puzzle.active || Trainer.active || cbAiMode() || CB.over()) return false;
    if (pendingGuess) return true;           // a guess is already committed: swallow stray clicks
    var ply = CB.moves().length;
    pendingGuess = { ply: ply, move: m, lineKey: "g:" + ply + ":" + m, revealed: false };
    drawGuessGhost();
    $("coachfb").innerHTML = '<span class="dimtext">Guess committed: </span><b>' + moveName(m) +
      '</b><span class="dimtext"> — grading it before the reveal…</span>';
    ensureJob(ply);                                        // baseline (the engine's choice)
    ensureJobLine(pendingGuess.lineKey, CB.moves().concat([m]));
    guessTimer = setTimeout(function () { revealGuess(true); }, 5000); // degrade: partial reveal
    refreshStatus();
    return true;                                           // hold the move
  };
  function tryRevealGuess() { revealGuess(false); }
  function revealGuess(timedOut) {
    if (!pendingGuess || pendingGuess.revealed) return;
    var pg = pendingGuess;
    var base = results[pg.ply], line = results[pg.lineKey];
    if (!timedOut && (!base || !base.done || !line || !line.done)) return; // wait for both analyses
    pg.revealed = true;
    if (guessTimer) { clearTimeout(guessTimer); guessTimer = 0; }
    var entry = null, html;
    var baseMoves = CB.moves();
    if (base && typeof base.move === "number" && base.move) {
      var mover = pg.ply % 2, isBest = pg.move === base.move, loss = 0, graded = true;
      if (!isBest) {
        if (line && typeof line.score === "number") {
          var lineSc = isTerm(line) ? (line.winner === mover ? MATE_C : -MATE_C) : -line.score;
          loss = Math.max(0, base.score - lineSc);
        } else if (isTerm(line || {})) {
          loss = line.winner === mover ? 0 : MATE_C;
        } else { graded = false; }
      }
      var sev = isBest ? { key: "best", mark: "!", label: "Best move" }
                       : (graded ? classify(loss) : { key: "ok", mark: "", label: "Ungraded" });
      var why = "";
      try {
        if (!isBest) why = whyLine(factsFor(baseMoves, pg.move), factsFor(baseMoves, base.move));
      } catch (e) {}
      entry = { ply: pg.ply, move: pg.move, loss: loss, best: base.move, sev: sev, why: why,
                mover: mover, moves: baseMoves.slice(), guess: true };
      // hypercorrection: a confidently wrong guess is prime spaced-repetition material
      if (graded) { captureSrs(entry); v3Graded(entry); } // v3: guesses feed the radar too
      html = '<span class="sevbadge sev-' + sev.key + '">Your guess: ' + sev.label +
             (sev.mark ? " " + sev.mark : "") + '</span><b>' + moveName(pg.move) + '</b>' +
             (graded && loss >= 80 ? ' <span class="dimtext">(−' + (loss > 1000 ? "10+" : (loss / 100).toFixed(1)) + ')</span>' : "") +
             (!isBest ? '<div class="better">Engine prefers <b>' + moveName(base.move) + '</b> (highlighted)</div>' : "") +
             (why ? '<div class="why">' + why + '</div>' : "");
      if (!isBest) showHint(base.move);
    } else {
      html = '<span class="dimtext">Analysis did not finish in time — your guess stands ungraded.</span>';
    }
    html += '<div id="guessbar"></div>';
    $("coachfb").innerHTML = html;
    var gb = $("guessbar");
    function gbtn(label, fn) {
      var b = document.createElement("button");
      b.textContent = label;
      b.addEventListener("click", fn);
      gb.appendChild(b);
    }
    gbtn("Play my move", function () { resolveGuess(pg, entry, pg.move); });
    if (entry && entry.best && entry.best !== pg.move)
      gbtn("Play " + moveName(entry.best) + " (engine)", function () { resolveGuess(pg, entry, entry.best); });
    gbtn("Cancel", function () {
      pendingGuess = null; clearGuess(false); clearHint();
      $("coachfb").innerHTML = defaultFbHtml;
    });
  }
  function resolveGuess(pg, entry, chosen) {
    if (pendingGuess !== pg) return;
    pendingGuess = null;
    clearGuess(false);
    var rec = null;
    if (entry && chosen === pg.move) rec = entry;
    else if (entry && chosen === entry.best)
      rec = { ply: pg.ply, move: chosen, loss: 0, best: chosen,
              sev: { key: "best", mark: "!", label: "Best move" }, why: "",
              mover: pg.ply % 2, moves: entry.moves };
    if (rec) record.push(rec);
    guessSkip = { ply: pg.ply, move: chosen };  // the move handler must not double-judge it
    if (CB.play) CB.play(chosen);
    if (CB.moves().length <= pg.ply) { guessSkip = null; return; }  // play was rejected
    if (rec) showFeedback(rec);
    else $("coachfb").innerHTML = '<span class="dimtext">Played ' + moveName(chosen) + '.</span>';
  }

  /* ======== (b) TRAIN — spaced-repetition puzzles from your own mistakes ======== */
  var gsEng = null;
  function gradeAttemptSync(baseMoves, m, ms) {
    // synchronous two-probe grade (~2x ms); used only on puzzle attempts where a
    // short main-thread block is fine and determinism beats async fragility
    try {
      if (!gsEng) { var g2 = new Quoridor(); gsEng = { g: g2, s: new Search(g2) }; }
      gsEng.g.loadState({ moves: baseMoves });
      var rb = gsEng.s.think(ms, 30, true);
      if (rb.move === m) return { loss: 0, best: rb.move };
      var mover = baseMoves.length % 2;
      gsEng.g.loadState({ moves: baseMoves.concat([m]) });
      var w = gsEng.g.winner(), moverScore;
      if (w >= 0) moverScore = w === mover ? MATE_C : -MATE_C;
      else { var ra = gsEng.s.think(ms, 30, true); moverScore = -ra.score; }
      return { loss: Math.max(0, rb.score - moverScore), best: rb.move };
    } catch (e) { return null; }  // degrade: exact-match-only checking
  }
  var Puzzle = {
    active: false, list: [], idx: 0, item: null, tries: 0, solved: 0,
    needs: function () { return false; },     // sync grading: no async line jobs to protect
    onResult: function () {},
    start: function () {
      this.list = srsDue(SRS, S2.games);
      if (!this.list.length) {
        $("coachfb").innerHTML = '<span class="dimtext">No mistakes due for review — play more games ' +
          '(' + SRS.filter(function (i) { return !i.retired; }).length + ' scheduled).</span>';
        return;
      }
      this.active = true; this.idx = 0; this.solved = 0;
      this.serve();
    },
    serve: function () {
      this.item = this.list[this.idx]; this.tries = 0;
      clearHint(); clearPv(); clearGuess(true);
      CB.loadPosition(this.item.moves, { noEngine: true }); // emits "load" -> renderPrompt
    },
    renderPrompt: function () {
      if (!this.item) return;
      $("coachfb").innerHTML =
        '<span class="sevbadge sev-mistake">PUZZLE ' + (this.idx + 1) + "/" + this.list.length + '</span>' +
        'You played <b>' + moveName(this.item.played) + '</b> here (lost ~' +
        (this.item.loss > 1000 ? "10+" : (this.item.loss / 100).toFixed(1)) + '). Find a better move — attempt ' +
        (this.tries + 1) + ' of 2.<div id="pzbar"></div>';
      this.bar(false);
      $("coachreview").innerHTML = "";
    },
    bar: function (finished) {
      var pb = $("pzbar"), self = this;
      if (!pb) return;
      function btn(label, fn) {
        var b = document.createElement("button");
        b.textContent = label;
        b.addEventListener("click", fn);
        pb.appendChild(b);
      }
      if (finished && this.idx + 1 < this.list.length) btn("Next puzzle", function () { self.idx++; self.serve(); });
      if (finished) btn("End training", function () { self.end(); });
      else btn("Skip / end training", function () { self.end(); });
    },
    onMove: function (m) {
      if (!this.item) return;
      this.tries++;
      var gr = null, okMove = m === this.item.best;
      if (!okMove) {
        gr = gradeAttemptSync(this.item.moves, m, 350);
        if (gr && typeof gr.loss === "number" && gr.loss < 80) okMove = true; // any near-best move counts
      }
      if (okMove) this.finish(true, m);
      else if (this.tries < 2) {
        var self = this;
        setTimeout(function () {                       // let the board show the attempt briefly
          if (!self.active) return;
          CB.restore(self.item.moves.length);          // rewind the attempt; prompt re-renders
        }, 650);
        $("coachfb").innerHTML = '<span class="sevbadge sev-inaccuracy">Not it</span>' +
          moveName(m) + ' still loses ground — the position rewinds for attempt 2 of 2.';
      } else this.finish(false, m);
    },
    finish: function (success, lastMove) {
      var item = this.item, self = this;
      srsUpdate(item, success, S2.games);              // SM-2-lite reschedule (1 -> 3 -> 7 games)
      saveSrs(); refreshTrainBadge();
      if (success) this.solved++;
      var html;
      if (success) {
        html = '<span class="sevbadge sev-best">Solved' + (this.tries === 1 ? " !" : "") + '</span>' +
               '<b>' + moveName(lastMove) + '</b> — ' +
               (item.retired ? "mastered: this one is retired." :
                "comes back in " + item.interval + " game" + (item.interval === 1 ? "" : "s") + ".");
      } else {
        var why = "";
        try { why = whyLine(factsFor(item.moves, lastMove), factsFor(item.moves, item.best)); } catch (e) {}
        html = '<span class="sevbadge sev-blunder">Solution</span>The idea was <b>' +
               moveName(item.best) + '</b> (highlighted).' +
               (why ? '<div class="why">' + why + '</div>' : "") +
               '<div class="dimtext">It returns next game.</div>';
        showHint(item.best);
        pvCompute(item.moves.concat([item.best]), 2, function (pv) { // elaborate the solution line
          if (self.active) animatePv(item.moves, [item.best].concat(pv));
        });
      }
      html += '<div id="pzbar"></div>';
      $("coachfb").innerHTML = html;
      this.bar(true);
    },
    end: function () {
      var done = this.solved, total = this.list.length;
      this.active = false; this.item = null; this.list = [];
      if (CB.newGame) CB.newGame();
      $("coachfb").innerHTML = '<span class="dimtext">Training over — ' + done + "/" + total +
        ' solved. Fresh game started.</span>';
    }
  };

  /* ======== COACH V3 — skill accelerator UI (COACH_V3_DOM) ========
     Mechanisms 1-6 of Coach v3; pure logic lives above (COACH_V3_LOGIC).
     All of it is gated on Coach ON and degrades politely without drills.js. */

  var LS3 = "quoridor_coach3_v1";
  var S3 = { taxo: {}, log: [], graded: 0,
             rating: 1500, rgames: 0, rhist: [],
             snapMargin: 400, snapHist: [], snapStreak: 0, snapBest: 0,
             curLevel: 0, curHist: [[], [], [], [], []],
             drillsDone: 0, drillsByCat: {}, sessions: 0 };
  try {
    var s3raw = JSON.parse(localStorage.getItem(LS3) || "null");
    if (s3raw && typeof s3raw === "object" && !Array.isArray(s3raw)) {
      if (s3raw.taxo && typeof s3raw.taxo === "object") S3.taxo = s3raw.taxo;
      if (Array.isArray(s3raw.log)) S3.log = s3raw.log.slice(-200);
      if (typeof s3raw.graded === "number" && s3raw.graded >= 0) S3.graded = s3raw.graded;
      if (typeof s3raw.rating === "number" && s3raw.rating > 0) S3.rating = s3raw.rating;
      if (typeof s3raw.rgames === "number" && s3raw.rgames >= 0) S3.rgames = s3raw.rgames;
      if (Array.isArray(s3raw.rhist)) S3.rhist = s3raw.rhist.slice(-30);
      if (typeof s3raw.snapMargin === "number") S3.snapMargin = snapAdjust(s3raw.snapMargin, null);
      if (Array.isArray(s3raw.snapHist)) S3.snapHist = s3raw.snapHist.slice(-10);
      if (typeof s3raw.snapStreak === "number" && s3raw.snapStreak >= 0) S3.snapStreak = s3raw.snapStreak;
      if (typeof s3raw.snapBest === "number" && s3raw.snapBest >= 0) S3.snapBest = s3raw.snapBest;
      if (typeof s3raw.curLevel === "number" && s3raw.curLevel >= 0 && s3raw.curLevel < CUR_LEVELS.length)
        S3.curLevel = s3raw.curLevel | 0;
      if (Array.isArray(s3raw.curHist) && s3raw.curHist.length === 5) S3.curHist = s3raw.curHist;
      if (typeof s3raw.drillsDone === "number" && s3raw.drillsDone >= 0) S3.drillsDone = s3raw.drillsDone;
      if (s3raw.drillsByCat && typeof s3raw.drillsByCat === "object") S3.drillsByCat = s3raw.drillsByCat;
      if (typeof s3raw.sessions === "number" && s3raw.sessions >= 0) S3.sessions = s3raw.sessions;
    }
  } catch (e) {}
  function saveS3() { try { localStorage.setItem(LS3, JSON.stringify(S3)); } catch (e) {} }

  // (2) the drill pack mined offline by gen_drills.js (drills.js sibling file)
  var DIDX = drillIndex(typeof window !== "undefined" ? window.QuoridorDrills : null);

  var st3 = document.createElement("style");
  st3.id = "coachstyle3";
  st3.textContent = [
    "#v3sec { display: none; margin-top: 10px; padding-top: 8px; border-top: 1px solid #3a414c; }",
    "body.coach-on #v3sec { display: block; }",
    "#v3head { display: flex; justify-content: space-between; align-items: center; color: var(--dim); font-size: 11px; letter-spacing: 1px; }",
    "#v3rating { color: var(--txt); font-size: 12px; display: inline-flex; gap: 6px; align-items: center; letter-spacing: 0; }",
    "#radar { margin: 6px 0 2px; }",
    ".radrow { display: flex; align-items: center; gap: 6px; font-size: 11px; margin: 2px 0; }",
    ".radlab { width: 148px; color: var(--dim); text-align: right; white-space: nowrap; }",
    ".radbar { flex: 1; height: 7px; background: #2b3038; border-radius: 4px; overflow: hidden; }",
    ".radfill { display: block; height: 100%; background: linear-gradient(90deg, #e8b04a, #d96a6a); border-radius: 4px; }",
    ".radn { width: 46px; font-size: 10px; color: var(--txt); }",
    ".radtrend { color: var(--dim); font-weight: 400; }",
    "#v3btns { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0 4px; }",
    "#v3btns button { font-size: 12px; padding: 4px 10px; }",
    "#v3stats { font-size: 11px; color: var(--dim); margin-top: 4px; }",
    "#v3note { font-size: 11px; color: var(--dim); margin-top: 4px; }",
    "#v3note b { color: var(--wall); }",
    "#snapcover { position: absolute; inset: 0; z-index: 8; border-radius: 10px; background: rgba(26,29,35,0.97); display: none; align-items: center; justify-content: center; color: var(--dim); font-size: 14px; letter-spacing: 1px; }"
  ].join("\n");
  document.head.appendChild(st3);

  var v3sec = document.createElement("div");
  v3sec.id = "v3sec";
  v3sec.innerHTML =
    '<div id="v3head"><span>SKILL ACCELERATOR</span><span id="v3rating"></span></div>' +
    '<div id="radar"></div>' +
    '<div id="v3btns">' +
    '<button id="drillbtn" title="Deliberate practice: 5 drills aimed at your weakest error category">Drill my weakness</button>' +
    '<button id="curbtn" title="Backward curriculum: endgames first, openings last; 80% over the last 10 advances">Curriculum</button>' +
    '<button id="snapbtn" title="Pattern training: the position flashes for 5 s, then call the winner (or find the cut in 10 s)">Snap judgment</button>' +
    '<button id="dailybtn" title="Interleaved ~15 min: due puzzles + weakness drills + snap judgments + one adaptive game with guess-first">Daily 15-min</button>' +
    '</div>' +
    '<div id="v3stats"></div><div id="v3note"></div>';
  panel.appendChild(v3sec);

  var snapcover = document.createElement("div");
  snapcover.id = "snapcover";
  snapcover.innerHTML = "<div>position hidden — trust your read</div>";
  board.appendChild(snapcover);

  /* ---- (1) weakness radar ---- */
  function catTrend(key) {
    // this category's share of the last 20 graded errors vs the 20 before
    var ci = catIndex(key), recent = 0, prior = 0, n = S3.log.length, i;
    if (n < 25) return "";
    for (i = 0; i < n; i++) {
      if (!S3.log[i] || S3.log[i].c !== ci) continue;
      if (i >= n - 20) recent++; else if (i >= n - 40) prior++;
    }
    if (recent >= prior + 2) return "&#9650;";  // worsening
    if (prior >= recent + 2) return "&#9660;";  // improving
    return "";
  }
  function renderRadar() {
    var el = $("radar"), max = 1, any = false, rows = "", i, n, t;
    for (i = 0; i < TAXONOMY.length; i++) { n = S3.taxo[TAXONOMY[i].key] || 0; if (n > max) max = n; if (n) any = true; }
    for (i = 0; i < TAXONOMY.length; i++) {
      t = TAXONOMY[i]; n = S3.taxo[t.key] || 0;
      rows += '<div class="radrow" title="' + t.tip + '"><span class="radlab">' + t.label + '</span>' +
              '<span class="radbar"><span class="radfill" style="width:' + (n ? Math.max(4, Math.round(n / max * 100)) : 0) + '%"></span></span>' +
              '<span class="radn">' + n + ' <b class="radtrend">' + catTrend(t.key) + '</b></span></div>';
    }
    el.innerHTML = '<div class="radrow" style="font-size:10px;color:var(--dim);letter-spacing:1px">WEAKNESS RADAR &nbsp;<span>' +
      (any ? S3.graded + " graded moves" : "no graded mistakes yet — play coach games") + '</span></div>' + rows;
  }
  function weakestCat() { // highest error count; ties resolve to taxonomy order
    var best = null, bestN = 0, i, n;
    for (i = 0; i < TAXONOMY.length; i++) {
      n = S3.taxo[TAXONOMY[i].key] || 0;
      if (n > bestN) { bestN = n; best = TAXONOMY[i].key; }
    }
    return best;
  }
  // every graded human move feeds the radar; mistakes (>=80cp) are classified
  function v3Graded(entry) {
    S3.graded++;
    if (entry.loss >= 80 && entry.best && entry.best !== entry.move) {
      try {
        var md = buildModel(entry.moves), me = md.turn;
        var cat = classifyError(factsFor(entry.moves, entry.move), factsFor(entry.moves, entry.best),
                                md.wl[me], md.wl[1 - me]);
        S3.taxo[cat] = (S3.taxo[cat] || 0) + 1;
        S3.log.push({ c: catIndex(cat), g: S3.rgames });
        if (S3.log.length > 200) S3.log.splice(0, S3.log.length - 200);
      } catch (e) {}
    }
    saveS3(); renderRadar();
  }

  /* ---- (5) rating estimate + sparkline (see honesty note in the logic block) ---- */
  var tookOver = false; // takeover games are excluded: the human played only part
  function effectiveEngineMs() {
    if (coachOn && S2.adaptive) return S2.ms;
    var sel = $("difficulty").value.split(",");
    return +sel[0] || 400;
  }
  function sparkSvg(vals) {
    if (!vals || vals.length < 2) return "";
    var w = 90, h = 20, min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
    var span = Math.max(1, max - min), pts = [], i;
    for (i = 0; i < vals.length; i++)
      pts.push((i / (vals.length - 1) * w).toFixed(1) + "," + (h - 2 - (vals[i] - min) / span * (h - 4)).toFixed(1));
    return '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + " " + h + '">' +
           '<polyline fill="none" stroke="#7ec97e" stroke-width="1.5" points="' + pts.join(" ") + '"/></svg>';
  }
  function renderRating() {
    $("v3rating").innerHTML = S3.rgames
      ? 'rating ~<b>&nbsp;' + S3.rating + '</b>&nbsp;' + sparkSvg(S3.rhist)
      : '<span class="dimtext">rating: play graded games</span>';
    $("v3rating").title = "LOCAL ladder estimate only. Engine level = 1800 + 60*log2(ms/4000): the anchor is arbitrary " +
      "and the slope is eyeballed from this project's gauntlet history. Comparable to itself over time, not to FIDE/online ratings.";
  }
  function renderStats() {
    $("v3stats").innerHTML = "drills done: <b>" + S3.drillsDone + "</b> · snap streak: <b>" + S3.snapStreak +
      "</b> (best " + S3.snapBest + ") · curriculum: <b>" + CUR_LEVELS[S3.curLevel].name + "</b>" +
      (S3.sessions ? " · daily sessions: <b>" + S3.sessions + "</b>" : "");
  }
  function v3GameEnd() { // called from onGameEnd: real, finished human coach games only
    if (!coachOn || tookOver) return;
    var mv = CB.moves();
    if (!mv.length) return;
    var won = ((mv.length - 1) % 2) === CB.human() ? 1 : 0;
    S3.rating = ratingUpdate(S3.rating, engineEloOfMs(effectiveEngineMs()), won, S3.rgames);
    S3.rgames++;
    S3.rhist.push(S3.rating);
    if (S3.rhist.length > 30) S3.rhist.splice(0, S3.rhist.length - 30);
    saveS3(); renderRating(); renderStats();
  }

  /* ---- unified trainer (drills, curriculum items, snap judgments, session SRS).
     Reuses the puzzle plumbing pattern: CB.loadPosition with noEngine, the
     'load' event renders the prompt, the 'move' event grades. mode 'done'
     marks the verdict screen between items (board stays inert). ---- */
  var Trainer = {
    active: false, mode: null, drill: null, item: null, base: null, tries: 0,
    timer: 0, onDone: null, label: "",
    start: function (mode, payload, label, onDone) {
      this.active = true; this.mode = mode; this.label = label || ""; this.onDone = onDone || null;
      this.tries = 0;
      clearHint(); clearPv(); clearGuess(true);
      if (mode === "srs") {
        this.item = payload; this.drill = null;
        this.base = payload.moves.slice();
        CB.loadPosition(this.base, { noEngine: true });
      } else {
        this.drill = payload; this.item = null;
        this.base = synthMoves(payload.pos);
        if (!this.base) {
          this.active = false;
          $("coachfb").innerHTML = '<span class="dimtext">bad drill record — skipped.</span>';
          if (onDone) onDone(false);
          return;
        }
        // snap "who wins": the HUMAN is the side NOT to move -> the board is input-inert
        var human = mode === "snapwho" ? 1 - payload.pos.t : payload.pos.t;
        CB.loadPosition(this.base, { noEngine: true, human: human });
      }
    },
    clearTimer: function () {
      if (this.timer) { clearTimeout(this.timer); this.timer = 0; }
      snapcover.style.display = "none";
    },
    stopBtn: function () {
      var pb = $("pzbar");
      if (!pb) return;
      var b = document.createElement("button");
      b.textContent = "Stop training";
      b.addEventListener("click", function () { trainerWrapUp(); });
      pb.appendChild(b);
    },
    renderPrompt: function () {
      if (!this.active || this.mode === "done") return;
      var self = this, head = '<span class="sevbadge sev-inaccuracy">' + this.label + '</span>';
      if (this.mode === "snapwho") {
        $("coachfb").innerHTML = head + "Who is winning? <span class=\"dimtext\">(side to move: " +
          (this.drill.pos.t === 0 ? "blue" : "red") + " — the board hides in 5 s, read it NOW)</span><div id=\"pzbar\"></div>";
        var pb = $("pzbar");
        function abtn(label2, side) {
          var b = document.createElement("button");
          b.textContent = label2;
          b.addEventListener("click", function () { Trainer.answerWho(side); });
          pb.appendChild(b);
        }
        abtn("Blue is winning", 0);
        abtn("Red is winning", 1);
        this.stopBtn();
        this.timer = setTimeout(function () {
          if (self.active && self.mode === "snapwho") snapcover.style.display = "flex";
        }, 5000);
      } else if (this.mode === "snapcut") {
        $("coachfb").innerHTML = head + "Find the cut: place the ONE wall that hurts the opponent most (worth ~+" +
          (this.drill.aux || 2) + " steps). One try, 10 seconds.<div id=\"pzbar\"></div>";
        this.stopBtn();
        this.timer = setTimeout(function () {
          if (self.active && self.mode === "snapcut") self.finish(false, "time is up — ");
        }, 10000);
      } else { // drill / srs: find the strong move, 2 attempts
        var tip = "";
        if (this.drill) {
          var meta = TAXONOMY[catIndex(this.drill.cat)];
          tip = this.drill.tier === 0
            ? "Pure race — the walls are gone, only the arithmetic counts."
            : (meta ? meta.tip : "");
        } else if (this.item) {
          tip = "You played " + moveName(this.item.played) + " here and lost ~" +
                (this.item.loss > 1000 ? "10+" : (this.item.loss / 100).toFixed(1)) + ".";
        }
        $("coachfb").innerHTML = head + "Find the strongest move — attempt " + (this.tries + 1) + " of 2." +
          (tip ? ' <span class="dimtext">' + tip + "</span>" : "") + '<div id="pzbar"></div>';
        this.stopBtn();
      }
      $("coachreview").innerHTML = "";
    },
    onMove: function (m) {
      if (!this.active || this.mode === "done" || this.mode === "snapwho") return;
      if (this.mode === "snapcut") {
        this.clearTimer();
        var ok2 = false, info = "";
        if (m >= 100) {
          try {
            var fc = factsFor(this.base, m);
            ok2 = m === this.drill.best || fc.oppHurt >= Math.max(2, (this.drill.aux || 2) - 1);
            info = "your wall adds +" + Math.max(0, fc.oppHurt) + " to the opponent. ";
          } catch (e) {}
        } else info = "that was a pawn move — the task was a wall. ";
        this.finish(ok2, info);
        return;
      }
      // drill / srs: 2 tries; exact best, or any near-best (<80cp) move counts
      this.tries++;
      var success = false, best = this.mode === "srs" ? this.item.best : this.drill.best;
      if (m === best) success = true;
      else if (this.mode !== "srs" && this.drill.tier === 0) {
        // L1 ground truth: any FASTEST step is exactly correct (race arithmetic)
        try { success = factsFor(this.base, m).myGain >= raceBestGain(this.base); } catch (e) {}
      } else {
        var gr = gradeAttemptSync(this.base, m, 350);
        success = !!(gr && typeof gr.loss === "number" && gr.loss < 80);
      }
      if (success) this.finish(true, "");
      else if (this.tries < 2) {
        var self = this;
        $("coachfb").innerHTML = '<span class="sevbadge sev-inaccuracy">Not it</span>' + moveName(m) +
          " loses ground — attempt 2 of 2 in a moment.";
        setTimeout(function () { if (self.active && self.mode !== "done") CB.restore(self.base.length); }, 650);
      } else this.finish(false, "");
    },
    answerWho: function (side) {
      if (!this.active || this.mode !== "snapwho") return;
      this.clearTimer();
      var d = this.drill, win = snapVerdictWho(d.sc, d.pos.t, side);
      var winner = d.sc > 0 ? d.pos.t : 1 - d.pos.t;
      this.finish(win, (winner === 0 ? "blue" : "red") + " is winning — engine: " +
        (d.sc > 0 ? "+" : "") + (d.sc / 100).toFixed(1) + " for the side to move. ");
    },
    finish: function (success, info) {
      this.clearTimer();
      var mode = this.mode;
      this.mode = "done";
      if (mode === "srs") { // session SRS items reschedule exactly like Train puzzles
        srsUpdate(this.item, success, S2.games);
        saveSrs(); refreshTrainBadge();
      } else if (this.drill) {
        S3.drillsDone++;
        S3.drillsByCat[this.drill.cat] = (S3.drillsByCat[this.drill.cat] || 0) + 1;
        if (mode === "snapwho" || mode === "snapcut") {
          S3.snapHist.push(success ? 1 : 0);
          if (S3.snapHist.length > 10) S3.snapHist.shift();
          S3.snapStreak = success ? S3.snapStreak + 1 : 0;
          if (S3.snapStreak > S3.snapBest) S3.snapBest = S3.snapStreak;
          S3.snapMargin = snapAdjust(S3.snapMargin, S3.snapHist); // difficulty tracks accuracy
        }
      }
      saveS3(); renderStats();
      var html = success ? '<span class="sevbadge sev-best">Correct</span>'
                         : '<span class="sevbadge sev-blunder">Not this time</span>';
      if (info) html += info;
      if (mode === "snapwho" && !success) html += "(streak resets — margins widen a little.)";
      if (!success && mode !== "snapwho") {
        var best2 = mode === "srs" ? this.item.best : this.drill.best;
        html += "The idea: <b>" + moveName(best2) + "</b> (highlighted).";
        try { html += '<div class="why">' + narrate(factsFor(this.base, best2)) + "</div>"; } catch (e) {}
        showHint(best2);
      }
      html += '<div id="pzbar"></div>';
      $("coachfb").innerHTML = html;
      var pb = $("pzbar"), done = this.onDone;
      this.onDone = null;
      if (done) {
        var nb = document.createElement("button");
        nb.textContent = "Next";
        nb.addEventListener("click", function () { done(success); });
        pb.appendChild(nb);
      }
      var sb = document.createElement("button");
      sb.textContent = done ? "Stop" : "Done";
      sb.addEventListener("click", function () { trainerWrapUp(); });
      pb.appendChild(sb);
    },
    abort: function () { this.clearTimer(); this.active = false; this.mode = null; this.onDone = null; }
  };
  function trainerWrapUp(html) {
    Trainer.abort();
    var wasSession = Session.active;
    Session.abort();
    if (CB.newGame) CB.newGame();
    $("coachfb").innerHTML = html ||
      '<span class="dimtext">Training ' + (wasSession ? "session " : "") + 'over — fresh game started.</span>';
  }

  function sampleN(pool, n) {
    var idx = [], out = [], i, j, t2;
    for (i = 0; i < pool.length; i++) idx.push(i);
    for (i = idx.length - 1; i > 0; i--) { j = (Math.random() * (i + 1)) | 0; t2 = idx[i]; idx[i] = idx[j]; idx[j] = t2; }
    for (i = 0; i < Math.min(n, idx.length); i++) out.push(pool[idx[i]]);
    return out;
  }
  function requireIdle(needPack) {
    if (!coachOn) return false;
    if (Puzzle.active || Trainer.active || Session.active || cbAiMode() || pendingGuess) {
      $("v3note").innerHTML = "finish the current activity first.";
      return false;
    }
    if (needPack && !DIDX.ok) {
      $("v3note").innerHTML = "Drill pack missing: <b>drills.js</b> must sit next to quoridor.html " +
        "(generate it with gen_drills.js). Drills, curriculum and snap mode are disabled without it.";
      return false;
    }
    return true;
  }

  /* ---- (2) targeted drills — principle: DELIBERATE PRACTICE (effortful reps
     aimed at the diagnosed weakness, immediate feedback, edge of ability) ---- */
  function startWeakness() {
    if (!requireIdle(true)) return;
    var cat = weakestCat(), note = "";
    if (!cat) { cat = "RACE_TEMPO"; note = "No diagnosed weakness yet (play graded games first) — serving tempo drills. "; }
    var pool = DIDX.byCat[cat];
    if (!pool.length) { $("v3note").innerHTML = "no drills for " + cat + " in the pack."; return; }
    var meta = TAXONOMY[catIndex(cat)], items = sampleN(pool, 5), i = 0, okN = 0;
    $("v3note").innerHTML = note + "Drilling <b>" + meta.label + "</b> — " + meta.tip;
    function next(prevOk) {
      if (prevOk === true) okN++;
      if (i >= items.length) {
        trainerWrapUp('<span class="sevbadge sev-ok">Drill set done</span>' + okN + "/" + items.length +
          " on " + meta.label + '. <span class="dimtext">' + meta.tip + "</span>");
        return;
      }
      i++;
      Trainer.start("drill", items[i - 1], "DRILL " + i + "/" + items.length + " — " + meta.label, next);
    }
    next(null);
  }

  /* ---- (3) curriculum runner (levels live in CUR_LEVELS; backward order) ---- */
  function updateCurBtn() { $("curbtn").textContent = "Curriculum " + CUR_LEVELS[S3.curLevel].name.split(" ")[0]; }
  function startCurriculum() {
    if (!requireIdle(true)) return;
    function serveOne() {
      var lvl = S3.curLevel, L2 = CUR_LEVELS[lvl], pool = DIDX.byTier[L2.tier];
      if (!pool.length) {
        trainerWrapUp('<span class="dimtext">No drills at ' + L2.name + " in the pack — regenerate with gen_drills.js.</span>");
        return;
      }
      var h = S3.curHist[lvl], s = 0, k;
      for (k = 0; k < h.length; k++) s += h[k] ? 1 : 0;
      Trainer.start("drill", sampleN(pool, 1)[0],
        L2.name + " (" + s + "/" + h.length + " of last 10 — 80% advances)",
        function (ok3) {
          var hh = S3.curHist[lvl];
          hh.push(ok3 ? 1 : 0);
          if (hh.length > 10) hh.shift();
          if (lvl < CUR_LEVELS.length - 1 && curriculumAdvance(hh)) {
            S3.curLevel = lvl + 1;
            $("v3note").innerHTML = "<b>LEVEL UP</b> — welcome to " + CUR_LEVELS[S3.curLevel].name + ".";
          }
          saveS3(); renderStats(); updateCurBtn();
          serveOne();
        });
    }
    serveOne();
  }

  /* ---- (4) snap set runner ---- */
  function startSnap() {
    if (!requireIdle(true)) return;
    var i = 0, okN = 0, N = 10;
    var cutPool = DIDX.byCat.MISSED_CUT.concat(DIDX.byCat.WRONG_SIDE_WALL);
    function next(prevOk) {
      if (prevOk === true) okN++;
      if (i >= N) {
        trainerWrapUp('<span class="sevbadge sev-ok">Snap set done</span>' + okN + "/" + N +
          ' — streak ' + S3.snapStreak + ", margin now ±" + (S3.snapMargin / 100).toFixed(1) + " (shrinks as you improve).");
        return;
      }
      i++;
      var useCut = cutPool.length && i % 3 === 0; // interleave the two perception tasks
      var d = useCut ? sampleN(cutPool, 1)[0] : snapPick(DIDX.all, S3.snapMargin, Math.random);
      if (!d) { trainerWrapUp('<span class="dimtext">no snap material in the pack.</span>'); return; }
      Trainer.start(useCut ? "snapcut" : "snapwho", d,
        "SNAP " + i + "/" + N + (useCut ? " — find the cut" : " — who is winning?"), next);
    }
    next(null);
  }

  /* ---- (6) daily 15-minute session — interleaved, then one adaptive game ---- */
  var Session = {
    active: false, queue: [], idx: 0, ok: {}, n: {}, t0: 0,
    prevGuess: null, prevAdapt: null, phase: null, spawning: false,
    abort: function () {
      if (!this.active && this.prevGuess === null) return;
      this.active = false; this.phase = null; this.queue = [];
      if (this.prevGuess !== null) { S2.guess = this.prevGuess; $("guesschk").checked = S2.guess; }
      if (this.prevAdapt !== null) { S2.adaptive = this.prevAdapt; $("adaptchk").checked = S2.adaptive; }
      this.prevGuess = this.prevAdapt = null;
      saveS2(); refreshAdapt();
    }
  };
  function startDaily() {
    if (!requireIdle(false)) return; // works without the pack in degraded form
    var srsItems = srsDue(SRS, S2.games).slice(0, 5).map(function (it) { return { kind: "srs", item: it }; });
    var drills = [], snaps = [];
    if (DIDX.ok) {
      var cat = weakestCat() || "RACE_TEMPO";
      var dp = DIDX.byCat[cat].length ? DIDX.byCat[cat] : DIDX.all;
      drills = sampleN(dp, 5).map(function (d) { return { kind: "drill", item: d }; });
      var cutPool = DIDX.byCat.MISSED_CUT.concat(DIDX.byCat.WRONG_SIDE_WALL), k, sd;
      for (k = 0; k < 10; k++) {
        if (k % 3 === 2 && cutPool.length) snaps.push({ kind: "snapcut", item: sampleN(cutPool, 1)[0] });
        else { sd = snapPick(DIDX.all, S3.snapMargin, Math.random); if (sd) snaps.push({ kind: "snapwho", item: sd }); }
      }
    }
    // INTERLEAVING: mixed item types beat massed blocks for retention
    Session.queue = interleave([snaps, drills, srsItems]);
    Session.queue.push({ kind: "game" });
    Session.active = true; Session.idx = 0; Session.t0 = Date.now();
    Session.ok = { srs: 0, drill: 0, snapwho: 0, snapcut: 0 };
    Session.n = { srs: 0, drill: 0, snapwho: 0, snapcut: 0 };
    Session.phase = "items";
    $("v3note").innerHTML = "Daily session: " + (Session.queue.length - 1) +
      " interleaved training items, then one adaptive game with guess-first ON." +
      (DIDX.ok ? "" : " <b>(drill pack missing — puzzles + game only)</b>");
    sessionNext();
  }
  function sessionNext() {
    if (!Session.active) return;
    var q = Session.queue[Session.idx++];
    if (!q) { Session.abort(); return; }
    if (q.kind === "game") {
      Session.phase = "game";
      Session.prevGuess = S2.guess; Session.prevAdapt = S2.adaptive;
      S2.guess = true; S2.adaptive = true; saveS2();      // restored by Session.abort()
      $("guesschk").checked = true; $("adaptchk").checked = true; refreshAdapt();
      Trainer.abort();
      Session.spawning = true;
      CB.newGame();
      Session.spawning = false;
      $("coachfb").innerHTML = '<span class="sevbadge sev-ok">FINAL GAME</span>guess-first and adaptive strength ' +
        "are ON for this one; the post-game review runs automatically.";
      return;
    }
    Session.n[q.kind]++;
    var names = { srs: "review your past mistake", drill: "weakness drill", snapwho: "who is winning?", snapcut: "find the cut" };
    Trainer.start(q.kind === "srs" ? "srs" : (q.kind === "drill" ? "drill" : q.kind), q.item,
      "DAILY " + Session.idx + "/" + Session.queue.length + " — " + names[q.kind],
      function (ok4) { if (ok4) Session.ok[q.kind]++; sessionNext(); });
  }
  function sessionGameDone() { // runs from onGameEnd when the final game finishes
    if (!Session.active || Session.phase !== "game") return;
    var mins = Math.max(1, Math.round((Date.now() - Session.t0) / 60000));
    var names = { srs: "puzzles", drill: "drills", snapwho: "snap calls", snapcut: "cuts" };
    var parts = [], k;
    for (k in Session.n) if (Session.n[k]) parts.push(Session.ok[k] + "/" + Session.n[k] + " " + names[k]);
    var mv = CB.moves();
    var won = mv.length && ((mv.length - 1) % 2) === CB.human();
    S3.sessions++; saveS3(); renderStats();
    Session.abort(); // restores the guess/adaptive switches
    $("v3note").innerHTML = '<span class="sevbadge sev-best">DAILY DONE</span>' +
      (parts.length ? parts.join(" · ") + " · " : "") + "game " + (won ? "won" : "lost") +
      " · ~" + mins + " min. Review above; same time tomorrow.";
  }

  $("drillbtn").addEventListener("click", startWeakness);
  $("curbtn").addEventListener("click", startCurriculum);
  $("snapbtn").addEventListener("click", startSnap);
  $("dailybtn").addEventListener("click", startDaily);
  renderRadar(); renderRating(); renderStats(); updateCurBtn();
  if (!DIDX.ok)
    $("v3note").innerHTML = '<span class="dimtext">drills.js not found next to quoridor.html — weakness drills, ' +
      "curriculum and snap mode are disabled (the two files must travel together; regenerate with gen_drills.js).</span>";

  /* ======== AI-vs-AI narration (teacher voice for the exhibition) ======== */
  function aiInstantNarrate(ply, m) {
    var line;
    try { line = narrate(factsFor(CB.moves().slice(0, ply), m)); }
    catch (e) { line = moveName(m) + "."; }
    $("coachfb").innerHTML = '<span class="dimtext">' + (ply % 2 === 0 ? "P0 (bottom): " : "P1 (top): ") +
      '</span>' + line + ' <span class="dimtext">(grading…)</span>';
  }

  /* ======== Coach v2 controls wiring ======== */
  $("guesschk").checked = S2.guess;
  $("guesschk").addEventListener("change", function () {
    S2.guess = this.checked; saveS2();
    if (!S2.guess) { clearGuess(true); }
  });
  $("adaptchk").checked = S2.adaptive;
  $("adaptchk").addEventListener("change", function () {
    S2.adaptive = this.checked; saveS2(); refreshAdapt();
  });
  $("trainbtn").addEventListener("click", function () {
    if (!coachOn) return;
    if (Puzzle.active) { Puzzle.end(); return; }
    Puzzle.start();
  });
  // (c) the adaptive handicap is applied ONLY through this hook; AI-vs-AI and
  // puzzles always use the honest selector strength (and puzzles use no engine)
  CB.msHook = function () {
    return (coachOn && S2.adaptive && !cbAiMode() && !Puzzle.active && !Trainer.active) ? S2.ms : 0;
  };

  /* ======== lifecycle ======== */
  function refreshStatus() {
    var busy = analysisOn() && (running !== null || queue.length > 0);
    $("coachstatus").textContent = busy ? "analyzing…" : "";
    bar.classList.toggle("analyzing", busy);
  }
  function invalidate(keepLen) {
    token++;
    queue = []; running = null; pendingJudge = null; fbToken++;
    for (var k in results) { if (isNaN(+k) || +k > keepLen) delete results[k]; } // line keys always go
    record = record.filter(function (e) { return e.ply < keepLen; });
    if (cworker) { try { cworker.postMessage({ type: "cancel", token: token }); } catch (e) {} }
    clearHint();
    $("coachreview").innerHTML = "";
  }
  function resync() {
    if (!analysisOn()) return;
    var cur = CB.moves().length;
    if (CB.over()) { updateBarTerminal(); renderReview(); }
    else if (!Puzzle.active && !Trainer.active) {
      if (results[cur]) updateBar(results[cur]); else setBarP(0.5, true);
      ensureJob(cur);
    }
    tryJudge();
    refreshStatus();
  }

  CB.on(function (type, arg) {
    // epoch changes must invalidate cached analyses even while the coach is toggled off
    if (type === "new") { invalidate(0); gameCounted = false; clearGuess(true); clearPv(); }
    else if (type === "undo") { invalidate(CB.moves().length); clearGuess(true); clearPv(); }
    else if (type === "restore") { invalidate(arg); clearGuess(true); clearPv(); }
    else if (type === "load") { invalidate(0); gameCounted = false; clearGuess(true); clearPv(); }
    else if (type === "flip") { // pure view change: reproject overlays, nothing else
      clearHint(); clearPv();
      if (pendingGuess) drawGuessGhost();
      return;
    }
    if (type === "new" && Puzzle.active) { Puzzle.active = false; Puzzle.item = null; } // user bailed out
    if (type === "new") { // v3: a fresh game ends any training flow (unless the session spawned it)
      tookOver = false;
      if (Trainer.active) Trainer.abort();
      if (Session.active && !Session.spawning) Session.abort();
    }
    if (type === "load") tookOver = false;
    if (!analysisOn()) return;
    if (type === "move") {
      clearHint(); clearPv();
      if (Trainer.active) { Trainer.onMove(arg); refreshStatus(); return; } // v3 training flows
      if (Puzzle.active) { Puzzle.onMove(arg); refreshStatus(); return; }
      var len = CB.moves().length, ply = len - 1;
      if (cbAiMode()) {
        // exhibition: narrate EVERY move instantly from facts; the graded verdict follows
        aiInstantNarrate(ply, arg);
        pendingJudge = { ply: ply, move: arg };
        ensureJob(ply);
        ensureJob(len);
      } else if (ply % 2 === CB.human()) {
        if (guessSkip && guessSkip.ply === ply && guessSkip.move === arg) {
          guessSkip = null; // already graded at the guess reveal; don't double-judge
          ensureJob(len);   // still need the new position for the eval bar / next baseline
        } else {
          pendingJudge = { ply: ply, move: arg };
          $("coachfb").innerHTML = '<span class="dimtext">analyzing your move…</span>';
          ensureJob(ply);   // baseline (normally already done or running)
          ensureJob(len);   // position after your move
        }
      } else {
        ensureJob(len);     // engine moved: eval bar + baseline for your next move
      }
      if (CB.over()) { updateBarTerminal(); renderReview(); onGameEnd(); }
      refreshStatus();
    } else if (type === "new") {
      $("coachfb").innerHTML = defaultFbHtml;
      setBarP(0.5, true);
      resync();
    } else if (type === "undo") {
      $("coachfb").innerHTML = defaultFbHtml;
      resync();
    } else if (type === "restore") {
      if (Trainer.active) { Trainer.renderPrompt(); refreshStatus(); return; } // v3 attempt-2 rewind
      if (Puzzle.active) { Puzzle.renderPrompt(); refreshStatus(); return; }
      $("coachfb").innerHTML = '<span class="dimtext">position restored — find a better move.</span>';
      resync();
    } else if (type === "load") {
      if (Trainer.active) { Trainer.renderPrompt(); refreshStatus(); return; } // v3 drill served
      if (Puzzle.active) { Puzzle.renderPrompt(); refreshStatus(); return; }
      resync();
    } else if (type === "takeover") {
      tookOver = true; // v3: takeover games are excluded from the rating estimate
      $("coachfb").innerHTML = '<span class="dimtext">You took over as ' +
        (arg === 0 ? "P0 (bottom)" : "P1 (top)") + ' — your moves are graded from here.</span>';
      resync();
    }
  });

  var LS_KEY = "quoridor_coach";
  function setCoach(on, save) {
    coachOn = on;
    document.body.classList.toggle("coach-on", on);
    $("coachchk").checked = on;
    if (save) { try { localStorage.setItem(LS_KEY, on ? "1" : "0"); } catch (e) {} }
    if (!on && (Trainer.active || Session.active)) { // v3: coach-off ends any training flow
      Trainer.abort(); Session.abort();
      if (CB.newGame) CB.newGame();
    }
    if (!on && Puzzle.active) { Puzzle.active = false; Puzzle.item = null; if (CB.newGame) CB.newGame(); }
    if (!on) clearGuess(true);
    refreshAdapt(); refreshTrainBadge();
    if (on) resync();
    else if (cbAiMode()) refreshStatus();   // AI exhibition keeps narrating with Coach off
    else { invalidate(CB.moves().length); $("coachfb").innerHTML = defaultFbHtml; refreshStatus(); }
  }
  $("coachchk").addEventListener("change", function () { setCoach(this.checked, true); });
  var saved = "0";
  try { saved = localStorage.getItem(LS_KEY) || "0"; } catch (e) {}
  setCoach(saved === "1", false);
})();
