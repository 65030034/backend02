const express = require('express');
const cors = require('cors');
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser'); // ✅ แก้ชื่อจาก Parrer เป็น Parser

const app = express();
app.use(cors()); 
app.use(express.json());

const IMAP_HOST = 'capumail.com'; 

const getImapConfig = (req) => {
    const user = req.headers['x-imap-user'];
    const pass = req.headers['x-imap-pass'];
    if (!user || !pass) throw new Error('Missing Credentials');
    return {
        host: IMAP_HOST, 
        port: 993, 
        secure: true,
        auth: { user, pass }, 
        logger: false,
        connectionTimeout: 15000 
    };
};

app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    const client = new ImapFlow({ host: IMAP_HOST, port: 993, secure: true, auth: { user: email, pass: password } });
    try {
        await client.connect();
        await client.logout();
        res.json({ success: true });
    } catch (err) { res.status(401).json({ success: false, error: err.message }); }
});

app.get('/api/folders', async (req, res) => {
    try {
        const client = new ImapFlow(getImapConfig(req));
        await client.connect();
        let folders = await client.list();
        await client.logout();
        res.json({ success: true, data: folders.map(f => ({ name: f.name, path: f.path })) });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/emails', async (req, res) => {
    const folderPath = req.query.folder || 'INBOX';
    try {
        const client = new ImapFlow(getImapConfig(req));
        await client.connect();
        let lock = await client.getMailboxLock(folderPath);
        try {
            const mailbox = client.mailbox;
            if (mailbox.exists === 0) return res.json({ success: true, data: [] });

            let emails = [];
            let start = Math.max(1, mailbox.exists - 14); 
            for await (let msg of client.fetch(`${start}:*`, { envelope: true })) {
                emails.push({
                    uid: msg.uid,
                    subject: msg.envelope.subject || '(No Subject)',
                    from: msg.envelope.from?.[0]?.address || 'Unknown',
                    date: msg.envelope.date
                });
            }
            res.json({ success: true, data: emails.reverse() });
        } finally { lock.release(); await client.logout(); }
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ✅ แก้ไขส่วนดึง Content ให้ใช้ Parser เพื่อลบ Header รกๆ ออก
app.get('/api/email-content', async (req, res) => {
    const { folder, uid } = req.query;
    try {
        const client = new ImapFlow(getImapConfig(req));
        await client.connect();
        let lock = await client.getMailboxLock(folder || 'INBOX');
        try {
            let message = await client.fetchOne(uid, { source: true });
            
            // 🛠️ ถอดรหัส Source Code ของเมลให้กลายเป็นข้อความอ่านง่าย
            const parsed = await simpleParser(message.source);
            
            res.json({ 
                success: true, 
                // ส่งค่าที่เป็น HTML หรือถ้าไม่มีให้ส่ง Text ธรรมดาไป
                content: parsed.html || parsed.textAsHtml || parsed.text || "No Content" 
            });
        } finally { lock.release(); await client.logout(); }
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ✅ แก้ Port สำหรับ Render
const PORT = process.env.PORT || 5001;
app.listen(PORT, () => console.log(`☕ CapuMail Backend running on port ${PORT}`));