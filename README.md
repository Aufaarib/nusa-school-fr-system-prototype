# 👁️ Face Recognition System

Real-time face detection and recognition system for school attendance and human detection.
Works with single persons or crowded scenes.

---

## ⚡ Quick Setup (3 steps)

### Step 1 — Install dependencies
```bash
npm install
```

### Step 2 — Download AI models
```bash
node download-models.js
```
This downloads the face-api.js model weights (~10 MB) into the `models/` folder.
Only needs to be done **once**.

### Step 3 — Start the server
```bash
npm start
```
Then open your browser at: **http://localhost:3000**

---

## 📋 Pages

| Page | URL | Purpose |
|------|-----|---------|
| Dashboard | `/` | Overview: stats, registered persons, today's activity |
| Register | `/register.html` | Add a new person using live camera |
| Recognize | `/recognize.html` | Start real-time face detection & recognition |
| Attendance | `/attendance.html` | View logs, filter by date, export CSV |

---

## 📧 Email Notifications (Optional)

1. Copy `.env.example` to `.env`
2. Fill in your Gmail credentials
3. Generate a Gmail App Password at: https://myaccount.google.com/apppasswords

```env
EMAIL_USER=your-email@gmail.com
EMAIL_PASS=your-app-password
NOTIFY_EMAIL=admin@school.com
```

---

## 🧠 How It Works

1. **Register**: Captures 10 face frames from the camera, computes a 128-dimensional face descriptor (using face-api.js), and stores it on the server.
2. **Recognize**: Every video frame, all faces are detected and their descriptors computed. Each face is matched against registered descriptors using Euclidean distance.
   - Distance < threshold → **Recognized** (default threshold: 0.5)
   - Distance ≥ threshold → **Unknown**
3. **Attendance**: On first recognition each day, a log entry is created automatically.

### Crowd Support
The system detects **all faces in frame simultaneously** — each face gets its own bounding box and name label. Works for classrooms, corridors, or any crowded setting.

---

## 🗂️ Project Structure

```
├── server.js            # Express backend (API + static server)
├── download-models.js   # One-time model downloader
├── package.json
├── .env.example         # Email config template
├── data/
│   ├── faces.json       # Stored face descriptors
│   └── attendance.json  # Attendance log
├── models/              # face-api.js model weights (auto-downloaded)
└── public/
    ├── index.html       # Dashboard
    ├── register.html    # Face registration
    ├── recognize.html   # Live recognition
    ├── attendance.html  # Attendance records
    ├── css/style.css
    └── js/
        ├── register.js
        └── recognize.js
```

---

## 🔧 Requirements

- Node.js 16+
- A webcam
- Google Chrome or Firefox (for camera access)
