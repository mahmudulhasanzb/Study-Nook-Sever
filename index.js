const express = require('express');
const app = express();
const dotenv = require('dotenv');
dotenv.config();
const cors = require('cors');
app.use(cors());
const { MongoClient, ServerApiVersion } = require('mongodb');
const port = process.env.PORT || 8000;

const uri = process.env.MONGODB_URI;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  // try {
  await client.connect();
  // Send a ping to confirm a successful connection
  // await client.db('admin').command({ ping: 1 });
  const db = client.db('study-nook');
  const roomsCollection = db.collection('rooms');

  app.get('/rooms', async (req, res) => {
    const cursor = roomsCollection.find();
    const result = await cursor.toArray();

    res.send(result);
  });

  console.log(
    'Pinged your deployment. You successfully connected to MongoDB!',
  );
  // } finally {
  //   // Ensures that the client will close when you finish/error
  //   await client.close();
  // }
}
run().catch(console.dir);

app.get('/', (req, res) => {
  res.send('Study Nook Server is running!');
});

app.listen(port, () => {
  console.log(`Study Nook Server listening on port ${port}`);
});
