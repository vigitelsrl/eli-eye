// The five effect pages, laid out as 3×3 grids with Normal in the middle.
// kind: 'color' | 'distort' (plain shaders), 'face' (needs face tracking),
//       'backdrop' (needs segmentation), 'user' (segmentation + a dropped image).

const NORMAL = { id: 'normal', name: 'Normal', kind: 'color' };

const fx = (id, name, kind) => ({ id, name, kind });

export const PAGES = [
  [
    fx('sepia', 'Sepia', 'color'), fx('bw', 'Black & White', 'color'), fx('glow', 'Glow', 'color'),
    fx('comic', 'Comic Book', 'color'), NORMAL, fx('pencil', 'Colored Pencil', 'color'),
    fx('thermal', 'Thermal Camera', 'color'), fx('xray', 'X-Ray', 'color'), fx('popart', 'Pop Art', 'color'),
  ],
  [
    fx('bulge', 'Bulge', 'distort'), fx('dent', 'Dent', 'distort'), fx('twirl', 'Twirl', 'distort'),
    fx('squeeze', 'Squeeze', 'distort'), NORMAL, fx('mirror', 'Mirror', 'distort'),
    fx('tunnel', 'Light Tunnel', 'distort'), fx('fisheye', 'Fish Eye', 'distort'), fx('stretch', 'Stretch', 'distort'),
  ],
  [
    fx('bugout', 'Bug Out', 'face'), fx('chipmunk', 'Chipmunk', 'face'), fx('lovestruck', 'Lovestruck', 'face'),
    fx('dizzy', 'Dizzy', 'face'), NORMAL, fx('nosetwirl', 'Nose Twirl', 'face'),
    fx('frog', 'Frog', 'face'), fx('blockhead', 'Blockhead', 'face'), fx('pinhead', 'Pinhead', 'face'),
  ],
  [
    fx('clouds', 'Clouds', 'backdrop'), fx('dots', 'Color Dots', 'backdrop'), fx('sunset', 'Sunset', 'backdrop'),
    fx('earth', 'Earth', 'backdrop'), NORMAL, fx('moon', 'Moon', 'backdrop'),
    fx('aquarium', 'Fish', 'backdrop'), fx('aurora', 'Aurora', 'backdrop'), fx('rainbow', 'Rainbow', 'backdrop'),
  ],
  [1, 2, 3, 4, null, 5, 6, 7, 8].map((slot) =>
    slot === null ? NORMAL : { id: `user${slot}`, name: '', kind: 'user', slot }),
];

export { NORMAL };

export function findEffect(id) {
  for (const page of PAGES) for (const e of page) if (e.id === id) return e;
  return NORMAL;
}

export function pageOf(effect) {
  return PAGES.findIndex((p) => p.some((e) => e.id === effect.id && e.id !== 'normal'));
}
