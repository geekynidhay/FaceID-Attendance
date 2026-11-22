const axios = require('axios');
require('dotenv').config();

const OPENWA_BASE_URL = process.env.OPENWA_BASE_URL || 'http://localhost:2785';
const OPENWA_SESSION = process.env.OPENWA_SESSION || '0ef720ea-60c6-45e2-b806-f5677a9d91d4';
const OPENWA_API_KEY = process.env.OPENWA_API_KEY || '';
const INSTITUTE_NAME = process.env.INSTITUTE_NAME || 'DOT-CMC Computer Center';
const SIMULATE = process.env.SIMULATE_WHATSAPP === 'true';

// Normalize phone number to international Indian WhatsApp JID (e.g., 919893177887@c.us)
function formatWhatsAppJid(phone) {
  let cleaned = (phone || '').toString().replace(/\D/g, ''); // strip spaces, +, -, etc.
  
  if (cleaned.length === 10) {
    cleaned = '91' + cleaned;
  } else if (cleaned.length === 12 && cleaned.startsWith('91')) {
    cleaned = cleaned;
  } else if (cleaned.length === 11 && cleaned.startsWith('0')) {
    cleaned = '91' + cleaned.substring(1);
  }
  return `${cleaned}@c.us`;
}

/**
 * Send WhatsApp text message to single recipient
 */
async function sendSingleMessage(jid, message) {
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

    console.log(`[WHATSAPP SENT] Delivered to ${jid}:`, res.data);
    return { success: true, response: res.data };
  } catch (error) {
    const errMsg = error.response ? JSON.stringify(error.response.data) : error.message;
    console.error(`[WHATSAPP ERROR] Failed to send to ${jid}:`, errMsg);
    return { success: false, error: errMsg };
  }
}

/**
 * Send WhatsApp attendance notification to parent (ENTRY or EXIT)
 * Supports multiple numbers (primary + secondary)
 */
async function sendAttendanceAlert(studentName, rollNo, parentPhone, timeString, type = 'ENTRY', secondaryPhone = null) {
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

  const phoneNumbers = [parentPhone];
  if (secondaryPhone && secondaryPhone.trim() && secondaryPhone.trim() !== parentPhone.trim()) {
    phoneNumbers.push(secondaryPhone.trim());
  }

  const results = [];
  for (const phone of phoneNumbers) {
    const jid = formatWhatsAppJid(phone);
    const res = await sendSingleMessage(jid, message);
    results.push({ phone, jid, ...res });
  }

  const anySuccess = results.some(r => r.success);
  return {
    success: anySuccess,
    results
  };
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

/**
 * Send Welcome Registration Message to Parent(s)
 */
async function sendWelcomeRegistrationAlert(studentName, parentPhone, secondaryPhone = null) {
  const message = `🎉 *Welcome to ${INSTITUTE_NAME}*\n\n` +
    `Dear Parent,\n` +
    `We are pleased to inform you that *${studentName}* has been successfully registered at ${INSTITUTE_NAME}.\n\n` +
    `📌 *Important Notice:*\n` +
    `Please *save this WhatsApp number* to your contacts. You will receive all daily arrival and departure attendance alerts for *${studentName}* directly from this number.\n\n` +
    `For any queries, assistance, or guidance, feel free to contact us:\n` +
    `📞 *9685192443*\n` +
    `📞 *07562796465*\n\n` +
    `----------------------------------\n\n` +
    `प्रिय अभिभावक,\n` +
    `हमें आपको सूचित करते हुए अत्यंत प्रसन्नता हो रही है कि *${studentName}* का पंजीकरण ${INSTITUTE_NAME} में सफलतापूर्वक हो गया है।\n\n` +
    `📌 *महत्वपूर्ण सूचना:*\n` +
    `कृपया *इस व्हाट्सएप नंबर को अपने संपर्कों (Contacts) में सेव कर लें।* *${studentName}* के दैनिक आने और जाने (उपस्थिति) के सभी संदेश आपको इसी नंबर से प्राप्त होंगे।\n\n` +
    `किसी भी प्रकार की जानकारी, सहायता या मार्गदर्शन के लिए आप हमसे संपर्क कर सकते हैं:\n` +
    `📞 *9685192443*\n` +
    `📞 *07562796465*`;

  const phoneNumbers = [parentPhone];
  if (secondaryPhone && secondaryPhone.trim() && secondaryPhone.trim() !== parentPhone.trim()) {
    phoneNumbers.push(secondaryPhone.trim());
  }

  const results = [];
  for (const phone of phoneNumbers) {
    const jid = formatWhatsAppJid(phone);
    const res = await sendSingleMessage(jid, message);
    results.push({ phone, jid, ...res });
  }

  const anySuccess = results.some(r => r.success);
  return {
    success: anySuccess,
    results
  };
}

module.exports = {
  sendAttendanceAlert,
  sendWelcomeRegistrationAlert,
  checkSessionStatus,
  formatWhatsAppJid
};
