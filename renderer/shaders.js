// GLSL for every effect. Coordinates: P is the display UV (0..1, y up, already
// mirrored like the preview). toA() maps to aspect-correct space centred on 0.

export const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
uniform float uFlipY;
void main() {
  vUv = aPos * 0.5 + 0.5;
  vec2 p = aPos;
  if (uFlipY > 0.5) p.y = -p.y;
  gl_Position = vec4(p, 0.0, 1.0);
}`;

// Edge refinement for the person mask: a joint bilateral upsample guided by
// the camera image, so the cut-out follows real colour edges (hair vs wall)
// instead of the segmentation model's coarse blocks. Output is in camera
// texture space (y up).
export const REFINE_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uCam;
uniform sampler2D uLow;
uniform vec2 uLowTexel;
uniform float uSpread;
uniform float uColorK;

float low(vec2 uv) { return texture(uLow, vec2(uv.x, 1.0 - uv.y)).r; }

void main() {
  vec3 c0 = texture(uCam, vUv).rgb;
  float sum = 0.0, wsum = 0.0;
  for (int j = -4; j <= 4; j++) {
    for (int i = -4; i <= 4; i++) {
      vec2 o = vec2(float(i), float(j));
      vec2 uv = vUv + o * uLowTexel * uSpread;
      vec3 d = texture(uCam, uv).rgb - c0;
      float w = exp(-dot(o, o) / 18.0) * exp(-dot(d, d) * uColorK);
      sum += low(uv) * w;
      wsum += w;
    }
  }
  float m = sum / max(wsum, 1e-5);
  fragColor = vec4(m, m, m, 1.0);
}`;

const HEADER = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uCam;
uniform sampler2D uMask;
uniform sampler2D uBg;
uniform vec2 uRes;
uniform float uTime;
uniform float uMirror;
uniform float uHasMask;
uniform float uHasBg;
uniform float uBgAspect;
uniform float uHasFace;
uniform vec2 uEyeL, uEyeR, uNose, uMouth, uCheekL, uCheekR, uFaceC, uHeadTop;
uniform float uFaceW;

const float PI = 3.14159265;

vec2 texUv(vec2 P) { return vec2(uMirror > 0.5 ? 1.0 - P.x : P.x, P.y); }
vec3 cam(vec2 P) { return texture(uCam, clamp(texUv(P), vec2(0.0005), vec2(0.9995))).rgb; }
float maskAt(vec2 P) { return texture(uMask, texUv(P)).r; }
float aspect() { return uRes.x / uRes.y; }
vec2 toA(vec2 P) { return vec2((P.x - 0.5) * aspect(), P.y - 0.5); }
vec2 fromA(vec2 q) { return vec2(q.x / aspect() + 0.5, q.y + 0.5); }
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
float dot2(vec2 v) { return dot(v, v); }

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + vec2(17.1, 9.2); a *= 0.5; }
  return v;
}

// Radial magnify (e > 1) or pinch (e < 1) inside radius R around C.
vec2 bulge(vec2 P, vec2 C, float R, float e) {
  vec2 c = toA(C);
  vec2 q = toA(P) - c;
  float r = length(q);
  if (r < R && r > 1e-5) {
    float t = r / R;
    q = q / r * R * pow(t, mix(e, 1.0, smoothstep(0.55, 1.0, t)));
  }
  return fromA(c + q);
}

vec2 twirl(vec2 P, vec2 C, float R, float ang) {
  vec2 c = toA(C);
  vec2 q = toA(P) - c;
  float r = length(q);
  if (r < R) {
    float t = 1.0 - r / R;
    float a = ang * t * t;
    float s = sin(a), co = cos(a);
    q = vec2(co * q.x - s * q.y, s * q.x + co * q.y);
  }
  return fromA(c + q);
}

// Anisotropic scale inside an ellipse; k < 1 magnifies along that axis.
vec2 scaleRegion(vec2 P, vec2 C, vec2 radii, vec2 k) {
  vec2 c = toA(C);
  vec2 q = toA(P) - c;
  float t = length(q / radii);
  if (t < 1.0) {
    float w = 1.0 - t * t;
    q *= mix(vec2(1.0), k, w * w);
  }
  return fromA(c + q);
}

vec3 blur5(vec2 P, float s) {
  vec2 px = s / uRes;
  return (cam(P) * 4.0 + cam(P + vec2(px.x, 0.0)) + cam(P - vec2(px.x, 0.0))
        + cam(P + vec2(0.0, px.y)) + cam(P - vec2(0.0, px.y))) / 8.0;
}

float edgeAt(vec2 P, float s) {
  vec2 px = s / uRes;
  float tl = luma(cam(P + px * vec2(-1, 1))), t = luma(cam(P + px * vec2(0, 1))), tr = luma(cam(P + px * vec2(1, 1)));
  float l = luma(cam(P + px * vec2(-1, 0))), r = luma(cam(P + px * vec2(1, 0)));
  float bl = luma(cam(P + px * vec2(-1, -1))), b = luma(cam(P + px * vec2(0, -1))), br = luma(cam(P + px * vec2(1, -1)));
  float gx = (tr + 2.0 * r + br) - (tl + 2.0 * l + bl);
  float gy = (tl + 2.0 * t + tr) - (bl + 2.0 * b + br);
  return length(vec2(gx, gy));
}

float stars(vec2 P) {
  vec2 g = vec2(P.x * aspect(), P.y) * 140.0;
  vec2 id = floor(g);
  float h = hash(id);
  if (h < 0.985) return 0.0;
  vec2 f = fract(g) - 0.5 - (vec2(hash(id + 3.1), hash(id + 5.7)) - 0.5) * 0.6;
  float tw = 0.6 + 0.4 * sin(uTime * 2.0 + h * 50.0);
  return smoothstep(0.14, 0.0, length(f)) * tw;
}

vec3 composite(vec3 bg, vec2 P) {
  if (uHasMask < 0.5) return cam(P);
  // Pull the edge in slightly so the old background's rim is cut away.
  float m = smoothstep(0.45, 0.8, maskAt(P));
  if (m <= 0.0) return bg;
  vec3 fg = cam(P);
  if (m < 1.0) {
    // Edge pixels are a blend of person and old wall; take their colour from
    // just inside the outline instead (towards higher mask values).
    vec2 px = 1.0 / uRes;
    vec2 g = vec2(maskAt(P + vec2(px.x * 2.0, 0.0)) - maskAt(P - vec2(px.x * 2.0, 0.0)),
                  maskAt(P + vec2(0.0, px.y * 2.0)) - maskAt(P - vec2(0.0, px.y * 2.0)));
    if (dot(g, g) > 1e-6) fg = mix(cam(P + normalize(g) * px * 2.5), fg, m);
  }
  return mix(bg, fg, m);
}
`;

const DEFS = {
  thermal: `
vec3 thermalPal(float t) {
  vec3 c0 = vec3(0.02, 0.0, 0.25), c1 = vec3(0.35, 0.0, 0.65), c2 = vec3(0.85, 0.05, 0.35);
  vec3 c3 = vec3(1.0, 0.45, 0.0), c4 = vec3(1.0, 0.9, 0.1), c5 = vec3(1.0, 1.0, 0.9);
  t *= 5.0;
  if (t < 1.0) return mix(c0, c1, t);
  if (t < 2.0) return mix(c1, c2, t - 1.0);
  if (t < 3.0) return mix(c2, c3, t - 2.0);
  if (t < 4.0) return mix(c3, c4, t - 3.0);
  return mix(c4, c5, t - 4.0);
}`,
  heart: `
float sdHeart(vec2 p) {
  p.x = abs(p.x);
  if (p.y + p.x > 1.0) return sqrt(dot2(p - vec2(0.25, 0.75))) - sqrt(2.0) / 4.0;
  return sqrt(min(dot2(p - vec2(0.0, 1.0)), dot2(p - 0.5 * max(p.x + p.y, 0.0)))) * sign(p.x - p.y);
}`,
  star: `
float sdStar5(vec2 p, float r, float rf) {
  const vec2 k1 = vec2(0.809016994375, -0.587785252292);
  const vec2 k2 = vec2(-k1.x, k1.y);
  p.x = abs(p.x);
  p -= 2.0 * max(dot(k1, p), 0.0) * k1;
  p -= 2.0 * max(dot(k2, p), 0.0) * k2;
  p.x = abs(p.x);
  p.y -= r;
  vec2 ba = rf * vec2(-k1.y, k1.x) - vec2(0, 1);
  float h = clamp(dot(p, ba) / dot(ba, ba), 0.0, r);
  return length(p - ba * h) * sign(p.y * ba.x - p.x * ba.y);
}`,
  earth: `
// Returns lit Earth colour for a point q in unit-sphere space (|q| < 1).
vec3 earthSurface(vec2 q, float spin) {
  float z = sqrt(max(0.0, 1.0 - dot(q, q)));
  float lon = atan(q.x, z) + spin;
  float lat = asin(clamp(q.y, -1.0, 1.0));
  vec2 uv = vec2(lon * 1.6, lat * 2.2);
  float land = smoothstep(0.5, 0.54, fbm(uv * 1.4 + 3.0));
  vec3 ocean = mix(vec3(0.02, 0.12, 0.38), vec3(0.05, 0.25, 0.55), fbm(uv * 3.0));
  vec3 ground = mix(vec3(0.16, 0.38, 0.12), vec3(0.55, 0.45, 0.28), fbm(uv * 4.0 + 9.0));
  ground = mix(ground, vec3(0.95), smoothstep(1.15, 1.35, abs(lat)));
  float clouds = smoothstep(0.52, 0.75, fbm(vec2(lon * 2.5 + spin * 0.5, lat * 4.0) + 20.0));
  vec3 surf = mix(mix(ocean, ground, land), vec3(1.0), clouds * 0.85);
  float light = clamp(dot(normalize(vec3(q, z)), normalize(vec3(-0.6, 0.5, 0.65))), 0.0, 1.0);
  return surf * (0.06 + 0.95 * light);
}`,
};

const BG = {
  clouds: `
  vec2 a = toA(P);
  vec3 sky = mix(vec3(0.58, 0.78, 0.98), vec3(0.16, 0.42, 0.88), P.y);
  float n = fbm(vec2(a.x * 2.2 + uTime * 0.03, a.y * 3.2));
  float n2 = fbm(vec2(a.x * 5.0 + uTime * 0.05, a.y * 6.0) + 4.0);
  float cl = smoothstep(0.42, 0.78, n * 0.8 + n2 * 0.25);
  vec3 cloud = mix(vec3(0.8, 0.84, 0.9), vec3(1.0), smoothstep(0.45, 0.85, n2));
  return mix(sky, cloud, cl);`,

  dots: `
  vec2 a = toA(P) * 6.5;
  a.y += uTime * 0.12;
  vec2 id = floor(a);
  vec2 f = fract(a) - 0.5;
  float h = hash(id);
  vec3 col = 0.55 + 0.45 * cos(6.2831 * (h + vec3(0.0, 0.33, 0.67)));
  float r = 0.26 + 0.14 * hash(id + 7.0);
  float px = 6.5 / uRes.y;
  float m = 1.0 - smoothstep(r - px, r + px, length(f));
  return mix(vec3(0.98, 0.97, 0.95), col, m);`,

  sunset: `
  vec2 a = toA(P);
  float hz = 0.36;
  vec3 sky = mix(vec3(1.0, 0.56, 0.24), vec3(0.32, 0.16, 0.48), smoothstep(hz, 1.0, P.y));
  sky = mix(sky, vec3(1.0, 0.78, 0.45), exp(-(P.y - hz) * 14.0) * 0.6);
  vec2 sun = vec2(0.0, hz - 0.5 + 0.1);
  float sd = length(a - sun);
  sky += vec3(1.0, 0.65, 0.3) * exp(-sd * 5.0) * 0.55;
  sky = mix(sky, vec3(1.0, 0.93, 0.65), smoothstep(0.125, 0.115, sd));
  if (P.y < hz) {
    vec3 sea = mix(vec3(0.12, 0.08, 0.25), vec3(0.6, 0.32, 0.32), pow(P.y / hz, 2.0));
    float w = noise(vec2(a.x * 45.0, (hz - P.y) * 110.0 + uTime * 1.5));
    float refl = exp(-abs(a.x) * 7.0) * smoothstep(0.45, 0.8, w) * (0.3 + 0.7 * P.y / hz);
    return sea + vec3(1.0, 0.72, 0.38) * refl;
  }
  return sky;`,

  earth: `
  vec2 a = toA(P);
  vec3 col = vec3(0.0, 0.0, 0.03) + stars(P);
  vec2 c = vec2(aspect() * 0.12, -0.72);
  float R = 0.62;
  vec2 q = (a - c) / R;
  float r = length(q);
  if (r < 1.0) col = earthSurface(q, uTime * 0.02);
  col += vec3(0.3, 0.55, 1.0) * exp(-abs(r - 1.0) * 28.0) * 0.75;
  return col;`,

  moon: `
  vec2 a = toA(P);
  vec3 col = vec3(0.0, 0.0, 0.02) + stars(P);
  vec2 ec = vec2(aspect() * 0.3, 0.26);
  vec2 eq = (a - ec) / 0.1;
  float er = length(eq);
  if (er < 1.0) col = earthSurface(eq, uTime * 0.05);
  col += vec3(0.3, 0.55, 1.0) * exp(-abs(er - 1.0) * 12.0) * 0.4;
  float horizon = -0.12 + 0.05 * fbm(vec2(a.x * 1.5, 2.0)) - 0.03 * a.x;
  if (a.y < horizon) {
    float n = fbm(a * vec2(5.0, 12.0));
    vec3 g = vec3(0.42 + 0.3 * n);
    for (int s = 0; s < 2; s++) {
      vec2 gp = a * (s == 0 ? vec2(3.0, 9.0) : vec2(7.0, 20.0));
      vec2 id = floor(gp);
      vec2 f = fract(gp) - 0.5;
      float rr = 0.15 + 0.25 * hash(id + float(s));
      float d = length(f);
      if (hash(id + 11.0) > 0.45) {
        g *= mix(0.72, 1.0, smoothstep(rr * 0.6, rr, d));
        g *= 1.0 + 0.25 * smoothstep(rr * 0.7, rr, d) * smoothstep(rr * 1.25, rr, d);
      }
    }
    float depth = clamp((horizon - a.y) * 2.5, 0.0, 1.0);
    return g * mix(0.7, 1.05, depth);
  }
  return col;`,

  aquarium: `
  vec2 a = toA(P);
  vec3 col = mix(vec3(0.0, 0.12, 0.32), vec3(0.08, 0.52, 0.72), P.y);
  float ray = pow(max(0.0, sin(a.x * 9.0 + a.y * 2.5 + uTime * 0.25) * 0.5 + 0.5), 8.0);
  col += vec3(0.4, 0.7, 0.8) * ray * P.y * 0.25;
  float cst = pow(1.0 - abs(noise(a * 7.0 + vec2(uTime * 0.25, uTime * 0.1)) * 2.0 - 1.0), 14.0);
  col += vec3(0.6, 0.85, 0.95) * cst * 0.22 * smoothstep(0.1, 1.0, P.y);
  float sand = 0.12 + 0.02 * sin(a.x * 7.0) + 0.015 * noise(vec2(a.x * 20.0, 0.0));
  if (P.y < sand) col = mix(vec3(0.62, 0.55, 0.38), vec3(0.85, 0.77, 0.55), noise(a * 60.0) * 0.6 + P.y * 3.0);
  float span = aspect() + 0.6;
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    float dir = mod(fi, 2.0) < 1.0 ? 1.0 : -1.0;
    float speed = 0.05 + 0.04 * hash(vec2(fi, 1.0));
    float x = mod(uTime * speed + fi * 0.71, span) - span * 0.5;
    x *= dir;
    float y = -0.3 + 0.13 * fi + 0.025 * sin(uTime * 1.3 + fi * 2.0);
    float size = 0.05 + 0.03 * hash(vec2(fi, 4.0));
    vec2 p = (a - vec2(x, y)) / size;
    p.x *= dir;
    float body = length(p * vec2(1.0, 1.8)) - 0.55;
    float tailIn = (p.x < -0.4 && p.x > -0.9 && abs(p.y) < (-0.35 - p.x) * 0.9) ? 1.0 : 0.0;
    vec3 fc = 0.5 + 0.5 * cos(6.2831 * (hash(vec2(fi, 9.0)) * 0.4 + vec3(0.0, 0.15, 0.3)));
    fc = mix(fc, vec3(1.0, 0.5, 0.1), 0.4);
    if (body < 0.0 || tailIn > 0.5) {
      col = fc * (0.75 + 0.35 * smoothstep(-0.3, 0.3, p.y));
      if (body < 0.0 && abs(p.x - 0.1) < 0.04) col *= 0.75;
      if (length(p - vec2(0.3, 0.08)) < 0.08) col = vec3(0.02);
    }
  }
  vec2 g = vec2(a.x * 9.0, a.y * 9.0 - uTime * 1.1);
  vec2 bid = floor(g);
  if (hash(bid) > 0.88) {
    vec2 f = fract(g) - 0.5 - vec2(0.15 * sin(uTime * 2.0 + bid.y), 0.0);
    float br = 0.12 + 0.12 * hash(bid + 2.0);
    float ring = smoothstep(0.03, 0.0, abs(length(f) - br));
    col = mix(col, vec3(0.85, 0.95, 1.0), ring * 0.7);
  }
  return col;`,

  aurora: `
  vec2 a = toA(P);
  vec3 col = mix(vec3(0.0, 0.02, 0.07), vec3(0.03, 0.1, 0.2), 1.0 - P.y) + stars(P) * 0.8;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float y0 = 0.5 + 0.09 * fi + 0.06 * sin(a.x * 2.3 + uTime * 0.25 + fi * 2.0)
             + 0.04 * noise(vec2(a.x * 3.0 + uTime * 0.15, fi * 7.0));
    float d = P.y - y0;
    float curtain = exp(-max(d, 0.0) * 5.0) * smoothstep(-0.03, 0.0, d);
    float streak = 0.45 + 0.55 * noise(vec2(a.x * 35.0 + fi * 13.0, uTime * 0.4));
    vec3 c = mix(vec3(0.1, 1.0, 0.55), vec3(0.65, 0.25, 0.95), fi / 2.0 + 0.3 * smoothstep(0.0, 0.3, d));
    col += c * curtain * streak * 0.55;
  }
  float m = 0.2 + 0.1 * fbm(vec2(a.x * 1.8, 1.0)) + 0.04 * noise(vec2(a.x * 9.0, 3.0));
  if (P.y < m) col = mix(vec3(0.0, 0.01, 0.03), vec3(0.02, 0.04, 0.07), P.y / m);
  return col;`,

  rainbow: `
  vec2 a = toA(P);
  vec3 col = mix(vec3(0.78, 0.9, 1.0), vec3(0.42, 0.68, 0.98), P.y);
  float cl = smoothstep(0.55, 0.8, fbm(vec2(a.x * 2.0 + uTime * 0.02, a.y * 3.0) + 5.0));
  col = mix(col, vec3(1.0), cl * 0.8);
  float r = length(a - vec2(0.0, -0.62));
  float band = (r - 0.62) / 0.24;
  if (band > 0.0 && band < 1.0) {
    float h = band * 0.8;
    vec3 rb = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
    col = mix(col, rb, 0.7 * smoothstep(0.0, 0.08, band) * smoothstep(1.0, 0.92, band));
  }
  float hill = 0.16 + 0.04 * sin(a.x * 3.0 + 1.0) + 0.02 * sin(a.x * 9.0);
  if (P.y < hill) col = mix(vec3(0.18, 0.5, 0.15), vec3(0.4, 0.75, 0.25), P.y / hill + 0.15 * noise(a * 40.0));
  return col;`,
};

const FACE_PRE = `
  if (uHasFace < 0.5) return cam(P);
  float d = distance(toA(uEyeL), toA(uEyeR));`;

const BODIES = {
  normal: `return cam(P);`,

  sepia: `
  vec3 c = cam(P);
  return vec3(dot(c, vec3(0.393, 0.769, 0.189)), dot(c, vec3(0.349, 0.686, 0.168)), dot(c, vec3(0.272, 0.534, 0.131)));`,

  bw: `
  float l = luma(cam(P));
  return vec3(clamp((l - 0.5) * 1.15 + 0.5, 0.0, 1.0));`,

  glow: `
  vec3 c = cam(P);
  vec3 b = vec3(0.0);
  float tw = 0.0;
  for (int i = -3; i <= 3; i++) for (int j = -3; j <= 3; j++) {
    vec2 o = vec2(float(i), float(j));
    float w = exp(-dot(o, o) / 6.0);
    b += cam(P + o * vec2(0.007 / aspect(), 0.007)) * w;
    tw += w;
  }
  b /= tw;
  vec3 o = 1.0 - (1.0 - c) * (1.0 - b * 0.8);
  return mix(o, vec3(luma(o)), 0.12);`,

  comic: `
  float l = luma(blur5(P, 1.0));
  l = clamp((l - 0.5) * 1.4 + 0.5, 0.0, 1.0);
  float e = edgeAt(P, 1.2);
  float cs = max(uRes.y / 110.0, 2.5);
  vec2 pp = P * uRes;
  vec2 rp = vec2(pp.x + pp.y, pp.y - pp.x) * 0.7071 / cs;
  float dd = length(fract(rp) - 0.5);
  float ink;
  if (l > 0.58) ink = 1.0;
  else if (l > 0.3) { float rad = mix(0.48, 0.12, (l - 0.3) / 0.28); ink = smoothstep(rad - 0.08, rad + 0.08, dd); }
  else ink = 0.0;
  ink *= 1.0 - smoothstep(0.35, 0.65, e);
  return mix(vec3(0.06), vec3(0.98, 0.96, 0.9), ink);`,

  pencil: `
  vec3 c = cam(P);
  float l = luma(c);
  float e = smoothstep(0.08, 0.5, edgeAt(P, 1.0));
  vec2 pp = P * uRes;
  float sc = max(uRes.y / 180.0, 1.2);
  float h1 = 1.0 - smoothstep(0.15, 0.45, abs(fract((pp.x + pp.y) / (4.0 * sc)) - 0.5) * 2.0);
  float h2 = 1.0 - smoothstep(0.15, 0.45, abs(fract((pp.x - pp.y) / (4.0 * sc)) - 0.5) * 2.0);
  float dark = 1.0 - l;
  float hatch = h1 * smoothstep(0.35, 0.6, dark) + h2 * smoothstep(0.6, 0.85, dark);
  float g = noise(pp * 0.7) * 0.15;
  vec3 sat = clamp(mix(vec3(l), c, 1.6), 0.0, 1.0);
  float amt = clamp(e * 0.9 + hatch * 0.7 + dark * 0.15 - g, 0.0, 1.0);
  return mix(vec3(0.98, 0.97, 0.94), sat * 0.85, amt);`,

  thermal: `
  float l = luma(blur5(P, 2.0));
  return thermalPal(clamp((l - 0.08) * 1.25, 0.0, 1.0));`,

  xray: `
  float l = 1.0 - luma(blur5(P, 1.0));
  l = pow(smoothstep(0.08, 0.92, l), 1.3);
  return vec3(l) * vec3(0.8, 0.92, 1.0) + vec3(0.0, 0.02, 0.05);`,

  popart: `
  vec2 cell = floor(P * 2.0);
  vec2 sp = fract(P * 2.0);
  float l = luma(blur5(sp, 1.0));
  l = clamp((l - 0.5) * 1.3 + 0.5, 0.0, 1.0);
  int idx = int(cell.x) + int(cell.y) * 2;
  vec3 a, b, c;
  if (idx == 2) { a = vec3(0.12, 0.1, 0.5); b = vec3(1.0, 0.3, 0.6); c = vec3(1.0, 0.93, 0.25); }
  else if (idx == 3) { a = vec3(0.5, 0.05, 0.12); b = vec3(0.1, 0.75, 0.45); c = vec3(1.0, 0.78, 0.86); }
  else if (idx == 0) { a = vec3(0.05, 0.3, 0.12); b = vec3(1.0, 0.55, 0.05); c = vec3(0.6, 0.86, 1.0); }
  else { a = vec3(0.35, 0.0, 0.42); b = vec3(0.0, 0.62, 0.92); c = vec3(1.0, 1.0, 0.55); }
  vec3 o = mix(a, b, smoothstep(0.34, 0.38, l));
  return mix(o, c, smoothstep(0.62, 0.66, l));`,

  bulge: `return cam(bulge(P, vec2(0.5), 0.48, 2.0));`,
  dent: `return cam(bulge(P, vec2(0.5), 0.48, 0.5));`,
  twirl: `return cam(twirl(P, vec2(0.5), 0.6, 3.6));`,

  squeeze: `
  vec2 q = toA(P);
  float W = 0.62;
  float x = abs(q.x);
  if (x < W) q.x = sign(q.x) * W * pow(x / W, mix(0.55, 1.0, smoothstep(0.6, 1.0, x / W)));
  return cam(fromA(q));`,

  mirror: `return cam(vec2(P.x > 0.5 ? 1.0 - P.x : P.x, P.y));`,

  tunnel: `
  vec2 q = toA(P);
  float r = length(q);
  float R = 0.27;
  if (r <= R) return cam(P);
  vec2 dir = q / r;
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 8; i++) acc += cam(fromA(dir * R * (1.0 - float(i) * 0.012)));
  acc /= 8.0;
  return acc * mix(1.0, 0.55, smoothstep(0.0, 0.7, r - R));`,

  fisheye: `
  vec2 q = toA(P);
  float rmax = length(vec2(aspect() * 0.5, 0.5));
  float u = length(q) / rmax;
  if (u > 1e-5) {
    float k = 2.2;
    q *= (tan(u * atan(k)) / k) / u;
  }
  return cam(fromA(q)) * (1.0 - 0.3 * smoothstep(0.65, 1.0, u));`,

  stretch: `
  vec2 q = toA(P);
  float H = 0.45, W = 0.55;
  float y = abs(q.y), x = abs(q.x);
  if (y < H) q.y = sign(q.y) * H * pow(y / H, mix(1.6, 1.0, smoothstep(0.6, 1.0, y / H)));
  if (x < W) q.x = sign(q.x) * W * pow(x / W, mix(0.8, 1.0, smoothstep(0.6, 1.0, x / W)));
  return cam(fromA(q));`,

  bugout: `${FACE_PRE}
  vec2 p = bulge(P, uEyeL, d * 0.6, 2.1);
  p = bulge(p, uEyeR, d * 0.6, 2.1);
  return cam(p);`,

  chipmunk: `${FACE_PRE}
  vec2 p = bulge(P, uCheekL, d * 0.75, 1.8);
  p = bulge(p, uCheekR, d * 0.75, 1.8);
  p = bulge(p, uEyeL, d * 0.32, 0.7);
  p = bulge(p, uEyeR, d * 0.32, 0.7);
  return cam(p);`,

  lovestruck: `${FACE_PRE}
  vec3 c = cam(P);
  c = mix(c, c * vec3(1.08, 0.93, 0.96), 0.5);
  vec2 a = toA(P);
  vec2 center = toA(uHeadTop) + vec2(0.0, d * 0.25);
  for (int i = 0; i < 6; i++) {
    float ang = uTime * 1.4 + float(i) * PI / 3.0;
    vec2 pos = center + vec2(cos(ang) * d * 1.35, sin(ang) * d * 0.32);
    float depth = 0.5 - 0.5 * sin(ang);
    float size = d * mix(0.22, 0.34, depth);
    vec2 lp = (a - pos) / size;
    lp.y += 0.5;
    float sd = sdHeart(lp);
    float aa = 1.5 / (size * uRes.y);
    float m = 1.0 - smoothstep(-aa, aa, sd);
    vec3 col = mix(vec3(0.85, 0.05, 0.2), vec3(1.0, 0.45, 0.6), smoothstep(0.55, 1.0, lp.y) * step(0.0, -lp.x + 0.1));
    col = mix(vec3(0.45, 0.0, 0.08), col, smoothstep(0.0, 0.07, -sd));
    c = mix(c, col * mix(0.7, 1.0, depth), m);
  }
  return c;`,

  dizzy: `${FACE_PRE}
  vec3 c = cam(twirl(P, uFaceC, uFaceW * 0.9, 0.5 * sin(uTime * 2.5)));
  vec2 a = toA(P);
  vec2 center = toA(uHeadTop) + vec2(0.0, d * 0.25);
  for (int i = 0; i < 5; i++) {
    float ang = -uTime * 2.0 + float(i) * 2.0 * PI / 5.0;
    vec2 pos = center + vec2(cos(ang) * d * 1.3, sin(ang) * d * 0.3);
    float depth = 0.5 - 0.5 * sin(ang);
    float size = d * mix(0.2, 0.3, depth);
    vec2 lp = (a - pos) / size;
    float rot = uTime * 3.0 + float(i);
    lp = vec2(cos(rot) * lp.x - sin(rot) * lp.y, sin(rot) * lp.x + cos(rot) * lp.y);
    float sd = sdStar5(lp, 0.5, 0.45);
    float aa = 1.5 / (size * uRes.y);
    float m = 1.0 - smoothstep(-aa, aa, sd);
    vec3 col = mix(vec3(0.85, 0.45, 0.0), vec3(1.0, 0.92, 0.2), smoothstep(0.0, 0.08, -sd));
    c = mix(c, col * mix(0.75, 1.0, depth), m);
  }
  return c;`,

  nosetwirl: `${FACE_PRE}
  return cam(twirl(P, uNose, d * 0.95, 4.5 * sin(uTime * 1.3)));`,

  frog: `${FACE_PRE}
  vec2 p = scaleRegion(P, uMouth, vec2(d * 1.15, d * 0.5), vec2(0.62, 0.9));
  p = bulge(p, uEyeL, d * 0.5, 1.9);
  p = bulge(p, uEyeR, d * 0.5, 1.9);
  vec3 c = cam(p);
  float fm = 1.0 - smoothstep(0.75, 1.0, length((toA(P) - toA(uFaceC)) / vec2(uFaceW * 0.62, uFaceW * 0.85)));
  return mix(c, vec3(luma(c)) * vec3(0.55, 1.15, 0.45), 0.55 * fm);`,

  blockhead: `${FACE_PRE}
  return cam(scaleRegion(P, uFaceC, vec2(uFaceW * 0.95, uFaceW * 1.25), vec2(0.7, 1.35)));`,

  pinhead: `${FACE_PRE}
  return cam(bulge(P, uFaceC, uFaceW * 1.25, 0.45));`,

  user: `
  if (uHasBg < 0.5) return cam(P);
  float ca = aspect();
  vec2 uv = P;
  if (uBgAspect > ca) uv.x = (P.x - 0.5) * ca / uBgAspect + 0.5;
  else uv.y = (P.y - 0.5) * uBgAspect / ca + 0.5;
  return composite(texture(uBg, uv).rgb, P);`,
};

const NEEDS = {
  thermal: ['thermal'], lovestruck: ['heart'], dizzy: ['star'], earth: ['earth'], moon: ['earth'],
};

export function fragmentFor(effect) {
  const key = effect.kind === 'user' ? 'user' : effect.id;
  let defs = (NEEDS[key] || []).map((n) => DEFS[n]).join('\n');
  let body = BODIES[key];
  if (effect.kind === 'backdrop') {
    defs += `\nvec3 background(vec2 P) {${BG[key]}\n}`;
    body = 'return composite(background(P), P);';
  }
  return `${HEADER}
${defs}
vec3 effect(vec2 P) {
${body}
}
void main() { fragColor = vec4(clamp(effect(vUv), 0.0, 1.0), 1.0); }`;
}
