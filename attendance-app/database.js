const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'attendance.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening SQLite database:', err.message);
  } else {
    console.log('Connected to SQLite database at', dbPath);
  }
});

// Initialize tables and migrations
db.serialize(() => {
  // Students table
  db.run(`
    CREATE TABLE IF NOT EXISTS students (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      roll_no TEXT UNIQUE NOT NULL,
      batch TEXT,
      parent_name TEXT,
      parent_phone TEXT NOT NULL,
      face_descriptor TEXT NOT NULL,
      photo_url TEXT,
      father_name TEXT,
      mother_name TEXT,
      secondary_phone TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Ensure newly added columns exist in case table was created earlier
  const columnsToAdd = [
    { name: 'father_name', type: 'TEXT' },
    { name: 'mother_name', type: 'TEXT' },
    { name: 'secondary_phone', type: 'TEXT' }
  ];

  columnsToAdd.forEach(col => {
    db.run(`ALTER TABLE students ADD COLUMN ${col.name} ${col.type}`, (err) => {
      // Ignore error if column already exists
    });
  });

  // Batches table
  db.run(`
    CREATE TABLE IF NOT EXISTS batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Insert default batch "Basic Computer" if empty
  db.get(`SELECT count(*) as count FROM batches`, [], (err, row) => {
    if (!err && (!row || row.count === 0)) {
      db.run(`INSERT OR IGNORE INTO batches (name) VALUES (?)`, ['Basic Computer']);
    }
  });

  // Attendance log table
  db.run(`
    CREATE TABLE IF NOT EXISTS attendance_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL,
      student_name TEXT NOT NULL,
      roll_no TEXT NOT NULL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      parent_phone TEXT NOT NULL,
      whatsapp_status TEXT DEFAULT 'PENDING',
      whatsapp_response TEXT,
      type TEXT DEFAULT 'ENTRY',
      FOREIGN KEY(student_id) REFERENCES students(id)
    )
  `);
});

module.exports = db;
