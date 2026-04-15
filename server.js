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

// Body parsing middleware MUST come before routes
app.use('/webhook', require('./routes/webhooks'));
app.use(express.json());
app.use(cookieParser());

// Stripe/webhook routes are disabled until Stripe is configured
// app.use('/webhook', require('./routes/webhooks'));

// Routes
app.use('/auth', require('./routes/auth'));
app.use('/api', require('./routes/api'));
app.use('/membership', require('./routes/membership'));
app.use('/user', require('./routes/user'));
app.use('/admin', require('./routes/admin'));
app.use('/listings', require('./routes/listings'));
app.use('/payments', require('./routes/payments'));
app.use('/breeder', require('./routes/breeder'));

app.listen(3000, () => console.log('Server running on port 3000'));