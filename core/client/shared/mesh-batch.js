import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

// Merges a parent's direct static mesh children into one mesh per material,
// so a low-detail race car costs a handful of draw calls instead of dozens
// (each one paid twice with shadows). Child groups (wheels, steering) are
// left alone, so their animation keeps working; batch them separately.
export function batchStaticMeshes(parent) {
  const buckets = new Map();
  parent.children.filter(o => o.isMesh).forEach(o => {
    o.updateMatrix();
    const geometry = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone());
    geometry.applyMatrix4(o.matrix);
    if (!buckets.has(o.material)) buckets.set(o.material, []);
    buckets.get(o.material).push(geometry);
    parent.remove(o); o.geometry.dispose();
  });
  for (const [material, geometries] of buckets) {
    const merged = new THREE.BufferGeometry();
    for (const key of ['position', 'normal', 'uv']) {
      // Procedural shells have no UVs; supply zero UVs for solid paint.
      const size = key === 'uv' ? 2 : 3;
      const length = geometries.reduce((n, g) => n + g.attributes.position.count * size, 0);
      const array = new Float32Array(length); let offset = 0;
      for (const g of geometries) { const a = g.attributes[key]; if (a) array.set(a.array, offset); offset += g.attributes.position.count * size; }
      merged.setAttribute(key, new THREE.BufferAttribute(array, size));
    }
    const m = new THREE.Mesh(merged, material);
    m.castShadow = true; m.receiveShadow = true;
    parent.add(m);
    geometries.forEach(g => g.dispose());
  }
}

// Batches every group in a model, the root included.
export function batchModel(root) {
  const parents = [];
  root.traverse(o => { if (o.children.some(c => c.isMesh)) parents.push(o); });
  parents.forEach(batchStaticMeshes);
}
