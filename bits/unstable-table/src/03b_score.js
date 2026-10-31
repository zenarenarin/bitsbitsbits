// Scoring rules, kept as small pure functions so they are easy to read,
// change and test (dev/score_test.js).
//
//   placement  = (base + balance bonus) x steady-hand multiplier
//   base       = 100 for every object that settles on the table (once per object)
//   balance    = from the table's actual angle once things have settled:
//                within 2 deg +100, within 4 deg +70, within 6 deg +40, beyond: 0
//   multiplier = consecutive stable placements: x1, x1.25, x1.5, x1.75, then x2;
//                the streak resets when the table enters the critical zone
//   perfect    = +150 for bringing the table back within 2 deg after it had
//                become unstable (at most once per placed object)

const SCORING = {
  base: 100,
  balanceBands: [[2, 100], [4, 70], [6, 40]], // [max degrees, bonus]
  multipliers: [1, 1.25, 1.5, 1.75, 2],        // by streak length 1, 2, 3, 4, 5+
  perfect: 150,
  perfectWithin: 2,     // degrees
  unstableHold: 0.4,    // seconds unstable before a recovery can count
  perfectHold: 0.5,     // seconds held within 2 deg (and nearly still) to award
  settleWait: 2.5       // max seconds to wait for the table to stop swinging before scoring
};

function balanceBonus(angleDeg) {
  const a = Math.abs(angleDeg);
  for (const [max, bonus] of SCORING.balanceBands) if (a <= max) return bonus;
  return 0;
}

function streakMultiplier(streak) {
  const m = SCORING.multipliers;
  return m[clamp(streak, 1, m.length) - 1];
}

// The full breakdown for one placement; `streak` includes this placement.
function placementScore(angleDeg, streak) {
  const base = SCORING.base, bonus = balanceBonus(angleDeg), mult = streakMultiplier(streak);
  return { base, bonus, mult, total: Math.round((base + bonus) * mult) };
}
