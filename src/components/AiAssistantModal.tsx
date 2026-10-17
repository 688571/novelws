import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { Bot, Key, Globe, Sparkles, Send, Settings, Save, Check } from 'lucide-react';

export function AiAssistantModal() {
  const { authFetch } = useAuth();
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('custom_ai_apikey') || '');
  const [apiUrl, setApiUrl] = useState(() => localStorage.getItem('custom_ai_url') || 'https://api.openai.com/v1');
  const [model, setModel] = useState(() => localStorage.getItem('custom_ai_model') || 'gpt-4o-mini');
  const [systemPrompt, setSystemPrompt] = useState('你是一个博学的小说AI助手，可以帮用户解答剧情疑问、提炼情节或润色文字。');
  const [prompt, setPrompt] = useState('');
  const [reply, setReply] = useState('');
  const [loading, setLoading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');

  const [autoOptimize, setAutoOptimize] = useState(() => localStorage.getItem('auto_optimize_on_download') === 'true');

  const handleSaveSettings = () => {
    localStorage.setItem('custom_ai_apikey', apiKey.trim());
    localStorage.setItem('custom_ai_url', apiUrl.trim());
    localStorage.setItem('custom_ai_model', model.trim());
    localStorage.setItem('auto_optimize_on_download', String(autoOptimize));
    setSavedMsg('✅ 配置已保存');
    setTimeout(() => setSavedMsg(''), 2000);
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) return;
    if (!apiKey.trim()) {
      alert('请先在设置中配置您的 API Key');
      setShowSettings(true);
      return;
    }
    if (!apiUrl.trim()) {
      alert('请填写大模型 API URL');
      setShowSettings(true);
      return;
    }

    setLoading(true);
    setReply('');
    try {
      const res = await authFetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: apiKey.trim(),
          apiUrl: apiUrl.trim(),
          model: model.trim(),
          prompt: prompt.trim(),
          systemPrompt: systemPrompt.trim()
        })
      });
      const data = await res.json();
      if (data.success) {
        setReply(data.reply);
      } else {
        alert(data.error || 'AI 请求失败');
      }
    } catch (e: any) {
      alert('请求出错: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <style>{`
        .ai-modal-root {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background: var(--theme-bg);
            min-height: 100vh;
            padding: 24px 16px;
            color: var(--theme-text-main);
        }
        .ai-card {
            max-width: 800px;
            margin: 0 auto;
            background: var(--theme-card);
            border-radius: 20px;
            border: 1px solid var(--theme-border);
            box-shadow: 0 10px 25px -5px rgba(0,0,0,0.05);
            padding: 28px;
        }
      `}</style>
      <div className="ai-modal-root">
        <div className="ai-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', borderBottom: '1px solid var(--theme-border)', paddingBottom: '16px' }}>
            <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Bot className="w-7 h-7 text-indigo-600" />
              自定义 AI 小说助手
            </h1>
            <button
              onClick={() => setShowSettings(!showSettings)}
              style={{
                background: showSettings ? 'var(--theme-primary)' : 'var(--theme-card-sub)',
                color: showSettings ? '#fff' : 'var(--theme-text-main)',
                border: '1px solid var(--theme-border)',
                padding: '8px 16px',
                borderRadius: '12px',
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: '0.85rem',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              <Settings className="w-4 h-4" />
              {showSettings ? '隐藏配置' : '大模型 API 配置'}
            </button>
          </div>

          {showSettings && (
            <div style={{ background: 'var(--theme-card-sub)', padding: '18px 20px', borderRadius: '16px', border: '1px solid var(--theme-border)', marginBottom: '20px' }}>
              <h3 style={{ margin: '0 0 12px 0', fontSize: '1rem', fontWeight: 700 }}>⚙️ 自定义大模型参数</h3>
              <div style={{ display: 'grid', gap: '12px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '4px' }}>API URL (支持 OpenAI 兼容格式、DeepSeek、Kimi、Ollama 等)</label>
                  <input
                    type="text"
                    value={apiUrl}
                    onChange={e => setApiUrl(e.target.value)}
                    placeholder="https://api.openai.com/v1"
                    style={{ width: '100%', padding: '9px 12px', borderRadius: '10px', border: '1px solid var(--theme-border)', background: 'var(--theme-input-bg)', color: 'var(--theme-text-main)', fontSize: '0.9rem', boxSizing: 'border-box' }}
                  />
                </div>
                <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                  <div style={{ flex: 2, minWidth: '220px' }}>
                    <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '4px' }}>API Key</label>
                    <input
                      type="password"
                      value={apiKey}
                      onChange={e => setApiKey(e.target.value)}
                      placeholder="sk-..."
                      style={{ width: '100%', padding: '9px 12px', borderRadius: '10px', border: '1px solid var(--theme-border)', background: 'var(--theme-input-bg)', color: 'var(--theme-text-main)', fontSize: '0.9rem', boxSizing: 'border-box' }}
                    />
                  </div>
                  <div style={{ flex: 1, minWidth: '150px' }}>
                    <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '4px' }}>Model 名称</label>
                    <input
                      type="text"
                      value={model}
                      onChange={e => setModel(e.target.value)}
                      placeholder="gpt-4o-mini"
                      style={{ width: '100%', padding: '9px 12px', borderRadius: '10px', border: '1px solid var(--theme-border)', background: 'var(--theme-input-bg)', color: 'var(--theme-text-main)', fontSize: '0.9rem', boxSizing: 'border-box' }}
                    />
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '6px', background: 'var(--theme-card)', padding: '10px 14px', borderRadius: '10px', border: '1px solid var(--theme-border)' }}>
                  <input
                    type="checkbox"
                    id="auto_optimize_checkbox"
                    checked={autoOptimize}
                    onChange={e => setAutoOptimize(e.target.checked)}
                    style={{ width: '18px', height: '18px', accentColor: 'var(--theme-primary)', cursor: 'pointer' }}
                  />
                  <label htmlFor="auto_optimize_checkbox" style={{ fontSize: '0.9rem', fontWeight: 600, cursor: 'pointer', userSelect: 'none' }}>
                    🚀 默认下载入库后自动使用 AI 优化一次 (自动去除广告网址并规范章节排版)
                  </label>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '4px' }}>
                  <button
                    onClick={handleSaveSettings}
                    style={{ background: 'var(--theme-primary-gradient)', color: '#fff', border: 'none', padding: '8px 18px', borderRadius: '10px', fontWeight: 700, fontSize: '0.85rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}
                  >
                    <Save className="w-4 h-4" /> 保存配置
                  </button>
                  {savedMsg && <span style={{ fontSize: '0.85rem', color: '#16a34a', fontWeight: 700 }}>{savedMsg}</span>}
                </div>
              </div>
            </div>
          )}

          <form onSubmit={handleSend}>
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '0.9rem', fontWeight: 600, marginBottom: '6px' }}>系统角色设定 (System Prompt)</label>
              <input
                type="text"
                value={systemPrompt}
                onChange={e => setSystemPrompt(e.target.value)}
                style={{ width: '100%', padding: '10px 14px', borderRadius: '12px', border: '1px solid var(--theme-border)', background: 'var(--theme-input-bg)', color: 'var(--theme-text-main)', fontSize: '0.9rem', boxSizing: 'border-box' }}
              />
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '0.9rem', fontWeight: 600, marginBottom: '6px' }}>向 AI 提问或让其帮您润色小说</label>
              <textarea
                rows={4}
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                placeholder="例如：请帮我分析这段剧情的发展，或者帮我续写..."
                style={{ width: '100%', padding: '12px 14px', borderRadius: '12px', border: '1px solid var(--theme-border)', background: 'var(--theme-input-bg)', color: 'var(--theme-text-main)', fontSize: '0.95rem', boxSizing: 'border-box', resize: 'vertical' }}
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              style={{
                width: '100%',
                padding: '12px',
                background: loading ? 'var(--theme-border)' : 'var(--theme-primary-gradient)',
                color: '#fff',
                border: 'none',
                borderRadius: '14px',
                fontWeight: 700,
                fontSize: '1rem',
                cursor: loading ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px'
              }}
            >
              <Sparkles className="w-5 h-5" />
              {loading ? 'AI 正在思考中...' : '发送给 AI 助手'}
            </button>
          </form>

          {reply && (
            <div style={{ marginTop: '24px', background: 'var(--theme-card-sub)', padding: '20px', borderRadius: '16px', border: '1px solid var(--theme-border)' }}>
              <h3 style={{ margin: '0 0 10px 0', fontSize: '1rem', fontWeight: 700, color: 'var(--theme-primary)' }}>💡 AI 回复：</h3>
              <div style={{ whiteSpace: 'pre-wrap', lineHeight: '1.7', fontSize: '0.95rem' }}>{reply}</div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
