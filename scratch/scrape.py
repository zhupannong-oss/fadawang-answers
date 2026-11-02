#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""抓取法院网法答网精选答问文章并解析为结构化数据"""
import json, os, re, time, html as htmlmod
import requests
from bs4 import BeautifulSoup

BASE = os.path.dirname(os.path.abspath(__file__))
HTML_DIR = os.path.join(BASE, "html")
os.makedirs(HTML_DIR, exist_ok=True)
UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"}

links = json.load(open(os.path.join(BASE, "links.json")))

def clean_text(t):
    t = t.replace("\u3000", " ").replace("\xa0", " ")
    t = re.sub(r"[ \t]+", " ", t)
    return t.strip()

def para_texts(div):
    """提取容器内段落文本：统一按 </p>/<br> 切行，保留 <strong> 语义为 **xx**"""
    s = div.decode_contents()
    s = re.sub(r"<br\s*/?>", "\n", s, flags=re.I)
    s = re.sub(r"</p\s*>", "\n", s, flags=re.I)
    s = re.sub(r"<p[^>]*>", "\n", s, flags=re.I)
    s = re.sub(r"</?(strong|b)>", "**", s, flags=re.I)
    s = re.sub(r"<[^>]+>", "", s)
    s = htmlmod.unescape(s)
    out = []
    for line in s.split("\n"):
        line = clean_text(line)
        if not line:
            continue
        line = re.sub(r"\*{2,}", "**", line)
        line = re.sub(r"\*\*\s*\*\*", "", line)
        out.append(line.strip().strip("**").strip() if line.count("**") == 2 and line.startswith("**") and line.endswith("**") and len(line) < 200 else line)
    return out

def render_inline(el):
    parts = []
    for node in el.descendants:
        if isinstance(node, str):
            parts.append(node)
        elif node.name == "strong" or node.name == "b":
            inner = node.get_text()
            if inner.strip():
                parts.append("**" + inner.strip() + "**")
        elif node.name == "br":
            parts.append(" ")
    # 修正：strong 内文本会被 descendants 重复计入，重新用替换法
    s = str(el)
    s = re.sub(r"<br\s*/?>", " ", s, flags=re.I)
    s = re.sub(r"</?(strong|b)>", "**", s, flags=re.I)
    s = re.sub(r"<[^>]+>", "", s)
    s = htmlmod.unescape(s)
    s = clean_text(s)
    s = re.sub(r"\*{2,}", "**", s)
    s = re.sub(r"\*\*\s*\*\*", "", s)
    return s.strip()

def parse_article(html_path, url):
    soup = BeautifulSoup(open(html_path, encoding="utf-8", errors="ignore").read(), "html.parser")
    title_el = soup.select_one("div.detail > div.title") or soup.find("title")
    title = clean_text(title_el.get_text()) if title_el else ""
    source = date = ""
    for li in soup.select("div.detail_mes li"):
        t = clean_text(li.get_text())
        if t.startswith("来源"):
            source = t.split("：", 1)[-1].strip() or t.split(":", 1)[-1].strip()
        elif t.startswith("发布时间"):
            date = t.split("：", 1)[-1].strip() or t.split(":", 1)[-1].strip()
    zoom = soup.select_one("div.txt_txt#zoom") or soup.select_one("#zoom")
    if zoom is None:
        zoom = soup.select_one("div.detail")
    paras = para_texts(zoom) if zoom else []
    return {"title": title, "source": source, "date": date, "url": url, "paras": paras}

results = {}
failed = {}
for aid, item in sorted(links.items(), key=lambda x: -int(x[0])):
    fp = os.path.join(HTML_DIR, aid + ".html")
    if not os.path.exists(fp) or os.path.getsize(fp) < 5000:
        try:
            r = requests.get(item["url"], headers=UA, timeout=30)
            r.raise_for_status()
            open(fp, "wb").write(r.content)
            time.sleep(0.6)
        except Exception as e:
            failed[aid] = {"title": item["title"], "url": item["url"], "error": str(e)}
            continue
    try:
        results[aid] = parse_article(fp, item["url"])
    except Exception as e:
        failed[aid] = {"title": item["title"], "url": item["url"], "error": "parse: " + str(e)}

json.dump({"ok": results, "failed": failed}, open(os.path.join(BASE, "parsed.json"), "w"), ensure_ascii=False, indent=1)

# 摘要
for aid, r in sorted(results.items(), key=lambda x: -int(x[0])):
    nq = len(re.findall(r"问题\s*\d+\s*[：:]", "\n".join(r["paras"])))
    print(f'{aid} | {r["title"][:38]:40s} | {r["date"][:10]:10s} | paras={len(r["paras"]):3d} | 问题={nq}')
print("FAILED:", json.dumps(failed, ensure_ascii=False))
