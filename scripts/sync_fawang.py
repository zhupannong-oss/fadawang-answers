#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
法答网精选答问 · 增量同步脚本
- 从最高人民法院官网检索「法答网精选答问」并抓取各批次正文
- 按标题 / 原始链接去重，仅将新增与变更条目增量同步进 frontend/data/（Markdown 为唯一数据源）
- 新增 / 变更批次更新「最后更新」时间戳，并重建 index.md
- 任一条目抓取失败时：保留上一次数据不变，并把失败状态记录到 frontend/data/采集状态.md
- 部门法标签固定十类，新增问答按关键词规则自动标注（分类依据注明“自动标注，待人工复核”）

依赖：requests、beautifulsoup4（CI 中 pip install requests beautifulsoup4）
用法：python scripts/sync_fawang.py
"""
import hashlib
import json
import os
import re
import sys
import time
from datetime import date, datetime

import requests
from bs4 import BeautifulSoup

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(REPO, "frontend", "data")
SEARCH_URL = "https://www.court.gov.cn/search.html?content=%E6%B3%95%E7%AD%94%E7%BD%91%E7%B2%BE%E9%80%89%E7%AD%94%E9%97%AE&page={page}"
UA = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/120.0 Safari/537.36"
}

# ---------------- 通用工具 ----------------

def clean_text(t):
    t = t.replace("\u3000", " ").replace("\xa0", " ")
    return re.sub(r"[ \t]+", " ", t).strip()


def cn_numeral_to_int(s):
    """中文数字（如 四十 / 二十七 / 三十九）转 int"""
    digits = {"零": 0, "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9}
    if not s:
        return None
    if s.isdigit():
        return int(s)
    total, num = 0, 0
    for ch in s:
        if ch in digits:
            num = digits[ch]
        elif ch == "十":
            total += (num or 1) * 10
            num = 0
        elif ch == "百":
            total += (num or 1) * 100
            num = 0
        else:
            return None
    return total + num


# ---------------- 抓取与解析 ----------------

def fetch(url, retries=2):
    last = None
    for _ in range(retries + 1):
        try:
            r = requests.get(url, headers=UA, timeout=30)
            r.raise_for_status()
            return r.text
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(1.5)
    raise last


def discover_articles():
    """遍历检索结果页，返回 [{title, url, id}]，按链接去重"""
    seen, items = set(), []
    for page in range(1, 6):
        html = fetch(SEARCH_URL.format(page=page))
        found = re.findall(
            r'<a title="([^"]*)" target="_blank" href="(/zixun/xiangqing/(\d+)\.html)"', html
        )
        if not found:
            break
        for title, href, aid in found:
            title = clean_text(re.sub(r"</?[^>]+>", "", title))
            if "法答网精选答问" not in title or aid in seen:
                continue
            seen.add(aid)
            items.append({"title": title, "url": "https://www.court.gov.cn" + href, "id": aid})
    return items


def para_texts(div):
    import html as htmlmod
    s = div.decode_contents()
    s = re.sub(r"<br\s*/?>", "\n", s, flags=re.I)
    s = re.sub(r"</p\s*>", "\n", s, flags=re.I)
    s = re.sub(r"<p[^>]*>", "\n", s, flags=re.I)
    s = re.sub(r"</?(strong|b)>", "**", s, flags=re.I)
    s = re.sub(r"<[^>]+>", "", s)
    s = re.sub(r"\*\*\s*\*\*", "", s)
    s = htmlmod.unescape(s)
    out = []
    for line in s.split("\n"):
        line = clean_text(line)
        if line:
            out.append(re.sub(r"\*{2,}", "**", line))
    return out


def parse_article(html_text, url):
    soup = BeautifulSoup(html_text, "html.parser")
    title_el = soup.select_one("div.detail > div.title") or soup.find("title")
    title = clean_text(title_el.get_text()) if title_el else ""
    source = published = ""
    for li in soup.select("div.detail_mes li"):
        t = clean_text(li.get_text())
        if t.startswith("来源"):
            source = t.split("：", 1)[-1].strip()
        elif t.startswith("发布时间"):
            published = t.split("：", 1)[-1].strip()
    zoom = soup.select_one("div.txt_txt#zoom") or soup.select_one("#zoom") or soup.select_one("div.detail")
    paras = para_texts(zoom) if zoom else []
    return {
        "title": re.sub(r"\s+", "", title.replace("\n", " ")),
        "source": source or "人民法院报",
        "date": (published or "")[:10],
        "url": url,
        "paras": paras,
    }


Q_RE = re.compile(r"^\s*问题\s*([0-9]+)\s*[：:]\s*(.*)")


def split_qas(paras):
    intro, blocks, cur, mode = [], [], None, "intro"
    for p in paras:
        plain = re.sub(r"\*\*", "", p).strip()
        m = Q_RE.match(plain)
        if m:
            if cur:
                blocks.append(cur)
            cur = {"num": int(m.group(1)), "q": m.group(2).strip(), "answer": [],
                   "consultant": "", "expert": "", "review": [], "reviewer": ""}
            mode = "q"
            continue
        if cur is None:
            intro.append(plain)
            continue
        if plain.startswith("答疑意见"):
            mode = "a"
            rest = re.sub(r"^答疑意见\s*[：:]\s*", "", plain)
            if rest:
                cur["answer"].append(rest)
        elif plain.startswith("咨询人"):
            mode = "c"
            rest = re.sub(r"^咨询人\s*[：:]\s*", "", plain)
            m2 = re.search(r"答疑(专家|人)\s*[：:]\s*(.*)$", rest)
            if m2:
                cur["consultant"] = rest[:m2.start()].strip()
                cur["expert"] = m2.group(2).strip()
                mode = "e"
            else:
                cur["consultant"] = rest
        elif re.match(r"^答疑(专家|人)\s*[：:]", plain):
            mode = "e"
            cur["expert"] = re.sub(r"^答疑(专家|人)\s*[：:]\s*", "", plain)
        elif plain.startswith("点评专家"):
            mode = "r"
            cur["reviewer"] = re.sub(r"^点评专家\s*[：:]\s*", "", plain)
        elif plain.startswith("点评意见"):
            mode = "r"
            rest = re.sub(r"^点评意见\s*[：:]\s*", "", plain)
            if rest:
                cur["review"].append(rest)
        elif plain.startswith("专家点评"):
            mode = "r"
        elif mode == "a":
            cur["answer"].append(plain)
        elif mode == "r":
            cur["review"].append(plain)
        elif mode == "q":
            cur["q"] += plain
        elif mode == "c":
            cur["consultant"] += plain
        elif mode == "e":
            cur["expert"] += plain
    if cur:
        blocks.append(cur)
    return intro, blocks


# ---------------- 自动分类（新增问答，规则标注待人工复核） ----------------

AUTO_RULES = [
    ("劳动争议", r"工伤|劳动争议|劳动合同|用人单位|劳动者|竞业限制|加班|工资|社会保险"),
    ("破产", r"破产|重整|和解程序|破产财产|破产受理"),
    ("婚家", r"离婚|婚姻|抚养|继承|遗产|夫妻|赡养|收养|监护人"),
    ("执行", r"执行|被执行人|强制执行|查封|拍卖|以物抵债|限制高消费|失信|保全执行"),
    ("刑事", r"犯罪|刑法|罪名|量刑|刑事|盗窃|诈骗|走私|毒品|缓刑|罚金|自首|立功|辩护人"),
    ("行政", r"行政|行政处罚|行政诉讼|征收|复议|国家赔偿|信息公开|行政强制"),
    ("公司", r"股东|公司|股权|出资|注册资本|认缴|抽逃|对赌|代持|董事|监事"),
    ("侵权", r"侵权|名誉|肖像|隐私|个人信息|专利|商标|著作权|商业秘密|不正当竞争|产品责任|生态环境"),
    ("合同", r"合同|违约|借款|买卖|租赁|保证|抵押|担保|保险|票据|承揽|运输|债权人|债务人|代位权|撤销权"),
    ("民事诉讼程序", r"管辖|诉讼|起诉|受理|举证|证据|仲裁|审判|再审|上诉|调解|送达|时效|保全|立案|公益诉讼|诉讼费"),
]


def auto_classify(question, answer_text):
    hay = question + " " + answer_text[:300]
    hits = []
    for cat, pat in AUTO_RULES:
        if re.search(pat, hay) and cat not in hits:
            hits.append(cat)
    if not hits:
        hits = ["民事诉讼程序"]
    hits = hits[:3]
    return "、".join(hits), "自动标注：" + "、".join(hits) + "（按关键词规则匹配，待人工复核）"


# ---------------- Markdown 生成 ----------------

def content_fingerprint(article, blocks):
    raw = article["title"] + "|" + "|".join(
        b["q"] + "#" + "".join(b["answer"]) for b in blocks
    )
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]


def render_batch_md(article, blocks, batch_no, theme, updated, fingerprint):
    lines = [f"# {article['title']}", ""]
    lines.append(f"- **批次**：第{batch_no}批")
    lines.append(f"- **专题**：{theme}")
    lines.append(f"- **发布日期**：{article['date']}")
    lines.append(f"- **来源**：{article['source']}")
    lines.append(f"- **原始链接**：{article['url']}")
    lines.append(f"- **问答数量**：{len(blocks)}")
    lines.append(f"- **最后更新**：{updated}")
    lines.append(f"- **内容指纹**：{fingerprint}")
    lines.append("")
    for b in blocks:
        cats, basis = auto_classify(b["q"], "".join(b["answer"]))
        lines.append(f"## 问题{b['num']}：{b['q']}")
        lines.append("")
        lines.append(f"**部门法分类**：{cats}")
        lines.append(f"**分类依据**：{basis}")
        lines.append("")
        lines.append("**答疑意见**：")
        lines.append("")
        for a in b["answer"]:
            lines.append(a)
            lines.append("")
        if b["consultant"]:
            lines.append(f"**咨询人**：{b['consultant']}")
        if b["expert"]:
            lines.append(f"**答疑专家**：{b['expert']}")
        if b["review"]:
            who = f"（点评专家：{b['reviewer']}）" if b["reviewer"] else ""
            lines.append("")
            lines.append(f"**专家点评**{who}：")
            lines.append("")
            for rv in b["review"]:
                lines.append(rv)
                lines.append("")
        lines.append("---")
        lines.append("")
    return "\n".join(lines)


def read_meta(md_text):
    meta = {}
    for m in re.finditer(r"^-\s*\*\*(.+?)\*\*：(.+)$", md_text, re.M):
        meta[m.group(1).strip()] = m.group(2).strip()
    return meta


def rebuild_index():
    metas = []
    for fn in sorted(os.listdir(DATA_DIR)):
        if not re.match(r"法答网精选答问-第\d+批\.md$", fn):
            continue
        text = open(os.path.join(DATA_DIR, fn), encoding="utf-8").read()
        meta = read_meta(text)
        title = text.split("\n", 1)[0].lstrip("# ").strip()
        m = re.search(r"（第([^）]+)批）", title)
        no = cn_numeral_to_int(m.group(1)) if m else 0
        metas.append({"fn": fn, "no": no or 0, "meta": meta, "title": title})
    metas.sort(key=lambda x: (x["meta"].get("发布日期", ""), x["no"]), reverse=True)
    out = ["# 法答网精选答问数据集索引", "",
           "> 本文件由采集流程生成，是知识库系统读取批次文件的唯一清单。",
           "> 全部批次按发布日期倒序排列，Markdown 文件为唯一数据源。",
           f"> 最后同步：{date.today().isoformat()}", "",
           "| 批次 | 专题 | 发布日期 | 问答数 | 数据文件 |",
           "|------|------|----------|--------|----------|"]
    for x in metas:
        out.append(f"| 第{x['no']}批 | {x['meta'].get('专题', '')} | {x['meta'].get('发布日期', '')} "
                   f"| {x['meta'].get('问答数量', '')} | [{x['fn']}]({x['fn']}) |")
    out.append("")
    open(os.path.join(DATA_DIR, "index.md"), "w", encoding="utf-8").write("\n".join(out))


def write_status(result):
    path = os.path.join(DATA_DIR, "采集状态.md")
    lines = ["# 采集状态记录", "",
             f"- **最后同步时间**：{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
             f"- **本次结果**：新增 {result['added']} 批 / 更新 {result['updated']} 批 / "
             f"登记指纹 {result['registered']} 批 / 跳过（无变化）{result['unchanged']} 批 / 失败 {len(result['failures'])} 条", ""]
    if result["failures"]:
        lines.append("## 失败条目（已保留上一次数据，未做任何变更）")
        lines.append("")
        for f in result["failures"]:
            lines.append(f"- {f['title']}（{f['url']}）：{f['error']}")
        lines.append("")
    else:
        lines.append("本次同步无失败条目。")
        lines.append("")
    records = []
    if os.path.exists(path):
        old = open(path, encoding="utf-8").read()
        if "## 历史记录" in old:
            records = [l for l in old.split("## 历史记录", 1)[1].strip().split("\n")
                       if l.strip().startswith("- ")][:19]
    lines.append("## 历史记录")
    lines.append("")
    lines.append(f"- {datetime.now().strftime('%Y-%m-%d %H:%M')}｜新增 {result['added']} / 更新 {result['updated']} / 失败 {len(result['failures'])}")
    lines.extend(records)
    lines.append("")
    open(path, "w", encoding="utf-8").write("\n".join(lines))


# ---------------- 主流程 ----------------

def existing_index():
    """扫描已有批次文件：{url: {file, fingerprint, title}}，按原始链接去重"""
    known = {}
    for fn in sorted(os.listdir(DATA_DIR)):
        if not re.match(r"法答网精选答问-第\d+批\.md$", fn):
            continue
        text = open(os.path.join(DATA_DIR, fn), encoding="utf-8").read()
        meta = read_meta(text)
        url = meta.get("原始链接", "")
        title = text.split("\n", 1)[0].lstrip("# ").strip()
        if url:
            known[url] = {"file": fn, "fingerprint": meta.get("内容指纹"), "title": title}
    return known


def batch_no_of(title, fallback):
    m = re.search(r"（第([^）]+)批）", title)
    if m:
        n = cn_numeral_to_int(m.group(1))
        if n:
            return n
    return fallback


def main():
    os.makedirs(DATA_DIR, exist_ok=True)
    result = {"added": 0, "updated": 0, "registered": 0, "unchanged": 0, "failures": []}
    try:
        articles = discover_articles()
    except Exception as e:  # noqa: BLE001
        result["failures"].append({"title": "检索结果页", "url": SEARCH_URL.format(page=1), "error": str(e)})
        write_status(result)
        print("检索失败，保留上一次数据：", e)
        return
    if not articles:
        result["failures"].append({"title": "检索结果页", "url": SEARCH_URL.format(page=1), "error": "未解析到任何条目"})
        write_status(result)
        print("检索无结果，保留上一次数据")
        return

    known = existing_index()
    next_no = max([int(m.group(1)) for v in known.values()
                   for m in [re.search(r"第(\d+)批", v["file"])] if m] or [0]) + 1

    for art in articles:
        url = art["url"]
        entry = known.get(url)
        try:
            parsed = parse_article(fetch(url), url)
            _, blocks = split_qas(parsed["paras"])
            if not blocks:
                raise ValueError("正文解析为空")
            fp = content_fingerprint(parsed, blocks)
            theme_m = re.match(r"法答网精选答问（第[^）]+批）\s*[——\-–—]*\s*(.*)",
                               re.sub(r"\s+", "", parsed["title"]))
            theme = (theme_m.group(1).strip("—- ") if theme_m and theme_m.group(1) else "综合辑")
            today = date.today().isoformat()

            if entry is None:
                no = batch_no_of(parsed["title"], next_no)
                if no >= next_no:
                    next_no = no + 1
                fn = f"法答网精选答问-第{no:02d}批.md"
                md = render_batch_md(parsed, blocks, no, theme, today, fp)
                open(os.path.join(DATA_DIR, fn), "w", encoding="utf-8").write(md)
                known[url] = {"file": fn, "fingerprint": fp, "title": parsed["title"]}
                result["added"] += 1
                print(f"[新增] {fn} {parsed['title']}")
            elif entry["fingerprint"] is None:
                # 已有文件登记内容指纹（不改动已有内容）
                path = os.path.join(DATA_DIR, entry["file"])
                text = open(path, encoding="utf-8").read()
                if "- **内容指纹**：" not in text:
                    text = re.sub(r"(-\s*\*\*最后更新\*\*：[^\n]+\n)",
                                  lambda m: m.group(1) + f"- **内容指纹**：{fp}\n", text, count=1)
                    open(path, "w", encoding="utf-8").write(text)
                entry["fingerprint"] = fp
                result["registered"] += 1
                print(f"[登记指纹] {entry['file']}")
            elif entry["fingerprint"] != fp:
                no = batch_no_of(parsed["title"], 0) or int(re.search(r"第(\d+)批", entry["file"]).group(1))
                md = render_batch_md(parsed, blocks, no, theme, today, fp)
                open(os.path.join(DATA_DIR, entry["file"]), "w", encoding="utf-8").write(md)
                entry["fingerprint"] = fp
                result["updated"] += 1
                print(f"[更新] {entry['file']}")
            else:
                result["unchanged"] += 1
        except Exception as e:  # noqa: BLE001
            # 失败：保留上一次数据，仅记录状态
            result["failures"].append({"title": art["title"], "url": url, "error": str(e)})
            print(f"[失败] {art['title']}：{e}")
        time.sleep(0.6)

    rebuild_index()
    write_status(result)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
