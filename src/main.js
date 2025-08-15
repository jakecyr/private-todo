import { app, BrowserWindow, ipcMain, systemPreferences, dialog } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import crypto from 'node:crypto';
import keytar from 'keytar';
import os from 'node:os';

console.log('=== MAIN PROCESS STARTED ===');
console.log('Console.log is working in main process');

const KEYTAR_SERVICE = 'PrivateTodo';
const KEYTAR_ACCOUNT = 'encryption-key';

// ----- ESM-safe pathing (critical fix) -----
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let mainWindow;
const isDev = process.env.NODE_ENV === 'development';

const ARCHIVE_THRESHOLD = 2000; // move old completed tasks to archive past this count

const userDataDir = app.getPath('userData');
const dbPath = join(userDataDir, 'db.json');
const archivePath = join(userDataDir, 'archive.json');
const settingsPath = join(userDataDir, 'settings.json');

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
  console.log('App is ready, initializing...');
  await ensureFiles();
  console.log('Files ensured, creating window...');
  await createWindow();
  console.log('Window created, setting up app events...');
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
  console.log('App initialization complete');
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

async function createWindow() {
  console.log('Creating main window...');
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 800,
    minHeight: 600,
    title: 'Private Todo',
    webPreferences: {
      contextIsolation: true,
      // !!! Use __dirname-based absolute path for preload
      preload: join(__dirname, 'preload.cjs'),
      sandbox: false,
    },
    frame: false,
    backgroundColor: '#111418',
  });
  // !!! Use __dirname to load the renderer HTML
  await mainWindow.loadFile(join(__dirname, 'renderer', 'index.html'));
  console.log('Main window loaded successfully');
  if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });
}

/* ---------- File helpers ---------- */
async function ensureFiles() {
  console.log('Ensuring files exist...');
  if (!existsSync(userDataDir)) {
    console.log('Creating user data directory');
    await fs.mkdir(userDataDir, { recursive: true });
  }
  if (!existsSync(settingsPath)) {
    console.log('Creating default settings');
    await writeSettings(defaultSettings);
  }
  if (!existsSync(dbPath)) {
    console.log('Creating default database with structure:', defaultDB);
    await writeJSONFile(dbPath, defaultDB, false);
  }
  console.log('Files ensured successfully');
}

async function readSettings() {
  const raw = await fs.readFile(settingsPath, 'utf8');
  return JSON.parse(raw);
}
async function writeSettings(s) {
  await atomicWrite(settingsPath, JSON.stringify(s, null, 2));
}

async function readJSONFile(file, encrypted) {
  if (!existsSync(file)) {
    console.log(`File does not exist: ${file}`);
    return null;
  }

  try {
    const raw = await fs.readFile(file, 'utf8');
    const obj = JSON.parse(raw);

    console.log(`readJSONFile ${file}:`, {
      encrypted,
      hasData: !!obj,
      dataType: typeof obj,
      hasProjects: !!obj?.projects,
      projectsCount: obj?.projects?.length || 0,
    });

    if (encrypted) {
      if (!obj || obj._enc !== true) throw new Error('Expected encrypted file');
      if (!sessionKey) throw new Error('Locked: no session key');
      return decryptPayload(obj, sessionKey);
    }
    return obj;
  } catch (error) {
    console.error(`Error reading JSON file ${file}:`, error);
    throw error;
  }
}
async function writeJSONFile(file, data, encrypted) {
  console.log(`writeJSONFile ${file}:`, {
    encrypted,
    hasData: !!data,
    dataType: typeof data,
    hasProjects: !!data?.projects,
    projectsCount: data?.projects?.length || 0,
  });

  if (encrypted) {
    if (!sessionKey) throw new Error('Locked: no session key');
    const payload = encryptPayload(data, sessionKey);
    await atomicWrite(file, JSON.stringify(payload, null, 2));
  } else {
    await atomicWrite(file, JSON.stringify(data, null, 2));
  }

  console.log(`writeJSONFile ${file} completed successfully`);
}
async function atomicWrite(file, contents) {
  const tmp = join(dirname(file), `${basename(file)}.${Date.now()}.tmp`);
  console.log(`atomicWrite ${file}:`, {
    tmpFile: tmp,
    contentLength: contents?.length || 0,
  });

  try {
    await fs.writeFile(tmp, contents, 'utf8');
    await fs.rename(tmp, file);
    console.log(`atomicWrite ${file} completed successfully`);
  } catch (error) {
    console.error(`atomicWrite ${file} failed:`, error);
    // Clean up temp file if it exists
    try {
      if (existsSync(tmp)) await fs.unlink(tmp);
    } catch (cleanupError) {
      console.warn('Failed to cleanup temp file:', cleanupError);
    }
    throw error;
  }
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

  console.log('loadAllData - raw data:', {
    hasCurrent: !!current,
    currentProjects: current?.projects,
    currentProjectsLength: current?.projects?.length || 0,
    hasArchive: !!archive,
    archiveProjects: archive?.projects,
    archiveProjectsLength: archive?.projects?.length || 0,
  });

  const projMap = new Map();
  [...(archive.projects || []), ...(current.projects || [])].forEach((p) => projMap.set(p.id, p));
  const projects = [...projMap.values()];
  const tasks = [...(current.tasks || []), ...(archive.tasks || [])];

  console.log('loadAllData - merged result:', {
    projectsCount: projects.length,
    tasksCount: tasks.length,
    currentProjectsCount: current.projects?.length || 0,
    archiveProjectsCount: archive.projects?.length || 0,
  });

  return { projects, tasks, current, archive };
}
async function saveCurrentAndMaybeArchive(settings, merged) {
  const enc = !!settings.encryptionEnabled;
  let current = merged.current;
  let archive = merged.archive;

  console.log('saveCurrentAndMaybeArchive - input:', {
    hasCurrent: !!current,
    currentProjectsCount: current?.projects?.length || 0,
    currentTasksCount: current?.tasks?.length || 0,
    hasArchive: !!archive,
    archiveProjectsCount: archive?.projects?.length || 0,
    archiveTasksCount: archive?.tasks?.length || 0,
    encryptionEnabled: enc,
  });

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

  console.log('About to write current DB with projects count:', current.projects?.length || 0);
  await writeJSONFile(dbPath, current, enc);
  console.log('Current DB written successfully');

  if ((archive.tasks?.length || 0) > 0 || existsSync(archivePath)) {
    console.log('About to write archive with projects count:', archive.projects?.length || 0);
    await writeJSONFile(archivePath, archive, enc);
    console.log('Archive written successfully');
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
  console.log('=== SECURITY UNLOCK CALLED ===');
  console.log('Event data:', _evt);
  
  const s = await readSettings();
  console.log('Settings loaded:', s);
  
  if (!s.encryptionEnabled) return { ok: true }; // nothing to unlock

  console.log('Security unlock called with:', { 
    hasPasscode: !!passcode, 
    useBiometrics: s.useBiometrics, 
    biometricsAvailable: biometricsAvailable(),
    settings: s
  });

  let key = null;
  let biometricsAttempted = false;

  // Try biometrics first if enabled and available and no passcode provided
  if (!passcode && s.useBiometrics && biometricsAvailable()) {
    biometricsAttempted = true;
    console.log('Biometrics are enabled and available, attempting biometric unlock...');
    try {
      console.log('About to prompt Touch ID...');
      await systemPreferences.promptTouchID('Unlock your tasks'); // UI gate
      console.log('Touch ID prompt completed successfully');
      
      console.log('About to access keychain...');
      const stored = await keytar.getPassword(KEYTAR_SERVICE, KEYTAR_ACCOUNT);
      console.log('Keychain access result:', { hasStored: !!stored, storedLength: stored?.length });
      
      if (stored) {
        console.log('Stored key found, converting to buffer...');
        key = Buffer.from(stored, 'base64');
        sessionKey = key;
        console.log('Unlocked successfully with biometrics, sessionKey set');
        return { ok: true, method: 'biometrics' };
      } else {
        console.log('No stored key found in keychain - returning NO_BIO_KEY without falling back');
        return { ok: false, code: 'NO_BIO_KEY', reason: 'Missing keychain entry' };
      }
    } catch (e) {
      console.log('Biometrics failed with error:', e.message);
      console.log('Error details:', e);
      console.log('Error stack:', e.stack);
      // Prompt canceled or Keychain failure; will fall back to passcode.
    }
  } else {
    console.log('Biometrics not available or not enabled:', { 
      useBiometrics: s.useBiometrics, 
      biometricsAvailable: biometricsAvailable() 
    });
  }

  // Fallback: derive from passcode (only if biometrics failed or not enabled)
  if (!passcode) {
    console.log('No passcode provided after biometric path; returning NEED_PASSCODE');
    return { ok: false, code: 'NEED_PASSCODE' };
  }

  console.log('Attempting passcode unlock...');
  key = await deriveKey(passcode, s);
  sessionKey = key;
  console.log('Unlocked successfully with passcode');
  
  // If biometrics are enabled, try to re-encrypt the key with biometrics after successful passcode unlock
  if (s.useBiometrics && biometricsAvailable()) {
    try {
      console.log('Attempting to re-encrypt key with biometrics after successful passcode unlock...');
      await keytar.setPassword(KEYTAR_SERVICE, KEYTAR_ACCOUNT, key.toString('base64'));
      console.log('Successfully re-encrypted key with biometrics');
      
      // Update settings to ensure biometrics flag is set
      if (!s.useBiometrics) {
        s.useBiometrics = true;
        await writeSettings(s);
        console.log('Updated settings to enable biometrics');
      }
    } catch (e) {
      console.log('Failed to re-encrypt key with biometrics:', e.message);
      // Don't fail the unlock - user can still use passcode
    }
  }
  
  return { ok: true, method: 'passcode' };
});

ipcMain.handle('security:lock', async () => {
  sessionKey = null;
  return { ok: true };
});

// Projects

ipcMain.handle('project:add', async (_evt, name) => {
  try {
    const s = await readSettings();
    const merged = await loadAllData(s);
    const nm = String(name || '').trim();
    if (!nm) throw new Error('Project name required');

    console.log('Project add - merged data:', {
      hasCurrent: !!merged.current,
      hasProjects: !!merged.current?.projects,
      projectsLength: merged.current?.projects?.length || 0,
      archiveProjectsLength: merged.archive?.projects?.length || 0,
    });

    // prevent dup by name (case-insensitive)
    const exists = [...(merged.current.projects || []), ...(merged.archive.projects || [])].some(
      (p) => p?.name?.toLowerCase() === nm.toLowerCase(),
    );
    if (exists) throw new Error('A project with that name already exists');

    if (!Array.isArray(merged.current.projects)) {
      console.log('Initializing projects array');
      merged.current.projects = [];
    }
    const id = `proj_${randId()}`;
    const newProject = { id, name: nm, createdAt: new Date().toISOString() };
    merged.current.projects.push(newProject);

    console.log('About to save, projects count:', merged.current.projects.length);
    await saveCurrentAndMaybeArchive(s, merged);
    console.log('Project saved successfully');

    return { id, name: nm };
  } catch (error) {
    console.error('Project add error:', error);
    throw error;
  }
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
  try {
    const s = await readSettings();
    const merged = await loadAllData(s);

    const result = {
      settings: { encryptionEnabled: s.encryptionEnabled, useBiometrics: s.useBiometrics },
      projects: merged.projects,
      tasks: merged.tasks,
    };

    console.log('db:load returning:', {
      hasSettings: !!result.settings,
      projectsCount: result.projects?.length || 0,
      tasksCount: result.tasks?.length || 0,
      projects: result.projects,
    });

    return result;
  } catch (error) {
    console.error('db:load error:', error);
    throw error;
  }
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
    defaultPath: join(os.homedir(), 'private-todo-offline-backup.json'),
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

// Allow starting fresh if passcode is lost
ipcMain.handle('env:reset', async () => {
  try {
    // remove data files if they exist
    await Promise.all([
      fs.unlink(dbPath).catch(() => {}),
      fs.unlink(archivePath).catch(() => {}),
      fs.unlink(settingsPath).catch(() => {}),
    ]);

    // remove any stored key and in-memory session
    try {
      await keytar.deletePassword(KEYTAR_SERVICE, KEYTAR_ACCOUNT);
    } catch {
      console.warn('Keychain delete failed during env reset');
    }
    sessionKey = null;

    // recreate default files
    await ensureFiles();
    return { ok: true };
  } catch (error) {
    console.error('env:reset error', error);
    throw error;
  }
});

/* ---------- Utils ---------- */
function randId() {
  const id = Math.random().toString(36).slice(2, 10);
  console.log('Generated ID:', id);
  return id;
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
