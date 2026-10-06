const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const path = require('path');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Storage configuration for Images, Videos, and Audio Voice Notes
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

// Database initialization
const db = new sqlite3.Database('./database.db', (err) => {
  if (!err) console.log('Connected to SQLite database.');
});

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
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// File upload endpoint for Chat & Status Media
app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const fileUrl = `/uploads/${req.file.filename}`;
  const fileType = req.file.mimetype;
  res.json({ fileUrl, fileType });
});

// Realtime Communications
io.on('connection', (socket) => {
  
  socket.on('join_room', (roomId) => {
    socket.join(roomId);
    db.all('SELECT * FROM messages WHERE roomId = ? ORDER BY id ASC', [roomId], (err, rows) => {
      if (!err) socket.emit('load_messages', rows);
    });
  });

  socket.on('send_message', (data) => {
    const { roomId, sender, phone, message, fileUrl, fileType, replyTo } = data;
    db.run(
      `INSERT INTO messages (roomId, sender, phone, message, fileUrl, fileType, replyTo) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [roomId, sender, phone, message, fileUrl || null, fileType || null, replyTo || null],
      function (err) {
        if (!err) {
          const newMessage = { id: this.lastID, roomId, sender, phone, message, fileUrl, fileType, replyTo, timestamp: new Date() };
          io.to(roomId).emit('receive_message', newMessage);
        }
      }
    );
  });

  socket.on('edit_message', (data) => {
    const { id, roomId, newMessage } = data;
    db.run('UPDATE messages SET message = ? WHERE id = ?', [newMessage, id], (err) => {
      if (!err) io.to(roomId).emit('message_edited', { id, newMessage });
    });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
      
