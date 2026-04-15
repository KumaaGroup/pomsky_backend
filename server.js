const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
require('dotenv').config();

const app = express();

app.use(cors({
  origin: [
    "https://pomsky-association.webflow.io",
    "https://your-custom-domain.com"
  ],
  credentials: true
}));

// Body parsing middleware MUST come before routes
app.use(cookieParser());
app.use(express.json());
app.use('/webhook', require('./routes/webhooks'));

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