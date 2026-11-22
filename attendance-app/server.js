require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./database');
const { sendAttendanceAlert, sendWelcomeRegistrationAlert, checkSessionStatus } = require('./whatsapp');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve frontend assets
app.use(express.static(path.join(__dirname, 'public')));

// Temporary in-memory phone capture requests: { [requestId]: { student_name, device_id, status: 'PENDING'|'COMPLETED', face_descriptor: null } }
const remoteCaptureRequests = {};

// Active online phones { [deviceId]: { name, lastSeen: timestamp } }
const connectedPhones = {};

/**
 * 0. Phone Heartbeat / Registration
 */
app.post('/api/devices/heartbeat', (req, res) => {
  const { device_id, device_name } = req.body;
  if (!device_id) return res.status(400).json({ error: 'device_id required' });
  connectedPhones[device_id] = {
    id: device_id,
    name: device_name || 'Staff Phone',
    lastSeen: Date.now()
  };
  res.json({ success: true, count: Object.keys(connectedPhones).length });
});

/**
 * List online devices for photo capture selection
 */
app.get('/api/devices/list', (req, res) => {
  const now = Date.now();
  // Filter devices seen in the last 60 seconds
  const list = Object.values(connectedPhones).filter(d => now - d.lastSeen < 60000);
  res.json(list);
});

/**
 * Create Remote Capture Request (Triggered by Web when choosing a staff phone)
 */
app.post('/api/remote-capture/create', (req, res) => {
  const { device_id, student_name } = req.body;
  if (!device_id || !student_name) return res.status(400).json({ error: 'device_id and student_name required' });

  const requestId = 'CAP_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
  remoteCaptureRequests[requestId] = {
    requestId,
    device_id,
    student_name,
    status: 'PENDING',
    face_descriptor: null,
    createdAt: Date.now()
  };

  res.json({ success: true, requestId });
});

/**
 * Poll for Remote Capture Task (Phone polls this)
 */
app.get('/api/remote-capture/pending/:deviceId', (req, res) => {
  const { deviceId } = req.params;
  const pending = Object.values(remoteCaptureRequests).find(r => r.device_id === deviceId && r.status === 'PENDING');
  res.json(pending || null);
});

/**
 * Submit Remote Capture Face Descriptor (Phone sends this)
 */
app.post('/api/remote-capture/submit', (req, res) => {
  const { requestId, face_descriptor } = req.body;
  if (!requestId || !face_descriptor) return res.status(400).json({ error: 'requestId and face_descriptor required' });

  if (remoteCaptureRequests[requestId]) {
    remoteCaptureRequests[requestId].face_descriptor = face_descriptor;
    remoteCaptureRequests[requestId].status = 'COMPLETED';
    return res.json({ success: true });
  }
  res.status(404).json({ error: 'Request not found' });
});

/**
 * Check Remote Capture Status (Web polls this)
 */
app.get('/api/remote-capture/status/:requestId', (req, res) => {
  const { requestId } = req.params;
  const task = remoteCaptureRequests[requestId];
  if (!task) return res.status(404).json({ error: 'Request not found' });
  res.json(task);
});

/**
 * ================= BATCHES MANAGEMENT API =================
 */
app.get('/api/batches/list', (req, res) => {
  db.all('SELECT * FROM batches ORDER BY id ASC', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/batches/add', (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Batch name is required' });
  }
  db.run('INSERT INTO batches (name) VALUES (?)', [name.trim()], function(err) {
    if (err) {
      if (err.message.includes('UNIQUE')) {
        return res.status(400).json({ error: 'Batch already exists' });
      }
      return res.status(500).json({ error: err.message });
    }
    res.json({ success: true, id: this.lastID, name: name.trim() });
  });
});

app.delete('/api/batches/:id', (req, res) => {
  const { id } = req.params;
  db.run('DELETE FROM batches WHERE id = ?', [id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true, deleted: this.changes });
  });
});

/**
 * ================= STUDENTS MANAGEMENT API =================
 */

// Delete Student
app.delete('/api/students/:id', (req, res) => {
  const { id } = req.params;
  db.run('DELETE FROM students WHERE id = ?', [id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true, deleted: this.changes });
  });
});

// Update Student (Admin Mode Edit)
app.put('/api/students/:id', (req, res) => {
  const { id } = req.params;
  const { name, batch, father_name, mother_name, parent_phone, secondary_phone } = req.body;

  if (!name || !parent_phone) {
    return res.status(400).json({ error: 'Name and Parent Phone are required' });
  }

  const query = `
    UPDATE students
    SET name = ?, batch = ?, father_name = ?, mother_name = ?, parent_phone = ?, secondary_phone = ?
    WHERE id = ?
  `;

  db.run(query, [
    name.trim(),
    batch || 'Basic Computer',
    father_name ? father_name.trim() : null,
    mother_name ? mother_name.trim() : null,
    parent_phone.trim(),
    secondary_phone ? secondary_phone.trim() : null,
    id
  ], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true, updated: this.changes });
  });
});

// Descriptors for facial recognition
app.get('/api/students/descriptors', (req, res) => {
  const query = `
    SELECT id, name, roll_no, batch, parent_phone, secondary_phone, face_descriptor 
    FROM students
  `;
  db.all(query, [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    const formatted = rows.map(r => ({
      ...r,
      face_descriptor: JSON.parse(r.face_descriptor)
    }));
    res.json(formatted);
  });
});

// Full Student List for Admin Mode & Export
app.get('/api/students/list', (req, res) => {
  const query = `
    SELECT id, name, roll_no, batch, father_name, mother_name, parent_phone, secondary_phone, created_at 
    FROM students 
    ORDER BY id DESC
  `;
  db.all(query, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Register New Student
app.post('/api/students/register', (req, res) => {
  const { name, roll_no, batch, father_name, mother_name, parent_phone, secondary_phone, face_descriptor, photo_url } = req.body;

  if (!name || !roll_no || !parent_phone || !face_descriptor) {
    return res.status(400).json({ 
      error: 'Missing required fields: name, roll_no, parent_phone, face_descriptor' 
    });
  }

  const descriptorStr = typeof face_descriptor === 'string' 
    ? face_descriptor 
    : JSON.stringify(face_descriptor);

  const query = `
    INSERT INTO students (name, roll_no, batch, father_name, mother_name, parent_phone, secondary_phone, face_descriptor, photo_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  db.run(query, [
    name.trim(), 
    roll_no.trim(), 
    batch || 'Basic Computer', 
    father_name ? father_name.trim() : null, 
    mother_name ? mother_name.trim() : null, 
    parent_phone.trim(), 
    secondary_phone ? secondary_phone.trim() : null, 
    descriptorStr, 
    photo_url
  ], function(err) {
    if (err) {
      if (err.message.includes('UNIQUE constraint failed')) {
        return res.status(400).json({ error: 'A student with this Roll No already exists!' });
      }
      return res.status(500).json({ error: err.message });
    }

    // Send Welcome WhatsApp Message to primary (+ secondary if available) in background
    sendWelcomeRegistrationAlert(name.trim(), parent_phone.trim(), secondary_phone ? secondary_phone.trim() : null)
      .catch(wErr => console.error('Error sending welcome WhatsApp:', wErr));

    res.json({
      success: true,
      message: 'Student registered successfully',
      student_id: this.lastID
    });
  });
});

/**
 * ================= ATTENDANCE VERIFICATION & CHECKIN =================
 */

// Check student status: are they currently inside?
app.post('/api/attendance/check-status', (req, res) => {
  const { student_id } = req.body;
  if (!student_id) return res.status(400).json({ error: 'student_id required' });

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const startOfDayStr = startOfDay.toISOString().replace('T', ' ').substring(0, 19);

  const query = `
    SELECT type, timestamp FROM attendance_logs 
    WHERE student_id = ? AND timestamp >= ?
    ORDER BY id DESC LIMIT 1
  `;

  db.get(query, [student_id, startOfDayStr], (err, lastLog) => {
    if (err) return res.status(500).json({ error: err.message });
    const isInside = (lastLog && lastLog.type === 'ENTRY');
    res.json({
      isInside,
      lastAction: lastLog ? lastLog.type : null,
      lastTimestamp: lastLog ? lastLog.timestamp : null
    });
  });
});

// Mark Attendance (ENTRY or EXIT)
app.post('/api/attendance/mark', (req, res) => {
  const { student_id, action_type } = req.body;

  if (!student_id) {
    return res.status(400).json({ error: 'Missing student_id' });
  }

  db.get('SELECT * FROM students WHERE id = ?', [student_id], async (err, student) => {
    if (err || !student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    const type = action_type === 'EXIT' ? 'EXIT' : 'ENTRY';

    // Anti-duplicate cooldown: prevent duplicate alerts for same action within 5 mins
    const cooldownQuery = `
      SELECT timestamp, type FROM attendance_logs 
      WHERE student_id = ? AND type = ?
      ORDER BY id DESC LIMIT 1
    `;

    db.get(cooldownQuery, [student_id, type], async (cdErr, lastLog) => {
      if (lastLog) {
        const lastTime = new Date(lastLog.timestamp).getTime();
        const now = new Date().getTime();
        const diffMinutes = (now - lastTime) / (1000 * 60);

        if (diffMinutes < 5) {
          return res.json({
            success: true,
            cooldown: true,
            type,
            message: `${student.name} already marked ${type} ${Math.round(diffMinutes)} mins ago.`,
            student: {
              id: student.id,
              name: student.name,
              roll_no: student.roll_no,
              batch: student.batch,
              parent_phone: student.parent_phone,
              secondary_phone: student.secondary_phone
            }
          });
        }
      }

      const now = new Date();
      const timeFormatted = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });

      // Trigger WhatsApp Alert to primary (+ secondary if available) in background
      sendAttendanceAlert(student.name, student.roll_no, student.parent_phone, timeFormatted, type, student.secondary_phone)
        .then(waResult => {
          const status = waResult.success ? (process.env.SIMULATE_WHATSAPP === 'true' ? 'SIMULATED' : 'SENT') : 'FAILED';
          const responseStr = JSON.stringify(waResult);

          db.run(
            `INSERT INTO attendance_logs (student_id, student_name, roll_no, parent_phone, whatsapp_status, whatsapp_response, type)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [student.id, student.name, student.roll_no, student.parent_phone, status, responseStr, type]
          );
        })
        .catch(err => {
          console.error(`Error logging attendance WhatsApp [${type}]:`, err);
        });

      return res.json({
        success: true,
        cooldown: false,
        type,
        message: type === 'ENTRY' 
          ? `${student.name} entered the institute. Notification dispatched.` 
          : `${student.name} left the institute. Notification dispatched.`,
        student: {
          id: student.id,
          name: student.name,
          roll_no: student.roll_no,
          batch: student.batch,
          parent_phone: student.parent_phone,
          secondary_phone: student.secondary_phone
        },
        time: timeFormatted
      });
    });
  });
});

// Recent attendance logs
app.get('/api/attendance/logs', (req, res) => {
  const query = `
    SELECT id, student_name, roll_no, timestamp, parent_phone, whatsapp_status, type 
    FROM attendance_logs 
    ORDER BY id DESC 
    LIMIT 50
  `;
  db.all(query, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Check WhatsApp Service Status
app.get('/api/whatsapp/status', async (req, res) => {
  const status = await checkSessionStatus();
  res.json({
    config: {
      openwa_url: process.env.OPENWA_BASE_URL,
      session: process.env.OPENWA_SESSION,
      simulate: process.env.SIMULATE_WHATSAPP === 'true'
    },
    service: status
  });
});

// Get QR Code for WhatsApp linking
app.get('/api/whatsapp/qr', async (req, res) => {
  try {
    const axios = require('axios');
    const sessionId = process.env.OPENWA_SESSION;
    const apiKey = process.env.OPENWA_API_KEY;
    const qrRes = await axios.get(`${process.env.OPENWA_BASE_URL}/api/sessions/${sessionId}/qr`, {
      headers: { 'X-Api-Key': apiKey },
      timeout: 5000
    });
    res.json(qrRes.data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`=================================================`);
  console.log(`🚀 Attendance System running on: http://localhost:${PORT}`);
  console.log(`📱 Access on Mobile via Local Wi-Fi: http://<YOUR_PC_IP>:${PORT}`);
  console.log(`=================================================`);

  startUdpDiscoveryBeacon();
});

// ================= ZERO-CONFIG UDP LOCAL DISCOVERY ================= //
function startUdpDiscoveryBeacon() {
  const dgram = require('dgram');
  const server = dgram.createSocket('udp4');
  const DISCOVERY_PORT = 41234;

  server.on('error', (err) => {
    console.error(`[UDP Discovery Error]:\n${err.stack}`);
    server.close();
  });

  server.on('message', (msg, rinfo) => {
    const text = msg.toString().trim();
    if (text === 'DISCOVER_APEX_ATTENDANCE_SERVER') {
      const response = JSON.stringify({
        service: 'DOT_CMC_ATTENDANCE',
        port: PORT
      });
      server.send(response, rinfo.port, rinfo.address, (err) => {
        if (!err) {
          console.log(`[Zero-Config Auto-Discovery] Dispatched server IP to phone at ${rinfo.address}:${rinfo.port}`);
        }
      });
    }
  });

  server.bind(DISCOVERY_PORT, '0.0.0.0', () => {
    server.setBroadcast(true);
    console.log(`📡 Zero-Config Auto-Discovery Beacon active on UDP port ${DISCOVERY_PORT}`);
  });
}
