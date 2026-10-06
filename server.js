const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const path = require('path');
const cors = require('cors');
const fs = require('fs');

// Ensure uploads folder exists automatically on boot
if (!fs.existsSync('./uploads')) {
  fs.mkdirSync('./uploads', { recursive: true });
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Multer Storage Configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

// Database Initialization
const db = new sqlite3.Database('./database.sqlite');

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      roomId TEXT,
      sender TEXT,
      phone TEXT,
      message TEXT,
      fileUrl TEXT,
      fileType TEXT,
      replyTo TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS statuses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userName TEXT,
      phone TEXT,
      fileUrl TEXT,
      fileType TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS status_views (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      statusId INTEGER,
      viewerPhone TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(statusId, viewerPhone)
    )
  `);
});

// File Upload Endpoint
app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const fileUrl = `/uploads/${req.file.filename}`;
  res.json({ fileUrl, fileType: req.file.mimetype });
});

// Status Endpoints
app.post('/api/status', upload.single('file'), (req, res) => {
  const { phone, userName } = req.body;
  if (!req.file || !phone || !userName) {
    return res.status(400).json({ error: 'Missing parameters or file' });
  }

  const fileUrl = `/uploads/${req.file.filename}`;
  const fileType = req.file.mimetype;

  db.run(
    `INSERT INTO statuses (userName, phone, fileUrl, fileType) VALUES (?, ?, ?, ?)`,
    [userName, phone, fileUrl, fileType],
    function (err) {
      if (err) return res.status(500).json({ error: 'Database error' });
      const newStatus = { id: this.lastID, userName, phone, fileUrl, fileType, timestamp: new Date() };
      io.emit('new_status', newStatus);
      res.json(newStatus);
    }
  );
});

app.get('/api/statuses', (req, res) => {
  db.all(`SELECT * FROM statuses ORDER BY timestamp DESC`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    res.json(rows);
  });
});

app.post('/api/status/view', (req, res) => {
  const { statusId, viewerPhone } = req.body;
  if (!statusId || !viewerPhone) return res.status(400).json({ error: 'Missing parameters' });

  db.run(
    `INSERT OR IGNORE INTO status_views (statusId, viewerPhone) VALUES (?, ?)`,
    [statusId, viewerPhone],
    function (err) {
      if (err) return res.status(500).json({ error: 'Database error' });
      db.get(`SELECT COUNT(*) as viewCount FROM status_views WHERE statusId = ?`, [statusId], (err, row) => {
        const count = row ? row.viewCount : 0;
        io.emit('status_view_updated', { statusId, viewCount: count });
        res.json({ statusId, viewCount: count });
      });
    }
  );
});

app.get('/api/status/:id/views', (req, res) => {
  db.get(`SELECT COUNT(*) as viewCount FROM status_views WHERE statusId = ?`, [req.params.id], (err, row) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    res.json({ viewCount: row ? row.viewCount : 0 });
  });
});

// Socket.io Messaging logic
io.on('connection', (socket) => {
  socket.on('join_room', (roomId) => {
    socket.join(roomId);
    db.all(`SELECT * FROM messages WHERE roomId = ? ORDER BY timestamp ASC`, [roomId], (err, rows) => {
      if (!err) socket.emit('load_messages', rows);
    });
  });

  socket.on('send_message', (data) => {
    const { roomId, sender, phone, message, fileUrl, fileType, replyTo } = data;
    db.run(
      `INSERT INTO messages (roomId, sender, phone, message, fileUrl, fileType, replyTo) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [roomId, sender, phone, message, fileUrl, fileType, replyTo],
      function (err) {
        if (!err) {
          const fullMessage = { id: this.lastID, ...data, timestamp: new Date() };
          io.to(roomId).emit('receive_message', fullMessage);
        }
      }
    );
  });

  socket.on('edit_message', (data) => {
    const { id, roomId, newMessage } = data;
    db.run(`UPDATE messages SET message = ? WHERE id = ?`, [newMessage, id], (err) => {
      if (!err) io.to(roomId).emit('message_edited', { id, newMessage });
    });
  });
});

// Dynamic Port Assignment for Deployment
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
  
