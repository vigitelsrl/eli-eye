// Downloads the MediaPipe models used for backdrops and face effects.
const fs = require('fs');
const path = require('path');

const MODELS = {
  'selfie_segmenter.tflite':
    'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite',
  'selfie_multiclass_256x256.tflite':
    'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite',
  'face_landmarker.task':
    'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task',
};

const dir = path.join(__dirname, '..', 'models');
fs.mkdirSync(dir, { recursive: true });

(async () => {
  for (const [name, url] of Object.entries(MODELS)) {
    const dest = path.join(dir, name);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 0) continue;
    process.stdout.write(`Downloading ${name}… `);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
    console.log('done');
  }
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
