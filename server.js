/**
 * Face Recognition System - Backend Server
 * Handles face data storage, attendance logging, and email notifications
 */

require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3100;

// Middleware
app.use(express.json({ limit: '20mb' }));
app.use(express.static('public'));
app.use('/models', express.static('models'));

// ─── File Paths ────────────────────────────────────────────────────────────────
const DATA_DIR    = path.join(__dirname, 'data');
const FACES_FILE  = path.join(DATA_DIR, 'faces.json');
const ATTEND_FILE = path.join(DATA_DIR, 'attendance.json');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

// Initialize data files if they don't exist
if (!fs.existsSync(DATA_DIR))      fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(FACES_FILE))    fs.writeFileSync(FACES_FILE,  JSON.stringify([], null, 2));
if (!fs.existsSync(ATTEND_FILE))   fs.writeFileSync(ATTEND_FILE, JSON.stringify([], null, 2));
if (!fs.existsSync(CONFIG_FILE))   fs.writeFileSync(CONFIG_FILE, JSON.stringify({
  systemName: 'Face Recognition System',
  notifyOnRecognize: false,
  notifyOnUnknown: true,
  matchThreshold: 0.5
}, null, 2));

// ─── Helper Functions ──────────────────────────────────────────────────────────
const readJSON  = (file)       => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJSON = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2));

// ─── API: Faces ────────────────────────────────────────────────────────────────

// GET all registered faces (returns descriptors for recognition)
app.get('/api/faces', (req, res) => {
  try {
    const faces = readJSON(FACES_FILE);
    res.json({ success: true, data: faces });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// POST register a new face
app.post('/api/faces/register', (req, res) => {
  try {
    const { name, personId, role, department, descriptor, thumbnail } = req.body;
    if (!name || !personId || !descriptor) {
      return res.status(400).json({ success: false, message: 'name, personId, and descriptor are required' });
    }

    const faces = readJSON(FACES_FILE);
    const existingIdx = faces.findIndex(f => f.personId === personId);
    const entry = {
      personId,
      name,
      role: role || 'person',
      department: department || '',
      descriptor,           // Float32Array serialized as array
      thumbnail: thumbnail || null,
      registeredAt: new Date().toISOString()
    };

    if (existingIdx >= 0) {
      faces[existingIdx] = entry;
      writeJSON(FACES_FILE, faces);
      res.json({ success: true, message: `${name} updated successfully`, updated: true });
    } else {
      faces.push(entry);
      writeJSON(FACES_FILE, faces);
      res.json({ success: true, message: `${name} registered successfully`, updated: false });
    }
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// DELETE a registered face
app.delete('/api/faces/:personId', (req, res) => {
  try {
    let faces = readJSON(FACES_FILE);
    const before = faces.length;
    faces = faces.filter(f => f.personId !== req.params.personId);
    if (faces.length === before) {
      return res.status(404).json({ success: false, message: 'Person not found' });
    }
    writeJSON(FACES_FILE, faces);
    res.json({ success: true, message: 'Person removed' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ─── API: Attendance ───────────────────────────────────────────────────────────

// GET attendance records (optional filters: ?date=MM/DD/YYYY&search=name)
app.get('/api/attendance', (req, res) => {
  try {
    const { date, search } = req.query;
    let records = readJSON(ATTEND_FILE);

    if (date)   records = records.filter(r => r.date === date);
    if (search) records = records.filter(r =>
      r.personName.toLowerCase().includes(search.toLowerCase()) ||
      r.personId.toLowerCase().includes(search.toLowerCase())
    );

    res.json({ success: true, data: records.reverse() });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// POST log attendance when a face is recognized
app.post('/api/attendance/log', (req, res) => {
  try {
    const { personId, personName, role, department, confidence } = req.body;
    if (!personId) return res.status(400).json({ success: false, message: 'personId required' });

    const records   = readJSON(ATTEND_FILE);
    const now       = new Date();
    const todayStr  = now.toLocaleDateString('en-US');

    // Prevent duplicate logs for same person same day
    const alreadyToday = records.some(r =>
      r.personId === personId && r.date === todayStr
    );

    if (alreadyToday) {
      return res.json({ success: true, alreadyLogged: true, message: `${personName} already logged today` });
    }

    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      personId,
      personName,
      role: role || 'person',
      department: department || '',
      confidence: confidence || 0,
      timestamp: now.toISOString(),
      date: todayStr,
      time: now.toLocaleTimeString('en-US')
    };

    records.push(entry);
    writeJSON(ATTEND_FILE, records);
    res.json({ success: true, alreadyLogged: false, message: `${personName} attendance logged`, entry });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// GET today's absent list
app.get('/api/attendance/absent', (req, res) => {
  try {
    const faces    = readJSON(FACES_FILE);
    const records  = readJSON(ATTEND_FILE);
    const today    = new Date().toLocaleDateString('en-US');
    const present  = new Set(records.filter(r => r.date === today).map(r => r.personId));
    const absent   = faces.filter(f => !present.has(f.personId));
    res.json({ success: true, data: absent, date: today });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// DELETE attendance records by date
app.delete('/api/attendance', (req, res) => {
  try {
    const { date } = req.query;
    let records = readJSON(ATTEND_FILE);
    if (date) records = records.filter(r => r.date !== date);
    else      records = [];
    writeJSON(ATTEND_FILE, records);
    res.json({ success: true, message: 'Records cleared' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ─── API: Statistics ───────────────────────────────────────────────────────────
app.get('/api/stats', (req, res) => {
  try {
    const faces   = readJSON(FACES_FILE);
    const records = readJSON(ATTEND_FILE);
    const today   = new Date().toLocaleDateString('en-US');
    const todayRecords = records.filter(r => r.date === today);

    res.json({
      success: true,
      data: {
        totalRegistered: faces.length,
        todayPresent:    todayRecords.length,
        todayAbsent:     Math.max(0, faces.length - todayRecords.length),
        totalLogs:       records.length
      }
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ─── API: Email Notification ───────────────────────────────────────────────────
app.post('/api/notify', async (req, res) => {
  const { personName, personId, role, department, timestamp, type } = req.body;

  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    return res.json({ success: false, message: 'Email not configured in .env file' });
  }

  try {
    const transporter = nodemailer.createTransport({
      service: process.env.EMAIL_SERVICE || 'gmail',
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
    });

    const isUnknown = type === 'unknown';
    const subject   = isUnknown
      ? '⚠️ Unknown Face Detected'
      : `✅ Face Recognized: ${personName}`;

    const html = isUnknown ? `
      <div style="font-family:sans-serif;padding:20px;background:#fff3cd;border-radius:8px">
        <h2 style="color:#856404">⚠️ Unknown Face Detected</h2>
        <p>An unrecognized face was detected by the system.</p>
        <p><strong>Time:</strong> ${new Date(timestamp).toLocaleString()}</p>
        <p>Please review the system logs for more details.</p>
      </div>
    ` : `
      <div style="font-family:sans-serif;padding:20px;background:#d4edda;border-radius:8px">
        <h2 style="color:#155724">✅ Face Recognized</h2>
        <table style="border-collapse:collapse;width:100%;margin-top:10px">
          <tr><td style="padding:6px;font-weight:bold">Name</td><td style="padding:6px">${personName}</td></tr>
          <tr><td style="padding:6px;font-weight:bold">ID</td><td style="padding:6px">${personId}</td></tr>
          <tr><td style="padding:6px;font-weight:bold">Role</td><td style="padding:6px">${role || 'N/A'}</td></tr>
          <tr><td style="padding:6px;font-weight:bold">Department</td><td style="padding:6px">${department || 'N/A'}</td></tr>
          <tr><td style="padding:6px;font-weight:bold">Time</td><td style="padding:6px">${new Date(timestamp).toLocaleString()}</td></tr>
        </table>
      </div>
    `;

    await transporter.sendMail({
      from: `"Face Recognition System" <${process.env.EMAIL_USER}>`,
      to:   process.env.NOTIFY_EMAIL || process.env.EMAIL_USER,
      subject,
      html
    });

    res.json({ success: true, message: 'Notification sent' });
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

// ─── API: Config ───────────────────────────────────────────────────────────────
app.get('/api/config', (req, res) => {
  try {
    res.json({ success: true, data: readJSON(CONFIG_FILE) });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.put('/api/config', (req, res) => {
  try {
    const current = readJSON(CONFIG_FILE);
    const updated = { ...current, ...req.body };
    writeJSON(CONFIG_FILE, updated);
    res.json({ success: true, data: updated });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// ─── Start Server ──────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n╔═══════════════════════════════════════════╗`);
  console.log(`║   Face Recognition System  v1.0           ║`);
  console.log(`╠═══════════════════════════════════════════╣`);
  console.log(`║  Running at: http://localhost:${PORT}         ║`);
  console.log(`╠═══════════════════════════════════════════╣`);
  console.log(`║  Dashboard:   http://localhost:${PORT}/       ║`);
  console.log(`║  Register:    http://localhost:${PORT}/register║`);
  console.log(`║  Recognize:   http://localhost:${PORT}/recognize║`);
  console.log(`║  Attendance:  http://localhost:${PORT}/attendance║`);
  console.log(`╚═══════════════════════════════════════════╝\n`);
});
