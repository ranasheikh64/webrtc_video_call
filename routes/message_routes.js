const express = require('express');
const Message = require('../models/Message');
const router = express.Router();
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'your_super_secret_key';

// Middleware for authentication
const auth = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) throw new Error();
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (e) {
    res.status(401).send({ error: 'Please authenticate.' });
  }
};

// GET /api/messages/:receiverId - Get chat history between two users
router.get('/:receiverId', auth, async (req, res) => {
  try {
    const messages = await Message.find({
      $or: [
        { senderId: req.user.id, receiverId: req.params.receiverId },
        { senderId: req.params.receiverId, receiverId: req.user.id }
      ]
    }).sort({ createdAt: 1 }); // Sort by time (oldest first)
    
    res.send(messages);
  } catch (error) {
    res.status(500).send({ error: 'Server error: ' + error.message });
  }
});

module.exports = router;
