const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();
const authRoutes = require('./routes/auth_routes');
const userRoutes = require('./routes/user_routes');
const messageRoutes = require('./routes/message_routes');
const User = require('./models/User');
const Message = require('./models/Message');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
  },
});

const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/webrtc_call';

// Middleware
app.use(cors());
app.use(express.json());

// Database Connection
mongoose.connect(MONGO_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/messages', messageRoutes);

// Online Users Store (User ID -> Socket ID)
const users = new Map();

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // 1. Join user to signaling network and chat
  socket.on('join-user', (userId) => {
    users.set(userId, socket.id);
    console.log(`User registered: ${userId} with socket ID: ${socket.id}`);
    
    // Broadcast updated user list
    io.emit('online-users', Array.from(users.keys()));
  });

  // 2. Real-time Messaging (Chat)
  socket.on('send-message', async (data) => {
    const { senderId, receiverId, text } = data;
    const targetSocketId = users.get(receiverId);

    try {
      // Save message to database
      const newMessage = new Message({ senderId, receiverId, text });
      await newMessage.save();

      // Emit to receiver if online
      if (targetSocketId) {
        console.log(`Relaying message from ${senderId} to ${receiverId}`);
        io.to(targetSocketId).emit('receive-message', {
          senderId,
          text,
          createdAt: newMessage.createdAt,
        });
      }
    } catch (err) {
      console.error('Error sending message:', err);
    }
  });

  // 3. WebRTC Signaling (Video Call)
  socket.on('call-user', (data) => {
    const { targetId, callerId, offer } = data;
    console.log(`[SIGNAL] call-user: from ${callerId} to ${targetId}`);
    const targetSocketId = users.get(targetId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('incoming-call', { callerId, offer });
      console.log(`[SIGNAL] call-offer relayed to socket ${targetSocketId}`);
    } else {
      console.log(`[SIGNAL] call-user failed: target user ${targetId} is offline`);
    }
  });

  socket.on('accept-call', (data) => {
    const { targetId, responderId, answer } = data;
    console.log(`[SIGNAL] accept-call: by ${responderId} for ${targetId}`);
    const targetSocketId = users.get(targetId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('call-accepted', { responderId, answer });
      console.log(`[SIGNAL] call-accept relayed to socket ${targetSocketId}`);
    } else {
      console.log(`[SIGNAL] accept-call failed: target user ${targetId} is offline`);
    }
  });

  socket.on('ice-candidate', (data) => {
    const { targetId, candidate, senderId } = data;
    const targetSocketId = users.get(targetId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('ice-candidate', { candidate, senderId });
      // Log candidate type for debugging
      const candidateStr = candidate.candidate || '';
      const type = candidateStr.includes('typ host') ? 'HOST' : (candidateStr.includes('typ srflx') ? 'SRFLX' : 'OTHER');
      console.log(`[SIGNAL] ice-candidate (${type}): from ${senderId} to ${targetId} (socket ${targetSocketId})`);
    }
  });

  socket.on('hangup', (data) => {
    const { targetId, senderId } = data;
    console.log(`[SIGNAL] hangup: by ${senderId} for ${targetId}`);
    const targetSocketId = users.get(targetId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('hangup');
      console.log(`[SIGNAL] hangup relayed to socket ${targetSocketId}`);
    }
  });

  // 4. Handle Disconnection
  socket.on('disconnect', () => {
    for (const [userId, socketId] of users.entries()) {
      if (socketId === socket.id) {
        users.delete(userId);
        console.log(`User removed from registry: ${userId}`);
        break;
      }
    }
    io.emit('online-users', Array.from(users.keys()));
  });
});

app.get('/', (req, res) => {
  res.send('Social Calling Platform API is running...');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on port ${PORT}`);
});
