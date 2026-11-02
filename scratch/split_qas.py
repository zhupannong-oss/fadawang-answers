#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 parsed.json 的段落切分为问答结构，输出结构报告供人工核对"""
import json, os, re

BASE = os.path.dirname(os.path.abspath(__file__))
data = json.load(open(os.path.join(BASE, "parsed.json")))["ok"]

Q_RE = re.compile(r"^\s*(?:\*\*)?\s*问题\s*([0-9]+)\s*[：:]\s*(.*)")
HEAD_RE = re.compile(r"^\s*(开栏语|开栏的话|开栏的话：|专家点评|点评)\s*$")

def split_qas(paras):
    intro, blocks, cur = [], [], None
    mode = "intro"
    for p in paras:
        m = Q_RE.match(p)
        if m:
            if cur:
                blocks.append(cur)
            cur = {"num": int(m.group(1)), "q": re.sub(r"\*\*", "", m.group(2)).strip(),
                   "answer": [], "consultant": "", "expert": "", "review": [], "reviewer": "", "extra": []}
            mode = "q"
            continue
        if cur is None:
            intro.append(p)
            continue
        plain = re.sub(r"\*\*", "", p).strip()
        if plain.startswith("答疑意见"):
            mode = "a"
            rest = re.sub(r"^答疑意见\s*[：:]\s*", "", plain)
            if rest:
                cur["answer"].append(rest)
            continue
        if plain.startswith("咨询人"):
            mode = "c"
            rest = re.sub(r"^咨询人\s*[：:]\s*", "", plain).strip()
            # 兼容同行“咨询人：X答疑专家：Y”
            m2 = re.search(r"答疑(专家|人)\s*[：:]\s*(.*)$", rest)
            if m2:
                cur["consultant"] = rest[:m2.start()].strip()
                cur["expert"] = m2.group(2).strip()
                mode = "e"
            else:
                cur["consultant"] = rest
            continue
        if re.match(r"^答疑(专家|人)\s*[：:]", plain):
            mode = "e"
            cur["expert"] = re.sub(r"^答疑(专家|人)\s*[：:]\s*", "", plain).strip()
            continue
        if plain.startswith("点评专家"):
            mode = "r"
            cur["reviewer"] = re.sub(r"^点评专家\s*[：:]\s*", "", plain).strip()
            continue
        if plain.startswith("点评意见"):
            mode = "r"
            rest = re.sub(r"^点评意见\s*[：:]\s*", "", plain)
            if rest:
                cur["review"].append(rest)
            continue
        if HEAD_RE.match(plain) or plain.startswith("专家点评"):
            mode = "r"
            continue
        if mode == "a":
            cur["answer"].append(plain)
        elif mode == "r":
            cur["review"].append(plain)
        elif mode == "q":
            # 问题行折行拼接
            cur["q"] += plain
        elif mode == "c":
            cur["consultant"] += " " + plain
        elif mode == "e":
            cur["expert"] += " " + plain
        else:
            cur["extra"].append(plain)
    if cur:
        blocks.append(cur)
    return intro, blocks

report = []
stats = {"batches": 0, "questions": 0, "no_answer": [], "no_expert": []}
def _k(x):
    try:
        return int(x[0])
    except ValueError:
        return {"b18": 18, "b27": 27}.get(x[0], 0)

for aid, r in sorted(data.items(), key=lambda x: -_k(x)):
    intro, blocks = split_qas(r["paras"])
    stats["batches"] += 1
    stats["questions"] += len(blocks)
    report.append(f'## {aid} {re.sub(chr(10), " ", r["title"])} [{r["date"][:10]}] blocks={len(blocks)}')
    for b in blocks:
        flags = []
        if not b["answer"]:
            flags.append("NO_ANSWER")
            stats["no_answer"].append(f'{aid}#Q{b["num"]}')
        if not b["expert"]:
            flags.append("NO_EXPERT")
            stats["no_expert"].append(f'{aid}#Q{b["num"]}')
        report.append(f'  Q{b["num"]}: {b["q"][:80]} {" ".join(flags)}')
    report.append(f'  [intro] {(" | ".join(intro))[:100]}')

open(os.path.join(BASE, "structure_report.txt"), "w").write("\n".join(report))
print("\n".join(report))
print("\nSTATS:", json.dumps(stats, ensure_ascii=False))
