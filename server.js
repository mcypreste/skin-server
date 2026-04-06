/**
 * Heeph Skin Server — Yggdrasil-compatible
 * Hospede em Railway/Render (gratuito) e aponte o launcher pra cá.
 * Todos os jogadores com Heeph Client vão ver as skins uns dos outros.
 */
const express  = require('express');
const multer   = require('multer');
const crypto   = require('crypto');
const fs       = require('fs');
const path     = require('path');

const PORT          = process.env.PORT || 3000;
const UPLOAD_SECRET = process.env.UPLOAD_SECRET || 'heeph-secret-123';
const DATA_DIR      = process.env.DATA_DIR || path.join(__dirname, 'data');
const TEXTURES_DIR  = path.join(DATA_DIR, 'textures');
const KEYS_DIR      = path.join(DATA_DIR, 'keys');
const MANIFEST_FILE = path.join(DATA_DIR, 'players.json');
const NEWS_FILE     = path.join(DATA_DIR, 'news.json');
const CHANGELOG_FILE= path.join(DATA_DIR, 'changelog.json');
const NEWS_WEBHOOK_KEY = process.env.NEWS_WEBHOOK_KEY || '';

fs.mkdirSync(TEXTURES_DIR, { recursive: true });
fs.mkdirSync(KEYS_DIR,     { recursive: true });

// ── RSA key pair (gerado 1x, salvo no disco) ──────────
const privKeyFile = path.join(KEYS_DIR, 'private.pem');
const pubKeyFile  = path.join(KEYS_DIR, 'public.pem');
let PRIVATE_KEY, PUBLIC_KEY;

if (!fs.existsSync(privKeyFile)) {
  console.log('Gerando chave RSA 4096-bit (pode demorar alguns segundos)...');
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 4096,
    publicKeyEncoding:  { type: 'spki',  format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  fs.writeFileSync(privKeyFile, privateKey);
  fs.writeFileSync(pubKeyFile,  publicKey);
  PRIVATE_KEY = privateKey;
  PUBLIC_KEY  = publicKey;
  console.log('Chave gerada.');
} else {
  PRIVATE_KEY = fs.readFileSync(privKeyFile, 'utf8');
  PUBLIC_KEY  = fs.readFileSync(pubKeyFile,  'utf8');
}

// ── Helpers ───────────────────────────────────────────
function readManifest() {
  try { return JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8')); } catch { return {}; }
}
function writeManifest(data) {
  fs.writeFileSync(MANIFEST_FILE, JSON.stringify(data, null, 2));
}

function readFeed(file) {
  try {
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Array.isArray(json)) return json;
    if (json && Array.isArray(json.items)) return json.items;
    return [];
  } catch {
    return [];
  }
}

function writeFeed(file, items) {
  fs.writeFileSync(file, JSON.stringify({ items }, null, 2));
}

function extractDiscordItem(body) {
  const content = String(body?.content || '').trim();
  const lines = content.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const embeds = Array.isArray(body?.embeds) ? body.embeds : [];
  const firstEmbed = embeds[0] || null;
  const title = (firstEmbed && String(firstEmbed.title || '').trim()) || (lines[0] || 'Update');
  const meta = (firstEmbed && String(firstEmbed.description || '').trim()) || (lines.slice(1).join(' ') || '');

  let image = '';
  if (firstEmbed?.image?.url) image = String(firstEmbed.image.url);
  else if (firstEmbed?.thumbnail?.url) image = String(firstEmbed.thumbnail.url);
  else if (Array.isArray(body?.attachments) && body.attachments[0]?.url) image = String(body.attachments[0].url);

  const badge = String(body?.username || '').trim();
  const url = String(firstEmbed?.url || '').trim();
  return {
    title,
    meta,
    image,
    badge,
    url,
    ts: Date.now(),
  };
}

function offlineUUID(name) {
  const b = crypto.createHash('md5').update('OfflinePlayer:' + name, 'utf8').digest();
  b[6] = (b[6] & 0x0f) | 0x30;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}

function stripDashes(uuid) { return uuid.replace(/-/g, ''); }

function buildSignedProfile(req, uuid, username, skinFile, model) {
  const proto = req.get('x-forwarded-proto') || req.protocol;
  const base = `${proto}://${req.get('host')}`;
  const skinUrl = `${base}/textures/${skinFile}`;

  const texturesObj = {
    timestamp:   Date.now(),
    profileId:   stripDashes(uuid),
    profileName: username,
    textures: {
      SKIN: {
        url: skinUrl,
        ...(model === 'slim' ? { metadata: { model: 'slim' } } : {}),
      },
    },
  };

  const value = Buffer.from(JSON.stringify(texturesObj)).toString('base64');
  const signer = crypto.createSign('RSA-SHA1');
  signer.update(value);
  const signature = signer.sign(PRIVATE_KEY, 'base64');

  return {
    id:   stripDashes(uuid),
    name: username,
    properties: [{ name: 'textures', value, signature }],
  };
}

// ── Express ───────────────────────────────────────────
const app    = express();
app.set('trust proxy', true);
const upload = multer({ dest: path.join(DATA_DIR, 'tmp') });
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/', (_req, res) => {
  res.json({ ok: true, server: 'Heeph Skin Server' });
});

app.get('/healthz', (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    console.log(`[HTTP] ${req.method} ${req.url} -> ${res.statusCode} (${ms}ms)`);
  });
  next();
});

// CORS para o launcher conseguir fazer requests
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

// ── Yggdrasil: configuração (authlib-injector lê aqui) ─
app.get('/.well-known/yggdrasil-configuration', (req, res) => {
  const base = `${req.protocol}://${req.get('host')}`;
  res.json({
    meta: {
      serverName: 'Heeph Skins',
      implementationName: 'heeph-skin-server',
      implementationVersion: '1.0',
      feature: { non_email_login: true },
    },
    skinDomains:      [req.get('host')],
    signaturePublickey: PUBLIC_KEY,
  });
});

// ── Yggdrasil: perfil do jogador (Minecraft busca a skin aqui) ─
app.get('/sessionserver/session/minecraft/profile/:uuid', (req, res) => {
  const manifest = readManifest();
  const rawUuid  = stripDashes(req.params.uuid);

  const entry = Object.values(manifest).find(e => stripDashes(e.uuid) === rawUuid);
  console.log(`[PROFILE] uuid=${rawUuid} found=${!!entry}`);
  if (!entry) return res.status(204).send();

  res.json(buildSignedProfile(req, entry.uuid, entry.username, entry.skinFile, entry.model || ''));
});

// ── Yggdrasil: busca por username (atalho útil) ─
app.get('/sessionserver/session/minecraft/profile/username/:name', (req, res) => {
  const manifest = readManifest();
  const entry = manifest[req.params.name.toLowerCase()];
  console.log(`[PROFILE] username=${req.params.name} found=${!!entry}`);
  if (!entry) return res.status(204).send();
  res.json(buildSignedProfile(req, entry.uuid, entry.username, entry.skinFile, entry.model || ''));
});

// ── Serve arquivos de textura ─
app.use('/textures', express.static(TEXTURES_DIR));

// ── Upload de skin (chamado pelo launcher) ─
app.post('/api/skin', upload.single('skin'), (req, res) => {
  const { username, secret, model } = req.body;

  if (!req.file)   return res.status(400).json({ ok: false, error: 'skin PNG obrigatória' });
  if (!username)   return res.status(400).json({ ok: false, error: 'username obrigatório' });
  if (secret !== UPLOAD_SECRET) {
    fs.unlinkSync(req.file.path);
    return res.status(403).json({ ok: false, error: 'secret inválido' });
  }

  const key      = username.toLowerCase();
  const skinFile = `${key}.png`;
  const dest     = path.join(TEXTURES_DIR, skinFile);

  try {
    fs.renameSync(req.file.path, dest);
  } catch {
    fs.copyFileSync(req.file.path, dest);
    fs.unlinkSync(req.file.path);
  }

  const manifest  = readManifest();
  manifest[key] = {
    username,
    uuid:      offlineUUID(username),
    skinFile,
    model:     model || '',
    updatedAt: Date.now(),
  };
  writeManifest(manifest);

  console.log(`[SKIN] ${username} → ${skinFile}`);
  res.json({ ok: true, uuid: offlineUUID(username) });
});

app.get('/api/news', (req, res) => {
  res.json({ ok: true, items: readFeed(NEWS_FILE) });
});

app.get('/api/changelog', (req, res) => {
  res.json({ ok: true, items: readFeed(CHANGELOG_FILE) });
});

function requireAdminKey(req, res) {
  const key = String(req.query.key || req.headers['x-heeph-key'] || '').trim();
  if (NEWS_WEBHOOK_KEY && key !== NEWS_WEBHOOK_KEY) {
    res.status(403).json({ ok: false });
    return false;
  }
  return true;
}

app.get('/api/admin/feed/:kind', (req, res) => {
  if (!requireAdminKey(req, res)) return;
  const kind = String(req.params.kind || '').toLowerCase() === 'changelog' ? 'changelog' : 'news';
  const file = kind === 'changelog' ? CHANGELOG_FILE : NEWS_FILE;
  res.json({ ok: true, items: readFeed(file) });
});

app.post('/api/admin/feed/:kind/remove', (req, res) => {
  if (!requireAdminKey(req, res)) return;
  const kind = String(req.params.kind || '').toLowerCase() === 'changelog' ? 'changelog' : 'news';
  const file = kind === 'changelog' ? CHANGELOG_FILE : NEWS_FILE;
  const ts = Number(req.body?.ts || 0);
  if (!ts) return res.status(400).json({ ok: false, msg: 'ts obrigatório' });

  const items = readFeed(file);
  const next = items.filter((i) => Number(i?.ts || 0) !== ts);
  writeFeed(file, next);
  res.json({ ok: true, removed: items.length - next.length });
});

app.post('/webhook/news', (req, res) => {
  if (!requireAdminKey(req, res)) return;
  const item = extractDiscordItem(req.body);
  const items = readFeed(NEWS_FILE);
  items.unshift(item);
  writeFeed(NEWS_FILE, items.slice(0, 30));
  res.json({ ok: true });
});

app.post('/webhook/changelog', (req, res) => {
  if (!requireAdminKey(req, res)) return;
  const item = extractDiscordItem(req.body);
  const items = readFeed(CHANGELOG_FILE);
  items.unshift(item);
  writeFeed(CHANGELOG_FILE, items.slice(0, 60));
  res.json({ ok: true });
});

// ── Stub mínimo: hasJoined (para servidores em online-mode) ─
app.get('/sessionserver/session/minecraft/hasJoined', (req, res) => {
  const { username } = req.query;
  if (!username) return res.status(204).send();
  const manifest = readManifest();
  const entry    = manifest[username.toLowerCase()];
  if (!entry) return res.status(204).send();
  res.json(buildSignedProfile(req, entry.uuid, entry.username, entry.skinFile, entry.model || ''));
});

app.listen(PORT, () => {
  console.log(`Heeph Skin Server rodando em :${PORT}`);
  console.log(`UPLOAD_SECRET: ${UPLOAD_SECRET}`);
});
