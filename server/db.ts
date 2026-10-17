import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import fs from 'fs/promises';
import path from 'path';

const JWT_SECRET = process.env.JWT_SECRET || 'tt-novel-multiuser-secret-key-2026';
const DB_FILE = path.join(process.cwd(), 'server', 'users_db.json');

export interface DbUser {
  id: number;
  username: string;
  password?: string;
  nickname: string;
  role: 'admin' | 'user';
  bound_device_id?: string | null;
  device_info?: string | null;
  device_bound_at?: string | null;
  device_reset_requested?: number; // 0 or 1
  status?: 'active' | 'disabled' | 'pending';
  is_donated?: number; // 0 or 1
  created_at: string;
  novel_count?: number;
}

export interface DbUserNovel {
  id: number;
  user_id: number;
  novel_filename: string;
  custom_name?: string | null;
  is_favorite: number; // 0 or 1
  created_at: string;
}

let mysqlPool: mysql.Pool | null = null;
let isUsingMySQL = false;

// Fallback in-memory / file-backed storage if MySQL is not reachable
interface LocalDbSchema {
  users: DbUser[];
  user_novels: DbUserNovel[];
  nextUserId: number;
  nextUserNovelId: number;
}

let localDb: LocalDbSchema = {
  users: [],
  user_novels: [],
  nextUserId: 1,
  nextUserNovelId: 1
};

async function loadLocalDb() {
  try {
    const data = await fs.readFile(DB_FILE, 'utf-8');
    localDb = JSON.parse(data);
    
    // Migrate existing users in localDb if missing new fields
    let changed = false;
    for (const u of localDb.users) {
      if (!u.role) {
        u.role = u.username === 'admin' ? 'admin' : 'user';
        changed = true;
      }
      if (!u.status) {
        u.status = 'active';
        changed = true;
      }
      if (u.bound_device_id === undefined) {
        u.bound_device_id = null;
        changed = true;
      }
      if (u.device_reset_requested === undefined) {
        u.device_reset_requested = 0;
        changed = true;
      }
    }
    if (changed) {
      await saveLocalDb();
    }
  } catch {
    // Seed default admin user (password: 123456)
    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync('123456', salt);
    localDb = {
      users: [
        {
          id: 1,
          username: 'admin',
          password: hash,
          nickname: '超级管理员',
          role: 'admin',
          bound_device_id: null,
          device_info: null,
          device_bound_at: null,
          device_reset_requested: 0,
          status: 'active',
          created_at: new Date().toISOString()
        },
        {
          id: 2,
          username: 'reader1',
          password: hash,
          nickname: '书友小陈',
          role: 'user',
          bound_device_id: null,
          device_info: null,
          device_bound_at: null,
          device_reset_requested: 0,
          status: 'active',
          created_at: new Date().toISOString()
        }
      ],
      user_novels: [],
      nextUserId: 3,
      nextUserNovelId: 1
    };
    await saveLocalDb();
  }
}

async function saveLocalDb() {
  try {
    await fs.mkdir(path.dirname(DB_FILE), { recursive: true });
    await fs.writeFile(DB_FILE, JSON.stringify(localDb, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to save local database:', err);
  }
}

export async function initDatabase() {
  await loadLocalDb();

  const host = process.env.MYSQL_HOST || '127.0.0.1';
  const port = Number(process.env.MYSQL_PORT || 3306);
  const user = process.env.MYSQL_USER || 'root';
  const password = process.env.MYSQL_PASSWORD || '';
  const database = process.env.MYSQL_DATABASE || 'novel_reader';

  // Only attempt MySQL if configured or if standard settings are present
  try {
    console.log(`[Database] 正在尝试连接 MySQL (${user}@${host}:${port}/${database})...`);
    
    // First try connecting to MySQL server directly
    const tempPool = mysql.createPool({
      host,
      port,
      user,
      password,
      waitForConnections: true,
      connectionLimit: 5,
      connectTimeout: 3000
    });

    const conn = await tempPool.getConnection();
    await conn.query(`CREATE DATABASE IF NOT EXISTS \`${database}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    conn.release();
    await tempPool.end();

    // Now connect to the target database
    mysqlPool = mysql.createPool({
      host,
      port,
      user,
      password,
      database,
      waitForConnections: true,
      connectionLimit: 10,
      connectTimeout: 3000
    });

    // Create tables with member management and device binding fields
    await mysqlPool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(64) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        nickname VARCHAR(64) DEFAULT NULL,
        role VARCHAR(16) DEFAULT 'user',
        bound_device_id VARCHAR(128) DEFAULT NULL,
        device_info VARCHAR(255) DEFAULT NULL,
        device_bound_at TIMESTAMP NULL DEFAULT NULL,
        device_reset_requested TINYINT(1) DEFAULT 0,
        status VARCHAR(16) DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // Safely add any new columns to existing MySQL users table
    const columnsToEnsure = [
      { name: 'role', def: "VARCHAR(16) DEFAULT 'user'" },
      { name: 'bound_device_id', def: 'VARCHAR(128) DEFAULT NULL' },
      { name: 'device_info', def: 'VARCHAR(255) DEFAULT NULL' },
      { name: 'device_bound_at', def: 'TIMESTAMP NULL DEFAULT NULL' },
      { name: 'device_reset_requested', def: 'TINYINT(1) DEFAULT 0' },
      { name: 'status', def: "VARCHAR(16) DEFAULT 'active'" }
    ];
    for (const col of columnsToEnsure) {
      try {
        await mysqlPool.query(`ALTER TABLE users ADD COLUMN ${col.name} ${col.def}`);
      } catch (err: any) {
        // Ignored if column already exists
      }
    }

    await mysqlPool.query(`
      CREATE TABLE IF NOT EXISTS user_novels (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        novel_filename VARCHAR(255) NOT NULL,
        custom_name VARCHAR(255) DEFAULT NULL,
        is_favorite TINYINT(1) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uk_user_novel (user_id, novel_filename),
        INDEX idx_user_id (user_id),
        INDEX idx_filename (novel_filename)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    // Ensure default admin user exists and has role='admin'
    const [rows]: any = await mysqlPool.query('SELECT id, role FROM users WHERE username = ?', ['admin']);
    if (rows.length === 0) {
      const salt = bcrypt.genSaltSync(10);
      const hash = bcrypt.hashSync('123456', salt);
      await mysqlPool.query(
        'INSERT INTO users (username, password, nickname, role, status) VALUES (?, ?, ?, ?, ?)',
        ['admin', hash, '超级管理员', 'admin', 'active']
      );
    } else if (rows[0].role !== 'admin') {
      await mysqlPool.query('UPDATE users SET role = "admin" WHERE username = "admin"');
    }

    isUsingMySQL = true;
    console.log(`✅ [Database] 成功连接并初始化 MySQL 数据库 (${database})！已开启多用户数据管理。`);
  } catch (err: any) {
    isUsingMySQL = false;
    mysqlPool = null;
    console.warn(`⚠️ [Database] MySQL 连接未开启或不可达 (${err.message})。`);
    console.log(`ℹ️ [Database] 已自动切换至本地持久化 SQL 引擎模式 (兼备完整的用户与书架关联系统)。`);
  }
}

export function isDbUsingMySQL(): boolean {
  return isUsingMySQL;
}

export function getMySqlPool(): mysql.Pool | null {
  return mysqlPool;
}

// User methods
export async function registerUser(
  username: string, 
  passwordPlain: string, 
  nickname?: string,
  deviceId?: string,
  deviceInfo?: string
): Promise<DbUser> {
  const cleanUsername = username.trim();
  if (!cleanUsername) throw new Error('用户名不能为空');
  if (!passwordPlain || passwordPlain.length < 5) throw new Error('密码长度至少需要5位');

  const salt = bcrypt.genSaltSync(10);
  const passwordHash = bcrypt.hashSync(passwordPlain, salt);
  const nick = nickname?.trim() || cleanUsername;
  const boundDev = deviceId || null;
  const devInfo = deviceInfo || null;
  const now = new Date().toISOString();

  if (isUsingMySQL && mysqlPool) {
    try {
      const [res]: any = await mysqlPool.query(
        `INSERT INTO users (username, password, nickname, role, bound_device_id, device_info, device_bound_at, device_reset_requested, status) 
         VALUES (?, ?, ?, 'user', ?, ?, ${boundDev ? 'NOW()' : 'NULL'}, 0, 'pending')`,
        [cleanUsername, passwordHash, nick, boundDev, devInfo]
      );
      return {
        id: res.insertId,
        username: cleanUsername,
        nickname: nick,
        role: 'user',
        bound_device_id: boundDev,
        device_info: devInfo,
        device_bound_at: boundDev ? now : null,
        device_reset_requested: 0,
        status: 'pending',
        created_at: now
      };
    } catch (err: any) {
      if (err.code === 'ER_DUP_ENTRY') {
        throw new Error('用户名已存在，请更换其他用户名');
      }
      throw err;
    }
  } else {
    const existing = localDb.users.find(u => u.username.toLowerCase() === cleanUsername.toLowerCase());
    if (existing) {
      throw new Error('用户名已存在，请更换其他用户名');
    }
    const newUser: DbUser = {
      id: localDb.nextUserId++,
      username: cleanUsername,
      password: passwordHash,
      nickname: nick,
      role: 'user',
      bound_device_id: boundDev,
      device_info: devInfo,
      device_bound_at: boundDev ? now : null,
      device_reset_requested: 0,
      status: 'pending',
      created_at: now
    };
    localDb.users.push(newUser);
    await saveLocalDb();
    const { password, ...safeUser } = newUser;
    return safeUser as DbUser;
  }
}

export async function loginUser(
  username: string, 
  passwordPlain: string,
  deviceId?: string,
  deviceInfo?: string
): Promise<{ token: string; user: DbUser }> {
  const cleanUsername = username.trim();
  let user: DbUser | undefined;

  if (isUsingMySQL && mysqlPool) {
    const [rows]: any = await mysqlPool.query(
      `SELECT id, username, password, nickname, role, bound_device_id, device_info, device_bound_at, device_reset_requested, status, created_at 
       FROM users WHERE username = ?`,
      [cleanUsername]
    );
    if (rows && rows.length > 0) {
      user = rows[0];
    }
  } else {
    user = localDb.users.find(u => u.username.toLowerCase() === cleanUsername.toLowerCase());
  }

  if (!user || !user.password) {
    throw new Error('用户名或密码错误');
  }

  const isMatch = bcrypt.compareSync(passwordPlain, user.password);
  if (!isMatch) {
    throw new Error('用户名或密码错误');
  }

  if (user.status === 'pending') {
    throw new Error('您的账号正在等待系统管理员审核，请审核通过后再登录。');
  }

  if (user.status === 'disabled') {
    throw new Error('该账号已被管理员禁用，请联系管理员。');
  }

  const isAdmin = user.role === 'admin' || user.username === 'admin';

  // 单设备登录策略限制 (非管理员用户必须在单设备登录，换机需管理员重置允许)
  if (!isAdmin && deviceId) {
    if (!user.bound_device_id) {
      // 首次登录或已被管理员解绑允许换机：立即绑定当前设备
      if (isUsingMySQL && mysqlPool) {
        await mysqlPool.query(
          `UPDATE users SET bound_device_id = ?, device_info = ?, device_bound_at = NOW(), device_reset_requested = 0 WHERE id = ?`,
          [deviceId, deviceInfo || null, user.id]
        );
      } else {
        user.bound_device_id = deviceId;
        user.device_info = deviceInfo || null;
        user.device_bound_at = new Date().toISOString();
        user.device_reset_requested = 0;
        await saveLocalDb();
      }
      user.bound_device_id = deviceId;
      user.device_info = deviceInfo || null;
    } else if (user.bound_device_id !== deviceId) {
      // 在不同设备上登录，且未被管理员允许换机
      throw new Error('DEVICE_LOCKED:此账号仅允许在单台绑定设备上登录。如需更换设备，请联系管理员在后台解绑允许。');
    }
  }

  const safeUser: DbUser = {
    id: user.id,
    username: user.username,
    nickname: user.nickname || user.username,
    role: isAdmin ? 'admin' : 'user',
    bound_device_id: user.bound_device_id,
    device_info: user.device_info,
    device_bound_at: user.device_bound_at,
    device_reset_requested: user.device_reset_requested,
    status: user.status || 'active',
    created_at: user.created_at
  };

  const token = jwt.sign(
    { 
      id: safeUser.id, 
      username: safeUser.username, 
      nickname: safeUser.nickname,
      role: safeUser.role,
      deviceId: deviceId || null
    },
    JWT_SECRET,
    { expiresIn: '30d' }
  );

  return { token, user: safeUser };
}

export async function getUserById(userId: number): Promise<DbUser | null> {
  if (isUsingMySQL && mysqlPool) {
    const [rows]: any = await mysqlPool.query(
      `SELECT id, username, nickname, role, bound_device_id, device_info, device_bound_at, device_reset_requested, status, created_at 
       FROM users WHERE id = ?`,
      [userId]
    );
    return rows.length > 0 ? rows[0] : null;
  } else {
    const user = localDb.users.find(u => u.id === userId);
    if (!user) return null;
    const { password, ...safeUser } = user;
    return safeUser as DbUser;
  }
}

export function verifyUserToken(token: string): { id: number; username: string; nickname: string; role: 'admin' | 'user'; deviceId?: string } | null {
  try {
    return jwt.verify(token, JWT_SECRET) as any;
  } catch {
    return null;
  }
}

// ==========================================
// Admin Member Management API Functions
// ==========================================

export async function adminGetAllUsers(): Promise<DbUser[]> {
  if (isUsingMySQL && mysqlPool) {
    const [rows]: any = await mysqlPool.query(`
      SELECT 
        u.id, u.username, u.nickname, u.role, u.bound_device_id, u.device_info, u.device_bound_at, u.device_reset_requested, u.status, u.created_at,
        COUNT(un.id) as novel_count
      FROM users u
      LEFT JOIN user_novels un ON u.id = un.user_id
      GROUP BY u.id
      ORDER BY u.id ASC
    `);
    return rows.map((r: any) => ({
      ...r,
      novel_count: Number(r.novel_count || 0)
    }));
  } else {
    return localDb.users.map(u => {
      const { password, ...safe } = u;
      const count = localDb.user_novels.filter(un => un.user_id === u.id).length;
      return {
        ...safe,
        novel_count: count
      };
    });
  }
}

export async function adminResetUserDevice(userId: number): Promise<boolean> {
  if (isUsingMySQL && mysqlPool) {
    const [res]: any = await mysqlPool.query(
      `UPDATE users SET bound_device_id = NULL, device_info = NULL, device_bound_at = NULL, device_reset_requested = 0 WHERE id = ?`,
      [userId]
    );
    return res.affectedRows > 0;
  } else {
    const user = localDb.users.find(u => u.id === userId);
    if (user) {
      user.bound_device_id = null;
      user.device_info = null;
      user.device_bound_at = null;
      user.device_reset_requested = 0;
      await saveLocalDb();
      return true;
    }
    return false;
  }
}

export async function adminResetUserPassword(userId: number, newPasswordPlain: string): Promise<boolean> {
  if (!newPasswordPlain || newPasswordPlain.length < 5) {
    throw new Error('密码长度至少需要5位');
  }
  const salt = bcrypt.genSaltSync(10);
  const hash = bcrypt.hashSync(newPasswordPlain, salt);

  if (isUsingMySQL && mysqlPool) {
    const [res]: any = await mysqlPool.query(
      `UPDATE users SET password = ? WHERE id = ?`,
      [hash, userId]
    );
    return res.affectedRows > 0;
  } else {
    const user = localDb.users.find(u => u.id === userId);
    if (user) {
      user.password = hash;
      await saveLocalDb();
      return true;
    }
    return false;
  }
}

export async function adminToggleUserStatus(userId: number, status: 'active' | 'disabled'): Promise<boolean> {
  if (isUsingMySQL && mysqlPool) {
    const [res]: any = await mysqlPool.query(
      `UPDATE users SET status = ? WHERE id = ?`,
      [status, userId]
    );
    return res.affectedRows > 0;
  } else {
    const user = localDb.users.find(u => u.id === userId);
    if (user) {
      user.status = status;
      await saveLocalDb();
      return true;
    }
    return false;
  }
}

export async function adminDeleteUser(userId: number): Promise<boolean> {
  // Prevent deleting primary admin
  const user = await getUserById(userId);
  if (!user || user.username === 'admin') {
    throw new Error('不允许删除系统超级管理员账号');
  }

  if (isUsingMySQL && mysqlPool) {
    await mysqlPool.query(`DELETE FROM user_novels WHERE user_id = ?`, [userId]);
    const [res]: any = await mysqlPool.query(`DELETE FROM users WHERE id = ?`, [userId]);
    return res.affectedRows > 0;
  } else {
    localDb.user_novels = localDb.user_novels.filter(un => un.user_id !== userId);
    localDb.users = localDb.users.filter(u => u.id !== userId);
    await saveLocalDb();
    return true;
  }
}

export async function adminCreateUser(
  username: string,
  passwordPlain: string,
  nickname?: string
): Promise<DbUser> {
  const cleanUsername = username.trim();
  if (!cleanUsername) throw new Error('用户名不能为空');
  if (!passwordPlain || passwordPlain.length < 5) throw new Error('密码长度至少需要5位');

  const salt = bcrypt.genSaltSync(10);
  const passwordHash = bcrypt.hashSync(passwordPlain, salt);
  const nick = nickname?.trim() || cleanUsername;
  const now = new Date().toISOString();

  if (isUsingMySQL && mysqlPool) {
    try {
      const [res]: any = await mysqlPool.query(
        `INSERT INTO users (username, password, nickname, role, bound_device_id, device_info, device_bound_at, device_reset_requested, status) 
         VALUES (?, ?, ?, 'user', NULL, NULL, NULL, 0, 'active')`,
        [cleanUsername, passwordHash, nick]
      );
      return {
        id: res.insertId,
        username: cleanUsername,
        nickname: nick,
        role: 'user',
        bound_device_id: null,
        device_info: null,
        device_bound_at: null,
        device_reset_requested: 0,
        status: 'active',
        created_at: now
      };
    } catch (err: any) {
      if (err.code === 'ER_DUP_ENTRY') {
        throw new Error('用户名已存在，请更换其他用户名');
      }
      throw err;
    }
  } else {
    const existing = localDb.users.find(u => u.username.toLowerCase() === cleanUsername.toLowerCase());
    if (existing) {
      throw new Error('用户名已存在，请更换其他用户名');
    }
    const newUser: DbUser = {
      id: localDb.nextUserId++,
      username: cleanUsername,
      password: passwordHash,
      nickname: nick,
      role: 'user',
      bound_device_id: null,
      device_info: null,
      device_bound_at: null,
      device_reset_requested: 0,
      status: 'active',
      created_at: now
    };
    localDb.users.push(newUser);
    await saveLocalDb();
    const { password, ...safeUser } = newUser;
    return safeUser as DbUser;
  }
}

export async function requestDeviceReset(username: string): Promise<boolean> {
  const cleanUsername = username.trim();
  if (!cleanUsername) return false;

  if (isUsingMySQL && mysqlPool) {
    const [res]: any = await mysqlPool.query(
      `UPDATE users SET device_reset_requested = 1 WHERE username = ?`,
      [cleanUsername]
    );
    return res.affectedRows > 0;
  } else {
    const user = localDb.users.find(u => u.username.toLowerCase() === cleanUsername.toLowerCase());
    if (user) {
      user.device_reset_requested = 1;
      await saveLocalDb();
      return true;
    }
    return false;
  }
}

// ==========================================
// User-Novel Association & Operations
// ==========================================

export async function getUserNovels(userId: number): Promise<DbUserNovel[]> {
  if (isUsingMySQL && mysqlPool) {
    const [rows]: any = await mysqlPool.query(
      'SELECT id, user_id, novel_filename, custom_name, is_favorite, created_at FROM user_novels WHERE user_id = ? ORDER BY created_at DESC',
      [userId]
    );
    return rows;
  } else {
    return localDb.user_novels
      .filter(un => un.user_id === userId)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }
}

export async function associateNovel(
  userId: number,
  novelFilename: string,
  customName?: string,
  isFavorite: boolean = false
): Promise<DbUserNovel> {
  const cleanFilename = path.basename(novelFilename);
  const favVal = isFavorite ? 1 : 0;
  const now = new Date().toISOString();

  if (isUsingMySQL && mysqlPool) {
    await mysqlPool.query(
      `INSERT INTO user_novels (user_id, novel_filename, custom_name, is_favorite, created_at)
       VALUES (?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE 
         custom_name = COALESCE(?, custom_name),
         is_favorite = GREATEST(is_favorite, ?)`,
      [userId, cleanFilename, customName || null, favVal, customName || null, favVal]
    );

    const [rows]: any = await mysqlPool.query(
      'SELECT * FROM user_novels WHERE user_id = ? AND novel_filename = ?',
      [userId, cleanFilename]
    );
    return rows[0];
  } else {
    const existing = localDb.user_novels.find(
      un => un.user_id === userId && un.novel_filename === cleanFilename
    );
    if (existing) {
      if (customName) existing.custom_name = customName;
      if (isFavorite) existing.is_favorite = 1;
      await saveLocalDb();
      return existing;
    }

    const item: DbUserNovel = {
      id: localDb.nextUserNovelId++,
      user_id: userId,
      novel_filename: cleanFilename,
      custom_name: customName || null,
      is_favorite: favVal,
      created_at: now
    };
    localDb.user_novels.push(item);
    await saveLocalDb();
    return item;
  }
}

export async function toggleFavoriteNovel(userId: number, novelFilename: string): Promise<boolean> {
  const cleanFilename = path.basename(novelFilename);

  if (isUsingMySQL && mysqlPool) {
    const [rows]: any = await mysqlPool.query(
      'SELECT is_favorite FROM user_novels WHERE user_id = ? AND novel_filename = ?',
      [userId, cleanFilename]
    );
    if (rows.length === 0) {
      // If not yet in bookshelf, associate and favorite
      await associateNovel(userId, cleanFilename, undefined, true);
      return true;
    }
    const current = Number(rows[0].is_favorite);
    const nextVal = current === 1 ? 0 : 1;
    await mysqlPool.query(
      'UPDATE user_novels SET is_favorite = ? WHERE user_id = ? AND novel_filename = ?',
      [nextVal, userId, cleanFilename]
    );
    return nextVal === 1;
  } else {
    const item = localDb.user_novels.find(
      un => un.user_id === userId && un.novel_filename === cleanFilename
    );
    if (!item) {
      await associateNovel(userId, cleanFilename, undefined, true);
      return true;
    }
    item.is_favorite = item.is_favorite === 1 ? 0 : 1;
    await saveLocalDb();
    return item.is_favorite === 1;
  }
}

export async function dissociateNovel(userId: number, novelFilename: string): Promise<boolean> {
  const cleanFilename = path.basename(novelFilename);

  if (isUsingMySQL && mysqlPool) {
    const [res]: any = await mysqlPool.query(
      'DELETE FROM user_novels WHERE user_id = ? AND novel_filename = ?',
      [userId, cleanFilename]
    );
    return res.affectedRows > 0;
  } else {
    const initialLen = localDb.user_novels.length;
    localDb.user_novels = localDb.user_novels.filter(
      un => !(un.user_id === userId && un.novel_filename === cleanFilename)
    );
    if (localDb.user_novels.length !== initialLen) {
      await saveLocalDb();
      return true;
    }
    return false;
  }
}

export async function renameUserNovel(userId: number, novelFilename: string, newName: string): Promise<boolean> {
  const cleanFilename = path.basename(novelFilename);

  if (isUsingMySQL && mysqlPool) {
    const [res]: any = await mysqlPool.query(
      'UPDATE user_novels SET custom_name = ? WHERE user_id = ? AND novel_filename = ?',
      [newName.trim(), userId, cleanFilename]
    );
    return res.affectedRows > 0;
  } else {
    const item = localDb.user_novels.find(
      un => un.user_id === userId && un.novel_filename === cleanFilename
    );
    if (item) {
      item.custom_name = newName.trim();
      await saveLocalDb();
      return true;
    }
    return false;
  }
}

// Get all files that are associated with any user
export async function getNovelAssociationCount(novelFilename: string): Promise<number> {
  const cleanFilename = path.basename(novelFilename);
  if (isUsingMySQL && mysqlPool) {
    const [rows]: any = await mysqlPool.query(
      'SELECT COUNT(*) as count FROM user_novels WHERE novel_filename = ?',
      [cleanFilename]
    );
    return Number(rows[0]?.count || 0);
  } else {
    return localDb.user_novels.filter(un => un.novel_filename === cleanFilename).length;
  }
}
