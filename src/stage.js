// The frame window is a second, frameless view of the same portrait. It owns
// no camera and no SDK state: the studio broadcasts its already-derived
// animation state over BroadcastChannel (with window.postMessage as a
// fallback for file:// origins where BroadcastChannel is unavailable).

import { mountPortrait, idleState } from './portrait.js';

const $ = (id) => document.getElementById(id);

const frameStatus = $('frame-status');
const frameStatusLabel = $('frame-status-label');
const framePulse = $('frame-pulse');
const frameBreath = $('frame-breath');
const frameExpression = $('frame-expression');
const fullscreenBtn = $('frame-fullscreen');
const closeBtn = $('frame-close');

const portrait = mountPortrait($('stage-portrait'));

let latest = {
  render: idleState,
  status: { label: 'Waiting for studio', tone: 'muted' },
  ui: {
    pulse: { enabled: false, rate: null },
    breath: { enabled: false, rate: null },
    face: { enabled: false, label: '—', seen: false },
  },
};
let lastMessageAt = 0;
let wentIdle = false;

function applyMeta() {
  frameStatusLabel.textContent = latest.status.label || 'Waiting for studio';
  frameStatus.dataset.tone = latest.status.tone || 'muted';

  const pulse = latest.ui && latest.ui.pulse;
  const breath = latest.ui && latest.ui.breath;
  const face = latest.ui && latest.ui.face;

  framePulse.textContent = pulse && pulse.enabled && pulse.rate != null
    ? String(Math.round(pulse.rate))
    : '—';
  frameBreath.textContent = breath && breath.enabled && breath.rate != null
    ? String(Math.round(breath.rate))
    : '—';
  frameExpression.textContent = face && face.enabled && face.seen ? face.label : '—';
}

function receive(data) {
  if (!data || data.type !== 'kin-state') return;
  latest = data;
  lastMessageAt = performance.now();
  wentIdle = false;
  applyMeta();
}

function announce() {
  const message = { type: 'kin-stage-ready' };
  if (channel) {
    try {
      channel.postMessage(message);
    } catch {
      /* channel may be unavailable on this origin */
    }
  }
  try {
    if (window.opener) window.opener.postMessage(message, '*');
  } catch {
    /* the opener may already be gone */
  }
}

let channel = null;
if (typeof BroadcastChannel === 'function') {
  try {
    channel = new BroadcastChannel('kin-stage');
    channel.addEventListener('message', (event) => receive(event.data));
  } catch {
    channel = null;
  }
}

window.addEventListener('message', (event) => {
  receive(event.data);
});

fullscreenBtn.addEventListener('click', () => {
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  } else {
    document.documentElement.requestFullscreen().catch(() => {});
  }
});

closeBtn.addEventListener('click', () => {
  window.close();
});


let lastPaintAt = 0;

function loop(now) {
  // If the studio has gone away, let the portrait sleep rather than holding
  // a stale signal forever. This is not a measurement state.
  if (!wentIdle && lastMessageAt && now - lastMessageAt > 5000) {
    wentIdle = true;
    latest = {
      render: idleState,
      status: { label: 'Waiting for studio', tone: 'muted' },
      ui: {
        pulse: { enabled: false, rate: null },
        breath: { enabled: false, rate: null },
        face: { enabled: false, label: '—', seen: false },
      },
    };
    applyMeta();
  }

  // The portrait is a slow biological display. Ten frames a second keeps the
  // expression pose readable while leaving CPU for the camera self-view on
  // two-core machines; the studio broadcasts derived state at 10 fps.
  if (now - lastPaintAt >= 100) {
    portrait.render(latest.render || idleState);
    lastPaintAt = now;
  }
  requestAnimationFrame(loop);
}

applyMeta();
announce();
setTimeout(announce, 450);
setTimeout(announce, 1200);
requestAnimationFrame(loop);
