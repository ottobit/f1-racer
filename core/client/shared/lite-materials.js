import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

// Phone-only shader diet (#357), at full frame rate: every pixel of a
// matte surface (grass, sand, concrete, dry asphalt) and of the rival cars
// is shaded with a cheaper model that looks the same at race distance.
//   - MeshStandard with roughness >= 0.85 and no metalness -> MeshLambert
//     (same diffuse term; the specular lobe it drops is invisible that rough)
//   - MeshPhysical (clearcoat paint, glass) -> MeshStandard
// Wet asphalt (roughness .32) keeps its reflections. Converted once, after
// the scene is built; shared materials stay shared. `skip` subtrees (the
// player's own car) keep their full materials.
const MATTE_ROUGHNESS = 0.85;

function toLambert(source) {
  const lite = new THREE.MeshLambertMaterial();
  THREE.Material.prototype.copy.call(lite, source);
  lite.color.copy(source.color);
  lite.map = source.map;
  lite.emissive.copy(source.emissive);
  lite.emissiveMap = source.emissiveMap;
  lite.emissiveIntensity = source.emissiveIntensity;
  lite.flatShading = source.flatShading;
  return lite;
}

function liteVersion(material) {
  if (material.isMeshPhysicalMaterial) return new THREE.MeshStandardMaterial().copy(material);
  if (material.isMeshStandardMaterial && material.roughness >= MATTE_ROUGHNESS && material.metalness <= 0.05) return toLambert(material);
  return null;
}

export function simplifyMaterials(root, { skip = [] } = {}) {
  const cache = new Map();
  const convert = (material) => {
    if (!cache.has(material)) cache.set(material, liteVersion(material) ?? material);
    return cache.get(material);
  };
  (function walk(object) {
    if (skip.includes(object)) return;
    if (object.isMesh && !Array.isArray(object.material)) object.material = convert(object.material);
    object.children.forEach(walk);
  })(root);
  for (const [from, to] of cache) if (from !== to) from.dispose();
}
