const express = require('express');
const app = express();
const dotenv = require('dotenv');
dotenv.config();
const cors = require('cors');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const authMiddleware = require('./authMiddleware');

const port = process.env.PORT || 8000;
const uri = process.env.MONGODB_URI;

app.use(helmet());

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' }
});
app.use('/api', apiLimiter);

const allowedOrigins = [
  'http://localhost:3050',
  'http://localhost:3000',
  process.env.FRONTEND_URL
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    const isAllowed = allowedOrigins.includes(origin) || 
                      origin.endsWith('.vercel.app') || 
                      origin.startsWith('http://localhost:');
    if (isAllowed) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Cookie']
}));

app.use(express.json());
app.use(cookieParser());

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

let db = null;
let roomsCollection = null;
let bookingsCollection = null;
let usersCollection = null;
let sessionsCollection = null;

async function getDb() {
  if (!db) {
    await client.connect();
    db = client.db('study-nook');
    roomsCollection = db.collection('rooms');
    bookingsCollection = db.collection('bookings');
    usersCollection = db.collection('user');
    sessionsCollection = db.collection('session');
    console.log('Connected to MongoDB Atlas');
  }
  return db;
}

app.use(async (req, res, next) => {
  try {
    await getDb();
    next();
  } catch (error) {
    console.error('Database connection failed:', error);
    res.status(500).json({ error: 'Database connection failed' });
  }
});

const findUserById = async (id) => {
  if (!id) return null;
  try {
    let query = {};
    if (ObjectId.isValid(id)) {
      query = { $or: [{ _id: new ObjectId(id) }, { id: id.toString() }] };
    } else {
      query = { id: id.toString() };
    }
    return await usersCollection.findOne(query);
  } catch (_) {
    return null;
  }
};

// Auth
app.get('/api/auth/me', authMiddleware, async (req, res) => {
  try {
    const user = await findUserById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const { password, ...safe } = user;
    res.json(safe);
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({ error: 'Server error fetching user' });
  }
});

// Rooms (Public)
app.get('/featured', async (req, res) => {
  try {
    const cursor = roomsCollection.find().sort({ createdAt: -1 }).limit(6);
    const result = await cursor.toArray();

    const enriched = await Promise.all(result.map(async (room) => {
      const owner = await findUserById(room.ownerId);
      return {
        ...room,
        ownerName: owner?.name || 'Unknown',
        ownerEmail: owner?.email || '',
        ownerImage: owner?.image || '',
      };
    }));

    res.json(enriched);
  } catch (error) {
    console.error('Error fetching featured rooms:', error);
    res.status(500).json({ error: 'Server error fetching featured rooms' });
  }
});

app.get('/rooms', async (req, res) => {
  try {
    const { search, amenities, minRate, maxRate, floor } = req.query;
    const query = {};

    if (search) {
      query.name = { $regex: search, $options: 'i' };
    }

    if (amenities) {
      const amenitiesArray = Array.isArray(amenities)
        ? amenities
        : amenities.split(',').filter(Boolean);
      if (amenitiesArray.length > 0) {
        query.amenities = { $all: amenitiesArray };
      }
    }

    if (minRate || maxRate) {
      query.hourlyRate = {};
      if (minRate) query.hourlyRate.$gte = parseFloat(minRate);
      if (maxRate) query.hourlyRate.$lte = parseFloat(maxRate);
    }

    if (floor) {
      query.floor = { $regex: floor, $options: 'i' };
    }

    const result = await roomsCollection.find(query).toArray();
    res.json(result);
  } catch (error) {
    console.error('Error fetching rooms:', error);
    res.status(500).json({ error: 'Server error while fetching rooms' });
  }
});

app.get('/rooms/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid room ID' });
    }

    const room = await roomsCollection.findOne({ _id: new ObjectId(id) });
    if (!room) return res.status(404).json({ error: 'Room not found' });

    const owner = await findUserById(room.ownerId);
    res.json({
      ...room,
      ownerName: owner?.name || 'Unknown',
      ownerEmail: owner?.email || '',
      ownerImage: owner?.image || '',
    });
  } catch (error) {
    console.error('Error fetching room:', error);
    res.status(500).json({ error: 'Server error fetching room' });
  }
});

app.get('/rooms/:id/booked-slots', async (req, res) => {
  const { id } = req.params;
  const { date } = req.query;

  if (!ObjectId.isValid(id)) {
    return res.status(400).json({ error: 'Invalid room ID' });
  }

  if (!date) {
    return res.status(400).json({ error: 'Date query parameter is required' });
  }

  try {
    const bookings = await bookingsCollection.find({
      roomId: new ObjectId(id),
      date: date,
      status: { $ne: 'cancelled' }
    }).toArray();

    const bookedSlots = bookings.reduce((acc, booking) => {
      return acc.concat(booking.slots);
    }, []);

    res.json(bookedSlots);
  } catch (error) {
    console.error('Error fetching booked slots:', error);
    res.status(500).json({ error: 'Server error fetching booked slots' });
  }
});

// Rooms (Protected)
app.post('/api/rooms', authMiddleware, async (req, res) => {
  const { name, description, image, floor, capacity, hourlyRate, amenities } = req.body;

  if (!name || !description || !image || !floor || !capacity || !hourlyRate) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  try {
    const newRoom = {
      name,
      description,
      image,
      floor,
      capacity: parseInt(capacity),
      hourlyRate: parseFloat(hourlyRate),
      amenities: Array.isArray(amenities)
        ? amenities
        : (amenities ? amenities.split(',').map(a => a.trim()).filter(Boolean) : []),
      ownerId: req.user.id,
      bookingCount: 0,
      createdAt: new Date()
    };

    const result = await roomsCollection.insertOne(newRoom);
    const owner = await findUserById(req.user.id);
    res.status(201).json({
      message: 'Room listed successfully!',
      roomId: result.insertedId,
      ownerName: owner?.name,
    });
  } catch (error) {
    console.error('Error adding room:', error);
    res.status(500).json({ error: 'Server error while adding room' });
  }
});

app.get('/api/rooms/my', authMiddleware, async (req, res) => {
  try {
    const userIdStr = req.user.id.toString();
    const query = {
      $or: [
        { ownerId: userIdStr }
      ]
    };
    if (ObjectId.isValid(userIdStr)) {
      query.$or.push({ ownerId: new ObjectId(userIdStr) });
    }
    const result = await roomsCollection
      .find(query)
      .sort({ createdAt: -1 })
      .toArray();
    res.json(result);
  } catch (error) {
    console.error('Error fetching my rooms:', error);
    res.status(500).json({ error: 'Server error while fetching my rooms' });
  }
});

app.put('/api/rooms/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  if (!ObjectId.isValid(id)) {
    return res.status(400).json({ error: 'Invalid room ID' });
  }

  const { name, image, floor, capacity, amenities, description, hourlyRate } = req.body;

  try {
    const room = await roomsCollection.findOne({ _id: new ObjectId(id) });
    if (!room) return res.status(404).json({ error: 'Room not found' });

    if (!room.ownerId || room.ownerId.toString() !== req.user.id.toString()) {
      return res.status(403).json({ error: 'Unauthorized to update this room' });
    }

    await roomsCollection.updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          name,
          image,
          floor,
          capacity: parseInt(capacity),
          amenities: Array.isArray(amenities)
            ? amenities
            : amenities.split(',').map(a => a.trim()).filter(Boolean),
          description,
          hourlyRate: parseFloat(hourlyRate),
        }
      }
    );

    res.json({ message: 'Room updated successfully' });
  } catch (error) {
    console.error('Error updating room:', error);
    res.status(500).json({ error: 'Server error while updating room' });
  }
});

app.delete('/api/rooms/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  if (!ObjectId.isValid(id)) {
    return res.status(400).json({ error: 'Invalid room ID' });
  }

  try {
    const room = await roomsCollection.findOne({ _id: new ObjectId(id) });
    if (!room) return res.status(404).json({ error: 'Room not found' });

    if (!room.ownerId || room.ownerId.toString() !== req.user.id.toString()) {
      return res.status(403).json({ error: 'Unauthorized to delete this room' });
    }

    await roomsCollection.deleteOne({ _id: new ObjectId(id) });

    await bookingsCollection.updateMany(
      { roomId: new ObjectId(id) },
      { $set: { status: 'cancelled' } }
    );

    res.json({ message: 'Room listing deleted successfully' });
  } catch (error) {
    console.error('Error deleting room:', error);
    res.status(500).json({ error: 'Server error while deleting room' });
  }
});

// Bookings
app.post('/api/bookings', authMiddleware, async (req, res) => {
  const { roomId, date, slots } = req.body;

  if (!roomId || !ObjectId.isValid(roomId) || !date || !slots || !Array.isArray(slots) || slots.length === 0) {
    return res.status(400).json({ error: 'Valid Room ID, date, and slots are required' });
  }

  try {
    const room = await roomsCollection.findOne({ _id: new ObjectId(roomId) });
    if (!room) return res.status(404).json({ error: 'Room not found' });

    if (room.ownerId && room.ownerId.toString() === req.user.id.toString()) {
      return res.status(400).json({ error: 'You cannot book your own room' });
    }

    const conflict = await bookingsCollection.findOne({
      roomId: new ObjectId(roomId),
      date: date,
      status: { $ne: 'cancelled' },
      slots: { $in: slots }
    });

    if (conflict) {
      return res.status(409).json({ error: 'Conflict: One or more selected slots are already booked' });
    }

    const totalCost = room.hourlyRate * slots.length;

    const newBooking = {
      userId: req.user.id,
      roomId: new ObjectId(roomId),
      date: date,
      slots: slots,
      totalCost: totalCost,
      status: 'confirmed',
      createdAt: new Date()
    };

    const result = await bookingsCollection.insertOne(newBooking);

    await roomsCollection.updateOne(
      { _id: new ObjectId(roomId) },
      { $inc: { bookingCount: 1 } }
    );

    res.status(201).json({ message: 'Booking confirmed!', bookingId: result.insertedId });
  } catch (error) {
    console.error('Error creating booking:', error);
    res.status(500).json({ error: 'Server error while booking' });
  }
});

app.get('/api/bookings', authMiddleware, async (req, res) => {
  try {
    const pipeline = [
      { $match: { userId: req.user.id } },
      {
        $lookup: {
          from: 'rooms',
          localField: 'roomId',
          foreignField: '_id',
          as: 'roomDetails'
        }
      },
      { $unwind: '$roomDetails' },
      { $sort: { createdAt: -1 } }
    ];
    const bookings = await bookingsCollection.aggregate(pipeline).toArray();
    res.json(bookings);
  } catch (error) {
    console.error('Error fetching bookings:', error);
    res.status(500).json({ error: 'Server error fetching bookings' });
  }
});

app.patch('/api/bookings/:id/cancel', authMiddleware, async (req, res) => {
  const { id } = req.params;
  if (!ObjectId.isValid(id)) {
    return res.status(400).json({ error: 'Invalid booking ID' });
  }

  try {
    const booking = await bookingsCollection.findOne({ _id: new ObjectId(id) });
    if (!booking) return res.status(404).json({ error: 'Booking not found' });

    if (booking.userId.toString() !== req.user.id.toString()) {
      return res.status(403).json({ error: 'Unauthorized to cancel this booking' });
    }

    if (booking.status === 'cancelled') {
      return res.status(400).json({ error: 'Booking is already cancelled' });
    }

    await bookingsCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { status: 'cancelled' } }
    );

    await roomsCollection.updateOne(
      { _id: booking.roomId },
      { $inc: { bookingCount: -1 } }
    );

    res.json({ message: 'Booking cancelled successfully' });
  } catch (error) {
    console.error('Error cancelling booking:', error);
    res.status(500).json({ error: 'Server error while cancelling booking' });
  }
});

app.get('/', (req, res) => {
  res.send('StudyNook API Server is running!');
});

if (require.main === module) {
  app.listen(port, () => {
    console.log(`StudyNook Server listening on port ${port}`);
  });
}

module.exports = app;
