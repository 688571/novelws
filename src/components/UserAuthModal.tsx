import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { User, KeyRound, UserPlus, LogIn, Database, X, ShieldCheck, Smartphone, AlertTriangle, Send } from 'lucide-react';

export function UserAuthModal() {
  const { 
    user, 
    isMySQL, 
    isAdmin, 
    login, 
    register, 
    logout, 
    isAuthModalOpen, 
    closeAuthModal, 
    openAdminModal, 
    requestDeviceReset,
    deviceInfo 
  } = useAuth();

  const [tab, setTab] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Device locked state
  const [lockedUsername, setLockedUsername] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [resetRequested, setResetRequested] = useState(false);
  const [requestingReset, setRequestingReset] = useState(false);

  if (!isAuthModalOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) {
      setErrorMessage('请填写完整账号与密码');
      return;
    }
    setSubmitting(true);
    setErrorMessage(null);
    setLockedUsername(null);
    setResetRequested(false);

    if (tab === 'login') {
      const res = await login(username.trim(), password);
      setSubmitting(false);
      if (res.success) {
        setUsername('');
        setPassword('');
        closeAuthModal();
      } else {
        setErrorMessage(res.error || '登录失败');
        if (res.isDeviceLocked) {
          setLockedUsername(username.trim());
        }
      }
    } else {
      const res = await register(username.trim(), password, nickname.trim());
      setSubmitting(false);
      if (res.success) {
        setUsername('');
        setPassword('');
        setNickname('');
        closeAuthModal();
      } else {
        setErrorMessage(res.error || '注册失败');
      }
    }
  };

  const handleQuickSwitch = async (quickUsername: string) => {
    setSubmitting(true);
    setErrorMessage(null);
    setLockedUsername(null);
    setResetRequested(false);
    const res = await login(quickUsername, '123456');
    setSubmitting(false);
    if (res.success) {
      closeAuthModal();
    } else {
      setErrorMessage(res.error || '快速登录失败');
      if (res.isDeviceLocked) {
        setLockedUsername(quickUsername);
      }
    }
  };

  const handleRequestDeviceReset = async () => {
    if (!lockedUsername) return;
    setRequestingReset(true);
    const res = await requestDeviceReset(lockedUsername);
    setRequestingReset(false);
    if (res.success) {
      setResetRequested(true);
    } else {
      alert(res.error || '提交申请失败');
    }
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(15, 23, 42, 0.65)',
      backdropFilter: 'blur(8px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 9999,
      padding: '16px'
    }}>
      <div style={{
        background: 'var(--theme-card)',
        borderRadius: '24px',
        width: '100%',
        maxWidth: '460px',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
        border: '1px solid var(--theme-border)',
        overflow: 'hidden',
        color: 'var(--theme-text-main)'
      }}>
        {/* Header */}
        <div style={{
          padding: '20px 24px',
          background: 'var(--theme-card-sub)',
          borderBottom: '1px solid var(--theme-border)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: 'var(--theme-text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <User className="w-5 h-5" style={{ color: 'var(--theme-primary)' }} />
              多用户账号中心
            </h3>
            <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: 'var(--theme-text-muted)', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Database className="w-3.5 h-3.5 text-blue-500" />
              {isMySQL ? 'MySQL 数据库驱动已生效' : '本地持久化 SQL 引擎驱动中'}
            </p>
          </div>
          <button
            onClick={closeAuthModal}
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--theme-text-muted)',
              padding: '6px',
              borderRadius: '8px'
            }}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Current User Status Banner */}
        <div style={{
          padding: '12px 24px',
          background: 'var(--theme-card-sub)',
          borderBottom: '1px solid var(--theme-border)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: '0.85rem'
        }}>
          <span style={{ color: 'var(--theme-text-main)', display: 'flex', alignItems: 'center', gap: '6px' }}>
            当前状态: <strong style={{ color: user ? 'var(--theme-primary-text)' : 'var(--theme-text-muted)' }}>{user ? (user.nickname || user.username) : '未登录 (访客)'}</strong>
            {user && isAdmin && (
              <span style={{
                background: '#fef3c7',
                color: '#92400e',
                fontSize: '0.7rem',
                padding: '2px 6px',
                borderRadius: '6px',
                fontWeight: 700,
                border: '1px solid #fde68a'
              }}>
                管理员
              </span>
            )}
            {user && !isAdmin && (
              <span style={{
                background: '#dcfce7',
                color: '#15803d',
                fontSize: '0.7rem',
                padding: '2px 6px',
                borderRadius: '6px',
                fontWeight: 600,
                border: '1px solid #bbf7d0'
              }}>
                普通会员
              </span>
            )}
          </span>
          <div style={{ display: 'flex', gap: '6px' }}>
            {user && isAdmin && (
              <button
                onClick={() => {
                  closeAuthModal();
                  openAdminModal();
                }}
                style={{
                  background: '#ede9fe',
                  color: '#6d28d9',
                  border: '1px solid #ddd6fe',
                  borderRadius: '6px',
                  padding: '4px 10px',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px'
                }}
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                会员管理
              </button>
            )}
            {user && (
              <button
                onClick={() => {
                  logout();
                  setErrorMessage(null);
                  setLockedUsername(null);
                  setSuccessMessage('已成功退出当前登录');
                  setTimeout(() => setSuccessMessage(null), 3000);
                }}
                style={{
                  background: '#fee2e2',
                  color: '#b91c1c',
                  border: 'none',
                  borderRadius: '6px',
                  padding: '4px 10px',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                退出登录
              </button>
            )}
          </div>
        </div>

        {/* Admin Credentials Info Alert */}
        <div style={{
          padding: '10px 24px',
          background: '#fffbeb',
          borderBottom: '1px solid #fef3c7',
          fontSize: '0.8rem',
          color: '#92400e',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <span>
            🔑 初始管理员账号: <strong style={{ fontFamily: 'monospace' }}>admin</strong>，密码: <strong style={{ fontFamily: 'monospace' }}>123456</strong>
          </span>
        </div>

        {/* Device Locked Alert Banner */}
        {lockedUsername && (
          <div style={{
            margin: '16px 24px 0',
            padding: '14px',
            background: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: '12px',
            fontSize: '0.85rem',
            color: '#991b1b'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700, marginBottom: '6px' }}>
              <AlertTriangle className="w-4 h-4 text-red-600" />
              单设备登录安全拦截
            </div>
            <p style={{ margin: '0 0 10px', lineHeight: 1.5, fontSize: '0.8rem', color: '#7f1d1d' }}>
              账号 <strong>{lockedUsername}</strong> 已绑定在其他设备。系统严格限制单设备登录，若您已更换设备，须联系管理员后台解绑，或点击下方提交申请。
            </p>
            {resetRequested ? (
              <div style={{
                background: '#ecfdf5',
                color: '#065f46',
                border: '1px solid #a7f3d0',
                padding: '8px 12px',
                borderRadius: '8px',
                fontSize: '0.75rem',
                fontWeight: 600,
                textAlign: 'center'
              }}>
                ✅ 已向管理员发送更换设备申请！管理员在后台点击“允许更换”后，即可直接在此设备登录。
              </div>
            ) : (
              <button
                type="button"
                onClick={handleRequestDeviceReset}
                disabled={requestingReset}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  background: '#b91c1c',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  cursor: requestingReset ? 'wait' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px'
                }}
              >
                <Send className="w-3.5 h-3.5" />
                {requestingReset ? '提交中...' : '向管理员申请更换设备 (解绑)'}
              </button>
            )}
          </div>
        )}

        {/* Error message */}
        {errorMessage && !lockedUsername && (
          <div style={{
            margin: '16px 24px 0',
            padding: '10px 14px',
            background: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: '10px',
            fontSize: '0.85rem',
            color: '#b91c1c'
          }}>
            {errorMessage}
          </div>
        )}

        {/* Success message */}
        {successMessage && (
          <div style={{
            margin: '16px 24px 0',
            padding: '10px 14px',
            background: '#f0fdf4',
            border: '1px solid #bbf7d0',
            borderRadius: '10px',
            fontSize: '0.85rem',
            color: '#15803d',
            fontWeight: 500
          }}>
            ✅ {successMessage}
          </div>
        )}

        {/* Tab Toggle */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--theme-border)', background: 'var(--theme-card-sub)', marginTop: '8px' }}>
          <button
            onClick={() => {
              setTab('login');
              setErrorMessage(null);
              setLockedUsername(null);
            }}
            style={{
              flex: 1,
              padding: '14px',
              border: 'none',
              background: tab === 'login' ? 'var(--theme-card)' : 'transparent',
              fontWeight: tab === 'login' ? 700 : 500,
              color: tab === 'login' ? 'var(--theme-primary)' : 'var(--theme-text-muted)',
              borderBottom: tab === 'login' ? '2px solid var(--theme-primary)' : 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              fontSize: '0.9rem'
            }}
          >
            <LogIn className="w-4 h-4" /> 账号登录
          </button>
          <button
            onClick={() => {
              setTab('register');
              setErrorMessage(null);
              setLockedUsername(null);
            }}
            style={{
              flex: 1,
              padding: '14px',
              border: 'none',
              background: tab === 'register' ? 'var(--theme-card)' : 'transparent',
              fontWeight: tab === 'register' ? 700 : 500,
              color: tab === 'register' ? 'var(--theme-primary)' : 'var(--theme-text-muted)',
              borderBottom: tab === 'register' ? '2px solid var(--theme-primary)' : 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              fontSize: '0.9rem'
            }}
          >
            <UserPlus className="w-4 h-4" /> 注册新用户
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ padding: '20px 24px' }}>
          <div style={{ marginBottom: '14px' }}>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: 'var(--theme-text-main)', marginBottom: '6px' }}>
              用户名 / 账号
            </label>
            <input
              type="text"
              required
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder="请输入用户名"
              style={{
                width: '100%',
                padding: '10px 14px',
                borderRadius: '10px',
                border: '1px solid var(--theme-border)',
                background: 'var(--theme-input-bg)',
                color: 'var(--theme-text-main)',
                fontSize: '0.9rem',
                outline: 'none',
                boxSizing: 'border-box'
              }}
            />
          </div>

          {tab === 'register' && (
            <div style={{ marginBottom: '14px' }}>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: 'var(--theme-text-main)', marginBottom: '6px' }}>
                用户昵称 (可选)
              </label>
              <input
                type="text"
                value={nickname}
                onChange={e => setNickname(e.target.value)}
                placeholder="例如：爱看书的书友"
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  borderRadius: '10px',
                  border: '1px solid var(--theme-border)',
                  background: 'var(--theme-input-bg)',
                  color: 'var(--theme-text-main)',
                  fontSize: '0.9rem',
                  outline: 'none',
                  boxSizing: 'border-box'
                }}
              />
            </div>
          )}

          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: 'var(--theme-text-main)', marginBottom: '6px' }}>
              密码
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="请输入密码 (至少5位)"
              style={{
                width: '100%',
                padding: '10px 14px',
                borderRadius: '10px',
                border: '1px solid var(--theme-border)',
                background: 'var(--theme-input-bg)',
                color: 'var(--theme-text-main)',
                fontSize: '0.9rem',
                outline: 'none',
                boxSizing: 'border-box'
              }}
            />
          </div>

          <div style={{ marginBottom: '16px', fontSize: '0.75rem', color: 'var(--theme-text-muted)', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Smartphone className="w-3.5 h-3.5 text-slate-400" />
            <span>当前登录设备: {deviceInfo}</span>
          </div>

          <button
            type="submit"
            disabled={submitting}
            style={{
              width: '100%',
              padding: '12px',
              borderRadius: '12px',
              border: 'none',
              background: 'var(--theme-primary-gradient)',
              color: '#ffffff',
              fontSize: '0.95rem',
              fontWeight: 700,
              cursor: submitting ? 'wait' : 'pointer',
              boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
            }}
          >
            {submitting ? '提交中...' : (tab === 'login' ? '立即登录' : '立即注册并登录')}
          </button>

        </form>
      </div>
    </div>
  );
}
