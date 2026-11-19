// Turns decoded SmartSpectra windows into animation targets.
//
// SmartSpectra emits windowed metrics slices, not a continuous frame stream.
// The arterial-pressure trace and the chest-movement trace are real measured
// waveforms, so the portrait follows those. The rate numbers are displayed
// only when the SDK provides them; the portrait never invents a beat or a
// breath to fill a silent stretch.

const PULSE_WINDOW_MS = 4200;
const BREATH_WINDOW_MS = 12000;
const PULSE_LIVE_MS = 2600;
const BREATH_LIVE_MS = 3800;
const BLINK_MS = 230;

const NEUTRAL = Object.freeze({
  browRaise: 0,
  browAngle: 0,
  eyeOpen: 1,
  smile: 0,
  mouthOpen: 0,
  blush: 0.12,
});

// The SDK's ExpressionType values. These labels describe visible facial shapes,
// not inner feelings, and the UI copy says so. Keep them shape-based: the app
// makes no emotion claim even though the SDK's enum uses emotion names.
export const EXPRESSION_LABELS = Object.freeze({
  0: 'Neutral',
  1: 'Brow knit',
  2: 'Lip pull',
  3: 'Nose wrinkle',
  4: 'Eyes wide',
  5: 'Mouth curve',
  6: 'Neutral',
  7: 'Eyes down',
  8: 'Brows up',
});

const EXPRESSION_TARGETS = Object.freeze({
  0: NEUTRAL,
  1: { browRaise: -0.65, browAngle: 0.85, eyeOpen: 0.82, smile: -0.32, mouthOpen: 0.04, blush: 0.28 },
  2: { browRaise: 0.15, browAngle: 0.35, eyeOpen: 0.9, smile: 0.35, mouthOpen: 0, blush: 0.12 },
  3: { browRaise: -0.45, browAngle: 0.5, eyeOpen: 0.7, smile: -0.45, mouthOpen: 0.08, blush: 0.18 },
  4: { browRaise: 0.85, browAngle: -0.35, eyeOpen: 1.25, smile: -0.35, mouthOpen: 0.32, blush: 0.08 },
  5: { browRaise: 0.18, browAngle: -0.08, eyeOpen: 0.82, smile: 0.95, mouthOpen: 0.12, blush: 0.55 },
  6: NEUTRAL,
  7: { browRaise: 0.35, browAngle: -0.75, eyeOpen: 0.72, smile: -0.75, mouthOpen: 0.03, blush: 0.12 },
  8: { browRaise: 1, browAngle: -0.2, eyeOpen: 1.28, smile: 0.05, mouthOpen: 0.55, blush: 0.15 },
});

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function latest(array) {
  return Array.isArray(array) && array.length ? array[array.length - 1] : null;
}

function copyTarget(target) {
  return {
    browRaise: target.browRaise,
    browAngle: target.browAngle,
    eyeOpen: target.eyeOpen,
    smile: target.smile,
    mouthOpen: target.mouthOpen,
    blush: target.blush,
  };
}

export class SignalEngine {
  constructor() {
    this.entitlements = { pulse: true, breath: true, face: false };
    this.status = 'idle';
    this.presence = 0.32;
    this.lastMetricsAt = 0;
    this.lastHistoryAt = 0;
    this.reset();
  }

  setStatus(status) {
    this.status = status;
  }

  setEntitlements(entitlements) {
    this.entitlements = { ...this.entitlements, ...entitlements };
    if (!this.entitlements.pulse) {
      this.pulseRate = null;
      this.pulseSeen = false;
      this.pulseTraceLive = false;
      this.pulsePaced = false;
      this.pulseEnvelope = 0;
    }
    if (!this.entitlements.breath) {
      this.breathRate = null;
      this.breathSeen = false;
      this.breathTraceLive = false;
      this.breathPhase = 0;
    }
    if (!this.entitlements.face) {
      this.faceSeen = false;
      this.faceAwake = 0;
      this.expressionType = 6;
      this.expressionConfidence = 0;
      this.faceTarget = copyTarget(NEUTRAL);
      this.expressionScores = [];
    }
  }

  resetSignals() {
    this.pulseRate = null;
    this.pulseConfidence = 0;
    this.pulseStable = false;
    this.pulseRateAt = 0;
    this.pulseSeen = false;
    this.pulseBuf = [];
    this.pulseNorm = 0.5;
    this.prevPulseNorm = 0.5;
    this.pulseEnvelope = 0;
    this.lastBeatAt = 0;
    this.beatCount = 0;
    this.pulseTraceAt = 0;
    this.pulseTraceLive = false;
    this.pulsePaced = false;

    this.breathRate = null;
    this.breathConfidence = 0;
    this.breathStable = false;
    this.breathRateAt = 0;
    this.breathSeen = false;
    this.breathBuf = [];
    this.breathPhase = 0;
    this.breathTraceAt = 0;
    this.breathTraceLive = false;

    this.faceSeen = false;
    this.faceSeenAt = 0;
    this.faceAwake = 0;
    this.expressionType = 6;
    this.expressionConfidence = 0;
    this.expressionStable = false;
    this.talking = false;
    this.talkingAt = 0;
    this.talkOpen = 0;
    this.lastBlinkDetected = false;
    this.blinkAt = -10000;
    this.blinkFactor = 0;
    this.faceParams = copyTarget(NEUTRAL);
    this.faceTarget = copyTarget(NEUTRAL);
    this.expressionScores = [];

    this.pulseHistory = [];
    this.breathHistory = [];
    this.lastHistoryAt = 0;
  }

  reset() {
    this.resetSignals();
    this.presence = 0.32;
  }

  ingest(metrics, now = performance.now()) {
    if (!metrics) return;
    this.lastMetricsAt = now;

    if (this.entitlements.pulse) this.ingestCardio(metrics.cardio, now);
    if (this.entitlements.breath) this.ingestBreathing(metrics.breathing, now);
    if (this.entitlements.face) this.ingestFace(metrics.face, now);
  }

  ingestCardio(cardio, now) {
    if (!cardio) return;
    const rate = latest(cardio.pulseRate);
    if (rate && Number.isFinite(rate.value) && rate.value > 0) {
      this.pulseRate = rate.value;
      this.pulseConfidence = clamp(finite(rate.confidence), 0, 100);
      this.pulseStable = Boolean(rate.stable);
      this.pulseRateAt = now;
      this.pulseSeen = true;
    }

    const trace = cardio.arterialPressureTrace;
    if (!Array.isArray(trace) || trace.length === 0) return;
    const n = trace.length;
    for (let i = 0; i < n; i += 1) {
      const value = trace[i] && trace[i].value;
      if (Number.isFinite(value)) {
        // Spread the slice backwards so a burst of samples does not look like
        // one instant. The exact sample rate does not matter for the glow.
        this.pulseBuf.push({ t: now - (n - 1 - i) * 33, v: value });
      }
    }
    this.pulseTraceAt = now;
    this.pulseSeen = true;

    const cutoff = now - PULSE_WINDOW_MS;
    while (this.pulseBuf.length && this.pulseBuf[0].t < cutoff) this.pulseBuf.shift();
    this.updatePulseNorm(now);
  }

  updatePulseNorm(now) {
    if (this.pulseBuf.length < 8) return;
    let min = Infinity;
    let max = -Infinity;
    for (const sample of this.pulseBuf) {
      if (sample.v < min) min = sample.v;
      if (sample.v > max) max = sample.v;
    }
    const range = max - min;
    if (!Number.isFinite(range) || range < 1e-7) return;

    const value = this.pulseBuf[this.pulseBuf.length - 1].v;
    const raw = clamp((value - min) / range, 0, 1);
    const prev = this.pulseNorm;
    this.pulseNorm = prev + (raw - prev) * 0.55;

    // One peak per cardiac cycle. The refractory window stops the smoothed
    // waveform from double-triggering on a noisy upstroke.
    if (this.pulseNorm > 0.67 && prev <= 0.67 && now - this.lastBeatAt > 280) {
      this.lastBeatAt = now;
      this.pulseEnvelope = 1;
      this.beatCount += 1;
    }
    this.prevPulseNorm = prev;
  }

  ingestBreathing(breathing, now) {
    if (!breathing) return;
    const rate = latest(breathing.rate);
    if (rate && Number.isFinite(rate.value) && rate.value > 0) {
      this.breathRate = rate.value;
      this.breathConfidence = clamp(finite(rate.confidence), 0, 100);
      this.breathStable = Boolean(rate.stable);
      this.breathRateAt = now;
      this.breathSeen = true;
    }

    // Prefer the chest trace; fall back to the abdomen if only that is present.
    let trace = breathing.upperTrace;
    if (!Array.isArray(trace) || trace.length === 0) trace = breathing.lowerTrace;
    if (!Array.isArray(trace) || trace.length === 0) return;

    const n = trace.length;
    for (let i = 0; i < n; i += 1) {
      const value = trace[i] && trace[i].value;
      if (Number.isFinite(value)) {
        this.breathBuf.push({ t: now - (n - 1 - i) * 33, v: value });
      }
    }
    this.breathTraceAt = now;
    this.breathSeen = true;

    const cutoff = now - BREATH_WINDOW_MS;
    while (this.breathBuf.length && this.breathBuf[0].t < cutoff) this.breathBuf.shift();
    this.updateBreathNorm();
  }

  updateBreathNorm() {
    if (this.breathBuf.length < 20) return;
    let sum = 0;
    for (const sample of this.breathBuf) sum += sample.v;
    const mean = sum / this.breathBuf.length;

    let maxAbs = 0;
    for (const sample of this.breathBuf) {
      const deviation = Math.abs(sample.v - mean);
      if (deviation > maxAbs) maxAbs = deviation;
    }
    if (maxAbs < 1e-7) return;

    const value = this.breathBuf[this.breathBuf.length - 1].v;
    const raw = clamp((value - mean) / maxAbs, -1, 1);
    this.breathPhase += (raw - this.breathPhase) * 0.18;
  }

  ingestFace(face, now) {
    if (!face) return;
    const expression = latest(face.expression);
    if (expression) {
      this.faceSeen = true;
      this.faceSeenAt = now;
      let best = null;
      if (Array.isArray(expression.scores)) {
        this.expressionScores = expression.scores.map((score) => ({
          type: finite(score.type, 0),
          confidence: clamp(finite(score.confidence), 0, 100),
        }));
        for (const score of expression.scores) {
          if (!best || finite(score.confidence) > finite(best.confidence)) best = score;
        }
      }
      if (best && Number.isFinite(best.type)) {
        const confidence = clamp(finite(best.confidence), 0, 100);
        this.expressionType = best.type;
        this.expressionConfidence = confidence;
        this.expressionStable = Boolean(expression.stable);
        const target = confidence >= 18 ? EXPRESSION_TARGETS[best.type] : NEUTRAL;
        this.faceTarget = copyTarget(target || NEUTRAL);
      }
    }

    const blink = latest(face.blinking);
    if (blink) {
      this.faceSeen = true;
      this.faceSeenAt = now;
      const detected = Boolean(blink.detected);
      if (detected && !this.lastBlinkDetected) this.blinkAt = now;
      this.lastBlinkDetected = detected;
    }

    const talking = latest(face.talking);
    if (talking) {
      this.faceSeen = true;
      this.faceSeenAt = now;
      this.talking = Boolean(talking.detected);
      this.talkingAt = now;
    }
  }

  tick(dt, now = performance.now()) {
    const step = Math.min(0.06, Math.max(0.001, dt));

    this.pulseTraceLive = this.entitlements.pulse && now - this.pulseTraceAt < PULSE_LIVE_MS;
    this.breathTraceLive = this.entitlements.breath && now - this.breathTraceAt < BREATH_LIVE_MS;

    // Pulse-rate-only mode: the SDK can provide a live rate without the
    // arterial-pressure trace (which needs an extra network model). Pace the
    // portrait's glow from that measured rate; the number remains the real
    // Presage value, and no waveform or confidence is invented.
    const pulseRateFresh = Boolean(this.pulseRate && now - this.pulseRateAt < 6500);
    this.pulsePaced = this.entitlements.pulse
      && !this.pulseTraceLive
      && pulseRateFresh
      && this.status === 'listening';

    if (this.pulsePaced) {
      const period = 60000 / clamp(this.pulseRate, 35, 200);
      if (now - this.lastBeatAt > period * 0.85) {
        this.lastBeatAt = now;
        this.pulseEnvelope = 1;
        this.beatCount += 1;
      }
      this.pulseEnvelope *= Math.exp(-step / 0.32);
    } else if (this.pulseTraceLive) {
      this.pulseEnvelope *= Math.exp(-step / 0.32);
    } else {
      this.pulseEnvelope *= Math.exp(-step / 0.16);
      if (!this.entitlements.pulse) this.pulseEnvelope = 0;
    }

    if (this.entitlements.breath) {
      if (!this.breathTraceLive) {
        this.breathPhase += (0 - this.breathPhase) * (1 - Math.exp(-step / 1.15));
      }
    } else {
      this.breathPhase = 0;
    }

    const faceTargetAwake = this.entitlements.face && this.faceSeen ? 1 : 0;
    this.faceAwake += (faceTargetAwake - this.faceAwake) * (1 - Math.exp(-step / 0.55));

    // Expression windows arrive much less often than video frames. A slow
    // 0.28s ease made a deliberate expression look like it landed a beat late;
    // 0.15s still hides classifier jitter but follows the face much closer.
    const faceK = 1 - Math.exp(-step / 0.15);
    for (const key of Object.keys(this.faceParams)) {
      this.faceParams[key] += (this.faceTarget[key] - this.faceParams[key]) * faceK;
    }

    const blinkElapsed = now - this.blinkAt;
    this.blinkFactor = blinkElapsed >= 0 && blinkElapsed < BLINK_MS
      ? Math.sin(Math.PI * (blinkElapsed / BLINK_MS))
      : 0;

    const talkingNow = this.talking && now - this.talkingAt < 650;
    const talkTarget = talkingNow ? 0.24 : 0;
    this.talkOpen += (talkTarget - this.talkOpen) * (1 - Math.exp(-step / 0.12));

    const presenceTarget = {
      listening: 1,
      waking: 0.62,
      paused: 0.44,
      error: 0.34,
      idle: 0.32,
    }[this.status] ?? 0.32;
    this.presence += (presenceTarget - this.presence) * (1 - Math.exp(-step / 0.6));

    if (now - this.lastHistoryAt > 120) {
      this.lastHistoryAt = now;
      this.pulseHistory.push(this.pulseTraceLive ? this.pulseNorm : null);
      this.breathHistory.push(this.breathTraceLive ? (this.breathPhase + 1) / 2 : null);
      if (this.pulseHistory.length > 150) this.pulseHistory.shift();
      if (this.breathHistory.length > 150) this.breathHistory.shift();
    }
  }

  get expressionLabel() {
    if (!this.entitlements.face) return 'Off';
    if (!this.faceSeen) return 'Watching';
    if (this.expressionConfidence < 18) return 'Neutral';
    return EXPRESSION_LABELS[this.expressionType] || 'Neutral';
  }

  getRenderState() {
    const eyeOpen = this.entitlements.face
      ? this.faceParams.eyeOpen * (1 - 0.96 * this.blinkFactor)
      : 1;

    return {
      presence: this.presence,
      status: this.status,
      pulse: {
        active: this.entitlements.pulse && (this.pulseTraceLive || this.pulsePaced),
        envelope: this.pulseEnvelope,
        bpm: this.pulseRate,
        confidence: this.pulseConfidence,
        stable: this.pulseStable,
        seen: this.pulseSeen,
        live: this.pulseTraceLive,
      },
      breath: {
        active: this.entitlements.breath && this.breathTraceLive,
        phase: this.breathPhase,
        rate: this.breathRate,
        confidence: this.breathConfidence,
        stable: this.breathStable,
        seen: this.breathSeen,
        live: this.breathTraceLive,
      },
      face: {
        active: this.entitlements.face,
        awake: this.faceAwake,
        eyeOpen,
        browRaise: this.faceParams.browRaise,
        browAngle: this.faceParams.browAngle,
        smile: this.faceParams.smile,
        mouthOpen: clamp(Math.max(this.faceParams.mouthOpen, this.talkOpen), 0, 1.2),
        blush: this.faceParams.blush,
      },
    };
  }

  getUiState() {
    return {
      pulse: {
        enabled: this.entitlements.pulse,
        seen: this.pulseSeen,
        live: this.pulseTraceLive || this.pulsePaced,
        rate: this.pulseRate,
        confidence: this.pulseConfidence,
        stable: this.pulseStable,
        rateAt: this.pulseRateAt,
      },
      breath: {
        enabled: this.entitlements.breath,
        seen: this.breathSeen,
        live: this.breathTraceLive,
        rate: this.breathRate,
        confidence: this.breathConfidence,
        stable: this.breathStable,
        rateAt: this.breathRateAt,
      },
      face: {
        enabled: this.entitlements.face,
        seen: this.faceSeen,
        label: this.expressionLabel,
        type: this.expressionType,
        confidence: this.expressionConfidence,
        stable: this.expressionStable,
        scores: this.expressionScores,
      },
      pulseHistory: this.pulseHistory,
      breathHistory: this.breathHistory,
    };
  }
}
