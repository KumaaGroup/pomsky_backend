const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
require('dotenv').config();

const app = express();

app.use(cors({
  origin: 'https://pomsky-association.design.webflow.com/', // your Webflow domain
  credentials: true // required for cookies
}));
app.use(express.json());
app.use(cookieParser());

// Routes
app.use('/auth', require('./routes/auth'));
app.use('/api', require('./routes/api'));

app.listen(3000, () => console.log('Server running on port 3000'));