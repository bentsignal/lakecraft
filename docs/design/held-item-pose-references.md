# Held-item pose references

Reviewed 2026-08-02 for screen-space composition only. These pages did not
supply textures, meshes, screenshots, or other production assets. See
[the visual asset pipeline](visual-assets.md) for the assets Lakecraft does use.

- [Dirt Platform gallery](https://www.curseforge.com/minecraft/mc-mods/dirt-platform/gallery).
  First-person block and hotbar scenes show the compact lower-right grip. A
  held cube should read as a small object, with a useful top plane and two
  vertical planes instead of a front-on wall of texture.
- [Battleaxe Addon gallery](https://modbay.org/mods/40-battleaxe-addon.html).
  The axe silhouette runs from a lower-right grip to an upper-left head. The
  head is above the hand and canted into the scene rather than rotated sideways
  around the screen.
- [Reinforced Tools gallery](https://www.curseforge.com/minecraft/mc-mods/reinforced-tools).
  Pickaxe references retain the same diagonal handle but need a clearly
  transverse head and projecting pick point. Lakecraft uses the silhouette only,
  not this pack's reinforced art or materials.
- [Mojang bug tracker MC-155379](https://bugs.mojang.com/browse/MC/issues/MC-155379)
  and [Bow Charger gallery](https://www.curseforge.com/minecraft/texture-packs/bow-charger).
  Bow draw occupies a taller area on the right while the shot still reads as
  aiming into the crosshair. The bow presentation does not need an unrelated
  ordinary one-arm mesh layered beneath it.

## Implementation observations

- Lakecraft's old cube used a negative X rotation, turning the top normal away
  from the camera. A positive pitch restores the top face while retaining two
  adjacent vertical faces.
- Tool boxes already used the correct swing timing and wrist pivot; only their
  authored idle geometry needed real depth and clearer head/handle alignment.
- The old bow arrow lived at one constant Z and traversed screen X, so a correct
  camera-ray shot looked sideways. The revised visual shaft travels through Z
  from the bow nock toward a model-space point that resolves to camera-space
  crosshair center. Combat still derives its projectile direction from the
  camera ray in `voxelEngine.ts`.
