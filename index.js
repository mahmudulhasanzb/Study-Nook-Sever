const express = require('express');
const app = express();
const dotenv = require('dotenv')
dotenv.config()
const cors = require('cors')
app.use(cors())
const port = process.env.PORT || 8000;

app.get('/', (req, res) => {
  res.send('Study Nook Server is running!');
});

app.listen(port, () => {
  console.log(`Study Nook Server listening on port ${port}`);
});
