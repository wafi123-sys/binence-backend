import { makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers } from '@whiskeysockets/baileys';
const qrcode = require('qrcode-terminal');
import pino from 'pino';

class WhatsAppService {
  private sock: any = null;
  private targetNumber: string | null = null;
  private isConnected = false;

  constructor() {
    this.targetNumber = process.env.WA_TARGET_NUMBER || null;
  }

  async init() {
    const { state, saveCreds } = await useMultiFileAuthState('wa_auth_info');

    this.sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: 'silent' }), // Suppress baileys logs
      browser: Browsers.macOS('Desktop'),
      syncFullHistory: false
    });

    this.sock.ev.on('connection.update', (update: any) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        console.log('\n[WhatsApp] Scan QR Code di bawah ini menggunakan aplikasi WhatsApp di HP kamu:');
        qrcode.generate(qr, { small: true });
        console.log('[WhatsApp] Menunggu scan QR...\n');
      }

      if (connection === 'close') {
        const shouldReconnect = (lastDisconnect.error as any)?.output?.statusCode !== DisconnectReason.loggedOut;
        console.log('[WhatsApp] Connection closed due to', lastDisconnect.error, ', reconnecting:', shouldReconnect);
        if (shouldReconnect) {
          this.init();
        } else {
          console.log('[WhatsApp] Logged out. Hapus folder wa_auth_info dan restart server untuk scan ulang.');
        }
        this.isConnected = false;
      } else if (connection === 'open') {
        console.log('[WhatsApp] ✅ Terhubung ke WhatsApp!');
        this.isConnected = true;
      }
    });

    this.sock.ev.on('creds.update', saveCreds);
    
    // Automatically capture target number if they send a message to the bot
    this.sock.ev.on('messages.upsert', async (m: any) => {
      const msg = m.messages[0];
      if (!msg.key.fromMe && m.type === 'notify') {
        const sender = msg.key.remoteJid;
        const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text;
        
        if (text?.toLowerCase() === 'start') {
           this.targetNumber = sender;
           console.log(`[WhatsApp] Registered target number: ${sender}`);
           await this.sock.sendMessage(sender, { text: 'Agnoia Terminal V2 Bot successfully linked! You will receive entry signals here.' });
        }
      }
    });
  }

  async sendEntrySignal(signal: any) {
    if (!this.isConnected || !this.targetNumber) {
      if (!this.targetNumber && this.isConnected) {
         console.log('[WhatsApp] Cannot send signal: Target number not set. Please send "start" to the bot WhatsApp number.');
      }
      return;
    }

    const { symbol, direction, confidence, strategy } = signal;
    
    const message = `🚨 *AGNOIA ENTRY SIGNAL* 🚨\n\n` +
      `*Symbol:* ${symbol}\n` +
      `*Direction:* ${direction === 'LONG' ? '🟢 LONG' : '🔴 SHORT'}\n` +
      `*Confidence:* ${confidence?.toFixed(1)}%\n` +
      `*Strategy:* ${strategy}\n\n` +
      `_Automated by Agnoia Terminal V2_`;

    try {
      await this.sock.sendMessage(this.targetNumber, { text: message });
      console.log(`[WhatsApp] Sent entry signal to ${this.targetNumber}`);
    } catch (err) {
      console.error('[WhatsApp] Failed to send message:', err);
    }
  }
}

export const whatsappService = new WhatsAppService();
