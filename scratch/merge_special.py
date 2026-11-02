#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把第十八批(文本)与第二十七批(转载页)合并进 parsed.json"""
import json, os, re, html as htmlmod
from bs4 import BeautifulSoup

BASE = os.path.dirname(os.path.abspath(__file__))
parsed = json.load(open(os.path.join(BASE, "parsed.json")))

# ---- 第十八批：文本逐行 ----
lines = [l.strip() for l in open(os.path.join(BASE, "b18_raw.txt"), encoding="utf-8") if l.strip()]
parsed["ok"]["b18"] = {
    "title": "法答网精选答问（第十八批）——工伤保险待遇专题",
    "source": "人民法院报（今日头条“最高人民法院”官方账号全文转载）",
    "date": "2025-05-02",
    "url": "http://m.toutiao.com/group/7499711372788236854/",
    "paras": lines,
}

# ---- 第二十七批：望花区法院转载页 ----
soup = BeautifulSoup(open(os.path.join(BASE, "mirror_b27.html"), encoding="utf-8", errors="ignore").read(), "html.parser")
div = soup.select_one("div.detail") or soup.body
s = div.decode_contents()
s = re.sub(r"<br\s*/?>", "\n", s, flags=re.I)
s = re.sub(r"</p\s*>", "\n", s, flags=re.I)
s = re.sub(r"<p[^>]*>", "\n", s, flags=re.I)
s = re.sub(r"</?(strong|b)>", "**", s, flags=re.I)
s = re.sub(r"<[^>]+>", "", s)
s = htmlmod.unescape(s)
paras = []
for line in s.split("\n"):
    line = re.sub(r"[ \t\u3000\xa0]+", " ", line).strip()
    if line:
        paras.append(line)
# 裁掉页面头尾（保留 问题1 到 末尾责任编辑 前）
start = next((i for i, p in enumerate(paras) if p.lstrip("*").startswith("问题1")), 0)
end = next((i for i, p in enumerate(paras) if p.startswith("责任编辑") or p.startswith("来源：")), len(paras))
body = paras[start:end]
parsed["ok"]["b27"] = {
    "title": "法答网精选答问（第二十七批）——未成年人司法保护专题",
    "source": "人民法院报·7版（抚顺市望花区人民法院官网转载）",
    "date": "2025-08-28",
    "url": "https://fswh.lncourt.gov.cn/article/detail/2025/09/id/8983098.shtml",
    "paras": body,
}

json.dump(parsed, open(os.path.join(BASE, "parsed.json"), "w"), ensure_ascii=False, indent=1)
print("b18 paras:", len(parsed["ok"]["b18"]["paras"]))
print("b27 paras:", len(parsed["ok"]["b27"]["paras"]))
print("b27 首段:", parsed["ok"]["b27"]["paras"][0][:60])
print("b27 末段:", parsed["ok"]["b27"]["paras"][-1][:60])
