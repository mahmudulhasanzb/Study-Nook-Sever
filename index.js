const express = require('express');
const app = express();
const port = 5000;

app.get('/', (req, res) => {
  res.send('Study Nook Server is running!');
});

app.listen(port, () => {
  console.log(`Study Nook Server listening on port ${port}`);
});
