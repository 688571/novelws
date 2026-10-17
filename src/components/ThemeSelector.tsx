import React, { useState, useRef, useEffect } from 'react';
import { Palette, Check } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';

export function ThemeSelector() {
  const { currentTheme, themeConfig, setTheme, themes } = useTheme();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border transition cursor-pointer text-xs font-semibold shadow-2xs"
        style={{
          background: 'var(--theme-card)',
          borderColor: 'var(--theme-border)',
          color: 'var(--theme-text-main)'
        }}
        title="切换界面风格主题"
      >
        <span
          className="w-3.5 h-3.5 rounded-full shrink-0 shadow-xs"
          style={{ background: themeConfig.dotColor }}
        />
        <Palette className="w-3.5 h-3.5 opacity-70" />
        <span className="hidden sm:inline">{themeConfig.name}</span>
      </button>

      {isOpen && (
        <div
          className="absolute right-0 mt-2 w-72 rounded-2xl shadow-xl border p-2.5 z-50 animate-in fade-in zoom-in-95 duration-150"
          style={{
            background: 'var(--theme-card)',
            borderColor: 'var(--theme-border)',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.15), 0 8px 10px -6px rgba(0, 0, 0, 0.1)'
          }}
        >
          <div className="px-2.5 py-1.5 mb-1.5 border-b flex items-center justify-between" style={{ borderColor: 'var(--theme-border)' }}>
            <div className="text-xs font-bold flex items-center gap-1.5" style={{ color: 'var(--theme-text-main)' }}>
              <Palette className="w-4 h-4" style={{ color: 'var(--theme-primary)' }} />
              <span>选择界面美化风格</span>
            </div>
            <span className="text-[11px] opacity-60" style={{ color: 'var(--theme-text-muted)' }}>
              共 {themes.length} 款
            </span>
          </div>

          <div className="grid grid-cols-1 gap-1.5">
            {themes.map((t) => {
              const isSelected = t.id === currentTheme;
              return (
                <button
                  key={t.id}
                  onClick={() => {
                    setTheme(t.id);
                    setIsOpen(false);
                  }}
                  className="flex items-center justify-between p-2 rounded-xl transition cursor-pointer text-left w-full group"
                  style={{
                    background: isSelected ? 'var(--theme-primary-light)' : 'transparent',
                    border: isSelected ? '1px solid var(--theme-border)' : '1px solid transparent'
                  }}
                >
                  <div className="flex items-center gap-2.5">
                    <div
                      className="w-5 h-5 rounded-full flex items-center justify-center shrink-0 shadow-2xs group-hover:scale-110 transition-transform"
                      style={{ background: t.dotColor }}
                    >
                      {isSelected && <Check className="w-3 h-3 text-white stroke-[3]" />}
                    </div>
                    <div>
                      <div
                        className="text-xs font-bold"
                        style={{ color: isSelected ? 'var(--theme-primary)' : 'var(--theme-text-main)' }}
                      >
                        {t.name}
                      </div>
                      <div
                        className="text-[11px] leading-tight"
                        style={{ color: 'var(--theme-text-muted)' }}
                      >
                        {t.tagline}
                      </div>
                    </div>
                  </div>

                  {isSelected && (
                    <span
                      className="text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider shrink-0"
                      style={{
                        background: 'var(--theme-card)',
                        color: 'var(--theme-primary)',
                        border: '1px solid var(--theme-border)'
                      }}
                    >
                      使用中
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
