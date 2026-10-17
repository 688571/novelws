import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Search, Globe, Download, ArrowRight, BookOpen, Sparkles, Check, CheckCircle2, ShieldCheck, User } from 'lucide-react';

export function CrawlerConsole() {
  const { user, isAdmin, isMySQL, authFetch, openAuthModal } = useAuth();
  const [url, setUrl] = useState('');
  const [novelName, setNovelName] = useState('');
  const [incremental, setIncremental] = useState(true);
  
  // Search state variables
  const [activeTab, setActiveTab] = useState<'search' | 'manual'>('search');
  const [selectedSite, setSelectedSite] = useState<'52shuku' | 'asw227' | 'aswtxt' | '00shu'>('asw227');
  const [searchMode, setSearchMode] = useState<'fuzzy' | 'exact'>('fuzzy');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [downloadingUrl, setDownloadingUrl] = useState<string | null>(null);
  
  // Mirror modal state
  const [manualDownloadItem, setManualDownloadItem] = useState<any>(null);
  const [manualCandidates, setManualCandidates] = useState<any[]>([]);
  const [fetchingCandidates, setFetchingCandidates] = useState(false);
  
  const navigate = useNavigate();

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      alert('🔒 未注册/未登录用户禁止搜索！请先点击右上角注册/登录账号（注册后需管理员审核通过方可使用）。');
      openAuthModal();
      return;
    }
    const queryTerm = searchQuery.trim();
    if (!queryTerm) return;
    
    setSearching(true);
    setHasSearched(true);
    try {
      const res = await authFetch(`/api/search?q=${encodeURIComponent(queryTerm)}&site=${selectedSite}&mode=${searchMode}`);
      const data = await res.json();
      if (data.success) {
        setSearchResults((data.results || []).slice(0, 10));
      } else {
        alert(data.error || '搜索失败');
      }
    } catch (err: any) {
      alert('搜索出错: ' + err.message);
    } finally {
      setSearching(false);
    }
  };

  const formatBookTitle = (rawTitle?: string, fallback = '未知书名'): string => {
    if (!rawTitle) return `《${fallback}》`;
    let t = String(rawTitle).trim();
    while (t.startsWith('《') && t.endsWith('》') && t.length >= 2) {
      t = t.slice(1, -1).trim();
    }
    t = t.replace(/^《+|》+$/g, '').trim();
    t = t.replace(/\.txt$/i, '').trim();
    if (!t) return `《${fallback}》`;
    return `《${t}》`;
  };

  const fillNovel = (item: any) => {
    setUrl(item.url);
    setNovelName(item.title);
    setActiveTab('manual');
    setTimeout(() => {
      const el = document.getElementById('novel_name');
      if (el) el.focus();
    }, 100);
  };

  // Channel 4 inline progress state
  const [channel4Task, setChannel4Task] = useState<{ taskId: string; title: string; progress: number; status: string; log: string[] } | null>(null);

  const quickCrawl = async (item: any) => {
    if (selectedSite === '00shu') {
      // Channel 4: Do not enter log terminal interface, show clean inline progress modal
      setChannel4Task({ taskId: '', title: item.title, progress: 10, status: 'running', log: ['正在启动安全加密采集通道...'] });
      try {
        const res = await authFetch('/api/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: item.url, novel_name: item.title, incremental })
        });
        const data = await res.json();
        if (data.task_id) {
          const tid = data.task_id;
          setChannel4Task(prev => prev ? { ...prev, taskId: tid, progress: 30 } : null);

          // Poll silently with exact LogsViewer progress calculation
          const pollTimer = setInterval(async () => {
            try {
              const logRes = await authFetch(`/api/logs/${tid}`);
              if (logRes.ok) {
                const logData = await logRes.json();
                if (logData.status === 'finished') {
                  clearInterval(pollTimer);
                  setChannel4Task(prev => prev ? { ...prev, progress: 100, status: 'finished', log: ['🎉 小说抓取、广告清洗与分章排版已全部完成！'] } : null);
                  setTimeout(() => {
                    alert(`✅ 《${item.title}》抓取并优化入库成功！已自动关联到您的个人书架。`);
                    setChannel4Task(null);
                  }, 600);
                } else if (logData.status === 'error') {
                  clearInterval(pollTimer);
                  setChannel4Task(null);
                  alert('❌ 抓取任务异常中止');
                } else {
                  const rawLogs = logData.log || [];
                  // Parse progress precisely like LogsViewer
                  let currentProgressText = "正在加密通道中处理...";
                  let progressPercent = 15;

                  const reversedLogs = [...rawLogs].reverse();
                  const processingLine = reversedLogs.find((l: string) => l.includes('处理中'));
                  const cleaningLine = reversedLogs.find((l: string) => l.includes('后置清理') || l.includes('后置处理') || l.includes('清洗'));
                  const skipLine = reversedLogs.find((l: string) => l.includes('跳过已抓取页'));

                  if (cleaningLine) {
                    currentProgressText = "🧹 正在合并生成纯净文本，剔除广告推广，并规范排版...";
                    progressPercent = 92;
                  } else if (processingLine) {
                    const match = processingLine.match(/处理中\s*\[(\d+)\/(\d+|\?)\]/);
                    if (match) {
                      const cur = parseInt(match[1]);
                      const tot = match[2];
                      if (tot === '?') {
                        currentProgressText = `⏳ 正在抓取正文: 动态爬取第 ${cur} 页...`;
                        progressPercent = Math.min(85, 20 + cur * 4);
                      } else {
                        const total = parseInt(tot);
                        currentProgressText = `⏳ 正在爬取正文: 第 ${cur} 部分 / 共 ${total} 部分...`;
                        if (total > 0) {
                          progressPercent = Math.min(90, Math.round((cur / total) * 100));
                        }
                      }
                    } else {
                      currentProgressText = processingLine;
                    }
                  } else if (skipLine) {
                    currentProgressText = `🔄 增量比对：本地已缓存，正在高速校验...`;
                    progressPercent = 50;
                  } else if (rawLogs.length > 0) {
                    currentProgressText = rawLogs[rawLogs.length - 1];
                  }

                  // Sanitize any raw URLs in progress text
                  const cleanText = currentProgressText.replace(/https?:\/\/[^\s"'<>]+/gi, '[云端通道]').replace(/(?:www\.)?[a-zA-Z0-9-]+\.(?:com|net|org|cn|info)/gi, '[云端通道]');

                  setChannel4Task(prev => prev ? { ...prev, progress: progressPercent, log: [cleanText] } : null);
                }
              }
            } catch (err) {}
          }, 1500);
        } else {
          setChannel4Task(null);
          alert(data.error || '启动失败');
        }
      } catch (e: any) {
        setChannel4Task(null);
        alert('Error: ' + e.message);
      }
      return;
    }

    if (!confirm(`确定要立即开始抓取${formatBookTitle(item.title)}并加入您的个人书架吗？`)) return;
    try {
      const res = await authFetch('/api/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: item.url, novel_name: item.title, incremental })
      });
      const data = await res.json();
      if (data.task_id) {
        navigate(`/logs/${data.task_id}`);
      } else {
        alert(data.error || '启动失败');
      }
    } catch (e: any) {
      alert('Error: ' + e.message);
    }
  };

  const handleAswDownload = async (item: any, candidateIndex?: number) => {
    setDownloadingUrl(item.url);
    try {
      const res = await authFetch('/api/asw227/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: item.url, title: item.title, candidateIndex })
      });
      const data = await res.json();
      if (data.success) {
        alert(`✅ 下载成功！\n${formatBookTitle(data.name)}已整理入库，并已成功关联到您的个人书架 (${user?.nickname || user?.username})！`);
        setManualDownloadItem(null);
        setManualCandidates([]);
      } else if (data.needManualChoose) {
        setManualDownloadItem(item);
        setManualCandidates(data.candidates || []);
      } else {
        alert(`❌ 下载失败: ${data.error || '未知错误'}`);
      }
    } catch (e: any) {
      alert(`❌ 下载出错: ${e.message}`);
    } finally {
      setDownloadingUrl(null);
    }
  };

  const fetchCandidatesAndChoose = async (item: any) => {
    setFetchingCandidates(true);
    setDownloadingUrl(item.url);
    try {
      const res = await authFetch('/api/asw227/candidates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: item.url })
      });
      const data = await res.json();
      if (data.success && data.candidates && data.candidates.length > 0) {
        setManualDownloadItem(item);
        setManualCandidates(data.candidates);
      } else {
        alert(data.error || '未能在该小说页面提取到有效线路');
      }
    } catch (e: any) {
      alert(`❌ 获取线路失败: ${e.message}`);
    } finally {
      setFetchingCandidates(false);
      setDownloadingUrl(null);
    }
  };

  const handleAswtxtDownload = async (item: any) => {
    setDownloadingUrl(item.url);
    try {
      const res = await authFetch('/api/aswtxt/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: item.url, title: item.title })
      });
      const data = await res.json();
      if (data.success) {
        alert(`✅ 秒下成功！\n${formatBookTitle(data.name)}已完成格式化，并已关联至您的个人书架！`);
      } else {
        alert(`❌ 下载失败: ${data.error || '未知错误'}`);
      }
    } catch (e: any) {
      alert(`❌ 下载出错: ${e.message}`);
    } finally {
      setDownloadingUrl(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url) {
      alert('请填写小说起始页URL');
      return;
    }
    try {
      const res = await authFetch('/api/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, novel_name: novelName, incremental })
      });
      const data = await res.json();
      if (data.task_id) {
        navigate(`/logs/${data.task_id}`);
      } else {
        alert(data.error || '启动失败');
      }
    } catch (e: any) {
      alert('Error: ' + e.message);
    }
  };

  return (
    <>
      <style>{`
        .console-root {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
            background: var(--theme-bg);
            min-height: 100vh;
            padding: 24px 16px;
            color: var(--theme-text-main);
            transition: background 0.25s ease, color 0.25s ease;
        }

        .console-root .container {
            max-width: 900px;
            margin: 0 auto;
            background: var(--theme-card);
            border-radius: 24px;
            box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.05);
            border: 1px solid var(--theme-border);
            overflow: hidden;
            transition: background 0.25s ease, border-color 0.25s ease;
        }

        .console-root .header {
            padding: 28px 32px 20px;
            border-bottom: 1px solid var(--theme-border);
            display: flex;
            justify-content: space-between;
            align-items: center;
            background: var(--theme-card);
        }

        .console-root .header h1 {
            font-size: 1.6rem;
            font-weight: 800;
            color: var(--theme-text-main);
            margin: 0;
            display: flex;
            align-items: center;
            gap: 10px;
        }

        .console-root .shelf-link {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            background: var(--theme-badge-bg);
            color: var(--theme-badge-text);
            padding: 8px 16px;
            border-radius: 99px;
            font-size: 0.9rem;
            font-weight: 700;
            text-decoration: none;
            transition: all 0.2s;
            border: 1px solid var(--theme-border);
        }

        .console-root .shelf-link:hover {
            opacity: 0.88;
            transform: translateY(-1px);
        }

        .console-root .main-content {
            padding: 28px 32px 36px;
        }

        .console-root input[type="url"],
        .console-root input[type="text"] {
            width: 100%;
            padding: 12px 16px;
            border: 1px solid var(--theme-border);
            border-radius: 14px;
            font-size: 0.95rem;
            transition: all 0.2s;
            background: var(--theme-input-bg);
            color: var(--theme-text-main);
            box-sizing: border-box;
        }

        .console-root input:focus {
            outline: none;
            border-color: var(--theme-primary);
            box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.15);
        }

        .console-root .form-group {
            margin-bottom: 20px;
        }

        .console-root .form-group label {
            display: block;
            margin-bottom: 8px;
            font-weight: 600;
            color: var(--theme-text-main);
            font-size: 0.95rem;
        }

        .console-root .checkbox-group {
            display: flex;
            align-items: center;
            gap: 10px;
            background: var(--theme-card-sub);
            padding: 12px 16px;
            border-radius: 14px;
            margin: 16px 0 24px;
            border: 1px solid var(--theme-border);
        }

        .console-root .checkbox-group input {
            width: 18px;
            height: 18px;
            accent-color: var(--theme-primary);
            cursor: pointer;
        }

        .console-root .checkbox-group label {
            font-weight: 500;
            color: var(--theme-text-main);
            cursor: pointer;
            font-size: 0.9rem;
        }

        .console-root button.submit-btn {
            background: var(--theme-primary-gradient);
            color: white;
            border: none;
            padding: 14px 24px;
            border-radius: 14px;
            font-size: 1rem;
            font-weight: 700;
            cursor: pointer;
            transition: all 0.2s ease;
            width: 100%;
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
        }

        .console-root button.submit-btn:hover {
            opacity: 0.92;
            transform: translateY(-1px);
        }

        .console-root .note {
            margin-top: 24px;
            padding: 14px 18px;
            background: var(--theme-card-sub);
            border-radius: 14px;
            color: var(--theme-text-muted);
            font-size: 0.85rem;
            border: 1px solid var(--theme-border);
            text-align: center;
            line-height: 1.6;
        }

        .console-root .nav-links {
            margin-top: 24px;
            padding-top: 20px;
            border-top: 1px solid var(--theme-border);
            text-align: center;
            display: flex;
            justify-content: center;
            gap: 16px;
        }
      `}</style>

      <div className="console-root">
        <div className="container">
          <div className="header">
            <div>
              <h1>
                <Search className="w-6 h-6 text-indigo-600" />
                小说检索与抓取
              </h1>
              <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: '#64748b' }}>
                多用户协同共享小说库 · 抓取后自动关联至您的个人书架
              </p>
            </div>
            <Link to="/library" className="shelf-link" title="查看已加入书架的小说">
              📚 我的书架
            </Link>
          </div>

          <div className="main-content">
            {/* Mode Switcher Tabs (Only Admin can access manual raw URL crawler) */}
            {isAdmin && (
              <div style={{
                display: 'flex',
                background: 'var(--theme-card-sub)',
                padding: '4px',
                borderRadius: '14px',
                marginBottom: '24px',
                border: '1px solid var(--theme-border)'
              }}>
                <button
                  type="button"
                  onClick={() => setActiveTab('search')}
                  style={{
                    flex: 1,
                    padding: '12px 16px',
                    border: 'none',
                    fontWeight: 700,
                    fontSize: '0.95rem',
                    cursor: 'pointer',
                    borderRadius: '10px',
                    transition: 'all 0.2s',
                    color: activeTab === 'search' ? 'var(--theme-primary-text)' : 'var(--theme-text-muted)',
                    background: activeTab === 'search' ? 'var(--theme-card)' : 'transparent',
                    boxShadow: activeTab === 'search' ? '0 2px 4px rgba(0,0,0,0.06)' : 'none'
                  }}
                >
                  🔍 智能搜书 (全网书源)
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('manual')}
                  style={{
                    flex: 1,
                    padding: '12px 16px',
                    border: 'none',
                    fontWeight: 700,
                    fontSize: '0.95rem',
                    cursor: 'pointer',
                    borderRadius: '10px',
                    transition: 'all 0.2s',
                    color: activeTab === 'manual' ? 'var(--theme-primary-text)' : 'var(--theme-text-muted)',
                    background: activeTab === 'manual' ? 'var(--theme-card)' : 'transparent',
                    boxShadow: activeTab === 'manual' ? '0 2px 4px rgba(0,0,0,0.06)' : 'none'
                  }}
                >
                  🔗 管理员专享: 手动输入 URL (定向抓取)
                </button>
              </div>
            )}

            {/* Tab 1: Search Novels */}
            {(activeTab === 'search' || !isAdmin) && (
              <div>
                {/* Source Selection Buttons */}
                <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.85rem', color: 'var(--theme-text-muted)', display: 'flex', alignItems: 'center', fontWeight: 600 }}>
                    检索通道:
                  </span>
                  {[
                    { id: 'asw227', name: '通道 1 (秒下高速)' },
                    { id: '52shuku', name: '通道 2 (精排文库)' },
                    { id: 'aswtxt', name: '通道 3 (完整全本)' },
                    { id: '00shu', name: '通道 4 (网络修真)' }
                  ].map(s => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setSelectedSite(s.id as any)}
                      style={{
                        padding: '6px 14px',
                        borderRadius: '99px',
                        border: selectedSite === s.id ? '1px solid var(--theme-primary)' : '1px solid var(--theme-border)',
                        background: selectedSite === s.id ? 'var(--theme-primary-light)' : 'var(--theme-card)',
                        color: selectedSite === s.id ? 'var(--theme-primary-text)' : 'var(--theme-text-muted)',
                        fontSize: '0.85rem',
                        fontWeight: selectedSite === s.id ? 700 : 500,
                        cursor: 'pointer',
                        transition: 'all 0.15s'
                      }}
                    >
                      {s.name}
                    </button>
                  ))}
                </div>

                {/* Search Options: 模糊查找 & 完整匹配 (默认繁简交叉搜索) */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '16px',
                  marginBottom: '16px',
                  padding: '10px 16px',
                  background: 'var(--theme-card-sub)',
                  borderRadius: '12px',
                  border: '1px solid var(--theme-border)',
                  flexWrap: 'wrap',
                  fontSize: '0.85rem'
                }}>
                  <span style={{ color: 'var(--theme-text-main)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '4px' }}>
                    匹配模式:
                  </span>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', color: searchMode === 'fuzzy' ? 'var(--theme-primary)' : 'var(--theme-text-muted)', fontWeight: searchMode === 'fuzzy' ? 700 : 500 }}>
                    <input
                      type="checkbox"
                      checked={searchMode === 'fuzzy'}
                      onChange={() => setSearchMode('fuzzy')}
                      style={{ cursor: 'pointer', accentColor: 'var(--theme-primary)', width: '16px', height: '16px' }}
                    />
                    <span>🔍 模糊查找 (相关度排序 · 最优不超过10条)</span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', color: searchMode === 'exact' ? 'var(--theme-primary)' : 'var(--theme-text-muted)', fontWeight: searchMode === 'exact' ? 700 : 500 }}>
                    <input
                      type="checkbox"
                      checked={searchMode === 'exact'}
                      onChange={() => setSearchMode('exact')}
                      style={{ cursor: 'pointer', accentColor: 'var(--theme-primary)', width: '16px', height: '16px' }}
                    />
                    <span>🎯 完整匹配 (严格书名全字匹配)</span>
                  </label>
                  <span style={{ marginLeft: 'auto', fontSize: '0.75rem', color: 'var(--theme-primary-text)', background: 'var(--theme-primary-light)', border: '1px solid var(--theme-border)', padding: '3px 10px', borderRadius: '6px', fontWeight: 600 }}>
                    ✨ 默认繁简交叉搜索
                  </span>
                </div>

                {/* Search Form */}
                <form onSubmit={handleSearch} style={{ display: 'flex', gap: '10px', marginBottom: '24px' }}>
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="输入小说名称、作者名 (支持简体/繁体，例如：斗破苍穹、凡人修仙傳、诡秘之主)"
                    style={{
                      flex: 1,
                      padding: '14px 18px',
                      border: '1px solid var(--theme-border)',
                      borderRadius: '14px',
                      fontSize: '0.95rem',
                      outline: 'none',
                      background: 'var(--theme-input-bg)',
                      color: 'var(--theme-text-main)'
                    }}
                  />
                  <button
                    type="submit"
                    disabled={searching}
                    style={{
                      padding: '0 24px',
                      background: 'var(--theme-primary-gradient)',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: '14px',
                      fontSize: '0.95rem',
                      fontWeight: 700,
                      cursor: searching ? 'not-allowed' : 'pointer',
                      opacity: searching ? 0.7 : 1,
                      transition: 'all 0.2s',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {searching ? '正在检索...' : '立即搜索'}
                  </button>
                </form>

                {/* Search Results */}
                {searching ? (
                  <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--theme-text-muted)' }}>
                    <div style={{ fontSize: '1.2rem', marginBottom: '8px' }}>⏳</div>
                    正在连接书源获取最新小说索引，请稍候...
                  </div>
                ) : hasSearched && searchResults.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--theme-text-muted)' }}>
                    <p style={{ margin: 0, fontSize: '0.95rem' }}>未找到相关小说，请尝试切换通道或更换更精炼的关键词。</p>
                  </div>
                ) : searchResults.length > 0 && (
                  <div style={{ display: 'grid', gap: '14px' }}>
                    <div style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      background: 'var(--theme-card-sub)',
                      border: '1px solid var(--theme-border)',
                      borderRadius: '12px',
                      padding: '10px 16px',
                      fontSize: '0.85rem',
                      color: 'var(--theme-text-muted)',
                      flexWrap: 'wrap',
                      gap: '8px'
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 700, color: 'var(--theme-text-main)' }}>
                          🔍 检索结果（共 {searchResults.length} 条，严格限额 ≤ 10 条）
                        </span>
                        <span style={{
                          background: 'var(--theme-primary-light)',
                          color: 'var(--theme-primary-text)',
                          padding: '2px 8px',
                          borderRadius: '99px',
                          fontSize: '0.75rem',
                          fontWeight: 700
                        }}>
                          {searchMode === 'exact' ? '🎯 精确匹配模式' : '⚡ 匹配算法智能降序'}
                        </span>
                      </div>
                      <span style={{ fontSize: '0.75rem' }}>
                        已自动完成简繁多源互通与高智能度排序
                      </span>
                    </div>
                    {searchResults.map((item, idx) => (
                      <div
                        key={idx}
                        style={{
                          background: 'var(--theme-card)',
                          border: '1px solid var(--theme-border)',
                          borderRadius: '16px',
                          padding: '18px 20px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '12px',
                          transition: 'all 0.2s',
                          boxShadow: '0 1px 3px 0 rgba(0,0,0,0.04)'
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                            <h3 style={{ fontSize: '1.15rem', fontWeight: 800, margin: 0, color: 'var(--theme-text-main)' }}>
                              {formatBookTitle(item.title)}
                            </h3>
                            {item.exactMatch ? (
                              <span style={{ background: '#ecfdf5', color: '#047857', border: '1px solid #a7f3d0', fontSize: '0.75rem', fontWeight: 700, padding: '3px 9px', borderRadius: '99px', display: 'flex', alignItems: 'center', gap: '3px' }}>
                                🎯 完整匹配
                              </span>
                            ) : item.matchScore && item.matchScore > 0 ? (
                              <span style={{ background: 'var(--theme-primary-light)', color: 'var(--theme-primary-text)', border: '1px solid var(--theme-border)', fontSize: '0.75rem', fontWeight: 600, padding: '3px 9px', borderRadius: '99px' }}>
                                ⚡ 智能度优选
                              </span>
                            ) : null}
                            <span style={{ background: 'var(--theme-card-sub)', color: 'var(--theme-text-muted)', border: '1px solid var(--theme-border)', fontSize: '0.75rem', fontWeight: 600, padding: '3px 10px', borderRadius: '99px' }}>
                              作者: {item.author || '未知'}
                            </span>
                            {item.category && (
                              <span style={{ background: 'var(--theme-primary-light)', color: 'var(--theme-primary-text)', border: '1px solid var(--theme-border)', fontSize: '0.75rem', fontWeight: 600, padding: '3px 10px', borderRadius: '99px' }}>
                                分类: {item.category}
                              </span>
                            )}
                          </div>

                          {/* Action Buttons */}
                          <div style={{ display: 'flex', gap: '8px' }}>
                            {selectedSite === 'asw227' ? (
                              <>
                                <button
                                  type="button"
                                  disabled={downloadingUrl === item.url}
                                  onClick={() => handleAswDownload(item)}
                                  style={{
                                    padding: '8px 16px',
                                    background: downloadingUrl === item.url ? 'var(--theme-border)' : 'var(--theme-primary-gradient)',
                                    color: '#ffffff',
                                    border: 'none',
                                    borderRadius: '10px',
                                    fontSize: '0.85rem',
                                    fontWeight: 700,
                                    cursor: downloadingUrl === item.url ? 'wait' : 'pointer'
                                  }}
                                >
                                  {downloadingUrl === item.url ? '⏳ 正在下载...' : '📥 极速秒下到书架'}
                                </button>
                                <button
                                  type="button"
                                  disabled={downloadingUrl === item.url}
                                  onClick={() => fetchCandidatesAndChoose(item)}
                                  style={{
                                    padding: '8px 12px',
                                    background: 'var(--theme-card-sub)',
                                    color: 'var(--theme-text-main)',
                                    border: '1px solid var(--theme-border)',
                                    borderRadius: '10px',
                                    fontSize: '0.85rem',
                                    fontWeight: 600,
                                    cursor: downloadingUrl === item.url ? 'wait' : 'pointer'
                                  }}
                                >
                                  🌐 线路切换
                                </button>
                              </>
                            ) : selectedSite === 'aswtxt' ? (
                              <button
                                type="button"
                                disabled={downloadingUrl === item.url}
                                onClick={() => handleAswtxtDownload(item)}
                                style={{
                                  padding: '8px 16px',
                                  background: downloadingUrl === item.url ? 'var(--theme-border)' : 'var(--theme-primary-gradient)',
                                  color: '#ffffff',
                                  border: 'none',
                                  borderRadius: '10px',
                                  fontSize: '0.85rem',
                                  fontWeight: 700,
                                  cursor: downloadingUrl === item.url ? 'wait' : 'pointer'
                                }}
                              >
                                {downloadingUrl === item.url ? '⏳ 下载中...' : '📥 全本秒下入库'}
                              </button>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={() => quickCrawl(item)}
                                  style={{
                                    padding: '8px 16px',
                                    background: 'var(--theme-primary-gradient)',
                                    color: '#ffffff',
                                    border: 'none',
                                    borderRadius: '10px',
                                    fontSize: '0.85rem',
                                    fontWeight: 700,
                                    cursor: 'pointer'
                                  }}
                                >
                                  🚀 立即抓取
                                </button>
                              </>
                            )}
                          </div>
                        </div>

                        {/* Description (No raw URLs exposed) */}
                        <p style={{
                          fontSize: '0.85rem',
                          color: 'var(--theme-text-muted)',
                          margin: 0,
                          lineHeight: 1.6,
                          background: 'var(--theme-card-sub)',
                          padding: '10px 14px',
                          borderRadius: '10px',
                          border: '1px solid var(--theme-border)'
                        }}>
                          {item.desc || '暂无简介。'}
                        </p>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem', color: '#10b981', fontWeight: 600 }}>
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>已连接高速通道 · 下载完成后将自动同步关联至当前书架 ({user?.nickname || user?.username})</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Tab 2: Manual Input Form */}
            {activeTab === 'manual' && (
              <div>
                <form onSubmit={handleSubmit}>
                  <div className="form-group">
                    <label htmlFor="novel_name">
                      📝 小说名称 <span style={{ fontWeight: 'normal', color: '#64748b', fontSize: '0.85rem' }}>（可选，留空将自动提取）</span>
                    </label>
                    <input 
                      type="text" 
                      id="novel_name" 
                      value={novelName}
                      onChange={(e) => setNovelName(e.target.value)}
                      placeholder="例如：凡人修仙传、诡秘之主" 
                      autoComplete="off" 
                    />
                  </div>

                  <div className="form-group">
                    <label htmlFor="url">
                      🔗 小说起始页或目录 URL <span style={{ color: '#ef4444' }}>*</span>
                    </label>
                    <input 
                      type="url" 
                      id="url" 
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      placeholder="https://.../目录.html 或 任意章节阅读页" 
                      required 
                    />
                  </div>

                  <div className="checkbox-group">
                    <input 
                      type="checkbox" 
                      id="incremental_single" 
                      checked={incremental}
                      onChange={(e) => setIncremental(e.target.checked)}
                    />
                    <label htmlFor="incremental_single">🔄 增量模式（智能跳过已抓取章节，断点续传）</label>
                  </div>

                  <button type="submit" className="submit-btn">🚀 开始抓取并关联至书架</button>
                </form>
              </div>
            )}

            <div className="note">
              💡 <strong>多用户协同管理说明：</strong> 所有用户共享服务器统一小说存储目录，根据您的下载、收藏或移出操作进行轻量关联与解除，无需重复冗余存储。
            </div>

            <div className="nav-links">
              <Link to="/library" className="shelf-link" title="前往我的书架">
                📖 前往我的书架查看小说
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Mirror Line Selection Modal (Concrete URLs completely hidden) */}
      {manualDownloadItem && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(15, 23, 42, 0.65)',
          backdropFilter: 'blur(8px)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 9999,
          padding: '20px'
        }}>
          <div style={{
            background: 'var(--theme-card)',
            borderRadius: '24px',
            width: '100%',
            maxWidth: '480px',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
            border: '1px solid var(--theme-border)',
            overflow: 'hidden'
          }}>
            <div style={{
              padding: '20px 24px',
              borderBottom: '1px solid var(--theme-border)',
              background: 'var(--theme-card-sub)'
            }}>
              <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800, color: 'var(--theme-text-main)' }}>
                🌐 选择下载分流通道
              </h3>
              <p style={{ margin: '6px 0 0', fontSize: '0.85rem', color: 'var(--theme-text-muted)' }}>
                {formatBookTitle(manualDownloadItem?.title)} ── 请选择可用的分流通道进行秒下：
              </p>
            </div>

            <div style={{ padding: '20px 24px', maxHeight: '50vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {manualCandidates.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--theme-text-muted)' }}>
                  未获取到分流线路
                </div>
              ) : (
                manualCandidates.map((cand, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => handleAswDownload(manualDownloadItem, cand.index ?? idx)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '14px 18px',
                      background: 'var(--theme-card-sub)',
                      border: '1px solid var(--theme-border)',
                      borderRadius: '12px',
                      cursor: 'pointer',
                      textAlign: 'left',
                      width: '100%',
                      transition: 'all 0.15s'
                    }}
                  >
                    <div>
                      <span style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--theme-text-main)', display: 'block' }}>
                        {(!isAdmin && cand.text && (cand.text.includes('http') || cand.text.includes('.com') || cand.text.includes('.net') || cand.text.includes('www.'))) 
                          ? `高速通道线路 ${idx + 1}` 
                          : (cand.text || `线路通道 ${idx + 1}`)}
                      </span>
                      <span style={{ fontSize: '0.75rem', color: '#10b981', display: 'flex', alignItems: 'center', gap: '4px', marginTop: '2px' }}>
                        <Check className="w-3 h-3" /> 网络通畅 · 支持秒下
                      </span>
                    </div>
                    <span style={{
                      padding: '6px 12px',
                      background: 'var(--theme-primary-light)',
                      color: 'var(--theme-primary-text)',
                      borderRadius: '8px',
                      fontSize: '0.8rem',
                      fontWeight: 700,
                      border: '1px solid var(--theme-border)'
                    }}>
                      ⚡ 选用此通道
                    </span>
                  </button>
                ))
              )}
            </div>

            <div style={{
              padding: '16px 24px',
              borderTop: '1px solid var(--theme-border)',
              display: 'flex',
              justifyContent: 'flex-end',
              background: 'var(--theme-card-sub)'
            }}>
              <button
                type="button"
                onClick={() => {
                  setManualDownloadItem(null);
                  setManualCandidates([]);
                }}
                style={{
                  padding: '8px 18px',
                  background: 'var(--theme-card)',
                  color: 'var(--theme-text-main)',
                  border: '1px solid var(--theme-border)',
                  borderRadius: '10px',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Channel 4 Clean Progress Modal (No raw URLs exposed) */}
      {channel4Task && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(15, 23, 42, 0.7)',
          backdropFilter: 'blur(6px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 99999,
          padding: '16px'
        }}>
          <div style={{
            background: 'var(--theme-card)',
            borderRadius: '24px',
            width: '100%',
            maxWidth: '440px',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
            border: '1px solid var(--theme-border)',
            padding: '28px',
            color: 'var(--theme-text-main)',
            textAlign: 'center'
          }}>
            <div style={{ width: '56px', height: '56px', borderRadius: '16px', background: 'var(--theme-primary-light)', color: 'var(--theme-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
              <Download className="w-7 h-7 animate-bounce" />
            </div>
            <h3 style={{ margin: '0 0 6px 0', fontSize: '1.25rem', fontWeight: 800 }}>
              正在为您抓取《{channel4Task.title}》
            </h3>
            <p style={{ margin: '0 0 20px 0', fontSize: '0.85rem', color: 'var(--theme-text-muted)' }}>
              云端加密通道正在高速下载并自动进行 AI 去广告排版...
            </p>

            <div style={{ width: '100%', height: '10px', borderRadius: '99px', background: 'var(--theme-border)', overflow: 'hidden', marginBottom: '14px', position: 'relative' }}>
              <div style={{ width: `${channel4Task.progress}%`, height: '100%', background: 'var(--theme-primary-gradient)', borderRadius: '99px', transition: 'width 0.4s ease' }}></div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', fontWeight: 700, color: 'var(--theme-text-muted)', marginBottom: '16px' }}>
              <span>实时进度</span>
              <span>{channel4Task.progress}%</span>
            </div>

            <div style={{ background: 'var(--theme-card-sub)', padding: '10px 14px', borderRadius: '12px', fontSize: '0.75rem', color: 'var(--theme-text-muted)', fontFamily: 'monospace', maxHeight: '70px', overflowY: 'auto', textAlign: 'left', border: '1px solid var(--theme-border)' }}>
              {channel4Task.log[channel4Task.log.length - 1] || '正在初始化加密传输...'}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
