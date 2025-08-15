import { app, BrowserWindow, ipcMain, dialog, systemPreferences } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import keytar from 'keytar';

const KEYTAR_SERVICE = 'PrivateTodo';
const KEYTAR_ACCOUNT = 'encryption-key';

// ----- ESM-safe pathing (critical fix) -----
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow;
const isDev = process.env.NODE_ENV === 'development';

const ARCHIVE_THRESHOLD = 2000; // move old completed tasks to archive past this count

const userDataDir = app.getPath('userData');
const dbPath = path.join(userDataDir, 'db.json');
const archivePath = path.join(userDataDir, 'archive.json');
const settingsPath = path.join(userDataDir, 'settings.json');

// Session-only key
let sessionKey = null;

const defaultSettings = {
  version: 1,
  encryptionEnabled: false,
  useBiometrics: false,
  kdf: { algo: 'scrypt', N: 16384, r: 8, p: 1, keyLen: 32, salt: null },
};

const defaultDB = {
  version: 1,
  createdAt: new Date().toISOString(),
  projects: [{ id: 'inbox', name: 'Inbox', createdAt: new Date().toISOString() }],
  tasks: [],
};

app.whenReady().then(async () => {
  await ensureFiles();
  await createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'Todoist Offline',
    webPreferences: {
      contextIsolation: true,
      // !!! Use __dirname-based absolute path for preload
      preload: path.join(__dirname, 'preload.cjs'),
      sandbox: false,
    },
    frame: false,
    backgroundColor: '#111418',
  });
  // !!! Use __dirname to load the renderer HTML
  await mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });
}

/* ---------- File helpers ---------- */
async function ensureFiles() {
  if (!existsSync(userDataDir)) await fs.mkdir(userDataDir, { recursive: true });
  if (!existsSync(settingsPath)) await writeSettings(defaultSettings);
  if (!existsSync(dbPath)) await writeJSONFile(dbPath, defaultDB, false);
}

async function readSettings() {
  const raw = await fs.readFile(settingsPath, 'utf8');
  return JSON.parse(raw);
}
async function writeSettings(s) {
  await atomicWrite(settingsPath, JSON.stringify(s, null, 2));
}

async function readJSONFile(file, encrypted) {
  if (!existsSync(file)) return null;
  const raw = await fs.readFile(file, 'utf8');
  const obj = JSON.parse(raw);
  if (encrypted) {
    if (!obj || obj._enc !== true) throw new Error('Expected encrypted file');
    if (!sessionKey) throw new Error('Locked: no session key');
    return decryptPayload(obj, sessionKey);
  }
  return obj;
}
async function writeJSONFile(file, data, encrypted) {
  if (encrypted) {
    if (!sessionKey) throw new Error('Locked: no session key');
    const payload = encryptPayload(data, sessionKey);
    await atomicWrite(file, JSON.stringify(payload, null, 2));
  } else {
    await atomicWrite(file, JSON.stringify(data, null, 2));
  }
}
async function atomicWrite(file, contents) {
  const tmp = path.join(path.dirname(file), `${path.basename(file)}.${Date.now()}.tmp`);
  await fs.writeFile(tmp, contents, 'utf8');
  await fs.rename(tmp, file);
}

/* ---------- Crypto ---------- */
function encryptPayload(obj, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(obj), 'utf8');
  const enc = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    _enc: true,
    algo: 'aes-256-gcm',
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: enc.toString('base64'),
  };
}
function decryptPayload(payload, key) {
  const iv = Buffer.from(payload.iv, 'base64');
  const tag = Buffer.from(payload.tag, 'base64');
  const data = Buffer.from(payload.data, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(data), decipher.final()]);
  return JSON.parse(dec.toString('utf8'));
}
async function deriveKey(pass, settings) {
  if (!settings.kdf?.salt) throw new Error('Missing KDF salt');
  const salt = Buffer.from(settings.kdf.salt, 'base64');
  return new Promise((resolve, reject) => {
    crypto.scrypt(
      pass,
      salt,
      settings.kdf.keyLen,
      { N: settings.kdf.N, r: settings.kdf.r, p: settings.kdf.p },
      (err, derived) => {
        if (err) reject(err);
        else resolve(derived);
      },
    );
  });
}

/* ---------- DB merge & archive ---------- */
async function loadAllData(settings) {
  const enc = !!settings.encryptionEnabled;
  const current = (await readJSONFile(dbPath, enc)) ?? structuredClone(defaultDB);
  let archive = { version: 1, createdAt: current.createdAt, projects: [], tasks: [] };
  if (existsSync(archivePath)) archive = await readJSONFile(archivePath, enc);
  const projMap = new Map();
  [...(archive.projects || []), ...(current.projects || [])].forEach((p) => projMap.set(p.id, p));
  const projects = [...projMap.values()];
  const tasks = [...(current.tasks || []), ...(archive.tasks || [])];
  return { projects, tasks, current, archive };
}
async function saveCurrentAndMaybeArchive(settings, merged) {
  const enc = !!settings.encryptionEnabled;
  let current = merged.current;
  let archive = merged.archive;
  if ((current.tasks?.length || 0) > ARCHIVE_THRESHOLD) {
    const overflow = current.tasks.length - ARCHIVE_THRESHOLD;
    const completed = current.tasks
      .filter((t) => t.completed)
      .sort(
        (a, b) =>
          new Date(a.dateCompleted || a.createdAt) - new Date(b.dateCompleted || b.createdAt),
      );
    const toMove = completed.slice(0, Math.max(0, overflow));
    if (toMove.length) {
      const moveIds = new Set(toMove.map((t) => t.id));
      current.tasks = current.tasks.filter((t) => !moveIds.has(t.id));
      archive.tasks = [...(archive.tasks || []), ...toMove];
      if (!archive.version) archive.version = 1;
      if (!archive.createdAt) archive.createdAt = new Date().toISOString();
    }
  }
  await writeJSONFile(dbPath, current, enc);
  if ((archive.tasks?.length || 0) > 0 || existsSync(archivePath)) {
    await writeJSONFile(archivePath, archive, enc);
  }
}

/* ---------- Biometrics ---------- */
function biometricsAvailable() {
  try {
    return (
      process.platform === 'darwin' &&
      typeof systemPreferences.canPromptTouchID === 'function' &&
      systemPreferences.canPromptTouchID()
    );
  } catch {
    return false;
  }
}

/* ---------- IPC ---------- */

// Settings / Security
ipcMain.handle('security:getConfig', async () => {
  const s = await readSettings();
  return {
    encryptionEnabled: s.encryptionEnabled,
    useBiometrics: s.useBiometrics,
    biometricsAvailable: biometricsAvailable(),
  };
});

ipcMain.handle('security:enable', async (_evt, { passcode, useBiometrics }) => {
  let s = await readSettings();
  if (s.encryptionEnabled) return { ok: true }; // already on
  // create salt
  s.kdf.salt = crypto.randomBytes(16).toString('base64');
  const key = await deriveKey(passcode, s);
  sessionKey = key; // keep in-memory
  s.encryptionEnabled = true;
  s.useBiometrics = !!useBiometrics && biometricsAvailable();
  await writeSettings(s);

  // Store key in Keychain if biometrics chosen
  if (s.useBiometrics) {
    try {
      await keytar.setPassword(KEYTAR_SERVICE, KEYTAR_ACCOUNT, key.toString('base64'));
    } catch (e) {
      console.warn('Keychain save failed, continuing without biometrics key:', e);
      s.useBiometrics = false;
      await writeSettings(s);
    }
  }

  // Encrypt existing files
  const currentPlain = existsSync(dbPath)
    ? JSON.parse(await fs.readFile(dbPath, 'utf8'))
    : structuredClone(defaultDB);
  await writeJSONFile(dbPath, currentPlain, true);

  if (existsSync(archivePath)) {
    const archPlain = JSON.parse(await fs.readFile(archivePath, 'utf8'));
    await writeJSONFile(archivePath, archPlain, true);
  }
  return { ok: true };
});

ipcMain.handle('security:disable', async () => {
  // Not exposed in UI by default; left for completeness
  let s = await readSettings();
  if (!s.encryptionEnabled) return { ok: true };
  if (!sessionKey) throw new Error('Unlock required to disable encryption');

  // Decrypt files and rewrite plaintext
  const current = await readJSONFile(dbPath, true);
  await writeJSONFile(dbPath, current, false);
  if (existsSync(archivePath)) {
    const arch = await readJSONFile(archivePath, true);
    await writeJSONFile(archivePath, arch, false);
  }
  s.encryptionEnabled = false;
  s.useBiometrics = false;
  await writeSettings(s);
  try {
    await keytar.deletePassword(KEYTAR_SERVICE, KEYTAR_ACCOUNT);
  } catch {
    console.warn('Keychain delete failed, continuing without biometrics key');
  }
  sessionKey = null;
  return { ok: true };
});

ipcMain.handle('security:unlock', async (_evt, { passcode }) => {
  const s = await readSettings();
  if (!s.encryptionEnabled) return { ok: true }; // nothing to unlock

  let key = null;
  if (s.useBiometrics && biometricsAvailable()) {
    try {
      await systemPreferences.promptTouchID('Unlock your tasks'); // UI gate
      const stored = await keytar.getPassword(KEYTAR_SERVICE, KEYTAR_ACCOUNT);
      if (stored) {
        key = Buffer.from(stored, 'base64');
        sessionKey = key;
      }
    } catch (e) {
      // Prompt canceled or Keychain failure; will fall back to passcode.
    }
  }
  if (!sessionKey) {
    // Fallback: derive from passcode
    key = await deriveKey(passcode, s);
    sessionKey = key;
  }

  // 2) Try to read encrypted DB. If it fails, migrate plaintext (if any) to encrypted using the key we just set.
  try {
    if (existsSync(dbPath)) {
      await readJSONFile(dbPath, true); // just a validation read
    } else {
      // No file -> create encrypted default
      await writeJSONFile(dbPath, defaultDB, true);
    }
  } catch {
    // Likely plaintext from a prior run; migrate it
    if (existsSync(dbPath)) {
      const plain = JSON.parse(await fs.readFile(dbPath, 'utf8'));
      await writeJSONFile(dbPath, plain, true);
    } else {
      await writeJSONFile(dbPath, defaultDB, true);
    }
  }

  // Same migration logic for archive file (if present)
  if (existsSync(archivePath)) {
    try {
      await readJSONFile(archivePath, true);
    } catch {
      const plainArc = JSON.parse(await fs.readFile(archivePath, 'utf8'));
      await writeJSONFile(archivePath, plainArc, true);
    }
  }

  return { ok: true };
});

ipcMain.handle('security:lock', async () => {
  sessionKey = null;
  return { ok: true };
});

// Projects
ipcMain.handle('project:add', async (_evt, name) => {
  const s = await readSettings();
  const merged = await loadAllData(s);
  const id = `proj_${randId()}`;
  merged.current.projects.push({ id, name, createdAt: new Date().toISOString() });
  await saveCurrentAndMaybeArchive(s, merged);
  return { id, name };
});
ipcMain.handle('project:rename', async (_evt, { id, name }) => {
  const s = await readSettings();
  const merged = await loadAllData(s);
  const inCurrent = merged.current.projects.find((p) => p.id === id);
  const inArchive = merged.archive.projects?.find((p) => p.id === id);
  const target = inCurrent || inArchive;
  if (!target) throw new Error('Project not found');
  target.name = name;
  await saveCurrentAndMaybeArchive(s, merged);
  return true;
});
ipcMain.handle('project:delete', async (_evt, id) => {
  if (id === 'inbox') throw new Error('Cannot delete Inbox');
  const s = await readSettings();
  const merged = await loadAllData(s);
  merged.current.tasks.forEach((t) => {
    if (t.projectId === id) t.projectId = 'inbox';
  });
  merged.archive.tasks.forEach((t) => {
    if (t.projectId === id) t.projectId = 'inbox';
  });
  merged.current.projects = merged.current.projects.filter((p) => p.id !== id);
  merged.archive.projects = (merged.archive.projects || []).filter((p) => p.id !== id);
  await saveCurrentAndMaybeArchive(s, merged);
  return true;
});

// Tasks
ipcMain.handle('task:add', async (_evt, task) => {
  const s = await readSettings();
  const merged = await loadAllData(s);
  const id = `task_${randId()}`;
  const now = new Date().toISOString();
  const newTask = {
    id,
    title: task.title?.trim() || 'Untitled',
    description: task.description?.trim() || '',
    projectId: task.projectId || 'inbox',
    dueDate: task.dueDate || null,
    priority: clampPriority(task.priority),
    tags: Array.isArray(task.tags) ? sanitizeTags(task.tags) : [],
    completed: false,
    dateCompleted: null,
    createdAt: now,
    updatedAt: now,
  };
  merged.current.tasks.push(newTask);
  await saveCurrentAndMaybeArchive(s, merged);
  return newTask;
});

ipcMain.handle('task:update', async (_evt, partial) => {
  const s = await readSettings();
  const merged = await loadAllData(s);

  const findTask = (id) =>
    merged.current.tasks.find((t) => t.id === id) || merged.archive.tasks.find((t) => t.id === id);
  const t = findTask(partial.id);
  if (!t) throw new Error('Task not found');

  if (typeof partial.title === 'string') t.title = partial.title.trim();
  if (typeof partial.description === 'string') t.description = partial.description.trim();
  if (typeof partial.projectId === 'string') t.projectId = partial.projectId;
  if (typeof partial.dueDate !== 'undefined') t.dueDate = partial.dueDate;
  if (typeof partial.priority !== 'undefined') t.priority = clampPriority(partial.priority);
  if (Array.isArray(partial.tags)) t.tags = sanitizeTags(partial.tags);
  if (typeof partial.completed === 'boolean') {
    t.completed = partial.completed;
    t.dateCompleted = t.completed ? new Date().toISOString() : null;
  }
  t.updatedAt = new Date().toISOString();

  await saveCurrentAndMaybeArchive(s, merged);
  return t;
});

ipcMain.handle('task:delete', async (_evt, id) => {
  const s = await readSettings();
  const merged = await loadAllData(s);
  const beforeLen = merged.current.tasks.length + merged.archive.tasks.length;
  merged.current.tasks = merged.current.tasks.filter((t) => t.id !== id);
  merged.archive.tasks = merged.archive.tasks.filter((t) => t.id !== id);
  if (beforeLen === merged.current.tasks.length + merged.archive.tasks.length)
    throw new Error('Task not found');
  await saveCurrentAndMaybeArchive(s, merged);
  return true;
});

// DB: load merged view (current + archive)
ipcMain.handle('db:load', async () => {
  const s = await readSettings();
  const merged = await loadAllData(s);
  return {
    settings: { encryptionEnabled: s.encryptionEnabled, useBiometrics: s.useBiometrics },
    projects: merged.projects,
    tasks: merged.tasks,
  };
});

/* ---------- Backup / Restore ---------- */
/** Exports a single file:
 * {
 *   version:1,
 *   encryptionEnabled:boolean,
 *   settings:{kdf...},
 *   blob:{ current: <encryptedOrPlain>, archive: <encryptedOrPlain|null> }
 * }
 */
ipcMain.handle('backup:export', async () => {
  const s = await readSettings();
  const { filePath, canceled } = await dialog.showSaveDialog({
    title: 'Export Backup',
    defaultPath: path.join(os.homedir(), 'todoist-offline-backup.json'),
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (canceled || !filePath) return { ok: false };

  const backup = {
    version: 1,
    encryptionEnabled: s.encryptionEnabled,
    settings: s,
    blob: { current: null, archive: null },
  };
  if (s.encryptionEnabled) {
    // just copy encrypted files verbatim
    const curRaw = existsSync(dbPath) ? JSON.parse(await fs.readFile(dbPath, 'utf8')) : null;
    const arcRaw = existsSync(archivePath)
      ? JSON.parse(await fs.readFile(archivePath, 'utf8'))
      : null;
    backup.blob.current = curRaw;
    if (arcRaw) backup.blob.archive = arcRaw;
  } else {
    // copy plaintext as-is
    backup.blob.current = existsSync(dbPath)
      ? JSON.parse(await fs.readFile(dbPath, 'utf8'))
      : defaultDB;
    backup.blob.archive = existsSync(archivePath)
      ? JSON.parse(await fs.readFile(archivePath, 'utf8'))
      : null;
  }

  await fs.writeFile(filePath, JSON.stringify(backup, null, 2), 'utf8');
  return { ok: true, filePath };
});

ipcMain.handle('backup:import', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'Restore Backup',
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (canceled || !filePaths?.length) return { ok: false };

  const raw = await fs.readFile(filePaths[0], 'utf8');
  const parsed = JSON.parse(raw);

  if (!parsed || !parsed.version || !parsed.blob) throw new Error('Invalid backup file');
  const s = await readSettings();

  // If backup was encrypted but app is not (or vice versa), we still write files accordingly
  if (parsed.encryptionEnabled) {
    // Write encrypted payloads directly
    await atomicWrite(dbPath, JSON.stringify(parsed.blob.current, null, 2));
    if (parsed.blob.archive)
      await atomicWrite(archivePath, JSON.stringify(parsed.blob.archive, null, 2));
  } else {
    // Write plaintext (and if app uses encryption now, we’ll re-encrypt on write)
    await writeJSONFile(dbPath, parsed.blob.current, s.encryptionEnabled);
    if (parsed.blob.archive)
      await writeJSONFile(archivePath, parsed.blob.archive, s.encryptionEnabled);
  }

  return { ok: true };
});

/* ---------- Utils ---------- */
function randId() {
  return Math.random().toString(36).slice(2, 10);
}
function clampPriority(p) {
  const n = Number(p);
  return Number.isNaN(n) ? 0 : Math.max(0, Math.min(3, Math.floor(n)));
}
function sanitizeTags(tags) {
  return tags
    .map((t) => String(t).trim())
    .filter(Boolean)
    .slice(0, 20);
}
