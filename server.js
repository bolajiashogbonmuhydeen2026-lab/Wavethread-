cat << 'EOF' > server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const path = require('path');
const cors = require('cors');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e8 }); // 100MB media support

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Prevent browser caching issues
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  next();
});

app.use(express.static(__dirname));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');

// SQLite Database Setup
const db = new sqlite3.Database('./wavethread_pro.db');

db.serialize(() => {
  // Users Table
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT UNIQUE,
    username TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Messages Table
  db.run(`CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender_phone TEXT,
    sender_name TEXT,
    text TEXT,
    file_url TEXT,
    file_type TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Statuses / Stories Table
  db.run(`CREATE TABLE IF NOT EXISTS statuses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_phone TEXT,
    user_name TEXT,
    media_url TEXT,
    media_type TEXT,
    caption TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
});

// Storage Config
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname.replace(/\s+/g, '_'))
});
const upload = multer({ storage });

// Phone Auth API
app.post('/api/auth/phone', (req, res) => {
  const { phone, username } = req.body;
  if (!phone || !username) {
    return res.status(400).json({ success: false, error: 'Phone number and name are required.' });
  }

  const cleanPhone = phone.trim();
  const cleanName = username.trim();

  db.get('SELECT * FROM users WHERE phone = ?', [cleanPhone], (err, row) => {
    if (err) return res.status(500).json({ success: false, error: err.message });
    if (row) {
      db.run('UPDATE users SET username = ? WHERE phone = ?', [cleanName, cleanPhone], (uErr) => {
        if (uErr) return res.status(500).json({ success: false, error: uErr.message });
        res.json({ success: true, user: { phone: cleanPhone, username: cleanName } });
      });
    } else {
      db.run('INSERT INTO users (phone, username) VALUES (?, ?)', [cleanPhone, cleanName], function(iErr) {
        if (iErr) return res.status(500).json({ success: false, error: iErr.message });
        res.json({ success: true, user: { phone: cleanPhone, username: cleanName } });
      });
    }
  });
});

// Messages API
app.get('/api/messages', (req, res) => {
  db.all('SELECT * FROM messages ORDER BY id ASC', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Chat Media Upload API
app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const fileUrl = `/uploads/${req.file.filename}`;
  
  let fileType = 'file';
  if (req.file.mimetype.startsWith('image/')) fileType = 'image';
  else if (req.file.mimetype.startsWith('video/')) fileType = 'video';
  else if (req.file.mimetype.startsWith('audio/')) fileType = 'audio';

  res.json({ fileUrl, fileType });
});

// Status Story Upload API
app.post('/api/status/upload', upload.single('media'), (req, res) => {
  const { phone, username, caption } = req.body;
  if (!req.file || !phone) {
    return res.status(400).json({ success: false, error: 'Media and phone required.' });
  }

  const mediaUrl = `/uploads/${req.file.filename}`;
  let mediaType = 'image';
  if (req.file.mimetype.startsWith('video/')) mediaType = 'video';

  db.run(
    `INSERT INTO statuses (user_phone, user_name, media_url, media_type, caption) VALUES (?, ?, ?, ?, ?)`,
    [phone, username, mediaUrl, mediaType, caption || ''],
    function(err) {
      if (err) return res.status(500).json({ success: false, error: err.message });
      const newStatus = {
        id: this.lastID,
        user_phone: phone,
        user_name: username,
        media_url: mediaUrl,
        media_type: mediaType,
        caption: caption || '',
        timestamp: new Date().toISOString()
      };
      io.emit('newStatus', newStatus);
      res.json({ success: true, status: newStatus });
    }
  );
});

// Fetch Statuses API
app.get('/api/statuses', (req, res) => {
  db.all('SELECT * FROM statuses ORDER BY id DESC', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Socket.io Sockets
io.on('connection', (socket) => {
  socket.on('sendMessage', (data) => {
    const { phone, sender, text, fileUrl, fileType } = data;
    db.run(
      `INSERT INTO messages (sender_phone, sender_name, text, file_url, file_type) VALUES (?, ?, ?, ?, ?)`,
      [phone, sender, text || '', fileUrl || '', fileType || ''],
      function (err) {
        if (!err) {
          io.emit('receiveMessage', {
            id: this.lastID,
            sender_phone: phone,
            sender_name: sender,
            text,
            file_url: fileUrl,
            file_type: fileType,
            timestamp: new Date().toISOString()
          });
        }
      }
    );
  });

  socket.on('typing', (user) => socket.broadcast.emit('userTyping', user));
  socket.on('stopTyping', () => socket.broadcast.emit('userStopTyping'));
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`WaveThread WhatsApp Pro engine live on http://localhost:${PORT}`);
});
EOF
