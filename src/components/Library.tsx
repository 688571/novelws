import React, { useEffect, useState, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { NovelMeta } from '../types';
import { BookOpen, Star, Trash2, Edit3, Plus, RefreshCw, Upload, User, Globe, Search, ArrowRight, ShieldCheck } from 'lucide-react';

export function Library() {
  const { user, isMySQL, authFetch, openAuthModal } = useAuth();
  const [novels, setNovels] = useState<NovelMeta[]>([]);
  const [exploreNovels, setExploreNovels] = useState<NovelMeta[]>([]);
  const [activeTab, setActiveTab] = useState<'all' | 'favorites' | 'explore'>('all');
  const [loading, setLoading] = useState(true);
  const [searchFilter, setSearchFilter] = useState('');
  
  // Upload state
  const [uploadMessage, setUploadMessage] = useState('');
  const [uploadName, setUploadName] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const fetchNovels = async () => {
    setLoading(true);
    try {
      const res = await authFetch('/api/library');
      const data = await res.json();
      setNovels(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Fetch library error:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchExploreNovels = async () => {
    try {
      const res = await authFetch('/api/library/explore');
      const data = await res.json();
      setExploreNovels(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Fetch explore error:', error);
    }
  };

  useEffect(() => {
    fetchNovels();
    fetchExploreNovels();
  }, [user?.id]);

  const handleToggleFavorite = async (novel: NovelMeta) => {
    try {
      const res = await authFetch('/api/library/favorite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: novel.filename })
      });
      const data = await res.json();
      if (data.success) {
        setNovels(prev =>
          prev.map(n => n.filename === novel.filename ? { ...n, is_favorite: data.is_favorite } : n)
        );
      }
    } catch (e: any) {
      alert('收藏操作失败: ' + e.message);
    }
  };

  const handleAssociateFromExplore = async (novel: NovelMeta) => {
    try {
      const res = await authFetch('/api/library/associate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: novel.filename, custom_name: novel.name })
      });
      const data = await res.json();
      if (data.success) {
        alert(`已成功将《${novel.name}》关联添加到您的书架！`);
        fetchNovels();
        fetchExploreNovels();
      } else {
        alert(data.error || '关联失败');
      }
    } catch (e: any) {
      alert('关联失败: ' + e.message);
    }
  };

  const handleRename = async (filename: string, oldName: string) => {
    const newName = prompt('请输入新的小说名称', oldName);
    if (!newName || newName.trim() === '' || newName === oldName) return;
    try {
      const res = await authFetch('/api/library/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename, new_name: newName.trim() })
      });
      const data = await res.json();
      if (data.success) {
        fetchNovels();
        fetchExploreNovels();
      } else {
        alert(data.error);
      }
    } catch (e: any) {
      alert(e.message);
    }
  };

  const handleDelete = async (filename: string, name: string) => {
    const isAdmin = user?.role === 'admin' || user?.username === 'admin';
    let deletePhysical = false;
    
    if (isAdmin) {
      const choice = confirm(`【管理员操作】\n您正在删除小说《${name}》：\n- 点击【确定】将彻底从服务器物理删除该小说及所有用户的关联。\n- 点击【取消】仅从您当前的个人书架移出。`);
      if (choice) {
        deletePhysical = true;
      } else {
        // 用户点了取消，询问是否仅移出个人书架
        if (!confirm(`确定要从个人书架移出《${name}》吗？`)) return;
      }
    } else {
      if (!confirm(`确定要将小说《${name}》从您的个人书架移出吗？`)) return;
    }

    try {
      const res = await authFetch('/api/library/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename, deletePhysical })
      });
      const data = await res.json();
      if (data.success) {
        fetchNovels();
        fetchExploreNovels();
      } else {
        alert(data.error);
      }
    } catch (e: any) {
      alert(e.message);
    }
  };

  const handleAiOptimize = async (novel: NovelMeta) => {
    if (!confirm(`确定要使用 AI 模型对《${novel.name}》进行深度优化吗？\n这将自动去除所有广告词、网址链接，并重新整理章节与排版。`)) return;
    
    // 优先读取用户在 AI 助手页面自己配置的 API Key 与 URL
    const customApiKey = localStorage.getItem('custom_ai_apikey') || '';
    const customApiUrl = localStorage.getItem('custom_ai_url') || '';
    const customModel = localStorage.getItem('custom_ai_model') || '';

    try {
      const res = await authFetch('/api/library/ai-optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          filename: novel.filename,
          customApiKey,
          customApiUrl,
          customModel
        })
      });
      const data = await res.json();
      if (data.success) {
        alert(data.message || 'AI 优化成功！');
        fetchNovels();
      } else {
        if (data.needsDonation) {
          const donateChoice = confirm(`${data.error}\n\n是否立即进行打赏以解锁服务器共享大模型？\n(点击【确定】模拟完成打赏并开放权限)`);
          if (donateChoice) {
            // 模拟打赏成功请求
            const donateRes = await authFetch('/api/user/donate', { method: 'POST' });
            const donateData = await donateRes.json();
            if (donateData.success) {
              alert('🎉 打赏成功！服务器共享大模型权限已为您永久开启，请重新点击【AI 优化】按钮。');
            } else {
              alert('打赏记录保存失败');
            }
          }
        } else {
          alert(data.error || 'AI 优化失败');
        }
      }
    } catch (e: any) {
      alert('AI 优化请求出错: ' + e.message);
    }
  };

  const handleUpdate = async (novel: NovelMeta) => {
    if (!novel.start_url) {
      alert('未找到该小说的原始来源地址，无法追更。');
      return;
    }
    if (!confirm(`确定要查询并追更《${novel.name}》的后续章节吗？`)) return;
    try {
      const res = await authFetch('/api/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          url: novel.start_url, 
          novel_name: novel.name, 
          incremental: true 
        })
      });
      const data = await res.json();
      if (data.task_id) {
        navigate(`/logs/${data.task_id}`);
      } else {
        alert(data.error || '追更启动失败');
      }
    } catch (e: any) {
      alert('Error: ' + e.message);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      setSelectedFile(null);
      setUploadMessage('');
      return;
    }
    if (!file.name.toLowerCase().endsWith('.txt')) {
      setUploadMessage('❌ 只支持 .txt 文件');
      setSelectedFile(null);
      return;
    }
    if (file.size > 3 * 1024 * 1024) {
      setUploadMessage('❌ 文件超过 3MB，无法上传');
      setSelectedFile(null);
      return;
    }
    setSelectedFile(file);
    setUploadMessage('');
  };

  const handleUpload = async () => {
    if (!selectedFile) return;
    const formData = new FormData();
    formData.append('file', selectedFile);
    if (uploadName.trim()) {
      formData.append('novel_name', uploadName.trim());
    }
    
    setIsUploading(true);
    setUploadMessage('正在解析并存入书库...');
    
    try {
      const res = await authFetch('/api/upload', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (data.success) {
        setUploadMessage(`✅ 上传成功！《${data.name}》已加入您的书架。`);
        setSelectedFile(null);
        setUploadName('');
        if (fileInputRef.current) fileInputRef.current.value = '';
        fetchNovels();
        fetchExploreNovels();
      } else {
        setUploadMessage(`❌ 上传失败：${data.error}`);
      }
    } catch (err: any) {
      setUploadMessage(`❌ 上传失败：${err.message}`);
    } finally {
      setIsUploading(false);
    }
  };

  const [sortBy, setSortBy] = useState<'name' | 'mtime' | 'size'>('mtime');
  const [layoutMode, setLayoutMode] = useState<'grid' | 'row' | 'compact'>('row');

  // Filtered and sorted displayed novels
  const displayedNovels = (activeTab === 'favorites' ? novels.filter(n => n.is_favorite) : novels)
    .filter(n => {
      if (!searchFilter.trim()) return true;
      return n.name.toLowerCase().includes(searchFilter.trim().toLowerCase());
    })
    .sort((a, b) => {
      if (sortBy === 'name') {
        return a.name.localeCompare(b.name, 'zh-CN');
      }
      if (sortBy === 'size') {
        // parse size string like "1.24 MB" or "500 KB"
        const parseSize = (s: string) => {
          if (!s) return 0;
          const num = parseFloat(s) || 0;
          if (s.includes('MB')) return num * 1024 * 1024;
          if (s.includes('KB')) return num * 1024;
          if (s.includes('GB')) return num * 1024 * 1024 * 1024;
          return num;
        };
        return parseSize(b.size) - parseSize(a.size);
      }
      // default 'mtime'
      return new Date(b.mtime || 0).getTime() - new Date(a.mtime || 0).getTime();
    });

  const displayedExploreNovels = exploreNovels
    .filter(n => {
      if (!searchFilter.trim()) return true;
      return n.name.toLowerCase().includes(searchFilter.trim().toLowerCase());
    })
    .sort((a, b) => {
      if (sortBy === 'name') {
        return a.name.localeCompare(b.name, 'zh-CN');
      }
      if (sortBy === 'size') {
        const parseSize = (s: string) => {
          if (!s) return 0;
          const num = parseFloat(s) || 0;
          if (s.includes('MB')) return num * 1024 * 1024;
          if (s.includes('KB')) return num * 1024;
          return num;
        };
        return parseSize(b.size) - parseSize(a.size);
      }
      return new Date(b.mtime || 0).getTime() - new Date(a.mtime || 0).getTime();
    });

  return (
    <>
      <style>{`
        .library-root {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
            background: var(--theme-bg);
            min-height: 100vh;
            padding: 24px 16px;
            color: var(--theme-text-main);
            transition: background 0.25s ease, color 0.25s ease;
        }

        .library-root .container {
            max-width: 1040px;
            margin: 0 auto;
            background: var(--theme-card);
            border-radius: 24px;
            box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.05);
            border: 1px solid var(--theme-border);
            padding: 28px 32px;
            transition: background 0.25s ease, border-color 0.25s ease;
        }

        .library-root .header-row {
            display: flex;
            flex-wrap: wrap;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 24px;
            gap: 16px;
            border-bottom: 1px solid var(--theme-border);
            padding-bottom: 20px;
        }

        .library-root h1 {
            color: var(--theme-text-main);
            margin: 0;
            font-size: 1.6rem;
            font-weight: 800;
            display: flex;
            align-items: center;
            gap: 10px;
        }

        .library-root .user-badge-bar {
            display: flex;
            align-items: center;
            gap: 12px;
            background: var(--theme-card-sub);
            padding: 6px 14px;
            border-radius: 99px;
            font-size: 0.85rem;
            color: var(--theme-text-main);
            border: 1px solid var(--theme-border);
        }

        .library-root .upload-card {
            background: var(--theme-card-sub);
            border-radius: 18px;
            padding: 18px 22px;
            margin: 20px 0;
            border: 1px solid var(--theme-border);
        }

        .library-root .upload-title {
            font-size: 0.95rem;
            font-weight: 700;
            color: var(--theme-text-main);
            margin-bottom: 12px;
        }

        .library-root .upload-form {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: 12px;
        }

        .library-root .upload-input {
            flex: 2;
            min-width: 180px;
            padding: 9px 14px;
            border: 1px solid var(--theme-border);
            border-radius: 12px;
            font-size: 0.9rem;
            outline: none;
            background: var(--theme-input-bg);
            color: var(--theme-text-main);
        }

        .library-root .btn-select {
            background: var(--theme-card);
            color: var(--theme-text-main);
            border: 1px solid var(--theme-border);
            padding: 9px 16px;
            border-radius: 12px;
            cursor: pointer;
            font-size: 0.85rem;
            font-weight: 600;
            transition: all 0.15s;
        }

        .library-root .btn-select:hover {
            opacity: 0.9;
        }

        .library-root .btn-upload {
            background: var(--theme-primary-gradient);
            color: white;
            border: none;
            padding: 9px 20px;
            border-radius: 12px;
            cursor: pointer;
            font-size: 0.85rem;
            font-weight: 700;
            transition: all 0.15s;
        }

        .library-root .btn-upload:hover:not(:disabled) {
            opacity: 0.92;
        }

        .library-root .btn-upload:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        .library-root .novel-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
            gap: 16px;
            margin-top: 20px;
        }

        .library-root .novel-grid.layout-row {
            grid-template-columns: 1fr;
            gap: 12px;
        }
        .library-root .novel-grid.layout-row .novel-card {
            flex-direction: row;
            align-items: center;
            justify-content: space-between;
            padding: 14px 20px;
        }
        .library-root .novel-grid.layout-row .card-actions {
            border-top: none;
            margin-top: 0;
            padding-top: 0;
            width: auto;
        }

        .library-root .novel-grid.layout-compact {
            grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
            gap: 10px;
        }
        .library-root .novel-grid.layout-compact .novel-card {
            padding: 12px 16px;
        }

        .library-root .novel-card {
            background: var(--theme-card);
            border: 1px solid var(--theme-border);
            border-radius: 18px;
            padding: 18px 20px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.04);
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            transition: all 0.2s;
        }

        .library-root .novel-card:hover {
            transform: translateY(-2px);
            box-shadow: 0 10px 15px -3px rgba(0,0,0,0.06);
            border-color: var(--theme-primary);
        }

        .library-root .card-actions {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
            margin-top: 16px;
            border-top: 1px solid var(--theme-border);
            padding-top: 12px;
            max-width: 100%;
        }

        .library-root .action-btn {
            flex: 0 0 auto;
            padding: 6px 12px;
            border-radius: 10px;
            font-size: 0.8rem;
            font-weight: 600;
            border: none;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 4px;
            text-decoration: none;
            transition: all 0.15s;
            white-space: nowrap;
        }

        .library-root .btn-ai {
            background: #ede9fe;
            color: #6d28d9;
            border: 1px solid #ddd6fe;
        }
        .library-root .btn-ai:hover {
            background: #ddd6fe;
        }

        .library-root .btn-read {
            background: var(--theme-primary-light);
            color: var(--theme-primary-text);
        }
        .library-root .btn-read:hover {
            opacity: 0.85;
        }

        .library-root .btn-fav {
            background: #fef3c7;
            color: #92400e;
        }
        .library-root .btn-fav:hover {
            background: #fde68a;
        }

        .library-root .btn-edit {
            background: var(--theme-card-sub);
            color: var(--theme-text-muted);
            border: 1px solid var(--theme-border);
        }
        .library-root .btn-edit:hover {
            opacity: 0.85;
        }

        .library-root .btn-del {
            background: #fee2e2;
            color: #b91c1c;
        }
        .library-root .btn-del:hover {
            background: #fecaca;
        }
      `}</style>

      <div className="library-root">
        <div className="container">
          {!user ? (
            <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--theme-text-muted)' }}>
              <div style={{ fontSize: '3rem', marginBottom: '16px' }}>🔒</div>
              <h2 style={{ margin: '0 0 10px 0', fontSize: '1.4rem', fontWeight: 800, color: 'var(--theme-text-main)' }}>
                未登录用户无法查看我的书架
              </h2>
              <p style={{ margin: '0 0 20px 0', fontSize: '0.95rem' }}>
                请先登录或注册账号，即可畅享个人专属书架、云端同步与收藏功能。
              </p>
              <button
                onClick={openAuthModal}
                style={{
                  background: 'var(--theme-primary-gradient)',
                  color: '#fff',
                  border: 'none',
                  padding: '10px 24px',
                  borderRadius: '12px',
                  fontWeight: 700,
                  fontSize: '0.95rem',
                  cursor: 'pointer'
                }}
              >
                立即登录 / 注册
              </button>
            </div>
          ) : (
            <>
          {/* Header */}
          <div className="header-row">
            <div>
              <h1>
                <BookOpen className="w-7 h-7 text-indigo-600" />
                我的书架
              </h1>
              <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: '#64748b' }}>
                当前书架关联的小说 ({user?.nickname || user?.username}) · 共享同一个小说库文件夹
              </p>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <button
                onClick={openAuthModal}
                className="user-badge-bar"
                style={{ border: 'none', cursor: 'pointer' }}
                title="切换登录账号"
              >
                <User className="w-4 h-4 text-indigo-600" />
                <span>用户: <strong>{user?.nickname || user?.username}</strong></span>
                <span style={{ fontSize: '0.75rem', color: '#6366f1', textDecoration: 'underline' }}>切换</span>
              </button>
              <Link
                to="/"
                style={{
                  background: 'linear-gradient(135deg, #4f46e5 0%, #6366f1 100%)',
                  color: 'white',
                  padding: '8px 18px',
                  borderRadius: '99px',
                  fontSize: '0.85rem',
                  fontWeight: 700,
                  textDecoration: 'none'
                }}
              >
                🔍 检索新书
              </Link>
            </div>
          </div>

          {/* Tab Navigation: All Books vs Favorites vs Shared Explore */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '16px' }}>
            <div style={{ display: 'flex', gap: '8px', background: '#f1f5f9', padding: '4px', borderRadius: '14px' }}>
              <button
                onClick={() => setActiveTab('all')}
                style={{
                  padding: '8px 18px',
                  borderRadius: '10px',
                  border: 'none',
                  background: activeTab === 'all' ? '#ffffff' : 'transparent',
                  color: activeTab === 'all' ? '#4338ca' : '#64748b',
                  fontWeight: activeTab === 'all' ? 700 : 500,
                  fontSize: '0.9rem',
                  cursor: 'pointer',
                  boxShadow: activeTab === 'all' ? '0 1px 3px rgba(0,0,0,0.06)' : 'none'
                }}
              >
                全部书架 ({novels.length})
              </button>
              <button
                onClick={() => setActiveTab('favorites')}
                style={{
                  padding: '8px 18px',
                  borderRadius: '10px',
                  border: 'none',
                  background: activeTab === 'favorites' ? '#ffffff' : 'transparent',
                  color: activeTab === 'favorites' ? '#b45309' : '#64748b',
                  fontWeight: activeTab === 'favorites' ? 700 : 500,
                  fontSize: '0.9rem',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  boxShadow: activeTab === 'favorites' ? '0 1px 3px rgba(0,0,0,0.06)' : 'none'
                }}
              >
                <Star className="w-4 h-4 fill-amber-400 text-amber-500" />
                我的收藏 ({novels.filter(n => n.is_favorite).length})
              </button>
              <button
                onClick={() => setActiveTab('explore')}
                style={{
                  padding: '8px 18px',
                  borderRadius: '10px',
                  border: 'none',
                  background: activeTab === 'explore' ? '#ffffff' : 'transparent',
                  color: activeTab === 'explore' ? '#0369a1' : '#64748b',
                  fontWeight: activeTab === 'explore' ? 700 : 500,
                  fontSize: '0.9rem',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  boxShadow: activeTab === 'explore' ? '0 1px 3px rgba(0,0,0,0.06)' : 'none'
                }}
              >
                <Globe className="w-4 h-4 text-sky-600" />
                共享书库探索 ({exploreNovels.length})
              </button>
            </div>

            {/* Keyword Search Filter */}
            <div style={{ position: 'relative', minWidth: '220px' }}>
              <input
                type="text"
                placeholder="在当前列表中快速筛选..."
                value={searchFilter}
                onChange={e => setSearchFilter(e.target.value)}
                style={{
                  padding: '8px 14px 8px 32px',
                  border: '1px solid #cbd5e1',
                  borderRadius: '99px',
                  fontSize: '0.85rem',
                  outline: 'none',
                  width: '100%',
                  boxSizing: 'border-box'
                }}
              />
              <Search className="w-4 h-4 text-slate-400" style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)' }} />
            </div>
          </div>

          {/* Sorting & Layout Control Bar */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '16px', background: 'var(--theme-card-sub)', padding: '10px 16px', borderRadius: '14px', border: '1px solid var(--theme-border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem', color: 'var(--theme-text-muted)' }}>
              <span>排序方式:</span>
              <select
                value={sortBy}
                onChange={e => setSortBy(e.target.value as any)}
                style={{
                  padding: '6px 12px',
                  borderRadius: '8px',
                  border: '1px solid var(--theme-border)',
                  background: 'var(--theme-card)',
                  color: 'var(--theme-text-main)',
                  fontSize: '0.85rem',
                  outline: 'none',
                  cursor: 'pointer'
                }}
              >
                <option value="mtime">🕒 最近更新/导入时间</option>
                <option value="name">🔤 书名字母/拼音排序</option>
                <option value="size">📦 文件体积大小</option>
              </select>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem', color: 'var(--theme-text-muted)' }}>
              <span>排布样式:</span>
              <div style={{ display: 'flex', gap: '4px', background: 'var(--theme-card)', padding: '3px', borderRadius: '10px', border: '1px solid var(--theme-border)' }}>
                <button
                  onClick={() => setLayoutMode('grid')}
                  style={{
                    padding: '4px 10px',
                    borderRadius: '8px',
                    border: 'none',
                    background: layoutMode === 'grid' ? 'var(--theme-primary)' : 'transparent',
                    color: layoutMode === 'grid' ? '#ffffff' : 'var(--theme-text-muted)',
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                  title="标准网格卡片"
                >
                  🔲 网格排布
                </button>
                <button
                  onClick={() => setLayoutMode('row')}
                  style={{
                    padding: '4px 10px',
                    borderRadius: '8px',
                    border: 'none',
                    background: layoutMode === 'row' ? 'var(--theme-primary)' : 'transparent',
                    color: layoutMode === 'row' ? '#ffffff' : 'var(--theme-text-muted)',
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                  title="每行一条分行排布"
                >
                  📃 分行排布
                </button>
                <button
                  onClick={() => setLayoutMode('compact')}
                  style={{
                    padding: '4px 10px',
                    borderRadius: '8px',
                    border: 'none',
                    background: layoutMode === 'compact' ? 'var(--theme-primary)' : 'transparent',
                    color: layoutMode === 'compact' ? '#ffffff' : 'var(--theme-text-muted)',
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                  title="紧凑精简排布"
                >
                  📑 紧凑排布
                </button>
              </div>
            </div>
          </div>

          {/* Upload Box (Only visible in 'all' tab) */}
          {activeTab === 'all' && (
            <div className="upload-card">
              <div className="upload-title">📤 本地 TXT 小说上传（≤3MB，自动关联至当前账号）</div>
              <div className="upload-form">
                <input 
                  type="text" 
                  className="upload-input" 
                  placeholder="自定义书名（可选）"
                  value={uploadName}
                  onChange={e => setUploadName(e.target.value)}
                />
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <input 
                    type="file" 
                    accept=".txt" 
                    style={{ display: 'none' }} 
                    ref={fileInputRef}
                    onChange={handleFileChange}
                  />
                  <button className="btn-select" onClick={() => fileInputRef.current?.click()}>
                    📁 选择文件
                  </button>
                  <span style={{ fontSize: '0.85rem', color: '#64748b', maxWidth: '160px', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                    {selectedFile ? selectedFile.name : '未选择'}
                  </span>
                </div>
                <button 
                  className="btn-upload" 
                  disabled={!selectedFile || isUploading}
                  onClick={handleUpload}
                >
                  {isUploading ? '处理中...' : '上传并加入书架'}
                </button>
              </div>
              {uploadMessage && (
                <div style={{ marginTop: '8px', fontSize: '0.85rem', color: uploadMessage.includes('✅') ? '#16a34a' : '#dc2626' }}>
                  {uploadMessage}
                </div>
              )}
            </div>
          )}

          {/* Main List: My Bookshelf vs Explore */}
          {activeTab === 'explore' ? (
            /* Explore Shared Folder View */
            <div>
              <div style={{ background: '#f0f9ff', padding: '12px 16px', borderRadius: '12px', border: '1px solid #e0f2fe', color: '#0369a1', fontSize: '0.85rem', marginBottom: '16px' }}>
                💡 <strong>共享书库说明：</strong> 此处汇集了服务器小说公共文件夹中现有的全部小说。您可以一键将其关联到您当前的个人书架，免去重复下载！
              </div>

              {loading ? (
                <div style={{ textAlign: 'center', padding: '40px 0', color: '#94a3b8' }}>正在加载共享书库...</div>
              ) : displayedExploreNovels.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px 0', color: '#94a3b8' }}>暂无共享小说。</div>
              ) : (
                <div className={`novel-grid layout-${layoutMode}`}>
                  {displayedExploreNovels.map(novel => (
                    <div className="novel-card" key={novel.filename}>
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <h3 style={{ margin: '0 0 6px 0', fontSize: '1.1rem', fontWeight: 800, color: 'var(--theme-text-main)' }}>
                            {novel.name}
                          </h3>
                          {novel.associated ? (
                            <span style={{ background: '#dcfce7', color: '#15803d', fontSize: '0.75rem', fontWeight: 700, padding: '2px 8px', borderRadius: '6px' }}>
                              已在书架
                            </span>
                          ) : (
                            <span style={{ background: 'var(--theme-card-sub)', color: 'var(--theme-text-muted)', fontSize: '0.75rem', fontWeight: 600, padding: '2px 8px', borderRadius: '6px' }}>
                              未关联
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--theme-text-muted)', display: 'flex', gap: '10px', marginTop: '4px' }}>
                          <span>📁 {novel.size}</span>
                          <span>🕒 {novel.mtime.slice(0, 10)}</span>
                        </div>
                      </div>

                      <div className="card-actions">
                        <Link to={`/read/${encodeURIComponent(novel.filename)}`} className="action-btn btn-read">
                          📖 试读
                        </Link>
                        {!novel.associated ? (
                          <button
                            className="action-btn"
                            style={{ background: 'var(--theme-primary)', color: '#ffffff' }}
                            onClick={() => handleAssociateFromExplore(novel)}
                          >
                            <Plus className="w-3.5 h-3.5" /> 加入我的书架
                          </button>
                        ) : (
                          <button
                            className="action-btn btn-del"
                            onClick={() => handleDelete(novel.filename, novel.name)}
                          >
                            <Trash2 className="w-3.5 h-3.5" /> 移出书架
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            /* My Bookshelf View */
            <div>
              {loading ? (
                <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--theme-text-muted)' }}>正在读取书架...</div>
              ) : displayedNovels.length > 0 ? (
                <div className={`novel-grid layout-${layoutMode}`}>
                  {displayedNovels.map(novel => (
                    <div className="novel-card" key={novel.filename}>
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                          <h3 style={{ margin: '0 0 6px 0', fontSize: '1.15rem', fontWeight: 800, color: 'var(--theme-text-main)' }}>
                            {novel.name}
                          </h3>
                          <button
                            onClick={() => handleToggleFavorite(novel)}
                            style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px' }}
                            title={novel.is_favorite ? '取消收藏' : '加入收藏'}
                          >
                            <Star className={`w-5 h-5 ${novel.is_favorite ? 'fill-amber-400 text-amber-500' : 'text-slate-300 hover:text-amber-400'}`} />
                          </button>
                        </div>
                        <div style={{ fontSize: '0.8rem', color: '#64748b', display: 'flex', gap: '12px', marginTop: '6px' }}>
                          <span>📁 {novel.size}</span>
                          <span>🕒 {novel.mtime.slice(0, 10)}</span>
                          {novel.is_favorite && (
                            <span style={{ color: '#d97706', fontWeight: 700 }}>★ 收藏</span>
                          )}
                        </div>
                      </div>

                      <div className="card-actions">
                        <Link to={`/read/${encodeURIComponent(novel.filename)}`} className="action-btn btn-read">
                          📖 阅读
                        </Link>
                        <button className="action-btn btn-ai" onClick={() => handleAiOptimize(novel)} title="使用大模型去除广告、网址并优化章节排版">
                          ✨ AI 优化
                        </button>
                        {novel.start_url && (
                          <button className="action-btn btn-fav" onClick={() => handleUpdate(novel)} title="增量追更后续章节">
                            <RefreshCw className="w-3.5 h-3.5" /> 追更
                          </button>
                        )}
                        <button className="action-btn btn-edit" onClick={() => handleRename(novel.filename, novel.name)}>
                          <Edit3 className="w-3.5 h-3.5" /> 改名
                        </button>
                        <button className="action-btn btn-del" onClick={() => handleDelete(novel.filename, novel.name)} title="从个人书架移出">
                          <Trash2 className="w-3.5 h-3.5" /> 移出
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ textAlign: 'center', padding: '60px 20px', color: '#64748b' }}>
                  <div style={{ fontSize: '2.5rem', marginBottom: '12px' }}>📚</div>
                  <h3 style={{ margin: '0 0 8px 0', color: '#1e293b', fontSize: '1.2rem', fontWeight: 700 }}>
                    {activeTab === 'favorites' ? '暂无收藏的小说' : '您的个人书架还是空的'}
                  </h3>
                  <p style={{ margin: 0, fontSize: '0.9rem', color: '#94a3b8' }}>
                    您可以前往 <Link to="/" style={{ color: '#4f46e5', fontWeight: 700 }}>搜索抓取新书</Link> 或在上方切换到 <button onClick={() => setActiveTab('explore')} style={{ background: 'none', border: 'none', color: '#4f46e5', fontWeight: 700, cursor: 'pointer', textDecoration: 'underline' }}>共享书库探索</button> 关联已有小说。
                  </p>
                </div>
              )}
            </div>
          )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
