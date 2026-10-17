import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { TaskStatus } from '../types';
import { useAuth } from '../context/AuthContext';

export function BatchList() {
  const { isAdmin, authFetch } = useAuth();
  const [tasks, setTasks] = useState<(TaskStatus & { id: string })[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchTasks = async () => {
      try {
        const res = await authFetch('/api/tasks');
        if (res.ok) {
          setTasks(await res.json());
        }
      } catch (e) {}
    };
    fetchTasks();
    const timer = setInterval(fetchTasks, 3000);
    return () => clearInterval(timer);
  }, []);

  const handleDeleteSelected = async () => {
    if (!confirm(`确定要删除选中的 ${selectedIds.length} 个任务吗？`)) return;
    for (const id of selectedIds) {
      await fetch(`/api/tasks/${id}`, { method: 'DELETE' });
    }
    setTasks(tasks.filter(t => !selectedIds.includes(t.id)));
    setSelectedIds([]);
  };

  const handleUpdateSelected = async () => {
    const worksToUpdate = tasks
      .filter(t => selectedIds.includes(t.id) && t.start_url && !t.novel_name?.startsWith('[批量任务]'))
      .map(t => ({
        url: t.start_url,
        title: t.novel_name || '未命名'
      }));
      
    if (worksToUpdate.length === 0) {
      alert("选中的任务中没有有效的单本小说可用于追更（批量任务节点不支持直接追更，请选择单本记录）。");
      return;
    }
    
    if (!confirm(`确定要对选中的 ${worksToUpdate.length} 本小说进行连载追更（增量更新）吗？`)) return;
    
    try {
      const res = await fetch('/api/batch_start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ works: worksToUpdate, incremental: true })
      });
      const data = await res.json();
      if (data.task_id) {
        navigate(`/batch_logs/${data.task_id}`);
      } else {
        alert(data.error || '批量启动失败');
      }
    } catch (e: any) {
      alert('Error: ' + e.message);
    }
  };

  return (
    <>
      <style>{`
        .batch-root {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            background: #1a1a2e;
            min-height: 100vh;
            padding: 20px;
            color: #ddd;
        }
        .batch-root .container {
            max-width: 1200px;
            margin: 0 auto;
        }
        .batch-root .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            border-radius: 16px;
            padding: 20px 30px;
            margin-bottom: 20px;
            color: white;
        }
        .batch-root .header h1 { margin-bottom: 10px; }
        .batch-root .nav-links {
            display: flex;
            gap: 15px;
            margin-top: 15px;
        }
        .batch-root .nav-links a {
            color: white;
            text-decoration: none;
            padding: 6px 14px;
            background: rgba(255,255,255,0.2);
            border-radius: 20px;
            transition: all 0.3s;
        }
        .batch-root .nav-links a:hover { background: rgba(255,255,255,0.3); }
        .batch-root .card {
            background: #16213e;
            border-radius: 16px;
            overflow: hidden;
        }
        .batch-root .card-header {
            padding: 20px;
            background: #0f3460;
            border-bottom: 1px solid #2a3a5a;
        }
        .batch-root .card-header h2 { color: #eee; margin: 0; }
        .batch-root .task-table {
            width: 100%;
            border-collapse: collapse;
        }
        .batch-root .task-table th,
        .batch-root .task-table td {
            padding: 15px;
            text-align: left;
            border-bottom: 1px solid #2a3a5a;
            color: #ddd;
        }
        .batch-root .task-table th { background: #0f3460; color: #667eea; font-weight: 600; }
        .batch-root .task-table tr:hover { background: #1a2a4a; }
        .batch-root .status-badge {
            display: inline-block;
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: bold;
        }
        .batch-root .status-running { background: #f59e0b; color: white; }
        .batch-root .status-finished { background: #10b981; color: white; }
        .batch-root .status-error { background: #ef4444; color: white; }
        .batch-root .btn {
            display: inline-block;
            padding: 6px 14px;
            border-radius: 6px;
            text-decoration: none;
            font-size: 13px;
            transition: all 0.3s;
            cursor: pointer;
            border: none;
        }
        .batch-root .btn-view { background: #667eea; color: white; }
        .batch-root .btn-view:hover { background: #5a67d8; }
        .batch-root .empty-state {
            text-align: center;
            padding: 60px;
            color: #888;
        }
      `}</style>

      <div className="batch-root">
        <div className="container">
          <div className="header">
              <h1>📋 批量任务列表</h1>
              <p>查看所有批量下载任务的历史记录 (此处聚合所有任务)</p>
              <div className="nav-links">
                  <Link to="/">➕ 新建任务</Link>
                  <Link to="/">🏠 单本下载</Link>
                  <Link to="/library">📖 小说库</Link>
              </div>
          </div>

          <div className="card">
              <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                      <h2 style={{ margin: 0 }}>📦 历史任务</h2>
                      <select 
                          onChange={(e) => {
                              const val = e.target.value;
                              if (val === 'all') setSelectedIds(tasks.map(t => t.id));
                              else if (val === 'none') setSelectedIds([]);
                              else if (val) setSelectedIds(tasks.filter(t => t.status === val).map(t => t.id));
                              e.target.value = '';
                          }}
                          style={{
                              padding: '6px 10px',
                              borderRadius: '6px',
                              border: '1px solid #cbd5e1',
                              fontSize: '0.9rem',
                              outline: 'none',
                              background: 'white'
                          }}
                      >
                          <option value="">快速选择...</option>
                          <option value="all">全选所有</option>
                          <option value="none">取消选择</option>
                          <option value="error">全选出错 (Error)</option>
                          <option value="finished">全选完成 (Finished)</option>
                          <option value="running">全选运行中 (Running)</option>
                      </select>
                  </div>
                  {selectedIds.length > 0 && (
                    <div style={{ display: 'flex', gap: '10px' }}>
                      <button className="btn" style={{ background: '#10b981', color: 'white', padding: '6px 12px', fontSize: '0.9rem' }} onClick={handleUpdateSelected}>
                        🔄 追更选中 ({selectedIds.length})
                      </button>
                      <button className="btn" style={{ background: '#ef4444', color: 'white', padding: '6px 12px', fontSize: '0.9rem' }} onClick={handleDeleteSelected}>
                        🗑️ 删除选中 ({selectedIds.length})
                      </button>
                    </div>
                  )}
              </div>
              {tasks.length > 0 ? (
                <table className="task-table">
                    <thead>
                        <tr>
                            <th style={{ width: '40px' }}>
                                <input 
                                  type="checkbox" 
                                  checked={tasks.length > 0 && selectedIds.length === tasks.length}
                                  onChange={e => setSelectedIds(e.target.checked ? tasks.map(t => t.id) : [])}
                                />
                            </th>
                            <th>任务ID / 名称</th>
                            <th>状态</th>
                            <th>操作</th>
                        </tr>
                    </thead>
                    <tbody>
                        {tasks.map(task => (
                          <tr key={task.id}>
                              <td>
                                  <input
                                    type="checkbox"
                                    checked={selectedIds.includes(task.id)}
                                    onChange={e => {
                                      if (e.target.checked) setSelectedIds([...selectedIds, task.id]);
                                      else setSelectedIds(selectedIds.filter(id => id !== task.id));
                                    }}
                                  />
                              </td>
                              <td>{task.novel_name || (isAdmin ? task.start_url : '云端书源任务')} <br/><small style={{color: '#888'}}>{task.id}</small></td>
                              <td>
                                  {task.status === 'running' ? <span className="status-badge status-running">运行中</span> :
                                   task.status === 'finished' ? <span className="status-badge status-finished">已完成</span> :
                                   task.status === 'error' ? <span className="status-badge status-error">出错</span> :
                                   <span className="status-badge">未知</span>
                                  }
                              </td>
                              <td>
                                  <Link to={`/batch_logs/${task.id}`} className="btn btn-view">实时进度台</Link>
                                  <span style={{width:10, display:'inline-block'}}></span>
                                  <Link to={`/logs/${task.id}`} className="btn btn-view" style={{background:'#0e7c7e'}}>原始日志</Link>
                              </td>
                          </tr>
                        ))}
                    </tbody>
                </table>
              ) : (
                <div className="empty-state">
                    <p>暂无任务</p>
                    <Link to="/" className="btn btn-view" style={{ marginTop: '15px' }}>创建第一个任务</Link>
                </div>
              )}
          </div>
        </div>
      </div>
    </>
  );
}
