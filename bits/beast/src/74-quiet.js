// ---- Quiet Streak --------------------------------------------------------------
// Sustained careful climbing earns a modest bonus. The streak counts new
// height gained since the last loud sound: a running step, a landing on bare
// fur or skin (moss and mushroom caps take a landing softly), a fall, or the
// beast beginning to stir. Careful steps and take-offs never break it, and a
// break costs only the bonus to come - never seeds, never progress.
// Each tier reached blooms Dream Seeds at the explorer's feet:
//   15 m -> 1, 40 m -> 2, 80 m -> 3, then 3 more every 40 m after that.

const QUIET = { tiers: [15, 40, 80], every: 40, loud: 0.0095 };

class QuietStreak {
  constructor() {
    this.reset();
  }

  reset() {
    this.metres = 0;
    this.peak = null;
    this.tier = 0;
    this.prevAt = 0;
    this.nextAt = QUIET.tiers[0];
    this.seq = 0;
    this.stirT = -1;
    this.broken = null; // { t, metres, tier } of the last break, for the HUD
    this.best = 0; // longest streak this run (m)
    this.blooms = []; // tier rewards waiting to be paid out
    this.time = 0;
  }

  update(dt, ex, alert) {
    this.time += dt;
    if (this.peak === null) this.peak = ex.y;
    for (const p of alert.pulses) {
      if (p.seq <= this.seq) continue;
      this.seq = p.seq;
      if (p.kind === "run" || p.kind === "fell" || p.raw >= QUIET.loud) this.break(ex);
    }
    if (alert.changed && alert.changed.to === "stirring" && alert.changed.t !== this.stirT) {
      this.stirT = alert.changed.t;
      this.break(ex);
    }
    // Only new height counts, and only once the feet are down again.
    if ((ex.grounded || ex.onCap) && ex.y > this.peak) {
      this.metres += ex.y - this.peak;
      this.peak = ex.y;
      this.best = Math.max(this.best, this.metres);
      while (this.metres >= this.nextAt) {
        this.tier++;
        this.blooms.push({ tier: this.tier, n: Math.min(this.tier, 3) });
        this.prevAt = this.nextAt;
        this.nextAt = this.tier < QUIET.tiers.length ? QUIET.tiers[this.tier] : this.nextAt + QUIET.every;
      }
    }
  }

  break(ex) {
    if (this.metres > 1.5) this.broken = { t: this.time, metres: this.metres, tier: this.tier };
    this.metres = 0;
    this.tier = 0;
    this.prevAt = 0;
    this.nextAt = QUIET.tiers[0];
    this.peak = ex.y;
  }

  // 0..1 progress toward the next tier.
  get progress() {
    return clamp((this.metres - this.prevAt) / (this.nextAt - this.prevAt), 0, 1);
  }
}
