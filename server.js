const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const path = require('path');
const cors = require('cors');
const fs = require('fs');

// Auto-create uploads folder on startup
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

// Serve static files from both public folder and root folder
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Serve index.html explicitly at root URL
app.get('/', (req, res) => {
  if (fs.existsSync(path.join(__dirname, 'public', 'index.html'))) {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  } else if (fs.existsSync(path.join(__dirname, 'index.html'))) {
    res.sendFile(path.join(__dirname, 'index.html'));
  } else {
    res.send("<h1>Wavethread Server is Live!</h1><p>Please ensure index.html is uploaded in your project root or public directory.</p>");
  }
});

// Storage Setup
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
  res.json({ fileUrl: `/uploads/${req.file.filename}`, fileType: req.file.mimetype });
});

// Status System Endpoints
app.post('/api/status', upload.single('file'), (req, res) => {
  const { phone, userName } = req.body;
  if (!req.file || !phone || !userName) return res.status(400).json({ error: 'Missing parameters or file' });

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

// Socket.io Realtime Logic
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

// Server Listener
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
io.on('connection', (socket) => {
  // YOUR EXISTING SOCKET EVENTS ARE HERE...
  // (like socket.on('join', ...), etc.)

  // --- PASTE THE NEW CODE RIGHT HERE ---
  
  // 1. User joins their personal phone room for incoming alerts
  socket.on('join_user_room', (phoneNumber) => {
    if (phoneNumber) {
      socket.io?.sockets?.adapter?.rooms; // or just socket.join
      socket.join(phoneNumber);
    }
  });

  // 2. Real-time message relay + recipient notification push
  socket.on('send_chat_message', async (data) => {
    try {
      const { chatId, sender, text, recipients } = data;
      
      // Emit the message to everyone currently viewing this chat room
      io.to(chatId).emit('receive_chat_message', {
        chatId,
        sender,
        text,
        timestamp: new Date()
      });

      // Send a direct notification to other participants
      if (Array.isArray(recipients)) {
        recipients.forEach((phone) => {
          if (phone !== sender) {
            io.to(phone).emit('new_message_notification', {
              sender,
              text,
              chatId,
              alert: `New message from ${sender}`
            });
          }
        });
      }
    } catch (err) {
      console.error("Socket message error:", err);
    }
  });
  // -------------------------------------
});
  // --- 1. DIRECT NUMBER PING & NOTIFICATION ---
  socket.on('register_user_phone', (phoneNumber) => {
    if (phoneNumber) {
      socket.join(phoneNumber); // Puts the user in their own phone number room
    }
  });

  socket.on('send_direct_ping', (data) => {
    const { targetPhone, senderName, message } = data;
    // Send a direct popup notification to that specific phone number
    io.to(targetPhone).emit('receive_direct_notification', {
      sender: senderName,
      text: message || "Someone is talking to you on Wavethread Messenger!",
      timestamp: new Date()
    });
  });


  // --- 2. GLOBAL LIVE ROOM (Everyone on the website sees & talks together) ---
  socket.on('join_global_room', () => {
    socket.join('wavethread_global_lobby');
  });

  socket.on('send_global_message', (data) => {
    // Broadcasts the message to EVERYONE currently on the website instantly
    io.to('wavethread_global_lobby').emit('receive_global_message', {
      sender: data.sender,
      text: data.text,
      timestamp: new Date()
    });
  });


  // --- 3. GROUP CHAT & DM NOTIFICATIONS ---
  socket.on('join_group_room', (groupId) => {
    socket.join(groupId);
  });

  socket.on('send_group_message', (data) => {
    const { groupId, sender, text, memberPhones } = data;
    
    // Send message to everyone currently inside the group chat
    io.to(groupId).emit('receive_group_message', {
      sender,
      text,
      timestamp: new Date()
    });

    // Also send background DM notifications to members who aren't currently inside the group
    if (Array.isArray(memberPhones)) {
      memberPhones.forEach((phone) => {
        if (phone !== sender) {
          io.to(phone).emit('receive_direct_notification', {
            sender: `Group (${sender})`,
            text: text,
            timestamp: new Date()
          });
        }
      });
    }
  });
            
