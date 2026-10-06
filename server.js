const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const path = require('path');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static assets from the root and uploads directory
app.use(express.static(__dirname));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Storage configuration for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});
const upload = multer({ storage });

// Database setup
const db = new sqlite3.Database('./database.db', (err) => {
  if (err) {
    console.error('Database connection error:', err.message);
  } else {
    console.log('Connected to SQLite database.');
  }
});

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender TEXT,
      message TEXT,
      fileUrl TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
});

// Serve index.html directly from root folder
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  const fileUrl = `/uploads/${req.file.filename}`;
  res.json({ fileUrl });
});

// Socket.io Real-time Communication
io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  // Send historical messages on connection
  db.all('SELECT * FROM messages ORDER BY id ASC', [], (err, rows) => {
    if (!err) {
      socket.emit('load_messages', rows);
    }
  });

  socket.on('send_message', (data) => {
    const { sender, message, fileUrl } = data;
    db.run(
      'INSERT INTO messages (sender, message, fileUrl) VALUES (?, ?, ?)',
      [sender, message, fileUrl || null],
      function (err) {
        if (!err) {
          const newMessage = {
            id: this.lastID,
            sender,
            message,
            fileUrl,
            timestamp: new Date()
          };
          io.emit('receive_message', newMessage);
        }
      }
    );
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
      
