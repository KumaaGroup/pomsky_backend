const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
require('dotenv').config();

const app = express();

app.use(cors({
  origin: function(origin, callback) {
    if (!origin || origin.endsWith('.webflow.com') || origin.endsWith('.webflow.io')) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));

app.use(express.json());
app.use(cookieParser());

// Routes
app.use('/auth', require('./routes/auth'));
app.use('/api', require('./routes/api'));
app.use('/membership', require('./routes/membership'));

app.listen(3000, () => console.log('Server running on port 3000'));