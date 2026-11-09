# Shrink an exported GLB for embedding in a Bit (pure Python, no Blender):
#  - drop animation channels whose values never change (scale = 1, fixed
#    translations, idle bones): the rest pose already holds those values
#  - keep min/max only where glTF requires them (POSITION, animation inputs)
#  - repack the binary chunk with only what is still referenced
# Usage: python3 compact_glb.py in.glb out.glb
import json, struct, sys

src, dst = sys.argv[1], sys.argv[2]
b = open(src, 'rb').read()
jl = struct.unpack('<I', b[12:16])[0]
j = json.loads(b[20:20 + jl])
bin_off = 20 + jl + 8
binl = struct.unpack('<I', b[20 + jl:24 + jl])[0]
BIN = b[bin_off:bin_off + binl]
CT = {5126: ('f', 4), 5123: ('H', 2), 5121: ('B', 1), 5125: ('I', 4)}
N = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}

def values(ai):
    a = j['accessors'][ai]; v = j['bufferViews'][a['bufferView']]
    fmt, sz = CT[a['componentType']]; n = N[a['type']]
    off = v.get('byteOffset', 0) + a.get('byteOffset', 0)
    flat = struct.unpack_from('<%d%s' % (a['count'] * n, fmt), BIN, off)
    return [flat[i * n:(i + 1) * n] for i in range(a['count'])]

def rest(node, path):
    nd = j['nodes'][node]
    return {'translation': nd.get('translation', [0, 0, 0]), 'rotation': nd.get('rotation', [0, 0, 0, 1]), 'scale': nd.get('scale', [1, 1, 1])}[path]

dropped = 0
for an in j.get('animations', []):
    keep = []
    for ch in an['channels']:
        out = values(an['samplers'][ch['sampler']]['output'])
        r = rest(ch['target']['node'], ch['target']['path'])
        if all(max(abs(x - y) for x, y in zip(v, r)) < 1e-4 for v in out): dropped += 1; continue
        keep.append(ch)
    # renumber samplers to those still used
    used = sorted({c['sampler'] for c in keep}); remap = {s: i for i, s in enumerate(used)}
    an['samplers'] = [an['samplers'][s] for s in used]
    for c in keep: c['sampler'] = remap[c['sampler']]
    an['channels'] = keep

# accessors still referenced, then the buffer views they need, repacked
ref = set()
for m in j['meshes']:
    for p in m['primitives']:
        ref.update(p['attributes'].values())
        if 'indices' in p: ref.add(p['indices'])
for s in j.get('skins', []):
    if 'inverseBindMatrices' in s: ref.add(s['inverseBindMatrices'])
for an in j.get('animations', []):
    for s in an['samplers']: ref.update((s['input'], s['output']))
order = sorted(ref); amap = {a: i for i, a in enumerate(order)}
pos_acc = {p['attributes']['POSITION'] for m in j['meshes'] for p in m['primitives']}
anim_in = {s['input'] for an in j.get('animations', []) for s in an['samplers']}
new_acc, new_bv, out = [], [], bytearray()
for a in order:
    acc = dict(j['accessors'][a]); v = j['bufferViews'][acc['bufferView']]
    fmt, sz = CT[acc['componentType']]; n = N[acc['type']]
    start = v.get('byteOffset', 0) + acc.get('byteOffset', 0); length = acc['count'] * n * sz
    while len(out) % 4: out.append(0)
    bv = {'buffer': 0, 'byteOffset': len(out), 'byteLength': length}
    if 'target' in v: bv['target'] = v['target']
    out += BIN[start:start + length]
    new_bv.append(bv); acc['bufferView'] = len(new_bv) - 1; acc.pop('byteOffset', None)
    if a not in pos_acc and a not in anim_in: acc.pop('min', None); acc.pop('max', None)
    acc.pop('name', None)
    new_acc.append(acc)
j['accessors'], j['bufferViews'] = new_acc, new_bv
j['buffers'] = [{'byteLength': len(out)}]
for m in j['meshes']:
    for p in m['primitives']:
        p['attributes'] = {k: amap[v] for k, v in p['attributes'].items()}
        if 'indices' in p: p['indices'] = amap[p['indices']]
for s in j.get('skins', []):
    if 'inverseBindMatrices' in s: s['inverseBindMatrices'] = amap[s['inverseBindMatrices']]
for an in j.get('animations', []):
    for s in an['samplers']: s['input'] = amap[s['input']]; s['output'] = amap[s['output']]
j.pop('asset', None); j['asset'] = {'version': '2.0'}

js = json.dumps(j, separators=(',', ':')).encode()
while len(js) % 4: js += b' '
while len(out) % 4: out.append(0)
total = 12 + 8 + len(js) + 8 + len(out)
glb = struct.pack('<III', 0x46546C67, 2, total) + struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(out), 0x004E4942) + bytes(out)
open(dst, 'wb').write(glb)
print('%s: %d -> %d bytes (json %d -> %d), %d constant channels dropped' % (dst, len(b), len(glb), jl, len(js), dropped))
