const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { 
  cors: { origin: "*" } 
});

app.use(express.json());

// --- RESTORES YOUR FRONTEND UI ---
// This serves your HTML, CSS, and client-side files so your website looks normal again.
app.use(express.static(path.join(__dirname)));
// Note: If your HTML/JS files are inside a folder named 'public', change the line above to: app.use(express.static('public'));

io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  // --- 1. REGISTER USER PHONE (For Direct DM Notifications) ---
  socket.on('register_user', (phoneNumber) => {
    if (phoneNumber) {
      socket.join(phoneNumber); // Locks into a room matching their specific phone number
    }
  });


  // --- 2. GLOBAL LIVE ROOM (Anyone who enters the website sees and talks together) ---
  socket.on('join_global_room', () => {
    socket.join('wavethread_global_lobby');
  });

  socket.on('send_global_message', (data) => {
    io.to('wavethread_global_lobby').emit('receive_global_message', {
      sender: data.sender,
      text: data.text,
      timestamp: new Date()
    });
  });


  // --- 3. PRIVATE GROUP CHATS (Only added members can see/participate) ---
  socket.on('join_group_room', (groupId) => {
    socket.join(groupId);
  });

  socket.on('send_group_message', (data) => {
    const { groupId, sender, text, memberPhones } = data;
    
    // Broadcast message to everyone inside the private group room
    io.to(groupId).emit('receive_group_message', {
      sender,
      text,
      timestamp: new Date()
    });

    // Send background notifications to group members' personal phone numbers
    if (Array.isArray(memberPhones)) {
      memberPhones.forEach((phone) => {
        if (phone !== sender) {
          io.to(phone).emit('receive_notification', {
            type: 'group',
            sender: sender,
            text: text,
            message: `New message in group from ${sender}`,
            timestamp: new Date()
          });
        }
      });
    }
  });


  // --- 4. DIRECT MESSAGING (DM) & PING NOTIFICATIONS ---
  socket.on('send_direct_message', (data) => {
    const { targetPhone, senderPhone, text } = data;
    
    // Send message to the target user's personal chat room if they are online
    io.to(targetPhone).emit('receive_direct_message', {
      sender: senderPhone,
      text: text,
      timestamp: new Date()
    });

    // Send a direct notification alert to their phone number so they know someone messaged them
    io.to(targetPhone).emit('receive_notification', {
      type: 'dm',
      sender: senderPhone,
      text: text,
      message: `New message from ${senderPhone}: ${text}`,
      timestamp: new Date()
    });
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

// Use Render's dynamic port or default to 3000 locally
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Wavethread server running successfully on port ${PORT}`);
});
  
