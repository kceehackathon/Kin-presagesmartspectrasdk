// Animated emoji mirror: a glossy 3D-look inline-SVG face that imitates the user's
// expression, plus the expression's name. The 3D look comes only from gradients
// (no filters, blur, CSS animation, timers or rAF). The host calls render() ~5x/s
// with already-eased pose params and we only touch the DOM when a quantized value
// actually changed.

// SmartSpectra ExpressionType -> display name + Unicode emoji.
export const EXPRESSIONS = Object.freeze({
  0: Object.freeze({ name: 'Neutral', emoji: '\u{1F610}' }),
  1: Object.freeze({ name: 'Angry', emoji: '\u{1F620}' }),
  2: Object.freeze({ name: 'Contempt', emoji: '\u{1F612}' }),
  3: Object.freeze({ name: 'Disgust', emoji: '\u{1F922}' }),
  4: Object.freeze({ name: 'Fear', emoji: '\u{1F628}' }),
  5: Object.freeze({ name: 'Happy', emoji: '\u{1F604}' }),
  6: Object.freeze({ name: 'Neutral', emoji: '\u{1F610}' }),
  7: Object.freeze({ name: 'Sad', emoji: '\u{1F622}' }),
  8: Object.freeze({ name: 'Surprise', emoji: '\u{1F62E}' }),
});

const CONFIDENCE_THRESHOLD = 18;
const NEUTRAL_FACE = Object.freeze({
  awake: 1, eyeOpen: 1, browRaise: 0, browAngle: 0, smile: 0.05, mouthOpen: 0, blush: 0,
});
const INK = '#3b2412';
const MOUTH_STROKE = '#5a2a1a';

let mountCounter = 0;

function num(v, lo, hi, dflt) {
  v = Number(v);
  if (!Number.isFinite(v)) v = dflt;
  return v < lo ? lo : v > hi ? hi : v;
}
const q = (v, d = 2) => v.toFixed(d);

export function mountEmoji(container) {
  const id = `kinEmoji-${++mountCounter}`;
  const stop = (o, c, a) => `<stop offset="${o}" stop-color="${c}"${a === undefined ? '' : ` stop-opacity="${a}"`}/>`;
  const defs =
    `<defs>` +
    // Sphere body, light from top-left.
    `<radialGradient id="${id}-body" cx="36%" cy="30%" r="82%" fx="32%" fy="26%">` +
    stop(0, '#fff3b0') + stop(0.35, '#ffd23f') + stop(0.75, '#f5a623') + stop(1, '#d17a0a') + `</radialGradient>` +
    // Terminator / rim: transparent in the lit area, darker toward the lower-right edge.
    `<radialGradient id="${id}-rim" cx="38%" cy="32%" r="78%">` +
    stop(0.6, '#8a4a05', 0) + stop(0.88, '#8a4a05', 0.18) + stop(1, '#6b3503', 0.42) + `</radialGradient>` +
    // Warm bounce light along the bottom edge.
    `<radialGradient id="${id}-bounce" cx="50%" cy="100%" r="55%">` +
    stop(0, '#ff9a3c', 0.5) + stop(1, '#ff9a3c', 0) + `</radialGradient>` +
    // Specular highlight.
    `<radialGradient id="${id}-spec" cx="50%" cy="50%" r="50%">` +
    stop(0, '#ffffff', 0.75) + stop(1, '#ffffff', 0) + `</radialGradient>` +
    // Contact shadow.
    `<radialGradient id="${id}-shadow" cx="50%" cy="50%" r="50%">` +
    stop(0, '#000', 0.18) + stop(1, '#000', 0) + `</radialGradient>` +
    // Cheeks.
    `<radialGradient id="${id}-cheek" cx="50%" cy="50%" r="50%">` +
    stop(0, '#ff6f7a', 0.95) + stop(1, '#ff6f7a', 0) + `</radialGradient>` +
    // Glossy eyes.
    `<radialGradient id="${id}-eye" cx="40%" cy="30%" r="80%">` +
    stop(0, '#6b4a30') + stop(0.5, '#2a160a') + stop(1, '#120803') + `</radialGradient>` +
    // Mouth interior.
    `<linearGradient id="${id}-mouth" x1="0" y1="0" x2="0" y2="1">` +
    stop(0, '#3a1208') + stop(1, '#7a2e22') + `</linearGradient>` +
    // Tongue.
    `<radialGradient id="${id}-tongue" cx="50%" cy="30%" r="75%">` +
    stop(0, '#ff9aa0') + stop(1, '#d9535f') + `</radialGradient>` +
    // Sweat drop.
    `<radialGradient id="${id}-drop" cx="35%" cy="35%" r="75%">` +
    stop(0, '#e6f7ff') + stop(0.5, '#8fd3f4') + stop(1, '#3f9ad0') + `</radialGradient>` +
    `</defs>`;

  container.innerHTML =
    `<div class="kin-emoji" style="display:flex;align-items:center;gap:18px">` +
    `<svg class="kin-emoji-face" viewBox="-10 -6 120 120" width="112" height="112" role="img" aria-label="Neutral" style="flex:none;display:block">` +
    defs +
    `<ellipse cx="50" cy="102" rx="34" ry="5" fill="url(#${id}-shadow)"/>` +
    `<g data-k="root">` +
    `<circle cx="50" cy="50" r="46" fill="url(#${id}-body)"/>` +
    `<circle cx="50" cy="50" r="46" fill="url(#${id}-rim)"/>` +
    `<ellipse cx="50" cy="90" rx="30" ry="10" fill="url(#${id}-bounce)"/>` +
    `<g data-k="feat">` +
    `<ellipse data-k="cheekL" cx="23" cy="62" rx="11" ry="7" fill="url(#${id}-cheek)" opacity="0"/>` +
    `<ellipse data-k="cheekR" cx="77" cy="62" rx="11" ry="7" fill="url(#${id}-cheek)" opacity="0"/>` +
    `<ellipse data-k="scL" cx="35" cy="45" rx="8.5" ry="8" fill="#fff" stroke="#c9a15a" stroke-width="1" display="none"/>` +
    `<ellipse data-k="scR" cx="65" cy="45" rx="8.5" ry="8" fill="#fff" stroke="#c9a15a" stroke-width="1" display="none"/>` +
    `<ellipse data-k="eyeL" cx="35" cy="45" rx="5" ry="6" fill="url(#${id}-eye)"/>` +
    `<ellipse data-k="eyeR" cx="65" cy="45" rx="5" ry="6" fill="url(#${id}-eye)"/>` +
    `<ellipse data-k="glintL" cx="33.2" cy="42.6" rx="1.8" ry="1.8" fill="#fff" opacity="0.95"/>` +
    `<ellipse data-k="glintR" cx="63.2" cy="42.6" rx="1.8" ry="1.8" fill="#fff" opacity="0.95"/>` +
    `<line data-k="browL" x1="-8" y1="0" x2="8" y2="0" stroke="${INK}" stroke-width="4.4" stroke-linecap="round"/>` +
    `<line data-k="browR" x1="-8" y1="0" x2="8" y2="0" stroke="${INK}" stroke-width="4.4" stroke-linecap="round"/>` +
    `<path data-k="wrinkle" d="M45 52 Q50 49 55 52 M47 55 Q50 53 53 55" fill="none" stroke="#a8630f" stroke-width="1.8" stroke-linecap="round" display="none"/>` +
    `<path data-k="lip" d="" transform="translate(0 1.8)" fill="none" stroke="#fff0b8" stroke-opacity="0.55" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path data-k="mouth" d="" fill="none" stroke="${MOUTH_STROKE}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<ellipse data-k="tongue" cx="50" cy="75" rx="7.5" ry="3.4" fill="url(#${id}-tongue)" display="none"/>` +
    `<path data-k="sweat" d="M82 22 Q88 31 82 36 Q76 31 82 22Z" fill="url(#${id}-drop)" stroke="#3f9ad0" stroke-width="0.8" display="none"/>` +
    `<ellipse data-k="sweatGlint" cx="80.6" cy="31" rx="1.1" ry="2" fill="#fff" opacity="0.85" display="none"/>` +
    `</g>` +
    `<ellipse cx="33" cy="22" rx="20" ry="12" transform="rotate(-32 33 22)" fill="url(#${id}-spec)"/>` +
    `</g></svg>` +
    `<div class="kin-emoji-text" style="min-width:0">` +
    `<div class="kin-emoji-name" aria-live="polite" style="font-family:var(--font-display);font-size:30px;line-height:1.15;color:#241b16;white-space:nowrap"></div>` +
    `<div class="kin-emoji-note" style="font-family:var(--font-ui);font-size:13px;line-height:1.4;color:#7c6a5c;margin-top:4px"></div>` +
    `</div></div>`;

  const $ = (k) => container.querySelector(`[data-k="${k}"]`);
  const svg = container.querySelector('.kin-emoji-face');
  const nameEl = container.querySelector('.kin-emoji-name');
  const noteEl = container.querySelector('.kin-emoji-note');
  const els = {};
  for (const k of ['root', 'feat', 'cheekL', 'cheekR', 'scL', 'scR', 'eyeL', 'eyeR',
    'glintL', 'glintR', 'browL', 'browR', 'wrinkle', 'lip', 'mouth', 'tongue', 'sweat',
    'sweatGlint']) els[k] = $(k);

  // Last-written string per "element:attr"; identical writes are skipped.
  const cache = Object.create(null);
  function set(k, attr, val) {
    const key = k + ':' + attr;
    if (cache[key] === val) return;
    cache[key] = val;
    els[k].setAttribute(attr, val);
  }
  const show = (k, on) => set(k, 'display', on ? 'inline' : 'none');
  let lastName = '', lastNote = '', lastLabel = '';

  // Mouth geometry (y grows downward; resting mouth line at y=68).
  // - corner y = 68 - smile*7 (smile>0 lifts corners, <0 drops them)
  // - top-lip control y = 68 + smile*9 -> curve midpoint sags for smiles, arches for frowns
  // - bottom-lip control = top control + open*30 -> midpoint drops open*15 below the top lip
  // `skew` lifts the right corner (contempt smirk).
  function mouthGeometry(smile, open, skew) {
    const xl = 33, xr = 67;
    const yl = 68 - smile * 7 + open * 1.5;
    const yr = 68 - smile * 7 + open * 1.5 - skew;
    const top = 68 + smile * 9 - open * 2;
    const bot = top + open * 30;
    const d = `M${q(xl, 1)} ${q(yl, 1)} Q50 ${q(top, 1)} ${q(xr, 1)} ${q(yr, 1)}` +
      (open > 0.08 ? ` Q50 ${q(bot, 1)} ${q(xl, 1)} ${q(yl, 1)}Z` : '');
    // y of the lower lip midpoint, used to seat the tongue
    return { d, lowMid: (yl + yr) / 4 + (top + bot) / 4 };
  }

  function render(state) {
    const s = state || {};
    const enabled = !!s.enabled;
    const seen = enabled && !!s.seen;
    const conf = num(s.confidence, 0, 100, 0);
    let type = Number(s.type);
    if (!Object.prototype.hasOwnProperty.call(EXPRESSIONS, type)) type = 0;
    if (!seen || conf < CONFIDENCE_THRESHOLD) type = 6;
    const ex = EXPRESSIONS[type];

    // Not enabled / no face yet: neutral pose, dimmed.
    const f = seen ? (s.face || NEUTRAL_FACE) : NEUTRAL_FACE;
    const awake = seen ? num(f.awake, 0, 1, 1) : 1;
    const eyeOpen = num(f.eyeOpen, 0.02, 1.35, 1);
    const browRaise = num(f.browRaise, -1, 1, 0);
    const browAngle = num(f.browAngle, -1, 1, 0);
    const smile = num(f.smile, -1, 1, 0);
    const open = num(f.mouthOpen, 0, 1.2, 0);
    const blush = num(f.blush, 0, 1, 0);

    // Whole-face dimming by mode; features additionally fade in with `awake`.
    set('root', 'opacity', !enabled ? '0.35' : seen ? '1' : '0.6');
    set('feat', 'opacity', q(0.55 + 0.45 * awake));
    // Very slight head tilt from brow angle.
    set('feat', 'transform', `rotate(${q(browAngle * 2, 1)} 50 50)`);

    // Eyes: ry scales with openness (min 0.8 so a blink is a thin line).
    // Above 1.1 a white sclera ring appears and the pupil stops growing.
    const wide = eyeOpen > 1.1;
    const ry = Math.max(0.8, 6 * eyeOpen);
    const pupilRy = wide ? Math.min(ry, 6.4) : ry;
    const rx = wide ? 4.2 : 5;
    set('eyeL', 'ry', q(pupilRy, 1)); set('eyeR', 'ry', q(pupilRy, 1));
    set('eyeL', 'rx', q(rx, 1)); set('eyeR', 'rx', q(rx, 1));
    show('scL', wide); show('scR', wide);
    if (wide) {
      set('scL', 'ry', q(ry + 2, 1)); set('scR', 'ry', q(ry + 2, 1));
    }
    // Catch-lights: scale with the eye, hidden while blinking.
    const glint = eyeOpen >= 0.3;
    show('glintL', glint); show('glintR', glint);
    if (glint) {
      const gr = Math.min(1.8, pupilRy * 0.32);
      const gy = 45 - pupilRy * 0.4;
      set('glintL', 'ry', q(gr, 1)); set('glintR', 'ry', q(gr, 1));
      set('glintL', 'rx', q(Math.min(1.8, gr + 0.1), 1)); set('glintR', 'rx', q(Math.min(1.8, gr + 0.1), 1));
      set('glintL', 'cy', q(gy, 1)); set('glintR', 'cy', q(gy, 1));
    }

    // Brows: y = 29 - raise*7; rotation = angle*22 deg. The left brow's inner end is
    // on its right, so +angle (inner down) is clockwise there and counter-clockwise
    // on the right brow (mirrored).
    const by = 29 - browRaise * 7;
    const ang = browAngle * 22;
    set('browL', 'transform', `translate(35 ${q(by, 1)}) rotate(${q(ang, 1)})`);
    set('browR', 'transform', `translate(65 ${q(by, 1)}) rotate(${q(-ang, 1)})`);

    // Mouth, with per-type accents (all static toggles).
    const skew = type === 2 && seen ? 4 : 0;
    const m = mouthGeometry(smile, open, skew);
    set('mouth', 'd', m.d);
    set('lip', 'd', m.d);
    set('mouth', 'fill', open > 0.08 ? `url(#${id}-mouth)` : 'none');
    show('tongue', open > 0.5);
    if (open > 0.5) set('tongue', 'cy', q(m.lowMid - 1, 1));
    show('wrinkle', type === 3 && seen);
    const sweat = type === 4 && seen;
    show('sweat', sweat); show('sweatGlint', sweat);

    // Cheeks.
    const cheek = q(blush * 0.8);
    set('cheekL', 'opacity', cheek); set('cheekR', 'opacity', cheek);

    // Text.
    const nameText = `${ex.emoji} ${ex.name}`;
    if (nameText !== lastName) { lastName = nameText; nameEl.textContent = nameText; }
    // `state.note` lets the host override the line (paused, not on this key).
    const note = typeof s.note === 'string' && s.note ? s.note
      : !enabled ? 'Expression mirror is off'
      : !seen ? 'Watching for a face'
      : `${Math.round(conf)}% · visible expression, not a feeling`;
    if (note !== lastNote) { lastNote = note; noteEl.textContent = note; }
    const label = `Expression: ${ex.name}`;
    if (label !== lastLabel) { lastLabel = label; svg.setAttribute('aria-label', label); }
  }

  render({ enabled: false, seen: false, type: 6, confidence: 0, face: NEUTRAL_FACE });
  return { render };
}
