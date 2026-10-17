import React, { useEffect, useState, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Chapter } from '../types';
import { useTheme } from '../context/ThemeContext';

export function Reader() {
  const { filename } = useParams<{ filename: string }>();
  const { currentTheme, isDark } = useTheme();
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [currentChapterIndex, setCurrentChapterIndex] = useState(0);
  const [fontSize, setFontSize] = useState(16);
  const [lineHeight, setLineHeight] = useState(1.8);
  const [fontFamily, setFontFamily] = useState("'Microsoft YaHei', sans-serif");
  const [brightness, setBrightness] = useState(100);
  const [theme, setTheme] = useState('light');
  const [bgColor, setBgColor] = useState('#ffffff');
  const [textColor, setTextColor] = useState('#333333');

  const [isPanelExpanded, setIsPanelExpanded] = useState(false);
  const [convertMode, setConvertMode] = useState<'s2t' | 't2s'>('t2s');
  const [autoScrollSpeed, setAutoScrollSpeed] = useState(0); // 0, 2, 3, 5, 7, 9

  const frameRef = useRef<HTMLDivElement>(null);
  const speedLevels = [0, 2, 3, 5, 7, 9];

  // Fetch chapters and load settings
  useEffect(() => {
    const fetchContent = async () => {
      try {
        const res = await fetch(`/api/read/${encodeURIComponent(filename || '')}`);
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        setChapters(data.chapters);

        // Restore progress
        const savedIndex = localStorage.getItem(`bookmark_${filename}`);
        if (savedIndex) {
          const idx = parseInt(savedIndex, 10);
          if (idx >= 0 && idx < data.chapters.length) {
            setCurrentChapterIndex(idx);
          }
        }
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    };
    fetchContent();

    // Load Settings
    try {
      const saved = localStorage.getItem('novelReaderSettings');
      if (saved) {
        const settings = JSON.parse(saved);
        if (settings.fontSize) setFontSize(Number(settings.fontSize));
        if (settings.lineHeight) setLineHeight(Number(settings.lineHeight));
        if (settings.fontFamily) setFontFamily(settings.fontFamily);
        if (settings.brightness) setBrightness(Number(settings.brightness));
        if (settings.theme) setTheme(settings.theme);
        if (settings.bgColor) setBgColor(settings.bgColor);
        if (settings.textColor) setTextColor(settings.textColor);
      }
    } catch (e) {}

    // Load saved convert mode
    try {
      const savedMode = localStorage.getItem(`convertMode_${filename}`);
      if (savedMode === 's2t' || savedMode === 't2s') {
        setConvertMode(savedMode);
      }
    } catch (e) {}
  }, [filename]);

  // Sync reader theme with workspace theme style
  useEffect(() => {
    if (currentTheme === 'parchment') {
      setBgColor('#fbf7ee');
      setTextColor('#292524');
    } else if (currentTheme === 'bamboo') {
      setBgColor('#f1f7f3');
      setTextColor('#064e3b');
    } else if (currentTheme === 'midnight') {
      setBgColor('#131b2e');
      setTextColor('#f8fafc');
    } else if (currentTheme === 'lavender') {
      setBgColor('#f7f4fc');
      setTextColor('#2e1065');
    } else if (currentTheme === 'sunset') {
      setBgColor('#fff7f4');
      setTextColor('#431407');
    } else {
      // indigo
      setBgColor('#ffffff');
      setTextColor('#0f172a');
    }
  }, [currentTheme]);

  // Sync scroll positions of top and bottom active chapter buttons
  useEffect(() => {
    if (chapters.length === 0) return;

    const timer = setTimeout(() => {
      const topCurrent = document.querySelector('.top-chapter-list a.current') as HTMLElement;
      const topContainer = document.querySelector('.top-chapter-list') as HTMLElement;
      if (topCurrent && topContainer) {
        const parentRect = topContainer.getBoundingClientRect();
        const nodeRect = topCurrent.getBoundingClientRect();
        if (nodeRect.left < parentRect.left || nodeRect.right > parentRect.right) {
          topContainer.scrollLeft += nodeRect.left - parentRect.left - parentRect.width / 2 + nodeRect.width / 2;
        }
      }

      const bottomCurrent = document.querySelector('.chapter-list a.current') as HTMLElement;
      const bottomContainer = document.querySelector('.chapter-list') as HTMLElement;
      if (bottomCurrent && bottomContainer) {
        const parentRect = bottomContainer.getBoundingClientRect();
        const nodeRect = bottomCurrent.getBoundingClientRect();
        if (nodeRect.left < parentRect.left || nodeRect.right > parentRect.right) {
          bottomContainer.scrollLeft += nodeRect.left - parentRect.left - parentRect.width / 2 + nodeRect.width / 2;
        }
      }
    }, 100);

    return () => clearTimeout(timer);
  }, [currentChapterIndex, chapters]);

  // Apply theme classes and custom background/text sync to body
  useEffect(() => {
    document.body.className = theme;

    let bodyBg = '#f5f5f5';
    if (theme === 'dark') bodyBg = '#1e1e1e';
    else if (theme === 'sepia') bodyBg = '#d1cdb7';
    else if (theme === 'paper') bodyBg = '#e8dcc0';

    document.body.style.backgroundColor = bodyBg;

    return () => {
      document.body.className = '';
      document.body.style.backgroundColor = '';
    };
  }, [theme]);

  // Auto scroll feature
  useEffect(() => {
    if (autoScrollSpeed === 0) return;

    let lastTimestamp: number | null = null;
    let remainder = 0;
    let rafId: number;
    const pixelsPerSecond = autoScrollSpeed * 10;

    const step = (timestamp: number) => {
      if (lastTimestamp === null) {
        lastTimestamp = timestamp;
        rafId = requestAnimationFrame(step);
        return;
      }

      const delta = Math.min(100, timestamp - lastTimestamp);
      if (delta > 5) {
        const move = (delta / 1000) * pixelsPerSecond + remainder;
        const intMove = Math.floor(move);
        remainder = move - intMove;

        if (intMove !== 0) {
          const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
          const newScrollY = window.scrollY + intMove;
          if (newScrollY >= maxScroll) {
            window.scrollTo(0, maxScroll);
            setAutoScrollSpeed(0);
            return;
          } else {
            window.scrollBy(0, intMove);
          }
        }
      }

      lastTimestamp = timestamp;
      rafId = requestAnimationFrame(step);
    };

    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
  }, [autoScrollSpeed]);

  // Traditional/Simplified translation via OpenCC
  useEffect(() => {
    if (chapters.length === 0 || !frameRef.current) return;

    const applyConversion = () => {
      if (typeof (window as any).OpenCC !== 'undefined') {
        try {
          const converter = (window as any).OpenCC.Converter({
            from: convertMode === 's2t' ? 'cn' : 'tw',
            to: convertMode === 's2t' ? 'tw' : 'cn'
          });

          const walker = document.createTreeWalker(frameRef.current!, NodeFilter.SHOW_TEXT, null);
          const textNodes = [];
          let node;
          while ((node = walker.nextNode())) {
            textNodes.push(node);
          }
          textNodes.forEach(n => {
            if (n.nodeValue) n.nodeValue = converter(n.nodeValue);
          });
        } catch (e) {
          console.error("OpenCC translational error:", e);
        }
      }
    };

    const timer = setTimeout(applyConversion, 50);
    return () => clearTimeout(timer);
  }, [currentChapterIndex, chapters, convertMode]);

  const saveSettings = () => {
    const settings = {
      fontSize,
      lineHeight,
      fontFamily,
      brightness,
      theme,
      bgColor,
      textColor
    };
    localStorage.setItem('novelReaderSettings', JSON.stringify(settings));
    alert('💾 保存成功');
  };

  const handlePrevChapter = () => {
    if (currentChapterIndex > 0) {
      setAutoScrollSpeed(0);
      setCurrentChapterIndex(idx => idx - 1);
      localStorage.setItem(`bookmark_${filename}`, String(currentChapterIndex - 1));
      window.scrollTo({ top: 0, behavior: 'instant' as any });
    }
  };

  const handleNextChapter = () => {
    if (currentChapterIndex < chapters.length - 1) {
      setAutoScrollSpeed(0);
      setCurrentChapterIndex(idx => idx + 1);
      localStorage.setItem(`bookmark_${filename}`, String(currentChapterIndex + 1));
      window.scrollTo({ top: 0, behavior: 'instant' as any });
    }
  };

  const goToChapter = (idx: number) => {
    setAutoScrollSpeed(0);
    setCurrentChapterIndex(idx);
    localStorage.setItem(`bookmark_${filename}`, String(idx));
    window.scrollTo({ top: 0, behavior: 'instant' as any });
  };

  const cycleAutoSpeed = () => {
    const currentIdx = speedLevels.indexOf(autoScrollSpeed);
    const nextIdx = (currentIdx + 1) % speedLevels.length;
    setAutoScrollSpeed(speedLevels[nextIdx]);
  };

  const pageDown = () => {
    window.scrollBy({
      top: window.innerHeight * 0.9,
      behavior: 'smooth'
    });
  };

  const handleThemePresets = (selectedTheme: string) => {
    setTheme(selectedTheme);
    if (selectedTheme === 'light') {
      setBgColor('#ffffff');
      setTextColor('#333333');
    } else if (selectedTheme === 'dark') {
      setBgColor('#2d2d2d');
      setTextColor('#d4d4d4');
    } else if (selectedTheme === 'sepia') {
      setBgColor('#fbf0d9');
      setTextColor('#5b4636');
    } else if (selectedTheme === 'paper') {
      setBgColor('#fef7e9');
      setTextColor('#3e2e23');
    }
  };

  const handleConvertToggle = () => {
    const targetMode = convertMode === 's2t' ? 't2s' : 's2t';
    setConvertMode(targetMode);
    try {
      localStorage.setItem(`convertMode_${filename}`, targetMode);
    } catch (e) {}
  };

  const getFontFriendlyName = (fontVal: string) => {
    if (fontVal.includes('Microsoft YaHei')) return '微软雅黑';
    if (fontVal.includes('SimSun') || fontVal.includes('宋体')) return '宋体';
    if (fontVal.includes('SimHei') || fontVal.includes('黑体')) return '黑体';
    if (fontVal.includes('KaiTi') || fontVal.includes('楷体')) return '楷体';
    if (fontVal.includes('FangSong') || fontVal.includes('仿宋')) return '仿宋';
    return '微软雅黑';
  };

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}>加载中...</div>;
  if (error) return <div style={{ padding: 40, textAlign: 'center', color: 'red' }}>{error}</div>;

  const currentChapter = chapters[currentChapterIndex];

  return (
    <>
      <style>{`
        /* ========== 全局阅读器样式 ========== */
        .reader-wrapper {
            font-family: ${fontFamily};
            line-height: inherit;
            color: inherit;
            min-height: 100vh;
            padding: 10px;
            position: relative;
        }

        .reader-wrapper .reader-container {
            max-width: 1000px;
            margin: 0 auto;
            background: ${bgColor};
            color: ${textColor};
            box-shadow: 0 10px 30px rgba(0,0,0,0.1);
            border-radius: 24px;
            overflow: hidden;
            transition: background-color 0.3s ease, color 0.3s ease, box-shadow 0.3s ease, filter 0.3s ease;
            filter: brightness(${brightness}%);
        }

        /* 顶部目录面板 */
        .reader-wrapper #top-toc-panel {
            background: rgba(0,0,0,0.03);
            padding: 15px 20px;
            border-bottom: 1px solid rgba(0,0,0,0.06);
            margin-bottom: 0;
        }
        .reader-wrapper #top-toc-panel h3 {
            font-size: 16px;
            font-weight: 500;
            margin-bottom: 10px;
            color: inherit;
            display: inline-block;
        }
        .reader-wrapper .top-chapter-list {
            overflow-x: auto;
            white-space: nowrap;
            -webkit-overflow-scrolling: touch;
            padding-bottom: 5px;
            scroll-behavior: smooth;
        }
        .reader-wrapper .top-chapter-list ul {
            list-style: none;
            display: inline-flex;
            gap: 6px;
            padding-left: 0;
            margin: 0;
        }
        .reader-wrapper .top-chapter-list li {
            display: inline-block;
        }
        .reader-wrapper .top-chapter-list a {
            display: inline-block;
            padding: 5px 12px;
            background: rgba(255, 255, 255, 0.9);
            border-radius: 30px;
            border: 1px solid rgba(128,128,128,0.3);
            color: #2c3e50;
            text-decoration: none;
            font-size: 13px;
            white-space: nowrap;
            cursor: pointer;
            transition: all 0.2s;
        }
        .reader-wrapper .top-chapter-list a:hover {
            background: #2c3e50;
            color: white;
        }
        .reader-wrapper .top-chapter-list a.current {
            background: #3498db;
            color: white;
            border-color: #2980b9;
        }

        .reader-wrapper .reader-content {
            padding: 40px 50px;
            font-size: ${fontSize}px;
            line-height: ${lineHeight};
            transition: font-size 0.2s, line-height 0.2s;
        }

        @media (max-width: 600px) {
            .reader-wrapper .reader-content {
                padding: 20px 15px;
                font-size: 15px;
            }
        }

        /* 针对小说生成HTML的样式覆盖 */
        .reader-wrapper .reader-content h1, 
        .reader-wrapper .reader-content h2 {
            font-size: 1.4em;
            font-weight: 500;
            margin: 1.5em 0 0.8em;
            color: inherit;
            border-left: 5px solid currentColor;
            padding-left: 20px;
        }
        .reader-wrapper .reader-content p {
            margin: 1em 0;
            text-indent: 2em;
            word-break: break-word;
        }

        /* 导航链接 */
        .reader-wrapper .nav-links {
            display: flex;
            justify-content: space-between;
            margin: 40px 0 20px;
            padding-top: 20px;
            border-top: 1px dashed rgba(128,128,128,0.3);
        }
        .reader-wrapper .nav-links a {
            color: #3498db;
            text-decoration: none;
            padding: 8px 20px;
            border: 1px solid currentColor;
            border-radius: 40px;
            transition: all 0.2s;
            font-size: 14px;
            min-width: 80px;
            text-align: center;
            cursor: pointer;
        }
        .reader-wrapper .nav-links a:hover {
            background: #3498db;
            color: white !important;
        }
        .reader-wrapper .nav-links a.disabled {
            opacity: 0.3;
            pointer-events: none;
        }

        /* 底部章节目录 */
        .reader-wrapper .chapter-directory {
            margin-top: 30px;
            padding-top: 20px;
            border-top: 2px solid rgba(128,128,128,0.2);
        }
        .reader-wrapper .chapter-directory h3 {
            font-size: 18px;
            font-weight: 500;
            margin-bottom: 15px;
            color: inherit;
        }
        .reader-wrapper .chapter-list {
            max-height: 480px;
            overflow-y: auto;
            -webkit-overflow-scrolling: touch;
            padding-right: 8px;
            scroll-behavior: smooth;
        }
        .reader-wrapper .chapter-list ul {
            list-style: none;
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
            gap: 10px;
            padding-left: 0;
            margin: 0;
        }
        .reader-wrapper .chapter-list li {
            display: block;
        }
        .reader-wrapper .chapter-list a {
            display: block;
            width: 100%;
            padding: 10px 16px;
            background: var(--theme-card-sub, rgba(128,128,128,0.08));
            border-radius: 12px;
            border: 1px solid var(--theme-border, rgba(128,128,128,0.2));
            color: inherit;
            text-decoration: none;
            font-size: 0.95rem;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            cursor: pointer;
            transition: all 0.2s;
        }
        .reader-wrapper .chapter-list a:hover {
            background: var(--theme-primary, #3498db);
            color: white;
            border-color: var(--theme-primary, #2980b9);
        }
        .reader-wrapper .chapter-list a.current {
            background: var(--theme-primary, #3498db);
            color: white;
            border-color: var(--theme-primary, #2980b9);
            font-weight: 600;
        }

        /* ========== 控制面板 ========== */
        .reader-wrapper .control-panel {
            position: sticky;
            top: 10px;
            float: right;
            width: 260px;
            margin-left: 20px;
            background: rgba(255,255,255,0.95);
            backdrop-filter: blur(12px);
            border: 1px solid rgba(255,255,255,0.5);
            border-radius: 28px;
            padding: 18px 16px;
            box-shadow: 0 8px 25px rgba(0,0,0,0.08);
            transition: all 0.3s;
            z-index: 100;
            font-size: 14px;
            color: #333333;
        }

        .reader-wrapper .control-panel h3 {
            font-size: 18px;
            font-weight: 500;
            margin: 0 0 15px 0;
            color: #2c3e50;
            border-bottom: 1px solid rgba(0,0,0,0.1);
            padding-bottom: 8px;
        }

        .reader-wrapper .control-panel label {
            display: block;
            margin: 12px 0 5px;
            font-weight: 500;
            color: #555;
        }

        .reader-wrapper .control-panel select,
        .reader-wrapper .control-panel input[type="range"],
        .reader-wrapper .control-panel input[type="color"] {
            width: 100%;
            margin-bottom: 10px;
            padding: 5px;
            border-radius: 20px;
            border: 1px solid #ddd;
            background: white;
        }

        .reader-wrapper .control-panel input[type="color"] {
            height: 35px;
            padding: 2px;
        }

        .reader-wrapper .theme-buttons {
            display: flex;
            gap: 6px;
            margin: 15px 0;
            flex-wrap: wrap;
        }

        .reader-wrapper .theme-btn {
            flex: 1 0 auto;
            padding: 6px 12px;
            border: none;
            border-radius: 30px;
            font-size: 13px;
            font-weight: 500;
            cursor: pointer;
            background: #f0f0f0;
            color: #333;
            transition: all 0.2s;
            border: 1px solid transparent;
        }

        .reader-wrapper .theme-btn:hover {
            background: #e0e0e0;
        }

        .reader-wrapper .theme-btn.active {
            background: #3498db;
            color: white;
            border-color: #2980b9;
        }

        .reader-wrapper .value-display {
            float: right;
            color: #666;
        }

        .reader-wrapper .btn-primary {
            background: #3498db;
            color: white;
            border: none;
            border-radius: 20px;
            padding: 8px 15px;
            cursor: pointer;
            width: 100%;
            font-size: 14px;
            transition: background 0.2s;
        }
        .reader-wrapper .btn-primary:hover {
            background: #2980b9;
        }
        .reader-wrapper .btn-secondary {
            background: #6c757d;
            color: white;
            border: none;
            border-radius: 20px;
            padding: 8px 15px;
            cursor: pointer;
            width: 100%;
            font-size: 14px;
            transition: background 0.2s;
            text-align: center;
            text-decoration: none;
            display: block;
        }
        .reader-wrapper .btn-secondary:hover {
            background: #5a6268;
        }

        /* ========== 独立简繁转换悬浮按钮 ========== */
        .reader-wrapper .convert-float {
            position: fixed;
            top: 40px;
            right: 300px;
            z-index: 350;
            width: 50px;
            height: 50px;
            background: #9b59b6;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            box-shadow: 0 4px 12px rgba(0,0,0,0.2);
            color: white;
            font-size: 20px;
            font-weight: bold;
            transition: background 0.2s;
            border: none;
        }
        .reader-wrapper .convert-float:hover {
            background: #8e44ad;
        }

        /* ========== 自动浏览悬浮按钮 ========== */
        .reader-wrapper .auto-scroll-btn {
            position: fixed;
            right: 300px;
            top: 140px;
            transform: translateY(-50%);
            width: 50px;
            height: 50px;
            background: #3498db;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            box-shadow: 0 4px 12px rgba(0,0,0,0.2);
            color: white;
            font-size: 18px;
            font-weight: bold;
            transition: background 0.2s;
            border: none;
            z-index: 300;
        }
        .reader-wrapper .auto-scroll-btn:hover {
            background: #2980b9;
        }

        /* ========== 左右箭头章节切换容器 ========== */
        .reader-wrapper .chapter-switch-container {
            position: fixed;
            right: 300px;
            bottom: 180px;
            display: flex;
            gap: 12px;
            z-index: 300;
        }
        .reader-wrapper .chapter-arrow {
            width: 50px;
            height: 50px;
            background: #3498db;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            box-shadow: 0 4px 12px rgba(0,0,0,0.2);
            color: white;
            font-size: 28px;
            font-weight: bold;
            transition: all 0.2s ease;
            border: none;
            user-select: none;
        }
        .reader-wrapper .chapter-arrow:hover {
            background: #2980b9;
            transform: scale(1.02);
        }
        .reader-wrapper .chapter-arrow.disabled {
            opacity: 0.4;
            cursor: not-allowed;
            pointer-events: none;
            background: #6c757d;
            transform: none;
        }

        /* 向下翻页按钮 */
        .reader-wrapper .page-down-btn {
            position: fixed;
            right: 300px;
            bottom: 100px; 
            transform: translateY(-50%);
            width: 50px;
            height: 50px;
            background: #2ecc71;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            box-shadow: 0 4px 12px rgba(0,0,0,0.2);
            color: white;
            font-size: 24px;
            font-weight: bold;
            transition: background 0.2s;
            border: none;
            z-index: 300;
        }
        .reader-wrapper .page-down-btn:hover {
            background: #27ae60;
        }

        .reader-wrapper .page-down-btn2 {
            position: fixed;
            left: 100px;
            bottom: 100px; 
            transform: translateY(-50%);
            width: 50px;
            height: 50px;
            background: #2ecc71;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            box-shadow: 0 4px 12px rgba(0,0,0,0.2);
            color: white;
            font-size: 24px;
            font-weight: bold;
            transition: background 0.2s;
            border: none;
            z-index: 300;
        }
        .reader-wrapper .page-down-btn2:hover {
            background: #27ae60;
        }

        /* Dark / theme modifications on settings panel */
        body.dark .control-panel {
            background: rgba(40,40,45,0.95);
            border-color: rgba(80,80,90,0.5);
            color: #eee;
        }
        body.dark .control-panel h3 { color: #ccc; border-bottom-color: #444; }
        body.dark .control-panel label { color: #aaa; }
        body.dark .btn-primary { background: #1f6f9f; }
        body.dark .btn-secondary { background: #495057; }

        /* ---------- 小屏幕（≤1024px）响应式折叠 ---------- */
        @media (max-width: 1024px) {
            .reader-wrapper .control-panel {
                position: fixed;
                bottom: 20px;
                left: 55px;  
                top: auto;
                right: auto;
                width: 50px;
                height: 50px;
                border-radius: 50%;
                padding: 0;
                overflow: hidden;
                box-shadow: 0 4px 12px rgba(0,0,0,0.2);
                cursor: pointer;
                z-index: 300;
                display: block !important;
            }
            
            .reader-wrapper .control-panel:not(.expanded) {
                background: #3498db url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="white"><path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>') no-repeat center center !important;
                background-size: 30px !important;
                transition: background-color 0.2s;
            }
            
            .reader-wrapper .control-panel:not(.expanded):hover {
                background-color: #2980b9 !important;
            }
            
            .reader-wrapper .control-panel.expanded {
                position: fixed;
                bottom: 25px;
                left: 60px;   /* 与折叠态统一 */
                right: auto;
                top: auto;
                width: 280px;
                max-width: calc(100vw - 40px);
                height: auto;
                max-height: calc(100vh - 40px);
                overflow-y: auto;
                border-radius: 20px;
                padding: 16px;
                background: rgba(255,255,255,0.98);
                box-shadow: 0 8px 30px rgba(0,0,0,0.25);
                cursor: default;
                background-image: none;
                z-index: 400;
                display: block !important;
            }
            body.dark .reader-wrapper .control-panel.expanded {
                background: rgba(40,40,45,0.98);
            }
            .reader-wrapper .control-panel.expanded .panel-toggle {
                display: block;
                position: absolute;
                top: 8px;
                right: 12px;
                font-size: 20px;
                cursor: pointer;
                color: #666;
            }
            .reader-wrapper .control-panel.expanded label { margin: 8px 0 3px; }
            .reader-wrapper .control-panel.expanded select,
            .reader-wrapper .control-panel.expanded input[type="range"],
            .reader-wrapper .control-panel.expanded input[type="color"] {
                margin-bottom: 6px;
                padding: 4px;
            }
            .reader-wrapper .control-panel.expanded .theme-buttons { margin: 8px 0; }
            .reader-wrapper .control-panel.expanded .btn-primary,
            .reader-wrapper .control-panel.expanded .btn-secondary {
                padding: 6px 10px;
                font-size: 13px;
            }
            
            .reader-wrapper .control-panel:not(.expanded) > *:not(.panel-toggle) {
                display: none !important;
            }
            /* 新增：折叠时隐藏按钮行 */
            .reader-wrapper .control-panel:not(.expanded) .button-row {
                display: none !important;
            }
            .reader-wrapper .control-panel .panel-toggle {
                display: none;
            }

            .reader-wrapper .convert-float {
                display: none !important;
            }
            .reader-wrapper .auto-scroll-btn {
                display: none !important;
            }

            .reader-wrapper .page-down-btn {
                position: fixed;
                right: 20px;
                bottom: 20px;
                left: auto;
                top: auto;
                width: 50px;
                height: 50px;
                border-radius: 50%;
                z-index: 300;
            }
            .reader-wrapper .page-down-btn2 {
                position: fixed;
                left: 20px;
                bottom: 20px;
                right: auto;
                top: auto;
                width: 50px;
                height: 50px;
                border-radius: 50%;
                z-index: 300;
            }

            .reader-wrapper .chapter-switch-container {
                position: fixed;
                right: 80px;
                bottom: 20px;
                left: auto;
                top: auto;
                display: flex;
                gap: 12px;
                z-index: 300;
            }
            .reader-wrapper .chapter-arrow {
                width: 48px;
                height: 48px;
                font-size: 24px;
            }
        }
      `}</style>
      
      <div className="reader-wrapper">
        <button className="convert-float" id="convertFloat" onClick={handleConvertToggle}>
          {convertMode === 's2t' ? '繁' : '简'}
        </button>
        
        <button className="auto-scroll-btn" id="autoScrollBtn" onClick={cycleAutoSpeed}>
          {autoScrollSpeed === 0 ? '▷' : `${autoScrollSpeed}X`}
        </button>
        
        <div className="chapter-switch-container" id="chapterSwitchContainer">
          <button 
            className={`chapter-arrow ${currentChapterIndex <= 0 ? 'disabled' : ''}`} 
            id="prevChapterArrow" 
            onClick={handlePrevChapter}
          >
            ←
          </button>
          
          <button 
            className={`chapter-arrow ${currentChapterIndex >= chapters.length - 1 ? 'disabled' : ''}`} 
            id="nextChapterArrow" 
            onClick={handleNextChapter}
          >
            →
          </button>
        </div>
        
        <button className="page-down-btn" onClick={pageDown}>↓</button>
        <button className="page-down-btn2" onClick={pageDown}>↓</button>
        
        <div 
          className={`control-panel ${isPanelExpanded ? 'expanded' : ''}`} 
          id="controlPanel"
          onClick={() => { if (!isPanelExpanded) setIsPanelExpanded(true); }}
        >
          <div className="panel-toggle" onClick={(e) => { e.stopPropagation(); setIsPanelExpanded(false); }}>✕</div>
          
          <h3>📖 阅读设置</h3>
          
          <label>字体 <span className="value-display">{getFontFriendlyName(fontFamily)}</span></label>
          <select value={fontFamily} onChange={e => setFontFamily(e.target.value)}>
            <option value="'Microsoft YaHei', sans-serif">微软雅黑</option>
            <option value="'SimSun', '宋体', serif">宋体</option>
            <option value="'SimHei', '黑体', sans-serif">黑体</option>
            <option value="'KaiTi', '楷体', serif">楷体</option>
            <option value="'FangSong', '仿宋', serif">仿宋</option>
          </select>

          <label>字号 <span className="value-display">{fontSize}px</span></label>
          <input type="range" min="12" max="28" value={fontSize} step="1" onChange={e => setFontSize(Number(e.target.value))} />

          <label>行间距 <span className="value-display">{lineHeight}</span></label>
          <input type="range" min="1.2" max="2.8" step="0.1" value={lineHeight} onChange={e => setLineHeight(Number(e.target.value))} />

          <label>亮度 <span className="value-display">{brightness}%</span></label>
          <input type="range" min="50" max="150" value={brightness} step="1" onChange={e => setBrightness(Number(e.target.value))} />

          <label>主题</label>
          <div className="theme-buttons">
            <button className={`theme-btn ${theme === 'light' ? 'active' : ''}`} onClick={(e) => { e.stopPropagation(); handleThemePresets('light'); }}>亮色</button>
            <button className={`theme-btn ${theme === 'dark' ? 'active' : ''}`} onClick={(e) => { e.stopPropagation(); handleThemePresets('dark'); }}>深色</button>
            <button className={`theme-btn ${theme === 'sepia' ? 'active' : ''}`} onClick={(e) => { e.stopPropagation(); handleThemePresets('sepia'); }}>护眼</button>
            <button className={`theme-btn ${theme === 'paper' ? 'active' : ''}`} onClick={(e) => { e.stopPropagation(); handleThemePresets('paper'); }}>纸色</button>
          </div>

          <label>背景色</label>
          <input type="color" value={bgColor} onChange={e => setBgColor(e.target.value)} onClick={(e) => e.stopPropagation()} />

          <label>文字颜色</label>
          <input type="color" value={textColor} onChange={e => setTextColor(e.target.value)} onClick={(e) => e.stopPropagation()} />

          <div className="button-row" style={{ marginTop: '15px', display: 'flex', gap: '10px', justifyContent: 'center' }} onClick={(e) => e.stopPropagation()}>
            <button className="btn-primary" onClick={saveSettings}>💾 保存</button>
            <Link className="btn-secondary" to="/library">📚 我的书架</Link>
          </div>
        </div>

        <div className="reader-container">
          <div id="top-toc-panel">
            <h3>📑 快速跳转</h3>
            <div className="top-chapter-list">
              <ul>
                {chapters.map((chap, idx) => (
                  <li key={idx}>
                    <a className={idx === currentChapterIndex ? 'current' : ''} onClick={() => goToChapter(idx)}>
                      {idx + 1}. {chap.title}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          
          <div className="reader-content" ref={frameRef}>
            {currentChapter ? (
              <section>
                <h2>{currentChapter.title}</h2>
                <div dangerouslySetInnerHTML={{ __html: currentChapter.content }} />
                
                <div className="nav-links">
                  <a className={currentChapterIndex <= 0 ? 'disabled' : ''} onClick={handlePrevChapter}>上一章</a>
                  <a onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>回到顶部</a>
                  <a className={currentChapterIndex >= chapters.length - 1 ? 'disabled' : ''} onClick={handleNextChapter}>下一章</a>
                </div>

                <div className="chapter-directory">
                  <h3>📑 目录 (共 {chapters.length} 章)</h3>
                  <div className="chapter-list">
                    <ul>
                      {chapters.map((chap, idx) => (
                        <li key={idx}>
                          <a className={idx === currentChapterIndex ? 'current' : ''} onClick={() => goToChapter(idx)}>
                            {idx + 1}. {chap.title}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </section>
            ) : (
              <div>无章节内容</div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}