import JSZip from 'jszip';
import html2canvas from 'html2canvas-pro';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { EngineOutput, RenderedPageThumbnail } from '../types/pdf';
import {
  ColorModifiers,
  DEFAULT_PPTX_THEME,
  GroupTransform,
  PRESET_COLORS,
  PptxTheme,
  RectBox,
  applyColorModifiers,
  emuToPt,
  emuToPx,
  formatAutoNumberBullet,
  resolveFontFamilyCss,
  resolveSchemeColorHex,
  resolveZipTargetPath,
  transformChildBoxInGroup,
} from './pptxColorAndMath';

/* -------------------------------------------------------------------------- */
/* XML DOM HELPERS (Namespace-agnostic & mc:AlternateContent aware)           */
/* -------------------------------------------------------------------------- */

function parseXml(xmlText: string): Document | null {
  if (typeof DOMParser === 'undefined') return null;
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) return null;
  return doc;
}

function directChildren(el: Element | null | undefined, localName?: string): Element[] {
  if (!el) return [];
  const res: Element[] = [];
  for (let i = 0; i < el.children.length; i++) {
    const child = el.children[i];
    if (child.localName === 'AlternateContent') {
      // Unwrap mc:AlternateContent preferring Fallback for broadest compatibility, else Choice
      const fallback = directChildren(child, 'Fallback')[0];
      const choice = directChildren(child, 'Choice')[0];
      const branch = fallback || choice;
      if (branch) {
        const inner = directChildren(branch, localName);
        res.push(...inner);
      }
      continue;
    }
    if (!localName || child.localName === localName) {
      res.push(child);
    }
  }
  return res;
}

function firstChild(el: Element | null | undefined, localName: string): Element | null {
  return directChildren(el, localName)[0] || null;
}

function firstDescendant(el: Element | Document | null | undefined, localName: string): Element | null {
  if (!el) return null;
  const list = el.getElementsByTagNameNS('*', localName);
  return list.length > 0 ? list[0] : null;
}

function allDescendants(el: Element | Document | null | undefined, localName: string): Element[] {
  if (!el) return [];
  return Array.from(el.getElementsByTagNameNS('*', localName));
}

function attr(el: Element | null | undefined, name: string): string | null {
  if (!el) return null;
  const v = el.getAttribute(name);
  if (v !== null) return v;
  // Also check namespaced attributes like r:embed, r:id, r:blip
  for (let i = 0; i < el.attributes.length; i++) {
    const a = el.attributes[i];
    if (a.localName === name || a.name === name) return a.value;
  }
  return null;
}

function attrNum(el: Element | null | undefined, name: string, fallback = 0): number {
  const v = attr(el, name);
  if (v === null || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* -------------------------------------------------------------------------- */
/* OOXML RELATIONSHIPS, THEME & COLOR EXTRACTION                              */
/* -------------------------------------------------------------------------- */

interface RelMap {
  [rId: string]: { type: string; target: string };
}

async function readRels(zip: JSZip, ownerPath: string): Promise<RelMap> {
  const parts = ownerPath.split('/');
  const fileName = parts.pop()!;
  const dir = parts.join('/');
  const relsPath = dir ? `${dir}/_rels/${fileName}.rels` : `_rels/${fileName}.rels`;
  const entry = zip.files[relsPath];
  if (!entry) return {};
  const xml = await entry.async('string');
  const doc = parseXml(xml);
  if (!doc) return {};
  const map: RelMap = {};
  for (const rel of allDescendants(doc, 'Relationship')) {
    const id = attr(rel, 'Id');
    const target = attr(rel, 'Target') || '';
    const type = attr(rel, 'Type') || '';
    if (id) {
      map[id] = {
        type,
        target: resolveZipTargetPath(ownerPath, target),
      };
    }
  }
  return map;
}

function parseColorModifiers(colorNode: Element): ColorModifiers {
  const mods: ColorModifiers = {};
  for (const ch of directChildren(colorNode)) {
    const val = attrNum(ch, 'val', NaN);
    if (!Number.isFinite(val)) continue;
    switch (ch.localName) {
      case 'lumMod':
        mods.lumMod = val;
        break;
      case 'lumOff':
        mods.lumOff = val;
        break;
      case 'tint':
        mods.tint = val;
        break;
      case 'shade':
        mods.shade = val;
        break;
      case 'satMod':
        mods.satMod = val;
        break;
      case 'satOff':
        mods.satOff = val;
        break;
      case 'alpha':
        mods.alpha = val;
        break;
    }
  }
  return mods;
}

function resolveColorElement(
  parentEl: Element | null | undefined,
  theme: PptxTheme,
  placeholderHex?: string
): string | null {
  if (!parentEl) return null;
  const srgb = firstChild(parentEl, 'srgbClr');
  if (srgb) {
    const hex = attr(srgb, 'val') || '000000';
    return applyColorModifiers(hex, parseColorModifiers(srgb));
  }
  const scheme = firstChild(parentEl, 'schemeClr');
  if (scheme) {
    const token = attr(scheme, 'val') || 'tx1';
    const baseHex = resolveSchemeColorHex(token, theme, placeholderHex);
    return applyColorModifiers(baseHex, parseColorModifiers(scheme));
  }
  const sys = firstChild(parentEl, 'sysClr');
  if (sys) {
    const hex = attr(sys, 'lastClr') || (attr(sys, 'val') === 'window' ? 'FFFFFF' : '000000');
    return applyColorModifiers(hex, parseColorModifiers(sys));
  }
  const prst = firstChild(parentEl, 'prstClr');
  if (prst) {
    const name = attr(prst, 'val') || 'black';
    const hex = PRESET_COLORS[name] || PRESET_COLORS[name.toLowerCase()] || '000000';
    return applyColorModifiers(hex, parseColorModifiers(prst));
  }
  return null;
}

function parseThemeXml(themeDoc: Document | null, masterDoc: Document | null): PptxTheme {
  const theme: PptxTheme = {
    colors: { ...DEFAULT_PPTX_THEME.colors },
    clrMap: { ...DEFAULT_PPTX_THEME.clrMap },
    majorFont: DEFAULT_PPTX_THEME.majorFont,
    minorFont: DEFAULT_PPTX_THEME.minorFont,
  };

  if (themeDoc) {
    const clrScheme = firstDescendant(themeDoc, 'clrScheme');
    if (clrScheme) {
      for (const ch of directChildren(clrScheme)) {
        const key = ch.localName;
        const srgb = firstChild(ch, 'srgbClr');
        const sys = firstChild(ch, 'sysClr');
        const val = attr(srgb, 'val') || attr(sys, 'lastClr');
        if (val && /^[0-9a-fA-F]{6}$/.test(val)) {
          theme.colors[key] = val;
        }
      }
    }
    const fontScheme = firstDescendant(themeDoc, 'fontScheme');
    if (fontScheme) {
      const maj = firstChild(firstChild(fontScheme, 'majorFont'), 'latin');
      const min = firstChild(firstChild(fontScheme, 'minorFont'), 'latin');
      const majFace = attr(maj, 'typeface');
      const minFace = attr(min, 'typeface');
      if (majFace) theme.majorFont = majFace;
      if (minFace) theme.minorFont = minFace;
    }
  }

  if (masterDoc) {
    const clrMap = firstDescendant(masterDoc, 'clrMap');
    if (clrMap) {
      for (let i = 0; i < clrMap.attributes.length; i++) {
        const a = clrMap.attributes[i];
        if (a.value) theme.clrMap[a.localName] = a.value;
      }
    }
  }

  return theme;
}

/* -------------------------------------------------------------------------- */
/* FILL, STROKE, SHADOW, AND GEOMETRY EXTRACTION                              */
/* -------------------------------------------------------------------------- */

interface ResolvedFill {
  type: 'none' | 'solid' | 'gradient' | 'image';
  color?: string;
  gradientCss?: string;
  gradientSvg?: {
    isRadial: boolean;
    angleDeg: number;
    stops: { offsetPct: number; color: string }[];
  };
  imageUrl?: string;
  srcRect?: { l: number; t: number; r: number; b: number };
}

async function getMediaDataUrl(
  zip: JSZip,
  mediaPath: string,
  cache: Map<string, string>
): Promise<string | null> {
  if (!mediaPath) return null;
  if (cache.has(mediaPath)) return cache.get(mediaPath)!;
  const entry = zip.files[mediaPath];
  if (!entry) return null;

  const lower = mediaPath.toLowerCase();
  const mime = lower.endsWith('.png')
    ? 'image/png'
    : lower.endsWith('.jpg') || lower.endsWith('.jpeg')
    ? 'image/jpeg'
    : lower.endsWith('.gif')
    ? 'image/gif'
    : lower.endsWith('.webp')
    ? 'image/webp'
    : lower.endsWith('.svg')
    ? 'image/svg+xml'
    : lower.endsWith('.bmp')
    ? 'image/bmp'
    : null;

  if (!mime) return null; // Skip unsupported WMF/EMF binaries gracefully
  const base64 = await entry.async('base64');
  const url = `data:${mime};base64,${base64}`;
  cache.set(mediaPath, url);
  return url;
}

async function resolveFill(
  containerEl: Element | null | undefined,
  rels: RelMap,
  zip: JSZip,
  theme: PptxTheme,
  mediaCache: Map<string, string>,
  placeholderHex?: string
): Promise<ResolvedFill | null> {
  if (!containerEl) return null;

  if (firstChild(containerEl, 'noFill')) {
    return { type: 'none' };
  }

  const solid = firstChild(containerEl, 'solidFill');
  if (solid) {
    const color = resolveColorElement(solid, theme, placeholderHex);
    if (color) return { type: 'solid', color };
  }

  const grad = firstChild(containerEl, 'gradFill');
  if (grad) {
    const gsLst = firstChild(grad, 'gsLst');
    const stops: { offsetPct: number; color: string }[] = [];
    for (const gs of directChildren(gsLst, 'gs')) {
      const pos = attrNum(gs, 'pos', 0) / 1000; // 0..100
      const c = resolveColorElement(gs, theme, placeholderHex) || '#ffffff';
      stops.push({ offsetPct: Math.max(0, Math.min(100, pos)), color: c });
    }
    stops.sort((a, b) => a.offsetPct - b.offsetPct);
    if (stops.length > 0) {
      const lin = firstChild(grad, 'lin');
      const path = firstChild(grad, 'path');
      // OOXML linear gradient angle: 0 = left-to-right (CSS 90deg), 5400000 (90deg) = top-to-bottom (CSS 180deg)
      const ooxmlDeg = lin ? attrNum(lin, 'ang', 0) / 60000 : 90;
      const cssDeg = (ooxmlDeg + 90) % 360;
      const stopStr = stops.map((s) => `${s.color} ${s.offsetPct.toFixed(1)}%`).join(', ');
      const isRadial = Boolean(path && !lin);
      return {
        type: 'gradient',
        gradientCss: isRadial
          ? `radial-gradient(circle, ${stopStr})`
          : `linear-gradient(${cssDeg.toFixed(1)}deg, ${stopStr})`,
        gradientSvg: { isRadial, angleDeg: cssDeg, stops },
      };
    }
  }

  const blipFill = firstChild(containerEl, 'blipFill');
  if (blipFill) {
    const blip = firstChild(blipFill, 'blip');
    const rId = attr(blip, 'embed') || attr(blip, 'link');
    if (rId && rels[rId]) {
      const url = await getMediaDataUrl(zip, rels[rId].target, mediaCache);
      if (url) {
        const srcRectEl = firstChild(blipFill, 'srcRect');
        const srcRect = srcRectEl
          ? {
              l: attrNum(srcRectEl, 'l', 0),
              t: attrNum(srcRectEl, 't', 0),
              r: attrNum(srcRectEl, 'r', 0),
              b: attrNum(srcRectEl, 'b', 0),
            }
          : undefined;
        return { type: 'image', imageUrl: url, srcRect };
      }
    }
  }

  return null;
}

interface ResolvedStroke {
  widthPx: number;
  color: string;
  dashArray?: string;
  headEnd?: string;
  tailEnd?: string;
}

function resolveStroke(
  lnEl: Element | null | undefined,
  theme: PptxTheme,
  fallbackColor?: string
): ResolvedStroke | null {
  if (!lnEl) return null;
  if (firstChild(lnEl, 'noFill')) return null;

  const wEmu = attrNum(lnEl, 'w', 12700); // default 1pt
  const solid = firstChild(lnEl, 'solidFill');
  const grad = firstChild(lnEl, 'gradFill');
  let color = solid ? resolveColorElement(solid, theme) : null;
  if (!color && grad) {
    const firstGs = directChildren(firstChild(grad, 'gsLst'), 'gs')[0];
    color = resolveColorElement(firstGs, theme);
  }
  if (!color) color = fallbackColor || null;
  if (!color) return null;

  const prstDash = attr(firstChild(lnEl, 'prstDash'), 'val') || 'solid';
  const dashMap: Record<string, string> = {
    dot: '2 2',
    sysDot: '2 2',
    dash: '6 4',
    sysDash: '6 4',
    lgDash: '10 4',
    dashDot: '6 3 2 3',
    lgDashDot: '10 3 2 3',
  };

  const headEnd = attr(firstChild(lnEl, 'headEnd'), 'type') || undefined;
  const tailEnd = attr(firstChild(lnEl, 'tailEnd'), 'type') || undefined;

  return {
    widthPx: Math.max(0.75, emuToPx(wEmu)),
    color,
    dashArray: dashMap[prstDash],
    headEnd: headEnd && headEnd !== 'none' ? headEnd : undefined,
    tailEnd: tailEnd && tailEnd !== 'none' ? tailEnd : undefined,
  };
}

function resolveShadowCss(spPr: Element | null | undefined, theme: PptxTheme): string {
  const effectLst = firstChild(spPr, 'effectLst');
  const shdw = firstChild(effectLst, 'outerShdw');
  if (!shdw) return '';
  const blurPx = Math.max(2, emuToPx(attrNum(shdw, 'blurRad', 38100)));
  const distPx = emuToPx(attrNum(shdw, 'dist', 25400));
  const dirRad = ((attrNum(shdw, 'dir', 2700000) / 60000) * Math.PI) / 180;
  const dx = Math.cos(dirRad) * distPx;
  const dy = Math.sin(dirRad) * distPx;
  const color = resolveColorElement(shdw, theme) || 'rgba(0,0,0,0.22)';
  return `drop-shadow(${dx.toFixed(1)}px ${dy.toFixed(1)}px ${(blurPx * 0.5).toFixed(1)}px ${color})`;
}

/* -------------------------------------------------------------------------- */
/* PLACEHOLDER & MASTER TEXT STYLE INHERITANCE                                */
/* -------------------------------------------------------------------------- */

interface TextLevelStyle {
  fontSizePt?: number;
  bold?: boolean;
  italic?: boolean;
  color?: string;
  fontFamily?: string;
  align?: string;
  marLPx?: number;
  indentPx?: number;
  bulletChar?: string;
  bulletNone?: boolean;
  bulletAutoNum?: string;
}

interface PlaceholderDef {
  type: string;
  idx: string;
  box?: RectBox;
  spPr?: Element | null;
  levelStyles: Record<number, TextLevelStyle>;
  bodyAnchor?: string;
  bodyInsets?: { l: number; r: number; t: number; b: number };
}

function parseXfrm(xfrm: Element | null | undefined): RectBox | null {
  if (!xfrm) return null;
  const off = firstChild(xfrm, 'off');
  const ext = firstChild(xfrm, 'ext');
  if (!off || !ext) return null;
  return {
    x: attrNum(off, 'x', 0),
    y: attrNum(off, 'y', 0),
    w: attrNum(ext, 'cx', 0),
    h: attrNum(ext, 'cy', 0),
    rot: attrNum(xfrm, 'rot', 0) / 60000,
    flipH: attr(xfrm, 'flipH') === '1' || attr(xfrm, 'flipH') === 'true',
    flipV: attr(xfrm, 'flipV') === '1' || attr(xfrm, 'flipV') === 'true',
  };
}

function parseLevelStyle(pPrEl: Element | null | undefined, theme: PptxTheme): TextLevelStyle {
  const style: TextLevelStyle = {};
  if (!pPrEl) return style;

  const algn = attr(pPrEl, 'algn');
  if (algn) style.align = algn;
  const marL = attr(pPrEl, 'marL');
  if (marL !== null) style.marLPx = emuToPx(Number(marL));
  const indent = attr(pPrEl, 'indent');
  if (indent !== null) style.indentPx = emuToPx(Number(indent));

  if (firstChild(pPrEl, 'buNone')) {
    style.bulletNone = true;
  } else {
    const buChar = firstChild(pPrEl, 'buChar');
    if (buChar) style.bulletChar = attr(buChar, 'char') || '•';
    const buAuto = firstChild(pPrEl, 'buAutoNum');
    if (buAuto) style.bulletAutoNum = attr(buAuto, 'type') || 'arabicPeriod';
  }

  const defRPr = firstChild(pPrEl, 'defRPr');
  if (defRPr) {
    const sz = attr(defRPr, 'sz');
    if (sz) style.fontSizePt = Number(sz) / 100;
    const b = attr(defRPr, 'b');
    if (b !== null) style.bold = b === '1' || b === 'true';
    const it = attr(defRPr, 'i');
    if (it !== null) style.italic = it === '1' || it === 'true';
    const solid = firstChild(defRPr, 'solidFill');
    const c = resolveColorElement(solid, theme);
    if (c) style.color = c;
    const latin = firstChild(defRPr, 'latin');
    const tf = attr(latin, 'typeface');
    if (tf) style.fontFamily = tf;
  }

  return style;
}

function parseLstStyle(lstStyleEl: Element | null | undefined, theme: PptxTheme): Record<number, TextLevelStyle> {
  const map: Record<number, TextLevelStyle> = {};
  if (!lstStyleEl) return map;
  for (let lvl = 0; lvl <= 8; lvl++) {
    const el = firstChild(lstStyleEl, `lvl${lvl + 1}pPr`);
    if (el) map[lvl] = parseLevelStyle(el, theme);
  }
  const defPPr = firstChild(lstStyleEl, 'defPPr');
  if (defPPr && !map[0]) map[0] = parseLevelStyle(defPPr, theme);
  return map;
}

function extractPlaceholders(doc: Document | null, theme: PptxTheme): PlaceholderDef[] {
  if (!doc) return [];
  const spTree = firstDescendant(doc, 'spTree');
  if (!spTree) return [];
  const defs: PlaceholderDef[] = [];

  for (const sp of directChildren(spTree, 'sp')) {
    const nvPr = firstChild(firstChild(sp, 'nvSpPr'), 'nvPr');
    const ph = firstChild(nvPr, 'ph');
    if (!ph) continue;
    const type = attr(ph, 'type') || '';
    const idx = attr(ph, 'idx') || '';
    const spPr = firstChild(sp, 'spPr');
    const box = parseXfrm(firstChild(spPr, 'xfrm')) || undefined;
    const txBody = firstChild(sp, 'txBody');
    const bodyPr = firstChild(txBody, 'bodyPr');
    const levelStyles = parseLstStyle(firstChild(txBody, 'lstStyle'), theme);

    defs.push({
      type,
      idx,
      box,
      spPr,
      levelStyles,
      bodyAnchor: attr(bodyPr, 'anchor') || undefined,
      bodyInsets: bodyPr
        ? {
            l: emuToPx(attrNum(bodyPr, 'lIns', 91440)),
            r: emuToPx(attrNum(bodyPr, 'rIns', 91440)),
            t: emuToPx(attrNum(bodyPr, 'tIns', 45720)),
            b: emuToPx(attrNum(bodyPr, 'bIns', 45720)),
          }
        : undefined,
    });
  }
  return defs;
}

function findMatchingPlaceholder(
  type: string,
  idx: string,
  candidates: PlaceholderDef[]
): PlaceholderDef | undefined {
  if (idx) {
    const exactIdx = candidates.find((c) => c.idx === idx);
    if (exactIdx) return exactIdx;
  }
  if (type) {
    const exactType = candidates.find((c) => c.type === type);
    if (exactType) return exactType;
    if (type === 'ctrTitle') {
      const titleMatch = candidates.find((c) => c.type === 'title');
      if (titleMatch) return titleMatch;
    }
    if (type === 'subTitle') {
      const bodyMatch = candidates.find((c) => c.type === 'body');
      if (bodyMatch) return bodyMatch;
    }
  }
  return undefined;
}

/* -------------------------------------------------------------------------- */
/* SVG PRESET & CUSTOM SHAPE RENDERING                                        */
/* -------------------------------------------------------------------------- */

function buildShapeSvgHtml(
  prst: string,
  wPx: number,
  hPx: number,
  fill: ResolvedFill | null,
  stroke: ResolvedStroke | null,
  avList: Record<string, number>,
  custGeomEl: Element | null,
  uid: string
): string {
  const w = Math.max(1, wPx);
  const h = Math.max(1, hPx);
  const sw = stroke ? stroke.widthPx : 0;
  const pad = sw / 2;

  let defs = '';
  let fillAttr = 'none';
  if (fill?.type === 'solid' && fill.color) {
    fillAttr = fill.color;
  } else if (fill?.type === 'gradient' && fill.gradientSvg) {
    const gid = `g_${uid}`;
    if (fill.gradientSvg.isRadial) {
      defs += `<radialGradient id="${gid}" cx="50%" cy="50%" r="70%">`;
      for (const s of fill.gradientSvg.stops) {
        defs += `<stop offset="${s.offsetPct}%" stop-color="${s.color}"/>`;
      }
      defs += `</radialGradient>`;
    } else {
      const rad = ((fill.gradientSvg.angleDeg - 90) * Math.PI) / 180;
      const x1 = 50 - Math.cos(rad) * 50;
      const y1 = 50 - Math.sin(rad) * 50;
      const x2 = 50 + Math.cos(rad) * 50;
      const y2 = 50 + Math.sin(rad) * 50;
      defs += `<linearGradient id="${gid}" x1="${x1.toFixed(1)}%" y1="${y1.toFixed(1)}%" x2="${x2.toFixed(1)}%" y2="${y2.toFixed(1)}%">`;
      for (const s of fill.gradientSvg.stops) {
        defs += `<stop offset="${s.offsetPct}%" stop-color="${s.color}"/>`;
      }
      defs += `</linearGradient>`;
    }
    fillAttr = `url(#${gid})`;
  } else if (fill?.type === 'image' && fill.imageUrl) {
    const pid = `p_${uid}`;
    defs += `<pattern id="${pid}" patternUnits="objectBoundingBox" width="1" height="1">
      <image href="${fill.imageUrl}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" preserveAspectRatio="xMidYMid slice"/>
    </pattern>`;
    fillAttr = `url(#${pid})`;
  }

  let markerAttrs = '';
  if (stroke?.tailEnd) {
    const mid = `mt_${uid}`;
    defs += `<marker id="${mid}" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth">
      <path d="M0,0 L0,6 L9,3 z" fill="${stroke.color}"/>
    </marker>`;
    markerAttrs += ` marker-end="url(#${mid})"`;
  }
  if (stroke?.headEnd) {
    const mid = `mh_${uid}`;
    defs += `<marker id="${mid}" markerWidth="10" markerHeight="10" refX="1" refY="3" orient="auto" markerUnits="strokeWidth">
      <path d="M9,0 L9,6 L0,3 z" fill="${stroke.color}"/>
    </marker>`;
    markerAttrs += ` marker-start="url(#${mid})"`;
  }

  const strokeAttrs = stroke
    ? `stroke="${stroke.color}" stroke-width="${sw.toFixed(2)}"${
        stroke.dashArray ? ` stroke-dasharray="${stroke.dashArray}"` : ''
      } stroke-linecap="round" stroke-linejoin="round"${markerAttrs}`
    : 'stroke="none"';

  // Custom Geometry (<a:custGeom>)
  if (custGeomEl) {
    const pathLst = firstChild(custGeomEl, 'pathLst');
    const pathEls = directChildren(pathLst, 'path');
    if (pathEls.length > 0) {
      const svgPaths: string[] = [];
      for (const pEl of pathEls) {
        const pw = attrNum(pEl, 'w', w) || w;
        const ph = attrNum(pEl, 'h', h) || h;
        const sx = w / pw;
        const sy = h / ph;
        let d = '';
        for (const cmd of directChildren(pEl)) {
          const pts = directChildren(cmd, 'pt');
          if (cmd.localName === 'moveTo' && pts[0]) {
            d += `M ${(attrNum(pts[0], 'x') * sx).toFixed(2)} ${(attrNum(pts[0], 'y') * sy).toFixed(2)} `;
          } else if (cmd.localName === 'lnTo' && pts[0]) {
            d += `L ${(attrNum(pts[0], 'x') * sx).toFixed(2)} ${(attrNum(pts[0], 'y') * sy).toFixed(2)} `;
          } else if (cmd.localName === 'cubicBezTo' && pts.length >= 3) {
            d += `C ${(attrNum(pts[0], 'x') * sx).toFixed(2)} ${(attrNum(pts[0], 'y') * sy).toFixed(2)}, ${(attrNum(pts[1], 'x') * sx).toFixed(2)} ${(attrNum(pts[1], 'y') * sy).toFixed(2)}, ${(attrNum(pts[2], 'x') * sx).toFixed(2)} ${(attrNum(pts[2], 'y') * sy).toFixed(2)} `;
          } else if (cmd.localName === 'quadBezTo' && pts.length >= 2) {
            d += `Q ${(attrNum(pts[0], 'x') * sx).toFixed(2)} ${(attrNum(pts[0], 'y') * sy).toFixed(2)}, ${(attrNum(pts[1], 'x') * sx).toFixed(2)} ${(attrNum(pts[1], 'y') * sy).toFixed(2)} `;
          } else if (cmd.localName === 'close') {
            d += 'Z ';
          }
        }
        if (d.trim()) {
          svgPaths.push(`<path d="${d.trim()}" fill="${fillAttr}" ${strokeAttrs}/>`);
        }
      }
      if (svgPaths.length > 0) {
        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w.toFixed(1)} ${h.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" style="position:absolute;left:0;top:0;width:100%;height:100%;overflow:visible;">${
          defs ? `<defs>${defs}</defs>` : ''
        }${svgPaths.join('')}</svg>`;
      }
    }
  }

  let shapeTag = '';
  const iw = Math.max(0.5, w - sw);
  const ih = Math.max(0.5, h - sw);

  switch (prst) {
    case 'line':
    case 'straightConnector1':
      shapeTag = `<line x1="0" y1="0" x2="${w.toFixed(2)}" y2="${h.toFixed(2)}" fill="none" ${strokeAttrs}/>`;
      break;
    case 'bentConnector2':
    case 'bentConnector3':
      shapeTag = `<polyline points="0,0 ${(w / 2).toFixed(2)},0 ${(w / 2).toFixed(2)},${h.toFixed(2)} ${w.toFixed(2)},${h.toFixed(2)}" fill="none" ${strokeAttrs}/>`;
      break;
    case 'ellipse':
      shapeTag = `<ellipse cx="${(w / 2).toFixed(2)}" cy="${(h / 2).toFixed(2)}" rx="${(iw / 2).toFixed(2)}" ry="${(ih / 2).toFixed(2)}" fill="${fillAttr}" ${strokeAttrs}/>`;
      break;
    case 'roundRect':
    case 'round1Rect':
    case 'round2SameRect':
    case 'snipRoundRect': {
      const adj = avList.adj !== undefined ? avList.adj / 100000 : 0.16667;
      const rx = Math.min(w, h) * Math.min(0.5, Math.max(0, adj));
      shapeTag = `<rect x="${pad.toFixed(2)}" y="${pad.toFixed(2)}" width="${iw.toFixed(2)}" height="${ih.toFixed(2)}" rx="${rx.toFixed(2)}" ry="${rx.toFixed(2)}" fill="${fillAttr}" ${strokeAttrs}/>`;
      break;
    }
    case 'triangle':
      shapeTag = `<polygon points="${(w / 2).toFixed(1)},${pad} ${(w - pad).toFixed(1)},${(h - pad).toFixed(1)} ${pad},${(h - pad).toFixed(1)}" fill="${fillAttr}" ${strokeAttrs}/>`;
      break;
    case 'rtTriangle':
      shapeTag = `<polygon points="${pad},${pad} ${(w - pad).toFixed(1)},${(h - pad).toFixed(1)} ${pad},${(h - pad).toFixed(1)}" fill="${fillAttr}" ${strokeAttrs}/>`;
      break;
    case 'diamond':
      shapeTag = `<polygon points="${(w / 2).toFixed(1)},${pad} ${(w - pad).toFixed(1)},${(h / 2).toFixed(1)} ${(w / 2).toFixed(1)},${(h - pad).toFixed(1)} ${pad},${(h / 2).toFixed(1)}" fill="${fillAttr}" ${strokeAttrs}/>`;
      break;
    case 'parallelogram':
      shapeTag = `<polygon points="${(w * 0.2).toFixed(1)},${pad} ${(w - pad).toFixed(1)},${pad} ${(w * 0.8).toFixed(1)},${(h - pad).toFixed(1)} ${pad},${(h - pad).toFixed(1)}" fill="${fillAttr}" ${strokeAttrs}/>`;
      break;
    case 'trapezoid':
      shapeTag = `<polygon points="${(w * 0.2).toFixed(1)},${pad} ${(w * 0.8).toFixed(1)},${pad} ${(w - pad).toFixed(1)},${(h - pad).toFixed(1)} ${pad},${(h - pad).toFixed(1)}" fill="${fillAttr}" ${strokeAttrs}/>`;
      break;
    case 'chevron':
      shapeTag = `<polygon points="${pad},${pad} ${(w * 0.78).toFixed(1)},${pad} ${(w - pad).toFixed(1)},${(h / 2).toFixed(1)} ${(w * 0.78).toFixed(1)},${(h - pad).toFixed(1)} ${pad},${(h - pad).toFixed(1)} ${(w * 0.22).toFixed(1)},${(h / 2).toFixed(1)}" fill="${fillAttr}" ${strokeAttrs}/>`;
      break;
    case 'homePlate':
      shapeTag = `<polygon points="${pad},${pad} ${(w * 0.78).toFixed(1)},${pad} ${(w - pad).toFixed(1)},${(h / 2).toFixed(1)} ${(w * 0.78).toFixed(1)},${(h - pad).toFixed(1)} ${pad},${(h - pad).toFixed(1)}" fill="${fillAttr}" ${strokeAttrs}/>`;
      break;
    case 'hexagon':
      shapeTag = `<polygon points="${(w * 0.25).toFixed(1)},${pad} ${(w * 0.75).toFixed(1)},${pad} ${(w - pad).toFixed(1)},${(h / 2).toFixed(1)} ${(w * 0.75).toFixed(1)},${(h - pad).toFixed(1)} ${(w * 0.25).toFixed(1)},${(h - pad).toFixed(1)} ${pad},${(h / 2).toFixed(1)}" fill="${fillAttr}" ${strokeAttrs}/>`;
      break;
    case 'pentagon':
      shapeTag = `<polygon points="${(w * 0.5).toFixed(1)},${pad} ${(w - pad).toFixed(1)},${(h * 0.38).toFixed(1)} ${(w * 0.81).toFixed(1)},${(h - pad).toFixed(1)} ${(w * 0.19).toFixed(1)},${(h - pad).toFixed(1)} ${pad},${(h * 0.38).toFixed(1)}" fill="${fillAttr}" ${strokeAttrs}/>`;
      break;
    case 'rightArrow':
      shapeTag = `<polygon points="${pad},${(h * 0.25).toFixed(1)} ${(w * 0.65).toFixed(1)},${(h * 0.25).toFixed(1)} ${(w * 0.65).toFixed(1)},${pad} ${(w - pad).toFixed(1)},${(h / 2).toFixed(1)} ${(w * 0.65).toFixed(1)},${(h - pad).toFixed(1)} ${(w * 0.65).toFixed(1)},${(h * 0.75).toFixed(1)} ${pad},${(h * 0.75).toFixed(1)}" fill="${fillAttr}" ${strokeAttrs}/>`;
      break;
    case 'leftArrow':
      shapeTag = `<polygon points="${(w - pad).toFixed(1)},${(h * 0.25).toFixed(1)} ${(w * 0.35).toFixed(1)},${(h * 0.25).toFixed(1)} ${(w * 0.35).toFixed(1)},${pad} ${pad},${(h / 2).toFixed(1)} ${(w * 0.35).toFixed(1)},${(h - pad).toFixed(1)} ${(w * 0.35).toFixed(1)},${(h * 0.75).toFixed(1)} ${(w - pad).toFixed(1)},${(h * 0.75).toFixed(1)}" fill="${fillAttr}" ${strokeAttrs}/>`;
      break;
    case 'downArrow':
      shapeTag = `<polygon points="${(w * 0.25).toFixed(1)},${pad} ${(w * 0.75).toFixed(1)},${pad} ${(w * 0.75).toFixed(1)},${(h * 0.65).toFixed(1)} ${(w - pad).toFixed(1)},${(h * 0.65).toFixed(1)} ${(w / 2).toFixed(1)},${(h - pad).toFixed(1)} ${pad},${(h * 0.65).toFixed(1)} ${(w * 0.25).toFixed(1)},${(h * 0.65).toFixed(1)}" fill="${fillAttr}" ${strokeAttrs}/>`;
      break;
    case 'upArrow':
      shapeTag = `<polygon points="${(w * 0.25).toFixed(1)},${(h - pad).toFixed(1)} ${(w * 0.75).toFixed(1)},${(h - pad).toFixed(1)} ${(w * 0.75).toFixed(1)},${(h * 0.35).toFixed(1)} ${(w - pad).toFixed(1)},${(h * 0.35).toFixed(1)} ${(w / 2).toFixed(1)},${pad} ${pad},${(h * 0.35).toFixed(1)} ${(w * 0.25).toFixed(1)},${(h * 0.35).toFixed(1)}" fill="${fillAttr}" ${strokeAttrs}/>`;
      break;
    case 'star5': {
      const cx = w / 2;
      const cy = h / 2;
      const outerR = Math.min(w, h) / 2 - pad;
      const innerR = outerR * 0.382;
      const pts: string[] = [];
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? outerR : innerR;
        const a = (i * Math.PI) / 5 - Math.PI / 2;
        pts.push(`${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`);
      }
      shapeTag = `<polygon points="${pts.join(' ')}" fill="${fillAttr}" ${strokeAttrs}/>`;
      break;
    }
    case 'plus': {
      const t = Math.min(w, h) * 0.25;
      shapeTag = `<polygon points="${t},${pad} ${w - t},${pad} ${w - t},${t} ${w - pad},${t} ${w - pad},${h - t} ${w - t},${h - t} ${w - t},${h - pad} ${t},${h - pad} ${t},${h - t} ${pad},${h - t} ${pad},${t} ${t},${t}" fill="${fillAttr}" ${strokeAttrs}/>`;
      break;
    }
    case 'rect':
    default:
      shapeTag = `<rect x="${pad.toFixed(2)}" y="${pad.toFixed(2)}" width="${iw.toFixed(2)}" height="${ih.toFixed(2)}" fill="${fillAttr}" ${strokeAttrs}/>`;
      break;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w.toFixed(1)} ${h.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" style="position:absolute;left:0;top:0;width:100%;height:100%;overflow:visible;">${
    defs ? `<defs>${defs}</defs>` : ''
  }${shapeTag}</svg>`;
}

/* -------------------------------------------------------------------------- */
/* TEXT BODY RENDERING (Full typography, bullets, numbering, alignment)        */
/* -------------------------------------------------------------------------- */

function renderTextBodyHtml(
  txBody: Element | null | undefined,
  theme: PptxTheme,
  inheritedLevels: Record<number, TextLevelStyle>,
  inheritedAnchor: string | undefined,
  inheritedInsets: { l: number; r: number; t: number; b: number } | undefined,
  defaultTextColor: string,
  defaultFontSizePt: number,
  isTitlePlaceholder: boolean,
  collectedText: string[]
): string {
  if (!txBody) return '';

  const bodyPr = firstChild(txBody, 'bodyPr');
  const lstStyles = parseLstStyle(firstChild(txBody, 'lstStyle'), theme);

  const lIns = bodyPr && attr(bodyPr, 'lIns') !== null
    ? emuToPx(attrNum(bodyPr, 'lIns', 91440))
    : inheritedInsets?.l ?? 9.6;
  const rIns = bodyPr && attr(bodyPr, 'rIns') !== null
    ? emuToPx(attrNum(bodyPr, 'rIns', 91440))
    : inheritedInsets?.r ?? 9.6;
  const tIns = bodyPr && attr(bodyPr, 'tIns') !== null
    ? emuToPx(attrNum(bodyPr, 'tIns', 45720))
    : inheritedInsets?.t ?? 4.8;
  const bIns = bodyPr && attr(bodyPr, 'bIns') !== null
    ? emuToPx(attrNum(bodyPr, 'bIns', 45720))
    : inheritedInsets?.b ?? 4.8;

  const anchor = attr(bodyPr, 'anchor') || inheritedAnchor || 't';
  const justifyContent =
    anchor === 'ctr' ? 'center' : anchor === 'b' ? 'flex-end' : 'flex-start';

  // Auto-fit font scale (e.g. normAutofit fontScale="85000" -> 0.85)
  const normAutofit = firstChild(bodyPr, 'normAutofit');
  const fontScale = normAutofit ? attrNum(normAutofit, 'fontScale', 100000) / 100000 : 1;

  const paragraphs = directChildren(txBody, 'p');
  if (paragraphs.length === 0) return '';

  const autoNumCounters: Record<number, number> = {};
  const paraHtmlList: string[] = [];

  for (const pEl of paragraphs) {
    const pPr = firstChild(pEl, 'pPr');
    const lvl = attrNum(pPr, 'lvl', 0);
    const localPStyle = parseLevelStyle(pPr, theme);
    const mergedLevel: TextLevelStyle = {
      ...(inheritedLevels[lvl] || inheritedLevels[0] || {}),
      ...(lstStyles[lvl] || lstStyles[0] || {}),
      ...localPStyle,
    };

    const algn = mergedLevel.align || 'l';
    const textAlign =
      algn === 'ctr' ? 'center' : algn === 'r' ? 'right' : algn === 'just' ? 'justify' : 'left';

    // Line spacing
    let lineHeightCss = '1.22';
    const lnSpc = firstChild(pPr, 'lnSpc');
    if (lnSpc) {
      const spcPct = firstChild(lnSpc, 'spcPct');
      const spcPts = firstChild(lnSpc, 'spcPts');
      if (spcPct) {
        const lh = Math.max(0.85, (attrNum(spcPct, 'val', 100000) / 100000) * 1.15);
        lineHeightCss = lh.toFixed(2);
      } else if (spcPts) {
        lineHeightCss = `${((attrNum(spcPts, 'val', 1400) / 100) * (96 / 72)).toFixed(1)}px`;
      }
    }

    // Space before / after
    let marginTopPx = 0;
    const spcBef = firstChild(pPr, 'spcBef');
    if (spcBef) {
      const spcPts = firstChild(spcBef, 'spcPts');
      if (spcPts) marginTopPx = (attrNum(spcPts, 'val', 0) / 100) * (96 / 72);
    }
    let marginBottomPx = 0;
    const spcAft = firstChild(pPr, 'spcAft');
    if (spcAft) {
      const spcPts = firstChild(spcAft, 'spcPts');
      if (spcPts) marginBottomPx = (attrNum(spcPts, 'val', 0) / 100) * (96 / 72);
    }

    // Runs & breaks inside paragraph
    const runNodes = directChildren(pEl).filter(
      (n) => n.localName === 'r' || n.localName === 'br' || n.localName === 'fld'
    );

    const endParaRPr = firstChild(pEl, 'endParaRPr');
    let paraPlainText = '';
    const runsHtml: string[] = [];

    for (const node of runNodes) {
      if (node.localName === 'br') {
        runsHtml.push('<br/>');
        continue;
      }
      const tEl = firstChild(node, 't');
      const rawText = tEl?.textContent || '';
      if (!rawText) continue;
      paraPlainText += rawText;

      const rPr = firstChild(node, 'rPr');
      const szRaw = attr(rPr, 'sz');
      const basePt = szRaw
        ? Number(szRaw) / 100
        : mergedLevel.fontSizePt ?? defaultFontSizePt;
      const finalPx = Math.max(6, basePt * fontScale * (96 / 72));

      const bAttr = attr(rPr, 'b');
      const isBold = bAttr !== null ? bAttr === '1' || bAttr === 'true' : Boolean(mergedLevel.bold);
      const iAttr = attr(rPr, 'i');
      const isItalic =
        iAttr !== null ? iAttr === '1' || iAttr === 'true' : Boolean(mergedLevel.italic);
      const uAttr = attr(rPr, 'u');
      const isUnderline = uAttr !== null && uAttr !== 'none';
      const strikeAttr = attr(rPr, 'strike');
      const isStrike = strikeAttr !== null && strikeAttr !== 'noStrike';
      const capAttr = attr(rPr, 'cap');
      const spcAttr = attr(rPr, 'spc');
      const baseline = attrNum(rPr, 'baseline', 0);

      const solidFill = firstChild(rPr, 'solidFill');
      const runColor =
        resolveColorElement(solidFill, theme) || mergedLevel.color || defaultTextColor;

      const latin = firstChild(rPr, 'latin');
      const ea = firstChild(rPr, 'ea');
      const typeface = attr(latin, 'typeface') || attr(ea, 'typeface') || mergedLevel.fontFamily;
      const fontFamily = resolveFontFamilyCss(typeface, theme);

      const highlightEl = firstChild(rPr, 'highlight');
      const highlightColor = resolveColorElement(highlightEl, theme);

      const styles: string[] = [
        `font-size:${finalPx.toFixed(2)}px`,
        `font-family:${fontFamily}`,
        `color:${runColor}`,
        `font-weight:${isBold ? '700' : '400'}`,
      ];
      if (isItalic) styles.push('font-style:italic');
      if (isUnderline && isStrike) styles.push('text-decoration:underline line-through');
      else if (isUnderline) styles.push('text-decoration:underline');
      else if (isStrike) styles.push('text-decoration:line-through');
      if (capAttr === 'all') styles.push('text-transform:uppercase');
      if (spcAttr) styles.push(`letter-spacing:${((Number(spcAttr) / 100) * (96 / 72)).toFixed(2)}px`);
      if (highlightColor) styles.push(`background:${highlightColor}`);
      if (baseline > 0) styles.push('vertical-align:super;font-size:0.72em');
      else if (baseline < 0) styles.push('vertical-align:sub;font-size:0.72em');

      // Preserve multiple spaces cleanly
      const safeText = escapeHtml(rawText).replace(/  /g, ' &nbsp;');
      runsHtml.push(`<span style="${styles.join(';')}">${safeText}</span>`);
    }

    if (paraPlainText.trim()) {
      collectedText.push(paraPlainText.trim());
    }

    // Determine bullet / numbering prefix
    let bulletHtml = '';
    const hasContent = runsHtml.length > 0 && paraPlainText.trim().length > 0;
    if (hasContent && !mergedLevel.bulletNone && !isTitlePlaceholder) {
      let marker = '';
      if (mergedLevel.bulletAutoNum) {
        autoNumCounters[lvl] = (autoNumCounters[lvl] || 0) + 1;
        marker = formatAutoNumberBullet(mergedLevel.bulletAutoNum, autoNumCounters[lvl]);
      } else if (mergedLevel.bulletChar) {
        marker = mergedLevel.bulletChar;
      }
      if (marker) {
        const buClr = resolveColorElement(firstChild(pPr, 'buClr'), theme) || mergedLevel.color || defaultTextColor;
        const buPx = (mergedLevel.fontSizePt ?? defaultFontSizePt) * fontScale * (96 / 72);
        bulletHtml = `<span style="display:inline-block;min-width:${(buPx * 0.95).toFixed(1)}px;color:${buClr};font-size:${buPx.toFixed(1)}px;margin-right:4px;">${escapeHtml(marker)}</span>`;
      }
    }

    // Empty paragraph preserves vertical spacing
    if (runsHtml.length === 0) {
      const emptyPt = attr(endParaRPr, 'sz')
        ? Number(attr(endParaRPr, 'sz')) / 100
        : mergedLevel.fontSizePt ?? defaultFontSizePt;
      const emptyPx = Math.max(8, emptyPt * fontScale * (96 / 72));
      paraHtmlList.push(`<div style="height:${(emptyPx * 0.85).toFixed(1)}px;"></div>`);
      continue;
    }

    const marLPx = mergedLevel.marLPx ?? lvl * 22;
    const indentPx = mergedLevel.indentPx ?? 0;
    const padLeft = Math.max(0, marLPx + (bulletHtml ? Math.min(0, indentPx) : 0));

    paraHtmlList.push(
      `<div style="text-align:${textAlign};line-height:${lineHeightCss};margin-top:${marginTopPx.toFixed(1)}px;margin-bottom:${marginBottomPx.toFixed(1)}px;padding-left:${padLeft.toFixed(1)}px;word-wrap:break-word;overflow-wrap:break-word;">${bulletHtml}${runsHtml.join('')}</div>`
    );
  }

  return `<div style="position:absolute;inset:0;display:flex;flex-direction:column;justify-content:${justifyContent};padding:${tIns.toFixed(1)}px ${rIns.toFixed(1)}px ${bIns.toFixed(1)}px ${lIns.toFixed(1)}px;box-sizing:border-box;overflow:visible;">${paraHtmlList.join('')}</div>`;
}

/* -------------------------------------------------------------------------- */
/* TABLE RENDERING (<a:tbl>)                                                  */
/* -------------------------------------------------------------------------- */

async function renderTableHtml(
  tblEl: Element,
  box: RectBox,
  rels: RelMap,
  zip: JSZip,
  theme: PptxTheme,
  mediaCache: Map<string, string>,
  defaultTextColor: string,
  collectedText: string[]
): Promise<string> {
  const tblPr = firstChild(tblEl, 'tblPr');
  const firstRowFlag = attr(tblPr, 'firstRow') === '1' || attr(tblPr, 'firstRow') === 'true';
  const bandRowFlag = attr(tblPr, 'bandRow') === '1' || attr(tblPr, 'bandRow') === 'true';

  const tblGrid = firstChild(tblEl, 'tblGrid');
  const gridCols = directChildren(tblGrid, 'gridCol').map((c) => attrNum(c, 'w', 914400));
  const totalGridW = gridCols.reduce((a, b) => a + b, 0) || box.w || 1;
  const colPctWidths = gridCols.map((w) => (w / totalGridW) * 100);

  const rows = directChildren(tblEl, 'tr');
  const totalRowH = rows.reduce((a, r) => a + attrNum(r, 'h', 300000), 0) || box.h || 1;
  const frameHPx = emuToPx(box.h);

  const accentHex = resolveSchemeColorHex('accent1', theme);
  const headerBgDefault = applyColorModifiers(accentHex);
  const bandBgDefault = applyColorModifiers(accentHex, { lumMod: 20000, lumOff: 80000 });

  const trHtmlList: string[] = [];

  for (let rIdx = 0; rIdx < rows.length; rIdx++) {
    const tr = rows[rIdx];
    const rowHPx = (attrNum(tr, 'h', 300000) / totalRowH) * frameHPx;
    const cells = directChildren(tr, 'tc');
    const tdHtmlList: string[] = [];

    for (let cIdx = 0; cIdx < cells.length; cIdx++) {
      const tc = cells[cIdx];
      if (attr(tc, 'hMerge') === '1' || attr(tc, 'vMerge') === '1') {
        continue; // Merged continuation cell
      }

      const colSpan = attrNum(tc, 'gridSpan', 1);
      const rowSpan = attrNum(tc, 'rowSpan', 1);
      const tcPr = firstChild(tc, 'tcPr');
      const fill = await resolveFill(tcPr, rels, zip, theme, mediaCache);

      let bgCss = 'transparent';
      if (fill?.type === 'solid' && fill.color) {
        bgCss = fill.color;
      } else if (fill?.type === 'gradient' && fill.gradientCss) {
        bgCss = fill.gradientCss;
      } else if (firstRowFlag && rIdx === 0) {
        bgCss = headerBgDefault;
      } else if (bandRowFlag && rIdx % 2 === 1) {
        bgCss = bandBgDefault;
      }

      const borderOf = (tag: string) => {
        const ln = firstChild(tcPr, tag);
        const st = resolveStroke(ln, theme);
        if (ln && firstChild(ln, 'noFill')) return 'none';
        if (st) return `${st.widthPx.toFixed(1)}px solid ${st.color}`;
        return '1px solid rgba(0,0,0,0.14)';
      };

      const marL = emuToPx(attrNum(tcPr, 'marL', 91440));
      const marR = emuToPx(attrNum(tcPr, 'marR', 91440));
      const marT = emuToPx(attrNum(tcPr, 'marT', 45720));
      const marB = emuToPx(attrNum(tcPr, 'marB', 45720));
      const vAlign = attr(tcPr, 'anchor') === 'ctr' ? 'middle' : attr(tcPr, 'anchor') === 'b' ? 'bottom' : 'top';

      const cellDefaultTextColor =
        !fill && firstRowFlag && rIdx === 0 ? '#ffffff' : defaultTextColor;

      const txBody = firstChild(tc, 'txBody');
      const cellInner = renderTextBodyHtml(
        txBody,
        theme,
        {},
        attr(tcPr, 'anchor') || 'ctr',
        { l: 0, r: 0, t: 0, b: 0 },
        cellDefaultTextColor,
        12,
        false,
        collectedText
      )
        // Make table cell text flow inline inside <td> rather than absolute
        .replace('position:absolute;inset:0;', 'position:relative;width:100%;height:100%;');

      let widthPct = 0;
      for (let k = 0; k < colSpan; k++) {
        widthPct += colPctWidths[cIdx + k] || 100 / Math.max(1, cells.length);
      }

      tdHtmlList.push(
        `<td${colSpan > 1 ? ` colspan="${colSpan}"` : ''}${rowSpan > 1 ? ` rowspan="${rowSpan}"` : ''} style="width:${widthPct.toFixed(2)}%;background:${bgCss};border-left:${borderOf('lnL')};border-right:${borderOf('lnR')};border-top:${borderOf('lnT')};border-bottom:${borderOf('lnB')};padding:${marT.toFixed(1)}px ${marR.toFixed(1)}px ${marB.toFixed(1)}px ${marL.toFixed(1)}px;vertical-align:${vAlign};box-sizing:border-box;">${cellInner}</td>`
      );
    }

    trHtmlList.push(`<tr style="min-height:${Math.max(18, rowHPx).toFixed(1)}px;">${tdHtmlList.join('')}</tr>`);
  }

  return `<table style="width:100%;height:100%;border-collapse:collapse;table-layout:fixed;">${trHtmlList.join('')}</table>`;
}

/* -------------------------------------------------------------------------- */
/* CHART RENDERING (<c:chart>)                                                */
/* -------------------------------------------------------------------------- */

async function renderChartHtml(
  chartPath: string,
  box: RectBox,
  zip: JSZip,
  theme: PptxTheme,
  collectedText: string[]
): Promise<string> {
  const entry = zip.files[chartPath];
  if (!entry) return '';
  const xml = await entry.async('string');
  const doc = parseXml(xml);
  if (!doc) return '';

  const w = Math.max(120, emuToPx(box.w));
  const h = Math.max(80, emuToPx(box.h));

  const titleEl = firstDescendant(doc, 'title');
  const titleText = titleEl
    ? allDescendants(titleEl, 't')
        .map((t) => t.textContent || '')
        .join('')
        .trim()
    : '';
  if (titleText) collectedText.push(titleText);

  const isPie = Boolean(firstDescendant(doc, 'pieChart') || firstDescendant(doc, 'doughnutChart'));
  const isLine = Boolean(firstDescendant(doc, 'lineChart'));

  const serEls = allDescendants(doc, 'ser');
  const series: { name: string; categories: string[]; values: number[]; color: string }[] = [];
  const paletteKeys = ['accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'];

  serEls.forEach((ser, idx) => {
    const txName = allDescendants(firstChild(ser, 'tx'), 'v')
      .map((v) => v.textContent || '')
      .join('')
      .trim();
    const cats = allDescendants(firstChild(ser, 'cat'), 'pt')
      .sort((a, b) => attrNum(a, 'idx') - attrNum(b, 'idx'))
      .map((pt) => firstChild(pt, 'v')?.textContent?.trim() || '');
    const vals = allDescendants(firstChild(ser, 'val'), 'pt')
      .sort((a, b) => attrNum(a, 'idx') - attrNum(b, 'idx'))
      .map((pt) => Number(firstChild(pt, 'v')?.textContent || 0));

    const spPr = firstChild(ser, 'spPr');
    const explicitClr = resolveColorElement(firstChild(spPr, 'solidFill'), theme);
    const color =
      explicitClr || `#${resolveSchemeColorHex(paletteKeys[idx % paletteKeys.length], theme)}`;

    series.push({ name: txName || `Series ${idx + 1}`, categories: cats, values: vals, color });
  });

  if (series.length === 0 || series[0].values.length === 0) return '';

  const titleOffset = titleText ? 28 : 10;
  let svgInner = '';
  if (titleText) {
    svgInner += `<text x="${(w / 2).toFixed(1)}" y="20" text-anchor="middle" font-size="14" font-weight="700" fill="#18181b" font-family="sans-serif">${escapeHtml(titleText)}</text>`;
  }

  if (isPie) {
    const vals = series[0].values;
    const total = vals.reduce((a, b) => a + Math.max(0, b), 0) || 1;
    const cx = w * 0.42;
    const cy = titleOffset + (h - titleOffset) / 2;
    const r = Math.min(w * 0.34, (h - titleOffset) * 0.42);
    let angle = -Math.PI / 2;

    vals.forEach((v, i) => {
      const slice = (Math.max(0, v) / total) * Math.PI * 2;
      const x1 = cx + r * Math.cos(angle);
      const y1 = cy + r * Math.sin(angle);
      const x2 = cx + r * Math.cos(angle + slice);
      const y2 = cy + r * Math.sin(angle + slice);
      const large = slice > Math.PI ? 1 : 0;
      const col = `#${resolveSchemeColorHex(paletteKeys[i % paletteKeys.length], theme)}`;
      svgInner += `<path d="M ${cx.toFixed(1)} ${cy.toFixed(1)} L ${x1.toFixed(1)} ${y1.toFixed(1)} A ${r.toFixed(1)} ${r.toFixed(1)} 0 ${large} 1 ${x2.toFixed(1)} ${y2.toFixed(1)} Z" fill="${col}" stroke="#fff" stroke-width="1.5"/>`;
      const lbl = series[0].categories[i] || `Slice ${i + 1}`;
      const ly = titleOffset + 18 + i * 18;
      if (ly < h - 8) {
        svgInner += `<rect x="${(w * 0.76).toFixed(1)}" y="${(ly - 9).toFixed(1)}" width="10" height="10" rx="2" fill="${col}"/>`;
        svgInner += `<text x="${(w * 0.76 + 15).toFixed(1)}" y="${ly.toFixed(1)}" font-size="11" fill="#3f3f46" font-family="sans-serif">${escapeHtml(lbl.slice(0, 16))}</text>`;
      }
      angle += slice;
    });
  } else {
    const padL = 44;
    const padR = 16;
    const padB = 30;
    const plotW = Math.max(40, w - padL - padR);
    const plotH = Math.max(40, h - titleOffset - padB);
    const cats = series[0].categories.length > 0
      ? series[0].categories
      : series[0].values.map((_, i) => String(i + 1));
    const maxVal = Math.max(1, ...series.flatMap((s) => s.values));

    // Gridlines
    for (let g = 0; g <= 4; g++) {
      const gy = titleOffset + plotH - (g / 4) * plotH;
      const gv = Math.round((maxVal * g) / 4);
      svgInner += `<line x1="${padL}" y1="${gy.toFixed(1)}" x2="${(padL + plotW).toFixed(1)}" y2="${gy.toFixed(1)}" stroke="#e4e4e7" stroke-width="1"/>`;
      svgInner += `<text x="${padL - 6}" y="${(gy + 3.5).toFixed(1)}" text-anchor="end" font-size="10" fill="#71717a" font-family="sans-serif">${gv}</text>`;
    }

    const groupW = plotW / Math.max(1, cats.length);

    if (isLine) {
      series.forEach((s) => {
        const pts = s.values
          .map((v, i) => {
            const x = padL + i * groupW + groupW / 2;
            const y = titleOffset + plotH - (Math.max(0, v) / maxVal) * plotH;
            return `${x.toFixed(1)},${y.toFixed(1)}`;
          })
          .join(' ');
        svgInner += `<polyline points="${pts}" fill="none" stroke="${s.color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`;
      });
    } else {
      const barPad = groupW * 0.16;
      const barW = Math.max(4, (groupW - barPad * 2) / Math.max(1, series.length));
      series.forEach((s, sIdx) => {
        s.values.forEach((v, i) => {
          const bh = (Math.max(0, v) / maxVal) * plotH;
          const bx = padL + i * groupW + barPad + sIdx * barW;
          const by = titleOffset + plotH - bh;
          svgInner += `<rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${Math.max(2, barW - 2).toFixed(1)}" height="${bh.toFixed(1)}" rx="2" fill="${s.color}"/>`;
        });
      });
    }

    cats.forEach((c, i) => {
      const cx = padL + i * groupW + groupW / 2;
      svgInner += `<text x="${cx.toFixed(1)}" y="${(titleOffset + plotH + 16).toFixed(1)}" text-anchor="middle" font-size="10" fill="#52525b" font-family="sans-serif">${escapeHtml(c.slice(0, 14))}</text>`;
    });
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w.toFixed(1)} ${h.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" style="width:100%;height:100%;background:rgba(255,255,255,0.65);border-radius:4px;">${svgInner}</svg>`;
}

/* -------------------------------------------------------------------------- */
/* RECURSIVE SHAPE TREE COMPOSITOR                                            */
/* -------------------------------------------------------------------------- */

interface RenderContext {
  zip: JSZip;
  theme: PptxTheme;
  mediaCache: Map<string, string>;
  layoutPlaceholders: PlaceholderDef[];
  masterPlaceholders: PlaceholderDef[];
  masterTitleStyles: Record<number, TextLevelStyle>;
  masterBodyStyles: Record<number, TextLevelStyle>;
  masterOtherStyles: Record<number, TextLevelStyle>;
  defaultTextColor: string;
  collectedText: string[];
  uidCounter: { n: number };
}

async function renderShapeTreeElements(
  treeEl: Element | null | undefined,
  rels: RelMap,
  ctx: RenderContext,
  parentGroupTransform: GroupTransform | null,
  skipPlaceholders: boolean
): Promise<string[]> {
  if (!treeEl) return [];
  const fragments: string[] = [];

  for (const el of directChildren(treeEl)) {
    const tag = el.localName;

    // 1. Group Shape (<p:grpSp>) — recursive coordinate transform
    if (tag === 'grpSp') {
      const grpSpPr = firstChild(el, 'grpSpPr');
      const xfrm = firstChild(grpSpPr, 'xfrm');
      const off = firstChild(xfrm, 'off');
      const ext = firstChild(xfrm, 'ext');
      const chOff = firstChild(xfrm, 'chOff');
      const chExt = firstChild(xfrm, 'chExt');

      let grpBox: RectBox = {
        x: attrNum(off, 'x', 0),
        y: attrNum(off, 'y', 0),
        w: attrNum(ext, 'cx', 0),
        h: attrNum(ext, 'cy', 0),
        rot: attrNum(xfrm, 'rot', 0) / 60000,
        flipH: attr(xfrm, 'flipH') === '1',
        flipV: attr(xfrm, 'flipV') === '1',
      };
      if (parentGroupTransform) {
        grpBox = transformChildBoxInGroup(grpBox, parentGroupTransform);
      }

      const nextGroupTransform: GroupTransform = {
        offX: grpBox.x,
        offY: grpBox.y,
        extX: grpBox.w,
        extY: grpBox.h,
        chOffX: attrNum(chOff, 'x', 0),
        chOffY: attrNum(chOff, 'y', 0),
        chExtX: attrNum(chExt, 'cx', grpBox.w || 1),
        chExtY: attrNum(chExt, 'cy', grpBox.h || 1),
        rot: grpBox.rot,
        flipH: grpBox.flipH,
        flipV: grpBox.flipV,
      };

      const childrenHtml = await renderShapeTreeElements(
        el,
        rels,
        ctx,
        nextGroupTransform,
        skipPlaceholders
      );
      fragments.push(...childrenHtml);
      continue;
    }

    // 2. Picture (<p:pic>)
    if (tag === 'pic') {
      const nvPr = firstChild(firstChild(el, 'nvPicPr'), 'nvPr');
      if (skipPlaceholders && firstChild(nvPr, 'ph')) continue;

      const spPr = firstChild(el, 'spPr');
      let box = parseXfrm(firstChild(spPr, 'xfrm'));
      if (!box) continue;
      if (parentGroupTransform) box = transformChildBoxInGroup(box, parentGroupTransform);
      if (box.w <= 0 || box.h <= 0) continue;

      const blipFill = firstChild(el, 'blipFill');
      const blip = firstChild(blipFill, 'blip');
      const rId = attr(blip, 'embed') || attr(blip, 'link');
      const mediaUrl = rId && rels[rId] ? await getMediaDataUrl(ctx.zip, rels[rId].target, ctx.mediaCache) : null;
      if (!mediaUrl) continue;

      const srcRectEl = firstChild(blipFill, 'srcRect');
      const l = attrNum(srcRectEl, 'l', 0);
      const t = attrNum(srcRectEl, 't', 0);
      const r = attrNum(srcRectEl, 'r', 0);
      const b = attrNum(srcRectEl, 'b', 0);

      const alphaMod = firstChild(blip, 'alphaModFix');
      const opacity = alphaMod ? Math.max(0, Math.min(1, attrNum(alphaMod, 'amt', 100000) / 100000)) : 1;

      const prst = attr(firstChild(spPr, 'prstGeom'), 'prst') || 'rect';
      const borderRadius =
        prst === 'ellipse' ? '50%' : prst === 'roundRect' ? '12px' : '0';

      const stroke = resolveStroke(firstChild(spPr, 'ln'), ctx.theme);
      const borderCss = stroke ? `${stroke.widthPx.toFixed(1)}px solid ${stroke.color}` : 'none';
      const shadowCss = resolveShadowCss(spPr, ctx.theme);

      const transforms: string[] = [];
      if (box.rot) transforms.push(`rotate(${box.rot.toFixed(2)}deg)`);
      if (box.flipH) transforms.push('scaleX(-1)');
      if (box.flipV) transforms.push('scaleY(-1)');

      let imgTag = `<img src="${mediaUrl}" style="width:100%;height:100%;object-fit:fill;display:block;"/>`;
      if (l !== 0 || t !== 0 || r !== 0 || b !== 0) {
        const visW = Math.max(0.01, 1 - (l + r) / 100000);
        const visH = Math.max(0.01, 1 - (t + b) / 100000);
        const wPct = (1 / visW) * 100;
        const hPct = (1 / visH) * 100;
        const leftPct = -(l / 100000 / visW) * 100;
        const topPct = -(t / 100000 / visH) * 100;
        imgTag = `<img src="${mediaUrl}" style="position:absolute;left:${leftPct.toFixed(2)}%;top:${topPct.toFixed(2)}%;width:${wPct.toFixed(2)}%;height:${hPct.toFixed(2)}%;max-width:none;max-height:none;display:block;"/>`;
      }

      fragments.push(
        `<div style="position:absolute;left:${emuToPx(box.x).toFixed(2)}px;top:${emuToPx(box.y).toFixed(2)}px;width:${emuToPx(box.w).toFixed(2)}px;height:${emuToPx(box.h).toFixed(2)}px;overflow:hidden;border-radius:${borderRadius};border:${borderCss};opacity:${opacity.toFixed(3)};box-sizing:border-box;${
          transforms.length ? `transform:${transforms.join(' ')};` : ''
        }${shadowCss ? `filter:${shadowCss};` : ''}">${imgTag}</div>`
      );
      continue;
    }

    // 3. Graphic Frame (<p:graphicFrame> — Tables & Charts)
    if (tag === 'graphicFrame') {
      const nvPr = firstChild(firstChild(el, 'nvGraphicFramePr'), 'nvPr');
      if (skipPlaceholders && firstChild(nvPr, 'ph')) continue;

      let box = parseXfrm(firstChild(el, 'xfrm'));
      if (!box) continue;
      if (parentGroupTransform) box = transformChildBoxInGroup(box, parentGroupTransform);
      if (box.w <= 0 || box.h <= 0) continue;

      const graphicData = firstChild(firstChild(el, 'graphic'), 'graphicData');
      const tbl = firstChild(graphicData, 'tbl');
      const chartRef = firstChild(graphicData, 'chart');

      let inner = '';
      if (tbl) {
        inner = await renderTableHtml(
          tbl,
          box,
          rels,
          ctx.zip,
          ctx.theme,
          ctx.mediaCache,
          ctx.defaultTextColor,
          ctx.collectedText
        );
      } else if (chartRef) {
        const rId = attr(chartRef, 'id');
        if (rId && rels[rId]) {
          inner = await renderChartHtml(rels[rId].target, box, ctx.zip, ctx.theme, ctx.collectedText);
        }
      }

      if (inner) {
        fragments.push(
          `<div style="position:absolute;left:${emuToPx(box.x).toFixed(2)}px;top:${emuToPx(box.y).toFixed(2)}px;width:${emuToPx(box.w).toFixed(2)}px;height:${emuToPx(box.h).toFixed(2)}px;box-sizing:border-box;">${inner}</div>`
        );
      }
      continue;
    }

    // 4. Shapes & Connectors (<p:sp>, <p:cxnSp>)
    if (tag === 'sp' || tag === 'cxnSp') {
      const nvPr = firstChild(firstChild(el, tag === 'sp' ? 'nvSpPr' : 'nvCxnSpPr'), 'nvPr');
      const ph = firstChild(nvPr, 'ph');
      if (skipPlaceholders && ph) continue;

      const phType = attr(ph, 'type') || '';
      const phIdx = attr(ph, 'idx') || '';
      const layoutPh = ph ? findMatchingPlaceholder(phType, phIdx, ctx.layoutPlaceholders) : undefined;
      const masterPh = ph ? findMatchingPlaceholder(phType, phIdx, ctx.masterPlaceholders) : undefined;

      const spPr = firstChild(el, 'spPr');
      let box = parseXfrm(firstChild(spPr, 'xfrm')) || layoutPh?.box || masterPh?.box || null;
      if (!box) continue;
      if (parentGroupTransform) box = transformChildBoxInGroup(box, parentGroupTransform);

      const wPx = emuToPx(box.w);
      const hPx = emuToPx(box.h);
      const isLine = tag === 'cxnSp' || attr(firstChild(spPr, 'prstGeom'), 'prst')?.includes('line') || attr(firstChild(spPr, 'prstGeom'), 'prst')?.includes('Connector');
      if (!isLine && (wPx <= 0.5 || hPx <= 0.5)) continue;

      // Style refs (<p:style><a:fillRef>, <a:lnRef>, <a:fontRef>)
      const styleEl = firstChild(el, 'style');
      const fillRefColor = resolveColorElement(firstChild(styleEl, 'fillRef'), ctx.theme);
      const fillRefIdx = attrNum(firstChild(styleEl, 'fillRef'), 'idx', 0);
      const lnRefColor = resolveColorElement(firstChild(styleEl, 'lnRef'), ctx.theme);
      const lnRefIdx = attrNum(firstChild(styleEl, 'lnRef'), 'idx', 0);
      const fontRefColor = resolveColorElement(firstChild(styleEl, 'fontRef'), ctx.theme);

      let fill = await resolveFill(spPr, rels, ctx.zip, ctx.theme, ctx.mediaCache);
      if (!fill && layoutPh?.spPr) {
        fill = await resolveFill(layoutPh.spPr, rels, ctx.zip, ctx.theme, ctx.mediaCache);
      }
      if (!fill && fillRefColor && fillRefIdx > 0 && !isLine) {
        fill = { type: 'solid', color: fillRefColor };
      }

      const lnEl = firstChild(spPr, 'ln');
      let stroke = resolveStroke(lnEl, ctx.theme, lnRefIdx > 0 ? lnRefColor || undefined : undefined);
      if (!stroke && !lnEl && lnRefColor && lnRefIdx > 0) {
        stroke = { widthPx: 1.25, color: lnRefColor };
      }

      const prstGeom = firstChild(spPr, 'prstGeom');
      const custGeom = firstChild(spPr, 'custGeom');
      const prst = attr(prstGeom, 'prst') || (tag === 'cxnSp' ? 'line' : 'rect');
      const avList: Record<string, number> = {};
      for (const gd of directChildren(firstChild(prstGeom, 'avLst'), 'gd')) {
        const gName = attr(gd, 'name');
        const fmla = attr(gd, 'fmla') || '';
        const m = fmla.match(/val\s+(-?\d+)/);
        if (gName && m) avList[gName] = Number(m[1]);
      }

      const needsSvgShape = Boolean(
        (fill && fill.type !== 'none') || stroke || custGeom || isLine
      );

      let svgHtml = '';
      if (needsSvgShape) {
        ctx.uidCounter.n += 1;
        svgHtml = buildShapeSvgHtml(
          prst,
          Math.max(1, wPx),
          Math.max(1, hPx),
          fill,
          stroke,
          avList,
          custGeom,
          `s${ctx.uidCounter.n}`
        );
      }

      // Text body inside shape
      const txBody = firstChild(el, 'txBody');
      const isTitle = phType === 'title' || phType === 'ctrTitle';
      const baseMasterLevels = isTitle
        ? ctx.masterTitleStyles
        : phType === 'body' || phType === 'subTitle' || phType === 'obj'
        ? ctx.masterBodyStyles
        : ctx.masterOtherStyles;

      const mergedInheritedLevels: Record<number, TextLevelStyle> = {};
      for (let l = 0; l <= 8; l++) {
        mergedInheritedLevels[l] = {
          ...(baseMasterLevels[l] || {}),
          ...(masterPh?.levelStyles[l] || {}),
          ...(layoutPh?.levelStyles[l] || {}),
        };
      }

      const shapeDefaultTextColor =
        fontRefColor ||
        (fill?.type === 'solid' && fill.color && isDarkHex(fill.color) ? '#ffffff' : ctx.defaultTextColor);
      const defaultPt = isTitle ? 36 : phType === 'subTitle' ? 22 : 18;

      const textHtml = renderTextBodyHtml(
        txBody,
        ctx.theme,
        mergedInheritedLevels,
        layoutPh?.bodyAnchor || masterPh?.bodyAnchor,
        layoutPh?.bodyInsets || masterPh?.bodyInsets,
        shapeDefaultTextColor,
        defaultPt,
        isTitle,
        ctx.collectedText
      );

      if (!svgHtml && !textHtml) continue;

      const shadowCss = resolveShadowCss(spPr, ctx.theme);
      const transforms: string[] = [];
      if (box.rot) transforms.push(`rotate(${box.rot.toFixed(2)}deg)`);
      if (box.flipH) transforms.push('scaleX(-1)');
      if (box.flipV) transforms.push('scaleY(-1)');

      fragments.push(
        `<div style="position:absolute;left:${emuToPx(box.x).toFixed(2)}px;top:${emuToPx(box.y).toFixed(2)}px;width:${Math.max(1, wPx).toFixed(2)}px;height:${Math.max(1, hPx).toFixed(2)}px;box-sizing:border-box;${
          transforms.length ? `transform:${transforms.join(' ')};` : ''
        }${shadowCss ? `filter:${shadowCss};` : ''}">${svgHtml}${textHtml}</div>`
      );
    }
  }

  return fragments;
}

function isDarkHex(color: string): boolean {
  const m = color.match(/^#([0-9a-f]{6})$/i);
  if (!m) return false;
  const r = parseInt(m[1].slice(0, 2), 16);
  const g = parseInt(m[1].slice(2, 4), 16);
  const b = parseInt(m[1].slice(4, 6), 16);
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  return lum < 128;
}

/* -------------------------------------------------------------------------- */
/* SLIDE BACKGROUND CASCADE                                                   */
/* -------------------------------------------------------------------------- */

async function resolveSlideBackgroundStyle(
  slideDoc: Document,
  slideRels: RelMap,
  layoutDoc: Document | null,
  layoutRels: RelMap,
  masterDoc: Document | null,
  masterRels: RelMap,
  zip: JSZip,
  theme: PptxTheme,
  mediaCache: Map<string, string>
): Promise<{ css: string; isDarkBg: boolean }> {
  const tryDocBg = async (doc: Document | null, rels: RelMap) => {
    if (!doc) return null;
    const bg = firstDescendant(doc, 'bg');
    if (!bg) return null;
    const bgPr = firstChild(bg, 'bgPr');
    if (bgPr) {
      const fill = await resolveFill(bgPr, rels, zip, theme, mediaCache);
      if (fill && fill.type !== 'none') return fill;
    }
    const bgRef = firstChild(bg, 'bgRef');
    if (bgRef) {
      const c = resolveColorElement(bgRef, theme);
      if (c) return { type: 'solid' as const, color: c };
    }
    return null;
  };

  const resolved =
    (await tryDocBg(slideDoc, slideRels)) ||
    (await tryDocBg(layoutDoc, layoutRels)) ||
    (await tryDocBg(masterDoc, masterRels));

  if (resolved?.type === 'solid' && resolved.color) {
    return { css: `background:${resolved.color};`, isDarkBg: isDarkHex(resolved.color) };
  }
  if (resolved?.type === 'gradient' && resolved.gradientCss) {
    const firstStop = resolved.gradientSvg?.stops[0]?.color || '#ffffff';
    return { css: `background:${resolved.gradientCss};`, isDarkBg: isDarkHex(firstStop) };
  }
  if (resolved?.type === 'image' && resolved.imageUrl) {
    return {
      css: `background-image:url("${resolved.imageUrl}");background-size:cover;background-position:center;`,
      isDarkBg: false,
    };
  }

  const defaultBgHex = `#${resolveSchemeColorHex('bg1', theme)}`;
  return { css: `background:${defaultBgHex};`, isDarkBg: isDarkHex(defaultBgHex) };
}

/* -------------------------------------------------------------------------- */
/* DECK PARSING & HTML SLIDE COMPOSITION                                      */
/* -------------------------------------------------------------------------- */

export interface ComposedPptxSlide {
  slideNumber: number;
  widthPx: number;
  heightPx: number;
  widthPt: number;
  heightPt: number;
  htmlDocument: string;
  plainText: string;
}

export async function parsePptxToComposedSlides(
  bytes: Uint8Array,
  options: { themeOverride?: 'original' | 'light' | 'dark'; includeSlideNumbers?: boolean } = {}
): Promise<ComposedPptxSlide[]> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw new Error(
      'Could not open this file as a valid PowerPoint (.pptx) archive. Legacy .ppt files must be saved as .pptx first.'
    );
  }

  // 1. Parse presentation.xml for exact slide dimensions & true slide order
  const presXml = zip.files['ppt/presentation.xml']
    ? await zip.files['ppt/presentation.xml'].async('string')
    : '';
  const presDoc = parseXml(presXml);
  const presRels = await readRels(zip, 'ppt/presentation.xml');

  const sldSz = firstDescendant(presDoc, 'sldSz');
  const slideCx = attrNum(sldSz, 'cx', 9144000); // default 10 in = 720pt = 960px
  const slideCy = attrNum(sldSz, 'cy', 5143500); // default 5.625 in = 405pt = 540px
  const widthPx = Math.max(320, Math.round(emuToPx(slideCx)));
  const heightPx = Math.max(240, Math.round(emuToPx(slideCy)));
  const widthPt = emuToPt(slideCx);
  const heightPt = emuToPt(slideCy);

  let slidePaths: string[] = [];
  if (presDoc) {
    const sldIds = allDescendants(firstDescendant(presDoc, 'sldIdLst'), 'sldId');
    for (const sId of sldIds) {
      const rId = attr(sId, 'id');
      if (rId && presRels[rId]?.target && zip.files[presRels[rId].target]) {
        slidePaths.push(presRels[rId].target);
      }
    }
  }
  if (slidePaths.length === 0) {
    slidePaths = Object.keys(zip.files)
      .filter((k) => /^ppt\/slides\/slide\d+\.xml$/i.test(k))
      .sort((a, b) => {
        const na = parseInt(a.match(/slide(\d+)\.xml/i)?.[1] || '0', 10);
        const nb = parseInt(b.match(/slide(\d+)\.xml/i)?.[1] || '0', 10);
        return na - nb;
      });
  }

  if (slidePaths.length === 0) {
    throw new Error('No slides were found inside this .pptx archive.');
  }

  // Caches for layouts, masters, themes, and base64 media
  const xmlDocCache = new Map<string, Document | null>();
  const relsCache = new Map<string, RelMap>();
  const mediaCache = new Map<string, string>();

  const loadDocCached = async (path: string): Promise<Document | null> => {
    if (!path || !zip.files[path]) return null;
    if (xmlDocCache.has(path)) return xmlDocCache.get(path)!;
    const str = await zip.files[path].async('string');
    const doc = parseXml(str);
    xmlDocCache.set(path, doc);
    return doc;
  };

  const loadRelsCached = async (path: string): Promise<RelMap> => {
    if (!path) return {};
    if (relsCache.has(path)) return relsCache.get(path)!;
    const rels = await readRels(zip, path);
    relsCache.set(path, rels);
    return rels;
  };

  const composedSlides: ComposedPptxSlide[] = [];
  const uidCounter = { n: 0 };

  for (let idx = 0; idx < slidePaths.length; idx++) {
    const slidePath = slidePaths[idx];
    const slideDoc = await loadDocCached(slidePath);
    if (!slideDoc) continue;
    const slideRels = await loadRelsCached(slidePath);

    // Resolve Slide Layout -> Slide Master -> Theme
    const layoutRel = Object.values(slideRels).find((r) => r.type.includes('/slideLayout'));
    const layoutPath = layoutRel?.target || '';
    const layoutDoc = await loadDocCached(layoutPath);
    const layoutRels = await loadRelsCached(layoutPath);

    const masterRel = Object.values(layoutRels).find((r) => r.type.includes('/slideMaster'));
    const masterPath = masterRel?.target || 'ppt/slideMasters/slideMaster1.xml';
    const masterDoc = await loadDocCached(masterPath);
    const masterRels = await loadRelsCached(masterPath);

    const themeRel = Object.values(masterRels).find((r) => r.type.includes('/theme'));
    const themePath = themeRel?.target || 'ppt/theme/theme1.xml';
    const themeDoc = await loadDocCached(themePath);

    const theme = parseThemeXml(themeDoc, masterDoc);

    // Master text styles
    const txStyles = firstDescendant(masterDoc, 'txStyles');
    const masterTitleStyles = parseLstStyle(firstChild(txStyles, 'titleStyle'), theme);
    const masterBodyStyles = parseLstStyle(firstChild(txStyles, 'bodyStyle'), theme);
    const masterOtherStyles = parseLstStyle(firstChild(txStyles, 'otherStyle'), theme);

    const layoutPlaceholders = extractPlaceholders(layoutDoc, theme);
    const masterPlaceholders = extractPlaceholders(masterDoc, theme);

    // Background cascade
    let bg = await resolveSlideBackgroundStyle(
      slideDoc,
      slideRels,
      layoutDoc,
      layoutRels,
      masterDoc,
      masterRels,
      zip,
      theme,
      mediaCache
    );

    if (options.themeOverride === 'dark') {
      bg = { css: 'background:#0f1117;', isDarkBg: true };
    } else if (options.themeOverride === 'light') {
      bg = { css: 'background:#ffffff;', isDarkBg: false };
    }

    const defaultTextColor = bg.isDarkBg
      ? '#f4f4f5'
      : `#${resolveSchemeColorHex('tx1', theme)}`;

    const collectedText: string[] = [];
    const ctx: RenderContext = {
      zip,
      theme,
      mediaCache,
      layoutPlaceholders,
      masterPlaceholders,
      masterTitleStyles,
      masterBodyStyles,
      masterOtherStyles,
      defaultTextColor,
      collectedText,
      uidCounter,
    };

    // Determine whether master shapes should show (showMasterSp="0" hides them)
    const showMasterOnSlide = attr(slideDoc.documentElement, 'showMasterSp') !== '0';
    const showMasterOnLayout = attr(layoutDoc?.documentElement, 'showMasterSp') !== '0';

    const layers: string[] = [];

    if (showMasterOnSlide && showMasterOnLayout && masterDoc && !options.themeOverride) {
      const masterTree = firstDescendant(masterDoc, 'spTree');
      const masterFrags = await renderShapeTreeElements(masterTree, masterRels, ctx, null, true);
      layers.push(...masterFrags);
    }

    if (showMasterOnSlide && layoutDoc && !options.themeOverride) {
      const layoutTree = firstDescendant(layoutDoc, 'spTree');
      const layoutFrags = await renderShapeTreeElements(layoutTree, layoutRels, ctx, null, true);
      layers.push(...layoutFrags);
    }

    const slideTree = firstDescendant(slideDoc, 'spTree');
    const slideFrags = await renderShapeTreeElements(slideTree, slideRels, ctx, null, false);
    layers.push(...slideFrags);

    const slideBadgeHtml = options.includeSlideNumbers
      ? `<div style="position:absolute;right:18px;bottom:14px;font-family:monospace;font-size:11px;color:${
          bg.isDarkBg ? 'rgba(255,255,255,0.55)' : 'rgba(24,24,27,0.5)'
        };pointer-events:none;">${idx + 1} / ${slidePaths.length}</div>`
      : '';

    const htmlDocument = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<style>
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    width: ${widthPx}px;
    height: ${heightPx}px;
    overflow: hidden;
    -webkit-font-smoothing: antialiased;
  }
</style>
</head>
<body style="${bg.css}">
  <div id="pptx-slide-root" style="position:relative;width:${widthPx}px;height:${heightPx}px;overflow:hidden;${bg.css}">
    ${layers.join('\n')}
    ${slideBadgeHtml}
  </div>
</body>
</html>`;

    composedSlides.push({
      slideNumber: idx + 1,
      widthPx,
      heightPx,
      widthPt,
      heightPt,
      htmlDocument,
      plainText: collectedText.join('\n'),
    });
  }

  return composedSlides;
}

/* -------------------------------------------------------------------------- */
/* OFFSCREEN HIGH-DPI CAPTURE & PDF ASSEMBLY                                  */
/* -------------------------------------------------------------------------- */

async function renderSlideIframeToCanvas(
  slide: ComposedPptxSlide,
  scale: number
): Promise<{
  canvas: HTMLCanvasElement;
  textBoxes: { text: string; x: number; y: number; fontSizePx: number }[];
}> {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.position = 'fixed';
  iframe.style.left = '-12000px';
  iframe.style.top = '0';
  iframe.style.width = `${slide.widthPx}px`;
  iframe.style.height = `${slide.heightPx}px`;
  iframe.style.border = 'none';
  iframe.style.pointerEvents = 'none';
  iframe.style.visibility = 'visible';

  try {
    await new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };
      iframe.addEventListener('load', finish, { once: true });
      setTimeout(finish, 1500);
      iframe.srcdoc = slide.htmlDocument;
      document.body.appendChild(iframe);
    });

    const iframeDoc = iframe.contentDocument!;
    const body = iframeDoc.body;
    const root = iframeDoc.getElementById('pptx-slide-root') || body;

    // Wait for any embedded images inside the slide to decode
    const imgs = Array.from(iframeDoc.images || []);
    if (imgs.length > 0) {
      await Promise.all(
        imgs.map(
          (img) =>
            img.complete
              ? Promise.resolve()
              : new Promise<void>((res) => {
                  img.addEventListener('load', () => res(), { once: true });
                  img.addEventListener('error', () => res(), { once: true });
                  setTimeout(res, 1000);
                })
        )
      );
    }
    await new Promise((r) => setTimeout(r, 50));

    // Collect real DOM text coordinates for invisible searchable PDF text layer
    const textBoxes: { text: string; x: number; y: number; fontSizePx: number }[] = [];
    const rootRect = root.getBoundingClientRect();
    const walker = iframeDoc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const parentTag = node.parentElement?.tagName?.toUpperCase();
      if (parentTag === 'STYLE' || parentTag === 'SCRIPT') continue;
      const txt = (node.textContent || '').replace(/\s+/g, ' ').trim();
      if (!txt) continue;
      const range = iframeDoc.createRange();
      range.selectNodeContents(node);
      const r = range.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      const parentEl = node.parentElement;
      const cs = parentEl && iframe.contentWindow ? iframe.contentWindow.getComputedStyle(parentEl) : null;
      const fontSizePx = cs ? parseFloat(cs.fontSize) || 14 : 14;
      textBoxes.push({
        text: txt,
        x: r.left - rootRect.left,
        y: r.top - rootRect.top + r.height * 0.82,
        fontSizePx,
      });
    }

    // Primary high-fidelity rasterizer: native browser SVG <foreignObject> -> <canvas>.
    // Because every media asset is an inline data URL and every element uses self-contained
    // inline styles + inline SVG, this uses the browser's own layout/Skia engine directly
    // (preserving 100% of CSS gradients, transforms, drop-shadows, flexbox, tables, SVG charts & markers).
    let canvas: HTMLCanvasElement | null = null;
    try {
      const xhtml = new XMLSerializer().serializeToString(root);
      const svgMarkup =
        `<svg xmlns="http://www.w3.org/2000/svg" width="${slide.widthPx}" height="${slide.heightPx}" viewBox="0 0 ${slide.widthPx} ${slide.heightPx}">` +
        `<foreignObject x="0" y="0" width="${slide.widthPx}" height="${slide.heightPx}">` +
        `<div xmlns="http://www.w3.org/1999/xhtml" style="margin:0;padding:0;width:${slide.widthPx}px;height:${slide.heightPx}px;overflow:hidden;box-sizing:border-box;">` +
        `<style>* { box-sizing: border-box; }</style>` +
        xhtml +
        `</div></foreignObject></svg>`;

      const svgDataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgMarkup)}`;
      const renderedImg = await new Promise<HTMLImageElement>((resolve, reject) => {
        const im = new Image();
        im.onload = () => resolve(im);
        im.onerror = () => reject(new Error('SVG foreignObject rasterization failed'));
        im.src = svgDataUrl;
      });

      const outCanvas = document.createElement('canvas');
      outCanvas.width = Math.max(1, Math.round(slide.widthPx * scale));
      outCanvas.height = Math.max(1, Math.round(slide.heightPx * scale));
      const ctx2d = outCanvas.getContext('2d')!;
      ctx2d.imageSmoothingEnabled = true;
      ctx2d.imageSmoothingQuality = 'high';
      ctx2d.fillStyle = '#ffffff';
      ctx2d.fillRect(0, 0, outCanvas.width, outCanvas.height);
      ctx2d.drawImage(renderedImg, 0, 0, outCanvas.width, outCanvas.height);
      // Verify canvas is not tainted before accepting
      outCanvas.toDataURL('image/png');
      canvas = outCanvas;
    } catch {
      // Fallback to html2canvas-pro if a browser restricts SVG foreignObject canvas export
      canvas = await html2canvas(body, {
        scale,
        x: 0,
        y: 0,
        scrollX: 0,
        scrollY: 0,
        width: slide.widthPx,
        height: slide.heightPx,
        windowWidth: slide.widthPx,
        windowHeight: slide.heightPx,
        useCORS: true,
        allowTaint: true,
        backgroundColor: '#ffffff',
        logging: false,
      });
    }

    return { canvas, textBoxes };
  } finally {
    if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
  }
}

/**
 * Generates live visual slide thumbnails when a .pptx file is uploaded in PowerPoint to PDF.
 */
export async function renderPptxThumbnails(
  bytes: Uint8Array,
  fileId: string
): Promise<RenderedPageThumbnail[]> {
  if (typeof document === 'undefined') return [];
  const slides = await parsePptxToComposedSlides(bytes);
  const thumbs: RenderedPageThumbnail[] = [];

  for (let i = 0; i < slides.length; i++) {
    const s = slides[i];
    const { canvas } = await renderSlideIframeToCanvas(s, 0.75);
    thumbs.push({
      pageIndex: i,
      originalPageIndex: i,
      sourceFileId: fileId,
      pageNumber: s.slideNumber,
      width: s.widthPt,
      height: s.heightPt,
      rotation: 0,
      dataUrl: canvas.toDataURL('image/jpeg', 0.88),
      selected: false,
    });
  }
  return thumbs;
}

/**
 * High-fidelity PowerPoint (.pptx) to PDF converter preserving exact slide dimensions,
 * master/layout inheritance, backgrounds, gradients, shapes, connectors, images (with crop),
 * tables, charts, typography, and an invisible searchable PDF text layer.
 */
export async function renderPptxToExactPdf(
  bytes: Uint8Array,
  filename: string,
  params: Record<string, any> = {},
  onProgress?: (msg: string) => void
): Promise<EngineOutput> {
  onProgress?.('Parsing PowerPoint OOXML package, theme, masters & slide layouts...');
  const themeOverride =
    params.theme === 'dark' || params.theme === 'light' ? params.theme : undefined;
  const includeSlideNumbers = Boolean(params.includeSlideNumbers);
  const renderScale = Number(params.qualityScale || 2);

  const slides = await parsePptxToComposedSlides(bytes, {
    themeOverride,
    includeSlideNumbers,
  });

  if (slides.length === 0) {
    throw new Error(`No renderable slides found inside "${filename}".`);
  }

  // Yield a frame so UI shows progress smoothly
  await new Promise((r) => setTimeout(r, 16));

  const pdfDoc = await PDFDocument.create();
  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);

  for (let i = 0; i < slides.length; i++) {
    const slide = slides[i];
    onProgress?.(`Rendering slide ${i + 1} / ${slides.length} at ${renderScale}x fidelity...`);

    const page = pdfDoc.addPage([slide.widthPt, slide.heightPt]);
    const { canvas, textBoxes } = await renderSlideIframeToCanvas(slide, renderScale);

    // Embed crisp slide image (high-quality PNG for lossless sharp text & vector edges)
    const pngDataUrl = canvas.toDataURL('image/png');
    const base64 = pngDataUrl.split(',')[1];
    const pngBytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const embedded = await pdfDoc.embedPng(pngBytes);

    page.drawImage(embedded, {
      x: 0,
      y: 0,
      width: slide.widthPt,
      height: slide.heightPt,
    });

    // Overlay invisible selectable/searchable text layer at exact PDF coordinates
    const pxToPtX = slide.widthPt / slide.widthPx;
    const pxToPtY = slide.heightPt / slide.heightPx;
    for (const tb of textBoxes) {
      const safeWinAnsi = tb.text.replace(/[^\x20-\x7E\xA0-\xFF]/g, ' ').trim();
      if (!safeWinAnsi) continue;
      const xPt = Math.max(0, Math.min(slide.widthPt - 4, tb.x * pxToPtX));
      const yPt = Math.max(2, Math.min(slide.heightPt - 4, slide.heightPt - tb.y * pxToPtY));
      const sizePt = Math.max(5, Math.min(72, tb.fontSizePx * pxToPtY));
      try {
        page.drawText(safeWinAnsi, {
          x: xPt,
          y: yPt,
          size: sizePt,
          font: helvetica,
          color: rgb(0, 0, 0),
          opacity: 0,
        });
      } catch {
        // Ignore unencodable glyphs in invisible search layer (visible pixels already have full Unicode)
      }
    }
  }

  const outBytes = await pdfDoc.save({ useObjectStreams: true });
  return {
    bytes: outBytes,
    filename: `${filename.replace(/\.(pptx|ppt)$/i, '')}.pdf`,
    mimeType: 'application/pdf',
    beforeSize: bytes.byteLength,
    afterSize: outBytes.byteLength,
    pageCount: pdfDoc.getPageCount(),
    canChainAsPdf: true,
    summaryMessage: `Converted ${pdfDoc.getPageCount()} PowerPoint slide(s) to PDF preserving exact native layout (${Math.round(slides[0].widthPt)}×${Math.round(slides[0].heightPt)} pt) with searchable text.`,
  };
}
