import fs from 'fs/promises';
import path from 'path';

const BASE_DIR = process.cwd();
const OUTPUT_DIR = path.join(BASE_DIR, 'novels');
const TASKS_FILE = path.join(BASE_DIR, 'tasks.json');
const META_FILE = path.join(BASE_DIR, 'library_meta.json');

// Ensure directories and files exist
export async function initData() {
  try { await fs.mkdir(OUTPUT_DIR, { recursive: true }); } catch (e) {}
  try { await fs.access(TASKS_FILE); } catch (e) { await fs.writeFile(TASKS_FILE, '{}', 'utf-8'); }
  try { await fs.access(META_FILE); } catch (e) { await fs.writeFile(META_FILE, '{}', 'utf-8'); }
}

let tasksLock = Promise.resolve();
let metaLock = Promise.resolve();

export async function updateTasks(updater: (tasks: Record<string, any>) => void): Promise<void> {
  const unlock = await acquireLock('tasks');
  try {
    let tasks: Record<string, any> = {};
    try {
      const data = await fs.readFile(TASKS_FILE, 'utf-8');
      tasks = JSON.parse(data);
    } catch(e) {}
    updater(tasks);
    await fs.writeFile(TASKS_FILE, JSON.stringify(tasks, null, 2), 'utf-8');
  } finally {
    unlock();
  }
}

export async function readTasks(): Promise<Record<string, any>> {
  const unlock = await acquireLock('tasks');
  try {
    try {
      const data = await fs.readFile(TASKS_FILE, 'utf-8');
      return JSON.parse(data);
    } catch (e) {
      return {};
    }
  } finally {
    unlock();
  }
}

export async function writeTasks(tasks: Record<string, any>): Promise<void> {
  const unlock = await acquireLock('tasks');
  try {
    await fs.writeFile(TASKS_FILE, JSON.stringify(tasks, null, 2), 'utf-8');
  } finally {
    unlock();
  }
}

export async function getTask(taskId: string): Promise<any | undefined> {
  const tasks = await readTasks();
  return tasks[taskId];
}

export async function saveTask(taskId: string, task: any): Promise<void> {
  await updateTasks(tasks => {
    tasks[taskId] = task;
  });
}

export async function appendTaskLog(taskId: string, msg: string): Promise<void> {
  await updateTasks(tasks => {
    if (tasks[taskId]) {
      const time = new Date().toLocaleTimeString('en-US', { hour12: false });
      tasks[taskId].log.push(`[${time}] ${msg}`);
    }
  });
}

export async function updateMeta(updater: (meta: Record<string, any>) => void): Promise<void> {
  const unlock = await acquireLock('meta');
  try {
    let meta: Record<string, any> = {};
    try {
      const data = await fs.readFile(META_FILE, 'utf-8');
      meta = JSON.parse(data);
    } catch(e) {}
    updater(meta);
    await fs.writeFile(META_FILE, JSON.stringify(meta, null, 2), 'utf-8');
  } finally {
    unlock();
  }
}

export async function readMeta(): Promise<Record<string, any>> {
  const unlock = await acquireLock('meta');
  try {
    try {
      const data = await fs.readFile(META_FILE, 'utf-8');
      return JSON.parse(data);
    } catch (e) {
      return {};
    }
  } finally {
    unlock();
  }
}

export async function writeMeta(meta: Record<string, any>): Promise<void> {
  const unlock = await acquireLock('meta');
  try {
    await fs.writeFile(META_FILE, JSON.stringify(meta, null, 2), 'utf-8');
  } finally {
    unlock();
  }
}

async function acquireLock(type: 'tasks' | 'meta'): Promise<() => void> {
  let release: () => void = () => {};
  const newLock = new Promise<void>((resolve) => { release = resolve; });
  if (type === 'tasks') {
    const oldLock = tasksLock;
    tasksLock = oldLock.then(() => newLock);
    await oldLock;
  } else {
    const oldLock = metaLock;
    metaLock = oldLock.then(() => newLock);
    await oldLock;
  }
  return release;
}

export async function getExistingChapterHashes(filename: string): Promise<Set<string>> {
  const meta = await readMeta();
  const fileMeta = meta[filename] || {};
  return new Set(fileMeta.chapters || []);
}

export async function addChapterHashes(filename: string, newHashes: string[]): Promise<void> {
  await updateMeta(meta => {
    if (!meta[filename]) meta[filename] = {};
    const existing = new Set(meta[filename].chapters || []);
    newHashes.forEach(h => existing.add(h));
    meta[filename].chapters = Array.from(existing);
    
    const now = new Date();
    meta[filename].last_modified = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
  });
}
