#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""解析法院网检索结果页，提取法答网精选答问文章链接"""
import re, html, json, glob, os

SCRATCH = os.path.dirname(os.path.abspath(__file__))
items = {}
for f in sorted(glob.glob(os.path.join(SCRATCH, "search_page*.html"))):
    text = open(f, encoding="utf-8", errors="ignore").read()
    for m in re.finditer(r'<a title="([^"]*)" target="_blank" href="(/zixun/xiangqing/(\d+)\.html)"', text):
        title, href, aid = html.unescape(m.group(1)), m.group(2), m.group(3)
        if "法答网精选答问" in title:
            items[aid] = {"id": aid, "title": title, "url": "https://www.court.gov.cn" + href}

print(f"共找到 {len(items)} 条法答网精选答问链接")
for aid, it in sorted(items.items(), key=lambda x: -int(x[0])):
    print(aid, it["title"])

json.dump(items, open(os.path.join(SCRATCH, "links.json"), "w"), ensure_ascii=False, indent=2)
