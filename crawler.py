#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
小说爬虫 - 通用版 + 52shuku 专项优化 + 2kzw.la 适配
支持：目录页、单章页、作者页批量抓取、增量更新。
"""

import urllib.request
import urllib.error
import ssl
import sys
import os

# Ensure vendor directory is in sys.path as an absolute path
current_dir = os.path.dirname(os.path.abspath(__file__))
vendor_dir = os.path.join(current_dir, 'vendor')
if vendor_dir not in sys.path:
    sys.path.insert(0, vendor_dir)

# Also try process working directory vendor
cwd_vendor = os.path.join(os.getcwd(), 'vendor')
if cwd_vendor not in sys.path:
    sys.path.insert(0, cwd_vendor)

try:
    from bs4 import BeautifulSoup
except Exception as first_err:
    import subprocess
    import traceback
    sys.stderr.write(f"Pre-vendored bs4 import failed with: {first_err}\n")
    traceback.print_exc()
    sys.stderr.write(f"sys.path was: {sys.path}\n")
    sys.stderr.write("Attempting auto-install fallbacks...\n")
    
    install_commands = [
        [sys.executable, "-m", "pip", "install", "beautifulsoup4", "chardet<5.0.0"],
        ["pip3", "install", "beautifulsoup4", "chardet<5.0.0"],
        ["pip", "install", "beautifulsoup4", "chardet<5.0.0"],
        ["pip3", "install", "--user", "beautifulsoup4", "chardet<5.0.0"],
        ["pip", "install", "--user", "beautifulsoup4", "chardet<5.0.0"],
    ]
    
    installed_ok = False
    last_ex = None
    for cmd in install_commands:
        try:
            sys.stderr.write(f"Running fallback install command: {' '.join(cmd)}\n")
            subprocess.check_call(cmd)
            # Try importing again
            from bs4 import BeautifulSoup
            installed_ok = True
            sys.stderr.write("Successfully installed and imported bs4!\n")
            break
        except Exception as e:
            last_ex = e
            sys.stderr.write(f"Command {' '.join(cmd)} failed or import still failed: {e}\n")
            
    if not installed_ok:
        raise ImportError(
            f"无法导入 `bs4` 且所有自动安装尝试均已失败。\n"
            f"最后一次尝试的错误: {last_ex}\n"
            f"当前Python路径(sys.path): {sys.path}\n"
            f"当前工作目录(os.getcwd): {os.getcwd()}\n"
            f"请手动在您的服务器上执行：pip install beautifulsoup4 \"chardet<5.0.0\" 或 pip3 install beautifulsoup4 \"chardet<5.0.0\""
        )

import time
import random
import os
import re
import hashlib
from urllib.parse import urljoin, quote

# ==================== 配置 ====================
USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (iPad; CPU OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/114.0'
]

# 示例代理池，用户可以根据需要添加
PROXY_POOL = [
    # 'http://user:pass@host:port',
    # 'http://host:port'
]

# 尝试从外部文件加载代理
if os.path.exists('proxies.txt'):
    with open('proxies.txt', 'r', encoding='utf-8') as f:
        PROXY_POOL.extend([line.strip() for line in f if line.strip() and not line.startswith('#')])

def get_random_headers(url=None):
    ua = random.choice(USER_AGENTS)
    headers = {
        'User-Agent': ua,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Connection': 'keep-alive',
        'X-Forwarded-For': '114.114.114.114',
        'X-Real-IP': '114.114.114.114',
        'Client-IP': '114.114.114.114'
    }
    if url:
        headers['Referer'] = url
    return headers

def sanitize_filename(name):
    return re.sub(r'[\\/*?:"<>|\s]', '_', name)

def is_junk_page(page_title, paragraphs, novel_name):
    # Normalize inputs for easy matching
    title_clean = page_title.strip() if page_title else ""
    novel_clean = novel_name.strip() if novel_name else ""
    
    # 2. 书名判定 (如果标题等于 《书名》，或只有一个书名，或者标题完全是《书名》)
    # 去除书名号进行比较
    novel_plain = re.sub(r'[《》]', '', novel_clean).strip()
    title_plain = re.sub(r'[《》]', '', title_clean).strip()
    if title_plain == novel_plain or title_plain == f"{novel_plain}小说":
        all_text = "".join(paragraphs).strip()
        all_text_plain = re.sub(r'[《》\s]', '', all_text)
        if len(all_text_plain) < 150:
            return True, "页面只是书名且内容极少"

    # 3. 正文垃圾内容判定 (如果很多 《 》 或大量非正文小说推荐字符)
    all_text = "".join(paragraphs)
    book_tags_count = len(re.findall(r'《[^》]+》', all_text))
    # 统计含有推荐相关信息的行比例
    recommend_count = sum(1 for p in paragraphs if any(k in p for k in ['推荐', '好书', '经典', '作者：', '加入书架']))
    
    if len(paragraphs) > 0:
        if book_tags_count >= 3 and (recommend_count / len(paragraphs)) > 0.5:
            return True, "正文包含大量书单推荐内容"
        if "更多精彩小说" in all_text or "精彩小说推荐" in all_text:
            return True, "正文包含精彩小说推荐特征"
            
    # 4. 如果正文根本没有汉字或汉字极其稀疏，判定为垃圾
    all_filtered_text = "".join(paragraphs).strip()
    chinese_chars = len(re.findall(r'[\u4e00-\u9fa5]', all_filtered_text))
    if len(all_filtered_text) > 0 and chinese_chars / len(all_filtered_text) < 0.2:
        return True, "汉字密度过低，非正常小说正文"

    # 5. 如果字数过少且非特殊章节 (引子 / 序 / 第一章 等)
    if len(all_filtered_text) < 40 and not any(ch in title_clean for ch in ['第一章', '第1章', '序言', '引子']):
        return True, f"正文内容字数极少 ({len(all_filtered_text)} 字)"

    return False, ""

def cleanup_file_one_line_chapters(txt_path, log_callback=None):
    if not os.path.exists(txt_path):
        return
    try:
        with open(txt_path, 'r', encoding='utf-8') as f:
            content = f.read()
        
        separator = "=" * 40
        parts = content.split(separator)
        
        if len(parts) < 3:
            return
            
        new_parts = [parts[0]] # 保持书名、作者等元数据
        i = 1
        removed_count = 0
        novel_name = ""
        first_part = parts[0]
        title_match = re.search(r'《([^》]+)》', first_part)
        if title_match:
            novel_name = title_match.group(1).strip()
            
        while i < len(parts) - 1:
            header_part = parts[i]
            body_part = parts[i+1]
            
            body_lines = [line.strip() for line in body_part.split('\n') if line.strip()]
            
            # 提取 header 中的标题文字
            title_text = ""
            header_match = re.search(r'【第\s*\d+\s*页】:\s*(.*)', header_part)
            if header_match:
                title_text = header_match.group(1).strip()
            
            body_text_clean = "".join(body_lines).strip()
            total_chars = len(body_text_clean)
            
            is_junk = False
            reason = ""
            if total_chars < 100:
                is_junk = True
                reason = f"分页字数小于100字（当前共 {total_chars} 字）"
            else:
                # 使用 feels_like_junk 检测逻辑
                paras_for_check = [line for line in body_lines]
                is_junk, reason = is_junk_page(title_text, paras_for_check, novel_name)
                
            if is_junk:
                removed_count += 1
                i += 2
                continue
                
            new_parts.append(header_part)
            new_parts.append(body_part)
            i += 2
            
        if removed_count > 0:
            # 重新生成内容，并重排序页码
            renumbered_parts = [new_parts[0]]
            current_page_idx = 1
            
            j = 1
            while j < len(new_parts) - 1:
                hdr = new_parts[j]
                bdy = new_parts[j+1]
                
                # 重新修正页码为连续顺序
                fixed_hdr = re.sub(r'【第\s*\d+\s*页】', f"【第 {current_page_idx} 页】", hdr)
                renumbered_parts.append(fixed_hdr)
                renumbered_parts.append(bdy)
                
                current_page_idx += 1
                j += 2
                
            new_content = separator.join(renumbered_parts)
            with open(txt_path, 'w', encoding='utf-8') as f:
                f.write(new_content)
            if log_callback:
                log_callback(f"🧹 后置清理：已从最终文本中自动剔除 {removed_count} 个不正确/推荐/少字数的非正文章节，并对章节页码重新排列了顺序。")
    except Exception as e:
        if log_callback:
            log_callback(f"🧹 后置清理执行异常: {e}")

def get_url_hash(url):
    return hashlib.md5(url.encode('utf-8')).hexdigest()

def is_same_domain(url1, url2):
    try:
        from urllib.parse import urlparse
        return urlparse(url1).netloc.replace('www.', '') == urlparse(url2).netloc.replace('www.', '')
    except:
        return False

def extract_content_div(soup):
    """
    Precision content block finder using specialized selector ordering.
    """
    selectors = [
        'div.book_con.fix#text', # 52shuku specific
        '#booktxt',
        '#book-txt',
        '.booktxt',
        'div.read-content',
        '#chaptercontent',
        '.chaptercontent',
        '#chapter-content',
        '.chapter-content',
        '.show_txt',
        'div.show_txt',
        '#BookText',
        '#bookText',
        '#htmlContent',
        '#htmlcontent',
        '#txtContent',
        '#txt',
        'div.main-text',
        'div.maintext',
        '.main-text',
        '.maintext',
        '#content',
        '.content',
        '#article-content',
        '.article-content',
        'article.article-content',
        '#article',
        '.box_con #content',
        '.book_content',
        '.post-content',
        'div.main_content',
        'td[width="820"]',
        'div.text_c',
        '.nr_jianjie',
        'div.panel-body',
        'div.novelcontent',
        '.read_txt',
        '#read-content',
        '#txt_content',
        '.txt_content',
        'td p'
    ]
    
    for selector in selectors:
        elem = soup.select_one(selector)
        if elem:
            text_len = len(elem.get_text(strip=True))
            if text_len > 100:
                # Basic link density check (avoid selecting menu/directories by mistake)
                a_elems = elem.find_all('a')
                a_len = sum(len(a.get_text(strip=True)) for a in a_elems)
                if a_len < text_len * 0.4:
                    return elem
                    
    # Fallback to smart text density algorithm
    best_score = 0
    best_elem = None
    
    for elem in soup.find_all(['div', 'article', 'section', 'td']):
        cls = elem.get('class', [])
        id_name = elem.get('id', '')
        if isinstance(cls, list): 
            cls = ' '.join(cls)
        cls_lower = cls.lower() if cls else ''
        id_lower = id_name.lower() if id_name else ''
        
        # Skip lists, catalogs, headers, footers, sidebars, comments
        skip_words = [
            'header', 'footer', 'nav', 'menu', 'sidebar', 'aside', 'comment', 
            'reply', 'catalog', 'recommend', 'mulu', 'list', 'page-links', 
            'pagination', 'ads', 'ad-container', 'button', 'form'
        ]
        if any(w in cls_lower or w in id_lower for w in skip_words):
            continue
            
        text = elem.get_text()
        text_strip = text.strip()
        text_len = len(text_strip)
        
        if text_len < 100: 
            continue
            
        a_text_len = sum(len(a.get_text().strip()) for a in elem.find_all('a'))
        if text_len > 0 and (a_text_len / text_len) > 0.25:
            continue
            
        p_count = len(elem.find_all('p'))
        br_count = len(elem.find_all('br'))
        
        # Reward structure & filter by Chinese character presence to verify it's the real novel content
        chinese_chars_count = len(re.findall(r'[\u4e00-\u9fa5]', text_strip))
        if chinese_chars_count < text_len * 0.2:
            continue
            
        score = text_len + (p_count * 20) + (br_count * 10)
        
        if score > best_score:
            best_score = score
            best_elem = elem
            
    if best_elem and best_score > 100:
        return best_elem
        
    return None

def extract_chapter_title(soup, novel_name, default_title):
    title_selectors = [
        'h1.chapter-title', 'h1.title', '.chapter-name', '.chapter_title',
        'h2.chapter-title', 'h2.title', '.chapterTitle', '#title', 'div.title h1'
    ]
    for sel in title_selectors:
        elem = soup.select_one(sel)
        if elem:
            t = elem.get_text().strip()
            if t and t != novel_name and len(t) < 100:
                return t
                
    candidates = []
    for tag in ['h1', 'h2', 'h3', 'strong']:
        for elem in soup.find_all(tag):
            t = elem.get_text().strip()
            if not t or len(t) > 100:
                continue
            if t == novel_name or t + '小说' == novel_name or '目录' in t or '首页' in t:
                continue
            candidates.append(t)
            
    for c in candidates:
        if re.search(r'第\s*\d+\s*[章节回卷折幕]', c) or re.search(r'第[一二三四五六七八九十百千万零]+\s*[章节回卷折幕]', c):
            return c
            
    if candidates:
        return candidates[0]
        
    return default_title

def extract_paragraphs(content_div):
    paragraphs = []
    
    # Clean up standard junk tags inside the content div first
    unwanted_selectors = [
        '#content_tip', '.content_tip', 'script', 'style', 'iframe', 'button', 'input', 'form', 'nav', 'ins',
        '.ad', '.ads', '.adsbygoogle', '.bottom-ad', '.top_ad', '.read_ad',
        '.sidebar', '.comment', '.reply', '#comments', '#reply-box',
        'a[href*="next"]', 'a[href*="mulu"]', 'a[href*="chapter"]', 'a[href*="page"]'
    ]
    for selector in unwanted_selectors:
        for elem in content_div.select(selector):
            elem.decompose()
            
    # Remove standard action links
    for a in content_div.find_all('a'):
        a_text = a.get_text().strip()
        if any(k in a_text for k in ['下一页', '下一章', '上一页', '上一章', '返回目录', '加入书架', '报错', '举报', '点击下载']):
            a.decompose()

    # Try extracting all <p> tags
    p_tags = content_div.find_all('p')
    if p_tags and len(p_tags) > 3:
        for p in p_tags:
            text = p.get_text().strip()
            if text:
                paragraphs.append(text)
    else:
        # Split by <br> tags
        html = str(content_div)
        html_clean = re.sub(r'<br\s*/?>', '\n', html, flags=re.I)
        temp_soup = BeautifulSoup(html_clean, 'html.parser')
        raw_text = temp_soup.get_text()
        for line in raw_text.split('\n'):
            text = line.strip()
            if text:
                paragraphs.append(text)
                
    filtered_paragraphs = []
    junk_keywords = [
        '52书库', '52shuku', '传送门', 'APP下载', '半夏小说', 'xbanxia', 'kanunu8', 
        '看书吧', 'www.', '.com', '.net', '本站域名', '2wxsi', '爱文学', 
        '喜欢就分享', '收藏本页', '返回首页', '点此报错', '举报反馈',
        '微信', '公众号', '扫码', '关注', '加入书架', '推荐书目', '最新章节',
        '下一页', '上一页', '点击下一页继续', '本章未完', '未完待续', '亲们',
        '首发', '无广告', 'txt下载', '免费阅读', '最新首发'
    ]
    
    for p in paragraphs:
        p_lower = p.lower()
        if 'http://' in p_lower or 'https://' in p_lower or 'www.' in p_lower:
            continue
        if any(junk.lower() in p_lower for junk in junk_keywords):
            continue
        p_clean = re.sub(r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}', '', p)
        p_clean = p_clean.strip()
        if p_clean:
            filtered_paragraphs.append("　　" + p_clean)
            
    return filtered_paragraphs

def find_subpage_link(soup, current_url, links_set):
    for a in soup.find_all('a', href=True):
        text = a.get_text().strip()
        href = a['href']
        if not href or href.startswith('#') or href.startswith('javascript:'):
            continue
            
        full_url = urljoin(current_url, href)
        if full_url in links_set:
            continue
            
        text_lower = text.lower()
        if ('下一页' in text_lower or '下页' in text_lower or '余下全文' in text_lower or '继续阅读' in text_lower or '下一节' in text_lower) and not ('下一章' in text_lower or '下章' in text_lower or '下一章' in text or '下一章节' in text):
            return full_url
            
    return None

def find_next_page_link(soup, current_url, is_52shuku=False):
    # 方法1：直接查找文本为“下一页”的链接
    next_a = soup.find('a', string=re.compile(r'下一页|下页|下一章'))
    if next_a and next_a.get('href'):
        href = next_a['href']
        if is_52shuku and href.endswith('/'): return None # 52shuku 下一页如果跳回目录通常是一级结尾
        return urljoin(current_url, href)

    # 方法2：查找 rel="next"
    next_a = soup.find('a', attrs={'rel': 'next'})
    if next_a and next_a.get('href'):
        return urljoin(current_url, next_a['href'])

    # 方法3：查找 class 包含 next 的链接
    for a in soup.find_all('a', class_=re.compile(r'next', re.I)):
        if a.get('href'):
            return urljoin(current_url, a['href'])

    # 方法4：查找文本包含“下一页”的任何链接
    for a_elem in soup.find_all('a', href=True):
        text = a_elem.get_text().strip()
        if '下一页' in text or '下页' in text or '下一章' in text:
            return urljoin(current_url, a_elem['href'])

    return None

# ==================== 核心逻辑 ====================

class DummySession:
    def get(self, url, headers=None, timeout=15, proxies=None, verify=False):
        req_headers = dict(headers or {})
        target_url = url
        
        # 00小说网针对海外/非大陆IP在CDN层进行阻断
        # 直接直连HTTPS源站 23.224.90.121 并携带 Host: www.00shu.info 可稳定穿透阻断
        if '00shu' in target_url or '23.224.90' in target_url:
            req_headers['Host'] = 'www.00shu.info'
            req_headers['X-Forwarded-For'] = '114.114.114.114'
            req_headers['X-Real-IP'] = '114.114.114.114'
            req_headers['Client-IP'] = '114.114.114.114'
            target_url = re.sub(r'https?://(?:www\.)?00shu\.(?:info|la|cc|com)', 'https://23.224.90.121', target_url)
            target_url = re.sub(r'http://23\.224\.90\.\d+', 'https://23.224.90.121', target_url)
            verify = False

        req = urllib.request.Request(target_url, headers=req_headers)
        
        ctx = ssl.create_default_context()
        if not verify:
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
            
        handlers = [urllib.request.HTTPSHandler(context=ctx)]
        
        if proxies and 'http' in proxies:
            handlers.append(urllib.request.ProxyHandler(proxies))
            
        opener = urllib.request.build_opener(*handlers)
        
        try:
            resp = opener.open(req, timeout=timeout)
            class DummyResponse:
                def __init__(self, r):
                    self.status_code = r.getcode()
                    self.raw_data = r.read()
                    self.headers = r.headers
                    self._text = None
                    self.encoding = None
                    ctype = self.headers.get("Content-Type", "")
                    if "charset=" in ctype.lower():
                        try:
                            self.apparent_encoding = ctype.lower().split("charset=")[1].split(';')[0].strip()
                        except:
                            self.apparent_encoding = None
                    else:
                        self.apparent_encoding = None

                @property
                def text(self):
                    if self._text is None:
                        enc = self.encoding or self.apparent_encoding or 'utf-8'
                        try:
                            self._text = self.raw_data.decode(enc)
                        except UnicodeDecodeError:
                            try:
                                self._text = self.raw_data.decode('gbk')
                            except:
                                self._text = self.raw_data.decode('utf-8', errors='ignore')
                    return self._text
            return DummyResponse(resp)
        except urllib.error.HTTPError as e:
            class DummyResponseErr:
                status_code = e.code
                text = ""
                def __init__(self, e):
                    self.status_code = e.code
                    try:
                        self.text = e.read().decode('utf-8', errors='ignore')
                    except:
                        pass
            return DummyResponseErr(e)

def fetch_html(session, url, headers=None, proxy=None, retries=3):
    # 将 00shu 旧域名或旧 IP 统一映射为当前官方活跃的 https://www.00shu.info
    target_url = url
    if '00shu' in target_url or '23.224.90' in target_url:
        target_url = re.sub(r'https?://(?:www\.)?00shu\.(?:la|cc|com|info)', 'https://www.00shu.info', target_url)
        target_url = re.sub(r'https?://23\.224\.90\.\d+', 'https://www.00shu.info', target_url)

    if not headers:
        headers = get_random_headers(target_url)
    
    current_proxy = proxy
    if not current_proxy and PROXY_POOL:
        current_proxy = random.choice(PROXY_POOL)
        
    for attempt in range(retries):
        try:
            proxies = {'http': current_proxy, 'https': current_proxy} if current_proxy else None
            resp = session.get(target_url, headers=headers, timeout=15, proxies=proxies, verify=False)
            
            if resp.status_code == 200:
                # 检查常见的防护页面特征
                challenge_keywords = ["安全验证", "Cloudflare", "5秒", "浏览器安全性检查", "请稍候", "Checking your browser", "Verification"]
                if any(k in resp.text for k in challenge_keywords) and len(resp.text) < 5000:
                    print(f"Detected block/challenge for {target_url} (Attempt {attempt+1})")
                    if attempt < retries - 1:
                        time.sleep(6) # 稍微多等一会儿让挑战过期
                        continue
                
                if 'kanunu8.com' in target_url:
                    resp.encoding = 'gbk'
                elif 'xbanxia.cc' in target_url:
                    resp.encoding = 'utf-8'
                elif '00shu' in target_url or '23.224.90' in target_url:
                    resp.encoding = 'utf-8'
                else:
                    resp.encoding = resp.apparent_encoding if resp.apparent_encoding else 'utf-8'
                
                text = resp.text
                if '00shu' in target_url or '23.224.90' in target_url:
                    text = re.sub(r'https?://(?:www\.)?00shu\.(?:la|cc|com)', 'https://www.00shu.info', text)
                    text = re.sub(r'https?://23\.224\.90\.\d+', 'https://www.00shu.info', text)
                
                return text
            
            print(f"Fetch failed with status {resp.status_code} for {target_url} (Attempt {attempt+1}/{retries})")
            if resp.status_code in [403, 503, 429]: # Likely blocked or rate limited
                time.sleep(3 * (attempt + 1))
            
        except Exception as e:
            print(f"Fetch Error ({target_url}) Attempt {attempt+1}/{retries}: {e}")
            if attempt < retries - 1:
                time.sleep(2 * (attempt + 1))
            else:
                return None
    return None

def parse_author_page(author_url, log_callback=None, proxy=None):
    """解析作者页作品列表"""
    session = DummySession()
    
    # 在抓取作者页前稍微等待，特别是频繁解析时
    time.sleep(1)
    
    # 确保 URL 中的非 ASCII 字符被正确编码
    from urllib.parse import quote, urlparse
    parsed = urlparse(author_url)
    author_url = f"{parsed.scheme}://{parsed.netloc}{quote(parsed.path)}"
    if parsed.query:
        author_url += f"?{parsed.query}"
    
    html = fetch_html(session, author_url, proxy=proxy)
    if not html: 
        # 尝试再次获取，可能需要换个 UA 
        html = fetch_html(session, author_url, proxy=proxy)
        if not html:
            raise Exception(f"无法获取作者页: {author_url}。可能是被拦截或地址错误。建议使用代理。")
    
    soup = BeautifulSoup(html, 'html.parser')
    author_name = "未知作者"
    
    # 尝试多种作者名获取方式
    bc = soup.select_one('div.breadcrumbs, .breadcrumb, .place')
    if bc:
        match = re.search(r'([^\s>]+)(?:小说作品|的全部作品|的小說作品)', bc.text)
        if match: author_name = match.group(1)
    
    if author_name == "未知作者":
        h1 = soup.find('h1')
        if h1: 
            author_name = h1.text.replace('的全部小说作品', '').replace('的全部小說作品', '').strip()
    
    if author_name == "未知作者":
        title_tag = soup.find('title')
        if title_tag:
            match = re.search(r'^(.+?)(?:小说作品|的全部作品|的小說作品)', title_tag.text)
            if match: author_name = match.group(1).strip()

    works = []
    # 针对不同站点的特殊处理
    if '23.224.90.123' in author_url or '00shu.la' in author_url:
        for a in soup.select('td.odd a, td a'):
            title = a.get_text(strip=True)
            href = a.get('href')
            if href and title and len(title) > 0 and not href.endswith('.html'):
                if '00shu.la' in href or re.search(r'/\d+/\d+/?$', href):
                    # Replace 00shu.la with the IP if accessed via IP
                    if '23.224.90.123' in author_url:
                        href = href.replace('https://www.00shu.la', 'http://23.224.90.123').replace('http://www.00shu.la', 'http://23.224.90.123')
                    elif not href.startswith('http'):
                        href = urljoin(author_url, href)
                    print(f"Adding work: {title} {href}")
                    works.append({'title': title, 'url': href})

    if 'xbanxia' in author_url or 'xs.qh.ci' in author_url or 'tt.qh.ci' in author_url:
        # 半夏小说列表改进：支持更多层级和样式
        # 常见结构: <div class="list"> <ul> <li> <a href="...">...</a> </li> </ul> </div>
        # 或 <div class="book-item"> <h3> <a ...> </h3> </div>
        for a in soup.select('div.list li a, .list a, .book-item a, .book-list a, .bookname a, .item a, .novelslist2 li span.s2 a'):
            title = a.get_text(strip=True)
            href = a.get('href')
            if href and title and len(title) > 1:
                # 过滤掉非书籍链接
                if any(x in href for x in ['/books/', '/book/', '/novel/', '/info/']) or re.search(r'/\d+(?:_\d+)?/?$', href) or re.search(r'/\w+/\d+/?$', href):
                    works.append({'title': title, 'url': urljoin(author_url, href)})
    
    # 通用的选择器兜底
    if not works:
        selectors = [
            'article.excerpt header h2 a', 
            'div.mulu-list ul li a',
            '.book-list ul li a',
            '.book-item a',
            'li a[href*="/books/"]',
            'li a[href*="/book/"]',
            'li a[href*="/book5/"]',
            '.author-works a',
            'td a[href*="/book"]'
        ]
        
        for sel in selectors:
            for a in soup.select(sel):
                title = a.get_text(strip=True)
                href = a.get('href')
                if href and len(title) > 1:
                    if 'books/' in href or 'book/' in href or 'novel' in href:
                        title = re.sub(r'^\d+\.\s*', '', title)
                        works.append({'title': title, 'url': urljoin(author_url, href)})
    
    unique_works = []
    seen = set()
    for w in works:
        if w['url'] not in seen:
            seen.add(w['url'])
            unique_works.append(w)
            
    return author_name, unique_works

def run_crawler(start_url, output_dir, log_callback=None, override_name=None, 
                override_author=None, existing_chapter_hashes=None, proxy=None):
    """主抓取流程"""
    session = DummySession()
    
    html = fetch_html(session, start_url, proxy=proxy)
    if not html: return None, None, None
    
    soup = BeautifulSoup(html, 'html.parser')
    
    h1 = soup.find('h1')
    title_raw = h1.text.strip() if h1 else "Unknown"
    novel_name = override_name if override_name else title_raw.split('_')[0].split('(')[0].split(',')[0].strip()
    author_name = override_author if override_author else "佚名" # 默认抓取没做作者解析，这里支持覆盖
    safe_name = sanitize_filename(novel_name)
    
    # 检测是否适合动态“下一页”抓取模式
    content_div = extract_content_div(soup)
    
    is_52shuku = '52shuku.net' in start_url
    next_page_link = find_next_page_link(soup, start_url, is_52shuku)
    
    if is_52shuku and not content_div:
        # Detect directory page, grab first chapter for dynamic crawling bypass
        first_chapter_url = None
        base_match = re.search(r'([a-zA-Z0-9]+)\.html', start_url)
        if base_match:
            book_id = base_match.group(1)
            pattern = rf'href=[\"\']([^\"\']*{re.escape(book_id)}(?:_\d+)?\.html)[\"\']'
            found_links = []
            for match in re.finditer(pattern, html):
                found_links.append(urljoin(start_url, match.group(1)))
            if found_links:
                found_links = list(set(found_links))
                if start_url in found_links: found_links.remove(start_url)
                if found_links:
                    # Sort to find the first chapter, usually ends with _2.html or similar
                    def s_key(u):
                        m = re.search(r'_(\d+)\.html$', u)
                        return int(m.group(1)) if m else 0
                    first_chapter_url = sorted(found_links, key=s_key)[0]
        
        if first_chapter_url:
            if log_callback: log_callback(f"检测到目录页，跳转至第一页启动动态抓取: {first_chapter_url}")
            start_url = first_chapter_url
            html = fetch_html(session, start_url, proxy=proxy)
            if html:
                soup = BeautifulSoup(html, 'html.parser')
                content_div = extract_content_div(soup)
                next_page_link = find_next_page_link(soup, start_url, is_52shuku)

    use_dynamic = False
    if is_52shuku and content_div and next_page_link:
        use_dynamic = True
    elif content_div and next_page_link:
        use_dynamic = True
        
    if use_dynamic:
        if log_callback: log_callback(f"开始抓取: {novel_name}")
        if log_callback: log_callback("采用动态“下一页”模式抓取")
        
        full_content = []
        os.makedirs(output_dir, exist_ok=True)
        txt_path = os.path.join(output_dir, f"{safe_name}.txt")
        
        current_url = start_url
        visited = set()
        page_num = 0
        saved_page_count = 0
        
        current_html = html
        current_soup = soup
        
        all_chapter_hashes = []
        if existing_chapter_hashes:
            all_chapter_hashes.extend(existing_chapter_hashes)
            
        while current_url and current_url not in visited:
            visited.add(current_url)
            page_num += 1
            
            if log_callback: log_callback(f"处理中 [{page_num}/?] : {current_url}")
            
            c_div = extract_content_div(current_soup)
            
            is_valid_chapter = False
            paragraphs = []
            page_title = f"第 {page_num} 页"
            if c_div:
                page_title = extract_chapter_title(current_soup, novel_name, f"第 {page_num} 页")
                paragraphs = extract_paragraphs(c_div)
                
                is_junk, reason = is_junk_page(page_title, paragraphs, novel_name)
                if is_junk:
                    if log_callback: log_callback(f"⚠️ 过滤不正确或推荐页面: {page_title} 原因: {reason}")
                elif len(paragraphs) > 1:
                    is_valid_chapter = True
                else:
                    if log_callback: log_callback(f"⚠️ 页面的正文行数仅为 {len(paragraphs)} 行 (只有一两行或无内容)，已被判定为不正确章节，做过滤处理。")
            
            if is_valid_chapter:
                saved_page_count += 1
                all_chapter_hashes.append(get_url_hash(current_url))
                separator_line = "=" * 40
                page_header = f"\n\n{separator_line}\n【第 {saved_page_count} 页】: {page_title}\n{separator_line}\n\n"
                full_content.append(page_header + "\n\n".join(paragraphs))
            
            next_url = find_next_page_link(current_soup, current_url, is_52shuku)
            
            if is_52shuku and next_url:
                base_match = re.search(r'([a-zA-Z0-9]+)(?:_\d+)?\.html', start_url)
                if base_match:
                    book_id = base_match.group(1)
                    if book_id not in next_url:
                        next_url = None
            
            if next_url and not is_same_domain(start_url, next_url):
                if log_callback: log_callback(f"下一页域名不匹配，停止：{next_url}")
                next_url = None
            
            if not next_url:
                if log_callback: log_callback("未发现有效下一页链接，结束当前小说抓取。")
                break
                
            current_url = next_url
            time.sleep(random.uniform(0.5, 1.5))
            
            p_html = fetch_html(session, current_url, proxy=proxy)
            if not p_html:
                break
            current_soup = BeautifulSoup(p_html, 'html.parser')

        with open(txt_path, "a" if existing_chapter_hashes else "w", encoding="utf-8") as f:
            if not existing_chapter_hashes: 
                header = f"《{novel_name}》\n"
                if author_name and author_name != "佚名":
                    header += f"作者：{author_name}\n"
                header += "\n"
                f.write(header)
            f.write("\n\n".join(full_content))
            
        cleanup_file_one_line_chapters(txt_path, log_callback)
            
        return novel_name, txt_path, all_chapter_hashes

    # ==================== 提取目录链接 ====================
    links = []
    
    # 特别针对 52shuku.net 的目录提取
    if '52shuku.net' in start_url:
        # 正则表达式兜底提取所有直接相关的分页链接
        # 允许相对路径和绝对路径
        base_match = re.search(r'([a-zA-Z0-9]+)(?:_\d+)?\.html', start_url)
        if base_match:
            book_id = base_match.group(1)
            # 匹配包含 book_id 的 html 链接，比如 bjZ2n.html or bjZ2n_2.html
            # 甚至是相对路径 /yanqing/18_b/bjZ2n_2.html
            pattern = rf'href=[\"\']([^\"\']*{re.escape(book_id)}(?:_\d+)?\.html)[\"\']'
            for match in re.finditer(pattern, html):
                href = match.group(1)
                full_url = urljoin(start_url, href)
                if full_url not in links: links.append(full_url)
                
        # 52shuku 的目录通常在 <ul class="list clearfix"> <li> <a ...> 
        # 或者 <div class="list"> 下的链接
        # 特别注意有些目录页同时也包含了第一页内容
        for a in soup.select('ul.list li a, .list li a, div.list a, #list a, .mulu a, .book-list a'):
            href = a.get('href')
            if href and ('.html' in href or re.search(r'_\d+\.html$', href)):
                # 排除一些非正文链接
                title = a.get_text(strip=True)
                if not any(x in title for x in ['首页', '返回', '书评', '下载', '投诉', 'APP']):
                    full_url = urljoin(start_url, href)
                    if full_url not in links: links.append(full_url)
        
        # 针对有些直接是正文第一页的情况，提取底部的翻页/分页导航
        if not links or len(links) < 5:
            pagination = soup.select('.pagination a, .pagination2 a, .page-links a, .mulu-list a, .list a')
            for a in pagination:
                href = a.get('href')
                if href and ('.html' in href or re.search(r'_\d+\.html', href)):
                    full_url = urljoin(start_url, href)
                    if full_url not in links: links.append(full_url)
            
            # 如果能从链接中推断出结尾页，自动补全所有的分页列表
            base_url_match = re.search(r'^(.*?)(?:_\d+)?\.html', start_url)
            if base_url_match:
                base_url = base_url_match.group(1)
                max_page = 1
                for link in links:
                    m = re.search(r'_(\d+)\.html', link)
                    if m:
                        page_num = int(m.group(1))
                        if page_num > max_page:
                            max_page = page_num
                
                if max_page > 1:
                    for i in range(1, max_page + 1):
                        p_url = f"{base_url}_{i}.html" if i > 1 else f"{base_url}.html"
                        if p_url not in links: links.append(p_url)
        
        # 排除掉起始页自身（如果已经在列表中，移动到第一位）
        if start_url in links:
            links.remove(start_url)
        
        # 对于 52shuku.net，过滤掉纯目录页（没有 _数字.html 且在当前获取中没有正文框）
        is_52shuku_dir_only = False
        if '52shuku.net' in start_url:
            if not soup.select_one('div.book_con.fix#text'):
                is_52shuku_dir_only = True
            
            # 删除所有被错误添加的没有尾缀的可能是纯目录的链接
            base_url_match = re.search(r'^(.*?)(?:_\d+)?\.html', start_url)
            if base_url_match:
                dir_url = f"{base_url_match.group(1)}.html"
                if dir_url in links and start_url != dir_url:
                    links.remove(dir_url)
                    
        if not is_52shuku_dir_only:
            links.insert(0, start_url)
        
        # 排序：确保 _2.html 在 _10.html 之前
        def sort_key(url):
            match = re.search(r'_(\d+)\.html$', url)
            if match: return int(match.group(1))
            return 0
        
        if len(links) > 1:
            # 只有当链接看起来像是分页（带有 _数字.html）时才排序
            if any('_' in l for l in links[1:]):
                first = links[0]
                rest = sorted(links[1:], key=sort_key)
                links = [first] + rest

        # 去重并保持顺序
        seen = set()
        links = [x for x in links if not (x in seen or seen.add(x))]

        # 如果提取出的链接太少且不包含 _ 数字，可能这不是目录页而是单页
    
    # 特别针对 xbanxia.cc 的目录提取
    if 'xbanxia.cc' in start_url:
        # 半夏一般在 <div id="list"> 下的 <a href="...">
        # 或者 <div class="list">
        for a in soup.select('#list a, .list a, div.list ul li a'):
            href = a.get('href')
            if href and ('.html' in href or re.search(r'/\d+/\d+\.html', href)):
                full_url = urljoin(start_url, href)
                if full_url not in links: links.append(full_url)
    
    # 针对 2wxsi.com 的目录提取
    if '2wxsi' in start_url:
        for a in soup.select('.book-item a, .book-list a, .list a, .item a'):
            href = a.get('href')
            if href and ('.html' in href or re.search(r'/\d+/\d+/?$', href)):
                full_url = urljoin(start_url, href)
                if full_url not in links: links.append(full_url)
    
    # ==================== 新增：针对 2kzw.la 的目录提取 ====================
    if 'xs.qh.ci' in start_url or 'tt.qh.ci' in start_url or '2kzw.la' in start_url:
        # 使用 dd a 选择器提取所有章节链接
        for a in soup.select('dd a, .list a, .book-list a, .book-item a'):
            href = a.get('href')
            if href and not href.startswith('#') and not href.startswith('javascript:'):
                full_url = urljoin(start_url, href)
                if full_url not in links:
                    links.append(full_url)
        # 按链接中的数字 ID 排序（2kzw.la 的 URL 格式为 .../数字.html）
        def numeric_key(url):
            match = re.search(r'/(\d+)\.html$', url)
            return int(match.group(1)) if match else 0
        if links:
            links.sort(key=numeric_key)
        # 如果成功提取到链接，则跳过后续的通用提取逻辑
        if links:
            # 小说名优化：若 h1 不准确，尝试从 title 中提取
            if novel_name == "Unknown" or len(novel_name) < 2:
                title_tag = soup.find('title')
                if title_tag:
                    title_text = title_tag.get_text().strip()
                    # 格式如 "你或像你的人_明开夜合_2k小说"
                    parts = re.split(r'[_\-|]', title_text)
                    novel_name = max(parts, key=len).strip() if len(parts) >= 2 else parts[0].strip()
                    safe_name = sanitize_filename(novel_name)
            # 作者提取（可选，如果不提供覆盖）
            if author_name == "佚名" and not override_author:
                # 尝试从 title 中提取作者
                title_tag = soup.find('title')
                if title_tag:
                    title_text = title_tag.get_text().strip()
                    parts = re.split(r'[_\-|]', title_text)
                    if len(parts) >= 2:
                        # 假设第二部分是作者
                        author_name = parts[1].strip()
            # 直接跳转到链接处理，不再执行后面的通用选择器
            pass  # 注意：不能直接 return，需要继续往下走到链接处理部分
    # ===================================================================

    # ==================== 新增：针对 00小说网 (00shu.info) 的目录提取 ====================
    if '00shu' in start_url or '23.224.90' in start_url:
        for a in soup.select('#list dd a, #list a, dl dd a'):
            href = a.get('href')
            if href and not href.startswith('#') and not href.startswith('javascript:'):
                full_url = urljoin(start_url, href)
                full_url = re.sub(r'https?://(?:www\.)?00shu\.(?:la|cc|com)', 'https://www.00shu.info', full_url)
                full_url = re.sub(r'https?://23\.224\.90\.\d+', 'https://www.00shu.info', full_url)
                if full_url not in links:
                    links.append(full_url)
        def shu_numeric_key(url):
            match = re.search(r'/(\d+)\.html$', url)
            return int(match.group(1)) if match else 0
        if links:
            links.sort(key=shu_numeric_key)
            if novel_name == "Unknown" or len(novel_name) < 2:
                h1_el = soup.select_one('#info h1, h1')
                if h1_el:
                    novel_name = h1_el.get_text().strip()
                    safe_name = sanitize_filename(novel_name)
    # ===================================================================
    
    if not links:
        dir_selectors = [
            'ul.list.clearfix li.mulu a',
            '#list dd a',
            '.book-list ul li a',
            '#chapterlist li a',
            '.section-list li a',
            'td a[href*=".html"]'
        ]
        
        found_links = []
        for sel in dir_selectors:
            found_links.extend(soup.select(sel))
        
        if found_links:
            for a in found_links:
                full_url = urljoin(start_url, a.get('href'))
                if full_url not in links: links.append(full_url)
        else:
            links = [start_url]

    if log_callback: log_callback(f"开始抓取: {novel_name}")
    if log_callback: log_callback(f"找到 {len(links)} 个分页/章节")
    
    full_content = []
    os.makedirs(output_dir, exist_ok=True)
    txt_path = os.path.join(output_dir, f"{safe_name}.txt")
    
    all_chapter_hashes = []
    if existing_chapter_hashes:
        all_chapter_hashes.extend(existing_chapter_hashes)
        
    saved_page_count = 0
    for i, link in enumerate(links, 1):
        url_hash = get_url_hash(link)
        if existing_chapter_hashes and url_hash in existing_chapter_hashes:
            if log_callback: log_callback(f"跳过已抓取页 [{i}]: {link}")
            continue
            
        if log_callback: log_callback(f"处理中 [{i}/{len(links)}]: {link}")
        
        p_html = fetch_html(session, link, proxy=proxy)
        if p_html:
            p_soup = BeautifulSoup(p_html, 'html.parser')
            content_div = extract_content_div(p_soup)
            
            if content_div:
                page_title = extract_chapter_title(p_soup, novel_name, f"第 {i} 页")
                paragraphs = extract_paragraphs(content_div)
                
                is_junk, reason = is_junk_page(page_title, paragraphs, novel_name)
                if is_junk:
                    if log_callback: log_callback(f"⚠️ 过滤不正确或推荐页面: {page_title} 原因: {reason}")
                elif len(paragraphs) > 1:
                    saved_page_count += 1
                    # Record this chapter's hash
                    all_chapter_hashes.append(url_hash)
                    
                    separator_line = "=" * 40
                    page_header = f"\n\n{separator_line}\n【第 {saved_page_count} 页】: {page_title}\n{separator_line}\n\n"
                    
                    full_content.append(page_header + "\n\n".join(paragraphs))
                else:
                    if log_callback: log_callback(f"⚠️ 页面的正文行数仅为 {len(paragraphs)} 行 (只有一两行或无内容)，已被判定为不正确章节，做过滤处理。")
        
        # 频率限制
        time.sleep(random.uniform(0.3, 1.0))
    
    with open(txt_path, "a" if existing_chapter_hashes else "w", encoding="utf-8") as f:
        if not existing_chapter_hashes: 
            header = f"《{novel_name}》\n"
            if author_name and author_name != "佚名":
                header += f"作者：{author_name}\n"
            header += "\n"
            f.write(header)
        f.write("\n\n".join(full_content))
        
    cleanup_file_one_line_chapters(txt_path, log_callback)
    
    return novel_name, txt_path, all_chapter_hashes


def search_52shuku(query, proxy=None):
    """搜索 52书库 中的小说，返回解析出的列表"""
    import urllib.parse
    import urllib.request
    import ssl
    from bs4 import BeautifulSoup
    import re
    
    # 采用现代的 search.php GET 请求，UTF-8 URL 编码进行传参
    escaped_query = urllib.parse.quote(query.strip())
    url = f"https://www.52shuku.net/so/search.php?q={escaped_query}"
    
    headers = get_random_headers(url)
    
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    
    handlers = [urllib.request.HTTPSHandler(context=ctx)]
    if proxy:
        handlers.append(urllib.request.ProxyHandler({'http': proxy, 'https': proxy}))
        
    opener = urllib.request.build_opener(*handlers)
    req = urllib.request.Request(url, headers=headers)
    
    try:
        resp = opener.open(req, timeout=15)
        raw_content = resp.read()
        
        # 现代 52shuku 应该都是 utf-8 编码的 search.php 页
        try:
            html = raw_content.decode('utf-8')
        except:
            html = raw_content.decode('gbk', errors='ignore')
            
    except Exception as e:
        raise Exception(f"请求搜索失败: {e}")
        
    soup = BeautifulSoup(html, 'html.parser')
    
    results = []
    
    # 解析 search results 里的推荐作品和书籍链接
    for a in soup.find_all('a'):
        href = a.get('href')
        if not href:
            continue
            
        full_href = urljoin("https://www.52shuku.net/", href)
        
        # 匹配书籍主页的链接结构：https://www.52shuku.net/category(subcategories)/book_id.html
        # 过滤掉 e, zuozhe, tag, index, about, etc. 目录
        match = re.search(r'https?://(?:www\.)?52shuku\.net/([a-zA-Z0-9_/-]+)/([a-zA-Z0-9]+)\.html$', full_href)
        if match:
            category = match.group(1)
            book_id = match.group(2)
            
            # 检查是否有排除项
            segments = category.split('/')
            if any(s in segments for s in ['e', 'zuozhe', 'tag', 'index', 'about', 'shuku', 'so', 'search']):
                continue
                
            text = a.get_text(strip=True)
            if not text or len(text) < 3:
                continue
                
            # 过滤包含垃圾/推荐词、同类推荐的项
            if any(junk in text for junk in ['推荐', '同类', '大家都在看', '更多作品', '热门作品', '排行榜']):
                continue
                
            original_text = text
            author = "未知"
            
            # 剔除序号前缀如 "1. " 或 "2."
            text_num_match = re.match(r'^\d+[\.\s\-、：:]*(.*)$', text)
            if text_num_match:
                text = text_num_match.group(1).strip()
            
            # 如果是 "书名_作者【完结】" 形式
            if '_' in text:
                parts = text.split('_')
                title_cand = parts[0].strip()
                author_part = parts[1].strip()
                # 剔除作者后的完结标志
                author_cand = re.sub(r'【[^】]+】|\([^)]+\)|（[^）]+）', '', author_part).strip()
                title = re.sub(r'【[^】]+】|\([^)]+\)|（[^）]+）', '', title_cand).strip()
                if author_cand:
                    author = author_cand
            else:
                title = text
                book_match = re.search(r'《([^》]+)》', text)
                if book_match:
                    title = book_match.group(1).strip()
                    
                author_match = re.search(r'(?:作者[：:]|by\s*|（|(?:\s*\())\s*([^\s（）()]+)(?:）|\)?|$)', text, re.IGNORECASE)
                if author_match:
                    val = author_match.group(1).strip()
                    if val and val != title and not any(x in val for x in ['小说', 'txt', '下载', '完结', '书库']):
                        author = val
                title = re.sub(r'【[^】]+】|\([^)]+\)|（[^）]+）', '', title).strip()
                    
            # 智能提取该作品项的周边简介描述信息 (如 parent 容器中的说明文本)
            desc = ""
            parent = a.find_parent('li') or a.find_parent('div')
            if parent:
                desc_el = parent.select_one('.smalltext, .desc, p, span.desc')
                if desc_el:
                    desc = desc_el.get_text(strip=True)
                    desc = desc.replace(original_text, "").strip()
                else:
                    ptxt = parent.get_text(strip=True)
                    ptxt_clean = ptxt.replace(original_text, "").strip()
                    if ptxt_clean:
                        desc = ptxt_clean[:120]
                        
            if not desc:
                desc = f"点击进入《{title}》极速抓取通道。"
                
            results.append({
                'title': title,
                'author': author,
                'category': category,
                'url': full_href,
                'desc': desc[:150]
            })
            
    # 按 URL 去重
    seen = set()
    unique_results = []
    for r in results:
        if r['url'] not in seen:
            seen.add(r['url'])
            unique_results.append(r)
            
    return unique_results


if __name__ == "__main__":
    import sys
    import json
    
    if len(sys.argv) > 1:
        if sys.argv[1] == "--test":
            proxy = sys.argv[2] if len(sys.argv) > 2 else None
            if not proxy:
                print(json.dumps({"success": False, "message": "未提供代理地址"}))
                sys.exit(0)
            
            session = DummySession()
            headers = get_random_headers("https://www.google.com")
            try:
                proxies = {'http': proxy, 'https': proxy}
                start_time = time.time()
                target_test = "http://www.baidu.com" if "xbanxia" not in (proxy or "") else "https://www.google.com"
                resp = session.get(target_test, headers=headers, timeout=10, proxies=proxies)
                elapsed = time.time() - start_time
                if resp.status_code == 200:
                    print(json.dumps({"success": True, "message": f"连接成功", "latency": round(elapsed, 3)}))
                else:
                    print(json.dumps({"success": False, "message": f"连接失败 (HTTP {resp.status_code})"}))
            except Exception as e:
                print(json.dumps({"success": False, "message": f"连接异常: {str(e)}"}))
            sys.exit(0)
        
        if sys.argv[1] == "--batch-test":
            from concurrent.futures import ThreadPoolExecutor, as_completed
            proxy_list = json.loads(sys.argv[2])
            test_target = sys.argv[3] if len(sys.argv) > 3 else "https://www.google.com"
            
            results = []
            def test_one(p):
                session = DummySession()
                headers = get_random_headers(test_target)
                try:
                    proxies = {'http': p, 'https': p}
                    start_time = time.time()
                    # 使用指定的测试目标
                    resp = session.get(test_target, headers=headers, timeout=5, proxies=proxies)
                    elapsed = time.time() - start_time
                    if resp.status_code == 200:
                        return {"proxy": p, "success": True, "latency": round(elapsed, 3)}
                except:
                    pass
                return {"proxy": p, "success": False, "latency": 999}

            with ThreadPoolExecutor(max_workers=15) as executor:
                futures = [executor.submit(test_one, p) for p in proxy_list]
                for future in as_completed(futures):
                    res = future.result()
                    if res["success"]:
                        results.append(res)
            
            # 按延迟排序
            results.sort(key=lambda x: x['latency'])
            print(json.dumps(results))
            sys.exit(0)

        if sys.argv[1] == "--debug":
            url = sys.argv[2]
            proxy = sys.argv[3] if len(sys.argv) > 3 else None
            session = DummySession()
            html = fetch_html(session, url, proxy=proxy)
            if not html:
                print(json.dumps({"success": False, "error": "Fetch failed"}))
                sys.exit(0)
            
            soup = BeautifulSoup(html, 'html.parser')
            links = []
            
            # Use the same logic as in run_crawler to find links
            base_match = re.search(r'([a-zA-Z0-9]+)(?:_\d+)?\.html', url)
            if base_match:
                book_id = base_match.group(1)
                pattern = rf'href=[\"\']([^\"\']*{re.escape(book_id)}(?:_\d+)?\.html)[\"\']'
                for match in re.finditer(pattern, html):
                    links.append(urljoin(url, match.group(1)))
            
            # Pagination links
            pagination = soup.select('.pagination a, .pagination2 a, .page-links a, .mulu-list a, .list a, ul.list li a')
            for a in pagination:
                links.append(urljoin(url, a.get('href')))
            
            unique_links = sorted(list(set([l for l in links if '.html' in l])))
            
            # Content check
            content_div = (
                soup.select_one('div.book_con.fix#text') or 
                soup.select_one('#article') or
                soup.select_one('#content') or
                soup.select_one('.content')
            )
            content_sample = content_div.get_text()[:1000] if content_div else "No content found"
            
            # Title
            h1 = soup.find('h1')
            title = h1.text.strip() if h1 else "Unknown"
            
            print(json.dumps({
                "success": True,
                "title": title,
                "len": len(html),
                "links_count": len(unique_links),
                "links_sample": unique_links[:50],
                "content_sample": content_sample
            }))
            sys.exit(0)

        if sys.argv[1] == "--search":
            query = sys.argv[2]
            proxy = sys.argv[3] if len(sys.argv) > 3 else None
            try:
                results = search_52shuku(query, proxy=proxy)
                print(json.dumps({"success": True, "results": results}, ensure_ascii=False))
            except Exception as e:
                print(json.dumps({"success": False, "error": str(e)}, ensure_ascii=False))
            sys.exit(0)

        if sys.argv[1] == "--author":
            author_url = sys.argv[2]
            proxy = sys.argv[3] if len(sys.argv) > 3 else None
            try:
                name, works = parse_author_page(author_url, proxy=proxy)
                print(json.dumps({"author": name, "works": works}))
            except Exception as e:
                print(json.dumps({"error": str(e)}))
            sys.exit(0)

    # 获取参数
    target = sys.argv[1] if len(sys.argv) > 1 else "https://www.52shuku.net/yanqing/18_b/bjZ2n.html"
    out_dir = sys.argv[2] if len(sys.argv) > 2 else "./novels"
    proxy_arg = sys.argv[3] if len(sys.argv) > 3 else None
    
    # 额外支持 --title 和 --author 参数
    ov_name = None
    ov_author = None
    if "--title" in sys.argv:
        idx = sys.argv.index("--title")
        if idx + 1 < len(sys.argv): ov_name = sys.argv[idx+1]
    if "--author-name" in sys.argv:
        idx = sys.argv.index("--author-name")
        if idx + 1 < len(sys.argv): ov_author = sys.argv[idx+1]

    run_crawler(target, out_dir, log_callback=print, override_name=ov_name, override_author=ov_author, proxy=proxy_arg)