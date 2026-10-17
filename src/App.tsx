import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { BrowserRouter as Router, Routes, Route, Link, useLocation } from "react-router-dom";
import { BookOpen, Download, Terminal, Library as LibraryIcon, User as UserIcon, Database, ShieldCheck, LogOut } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

import { ThemeProvider, useTheme } from "./context/ThemeContext";
import { ThemeSelector } from "./components/ThemeSelector";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { UserAuthModal } from "./components/UserAuthModal";
import { AdminMemberModal } from "./components/AdminMemberModal";
import { CrawlerConsole } from "./components/CrawlerConsole";
import { LogsViewer } from "./components/LogsViewer";
import { Library } from "./components/Library";
import { Reader } from "./components/Reader";
import { AiAssistantModal } from "./components/AiAssistantModal";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

function Nav() {
  const location = useLocation();
  const { user, isMySQL, isAdmin, openAuthModal, openAdminModal, logout } = useAuth();
  const { themeConfig } = useTheme();

  return (
    <nav
      className="sticky top-0 z-50 border-b shadow-xs transition-colors duration-200"
      style={{
        background: 'var(--theme-nav-bg)',
        borderColor: 'var(--theme-nav-border)'
      }}
    >
      <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <Link
            to="/"
            className="flex items-center gap-2 font-bold text-xl hover:opacity-90 transition"
            style={{ color: 'var(--theme-primary)' }}
          >
            <BookOpen className="w-6 h-6" style={{ color: 'var(--theme-primary)' }} />
            <span style={{ color: 'var(--theme-text-main)' }}>小说工作台</span>
          </Link>
          <div className="hidden md:flex space-x-1 border-l pl-6" style={{ borderColor: 'var(--theme-border)' }}>
            <Link
              to="/"
              className={cn(
                "px-4 py-2 rounded-lg font-medium flex items-center space-x-2 transition text-sm",
                location.pathname === "/"
                  ? "font-bold shadow-2xs"
                  : "opacity-75 hover:opacity-100"
              )}
              style={{
                background: location.pathname === "/" ? 'var(--theme-primary-light)' : 'transparent',
                color: location.pathname === "/" ? 'var(--theme-primary-text)' : 'var(--theme-text-main)'
              }}
            >
              <Terminal size={17} />
              <span>搜索与抓取</span>
            </Link>
            <Link
              to="/library"
              className={cn(
                "px-4 py-2 rounded-lg font-medium flex items-center space-x-2 transition text-sm",
                location.pathname === "/library"
                  ? "font-bold shadow-2xs"
                  : "opacity-75 hover:opacity-100"
              )}
              style={{
                background: location.pathname === "/library" ? 'var(--theme-primary-light)' : 'transparent',
                color: location.pathname === "/library" ? 'var(--theme-primary-text)' : 'var(--theme-text-main)'
              }}
            >
              <LibraryIcon size={17} />
              <span>我的书架</span>
            </Link>
            <Link
                to="/ai"
                className={cn(
                  "px-4 py-2 rounded-lg font-medium transition text-sm flex items-center gap-1.5",
                  location.pathname === "/ai"
                    ? "font-bold shadow-2xs"
                    : "opacity-75 hover:opacity-100"
                )}
                style={{
                  background: location.pathname === "/ai" ? 'var(--theme-primary-light)' : 'transparent',
                  color: location.pathname === "/ai" ? 'var(--theme-primary-text)' : 'var(--theme-text-main)'
                }}
              >
                <span>🤖 AI 助手</span>
              </Link>
            </div>
          </div>

        {/* User Account & Theme & Admin Bar */}
        <div className="flex items-center gap-2">
          {/* Theme Selector */}
          <ThemeSelector />

          {isAdmin && (
            <button
              onClick={openAdminModal}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-amber-50 to-amber-100 hover:from-amber-100 hover:to-amber-200 border border-amber-300 text-amber-900 font-bold text-xs transition cursor-pointer shadow-2xs"
              title="进入会员管理后台：管理会员账号、重置密码、审核解绑单设备"
            >
              <ShieldCheck className="w-4 h-4 text-amber-700" />
              <span className="hidden sm:inline">会员管理</span>
            </button>
          )}

          <button
            onClick={openAuthModal}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg transition cursor-pointer text-sm font-medium border shadow-2xs"
            style={{
              background: 'var(--theme-card)',
              borderColor: 'var(--theme-border)',
              color: 'var(--theme-text-main)'
            }}
            title="点击切换用户或查看数据库状态"
          >
            <div
              className="w-5 h-5 rounded-full text-white flex items-center justify-center text-[11px] font-bold"
              style={{ background: 'var(--theme-primary)' }}
            >
              {(user?.nickname || user?.username || '访').slice(0, 1).toUpperCase()}
            </div>
            <span className="font-semibold max-w-[90px] truncate">{user ? (user.nickname || user.username) : '未登录'}</span>
            <span className={cn("text-[10px] px-1.5 py-0.5 rounded-md flex items-center gap-1 font-mono", isMySQL ? "bg-blue-100 text-blue-700" : "bg-emerald-100 text-emerald-700")}>
              <Database size={10} />
              {isMySQL ? 'MySQL' : 'SQL'}
            </span>
          </button>

          {user && (
            <button
              onClick={() => logout()}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-red-50 hover:bg-red-100 border border-red-200 text-red-700 hover:text-red-800 transition cursor-pointer text-xs font-semibold shadow-2xs"
              title="退出当前登录"
            >
              <LogOut size={13} />
              <span className="hidden sm:inline">退出</span>
            </button>
          )}
        </div>
      </div>
    </nav>
  );
}

function PluginGenerator() {
  const handleDownloadExtension = () => {
    const zip = new JSZip();

    zip.file("manifest.json", JSON.stringify({
      manifest_version: 3,
      name: "纯净阅读助手 (Clean Reader)",
      version: "1.0",
      description: "提供主流小说网站的纯净无广告阅读体验",
      permissions: ["activeTab", "scripting"],
      action: { default_title: "功能提示" },
      content_scripts: [{
        matches: ["<all_urls>"],
        js: ["content.js"],
        css: ["content.css"]
      }]
    }, null, 2));

    zip.file("content.js", `
function enableReaderMode() {
  const article = document.querySelector("article.article-content") || document.querySelector("#content") || document.querySelector(".read-content");
  if (!article) return alert("未找到文章主体内容！");
  const title = document.querySelector("h1")?.innerText || document.title;
  const scripts = article.querySelectorAll("script, style, iframe, .ad, .ads");
  scripts.forEach(s => s.remove());
  let html = article.innerHTML;
  let nextUrl = null;
  document.querySelectorAll("a").forEach(a => {
    const text = a.innerText || "";
    if (text.includes("下一页") || text.includes("下一章")) nextUrl = a.href;
  });
  document.body.innerHTML = '';
  document.body.className = 'reader-mode-active';
  const container = document.createElement('div');
  container.className = 'reader-container';
  container.innerHTML = \`
    <h1>\${title}</h1>
    <div class="reader-content">\${html}</div>
    \${nextUrl ? \`<div class="reader-footer"><a href="\${nextUrl}" class="next-btn">下一页 (Next Page)</a></div>\` : ''}
  \`;
  document.body.appendChild(container);
  window.scrollTo(0, 0);
}
const btn = document.createElement('button');
btn.innerText = '📖 开启纯净阅读';
btn.className = 'reader-trigger-btn';
btn.onclick = enableReaderMode;
document.body.appendChild(btn);
`);

    zip.file("content.css", `
.reader-trigger-btn { position: fixed; bottom: 30px; right: 30px; z-index: 999999; background: #0f172a; color: #fff; border: none; border-radius: 9999px; padding: 12px 24px; font-size: 16px; cursor: pointer; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1); transition: transform 0.2s, background 0.2s; }
.reader-trigger-btn:hover { transform: translateY(-2px); background: #1e293b; }
body.reader-mode-active { background-color: #f8f9fa; color: #333; font-family: "Palatino Linotype", serif; line-height: 1.8; margin: 0; padding: 0; }
.reader-container { max-width: 800px; margin: 0 auto; padding: 60px 40px; background: #fff; min-height: 100vh; box-shadow: 0 0 20px rgba(0,0,0,0.05); }
.reader-container h1 { font-size: 2.5rem; text-align: center; margin-bottom: 2rem; color: #1a202c; }
.reader-content p, .reader-content br { margin-bottom: 1.5em; font-size: 1.25rem; text-indent: 2em; }
.reader-footer { margin-top: 40px; text-align: center; padding-top: 20px; border-top: 1px solid #eee; }
.next-btn { display: inline-block; padding: 12px 30px; background: #0f172a; color: white !important; text-decoration: none; border-radius: 8px; transition: opacity 0.2s; }
.next-btn:hover { opacity: 0.9; }
`);
    zip.generateAsync({ type: "blob" }).then(content => saveAs(content, "clean-reader-extension.zip"));
  };

  return (
    <div className="max-w-4xl mx-auto py-12 px-4">
      <div
        className="rounded-2xl shadow-sm border overflow-hidden"
        style={{
          background: 'var(--theme-card)',
          borderColor: 'var(--theme-border)',
          color: 'var(--theme-text-main)'
        }}
      >
        <div className="p-8 md:p-12 text-center max-w-2xl mx-auto">
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-6"
            style={{
              background: 'var(--theme-primary-light)',
              color: 'var(--theme-primary)'
            }}
          >
            <Download className="w-8 h-8" />
          </div>
          <h2 className="text-2xl font-bold mb-4" style={{ color: 'var(--theme-text-main)' }}>
            下载纯净阅读 Chrome 插件
          </h2>
          <p className="mb-8 leading-relaxed" style={{ color: 'var(--theme-text-muted)' }}>
            为您生成无广告的网页小说阅读 Chrome 扩展，一键去广告排版，专注沉浸式阅读。
          </p>
          <button
            onClick={handleDownloadExtension}
            className="text-white px-8 py-3 rounded-xl font-medium transition-all shadow-sm mx-auto flex items-center gap-3 cursor-pointer"
            style={{
              background: 'var(--theme-primary-gradient)'
            }}
          >
            <Download className="w-5 h-5" /> 下载插件压缩包 (.zip)
          </button>
        </div>
      </div>
    </div>
  );
}

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <Router>
          <Nav />
          <UserAuthModal />
          <AdminMemberModal />
          <Routes>
            <Route path="/" element={<CrawlerConsole />} />
            <Route path="/library" element={<Library />} />
            <Route path="/ai" element={<AiAssistantModal />} />
            <Route path="/plugin" element={<PluginGenerator />} />
            <Route path="/logs/:id" element={<LogsViewer />} />
            <Route path="/read/:filename" element={<Reader />} />
          </Routes>
        </Router>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
