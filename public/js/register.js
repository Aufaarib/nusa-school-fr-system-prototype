/**
 * register.js — Face Registration Logic
 * Uses face-api.js to capture face descriptors from live camera
 */

const MODEL_URL      = '/models';
const SAMPLE_TARGET  = 10;     // How many frames to average for stability

let videoEl, overlayEl, overlayCtx;
let stream          = null;
let capturedSamples = [];     // Array of Float32Array descriptors
let isCapturing     = false;
let modelsLoaded    = false;
let detectionLoop   = null;

// ─── Init on Page Load ────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  videoEl   = document.getElementById('video');
  overlayEl = document.getElementById('overlay');
  overlayCtx = overlayEl.getContext('2d');

  await loadModels();
  await refreshRegisteredList();
});

// ─── Load AI Models ───────────────────────────────────────────────────────────
async function loadModels() {
  const dot    = document.getElementById('modelDot');
  const status = document.getElementById('modelStatus');

  try {
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODEL_URL),
      faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
    ]);

    modelsLoaded = true;
    dot.classList.add('live');
    status.textContent = 'AI models ready';
    document.getElementById('loadingOverlay').style.display = 'none';
    document.getElementById('btnCamera').disabled = false;
    showToast('info', 'Ready', 'AI models loaded. Start the camera to register.');
  } catch (err) {
    status.textContent = 'Model load failed!';
    document.getElementById('loadingOverlay').innerHTML = `
      <div style="color:var(--red);text-align:center;padding:20px">
        <div style="font-size:2rem">❌</div>
        <div style="font-weight:600;margin:8px 0">Models Not Found</div>
        <div style="font-size:0.8rem;color:var(--text-muted)">
          Run: <code>node download-models.js</code><br>then restart the server
        </div>
      </div>`;
    showToast('error', 'Models missing', 'Run: node download-models.js');
  }
}

// ─── Camera ───────────────────────────────────────────────────────────────────
async function startCamera() {
  if (!modelsLoaded) return showToast('warning', 'Wait', 'Models still loading...');

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }
    });
    videoEl.srcObject = stream;
    await videoEl.play();

    // Sync overlay canvas to video dimensions
    videoEl.addEventListener('loadedmetadata', () => {
      overlayEl.width  = videoEl.videoWidth;
      overlayEl.height = videoEl.videoHeight;
    });

    document.getElementById('cameraLabel').textContent = '● LIVE';
    document.getElementById('cameraLabel').style.color = 'var(--green)';
    document.getElementById('btnCamera').textContent   = '⏹ Stop Camera';
    document.getElementById('btnCamera').onclick       = stopCamera;
    document.getElementById('btnCapture').disabled     = false;

    startDetectionLoop();
  } catch (err) {
    showToast('error', 'Camera error', err.message.includes('Permission')
      ? 'Please allow camera access in your browser.' : err.message);
  }
}

function stopCamera() {
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  if (detectionLoop) { clearInterval(detectionLoop); detectionLoop = null; }
  overlayCtx.clearRect(0, 0, overlayEl.width, overlayEl.height);
  document.getElementById('cameraLabel').textContent = 'CAMERA OFF';
  document.getElementById('cameraLabel').style.color = '';
  document.getElementById('btnCamera').textContent   = '📷 Start Camera';
  document.getElementById('btnCamera').onclick       = startCamera;
  document.getElementById('btnCapture').disabled     = true;
}

// ─── Detection Loop (draws boxes on overlay) ──────────────────────────────────
function startDetectionLoop() {
  const opts = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 });

  detectionLoop = setInterval(async () => {
    if (!stream) return;
    try {
      const detections = await faceapi.detectAllFaces(videoEl, opts)
        .withFaceLandmarks(true);

      overlayCtx.clearRect(0, 0, overlayEl.width, overlayEl.height);

      const dims = { width: overlayEl.width, height: overlayEl.height };
      const resized = faceapi.resizeResults(detections, dims);

      resized.forEach(d => {
        const box = d.detection.box;
        // Draw box
        overlayCtx.strokeStyle = capturedSamples.length >= SAMPLE_TARGET
          ? '#3fb950' : '#58a6ff';
        overlayCtx.lineWidth   = 2;
        overlayCtx.strokeRect(box.x, box.y, box.width, box.height);

        // Draw label
        overlayCtx.fillStyle = overlayCtx.strokeStyle;
        overlayCtx.font = 'bold 13px sans-serif';
        const label = capturedSamples.length >= SAMPLE_TARGET
          ? '✓ Ready to save' : `Detecting... ${capturedSamples.length}/${SAMPLE_TARGET}`;
        overlayCtx.fillRect(box.x - 1, box.y - 22, overlayCtx.measureText(label).width + 12, 22);
        overlayCtx.fillStyle = '#000';
        overlayCtx.fillText(label, box.x + 5, box.y - 6);
      });

      // Face count indicator
      if (resized.length > 1) {
        overlayCtx.fillStyle = 'rgba(245,130,32,0.8)';
        overlayCtx.fillRect(4, 4, 200, 24);
        overlayCtx.fillStyle = '#000';
        overlayCtx.font = 'bold 13px sans-serif';
        overlayCtx.fillText(`${resized.length} faces detected — use single face`, 8, 20);
      }
    } catch (e) { /* Ignore frame errors */ }
  }, 200);
}

// ─── Capture Sample ───────────────────────────────────────────────────────────
async function captureSample() {
  if (!stream || isCapturing) return;
  if (capturedSamples.length >= SAMPLE_TARGET) {
    return showToast('info', 'Already captured', 'Click "Register Person" to save');
  }

  const name     = document.getElementById('name').value.trim();
  const personId = document.getElementById('personId').value.trim();
  if (!name || !personId) {
    return showToast('warning', 'Missing info', 'Please enter Name and Person ID first');
  }

  isCapturing = true;
  const btn   = document.getElementById('btnCapture');
  btn.disabled = true;
  btn.textContent = '⏳ Detecting...';

  try {
    const opts = new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.5 });
    const result = await faceapi.detectSingleFace(videoEl, opts)
      .withFaceLandmarks(true)
      .withFaceDescriptor();

    if (!result) {
      showToast('warning', 'No face', 'No face detected. Position yourself in front of the camera.');
    } else {
      capturedSamples.push(Array.from(result.descriptor));

      const pct = (capturedSamples.length / SAMPLE_TARGET) * 100;
      document.getElementById('captureBar').style.width = pct + '%';
      document.getElementById('captureCount').textContent =
        `${capturedSamples.length} / ${SAMPLE_TARGET} samples`;

      if (capturedSamples.length === 1) {
        // Take thumbnail from first capture
        const canvas = document.createElement('canvas');
        const box    = result.detection.box;
        const pad    = 20;
        canvas.width  = box.width  + pad * 2;
        canvas.height = box.height + pad * 2;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(videoEl,
          box.x - pad, box.y - pad, box.width + pad*2, box.height + pad*2,
          0, 0, canvas.width, canvas.height);
        const thumb = canvas.toDataURL('image/jpeg', 0.7);
        document.getElementById('thumbImg').src = thumb;
        document.getElementById('thumbPreview').style.display = 'block';
        window._thumbnail = thumb;
      }

      if (capturedSamples.length < SAMPLE_TARGET) {
        document.getElementById('captureHint').textContent =
          `Great! Move slightly and capture again (${SAMPLE_TARGET - capturedSamples.length} more)`;
        document.getElementById('captureBar').classList.remove('success');
      } else {
        document.getElementById('captureHint').textContent =
          '✅ All samples captured! Fill in details and click Register.';
        document.getElementById('captureBar').classList.add('success');
        document.getElementById('btnRegister').disabled = false;
        showToast('success', 'Capture complete', 'Face samples ready. Click Register Person.');
      }
    }
  } catch (err) {
    showToast('error', 'Error', err.message);
  } finally {
    isCapturing  = false;
    btn.disabled = capturedSamples.length >= SAMPLE_TARGET;
    btn.textContent = '⊕ Capture Face';
  }
}

// ─── Compute Mean Descriptor ──────────────────────────────────────────────────
function averageDescriptors(samples) {
  const len = samples[0].length;
  const avg = new Array(len).fill(0);
  for (const d of samples) {
    for (let i = 0; i < len; i++) avg[i] += d[i] / samples.length;
  }
  return avg;
}

// ─── Register Person ──────────────────────────────────────────────────────────
async function registerPerson() {
  const name       = document.getElementById('name').value.trim();
  const personId   = document.getElementById('personId').value.trim();
  const role       = document.getElementById('role').value;
  const department = document.getElementById('department').value.trim();

  if (!name || !personId) return showToast('warning', 'Required', 'Name and ID are required');
  if (capturedSamples.length < SAMPLE_TARGET) {
    return showToast('warning', 'Incomplete', 'Please capture enough face samples first');
  }

  const btn = document.getElementById('btnRegister');
  btn.disabled = true;
  btn.textContent = '⏳ Saving...';

  try {
    const descriptor = averageDescriptors(capturedSamples);
    const body = {
      name, personId, role, department,
      descriptor,
      thumbnail: window._thumbnail || null
    };

    const res  = await fetch('/api/faces/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();

    if (data.success) {
      showToast('success', data.updated ? 'Updated' : 'Registered!',
        `${name} has been ${data.updated ? 'updated' : 'registered'} successfully`);
      resetCapture();
      document.getElementById('name').value       = '';
      document.getElementById('personId').value   = '';
      document.getElementById('department').value = '';
      await refreshRegisteredList();
    } else {
      showToast('error', 'Failed', data.message);
    }
  } catch (err) {
    showToast('error', 'Error', err.message);
  } finally {
    btn.disabled    = false;
    btn.textContent = '✅ Register Person';
  }
}

// ─── Reset Capture ────────────────────────────────────────────────────────────
function resetCapture() {
  capturedSamples  = [];
  window._thumbnail = null;
  document.getElementById('captureBar').style.width  = '0%';
  document.getElementById('captureBar').classList.remove('success');
  document.getElementById('captureCount').textContent = `0 / ${SAMPLE_TARGET} samples`;
  document.getElementById('captureHint').textContent  = 'Start the camera and click "Capture Face" to begin';
  document.getElementById('thumbPreview').style.display = 'none';
  document.getElementById('btnRegister').disabled = true;
  if (stream) document.getElementById('btnCapture').disabled = false;
}

// ─── Refresh Registered List ──────────────────────────────────────────────────
async function refreshRegisteredList() {
  try {
    const res  = await fetch('/api/faces');
    const data = await res.json();
    const list = data.success ? data.data : [];

    document.getElementById('regCount').textContent = list.length;
    document.getElementById('btnClearAll').style.display = list.length ? 'inline-flex' : 'none';

    const container = document.getElementById('miniList');
    if (!list.length) {
      container.innerHTML = `<div class="empty-state" style="padding:24px"><span class="icon">👥</span><p>No persons registered</p></div>`;
      return;
    }

    container.innerHTML = list.map(f => `
      <div class="flex-between" style="padding:8px 0;border-bottom:1px solid var(--border)">
        <div class="flex-center">
          ${f.thumbnail
            ? `<img src="${f.thumbnail}" style="width:32px;height:32px;border-radius:50%;object-fit:cover">`
            : `<div style="width:32px;height:32px;border-radius:50%;background:var(--border);display:flex;align-items:center;justify-content:center">👤</div>`}
          <div>
            <div style="font-size:0.85rem;font-weight:600">${f.name}</div>
            <div style="font-size:0.72rem;color:var(--text-muted)">${f.personId} • ${f.role}</div>
          </div>
        </div>
        <button class="btn btn-danger btn-sm" onclick="deletePerson('${f.personId}','${f.name}')">✕</button>
      </div>
    `).join('');
  } catch (e) { }
}

async function deletePerson(personId, name) {
  if (!confirm(`Remove ${name}?`)) return;
  const res  = await fetch(`/api/faces/${encodeURIComponent(personId)}`, { method: 'DELETE' });
  const data = await res.json();
  if (data.success) {
    showToast('success', 'Removed', `${name} removed`);
    refreshRegisteredList();
  }
}

async function clearAll() {
  if (!confirm('Remove ALL registered persons? This cannot be undone.')) return;
  const res  = await fetch('/api/faces');
  const data = await res.json();
  for (const f of data.data) {
    await fetch(`/api/faces/${encodeURIComponent(f.personId)}`, { method: 'DELETE' });
  }
  showToast('success', 'Cleared', 'All persons removed');
  refreshRegisteredList();
}

// ─── Toast Helper ─────────────────────────────────────────────────────────────
function showToast(type, title, msg) {
  const icons = { success:'✅', error:'❌', warning:'⚠️', info:'ℹ️' };
  const el    = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `
    <div class="toast-icon">${icons[type] || 'ℹ️'}</div>
    <div><div class="toast-title">${title}</div><div class="toast-msg">${msg}</div></div>
  `;
  el.onclick = () => el.remove();
  document.getElementById('toastContainer').appendChild(el);
  setTimeout(() => el.remove(), 5000);
}
