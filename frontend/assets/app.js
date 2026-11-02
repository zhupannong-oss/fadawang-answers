/* 法答网精选答问知识库 · 应用逻辑（Markdown 为唯一数据源） */
(function () {
  "use strict";

  const CAT_ORDER = ["民事", "商事", "刑事", "行政", "执行", "知识产权", "国家赔偿", "劳动与社会保障", "涉外与国际", "程序与综合"];
  const CAT_CLASS = {
    "民事": "tag-civil", "劳动与社会保障": "tag-civil",
    "商事": "tag-commercial", "涉外与国际": "tag-commercial",
    "刑事": "tag-crime",
    "行政": "tag-admin", "国家赔偿": "tag-admin",
    "执行": "tag-exec",
    "知识产权": "tag-ip",
    "程序与综合": "tag-comp"
  };

  const state = {
    view: "batch",          // batch | category
    query: "",
    cats: new Set(),        // 部门法多选
    batch: "all",           // 批次筛选
    batches: [],            // 解析后的批次数据
    openBatches: new Set(),
    openQs: new Set()
  };

  const $ = (sel) => document.querySelector(sel);
  const contentEl = $("#content");
  const metaEl = $("#resultMeta");

  /* ---------- 工具 ---------- */
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function escapeReg(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
  function highlight(text, q) {
    const safe = escapeHtml(text);
    if (!q) return safe;
    try {
      return safe.replace(new RegExp(escapeReg(escapeHtml(q)), "gi"), (m) => `<mark>${m}</mark>`);
    } catch (e) { return safe; }
  }

  /* ---------- Markdown 解析（批次文件） ---------- */
  function parseBatchMd(text) {
    const lines = text.split(/\r?\n/);
    const batch = { title: "", meta: {}, intro: "", questions: [] };
    let cur = null, section = null;
    for (const raw of lines) {
      const line = raw.trim();
      const qm = line.match(/^##\s*问题(\d+)：(.*)$/);
      if (qm) {
        cur = { num: +qm[1], q: qm[2].trim(), cats: [], basis: "", answer: [], consultant: "", expert: "", review: [], reviewer: "" };
        batch.questions.push(cur); section = "q"; continue;
      }
      if (!cur) {
        if (line.startsWith("# ")) { batch.title = line.slice(2).trim(); continue; }
        const mm = line.match(/^-\s*\*\*(.+?)\*\*：(.+)$/);
        if (mm) { batch.meta[mm[1].trim()] = mm[2].trim(); continue; }
        if (line.startsWith(">")) { batch.intro += line.replace(/^>\s*/, ""); }
        continue;
      }
      const lm = line.match(/^\*\*(.+?)\*\*(?:（[^）]*）)?\s*[：:](.*)$/);
      if (lm) {
        const key = lm[1].trim();
        const val = lm[2].trim();
        if (key === "部门法分类") cur.cats = val.split(/[、,，]/).map((s) => s.trim()).filter(Boolean);
        else if (key === "分类依据") cur.basis = val;
        else if (key === "答疑意见") { section = "answer"; if (val) cur.answer.push(val); }
        else if (key === "咨询人") { section = "consultant"; if (val) cur.consultant = val; }
        else if (key === "答疑专家") { section = "expert"; if (val) cur.expert = val; }
        else if (key.indexOf("咨询人") === 0 && key.indexOf("答疑") >= 0) { section = "signoff"; cur.consultant = val; }
        else if (key.indexOf("专家点评") === 0) {
          section = "review";
          const rm = line.match(/点评专家：([^）]+)/);
          if (rm) cur.reviewer = rm[1].trim();
          if (val) cur.review.push(val);
        }
        continue;
      }
      if (!line || line === "---") { if (line === "---") section = null; continue; }
      if (section === "answer") cur.answer.push(line);
      else if (section === "review") cur.review.push(line);
      else if (section === "q") cur.q += line;
      else if (section === "consultant") cur.consultant += line;
      else if (section === "expert") cur.expert += line;
    }
    return batch;
  }

  /* ---------- mini Markdown 渲染（采集清单） ---------- */
  function mdToHtml(md) {
    const lines = md.split(/\r?\n/);
    const out = [];
    let inTable = false, inList = false;
    const closeAll = () => {
      if (inTable) { out.push("</table>"); inTable = false; }
      if (inList) { out.push("</ul>"); inList = false; }
    };
    for (const raw of lines) {
      const line = raw.trim();
      const inline = (s) => escapeHtml(s)
        .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
        .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
      if (!line) { closeAll(); continue; }
      let m;
      if ((m = line.match(/^(#{1,4})\s+(.*)$/))) {
        closeAll();
        const lv = Math.min(m[1].length + 0, 4);
        out.push(`<h${lv}>${inline(m[2])}</h${lv}>`);
      } else if (line.startsWith("|")) {
        const cells = line.split("|").slice(1, -1).map((c) => c.trim());
        if (cells.every((c) => /^[-: ]+$/.test(c))) continue;
        if (!inTable) { out.push("<table>"); inTable = true; out.push("<tr>" + cells.map((c) => `<th>${inline(c)}</th>`).join("") + "</tr>"); }
        else out.push("<tr>" + cells.map((c) => `<td>${inline(c)}</td>`).join("") + "</tr>");
      } else if ((m = line.match(/^[-*]\s+(.*)$/))) {
        if (inTable) { out.push("</table>"); inTable = false; }
        if (!inList) { out.push("<ul>"); inList = true; }
        out.push(`<li>${inline(m[1])}</li>`);
      } else if (line.startsWith(">")) {
        closeAll();
        out.push(`<blockquote>${inline(line.replace(/^>\s*/, ""))}</blockquote>`);
      } else {
        closeAll();
        out.push(`<p>${inline(line)}</p>`);
      }
    }
    closeAll();
    return out.join("\n");
  }

  /* ---------- 筛选 ---------- */
  function filteredQuestions() {
    const q = state.query.trim().toLowerCase();
    const rows = [];
    for (const b of state.batches) {
      if (state.batch !== "all" && String(b.no) !== state.batch) continue;
      for (const item of b.questions) {
        if (state.cats.size && !item.cats.some((c) => state.cats.has(c))) continue;
        if (q) {
          const hay = (item.q + " " + item.answer.join(" ") + " " + item.basis + " " + item.consultant + " " + item.expert).toLowerCase();
          if (!hay.includes(q)) continue;
        }
        rows.push({ batch: b, item });
      }
    }
    return rows;
  }

  /* ---------- 渲染 ---------- */
  function catTag(cat) {
    return `<span class="tag ${CAT_CLASS[cat] || "tag-comp"}">${escapeHtml(cat)}</span>`;
  }

  function qaItemHtml(row) {
    const { batch, item } = row;
    const key = batch.no + "-" + item.num;
    const open = state.openQs.has(key) ? " open" : "";
    const q = state.query.trim();
    return `
    <div class="qa-item${open}" data-qkey="${key}">
      <div class="qa-q">
        <span class="qa-idx">问 ${item.num}</span>
        <div class="qa-qtext">
          ${highlight(item.q, q)}
          <span class="qa-cats">${item.cats.map(catTag).join(" ")}</span>
        </div>
      </div>
      <div class="qa-body">
        <div class="basis">分类依据：${highlight(item.basis, q)}</div>
        <h4>答疑意见</h4>
        <div class="answer">${item.answer.map((p) => `<p>${highlight(p, q)}</p>`).join("")}</div>
        ${(item.consultant || item.expert) ? `
        <div class="signoff">
          ${item.consultant ? `<span>咨询人：${escapeHtml(item.consultant)}</span>` : ""}
          ${item.expert ? `<span>答疑专家：${escapeHtml(item.expert)}</span>` : ""}
        </div>` : `
        <div class="signoff"><span>咨询人 / 答疑专家：原文未标注（官网发布体例为专家点评）</span></div>`}
        ${item.review.length ? `
        <div class="review">
          <div class="review-title">专家点评${item.reviewer ? "（" + escapeHtml(item.reviewer) + "）" : ""}</div>
          ${item.review.map((p) => `<p>${highlight(p, q)}</p>`).join("")}
        </div>` : ""}
        <div class="signoff"><span>出处：${escapeHtml(batch.title)} · <a href="${escapeHtml(batch.meta["原始链接"] || "#")}" target="_blank" rel="noopener">原始链接</a></span></div>
      </div>
    </div>`;
  }

  function batchCardHtml(batch, rows) {
    const open = state.openBatches.has(batch.no) ? " open" : "";
    const cats = [...new Set(batch.questions.flatMap((i) => i.cats))];
    return `
    <div class="batch-card${open}" data-batch="${batch.no}">
      <div class="batch-head">
        <div class="batch-no"><span class="no">${String(batch.no).padStart(2, "0")}</span><span class="unit">BATCH</span></div>
        <div class="batch-info">
          <div class="batch-title">${escapeHtml(batch.title)}</div>
          <div class="batch-meta">
            <span>发布日期：${escapeHtml(batch.meta["发布日期"] || "")}</span>
            <span>问答数：${batch.questions.length}</span>
            <a href="${escapeHtml(batch.meta["原始链接"] || "#")}" target="_blank" rel="noopener">查看原文 ↗</a>
          </div>
          <div class="batch-tags">${cats.map(catTag).join(" ")}</div>
        </div>
        <div class="expand-icon">▾</div>
      </div>
      <div class="batch-body">${rows.map(qaItemHtml).join("")}</div>
    </div>`;
  }

  function render() {
    const rows = filteredQuestions();
    const q = state.query.trim();
    const catDesc = state.cats.size ? [...state.cats].join("、") : "全部";
    metaEl.innerHTML = `共 <b>${rows.length}</b> 条问答匹配　|　浏览方式：<b>${state.view === "batch" ? "按批次" : "按部门法"}</b>　|　部门法：<b>${escapeHtml(catDesc)}</b>${q ? `　|　关键词：<b>“${escapeHtml(q)}”</b>` : ""}`;

    if (!rows.length) {
      contentEl.innerHTML = `<div class="empty"><div class="big">未找到匹配的问答</div><p>请尝试更换关键词，或重置部门法 / 批次筛选。</p></div>`;
      return;
    }

    if (state.view === "batch") {
      const byBatch = new Map();
      for (const r of rows) {
        if (!byBatch.has(r.batch.no)) byBatch.set(r.batch.no, { batch: r.batch, items: [] });
        byBatch.get(r.batch.no).items.push(r);
      }
      const html = [...byBatch.values()]
        .sort((a, b) => a.batch.no - b.batch.no)
        .map(({ batch, items }) => batchCardHtml(batch, items)).join("");
      contentEl.innerHTML = html;
    } else {
      let html = "";
      for (const cat of CAT_ORDER) {
        const catRows = rows.filter((r) => r.item.cats.includes(cat));
        if (!catRows.length) continue;
        html += `
        <section class="cat-section">
          <div class="cat-header"><h3>${escapeHtml(cat)}</h3><span class="count">${catRows.length} 条问答（一问多类时在各类下均展示）</span></div>
          <div class="cat-list">${catRows.map(qaItemHtml).join("")}</div>
        </section>`;
      }
      contentEl.innerHTML = html;
    }
  }

  /* ---------- 初始化 ---------- */
  async function init() {
    const indexMd = await (await fetch("data/index.md")).text();
    const files = [...indexMd.matchAll(/\[([^\]]+\.md)\]\(([^)]+)\)/g)].map((m) => ({ name: m[1], path: "data/" + m[2] }));
    const list = files.filter((f) => /第\d+批/.test(f.name));
    const texts = await Promise.all(list.map((f) => fetch(f.path).then((r) => r.text())));
    state.batches = list.map((f, i) => ({ file: f.name, data: parseBatchMd(texts[i]) }))
      .sort((a, b) => a.file.localeCompare(b.file, "zh"))
      .map((x) => Object.assign(x.data, { no: +((x.file.match(/第(\d+)批/) || [])[1] || 0) }));

    // 统计
    $("#statBatches").textContent = state.batches.length;
    $("#statQuestions").textContent = state.batches.reduce((n, b) => n + b.questions.length, 0);
    $("#statCats").textContent = CAT_ORDER.length;

    // 批次下拉
    const sel = $("#batchSelect");
    for (const b of state.batches) {
      const opt = document.createElement("option");
      opt.value = String(b.no);
      opt.textContent = `第${String(b.no).padStart(2, "0")}批 · ${b.title.replace(/^法答网精选答问（[^）]+批）\s*[—\-–]*\s*/, "") || "综合"}`;
      sel.appendChild(opt);
    }

    // 部门法 chips
    const chips = $("#catChips");
    chips.innerHTML = CAT_ORDER.map((c) => `<button class="chip" data-cat="${escapeHtml(c)}">${escapeHtml(c)}</button>`).join("");

    // 采集清单
    try {
      const md = await (await fetch("data/采集清单.md")).text();
      $("#aboutContent").innerHTML = mdToHtml(md);
    } catch (e) {
      $("#aboutContent").innerHTML = "<p>采集清单加载失败。</p>";
    }

    render();
  }

  /* ---------- 事件 ---------- */
  document.addEventListener("click", (e) => {
    const head = e.target.closest(".batch-head");
    if (head) {
      const card = head.closest(".batch-card");
      const no = +card.dataset.batch;
      card.classList.toggle("open");
      if (card.classList.contains("open")) state.openBatches.add(no); else state.openBatches.delete(no);
      return;
    }
    const qbtn = e.target.closest(".qa-q");
    if (qbtn) {
      const item = qbtn.closest(".qa-item");
      const key = item.dataset.qkey;
      item.classList.toggle("open");
      if (item.classList.contains("open")) state.openQs.add(key); else state.openQs.delete(key);
      return;
    }
    const toggle = e.target.closest(".toggle-btn");
    if (toggle) {
      document.querySelectorAll(".toggle-btn").forEach((b) => b.classList.remove("active"));
      toggle.classList.add("active");
      state.view = toggle.dataset.view;
      render();
      return;
    }
    const chip = e.target.closest(".chip");
    if (chip) {
      const cat = chip.dataset.cat;
      if (state.cats.has(cat)) state.cats.delete(cat); else state.cats.add(cat);
      chip.classList.toggle("active");
      render();
      return;
    }
    if (e.target.id === "resetFilters") {
      state.query = ""; state.cats.clear(); state.batch = "all";
      $("#searchInput").value = "";
      $("#clearSearch").hidden = true;
      $("#batchSelect").value = "all";
      document.querySelectorAll(".chip.active").forEach((c) => c.classList.remove("active"));
      render();
      return;
    }
    if (e.target.id === "clearSearch") {
      state.query = "";
      $("#searchInput").value = "";
      e.target.hidden = true;
      render();
    }
  });

  let timer = null;
  document.addEventListener("input", (e) => {
    if (e.target.id !== "searchInput") return;
    $("#clearSearch").hidden = !e.target.value;
    clearTimeout(timer);
    timer = setTimeout(() => {
      state.query = e.target.value;
      render();
    }, 220);
  });
  document.addEventListener("change", (e) => {
    if (e.target.id === "batchSelect") {
      state.batch = e.target.value;
      render();
    }
  });

  init().catch((err) => {
    contentEl.innerHTML = `<div class="empty"><div class="big">数据加载失败</div><p>${escapeHtml(err.message)}</p><p>请通过本地 HTTP 服务访问本页面（Markdown 数据文件需经 fetch 读取）。</p></div>`;
  });
})();
