/**
 * Model Downloader
 * Downloads face-api.js model weights needed for face recognition.
 * Run: node download-models.js
 */

const https  = require('https');
const fs     = require('fs');
const path   = require('path');

const MODELS_DIR = path.join(__dirname, 'models');
const BASE_URL   = 'https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights';

const MODEL_FILES = [
  // Tiny Face Detector (fast detection)
  'tiny_face_detector_model-weights_manifest.json',
  'tiny_face_detector_model-shard1',
  // 68-point Face Landmarks (tiny, for alignment)
  'face_landmark_68_tiny_model-weights_manifest.json',
  'face_landmark_68_tiny_model-shard1',
  // Face Recognition (128-d descriptor)
  'face_recognition_model-weights_manifest.json',
  'face_recognition_model-shard1',
  'face_recognition_model-shard2',
];

if (!fs.existsSync(MODELS_DIR)) fs.mkdirSync(MODELS_DIR);

let downloaded = 0;

function downloadFile(filename) {
  return new Promise((resolve, reject) => {
    const dest = path.join(MODELS_DIR, filename);
    if (fs.existsSync(dest)) {
      console.log(`  ✓ Already exists: ${filename}`);
      downloaded++;
      return resolve();
    }

    const file = fs.createWriteStream(dest);
    const url  = `${BASE_URL}/${filename}`;
    console.log(`  ↓ Downloading: ${filename}`);

    https.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        // Handle redirect
        https.get(response.headers.location, (r) => {
          r.pipe(file);
          file.on('finish', () => { file.close(); downloaded++; resolve(); });
        }).on('error', reject);
      } else if (response.statusCode === 200) {
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          downloaded++;
          console.log(`  ✓ Done: ${filename}`);
          resolve();
        });
      } else {
        fs.unlink(dest, () => {});
        reject(new Error(`Failed to download ${filename}: HTTP ${response.statusCode}`));
      }
    }).on('error', (err) => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

async function main() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(' Face Recognition Model Downloader');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`\n📁 Saving to: ${MODELS_DIR}`);
  console.log(`📦 Files to download: ${MODEL_FILES.length}\n`);

  for (const file of MODEL_FILES) {
    try {
      await downloadFile(file);
    } catch (err) {
      console.error(`  ✗ Error: ${err.message}`);
    }
  }

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(` ✅ Done! ${downloaded}/${MODEL_FILES.length} files ready`);
  console.log(` 🚀 You can now run: npm start`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
}

main();
