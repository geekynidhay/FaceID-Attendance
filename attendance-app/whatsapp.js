const axios = require('axios');
require('dotenv').config();

const OPENWA_BASE_URL = process.env.OPENWA_BASE_URL || 'http://localhost:2785';
const OPENWA_SESSION = process.env.OPENWA_SESSION || '0ef720ea-60c6-45e2-b806-f5677a9d91d4';
const OPENWA_API_KEY = process.env.OPENWA_API_KEY || '';
const INSTITUTE_NAME = process.env.INSTITUTE_NAME || 'Coaching Institute';
const SIMULATE = process.env.SIMULATE_WHATSAPP === 'true';

// Normalize phone number to international Indian WhatsApp JID (e.g., 919893177887@c.us)
function formatWhatsAppJid(phone) {
  let cleaned = (phone || '').toString().replace(/\D/g, ''); // strip any spaces, +, -, etc.
  
  // If user entered 10 digits (e.g. 9893177887), automatically prefix India country code 91
  if (cleaned.length === 10) {
    cleaned = '91' + cleaned;
  } else if (cleaned.length === 12 && cleaned.startsWith('91')) {
    // Already has 91
    cleaned = cleaned;
  } else if (cleaned.length === 11 && cleaned.startsWith('0')) {
    // Leading 0 (e.g. 09893177887) -> strip 0 and add 91
    cleaned = '91' + cleaned.substring(1);
  }
  return `${cleaned}@c.us`;
}

/**
 * Send WhatsApp attendance notification to parent (ENTRY or EXIT)
 */
async function sendAttendanceAlert(studentName, rollNo, parentPhone, timeString, type = 'ENTRY') {
  const jid = formatWhatsAppJid(parentPhone);
  
  let message = '';
  if (type === 'ENTRY') {
    message = `🔔 *${INSTITUTE_NAME}*\n\n` +
      `Dear Parent,\n` +
      `*${studentName}* has entered the institute at *${timeString}*.\n\n` +
      `प्रिय अभिभावक,\n` +
      `*${studentName}* संस्थान में *${timeString}* पर उपस्थित हो गए हैं।`;
  } else {
    // EXIT / LEAVE
    message = `🔔 *${INSTITUTE_NAME}*\n\n` +
      `Dear Parent,\n` +
      `*${studentName}* has left the institute at *${timeString}*.\n\n` +
      `प्रिय अभिभावक,\n` +
      `*${studentName}* संस्थान से *${timeString}* पर निकल गए हैं।`;
  }

  if (SIMULATE) {
    console.log(`[SIMULATE WHATSAPP] Sending to ${jid}:\n${message}`);
    return { success: true, simulated: true, jid, message };
  }

  try {
    const url = `${OPENWA_BASE_URL}/api/sessions/${OPENWA_SESSION}/messages/send-text`;
    const headers = { 
      'Content-Type': 'application/json',
      'X-Api-Key': OPENWA_API_KEY
    };

    const res = await axios.post(url, {
      chatId: jid,
      text: message
    }, {
      headers,
      timeout: 10000
    });

    console.log(`[WHATSAPP SENT - ${type}] Delivered to ${jid}:`, res.data);
    return { success: true, response: res.data };
  } catch (error) {
    const errMsg = error.response ? JSON.stringify(error.response.data) : error.message;
    console.error(`[WHATSAPP ERROR] Failed to send to ${jid}:`, errMsg);
    return { success: false, error: errMsg };
  }
}

/**
 * Check OpenWA session status
 */
async function checkSessionStatus() {
  try {
    const url = `${OPENWA_BASE_URL}/api/sessions/${OPENWA_SESSION}`;
    const headers = {};
    if (OPENWA_API_KEY) {
      headers['X-Api-Key'] = OPENWA_API_KEY;
    }
    const res = await axios.get(url, { headers, timeout: 3000 });
    return res.data;
  } catch (error) {
    return { status: 'DISCONNECTED', error: error.message };
  }
}

module.exports = {
  sendAttendanceAlert,
  checkSessionStatus,
  formatWhatsAppJid
};
