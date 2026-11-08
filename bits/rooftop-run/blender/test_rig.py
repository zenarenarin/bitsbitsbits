# Pipeline test asset: a skinned three-bone column with two actions and two
# materials (one emissive), exported as GLB. Verifies skeleton, skinning,
# animation, materials and scale before the real cat is built.
# Run:  blender -b -P test_rig.py -- <out.glb>      (or with the bpy module)
import bpy, sys, math

out = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else 'test_rig.glb'
bpy.ops.wm.read_factory_settings(use_empty=True)

# mesh: a column 0.6 m tall, 12 rings, with a glowing cap
bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=0.06, depth=0.6, location=(0, 0, 0.3))
col = bpy.context.object; col.name = 'Column'
bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.subdivide(number_cuts=10); bpy.ops.object.mode_set(mode='OBJECT')
body = bpy.data.materials.new('Body'); body.use_nodes = True
body.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.05, 0.05, 0.06, 1)
body.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.7
col.data.materials.append(body)
bpy.ops.mesh.primitive_ico_sphere_add(radius=0.05, location=(0, 0, 0.65))
cap = bpy.context.object
glow = bpy.data.materials.new('Glow'); glow.use_nodes = True
p = glow.node_tree.nodes['Principled BSDF']
p.inputs['Base Color'].default_value = (0.3, 1, 0.6, 1); p.inputs['Emission Color'].default_value = (0.3, 1, 0.6, 1); p.inputs['Emission Strength'].default_value = 2
cap.data.materials.append(glow)
bpy.ops.object.select_all(action='DESELECT'); col.select_set(True); cap.select_set(True); bpy.context.view_layer.objects.active = col
bpy.ops.object.join()

# armature: three bones up the column
bpy.ops.object.armature_add(location=(0, 0, 0))
arm = bpy.context.object; arm.name = 'Rig'
bpy.ops.object.mode_set(mode='EDIT')
eb = arm.data.edit_bones; b0 = eb[0]; b0.name = 'b0'; b0.head = (0, 0, 0); b0.tail = (0, 0, 0.22)
prev = b0
for i in (1, 2):
    b = eb.new('b%d' % i); b.head = prev.tail; b.tail = (0, 0, 0.22 * (i + 1)); b.parent = prev; b.use_connect = True; prev = b
bpy.ops.object.mode_set(mode='OBJECT')
bpy.ops.object.select_all(action='DESELECT'); col.select_set(True); arm.select_set(True); bpy.context.view_layer.objects.active = arm
bpy.ops.object.parent_set(type='ARMATURE_AUTO')

# actions: sway (side to side) and bow (forward), 1 s each at 24 fps
def action(name, axis, amp):
    act = bpy.data.actions.new(name); arm.animation_data_create(); arm.animation_data.action = act
    bpy.ops.object.mode_set(mode='POSE')
    for f in range(0, 25, 4):
        for i, pb in enumerate(arm.pose.bones):
            pb.rotation_mode = 'XYZ'; a = [0, 0, 0]; a[axis] = amp * math.sin(f / 24 * 2 * math.pi) * (0.5 + 0.5 * i)
            pb.rotation_euler = a; pb.keyframe_insert('rotation_euler', frame=f)
    bpy.ops.object.mode_set(mode='OBJECT')
    tr = arm.animation_data.nla_tracks.new(); tr.name = name; tr.strips.new(name, 0, act); arm.animation_data.action = None
action('Sway', 1, 0.45)
action('Bow', 0, 0.5)

bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_animations=True, export_animation_mode='NLA_TRACKS', export_skins=True, export_yup=True)
print('exported', out)
