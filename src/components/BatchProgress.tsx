import React, { useEffect, useState, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { TaskStatus } from '../types';
import { useAuth } from '../context/AuthContext';

export function BatchProgress() {
  const { id } = useParams<{ id: string }>();
  const { isAdmin, authFetch } = useAuth();
  const [task, setTask] = useState<TaskStatus | null>(null);
  const [error, setError] = useState('');
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
          timer = setTimeout(fetchLog, 2000);
        }
      } catch (e: any) {
        setError(e.message);
        timer = setTimeout(fetchLog, 5000);
      }
    };
    fetchLog();
    return () => clearTimeout(timer);
  }, [id]);

  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [task?.log]);

  const clearLogDisplay = () => {
    if (task) {
      setTask({ ...task, log: [] });
    }
  };

  let total = 1;
  let current = 0;
  let successCount = 0;
  let failCount = 0;

  if (task) {
    if (task.novel_name?.includes('[批量任务]')) {
      const match = task.novel_name.match(/(\d+)本/);
      if (match) total = parseInt(match[1]);
      current = task.log.filter(l => l.includes('=== 开始下载')).length;
      successCount = task.log.filter(l => l.includes('✓') && l.includes('抓取完成')).length;
      failCount = task.log.filter(l => l.includes('✗') && (l.includes('异常') || l.includes('爬虫非正常退出'))).length;
    } else {
      current = task.status === 'finished' || task.status === 'error' ? 1 : 0;
      successCount = task.status === 'finished' ? 1 : 0;
      failCount = task.status === 'error' ? 1 : 0;
    }
  }

  const progressPercent = total > 0 ? ((successCount + failCount) / total) * 100 : 0;

  return (
    <>
      <style>{`
        .bprog-root {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            background: #1a1a2e;
            min-height: 100vh;
            padding: 20px;
            color: #ddd;
        }
        .bprog-root .container {
            max-width: 1400px;
            margin: 0 auto;
        }
        .bprog-root .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            border-radius: 16px;
            padding: 20px 30px;
            margin-bottom: 20px;
            color: white;
        }
        .bprog-root .header h1 { margin-bottom: 10px; }
        .bprog-root .nav-links {
            display: flex;
            gap: 15px;
            margin-top: 15px;
        }
        .bprog-root .nav-links a {
            color: white;
            text-decoration: none;
            padding: 6px 14px;
            background: rgba(255,255,255,0.2);
            border-radius: 20px;
            transition: all 0.3s;
        }
        .bprog-root .nav-links a:hover { background: rgba(255,255,255,0.3); }
        
        .bprog-root .dashboard {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
            margin-bottom: 20px;
        }
        @media (max-width: 800px) {
            .bprog-root .dashboard { grid-template-columns: 1fr; }
        }
        .bprog-root .card {
            background: #16213e;
            border-radius: 16px;
            padding: 20px;
            color: #eee;
        }
        .bprog-root .card-title {
            font-size: 18px;
            margin-bottom: 15px;
            color: #667eea;
            border-left: 3px solid #667eea;
            padding-left: 12px;
        }
        .bprog-root .stats {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 15px;
            text-align: center;
        }
        .bprog-root .stat-item {
            background: #0f3460;
            border-radius: 12px;
            padding: 15px;
        }
        .bprog-root .stat-value {
            font-size: 32px;
            font-weight: bold;
            color: #667eea;
        }
        .bprog-root .stat-label {
            font-size: 12px;
            color: #aaa;
            margin-top: 5px;
        }
        .bprog-root .progress-bar {
            background: #0f3460;
            border-radius: 10px;
            height: 20px;
            overflow: hidden;
            margin: 15px 0;
        }
        .bprog-root .progress-fill {
            background: linear-gradient(90deg, #667eea, #764ba2);
            height: 100%;
            width: 0%;
            transition: width 0.3s;
            border-radius: 10px;
        }
        .bprog-root .current-novel {
            background: #0f3460;
            border-radius: 12px;
            padding: 12px;
            margin-top: 10px;
            font-size: 14px;
        }
        .bprog-root .log-container {
            background: #0a0e27;
            border-radius: 16px;
            overflow: hidden;
        }
        .bprog-root .log-header {
            background: #16213e;
            padding: 15px 20px;
            border-bottom: 1px solid #2a3a5a;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .bprog-root .log-header h3 { color: #eee; margin:0; }
        .bprog-root .clear-btn {
            background: #e94560;
            border: none;
            color: white;
            padding: 5px 12px;
            border-radius: 6px;
            cursor: pointer;
        }
        .bprog-root .log-content {
            height: 400px;
            overflow-y: auto;
            padding: 15px;
            font-family: 'Monaco', 'Menlo', monospace;
            font-size: 13px;
            background: #0a0e27;
        }
        .bprog-root .log-entry {
            color: #aaa;
            padding: 4px 0;
            border-bottom: 1px solid #1a1a2e;
            word-break: break-all;
        }
        .bprog-root .log-entry.success { color: #4ade80; }
        .bprog-root .log-entry.error { color: #f87171; }
        .bprog-root .log-entry.info { color: #60a5fa; }
        
        .bprog-root button {
            background: #667eea;
            border: none;
            color: white;
            padding: 8px 16px;
            border-radius: 8px;
            cursor: pointer;
            margin-right: 10px;
        }
        .bprog-root button:hover { background: #5a67d8; }
        .bprog-root .status-badge {
            display: inline-block;
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: bold;
        }
        .bprog-root .status-running { background: #f59e0b; }
        .bprog-root .status-finished { background: #10b981; }
        .bprog-root .status-error { background: #ef4444; }
      `}</style>
      
      <div className="bprog-root">
        <div className="container">
          <div className="header">
              <h1>📦 下载进度实时监控</h1>
              <div className="nav-links">
                  <Link to="/">➕ 新建任务</Link>
                  <Link to="/">🏠 单本下载</Link>
                  <Link to="/library">📖 小说库</Link>
                  <Link to="/batch_list">📋 任务列表</Link>
              </div>
          </div>

          {!task && !error ? <div style={{textAlign:'center', padding:40}}>加载中...</div> : error ? <div style={{color:'red', padding:40}}>{error}</div> : (
          <>
            <div className="dashboard">
                <div className="card">
                    <div className="card-title">📊 下载进度监控</div>
                    <div className="stats">
                        <div className="stat-item">
                            <div className="stat-value">{total}</div>
                            <div className="stat-label">总计(本)</div>
                        </div>
                        <div className="stat-item">
                            <div className="stat-value">{successCount}</div>
                            <div className="stat-label">已成功</div>
                        </div>
                        <div className="stat-item">
                            <div className="stat-value">{failCount}</div>
                            <div className="stat-label">失败</div>
                        </div>
                    </div>
                    <div className="progress-bar">
                        <div className="progress-fill" style={{ width: `${progressPercent}%` }}></div>
                    </div>
                    <div className="current-novel">
                        {task.status === 'running' ? `⏳ 执行中 (第 ${current}/${total} 本)` :
                         task.status === 'finished' ? '✅ 全部完成！' :
                         task.status === 'error' ? `❌ 任务出错：查看日志` : '等待开始...'}
                    </div>
                </div>

                <div className="card">
                    <div className="card-title">ℹ️ 任务信息</div>
                    <div><strong>小说名称：</strong> {task.novel_name || '解析中...'}</div>
                    {isAdmin ? (
                      <div style={{wordBreak:'break-all'}}><strong>起源链接：</strong> <a href={task.start_url} target="_blank" style={{color:'#667eea'}}>{task.start_url}</a></div>
                    ) : (
                      <div><strong>起源链接：</strong> <span style={{color: '#64748b'}}>云端受保护书源 (私密通道)</span></div>
                    )}
                    <div style={{marginTop:'15px'}}><strong>状态：</strong> 
                        <span className={`status-badge status-${task.status}`}>{task.status === 'running' ? '运行中' : task.status === 'finished' ? '已完成' : '出错'}</span>
                    </div>
                    <div style={{ marginTop: '20px' }}>
                        <button onClick={() => window.location.reload()}>🔄 刷新</button>
                        <button onClick={() => window.location.href='/batch_list'}>📋 返回列表</button>
                        {task.status === 'finished' && task.safe_name && (
                            <button style={{background:'#10b981'}} onClick={() => window.location.href=`/read/${encodeURIComponent(task.safe_name + '.txt')}`}>📖 开始阅读</button>
                        )}
                    </div>
                </div>
            </div>

            <div className="log-container">
                <div className="log-header">
                    <h3>📝 实时日志 (ID: {id})</h3>
                    <button className="clear-btn" onClick={clearLogDisplay}>清空显示</button>
                </div>
                <div className="log-content" ref={logContainerRef}>
                    {task.log.length === 0 ? <div className="log-entry">暂无日志或已清空</div> :
                     task.log.map((entry, idx) => {
                         let className = "log-entry";
                         if (entry.includes('✓') || entry.includes('完成') || entry.includes('完成')) className += ' success';
                         if (entry.includes('✗') || entry.includes('失败') || entry.includes('异常')) className += ' error';
                         if (entry.includes('---') || entry.includes('开始下载') || entry.includes('增量')) className += ' info';
                         return <div key={idx} className={className}>{entry}</div>;
                     })}
                </div>
            </div>
            
            <div style={{fontSize:12, color:'#888', marginTop:20, textAlign:'center'}}>页面每 2 秒自动获取一次最新状态...</div>
          </>
          )}
        </div>
      </div>
    </>
  );
}
