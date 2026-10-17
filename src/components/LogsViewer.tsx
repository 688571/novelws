import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { TaskStatus } from '../types';
import { useAuth } from '../context/AuthContext';
import { 
  ArrowLeft, BookOpen, Terminal, CheckCircle2, AlertTriangle, Play, RefreshCw, Layers, 
  HelpCircle, ChevronRight, CheckCircle, Clock, ShieldCheck, ExternalLink
} from 'lucide-react';

export function LogsViewer() {
  const { id } = useParams<{ id: string }>();
  const { isAdmin, authFetch } = useAuth();
  const [task, setTask] = useState<TaskStatus | null>(null);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const logContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let timer: any;
    const fetchLog = async () => {
      try {
        const res = await authFetch(`/api/logs/${id}`);
        if (!res.ok) {
          if (res.status === 404) setError('任务不存在');
          return;
        }
        const data = await res.json();
        setTask(data);
        if (data.status === 'running') {
          timer = setTimeout(fetchLog, 1500); // Poll slightly faster for better real-time feel
        }
      } catch (e: any) {
        setError(e.message);
        timer = setTimeout(fetchLog, 5000);
      }
    };
    fetchLog();
    return () => clearTimeout(timer);
  }, [id]);

  // Handle auto-scrolling to the bottom of logs on update
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [task?.log]);

  // Extract latest processing progress details
  let currentProgressText = "系统准备中...";
  let progressPercent: number | null = null;
  let currentStep = 1; // 1: init, 2: download, 3: clean, 4: finished
  let totalChapters = 0;
  let currentChapter = 0;

  if (task && task.log && task.log.length > 0) {
    if (task.status === 'finished') {
      currentStep = 4;
      currentProgressText = "🎉 小说抓取、增量校验与深度清洗已全部完成！";
    } else if (task.status === 'error') {
      currentProgressText = "❌ 任务遭遇意外中断，详情请见控制台日志。";
    } else {
      // Find latest specific log events
      const reversedLogs = [...task.log].reverse();
      const processingLine = reversedLogs.find(l => l.includes('处理中'));
      const skipLine = reversedLogs.find(l => l.includes('跳过已抓取页'));
      const cleaningLine = reversedLogs.find(l => l.includes('后置清理') || l.includes('后置处理') || l.includes('清洗'));

      if (cleaningLine) {
        currentStep = 3;
        currentProgressText = "🧹 正在合并生成纯净文本，剔除重复广告推广，及排列页码...";
      } else if (processingLine) {
        currentStep = 2;
        const match = processingLine.match(/处理中\s*\[(\d+)\/(\d+|\?)\]/);
        if (match) {
          currentChapter = parseInt(match[1]);
          const totalStr = match[2];
          if (totalStr === '?') {
            currentProgressText = `⏳ 正在抓取正文: 动态爬取第 ${currentChapter} 页 (智能翻页中)...`;
          } else {
            totalChapters = parseInt(totalStr);
            currentProgressText = `⏳ 正在爬取正文: 第 ${currentChapter} 部分 / 共 ${totalChapters} 部分...`;
            if (totalChapters > 0) {
              progressPercent = Math.round((currentChapter / totalChapters) * 100);
            }
          }
        } else {
          currentProgressText = processingLine;
        }
      } else if (skipLine) {
        currentStep = 2;
        const match = skipLine.match(/跳过已抓取页\s*\[(\d+)\]/);
        if (match) {
          currentChapter = parseInt(match[1]);
          currentProgressText = `🔄 增量比对：本地已缓存，跳过第 ${currentChapter} 大页...`;
        } else {
          currentProgressText = skipLine;
        }
      } else {
        // Fallback to literal last log
        currentProgressText = task.log[task.log.length - 1];
        if (task.log.some(l => l.includes('寻找所有') || l.includes('找到') || l.includes('目录页'))) {
          currentStep = 1;
        }
      }
    }
  }

  return (
    <div className="bg-slate-50 min-h-screen text-slate-800 pb-12">
      {/* Upper Navigation Bar */}
      <div className="bg-white border-b border-slate-200 py-4 px-6 md:px-8 sticky top-0 z-10 shadow-sm">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => navigate('/')} 
              className="text-slate-500 hover:text-slate-800 p-2 hover:bg-slate-100 rounded-lg transition"
              title="返回控制台"
            >
              <ArrowLeft size={18} />
            </button>
            <div>
              <span className="text-xs uppercase tracking-wider font-mono font-bold text-indigo-600 block">Task Dashboard</span>
              <h1 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                抓取进度监控
                <span className="text-slate-400 font-mono text-sm font-normal">#{id}</span>
              </h1>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button 
              onClick={() => navigate('/library')} 
              className="px-4 py-2 text-sm bg-white border border-slate-200 text-slate-600 rounded-lg shadow-sm hover:bg-slate-50 transition flex items-center gap-1.5 font-medium"
            >
              <BookOpen size={15} /> 我的书架
            </button>
            <button 
              onClick={() => navigate('/')} 
              className="px-4 py-2 text-sm bg-indigo-600 border border-transparent text-white rounded-lg shadow-sm hover:bg-indigo-700 transition font-medium"
            >
              主控制台
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 md:px-8 mt-8">
        {error ? (
          <div className="bg-rose-50 border border-rose-200 p-6 rounded-2xl text-center max-w-lg mx-auto">
            <AlertTriangle className="text-rose-500 mx-auto w-12 h-12 mb-3" />
            <h3 className="text-lg font-bold text-rose-900 mb-1">加载失败</h3>
            <p className="text-rose-700 text-sm mb-4">{error}</p>
            <button onClick={() => navigate('/')} className="px-5 py-2 bg-rose-600 text-white rounded-lg hover:bg-rose-700 transition font-semibold text-sm">
              返回主页
            </button>
          </div>
        ) : !task ? (
          <div className="text-center py-24 max-w-lg mx-auto">
            <RefreshCw className="animate-spin text-indigo-600 mx-auto w-10 h-10 mb-4" />
            <h3 className="text-lg font-medium text-slate-700">正在与服务器握手，拉取最新抓取状况...</h3>
            <p className="text-slate-400 text-sm mt-1">这通常需要一两秒，请稍候。</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            
            {/* LEFT COLUMN: VISUAL DASHBOARD */}
            <div className="lg:col-span-5 space-y-6">
              
              {/* Novel Core Tracker */}
              <div
                className="rounded-2xl shadow-sm border p-6 relative overflow-hidden"
                style={{
                  background: 'var(--theme-card)',
                  borderColor: 'var(--theme-border)',
                  color: 'var(--theme-text-main)'
                }}
              >
                <div className="absolute top-0 left-0 w-full h-[4px]" style={{ background: 'var(--theme-primary)' }}></div>
                <div className="flex items-center justify-between mb-4">
                  <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold leading-none uppercase tracking-wide ${
                    task.status === 'running' ? 'bg-amber-100 text-amber-800' :
                    task.status === 'finished' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                  }`}>
                    {task.status === 'running' && <span className="h-2 w-2 rounded-full bg-amber-500 animate-ping"></span>}
                    {task.status === 'running' ? '正在采集' : task.status === 'finished' ? '任务成功' : '异常中止'}
                  </span>
                  
                  <span className="text-xs font-mono flex items-center gap-1" style={{ color: 'var(--theme-text-muted)' }}>
                    <Clock size={12} />
                    ID: {id}
                  </span>
                </div>

                <h2 className="text-xl font-extrabold leading-snug break-all mb-1" style={{ color: 'var(--theme-text-main)' }}>
                  《{task.novel_name || '获取小说标题中...'}》
                </h2>
                {isAdmin ? (
                  <div className="text-xs font-mono break-all line-clamp-1 mb-6 flex items-center gap-1.5" style={{ color: 'var(--theme-text-muted)' }}>
                    <span className="font-semibold uppercase tracking-wider">Origin URL:</span>
                    <a href={task.start_url} target="_blank" rel="noreferrer" className="hover:underline inline-flex items-center gap-1" style={{ color: 'var(--theme-primary)' }}>
                      {task.start_url} <ExternalLink size={10} />
                    </a>
                  </div>
                ) : (
                  <div className="text-xs font-mono break-all line-clamp-1 mb-6 flex items-center gap-1.5" style={{ color: 'var(--theme-text-muted)' }}>
                    <span className="font-semibold uppercase tracking-wider">数据采集源:</span>
                    <span className="px-2 py-0.5 rounded text-xs inline-flex items-center gap-1 font-medium" style={{ background: 'var(--theme-card-sub)', color: 'var(--theme-text-main)', border: '1px solid var(--theme-border)' }}>
                      <ShieldCheck size={12} className="text-emerald-600" />
                      <span>云端受保护书源 (私密加密通道)</span>
                    </span>
                  </div>
                )}

                {/* Progress Indicators */}
                <div className="rounded-xl p-4 border mb-6" style={{ background: 'var(--theme-card-sub)', borderColor: 'var(--theme-border)' }}>
                  <div className="flex justify-between items-end mb-2">
                    <span className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--theme-text-muted)' }}>
                      最新处理进度
                    </span>
                    <span className="text-sm font-extrabold font-mono" style={{ color: 'var(--theme-primary)' }}>
                      {progressPercent !== null ? `${progressPercent}%` : '实时运作中'}
                    </span>
                  </div>

                  <div className="w-full h-3 rounded-full overflow-hidden mb-3 relative" style={{ background: 'var(--theme-border)' }}>
                    <div 
                      className={`h-full rounded-full transition-all duration-700 ease-out ${
                        task.status === 'error' ? 'bg-rose-500' : 
                        task.status === 'finished' ? 'bg-emerald-500' : 'bg-indigo-600'
                      }`}
                      style={{ 
                        width: task.status === 'finished' ? '100%' : (progressPercent !== null ? `${progressPercent}%` : '50%'),
                        background: task.status === 'running' ? 'var(--theme-primary)' : undefined
                      }}
                    ></div>
                    {task.status === 'running' && progressPercent === null && (
                      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent animate-[pulse_1.5s_infinite] h-full"></div>
                    )}
                  </div>

                  <p className="text-xs leading-relaxed font-medium break-all mt-1" style={{ color: 'var(--theme-text-muted)' }}>
                    {currentProgressText}
                  </p>
                </div>

                {/* Real-time stats box */}
                {task.status === 'finished' && task.safe_name ? (
                  <div className="space-y-3">
                    <button 
                      onClick={() => navigate(`/read/${encodeURIComponent(task.safe_name! + '.txt')}`)}
                      className="w-full bg-emerald-600 text-white rounded-xl py-3 text-sm font-extrabold text-center block shadow-lg shadow-emerald-600/20 hover:bg-emerald-700 hover:shadow-emerald-700/30 active:scale-[0.99] transition cursor-pointer"
                    >
                      📖 立即进入护眼阅读
                    </button>
                  </div>
                ) : (
                  <div className="text-xs p-3 rounded-lg border flex justify-between items-center" style={{ background: 'var(--theme-card-sub)', borderColor: 'var(--theme-border)', color: 'var(--theme-text-muted)' }}>
                    <span>🔄 接收间隔: 1.5 秒更新</span>
                    <span className="font-mono font-semibold">日志包行数: {task.log.length}</span>
                  </div>
                )}
              </div>

              {/* Crawl Steps Stepper */}
              <div
                className="rounded-2xl shadow-sm border p-6"
                style={{
                  background: 'var(--theme-card)',
                  borderColor: 'var(--theme-border)',
                  color: 'var(--theme-text-main)'
                }}
              >
                <h3 className="text-sm font-extrabold uppercase tracking-wider mb-5" style={{ color: 'var(--theme-text-main)' }}>
                  爬虫采集关键阶段与步骤
                </h3>

                <div className="relative pl-6 border-l-2 border-slate-150 space-y-6">
                  
                  {/* Step 1 */}
                  <div className="relative">
                    <div className={`absolute -left-[31px] top-0.5 rounded-full p-0.5 flex items-center justify-center w-[18px] h-[18px] z-10 ${
                      currentStep > 1 || task.status === 'finished' ? 'bg-emerald-100 text-emerald-600' :
                      currentStep === 1 && task.status === 'running' ? 'bg-indigo-100 text-indigo-600 animate-pulse' : 'bg-slate-100 text-slate-400'
                    }`}>
                      {currentStep > 1 || task.status === 'finished' ? <CheckCircle size={14} /> : <div className="h-1.5 w-1.5 rounded-full bg-current"></div>}
                    </div>
                    <div>
                      <h4 className={`text-xs font-extrabold uppercase tracking-wider ${
                        currentStep === 1 && task.status === 'running' ? 'text-indigo-600' : 'text-slate-700'
                      }`}>阶段 1: 初始化配置 & 解析目录表</h4>
                      <p className="text-xs text-slate-400 mt-0.5">连通目标远端网站，智能探究书籍大纲与分页模式。</p>
                    </div>
                  </div>

                  {/* Step 2 */}
                  <div className="relative">
                    <div className={`absolute -left-[31px] top-0.5 rounded-full p-0.5 flex items-center justify-center w-[18px] h-[18px] z-10 ${
                      currentStep > 2 || task.status === 'finished' ? 'bg-emerald-100 text-emerald-600' :
                      currentStep === 2 && task.status === 'running' ? 'bg-indigo-100 text-indigo-600' : 'bg-slate-100 text-slate-400'
                    }`}>
                      {currentStep > 2 || task.status === 'finished' ? <CheckCircle size={14} /> : 
                       currentStep === 2 && task.status === 'running' ? <span className="h-1.5 w-1.5 rounded-full bg-indigo-600 animate-ping"></span> : <div className="h-1.5 w-1.5 rounded-full bg-current"></div>}
                    </div>
                    <div>
                      <h4 className={`text-xs font-extrabold uppercase tracking-wider ${
                        currentStep === 2 && task.status === 'running' ? 'text-indigo-600' : 'text-slate-700'
                      }`}>阶段 2: 章节抓取与增量同步</h4>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {totalChapters > 0 && currentChapter > 0 ? (
                          <span className="text-indigo-600 font-bold">爬取正文中: {currentChapter}/{totalChapters}</span>
                        ) : '动态大页分篇批量拉取，全速下载小说各段正文。'}
                      </p>
                    </div>
                  </div>

                  {/* Step 3 */}
                  <div className="relative">
                    <div className={`absolute -left-[31px] top-0.5 rounded-full p-0.5 flex items-center justify-center w-[18px] h-[18px] z-10 ${
                      currentStep > 3 || task.status === 'finished' ? 'bg-emerald-100 text-emerald-600' :
                      currentStep === 3 && task.status === 'running' ? 'bg-indigo-100 text-indigo-600 animate-pulse' : 'bg-slate-100 text-slate-400'
                    }`}>
                      {currentStep > 3 || task.status === 'finished' ? <CheckCircle size={14} /> : <div className="h-1.5 w-1.5 rounded-full bg-current"></div>}
                    </div>
                    <div>
                      <h4 className={`text-xs font-extrabold uppercase tracking-wider ${
                        currentStep === 3 && task.status === 'running' ? 'text-indigo-600' : 'text-slate-700'
                      }`}>阶段 3: 后置深度清洗与纯净化过滤</h4>
                      <p className="text-xs text-slate-400 mt-0.5">系统后处理：自动校验并剔除同类推荐或违禁广告，净化排版。</p>
                    </div>
                  </div>

                  {/* Step 4 */}
                  <div className="relative">
                    <div className={`absolute -left-[31px] top-0.5 rounded-full p-0.5 flex items-center justify-center w-[18px] h-[18px] z-10 ${
                      task.status === 'finished' ? 'bg-emerald-100 text-emerald-600 animate-bounce' : 'bg-slate-100 text-slate-400'
                    }`}>
                      {task.status === 'finished' ? <ShieldCheck size={14} /> : <div className="h-1.5 w-1.5 rounded-full bg-current"></div>}
                    </div>
                    <div>
                      <h4 className={`text-xs font-extrabold uppercase tracking-wider ${
                        task.status === 'finished' ? 'text-emerald-600' : 'text-slate-700'
                      }`}>阶段 4: 生成小说并成功导入书架</h4>
                      <p className="text-xs text-slate-400 mt-0.5">整合排班生成整本 TXT，注册元数据并支持在线纯净阅读。</p>
                    </div>
                  </div>

                </div>
              </div>

            </div>

            {/* RIGHT COLUMN: TERMINAL CONSOLE LOGS */}
            <div className="lg:col-span-7">
              <div className="bg-slate-900 rounded-2xl overflow-hidden shadow-xl border border-slate-800 flex flex-col h-full">
                
                {/* Visual Terminal Header */}
                <div className="bg-slate-950 px-5 py-4 border-b border-slate-800 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Terminal size={16} className="text-emerald-400" />
                    <span className="text-xs font-mono font-extrabold tracking-wider text-slate-300">
                      LIVE RUNTIME OUTPUT CONSOLE
                    </span>
                  </div>
                  
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex rounded-full h-2 w-2 ${task.status === 'running' ? 'bg-emerald-500 animate-[pulse_1.2s_infinite]' : 'bg-slate-600'}`}></span>
                      <span className="text-[10px] uppercase font-bold tracking-widest font-mono text-slate-400">
                        {task.status === 'running' ? 'Streaming' : 'Completed'}
                      </span>
                    </div>
                    
                    <button 
                      onClick={() => {
                        if (logContainerRef.current) {
                          logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
                        }
                      }}
                      className="px-2 py-0.5 text-[9px] font-mono bg-slate-800 hover:bg-slate-700 text-slate-300 rounded transition"
                      title="强行降落至最底部"
                    >
                      SCROLL BOTTOM
                    </button>
                  </div>
                </div>

                {/* Console Log Content Area */}
                <div 
                  ref={logContainerRef}
                  className="p-5 font-mono text-[12px] text-slate-300 space-y-1.5 overflow-y-auto"
                  style={{ height: '620px', minHeight: '520px', background: '#0d1117' }}
                >
                  {task.log.length === 0 ? (
                    <div className="text-slate-500 italic text-center py-12">
                      系统内核启动... 暂无详细运行快照
                    </div>
                  ) : (
                    task.log.map((line, idx) => {
                      const displayLine = isAdmin 
                        ? line 
                        : line.replace(/https?:\/\/[^\s"'<>]+/gi, '[云端通道]').replace(/(?:www\.)?[a-zA-Z0-9-]+\.(?:com|net|org|cn|info)/gi, '[云端通道]');
                      let tagStyle = "text-slate-400";
                      
                      if (displayLine.includes('⚠️')) {
                        tagStyle = "text-amber-400 bg-amber-500/10 px-1 rounded border border-amber-500/20";
                      } else if (displayLine.includes('❌') || displayLine.includes('错误') || displayLine.includes('异常') || displayLine.includes('报错') || displayLine.includes('失败')) {
                        tagStyle = "text-rose-400 bg-rose-500/10 px-1 rounded border border-rose-500/20";
                      } else if (displayLine.includes('✓') || displayLine.includes('成功') || displayLine.includes('采集完成') || displayLine.includes('完成')) {
                        tagStyle = "text-emerald-400 bg-emerald-500/10 px-1 rounded border border-emerald-500/20";
                      } else if (displayLine.includes('===') || displayLine.includes('任务启动') || displayLine.includes('开始抓取')) {
                        tagStyle = "text-cyan-400 font-bold";
                      } else {
                        tagStyle = "text-slate-300";
                      }

                      return (
                        <div key={idx} className={`leading-relaxed whitespace-pre-wrap transition-all duration-200 ${tagStyle}`}>
                          {displayLine}
                        </div>
                      );
                    })
                  )}
                </div>

                {/* Terminal Footer Info */}
                <div className="bg-slate-950 px-5 py-3 border-t border-slate-800/80 flex justify-between items-center text-[10px] font-mono text-slate-500">
                  <span>⚓️ AUTO WINDOW SCROLL: ON</span>
                  <span>LINES PACKET: {task.log.length}</span>
                </div>
              </div>
            </div>

          </div>
        )}
      </div>
    </div>
  );
}
