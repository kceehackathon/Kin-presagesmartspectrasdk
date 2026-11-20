// The portrait is one SVG, mounted in both the studio and the frame window.
// Every moving part is driven by live signal state: nothing here invents a
// heartbeat or a breath. The only ambient motion is the dust and the light,
// which are deliberately not presented as measurements.

const SVG = `
<svg class="portrait-svg" viewBox="0 0 600 820" role="img"
     aria-label="A stylized portrait that responds to live pulse, breathing, and visible facial expression.">
  <defs>
    <linearGradient id="archBg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#33221a"/>
      <stop offset=".55" stop-color="#1d1511"/>
      <stop offset="1" stop-color="#0e0b09"/>
    </linearGradient>
    <linearGradient id="skin" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#f4dfc6"/>
      <stop offset=".52" stop-color="#d8ab87"/>
      <stop offset="1" stop-color="#bc7c5e"/>
    </linearGradient>
    <linearGradient id="bust" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#bd8265"/>
      <stop offset=".6" stop-color="#96573f"/>
      <stop offset="1" stop-color="#6f3b2c"/>
    </linearGradient>
    <linearGradient id="hair" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#3a241b"/>
      <stop offset="1" stop-color="#130d0b"/>
    </linearGradient>
    <linearGradient id="gold" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#f0c58c"/>
      <stop offset=".5" stop-color="#b77a4c"/>
      <stop offset="1" stop-color="#6f422d"/>
    </linearGradient>
    <radialGradient id="ambient" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="#f0a563" stop-opacity=".55"/>
      <stop offset=".55" stop-color="#b45e3b" stop-opacity=".15"/>
      <stop offset="1" stop-color="#0e0b09" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="halo" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="#ffd39b" stop-opacity=".55"/>
      <stop offset=".45" stop-color="#e09a61" stop-opacity=".18"/>
      <stop offset="1" stop-color="#e09a61" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="heartGlow" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="#ffd7a1" stop-opacity=".85"/>
      <stop offset=".35" stop-color="#f09b58" stop-opacity=".35"/>
      <stop offset="1" stop-color="#c25f35" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="vignette" cx="50%" cy="46%" r="58%">
      <stop offset=".45" stop-color="#0b0908" stop-opacity="0"/>
      <stop offset="1" stop-color="#0b0908" stop-opacity=".78"/>
    </radialGradient>
    <linearGradient id="rim" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ffe0ad" stop-opacity=".9"/>
      <stop offset=".5" stop-color="#eaa15f" stop-opacity=".2"/>
      <stop offset="1" stop-color="#eaa15f" stop-opacity="0"/>
    </linearGradient>
    <clipPath id="archClip">
      <path d="M 60 800 L 60 286 C 60 138 160 42 300 42 C 440 42 540 138 540 286 L 540 800 Z"/>
    </clipPath>
  </defs>

  <g clip-path="url(#archClip)">
    <rect width="600" height="820" fill="url(#archBg)"/>
    <ellipse id="ambient" cx="300" cy="340" rx="286" ry="330" fill="url(#ambient)" opacity=".35"/>
    <ellipse id="halo" cx="300" cy="300" rx="218" ry="258" fill="url(#halo)" opacity=".2"/>

    <g id="aura" opacity=".55">
      <ellipse class="aura-ring" cx="300" cy="486" rx="238" ry="306" fill="none" stroke="#e8b98a" stroke-width="1" stroke-dasharray="2 13" opacity=".28"/>
      <ellipse class="aura-ring" cx="300" cy="486" rx="278" ry="346" fill="none" stroke="#e8b98a" stroke-width=".8" stroke-dasharray="1 17" opacity=".2"/>
      <ellipse class="aura-ring" cx="300" cy="486" rx="318" ry="386" fill="none" stroke="#e8b98a" stroke-width=".7" stroke-dasharray="1 21" opacity=".13"/>
    </g>

    <g id="motes"></g>

    <g id="figure" opacity=".72">
      <path id="bust" d="M 64 820 C 76 690 138 600 228 564 C 250 554 272 548 300 548 C 328 548 350 554 372 564 C 462 600 524 690 536 820 Z" fill="url(#bust)"/>
      <path d="M 228 564 C 250 596 350 596 372 564 C 400 578 420 606 432 640 C 390 620 350 610 300 610 C 250 610 210 620 168 640 C 180 606 200 578 228 564 Z" fill="#5d3025" opacity=".28"/>
      <path d="M 258 418 L 258 548 C 258 574 272 584 300 586 C 328 584 342 574 342 548 L 342 418 Z" fill="url(#skin)"/>
      <path d="M 258 430 C 272 458 328 458 342 430 L 342 418 L 258 418 Z" fill="#9d5b43" opacity=".28"/>
      <path d="M 238 560 Q 268 576 300 566 Q 332 576 362 560" fill="none" stroke="#4a261c" stroke-width="1.4" opacity=".28"/>
      <path d="M 214 590 Q 258 612 300 606 Q 342 612 386 590" fill="none" stroke="#f3c69c" stroke-width="1" opacity=".12"/>

      <ellipse id="ear-left" cx="190" cy="312" rx="20" ry="33" fill="url(#skin)" stroke="#6f3e2d" stroke-width=".8" opacity=".9"/>
      <ellipse id="ear-right" cx="410" cy="312" rx="20" ry="33" fill="url(#skin)" stroke="#6f3e2d" stroke-width=".8" opacity=".9"/>
      <path d="M 184 300 Q 194 312 184 326" fill="none" stroke="#8b513a" stroke-width="1.2" opacity=".5"/>
      <path d="M 416 300 Q 406 312 416 326" fill="none" stroke="#8b513a" stroke-width="1.2" opacity=".5"/>

      <path id="head" d="M 300 148 C 372 148 414 202 414 282 C 414 356 386 414 344 438 C 326 449 312 452 300 452 C 288 452 274 449 256 438 C 214 414 186 356 186 282 C 186 202 228 148 300 148 Z" fill="url(#skin)"/>
      <path d="M 186 282 C 186 356 214 414 256 438 C 274 449 288 452 300 452 L 300 148 C 228 148 186 202 186 282 Z" fill="#8e513a" opacity=".09"/>
      <path d="M 300 154 C 360 154 400 204 402 272 C 390 218 358 184 300 176 C 242 184 210 218 198 272 C 200 204 240 154 300 154 Z" fill="#f7e4cd" opacity=".18"/>
      <path id="jaw-line" d="M 230 398 C 250 430 274 444 300 446 C 326 444 350 430 370 398" fill="none" stroke="#9d5b43" stroke-width="1.2" opacity=".28"/>

      <path id="hair" d="M 184 306 C 176 208 218 146 300 144 C 382 146 424 208 416 306 C 406 252 386 218 350 198 C 330 187 302 184 276 188 C 240 196 212 228 198 272 C 192 284 187 295 184 306 Z" fill="url(#hair)"/>
      <path d="M 210 238 C 240 192 276 172 316 170 C 356 168 390 190 402 232" fill="none" stroke="#6d422f" stroke-width="2" opacity=".5"/>
      <path d="M 232 202 C 258 180 282 172 306 170" fill="none" stroke="#9a6347" stroke-width="1" opacity=".3"/>
      <path d="M 350 198 C 370 210 386 232 396 262" fill="none" stroke="#0c0807" stroke-width="3" opacity=".55"/>

      <g id="face" opacity=".5">
        <g id="brow-left">
          <path d="M 222 264 Q 252 252 286 262" fill="none" stroke="#3a2118" stroke-width="5.2" stroke-linecap="round"/>
        </g>
        <g id="brow-right">
          <path d="M 314 262 Q 348 252 378 264" fill="none" stroke="#3a2118" stroke-width="5.2" stroke-linecap="round"/>
        </g>

        <g id="eye-left">
          <path d="M 226 300 Q 253 282 280 300 Q 253 318 226 300 Z" fill="#f7ead9"/>
          <circle cx="253" cy="301" r="9" fill="#5a3527"/>
          <circle cx="253" cy="301" r="4.5" fill="#1b1210"/>
          <circle cx="250" cy="297" r="2.1" fill="#fff8ec" opacity=".9"/>
          <path d="M 226 300 Q 253 282 280 300" fill="none" stroke="#3a2118" stroke-width="2.6" stroke-linecap="round"/>
          <path d="M 231 308 Q 253 315 275 308" fill="none" stroke="#a76a51" stroke-width="1.1" opacity=".55"/>
        </g>
        <g id="eye-right">
          <path d="M 320 300 Q 347 282 374 300 Q 347 318 320 300 Z" fill="#f7ead9"/>
          <circle cx="347" cy="301" r="9" fill="#5a3527"/>
          <circle cx="347" cy="301" r="4.5" fill="#1b1210"/>
          <circle cx="344" cy="297" r="2.1" fill="#fff8ec" opacity=".9"/>
          <path d="M 320 300 Q 347 282 374 300" fill="none" stroke="#3a2118" stroke-width="2.6" stroke-linecap="round"/>
          <path d="M 325 308 Q 347 315 369 308" fill="none" stroke="#a76a51" stroke-width="1.1" opacity=".55"/>
        </g>

        <path id="nose" d="M 300 300 C 297 322 293 344 286 354 C 292 359 300 360 308 354" fill="none" stroke="#7d452f" stroke-width="2.2" stroke-linecap="round" opacity=".62"/>
        <path d="M 286 354 Q 292 358 298 355" fill="none" stroke="#5d3025" stroke-width="1.2" opacity=".5"/>
        <path d="M 302 355 Q 308 358 314 354" fill="none" stroke="#5d3025" stroke-width="1.2" opacity=".5"/>

        <ellipse id="blush-left" cx="234" cy="354" rx="31" ry="17" fill="#d46f52" opacity=".12"/>
        <ellipse id="blush-right" cx="366" cy="354" rx="31" ry="17" fill="#d46f52" opacity=".12"/>

        <ellipse id="mouth-inner" cx="300" cy="396" rx="19" ry="0" fill="#3a1414" opacity="0"/>
        <path id="mouth" d="M 268 392 Q 300 388 332 392 Q 300 400 268 392 Z" fill="#a9554c" stroke="#6e2f2d" stroke-width="1" stroke-linejoin="round"/>
        <ellipse id="lip-highlight" cx="300" cy="398" rx="12" ry="1.4" fill="#f0b39d" opacity=".22"/>

        <path d="M 286 426 Q 300 432 314 426" fill="none" stroke="#8b513a" stroke-width="1.2" opacity=".3"/>
        <path d="M 244 380 Q 252 388 260 384" fill="none" stroke="#8b513a" stroke-width=".9" opacity=".22"/>
        <path d="M 356 380 Q 348 388 340 384" fill="none" stroke="#8b513a" stroke-width=".9" opacity=".22"/>
      </g>

      <path id="head-rim" d="M 300 148 C 372 148 414 202 414 282 C 414 356 386 414 344 438" fill="none" stroke="url(#rim)" stroke-width="2.4" opacity=".3"/>
    </g>

    <g id="pulse-light">
      <circle id="heart-glow" cx="300" cy="612" r="86" fill="url(#heartGlow)" opacity=".12"/>
      <circle id="heart-core" cx="300" cy="612" r="5.5" fill="#ffdcae" opacity=".35"/>
      <path id="chest-rim" d="M 92 790 C 110 690 160 610 230 574" fill="none" stroke="url(#rim)" stroke-width="1.6" opacity=".08"/>
      <path id="chest-rim-right" d="M 508 790 C 490 690 440 610 370 574" fill="none" stroke="url(#rim)" stroke-width="1.6" opacity=".08"/>
    </g>

    <rect width="600" height="820" fill="url(#vignette)"/>
  </g>

  <path d="M 60 800 L 60 286 C 60 138 160 42 300 42 C 440 42 540 138 540 286 L 540 800"
        fill="none" stroke="url(#gold)" stroke-width="1.4" opacity=".72"/>
  <path d="M 68 800 L 68 287 C 68 146 164 52 300 52 C 436 52 532 146 532 287 L 532 800"
        fill="none" stroke="#f3d4a5" stroke-width=".6" opacity=".16"/>
</svg>`;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function num(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function mouthPath(cx, cy, width, smile, open) {
  const half = width / 2;
  const cornerY = cy - smile * 4;
  const topY = cy - 3 + smile * 2;
  const bottomY = cy + 4 + smile * 8 + open * 16;
  return `M ${cx - half} ${cornerY} Q ${cx} ${topY} ${cx + half} ${cornerY} Q ${cx} ${bottomY} ${cx - half} ${cornerY} Z`;
}

function makeMotes(count) {
  // Deterministic layout so the studio and frame windows show the same dust.
  let seed = 0x9e3779b9;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const motes = [];
  for (let i = 0; i < count; i += 1) {
    motes.push({
      x: 80 + rand() * 440,
      y: 90 + rand() * 650,
      r: 0.7 + rand() * 2.1,
      phase: rand() * Math.PI * 2,
      speed: 0.08 + rand() * 0.22,
      opacity: 0.25 + rand() * 0.65,
    });
  }
  return motes;
}

export function mountPortrait(container) {
  container.innerHTML = SVG;

  const pulseGlow = document.createElement('div');
  pulseGlow.className = 'portrait-pulse';
  pulseGlow.setAttribute('aria-hidden', 'true');
  container.appendChild(pulseGlow);

  const $ = (id) => container.querySelector(`#${id}`);
  const els = {
    ambient: $('ambient'),
    halo: $('halo'),
    aura: $('aura'),
    figure: $('figure'),
    face: $('face'),
    eyeLeft: $('eye-left'),
    eyeRight: $('eye-right'),
    browLeft: $('brow-left'),
    browRight: $('brow-right'),
    mouth: $('mouth'),
    mouthInner: $('mouth-inner'),
    lipHighlight: $('lip-highlight'),
    blushLeft: $('blush-left'),
    blushRight: $('blush-right'),
    headRim: $('head-rim'),
    heartGlow: $('heart-glow'),
    heartCore: $('heart-core'),
    chestRim: $('chest-rim'),
    chestRimRight: $('chest-rim-right'),
    motes: $('motes'),
  };

  const motes = makeMotes(26);
  const moteEls = motes.map((mote) => {
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', mote.x.toFixed(2));
    circle.setAttribute('cy', mote.y.toFixed(2));
    circle.setAttribute('r', mote.r.toFixed(2));
    circle.setAttribute('fill', '#f7d7ad');
    circle.setAttribute('opacity', (0.035 + 0.22 * mote.opacity).toFixed(3));
    els.motes.appendChild(circle);
    return circle;
  });

  const styleCache = new Map();
  let lastWarmth = null;
  let lastFaceKey = '';
  let lastMouthPath = '';

  function setVar(name, value) {
    if (styleCache.get(name) === value) return;
    styleCache.set(name, value);
    container.style.setProperty(name, value);
  }

  function applyFace(face) {
    const awake = clamp(num(face.awake), 0, 1);
    const eyeOpen = clamp(num(face.eyeOpen, 1), 0.02, 1.35);
    const browRaise = clamp(num(face.browRaise), -1, 1);
    const browAngle = clamp(num(face.browAngle), -1, 1);
    const smile = clamp(num(face.smile), -1, 1);
    const mouthOpen = clamp(num(face.mouthOpen), 0, 1.2);
    const blush = clamp(num(face.blush, 0.12), 0, 1);

    const lid = clamp((0.045 + 0.955 * awake) * eyeOpen, 0.02, 1.35);
    els.eyeLeft.setAttribute('transform', `translate(253 301) scale(1 ${lid.toFixed(3)}) translate(-253 -301)`);
    els.eyeRight.setAttribute('transform', `translate(347 301) scale(1 ${lid.toFixed(3)}) translate(-347 -301)`);
    els.face.setAttribute('opacity', (0.28 + awake * 0.72).toFixed(3));

    const browY = -browRaise * 6.5;
    const browRot = browAngle * 9;
    els.browLeft.setAttribute('transform', `translate(0 ${browY.toFixed(2)}) rotate(${(-browRot).toFixed(2)} 254 260)`);
    els.browRight.setAttribute('transform', `translate(0 ${browY.toFixed(2)}) rotate(${browRot.toFixed(2)} 346 260)`);

    const nextMouthPath = mouthPath(300, 392, 64, smile, mouthOpen);
    if (nextMouthPath !== lastMouthPath) {
      lastMouthPath = nextMouthPath;
      els.mouth.setAttribute('d', nextMouthPath);
    }
    const innerRy = Math.max(0, mouthOpen * 9);
    els.mouthInner.setAttribute('ry', innerRy.toFixed(2));
    els.mouthInner.setAttribute('cy', (394 - smile * 2).toFixed(2));
    els.mouthInner.setAttribute('opacity', mouthOpen > 0.04 ? '0.82' : '0');
    els.lipHighlight.setAttribute('cy', (398 + smile * 5 + mouthOpen * 8).toFixed(2));
    els.lipHighlight.setAttribute('opacity', (0.08 + awake * 0.18).toFixed(3));
    els.blushLeft.setAttribute('opacity', (0.05 + blush * 0.22).toFixed(3));
    els.blushRight.setAttribute('opacity', (0.05 + blush * 0.22).toFixed(3));
  }

  function render(state = {}) {
    const presence = clamp(num(state.presence, 0.3), 0, 1);
    const pulse = state.pulse || {};
    const breath = state.breath || {};
    const face = state.face || {};

    const pulseActive = Boolean(pulse.active);
    const pulseEnv = pulseActive ? clamp(num(pulse.envelope), 0, 1) : 0;
    const breathActive = Boolean(breath.active);
    const breathPhase = breathActive ? clamp(num(breath.phase), -1, 1) : 0;

    const pulseRate = Number(pulse.bpm);
    const breathRate = Number(breath.rate);
    const pulseDuration = Number.isFinite(pulseRate) && pulseRate > 0
      ? Math.min(2.4, Math.max(0.42, 60 / pulseRate))
      : 1.1;
    const breathDuration = Number.isFinite(breathRate) && breathRate > 0
      ? Math.min(12, Math.max(2.5, 60 / breathRate))
      : 6;

    setVar('--kin-pulse-duration', `${pulseDuration.toFixed(2)}s`);
    setVar('--kin-breath-duration', `${breathDuration.toFixed(2)}s`);
    setVar('--kin-pulse-play', pulseActive ? 'running' : 'paused');
    setVar('--kin-breath-play', breathActive ? 'running' : 'paused');
    setVar('--kin-pulse-opacity', (0.32 + pulseEnv * 0.42).toFixed(3));
    setVar('--kin-pulse-scale', (0.28 + pulseEnv * 0.45).toFixed(3));

    const nextWarmth = (0.35 + presence * 0.45 + pulseEnv * 0.2).toFixed(2);
    if (nextWarmth !== lastWarmth) {
      lastWarmth = nextWarmth;
      container.dataset.warmth = nextWarmth;
    }

    // Expression is the only part that needs a fast, discrete pose update.
    // Throttle it and skip identical frames; pulse and breath run in CSS so
    // the renderer stays free for the camera self-view.
    if (face.active) {
      const faceKey = [
        num(face.awake), num(face.eyeOpen, 1), num(face.browRaise),
        num(face.browAngle), num(face.smile), num(face.mouthOpen),
        num(face.blush, 0.12),
      ].map((value) => Number(value).toFixed(2)).join('|');
      if (faceKey !== lastFaceKey) {
        lastFaceKey = faceKey;
        applyFace(face);
      }
    }
  }

  render({});
  return { render };
}

export const idleState = Object.freeze({
  presence: 0.32,
  status: 'idle',
  pulse: { active: false, envelope: 0 },
  breath: { active: false, phase: 0 },
  face: { awake: 0, eyeOpen: 1, browRaise: 0, browAngle: 0, smile: 0, mouthOpen: 0, blush: 0.12 },
});
