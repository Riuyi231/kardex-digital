'use strict';
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const QRCode = require('qrcode');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  downloadMediaMessage,
  extractMessageContent
} = require('@whiskeysockets/baileys');

let pino = null;
try { pino = require('pino'); } catch (e) { /* optional */ }

const QR_TIMEOUT = 150000;
const MAX_DROPS_FOR_FRESH = 2;

class WhatsAppService extends EventEmitter {
  constructor() {
    super();
    this.sock = null;
    this.status = 'off';
    this.statusDetail = '';
    this.qrDataUrl = null;
    this.chats = [];
    this.authDir = '';
    this.manualDisconnect = false;
    this.reconnectTimer = null;
    this.reconnectAttempts = 0;
    this.sessionDrops = 0;
    this.forceFreshSession = false;
    this.onMessage = null;
    this.onReadReceipt = null;
    this.groupNames = {};
    this.groupMeta = {};
    this.contactos = {};
    this.avatars = {};
    this.lidToPn = {};
  }

  configure(authDir) {
    this.authDir = authDir;
    this.cargarLidMappings();
  }

  cargarLidMappings() {
    if (!this.authDir) return;
    try {
      const f = path.join(this.authDir, 'lid-pn.json');
      this.lidToPn = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {};
    } catch (e) { this.lidToPn = {}; }
  }

  persistirLidMappings() {
    if (!this.authDir) return;
    try { fs.writeFileSync(path.join(this.authDir, 'lid-pn.json'), JSON.stringify(this.lidToPn || {})); } catch (e) { /* noop */ }
  }

  guardarLidMapping(lid, pn) {
    try {
      const l = String(lid || '').trim();
      let p = String(pn || '').trim();
      if (!l || !p) return false;
      if (!p.includes('@')) p += '@s.whatsapp.net';
      if (!l.endsWith('@lid') || !p.endsWith('@s.whatsapp.net')) return false;
      if (!this.lidToPn[l] || this.lidToPn[l] !== p) {
        this.lidToPn[l] = p;
        this.persistirLidMappings();
        this.emit('lid-update', { lid: l, pn: p });
        return true;
      }
    } catch (e) { /* noop */ }
    return false;
  }

  resolverLid(jid) {
    const s = String(jid || '');
    if (s.endsWith('@lid') && this.lidToPn && this.lidToPn[s]) return this.lidToPn[s];
    return s;
  }

  configureMedia(dir) {
    this.mediaDir = dir;
    try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { /* noop */ }
  }

  clearAuth() {
    if (!this.authDir) return;
    try { fs.rmSync(this.authDir, { recursive: true, force: true }); } catch (e) { /* noop */ }
  }

  async resetSession() {
    this.manualDisconnect = true;
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    if (this.sock) {
      try { await this.sock.end(new Error('reiniciar sesión')); } catch (e) { /* noop */ }
      this.sock = null;
    }
    this.qrDataUrl = null;
    this.clearAuth();
    this.sessionDrops = 0;
    this.reconnectAttempts = 0;
    this.forceFreshSession = false;
    this.manualDisconnect = false;
    await this.connect();
  }

  async connect() {
    if (this.sock && (this.status === 'connecting' || this.status === 'qr' || this.status === 'ready')) {
      return;
    }
    if (this.sock) {
      try { Promise.resolve(this.sock.end(new Error('reconectar'))).catch(() => {}); } catch (e) { /* noop */ }
      this.sock = null;
    }
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    this.manualDisconnect = false;
    this.reconnectAttempts = 0;
    this.setStatus('connecting', 'Iniciando WhatsApp…');
    try {
      if (this.forceFreshSession) {
        this.forceFreshSession = false;
        this.clearAuth();
      }
      const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
      let version;
      try {
        const v = await fetchLatestBaileysVersion();
        version = v.version;
      } catch (e) { version = undefined; }
      const sock = makeWASocket({
        auth: state,
        version,
        browser: Browsers.ubuntu('Chrome'),
        logger: pino ? pino({ level: 'silent' }) : undefined,
        printQRInTerminal: false,
        qrTimeout: QR_TIMEOUT,
        getMessage: async () => undefined
      });
      this.sock = sock;
      let gotUpdate = false;
      const watchdog = setTimeout(() => {
        if (!gotUpdate && this.sock === sock) {
          try { Promise.resolve(sock.end(new Error('Sin respuesta del servidor de WhatsApp'))).catch(() => {}); } catch (e) { /* noop */ }
        }
      }, QR_TIMEOUT + 8000);

      sock.ev.on('creds.update', saveCreds);

      sock.ev.on('lid-mapping.update', (mp) => {
        if (mp && mp.lid && mp.pn) this.guardarLidMapping(mp.lid, mp.pn);
      });
      sock.ev.on('messaging-history.set', (data) => {
        try {
          for (const mp of (data && data.lidPnMappings) || []) {
            if (mp && mp.lid && mp.pn) this.guardarLidMapping(mp.lid, mp.pn);
          }
        } catch (e) { /* noop */ }
      });

      sock.ev.on('contacts.upsert', (cs) => this.guardarContactos(cs));
      sock.ev.on('contacts.update', (cs) => this.guardarContactos(cs));

      sock.ev.on('connection.update', async (update) => {
        gotUpdate = true;
        clearTimeout(watchdog);
        if (update.qr) {
          this.qrDataUrl = null;
          try {
            this.qrDataUrl = await QRCode.toDataURL(update.qr, { width: 280, margin: 1 });
          } catch (e) { /* noop */ }
          this.setStatus('qr', 'Escanea el código con tu WhatsApp');
        }
        if (update.connection === 'open') {
          if (this.sock !== sock) return;
          this.manualDisconnect = false;
          this.reconnectAttempts = 0;
          this.sessionDrops = 0;
          this.setStatus('ready', 'Conectado');
          try { await this.refreshChats(); } catch (e) { /* noop */ }
          this.setStatus('ready', 'Conectado');
        } else if (update.connection === 'close') {
          if (this.sock !== sock) return;
          this.sock = null;
          this.qrDataUrl = null;
          const err = (update.lastDisconnect && update.lastDisconnect.error) || null;
          const code = err ? (err.code !== undefined ? err.code : err.status) : undefined;
          if (code === DisconnectReason.loggedOut) {
            this.clearAuth();
            this.setStatus('off', 'La sesión se cerró desde tu teléfono. Vuelve a escanear el código QR.');
          } else if (code === DisconnectReason.connectionReplaced) {
            this.clearAuth();
            this.setStatus('off', 'Se inició sesión desde otro dispositivo. Reinicia la sesión para vincular este equipo.');
          } else if (code === DisconnectReason.badSession) {
            this.clearAuth();
            this.setStatus('off', 'La sesión guardada está dañada. Reinicia la sesión para escanear un QR nuevo.');
          } else if (this.manualDisconnect) {
            this.setStatus('off', 'Desconectado');
          } else {
            this.sessionDrops += 1;
            if (this.sessionDrops >= MAX_DROPS_FOR_FRESH) {
              this.forceFreshSession = true;
              this.clearAuth();
              this.setStatus('off', 'La sesión anterior falló varias veces. Se generará un QR nuevo…');
            } else {
              this.setStatus('off', 'Conexión perdida, reintentando…');
            }
            this.scheduleReconnect();
          }
        }
      });

      sock.ev.on('messages.upsert', async (u) => {
        try {
          for (const msg of (u && u.messages) || []) {
            const m = this.normalizeMessage(msg);
            if (!m) continue;
            await this.resolverConversacion(m);
            if (m.media) {
              try {
                const buff = await this.withTimeout(
                  downloadMediaMessage(msg, 'buffer', { logger: pino ? pino({ level: 'silent' }) : undefined }),
                  30000
                );
                if (buff && buff.length) {
                  const archivo = this.guardarMedia(buff, msg);
                  if (archivo) m.mediaArchivo = archivo;
                }
              } catch (e) { /* noop */ }
            }
            this.emit('message', m);
            if (typeof this.onMessage === 'function') this.onMessage(m);
          }
        } catch (e) { /* noop */ }
      });

      sock.ev.on('receipt.update', (updates) => {
        try {
          this.emit('receipt', updates || []);
          if (typeof this.onReadReceipt === 'function') this.onReadReceipt(updates || []);
        } catch (e) { /* noop */ }
      });
    } catch (e) {
      this.sock = null;
      this.setStatus('failed', e.message || 'Error al iniciar WhatsApp');
    }
  }

  scheduleReconnect() {
    if (this.manualDisconnect || this.reconnectTimer) return;
    if (this.reconnectAttempts >= 4) {
      this.setStatus('off', 'No se pudo conectar. Usa "Reiniciar sesión" para escanear un QR nuevo.');
      return;
    }
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.manualDisconnect && !this.sock && this.status !== 'ready') {
        this.connect();
      }
    }, 4000);
  }

  async disconnect() {
    this.manualDisconnect = true;
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    if (this.sock) {
      try { await this.sock.end(new Error('cerrado por el usuario')); } catch (e) { /* noop */ }
      this.sock = null;
    }
    this.qrDataUrl = null;
    this.setStatus('off', 'Desconectado');
  }

  setStatus(status, detail) {
    this.status = status;
    this.statusDetail = detail || '';
    this.emit('status', this.snapshot());
  }

  snapshot() {
    return { status: this.status, detail: this.statusDetail, qr: this.qrDataUrl, groups: this.chats.slice() };
  }

  async refreshChats() {
    if (!this.sock) return;
    try {
      const res = await this.sock.groupFetchAllParticipating();
      this.chats = Object.values(res || {})
        .map((g) => ({ id: g.id, name: g.subject || '' }))
        .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'es', { sensitivity: 'base' }));
    } catch (e) {
      this.chats = [];
    }
  }

  async findChat(ref) {
    if (!this.chats.length) await this.refreshChats();
    const s = String(ref || '').trim();
    if (!s) throw new Error('Elige un grupo de WhatsApp primero.');
    const byId = this.chats.find((c) => c.id === s);
    if (byId) return byId;
    const byName = this.chats.find((c) => c.name && c.name.toLowerCase().includes(s.toLowerCase()));
    if (!byName) throw new Error('No se encontró un grupo con "' + ref + '" en tus chats. Conecta WhatsApp y vuelve a intentarlo.');
    return byName;
  }

  construirQuoted(jid, reply) {
    if (!reply || !reply.id) return null;
    const protoMsg = {};
    const mediaT = String(reply.media || '');
    if (mediaT === 'imagen') protoMsg.imageMessage = { url: '' };
    else if (mediaT === 'video') protoMsg.videoMessage = { url: '' };
    else if (mediaT === 'audio') protoMsg.audioMessage = {};
    else if (mediaT === 'sticker') protoMsg.stickerMessage = {};
    else if (mediaT === 'documento') protoMsg.documentMessage = { fileName: String(reply.texto || 'documento') };
    else protoMsg.conversation = String(reply.texto || '');
    return {
      key: {
        remoteJid: String(jid || ''),
        fromMe: !!reply.fromMe,
        id: String(reply.id || ''),
        ...(reply.participant ? { participant: String(reply.participant) } : {})
      },
      message: protoMsg
    };
  }

  async sendMessageTo(jid, message, reply, mentions) {
    if (!this.sock || this.status !== 'ready') throw new Error('WhatsApp no está conectado. Conéctalo primero.');
    const quoted = this.construirQuoted(jid, reply);
    const content = { text: String(message) };
    if (Array.isArray(mentions) && mentions.length) content.mentions = mentions.filter((j) => j && /@/.test(String(j)));
    const res = await this.sock.sendMessage(jid, content, quoted ? { quoted } : undefined);
    const key = (res && res.key) || {};
    return { id: String(key.id || ''), jid: String(key.remoteJid || jid) };
  }

  async sendMediaTo(jid, opts) {
    if (!this.sock || this.status !== 'ready') throw new Error('WhatsApp no está conectado. Conéctalo primero.');
    const tipo = String(opts.tipo || '');
    const buff = opts.buffer;
    if (!buff || !buff.length) throw new Error('El archivo adjunto está vacío.');
    const caption = String(opts.caption || '');
    const quoted = this.construirQuoted(jid, opts.reply);
    let content;
    if (tipo === 'imagen') content = { image: buff, caption, mimetype: String(opts.mime || 'image/jpeg') };
    else if (tipo === 'video') content = { video: buff, caption, mimetype: String(opts.mime || 'video/mp4') };
    else if (tipo === 'sticker') content = { sticker: buff };
    else if (tipo === 'documento') content = { document: buff, fileName: String(opts.fileName || 'documento'), caption, mimetype: String(opts.mime || 'application/octet-stream') };
    else if (tipo === 'audio') content = { audio: buff, mimetype: String(opts.mime || 'audio/ogg; codecs=opus'), ptt: true };
    else throw new Error('Tipo de adjunto no válido.');
    if (Array.isArray(opts.mentions) && opts.mentions.length) content.mentions = opts.mentions.filter((j) => j && /@/.test(String(j)));
    const res = await this.sock.sendMessage(jid, content, quoted ? { quoted } : undefined);
    const key = (res && res.key) || {};
    return { id: String(key.id || ''), jid: String(key.remoteJid || jid) };
  }

  async obtenerParticipantes(jid) {
    if (!this.sock || this.status !== 'ready') return [];
    try {
      const meta = await this.withTimeout(this.sock.groupMetadata(jid), 8000);
      const parts = (meta && meta.participants) || [];
      return parts.map((p) => {
        const pjid = String(p.id || '');
        const pn = this.resolverLid(pjid);
        const c = this.contactos[pjid] || this.contactos[pn] || {};
        return {
          jid: pjid,
          pn,
          nombre: (c && c.name) || '',
          telefono: this.normalizarTelefono(pn)
        };
      }).filter((p) => p.jid);
    } catch (e) {
      return [];
    }
  }

  guardarMediaDedup(buff, ext) {
    if (!this.mediaDir || !buff || !buff.length) return '';
    let e = String(ext || '');
    if (e && !e.startsWith('.')) e = '.' + e;
    if (!/^\.[A-Za-z0-9]{1,8}$/.test(e)) e = '';
    if (!e) e = '.bin';
    const hash = crypto.createHash('sha256').update(buff).digest('hex').slice(0, 16);
    const name = 'wm_' + hash + e;
    const p = path.join(this.mediaDir, name);
    if (fs.existsSync(p)) return name;
    fs.writeFileSync(p, buff);
    return name;
  }

  guardarMediaBuffer(buff, ext) {
    if (!this.mediaDir || !buff || !buff.length) return '';
    try {
      return this.guardarMediaDedup(buff, ext);
    } catch (e2) { return ''; }
  }

  async sendToGroup(ref, message) {
    const chat = await this.findChat(ref);
    await this.sendMessageTo(chat.id, message);
    return chat.name;
  }

  async sendDocument(jid, buffer, fileName, caption) {
    if (!this.sock || this.status !== 'ready') throw new Error('WhatsApp no está conectado. Conéctalo primero.');
    const res = await this.sock.sendMessage(jid, {
      document: buffer,
      fileName: String(fileName || 'documento.pdf'),
      mimetype: 'application/pdf',
      caption: String(caption || '')
    });
    const key = (res && res.key) || {};
    return { id: String(key.id || ''), jid: String(key.remoteJid || jid) };
  }

  guardarMedia(buff, msg) {
    if (!this.mediaDir) return '';
    try {
      const body = extractMessageContent((msg && msg.message) || {}) || {};
      const info = body.imageMessage || body.videoMessage || body.documentMessage || body.audioMessage || body.stickerMessage;
      const mime = info && info.mimetype ? String(info.mimetype) : '';
      let ext = '';
      if (mime.includes('jpeg') || mime.includes('jpg')) ext = '.jpg';
      else if (mime.includes('png')) ext = '.png';
      else if (mime.includes('gif')) ext = '.gif';
      else if (mime.includes('webp')) ext = '.webp';
      else if (mime.includes('mp4')) ext = '.mp4';
      else if (mime.includes('webm')) ext = '.webm';
      else if (mime.includes('quicktime') || mime.includes('mov')) ext = '.mov';
      else if (mime.includes('mp3') || mime.includes('mpeg')) ext = '.mp3';
      else if (mime.includes('ogg')) ext = '.ogg';
      else if (mime.includes('opus')) ext = '.opus';
      else if (mime.includes('amr')) ext = '.amr';
      else if (mime.includes('aac')) ext = '.aac';
      else if (mime.includes('wav')) ext = '.wav';
      else if (mime.includes('pdf')) ext = '.pdf';
      else if (body.documentMessage && body.documentMessage.fileName) {
        ext = path.extname(String(body.documentMessage.fileName)) || '';
        if (!/^\.[A-Za-z0-9]{1,8}$/.test(ext)) ext = '';
      }
      if (!ext) ext = '.bin';
      return this.guardarMediaDedup(buff, ext);
    } catch (e) { return ''; }
  }

  withTimeout(promise, ms) {
    let timer;
    return Promise.race([
      Promise.resolve(promise),
      new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('Tiempo de espera agotado')), ms); })
    ]).finally(() => clearTimeout(timer));
  }

  guardarContactos(cs) {
    try {
      for (const c of cs || []) {
        if (!c || !c.id) continue;
        const nombre = c.name || c.notify || '';
        if (nombre) this.contactos[c.id] = { name: nombre };
        if (c.imgUrl) {
          this.avatarUrlCache = this.avatarUrlCache || {};
          this.avatarUrlCache[c.id] = c.imgUrl;
        }
      }
    } catch (e) { /* noop */ }
  }

  async resolverConversacion(m) {
    try {
      if (m.isGroup) {
        if (!(m.jid in this.groupMeta)) {
          const meta = await this.withTimeout(this.sock.groupMetadata(m.jid), 6000);
          this.groupMeta[m.jid] = {
            subject: (meta && meta.subject) || '',
            size: (meta && meta.participants && meta.participants.length) || 0
          };
          if ((meta && meta.subject) || '') this.groupNames[m.jid] = meta.subject;
        }
        const gm = this.groupMeta[m.jid];
        if (gm && gm.subject) m.nombre = gm.subject;
        m.miembros = (gm && gm.size) || 0;
      } else if (m.fromMe) {
        m.nombre = 'Yo';
      } else {
        m.nombre = m.nombre || m.remitente || m.telefono || '';
      }
      if (!(m.jid in this.avatars)) {
        this.avatars[m.jid] = await this.obtenerAvatar(m.jid);
      }
      m.avatar = this.avatars[m.jid] || '';
    } catch (e) { /* noop */ }
  }

  async enriquecerJids(jids) {
    const out = {};
    for (const jid of jids || []) {
      try {
        const info = { nombre: '', avatar: '', miembros: 0 };
        if (jid.endsWith('@g.us')) {
          if (!(jid in this.groupMeta)) {
            const meta = await this.withTimeout(this.sock.groupMetadata(jid), 6000);
            this.groupMeta[jid] = {
              subject: (meta && meta.subject) || '',
              size: (meta && meta.participants && meta.participants.length) || 0
            };
            if ((meta && meta.subject) || '') this.groupNames[jid] = meta.subject;
          }
          const gm = this.groupMeta[jid];
          info.nombre = (gm && gm.subject) || '';
          info.miembros = (gm && gm.size) || 0;
        }
        if (!(jid in this.avatars)) this.avatars[jid] = await this.obtenerAvatar(jid);
        info.avatar = this.avatars[jid] || '';
        out[jid] = info;
      } catch (e) { /* noop */ }
    }
    return out;
  }

  async obtenerAvatar(jid) {
    try {
      if (!this.mediaDir || !this.sock) return '';
      this.avatarUrlCache = this.avatarUrlCache || {};
      let url = this.avatarUrlCache[jid] || '';
      if (!url) {
        url = await this.withTimeout(this.sock.profilePictureUrl(jid, 'image'), 6000);
      }
      if (!url) return '';
      const fetchFn = typeof fetch === 'function' ? fetch : null;
      if (!fetchFn) return '';
      const res = await this.withTimeout(fetchFn(url), 15000);
      if (!res || !res.ok) return '';
      const buff = Buffer.from(await res.arrayBuffer());
      if (!buff || !buff.length) return '';
      const name = 'ava_' + String(jid).replace(/[^A-Za-z0-9@._-]/g, '_') + '.jpg';
      fs.writeFileSync(path.join(this.mediaDir, name), buff);
      return name;
    } catch (e) { return ''; }
  }

  normalizarTelefono(tel) {
    let t = String(tel || '').split('@')[0].replace(/\D/g, '');
    if (t.startsWith('521')) t = '52' + t.slice(3);
    t = t.replace(/^0+/, '');
    return t;
  }

  normalizeMessage(msg) {
    if (!msg || !msg.message) return null;
    const key = msg.key || {};
    const fromMe = !!key.fromMe;
    const jid = String(key.remoteJid || '');
    if (!jid || jid === 'status@broadcast') return null;
    const isGroup = jid.endsWith('@g.us');
    const inner = extractMessageContent(msg.message) || msg.message;
    const body = inner;
    const participanteJid = isGroup ? String(key.participant || '') : '';
    const remitente = (isGroup ? (this.contactos[participanteJid] && this.contactos[participanteJid].name) : (this.contactos[jid] && this.contactos[jid].name)) || msg.pushName || '';
    let texto = '';
    if (typeof body.conversation === 'string') texto = body.conversation;
    else if (body.extendedTextMessage && body.extendedTextMessage.text) texto = body.extendedTextMessage.text;
    else if (body.imageMessage && body.imageMessage.caption) texto = body.imageMessage.caption;
    else if (body.videoMessage && body.videoMessage.caption) texto = body.videoMessage.caption;
    else if (body.documentMessage && body.documentMessage.title) texto = body.documentMessage.title;
    else if (body.audioMessage) texto = '[Audio]';
    else if (body.stickerMessage) texto = '[Sticker]';
    else if (body.reactionMessage && body.reactionMessage.text) texto = '[Reacción]';
    else if (body.contactMessage && body.contactMessage.displayName) texto = '[Contacto] ' + body.contactMessage.displayName;
    const media = body.imageMessage || body.videoMessage || body.documentMessage || body.audioMessage || body.stickerMessage
      ? (body.imageMessage ? 'imagen' : body.videoMessage ? 'video' : body.documentMessage ? 'documento' : body.audioMessage ? 'audio' : 'sticker')
      : '';
    const mediaInfo = body.imageMessage || body.videoMessage || body.documentMessage || body.audioMessage || body.stickerMessage;
    const mediaMime = mediaInfo && mediaInfo.mimetype ? String(mediaInfo.mimetype) : '';
    const telefono = this.normalizarTelefono(isGroup ? this.resolverLid(participanteJid) : this.resolverLid(jid));
    const timestamp = Number(msg.messageTimestamp) * 1000 || Date.now();

    const TIPOS_CTX = ['extendedTextMessage', 'imageMessage', 'videoMessage', 'audioMessage', 'stickerMessage', 'documentMessage', 'contactMessage', 'locationMessage', 'productMessage'];
    const tipoCtx = (inner && TIPOS_CTX.find((k) => inner[k])) || '';
    const ctx = (tipoCtx && inner[tipoCtx].contextInfo) || (inner && inner.contextInfo) || {};
    const mentionIds = Array.isArray(ctx.mentionedJid) ? ctx.mentionedJid.filter((j) => j) : [];
    let replyId = String(ctx.stanzaId || '');
    let replyRemitente = '';
    let replyTexto = '';
    let replyMedia = '';
    if (ctx.quotedMessage) {
      const q = extractMessageContent(ctx.quotedMessage) || ctx.quotedMessage;
      replyMedia = q.imageMessage ? 'imagen' : q.videoMessage ? 'video' : q.audioMessage ? 'audio' : q.stickerMessage ? 'sticker' : q.documentMessage ? 'documento' : '';
      replyTexto = q.conversation
        || (q.extendedTextMessage && q.extendedTextMessage.text)
        || (q.imageMessage && q.imageMessage.caption)
        || (q.videoMessage && q.videoMessage.caption)
        || (q.documentMessage && q.documentMessage.title)
        || (q.contactMessage && q.contactMessage.displayName ? '[Contacto] ' + q.contactMessage.displayName : '')
        || '';
      if (!replyTexto && replyMedia) replyTexto = replyMedia === 'audio' ? '[Audio]' : replyMedia === 'sticker' ? '[Sticker]' : '[Adjunto]';
      const qj = String(ctx.participant || '');
      replyRemitente = (this.contactos[qj] && this.contactos[qj].name)
        || (this.contactos[this.resolverLid(qj)] && this.contactos[this.resolverLid(qj)].name)
        || this.normalizarTelefono(this.resolverLid(qj));
    }

    return {
      id: String(key.id || ''),
      jid,
      telefono,
      nombre: fromMe ? 'Yo' : (remitente || telefono),
      remitente,
      isGroup,
      fromMe,
      texto: texto.trim(),
      media,
      mediaMime,
      avatar: '',
      miembros: 0,
      participant: isGroup ? this.resolverLid(key.participant || '') : (key.participant || ''),
      mentionIds,
      replyId,
      replyRemitente,
      replyTexto,
      replyMedia,
      fecha: timestamp
    };
  }
}

module.exports = new WhatsAppService();
