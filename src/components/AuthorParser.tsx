import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { 
  BookOpen, 
  Download, 
  Search, 
  Check, 
  ExternalLink, 
  ChevronRight, 
  Info, 
  FileText, 
  RefreshCw, 
  Play, 
  ArrowLeft, 
  Sparkles, 
  CheckSquare, 
  Square,
  ShieldCheck,
  Zap,
  ListFilter
} from 'lucide-react';

import { useAuth } from '../context/AuthContext';

interface Novel {
  filename: string;
  name: string;
  mtime: string;
  size: string;
  chapter_estimate: number;
}

interface WorkItem {
  title: string;
  url: string;
  selected?: boolean;
}

export function AuthorParser() {
  const { isAdmin, authFetch } = useAuth();
  const [authorUrl, setAuthorUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [authorName, setAuthorName] = useState('');
  const [works, setWorks] = useState<WorkItem[]>([]);
  const [error, setError] = useState('');
  const [incremental, setIncremental] = useState(true);
  
  // Library state for synchronization
  const [library, setLibrary] = useState<Novel[]>([]);
  const [loadingLibrary, setLoadingLibrary] = useState(false);
  
  const navigate = useNavigate();

  // Fetch local library for synchronization
  const fetchLibrary = async () => {
    setLoadingLibrary(true);
    try {
      const res = await fetch('/api/library');
      if (res.ok) {
        const data = await res.json();
        setLibrary(data || []);
      }
    } catch (e) {
      console.error("Failed to load library status:", e);
    } finally {
      setLoadingLibrary(false);
    }
  };

  useEffect(() => {
    fetchLibrary();
  }, []);

  const handleParse = async (e?: React.FormEvent, urlOverride?: string) => {
    if (e) e.preventDefault();
    const targetUrl = urlOverride || authorUrl;
    if (!targetUrl) return alert('请输入作者页面或分类页面URL');
    
    setLoading(true);
    setError('');
    setWorks([]);
    setAuthorName('');
    
    try {
      const res = await fetch('/api/author', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: targetUrl })
      });
      const data = await res.json();
      if (res.ok) {
        setAuthorName(data.title);
        // By default, select all works
        setWorks(data.works.map((w: any) => ({ ...w, selected: true })));
      } else {
        setError(data.error || '解析失败，可能是不支持的站点结构或请求超时。');
      }
    } catch (e: any) {
      setError('解析出错: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  // Prepopulate and trigger parse automatically for quick testing
  const handleQuickTemplate = (url: string) => {
    setAuthorUrl(url);
    handleParse(undefined, url);
  };

  // Match library items with parsed items to recognize downloaded ones
  const getMatchedNovel = (title: string): Novel | null => {
    if (!library || library.length === 0) return null;
    const cleanWork = title.replace(/[《》\s]/g, '').toLowerCase();
    
    // Find closest filename or displayName match
    for (const novel of library) {
      const cleanLib = novel.name.replace(/[《》\s]/g, '').toLowerCase();
      // Match if one contains the other or vice-versa
      if (cleanLib.includes(cleanWork) || cleanWork.includes(cleanLib)) {
        return novel;
      }
    }
    return null;
  };

  const toggleSelectAll = (select: boolean) => {
    setWorks(works.map(w => ({ ...w, selected: select })));
  };

  const toggleSelect = (idx: number) => {
    setWorks(works.map((w, i) => i === idx ? { ...w, selected: !w.selected } : w));
  };

  // Smart Sync Filter: Select ONLY unsynced / not yet downloaded books
  const selectUnsyncedOnly = () => {
    setWorks(works.map(w => {
      const isDownloaded = getMatchedNovel(w.title) !== null;
      return { ...w, selected: !isDownloaded };
    }));
  };

  const handleBatchStart = async () => {
    const selectedWorks = works.filter(w => w.selected);
    if (!selectedWorks.length) return alert('请至少选择一本小说进行批量下载');
    
    try {
      const res = await fetch('/api/batch_start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ works: selectedWorks, incremental })
      });
      const data = await res.json();
      if (data.batch_id) {
        navigate(`/batch_logs/${data.batch_id}`);
      } else {
        alert(data.error || '启动批量任务失败');
      }
    } catch (e: any) {
      alert('批量任务启动异常: ' + e.message);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50/50 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-5xl mx-auto">
        
        {/* Navigation & Breadcrumb */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <div className="flex items-center gap-2">
            <Link 
              to="/" 
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors"
            >
              <ArrowLeft size={16} />
              <span>单本控制台</span>
            </Link>
            <ChevronRight size={14} className="text-slate-400" />
            <span className="text-sm font-semibold text-slate-900 bg-slate-100 px-2.5 py-1 rounded-md">
              批量同步管理
            </span>
          </div>

          <div className="flex items-center gap-3">
            <Link 
              to="/batch_list" 
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-100 transition-all shadow-sm"
              id="view-batch-tasks"
            >
              <FileText size={16} />
              <span>批量下载列表</span>
            </Link>
            
            <button 
              onClick={fetchLibrary}
              disabled={loadingLibrary}
              className="inline-flex items-center justify-center p-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 shadow-sm transition-all"
              title="刷新本地书库状态"
            >
              <RefreshCw size={16} className={`${loadingLibrary ? 'animate-spin text-indigo-600' : ''}`} />
            </button>
          </div>
        </div>

        {/* Header Cards Title */}
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-6 sm:p-8 mb-8 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-50/50 rounded-full blur-3xl -z-10 translate-x-20 -translate-y-20"></div>
          
          <div className="flex items-start gap-4">
            <div className="p-3.5 bg-indigo-600 rounded-2xl text-white shadow-md shadow-indigo-600/10">
              <BookOpen size={28} />
            </div>
            <div>
              <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight sm:text-3xl">
                🧑‍🎨 作者 / 分类页批量同步解析
              </h1>
              <p className="mt-2 text-slate-600 text-sm leading-relaxed max-w-2xl">
                独家首创 <strong className="text-indigo-600">本地书库状态实时同步系统</strong>。输入 52书库 各种小说站的作者主页、全书列表或任一分类目录链接，一键获取整页书籍。实时对接本地书库，精准标记已存档案、更新状态，告别重复下载与文件覆盖！
              </p>
            </div>
          </div>
        </div>

        {/* Parser input core card */}
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-6 sm:p-8 mb-8">
          <form onSubmit={handleParse} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <label className="text-sm font-semibold text-slate-800 flex items-center gap-1.5 select-none">
                <ExternalLink size={16} className="text-indigo-500" />
                <span>输入作者主页 / 作品分类栏目 URL 的绝对路径</span>
              </label>
              
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                    <Search size={18} />
                  </div>
                  <input 
                    type="url" 
                    value={authorUrl}
                    onChange={(e) => setAuthorUrl(e.target.value)}
                    placeholder="例如: https://www.52shuku.net/zuozhe/meiran.html 或 https://www.52shuku.net/yanqing/"
                    required
                    className="block w-full pl-10 pr-4 py-3 border border-slate-300 rounded-xl text-slate-900 bg-slate-50/30 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-[0.95rem] transition-all"
                    id="author-url-input"
                  />
                </div>
                
                <button 
                  type="submit" 
                  disabled={loading}
                  className="inline-flex items-center justify-center px-6 py-3 border border-transparent text-sm font-semibold rounded-xl text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 shadow-md shadow-indigo-600/10 transition-all disabled:opacity-75 disabled:cursor-not-allowed select-none min-w-[130px]"
                  id="start-parsing-btn"
                >
                  {loading ? (
                    <>
                      <RefreshCw size={16} className="animate-spin mr-2" />
                      <span>解析计算中...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles size={16} className="mr-2" />
                      <span>解 析 作 品</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </form>

          {/* Quick Demo Templates */}
          <div className="mt-5 pt-5 border-t border-slate-100 sm:flex sm:items-center sm:gap-4">
            <span className="text-xs font-semibold text-slate-400 tracking-wider uppercase block sm:inline mb-2.5 sm:mb-0">
              💡 演示体验链接(1秒极速载入):
            </span>
            <div className="flex flex-wrap gap-2.5">
              <button
                type="button"
                onClick={() => handleQuickTemplate('https://www.52shuku.net/zuozhe/meiran.html')}
                className="inline-flex items-center px-3 py-1.5 text-xs font-medium rounded-lg text-slate-700 bg-slate-100 hover:bg-indigo-50 hover:text-indigo-700 transition"
                title="作者: 梅燃 (古典纯美网文作者)"
              >
                🖊️ 专页: 极速解析“梅燃”
              </button>
              <button
                type="button"
                onClick={() => handleQuickTemplate('https://www.52shuku.net/zuozhe/guman.html')}
                className="inline-flex items-center px-3 py-1.5 text-xs font-medium rounded-lg text-slate-700 bg-slate-100 hover:bg-indigo-50 hover:text-indigo-700 transition"
                title="作者: 顾曼 (言情文豪)"
              >
                🖊️ 专页: 极速解析“顾漫”
              </button>
              <button
                type="button"
                onClick={() => handleQuickTemplate('https://www.52shuku.net/yanqing/')}
                className="inline-flex items-center px-3 py-1.5 text-xs font-medium rounded-lg text-slate-700 bg-slate-100 hover:bg-slate-200 transition"
              >
                📂 栏目: 言情小说分类
              </button>
            </div>
          </div>
        </div>

        {/* Error notification */}
        {error && (
          <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 flex gap-3 text-rose-800 mb-8 animation-fadeIn">
            <Info size={18} className="text-rose-500 shrink-0 mt-0.5" />
            <div className="text-sm font-medium">{error}</div>
          </div>
        )}

        {/* Parse outcome area */}
        {works.length > 0 && (() => {
          const matchedNovelsNum = works.filter(w => getMatchedNovel(w.title) !== null).length;
          const pendingSyncNum = works.length - matchedNovelsNum;
          const selectedCount = works.filter(w => w.selected).length;

          return (
            <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden mb-8">
              
              {/* Sync Dashboard Board */}
              <div className="bg-slate-50/50 px-6 py-5 border-b border-slate-200 sm:flex sm:items-center sm:justify-between gap-4">
                <div>
                  <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                    <span>📖 解析结果: {authorName && authorName !== '未知作者' ? `“${authorName}”` : '列表专页'}</span>
                    <span className="text-xs font-semibold bg-indigo-100 text-indigo-700 px-2.5 py-0.5 rounded-full">
                      发现 {works.length} 本作品
                    </span>
                  </h2>
                  <p className="text-xs text-slate-500 mt-1">
                    本地书库已匹配: <span className="font-semibold text-emerald-600">{matchedNovelsNum} 本</span> / 待同步: <span className="font-semibold text-amber-600">{pendingSyncNum} 本</span>
                  </p>
                </div>

                {/* Batch selection controllers */}
                <div className="flex flex-wrap items-center gap-2 mt-3.5 sm:mt-0">
                  <button 
                    onClick={() => toggleSelectAll(true)} 
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 shadow-sm transition"
                  >
                    <CheckSquare size={13} />
                    <span>全部选定</span>
                  </button>
                  <button 
                    onClick={() => toggleSelectAll(false)} 
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 shadow-sm transition"
                  >
                    <Square size={13} />
                    <span>全部取消</span>
                  </button>
                  <button 
                    onClick={selectUnsyncedOnly} 
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-100 shadow-sm transition"
                    title="仅勾选当前未在书库下载过的小说，实现快捷增量下载新书"
                  >
                    <ListFilter size={13} />
                    <span>仅选新书 (推荐)</span>
                  </button>
                </div>
              </div>

              {/* Works List Scroll area */}
              <div className="divide-y divide-slate-200 max-h-[500px] overflow-y-auto">
                {works.map((w, i) => {
                  const matchedNovel = getMatchedNovel(w.title);
                  const isDownloaded = matchedNovel !== null;

                  return (
                    <div 
                      key={i} 
                      className={`flex items-center justify-between p-4 sm:p-5 hover:bg-slate-50/50 transition-colors gap-4 ${w.selected ? '' : 'opacity-65'}`}
                      onClick={() => toggleSelect(i)}
                      style={{ cursor: 'pointer' }}
                    >
                      <div className="flex items-start gap-3.5 flex-1 min-w-0">
                        {/* Custom Checkbox */}
                        <div className="pt-0.5" onClick={(e) => e.stopPropagation()}>
                          <input 
                            type="checkbox" 
                            checked={w.selected} 
                            onChange={() => toggleSelect(i)} 
                            className="w-5 h-5 rounded-md text-indigo-600 focus:ring-indigo-500 border-slate-300 transition-all cursor-pointer"
                          />
                        </div>
                        
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-slate-800 text-[1.05rem] truncate">
                              《{w.title}》
                            </span>
                            
                            {/* Matching Badge statuses */}
                            {isDownloaded ? (
                              <div className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-100">
                                <ShieldCheck size={12} className="text-emerald-600" />
                                <span>已在书库 ({matchedNovel.size})</span>
                              </div>
                            ) : (
                              <div className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700 bg-amber-50/60 px-2.5 py-0.5 rounded-full border border-amber-100">
                                <Zap size={12} className="text-amber-500" />
                                <span>未下载新书</span>
                              </div>
                            )}
                          </div>
                          
                          <div className="flex items-center gap-3 text-xs text-slate-400 mt-1.5 font-mono truncate">
                            {isAdmin ? (
                              <span className="flex items-center gap-1 text-slate-500">
                                <span>🔗 目标起始链接:</span>
                                <a 
                                  href={w.url} 
                                  target="_blank" 
                                  rel="noopener noreferrer" 
                                  className="hover:text-indigo-600 underline flex items-center gap-0.5 inline-block"
                                  onClick={e => e.stopPropagation()}
                                >
                                  {w.url} <ExternalLink size={10} />
                                </a>
                              </span>
                            ) : (
                              <span className="flex items-center gap-1 text-slate-500">
                                <span>🔗 目标书源:</span>
                                <span className="text-slate-600 bg-slate-100 px-2 py-0.5 rounded text-[11px] font-sans">云端受保护书源</span>
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Quick Read / Action links right panel */}
                      <div className="shrink-0 flex items-center gap-3" onClick={e => e.stopPropagation()}>
                        {isDownloaded && (
                          <Link
                            to={`/read/${encodeURIComponent(matchedNovel.filename)}`}
                            className="inline-flex items-center justify-center p-2 rounded-xl text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 border border-slate-200/80 hover:border-indigo-100 hover:shadow-xs transition bg-white"
                            title="本地已有，点击直接进行阅读"
                          >
                            <Play size={15} fill="currentColor" className="ml-0.5" />
                            <span className="hidden sm:inline text-xs font-semibold ml-1.5 mr-1 text-indigo-700">阅读本书</span>
                          </Link>
                        )}
                        {isAdmin && (
                          <a 
                            href={w.url} 
                            target="_blank" 
                            rel="noopener noreferrer" 
                            className="inline-flex items-center justify-center p-2 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-100 border border-slate-100 bg-white"
                            title="在原始小说网打开查看"
                          >
                            <ExternalLink size={14} />
                          </a>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Synchronization Settings & Launcher Trigger */}
              <div className="bg-slate-50 p-6 border-t border-slate-200 sm:flex sm:items-center sm:justify-between gap-6">
                <div className="flex flex-col gap-1.5 mb-4 sm:mb-0">
                  <div className="inline-flex items-center gap-2">
                    <input 
                      type="checkbox" 
                      id="incremental_batch" 
                      checked={incremental} 
                      onChange={e => setIncremental(e.target.checked)} 
                      className="w-5 h-5 rounded text-indigo-600 focus:ring-indigo-500 border-slate-300 cursor-pointer"
                    />
                    <label htmlFor="incremental_batch" className="text-sm font-bold text-slate-700 select-none cursor-pointer">
                      启用核心增量同步模式 (分片校验)
                    </label>
                  </div>
                  <p className="text-xs text-slate-400 ml-7 leading-relaxed max-w-xl">
                    若作品在本地已存在，将自动校验已下载章节的哈希指纹，仅下载更新的多出内容。极大节约带宽并保护源IP。
                  </p>
                </div>

                <button 
                  onClick={handleBatchStart}
                  disabled={selectedCount === 0}
                  className="w-full sm:w-auto inline-flex items-center justify-center px-8 py-3.5 border border-transparent text-sm font-bold rounded-xl text-white bg-emerald-600 hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-500 shadow-md shadow-emerald-600/10 transition disabled:opacity-50 disabled:cursor-not-allowed select-none animate-pulse-slow"
                  id="launch-batch-download-btn"
                >
                  <Download size={18} className="mr-2" />
                  <span>📥 批量开始同步 ({selectedCount} 本作品)</span>
                </button>
              </div>

            </div>
          );
        })()}

      </div>
    </div>
  );
}
