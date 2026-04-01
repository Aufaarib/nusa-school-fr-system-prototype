/**
 * recognize.js — Live Face Recognition Engine
 *
 * How it works:
 * 1. Load all registered face descriptors from server
 * 2. Every frame: detect ALL faces in the camera feed
 * 3. For each detected face: compute 128-d descriptor
 * 4. Match against registered faces using Euclidean distance
 * 5. If distance < threshold → recognized; else → unknown
 * 6. Log attendance + send alerts
 */

const MODEL_URL = '/models';

let videoEl, overlayEl, overlayCtx;
let stream         = null;
let isRunning      = false;
let rafId          = null;
let faceMatcher    = null;
let modelsLoaded   = false;
let registeredFaces = [];

// Tracking
let recognizedToday = new Set();  // personIds logged today
let unknownCount    = 0;
let recognizedCount = 0;
let unknownAlerted  = new Set();  // prevent spam for unknown faces (by position hash)
let lastFrameTime   = 0;
let frameCount      = 0;
let fps             = 0;

// ─── Init ─────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  videoEl    = document.getElementById('video');
  overlayEl  = document.getElementById('overlay');
  overlayCtx = overlayEl.getContext('2d');

  await loadModels();
  await loadRegisteredFaces();
  await refreshPresentList();
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
    status.textContent = 'Models ready';
    document.getElementById('loadingOverlay').style.display = 'none';
    document.getElementById('btnStart').disabled = false;
  } catch (err) {
    status.textContent = '❌ Model load failed';
    document.getElementById('loadingOverlay').innerHTML = `
      <div style="color:var(--red);text-align:center;padding:20px">
        <div style="font-size:2rem">❌</div>
        <div style="font-weight:600;margin:8px 0">Models Missing</div>
        <div style="font-size:0.8rem;color:var(--text-muted)">Run: <code>node download-models.js</code></div>
      </div>`;
  }
}

// ─── Load Registered Faces from Server ───────────────────────────────────────
async function loadRegisteredFaces() {
  try {
    const res  = await fetch('/api/faces');
    const data = await res.json();
    if (!data.success) return;

    registeredFaces = data.data;
    document.getElementById('registeredTotal').textContent = registeredFaces.length;

    if (!registeredFaces.length) {
      showToast('warning', 'No faces registered',
        'Go to the Register page to add people first.');
      return;
    }

    // Build FaceMatcher from stored descriptors
    const labeledDescriptors = registeredFaces.map(f => {
      const desc = new Float32Array(f.descriptor);
      return new faceapi.LabeledFaceDescriptors(
        JSON.stringify({ id: f.personId, name: f.name, role: f.role, dept: f.department }),
        [desc]
      );
    });

    const threshold = parseFloat(document.getElementById('threshold').value);
    faceMatcher = new faceapi.FaceMatcher(labeledDescriptors, threshold);
    showToast('info', 'Ready', `${registeredFaces.length} person(s) loaded. Start camera to begin.`);
  } catch (e) {
    showToast('error', 'Load error', e.message);
  }
}

// ─── Start Recognition ────────────────────────────────────────────────────────
async function startRecognition() {
  if (!modelsLoaded) return showToast('warning', 'Wait', 'AI models still loading...');
  if (!registeredFaces.length) {
    return showToast('warning', 'No faces', 'Register people first before starting recognition.');
  }

  // Rebuild face matcher with current threshold
  const threshold = parseFloat(document.getElementById('threshold').value);
  const labeledDescriptors = registeredFaces.map(f => {
    const desc = new Float32Array(f.descriptor);
    return new faceapi.LabeledFaceDescriptors(
      JSON.stringify({ id: f.personId, name: f.name, role: f.role, dept: f.department }),
      [desc]
    );
  });
  faceMatcher = new faceapi.FaceMatcher(labeledDescriptors, threshold);

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 720 }, height: { ideal: 540 }, facingMode: 'user' }
    });
    videoEl.srcObject = stream;
    await videoEl.play();

    videoEl.addEventListener('loadedmetadata', () => {
      overlayEl.width  = videoEl.videoWidth;
      overlayEl.height = videoEl.videoHeight;
    });

    isRunning = true;
    document.getElementById('cameraLabel').textContent = '● LIVE';
    document.getElementById('cameraLabel').style.color = 'var(--green)';
    document.getElementById('btnStart').style.display  = 'none';
    document.getElementById('btnStop').style.display   = 'inline-flex';

    // Status dot
    document.getElementById('modelDot').classList.add('live');
    document.getElementById('modelStatus').textContent = 'Scanning...';

    runDetectionLoop();
  } catch (err) {
    showToast('error', 'Camera error', err.message.includes('Permission')
      ? 'Allow camera access in your browser.' : err.message);
  }
}

// ─── Detection Loop ───────────────────────────────────────────────────────────
async function runDetectionLoop() {
  if (!isRunning) return;

  const opts = new faceapi.TinyFaceDetectorOptions({
    inputSize: 416,     // Larger = more accurate but slower
    scoreThreshold: 0.4
  });

  const process = async () => {
    if (!isRunning) return;

    // FPS counter
    const now = performance.now();
    frameCount++;
    if (now - lastFrameTime >= 1000) {
      fps = frameCount;
      frameCount = 0;
      lastFrameTime = now;
      document.getElementById('fpsDisplay').textContent = `${fps} FPS`;
    }

    try {
      // Detect all faces + compute descriptors
      const detections = await faceapi
        .detectAllFaces(videoEl, opts)
        .withFaceLandmarks(true)
        .withFaceDescriptors();

      // Resize results to match overlay canvas
      const dims    = { width: overlayEl.width, height: overlayEl.height };
      const resized = faceapi.resizeResults(detections, dims);

      // Clear overlay
      overlayCtx.clearRect(0, 0, overlayEl.width, overlayEl.height);

      // Update in-frame count
      document.getElementById('facesInFrame').textContent = resized.length;

      // Process each detected face
      for (const detection of resized) {
        const match = faceMatcher.findBestMatch(detection.descriptor);

        if (match.label === 'unknown') {
          drawFaceBox(detection.detection.box, '🔴 UNKNOWN', '#f85149', 0);
          await handleUnknown(detection.detection.box);
        } else {
          let person;
          try { person = JSON.parse(match.label); } catch { person = { name: match.label }; }
          const confidence = Math.round((1 - match.distance) * 100);
          drawFaceBox(detection.detection.box, `✓ ${person.name}`, '#3fb950', confidence);
          await handleRecognized(person, confidence, detection.detection.box);
        }
      }

      // Crowd warning
      if (resized.length > 1) {
        overlayCtx.save();
        overlayCtx.fillStyle = 'rgba(90, 165, 255, 0.85)';
        const msg = ` 👥 ${resized.length} faces detected `;
        const w = overlayCtx.measureText(msg).width + 16;
        overlayCtx.fillRect(overlayEl.width/2 - w/2, 8, w, 26);
        overlayCtx.fillStyle = '#000';
        overlayCtx.font = 'bold 13px sans-serif';
        overlayCtx.fillText(msg, overlayEl.width/2 - w/2 + 8, 25);
        overlayCtx.restore();
      }

    } catch (e) {
      // Silent frame errors (e.g. during model inference)
    }

    rafId = requestAnimationFrame(process);
  };

  rafId = requestAnimationFrame(process);
}

// ─── Draw Bounding Box on Canvas ──────────────────────────────────────────────
function drawFaceBox(box, label, color, confidence) {
  const ctx = overlayCtx;

  // Outer glow
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth   = 2.5;
  ctx.shadowColor = color;
  ctx.shadowBlur  = 10;
  ctx.strokeRect(box.x, box.y, box.width, box.height);
  ctx.restore();

  // Corner brackets
  const cs = 18; // corner size
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  const corners = [
    [[box.x, box.y + cs], [box.x, box.y],                    [box.x + cs, box.y]],
    [[box.x+box.width-cs, box.y], [box.x+box.width, box.y],   [box.x+box.width, box.y+cs]],
    [[box.x+box.width, box.y+box.height-cs], [box.x+box.width, box.y+box.height], [box.x+box.width-cs, box.y+box.height]],
    [[box.x+cs, box.y+box.height], [box.x, box.y+box.height], [box.x, box.y+box.height-cs]],
  ];
  corners.forEach(pts => {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    ctx.lineTo(pts[1][0], pts[1][1]);
    ctx.lineTo(pts[2][0], pts[2][1]);
    ctx.stroke();
  });

  // Label background
  const fontSize = 13;
  ctx.font = `bold ${fontSize}px sans-serif`;
  const labelText = confidence > 0 ? `${label} (${confidence}%)` : label;
  const lw = ctx.measureText(labelText).width + 14;
  const lh = 24;
  ctx.fillStyle = color;
  ctx.fillRect(box.x - 1, box.y - lh - 2, lw, lh);

  // Label text
  ctx.fillStyle = '#000';
  ctx.fillText(labelText, box.x + 6, box.y - lh + 16);
}

// ─── Handle Recognized Person ─────────────────────────────────────────────────
async function handleRecognized(person, confidence, box) {
  const personId = person.id;
  if (!personId || recognizedToday.has(personId)) return;

  recognizedToday.add(personId);
  recognizedCount++;
  document.getElementById('recognizedCount').textContent = recognizedCount;

  const now = new Date();

  // Add to log
  addLogEntry({
    type: 'recognized',
    name: person.name,
    id: personId,
    role: person.role,
    dept: person.dept,
    confidence,
    time: now.toLocaleTimeString()
  });

  // Log attendance to server
  try {
    await fetch('/api/attendance/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personId,
        personName: person.name,
        role: person.role,
        department: person.dept,
        confidence
      })
    });
    await refreshPresentList();
  } catch (e) { }

  // On-screen alert
  if (document.getElementById('chkNotify').checked) {
    showToast('success', `✅ ${person.name}`, `${person.role || 'Person'} recognized (${confidence}%)`);
  }

  // Email notification
  if (document.getElementById('chkEmail').checked) {
    try {
      await fetch('/api/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          personName: person.name,
          personId,
          role: person.role,
          department: person.dept,
          timestamp: now.toISOString(),
          type: 'recognized'
        })
      });
    } catch (e) { }
  }
}

// ─── Handle Unknown Face ──────────────────────────────────────────────────────
async function handleUnknown(box) {
  if (!document.getElementById('chkUnknown').checked) return;

  // Use position bucket to avoid spamming the same unknown face
  const posKey = `${Math.round(box.x/50)}_${Math.round(box.y/50)}`;
  if (unknownAlerted.has(posKey)) return;

  unknownAlerted.add(posKey);
  unknownCount++;
  document.getElementById('unknownCount').textContent = unknownCount;
  setTimeout(() => unknownAlerted.delete(posKey), 8000); // allow re-alert after 8s

  addLogEntry({
    type: 'unknown',
    name: 'Unknown Person',
    id: '—',
    role: 'unregistered',
    confidence: 0,
    time: new Date().toLocaleTimeString()
  });

  showToast('warning', '⚠️ Unknown Face', 'Unregistered person detected in frame');

  if (document.getElementById('chkEmail').checked) {
    try {
      await fetch('/api/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          timestamp: new Date().toISOString(),
          type: 'unknown'
        })
      });
    } catch (e) { }
  }
}

// ─── Add to Recognition Log ───────────────────────────────────────────────────
function addLogEntry({ type, name, id, role, confidence, time }) {
  const log = document.getElementById('recognitionLog');

  // Clear empty state
  const empty = log.querySelector('.empty-state');
  if (empty) empty.remove();

  const entry = document.createElement('div');
  entry.className = `log-entry ${type === 'recognized' ? 'new' : 'unknown'}`;
  entry.innerHTML = `
    <div style="font-size:1.6rem;line-height:1">${type === 'recognized' ? '✅' : '⚠️'}</div>
    <div style="flex:1;min-width:0">
      <div style="font-weight:600;font-size:0.9rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
        ${name}
      </div>
      <div style="font-size:0.75rem;color:var(--text-muted)">${role}${id !== '—' ? ' · ' + id : ''}</div>
    </div>
    <div style="text-align:right;flex-shrink:0">
      ${confidence ? `<div style="font-size:0.8rem;color:var(--green)">${confidence}%</div>` : '<span class="badge badge-yellow">Unknown</span>'}
      <div style="font-size:0.7rem;color:var(--text-muted)">${time}</div>
    </div>
  `;

  log.insertBefore(entry, log.firstChild);

  // Keep max 50 entries
  while (log.children.length > 50) log.lastChild.remove();
}

// ─── Refresh Present List ─────────────────────────────────────────────────────
async function refreshPresentList() {
  try {
    const today = new Date().toLocaleDateString('en-US');
    const res   = await fetch(`/api/attendance?date=${encodeURIComponent(today)}`);
    const data  = await res.json();
    const list  = data.success ? data.data : [];

    document.getElementById('presentBadge').textContent = list.length;

    const container = document.getElementById('presentList');
    if (!list.length) {
      container.innerHTML = `<div style="font-size:0.82rem;color:var(--text-muted);text-align:center;padding:16px">No one yet</div>`;
      return;
    }

    container.innerHTML = list.slice(0, 15).map(r => `
      <div class="flex-between" style="padding:6px 0;border-bottom:1px solid var(--border)">
        <div>
          <div style="font-size:0.85rem;font-weight:600">${r.personName}</div>
          <div style="font-size:0.72rem;color:var(--text-muted)">${r.personId}</div>
        </div>
        <div style="font-size:0.75rem;color:var(--green)">${r.time}</div>
      </div>
    `).join('');
  } catch (e) { }
}

// ─── Stop Recognition ─────────────────────────────────────────────────────────
function stopRecognition() {
  isRunning = false;
  if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  overlayCtx.clearRect(0, 0, overlayEl.width, overlayEl.height);

  document.getElementById('cameraLabel').textContent = 'CAMERA OFF';
  document.getElementById('cameraLabel').style.color = '';
  document.getElementById('btnStart').style.display  = 'inline-flex';
  document.getElementById('btnStop').style.display   = 'none';
  document.getElementById('facesInFrame').textContent = '0';
  document.getElementById('modelStatus').textContent = 'Stopped';
}

// ─── Clear Log ────────────────────────────────────────────────────────────────
function clearLog() {
  document.getElementById('recognitionLog').innerHTML = `
    <div class="empty-state" style="padding:32px">
      <span class="icon">👁️</span>
      <p>Log cleared. Keep camera running to continue.</p>
    </div>`;
  recognizedToday.clear();
  unknownAlerted.clear();
  recognizedCount = 0;
  unknownCount    = 0;
  document.getElementById('recognizedCount').textContent = '0';
  document.getElementById('unknownCount').textContent    = '0';
}

// ─── Toast ────────────────────────────────────────────────────────────────────
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
