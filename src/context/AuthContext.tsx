import React, { createContext, useContext, useState, useEffect } from 'react';
import { User } from '../types';

export function getOrCreateDeviceId(): string {
  let devId = localStorage.getItem('novel_device_id');
  if (!devId) {
    devId = 'dev_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    localStorage.setItem('novel_device_id', devId);
  }
  return devId;
}

export function getBrowserDeviceInfo(): string {
  const ua = navigator.userAgent;
  let os = '电脑系统';
  if (/Windows/i.test(ua)) os = 'Windows 设备';
  else if (/Macintosh|Mac OS/i.test(ua)) os = 'Mac 设备';
  else if (/iPhone|iPad|iPod/i.test(ua)) os = 'iOS 移动端';
  else if (/Android/i.test(ua)) os = 'Android 手机';
  else if (/Linux/i.test(ua)) os = 'Linux 设备';

  let browser = '浏览器';
  if (/Edg\//i.test(ua)) browser = 'Edge';
  else if (/Chrome\//i.test(ua)) browser = 'Chrome';
  else if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) browser = 'Safari';
  else if (/Firefox\//i.test(ua)) browser = 'Firefox';

  return `${os} (${browser})`;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  isMySQL: boolean;
  isAdmin: boolean;
  deviceId: string;
  deviceInfo: string;
  login: (username: string, password: string) => Promise<{ success: boolean; error?: string; isDeviceLocked?: boolean }>;
  register: (username: string, password: string, nickname?: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  authFetch: (url: string, options?: RequestInit) => Promise<Response>;
  openAuthModal: () => void;
  closeAuthModal: () => void;
  isAuthModalOpen: boolean;
  openAdminModal: () => void;
  closeAdminModal: () => void;
  isAdminModalOpen: boolean;
  requestDeviceReset: (username: string) => Promise<{ success: boolean; message?: string; error?: string }>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const TOKEN_KEY = 'novel_auth_token';
const USER_KEY = 'novel_auth_user';

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const deviceId = getOrCreateDeviceId();
  const deviceInfo = getBrowserDeviceInfo();

  const [user, setUser] = useState<User | null>(() => {
    try {
      const savedUser = localStorage.getItem(USER_KEY);
      const savedToken = localStorage.getItem(TOKEN_KEY);
      if (savedUser && savedToken) {
        return JSON.parse(savedUser);
      }
      return null;
    } catch {
      return null;
    }
  });

  const [token, setToken] = useState<string | null>(() => {
    return localStorage.getItem(TOKEN_KEY) || null;
  });

  const [isMySQL, setIsMySQL] = useState<boolean>(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState<boolean>(false);
  const [isAdminModalOpen, setIsAdminModalOpen] = useState<boolean>(false);

  const isAdmin = Boolean(user && (user.role === 'admin' || user.username === 'admin'));

  // Check auth status on mount or token change
  useEffect(() => {
    const checkMe = async () => {
      if (!token) {
        setUser(null);
        return;
      }
      try {
        const headers: Record<string, string> = {
          'Authorization': `Bearer ${token}`
        };
        
        const res = await fetch('/api/auth/me', { headers });
        const data = await res.json();
        if (data.success && data.user) {
          setUser(data.user);
          setIsMySQL(Boolean(data.isMySQL));
          localStorage.setItem(USER_KEY, JSON.stringify(data.user));
        } else {
          setUser(null);
          setToken(null);
          localStorage.removeItem(TOKEN_KEY);
          localStorage.removeItem(USER_KEY);
        }
      } catch (err) {
        console.warn('Check auth error:', err);
      }
    };
    checkMe();
  }, [token]);

  const login = async (username: string, password: string): Promise<{ success: boolean; error?: string; isDeviceLocked?: boolean }> => {
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          username, 
          password, 
          deviceId, 
          deviceInfo 
        })
      });
      const data = await res.json();
      if (data.success && data.token && data.user) {
        setToken(data.token);
        setUser(data.user);
        setIsMySQL(Boolean(data.isMySQL));
        localStorage.setItem(TOKEN_KEY, data.token);
        localStorage.setItem(USER_KEY, JSON.stringify(data.user));
        return { success: true };
      } else {
        return { 
          success: false, 
          error: data.error || '登录失败', 
          isDeviceLocked: Boolean(data.isDeviceLocked) 
        };
      }
    } catch (err: any) {
      return { success: false, error: '网络或服务器错误: ' + err.message };
    }
  };

  const register = async (username: string, password: string, nickname?: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          username, 
          password, 
          nickname, 
          deviceId, 
          deviceInfo 
        })
      });
      const data = await res.json();
      if (data.success) {
        alert(data.message || '注册成功！请等待管理员在后台审核通过后方可登录。');
        return { success: true };
      } else {
        return { success: false, error: data.error || '注册失败' };
      }
    } catch (err: any) {
      return { success: false, error: '网络或服务器错误: ' + err.message };
    }
  };

  const requestDeviceReset = async (username: string): Promise<{ success: boolean; message?: string; error?: string }> => {
    try {
      const res = await fetch('/api/auth/request-device-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username })
      });
      const data = await res.json();
      if (data.success) {
        return { success: true, message: data.message };
      } else {
        return { success: false, error: data.error || '提交申请失败' };
      }
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  };

  const logout = () => {
    try {
      fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    } catch (e) {}
    setToken(null);
    setUser(null);
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setIsAdminModalOpen(false);
  };

  const authFetch = (url: string, options: RequestInit = {}): Promise<Response> => {
    const headers = new Headers(options.headers || {});
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
    if (user?.id) {
      headers.set('x-user-id', String(user.id));
    }
    return fetch(url, { ...options, headers });
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isMySQL,
        isAdmin,
        deviceId,
        deviceInfo,
        login,
        register,
        logout,
        authFetch,
        openAuthModal: () => setIsAuthModalOpen(true),
        closeAuthModal: () => setIsAuthModalOpen(false),
        isAuthModalOpen,
        openAdminModal: () => setIsAdminModalOpen(true),
        closeAdminModal: () => setIsAdminModalOpen(false),
        isAdminModalOpen,
        requestDeviceReset
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
