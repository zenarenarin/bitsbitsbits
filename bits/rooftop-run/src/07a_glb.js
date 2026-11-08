// =====================================================================
// A compact GLB (binary glTF 2.0) reader.
//
// Plethora's library registry carries three.js core only, with no
// GLTFLoader, and Bits cannot ship asset files, so character assets are
// embedded in main.js as base64 and decoded here. It reads the subset
// Blender exports for a game character: accessors, the node hierarchy,
// (skinned) meshes, simple PBR materials, and TRS animations. Output is
// plain three.js: Bones, a Skeleton, SkinnedMeshes and AnimationClips,
// so THREE.AnimationMixer does playback and blending.
//
// Not supported (not needed for the cat): textures, morph targets,
// cameras, lights, sparse accessors, CUBICSPLINE interpolation.
// =====================================================================

function b64ToBytes(b64) {
  const s = atob(b64), out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

// makeMaterial(gltfMaterial, { skinned, vertexColors }) -> THREE.Material (optional)
function readGLB(THREE, bytes, makeMaterial) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('not a GLB file');
  let off = 12, json = null, bin = null;
  while (off < bytes.byteLength) {
    const len = dv.getUint32(off, true), type = dv.getUint32(off + 4, true);
    const chunk = bytes.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(chunk));
    else if (type === 0x004e4942) bin = chunk;
    off += 8 + len;
  }
  if (!json) throw new Error('GLB has no JSON chunk');

  const COMP = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
  const SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
  const cache = new Map();
  function accessor(i) {
    if (cache.has(i)) return cache.get(i);
    const a = json.accessors[i], bv = json.bufferViews[a.bufferView], T = COMP[a.componentType], n = SIZE[a.type];
    const base = bin.byteOffset + (bv.byteOffset || 0) + (a.byteOffset || 0), stride = bv.byteStride || 0, el = n * T.BYTES_PER_ELEMENT;
    let arr;
    if (!stride || stride === el) arr = new T(bin.buffer.slice(base, base + a.count * el));
    else {   // interleaved: copy out
      arr = new T(a.count * n); const src = new DataView(bin.buffer);
      const get = { 1: 'getInt8', 2: 'getUint16', 4: 'getFloat32' };
      for (let k = 0; k < a.count; k++) for (let c = 0; c < n; c++) {
        const p = base + k * stride + c * T.BYTES_PER_ELEMENT;
        arr[k * n + c] = T === Float32Array ? src.getFloat32(p, true) : T === Uint16Array ? src.getUint16(p, true) : T === Uint8Array ? src.getUint8(p) : src[get[T.BYTES_PER_ELEMENT]](p, true);
      }
    }
    const out = { arr, n, normalized: !!a.normalized, count: a.count, T };
    cache.set(i, out);
    return out;
  }
  const attr = i => { const a = accessor(i); return new THREE.BufferAttribute(a.arr, a.n, a.normalized); };

  // nodes: bones for skin joints, groups otherwise
  const jointSet = new Set(); for (const s of json.skins || []) for (const j of s.joints) jointSet.add(j);
  const names = new Set();
  const objs = json.nodes.map((nd, i) => {
    const o = jointSet.has(i) ? new THREE.Bone() : new THREE.Group();
    let name = THREE.PropertyBinding.sanitizeNodeName(nd.name || 'node_' + i);
    while (names.has(name)) name += '_'; names.add(name); o.name = name;
    if (nd.matrix) new THREE.Matrix4().fromArray(nd.matrix).decompose(o.position, o.quaternion, o.scale);
    else {
      if (nd.translation) o.position.fromArray(nd.translation);
      if (nd.rotation) o.quaternion.fromArray(nd.rotation);
      if (nd.scale) o.scale.fromArray(nd.scale);
    }
    return o;
  });
  json.nodes.forEach((nd, i) => { for (const c of nd.children || []) objs[i].add(objs[c]); });

  const materials = (json.materials || []).map(m => m);
  const meshes = [], binds = [];
  json.nodes.forEach((nd, i) => {
    if (nd.mesh === undefined) return;
    const skin = nd.skin !== undefined ? json.skins[nd.skin] : null;
    let skeleton = null;
    if (skin) {
      const ibm = skin.inverseBindMatrices !== undefined ? accessor(skin.inverseBindMatrices).arr : null;
      const bones = skin.joints.map(j => objs[j]);
      const inv = skin.joints.map((_, k) => ibm ? new THREE.Matrix4().fromArray(ibm, k * 16) : new THREE.Matrix4());
      skeleton = new THREE.Skeleton(bones, inv);
    }
    for (const prim of json.meshes[nd.mesh].primitives) {
      const g = new THREE.BufferGeometry(), A = prim.attributes;
      g.setAttribute('position', attr(A.POSITION));
      if (A.NORMAL !== undefined) g.setAttribute('normal', attr(A.NORMAL)); else g.computeVertexNormals();
      if (A.TEXCOORD_0 !== undefined) g.setAttribute('uv', attr(A.TEXCOORD_0));
      if (A.COLOR_0 !== undefined) { const c = accessor(A.COLOR_0); g.setAttribute('color', new THREE.BufferAttribute(c.n === 4 ? (() => { const o = new Float32Array(c.count * 3), s = c.normalized && c.T !== Float32Array ? 1 / (c.T === Uint8Array ? 255 : 65535) : 1; for (let k = 0; k < c.count; k++) for (let j = 0; j < 3; j++) o[k * 3 + j] = c.arr[k * 4 + j] * s; return o; })() : c.arr, 3)); }
      if (skin) {
        const j = accessor(A.JOINTS_0), w = accessor(A.WEIGHTS_0);
        g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(Uint16Array.from(j.arr), 4));
        g.setAttribute('skinWeight', new THREE.BufferAttribute(w.T === Float32Array ? w.arr : Float32Array.from(w.arr, v => v / (w.T === Uint8Array ? 255 : 65535)), 4));
      }
      if (prim.indices !== undefined) { const ix = accessor(prim.indices); g.setIndex(new THREE.BufferAttribute(ix.arr, 1)); }
      g.computeBoundingSphere();
      const gm = prim.material !== undefined ? materials[prim.material] : {};
      const opts = { skinned: !!skin, vertexColors: A.COLOR_0 !== undefined };
      let mat = makeMaterial && makeMaterial(gm, opts);
      if (!mat) {
        const pbr = gm.pbrMetallicRoughness || {}, bc = pbr.baseColorFactor || [1, 1, 1, 1], em = gm.emissiveFactor || [0, 0, 0];
        const es = (gm.extensions && gm.extensions.KHR_materials_emissive_strength && gm.extensions.KHR_materials_emissive_strength.emissiveStrength) || 1;
        // glTF factors are linear, which is three's working space: no conversion
        mat = new THREE.MeshLambertMaterial({ color: new THREE.Color().fromArray(bc), emissive: new THREE.Color(em[0] * es, em[1] * es, em[2] * es), vertexColors: opts.vertexColors });
      }
      mat.name = gm.name || mat.name;
      const m = skin ? new THREE.SkinnedMesh(g, mat) : new THREE.Mesh(g, mat);
      m.name = (nd.name || 'mesh') + (json.meshes[nd.mesh].primitives.length > 1 ? '_' + meshes.length : '');
      objs[i].add(m);
      if (skin) binds.push([m, skeleton]);
      meshes.push(m);
    }
  });

  // animations: one clip per glTF animation; tracks bind by node name
  const PATH = { translation: 'position', rotation: 'quaternion', scale: 'scale' };
  const animations = (json.animations || []).map(an => {
    const tracks = [];
    for (const ch of an.channels) {
      const path = PATH[ch.target.path]; if (!path || ch.target.node === undefined) continue;
      const smp = an.samplers[ch.sampler], times = accessor(smp.input).arr, vals = accessor(smp.output).arr;
      const name = objs[ch.target.node].name + '.' + path;
      const interp = smp.interpolation === 'STEP' ? THREE.InterpolateDiscrete : THREE.InterpolateLinear;
      const T = path === 'quaternion' ? THREE.QuaternionKeyframeTrack : THREE.VectorKeyframeTrack;
      tracks.push(new T(name, Float32Array.from(times), Float32Array.from(vals), interp));
    }
    return new THREE.AnimationClip(an.name || 'clip', -1, tracks);
  });

  const scene = new THREE.Group();
  const roots = (json.scenes && json.scenes[json.scene || 0] ? json.scenes[json.scene || 0].nodes : json.nodes.map((_, i) => i).filter(i => !json.nodes.some(n => (n.children || []).includes(i))));
  for (const r of roots) scene.add(objs[r]);
  scene.updateMatrixWorld(true);
  // bind once the hierarchy is assembled, against each mesh's world transform
  for (const [m, sk] of binds) m.bind(sk, m.matrixWorld);
  return { scene, animations, meshes, json };
}
