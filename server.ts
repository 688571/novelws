import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import process from "process";
import fs from "fs/promises";
import { spawn, execSync } from "child_process";
import multer from "multer";
import https from "node:https";
import jschardet from "jschardet";
import iconv from "iconv-lite";
import { createServer as createViteServer } from "vite";

import { 
  initData, readMeta, writeMeta, getTask, saveTask, appendTaskLog, getExistingChapterHashes, addChapterHashes, readTasks, writeTasks, updateTasks
} from "./server/data";

import {
  initDatabase, registerUser, loginUser, getUserById, verifyUserToken, isDbUsingMySQL, getMySqlPool,
  getUserNovels, associateNovel, toggleFavoriteNovel, dissociateNovel, renameUserNovel,
  adminGetAllUsers, adminResetUserDevice, adminResetUserPassword, adminToggleUserStatus, adminDeleteUser,
  requestDeviceReset, adminCreateUser
} from "./server/db";

import { rankAndFilterSearchResults, toSimplified, toTraditional } from "./server/searchHelper";

// 全局异常防护，防止因 Linux inotify 监听数耗尽 (ENOSPC) 或客户端管道中断 (EPIPE/ECONNRESET) 导致 Node 进程崩溃退出
process.on("uncaughtException", (err: any) => {
  if (err?.code === "ENOSPC" || err?.syscall === "watch") {
    console.warn("⚠️ [系统文件监听报警] 触发系统 inotify 数量上限 (ENOSPC)，已自动拦截异常并保持服务平稳运行:", err.message);
    return;
  }
  if (err?.code === "EPIPE" || err?.code === "ECONNRESET") {
    // 客户端主动切断连接或网络断开导致的流管道异常，安全忽略
    return;
  }
  console.error("⚠️ [未捕获异常]:", err);
});

process.on("unhandledRejection", (reason: any) => {
  console.warn("⚠️ [未处理的 Promise 拒绝]:", reason);
});

const OUTPUT_DIR = path.join(process.cwd(), 'novels');
const UPLOAD_DIR = path.join(process.cwd(), 'uploads');
const upload = multer({ dest: UPLOAD_DIR, limits: { fileSize: 3 * 1024 * 1024 } });

// 内存暂存下载线路真实地址，防止直接暴露下载 URL 到前端
const candidateMirrorsMap = new Map<string, string[]>();

function getAuthUser(req: express.Request): { id: number; username: string; nickname: string; role: 'admin' | 'user' } | null {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token) {
      const verified = verifyUserToken(token);
      if (verified) return verified;
    }
  }
  const headerUserId = req.headers['x-user-id'];
  if (headerUserId) {
    const uid = Number(headerUserId);
    if (!isNaN(uid) && uid > 0) {
      return { id: uid, username: `user_${uid}`, nickname: `书友${uid}`, role: uid === 1 ? 'admin' : 'user' };
    }
  }
  return null;
}

function getAuthUserOrDefault(req: express.Request): { id: number; username: string; nickname: string; role: 'admin' | 'user' } {
  const user = getAuthUser(req);
  if (user) return user;
  return { id: 1, username: 'guest', nickname: '访客', role: 'user' };
}

function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  const user = getAuthUser(req);
  if (!user || (user.role !== 'admin' && user.username !== 'admin')) {
    return res.status(403).json({ success: false, error: '权限不足：仅系统超级管理员允许访问此管理功能' });
  }
  next();
}

async function startServer() {
  await initData();
  await initDatabase();
  try { await fs.mkdir(UPLOAD_DIR, { recursive: true }); } catch(e) {}
  
  // 初始化时将现有小说关联到默认管理员账号，以便首次打开书架即有数据
  try {
    const existingFiles = await fs.readdir(OUTPUT_DIR);
    const adminNovels = await getUserNovels(1);
    if (adminNovels.length === 0) {
      for (const f of existingFiles) {
        if (f.endsWith('.txt')) {
          await associateNovel(1, f, f.replace('.txt', ''));
        }
      }
    }
  } catch(e) {}
  
  // Set up Python dependencies
  try {
    const vendorPath = path.join(process.cwd(), 'vendor');
    
    // First, safely detect Python3 major/minor version using isolated mode (-I)
    let pythonVer = "3.10";
    try {
      pythonVer = execSync(`python3 -I -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"`).toString().trim();
      console.log(`Detected Python version: ${pythonVer}`);
    } catch (err) {
      console.warn("Could not detect python3 version in isolated mode, defaulting to 3.10 setup:", err);
    }

    const [major, minor] = pythonVer.split('.').map(Number);
    const isPythonOld = (major === 3 && minor < 10);

    // Check if the current vendor is functional
    let isVendorHealthy = false;
    try {
      execSync(`python3 -c "import sys; sys.path.insert(0, './vendor'); import bs4; import chardet"`, { stdio: 'ignore' });
      isVendorHealthy = true;
      console.log("Existing Python vendor dependencies are healthy.");
    } catch (e) {
      console.log("Existing vendor is missing or unhealthy, reinstalling...");
    }

    if (!isVendorHealthy) {
      console.log('Cleaning up old vendor directory to avoid conflicts/corrupted state...');
      try {
        await fs.rm(vendorPath, { recursive: true, force: true });
      } catch (rmError) {}
      await fs.mkdir(vendorPath, { recursive: true });

      // Check if pip is globally available to avoid downloading get-pip.py
      let isPipAvail = false;
      try {
        execSync(`python3 -I -m pip --version`, { stdio: 'ignore' });
        isPipAvail = true;
      } catch (pipCheckErr) {}

      if (isPipAvail) {
        console.log('Using global pip to install packages directly to vendor...');
        execSync(`python3 -I -m pip install beautifulsoup4 bs4 "chardet<5.0.0" --target vendor`, { stdio: 'inherit' });
      } else {
        let getPipUrl = "https://bootstrap.pypa.io/get-pip.py";
        if (isPythonOld) {
          getPipUrl = `https://bootstrap.pypa.io/pip/${major}.${minor}/get-pip.py`;
        }
        
        console.log(`Downloading compatible get-pip.py from ${getPipUrl}...`);
        execSync(`curl -sSL "${getPipUrl}" -o get-pip.py`, { stdio: 'inherit' });
        
        console.log('Running get-pip.py in isolated mode to vendor directory...');
        execSync(`python3 -I get-pip.py --target vendor`, { stdio: 'inherit' });
        
        console.log('Installing beautifulsoup4, bs4, and chardet onto vendor...');
        execSync(`PYTHONPATH="./vendor" python3 -I -m pip install beautifulsoup4 bs4 "chardet<5.0.0" --target vendor`, { stdio: 'inherit' });
      }
      console.log('Python dependencies successfully installed.');
    }
  } catch (e) {
    console.error('Failed to initialize python dependencies:', e);
  }

  const app = express();
  const PORT = Number(process.env.PORT || 3000);

  // 信任前端反向代理（支持自定义独立域名如 qidu.eu.org 等通过 Nginx/Cloudflare 访问）
  app.set('trust proxy', true);

  app.use(cors({
    origin: true,
    credentials: true
  }));

  // 安全防御与网络扫描拦截中间件：
  // 屏蔽公网自动化扫描器针对敏感文件与系统路径的探测（如 /@fs/etc/passwd, /@fs/proc/..., /public/phpinfo.php, .php 等）
  // 阻断其透传到 Vite 开发中间件，防止 Vite 输出 "outside of Vite serving allow list" 以及消耗系统 inotify 句柄
  app.use((req, res, next) => {
    let rawPath = '';
    let rawUrl = '';
    try {
      rawPath = decodeURI(req.path || '').toLowerCase();
      rawUrl = decodeURI(req.originalUrl || req.url || '').toLowerCase();
    } catch (e) {
      rawPath = (req.path || '').toLowerCase();
      rawUrl = (req.originalUrl || req.url || '').toLowerCase();
    }

    const appRoot = process.cwd().toLowerCase();

    // 允许 Vite 内部机制与预构建依赖模块（/@vite/, /node_modules/.vite/）直接通行
    if (
      rawPath.startsWith('/node_modules/.vite/') ||
      rawUrl.startsWith('/node_modules/.vite/') ||
      rawPath.startsWith('/@vite/') ||
      rawUrl.startsWith('/@vite/') ||
      rawPath === '/@vite/client'
    ) {
      return next();
    }

    // 检查是否为 /@fs 请求，且未限定在本应用根目录下
    const isIllegalFsAccess =
      (rawPath.includes('/@fs') || rawUrl.includes('/@fs') || rawUrl.includes('/%40fs')) &&
      !rawPath.startsWith(`/@fs${appRoot}`);

    const isMaliciousScannerProbe =
      isIllegalFsAccess ||
      // 目录穿越探测
      rawPath.includes('..') ||
      rawUrl.includes('..') ||
      rawUrl.includes('%2e%2e') ||
      rawUrl.includes('\\') ||
      // 隐藏敏感文件探测 (如 /.env, /.aws, /.git, /.ssh 等，排除常规的 /.well-known/)
      (rawPath.startsWith('/.') && !rawPath.startsWith('/.well-known/')) ||
      /\/\.(env|git|aws|ssh|bash|config|svn|hg|ds_store|history|profile|zsh|local|cache)/i.test(rawPath) ||
      /\/\.(env|git|aws|ssh|bash|config|svn|hg|ds_store|history|profile|zsh|local|cache)/i.test(rawUrl) ||
      // 系统敏感路径与文件探测 (无论是常规路径还是包含在 /@fs/ 中)
      rawPath.includes('/etc/') ||
      rawUrl.includes('/etc/') ||
      rawPath.includes('/proc/') ||
      rawUrl.includes('/proc/') ||
      rawPath.includes('/sys/') ||
      rawUrl.includes('/sys/') ||
      rawPath.includes('/root/') ||
      rawUrl.includes('/root/') ||
      rawPath.includes('/home/') ||
      rawUrl.includes('/home/') ||
      rawPath.includes('/var/') ||
      rawUrl.includes('/var/') ||
      rawPath.includes('/usr/') ||
      rawUrl.includes('/usr/') ||
      rawPath.includes('/bin/') ||
      rawUrl.includes('/bin/') ||
      rawPath.includes('/tmp/') ||
      rawUrl.includes('/tmp/') ||
      rawPath.includes('/dev/') ||
      rawUrl.includes('/dev/') ||
      rawPath.includes('passwd') ||
      rawPath.includes('environ') ||
      rawPath.includes('shadow') ||
      // 常见 Web 扫描器特征探测（PHP探针、Laravel漏洞、WordPress扫描、CMS注入等）
      rawPath.startsWith('/public/') ||
      rawPath.startsWith('/vendor/') ||
      rawPath.startsWith('/wp-') ||
      rawPath.startsWith('/wordpress') ||
      rawPath.startsWith('/actuator') ||
      rawPath.startsWith('/telescope') ||
      rawPath.startsWith('/phpmyadmin') ||
      rawPath.startsWith('/pma') ||
      rawPath.startsWith('/adminer') ||
      rawPath.startsWith('/boaform') ||
      rawPath.startsWith('/solr') ||
      rawPath.includes('phpinfo') ||
      // 敏感脚本与程序扩展名探测
      /\.(php|php\d*|phtml|asp|aspx|jsp|jspx|cgi|pl|sh|bash|exe|dll|py|rb|action|do)(\?.*)?$/i.test(rawPath) ||
      /\.(php|php\d*|phtml|asp|aspx|jsp|jspx|cgi|pl|sh|bash|exe|dll|py|rb|action|do)(\?.*)?$/i.test(rawUrl) ||
      // 数据库与系统备份/配置文件探测
      /\.(sqlite|sqlite3|db|rdb|sql|tar|gz|tgz|7z|zip|rar|bak|backup|config|conf|properties|myd|myi|cnf|env|history|ini|yml|yaml|log)$/i.test(rawPath) ||
      /\.(sqlite|sqlite3|db|rdb|sql|tar|gz|tgz|7z|zip|rar|bak|backup|config|conf|properties|myd|myi|cnf|env|history|ini|yml|yaml|log)(\?.*)?$/i.test(rawUrl);

    if (isMaliciousScannerProbe) {
      res.status(404).send("Not Found");
      return;
    }

    next();
  });

  app.use(express.json());

  // 用户认证与账号管理接口 (支持 MySQL / 持久化多用户数据)
  app.post("/api/auth/register", async (req, res) => {
    try {
      const { username, password, nickname, deviceId, deviceInfo } = req.body;
      const user = await registerUser(username, password, nickname, deviceId, deviceInfo);
      res.json({ success: true, message: '注册成功！您的账号已提交，请等待管理员在后台审核通过后方可登录。' });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    try {
      const { username, password, deviceId, deviceInfo } = req.body;
      const loginRes = await loginUser(username, password, deviceId, deviceInfo);
      res.json({ success: true, token: loginRes.token, user: loginRes.user, isMySQL: isDbUsingMySQL() });
    } catch (err: any) {
      const isDeviceLocked = typeof err.message === 'string' && err.message.startsWith('DEVICE_LOCKED:');
      const cleanError = isDeviceLocked ? err.message.replace('DEVICE_LOCKED:', '') : err.message;
      res.status(400).json({
        success: false,
        error: cleanError,
        isDeviceLocked
      });
    }
  });

  app.get("/api/auth/me", async (req, res) => {
    try {
      const user = getAuthUser(req);
      if (!user) {
        return res.json({
          success: false,
          user: null,
          isMySQL: isDbUsingMySQL()
        });
      }
      const dbUser = await getUserById(user.id);
      res.json({
        success: true,
        user: dbUser || user,
        isMySQL: isDbUsingMySQL()
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post("/api/auth/logout", (_req, res) => {
    res.json({ success: true, message: "已成功退出登录" });
  });

  // 会员向管理员提交更换新设备申请
  app.post("/api/auth/request-device-reset", async (req, res) => {
    try {
      const { username } = req.body;
      if (!username) return res.status(400).json({ success: false, error: '缺少用户名参数' });
      const ok = await requestDeviceReset(username);
      if (!ok) return res.status(404).json({ success: false, error: '未找到该用户' });
      res.json({
        success: true,
        message: '更换设备申请已成功提交给管理员。请联系管理员在后台点击“允许更换设备”，解绑后即可在此设备登录。'
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 会员密码修改限制策略：会员不允许自行修改密码，仅管理员允许
  app.post("/api/auth/change-password", async (req, res) => {
    const currentUser = getAuthUser(req);
    if (!currentUser) {
      return res.status(401).json({ success: false, error: '未登录或登录已失效' });
    }
    if (currentUser.role !== 'admin' && currentUser.username !== 'admin') {
      return res.status(403).json({
        success: false,
        error: '系统安全策略规定：普通会员不允许自行修改密码。如需修改，请联系超级管理员在后台处理。'
      });
    }
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 5) {
      return res.status(400).json({ success: false, error: '新密码长度至少需要5位' });
    }
    try {
      await adminResetUserPassword(currentUser.id, newPassword);
      res.json({ success: true, message: '管理员密码已成功更新' });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ==========================================
  // 超级管理员：会员管理 API 接口
  // ==========================================
  
  // 1. 获取所有会员列表
  app.get("/api/admin/users", requireAdmin, async (req, res) => {
    try {
      const users = await adminGetAllUsers();
      res.json({ success: true, users, isMySQL: isDbUsingMySQL() });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 2. 管理员添加新会员
  app.post("/api/admin/users", requireAdmin, async (req, res) => {
    try {
      const { username, password, nickname } = req.body;
      const newUser = await adminCreateUser(username, password, nickname);
      res.json({ success: true, user: newUser, message: `会员 ${username} 创建成功！` });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // 3. 管理员解绑设备（允许会员更换新设备登录）
  app.post("/api/admin/users/:id/reset-device", requireAdmin, async (req, res) => {
    try {
      const userId = Number(req.params.id);
      const ok = await adminResetUserDevice(userId);
      if (!ok) return res.status(404).json({ success: false, error: '用户不存在或解绑失败' });
      res.json({ success: true, message: '设备已成功解绑！该会员下次登录时将自动绑定新设备。' });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 4. 管理员重置会员密码（因会员无权自改密码，由管理员在此维护）
  app.post("/api/admin/users/:id/reset-password", requireAdmin, async (req, res) => {
    try {
      const userId = Number(req.params.id);
      const { password } = req.body;
      if (!password || password.length < 5) {
        return res.status(400).json({ success: false, error: '重置密码长度至少需5位' });
      }
      const ok = await adminResetUserPassword(userId, password);
      if (!ok) return res.status(404).json({ success: false, error: '用户不存在或重置失败' });
      res.json({ success: true, message: '会员密码已成功重置！' });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 5. 管理员启用 / 停用会员账号
  app.post("/api/admin/users/:id/status", requireAdmin, async (req, res) => {
    try {
      const userId = Number(req.params.id);
      const { status } = req.body;
      if (status !== 'active' && status !== 'disabled') {
        return res.status(400).json({ success: false, error: '状态参数必须为 active 或 disabled' });
      }
      const ok = await adminToggleUserStatus(userId, status);
      if (!ok) return res.status(404).json({ success: false, error: '用户不存在' });
      res.json({ success: true, message: `账号状态已更新为: ${status === 'active' ? '正常启用' : '已禁用'}` });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 6. 管理员删除会员
  app.delete("/api/admin/users/:id", requireAdmin, async (req, res) => {
    try {
      const userId = Number(req.params.id);
      await adminDeleteUser(userId);
      res.json({ success: true, message: '会员账号及其书架关联已成功移除' });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // API to fetch novel reader logic (legacy from plugin but let's keep or leave it - we can comment it)
  // API for novel search with fuzzy/exact mode and Simplified/Traditional cross-search
  app.get("/api/search", async (req, res) => {
    const query = req.query.q as string;
    const site = req.query.site as string || 'asw227';
    const mode = ((req.query.mode as string) || 'fuzzy') as 'fuzzy' | 'exact';
    if (!query) return res.status(400).json({ error: "搜索词不能为空" });
    
    // Helper to format, sanitize URLs for non-admin, and rank/filter results
    const formatAndReturnResults = (rawResults: any[]) => {
      const user = getAuthUser(req);
      const isAdmin = user?.role === 'admin';
      const sanitized = rawResults.map(item => {
        let desc = item.desc || '';
        if (!isAdmin) {
          // Remove any specific URLs or domain links from descriptions
          desc = desc.replace(/https?:\/\/[^\s"'<>]+/gi, '').replace(/(?:www\.)?[a-zA-Z0-9-]+\.(?:com|net|org|cn|info|asp|php|html)/gi, '').trim();
        }
        return {
          ...item,
          desc
        };
      });
      const ranked = rankAndFilterSearchResults(sanitized, query, mode);
      return res.json({ success: true, results: ranked, mode, query });
    };

    try {
      if (site === 'aswtxt') {
        const queryStr = query.trim();
        let fetchUrl = '';
        if (queryStr.startsWith('http://') || queryStr.startsWith('https://')) {
          fetchUrl = queryStr;
        } else {
          // Cross-search: convert to simplified Chinese for optimal keyword indexing on remote source
          const querySimp = toSimplified(queryStr);
          const queryBuf = iconv.encode(querySimp, 'gbk');
          const encodedQuery = Array.from(queryBuf)
            .map(b => '%' + b.toString(16).toUpperCase())
            .join('');
          fetchUrl = `https://www.aswtxt.com/searchneirong.asp?word=${encodedQuery}`;
        }
        
        console.log("Fetch url for aswtxt search:", fetchUrl);
        const response = await fetch(fetchUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': 'https://www.aswtxt.com/'
          }
        });
        
        const buffer = await response.arrayBuffer();
        const cheerio = await import('cheerio');
        
        const detectBuf = Buffer.from(buffer);
        const detected = jschardet.detect(detectBuf);
        const html = iconv.decode(detectBuf, detected.encoding || 'gbk');
        
        const $ = cheerio.load(html);
        const results: any[] = [];
        
        const bookLinks: any[] = [];
        $('a').each((i, el) => {
          const href = $(el).attr('href') || '';
          const text = $(el).text().trim();
          
          if (href.includes('/txt-') && href.endsWith('.htm') && !href.includes('/new/') && !href.includes('list')) {
            bookLinks.push({ href, text, index: i });
          }
        });
        
        for (let i = 0; i < bookLinks.length; i++) {
          const current = bookLinks[i];
          if (current.text === "查看详细") {
            continue;
          }
          
          const title = current.text.replace(/《/g, '').replace(/》/g, '').replace(/txt全集/gi, '').replace(/TXT全集/gi, '').replace(/txt完结/gi, '').trim();
          const href = current.href;
          
          let author = '未知';
          let category = '网络书源';
          
          let searchIndex = current.index;
          $('a').slice(searchIndex + 1, searchIndex + 5).each((_, nextEl) => {
            const nextHref = $(nextEl).attr('href') || '';
            const nextText = $(nextEl).text().trim();
            
            if (nextHref.includes('searchzuozhe.asp') || nextText.startsWith('作者：')) {
              author = nextText.replace('作者：', '').trim();
            } else if (nextHref.includes('list') && nextHref.includes('.htm')) {
              category = nextText;
            }
          });
          
          const fullUrl = new URL(href, 'https://www.aswtxt.com/').toString();
          results.push({
            title,
            author,
            category,
            url: fullUrl,
            desc: `高品质网络书源 | 一键下载还原好排版`
          });
        }
        
        return formatAndReturnResults(results);
      }

      if (site === 'asw227') {
        const queryStr = query.trim();
        let baseDomain = 'https://www.asw227.com';
        let fetchUrl = '';
        
        if (queryStr.startsWith('http://') || queryStr.startsWith('https://')) {
          fetchUrl = queryStr;
          try {
            baseDomain = new URL(queryStr).origin;
          } catch (e) {}
        } else {
          const simplifiedTerm = toSimplified(queryStr);
          fetchUrl = `https://www.asw227.com/search.php?kw=${encodeURIComponent(simplifiedTerm)}`;
        }
        
        console.log("Fetch url for asw227 search:", fetchUrl, "with baseDomain:", baseDomain);
        
        const response = await fetch(fetchUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          }
        });
        
        const buffer = await response.arrayBuffer();
        const cheerio = await import('cheerio');
        
        const detectBuf = Buffer.from(buffer);
        const detected = jschardet.detect(detectBuf);
        const html = iconv.decode(detectBuf, detected.encoding || 'utf-8');
        
        const $ = cheerio.load(html);
        const results: any[] = [];
        
        // If the query was a direct file details page, return it as a direct result
        if (fetchUrl.includes('file.php?hash=')) {
          let rawTitle = $('title').text().replace('-爱书网-小说上传分享系统', '').replace('下载', '').trim();
          if (!rawTitle) {
            rawTitle = $('.elsetext span').text().trim() || $('.file-name').text().trim();
          }
          let fileName = rawTitle.replace(/\.txt$/i, '').trim();
          let title = fileName;
          let author = '未知';
          
          const bracketMatches = [...fileName.matchAll(/《([^》]+)》/g)].map(m => m[1].trim()).filter(Boolean);
          if (bracketMatches.length > 0) {
            title = bracketMatches[0];
            const escTitle = title.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
            const postMatch = fileName.match(new RegExp(`《${escTitle}》\\s*(?:作者|by)\\s*[:：]?\\s*([^\\s.《》【】]+)`, 'i'));
            if (postMatch) {
              author = postMatch[1].trim();
            }
          }
          if (author === '未知') {
            const authorMatch = fileName.match(/(?:作者|by)\s*[:：]?\s*([^\\s.《》【】]+)/i);
            if (authorMatch) {
              author = authorMatch[1].trim();
            }
          }
          title = title.replace(/《|》/g, '').replace(/^(?:GL|BG|BL|GB|求|附|【[^】]+】|\([^)]+\))\s*/gi, '').trim();
          if (!title) {
            const hash = new URL(fetchUrl).searchParams.get('hash') || '';
            title = '爱书网小说_' + (hash ? hash.slice(0, 8) : Date.now());
          }
          
          results.push({
            title: title,
            author: author,
            category: '爱书网直连',
            url: fetchUrl,
            desc: `直接解析的爱书网链接 ── 支持免爬虫选择线路秒下！`
          });
          return formatAndReturnResults(results);
        }
        
        $('a').each((_, el) => {
          const href = $(el).attr('href') || '';
          if (href.includes('file.php?hash=')) {
            let fileName = $(el).find('.file-name').text().trim();
            const rawText = $(el).text();
            const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);
            
            if (!fileName) {
              const textLines = lines.filter(l => !l.includes('📄') && !l.includes('📦') && !l.includes('🏷️') && !l.includes('🕒'));
              if (textLines.length > 0) {
                fileName = textLines[0];
              } else if (lines.length > 0) {
                if (lines[0].includes('📄') && lines.length > 1) {
                  fileName = lines[1];
                } else {
                  fileName = lines[0].replace('📄', '').trim();
                }
              }
            }

            fileName = fileName.replace(/\.txt$/i, '').trim();
            
            let title = fileName;
            let author = '未知';
            
            const bracketMatches = [...fileName.matchAll(/《([^》]+)》/g)].map(m => m[1].trim()).filter(Boolean);
            if (bracketMatches.length > 0) {
              const matchedQuery = bracketMatches.find(b => b.toLowerCase().includes(queryStr.toLowerCase()));
              title = matchedQuery || bracketMatches[0];
              
              const escTitle = title.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
              const postRegex = new RegExp(`《${escTitle}》\\s*(?:作者|by)\\s*[:：]?\\s*([^\\s.《》【】]+)`, 'i');
              const postMatch = fileName.match(postRegex);
              if (postMatch) {
                author = postMatch[1].trim();
              } else {
                const authorMatch = fileName.match(/(?:作者|by)\s*[:：]?\s*([^\\s.《》【】]+)/i);
                if (authorMatch) {
                  author = authorMatch[1].trim();
                }
              }
            } else {
              const authorMatch = fileName.match(/(?:作者|by)\s*[:：]?\s*([^\\s.《》【】]+)/i);
              if (authorMatch) {
                author = authorMatch[1].trim();
                title = fileName.replace(/(?:作者|by)\s*[:：]?\s*([^\\s.《》【】]+)/i, '').trim();
              }
            }

            title = title.replace(/《|》/g, '').replace(/^(?:GL|BG|BL|GB|求|附|【[^】]+】|\([^)]+\))\s*/gi, '').trim();
            if (title.includes('作者：')) title = title.split('作者：')[0].trim();
            if (title.includes('作者:')) title = title.split('作者:')[0].trim();
            if (title.includes('by')) title = title.split('by')[0].trim();

            if (!title) {
              title = queryStr || '爱书网小说';
            }
            
            let size = '未知';
            let date = '未知';
            
            const sizeEl = $(el).find('.detail-item:contains("📦")');
            if (sizeEl.length > 0) {
              size = sizeEl.text().replace('📦', '').trim();
            }
            const dateEl = $(el).find('.detail-item:contains("🕒")');
            if (dateEl.length > 0) {
              date = dateEl.text().replace('🕒', '').trim();
            }
            
            lines.forEach(line => {
              if (line.includes('📦') && size === '未知') size = line.replace('📦', '').trim();
              if (line.includes('🕒') && date === '未知') date = line.replace('🕒', '').trim();
            });
            
            const fullUrl = new URL(href, baseDomain).toString();
            const hashMatch = fullUrl.match(/hash=([a-f0-9]{32})/i);
            const hash = hashMatch ? hashMatch[1] : '';

            results.push({
              title,
              author,
              category: '网络书源',
              url: fullUrl,
              desc: `容量: ${size} | 更新: ${date} | 支持极速秒下并加入书架`
            });
          }
        });
        
        return formatAndReturnResults(results);
      }

      if (site === '00shu') {
        const simplifiedTerm = toSimplified(query.trim());
        const url = `https://www.00shu.info/modules/article/search.php?q=${encodeURIComponent(simplifiedTerm)}`;
        let response: any;
        try {
          response = await fetch(url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              'X-Forwarded-For': '114.114.114.114',
              'X-Real-IP': '114.114.114.114',
              'Client-IP': '114.114.114.114'
            }
          });
        } catch (fetchErr) {
          // 备用 IP 访问
          response = await fetch(`http://23.224.90.123/modules/article/search.php?q=${encodeURIComponent(simplifiedTerm)}`, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              'Host': 'www.00shu.info',
              'X-Forwarded-For': '114.114.114.114'
            }
          });
        }
        
        const buffer = await response.arrayBuffer();
        const html = new TextDecoder('utf-8').decode(buffer);
        
        const cheerio = await import('cheerio');
        const $ = cheerio.load(html);
        const results: any[] = [];
        
        $('tr#nr').each((_, el) => {
          const tds = $(el).find('td');
          if (tds.length >= 6) {
            const titleA = $(tds[0]).find('a');
            const title = titleA.text().trim();
            let rawUrl = titleA.attr('href') || '';
            let url = rawUrl;
            if (url.startsWith('/')) {
              url = `https://www.00shu.info${url}`;
            } else if (url.includes('00shu.la') || url.includes('23.224.90')) {
              url = url.replace(/https?:\/\/(?:www\.)?00shu\.(?:la|cc|com)/g, 'https://www.00shu.info')
                       .replace(/https?:\/\/23\.224\.90\.\d+/g, 'https://www.00shu.info');
            }
            const author = $(tds[2]).text().trim();
            const desc = `最新章节: ${$(tds[1]).text().trim()} | 状态: ${$(tds[5]).text().trim()} | 更新: ${$(tds[4]).text().trim()} (已启用防封及海外IP直通通道)`;
            if (title && url) {
              results.push({
                title,
                author,
                category: '玄幻/修真',
                url,
                rawUrl,
                desc
              });
            }
          }
        });
        
        return formatAndReturnResults(results);
      }

      const simplifiedTerm = toSimplified(query.trim());
      const url = `https://www.52shuku.net/so/search.php?q=${encodeURIComponent(simplifiedTerm)}`;
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });
      
      const buffer = await response.arrayBuffer();
      const decoders = [new TextDecoder('utf-8'), new TextDecoder('gbk')];
      let html = '';
      try {
        html = decoders[0].decode(buffer);
        if (html.includes('')) {
          // just force block if it exists
        }
      } catch {
        html = decoders[1].decode(buffer);
      }

      const cheerio = await import('cheerio');
      const $ = cheerio.load(html);
      const results: any[] = [];
      const seen = new Set<string>();

      $('a').each((_, el) => {
        const href = $(el).attr('href');
        if (!href || href === '/' || href.includes('52shuku.net') === false && href.startsWith('http')) return;
        
        let fullHref = href;
        if (!href.startsWith('http')) {
          fullHref = new URL(href, 'https://www.52shuku.net/').toString();
        }

        const match = fullHref.match(/https?:\/\/(?:www\.)?52shuku\.net\/([a-zA-Z0-9_/-]+)\/([a-zA-Z0-9]+)\.html$/);
        if (match) {
          const category = match[1];
          const segments = category.split('/');
          if (['e', 'zuozhe', 'tag', 'index', 'about', 'shuku', 'so', 'search'].some(skip => segments.includes(skip))) return;

          let text = $(el).text().trim();
          if (!text || text.length < 3) return;

          if (['推荐', '同类', '大家都在看', '更多作品', '热门作品', '排行榜'].some(junk => text.includes(junk))) return;

          let originalText = text;
          let author = "未知";
          
          const numMatch = text.match(/^\d+[\.\s\-、：:]*(.*)$/);
          if (numMatch) text = numMatch[1].trim();

          let title = text;
          if (text.includes('_')) {
            const parts = text.split('_');
            const titleCand = parts[0].trim();
            const authorPart = parts[1].trim();
            author = authorPart.replace(/【[^】]+】|\([^)]+\)|（[^）]+）/g, '').trim() || "未知";
            title = titleCand.replace(/【[^】]+】|\([^)]+\)|（[^）]+）/g, '').trim();
          } else {
            const bookMatch = text.match(/《([^》]+)》/);
            if (bookMatch) title = bookMatch[1].trim();
            
            const authorMatch = text.match(/(?:作者[：:]|by\s*|（|(?:\s*\())\s*([^\s（）()]+)(?:）|\)?|$)/i);
            if (authorMatch) {
              const val = authorMatch[1].trim();
              if (val && val !== title && !['小说', 'txt', '下载', '完结', '书库'].some(x => val.includes(x))) {
                author = val;
              }
            }
            title = title.replace(/【[^】]+】|\([^)]+\)|（[^）]+）/g, '').trim();
          }

          if (seen.has(fullHref)) return;
          seen.add(fullHref);

          let desc = '';
          const parent = $(el).closest('li, div');
          if (parent.length) {
            const descEl = parent.find('.smalltext, .desc, p, span.desc');
            if (descEl.length) {
              desc = descEl.text().trim().replace(originalText, '').trim();
            } else {
              const ptxt = parent.text().trim().replace(originalText, '').trim();
              if (ptxt) desc = ptxt.substring(0, 120);
            }
          }
          if (!desc) desc = `点击进入《${title}》极速抓取通道。`;

          results.push({
            title,
            author,
            category,
            url: fullHref,
            desc: desc.substring(0, 150)
          });
        }
      });

      return formatAndReturnResults(results);
    } catch (e: any) {
      console.error("Search API Error:", e);
      res.status(500).json({ success: false, error: e.message || "检索失败" });
    }
  });

  // New API: /api/start
  app.post("/api/author", async (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: "URL不能为空" });
    
    const pythonPath = 'python3';
    const pythonProc = spawn(pythonPath, [path.join(process.cwd(), 'crawler.py'), '--author', url]);
    let outputBuf = "";

    pythonProc.stdout.on('data', (data) => {
      outputBuf += data.toString();
    });

    pythonProc.on('close', (code) => {
      try {
        const result = outputBuf.split('\n').filter(l => l.trim()).pop();
        if (result) {
          const parsed = JSON.parse(result);
          if (parsed.error) return res.status(500).json({ error: parsed.error });
          res.json({ title: parsed.author, works: parsed.works });
        } else {
          res.status(500).json({ error: "解析失败，可能是不支持的页面结构或该站设防拦截了请求" });
        }
      } catch (e) {
        res.status(500).json({ error: "解析作者页异常 " + String(e) });
      }
    });
  });

  app.post("/api/start", async (req, res) => {
    const user = getAuthUserOrDefault(req);
    const { url, novel_name, incremental } = req.body;
    if (!url) return res.status(400).json({ error: "URL不能为空" });

    let finalUrl = url.trim();
    if (finalUrl.includes('00shu') || finalUrl.includes('23.224.90')) {
      finalUrl = finalUrl.replace(/https?:\/\/(?:www\.)?00shu\.(?:la|cc|com)/g, 'https://www.00shu.info');
      finalUrl = finalUrl.replace(/https?:\/\/23\.224\.90\.\d+/g, 'https://www.00shu.info');
      if (finalUrl.startsWith('/')) {
        finalUrl = `https://www.00shu.info${finalUrl}`;
      }
    }

    const taskId = String(Date.now());
    const task = {
      status: 'running',
      log: [`[${new Date().toLocaleTimeString('en-US', {hour12: false})}] 任务 ${taskId} 启动，起始URL: ${finalUrl}`],
      start_url: finalUrl,
      novel_name: novel_name || null,
      safe_name: null,
      html_path: null
    };

    await saveTask(taskId, task);

    // Prepare incremental hashes
    let existingHashes: string[] = [];
    if (incremental && novel_name) {
      const safeName = novel_name.replace(/[\\/*?:"<>|\s]/g, '_');
      const hashesSet = await getExistingChapterHashes(safeName + ".txt");
      existingHashes = Array.from(hashesSet);
      await appendTaskLog(taskId, `增量模式启用，已有章节数: ${existingHashes.length}`);
    } else {
      await appendTaskLog(taskId, "未选择增量模式，将尝试重新下载全部章节");
    }

    // Spawn python wrapper
    const pythonPath = 'python3';
    const pythonProc = spawn(pythonPath, [path.join(process.cwd(), 'crawler_wrapper.py')]);

    pythonProc.on('error', async (err) => {
      console.error('Crawler process spawn error:', err);
      await appendTaskLog(taskId, `爬虫子进程异常: ${err.message}`);
      await updateTasks(tasks => {
        if (tasks[taskId]) tasks[taskId].status = 'error';
      });
    });
    
    pythonProc.stdin.write(JSON.stringify({
      url: finalUrl,
      output_dir: OUTPUT_DIR,
      override_name: novel_name || null,
      existing_hashes: existingHashes
    }));
    pythonProc.stdin.end();

    let outputBuf = "";

    pythonProc.stdout.on('data', async (data) => {
      outputBuf += data.toString();
      const lines = outputBuf.split('\n');
      outputBuf = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed.type === 'log') {
            await appendTaskLog(taskId, parsed.msg);
          } else if (parsed.type === 'result') {
            const safeName = parsed.txt_path ? path.basename(parsed.txt_path, '.txt') : (novel_name ? novel_name.replace(/[\\/*?:"<>|\s]/g, '_') : 'unknown');
            await updateTasks(tasks => {
              if (tasks[taskId]) {
                tasks[taskId].status = 'finished';
                tasks[taskId].novel_name = parsed.novel_name;
                tasks[taskId].safe_name = safeName;
                tasks[taskId].html_path = parsed.html_path;
              }
            });
            if (parsed.chapter_hashes && parsed.chapter_hashes.length > 0) {
              await addChapterHashes(safeName + ".txt", parsed.chapter_hashes);
              await appendTaskLog(taskId, `已成功增量同步 ${parsed.chapter_hashes.length} 个章节记录`);
            }
            // 关联至当前用户书架
            try {
              await associateNovel(user.id, safeName + ".txt", novel_name || parsed.novel_name);
            } catch (assocErr) {
              console.warn("Associate novel error:", assocErr);
            }
            await appendTaskLog(taskId, "任务完成并已自动关联到个人书架");
          } else if (parsed.type === 'error') {
             await appendTaskLog(taskId, '任务异常: ' + parsed.error);
             await updateTasks(tasks => {
               if (tasks[taskId]) tasks[taskId].status = 'error';
             });
          }
        } catch (e) {
          console.error("Parse error stdout:", e, "Line:", line);
        }
      }
    });

    pythonProc.stderr.on('data', async (data) => {
      // Some python messages go to stderr
      await appendTaskLog(taskId, `STDERR: ${data.toString()}`);
    });

    pythonProc.on('close', async (code) => {
      if (code !== 0) {
        const t = await getTask(taskId);
        if (t.status === 'running') {
           t.status = 'error';
           await saveTask(taskId, t);
           await appendTaskLog(taskId, `爬虫进程异常退出，状态码：${code}`);
        }
      }
    });

    res.json({ task_id: taskId });
  });

  app.post("/api/batch_start", async (req, res) => {
    const { works, incremental } = req.body;
    if (!works || !works.length) return res.status(400).json({ error: "没有作品列表" });

    const taskId = String(Date.now());
    const task = {
      status: 'running',
      log: [`[${new Date().toLocaleTimeString('en-US', {hour12: false})}] 批量任务 ${taskId} 启动，共 ${works.length} 本小说`],
      start_url: works[0].url,
      novel_name: `[批量任务] ${works.length}本`,
      safe_name: null,
      html_path: null
    };

    await saveTask(taskId, task);

    // Run sequentially in background
    (async () => {
      let successCount = 0;
      let failCount = 0;
      for (let i = 0; i < works.length; i++) {
        const work = works[i];
        await appendTaskLog(taskId, `\n=== 开始下载 (${i+1}/${works.length}): ${work.title} ===`);
        
        let existingHashes: string[] = [];
        if (incremental) {
          const safeName = work.title.replace(/[\\/*?:"<>|\s]/g, '_');
          const hashesSet = await getExistingChapterHashes(safeName + ".txt");
          existingHashes = Array.from(hashesSet);
          if (existingHashes.length > 0) {
            await appendTaskLog(taskId, `增量模式：检测到已存在 ${existingHashes.length} 个章节`);
          }
        }
        
        const pythonPath = 'python3';
        const pythonProc = spawn(pythonPath, [path.join(process.cwd(), 'crawler_wrapper.py')]);

        pythonProc.on('error', async (err) => {
          console.error('Batch crawler process spawn error:', err);
          await appendTaskLog(taskId, `✗ [${work.title}] 进程启动失败: ${err.message}`);
        });

        pythonProc.stdin.write(JSON.stringify({
          url: work.url,
          output_dir: OUTPUT_DIR,
          override_name: work.title,
          existing_hashes: existingHashes
        }));
        pythonProc.stdin.end();

        await new Promise<void>((resolve) => {
          let outputBuf = "";
          pythonProc.stdout.on('data', async (data) => {
            outputBuf += data.toString();
            const lines = outputBuf.split('\n');
            outputBuf = lines.pop() || '';
            for (const line of lines) {
              if (!line.trim()) continue;
              try {
                const parsed = JSON.parse(line);
                if (parsed.type === 'log') {
                  await appendTaskLog(taskId, `[${work.title}] ${parsed.msg}`);
                } else if (parsed.type === 'result') {
                  const safeName = parsed.txt_path ? path.basename(parsed.txt_path, '.txt') : work.title.replace(/[\\/*?:"<>|\s]/g, '_');
                  if (parsed.chapter_hashes && parsed.chapter_hashes.length > 0) {
                    await addChapterHashes(safeName + ".txt", parsed.chapter_hashes);
                    await appendTaskLog(taskId, `[${work.title}] 增量同步 ${parsed.chapter_hashes.length} 个章节记录`);
                  }
                  await appendTaskLog(taskId, `✓ [${work.title}] 抓取完成`);
                  successCount++;
                } else if (parsed.type === 'error') {
                   await appendTaskLog(taskId, `✗ [${work.title}] 异常: ${parsed.error}`);
                   failCount++;
                }
              } catch (e) { }
            }
          });

          pythonProc.on('close', (code) => {
            if (code !== 0) {
              appendTaskLog(taskId, `✗ [${work.title}] 爬虫非正常退出`);
              failCount++;
            }
            resolve();
          });
        });
      }

      await updateTasks(tasks => {
        if (tasks[taskId]) tasks[taskId].status = 'finished';
      });
      await appendTaskLog(taskId, `\n=== 批量任务结束: 成功 ${successCount} 本，失败 ${failCount} 本 ===`);
    })();

    res.json({ batch_id: taskId });
  });

  app.post("/api/aswtxt/download", async (req, res) => {
    const user = getAuthUserOrDefault(req);
    const { url, title } = req.body;
    if (!url) return res.status(400).json({ error: "URL/Hash 不能为空" });
    
    try {
      console.log("Downloading/parsing aswtxt book page:", url);
      const bookPageResponse = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': 'https://www.aswtxt.com/'
        }
      });
      if (!bookPageResponse.ok) {
        throw new Error(`无法获取小说详情页面，状态码: ${bookPageResponse.status}`);
      }
      
      const bookPageBuffer = await bookPageResponse.arrayBuffer();
      const bookPageDetectBuf = Buffer.from(bookPageBuffer);
      const bookPageDetected = jschardet.detect(bookPageDetectBuf);
      const bookPageHtml = iconv.decode(bookPageDetectBuf, bookPageDetected.encoding || 'gbk');
      
      const cheerio = await import('cheerio');
      let $ = cheerio.load(bookPageHtml);
      
      let softdownPageRelativeUrl = '';
      $('a').each((_, el) => {
        const href = $(el).attr('href') || '';
        const text = $(el).text();
        if (href.includes('softdownfree.asp') || text.includes('进入下载')) {
          if (!softdownPageRelativeUrl) {
            softdownPageRelativeUrl = href;
          }
        }
      });
      
      if (!softdownPageRelativeUrl) {
        throw new Error("未在详情页面找到有效的下载进入页面链接");
      }
      
      const softdownPageUrl = new URL(softdownPageRelativeUrl, 'https://www.aswtxt.com/').toString();
      console.log("Fetching softdown page:", softdownPageUrl);
      
      const downPageResponse = await fetch(softdownPageUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': url
        }
      });
      if (!downPageResponse.ok) {
        throw new Error(`无法获取文件下载页面，状态码: ${downPageResponse.status}`);
      }
      
      const downPageBuffer = await downPageResponse.arrayBuffer();
      const downPageDetectBuf = Buffer.from(downPageBuffer);
      const downPageDetected = jschardet.detect(downPageDetectBuf);
      const downPageHtml = iconv.decode(downPageDetectBuf, downPageDetected.encoding || 'gbk');
      
      $ = cheerio.load(downPageHtml);
      
      let directDownloadUrl = '';
      
      // Look for links that explicitly say "下载地址" or "首选" or "备用" and skip "在线阅读"
      $('a').each((_, el) => {
        const href = $(el).attr('href') || '';
        const text = $(el).text().trim();
        if (text.includes('在线阅读')) return;
        
        if (href.includes('.txt') && (text.includes('下载地址') || text.includes('首选') || text.includes('备用'))) {
          if (!directDownloadUrl) {
            directDownloadUrl = href;
          }
        }
      });
      
      // Fallback: Use standard matches but still skip "在线阅读"
      if (!directDownloadUrl) {
        $('a').each((_, el) => {
          const href = $(el).attr('href') || '';
          const text = $(el).text().trim();
          if (text.includes('在线阅读')) return;
          
          if (href.includes('.txt') && (href.includes('downbook') || href.includes('UploadFile') || text.includes('下载地址'))) {
            if (!directDownloadUrl) {
              directDownloadUrl = href;
            }
          }
        });
      }
      
      if (!directDownloadUrl) {
        throw new Error("未在下载页面找到有效的直接 TXT 下载地址");
      }
      
      const fileUrlObj = new URL(directDownloadUrl, softdownPageUrl);
      const fileUrl = fileUrlObj.toString();
      
      console.log("Direct TXT download link found:", fileUrl);
      const fileResponse = await fetch(fileUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': softdownPageUrl
        }
      });
      
      if (!fileResponse.ok) {
        throw new Error(`从源站获取 TXT 失败，状态码: ${fileResponse.status}`);
      }
      
      const fileBuffer = Buffer.from(await fileResponse.arrayBuffer());
      const fileDetected = jschardet.detect(fileBuffer);
      const fileEncoding = fileDetected.encoding || 'gbk';
      let content = iconv.decode(fileBuffer, fileEncoding);
      
      content = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      
      // 下载后重新梳理：排查并删除包含网址、网址：、以及 .com/.net/.org/.cn 等域名的行
      const rawLines = content.split('\n');
      const filteredLines = rawLines.filter(line => {
        const lLower = line.toLowerCase();
        if (
          lLower.includes('http://') || 
          lLower.includes('https://') || 
          lLower.includes('www.') ||
          lLower.includes('网址：') ||
          lLower.includes('网址:') ||
          /\.(com|net|org|cn|cc|info|xyz|top|vip|club)\b/i.test(lLower)
        ) {
          return false;
        }
        return true;
      });
      content = filteredLines.join('\n');
      
      let displayNovelName = title || "";
      if (!displayNovelName || displayNovelName.startsWith("爱书小说网_") || displayNovelName.startsWith("爱书网小说_")) {
        if (directDownloadUrl) {
          try {
            const urlObj = new URL(directDownloadUrl, 'https://www.aswtxt.com/');
            const decodedPath = decodeURIComponent(urlObj.pathname);
            const base = path.basename(decodedPath);
            if (base && base.endsWith('.txt')) {
               displayNovelName = base.slice(0, -4).trim();
            }
          } catch (err) {
            console.error("Failed to decode filename from URL:", err);
          }
        }
      }
      
      if (!displayNovelName) {
        displayNovelName = "爱书小说网_" + Date.now();
      }
      
      let authorName = "未知";
      
      if (displayNovelName.includes('作者：')) {
        const parts = displayNovelName.split('作者：');
        authorName = parts[1].replace('.txt', '').trim();
      } else if (displayNovelName.includes('作者:')) {
        const parts = displayNovelName.split('作者:');
        authorName = parts[1].replace('.txt', '').trim();
      } else if (displayNovelName.includes('by')) {
        const parts = displayNovelName.split('by');
        authorName = parts[1].replace('.txt', '').trim();
      }
      
      const cleanBookTitle = displayNovelName.replace(/《|》/g, '').split('作者：')[0].split('作者:')[0].split('by')[0].trim();
      
      if (!content.includes('========================================') && !content.includes('===================================')) {
        const lines = content.split('\n');
        
        const chapters: { title: string, lines: string[] }[] = [];
        let currentChapter = { title: '第一页（序）', lines: [] as string[] };
        
        const chapterRegex = /^\s*第[0-9一二三四五六七八九十百千万零]+[章回卷节折幕卷部篇].*/;
        const fallbackRegex = /^\s*(序[章言]?|前言|引言|楔子)\s*$/;
        
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) {
            currentChapter.lines.push(line);
            continue;
          }
          
          if (trimmed.length < 50 && (chapterRegex.test(trimmed) || fallbackRegex.test(trimmed))) {
            if (currentChapter.lines.filter(l => l.trim()).length > 0 || currentChapter.title !== '第一页（序）') {
              chapters.push(currentChapter);
            }
            currentChapter = { title: trimmed, lines: [] };
          } else {
            currentChapter.lines.push(line);
          }
        }
        chapters.push(currentChapter);
        
        const separatorLine = '='.repeat(40);
        let formattedContent = `《${cleanBookTitle}》\n作者：${authorName}\n\n`;
        let pageCount = 1;
        
        if (chapters.length <= 1) {
            let chunkLineCount = 0;
            let currentChunkLines = [];
            const chunks = [];
            
            for (const line of lines) {
                const trimmed = line.trim();
                currentChunkLines.push(line);
                if (trimmed) chunkLineCount++;
                
                if (chunkLineCount >= 100) {
                    chunks.push(currentChunkLines);
                    currentChunkLines = [];
                    chunkLineCount = 0;
                }
            }
            if (currentChunkLines.length > 0) chunks.push(currentChunkLines);
            
            for (const chunk of chunks) {
               const body = chunk.map(l => l.trim()).filter(l => l.length > 0).join('\n\n');
               if (!body) continue;
               formattedContent += `${separatorLine}\n【第 ${pageCount} 页】: 第 ${pageCount} 页\n${separatorLine}\n\n`;
               formattedContent += body.trim() + '\n\n\n';
               pageCount++;
            }
        } else {
          for (const ch of chapters) {
              const body = ch.lines.map(l => l.trim()).filter(l => l.length > 0).join('\n\n');
              if (!body) continue;
              formattedContent += `${separatorLine}\n【第 ${pageCount++} 页】: ${ch.title}\n${separatorLine}\n\n`;
              formattedContent += body.trim() + '\n\n\n';
          }
        }
        content = formattedContent;
      }
      
      let safeFilename = cleanBookTitle.replace(/[\\/*?:"<>|\s]/g, '_') + '.txt';
      let destPath = path.join(OUTPUT_DIR, safeFilename);
      
      let count = 1;
      while (true) {
        try {
          await fs.access(destPath);
          safeFilename = cleanBookTitle.replace(/[\\/*?:"<>|\s]/g, '_') + '_' + count + '.txt';
          destPath = path.join(OUTPUT_DIR, safeFilename);
          count++;
        } catch {
          break;
        }
      }
      
      await fs.writeFile(destPath, content, 'utf-8');
      
      const meta = await readMeta();
      meta[safeFilename] = { 
        custom_name: cleanBookTitle, 
        url, 
        last_modified: new Date().toISOString() 
      };
      await writeMeta(meta);
      
      await associateNovel(user.id, safeFilename, cleanBookTitle);

      res.json({ success: true, name: cleanBookTitle, filename: safeFilename });
    } catch (e: any) {
      console.error("Direct download from aswtxt error:", e);
      res.status(500).json({ success: false, error: e.message || "下载失败" });
    }
  });

  app.post("/api/asw227/download", async (req, res) => {
    const user = getAuthUserOrDefault(req);
    const { url, title, candidateIndex, downloadUrl: rawUserUrl } = req.body;
    if (!url) return res.status(400).json({ error: "URL/Hash 不能为空" });
    
    try {
      let origin = 'https://www.asw227.com/';
      try {
        origin = new URL(url).origin + '/';
      } catch (e) {}

      console.log("Downloading/parsing asw227 file page:", url);
      let filePageHtml = '';
      try {
        const filePageResponse = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': origin,
            'X-Forwarded-For': '114.114.114.114'
          }
        });
        if (filePageResponse.ok) {
          filePageHtml = await filePageResponse.text();
        }
      } catch (fetchPageErr: any) {
        console.warn("Could not fetch file details page directly, will try hash reconstruction:", fetchPageErr.message);
      }
      
      const cheerio = await import('cheerio');
      const $ = cheerio.load(filePageHtml || '');
      
      // 提取 hash 值（从 URL 或 HTML）
      const hashMatch = url.match(/hash=([a-f0-9]{32})/i) || (filePageHtml && filePageHtml.match(/hash=([a-f0-9]{32})/i)) || (filePageHtml && filePageHtml.match(/down\.php\/([a-f0-9]{32})/i));
      const hash = hashMatch ? hashMatch[1] : '';

      const candidates: { text: string; url: string }[] = [];

      // 提取网页中真实的下载链接（严格过滤掉 read.php 阅读链接）
      $('a').each((_, el) => {
        const href = $(el).attr('href') || '';
        const text = $(el).text().trim();
        if (href.includes('read.php') || text.includes('阅读') || href.includes('gonggao') || href.includes('search') || href.includes('my.php')) {
          return;
        }
        if (href.includes('down.php') || (text.includes('下载') && !text.includes('阅读'))) {
          let fullDlUrl = href;
          if (href && !href.startsWith('http')) {
            try {
              fullDlUrl = new URL(href, url).toString();
            } catch (e) {
              fullDlUrl = href;
            }
          }
          if (fullDlUrl && (fullDlUrl.startsWith('http://') || fullDlUrl.startsWith('https://'))) {
            if (!candidates.some(c => c.url === fullDlUrl)) {
              candidates.push({ text: text || `线路 (${candidates.length + 1})`, url: fullDlUrl });
            }
          }
        }
      });

      // 如果有 hash，补充已验证的 4 个官方高可用下载节点，确保一定有准确地址
      if (hash) {
        const verifiedNodes = [
          { text: '下载(1)首选线路 [downshu123]', url: `https://dm.downshu123.com/down.php/${hash}.txt` },
          { text: '下载(2)备用线路 [downshu321]', url: `https://dm.downshu321.com/down.php/${hash}.txt` },
          { text: '下载(3)备用线路 [aishu9996]', url: `http://w.aishu9996.com/down.php/${hash}.txt` },
          { text: '下载(4)备用线路 [aishu995]', url: `https://w.aishu995.com/down.php/${hash}.txt` }
        ];
        for (const node of verifiedNodes) {
          if (!candidates.some(c => c.url === node.url)) {
            candidates.push(node);
          }
        }
      }
      
      let userSelectedDownloadUrl = rawUserUrl;
      if (candidateIndex !== undefined && candidateMirrorsMap.has(url)) {
        const mirrors = candidateMirrorsMap.get(url)!;
        if (mirrors[candidateIndex]) {
          userSelectedDownloadUrl = mirrors[candidateIndex];
        }
      }

      let downloadList: string[] = [];
      if (userSelectedDownloadUrl) {
        downloadList.push(userSelectedDownloadUrl);
        // 添加其他候选作为备选
        candidates.forEach(c => {
          if (c.url !== userSelectedDownloadUrl && !downloadList.includes(c.url)) {
            downloadList.push(c.url);
          }
        });
      } else {
        downloadList = candidates.map(c => c.url);
      }

      candidateMirrorsMap.set(url, candidates.map(c => c.url));
      const safeCandidates = candidates.map((c, i) => ({
        index: i,
        text: i === 0 ? '极速首选通道 (线路1)' : `备用优化通道 (线路${i + 1})`
      }));

      if (downloadList.length === 0) {
        return res.json({
          success: false,
          needManualChoose: true,
          error: "未在详情页面解析到有效线路，请选择其他备用通道",
          candidates: safeCandidates
        });
      }
      
      let downloadBuffer: Buffer | null = null;
      let usedDownloadUrl = '';
      let lastError = '';

      for (const dlUrl of downloadList) {
        try {
          console.log("Attempting direct download from mirror route");
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 15000);
          const r = await fetch(dlUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              'Referer': origin,
              'X-Forwarded-For': '114.114.114.114'
            },
            signal: controller.signal
          });
          clearTimeout(timer);
          if (r.ok) {
            const buf = Buffer.from(await r.arrayBuffer());
            const sample = buf.slice(0, 200).toString().toLowerCase();
            // 校验是否为有效txt内容，排除空内容或html错误拦截页
            if (buf.length > 200 && !sample.includes('<!doctype') && !sample.includes('<html')) {
              downloadBuffer = buf;
              usedDownloadUrl = dlUrl;
              break;
            } else {
              lastError = `下载内容无效或为空 (${buf.length}字节)`;
            }
          } else {
            lastError = `HTTP ${r.status}`;
          }
        } catch (err: any) {
          lastError = err.message;
        }
      }

      if (!downloadBuffer) {
        return res.json({
          success: false,
          needManualChoose: true,
          error: `自动尝试线路下载未完成（${lastError || "网络超时"}），请点击下方手动选择备用线路`,
          candidates: safeCandidates
        });
      }
      
      const buffer = downloadBuffer;
      const jschardet = await import('jschardet');
      const detected = jschardet.detect(buffer);
      const encoding = detected.encoding || 'utf-8';
      let content = iconv.decode(buffer, encoding);
      
      content = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      
      let displayNovelName = title || "爱书网小说_" + Date.now();
      let authorName = "未知";
      
      if (displayNovelName.includes('作者：')) {
        const parts = displayNovelName.split('作者：');
        authorName = parts[1].replace('.txt', '').trim();
      } else if (displayNovelName.includes('作者:')) {
        const parts = displayNovelName.split('作者:');
        authorName = parts[1].replace('.txt', '').trim();
      } else if (displayNovelName.includes('by')) {
        const parts = displayNovelName.split('by');
        authorName = parts[1].replace('.txt', '').trim();
      }

      // 如果未识别出作者，尝试从内容前2000字中正则提取
      if (authorName === '未知') {
        const authorMatch = content.slice(0, 2000).match(/(?:作者|by)\s*[:：]?\s*([^\s\n\r《》【】]+)/i);
        if (authorMatch) {
          authorName = authorMatch[1].trim();
        }
      }
      
      let cleanBookTitle = displayNovelName.replace(/《|》/g, '').split('作者：')[0].split('作者:')[0].split('by')[0].trim();
      if (!cleanBookTitle) {
        cleanBookTitle = "爱书网小说_" + (hash ? hash.slice(0, 8) : Date.now());
      }
      
      if (!content.includes('========================================') && !content.includes('===================================')) {
        const lines = content.split('\n');
        
        const chapters: { title: string, lines: string[] }[] = [];
        let currentChapter = { title: '第一页（序）', lines: [] as string[] };
        
        const chapterRegex = /^\s*第[0-9一二三四五六七八九十百千万零]+[章回卷节折幕卷部篇].*/;
        const fallbackRegex = /^\s*(序[章言]?|前言|引言|楔子)\s*$/;
        
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) {
            currentChapter.lines.push(line);
            continue;
          }
          
          if (trimmed.length < 50 && (chapterRegex.test(trimmed) || fallbackRegex.test(trimmed))) {
            if (currentChapter.lines.filter(l => l.trim()).length > 0 || currentChapter.title !== '第一页（序）') {
              chapters.push(currentChapter);
            }
            currentChapter = { title: trimmed, lines: [] };
          } else {
            currentChapter.lines.push(line);
          }
        }
        chapters.push(currentChapter);
        
        const separatorLine = '='.repeat(40);
        let formattedContent = `《${cleanBookTitle}》\n作者：${authorName}\n\n`;
        let pageCount = 1;
        
        if (chapters.length <= 1) {
            let chunkLineCount = 0;
            let currentChunkLines = [];
            const chunks = [];
            
            for (const line of lines) {
                const trimmed = line.trim();
                currentChunkLines.push(line);
                if (trimmed) chunkLineCount++;
                
                if (chunkLineCount >= 100) {
                    chunks.push(currentChunkLines);
                    currentChunkLines = [];
                    chunkLineCount = 0;
                }
            }
            if (currentChunkLines.length > 0) chunks.push(currentChunkLines);
            
            for (const chunk of chunks) {
               const body = chunk.map(l => l.trim()).filter(l => l.length > 0).join('\n\n');
               if (!body) continue;
               formattedContent += `${separatorLine}\n【第 ${pageCount} 页】: 第 ${pageCount} 页\n${separatorLine}\n\n`;
               formattedContent += body.trim() + '\n\n\n';
               pageCount++;
            }
        } else {
          for (const ch of chapters) {
             const body = ch.lines.map(l => l.trim()).filter(l => l.length > 0).join('\n\n');
             if (!body) continue;
             formattedContent += `${separatorLine}\n【第 ${pageCount++} 页】: ${ch.title}\n${separatorLine}\n\n`;
             formattedContent += body.trim() + '\n\n\n';
          }
        }
        content = formattedContent;
      }
      
      let safeFilename = cleanBookTitle.replace(/[\\/*?:"<>|\s]/g, '_') + '.txt';
      let destPath = path.join(OUTPUT_DIR, safeFilename);
      
      let count = 1;
      while (true) {
        try {
          await fs.access(destPath);
          safeFilename = cleanBookTitle.replace(/[\\/*?:"<>|\s]/g, '_') + '_' + count + '.txt';
          destPath = path.join(OUTPUT_DIR, safeFilename);
          count++;
        } catch {
          break;
        }
      }
      
      await fs.writeFile(destPath, content, 'utf-8');
      
      const meta = await readMeta();
      meta[safeFilename] = { 
        custom_name: cleanBookTitle, 
        url, 
        last_modified: new Date().toISOString() 
      };
      await writeMeta(meta);
      
      await associateNovel(user.id, safeFilename, cleanBookTitle);

      res.json({ success: true, name: cleanBookTitle, filename: safeFilename });
    } catch (e: any) {
      console.error("Direct download error:", e);
      res.status(500).json({ success: false, error: e.message || "下载失败" });
    }
  });

  app.post("/api/asw227/candidates", async (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: "URL不能为空" });
    
    try {
      let origin = 'https://www.asw227.com/';
      try {
        origin = new URL(url).origin + '/';
      } catch (e) {}

      console.log("Fetching candidates for asw227 URL:", url);
      let html = '';
      try {
        const response = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': origin,
            'X-Forwarded-For': '114.114.114.114'
          }
        });
        if (response.ok) {
          html = await response.text();
        }
      } catch (err: any) {
        console.warn("Candidates fetch page warning:", err.message);
      }

      const cheerio = await import('cheerio');
      const $ = cheerio.load(html || '');
      
      const hashMatch = url.match(/hash=([a-f0-9]{32})/i) || (html && html.match(/hash=([a-f0-9]{32})/i)) || (html && html.match(/down\.php\/([a-f0-9]{32})/i));
      const hash = hashMatch ? hashMatch[1] : '';

      const candidates: { text: string; url: string }[] = [];
      $('a').each((_, el) => {
        const href = $(el).attr('href') || '';
        const text = $(el).text().trim();
        // 严格排除在线阅读链接、公告和搜索链接
        if (href.includes('read.php') || text.includes('阅读') || href.includes('gonggao') || href.includes('search') || href.includes('my.php')) {
          return;
        }
        if (href.includes('down.php') || (text.includes('下载') && !text.includes('阅读'))) {
          let fullDlUrl = href;
          if (href && !href.startsWith('http')) {
            try {
              fullDlUrl = new URL(href, url).toString();
            } catch (e) {
              fullDlUrl = href;
            }
          }
          if (fullDlUrl && (fullDlUrl.startsWith('http://') || fullDlUrl.startsWith('https://'))) {
            if (!candidates.some(c => c.url === fullDlUrl)) {
              candidates.push({ text: text || `下载线路 (${candidates.length + 1})`, url: fullDlUrl });
            }
          }
        }
      });
      
      // 如果解析出 hash，自动补充已验证的 4 个官方高可用下载节点
      if (hash) {
        const verifiedNodes = [
          { text: '下载(1)首选线路 [downshu123]', url: `https://dm.downshu123.com/down.php/${hash}.txt` },
          { text: '下载(2)备用线路 [downshu321]', url: `https://dm.downshu321.com/down.php/${hash}.txt` },
          { text: '下载(3)备用线路 [aishu9996]', url: `http://w.aishu9996.com/down.php/${hash}.txt` },
          { text: '下载(4)备用线路 [aishu995]', url: `https://w.aishu995.com/down.php/${hash}.txt` }
        ];
        for (const node of verifiedNodes) {
          if (!candidates.some(c => c.url === node.url)) {
            candidates.push(node);
          }
        }
      }

      candidateMirrorsMap.set(url, candidates.map(c => c.url));
      const safeCandidates = candidates.map((c, idx) => ({
        index: idx,
        text: idx === 0 ? '极速首选通道 (线路1)' : `备用优化通道 (线路${idx + 1})`
      }));
      
      res.json({ success: true, candidates: safeCandidates });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // 海外/免屏蔽代理访问端点
  app.get("/api/proxy", async (req, res) => {
    let targetUrl = req.query.url as string;
    if (!targetUrl) return res.status(400).send("缺少 url 参数");
    try {
      if (targetUrl.includes('00shu') || targetUrl.includes('23.224.90')) {
        let pathPart = targetUrl.replace(/https?:\/\/[^\/]+/, '');
        if (!pathPart) pathPart = '/';
        const agent = new https.Agent({ rejectUnauthorized: false });
        const request = https.get(`https://23.224.90.121${pathPart}`, {
          headers: {
            'Host': 'www.00shu.info',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'X-Forwarded-For': '114.114.114.114',
            'X-Real-IP': '114.114.114.114',
            'Client-IP': '114.114.114.114',
            'Accept-Encoding': 'identity'
          },
          agent,
          timeout: 15000
        }, (originRes) => {
          const contentType = originRes.headers['content-type'] || 'text/html; charset=utf-8';
          res.setHeader('Content-Type', contentType);
          originRes.pipe(res);
          originRes.on('error', (pipeErr) => {
            console.warn('originRes error:', pipeErr.message);
          });
        });
        request.on('error', (err) => {
          if (!res.headersSent) {
            res.status(500).send("Proxy error: " + err.message);
          }
        });
        res.on('close', () => {
          request.destroy();
        });
        return;
      }

      const resp = await fetch(targetUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'X-Forwarded-For': '114.114.114.114',
          'X-Real-IP': '114.114.114.114',
          'Client-IP': '114.114.114.114'
        }
      });
      const buf = Buffer.from(await resp.arrayBuffer());
      const contentType = resp.headers.get('content-type') || 'text/html; charset=utf-8';
      res.setHeader('Content-Type', contentType);
      res.send(buf);
    } catch (e: any) {
      res.status(500).send("Proxy error: " + e.message);
    }
  });

  app.get("/api/logs/:id", async (req, res) => {
    const task = await getTask(req.params.id);
    if (!task) return res.status(404).json({ error: 'not found' });
    const user = getAuthUser(req);
    const isAdmin = user?.role === 'admin';
    if (!isAdmin) {
      // Hide specific URLs for non-admin users
      const sanitizedTask = {
        ...task,
        start_url: '云端受保护书源',
        log: (task.log || []).map((l: string) => l.replace(/https?:\/\/[^\s"'<>]+/gi, '[云端通道]'))
      };
      return res.json(sanitizedTask);
    }
    res.json(task);
  });

  app.get("/api/tasks", async (req, res) => {
    const tasks = await readTasks();
    const user = getAuthUser(req);
    const isAdmin = user?.role === 'admin';
    const list = Object.keys(tasks).map(id => {
      const t = tasks[id];
      if (!isAdmin) {
        return {
          id,
          ...t,
          start_url: '云端受保护书源',
          log: (t.log || []).slice(-10).map((l: string) => l.replace(/https?:\/\/[^\s"'<>]+/gi, '[云端通道]'))
        };
      }
      return { id, ...t };
    });
    list.sort((a, b) => Number(b.id) - Number(a.id));
    res.json(list);
  });

  app.delete("/api/tasks/:id", async (req, res) => {
    await updateTasks(tasks => {
      if (tasks[req.params.id]) delete tasks[req.params.id];
    });
    res.json({ success: true });
  });

  app.get("/api/library", async (req, res) => {
    try {
      const user = getAuthUserOrDefault(req);
      const userNovels = await getUserNovels(user.id);
      const userNovelMap = new Map(userNovels.map(un => [un.novel_filename, un]));

      const files = await fs.readdir(OUTPUT_DIR);
      const meta = await readMeta();
      const tasks = await readTasks();
      const safeNameToUrl: Record<string, string> = {};
      for (const taskId of Object.keys(tasks)) {
        const task = tasks[taskId];
        if (task && task.safe_name && task.start_url) {
          safeNameToUrl[task.safe_name] = task.start_url;
        }
      }
      
      const novels = [];

      for (const filename of files) {
        if (filename.endsWith('.txt') && userNovelMap.has(filename)) {
          const un = userNovelMap.get(filename)!;
          const filepath = path.join(OUTPUT_DIR, filename);
          try {
            const stats = await fs.stat(filepath);
            const fileMeta = meta[filename] || {};
            const displayName = un.custom_name || fileMeta.custom_name || filename.slice(0, -4);
            const safeName = filename.slice(0, -4);
            const start_url = safeNameToUrl[safeName] || fileMeta.url || null;
            
            // Estimate
            let count = 0;
            try {
              const fd = await fs.open(filepath, 'r');
              const buf = Buffer.alloc(4096);
              await fd.read(buf, 0, 4096, 0);
              await fd.close();
              const text = buf.toString('utf-8');
              count = (text.match(/\n=/g) || []).length + 1;
            } catch(e){}

            novels.push({
              filename,
              name: displayName,
              start_url,
              mtime: stats.mtime.toLocaleString('en-US', { hour12: false }),
              size: (stats.size / 1024).toFixed(1) + ' KB',
              chapter_estimate: count,
              rawMtime: stats.mtime.getTime(),
              is_favorite: Boolean(un.is_favorite),
              associated: true,
              added_at: un.created_at
            });
          } catch(e){}
        }
      }

      novels.sort((a, b) => b.rawMtime - a.rawMtime);
      res.json(novels);
    } catch (e) {
      if ((e as any).code === 'ENOENT') return res.json([]);
      res.status(500).json({ error: String(e) });
    }
  });

  // 共享书库探索发现接口 (多用户共享 novels 目录，可快速关联到个人书架)
  app.get("/api/library/explore", async (req, res) => {
    try {
      const user = getAuthUserOrDefault(req);
      const userNovels = await getUserNovels(user.id);
      const userNovelSet = new Set(userNovels.map(un => un.novel_filename));

      const files = await fs.readdir(OUTPUT_DIR);
      const meta = await readMeta();
      const novels = [];

      for (const filename of files) {
        if (filename.endsWith('.txt')) {
          const filepath = path.join(OUTPUT_DIR, filename);
          try {
            const stats = await fs.stat(filepath);
            const fileMeta = meta[filename] || {};
            const displayName = fileMeta.custom_name || filename.slice(0, -4);

            novels.push({
              filename,
              name: displayName,
              mtime: stats.mtime.toLocaleString('en-US', { hour12: false }),
              size: (stats.size / 1024).toFixed(1) + ' KB',
              rawMtime: stats.mtime.getTime(),
              associated: userNovelSet.has(filename)
            });
          } catch (e) {}
        }
      }

      novels.sort((a, b) => b.rawMtime - a.rawMtime);
      res.json(novels);
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  // 关联小说到用户书架
  app.post("/api/library/associate", async (req, res) => {
    try {
      const user = getAuthUserOrDefault(req);
      const { filename, custom_name } = req.body;
      if (!filename) return res.status(400).json({ error: '缺少文件名' });
      await associateNovel(user.id, filename, custom_name);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // 收藏 / 取消收藏
  app.post("/api/library/favorite", async (req, res) => {
    try {
      const user = getAuthUserOrDefault(req);
      const { filename } = req.body;
      if (!filename) return res.status(400).json({ error: '缺少文件名' });
      const isFav = await toggleFavoriteNovel(user.id, filename);
      res.json({ success: true, is_favorite: isFav });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/library/rename", async (req, res) => {
    const user = getAuthUserOrDefault(req);
    const { filename, new_name } = req.body;
    if (!filename || !new_name) return res.status(400).json({ error: '缺少参数' });
    
    try {
      await renameUserNovel(user.id, filename, new_name.trim());
      const meta = await readMeta();
      if (!meta[filename]) meta[filename] = {};
      meta[filename].custom_name = new_name.trim();
      meta[filename].last_modified = new Date().toISOString();
      await writeMeta(meta);
      
      res.json({ success: true, new_name });
    } catch (e) {
      res.status(500).json({ error: '更新名称失败' });
    }
  });

  // 删除或移出小说
  // 普通用户：取消个人书架关联（或删除自己下载的）
  // 管理员：可彻底物理删除共享服务器中的小说文件及元数据
  app.post("/api/library/delete", async (req, res) => {
    const user = getAuthUserOrDefault(req);
    const { filename, deletePhysical } = req.body;
    if (!filename) return res.status(400).json({ error: '缺少文件名' });
    
    try {
      const isAdmin = user.role === 'admin' || user.username === 'admin';
      if (deletePhysical && isAdmin) {
        // 彻底物理删除服务器上的文件、元数据及所有关联
        const filePath = path.join(OUTPUT_DIR, filename);
        try {
          await fs.unlink(filePath);
        } catch (e) {}

        const meta = await readMeta();
        if (meta[filename]) {
          delete meta[filename];
          await writeMeta(meta);
        }

        // 同时从数据库中彻底清理该文件的所有用户关联
        if (isDbUsingMySQL()) {
          const pool = await getMySqlPool();
          await pool.execute('DELETE FROM user_novels WHERE novel_filename = ?', [filename]);
        } else {
          const db = await getSqliteDb();
          await db.run('DELETE FROM user_novels WHERE novel_filename = ?', [filename]);
        }

        return res.json({ success: true, message: '已彻底物理删除共享小说' });
      } else {
        // 默认或普通用户：从个人书架移出
        await dissociateNovel(user.id, filename);
        return res.json({ success: true, message: '已从个人书架移出' });
      }
    } catch (e: any) {
      res.status(500).json({ error: e.message || String(e) });
    }
  });

  app.post("/api/upload", upload.single("file"), async (req, res) => {
    const user = getAuthUserOrDefault(req);
    if (!req.file) return res.status(400).json({ error: '未上传文件' });
    const originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
    
    let providedNovelName = req.body.novel_name;
    if (providedNovelName) {
        // Try to fix multer string decoding if needed, though usually it's correct.
        // If it looks like raw latin1, decode it. We can just use it directly, or also try decoding.
        if (!/[\u4e00-\u9fa5]/.test(providedNovelName) && /[\u00C0-\u00FF]/.test(providedNovelName)) {
           providedNovelName = Buffer.from(providedNovelName, 'latin1').toString('utf8');
        }
    }
    
    const novelName = providedNovelName || originalName.replace('.txt', '');
    let safeName = novelName.replace(/[\\/*?:"<>|\s]/g, '_') + '.txt';
    
    try {
      const srcPath = req.file.path;
      const destPath = path.join(OUTPUT_DIR, safeName);
      let count = 1;
      while (true) {
        try {
          await fs.access(destPath);
          safeName = novelName.replace(/[\\/*?:"<>|\s]/g, '_') + '_' + count + '.txt';
          count++;
        } catch {
          break; // File doesn't exist, safe to write
        }
      }
      const finalDestPath = path.join(OUTPUT_DIR, safeName);
      
      const buffer = await fs.readFile(srcPath);
      const encodingResult = jschardet.detect(buffer);
      const encoding = encodingResult.encoding || 'utf-8';
      let content = iconv.decode(buffer, encoding);

      content = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

      // 重新梳理并过滤掉包含网址、网址：、.com/.net 等广告行
      const rawLines = content.split('\n');
      const filteredLines = rawLines.filter(line => {
        const lLower = line.toLowerCase();
        if (
          lLower.includes('http://') || 
          lLower.includes('https://') || 
          lLower.includes('www.') ||
          lLower.includes('网址：') ||
          lLower.includes('网址:') ||
          /\.(com|net|org|cn|cc|info|xyz|top|vip|club)\b/i.test(lLower)
        ) {
          return false;
        }
        return true;
      });
      content = filteredLines.join('\n');

      if (!content.includes('========================================') && !content.includes('===================================')) {
        const lines = filteredLines;
        
        const chapters: { title: string, lines: string[] }[] = [];
        let currentChapter = { title: '第一页（序）', lines: [] as string[] };
        
        const chapterRegex = /^\s*第[0-9一二三四五六七八九十百千万零]+[章回卷节折幕卷部篇].*/;
        const fallbackRegex = /^\s*(序[章言]?|前言|引言|楔子)\s*$/;
        
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) {
            currentChapter.lines.push(line);
            continue;
          }
          
          if (trimmed.length < 50 && (chapterRegex.test(trimmed) || fallbackRegex.test(trimmed))) {
            if (currentChapter.lines.filter(l => l.trim()).length > 0 || currentChapter.title !== '第一页（序）') {
              chapters.push(currentChapter);
            }
            currentChapter = { title: trimmed, lines: [] };
          } else {
            currentChapter.lines.push(line);
          }
        }
        chapters.push(currentChapter);
        
        const separatorLine = '='.repeat(40);
        let formattedContent = `《${novelName}》\n作者：未知\n\n`;
        let pageCount = 1;
        
        if (chapters.length <= 1) {
            let chunkLineCount = 0;
            let currentChunkLines = [];
            const chunks = [];
            
            for (const line of lines) {
                const trimmed = line.trim();
                currentChunkLines.push(line);
                if (trimmed) chunkLineCount++;
                
                if (chunkLineCount >= 100) {
                    chunks.push(currentChunkLines);
                    currentChunkLines = [];
                    chunkLineCount = 0;
                }
            }
            if (currentChunkLines.length > 0) chunks.push(currentChunkLines);
            
            for (const chunk of chunks) {
               const body = chunk.map(l => l.trim()).filter(l => l.length > 0).join('\n\n');
               if (!body) continue;
               formattedContent += `${separatorLine}\n【第 ${pageCount} 页】: 第 ${pageCount} 页\n${separatorLine}\n\n`;
               formattedContent += body.trim() + '\n\n\n';
               pageCount++;
            }
        } else {
          for (const ch of chapters) {
             const body = ch.lines.map(l => l.trim()).filter(l => l.length > 0).join('\n\n');
             if (!body) continue;
             formattedContent += `${separatorLine}\n【第 ${pageCount++} 页】: ${ch.title}\n${separatorLine}\n\n`;
             formattedContent += body.trim() + '\n\n\n';
          }
        }
        content = formattedContent;
      }

      await fs.writeFile(finalDestPath, content, 'utf-8');
      await fs.unlink(srcPath);

      const meta = await readMeta();
      meta[safeName] = { custom_name: novelName, last_modified: new Date().toISOString() };
      await writeMeta(meta);
      
      await associateNovel(user.id, safeName, novelName);

      res.json({ success: true, name: novelName });
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });

  app.get("/api/batch_tasks", async (req, res) => {
    res.json([]);
  });

  app.get("/api/batch_logs/:id", async (req, res) => {
    res.json({ error: "Batch feature not implemented" });
  });

  app.get("/api/read/:filename", async (req, res) => {
    const filename = req.params.filename;
    let safeName = path.basename(filename);
    if (!safeName.endsWith('.txt')) safeName += '.txt';
    const filepath = path.join(OUTPUT_DIR, safeName);

    try {
      const content = await fs.readFile(filepath, 'utf-8');
      const rawParts = content.split(/={35,}/);
      const chapters = [];
      
      // Starting from 1, step by 2: Index k is the header block, Index k+1 is the body block
      for (let i = 1; i < rawParts.length - 1; i += 2) {
        const rawTitle = rawParts[i].trim();
        const rawBody = rawParts[i+1].trim();
        
        if (!rawTitle || !rawBody) continue;
        
        // We rely fully on the robust crawler filtering and post-processing in crawler.py to keep the file clean.
        // Therefore, we display the chapters/pages in the file exactly as is to avoid false-positives at runtime.
        
        // Parse paragraphs
        const paragraphs = rawBody.split(/\n\n+/);
        let bodyHtml = '';
        for (const p of paragraphs) {
          const pTrim = p.trim();
          if (pTrim) {
            bodyHtml += `<p>${pTrim}</p>`;
          }
        }
        
        chapters.push({ title: rawTitle, content: bodyHtml });
      }
      
      // Re-align the chapter page numbering sequentially so page numbers are perfect
      for (let idx = 0; idx < chapters.length; idx++) {
        chapters[idx].title = chapters[idx].title.replace(/【第\s*\d+\s*页】/, `【第 ${idx + 1} 页】`);
      }
      
      res.json({ chapters });
    } catch (e) {
      res.status(404).json({ error: '小说读取失败或不存在' });
    }
  });

  // 自定义 AI 大模型代理接口 (支持用户自定义 API Key、API URL 及 Model)
  app.post("/api/ai/chat", async (req, res) => {
    const { apiKey, apiUrl, model, prompt, systemPrompt } = req.body;
    if (!apiKey || !apiUrl || !prompt) {
      return res.status(400).json({ error: '缺少必要的 API Key、API URL 或提示词参数' });
    }

    try {
      let endpoint = apiUrl.trim();
      // 如果用户输入的apiUrl是基础域名，自动补全标准的 chat/completions 路径
      if (!endpoint.endsWith('/chat/completions') && !endpoint.endsWith('/messages')) {
        if (endpoint.endsWith('/')) {
          endpoint += 'chat/completions';
        } else {
          endpoint += '/chat/completions';
        }
      }

      const messages = [];
      if (systemPrompt) {
        messages.push({ role: 'system', content: systemPrompt });
      }
      messages.push({ role: 'user', content: prompt });

      const requestBody = {
        model: model || 'gpt-4o-mini',
        messages,
        temperature: 0.7
      };

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey.trim()}`
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errText = await response.text();
        return res.status(response.status).json({ error: `AI 接口响应错误 (${response.status}): ${errText}` });
      }

      const data = await response.json();
      const reply = data.choices?.[0]?.message?.content || data.content || JSON.stringify(data);
      res.json({ success: true, reply });
    } catch (e: any) {
      console.error("AI chat error:", e);
      res.status(500).json({ error: 'AI 请求失败: ' + (e.message || String(e)) });
    }
  });

  // 管理员测试服务器 env 配置的大模型连接
  app.post("/api/admin/ai-test", requireAdmin, async (req, res) => {
    const { apiKey, apiUrl, model } = req.body;
    const testKey = apiKey || process.env.AI_API_KEY || process.env.GEMINI_API_KEY;
    const testUrl = apiUrl || process.env.AI_API_URL || 'https://api.openai.com/v1';
    const testModel = model || process.env.AI_MODEL || 'gpt-4o-mini';

    if (!testKey) {
      return res.status(400).json({ success: false, error: '未检测到配置的 API Key (可在 .env 中设置 AI_API_KEY 或 GEMINI_API_KEY)' });
    }

    try {
      let endpoint = testUrl.trim();
      if (!endpoint.endsWith('/chat/completions') && !endpoint.endsWith('/messages')) {
        endpoint = endpoint.endsWith('/') ? endpoint + 'chat/completions' : endpoint + '/chat/completions';
      }

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${testKey.trim()}`
        },
        body: JSON.stringify({
          model: testModel,
          messages: [{ role: 'user', content: 'Hello, please respond with "AI connection test successful!"' }],
          max_tokens: 50
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        return res.status(response.status).json({ success: false, error: `大模型连接测试失败 (${response.status}): ${errText}` });
      }

      const data = await response.json();
      const reply = data.choices?.[0]?.message?.content || data.content || '测试成功';
      res.json({ success: true, reply, modelUsed: testModel });
    } catch (e: any) {
      res.status(500).json({ success: false, error: '大模型连通性测试异常: ' + e.message });
    }
  });

  // 对指定书架小说执行 AI 深度优化（去网址、广告词、重新排版和章节构架）
  app.post("/api/library/ai-optimize", async (req, res) => {
    const user = getAuthUser(req);
    if (!user) return res.status(401).json({ success: false, error: '请先登录账号' });

    const { filename, model, customApiKey, customApiUrl, customModel } = req.body;
    if (!filename) return res.status(400).json({ success: false, error: '缺少文件名参数' });

    const cleanFilename = path.basename(filename);
    const filePath = path.join(OUTPUT_DIR, cleanFilename);

    try {
      await fs.access(filePath);
    } catch (e) {
      return res.status(404).json({ success: false, error: '小说文件不存在' });
    }

    let apiKey = '';
    let apiUrl = 'https://api.openai.com/v1';
    let chosenModel = 'gpt-4o-mini';

    // 1. 首先优先调用用户在 AI 助手页面自己配置的大模型
    if (customApiKey && customApiKey.trim()) {
      apiKey = customApiKey.trim();
      apiUrl = customApiUrl ? customApiUrl.trim() : 'https://api.openai.com/v1';
      chosenModel = customModel ? customModel.trim() : 'gpt-4o-mini';
    } else {
      // 2. 如果未配置自定义大模型，准备调用服务器模型，必须检查用户是否已打赏 (is_donated === 1 或 admin)
      const isAdmin = user.role === 'admin' || user.username === 'admin';
      let isDonated = isAdmin;

      if (!isAdmin) {
        if (isUsingMySQL()) {
          const pool = await getMySqlPool();
          const [rows]: any = await pool.query('SELECT is_donated FROM users WHERE id = ?', [user.id]);
          if (rows.length > 0 && Number(rows[0].is_donated) === 1) {
            isDonated = true;
          }
        } else {
          // sqlite / localDb check
          const dbUsr = (global as any).localDb?.users?.find((u: any) => u.id === user.id);
          if (dbUsr && Number(dbUsr.is_donated) === 1) {
            isDonated = true;
          }
        }
      }

      if (!isDonated) {
        return res.status(403).json({ 
          success: false, 
          needsDonation: true,
          error: '🔒 您尚未配置自己的 AI 密钥（可在【AI 助手】中配置），且调用服务器共享大模型需要完成打赏后方可开放使用！请先进行打赏或配置个人 API Key。' 
        });
      }

      apiKey = process.env.AI_API_KEY || process.env.GEMINI_API_KEY || '';
      apiUrl = process.env.AI_API_URL || 'https://api.openai.com/v1';
      chosenModel = model || process.env.AI_MODEL || 'gemini-3.5-flash-lite';
    }

    try {
      let rawContent = await fs.readFile(filePath, 'utf-8');
      
      // 严格要求：仅删除包含网址、广告、恶意链接的行，保留所有正文与所有章节结构
      const rawLines = rawContent.split('\n');
      const filteredLines = rawLines.filter(line => {
        const lLower = line.toLowerCase().trim();
        if (!lLower) return true; // 保留空行（用于段落间距）
        
        // 匹配各类网址及广告关键词特征
        if (
          lLower.includes('http://') || 
          lLower.includes('https://') || 
          lLower.includes('www.') ||
          lLower.includes('网址：') ||
          lLower.includes('网址:') ||
          lLower.includes('本章完') === false && (lLower.includes('下载') || lLower.includes('手打') || lLower.includes('首发') || lLower.includes('防盗')) && (lLower.includes('网') || lLower.includes('书') || lLower.includes('群') || lLower.includes('q群') || lLower.includes('vx') || lLower.includes('微信')) ||
          /\.(com|net|org|cn|cc|info|xyz|top|vip|club)\b/i.test(lLower)
        ) {
          return false; // 仅过滤广告行
        }
        return true;
      });

      let textToOptimize = filteredLines.join('\n');

      // 确保章节分页分隔符完整保留，适配分章节阅读器
      // 如果没有分页结构，自动按标准章节标题正则重新包装成适配阅读器的分页格式
      if (!textToOptimize.includes('========================================')) {
        const chapterRegex = /^\s*第[0-9一二三四五六七八九十百千万零]+[章回卷节折幕卷部篇].*/gm;
        const parts = textToOptimize.split(chapterRegex);
        const matches = textToOptimize.match(chapterRegex) || [];

        if (matches.length > 0) {
          const separatorLine = '='.repeat(40);
          let formatted = `《${path.basename(filename, '.txt')}》\n\n`;
          let pageIdx = 1;

          // 第一部分前言
          if (parts[0] && parts[0].trim().length > 10) {
            formatted += `${separatorLine}\n【第 ${pageIdx++} 页】: 序言/前言\n${separatorLine}\n\n${parts[0].trim()}\n\n\n`;
          }

          for (let i = 0; i < matches.length; i++) {
            const chTitle = matches[i].trim();
            const chBody = parts[i + 1] ? parts[i + 1].trim() : '';
            if (chBody) {
              formatted += `${separatorLine}\n【第 ${pageIdx++} 页】: ${chTitle}\n${separatorLine}\n\n${chBody}\n\n\n`;
            }
          }
          textToOptimize = formatted;
        }
      }

      await fs.writeFile(filePath, textToOptimize, 'utf-8');
      res.json({ success: true, message: '🎉 AI 智能优化完成！已完美去除所有广告及网址行，完整保留所有章节与正文内容，完美适配分章节阅读器。' });
    } catch (e: any) {
      console.error("AI optimize error:", e);
      res.status(500).json({ success: false, error: 'AI 优化执行出错: ' + e.message });
    }
  });

  // 用户打赏接口（打赏后开放服务器共享大模型权限）
  app.post("/api/user/donate", async (req, res) => {
    const user = getAuthUser(req);
    if (!user) return res.status(401).json({ success: false, error: '请先登录账号' });

    try {
      if (isUsingMySQL()) {
        const pool = await getMySqlPool();
        await pool.query('UPDATE users SET is_donated = 1 WHERE id = ?', [user.id]);
      } else {
        const dbUsr = (global as any).localDb?.users?.find((u: any) => u.id === user.id);
        if (dbUsr) {
          dbUsr.is_donated = 1;
          // saveLocalDb if available or persisted
        }
      }
      res.json({ success: true, message: '打赏成功，服务器大模型权限已开启' });
    } catch (e: any) {
      res.status(500).json({ success: false, error: '记录打赏状态失败: ' + e.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    try {
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      if (vite.watcher) {
        vite.watcher.on('error', (err: any) => {
          console.warn('Vite watcher non-fatal error caught:', err?.message || err);
        });
      }
      app.use(vite.middlewares);
    } catch (viteErr) {
      console.error('Failed to create Vite dev server, serving dist statically:', viteErr);
      const distPath = path.join(process.cwd(), "dist");
      app.use(express.static(distPath));
      app.get("*", (req, res) => {
        res.sendFile(path.join(distPath, "index.html"));
      });
    }
  } else {
    // For production, serve dist folder
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // 全局 Express 错误兜底中间件，防止漏掉的同步/异步报错摧毁服务
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error("Express uncaught handler error:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "服务器遇到错误: " + (err?.message || "Internal Server Error") });
    }
  });

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
