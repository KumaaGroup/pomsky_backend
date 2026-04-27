const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS
  }
});

async function sendEmail({ to, subject, html }) {
  try {
    await transporter.sendMail({
      from: `"Pomsky Association" <${process.env.GMAIL_USER}>`,
      to,
      subject,
      html
    });
    console.log(`Email sent to ${to}`);
    return { success: true };
  } catch (err) {
    console.error('EMAIL ERROR:', err.message);
    return { success: false, error: err.message };
  }
}

module.exports = { sendEmail };
