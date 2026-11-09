# THE LAST SIGNAL — the black cat: model, rig, animation, GLB export.
#
# Run headless:   blender -b -P cat.py -- <out.glb>
#   (or with the `bpy` Python module: python cat.py -- <out.glb>)
# Then shrink it for embedding:  python3 compact_glb.py <out.glb> ../assets/cat.glb
#
# Conventions: Blender Z-up, the cat faces +Y (glTF export turns +Y into
# -Z, the game's forward). Paws rest on Z = 0. Metres. 24 fps.
#
# The body is one organic mesh made with a Skin modifier over a vertex
# "armature" of the cat's form (spine, legs, neck, head, tail), then
# subdivided. Ears, eyes, nose, collar and power core are separate parts
# joined into the same skinned mesh and pinned to their bones.
#
# Animation is keyed on pose bones as rotations about armature-space axes
# (X = pitch, Z = yaw, Y = roll), converted to each bone's local frame, so
# poses read the same whatever a bone's roll. Clips:
#   Idle, Run, Sprint, Balance, Crouch, Fall (loops)
#   Jump, Land, Recover (one-shots; the game holds Jump's last pose in the air)
import bpy, bmesh, sys, math
from mathutils import Vector, Quaternion, Matrix

OUT = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else 'cat.glb'
FPS = 24
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = FPS

def mat(name, base, rough=0.75, emit=None, strength=0.0):
    m = bpy.data.materials.new(name); m.use_nodes = True
    p = m.node_tree.nodes['Principled BSDF']
    p.inputs['Base Color'].default_value = (*base, 1)
    p.inputs['Roughness'].default_value = rough
    if emit:
        p.inputs['Emission Color'].default_value = (*emit, 1); p.inputs['Emission Strength'].default_value = strength
    return m

FUR = mat('Fur', (0.018, 0.018, 0.022), 0.85)
INNER = mat('EarInner', (0.09, 0.045, 0.055), 0.9)
EYE = mat('Eye', (0.55, 0.9, 0.18), 0.3, (0.55, 0.9, 0.18), 1.5)
NOSE = mat('Nose', (0.05, 0.03, 0.035), 0.6)
COLLAR = mat('Collar', (0.18, 0.04, 0.035), 0.6)
CORE = mat('Core', (0.3, 1.0, 0.62), 0.2, (0.3, 1.0, 0.62), 4.0)

# ---------------------------------------------------------------- the form
# (name, position, (radius across x, radius along z)), and edges between them
P = {
    'hips':  ((0, -0.125, 0.215), (0.06, 0.066)),
    'waist': ((0, -0.025, 0.21), (0.054, 0.058)),
    'chest': ((0, 0.07, 0.222), (0.062, 0.078)),
    'neck':  ((0, 0.135, 0.262), (0.042, 0.046)),
    'head':  ((0, 0.188, 0.298), (0.058, 0.054)),
    'snout': ((0, 0.24, 0.284), (0.027, 0.024)),
    'nose':  ((0, 0.258, 0.284), (0.012, 0.012)),
    't0': ((0, -0.18, 0.25), (0.02, 0.02)), 't1': ((0, -0.24, 0.27), (0.018, 0.018)),
    't2': ((0, -0.3, 0.295), (0.016, 0.016)), 't3': ((0, -0.355, 0.33), (0.014, 0.014)),
    't4': ((0, -0.4, 0.375), (0.012, 0.012)), 't5': ((0, -0.43, 0.43), (0.01, 0.01)),
    't6': ((0, -0.44, 0.475), (0.007, 0.007)),
}
for s, sx in (('L', 1), ('R', -1)):
    P.update({
        'sh' + s: ((sx * 0.04, 0.085, 0.175), (0.028, 0.032)), 'el' + s: ((sx * 0.043, 0.068, 0.1), (0.019, 0.019)),
        'wr' + s: ((sx * 0.043, 0.082, 0.03), (0.014, 0.014)), 'fp' + s: ((sx * 0.043, 0.104, 0.012), (0.018, 0.012)),
        'hp' + s: ((sx * 0.046, -0.115, 0.175), (0.04, 0.046)), 'kn' + s: ((sx * 0.05, -0.07, 0.105), (0.023, 0.023)),
        'hk' + s: ((sx * 0.05, -0.15, 0.055), (0.015, 0.015)), 'hf' + s: ((sx * 0.05, -0.125, 0.012), (0.018, 0.012)),
    })
E = [('hips', 'waist'), ('waist', 'chest'), ('chest', 'neck'), ('neck', 'head'), ('head', 'snout'), ('snout', 'nose'),
     ('hips', 't0'), ('t0', 't1'), ('t1', 't2'), ('t2', 't3'), ('t3', 't4'), ('t4', 't5'), ('t5', 't6')]
for s in 'LR':
    E += [('chest', 'sh' + s), ('sh' + s, 'el' + s), ('el' + s, 'wr' + s), ('wr' + s, 'fp' + s),
          ('hips', 'hp' + s), ('hp' + s, 'kn' + s), ('kn' + s, 'hk' + s), ('hk' + s, 'hf' + s)]

names = list(P)
me = bpy.data.meshes.new('CatForm')
me.from_pydata([P[n][0] for n in names], [(names.index(a), names.index(b)) for a, b in E], [])
body = bpy.data.objects.new('Cat', me); scene.collection.objects.link(body)
bpy.context.view_layer.objects.active = body; body.select_set(True)
skin = body.modifiers.new('Skin', 'SKIN')
for i, n in enumerate(names):
    rx, rz = P[n][1]
    me.skin_vertices[0].data[i].radius = (rx, rz)
me.skin_vertices[0].data[names.index('hips')].use_root = True
sub = body.modifiers.new('Sub', 'SUBSURF'); sub.levels = 1; sub.render_levels = 1
bpy.ops.object.modifier_apply(modifier='Skin'); bpy.ops.object.modifier_apply(modifier='Subsurf' if 'Subsurf' in body.modifiers else 'Sub')
bpy.ops.object.shade_smooth()
body.data.materials.append(FUR)

parts = []
def part(obj, material):
    obj.data.materials.clear(); obj.data.materials.append(material); bpy.ops.object.shade_smooth(); parts.append(obj); return obj

# ears: a flattened cone with a dark inner face, tilted out and forward
for s, sx in (('L', 1), ('R', -1)):
    bpy.ops.mesh.primitive_cone_add(vertices=6, radius1=0.025, depth=0.06, location=(sx * 0.03, 0.18, 0.358))
    ear = bpy.context.object; ear.scale = (1, 0.45, 1); ear.rotation_euler = (math.radians(-12), math.radians(sx * 16), 0)
    part(ear, FUR); ear.name = 'Ear' + s
    bpy.ops.mesh.primitive_cone_add(vertices=3, radius1=0.015, depth=0.044, location=(sx * 0.03, 0.188, 0.356))
    inner = bpy.context.object; inner.scale = (1, 0.2, 1); inner.rotation_euler = ear.rotation_euler
    part(inner, INNER); inner.name = 'EarIn' + s
    bpy.ops.mesh.primitive_uv_sphere_add(segments=10, ring_count=6, radius=0.0115, location=(sx * 0.025, 0.232, 0.31))
    eye = bpy.context.object; eye.scale = (1, 0.6, 0.8); part(eye, EYE); eye.name = 'Eye' + s
bpy.ops.mesh.primitive_uv_sphere_add(segments=8, ring_count=5, radius=0.008, location=(0, 0.262, 0.29))
part(bpy.context.object, NOSE).name = 'NoseTip'
bpy.ops.mesh.primitive_torus_add(major_radius=0.046, minor_radius=0.006, major_segments=18, minor_segments=6, location=(0, 0.14, 0.255))
col = bpy.context.object; col.rotation_euler = (math.radians(62), 0, 0); part(col, COLLAR); col.name = 'Collar'
bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=0.013, location=(0, 0.172, 0.214))
part(bpy.context.object, CORE).name = 'Core'

# ---------------------------------------------------------------- the rig
arm_data = bpy.data.armatures.new('CatRig'); rig = bpy.data.objects.new('CatRig', arm_data)
scene.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig; bpy.ops.object.mode_set(mode='EDIT')
eb = arm_data.edit_bones
def bone(name, head, tail, parent=None, connect=False, deform=True):
    b = eb.new(name); b.head = head; b.tail = tail; b.use_deform = deform
    if parent: b.parent = eb[parent]; b.use_connect = connect
    return b
pos = lambda n: Vector(P[n][0])
bone('root', (0, 0, 0), (0, 0.06, 0), deform=False)
bone('spine', pos('waist'), pos('waist') + Vector((0, 0.04, 0.002)), 'root')
bone('chest', pos('waist') + Vector((0, 0.04, 0.002)), pos('chest') + Vector((0, 0.05, 0.01)), 'spine', True)
bone('neck', pos('chest') + Vector((0, 0.05, 0.01)), pos('neck') + Vector((0, 0.02, 0.02)), 'chest', True)
bone('head', pos('neck') + Vector((0, 0.02, 0.02)), pos('nose'), 'neck', True)
bone('pelvis', pos('waist'), pos('hips') + Vector((0, -0.04, 0.01)), 'spine')
prev = 'pelvis'
for i in range(6):
    a, b = ('t%d' % i), ('t%d' % (i + 1))
    bone('tail%d' % i, pos(a), pos(b), prev, i > 0); prev = 'tail%d' % i
for s, sx in (('L', 1), ('R', -1)):
    bone('ear.' + s, (sx * 0.03, 0.18, 0.333), (sx * 0.033, 0.18, 0.392), 'head')
    bone('upperarm.' + s, pos('sh' + s), pos('el' + s), 'chest')
    bone('forearm.' + s, pos('el' + s), pos('wr' + s), 'upperarm.' + s, True)
    bone('hand.' + s, pos('wr' + s), pos('fp' + s) + Vector((0, 0.02, 0)), 'forearm.' + s, True)
    bone('thigh.' + s, pos('hp' + s), pos('kn' + s), 'pelvis')
    bone('shin.' + s, pos('kn' + s), pos('hk' + s), 'thigh.' + s, True)
    bone('foot.' + s, pos('hk' + s), pos('hf' + s) + Vector((0, 0.02, 0)), 'shin.' + s, True)
bpy.ops.object.mode_set(mode='OBJECT')

# skin: automatic (heat) weights on the body; accessories pinned to their bone
bpy.ops.object.select_all(action='DESELECT'); body.select_set(True); rig.select_set(True); bpy.context.view_layer.objects.active = rig
bpy.ops.object.parent_set(type='ARMATURE_AUTO')
PIN = {'EarL': 'ear.L', 'EarInL': 'ear.L', 'EarR': 'ear.R', 'EarInR': 'ear.R', 'EyeL': 'head', 'EyeR': 'head', 'NoseTip': 'head', 'Collar': 'neck', 'Core': 'neck'}
for p in parts:
    vg = p.vertex_groups.new(name=PIN[p.name]); vg.add(list(range(len(p.data.vertices))), 1.0, 'REPLACE')
bpy.ops.object.select_all(action='DESELECT')
for p in parts: p.select_set(True)
body.select_set(True); bpy.context.view_layer.objects.active = body
bpy.ops.object.join()
body = bpy.context.object; body.name = 'Cat'

# ---------------------------------------------------------------- animation
pb = rig.pose.bones
for b in pb: b.rotation_mode = 'QUATERNION'
AX = {'x': Vector((1, 0, 0)), 'y': Vector((0, 1, 0)), 'z': Vector((0, 0, 1))}
def rot(name, pitch=0.0, yaw=0.0, roll=0.0):
    # rotation about armature-space axes (degrees), expressed in the bone's rest frame
    b = rig.data.bones[name]; inv = b.matrix_local.to_3x3().inverted()
    q = Quaternion()
    for ax, deg in (('z', yaw), ('x', pitch), ('y', roll)):
        if deg: q = Quaternion((inv @ AX[ax]).normalized(), math.radians(deg)) @ q
    return q

def keyframe(f, pose, lift=0.0, fwd=0.0):
    for name in pose_bones_animated:
        p = pose.get(name, (0, 0, 0))
        pb[name].rotation_quaternion = rot(name, *p)
        pb[name].keyframe_insert('rotation_quaternion', frame=f)
    # root lift (whole body up/down) through the spine bone's location, in its rest frame
    inv = rig.data.bones['spine'].matrix_local.to_3x3().inverted()
    pb['spine'].location = inv @ Vector((0, fwd, lift)); pb['spine'].keyframe_insert('location', frame=f)

pose_bones_animated = [b.name for b in rig.data.bones if b.name != 'root']

def clip(name, frames, fn, loop=True):
    act = bpy.data.actions.new(name)
    rig.animation_data_create(); rig.animation_data.action = act
    n = frames
    for f in range(0, n + 1):
        t = f / n
        pose, lift, fwd = fn(t)
        keyframe(f, pose, lift, fwd)
    tr = rig.animation_data.nla_tracks.new(); tr.name = name
    st = tr.strips.new(name, 0, act); rig.animation_data.action = None
    return act

S = lambda x: math.sin(2 * math.pi * x)
C = lambda x: math.cos(2 * math.pi * x)
pos_ = lambda v: max(0.0, v)

def legs(t, amp, fold, phases=(0.0, 0.1, 0.5, 0.6), stride_bias=0.0):
    # rotary gallop: hind pair, then fore pair. amp/fold in degrees.
    out = {}
    for (s, ph_h, ph_f) in (('L', phases[0], phases[2]), ('R', phases[1], phases[3])):
        h, f = t + ph_h, t + ph_f
        out['thigh.' + s] = (amp * S(h) + stride_bias, 0, 0)
        out['shin.' + s] = (-fold * pos_(S(h + 0.25)) - 8, 0, 0)
        out['foot.' + s] = (fold * 0.8 * pos_(S(h + 0.25)) + 6, 0, 0)
        out['upperarm.' + s] = (amp * 0.9 * S(f) + stride_bias, 0, 0)
        out['forearm.' + s] = (fold * 0.9 * pos_(S(f + 0.25)), 0, 0)
        out['hand.' + s] = (-fold * 0.6 * pos_(S(f + 0.3)), 0, 0)
    return out

def tail(t, base, wave, rate=1.0, curl=0.0):
    # base pitches the tail's root (positive lowers it: tail bones point backward); curl bends the rest
    return {'tail%d' % i: ((base if i == 0 else 0) + curl * (i / 5), wave * S(rate * t - i * 0.12) * (0.4 + i * 0.15), 0) for i in range(6)}

def run_pose(amp, fold, flex, bob, tail_base):
    def fn(t):
        p = legs(t, amp, fold)
        p['chest'] = (flex * S(t + 0.25), 0, 0); p['pelvis'] = (-flex * S(t + 0.25), 0, 0)
        p['neck'] = (-flex * 0.6 * S(t + 0.25) - 4, 0, 0); p['head'] = (-flex * 0.4 * S(t + 0.25) + 6, 0, 0)
        p.update(tail(t, tail_base, 8, 1))
        p['ear.L'] = p['ear.R'] = (-18, 0, 0)
        return p, bob * abs(S(t)), 0.0
    return fn

clip('Run', 12, run_pose(32, 55, 10, 0.012, 22))
clip('Sprint', 10, run_pose(46, 75, 18, 0.022, 28))

def idle(t):
    p = {'chest': (2 * S(t), 0, 0), 'neck': (6, 10 * S(t * 0.5), 0), 'head': (4, 12 * S(t * 0.5 + 0.1), 0)}
    p.update(tail(t, 45, 22, 1, -18))
    p['ear.L'] = (6 * pos_(S(t * 2 + 0.3)) - 4, 0, 0); p['ear.R'] = (-4, 0, 0)
    for s in 'LR': p['shin.' + s] = (-8, 0, 0); p['foot.' + s] = (6, 0, 0)
    return p, 0.004 * S(t), 0.0
clip('Idle', 72, idle)

def balance(t):
    p = legs(t, 14, 30, (0.0, 0.5, 0.25, 0.75))
    for s in 'LR':   # paws step in under the body line
        for b in ('thigh.', 'upperarm.'): p[b + s] = (p[b + s][0], 0, (8 if s == 'L' else -8))
    p['chest'] = (-4, 0, 3 * S(t)); p['pelvis'] = (2, 0, -3 * S(t))
    p['neck'] = (-14, 0, 0); p['head'] = (10, 0, -2 * S(t))
    # out behind, near level, swinging as a counterweight
    p.update({'tail%d' % i: (18 if i == 0 else 2, 18 * S(0.5 * t - i * 0.1) * (0.5 + i * 0.12), 0) for i in range(6)})
    p['ear.L'] = p['ear.R'] = (10, 0, 0)
    return p, -0.035, 0.0
clip('Balance', 24, balance)

def crouch(t):
    p = legs(t, 16, 40, (0.0, 0.5, 0.5, 0.0))
    for s in 'LR':
        p['upperarm.' + s] = (p['upperarm.' + s][0] + 25, 0, 0); p['forearm.' + s] = (p['forearm.' + s][0] - 45, 0, 0); p['hand.' + s] = (20, 0, 0)
        p['thigh.' + s] = (p['thigh.' + s][0] - 30, 0, 0); p['shin.' + s] = (p['shin.' + s][0] - 35, 0, 0); p['foot.' + s] = (p['foot.' + s][0] + 30, 0, 0)
    p['chest'] = (-6, 0, 0); p['neck'] = (-22, 0, 0); p['head'] = (12, 0, 0)
    p.update({'tail%d' % i: (40 if i == 0 else 3, 6 * S(t - i * 0.1), 0) for i in range(6)})
    p['ear.L'] = p['ear.R'] = (-55, 0, 0)
    return p, -0.085, 0.0
clip('Crouch', 18, crouch)

def jump(t):
    # 0-0.25 anticipation (gather), 0.25-0.45 push-off, then stretched flight
    a = min(1, t / 0.25); pu = min(1, max(0, (t - 0.25) / 0.2)); fl = min(1, max(0, (t - 0.45) / 0.3))
    p = {}
    for s in 'LR':
        p['thigh.' + s] = (lerp(-25 * a, -55, pu), 0, 0); p['shin.' + s] = (lerp(-45 * a, 25, pu), 0, 0); p['foot.' + s] = (lerp(35 * a, -20, pu), 0, 0)
        p['upperarm.' + s] = (lerp(lerp(-15 * a, 20, pu), 70, fl), 0, 0); p['forearm.' + s] = (lerp(lerp(-35 * a, -10, pu), 10, fl), 0, 0); p['hand.' + s] = (lerp(10, -15, fl), 0, 0)
    p['chest'] = (lerp(lerp(-8 * a, 10, pu), 6, fl), 0, 0); p['pelvis'] = (lerp(10 * a, -12, pu), 0, 0)
    p['neck'] = (lerp(-10 * a, 4, pu), 0, 0); p['head'] = (lerp(8 * a, -4, fl), 0, 0)
    p.update({'tail%d' % i: (lerp(10, 30, pu) if i == 0 else lerp(2, 4, fl), 0, 0) for i in range(6)})
    p['ear.L'] = p['ear.R'] = (lerp(-10, -30, fl), 0, 0)
    return p, lerp(-0.045 * a, 0.02, pu), 0.0
def lerp(a, b, k): return a + (b - a) * k
clip('Jump', 14, jump, loop=False)

def fall(t):
    p = {}
    for s, sx in (('L', 1), ('R', -1)):
        p['upperarm.' + s] = (55 + 5 * S(t * 2), 0, sx * 8); p['forearm.' + s] = (-20, 0, 0); p['hand.' + s] = (-25, 0, 0)
        p['thigh.' + s] = (25 + 5 * S(t * 2 + 0.3), 0, sx * 10); p['shin.' + s] = (-30, 0, 0); p['foot.' + s] = (25, 0, 0)
    p['chest'] = (8, 0, 0); p['neck'] = (-10, 0, 0); p['head'] = (-12, 0, 0)
    p.update({'tail%d' % i: (5 if i == 0 else -4, 20 * S(t - i * 0.15), 0) for i in range(6)})
    p['ear.L'] = p['ear.R'] = (-50, 0, 0)
    return p, 0.0, 0.0
clip('Fall', 12, fall)

def land(t):
    # forepaws touch first, the body absorbs, then rises back to running height
    k = math.sin(min(1, t / 0.35) * math.pi * 0.5); r = max(0, (t - 0.35) / 0.65)
    c = (1 - r) * k
    p = {}
    for s in 'LR':
        p['upperarm.' + s] = (lerp(30, -10, c), 0, 0); p['forearm.' + s] = (-35 * c, 0, 0); p['hand.' + s] = (25 * c, 0, 0)
        p['thigh.' + s] = (-30 * c, 0, 0); p['shin.' + s] = (-40 * c - 8, 0, 0); p['foot.' + s] = (35 * c + 6, 0, 0)
    p['chest'] = (-10 * c, 0, 0); p['pelvis'] = (6 * c, 0, 0); p['neck'] = (8 * c, 0, 0); p['head'] = (-6 * c, 0, 0)
    p.update({'tail%d' % i: (25 + 12 * c if i == 0 else 4 * c, 0, 0) for i in range(6)})
    p['ear.L'] = p['ear.R'] = (-25 * c, 0, 0)
    return p, -0.06 * c, 0.0
clip('Land', 10, land, loop=False)

def recover(t):
    # back on its feet: a low crouch, then a whole-body shake
    rise = min(1, t / 0.35); sh = max(0, (t - 0.4) / 0.6); w = math.sin(sh * math.pi) * S(sh * 4)
    p = {}
    for s in 'LR':
        p['thigh.' + s] = (-25 * (1 - rise), 0, 0); p['shin.' + s] = (-30 * (1 - rise) - 8, 0, 0); p['foot.' + s] = (25 * (1 - rise) + 6, 0, 0)
        p['upperarm.' + s] = (10 * (1 - rise), 0, 0); p['forearm.' + s] = (-25 * (1 - rise), 0, 0)
    p['chest'] = (0, 12 * w, 10 * w); p['pelvis'] = (0, -10 * w, -8 * w); p['neck'] = (0, 14 * w, 0); p['head'] = (0, 10 * w, 14 * w)
    p.update(tail(t, 35, 25 * (1 - sh), 2))
    p['ear.L'] = (-20 * w, 0, 0); p['ear.R'] = (20 * w, 0, 0)
    return p, -0.05 * (1 - rise), 0.0
clip('Recover', 30, recover, loop=False)

# ---------------------------------------------------------------- export
tris = sum(len(p.vertices) - 2 for p in body.data.polygons)
print('cat: %d verts, %d tris, %d bones, %d clips' % (len(body.data.vertices), tris, len(rig.data.bones), len(bpy.data.actions)))
bpy.ops.object.select_all(action='DESELECT'); body.select_set(True); rig.select_set(True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_animations=True,
                          export_animation_mode='NLA_TRACKS', export_skins=True, export_yup=True,
                          export_apply=False, export_texcoords=False, export_normals=True,
                          export_def_bones=True, export_optimize_animation_size=True, export_frame_step=2)
print('exported', OUT)
