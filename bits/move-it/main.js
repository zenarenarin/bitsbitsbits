/*
 * Move it — a tiny two-character animation playground for Plethora.
 *
 * Pose two figures, save poses, press play. Everything lives in one file, split
 * into sections that each own one concern:
 *   1. Constants            6. Rendering (canvas + timeline thumbnails)
 *   2. Character geometry   7. Pointer manipulation
 *   3. Project + poses      8. Timeline UI
 *   4. Undo / redo          9. Persistence
 *   5. Playback            10. GIF export
 *
 * Data rule: `project.poses` is the only source of truth for the animation.
 * The canvas shows `edit` (a private copy of the selected pose) while editing,
 * or freshly interpolated `play` characters during playback. Neither is ever
 * shared with a stored pose, and playback never writes back into poses.
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
    const BODY = {
      sp1: 48, sp2: 46, neck: 8, headR: 30,
      ua: 50, fa: 46, th: 58, sh: 54, foot: 15,
      hand: 7.5, limb: 12, torso: 15
    };
    // Character state: pelvis position + joint angles (radians, y-down).
    // sp = lower spine (absolute), ch = upper spine (relative), hd = head
    // (relative to upper spine), arms relative to the upper spine, legs
    // absolute from the pelvis, elbows/knees relative to their parent bone.
    const KEYS = ["x", "y", "sp", "ch", "hd", "lsh", "lel", "rsh", "rel", "lhp", "lkn", "rhp", "rkn"];
    const ANGLE_KEYS = KEYS.slice(2);
    const DEFAULT_BEND = { ch: 1, lel: -1, rel: 1, lkn: -1, rkn: 1 };
    const BASE_TRANSITION = 0.55; // seconds per pose transition at 1×
    const SPEEDS = [0.5, 0.75, 1, 1.5, 2];
    const HOLDS = [0, 0.5, 1, 2]; // extra seconds a pose is held at 1×
    const HISTORY_MAX = 80;
    const STORAGE_KEY = "move-it-project";
    const MAX_POSES = 240;
    const TAU = Math.PI * 2;
    const DEG = Math.PI / 180;
    // Playback-only secondary motion: distal joints start a little later
    // (follow-through) and swing a touch past their target before settling.
    // Keyframes are always reached exactly.
    const LAG = { sp: 0, ch: 0.04, hd: 0.12, lsh: 0.03, lel: 0.1, rsh: 0.03, rel: 0.1, lhp: 0, lkn: 0.06, rhp: 0, rkn: 0.06 };
    const SWING = { sp: 0, ch: 0.03, hd: 0.07, lsh: 0.02, lel: 0.06, rsh: 0.02, rel: 0.06, lhp: 0, lkn: 0.03, rhp: 0, rkn: 0.03 };

    // Joint slots in a Float64Array produced by forward kinematics (x at i, y at i+1).
    const P = 0, CH = 2, NK = 4, HD = 6, LE = 8, LH = 10, RE = 12, RH = 14,
      LK = 16, LA = 18, LT = 20, RK = 22, RA = 24, RT = 26, JLEN = 28;

    // Draggable handles. Segments map a touched bone to the handle that moves it.
    const HANDLES = [
      ["head", HD], ["neck", NK], ["pelvis", P],
      ["lel", LE], ["lhand", LH], ["rel", RE], ["rhand", RH],
      ["lkn", LK], ["lfoot", LA], ["rkn", RK], ["rfoot", RA]
    ];
    const SEGMENTS = [
      [P, CH, "body"], [CH, NK, "body"],
      [NK, LE, "lel"], [LE, LH, "lhand"], [NK, RE, "rel"], [RE, RH, "rhand"],
      [P, LK, "lkn"], [LK, LA, "lfoot"], [LA, LT, "lfoot"],
      [P, RK, "rkn"], [RK, RA, "rfoot"], [RA, RT, "rfoot"]
    ];
    const HANDLE_JOINT = Object.fromEntries(HANDLES);

    const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
    const norm = (a) => {
      a = (a + Math.PI) % TAU;
      if (a < 0) a += TAU;
      return a - Math.PI;
    };
    const angDelta = (from, to) => norm(to - from);
    const ease = (t) => 0.5 - 0.5 * Math.cos(Math.PI * t);
    const round3 = (v) => Math.round(v * 1000) / 1000;

    // ───────────────────────────────────────────── 2. Character geometry

    function makeChar(x, y, d) {
      // d holds absolute angles in degrees, which are easier to author.
      const r = (v) => v * DEG;
      return {
        x, y,
        sp: norm(r(d.spine[0])),
        ch: norm(r(d.spine[1] - d.spine[0])),
        hd: norm(r(d.head - d.spine[1])),
        lsh: norm(r(d.lArm[0] - d.spine[1])),
        lel: norm(r(d.lArm[1] - d.lArm[0])),
        rsh: norm(r(d.rArm[0] - d.spine[1])),
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

    // Forward kinematics: angles → joint positions.
    function fk(c, J) {
      const px = c.x, py = c.y;
      J[P] = px; J[P + 1] = py;
      const a1 = c.sp, a2 = a1 + c.ch, ah = a2 + c.hd;
      const cx = px + BODY.sp1 * Math.cos(a1), cy = py + BODY.sp1 * Math.sin(a1);
      J[CH] = cx; J[CH + 1] = cy;
      const nx = cx + BODY.sp2 * Math.cos(a2), ny = cy + BODY.sp2 * Math.sin(a2);
      J[NK] = nx; J[NK + 1] = ny;
      const hr = BODY.neck + BODY.headR;
      J[HD] = nx + hr * Math.cos(ah); J[HD + 1] = ny + hr * Math.sin(ah);
      limb(J, LE, nx, ny, a2 + c.lsh, c.lel, BODY.ua, BODY.fa);
      limb(J, RE, nx, ny, a2 + c.rsh, c.rel, BODY.ua, BODY.fa);
      let sh = limb(J, LK, px, py, c.lhp, c.lkn, BODY.th, BODY.sh);
      J[LT] = J[LA] + BODY.foot * Math.cos(sh + Math.PI / 2);
      J[LT + 1] = J[LA + 1] + BODY.foot * Math.sin(sh + Math.PI / 2);
      sh = limb(J, RK, px, py, c.rhp, c.rkn, BODY.th, BODY.sh);
      J[RT] = J[RA] + BODY.foot * Math.cos(sh - Math.PI / 2);
      J[RT + 1] = J[RA + 1] + BODY.foot * Math.sin(sh - Math.PI / 2);
      return J;
    }

    // Writes a two-bone limb at slots i (middle joint) and i+2 (end joint).
    function limb(J, i, ox, oy, a1, rel, l1, l2) {
      const mx = ox + l1 * Math.cos(a1), my = oy + l1 * Math.sin(a1);
      const a2 = a1 + rel;
      J[i] = mx; J[i + 1] = my;
      J[i + 2] = mx + l2 * Math.cos(a2); J[i + 3] = my + l2 * Math.sin(a2);
      return a2;
    }

    // Two-bone inverse kinematics. `bend` (+1/-1) picks which side the middle
    // joint sits on; it is captured at drag start so limbs never flip mid-drag.
    // Out-of-reach targets straighten the limb towards the target.
    const ikOut = { a1: 0, a2: 0 };
    function ik2(ox, oy, tx, ty, l1, l2, bend) {
      const dx = tx - ox, dy = ty - oy;
      const base = Math.atan2(dy, dx);
      const d = clamp(Math.hypot(dx, dy), Math.abs(l1 - l2) + 0.01, l1 + l2 - 0.001);
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

    // ───────────────────────────────────────────── 3. Project + poses

    let nextId = 1;

    function defaultChars() {
      return {
        a: makeChar(150, 356, {
          spine: [-92, -87], head: -80,
          lArm: [113, 96], rArm: [68, 92],
          lLeg: [100, 94], rLeg: [80, 86]
        }),
        b: makeChar(292, 356, {
          spine: [-88, -94], head: -101,
          lArm: [110, 94], rArm: [40, 112],
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

    // ───────────────────────────────────────────── 5. Playback

    let playing = false;
    let playTime = 0; // seconds into the schedule; kept while paused
    let schedule = null;
    const play = { a: cloneChar(edit.a), b: cloneChar(edit.b), pos: 0 };

    function invalidateSchedule() {
      schedule = null;
    }

    // Holds and transitions in play order. With looping on, the last pose
    // eases back into the first unless they already match.
    function buildSchedule() {
      const poses = project.poses;
      const n = poses.length;
      const speed = SPEEDS[project.speed];
      const trans = BASE_TRANSITION / speed;
      const segs = [];
      let t = 0;
      for (let i = 0; i < n; i++) {
        const hold = HOLDS[poses[i].h | 0] / speed;
        if (hold > 0) {
          segs.push({ i, j: i, t0: t, d: hold });
          t += hold;
        }
        if (i < n - 1) {
          segs.push({ i, j: i + 1, t0: t, d: trans });
          t += trans;
        } else if (project.loop && n > 1) {
          const first = poses[0];
          if (!(charsEqual(poses[i].a, first.a) && charsEqual(poses[i].b, first.b))) {
            segs.push({ i, j: 0, t0: t, d: trans });
            t += trans;
          }
        }
      }
      return { segs, total: t };
    }

    function getSchedule() {
      if (!schedule) schedule = buildSchedule();
      return schedule;
    }

    function lerpChar(c0, c1, t, out) {
      const e = ease(t);
      out.x = c0.x + (c1.x - c0.x) * e;
      out.y = c0.y + (c1.y - c0.y) * e;
      for (const k of ANGLE_KEYS) {
        const d = angDelta(c0[k], c1[k]);
        if (d === 0) {
          out[k] = c0[k];
          continue;
        }
        const lag = LAG[k];
        const tk = clamp((t - lag) / (1 - lag), 0, 1);
        const swing = -SWING[k] * Math.sin(TAU * tk) * tk * tk;
        out[k] = c0[k] + d * (ease(tk) + swing);
      }
      return out;
    }

    // Samples the animation at time `time` into out.a / out.b. Pure: reads
    // poses, writes only to `out`.
    function sample(time, out) {
      const poses = project.poses;
      const { segs, total } = getSchedule();
      if (!segs.length) {
        copyChar(poses[0].a, out.a);
        copyChar(poses[0].b, out.b);
        out.pos = 0;
        return out;
      }
      const t = clamp(time, 0, total);
      let s = segs[segs.length - 1];
      for (const seg of segs) {
        if (t < seg.t0 + seg.d) {
          s = seg;
          break;
        }
      }
      const f = clamp((t - s.t0) / s.d, 0, 1);
      const p0 = poses[s.i], p1 = poses[s.j];
      if (s.i === s.j) {
        copyChar(p0.a, out.a);
        copyChar(p0.b, out.b);
        out.pos = s.i;
      } else {
        lerpChar(p0.a, p1.a, f, out.a);
        lerpChar(p0.b, p1.b, f, out.b);
        out.pos = s.i + f;
      }
      return out;
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
      interact("play");
      updateControls();
      dirty = true;
    }

    function pause() {
      if (!playing) return;
      playing = false;
      updateControls();
      renderTimeline(false);
      dirty = true;
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
          updateControls();
        }
      }
      sample(playTime, play);
      updatePlayhead();
      dirty = true;
    }

    // ───────────────────────────────────────────── 6. Rendering

    const canvas = ctx.createCanvas2D({ layer: "content", maxDpr: 2, alpha: false, touchAction: "none" });
    const g = canvas.getContext("2d");
    canvas.style.touchAction = "none";
    const view = { s: 1, ox: 0, oy: 0 };
    const JA = new Float64Array(JLEN), JB = new Float64Array(JLEN);
    const JGA = new Float64Array(JLEN), JGB = new Float64Array(JLEN);
    const ghostA = mixHex(COLOR.bg, COLOR.a, 0.24);
    const ghostB = mixHex(COLOR.bg, COLOR.b, 0.24);
    const haloColor = mixHex(COLOR.bg, "#FFFFFF", 0.13);
    let dirty = true;
    let hover = null; // { ci, handle }
    let settle = null; // { x, y, t } release ripple in world units

    function mixHex(h1, h2, t) {
      const a = parseInt(h1.slice(1), 16), b = parseInt(h2.slice(1), 16);
      const ch = (v, s) => (v >> s) & 255;
      const m = (s) => Math.round(ch(a, s) + (ch(b, s) - ch(a, s)) * t);
      return "rgb(" + m(16) + "," + m(8) + "," + m(0) + ")";
    }

    function drawFigure(c2, J, color, extra) {
      const w = extra || 0;
      c2.strokeStyle = color;
      c2.fillStyle = color;
      c2.lineCap = "round";
      c2.lineJoin = "round";
      // legs + feet
      c2.lineWidth = BODY.limb + w;
      c2.beginPath();
      c2.moveTo(J[P], J[P + 1]);
      c2.lineTo(J[LK], J[LK + 1]);
      c2.lineTo(J[LA], J[LA + 1]);
      c2.lineTo(J[LT], J[LT + 1]);
      c2.moveTo(J[P], J[P + 1]);
      c2.lineTo(J[RK], J[RK + 1]);
      c2.lineTo(J[RA], J[RA + 1]);
      c2.lineTo(J[RT], J[RT + 1]);
      c2.stroke();
      // torso: a curve through the chest so bending reads as a spine
      c2.lineWidth = BODY.torso + w;
      c2.beginPath();
      c2.moveTo(J[P], J[P + 1]);
      c2.quadraticCurveTo(
        2 * J[CH] - (J[P] + J[NK]) / 2, 2 * J[CH + 1] - (J[P + 1] + J[NK + 1]) / 2,
        J[NK], J[NK + 1]
      );
      c2.stroke();
      // neck + arms
      c2.lineWidth = BODY.limb + w;
      c2.beginPath();
      c2.moveTo(J[NK], J[NK + 1]);
      c2.lineTo(J[HD], J[HD + 1]);
      c2.moveTo(J[NK], J[NK + 1]);
      c2.lineTo(J[LE], J[LE + 1]);
      c2.lineTo(J[LH], J[LH + 1]);
      c2.moveTo(J[NK], J[NK + 1]);
      c2.lineTo(J[RE], J[RE + 1]);
      c2.lineTo(J[RH], J[RH + 1]);
      c2.stroke();
      // hands + head
      c2.beginPath();
      c2.arc(J[LH], J[LH + 1], BODY.hand + w / 2, 0, TAU);
      c2.moveTo(J[RH] + BODY.hand + w / 2, J[RH + 1]);
      c2.arc(J[RH], J[RH + 1], BODY.hand + w / 2, 0, TAU);
      c2.moveTo(J[HD] + BODY.headR + w / 2, J[HD + 1]);
      c2.arc(J[HD], J[HD + 1], BODY.headR + w / 2, 0, TAU);
      c2.fill();
    }

    function drawJoints(J, ci) {
      const s = view.s;
      const active = drag && drag.ci === ci ? drag.handle : null;
      const hov = !drag && hover && hover.ci === ci ? hover.handle : null;
      g.fillStyle = "rgba(8,9,12,0.62)";
      g.beginPath();
      for (const [name, j] of HANDLES) {
        if (name === "head" || name === active) continue;
        g.moveTo(J[j] + 3.4 / s, J[j + 1]);
        g.arc(J[j], J[j + 1], 3.4 / s, 0, TAU);
      }
      g.fill();
      const ring = (name, alpha, r) => {
        if (!name || name === "body") return;
        const j = HANDLE_JOINT[name];
        const rr = name === "head" ? BODY.headR + 5 / s : r / s;
        g.strokeStyle = "rgba(255,255,255," + alpha + ")";
        g.lineWidth = 2 / s;
        g.beginPath();
        g.arc(J[j], J[j + 1], rr, 0, TAU);
        g.stroke();
      };
      ring(hov, 0.35, 11);
      if (active && active !== "body") {
        ring(active, 0.55, 13);
        if (active !== "head") {
          const j = HANDLE_JOINT[active];
          g.fillStyle = COLOR.ink;
          g.beginPath();
          g.arc(J[j], J[j + 1], 4.6 / s, 0, TAU);
          g.fill();
        }
      }
    }

    function render() {
      const cssW = ctx.width || canvas.clientWidth || 1;
      const k = canvas.width / cssW;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.fillStyle = COLOR.bg;
      g.fillRect(0, 0, canvas.width, canvas.height);
      g.setTransform(k * view.s, 0, 0, k * view.s, k * view.ox, k * view.oy);

      if (playing) {
        drawFigure(g, fk(play.a, JA), COLOR.a);
        drawFigure(g, fk(play.b, JB), COLOR.b);
        return;
      }

      if (project.ghost && project.sel > 0) {
        const prev = project.poses[project.sel - 1];
        drawFigure(g, fk(prev.a, JGA), ghostA);
        drawFigure(g, fk(prev.b, JGB), ghostB);
      }
      fk(edit.a, JA);
      fk(edit.b, JB);
      const bodyHalo = drag ? (drag.handle === "body" ? drag.ci : -1) : hover && hover.handle === "body" ? hover.ci : -1;
      if (bodyHalo >= 0) drawFigure(g, bodyHalo ? JB : JA, haloColor, 7 / view.s);
      drawFigure(g, JA, COLOR.a);
      drawFigure(g, JB, COLOR.b);
      drawJoints(JA, 0);
      drawJoints(JB, 1);

      if (settle) {
        const t = (performance.now() - settle.t) / 260;
        if (t >= 1) {
          settle = null;
        } else {
          g.strokeStyle = "rgba(255,255,255," + (0.4 * (1 - t)) + ")";
          g.lineWidth = 2 / view.s;
          g.beginPath();
          g.arc(settle.x, settle.y, (8 + 14 * ease(t)) / view.s, 0, TAU);
          g.stroke();
          dirty = true;
        }
      }
    }

    // Small inline SVG of both characters for the timeline.
    const JT = new Float64Array(JLEN);
    const f1 = (v) => Math.round(v * 10) / 10;
    function figureSVG(c, color) {
      const J = fk(c, JT);
      const pt = (i) => f1(J[i]) + " " + f1(J[i + 1]);
      const qx = 2 * J[CH] - (J[P] + J[NK]) / 2, qy = 2 * J[CH + 1] - (J[P + 1] + J[NK + 1]) / 2;
      return (
        '<g stroke="' + color + '" fill="none" stroke-linecap="round" stroke-linejoin="round">' +
        '<path stroke-width="17" d="M' + pt(P) + "L" + pt(LK) + "L" + pt(LA) + "L" + pt(LT) +
        "M" + pt(P) + "L" + pt(RK) + "L" + pt(RA) + "L" + pt(RT) +
        "M" + pt(NK) + "L" + pt(LE) + "L" + pt(LH) + "M" + pt(NK) + "L" + pt(RE) + "L" + pt(RH) +
        "M" + pt(NK) + "L" + pt(HD) + '"/>' +
        '<path stroke-width="20" d="M' + pt(P) + "Q" + f1(qx) + " " + f1(qy) + " " + pt(NK) + '"/>' +
        '<circle fill="' + color + '" stroke="none" cx="' + f1(J[HD]) + '" cy="' + f1(J[HD + 1]) + '" r="' + BODY.headR + '"/>' +
        "</g>"
      );
    }

    // One shared viewBox for every thumbnail so sizes and positions compare.
    function thumbViewBox() {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const p of project.poses) {
        for (const c of [p.a, p.b]) {
          const J = fk(c, JT);
          for (let i = 0; i < JLEN; i += 2) {
            x0 = Math.min(x0, J[i]); x1 = Math.max(x1, J[i]);
            y0 = Math.min(y0, J[i + 1]); y1 = Math.max(y1, J[i + 1]);
          }
          x0 = Math.min(x0, J[HD] - BODY.headR); x1 = Math.max(x1, J[HD] + BODY.headR);
          y0 = Math.min(y0, J[HD + 1] - BODY.headR); y1 = Math.max(y1, J[HD + 1] + BODY.headR);
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

    // ───────────────────────────────────────────── 7. Pointer manipulation

    let drag = null;
    let started = false;
    const JW = new Float64Array(JLEN);

    function toLocal(e) {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    function toWorld(p) {
      return { x: (p.x - view.ox) / view.s, y: (p.y - view.oy) / view.s };
    }

    function distSeg(px, py, ax, ay, bx, by) {
      const dx = bx - ax, dy = by - ay;
      const l2 = dx * dx + dy * dy;
      const t = l2 ? clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1) : 0;
      return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
    }

    // Nearest target wins. Joints beat the bones they sit on, a touched bone
    // selects the joint it moves, and the pink figure (drawn on top) wins ties.
    function pick(w) {
      const s = view.s;
      const hitR = 26 / s;
      const segBias = 9 / s;
      let best = null, bestD = hitR;
      for (const ci of [1, 0]) {
        const J = fk(ci ? edit.b : edit.a, JW);
        for (const [name, j] of HANDLES) {
          let d = Math.hypot(w.x - J[j], w.y - J[j + 1]);
          if (name === "head") d = Math.max(0, d - BODY.headR);
          if (d < bestD) { bestD = d; best = { ci, handle: name }; }
        }
        for (const [a, b, name] of SEGMENTS) {
          const d = distSeg(w.x, w.y, J[a], J[a + 1], J[b], J[b + 1]) + segBias;
          if (d < bestD) { bestD = d; best = { ci, handle: name }; }
        }
      }
      return best;
    }

    function beginDrag(e) {
      const w = toWorld(toLocal(e));
      const target = pick(w);
      if (!target) return false;
      const c = target.ci ? edit.b : edit.a;
      const J = fk(c, new Float64Array(JLEN));
      const j = target.handle === "body" ? P : HANDLE_JOINT[target.handle];
      drag = {
        pointerId: e.pointerId,
        ci: target.ci,
        handle: target.handle,
        before: snapshot(),
        offX: J[j] - w.x,
        offY: J[j + 1] - w.y,
        // feet stay planted while the hips move
        ankL: { x: J[LA], y: J[LA + 1] },
        ankR: { x: J[RA], y: J[RA + 1] },
        bend: {
          ch: bendOf(c, "ch"), lel: bendOf(c, "lel"), rel: bendOf(c, "rel"),
          lkn: bendOf(c, "lkn"), rkn: bendOf(c, "rkn")
        }
      };
      hover = null;
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* capture is best-effort */ }
      canvas.style.cursor = "grabbing";
      if (!started) {
        started = true;
        ctx.platform.start();
      }
      interact("pose_drag");
      dirty = true;
      return true;
    }

    function applyDrag(w) {
      const d = drag;
      const c = d.ci ? edit.b : edit.a;
      const tx = w.x + d.offX, ty = w.y + d.offY;
      const J = fk(c, JW);
      const nx = J[NK], ny = J[NK + 1];
      const upper = c.sp + c.ch;
      let r;
      switch (d.handle) {
        case "body":
          c.x = clamp(tx, 10, STAGE_W - 10);
          c.y = clamp(ty, 30, STAGE_H - 10);
          break;
        case "pelvis":
          c.x = clamp(tx, 10, STAGE_W - 10);
          c.y = clamp(ty, 30, STAGE_H - 10);
          r = ik2(c.x, c.y, d.ankL.x, d.ankL.y, BODY.th, BODY.sh, d.bend.lkn);
          c.lhp = norm(r.a1); c.lkn = norm(r.a2 - r.a1);
          r = ik2(c.x, c.y, d.ankR.x, d.ankR.y, BODY.th, BODY.sh, d.bend.rkn);
          c.rhp = norm(r.a1); c.rkn = norm(r.a2 - r.a1);
          break;
        case "neck":
          r = ik2(c.x, c.y, tx, ty, BODY.sp1, BODY.sp2, d.bend.ch);
          c.sp = norm(r.a1); c.ch = norm(r.a2 - r.a1);
          break;
        case "head":
          c.hd = norm(Math.atan2(ty - ny, tx - nx) - upper);
          break;
        case "lel":
          c.lsh = norm(Math.atan2(ty - ny, tx - nx) - upper);
          break;
        case "rel":
          c.rsh = norm(Math.atan2(ty - ny, tx - nx) - upper);
          break;
        case "lhand":
          r = ik2(nx, ny, tx, ty, BODY.ua, BODY.fa, d.bend.lel);
          c.lsh = norm(r.a1 - upper); c.lel = norm(r.a2 - r.a1);
          break;
        case "rhand":
          r = ik2(nx, ny, tx, ty, BODY.ua, BODY.fa, d.bend.rel);
          c.rsh = norm(r.a1 - upper); c.rel = norm(r.a2 - r.a1);
          break;
        case "lkn":
          c.lhp = norm(Math.atan2(ty - c.y, tx - c.x));
          break;
        case "rkn":
          c.rhp = norm(Math.atan2(ty - c.y, tx - c.x));
          break;
        case "lfoot":
          r = ik2(c.x, c.y, tx, ty, BODY.th, BODY.sh, d.bend.lkn);
          c.lhp = norm(r.a1); c.lkn = norm(r.a2 - r.a1);
          break;
        case "rfoot":
          r = ik2(c.x, c.y, tx, ty, BODY.th, BODY.sh, d.bend.rkn);
          c.rhp = norm(r.a1); c.rkn = norm(r.a2 - r.a1);
          break;
      }
      dirty = true;
    }

    function endDrag(commit) {
      if (!drag) return;
      const d = drag;
      drag = null;
      try { canvas.releasePointerCapture(d.pointerId); } catch (err) { /* already released */ }
      canvas.style.cursor = "";
      if (commit) {
        if (commitPoseEdit(d.before)) {
          const J = fk(d.ci ? edit.b : edit.a, JW);
          const j = d.handle === "body" ? P : HANDLE_JOINT[d.handle];
          settle = { x: J[j], y: J[j + 1], t: performance.now() };
        }
      } else {
        syncEdit();
      }
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
        applyDrag(toWorld(toLocal(e)));
        e.preventDefault();
        return;
      }
      if (e.pointerType === "mouse" && !playing) {
        const h = pick(toWorld(toLocal(e)));
        const same = h && hover && h.ci === hover.ci && h.handle === hover.handle;
        if (!same && (h || hover)) {
          hover = h;
          canvas.style.cursor = h ? "grab" : "";
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
      tipEl.textContent = playing ? "Tap the stage to pause" : n > 1 ? "Tap selected pose for more" : "";
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
    function unpackChar(arr) {
      if (!Array.isArray(arr) || arr.length !== KEYS.length) return null;
      const c = {};
      for (let i = 0; i < KEYS.length; i++) {
        const v = Number(arr[i]);
        if (!Number.isFinite(v)) return null;
        c[KEYS[i]] = i < 2 ? clamp(v, -STAGE_W, STAGE_W * 2) : norm(v);
      }
      return c;
    }

    function serialize() {
      return {
        v: 1,
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
      if (!data || data.v !== 1 || !Array.isArray(data.poses) || !data.poses.length) return false;
      const poses = [];
      for (const raw of data.poses.slice(0, MAX_POSES)) {
        const a = raw && unpackChar(raw.a), b = raw && unpackChar(raw.b);
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

    // Renders every frame of the animation off-screen and streams it into a
    // GIF89a encoder. Uses the same sampling as on-screen playback.
    async function encodeAnimation(job, onProgress) {
      const W = EXPORT_W, H = EXPORT_H;
      const off = new OffscreenCanvas(W, H);
      const c2 = off.getContext("2d", { willReadFrequently: true });
      const { total } = getSchedule();
      const loops = project.loop && project.poses.length > 1;
      const tail = loops ? 0 : 0.6;
      const frameCount = clamp(Math.ceil((total + tail) * EXPORT_FPS), 1, 1800);
      const dt = 1 / EXPORT_FPS;
      const pal = buildPalette();
      const gif = gifWriter(W, H, pal.rgb);
      const out = { a: cloneChar(edit.a), b: cloneChar(edit.b), pos: 0 };
      const J1 = new Float64Array(JLEN), J2 = new Float64Array(JLEN);
      const scale = W / STAGE_W;
      const indices = new Uint8Array(W * H);
      for (let f = 0; f < frameCount; f++) {
        if (job.cancelled) throw new Error("cancelled");
        const t = Math.min(f * dt, total);
        sample(t, out);
        c2.setTransform(1, 0, 0, 1, 0, 0);
        c2.fillStyle = COLOR.bg;
        c2.fillRect(0, 0, W, H);
        c2.setTransform(scale, 0, 0, scale, 0, 0);
        drawFigure(c2, fk(out.a, J1), COLOR.a);
        drawFigure(c2, fk(out.b, J2), COLOR.b);
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

    ctx.game.loop({
      update(dtMs) {
        advancePlayback(Math.min(dtMs, 100) / 1000);
      },
      render() {
        if (!dirty && !playing) return;
        dirty = false;
        render();
      }
    });

    render();

    // Read-only inspection for the local test harness; inert in Plethora.
    if (ctx.__testHooks) {
      ctx.__testHooks.moveIt = {
        joint(ci, handle) {
          const J = fk(ci ? edit.b : edit.a, new Float64Array(JLEN));
          const j = HANDLE_JOINT[handle] !== undefined ? HANDLE_JOINT[handle] : handle === "chest" || handle === "body" ? CH : P;
          const r = canvas.getBoundingClientRect();
          return { x: r.left + view.ox + J[j] * view.s, y: r.top + view.oy + J[j + 1] * view.s };
        },
        state() {
          return JSON.parse(JSON.stringify({ poses: project.poses, sel: project.sel, playing, playTime, edit, undo: undoStack.length, redo: redoStack.length, loop: project.loop }));
        },
        playPos() {
          return play.pos;
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
