/**
 * Pure OOXML color, EMU geometry, coordinate transform, and theme resolution utilities
 * for high-fidelity PowerPoint (.pptx) to PDF rendering.
 */

export const EMU_PER_POINT = 12700;
export const EMU_PER_PX = 9525; // At standard 96 DPI (914400 EMU/inch / 96 px/inch)

export interface RectBox {
  x: number;
  y: number;
  w: number;
  h: number;
  rot?: number; // degrees
  flipH?: boolean;
  flipV?: boolean;
}

export interface GroupTransform {
  offX: number;
  offY: number;
  extX: number;
  extY: number;
  chOffX: number;
  chOffY: number;
  chExtX: number;
  chExtY: number;
  rot?: number;
  flipH?: boolean;
  flipV?: boolean;
}

export interface ColorModifiers {
  lumMod?: number; // 0..100000 (e.g. 75000 = 75%)
  lumOff?: number; // -100000..100000
  tint?: number; // 0..100000
  shade?: number; // 0..100000
  satMod?: number; // 0..200000+
  satOff?: number;
  alpha?: number; // 0..100000
}

export interface PptxTheme {
  colors: Record<string, string>; // dk1, lt1, dk2, lt2, accent1..6, hlink, folHlink -> hex without #
  clrMap: Record<string, string>; // bg1 -> lt1, tx1 -> dk1, etc.
  majorFont: string;
  minorFont: string;
}

export const DEFAULT_PPTX_THEME: PptxTheme = {
  colors: {
    dk1: '000000',
    lt1: 'FFFFFF',
    dk2: '1F497D',
    lt2: 'EEECE1',
    accent1: '4F81BD',
    accent2: 'C0504D',
    accent3: '9BBB59',
    accent4: '8064A2',
    accent5: '4BACC6',
    accent6: 'F79646',
    hlink: '0000FF',
    folHlink: '800080',
  },
  clrMap: {
    bg1: 'lt1',
    tx1: 'dk1',
    bg2: 'lt2',
    tx2: 'dk2',
    accent1: 'accent1',
    accent2: 'accent2',
    accent3: 'accent3',
    accent4: 'accent4',
    accent5: 'accent5',
    accent6: 'accent6',
    hlink: 'hlink',
    folHlink: 'folHlink',
  },
  majorFont: 'Calibri Light',
  minorFont: 'Calibri',
};

export const PRESET_COLORS: Record<string, string> = {
  black: '000000',
  white: 'FFFFFF',
  red: 'FF0000',
  green: '008000',
  blue: '0000FF',
  yellow: 'FFFF00',
  cyan: '00FFFF',
  magenta: 'FF00FF',
  gray: '808080',
  grey: '808080',
  dkGray: 'A9A9A9',
  ltGray: 'D3D3D3',
  silver: 'C0C0C0',
  maroon: '800000',
  navy: '000080',
  olive: '808000',
  purple: '800080',
  teal: '008080',
  orange: 'FFA500',
  gold: 'FFD700',
  pink: 'FFC0CB',
  brown: 'A52A2A',
  lime: '00FF00',
  aqua: '00FFFF',
  fuchsia: 'FF00FF',
  dkBlue: '00008B',
  dkGreen: '006400',
  dkRed: '8B0000',
  ltBlue: 'ADD8E6',
  ltGreen: '90EE90',
  skyBlue: '87CEEB',
  steelBlue: '4682B4',
  slateGray: '708090',
  dimGray: '696969',
  whiteSmoke: 'F5F5F5',
  ghostWhite: 'F8F8FF',
  ivory: 'FFFFF0',
  beige: 'F5F5DC',
  coral: 'FF7F50',
  crimson: 'DC143C',
  indigo: '4B0082',
  turquoise: '40E0D0',
  violet: 'EE82EE',
};

export function emuToPx(emu: number): number {
  return emu / EMU_PER_PX;
}

export function emuToPt(emu: number): number {
  return emu / EMU_PER_POINT;
}

/**
 * Transforms a child bounding box inside a <p:grpSp> into parent/slide EMU coordinates.
 */
export function transformChildBoxInGroup(child: RectBox, group: GroupTransform): RectBox {
  const chExtX = group.chExtX || group.extX || 1;
  const chExtY = group.chExtY || group.extY || 1;
  const scaleX = group.extX / chExtX;
  const scaleY = group.extY / chExtY;

  let relX = (child.x - group.chOffX) * scaleX;
  let relY = (child.y - group.chOffY) * scaleY;
  const w = child.w * scaleX;
  const h = child.h * scaleY;

  if (group.flipH) {
    relX = group.extX - relX - w;
  }
  if (group.flipV) {
    relY = group.extY - relY - h;
  }

  return {
    x: group.offX + relX,
    y: group.offY + relY,
    w,
    h,
    rot: ((child.rot || 0) + (group.rot || 0)) % 360,
    flipH: Boolean(child.flipH) !== Boolean(group.flipH),
    flipV: Boolean(child.flipV) !== Boolean(group.flipV),
  };
}

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rn:
        h = (gn - bn) / d + (gn < bn ? 6 : 0);
        break;
      case gn:
        h = (bn - rn) / d + 2;
        break;
      default:
        h = (rn - gn) / d + 4;
        break;
    }
    h /= 6;
  }
  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) {
    const v = clampByte(l * 255);
    return [v, v, v];
  }
  const hue2rgb = (p: number, q: number, t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    clampByte(hue2rgb(p, q, h + 1 / 3) * 255),
    clampByte(hue2rgb(p, q, h) * 255),
    clampByte(hue2rgb(p, q, h - 1 / 3) * 255),
  ];
}

/**
 * Applies OOXML color modifiers (tint, shade, lumMod, lumOff, satMod, satOff, alpha)
 * to a 6-digit hex color string and returns a CSS color (`#rrggbb` or `rgba(...)`).
 */
export function applyColorModifiers(baseHex: string, mods?: ColorModifiers): string {
  const clean = baseHex.replace(/^#/, '').trim();
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return '#000000';

  let r = parseInt(clean.slice(0, 2), 16);
  let g = parseInt(clean.slice(2, 4), 16);
  let b = parseInt(clean.slice(4, 6), 16);
  let alpha = 1;

  if (mods) {
    // OOXML tint: blend toward white
    if (mods.tint !== undefined) {
      const f = mods.tint / 100000;
      r = clampByte(r * f + 255 * (1 - f));
      g = clampByte(g * f + 255 * (1 - f));
      b = clampByte(b * f + 255 * (1 - f));
    }

    // OOXML shade: blend toward black
    if (mods.shade !== undefined) {
      const f = mods.shade / 100000;
      r = clampByte(r * f);
      g = clampByte(g * f);
      b = clampByte(b * f);
    }

    // OOXML HSL luminance/saturation transforms
    if (
      mods.lumMod !== undefined ||
      mods.lumOff !== undefined ||
      mods.satMod !== undefined ||
      mods.satOff !== undefined
    ) {
      let [h, s, l] = rgbToHsl(r, g, b);
      if (mods.satMod !== undefined) s = Math.max(0, Math.min(1, s * (mods.satMod / 100000)));
      if (mods.satOff !== undefined) s = Math.max(0, Math.min(1, s + mods.satOff / 100000));
      if (mods.lumMod !== undefined) l = Math.max(0, Math.min(1, l * (mods.lumMod / 100000)));
      if (mods.lumOff !== undefined) l = Math.max(0, Math.min(1, l + mods.lumOff / 100000));
      [r, g, b] = hslToRgb(h, s, l);
    }

    if (mods.alpha !== undefined) {
      alpha = Math.max(0, Math.min(1, mods.alpha / 100000));
    }
  }

  if (alpha < 0.999) {
    return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
  }

  const toHex = (n: number) => clampByte(n).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Resolves a scheme color token (e.g. 'tx1', 'bg1', 'accent1', 'dk1') through
 * the slide master's color map and the deck's theme color scheme.
 */
export function resolveSchemeColorHex(
  token: string,
  theme: PptxTheme,
  placeholderColorHex?: string
): string {
  if (!token) return '000000';
  if (token === 'phClr' && placeholderColorHex) {
    return placeholderColorHex.replace(/^#/, '');
  }
  const mapped = theme.clrMap[token] || token;
  if (theme.colors[mapped]) return theme.colors[mapped];
  if (theme.colors[token]) return theme.colors[token];
  if (DEFAULT_PPTX_THEME.colors[mapped]) return DEFAULT_PPTX_THEME.colors[mapped];
  return '000000';
}

/**
 * Resolves an OOXML typeface name (including +mj-lt / +mn-lt theme font placeholders)
 * into a clean CSS font-family stack with reliable metric-compatible fallbacks.
 */
export function resolveFontFamilyCss(typeface: string | undefined, theme: PptxTheme): string {
  let name = (typeface || '').trim();
  if (!name || name === '+mn-lt' || name === '+mn-ea' || name === '+mn-cs') {
    name = theme.minorFont || 'Calibri';
  } else if (name === '+mj-lt' || name === '+mj-ea' || name === '+mj-cs') {
    name = theme.majorFont || 'Calibri Light';
  }

  const safeName = name.replace(/['"]/g, '');
  const lower = safeName.toLowerCase();
  if (lower.includes('times') || lower.includes('georgia') || lower.includes('cambria') || lower.includes('garamond')) {
    return `'${safeName}', Georgia, 'Times New Roman', serif`;
  }
  if (lower.includes('courier') || lower.includes('consolas') || lower.includes('mono') || lower.includes('menlo')) {
    return `'${safeName}', 'Courier New', Consolas, monospace`;
  }
  return `'${safeName}', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`;
}

/**
 * Resolves a relative OOXML target path (e.g. '../media/image1.png' from 'ppt/slides/slide1.xml')
 * to its normalized zip entry path ('ppt/media/image1.png').
 */
export function resolveZipTargetPath(baseFilePath: string, target: string): string {
  if (!target) return '';
  if (target.startsWith('/')) return target.slice(1);
  const baseParts = baseFilePath.split('/').slice(0, -1);
  const targetParts = target.split('/');
  const combined = [...baseParts];
  for (const part of targetParts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      combined.pop();
    } else {
      combined.push(part);
    }
  }
  return combined.join('/');
}

/**
 * Formats an auto-numbered list bullet marker according to OOXML `buAutoNum` type.
 */
export function formatAutoNumberBullet(type: string, index1Based: number): string {
  const n = Math.max(1, index1Based);
  const toAlpha = (num: number, upper: boolean) => {
    const code = ((num - 1) % 26) + (upper ? 65 : 97);
    return String.fromCharCode(code);
  };
  const toRoman = (num: number, upper: boolean) => {
    const vals: [number, string][] = [
      [1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'],
      [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'],
      [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i'],
    ];
    let rem = num;
    let out = '';
    for (const [v, sym] of vals) {
      while (rem >= v) {
        out += sym;
        rem -= v;
      }
    }
    return upper ? out.toUpperCase() : out;
  };

  switch (type) {
    case 'arabicParenR':
      return `${n})`;
    case 'arabicParenBoth':
      return `(${n})`;
    case 'alphaLcPeriod':
      return `${toAlpha(n, false)}.`;
    case 'alphaUcPeriod':
      return `${toAlpha(n, true)}.`;
    case 'alphaLcParenR':
      return `${toAlpha(n, false)})`;
    case 'alphaUcParenR':
      return `${toAlpha(n, true)})`;
    case 'romanLcPeriod':
      return `${toRoman(n, false)}.`;
    case 'romanUcPeriod':
      return `${toRoman(n, true)}.`;
    case 'arabicPeriod':
    default:
      return `${n}.`;
  }
}
