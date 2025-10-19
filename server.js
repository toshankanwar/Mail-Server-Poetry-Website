require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const admin = require('firebase-admin');

const app = express();
app.use(express.json());
app.use(cors());

// Initialize Firebase Admin SDK
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(require('./poem-dcbe8-firebase-adminsdk-fbsvc-fe707ed34e.json')),
  });
}
const firestore = admin.firestore();

// Brevo API configuration
const BREVO_API_KEY = process.env.BREVO_API_KEY;
const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';
const FROM_EMAIL = process.env.EMAIL_FROM ;
const FROM_NAME = process.env.EMAIL_FROM_NAME ;

// Helper function to send email via Brevo
async function sendBrevoEmail(to, subject, htmlContent) {
  try {
    const response = await axios.post(
      BREVO_API_URL,
      {
        sender: {
          email: FROM_EMAIL,
          name: FROM_NAME
        },
        to: Array.isArray(to) ? to.map(email => ({ email })) : [{ email: to }],
        subject: subject,
        htmlContent: htmlContent
      },
      {
        headers: {
          'api-key': BREVO_API_KEY,
          'Content-Type': 'application/json',
          'accept': 'application/json'
        }
      }
    );
    
    console.log(`✅ Email sent | Subject: ${subject}`);
    return { success: true, messageId: response.data.messageId };
  } catch (error) {
    console.error(`❌ Failed to send email:`, error.response?.data || error.message);
    throw error;
  }
}

// Send generic approval email
app.post('/api/send-aproval-email', async (req, res) => {
  const { to, subject, html } = req.body;
  
  if (!to || !subject || !html) {
    return res.status(400).json({ error: 'Missing to, subject, or html' });
  }
  
  try {
    await sendBrevoEmail(to, subject, html);
    res.status(200).json({ success: true });
  } catch (err) {
    console.error('Error sending email:', err);
    res.status(500).json({ error: 'Failed to send email' });
  }
});

// Send welcome email to new user
app.post('/api/send-welcome-email', async (req, res) => {
  const { email, name } = req.body;
  
  if (!email) {
    return res.status(400).json({ error: 'Missing email' });
  }

  const subject = "Welcome to the Poetry Community!";
  const html = `
  <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;background:#fff;border-radius:12px;box-shadow:0 2px 12px #ccb7f4;padding:32px 24px 20px 24px;">
    <header style="text-align:center;margin-bottom:28px;">
      <h1 style="color:#7c3aed;font-size:2em;margin:0;font-weight:bold;letter-spacing:-1px;">Welcome to Poetry Community${name ? ', ' + name : ''}!</h1>
      <p style="color:#6d28d9;font-size:1.08em;margin-top:10px;font-weight:500;">Your journey into a world of inspiration begins here.</p>
    </header>
    <section style="margin-bottom:28px;">
      <p style="font-size:1.15em;color:#3b3054;">We're delighted to have you join our growing family of poetry lovers and creators.</p>
      <p style="font-size:1.08em;color:#5a189a;">
        At <b>Poetry Community</b>, you can discover and share poems, connect with fellow enthusiasts, and explore a world of creativity and inspiration.
      </p>
      <div style="background:#f3e8ff;border-radius:8px;padding:20px 20px 15px 24px;margin:22px 0 18px 0;">
        <span style="font-weight:700;font-size:1.08em;color:#7c3aed;display:block;margin-bottom:11px;">Next Steps:</span>
        <ul style="padding-left:20px;margin:0 0 0 5px;color:#44337a;font-size:1em;">
          <li style="margin-bottom:7px;">✨ <a href="https://poems.toshankanwar.website/poem" style="color:#7c3aed;text-decoration:underline;">Explore featured poems</a></li>
          <li style="margin-bottom:7px;">✍️ Share your own poetic creations</li>
          <li>🤝 Connect with a supportive and vibrant community</li>
        </ul>
      </div>
      <p style="font-size:1em;color:#4b2774;">
        If you have any questions or suggestions, feel free to reply to this email or reach out to our support team at
        <a href="mailto:contact@toshankanwar.website" style="color:#7c3aed;text-decoration:underline;">contact@toshankanwar.website</a>.
      </p>
    </section>
    <footer style="text-align:center;color:#6c4a84;font-size:0.97em;">
      <p style="margin-top:18px;font-size:1.09em;">
        Welcome aboard, and happy reading and writing!<br/>
        <span style="color:#b197d9;">— Team PoemSite</span>
      </p>
    </footer>
  </div>
`;

  try {
    // Send welcome email
    await sendBrevoEmail(email, subject, html);

    // Add to mailing list
    const snap = await firestore.collection('mailingList').where('email', '==', email).limit(1).get();
    if (snap.empty) {
      await firestore.collection('mailingList').add({
        email,
        name: name || "",
        subscribed: true,
        created: admin.firestore.FieldValue.serverTimestamp(),
      });
    } else {
      const docRef = snap.docs[0].ref;
      await docRef.update({ subscribed: true });
    }

    res.status(200).json({ success: true });
  } catch (err) {
    console.error('Error sending welcome email:', err);
    res.status(500).json({ error: 'Failed to send welcome email' });
  }
});

// Send poem announcement to mailing list
app.post('/api/send-poem-announcement', async (req, res) => {
  console.log('Received poem announcement:', req.body);
  const { emails, poem } = req.body;
  
  if (!emails?.length || !poem) {
    return res.status(400).json({ error: 'Missing data' });
  }

  const subject = `New Poem Published: "${poem.title}"`;
  const link = `https://poems.toshankanwar.website/poem/${poem.slug}`;

  try {
    // Send to each email (with personalized unsubscribe link)
    const promises = emails.map(email => {
      const html = `
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;box-shadow:0 2px 12px #ccb7f4;padding:32px 24px 20px 24px;font-family:'Segoe UI',Arial,sans-serif;">
    <header style="text-align:center;margin-bottom:32px;">
      <h1 style="color:#7c3aed;font-size:2.1em;margin:0;font-weight:bold;letter-spacing:-1px;">PoemSite Announcement</h1>
      <p style="color:#7c3aed;font-size:1.07em;margin-top:10px;">A New Poem Has Been Published!</p>
    </header>

    <section style="margin-bottom:28px;">
      <h2 style="font-size:1.35em;color:#4b2774;margin-bottom:10px;">"${poem.title}"</h2>
      <p style="color:#6d28d9;font-size:1.08em;margin:0 0 18px 0;"><b>By:</b> ${poem.author}</p>
      <blockquote style="background:#f3e8ff;padding:22px 24px;border-left:5px solid #a78bfa;border-radius:8px;color:#44337a;font-size:1.1em;margin:0 0 15px 0;line-height:1.6;">
        ${poem.content.slice(0, 300)}${poem.content.length > 300 ? '...' : ''}
      </blockquote>
      <div style="margin:20px 0;">
        <a href="${link}" style="display:inline-block;background:#7c3aed;color:#fff;text-decoration:none;font-weight:600;padding:12px 28px;border-radius:6px;font-size:1em;box-shadow:0 1px 4px #e9d5ff;">Read the Full Poem</a>
      </div>
    </section>

    <hr style="border:none;border-top:1px solid #f3e8ff;margin:28px 0 18px 0;"/>

    <footer style="text-align:center;color:#6c4a84;font-size:0.97em;">
      <p style="margin-bottom:8px;">Thank you for being a valued member of the PoemSite community.<br/>We hope this poem inspires you today!</p>
      <p style="margin-bottom:3px;">
        <small>If you wish to unsubscribe from future poem notifications, <a href="https://poems.toshankanwar.website/unsubscribe?email=${encodeURIComponent(email)}" style="color:#7c3aed;text-decoration:underline;">click here</a>.</small>
      </p>
      <p style="margin-top:18px;font-size:0.93em;color:#b197d9;">
        &mdash; Team PoemSite 
      </p>
    </footer>
  </div>
`;
      return sendBrevoEmail(email, subject, html);
    });

    await Promise.all(promises);
    console.log(`✅ Poem announcement sent to ${emails.length} subscribers`);
    res.json({ sent: true, count: emails.length });
  } catch (e) {
    console.error('Error sending poem announcements:', e);
    res.status(500).json({ error: e.toString() });
  }
});

// Unsubscribe API
app.post('/api/unsubscribe', async (req, res) => {
  const { email } = req.body;
  
  if (!email) {
    return res.status(400).json({ error: 'Missing email' });
  }
  
  try {
    const snap = await firestore
      .collection('mailingList')
      .where('email', '==', email)
      .get();

    if (snap.empty) {
      return res.status(404).json({ error: 'Email not found in mailing list' });
    }

    const updates = [];
    snap.forEach(docRef => {
      updates.push(
        docRef.ref.update({ 
          subscribed: false, 
          unsubscribedAt: admin.firestore.FieldValue.serverTimestamp() 
        })
      );
    });
    await Promise.all(updates);

    console.log(`✅ Unsubscribed: ${email}`);
    res.json({ unsubscribed: true });
  } catch (err) {
    console.error('Unsubscribe error:', err);
    res.status(500).json({ error: 'Failed to unsubscribe' });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'PoemSite Email Server',
    brevoConfigured: !!BREVO_API_KEY,
    timestamp: new Date().toISOString()
  });
});

// Ping endpoint
app.get('/ping', (req, res) => {
  res.json({
    success: true,
    message: 'pong',
    timestamp: new Date().toISOString()
  });
});

// Self-ping service
let pingInterval = null;

function startSelfPing() {
  if (process.env.NODE_ENV !== 'production') {
    console.log('⏭️  Self-ping disabled (development mode)');
    return;
  }

  const SERVER_URL = process.env.RENDER_EXTERNAL_URL || process.env.SERVER_URL;
  if (!SERVER_URL) {
    console.warn('⚠️  SERVER_URL not set. Self-ping disabled.');
    return;
  }

  const PING_INTERVAL = 14 * 60 * 1000; // 14 minutes

  console.log('🔔 Starting self-ping service...');
  console.log(`📍 Target URL: ${SERVER_URL}/ping`);

  setTimeout(() => performPing(SERVER_URL), 60000);
  pingInterval = setInterval(() => performPing(SERVER_URL), PING_INTERVAL);

  console.log('✅ Self-ping service started');
}

async function performPing(url) {
  try {
    await axios.get(`${url}/ping`, { timeout: 10000 });
    console.log(`🏓 Self-ping successful at ${new Date().toLocaleTimeString()}`);
  } catch (error) {
    console.error('❌ Self-ping failed:', error.message);
  }
}

function stopSelfPing() {
  if (pingInterval) {
    clearInterval(pingInterval);
    pingInterval = null;
    console.log('🛑 Self-ping service stopped');
  }
}

// Start server
const PORT = process.env.PORT || 5001;

const server = app.listen(PORT, () => {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`📧 PoemSite Email Server`);
  console.log(`📍 Port: ${PORT}`);
  console.log(`📧 Email From: ${FROM_EMAIL}`);
  console.log(`🔑 Brevo API: ${BREVO_API_KEY ? '✅ Configured' : '❌ Not configured'}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  startSelfPing();
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('\n🛑 SIGTERM signal received');
  stopSelfPing();
  server.close(() => {
    console.log('✅ Server closed gracefully');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('\n🛑 SIGINT signal received');
  stopSelfPing();
  server.close(() => {
    console.log('✅ Server closed gracefully');
    process.exit(0);
  });
});
