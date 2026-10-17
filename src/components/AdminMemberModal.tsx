import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { User } from '../types';
import { 
  ShieldCheck, Smartphone, RefreshCw, KeyRound, UserPlus, 
  Trash2, Ban, CheckCircle, AlertTriangle, X, Search, Database, HardDrive, Info
} from 'lucide-react';

export function AdminMemberModal() {
  const { isAdminModalOpen, closeAdminModal, isAdmin, authFetch, isMySQL } = useAuth();

  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Add user modal state
  const [showAddModal, setShowAddModal] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newNickname, setNewNickname] = useState('');
  const [addingUser, setAddingUser] = useState(false);

  // Reset password modal state
  const [resettingUser, setResettingUser] = useState<User | null>(null);
  const [newMemberPassword, setNewMemberPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  const fetchUsers = async () => {
    if (!isAdmin) return;
    setLoading(true);
    try {
      const res = await authFetch('/api/admin/users');
      const data = await res.json();
      if (data.success && data.users) {
        setUsers(data.users);
      }
    } catch (err: any) {
      console.error('Fetch users error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAdminModalOpen && isAdmin) {
      fetchUsers();
    }
  }, [isAdminModalOpen, isAdmin]);

  if (!isAdminModalOpen || !isAdmin) return null;

  const handleResetDevice = async (user: User) => {
    if (!confirm(`确定允许会员【${user.nickname || user.username}】更换设备吗？\n解绑后，该会员下次登录时将自动绑定新设备。`)) {
      return;
    }
    try {
      const res = await authFetch(`/api/admin/users/${user.id}/reset-device`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        alert(data.message || '已成功解除设备绑定，允许该会员在更换后的新设备登录！');
        fetchUsers();
      } else {
        alert(data.error || '解绑失败');
      }
    } catch (err: any) {
      alert('操作失败: ' + err.message);
    }
  };

  const handleToggleStatus = async (user: User) => {
    const nextStatus = user.status === 'active' ? 'disabled' : 'active';
    const actionName = nextStatus === 'active' ? '启用/通过审核' : '禁用';
    if (user.status !== 'pending') {
      if (!confirm(`确定要${actionName}会员【${user.nickname || user.username}】的账号吗？`)) {
        return;
      }
    }
    try {
      const res = await authFetch(`/api/admin/users/${user.id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus })
      });
      const data = await res.json();
      if (data.success) {
        fetchUsers();
      } else {
        alert(data.error || '修改状态失败');
      }
    } catch (err: any) {
      alert('操作失败: ' + err.message);
    }
  };

  const handleDeleteUser = async (user: User) => {
    if (user.username === 'admin' || user.id === 1) {
      alert('系统内置超级管理员账号禁止删除！');
      return;
    }
    if (!confirm(`⚠️ 危险操作！确定彻底删除会员【${user.nickname || user.username}】吗？\n该会员的账号信息及书架关联记录都将被清空。`)) {
      return;
    }
    try {
      const res = await authFetch(`/api/admin/users/${user.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        alert('会员已成功删除');
        fetchUsers();
      } else {
        alert(data.error || '删除失败');
      }
    } catch (err: any) {
      alert('操作失败: ' + err.message);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUsername.trim() || !newPassword.trim()) {
      alert('请填写会员用户名和初始密码');
      return;
    }
    if (newPassword.length < 5) {
      alert('密码长度至少需要5位');
      return;
    }
    setAddingUser(true);
    try {
      const res = await authFetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: newUsername.trim(),
          password: newPassword.trim(),
          nickname: newNickname.trim()
        })
      });
      const data = await res.json();
      if (data.success) {
        alert(`会员【${newUsername.trim()}】创建成功！初始密码为: ${newPassword.trim()}`);
        setNewUsername('');
        setNewPassword('');
        setNewNickname('');
        setShowAddModal(false);
        fetchUsers();
      } else {
        alert(data.error || '创建会员失败');
      }
    } catch (err: any) {
      alert('创建失败: ' + err.message);
    } finally {
      setAddingUser(false);
    }
  };

  const handleResetPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resettingUser) return;
    if (!newMemberPassword || newMemberPassword.length < 5) {
      alert('新密码长度至少需要5位');
      return;
    }
    setSavingPassword(true);
    try {
      const res = await authFetch(`/api/admin/users/${resettingUser.id}/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: newMemberPassword })
      });
      const data = await res.json();
      if (data.success) {
        alert(`已成功为会员【${resettingUser.nickname || resettingUser.username}】重置密码为: ${newMemberPassword}`);
        setResettingUser(null);
        setNewMemberPassword('');
        fetchUsers();
      } else {
        alert(data.error || '密码重置失败');
      }
    } catch (err: any) {
      alert('重置密码出错: ' + err.message);
    } finally {
      setSavingPassword(false);
    }
  };

  // Filtered users
  const filteredUsers = users.filter(u => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return true;
    return (
      u.username.toLowerCase().includes(q) ||
      (u.nickname && u.nickname.toLowerCase().includes(q)) ||
      (u.device_info && u.device_info.toLowerCase().includes(q))
    );
  });

  // Calculate statistics
  const totalUsers = users.length;
  const activeUsers = users.filter(u => u.status !== 'disabled').length;
  const boundDevices = users.filter(u => Boolean(u.bound_device_id)).length;
  const resetRequests = users.filter(u => Boolean(u.device_reset_requested)).length;

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-5xl max-h-[92vh] shadow-2xl border border-slate-200 flex flex-col overflow-hidden animate-in fade-in duration-200">
        
        {/* Top Header */}
        <div className="px-6 py-4 bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white flex items-center justify-between border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-600/80 border border-indigo-400/30 flex items-center justify-center shadow-inner">
              <ShieldCheck className="w-6 h-6 text-indigo-200" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-lg text-white">会员管理与设备控制中心</h3>
                <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-500/30 text-indigo-200 border border-indigo-400/30">
                  {isMySQL ? 'MySQL 数据库驱动' : '本地持久化 SQL 引擎'}
                </span>
              </div>
              <p className="text-xs text-slate-300 mt-0.5 flex items-center gap-2">
                <span>系统初始管理员账号: <code className="text-amber-300 font-bold bg-amber-950/60 px-1 py-0.5 rounded border border-amber-600/40">admin</code></span>
                <span>初始密码: <code className="text-amber-300 font-bold bg-amber-950/60 px-1 py-0.5 rounded border border-amber-600/40">123456</code></span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={fetchUsers}
              disabled={loading}
              className="p-2 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white transition cursor-pointer"
              title="刷新列表"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={closeAdminModal}
              className="p-2 rounded-lg bg-slate-800/80 hover:bg-rose-900/60 text-slate-300 hover:text-rose-300 transition cursor-pointer"
              title="关闭窗口"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Stats Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-4 bg-slate-50 border-b border-slate-200 text-sm">
          <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-2xs">
            <span className="text-xs text-slate-500 block">注册会员总数</span>
            <span className="text-xl font-bold text-slate-800 mt-1 block">{totalUsers} 人</span>
          </div>
          <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-2xs">
            <span className="text-xs text-slate-500 block">正常可用账号</span>
            <span className="text-xl font-bold text-emerald-600 mt-1 block">{activeUsers} 人</span>
          </div>
          <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-2xs">
            <span className="text-xs text-slate-500 block">单设备绑定中</span>
            <span className="text-xl font-bold text-indigo-600 mt-1 block">{boundDevices} 台</span>
          </div>
          <div className={`p-3 rounded-xl border shadow-2xs ${resetRequests > 0 ? 'bg-amber-50 border-amber-300 animate-pulse' : 'bg-white border-slate-200'}`}>
            <span className="text-xs text-slate-500 block flex items-center gap-1">
              {resetRequests > 0 && <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />}
              换机申请待处理
            </span>
            <span className={`text-xl font-bold mt-1 block ${resetRequests > 0 ? 'text-amber-700 font-extrabold' : 'text-slate-600'}`}>
              {resetRequests} 条
            </span>
          </div>
        </div>

        {/* Action & Search Bar */}
        <div className="p-4 bg-white border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div className="relative flex-1 min-w-[220px] max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="搜索用户名、昵称或设备信息..."
              className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:border-indigo-500 focus:bg-white transition"
            />
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-sm transition shadow-xs cursor-pointer"
            >
              <UserPlus className="w-4 h-4" />
              添加新会员
            </button>
          </div>
        </div>

        {/* AI Model Configuration & Connection Test Bar */}
        <div className="p-4 bg-indigo-50/60 border-b border-indigo-100 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-600 text-white flex items-center justify-center font-bold text-xs">
              AI
            </div>
            <div>
              <h4 className="font-bold text-xs text-slate-800">服务器大模型去广告排查配置 (.env)</h4>
              <p className="text-[11px] text-slate-500">小说下载后将自动调用该大模型进行排版、分章及去广告优化。</p>
            </div>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1.5 bg-white px-3 py-1.5 rounded-lg border border-slate-200 text-xs">
              <span className="text-slate-400 font-medium">模型:</span>
              <select
                id="admin-ai-model-select"
                defaultValue={localStorage.getItem('admin_ai_model') || 'gemini-3.5-flash-lite'}
                onChange={(e) => localStorage.setItem('admin_ai_model', e.target.value)}
                className="bg-transparent font-bold text-indigo-700 outline-none cursor-pointer"
              >
                <option value="gemini-3.5-flash-lite">gemini-3.5-flash-lite</option>
                <option value="gpt-4o-mini">gpt-4o-mini</option>
                <option value="gpt-4o">gpt-4o</option>
                <option value="deepseek-chat">deepseek-chat</option>
                <option value="claude-3-5-sonnet">claude-3-5-sonnet</option>
              </select>
            </div>
            <button
              onClick={async () => {
                const model = (document.getElementById('admin-ai-model-select') as HTMLSelectElement)?.value || 'gemini-3.5-flash-lite';
                const btn = document.getElementById('admin-ai-test-btn');
                if (btn) btn.innerText = '测试中...';
                try {
                  const res = await authFetch('/api/admin/ai-test', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ model })
                  });
                  const data = await res.json();
                  if (data.success) {
                    alert(`✅ 大模型连接测试成功！\n模型: ${data.modelUsed}\nAI 回复: ${data.reply}`);
                  } else {
                    alert(`❌ 测试失败: ${data.error}`);
                  }
                } catch (e: any) {
                  alert('测试异常: ' + e.message);
                } finally {
                  if (btn) btn.innerText = '🧪 测试模型连通性';
                }
              }}
              id="admin-ai-test-btn"
              className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold transition shadow-2xs cursor-pointer"
            >
              🧪 测试模型连通性
            </button>
          </div>
        </div>

        {/* Members Table */}
        <div className="flex-1 overflow-y-auto p-4">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500 uppercase tracking-wider bg-slate-50/70">
                <th className="py-3 px-3">会员信息</th>
                <th className="py-3 px-3">角色权限</th>
                <th className="py-3 px-3">账号状态</th>
                <th className="py-3 px-3">单设备绑定状态</th>
                <th className="py-3 px-3">书架关联</th>
                <th className="py-3 px-3">注册时间</th>
                <th className="py-3 px-3 text-right">管理操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400">
                    {loading ? '正在加载会员数据...' : '没有找到匹配的会员'}
                  </td>
                </tr>
              ) : (
                filteredUsers.map(u => {
                  const isPrimaryAdmin = u.username === 'admin' || u.id === 1;
                  const isBound = Boolean(u.bound_device_id);
                  const isResetReq = Boolean(u.device_reset_requested);

                  return (
                    <tr key={u.id} className="hover:bg-slate-50/80 transition">
                      {/* User Info */}
                      <td className="py-3.5 px-3">
                        <div className="font-semibold text-slate-800 flex items-center gap-2">
                          <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${isPrimaryAdmin ? 'bg-amber-100 text-amber-800' : 'bg-indigo-100 text-indigo-700'}`}>
                            {(u.nickname || u.username).slice(0, 1).toUpperCase()}
                          </div>
                          <div>
                            <div>{u.nickname || u.username}</div>
                            <div className="text-xs text-slate-400 font-mono">@{u.username}</div>
                          </div>
                        </div>
                      </td>

                      {/* Role */}
                      <td className="py-3.5 px-3">
                        {isPrimaryAdmin ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
                            超级管理员
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600 border border-slate-200">
                            普通会员
                          </span>
                        )}
                      </td>

                      {/* Status */}
                      <td className="py-3.5 px-3">
                        {u.status === 'pending' ? (
                          <div className="flex items-center gap-1.5">
                            <span className="inline-flex items-center gap-1 text-xs font-bold text-amber-800 bg-amber-100 px-2.5 py-0.5 rounded-full border border-amber-300 animate-pulse">
                              ⏳ 待审核
                            </span>
                            <button
                              onClick={() => handleToggleStatus(u)}
                              className="px-2 py-0.5 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-md shadow-2xs transition cursor-pointer"
                              title="点击通过审核并启用账号"
                            >
                              通过审核
                            </button>
                          </div>
                        ) : u.status === 'disabled' ? (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-rose-600 bg-rose-50 px-2 py-0.5 rounded-full border border-rose-200">
                            已禁用
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                            正常
                          </span>
                        )}
                      </td>

                      {/* Device Binding */}
                      <td className="py-3.5 px-3">
                        {isPrimaryAdmin ? (
                          <span className="text-xs text-slate-400">管理员免绑定限制</span>
                        ) : isResetReq ? (
                          <div className="flex flex-col gap-1">
                            <span className="inline-flex items-center gap-1 text-xs font-bold text-amber-800 bg-amber-100 px-2 py-0.5 rounded-md border border-amber-300 animate-pulse">
                              <AlertTriangle className="w-3.5 h-3.5" /> 申请更换新设备
                            </span>
                            <span className="text-[11px] text-slate-500 font-mono truncate max-w-[150px]">
                              原: {u.device_info || '已锁设备'}
                            </span>
                          </div>
                        ) : isBound ? (
                          <div className="flex flex-col gap-0.5">
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-md border border-indigo-200 max-w-[180px] truncate">
                              <Smartphone className="w-3 h-3 text-indigo-500 shrink-0" />
                              {u.device_info || '已绑定设备'}
                            </span>
                            <span className="text-[10px] text-slate-400 font-mono">
                              已锁定单机
                            </span>
                          </div>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs text-slate-400 bg-slate-50 px-2 py-0.5 rounded-md border border-slate-200">
                            未绑定 (下次登录绑定)
                          </span>
                        )}
                      </td>

                      {/* Novels count */}
                      <td className="py-3.5 px-3">
                        <span className="text-xs font-medium text-slate-600">
                          {u.novel_count ?? 0} 本
                        </span>
                      </td>

                      {/* Created At */}
                      <td className="py-3.5 px-3 text-xs text-slate-500">
                        {u.created_at ? new Date(u.created_at).toLocaleDateString() : '-'}
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 px-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {/* Device unbind / allow change */}
                          {!isPrimaryAdmin && (
                            <button
                              onClick={() => handleResetDevice(u)}
                              className={`px-2.5 py-1 text-xs font-medium rounded-lg transition cursor-pointer flex items-center gap-1 ${
                                isResetReq 
                                  ? 'bg-amber-600 hover:bg-amber-700 text-white shadow-xs font-bold' 
                                  : isBound 
                                    ? 'bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200' 
                                    : 'bg-slate-100 text-slate-400 hover:bg-slate-200 hover:text-slate-600'
                              }`}
                              title={isBound ? "解绑当前设备，允许其更换至新设备" : "重置设备状态"}
                            >
                              <Smartphone className="w-3.5 h-3.5" />
                              {isResetReq ? '允许更换设备' : '解绑设备'}
                            </button>
                          )}

                          {/* Reset password */}
                          <button
                            onClick={() => {
                              setResettingUser(u);
                              setNewMemberPassword('');
                            }}
                            className="p-1.5 rounded-lg bg-slate-100 hover:bg-amber-50 text-slate-600 hover:text-amber-700 border border-slate-200 hover:border-amber-200 transition cursor-pointer"
                            title="修改/重置密码"
                          >
                            <KeyRound className="w-3.5 h-3.5" />
                          </button>

                          {/* Toggle status */}
                          {!isPrimaryAdmin && (
                            <button
                              onClick={() => handleToggleStatus(u)}
                              className={`p-1.5 rounded-lg border transition cursor-pointer ${
                                u.status === 'disabled'
                                  ? 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border-emerald-200'
                                  : 'bg-slate-100 hover:bg-slate-200 text-slate-600 border-slate-200'
                              }`}
                              title={u.status === 'disabled' ? '恢复启用' : '禁用账号'}
                            >
                              {u.status === 'disabled' ? <CheckCircle className="w-3.5 h-3.5" /> : <Ban className="w-3.5 h-3.5" />}
                            </button>
                          )}

                          {/* Delete user */}
                          {!isPrimaryAdmin && (
                            <button
                              onClick={() => handleDeleteUser(u)}
                              className="p-1.5 rounded-lg bg-slate-100 hover:bg-rose-50 text-slate-400 hover:text-rose-600 border border-slate-200 hover:border-rose-200 transition cursor-pointer"
                              title="删除会员"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Policy & Operational Tips Footer */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 text-xs text-slate-600 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-slate-500">
            <Info className="w-4 h-4 text-indigo-500 shrink-0" />
            <span>
              <strong>安全策略：</strong>普通会员严格限制单设备登录，换机须管理员在此点击<strong>【解绑设备/允许更换设备】</strong>；会员不允许自行修改密码，由管理员统一维护。
            </span>
          </div>
          <div className="text-slate-400 font-mono text-[11px]">
            独立域名: qidu.eu.org · 端口由 .env 动态驱动
          </div>
        </div>

      </div>

      {/* Add New Member Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-2xs flex items-center justify-center z-60 p-4">
          <div className="bg-white rounded-xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden">
            <div className="px-5 py-3.5 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
              <h4 className="font-bold text-slate-800 flex items-center gap-2">
                <UserPlus className="w-4 h-4 text-indigo-600" />
                添加新会员账号
              </h4>
              <button onClick={() => setShowAddModal(false)} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleCreateUser} className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  会员用户名 (唯一账号) *
                </label>
                <input
                  type="text"
                  required
                  value={newUsername}
                  onChange={e => setNewUsername(e.target.value)}
                  placeholder="例如: reader2"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  会员昵称 (展示名称)
                </label>
                <input
                  type="text"
                  value={newNickname}
                  onChange={e => setNewNickname(e.target.value)}
                  placeholder="例如: 书友老李"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm outline-none focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  初始登录密码 *
                </label>
                <input
                  type="text"
                  required
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  placeholder="请输入至少5位密码"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono outline-none focus:border-indigo-500"
                />
                <span className="text-[11px] text-slate-400 mt-1 block">
                  提示：普通会员无法自改密码，创建后请将此密码通知会员。
                </span>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 border border-slate-200 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-50 cursor-pointer"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={addingUser}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium cursor-pointer"
                >
                  {addingUser ? '创建中...' : '确认创建'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reset Password Modal */}
      {resettingUser && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-2xs flex items-center justify-center z-60 p-4">
          <div className="bg-white rounded-xl max-w-sm w-full shadow-2xl border border-slate-200 overflow-hidden">
            <div className="px-5 py-3.5 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
              <h4 className="font-bold text-slate-800 flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-amber-600" />
                重置会员密码
              </h4>
              <button onClick={() => setResettingUser(null)} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleResetPasswordSubmit} className="p-5 space-y-4">
              <div className="text-sm text-slate-600">
                当前重置会员：<strong className="text-slate-800">{resettingUser.nickname || resettingUser.username}</strong> ({resettingUser.username})
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  设置新密码 (至少5位) *
                </label>
                <input
                  type="text"
                  required
                  value={newMemberPassword}
                  onChange={e => setNewMemberPassword(e.target.value)}
                  placeholder="请输入新密码"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono outline-none focus:border-amber-500"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setResettingUser(null)}
                  className="px-4 py-2 border border-slate-200 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-50 cursor-pointer"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={savingPassword}
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-sm font-medium cursor-pointer"
                >
                  {savingPassword ? '保存中...' : '确认重置'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
