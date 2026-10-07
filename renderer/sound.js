// Synthesised countdown beep and shutter sound.

let ctx;
const ac = () => (ctx ??= new AudioContext());

export function beep() {
  const c = ac();
  const t = c.currentTime;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(1175, t);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.22, t + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
  osc.connect(gain).connect(c.destination);
  osc.start(t);
  osc.stop(t + 0.15);
}

let noiseBuffer;
function noise(c) {
  if (noiseBuffer) return noiseBuffer;
  noiseBuffer = c.createBuffer(1, c.sampleRate * 0.3, c.sampleRate);
  const d = noiseBuffer.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return noiseBuffer;
}

function click(c, t, freq, level, decay) {
  const src = c.createBufferSource();
  src.buffer = noise(c);
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = freq;
  bp.Q.value = 0.9;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(level, t + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  src.connect(bp).connect(g).connect(c.destination);
  src.start(t);
  src.stop(t + decay + 0.02);

  const thump = c.createOscillator();
  const tg = c.createGain();
  thump.frequency.setValueAtTime(180, t);
  thump.frequency.exponentialRampToValueAtTime(60, t + 0.05);
  tg.gain.setValueAtTime(level * 0.6, t);
  tg.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
  thump.connect(tg).connect(c.destination);
  thump.start(t);
  thump.stop(t + 0.07);
}

export function shutter() {
  const c = ac();
  const t = c.currentTime + 0.005;
  click(c, t, 3200, 0.7, 0.05);
  click(c, t + 0.085, 2400, 0.5, 0.07);
}
