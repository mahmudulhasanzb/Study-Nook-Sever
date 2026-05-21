const { MongoClient, ObjectId } = require('mongodb');

const mongoClient = new MongoClient(process.env.MONGODB_URI);
let db;

async function getDb() {
  if (!db) {
    await mongoClient.connect();
    db = mongoClient.db('study-nook');
  }
  return db;
}

const authMiddleware = async (req, res, next) => {
  try {
    const sessionToken = req.cookies?.['better-auth.session_token'] || 
                         req.cookies?.['__secure-better-auth.session_token'] || 
                         req.cookies?.['__Secure-better-auth.session_token'];

    if (!sessionToken) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const parsedToken = sessionToken.split('.')[0];
    const database = await getDb();
    const session = await database.collection('session').findOne({ token: parsedToken });

    if (!session) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (session.expiresAt && new Date(session.expiresAt) < new Date()) {
      return res.status(401).json({ error: 'Unauthorized: Session expired' });
    }

    req.user = { id: session.userId };
    next();
  } catch (error) {
    console.error('Auth error:', error);
    return res.status(500).json({ error: 'Authentication failed' });
  }
};

module.exports = authMiddleware;

