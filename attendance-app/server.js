require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./database');
const { sendAttendanceAlert, checkSessionStatus } = require('./whatsapp');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve frontend assets
app.use(express.static(path.join(__dirname, 'public')));

// ================= API ENDPOINTS ================= //

/**
 * 1. Register a new student with face descriptor
 */
app.post('/api/students/register', (req, res) => {
  const { name, roll_no, batch, parent_name, parent_phone, face_descriptor, photo_url } = req.body;

  if (!name || !roll_no || !parent_phone || !face_descriptor) {
    return res.status(400).json({ 
      error: 'Missing required fields: name, roll_no, parent_phone, face_descriptor' 
    });
  }

  // Ensure face_descriptor is stringified array
  const descriptorStr = typeof face_descriptor === 'string' 
    ? face_descriptor 
    : JSON.stringify(face_descriptor);

  const query = `
    INSERT INTO students (name, roll_no, batch, parent_name, parent_phone, face_descriptor, photo_url)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `;

  db.run(query, [name.trim(), roll_no.trim(), batch, parent_name, parent_phone.trim(), descriptorStr, photo_url], function(err) {
    if (err) {
      if (err.message.includes('UNIQUE constraint failed')) {
        return res.status(400).json({ error: 'A student with this Roll No already exists!' });
      }
      return res.status(500).json({ error: err.message });
    }
    res.json({
      success: true,
      message: 'Student registered successfully',
      student_id: this.lastID
    });
  });
});

/**
 * 2. Get all students face descriptors for matching
 */
app.get('/api/students/descriptors', (req, res) => {
  db.all('SELECT id, name, roll_no, batch, parent_phone, face_descriptor FROM students', [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    const students = rows.map(r => ({
      ...r,
      face_descriptor: JSON.parse(r.face_descriptor)
    }));
    res.json(students);
  });
});

/**
 * 3. Check student status (Entered vs Left)
 */
app.post('/api/attendance/check-status', (req, res) => {
  const { student_id } = req.body;
  if (!student_id) return res.status(400).json({ error: 'student_id required' });

  // Get last action for this student today
  const query = `
    SELECT * FROM attendance_logs 
    WHERE student_id = ? 
    ORDER BY id DESC LIMIT 1
  `;

  db.get(query, [student_id], (err, lastLog) => {
    if (err) return res.status(500).json({ error: err.message });

    db.get('SELECT * FROM students WHERE id = ?', [student_id], (sErr, student) => {
      if (sErr || !student) return res.status(404).json({ error: 'Student not found' });

      // If no log or last log was EXIT, next action is ENTRY
      // If last log was ENTRY, student is currently inside, so next action is LEAVE (requires confirmation)
      const isInside = lastLog && (lastLog.type === 'ENTRY' || !lastLog.type);

      res.json({
        student: {
          id: student.id,
          name: student.name,
          roll_no: student.roll_no,
          batch: student.batch,
          parent_phone: student.parent_phone
        },
        isInside: !!isInside,
        lastLog: lastLog || null
      });
    });
  });
});

/**
 * 4. Mark attendance (ENTRY or EXIT) upon confirmation
 */
app.post('/api/attendance/mark', async (req, res) => {
  const { student_id, action_type } = req.body;

  if (!student_id) {
    return res.status(400).json({ error: 'student_id is required' });
  }

  // Fetch student info
  db.get('SELECT * FROM students WHERE id = ?', [student_id], async (err, student) => {
    if (err || !student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    // Determine type: 'ENTRY' or 'EXIT'
    const type = action_type === 'EXIT' ? 'EXIT' : 'ENTRY';

    // Anti-duplicate cooldown: prevent sending multiple messages for the exact same action within 5 minutes
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
              parent_phone: student.parent_phone
            }
          });
        }
      }

      const now = new Date();
      const timeFormatted = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });

      // Trigger WhatsApp Alert in the background
      sendAttendanceAlert(student.name, student.roll_no, student.parent_phone, timeFormatted, type)
        .then(waResult => {
          const status = waResult.success ? (waResult.simulated ? 'SIMULATED' : 'SENT') : 'FAILED';
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
          parent_phone: student.parent_phone
        },
        time: timeFormatted
      });
    });
  });
});

/**
 * 5. Get recent attendance logs
 */
app.get('/api/attendance/logs', (req, res) => {
  const query = `
    SELECT id, student_name, roll_no, timestamp, parent_phone, whatsapp_status, type 
    FROM attendance_logs 
    ORDER BY id DESC 
    LIMIT 50
  `;
  db.all(query, [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

/**
 * 5. Check WhatsApp Service Status
 */
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

/**
 * 6. Get QR Code for WhatsApp linking
 */
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

  // Start UDP Discovery Beacon on Local Wi-Fi
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
