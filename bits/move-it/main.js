/*
 * Move it — a tiny two-character animation playground for Plethora.
 *
 * Pose two figures, save poses, press play. Everything lives in one file, split
 * into sections that each own one concern:
 *   1. Constants            6. Rendering (soft bodies + timeline thumbnails)
 *   2. Character rig        7. Direct manipulation
 *   3. Project + poses      8. Timeline UI
 *   4. Undo / redo          9. Persistence
 *   5. Animation engine    10. GIF export
 *
 * Data rule: `project.poses` is the only source of truth for the animation.
 * Editing works on `edit` (a private copy of the selected pose); playback
 * samples `play` from the poses. Secondary motion (momentum, follow-through,
 * squash) is layered on top into `disp` for display only. None of these
 * ever write back into stored poses.
 */
window.plethoraBit = {
  meta: {
    title: "Move it",
    runtime: "plethora-bit@2",
    tags: ["animation", "creative", "characters", "toy"],
    permissions: ["storage", "haptics"]
  },

  async init(ctx) {
    // ───────────────────────────────────────────── 1. Constants

    const COLOR = {
      bg: "#08090C",
      a: "#638CFF",
      b: "#FF648F",
      ink: "#F2F3F6",
      muted: "#7D818C"
    };
    // Stable world coordinates. Poses are stored in these units and never
    // rewritten on resize; only the view transform changes.
    const STAGE_W = 440;
    const STAGE_H = 600;
    // Rig dimensions. The spine has three segments so the torso can curve;
    // shoulders and hips have width so limbs don't sprout from one point.
    const BODY = {
      spine: [33, 32, 29], neck: 8, headR: 30,
      shW: 15, shDrop: 5, shLift: 7, hipW: 5.5,
      ua: 50, fa: 46, hand: 5, th: 58, sh: 54, foot: 16
    };
    // Body surface half-widths: [root, middle joint, end].
    const ARM_R = [7.2, 5.5, 4.4];
    const LEG_R = [8.2, 6.6, 5.2];
    const HAND_R = 6.4;
    const FOOT_R = 4.6;
    const NECK_R = 6.4;
    const CAP_R = [9.5, 7.2];
    // Torso half-width along the spine (u: 0 = hips, 1 = neck).
    const TORSO_W = [[-0.12, 9.5], [0, 13.2], [0.32, 10.8], [0.64, 13.2], [0.86, 12.4], [1, 7.6]];
    // Character state: hip position + joint angles (radians, y-down).
    // sp = lower spine (absolute), s2/s3 = spine bends, hd = head (relative
    // to the top of the spine), arms relative to the top of the spine, legs
    // absolute from the hips, elbows/knees relative to their parent bone.
    const KEYS = ["x", "y", "sp", "s2", "s3", "hd", "lsh", "lel", "rsh", "rel", "lhp", "lkn", "rhp", "rkn"];
    const ANGLE_KEYS = KEYS.slice(2);
    // Keeps playful exaggeration possible while preventing a folded spine.
    const LIMIT = { s2: 1.15, s3: 1.15, hd: 1.35 };
    const DEFAULT_BEND = { lel: -1, rel: 1, lkn: -1, rkn: 1 };
    const BASE_TRANSITION = 0.6; // seconds per pose transition at 1×
    const SPEEDS = [0.5, 0.75, 1, 1.5, 2];
    const HOLDS = [0, 0.5, 1, 2]; // extra seconds a pose is held at 1×
    const HISTORY_MAX = 80;
    const STORAGE_KEY = "move-it-project";
    const MAX_POSES = 240;
    const TAU = Math.PI * 2;
    const DEG = Math.PI / 180;
    // Overlapping action: how many seconds (at 1×) each channel trails the
    // hips, so the body leads and the head, forearms and shins follow.
    const LAG = {
      x: 0, y: 0, sp: 0.015, s2: 0.035, s3: 0.055, hd: 0.1,
      lsh: 0.04, lel: 0.085, rsh: 0.04, rel: 0.085,
      lhp: 0, lkn: 0, rhp: 0, rkn: 0 // legs move with the hips (and planted feet)
    };
    const MAX_LAG = 0.1;
    const TENSION = 0.9; // Catmull–Rom tangent scale; 1 = classic

    // Geometry slots in a Float64Array: points (x at i, y at i + 1), then the
    // world angles of the spine, head and limb bones.
    const P0 = 0, S1 = 2, S2 = 4, S3 = 6, HC = 8,
      LSH = 10, LEL = 12, LWR = 14, RSH = 16, REL = 18, RWR = 20,
      LHP = 22, LKN = 24, LAN = 26, LTO = 28, RHP = 30, RKN = 32, RAN = 34, RTO = 36,
      NPTS = 38,
      A1 = 38, A2 = 39, A3 = 40, AH = 41, LUA = 42, LFA = 43, RUA = 44, RFA = 45,
      LTH = 46, LSN = 47, RTH = 48, RSN = 49, GLEN = 50;
    const SIDE = {
      l: { sh: LSH, el: LEL, wr: LWR, hp: LHP, kn: LKN, an: LAN, to: LTO, ua: LUA, fa: LFA, th: LTH, sn: LSN },
      r: { sh: RSH, el: REL, wr: RWR, hp: RHP, kn: RKN, an: RAN, to: RTO, ua: RUA, fa: RFA, th: RTH, sn: RSN }
    };

    const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
    const norm = (a) => {
      a = (a + Math.PI) % TAU;
      if (a < 0) a += TAU;
      return a - Math.PI;
    };
    const angDelta = (from, to) => norm(to - from);
    const smooth = (e0, e1, x) => {
      const t = clamp((x - e0) / (e1 - e0), 0, 1);
      return t * t * (3 - 2 * t);
    };
    const round3 = (v) => Math.round(v * 1000) / 1000;

    // ───────────────────────────────────────────── 2. Character rig

    function makeChar(x, y, d) {
      // d holds absolute angles in degrees, which are easier to author.
      const r = (v) => v * DEG;
      return {
        x, y,
        sp: norm(r(d.spine[0])),
        s2: norm(r(d.spine[1] - d.spine[0])),
        s3: norm(r(d.spine[2] - d.spine[1])),
        hd: norm(r(d.head - d.spine[2])),
        lsh: norm(r(d.lArm[0] - d.spine[2])),
        lel: norm(r(d.lArm[1] - d.lArm[0])),
        rsh: norm(r(d.rArm[0] - d.spine[2])),
        rel: norm(r(d.rArm[1] - d.rArm[0])),
        lhp: norm(r(d.lLeg[0])),
        lkn: norm(r(d.lLeg[1] - d.lLeg[0])),
        rhp: norm(r(d.rLeg[0])),
        rkn: norm(r(d.rLeg[1] - d.rLeg[0]))
      };
    }

    function cloneChar(c) {
      const o = {};
      for (const k of KEYS) o[k] = c[k];
      return o;
    }

    function copyChar(src, dst) {
      for (const k of KEYS) dst[k] = src[k];
      return dst;
    }

    function charsEqual(a, b) {
      for (const k of KEYS) if (Math.abs(a[k] - b[k]) > 1e-6) return false;
      return true;
    }

    // How far a thigh is lifted away from hanging under the hips (0..1).
    function liftOf(thigh, spine) {
      return smooth(0.35, 1.7, Math.abs(norm(thigh - spine - Math.PI)));
    }

    // How far an arm is raised from hanging along the body (0..1).
    function raiseOf(rel) {
      return smooth(1.2, 2.9, Math.abs(norm(rel - Math.PI)));
    }

    // Forward kinematics with built-in anatomical assistance: lifting a leg
    // tips the pelvis and counter-leans the torso, and raising an arm lifts
    // its shoulder. `q` squashes (<1) or stretches (>1) the spine.
    function fk(c, G, q) {
      q = q || 1;
      const liftL = liftOf(c.lhp, c.sp), liftR = liftOf(c.rhp, c.sp);
      const a1 = c.sp + 0.1 * (liftL - liftR);
      const a2 = a1 + c.s2, a3 = a2 + c.s3, ah = a3 + c.hd;
      const L = BODY.spine;
      G[P0] = c.x; G[P0 + 1] = c.y;
      G[S1] = c.x + L[0] * q * Math.cos(a1); G[S1 + 1] = c.y + L[0] * q * Math.sin(a1);
      G[S2] = G[S1] + L[1] * q * Math.cos(a2); G[S2 + 1] = G[S1 + 1] + L[1] * q * Math.sin(a2);
      G[S3] = G[S2] + L[2] * q * Math.cos(a3); G[S3 + 1] = G[S2 + 1] + L[2] * q * Math.sin(a3);
      const hr = BODY.neck + BODY.headR;
      G[HC] = G[S3] + hr * Math.cos(ah); G[HC + 1] = G[S3 + 1] + hr * Math.sin(ah);
      G[A1] = a1; G[A2] = a2; G[A3] = a3; G[AH] = ah;

      // shoulders sit just below the neck and rise as the arm goes up
      const ux = Math.cos(a3), uy = Math.sin(a3), nx = -uy, ny = ux;
      armFK(G, SIDE.l, -1, c.lsh, c.lel, a3, ux, uy, nx, ny);
      armFK(G, SIDE.r, 1, c.rsh, c.rel, a3, ux, uy, nx, ny);

      // the pelvis tips up on the side of a lifted leg
      const tilt = 0.24 * (liftL - liftR);
      const hx = -Math.sin(a1 + tilt), hy = Math.cos(a1 + tilt);
      legFK(G, SIDE.l, -1, c.lhp, c.lkn, hx, hy);
      legFK(G, SIDE.r, 1, c.rhp, c.rkn, hx, hy);
      return G;
    }

    function armFK(G, S, side, sh, el, a3, ux, uy, nx, ny) {
      const drop = BODY.shDrop - BODY.shLift * raiseOf(sh);
      const sx = G[S3] + side * nx * BODY.shW - ux * drop;
      const sy = G[S3 + 1] + side * ny * BODY.shW - uy * drop;
      const ua = a3 + sh, fa = ua + el;
      G[S.sh] = sx; G[S.sh + 1] = sy;
      G[S.el] = sx + BODY.ua * Math.cos(ua); G[S.el + 1] = sy + BODY.ua * Math.sin(ua);
      G[S.wr] = G[S.el] + BODY.fa * Math.cos(fa); G[S.wr + 1] = G[S.el + 1] + BODY.fa * Math.sin(fa);
      G[S.ua] = ua; G[S.fa] = fa;
    }

    function legFK(G, S, side, th, kn, hx, hy) {
      const px = G[P0] + side * hx * BODY.hipW, py = G[P0 + 1] + side * hy * BODY.hipW;
      const sn = th + kn;
      G[S.hp] = px; G[S.hp + 1] = py;
      G[S.kn] = px + BODY.th * Math.cos(th); G[S.kn + 1] = py + BODY.th * Math.sin(th);
      G[S.an] = G[S.kn] + BODY.sh * Math.cos(sn); G[S.an + 1] = G[S.kn + 1] + BODY.sh * Math.sin(sn);
      const fd = sn - side * Math.PI / 2; // feet point outward
      G[S.to] = G[S.an] + BODY.foot * Math.cos(fd); G[S.to + 1] = G[S.an + 1] + BODY.foot * Math.sin(fd);
      G[S.th] = th; G[S.sn] = sn;
    }

    // Point at distance u (0 = hips, 1 = neck) along the spine.
    function spinePoint(G, u, out) {
      const pts = [P0, S1, S2, S3];
      let lens = 0;
      const seg = [0, 0, 0];
      for (let i = 0; i < 3; i++) {
        seg[i] = Math.hypot(G[pts[i + 1]] - G[pts[i]], G[pts[i + 1] + 1] - G[pts[i] + 1]);
        lens += seg[i];
      }
      let s = clamp(u, 0, 1) * lens;
      for (let i = 0; i < 3; i++) {
        if (s <= seg[i] || i === 2) {
          const f = seg[i] ? clamp(s / seg[i], 0, 1) : 0;
          out.x = G[pts[i]] + (G[pts[i + 1]] - G[pts[i]]) * f;
          out.y = G[pts[i] + 1] + (G[pts[i + 1] + 1] - G[pts[i] + 1]) * f;
          return out;
        }
        s -= seg[i];
      }
      return out;
    }

    // Soft reach: within `soft` of full length the reach eases towards the
    // limb length asymptotically. Used for automatically planted feet so a
    // knee straightens smoothly instead of popping when the hips rise.
    const PIN_SOFT = 0.04;
    function softReach(d, L, soft) {
      const s = soft * L, d0 = L - s;
      return soft > 0 && d > d0 ? d0 + s * (1 - Math.exp(-(d - d0) / s)) : d;
    }

    // Two-bone inverse kinematics. `bend` (+1/-1) picks which side the middle
    // joint sits on; it is captured at drag start so limbs never flip mid-drag.
    // Out-of-reach targets straighten the limb towards the target.
    const ikOut = { a1: 0, a2: 0 };
    function ik2(ox, oy, tx, ty, l1, l2, bend, soft) {
      const dx = tx - ox, dy = ty - oy;
      const base = Math.atan2(dy, dx);
      const L = l1 + l2;
      const d = clamp(softReach(Math.hypot(dx, dy), L, soft || 0), Math.abs(l1 - l2) + 0.01, L - 0.001);
      const cosA = clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1);
      const a1 = base - bend * Math.acos(cosA);
      const mx = ox + l1 * Math.cos(a1), my = oy + l1 * Math.sin(a1);
      ikOut.a1 = a1;
      ikOut.a2 = Math.atan2(oy + d * Math.sin(base) - my, ox + d * Math.cos(base) - mx);
      return ikOut;
    }

    function bendOf(c, key) {
      const v = c[key];
      return Math.abs(v) < 0.03 ? DEFAULT_BEND[key] : Math.sign(v);
    }

    // Bend side for automatic (non-drag) knee solves. A nearly straight knee
    // carries no reliable side, so it falls back to the natural default
    // instead of flickering between solutions frame to frame.
    function steadyBend(v, key) {
      return Math.abs(v) < 0.2 ? DEFAULT_BEND[key] : Math.sign(v);
    }

    // Scratch geometry for solvers (never rendered).
    const GW = new Float64Array(GLEN);
    const EF = { x: 0, y: 0 };

    // Shoulders and hips move with the limb (raise / tilt), so each solver
    // runs twice to settle that small feedback.
    function solveArm(c, side, tx, ty, g, bend) {
      const S = SIDE[side];
      for (let i = 0; i < 2; i++) {
        fk(c, GW);
        const r = ik2(GW[S.sh], GW[S.sh + 1], tx, ty, BODY.ua, g, bend);
        c[side + "sh"] = norm(r.a1 - GW[A3]);
        c[side + "el"] = norm(r.a2 - r.a1);
      }
    }

    function aimUpperArm(c, side, tx, ty) {
      const S = SIDE[side];
      for (let i = 0; i < 2; i++) {
        fk(c, GW);
        c[side + "sh"] = norm(Math.atan2(ty - GW[S.sh + 1], tx - GW[S.sh]) - GW[A3]);
      }
    }

    function solveLeg(c, side, tx, ty, g, bend, soft) {
      const S = SIDE[side];
      for (let i = 0; i < 3; i++) {
        fk(c, GW);
        const r = ik2(GW[S.hp], GW[S.hp + 1], tx, ty, BODY.th, g, bend, soft);
        c[side + "hp"] = norm(r.a1);
        c[side + "kn"] = norm(r.a2 - r.a1);
      }
    }

    function aimThigh(c, side, tx, ty) {
      const S = SIDE[side];
      for (let i = 0; i < 2; i++) {
        fk(c, GW);
        c[side + "hp"] = norm(Math.atan2(ty - GW[S.hp + 1], tx - GW[S.hp]));
      }
    }

    // Cyclic-coordinate-descent over spine/head joints. Weights spread the
    // bend so the torso curves instead of hinging at one point.
    const PIVOT = { sp: P0, s2: S1, s3: S2, hd: S3 };
    function ccd(c, joints, weights, effector, tx, ty, iters) {
      for (let it = 0; it < iters; it++) {
        for (const j of joints) {
          fk(c, GW);
          effector(GW, EF);
          const p = PIVOT[j];
          const px = GW[p], py = GW[p + 1];
          if (Math.hypot(EF.x - px, EF.y - py) < 3) continue;
          const d = angDelta(Math.atan2(EF.y - py, EF.x - px), Math.atan2(ty - py, tx - px));
          c[j] = norm(c[j] + clamp(d * weights[j], -0.4, 0.4));
          if (LIMIT[j]) c[j] = clamp(c[j], -LIMIT[j], LIMIT[j]);
        }
      }
    }

    // ───────────────────────────────────────────── 3. Project + poses

    let nextId = 1;

    function defaultChars() {
      return {
        a: makeChar(150, 356, {
          spine: [-94, -90, -85], head: -78,
          lArm: [116, 100], rArm: [64, 82],
          lLeg: [99, 94], rLeg: [81, 86]
        }),
        b: makeChar(292, 356, {
          spine: [-86, -91, -96], head: -104,
          lArm: [114, 98], rArm: [38, 114],
          lLeg: [99, 93], rLeg: [81, 87]
        })
      };
    }

    function defaultPose() {
      const d = defaultChars();
      return { id: nextId++, h: 0, a: d.a, b: d.b };
    }

    function clonePose(p, freshId) {
      return { id: freshId ? nextId++ : p.id, h: p.h | 0, a: cloneChar(p.a), b: cloneChar(p.b) };
    }

    const project = {
      poses: [defaultPose()],
      sel: 0,
      speed: 2, // index into SPEEDS
      loop: true,
      ghost: true
    };
    // The canvas edits this private copy of the selected pose. It is copied
    // back into project.poses only when an edit is committed.
    let edit = clonePose(project.poses[0]);

    function syncEdit() {
      project.sel = clamp(project.sel, 0, project.poses.length - 1);
      edit = clonePose(project.poses[project.sel]);
      resetMotions();
    }

    function isPristine() {
      if (project.poses.length !== 1) return false;
      const d = defaultChars();
      const p = project.poses[0];
      return charsEqual(p.a, d.a) && charsEqual(p.b, d.b) && !p.h;
    }

    // ───────────────────────────────────────────── 4. Undo / redo

    // Each entry is a serialized snapshot of the poses and selection, so
    // restoring can never alias live objects.
    const undoStack = [];
    const redoStack = [];

    function snapshot() {
      return JSON.stringify({ poses: project.poses, sel: project.sel });
    }

    function restore(snap) {
      const s = JSON.parse(snap);
      project.poses = s.poses;
      project.sel = s.sel;
      for (const p of project.poses) nextId = Math.max(nextId, p.id + 1);
      syncEdit();
    }

    function pushHistory(snap) {
      undoStack.push(snap);
      if (undoStack.length > HISTORY_MAX) undoStack.shift();
      redoStack.length = 0;
    }

    function undo() {
      if (!undoStack.length || playing) return;
      redoStack.push(snapshot());
      restore(undoStack.pop());
      changed();
    }

    function redo() {
      if (!redoStack.length || playing) return;
      undoStack.push(snapshot());
      restore(redoStack.pop());
      changed();
    }

    // Every committed project change funnels through here.
    function changed(opts) {
      closePopover();
      invalidateSchedule();
      renderTimeline(opts && opts.scroll);
      updateControls();
      scheduleSave();
      dirty = true;
    }

    function commitPoseEdit(before) {
      const cur = project.poses[project.sel];
      if (charsEqual(cur.a, edit.a) && charsEqual(cur.b, edit.b)) return false;
      pushHistory(before);
      project.poses[project.sel] = clonePose(edit);
      changed();
      return true;
    }

    function addPose() {
      if (playing || project.poses.length >= MAX_POSES) return;
      pushHistory(snapshot());
      project.poses.splice(project.sel + 1, 0, clonePose(edit, true));
      project.sel += 1;
      syncEdit();
      changed({ scroll: true });
      haptic("light");
      flashThumb(project.sel);
      interact("add_pose");
    }

    function duplicatePose(i) {
      if (playing || project.poses.length >= MAX_POSES) return;
      pushHistory(snapshot());
      project.poses.splice(i + 1, 0, clonePose(project.poses[i], true));
      project.sel = i + 1;
      syncEdit();
      changed({ scroll: true });
      haptic("light");
      flashThumb(project.sel);
      interact("duplicate_pose");
    }

    function deletePose(i) {
      if (playing || project.poses.length <= 1) return;
      pushHistory(snapshot());
      project.poses.splice(i, 1);
      if (project.sel > i || project.sel >= project.poses.length) project.sel = Math.max(0, project.sel - 1);
      syncEdit();
      changed({ scroll: true });
      interact("delete_pose");
    }

    function movePose(from, to) {
      to = clamp(to, 0, project.poses.length - 1);
      if (playing || from === to) return;
      pushHistory(snapshot());
      const [p] = project.poses.splice(from, 1);
      project.poses.splice(to, 0, p);
      project.sel = to;
      syncEdit();
      changed({ scroll: true });
      interact("reorder_pose");
    }

    function cycleHold(i) {
      if (playing) return;
      pushHistory(snapshot());
      const p = project.poses[i];
      p.h = (p.h + 1) % HOLDS.length;
      syncEdit();
      changed();
    }

    function selectPose(i) {
      if (playing) pause();
      if (i === project.sel) return;
      project.sel = clamp(i, 0, project.poses.length - 1);
      syncEdit();
      closePopover();
      renderTimeline(true);
      updateControls();
      dirty = true;
    }

    function newProject() {
      if (playing) pause();
      pushHistory(snapshot());
      project.poses = [defaultPose()];
      project.sel = 0;
      playTime = 0;
      syncEdit();
      changed({ scroll: true });
      toast("Fresh start. Undo brings the old one back.");
    }

    // ───────────────────────────────────────────── 5. Animation engine
    //
    // Two layers. The base layer is a pure function of time: every channel
    // (hip position, each joint angle) follows a Catmull–Rom curve through
    // the poses, so the body moves *through* poses instead of stopping at
    // each one (unless the pose has a hold). Distal channels trail slightly
    // (overlap), and feet that rest in the same place in neighbouring poses
    // are pinned there. The motion layer then adds secondary motion with
    // time-stepped springs: hip momentum drives sway, squash and stretch,
    // the head and forearms follow through, and the hips dip ahead of big
    // accelerations (anticipation). Neither layer writes to stored poses.

    let playing = false;
    let playTime = 0; // seconds into the schedule; kept while paused
    let schedule = null;
    const play = { a: cloneChar(edit.a), b: cloneChar(edit.b), pos: 0 };

    function invalidateSchedule() {
      schedule = null;
    }

    function posesEqual(p, q) {
      return charsEqual(p.a, q.a) && charsEqual(p.b, q.b);
    }

    function buildSchedule() {
      const all = project.poses;
      const loop = project.loop && all.length > 1;
      const idx = all.map((_, i) => i);
      // a final pose that repeats the first one *is* the loop point
      if (loop && all.length > 2 && posesEqual(all[all.length - 1], all[0])) idx.pop();
      const K = idx.length;
      const speed = SPEEDS[project.speed];
      const D = BASE_TRANSITION / speed;
      const arrive = new Float64Array(K), leave = new Float64Array(K), held = new Uint8Array(K);
      let t = 0;
      for (let i = 0; i < K; i++) {
        arrive[i] = t;
        const hold = HOLDS[all[idx[i]].h | 0] / speed;
        held[i] = hold > 0 ? 1 : 0;
        t += hold;
        leave[i] = t;
        if (i < K - 1 || loop) t += D;
      }
      const lagScale = D / BASE_TRANSITION;
      const total = loop ? t : t + MAX_LAG * lagScale + 0.02;

      const chans = [{}, {}];
      const feet = [[], []];
      const knees = [[], []];
      for (let ci = 0; ci < 2; ci++) {
        const who = ci ? "b" : "a";
        for (const k of KEYS) {
          const angle = k !== "x" && k !== "y";
          const step = (a, b) => (angle ? swing(k, a, b) : b - a);
          const v = idx.map((i) => all[i][who][k]);
          // unwrap angles so curves always take the short way round
          const u = new Float64Array(K + 1), m = new Float64Array(K + 1);
          u[0] = v[0];
          for (let i = 1; i < K; i++) u[i] = u[i - 1] + step(v[i - 1], v[i]);
          const close = K > 1 ? step(v[K - 1], v[0]) : 0;
          u[K] = loop ? u[K - 1] + close : u[K - 1];
          for (let i = 0; i < K; i++) {
            const prev = i > 0 ? u[i - 1] : loop ? u[0] - close : null;
            const next = i < K - 1 ? u[i + 1] : loop ? u[K] : null;
            m[i] = held[i] || prev === null || next === null ? 0 : (TENSION * (next - prev)) / (2 * D);
          }
          m[K] = m[0];
          chans[ci][k] = { u, m };
        }
        for (let i = 0; i < K; i++) {
          fk(all[idx[i]][who], GW);
          feet[ci].push([GW[LAN], GW[LAN + 1], GW[RAN], GW[RAN + 1]]);
          const kp = all[idx[i]][who];
          knees[ci].push([steadyBend(kp.lkn, "lkn"), steadyBend(kp.rkn, "rkn")]);
        }
      }
      return { idx, K, D, arrive, leave, held, total, loop, chans, feet, knees, lagScale };
    }

    // Shoulders never swing *through* the body: a big arm move that would
    // sweep across the torso goes round the outside instead.
    const AVOID = { lsh: 150 * DEG, rsh: -150 * DEG };
    function swing(k, a, b) {
      let d = angDelta(a, b);
      const f = AVOID[k];
      if (f === undefined || Math.abs(d) < 1.2) return d;
      let r = angDelta(a, f);
      if (d > 0 && r < 0) r += TAU;
      if (d < 0 && r > 0) r -= TAU;
      const crosses = d > 0 ? r > 0 && r < d : r < 0 && r > d;
      return crosses ? (d > 0 ? d - TAU : d + TAU) : d;
    }

    function getSchedule() {
      if (!schedule) schedule = buildSchedule();
      return schedule;
    }

    function wrapTime(S, t) {
      if (!(S.total > 0)) return 0;
      return S.loop ? ((t % S.total) + S.total) % S.total : clamp(t, 0, S.total);
    }

    // Where time t falls: a hold on key i, or the transition i → j.
    const SEG = { i: 0, j: 0, f: 0, hold: true };
    function locate(S, t) {
      for (let i = 0; i < S.K; i++) {
        if (t < S.arrive[i]) {
          SEG.i = i - 1; SEG.j = i; SEG.hold = false;
          SEG.f = clamp((t - S.leave[i - 1]) / S.D, 0, 1);
          return SEG;
        }
        if (t <= S.leave[i]) {
          SEG.i = SEG.j = i; SEG.hold = true; SEG.f = 0;
          return SEG;
        }
      }
      if (S.loop) {
        SEG.i = S.K - 1; SEG.j = S.K; SEG.hold = false;
        SEG.f = clamp((t - S.leave[S.K - 1]) / S.D, 0, 1);
      } else {
        SEG.i = SEG.j = S.K - 1; SEG.hold = true; SEG.f = 0;
      }
      return SEG;
    }

    // Cubic Hermite with Catmull–Rom tangents: continuous position and
    // velocity through every pose that isn't deliberately held.
    function chan(S, ch, t) {
      const s = locate(S, t);
      if (s.hold) return ch.u[s.i];
      const f = s.f, f2 = f * f, f3 = f2 * f;
      return (2 * f3 - 3 * f2 + 1) * ch.u[s.i] + (f3 - 2 * f2 + f) * ch.m[s.i] * S.D +
        (-2 * f3 + 3 * f2) * ch.u[s.j] + (f3 - f2) * ch.m[s.j] * S.D;
    }

    function sample(time, out) {
      const S = getSchedule();
      const t = wrapTime(S, time);
      for (let ci = 0; ci < 2; ci++) {
        const c = ci ? out.b : out.a, ch = S.chans[ci];
        for (const k of KEYS) c[k] = chan(S, ch[k], wrapTime(S, t - LAG[k] * S.lagScale));
        for (const k of ANGLE_KEYS) c[k] = norm(c[k]);
        pinFeet(S, ci, c, t);
      }
      const s = locate(S, t);
      const from = S.idx[s.i];
      const to = s.j < S.K ? S.idx[s.j] : S.idx[S.K - 1] + 1;
      out.pos = s.hold ? from : from + s.f * (to - from);
      return out;
    }

    // A foot resting at (nearly) the same spot in both neighbouring poses
    // stays planted through the transition, gliding only by whatever tiny
    // amount the poses differ; the knee absorbs the body's movement.
    // A moving foot eases into its next planted spot (touching down with no
    // speed) and peels off a planted spot gently when it lifts.
    function pinFeet(S, ci, c, t) {
      const s = locate(S, t);
      const F = S.feet[ci];
      const key = (i) => (S.loop ? ((i % S.K) + S.K) % S.K : clamp(i, 0, S.K - 1));
      const planted = (i, o) => {
        if (!S.loop && (i < 0 || i >= S.K - 1)) return i === S.K - 1 && S.K > 0 && i >= 0;
        const a = F[key(i)], b = F[key(i + 1)];
        return Math.hypot(a[o] - b[o], a[o + 1] - b[o + 1]) <= 2.5;
      };
      const a = F[s.i], b = F[key(s.j)];
      for (let side = 0; side < 2; side++) {
        const o = side * 2, sd = side ? "r" : "l";
        const bend = S.knees[ci][s.i][side];
        if (s.hold || planted(s.i, o)) {
          const e = s.hold ? 0 : 0.5 - 0.5 * Math.cos(Math.PI * s.f);
          solveLeg(c, sd, a[o] + (b[o] - a[o]) * e, a[o + 1] + (b[o + 1] - a[o + 1]) * e, BODY.sh, bend);
          continue;
        }
        const land = planted(s.i + 1, o) ? smooth(0.55, 1, s.f) : 0;
        const lift = planted(s.i - 1, o) ? 1 - smooth(0, 0.45, s.f) : 0;
        const w = Math.max(land, lift);
        if (w <= 0) continue;
        const cx = land >= lift ? b[o] : a[o], cy = land >= lift ? b[o + 1] : a[o + 1];
        fk(c, GW);
        const S2 = SIDE[sd];
        const fx = GW[S2.an], fy = GW[S2.an + 1];
        // soft only while the foot is in the air part of the blend, fading
        // to exact at contact, so contact itself lands on the planted spot
        solveLeg(c, sd, fx + (cx - fx) * w, fy + (cy - fy) * w, BODY.sh, bend, PIN_SOFT * (1 - w));
      }
    }

    // Anticipation and weight: the hips dip or shift against the coming
    // acceleration, so big moves wind up first and landings sink in.
    function anticipation(S, ci, t, out) {
      out.x = out.y = 0;
      if (!(S.total > 0) || S.K < 2) return out;
      const ch = S.chans[ci], e = 0.07, tl = t + 0.09;
      const at = (k) => (chan(S, ch[k], wrapTime(S, tl + e)) - 2 * chan(S, ch[k], wrapTime(S, tl)) +
        chan(S, ch[k], wrapTime(S, tl - e))) / (e * e);
      out.x = clamp(-0.003 * at("x"), -10, 10);
      out.y = clamp(-0.0034 * at("y"), -9, 14);
      return out;
    }

    function makeMotion() {
      return {
        live: false, rx: 0, ry: 0, vx: 0, vy: 0, h: 0, hv: 0, fl: 0, flv: 0, fr: 0, frv: 0, q: 1, ws: 1,
        tx: 0, ty: 0, th: 0, tl: 0, tr: 0 // previous targets, for sub-step interpolation
      };
    }
    const NOFREEZE = { head: false, l: false, r: false };
    const GM = new Float64Array(GLEN);

    // Secondary motion for one character. Reads `base`, writes the displayed
    // body to `out`, returns how lively it still is (0 when at rest).
    function stepMotion(m, base, dt, out, antic, freeze) {
      fk(base, GM);
      const hT = GM[AH], lT = GM[LFA], rT = GM[RFA];
      if (!m.live) {
        m.live = true;
        m.rx = m.tx = base.x; m.ry = m.ty = base.y; m.vx = m.vy = 0;
        m.h = m.th = hT; m.fl = m.tl = lT; m.fr = m.tr = rT; m.hv = m.flv = m.frv = 0;
      }
      // Fixed 240 Hz sub-steps with targets interpolated across the frame,
      // so 20 fps and 144 fps devices produce the same motion.
      const n = clamp(Math.ceil(dt * 240), 1, 40);
      const h = dt / n;
      const dhT = angDelta(m.th, hT), dlT = angDelta(m.tl, lT), drT = angDelta(m.tr, rT);
      for (let i = 1; i <= n; i++) {
        const k = i / n;
        const bx = m.tx + (base.x - m.tx) * k, by = m.ty + (base.y - m.ty) * k;
        // the body's mass lags behind the hips, then overshoots and settles
        m.vx += (-144 * (m.rx - bx) - 9.1 * m.vx) * h; m.rx += m.vx * h;
        m.vy += (-144 * (m.ry - by) - 9.1 * m.vy) * h; m.ry += m.vy * h;
        // head and forearms follow through
        m.hv += (-256 * angDelta(m.th + dhT * k, m.h) - 14.4 * m.hv) * h; m.h += m.hv * h;
        m.flv += (-225 * angDelta(m.tl + dlT * k, m.fl) - 12 * m.flv) * h; m.fl += m.flv * h;
        m.frv += (-225 * angDelta(m.tr + drT * k, m.fr) - 12 * m.frv) * h; m.fr += m.frv * h;
      }
      m.tx = base.x; m.ty = base.y; m.th = hT; m.tl = lT; m.tr = rT;
      if (freeze.head) { m.h = hT; m.hv = 0; }
      if (freeze.l) { m.fl = lT; m.flv = 0; }
      if (freeze.r) { m.fr = rT; m.frv = 0; }
      m.h = hT + angDelta(hT, m.h);
      m.fl = lT + angDelta(lT, m.fl);
      m.fr = rT + angDelta(rT, m.fr);

      copyChar(base, out);
      const ex = clamp(m.rx - base.x, -40, 40), ey = clamp(m.ry - base.y, -40, 40);
      const lean = clamp(ex * 0.0065, -0.32, 0.32);
      out.sp = norm(out.sp + lean);
      out.s3 = clamp(out.s3 + lean * 0.6, -LIMIT.s3, LIMIT.s3);
      const hOff = clamp(angDelta(hT, m.h), -0.45, 0.45);
      const lOff = clamp(angDelta(lT, m.fl), -0.5, 0.5), rOff = clamp(angDelta(rT, m.fr), -0.5, 0.5);
      out.hd += hOff;
      out.lel = norm(out.lel + lOff);
      out.rel = norm(out.rel + rOff);
      // squash while the mass is still sinking, stretch while it rises ahead
      const sq = clamp(ey * 0.012, -0.1, 0.14);
      m.q = 1 - sq * 0.5;
      m.ws = 1 + sq * 0.55;
      // the hips sink and shift while the feet stay where they are
      const dx = antic ? antic.x : 0, dy = sq * 36 + (antic ? antic.y : 0);
      if (Math.abs(dx) + Math.abs(dy) > 0.05) {
        fk(out, GM);
        const lx = GM[LAN], ly = GM[LAN + 1], rx = GM[RAN], ry = GM[RAN + 1];
        // shrink the shift if it would pull a leg straighter than it can go
        const maxD = (BODY.th + BODY.sh) * 0.995;
        let k = 1;
        for (let i = 0; i < 4; i++) {
          const lh = Math.hypot(GM[LHP] + dx * k - lx, GM[LHP + 1] + dy * k - ly);
          const rh = Math.hypot(GM[RHP] + dx * k - rx, GM[RHP + 1] + dy * k - ry);
          if (lh <= maxD && rh <= maxD) break;
          k *= 0.5;
        }
        out.x += dx * k;
        out.y += dy * k;
        solveLeg(out, "l", lx, ly, BODY.sh, steadyBend(base.lkn, "lkn"));
        solveLeg(out, "r", rx, ry, BODY.sh, steadyBend(base.rkn, "rkn"));
      }
      return Math.abs(ex) + Math.abs(ey) + 0.05 * (Math.abs(m.vx) + Math.abs(m.vy)) +
        30 * (Math.abs(hOff) + Math.abs(lOff) + Math.abs(rOff)) + 2 * (Math.abs(m.hv) + Math.abs(m.flv) + Math.abs(m.frv));
    }

    const motion = [makeMotion(), makeMotion()];
    const disp = [cloneChar(edit.a), cloneChar(edit.b)];
    const anticNow = [{ x: 0, y: 0 }, { x: 0, y: 0 }];
    let activity = 0;

    function resetMotions() {
      motion[0].live = motion[1].live = false;
      motion[0].q = motion[1].q = 1;
      motion[0].ws = motion[1].ws = 1;
      dirty = true;
    }

    // Advances the displayed bodies by dt seconds (frame-rate independent).
    function stepAll(dt) {
      const S = playing ? getSchedule() : null;
      const t = playing ? wrapTime(S, playTime) : 0;
      let act = 0;
      for (let ci = 0; ci < 2; ci++) {
        const base = playing ? (ci ? play.b : play.a) : ci ? edit.b : edit.a;
        const an = playing ? anticipation(S, ci, t, anticNow[ci]) : null;
        const fr = !playing && drag && drag.ci === ci ? drag.freeze : NOFREEZE;
        act += stepMotion(motion[ci], base, dt, disp[ci], an, fr);
      }
      activity = act;
    }

    function startPlayback(fromStart) {
      if (project.poses.length < 2) {
        toast("Add a second pose to see them move.");
        return;
      }
      closePopover();
      endDrag(false);
      const { total } = getSchedule();
      if (fromStart || playTime >= total) playTime = 0;
      playing = true;
      sample(playTime, play);
      resetMotions();
      interact("play");
      updateControls();
    }

    function pause() {
      if (!playing) return;
      playing = false;
      resetMotions();
      updateControls();
      renderTimeline(false);
    }

    function togglePlay() {
      if (playing) pause();
      else startPlayback(false);
    }

    function restart() {
      if (project.poses.length < 2) {
        toast("Add a second pose to see them move.");
        return;
      }
      startPlayback(true);
    }

    function advancePlayback(dt) {
      if (!playing) return;
      const { total } = getSchedule();
      playTime += dt;
      if (playTime >= total) {
        if (project.loop && total > 0) {
          playTime %= total;
        } else {
          playTime = total;
          playing = false;
          resetMotions();
          updateControls();
        }
      }
      sample(playTime, play);
      updatePlayhead();
      dirty = true;
    }

    // ───────────────────────────────────────────── 6. Rendering
    //
    // Each body part is a chain of circles (centre + radius); the chain and
    // the tangent hulls between neighbouring circles are filled together.
    // That gives tapered limbs, a curved torso and rounded elbows/knees with
    // no visible hinges. The same chains drive hit testing, so anything you
    // can see you can grab.

    const canvas = ctx.createCanvas2D({ layer: "content", maxDpr: 2, alpha: false, touchAction: "none" });
    const g = canvas.getContext("2d");
    canvas.style.touchAction = "none";
    const view = { s: 1, ox: 0, oy: 0 };
    const ghostA = mixHex(COLOR.bg, COLOR.a, 0.24);
    const ghostB = mixHex(COLOR.bg, COLOR.b, 0.24);
    const tintA = [mixHex(COLOR.a, "#FFFFFF", 0.16), mixHex(COLOR.a, "#FFFFFF", 0.32)];
    const tintB = [mixHex(COLOR.b, "#FFFFFF", 0.16), mixHex(COLOR.b, "#FFFFFF", 0.32)];
    const haloColor = mixHex(COLOR.bg, "#FFFFFF", 0.13);
    let dirty = true;
    let hover = null; // { ci, parts }

    function mixHex(h1, h2, t) {
      const a = parseInt(h1.slice(1), 16), b = parseInt(h2.slice(1), 16);
      const ch = (v, s) => (v >> s) & 255;
      const m = (s) => Math.round(ch(a, s) + (ch(b, s) - ch(a, s)) * t);
      return "rgb(" + m(16) + "," + m(8) + "," + m(0) + ")";
    }

    const PART_NAMES = ["torso", "lcap", "rcap", "neck", "head", "larm", "rarm", "lleg", "rleg"];
    function makeBody() {
      const b = {};
      for (const p of PART_NAMES) {
        b[p] = { n: 0, x: new Float64Array(16), y: new Float64Array(16), r: new Float64Array(16), s: new Float64Array(16) };
      }
      return b;
    }
    function push(p, x, y, r, s) {
      const i = p.n++;
      p.x[i] = x; p.y[i] = y; p.r[i] = r; p.s[i] = s;
    }

    function torsoHalfWidth(u) {
      const W = TORSO_W;
      if (u <= W[0][0]) return W[0][1];
      for (let i = 1; i < W.length; i++) {
        if (u <= W[i][0]) {
          const t = (u - W[i - 1][0]) / (W[i][0] - W[i - 1][0]);
          return W[i - 1][1] + (W[i][1] - W[i - 1][1]) * (0.5 - 0.5 * Math.cos(Math.PI * t));
        }
      }
      return W[W.length - 1][1];
    }

    // A limb: two bones joined by a soft fillet, tapering root → joint → end.
    // s runs 0 (root) → 1 (elbow/knee) → 2 (wrist/ankle).
    function limbPart(p, G, a, b, c, R, fillet) {
      p.n = 0;
      const ax = G[a], ay = G[a + 1], bx = G[b], by = G[b + 1], cx = G[c], cy = G[c + 1];
      const la = Math.hypot(bx - ax, by - ay) || 1, lc = Math.hypot(cx - bx, cy - by) || 1;
      const f = Math.min(fillet, la * 0.4, lc * 0.4);
      const p1x = bx - ((bx - ax) / la) * f, p1y = by - ((by - ay) / la) * f;
      const p2x = bx + ((cx - bx) / lc) * f, p2y = by + ((cy - by) / lc) * f;
      const rr = (s) => (s <= 1 ? R[0] + (R[1] - R[0]) * s : R[1] + (R[2] - R[1]) * (s - 1));
      const s1 = 1 - f / la, s2 = 1 + f / lc;
      push(p, ax, ay, R[0], 0);
      push(p, p1x, p1y, rr(s1), s1);
      for (let k = 1; k < 4; k++) {
        const t = k / 4, it = 1 - t;
        const s = s1 + (s2 - s1) * t;
        push(p, it * it * p1x + 2 * it * t * bx + t * t * p2x, it * it * p1y + 2 * it * t * by + t * t * p2y, rr(s), s);
      }
      push(p, p2x, p2y, rr(s2), s2);
      push(p, cx, cy, R[2], 2);
    }

    // Catmull–Rom point between control points i and i+1 of a flat array.
    const CR = { x: 0, y: 0 };
    function catmull(pts, n, i, t) {
      const i0 = Math.max(0, i - 1), i2 = Math.min(n - 1, i + 1), i3 = Math.min(n - 1, i + 2);
      const t2 = t * t, t3 = t2 * t;
      for (let d = 0; d < 2; d++) {
        const p0 = pts[i0 * 2 + d], p1 = pts[i * 2 + d], p2 = pts[i2 * 2 + d], p3 = pts[i3 * 2 + d];
        const v = 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (3 * p1 - p0 - 3 * p2 + p3) * t3);
        if (d) CR.y = v; else CR.x = v;
      }
      return CR;
    }

    const TORSO_PTS = new Float64Array(10);
    const TORSO_U = [-0.12, 0, 1 / 3, 2 / 3, 1];
    function buildBody(G, B, ws) {
      // torso: a curve through a point below the hips, the hips, waist, chest and neck
      const T = B.torso;
      T.n = 0;
      const a1 = G[A1];
      TORSO_PTS[0] = G[P0] - Math.cos(a1) * 7; TORSO_PTS[1] = G[P0 + 1] - Math.sin(a1) * 7;
      TORSO_PTS[2] = G[P0]; TORSO_PTS[3] = G[P0 + 1];
      TORSO_PTS[4] = G[S1]; TORSO_PTS[5] = G[S1 + 1];
      TORSO_PTS[6] = G[S2]; TORSO_PTS[7] = G[S2 + 1];
      TORSO_PTS[8] = G[S3]; TORSO_PTS[9] = G[S3 + 1];
      for (let k = 0; k < 4; k++) {
        const steps = k === 0 ? 1 : 3;
        for (let j = 0; j < steps; j++) {
          const t = j / steps;
          const u = TORSO_U[k] + (TORSO_U[k + 1] - TORSO_U[k]) * t;
          const pt = catmull(TORSO_PTS, 5, k, t);
          push(T, pt.x, pt.y, torsoHalfWidth(u) * ws, u);
        }
      }
      push(T, G[S3], G[S3 + 1], torsoHalfWidth(1) * ws, 1);
      // shoulder caps blend the chest into the arms
      const chx = G[S2] + (G[S3] - G[S2]) * 0.55, chy = G[S2 + 1] + (G[S3 + 1] - G[S2 + 1]) * 0.55;
      for (const [name, sl] of [["lcap", LSH], ["rcap", RSH]]) {
        const p = B[name];
        p.n = 0;
        push(p, chx, chy, CAP_R[0] * ws, 0);
        push(p, G[sl], G[sl + 1], CAP_R[1], 1);
      }
      // a short neck tucks up into the head
      const N = B.neck, H = B.head, ah = G[AH], nl = BODY.neck + BODY.headR * 0.5;
      N.n = 0;
      push(N, G[S3], G[S3 + 1], NECK_R, 0);
      push(N, G[S3] + nl * Math.cos(ah), G[S3 + 1] + nl * Math.sin(ah), NECK_R * 0.9, 1);
      H.n = 0;
      push(H, G[HC], G[HC + 1], BODY.headR, 1);
      // limbs, with a mitten hand and a rounded foot
      for (const sd of ["l", "r"]) {
        const S = SIDE[sd];
        const arm = B[sd + "arm"];
        limbPart(arm, G, S.sh, S.el, S.wr, ARM_R, 11);
        push(arm, G[S.wr] + BODY.hand * Math.cos(G[S.fa]), G[S.wr + 1] + BODY.hand * Math.sin(G[S.fa]), HAND_R, 2.4);
        const leg = B[sd + "leg"];
        limbPart(leg, G, S.hp, S.kn, S.an, LEG_R, 13);
        push(leg, G[S.to], G[S.to + 1], FOOT_R, 2.6);
      }
      return B;
    }

    function addCircle(c2, x, y, r) {
      c2.moveTo(x + r, y);
      c2.arc(x, y, r, 0, TAU);
    }

    // Outer tangent hull of two circles, wound the same way as arc() so the
    // union fills cleanly under the nonzero rule.
    function addHull(c2, x1, y1, r1, x2, y2, r2) {
      const dx = x2 - x1, dy = y2 - y1, d = Math.hypot(dx, dy);
      if (d <= Math.abs(r1 - r2) + 1e-6) return;
      const base = Math.atan2(dy, dx), phi = Math.acos(clamp((r1 - r2) / d, -1, 1));
      const ax = Math.cos(base + phi), ay = Math.sin(base + phi);
      const bx = Math.cos(base - phi), by = Math.sin(base - phi);
      c2.moveTo(x1 + r1 * bx, y1 + r1 * by);
      c2.lineTo(x2 + r2 * bx, y2 + r2 * by);
      c2.lineTo(x2 + r2 * ax, y2 + r2 * ay);
      c2.lineTo(x1 + r1 * ax, y1 + r1 * ay);
      c2.closePath();
    }

    function tracePart(c2, p, extra) {
      for (let i = 0; i < p.n; i++) {
        addCircle(c2, p.x[i], p.y[i], p.r[i] + extra);
        if (i) addHull(c2, p.x[i - 1], p.y[i - 1], p.r[i - 1] + extra, p.x[i], p.y[i], p.r[i] + extra);
      }
    }

    function fillParts(c2, B, names, color, extra) {
      c2.beginPath();
      for (const n of names) tracePart(c2, B[n], extra || 0);
      c2.fillStyle = color;
      c2.fill();
    }

    const BODY_A = makeBody(), BODY_B = makeBody(), BODY_G = makeBody();
    const GA = new Float64Array(GLEN), GB = new Float64Array(GLEN), GG = new Float64Array(GLEN);

    function render() {
      const cssW = ctx.width || canvas.clientWidth || 1;
      const k = canvas.width / cssW;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.fillStyle = COLOR.bg;
      g.fillRect(0, 0, canvas.width, canvas.height);
      g.setTransform(k * view.s, 0, 0, k * view.s, k * view.ox, k * view.oy);

      if (!playing && project.ghost && project.sel > 0) {
        const prev = project.poses[project.sel - 1];
        fillParts(g, buildBody(fk(prev.a, GG), BODY_G, 1), PART_NAMES, ghostA);
        fillParts(g, buildBody(fk(prev.b, GG), BODY_G, 1), PART_NAMES, ghostB);
      }
      buildBody(fk(disp[0], GA, motion[0].q), BODY_A, motion[0].ws);
      buildBody(fk(disp[1], GB, motion[1].q), BODY_B, motion[1].ws);
      const active = playing ? null : drag ? { ci: drag.ci, parts: drag.parts, level: 1 } : hover ? { ci: hover.ci, parts: hover.parts, level: 0 } : null;
      if (active && active.parts === PART_NAMES) {
        fillParts(g, active.ci ? BODY_B : BODY_A, PART_NAMES, haloColor, 6 / view.s);
      }
      for (let ci = 0; ci < 2; ci++) {
        const B = ci ? BODY_B : BODY_A;
        fillParts(g, B, PART_NAMES, ci ? COLOR.b : COLOR.a);
        if (active && active.ci === ci && active.parts !== PART_NAMES) {
          fillParts(g, B, active.parts, (ci ? tintB : tintA)[active.level]);
        }
      }
      if (drag && !playing) {
        // a soft ring where the finger holds the body
        g.strokeStyle = "rgba(255,255,255,0.32)";
        g.lineWidth = 2 / view.s;
        g.beginPath();
        g.arc(drag.wx, drag.wy, 15 / view.s, 0, TAU);
        g.stroke();
      }
    }

    // Small inline SVG of both characters for the timeline.
    const GT = new Float64Array(GLEN);
    const f1 = (v) => Math.round(v * 10) / 10;
    function figureSVG(c, color) {
      const G = fk(c, GT);
      const pt = (i) => f1(G[i]) + " " + f1(G[i + 1]);
      return (
        '<g stroke="' + color + '" fill="none" stroke-linecap="round" stroke-linejoin="round">' +
        '<path stroke-width="15" d="M' + pt(LHP) + "L" + pt(LKN) + "L" + pt(LAN) + "L" + pt(LTO) +
        "M" + pt(RHP) + "L" + pt(RKN) + "L" + pt(RAN) + "L" + pt(RTO) +
        "M" + pt(LSH) + "L" + pt(LEL) + "L" + pt(LWR) + "M" + pt(RSH) + "L" + pt(REL) + "L" + pt(RWR) +
        "M" + pt(LSH) + "L" + pt(S3) + "L" + pt(RSH) + "M" + pt(S3) + "L" + pt(HC) + '"/>' +
        '<path stroke-width="24" d="M' + pt(P0) + "L" + pt(S1) + "L" + pt(S2) + "L" + pt(S3) + '"/>' +
        '<circle fill="' + color + '" stroke="none" cx="' + f1(G[HC]) + '" cy="' + f1(G[HC + 1]) + '" r="' + BODY.headR + '"/>' +
        "</g>"
      );
    }

    // One shared viewBox for every thumbnail so sizes and positions compare.
    function thumbViewBox() {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const p of project.poses) {
        for (const c of [p.a, p.b]) {
          const G = fk(c, GT);
          for (let i = 0; i < NPTS; i += 2) {
            x0 = Math.min(x0, G[i]); x1 = Math.max(x1, G[i]);
            y0 = Math.min(y0, G[i + 1]); y1 = Math.max(y1, G[i + 1]);
          }
          x0 = Math.min(x0, G[HC] - BODY.headR); x1 = Math.max(x1, G[HC] + BODY.headR);
          y0 = Math.min(y0, G[HC + 1] - BODY.headR); y1 = Math.max(y1, G[HC + 1] + BODY.headR);
        }
      }
      const pad = 26;
      x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
      const aspect = THUMB_W / THUMB_H;
      let w = Math.max(x1 - x0, 300), h = Math.max(y1 - y0, 300 / aspect);
      if (w / h > aspect) h = w / aspect; else w = h * aspect;
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      return f1(cx - w / 2) + " " + f1(cy - h / 2) + " " + f1(w) + " " + f1(h);
    }

    // ───────────────────────────────────────────── 7. Direct manipulation
    //
    // Every visible surface is grabbable. What a drag does depends on where
    // the finger lands:
    //   head            tilts the head; the neck and upper spine follow
    //   chest           bends and curves the spine around the hips
    //   belly           leans the whole torso (steered from the chest)
    //   hips            shifts weight with the feet planted (crouch, sit);
    //                   pulling past the legs' reach brings the body along
    //   upper arm/thigh swings the limb from the shoulder/hip
    //   forearm, hand,  inverse kinematics on the whole limb; a hand pulled
    //   shin, foot      out of reach makes the body lean into the reach
    //   hold (≈0.4 s)   picks the whole figure up to move it
    // The grabbed point keeps its offset from the finger, so nothing jumps.

    const HOLD_MS = 380;
    const BOTH = ["l", "r"];
    const BEND_W = { sp: 0.3, s2: 0.65, s3: 0.85 };
    const LEAN_W = { sp: 0.6, s2: 0.25, s3: 0.2 };
    const HEAD_W = { hd: 1, s3: 0.4, s2: 0.2 };
    const REACH_W = { s3: 0.35, s2: 0.3, sp: 0.25 };
    // Extremities win where parts overlap (an arm in front of the torso).
    const PRIORITY = { torso: 0, lcap: 0.5, rcap: 0.5, neck: 1, head: 1.5, larm: 3, rarm: 3, lleg: 2.5, rleg: 2.5 };
    let drag = null;
    let started = false;
    let lastPointerType = "touch";
    const GP = new Float64Array(GLEN);
    const PICK = makeBody();

    function toLocal(e) {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    function toWorld(p) {
      return { x: (p.x - view.ox) / view.s, y: (p.y - view.oy) / view.s };
    }

    // Distance from a point to a part's surface (negative inside) and the
    // part coordinate `s` of the closest point on its centreline.
    const NEAR = { d: 0, s: 0 };
    function nearPart(p, wx, wy) {
      NEAR.d = Infinity;
      for (let i = 0; i < p.n; i++) {
        const dc = Math.hypot(wx - p.x[i], wy - p.y[i]) - p.r[i];
        if (dc < NEAR.d) { NEAR.d = dc; NEAR.s = p.s[i]; }
        if (!i) continue;
        const ax = p.x[i - 1], ay = p.y[i - 1], dx = p.x[i] - ax, dy = p.y[i] - ay;
        const l2 = dx * dx + dy * dy;
        if (!l2) continue;
        const t = clamp(((wx - ax) * dx + (wy - ay) * dy) / l2, 0, 1);
        const d = Math.hypot(wx - ax - t * dx, wy - ay - t * dy) - (p.r[i - 1] + (p.r[i] - p.r[i - 1]) * t);
        if (d < NEAR.d) { NEAR.d = d; NEAR.s = p.s[i - 1] + (p.s[i] - p.s[i - 1]) * t; }
      }
      return NEAR;
    }

    function pick(w) {
      const slop = (lastPointerType === "mouse" ? 6 : 16) / view.s;
      let best = null, bestScore = Infinity;
      for (const ci of [1, 0]) {
        buildBody(fk(ci ? edit.b : edit.a, GP), PICK, 1);
        for (const name of PART_NAMES) {
          const n = nearPart(PICK[name], w.x, w.y);
          if (n.d > slop) continue;
          // limbs win over the torso, except right at their roots
          const score = Math.max(n.d, 0) - (n.s > 0.3 ? PRIORITY[name] : 0);
          if (score < bestScore) {
            bestScore = score;
            best = { ci, part: name, s: n.s };
          }
        }
      }
      return best;
    }

    function dragKind(hit) {
      const p = hit.part, s = hit.s;
      if (p === "head" || p === "neck") return { kind: "head", parts: ["neck", "head"] };
      if (p === "torso") {
        if (s < 0.2) return { kind: "hips", parts: ["torso"] };
        // the belly steers the chest, a longer lever, so the lean stays gentle
        if (s < 0.5) return { kind: "lean", u: 0.8, parts: ["torso", "lcap", "rcap"] };
        return { kind: "bend", u: s, parts: ["torso", "lcap", "rcap"] };
      }
      if (p === "lcap" || p === "rcap") return { kind: "bend", u: 0.95, parts: ["torso", "lcap", "rcap"] };
      const side = p[0];
      if (p.slice(1) === "arm") {
        return s < 1
          ? { kind: "upper", side, g: Math.max(0.35, s) * BODY.ua, parts: [p] }
          : { kind: "lower", side, g: clamp(s - 1, 0.3, 1.15) * BODY.fa, parts: [p] };
      }
      return s < 1
        ? { kind: "thigh", side, g: Math.max(0.35, s) * BODY.th, parts: [p] }
        : { kind: "shin", side, g: clamp(s - 1, 0.3, 1) * BODY.sh, parts: [p] };
    }

    // The point on the body that follows the finger for a given drag.
    function effector(d, G, out) {
      const S = d.side ? SIDE[d.side] : null;
      switch (d.kind) {
        case "bend": case "lean": return spinePoint(G, d.u, out);
        case "head": out.x = G[HC]; out.y = G[HC + 1]; return out;
        case "upper": out.x = G[S.sh] + d.g * Math.cos(G[S.ua]); out.y = G[S.sh + 1] + d.g * Math.sin(G[S.ua]); return out;
        case "lower": out.x = G[S.el] + d.g * Math.cos(G[S.fa]); out.y = G[S.el + 1] + d.g * Math.sin(G[S.fa]); return out;
        case "thigh": out.x = G[S.hp] + d.g * Math.cos(G[S.th]); out.y = G[S.hp + 1] + d.g * Math.sin(G[S.th]); return out;
        case "shin": out.x = G[S.kn] + d.g * Math.cos(G[S.sn]); out.y = G[S.kn + 1] + d.g * Math.sin(G[S.sn]); return out;
        default: out.x = G[P0]; out.y = G[P0 + 1]; return out;
      }
    }

    function beginDrag(e) {
      lastPointerType = e.pointerType || "mouse";
      const p = toLocal(e), w = toWorld(p);
      const hit = pick(w);
      if (!hit) return false;
      const c = hit.ci ? edit.b : edit.a;
      const d = dragKind(hit);
      fk(c, GW);
      effector(d, GW, EF);
      d.pointerId = e.pointerId;
      d.ci = hit.ci;
      d.before = snapshot();
      d.start = cloneChar(c);
      d.offX = EF.x - w.x;
      d.offY = EF.y - w.y;
      d.x0 = p.x; d.y0 = p.y; d.moved = 0;
      d.wx = w.x; d.wy = w.y;
      d.bend = { lel: bendOf(c, "lel"), rel: bendOf(c, "rel"), lkn: bendOf(c, "lkn"), rkn: bendOf(c, "rkn") };
      d.feet = [GW[LAN], GW[LAN + 1], GW[RAN], GW[RAN + 1]];
      d.freeze = {
        head: d.kind === "head",
        l: d.side === "l" && (d.kind === "upper" || d.kind === "lower"),
        r: d.side === "r" && (d.kind === "upper" || d.kind === "lower")
      };
      drag = d;
      hover = null;
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* capture is best-effort */ }
      canvas.style.cursor = "grabbing";
      if (!started) {
        started = true;
        ctx.platform.start();
      }
      interact("pose_drag");
      ctx.timeout(() => {
        if (drag === d && d.kind !== "carry" && d.moved < 8) startCarry(d);
      }, HOLD_MS);
      dirty = true;
      return true;
    }

    // Press and hold: pick the whole figure up, pose untouched.
    function startCarry(d) {
      const c = d.ci ? edit.b : edit.a;
      copyChar(d.start, c);
      d.kind = "carry";
      d.parts = PART_NAMES;
      d.freeze = NOFREEZE;
      d.offX = c.x - d.wx;
      d.offY = c.y - d.wy;
      haptic("light");
      dirty = true;
    }

    function applyDrag(w) {
      const d = drag;
      const c = d.ci ? edit.b : edit.a;
      d.wx = w.x; d.wy = w.y;
      const tx = w.x + d.offX, ty = w.y + d.offY;
      switch (d.kind) {
        case "carry":
          c.x = clamp(tx, 10, STAGE_W - 10);
          c.y = clamp(ty, 30, STAGE_H - 10);
          break;
        case "hips":
          moveHips(c, d, clamp(tx, 10, STAGE_W - 10), clamp(ty, 30, STAGE_H - 10));
          break;
        case "bend": {
          const js = d.u > 2 / 3 ? ["s3", "s2", "sp"] : d.u > 1 / 3 ? ["s2", "sp"] : ["sp"];
          ccd(c, js, BEND_W, (G, o) => spinePoint(G, d.u, o), tx, ty, 4);
          keepFeet(c, d, BOTH);
          break;
        }
        case "lean":
          ccd(c, ["s3", "s2", "sp"], LEAN_W, (G, o) => spinePoint(G, d.u, o), tx, ty, 4);
          keepFeet(c, d, BOTH);
          break;
        case "head":
          ccd(c, ["hd", "s3", "s2"], HEAD_W, (G, o) => { o.x = G[HC]; o.y = G[HC + 1]; }, tx, ty, 4);
          break;
        case "upper":
          aimUpperArm(c, d.side, tx, ty);
          break;
        case "lower":
          reach(c, d, tx, ty);
          keepFeet(c, d, BOTH);
          break;
        case "thigh":
          aimThigh(c, d.side, tx, ty);
          keepFeet(c, d, d.side === "l" ? ["r"] : ["l"]);
          break;
        case "shin":
          solveLeg(c, d.side, tx, ty, d.g, d.bend[d.side + "kn"]);
          keepFeet(c, d, d.side === "l" ? ["r"] : ["l"]);
          break;
      }
      dirty = true;
    }

    // Planted feet stay exactly where they were while the rest of the body
    // moves (leaning or lifting a leg tips the pelvis). A nearly straight
    // standing leg has almost no slack, so if a foot can't quite be reached
    // the hips settle a little lower, as a real body would.
    function keepFeet(c, d, sides) {
      for (let it = 0; it < 4; it++) {
        let short = 0;
        for (const side of sides) {
          const o = side === "l" ? 0 : 2, S = SIDE[side];
          solveLeg(c, side, d.feet[o], d.feet[o + 1], BODY.sh, d.bend[side + "kn"]);
          fk(c, GW);
          short = Math.max(short, Math.hypot(GW[S.an] - d.feet[o], GW[S.an + 1] - d.feet[o + 1]));
        }
        if (short < 0.15) return;
        c.y = Math.min(c.y + short, STAGE_H - 10);
      }
    }

    // Arm IK; if the hand is pulled out of reach, the body leans a little
    // into the reach (bounded, so it never undoes the creator's own posture).
    function reach(c, d, tx, ty) {
      const side = d.side, bend = d.bend[side + "el"];
      solveArm(c, side, tx, ty, d.g, bend);
      if (d.g < 0.7 * BODY.fa) return;
      const eff = (G, o) => effector(d, G, o);
      for (let i = 0; i < 3; i++) {
        fk(c, GW);
        eff(GW, EF);
        if (Math.hypot(EF.x - tx, EF.y - ty) < 2) break;
        ccd(c, ["s3", "s2", "sp"], REACH_W, eff, tx, ty, 1);
        c.sp = norm(d.start.sp + clamp(angDelta(d.start.sp, c.sp), -0.45, 0.45));
        c.s2 = clamp(c.s2, d.start.s2 - 0.35, d.start.s2 + 0.35);
        c.s3 = clamp(c.s3, d.start.s3 - 0.35, d.start.s3 + 0.35);
        solveArm(c, side, tx, ty, d.g, bend);
      }
    }

    // Hips follow the finger with the feet planted; once a leg can't reach
    // its foot any more, the whole figure comes along.
    function moveHips(c, d, tx, ty) {
      const F = d.feet, maxReach = BODY.th + BODY.sh - 0.6;
      const ox = c.x, oy = c.y;
      c.x = tx;
      c.y = ty;
      fk(c, GW);
      const okL = Math.hypot(GW[LHP] - F[0], GW[LHP + 1] - F[1]) <= maxReach;
      const okR = Math.hypot(GW[RHP] - F[2], GW[RHP + 1] - F[3]) <= maxReach;
      if (okL && okR) {
        solveLeg(c, "l", F[0], F[1], BODY.sh, d.bend.lkn);
        solveLeg(c, "r", F[2], F[3], BODY.sh, d.bend.rkn);
      } else {
        const dx = tx - ox, dy = ty - oy;
        F[0] += dx; F[1] += dy; F[2] += dx; F[3] += dy;
      }
    }

    function endDrag(commit) {
      if (!drag) return;
      const d = drag;
      drag = null;
      try { canvas.releasePointerCapture(d.pointerId); } catch (err) { /* already released */ }
      canvas.style.cursor = "";
      if (commit) commitPoseEdit(d.before);
      else syncEdit();
      dirty = true;
    }

    ctx.listen(canvas, "pointerdown", (e) => {
      if (e.button !== undefined && e.button > 0) return;
      closePopover();
      if (playing) {
        pause();
        e.preventDefault();
        return;
      }
      if (drag) return; // one finger poses at a time
      if (beginDrag(e)) e.preventDefault();
    });

    ctx.listen(canvas, "pointermove", (e) => {
      if (drag) {
        if (e.pointerId !== drag.pointerId) return;
        const p = toLocal(e);
        drag.moved = Math.max(drag.moved, Math.hypot(p.x - drag.x0, p.y - drag.y0));
        applyDrag(toWorld(p));
        e.preventDefault();
        return;
      }
      if (e.pointerType === "mouse" && !playing) {
        lastPointerType = "mouse";
        const h = pick(toWorld(toLocal(e)));
        const next = h ? { ci: h.ci, parts: dragKind(h).parts } : null;
        const same = next && hover && next.ci === hover.ci && next.parts.join() === hover.parts.join();
        if (!same && (next || hover)) {
          hover = next;
          canvas.style.cursor = next ? "grab" : "";
          dirty = true;
        }
      }
    });

    const finishPointer = (commit) => (e) => {
      if (drag && e.pointerId === drag.pointerId) endDrag(commit);
    };
    ctx.listen(canvas, "pointerup", finishPointer(true));
    ctx.listen(canvas, "pointercancel", finishPointer(true));
    ctx.listen(canvas, "lostpointercapture", finishPointer(true));
    ctx.listen(canvas, "pointerleave", (e) => {
      if (!drag && hover && e.pointerType === "mouse") {
        hover = null;
        dirty = true;
      }
    });
    ctx.listen(canvas, "contextmenu", (e) => e.preventDefault());

    // ───────────────────────────────────────────── 8. Timeline + controls UI

    const THUMB_W = 46, THUMB_H = 60, THUMB_GAP = 8, STRIP_PAD = 16;
    const PITCH = THUMB_W + THUMB_GAP;

    const ICON = {
      menu: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>',
      undo: '<svg viewBox="0 0 24 24" class="st"><path d="M9 7 4.5 11.5 9 16"/><path d="M5 11.5h9.5a5 5 0 0 1 0 10H11"/></svg>',
      redo: '<svg viewBox="0 0 24 24" class="st"><path d="m15 7 4.5 4.5L15 16"/><path d="M19 11.5H9.5a5 5 0 0 0 0 10H13"/></svg>',
      play: '<svg viewBox="0 0 24 24"><path d="M8 5.6v12.8a1 1 0 0 0 1.5.86l10.4-6.4a1 1 0 0 0 0-1.72L9.5 4.74A1 1 0 0 0 8 5.6Z"/></svg>',
      pause: '<svg viewBox="0 0 24 24"><rect x="6.5" y="5" width="4" height="14" rx="1.3"/><rect x="13.5" y="5" width="4" height="14" rx="1.3"/></svg>',
      restart: '<svg viewBox="0 0 24 24" class="st"><path d="M4.5 12a7.5 7.5 0 1 0 2.4-5.5"/><path d="M4.5 4.5v4h4"/></svg>',
      ghost: '<svg viewBox="0 0 24 24" class="st"><circle cx="9" cy="7" r="3" opacity=".45"/><path d="M9 10v6m0-4-3 2m3-2 3 2m-3 2-2.5 4M9 16l2.5 4" opacity=".45"/><circle cx="15" cy="6" r="3"/><path d="M15 9v6m0-4-3.2 1.2M15 11l3.4-1.6M15 15l-2 4.5m2-4.5 3 4"/></svg>',
      loop: '<svg viewBox="0 0 24 24" class="st"><path d="M17 3.5 20 6.5l-3 3"/><path d="M4 11.5v-1a4 4 0 0 1 4-4h12"/><path d="M7 20.5 4 17.5l3-3"/><path d="M20 12.5v1a4 4 0 0 1-4 4H4"/></svg>',
      plus: '<svg viewBox="0 0 24 24" class="st"><path d="M12 5v14M5 12h14"/></svg>',
      left: '<svg viewBox="0 0 24 24" class="st"><path d="m14.5 6-6 6 6 6"/></svg>',
      right: '<svg viewBox="0 0 24 24" class="st"><path d="m9.5 6 6 6-6 6"/></svg>',
      copy: '<svg viewBox="0 0 24 24" class="st"><rect x="8.5" y="8.5" width="11" height="11" rx="2.5"/><path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2"/></svg>',
      trash: '<svg viewBox="0 0 24 24" class="st"><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/></svg>',
      hold: '<svg viewBox="0 0 24 24" class="st"><circle cx="12" cy="13" r="7"/><path d="M12 9.5V13l2.5 2M10 3.5h4"/></svg>'
    };

    const hud = ctx.createRoot({ layer: "overlay", input: "passthrough", className: "mi-root" });
    hud.innerHTML =
      "<style>" +
      ".mi-root{font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:" + COLOR.ink + ";-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent}" +
      ".mi-root *{box-sizing:border-box}" +
      ":where(.mi-root) :where(button){font:inherit;color:inherit;border:0;background:none;padding:0;margin:0;cursor:pointer;pointer-events:auto;-webkit-tap-highlight-color:transparent;touch-action:manipulation}" +
      ".mi-root button:focus-visible{outline:2px solid " + COLOR.ink + ";outline-offset:2px}" +
      ":where(.mi-root) :where(svg){width:22px;height:22px;fill:currentColor;display:block}" +
      ".mi-root svg.st{fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}" +
      ".mi-top{position:absolute;left:0;right:0;top:0;display:flex;align-items:center;gap:6px;padding:0 12px;height:52px;pointer-events:none}" +
      ".mi-ib{width:44px;height:44px;border-radius:22px;display:grid;place-items:center;color:" + COLOR.ink + ";transition:opacity .15s,background .15s}" +
      ".mi-ib:active{background:rgba(255,255,255,.08)}" +
      ".mi-ib[aria-disabled=true]{opacity:.28;cursor:default}" +
      ".mi-grow{flex:1}" +
      ".mi-status{font-size:12px;color:" + COLOR.muted + ";letter-spacing:.02em;opacity:0;transition:opacity .4s}" +
      ".mi-status.on{opacity:1}" +
      ".mi-speed{height:32px;min-width:46px;padding:0 12px;border-radius:16px;font-size:13px;font-weight:600;color:" + COLOR.ink + ";background:#15171D;font-variant-numeric:tabular-nums}" +
      ".mi-toast{position:absolute;left:50%;top:60px;transform:translate(-50%,-6px);max-width:calc(100% - 48px);padding:9px 14px;border-radius:14px;background:#16181E;color:" + COLOR.ink + ";font-size:13px;line-height:1.3;text-align:center;opacity:0;transition:opacity .25s,transform .25s;pointer-events:none}" +
      ".mi-toast.on{opacity:1;transform:translate(-50%,0)}" +
      ".mi-bottom{position:absolute;left:0;right:0;bottom:0;background:" + COLOR.bg + ";border-top:1px solid #16181E;pointer-events:auto}" +
      ".mi-tlhead{display:flex;align-items:baseline;justify-content:space-between;padding:10px 16px 0;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:" + COLOR.muted + "}" +
      ".mi-tlhead b{color:" + COLOR.ink + ";font-weight:600}" +
      ".mi-strip{position:relative;overflow-x:auto;overflow-y:hidden;-webkit-overflow-scrolling:touch;scrollbar-width:none;touch-action:pan-x;padding:8px 0 10px}" +
      ".mi-strip::-webkit-scrollbar{display:none}" +
      ".mi-track{position:relative;display:flex;gap:" + THUMB_GAP + "px;padding:0 " + STRIP_PAD + "px;width:max-content}" +
      ".mi-th{position:relative;flex:0 0 auto;width:" + THUMB_W + "px;height:" + THUMB_H + "px;border-radius:10px;background:#111318;box-shadow:inset 0 0 0 1px #1D2027;cursor:pointer;transition:box-shadow .15s,transform .18s;pointer-events:auto}" +
      ".mi-th svg{width:100%;height:100%;border-radius:10px}" +
      ".mi-th.sel{box-shadow:inset 0 0 0 2px " + COLOR.ink + "}" +
      ".mi-th.lift{transition:box-shadow .15s;z-index:2;box-shadow:inset 0 0 0 2px " + COLOR.ink + ",0 8px 18px rgba(0,0,0,.6);transform:scale(1.08)}" +
      ".mi-th.flash{animation:mi-pop .32s ease-out}" +
      "@keyframes mi-pop{0%{transform:scale(.7);opacity:.2}70%{transform:scale(1.06)}100%{transform:scale(1);opacity:1}}" +
      ".mi-th i{position:absolute;left:5px;bottom:3px;font-style:normal;font-size:9px;font-weight:600;color:" + COLOR.muted + "}" +
      ".mi-th.sel i{color:" + COLOR.ink + "}" +
      ".mi-th u{position:absolute;right:5px;bottom:4px;display:flex;gap:2px;text-decoration:none}" +
      ".mi-th u s{width:4px;height:4px;border-radius:2px;background:" + COLOR.ink + ";opacity:.75}" +
      ".mi-ph{position:absolute;bottom:3px;left:0;width:14px;height:3px;border-radius:2px;background:" + COLOR.ink + ";opacity:0;transition:opacity .2s;pointer-events:none}" +
      ".mi-ph.on{opacity:.9}.mi-ph.dim{opacity:.35}" +
      ".mi-controls{display:flex;align-items:center;justify-content:center;gap:10px;padding:2px 16px 10px}" +
      ".mi-tg{width:44px;height:44px;border-radius:22px;display:grid;place-items:center;color:" + COLOR.muted + ";transition:color .15s,background .15s,opacity .15s}" +
      ".mi-tg[aria-pressed=true]{color:" + COLOR.ink + ";background:#181B22}" +
      ".mi-tg[aria-disabled=true]{opacity:.28;cursor:default}" +
      ".mi-play{width:62px;height:62px;border-radius:31px;display:grid;place-items:center;background:" + COLOR.ink + ";color:" + COLOR.bg + ";margin:0 4px;transition:transform .12s}" +
      ".mi-play:active{transform:scale(.94)}.mi-play svg{width:28px;height:28px}" +
      ".mi-add{height:44px;padding:0 16px 0 12px;border-radius:22px;display:flex;align-items:center;gap:6px;font-size:14px;font-weight:600;color:" + COLOR.ink + ";box-shadow:inset 0 0 0 1.5px rgba(242,243,246,.55);transition:opacity .15s,background .15s}" +
      ".mi-add:active{background:rgba(255,255,255,.08)}" +
      ".mi-add[aria-disabled=true]{opacity:.28;cursor:default}" +
      ".mi-pop{position:absolute;display:none;gap:2px;padding:4px;border-radius:16px;background:#16181E;box-shadow:0 10px 30px rgba(0,0,0,.55);pointer-events:auto;z-index:5}" +
      ".mi-pop.on{display:flex}" +
      ".mi-pop button{height:40px;min-width:40px;padding:0 10px;border-radius:12px;display:flex;align-items:center;justify-content:center;gap:5px;font-size:12.5px;font-weight:600}" +
      ".mi-pop button:active{background:rgba(255,255,255,.08)}" +
      ".mi-pop button[aria-disabled=true]{opacity:.28;cursor:default}" +
      ".mi-pop svg{width:18px;height:18px}" +
      ".mi-scrim{position:absolute;inset:0;display:none;align-items:flex-end;justify-content:center;background:rgba(4,5,7,.6);pointer-events:auto;z-index:10}" +
      ".mi-scrim.on{display:flex}" +
      ".mi-sheet{width:min(100%,440px);margin:0 10px;padding:18px 16px 16px;border-radius:22px;background:#121419;box-shadow:0 -8px 40px rgba(0,0,0,.5)}" +
      ".mi-sheet h3{margin:0 0 6px;font-size:16px;font-weight:650}" +
      ".mi-sheet p{margin:0 0 14px;font-size:13.5px;line-height:1.4;color:#A6AAB4}" +
      ".mi-row{display:flex;gap:10px}" +
      ".mi-btn{flex:1;height:48px;border-radius:14px;font-size:14.5px;font-weight:600;background:#1C1F26;display:flex;align-items:center;justify-content:center}" +
      ".mi-btn.pri{background:" + COLOR.ink + ";color:" + COLOR.bg + "}" +
      ".mi-btn:active{opacity:.85}" +
      ".mi-item{width:100%;height:52px;border-radius:14px;display:flex;align-items:center;gap:12px;padding:0 12px;font-size:15px;text-align:left}" +
      ".mi-item:active{background:rgba(255,255,255,.06)}" +
      ".mi-item small{display:block;font-size:12px;color:" + COLOR.muted + ";font-weight:400}" +
      ".mi-bar{height:4px;border-radius:2px;background:#22252D;overflow:hidden;margin:4px 0 16px}" +
      ".mi-bar i{display:block;height:100%;width:0;background:" + COLOR.ink + "}" +
      ".mi-gif{display:block;width:100%;max-height:46vh;object-fit:contain;border-radius:14px;background:" + COLOR.bg + ";margin:0 0 12px;-webkit-touch-callout:default;pointer-events:auto}" +
      "</style>" +
      '<div class="mi-top">' +
      '<button class="mi-ib" data-a="menu" aria-label="Menu">' + ICON.menu + "</button>" +
      '<span class="mi-status" aria-live="polite"></span>' +
      '<span class="mi-grow"></span>' +
      '<button class="mi-speed" data-a="speed" aria-label="Playback speed">1×</button>' +
      '<button class="mi-ib" data-a="undo" aria-label="Undo">' + ICON.undo + "</button>" +
      '<button class="mi-ib" data-a="redo" aria-label="Redo">' + ICON.redo + "</button>" +
      "</div>" +
      '<div class="mi-toast" role="status"></div>' +
      '<div class="mi-bottom">' +
      '<div class="mi-tlhead"><span class="mi-count"></span><span class="mi-tip"></span></div>' +
      '<div class="mi-strip"><div class="mi-track"></div><div class="mi-ph"></div></div>' +
      '<div class="mi-controls">' +
      '<button class="mi-tg" data-a="ghost" aria-label="Show previous pose">' + ICON.ghost + "</button>" +
      '<button class="mi-ib" data-a="restart" aria-label="Play from the start">' + ICON.restart + "</button>" +
      '<button class="mi-play" data-a="play" aria-label="Play">' + ICON.play + "</button>" +
      '<button class="mi-add" data-a="add" aria-label="Add pose">' + ICON.plus + "<span>Pose</span></button>" +
      '<button class="mi-tg" data-a="loop" aria-label="Loop">' + ICON.loop + "</button>" +
      "</div></div>" +
      '<div class="mi-pop" role="menu">' +
      '<button data-p="left" aria-label="Move earlier">' + ICON.left + "</button>" +
      '<button data-p="dup">' + ICON.copy + "Duplicate</button>" +
      '<button data-p="hold">' + ICON.hold + '<span class="mi-holdlabel">Hold</span></button>' +
      '<button data-p="del">' + ICON.trash + "Delete</button>" +
      '<button data-p="right" aria-label="Move later">' + ICON.right + "</button>" +
      "</div>" +
      '<div class="mi-scrim"><div class="mi-sheet"></div></div>';

    const $ = (sel) => hud.querySelector(sel);
    const btn = (a) => hud.querySelector('[data-a="' + a + '"]');
    const topBar = $(".mi-top");
    const bottom = $(".mi-bottom");
    const strip = $(".mi-strip");
    const track = $(".mi-track");
    const playhead = $(".mi-ph");
    const countEl = $(".mi-count");
    const tipEl = $(".mi-tip");
    const statusEl = $(".mi-status");
    const toastEl = $(".mi-toast");
    const pop = $(".mi-pop");
    const scrim = $(".mi-scrim");
    const sheet = $(".mi-sheet");

    let toastToken = 0;
    function toast(msg) {
      const token = ++toastToken;
      toastEl.textContent = msg;
      toastEl.classList.add("on");
      ctx.timeout(() => {
        if (token === toastToken) toastEl.classList.remove("on");
      }, 2200);
    }

    function updateControls() {
      const ed = !playing;
      btn("play").innerHTML = playing ? ICON.pause : ICON.play;
      btn("play").setAttribute("aria-label", playing ? "Pause" : "Play");
      btn("undo").setAttribute("aria-disabled", String(!ed || !undoStack.length));
      btn("redo").setAttribute("aria-disabled", String(!ed || !redoStack.length));
      btn("add").setAttribute("aria-disabled", String(!ed || project.poses.length >= MAX_POSES));
      btn("ghost").setAttribute("aria-pressed", String(project.ghost));
      btn("loop").setAttribute("aria-pressed", String(project.loop));
      btn("speed").textContent = SPEEDS[project.speed] + "×";
      const n = project.poses.length;
      countEl.innerHTML = playing ? "<b>Playing</b>" : "Pose <b>" + (project.sel + 1) + "</b> of " + n;
      tipEl.textContent = playing ? "Tap the stage to pause" : n > 1 ? "Tap selected pose for more" : "Hold a figure to move it";
      updatePlayhead();
    }

    // Keyed thumbnails: only changed poses get new SVG markup.
    const thumbCache = new Map(); // id -> { el, key }
    let lastViewBox = "";
    function renderTimeline(scroll) {
      const vb = thumbViewBox();
      const vbChanged = vb !== lastViewBox;
      lastViewBox = vb;
      const seen = new Set();
      project.poses.forEach((p, i) => {
        let rec = thumbCache.get(p.id);
        if (!rec) {
          const el = document.createElement("div");
          el.className = "mi-th";
          el.setAttribute("role", "button");
          el.tabIndex = 0;
          rec = { el, key: "" };
          thumbCache.set(p.id, rec);
        }
        seen.add(p.id);
        const key = vb + "|" + JSON.stringify(p);
        if (key !== rec.key || vbChanged) {
          rec.key = key;
          rec.el.innerHTML =
            '<svg viewBox="' + vb + '" preserveAspectRatio="xMidYMid meet">' +
            figureSVG(p.a, COLOR.a) + figureSVG(p.b, COLOR.b) + "</svg>" +
            "<i>" + (i + 1) + "</i>" +
            (p.h ? "<u>" + "<s></s>".repeat(p.h) + "</u>" : "");
        } else {
          rec.el.querySelector("i").textContent = String(i + 1);
        }
        rec.el.dataset.id = String(p.id);
        rec.el.dataset.i = String(i);
        rec.el.classList.toggle("sel", i === project.sel);
        rec.el.setAttribute("aria-label", "Pose " + (i + 1) + (i === project.sel ? ", selected" : ""));
        rec.el.style.transform = "";
        if (track.children[i] !== rec.el) track.insertBefore(rec.el, track.children[i] || null);
      });
      for (const [id, rec] of thumbCache) {
        if (!seen.has(id)) {
          rec.el.remove();
          thumbCache.delete(id);
        }
      }
      if (scroll) scrollToThumb(project.sel);
      updatePlayhead();
    }

    function flashThumb(i) {
      const el = track.children[i];
      if (!el) return;
      el.classList.remove("flash");
      void el.offsetWidth;
      el.classList.add("flash");
    }

    function scrollToThumb(i) {
      const left = STRIP_PAD + i * PITCH;
      const vis = strip.clientWidth;
      if (left - 12 < strip.scrollLeft) strip.scrollLeft = Math.max(0, left - 12);
      else if (left + THUMB_W + 12 > strip.scrollLeft + vis) strip.scrollLeft = left + THUMB_W + 12 - vis;
    }

    function updatePlayhead() {
      const showing = playing || playTime > 0;
      if (!showing || project.poses.length < 2) {
        playhead.className = "mi-ph";
        return;
      }
      if (!playing) sample(playTime, play);
      const pos = play.pos;
      const x = STRIP_PAD + pos * PITCH + THUMB_W / 2 - 7;
      playhead.style.transform = "translateX(" + x.toFixed(1) + "px)";
      playhead.className = "mi-ph " + (playing ? "on" : "dim");
      if (playing) {
        const left = x - 40, right = x + 54;
        if (left < strip.scrollLeft || right > strip.scrollLeft + strip.clientWidth) {
          strip.scrollLeft = Math.max(0, x - strip.clientWidth / 2);
        }
      }
    }

    // Pose options popover, opened by tapping the selected thumbnail.
    let popIndex = -1;
    function openPopover(i) {
      popIndex = i;
      const n = project.poses.length;
      pop.querySelector('[data-p="left"]').setAttribute("aria-disabled", String(i === 0));
      pop.querySelector('[data-p="right"]').setAttribute("aria-disabled", String(i === n - 1));
      pop.querySelector('[data-p="del"]').setAttribute("aria-disabled", String(n <= 1));
      const h = project.poses[i].h | 0;
      pop.querySelector(".mi-holdlabel").textContent = h ? "Hold " + "•".repeat(h) : "Hold";
      pop.classList.add("on");
      const th = track.children[i];
      const hr = hud.getBoundingClientRect();
      const tr = th.getBoundingClientRect();
      const pw = pop.offsetWidth, ph = pop.offsetHeight;
      const x = clamp(tr.left - hr.left + tr.width / 2 - pw / 2, 8, hr.width - pw - 8);
      const y = tr.top - hr.top - ph - 10;
      pop.style.left = x + "px";
      pop.style.top = y + "px";
    }

    function closePopover() {
      popIndex = -1;
      pop.classList.remove("on");
    }

    ctx.listen(pop, "click", (e) => {
      const b = e.target.closest("[data-p]");
      if (!b || popIndex < 0 || b.getAttribute("aria-disabled") === "true") return;
      const i = popIndex;
      const a = b.dataset.p;
      if (a === "dup") duplicatePose(i);
      else if (a === "del") deletePose(i);
      else if (a === "left") movePose(i, i - 1);
      else if (a === "right") movePose(i, i + 1);
      else if (a === "hold") {
        cycleHold(i);
        openPopover(i);
      }
    });

    // Thumbnail taps select; tapping the selected one opens its options.
    // Press-and-hold then drag reorders.
    let press = null;
    ctx.listen(strip, "pointerdown", (e) => {
      const el = e.target.closest(".mi-th");
      if (!el || (press && press.active)) return;
      const token = {};
      press = { token, pointerId: e.pointerId, x0: e.clientX, y0: e.clientY, el, from: +el.dataset.i, to: +el.dataset.i, active: false };
      ctx.timeout(() => {
        if (!press || press.token !== token || playing) return;
        press.active = true;
        closePopover();
        el.classList.add("lift");
        try { el.setPointerCapture(press.pointerId); } catch (err) { /* best-effort */ }
        haptic("light");
      }, 380);
    });
    ctx.listen(strip, "pointermove", (e) => {
      if (!press || e.pointerId !== press.pointerId) return;
      const dx = e.clientX - press.x0;
      if (!press.active) {
        if (Math.hypot(dx, e.clientY - press.y0) > 8) press = null;
        return;
      }
      e.preventDefault();
      const n = project.poses.length;
      const to = clamp(press.from + Math.round(dx / PITCH), 0, n - 1);
      press.to = to;
      for (let k = 0; k < n; k++) {
        const el = track.children[k];
        if (k === press.from) el.style.transform = "translateX(" + dx + "px) scale(1.08)";
        else if (k > press.from && k <= to) el.style.transform = "translateX(" + -PITCH + "px)";
        else if (k < press.from && k >= to) el.style.transform = "translateX(" + PITCH + "px)";
        else el.style.transform = "";
      }
    });
    const endPress = (commit) => (e) => {
      if (!press || e.pointerId !== press.pointerId) return;
      const p = press;
      press = null;
      if (!p.active) {
        if (commit) tapThumb(p.from);
        return;
      }
      p.el.classList.remove("lift");
      if (commit && p.to !== p.from) movePose(p.from, p.to);
      else renderTimeline(false);
    };
    ctx.listen(strip, "pointerup", endPress(true));
    ctx.listen(strip, "pointercancel", endPress(false));
    ctx.listen(strip, "touchmove", (e) => {
      if (press && press.active) e.preventDefault();
    }, { passive: false });
    ctx.listen(strip, "contextmenu", (e) => e.preventDefault());
    ctx.listen(strip, "scroll", () => {
      if (popIndex >= 0) closePopover();
    });
    // Taps are handled on pointerup rather than click: some mobile
    // WebViews drop synthesized clicks right after another gesture.
    function tapThumb(i) {
      if (i < 0 || i >= project.poses.length) return;
      if (playing) {
        selectPose(i);
        return;
      }
      if (i === project.sel) {
        if (popIndex === i) closePopover();
        else openPopover(i);
      } else {
        selectPose(i);
      }
    }
    ctx.listen(strip, "keydown", (e) => {
      const el = e.target.closest && e.target.closest(".mi-th");
      if (el && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        tapThumb(+el.dataset.i);
      }
    });

    const disabled = (b) => b.getAttribute("aria-disabled") === "true";
    ctx.input.activate(btn("play"), () => togglePlay());
    ctx.input.activate(btn("restart"), () => restart());
    ctx.input.activate(btn("add"), () => { if (!disabled(btn("add"))) addPose(); });
    ctx.input.activate(btn("undo"), () => { if (!disabled(btn("undo"))) undo(); });
    ctx.input.activate(btn("redo"), () => { if (!disabled(btn("redo"))) redo(); });
    ctx.input.activate(btn("ghost"), () => {
      project.ghost = !project.ghost;
      toast(project.ghost ? "Showing the previous pose" : "Previous pose hidden");
      updateControls();
      scheduleSave();
      dirty = true;
    });
    ctx.input.activate(btn("loop"), () => {
      project.loop = !project.loop;
      invalidateSchedule();
      toast(project.loop ? "Looping on" : "Looping off: plays once");
      updateControls();
      scheduleSave();
    });
    ctx.input.activate(btn("speed"), () => {
      // keep the playback position at the same point in the sequence
      const before = getSchedule().total;
      project.speed = (project.speed + 1) % SPEEDS.length;
      invalidateSchedule();
      const after = getSchedule().total;
      if (before > 0) playTime = (playTime / before) * after;
      updateControls();
      scheduleSave();
    });
    ctx.input.activate(btn("menu"), () => openMenu());

    // Sheets: menu, new-animation confirm, export.
    let sheetKind = null;
    function openSheet(kind, html) {
      closePopover();
      sheetKind = kind;
      sheet.innerHTML = html;
      scrim.classList.add("on");
    }
    function closeSheet() {
      if (sheetKind === "export") cancelExport();
      sheetKind = null;
      scrim.classList.remove("on");
      sheet.innerHTML = "";
    }
    ctx.listen(scrim, "click", (e) => {
      if (e.target === scrim) {
        closeSheet();
        return;
      }
      const b = e.target.closest("[data-s]");
      if (!b) return;
      const a = b.dataset.s;
      if (a === "close") closeSheet();
      else if (a === "new") {
        if (isPristine()) {
          closeSheet();
          toast("Already a fresh animation.");
        } else {
          openSheet("confirm",
            "<h3>Start a new animation?</h3>" +
            "<p>This clears your " + project.poses.length + (project.poses.length === 1 ? " pose" : " poses") + ". You can undo right after if you change your mind.</p>" +
            '<div class="mi-row"><button class="mi-btn" data-s="close">Keep this one</button><button class="mi-btn pri" data-s="confirm-new">Start new</button></div>');
        }
      } else if (a === "confirm-new") {
        closeSheet();
        newProject();
      } else if (a === "export") {
        startExport();
      } else if (a === "save-gif") {
        saveGif();
      }
    });

    function openMenu() {
      if (playing) pause();
      openSheet("menu",
        '<button class="mi-item" data-s="export">' + ICON.play + "<span>Export GIF<small>Your animation, looping, no buttons</small></span></button>" +
        '<button class="mi-item" data-s="new">' + ICON.plus + "<span>New animation<small>Start again with two fresh figures</small></span></button>" +
        '<div class="mi-row" style="margin-top:8px"><button class="mi-btn" data-s="close">Close</button></div>');
    }

    ctx.listen(window, "keydown", (e) => {
      if (sheetKind) {
        if (e.key === "Escape") closeSheet();
        return;
      }
      const mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
      } else if (mod && (e.key === "y" || e.key === "Y")) {
        e.preventDefault();
        redo();
      } else if (e.key === " " && !(e.target && e.target.closest && e.target.closest("button"))) {
        e.preventDefault();
        togglePlay();
      } else if (e.key === "Escape") {
        closePopover();
      }
    });

    // Layout: the stage fits the space between the top bar and the timeline.
    function layout() {
      const W = ctx.width || canvas.clientWidth || 390;
      const H = ctx.height || canvas.clientHeight || 844;
      const safe = ctx.safeArea || { top: 0, bottom: 0, left: 0, right: 0 };
      topBar.style.top = (safe.top || 0) + "px";
      topBar.style.paddingLeft = 12 + (safe.left || 0) + "px";
      topBar.style.paddingRight = 12 + (safe.right || 0) + "px";
      toastEl.style.top = (safe.top || 0) + 58 + "px";
      bottom.style.paddingBottom = (safe.bottom || 0) + 6 + "px";
      bottom.style.paddingLeft = (safe.left || 0) + "px";
      bottom.style.paddingRight = (safe.right || 0) + "px";
      const top = (safe.top || 0) + 52;
      const bot = H - bottom.offsetHeight;
      const availH = Math.max(120, bot - top);
      const availW = Math.max(120, W - (safe.left || 0) - (safe.right || 0));
      view.s = Math.min((availW * 0.98) / STAGE_W, (availH * 0.98) / STAGE_H);
      view.ox = (safe.left || 0) + (availW - STAGE_W * view.s) / 2;
      view.oy = top + (availH - STAGE_H * view.s) / 2;
      closePopover();
      dirty = true;
    }

    // ───────────────────────────────────────────── 9. Persistence

    const storageOk = !!(ctx.storage && (!ctx.capabilities || ctx.capabilities.storage !== false));
    let saveToken = 0;
    let saveFailed = false;
    let statusToken = 0;

    function packChar(c) {
      return KEYS.map((k) => round3(c[k]));
    }
    // v1 projects had a two-segment spine with one bend ("ch").
    const V1_KEYS = ["x", "y", "sp", "ch", "hd", "lsh", "lel", "rsh", "rel", "lhp", "lkn", "rhp", "rkn"];
    function unpackChar(arr, version) {
      const keys = version === 1 ? V1_KEYS : KEYS;
      if (!Array.isArray(arr) || arr.length !== keys.length) return null;
      const o = {};
      for (let i = 0; i < keys.length; i++) {
        const v = Number(arr[i]);
        if (!Number.isFinite(v)) return null;
        o[keys[i]] = v;
      }
      if (version === 1) o.s2 = o.s3 = o.ch / 2;
      const c = {};
      for (const k of KEYS) c[k] = k === "x" || k === "y" ? clamp(o[k], -STAGE_W, STAGE_W * 2) : norm(o[k]);
      for (const k in LIMIT) c[k] = clamp(c[k], -LIMIT[k], LIMIT[k]);
      return c;
    }

    function serialize() {
      return {
        v: 2,
        sel: project.sel,
        speed: project.speed,
        loop: project.loop,
        ghost: project.ghost,
        poses: project.poses.map((p) => ({ h: p.h | 0, a: packChar(p.a), b: packChar(p.b) }))
      };
    }

    function load() {
      if (!storageOk) return false;
      let data = null;
      try {
        data = ctx.storage.get(STORAGE_KEY);
      } catch (err) {
        return false;
      }
      if (!data || (data.v !== 1 && data.v !== 2) || !Array.isArray(data.poses) || !data.poses.length) return false;
      const poses = [];
      for (const raw of data.poses.slice(0, MAX_POSES)) {
        const a = raw && unpackChar(raw.a, data.v), b = raw && unpackChar(raw.b, data.v);
        if (!a || !b) return false;
        poses.push({ id: nextId++, h: clamp(raw.h | 0, 0, HOLDS.length - 1), a, b });
      }
      project.poses = poses;
      project.sel = clamp(data.sel | 0, 0, poses.length - 1);
      project.speed = clamp(Number.isInteger(data.speed) ? data.speed : 2, 0, SPEEDS.length - 1);
      project.loop = data.loop !== false;
      project.ghost = data.ghost !== false;
      syncEdit();
      return true;
    }

    function scheduleSave() {
      if (!storageOk) return;
      const token = ++saveToken;
      ctx.timeout(() => {
        if (token !== saveToken) return;
        saveNow();
      }, 250);
    }

    function saveNow() {
      try {
        ctx.storage.set(STORAGE_KEY, serialize());
        if (saveFailed) saveFailed = false;
        showStatus("Saved");
      } catch (err) {
        if (!saveFailed) {
          saveFailed = true;
          toast("Couldn't save on this device. Keep this open to keep working.");
        }
        showStatus("Not saved");
      }
    }

    function showStatus(text) {
      const token = ++statusToken;
      statusEl.textContent = text;
      statusEl.classList.add("on");
      ctx.timeout(() => {
        if (token === statusToken && !saveFailed) statusEl.classList.remove("on");
      }, 1400);
    }

    // ───────────────────────────────────────────── 10. GIF export

    const EXPORT_W = 360;
    const EXPORT_H = Math.round((EXPORT_W * STAGE_H) / STAGE_W / 2) * 2;
    const EXPORT_FPS = 25;
    let exportJob = null;
    let gifUrl = null;
    let gifBlob = null;

    function cancelExport() {
      if (exportJob) exportJob.cancelled = true;
      exportJob = null;
    }

    function revokeGif() {
      if (gifUrl) URL.revokeObjectURL(gifUrl);
      gifUrl = null;
      gifBlob = null;
    }

    async function startExport() {
      if (typeof OffscreenCanvas === "undefined") {
        openSheet("export", "<h3>Export isn't available here</h3><p>This browser can't render the GIF off-screen. Your animation is still saved on this device.</p>" +
          '<div class="mi-row"><button class="mi-btn" data-s="close">OK</button></div>');
        return;
      }
      cancelExport();
      revokeGif();
      const job = { cancelled: false };
      exportJob = job;
      openSheet("export", '<h3>Making your GIF…</h3><p class="mi-prog">Rendering frames</p><div class="mi-bar"><i></i></div>' +
        '<div class="mi-row"><button class="mi-btn" data-s="close">Cancel</button></div>');
      const bar = sheet.querySelector(".mi-bar i");
      const prog = sheet.querySelector(".mi-prog");
      try {
        const bytes = await encodeAnimation(job, (f) => {
          bar.style.width = Math.round(f * 100) + "%";
          prog.textContent = "Rendering frames · " + Math.round(f * 100) + "%";
        });
        if (job.cancelled || exportJob !== job) return;
        exportJob = null;
        gifBlob = new Blob([bytes], { type: "image/gif" });
        gifUrl = URL.createObjectURL(gifBlob);
        const kb = Math.max(1, Math.round(gifBlob.size / 1024));
        openSheet("done",
          '<img class="mi-gif" alt="Your animation" src="' + gifUrl + '">' +
          "<p>" + EXPORT_W + "×" + EXPORT_H + " GIF · " + kb + " KB. If saving doesn't start, press and hold the image.</p>" +
          '<div class="mi-row"><button class="mi-btn" data-s="close">Close</button><button class="mi-btn pri" data-s="save-gif">Save GIF</button></div>');
        interact("export_gif");
      } catch (err) {
        if (job.cancelled) return;
        exportJob = null;
        ctx.platform.error({ stage: "gif_export", message: String((err && err.message) || err) });
        openSheet("export", "<h3>Export didn't work</h3><p>Something went wrong while rendering. Your animation is safe. Try again in a moment.</p>" +
          '<div class="mi-row"><button class="mi-btn" data-s="close">OK</button></div>');
      }
    }

    async function saveGif() {
      if (!gifBlob) return;
      const name = "move-it-" + new Date().toISOString().slice(0, 10) + ".gif";
      const coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
      try {
        if (coarse && typeof File === "function" && navigator.canShare) {
          const file = new File([gifBlob], name, { type: "image/gif" });
          if (navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file], title: "Move it" });
            return;
          }
        }
      } catch (err) {
        if (err && err.name === "AbortError") return;
      }
      const a = document.createElement("a");
      a.href = gifUrl;
      a.download = name;
      a.style.display = "none";
      hud.appendChild(a);
      a.click();
      a.remove();
    }

    // Renders the animation off-screen frame by frame, with the same base
    // sampling and secondary motion as on-screen playback, and streams it into
    // a GIF89a encoder. Looping animations run one silent lap first so the
    // springs are already in their looping rhythm and the GIF loops cleanly.
    async function encodeAnimation(job, onProgress) {
      const W = EXPORT_W, H = EXPORT_H;
      const off = new OffscreenCanvas(W, H);
      const c2 = off.getContext("2d", { willReadFrequently: true });
      const S = getSchedule();
      const tail = S.loop ? 0 : 0.6;
      const frameCount = clamp(Math.ceil((S.total + tail) * EXPORT_FPS), 1, 1800);
      const dt = 1 / EXPORT_FPS;
      const pal = buildPalette();
      const gif = gifWriter(W, H, pal.rgb);
      const base = { a: cloneChar(edit.a), b: cloneChar(edit.b), pos: 0 };
      const mo = [makeMotion(), makeMotion()];
      const shown = [cloneChar(edit.a), cloneChar(edit.b)];
      const an = [{ x: 0, y: 0 }, { x: 0, y: 0 }];
      const G = new Float64Array(GLEN), B = makeBody();
      const step = (t) => {
        sample(t, base);
        for (let ci = 0; ci < 2; ci++) {
          anticipation(S, ci, wrapTime(S, t), an[ci]);
          stepMotion(mo[ci], ci ? base.b : base.a, dt, shown[ci], an[ci], NOFREEZE);
        }
      };
      if (S.loop) for (let f = 0; f < frameCount; f++) step(f * dt);
      const scale = W / STAGE_W;
      const indices = new Uint8Array(W * H);
      for (let f = 0; f < frameCount; f++) {
        if (job.cancelled) throw new Error("cancelled");
        step(f * dt);
        c2.setTransform(1, 0, 0, 1, 0, 0);
        c2.fillStyle = COLOR.bg;
        c2.fillRect(0, 0, W, H);
        c2.setTransform(scale, 0, 0, scale, 0, 0);
        for (let ci = 0; ci < 2; ci++) {
          fillParts(c2, buildBody(fk(shown[ci], G, mo[ci].q), B, mo[ci].ws), PART_NAMES, ci ? COLOR.b : COLOR.a);
        }
        const px = c2.getImageData(0, 0, W, H).data;
        for (let i = 0, p = 0; i < indices.length; i++, p += 4) {
          indices[i] = pal.lookup(px[p], px[p + 1], px[p + 2]);
        }
        gif.frame(indices, 4);
        if (f % 3 === 2) {
          onProgress((f + 1) / frameCount);
          await new Promise((r) => ctx.timeout(r, 0));
        }
      }
      onProgress(1);
      return gif.finish();
    }

    // 32-colour palette: background, both character colours and the
    // antialiasing blends between them.
    function buildPalette() {
      const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
      const bg = hex(COLOR.bg), A = hex(COLOR.a), Bc = hex(COLOR.b);
      const mix = (x, y, t) => x.map((v, i) => Math.round(v + (y[i] - v) * t));
      const cols = [bg];
      for (let i = 1; i <= 12; i++) cols.push(mix(bg, A, i / 12));
      for (let i = 1; i <= 12; i++) cols.push(mix(bg, Bc, i / 12));
      for (const t of [0.2, 0.4, 0.6, 0.8]) cols.push(mix(A, Bc, t));
      while (cols.length < 32) cols.push(bg);
      const rgb = new Uint8Array(96);
      cols.forEach((c, i) => rgb.set(c, i * 3));
      const cache = new Uint8Array(32768).fill(255);
      return {
        rgb,
        lookup(r, gg, b) {
          const key = ((r >> 3) << 10) | ((gg >> 3) << 5) | (b >> 3);
          let idx = cache[key];
          if (idx !== 255) return idx;
          let best = 0, bestD = Infinity;
          for (let i = 0; i < 29; i++) {
            const c = cols[i];
            const d = (c[0] - r) * (c[0] - r) + (c[1] - gg) * (c[1] - gg) + (c[2] - b) * (c[2] - b);
            if (d < bestD) { bestD = d; best = i; }
          }
          cache[key] = best;
          return best;
        }
      };
    }

    function gifWriter(W, H, paletteRGB) {
      let buf = new Uint8Array(1 << 16);
      let n = 0;
      const byte = (b) => {
        if (n >= buf.length) {
          const nb = new Uint8Array(buf.length * 2);
          nb.set(buf);
          buf = nb;
        }
        buf[n++] = b;
      };
      const u16 = (v) => { byte(v & 255); byte((v >> 8) & 255); };
      const str = (s) => { for (let i = 0; i < s.length; i++) byte(s.charCodeAt(i)); };
      str("GIF89a");
      u16(W); u16(H);
      byte(0xf4); // global colour table, 8-bit resolution, 32 entries
      byte(0); byte(0);
      for (let i = 0; i < paletteRGB.length; i++) byte(paletteRGB[i]);
      byte(0x21); byte(0xff); byte(11); str("NETSCAPE2.0"); byte(3); byte(1); u16(0); byte(0);

      const MIN = 5;
      const table = new Int16Array(4096 * 32);

      function frame(indices, delayCs) {
        byte(0x21); byte(0xf9); byte(4); byte(0x04); u16(delayCs); byte(0); byte(0);
        byte(0x2c); u16(0); u16(0); u16(W); u16(H); byte(0);
        byte(MIN);
        // LZW, packed LSB-first into 255-byte sub-blocks.
        const CLEAR = 1 << MIN, EOI = CLEAR + 1;
        let codeSize = MIN + 1, next = EOI + 1;
        let cur = 0, bits = 0;
        let blockStart = n;
        byte(0);
        const emit = (code) => {
          cur |= code << bits;
          bits += codeSize;
          while (bits >= 8) {
            byte(cur & 255);
            cur >>>= 8;
            bits -= 8;
            if (n - blockStart - 1 === 255) {
              buf[blockStart] = 255;
              blockStart = n;
              byte(0);
            }
          }
        };
        table.fill(-1);
        emit(CLEAR);
        let prefix = indices[0];
        for (let i = 1; i < indices.length; i++) {
          const k = indices[i];
          const key = prefix * 32 + k;
          const code = table[key];
          if (code >= 0) {
            prefix = code;
            continue;
          }
          emit(prefix);
          if (next === 4096) {
            emit(CLEAR);
            table.fill(-1);
            codeSize = MIN + 1;
            next = EOI + 1;
          } else {
            if (next >= 1 << codeSize) codeSize++;
            table[key] = next++;
          }
          prefix = k;
        }
        emit(prefix);
        emit(EOI);
        if (bits > 0) {
          byte(cur & 255);
          if (n - blockStart - 1 === 255) {
            buf[blockStart] = 255;
            blockStart = n;
            byte(0);
          }
        }
        const len = n - blockStart - 1;
        if (len > 0) {
          buf[blockStart] = len;
          byte(0);
        } else {
          buf[blockStart] = 0;
        }
      }

      function finish() {
        byte(0x3b);
        return buf.slice(0, n);
      }
      return { frame, finish };
    }

    // ───────────────────────────────────────────── Platform glue + startup

    function haptic(kind) {
      if (ctx.capabilities && ctx.capabilities.haptics) {
        try { ctx.platform.haptic(kind); } catch (err) { /* optional */ }
      }
    }

    function interact(type) {
      try { ctx.platform.interact({ type }); } catch (err) { /* analytics only */ }
    }

    load();
    renderTimeline(true);
    updateControls();
    ctx.onResize(() => {
      layout();
      renderTimeline(false);
    }, { immediate: true });
    layout();

    let frozen = false; // test harness only
    ctx.game.loop({
      update(dtMs) {
        if (frozen) return;
        const dt = Math.min(dtMs, 100) / 1000;
        advancePlayback(dt);
        // secondary motion keeps stepping until the bodies have settled
        if (playing || drag || dirty || activity > 0.02) {
          stepAll(dt);
          dirty = true;
        }
      },
      render() {
        if (!dirty || frozen) return;
        dirty = false;
        render();
      }
    });

    stepAll(0);
    render();

    // Read-only inspection for the local test harness; inert in Plethora.
    if (ctx.__testHooks) {
      const named = (G, name, out) => {
        const S = SIDE[name[0]] || SIDE.l;
        const mid = (a, b) => { out.x = (G[a] + G[b]) / 2; out.y = (G[a + 1] + G[b + 1]) / 2; return out; };
        const at = (a) => { out.x = G[a]; out.y = G[a + 1]; return out; };
        switch (name) {
          case "head": return at(HC);
          case "neck": return at(S3);
          case "pelvis": return at(P0);
          case "belly": return spinePoint(G, 0.3, out);
          case "chest": return spinePoint(G, 0.78, out);
        }
        switch (name.slice(1)) {
          case "hand": return at(S.wr);
          case "elbow": return at(S.el);
          case "shoulder": return at(S.sh);
          case "uarm": return mid(S.sh, S.el);
          case "farm": return mid(S.el, S.wr);
          case "thigh": return mid(S.hp, S.kn);
          case "shin": return mid(S.kn, S.an);
          case "knee": return at(S.kn);
          case "foot": return at(S.an);
          case "hip": return at(S.hp);
        }
        throw new Error("unknown point " + name);
      };
      const tmp = new Float64Array(GLEN);
      ctx.__testHooks.moveIt = {
        // screen position of a named spot on the editable pose
        joint(ci, name) {
          const o = named(fk(ci ? edit.b : edit.a, tmp), name, { x: 0, y: 0 });
          const r = canvas.getBoundingClientRect();
          return { x: r.left + view.ox + o.x * view.s, y: r.top + view.oy + o.y * view.s };
        },
        // world position on the body as currently displayed (with motion)
        shown(ci, name) {
          return named(fk(disp[ci], tmp, motion[ci].q), name, { x: 0, y: 0 });
        },
        state() {
          return JSON.parse(JSON.stringify({ poses: project.poses, sel: project.sel, playing, playTime, edit, undo: undoStack.length, redo: redoStack.length, loop: project.loop, activity, total: getSchedule().total }));
        },
        playPos() {
          return play.pos;
        },
        // freezes the live loop and renders playback time t (simulated from 0)
        showAt(t, fps) {
          frozen = true;
          playing = false;
          const S = getSchedule();
          const base = { a: cloneChar(edit.a), b: cloneChar(edit.b), pos: 0 };
          resetMotions();
          const dt = 1 / (fps || 60);
          for (let tt = dt; tt <= t + 1e-9; tt += dt) {
            sample(tt, base);
            for (let ci = 0; ci < 2; ci++) {
              anticipation(S, ci, wrapTime(S, tt), anticNow[ci]);
              stepMotion(motion[ci], ci ? base.b : base.a, dt, disp[ci], anticNow[ci], NOFREEZE);
            }
          }
          playing = true; // hides editing feedback and the ghost
          render();
          playing = false;
        },
        scale() {
          return view.s;
        },
        // Deterministic playback simulation with an arbitrary frame-time
        // sequence; returns displayed body measurements per frame.
        trace(dts, names) {
          const S = getSchedule();
          const base = { a: cloneChar(edit.a), b: cloneChar(edit.b), pos: 0 };
          const mo = [makeMotion(), makeMotion()], shown = [cloneChar(edit.a), cloneChar(edit.b)];
          const an = [{ x: 0, y: 0 }, { x: 0, y: 0 }];
          const G = new Float64Array(GLEN);
          const frames = [];
          let t = 0;
          for (const dt of dts) {
            t += dt;
            sample(t, base);
            const fr = { t, pos: base.pos, ch: [] };
            for (let ci = 0; ci < 2; ci++) {
              anticipation(S, ci, wrapTime(S, t), an[ci]);
              stepMotion(mo[ci], ci ? base.b : base.a, dt, shown[ci], an[ci], NOFREEZE);
              fk(shown[ci], G, mo[ci].q);
              const pts = {};
              for (const n of names) pts[n] = named(G, n, { x: 0, y: 0 });
              const len = (a, b) => Math.hypot(G[a] - G[b], G[a + 1] - G[b + 1]);
              pts.bones = [len(LSH, LEL), len(LEL, LWR), len(RSH, REL), len(REL, RWR), len(LHP, LKN), len(LKN, LAN), len(RHP, RKN), len(RKN, RAN)];
              pts.spine = len(P0, S1) + len(S1, S2) + len(S2, S3);
              pts.state = cloneChar(shown[ci]);
              pts.base = cloneChar(ci ? base.b : base.a);
              pts.q = mo[ci].q;
              fr.ch.push(pts);
            }
            frames.push(fr);
          }
          return { total: S.total, frames };
        }
      };
    }
    ctx.onDestroy(() => {
      cancelExport();
      revokeGif();
      if (saveToken && storageOk) {
        try { ctx.storage.set(STORAGE_KEY, serialize()); } catch (err) { /* best-effort */ }
      }
    });
    ctx.platform.ready();
  }
};
