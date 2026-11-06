import type { Material, Mesh, Object3D, Texture } from "three";

function isTexture(value: unknown): value is Texture {
  return typeof value === "object" && value !== null && (value as Texture).isTexture === true;
}

function disposeMaterial(material: Material, textures: Set<Texture>): void {
  for (const value of Object.values(material)) {
    if (isTexture(value)) textures.add(value);
  }
  material.dispose();
}

/** Releases geometry, materials and textures owned by an imported scene. */
export function disposeObjectTree(root: Object3D): void {
  const textures = new Set<Texture>();
  root.traverse((object) => {
    const mesh = object as Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) material.forEach((m) => disposeMaterial(m, textures));
    else if (material) disposeMaterial(material, textures);
  });
  for (const texture of textures) {
    const image: unknown = texture.image;
    texture.dispose();
    if (typeof ImageBitmap !== "undefined" && image instanceof ImageBitmap) image.close();
  }
  root.removeFromParent();
}
