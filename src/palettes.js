export const PALETTES = Object.freeze({
  spectrum: {
    label: 'Spectrum',
    colors: ['#7C3AED', '#2563EB', '#06B6D4', '#F59E0B', '#F43F5E', '#EC4899'],
  },
  electric: {
    label: 'Electric',
    colors: ['#6D5DFB', '#00D4FF', '#00F5A0', '#FFE66D', '#FF5C8A'],
  },
  sunset: {
    label: 'Sunset',
    colors: ['#5B21B6', '#C026D3', '#F43F5E', '#FB923C', '#FDE047'],
  },
  ocean: {
    label: 'Ocean',
    colors: ['#172554', '#1D4ED8', '#0891B2', '#2DD4BF', '#A7F3D0'],
  },
  candy: {
    label: 'Candy',
    colors: ['#8B5CF6', '#EC4899', '#FB7185', '#FBBF24', '#38BDF8'],
  },
  ember: {
    label: 'Ember',
    colors: ['#450A0A', '#B91C1C', '#F97316', '#FBBF24', '#FEF3C7'],
  },
});

export function getPalette(paletteId = 'spectrum') {
  return PALETTES[paletteId] ?? PALETTES.spectrum;
}

export function toColorscale(colors) {
  if (colors.length === 1) return [[0, colors[0]], [1, colors[0]]];
  return colors.map((color, index) => [index / (colors.length - 1), color]);
}

export function categoricalColors(values, paletteId = 'spectrum') {
  const colors = getPalette(paletteId).colors;
  const assigned = new Map();
  return values.map((value) => {
    const key = value === null || value === undefined || value === '' ? 'Unspecified' : String(value);
    if (!assigned.has(key)) assigned.set(key, colors[assigned.size % colors.length]);
    return assigned.get(key);
  });
}

