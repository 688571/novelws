import React, { createContext, useContext, useEffect, useState } from 'react';

export type ThemeId = 'indigo' | 'parchment' | 'bamboo' | 'midnight' | 'lavender' | 'sunset';

export interface ThemeConfig {
  id: ThemeId;
  name: string;
  tagline: string;
  dotColor: string;
  accentColor: string;
  isDark?: boolean;
}

export const THEMES: ThemeConfig[] = [
  {
    id: 'indigo',
    name: '晨曦蓝调',
    tagline: '极简现代 · 科技纯净',
    dotColor: '#4f46e5',
    accentColor: '#6366f1'
  },
  {
    id: 'parchment',
    name: '古典宣纸',
    tagline: '古色古香 · 温润护眼',
    dotColor: '#b45309',
    accentColor: '#d97706'
  },
  {
    id: 'bamboo',
    name: '青竹墨韵',
    tagline: '清新雅致 · 润目舒缓',
    dotColor: '#059669',
    accentColor: '#10b981'
  },
  {
    id: 'midnight',
    name: '深邃暗夜',
    tagline: '极客暗黑 · 沉浸阅读',
    dotColor: '#6366f1',
    accentColor: '#818cf8',
    isDark: true
  },
  {
    id: 'lavender',
    name: '暮紫流金',
    tagline: '贵气典雅 · 唯美浪漫',
    dotColor: '#7c3aed',
    accentColor: '#a855f7'
  },
  {
    id: 'sunset',
    name: '落霞珊瑚',
    tagline: '暖色霞光 · 温暖恬适',
    dotColor: '#ea580c',
    accentColor: '#f97316'
  }
];

interface ThemeContextType {
  currentTheme: ThemeId;
  themeConfig: ThemeConfig;
  setTheme: (theme: ThemeId) => void;
  themes: ThemeConfig[];
  isDark: boolean;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [currentTheme, setCurrentThemeState] = useState<ThemeId>(() => {
    try {
      const saved = localStorage.getItem('app_theme_style') as ThemeId;
      if (saved && THEMES.some(t => t.id === saved)) {
        return saved;
      }
    } catch {}
    return 'indigo';
  });

  const setTheme = (theme: ThemeId) => {
    setCurrentThemeState(theme);
    try {
      localStorage.setItem('app_theme_style', theme);
    } catch {}
  };

  const themeConfig = THEMES.find(t => t.id === currentTheme) || THEMES[0];
  const isDark = Boolean(themeConfig.isDark);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', currentTheme);
    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [currentTheme, isDark]);

  return (
    <ThemeContext.Provider value={{ currentTheme, themeConfig, setTheme, themes: THEMES, isDark }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
