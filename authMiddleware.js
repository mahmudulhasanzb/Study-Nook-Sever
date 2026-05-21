const { MongoClient, ObjectId } = require('mongodb');

const mongoClient = new MongoClient(process.env.MONGODB_URI);
let db;

// Lazy connect — reuse connection
async function getDb() {
  if (!db) {
    await mongoClient.connect();
    db = mongoClient.db('study-nook');
  }
  return db;
}

/**
 * BetterAuth Session Middleware
 * Reads the `better-auth.session_token` cookie, looks up the session
 * in MongoDB `sessions` collection, and attaches req.user.id
 */
const authMiddleware = async (req, res, next) => {
  try {
    console.log('Incoming Cookies:', req.cookies);
    // BetterAuth sets this cookie name
    const sessionToken = req.cookies?.['better-auth.session_token'] || 
                         req.cookies?.['__secure-better-auth.session_token'] || 
                         req.cookies?.['__Secure-better-auth.session_token'];
    console.log('Found sessionToken:', sessionToken);

    if (!sessionToken) {
      return res.status(401).json({ error: 'Unauthorized: No session token' });
    }

    // BetterAuth cookies are in format "token_id.signature". The database only stores "token_id".
    const parsedToken = sessionToken.split('.')[0];
    console.log('Parsed database token:', parsedToken);

    const database = await getDb();
    const sessionsCollection = database.collection('session');

    // BetterAuth stores sessions with token field
    const session = await sessionsCollection.findOne({ token: parsedToken });

    if (!session) {
      console.log('Session not found in DB for token:', parsedToken);
      return res.status(401).json({ error: 'Unauthorized: Session not found' });
    }

    // Check session expiry
    if (session.expiresAt && new Date(session.expiresAt) < new Date()) {
      return res.status(401).json({ error: 'Unauthorized: Session expired' });
    }

    // BetterAuth stores userId as string
    req.user = { id: session.userId };
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    return res.status(500).json({ error: 'Server error during authentication' });
  }
};

module.exports = authMiddleware;
