/* 法答网精选答问知识库 · 应用逻辑（Markdown 为唯一数据源） */
(function () {
  "use strict";

  const PAGE_SIZE = 10;
  const CAT_ORDER = ["劳动争议", "公司", "合同", "侵权", "婚家", "破产", "执行", "民事诉讼程序", "刑事", "行政"];
  const CAT_CLASS = {
    "劳动争议": "tag-labor",
    "公司": "tag-company",
    "合同": "tag-contract",
    "侵权": "tag-tort",
    "婚家": "tag-family",
    "破产": "tag-bank",
    "执行": "tag-exec",
    "民事诉讼程序": "tag-proc",
    "刑事": "tag-crime",
    "行政": "tag-admin"
  };

  const state = {
    view: "batch",          // batch | category
    query: "",
    cats: new Set(),        // 部门法多选
    batch: "all",           // 批次筛选
    batches: [],            // 解析后的批次数据（按发布日期倒序）
    pageBatch: 1,           // 批次视图当前页
    pageCat: {},            // 部门法视图各分类当前页 {cat: page}
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

  /* ---------- 筛选 ---------- */
  function filteredRows() {
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
    return `<span class="tag ${CAT_CLASS[cat] || "tag-proc"}">${escapeHtml(cat)}</span>`;
  }

  function pagerHtml(kind, page, totalPages) {
    if (totalPages <= 1) return `<div class="pager"><span class="page-info">第 1 / 1 页</span></div>`;
    return `
    <div class="pager">
      <button class="page-btn" data-page-kind="${kind}" data-page-delta="-1" ${page <= 1 ? "disabled" : ""}>上一页</button>
      <span class="page-info">第 ${page} / ${totalPages} 页</span>
      <button class="page-btn" data-page-kind="${kind}" data-page-delta="1" ${page >= totalPages ? "disabled" : ""}>下一页</button>
    </div>`;
  }

  function qaItemHtml(row, idPrefix) {
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
    const cats = [...new Set(rows.flatMap((r) => r.item.cats))];
    return `
    <div class="batch-card${open}" data-batch="${batch.no}">
      <div class="batch-head">
        <div class="batch-no"><span class="no">${String(batch.no).padStart(2, "0")}</span><span class="unit">BATCH</span></div>
        <div class="batch-info">
          <div class="batch-title">${escapeHtml(batch.title)}</div>
          <div class="batch-meta">
            <span>发布日期：${escapeHtml(batch.meta["发布日期"] || "")}</span>
            <span>问答数：${rows.length}${rows.length !== batch.questions.length ? " / " + batch.questions.length : ""}</span>
            <a href="${escapeHtml(batch.meta["原始链接"] || "#")}" target="_blank" rel="noopener">查看原文 ↗</a>
          </div>
          <div class="batch-tags">${cats.map(catTag).join(" ")}</div>
        </div>
        <div class="expand-icon">▾</div>
      </div>
      <div class="batch-body">${rows.map((r) => qaItemHtml(r, "b")).join("")}</div>
    </div>`;
  }

  function render() {
    const rows = filteredRows();
    const q = state.query.trim();
    const catDesc = state.cats.size ? [...state.cats].join("、") : "全部";
    metaEl.innerHTML = `共 <b>${rows.length}</b> 条问答匹配　|　浏览方式：<b>${state.view === "batch" ? "按批次" : "按部门法"}</b>　|　部门法：<b>${escapeHtml(catDesc)}</b>${q ? `　|　关键词：<b>“${escapeHtml(q)}”</b>` : ""}`;

    if (!rows.length) {
      contentEl.innerHTML = `<div class="empty"><div class="big">未找到匹配的问答</div><p>请尝试更换关键词，或重置部门法 / 批次筛选。</p></div>`;
      return;
    }

    if (state.view === "batch") {
      /* ---- 按批次视图：批次卡片分页（每页 10 批），发布日期倒序 ---- */
      const byBatch = new Map();
      for (const r of rows) {
        if (!byBatch.has(r.batch.no)) byBatch.set(r.batch.no, { batch: r.batch, items: [] });
        byBatch.get(r.batch.no).items.push(r);
      }
      const all = [...byBatch.values()].sort((a, b) => {
        const da = a.batch.meta["发布日期"] || "", db = b.batch.meta["发布日期"] || "";
        return db.localeCompare(da) || b.batch.no - a.batch.no;
      });
      const totalPages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
      if (state.pageBatch > totalPages) state.pageBatch = totalPages;
      const page = state.pageBatch;
      const slice = all.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
      contentEl.innerHTML =
        slice.map(({ batch, items }) => batchCardHtml(batch, items)).join("") +
        pagerHtml("batch", page, totalPages);
    } else {
      /* ---- 按部门法视图：每个分类独立分页（每页 10 条） ---- */
      let html = "";
      for (const cat of CAT_ORDER) {
        const catRows = rows.filter((r) => r.item.cats.includes(cat));
        if (!catRows.length) continue;
        const totalPages = Math.max(1, Math.ceil(catRows.length / PAGE_SIZE));
        if (!state.pageCat[cat] || state.pageCat[cat] > totalPages) state.pageCat[cat] = 1;
        const page = state.pageCat[cat];
        const slice = catRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
        html += `
        <section class="cat-section" data-cat="${escapeHtml(cat)}">
          <div class="cat-header"><h3>${escapeHtml(cat)}</h3><span class="count">${catRows.length} 条问答（一问多类时在各类下均展示）</span></div>
          <div class="cat-list">${slice.map((r) => qaItemHtml(r, cat)).join("")}</div>
          ${pagerHtml("cat:" + cat, page, totalPages)}
        </section>`;
      }
      contentEl.innerHTML = html || `<div class="empty"><div class="big">未找到匹配的问答</div><p>请尝试更换关键词或筛选条件。</p></div>`;
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
      .map((x) => Object.assign(x.data, { no: +((x.file.match(/第(\d+)批/) || [])[1] || 0) }))
      .sort((a, b) => (b.meta["发布日期"] || "").localeCompare(a.meta["发布日期"] || "") || b.no - a.no);

    // 统计
    $("#statBatches").textContent = state.batches.length;
    $("#statQuestions").textContent = state.batches.reduce((n, b) => n + b.questions.length, 0);
    $("#statCats").textContent = CAT_ORDER.length;

    // 批次下拉（按发布日期倒序）
    const sel = $("#batchSelect");
    for (const b of state.batches) {
      const opt = document.createElement("option");
      opt.value = String(b.no);
      opt.textContent = `第${String(b.no).padStart(2, "0")}批 · ${(b.title.replace(/^法答网精选答问（[^）]+批）\s*[—\-–]*\s*/, "") || "综合")}`;
      sel.appendChild(opt);
    }

    // 部门法 chips
    const chips = $("#catChips");
    chips.innerHTML = CAT_ORDER.map((c) => `<button class="chip" data-cat="${escapeHtml(c)}">${escapeHtml(c)}</button>`).join("");

    render();
  }

  /* ---------- 事件 ---------- */
  document.addEventListener("click", (e) => {
    const pageBtn = e.target.closest(".page-btn");
    if (pageBtn && !pageBtn.disabled) {
      const kind = pageBtn.dataset.pageKind;
      const delta = +pageBtn.dataset.pageDelta;
      if (kind === "batch") {
        state.pageBatch = Math.max(1, state.pageBatch + delta);
      } else {
        const cat = kind.slice(4);
        state.pageCat[cat] = Math.max(1, (state.pageCat[cat] || 1) + delta);
      }
      render();
      window.scrollTo({ top: Math.max(0, contentEl.offsetTop - 80), behavior: "smooth" });
      return;
    }
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
      state.pageBatch = 1;
      state.pageCat = {};
      render();
      return;
    }
    const chip = e.target.closest(".chip");
    if (chip) {
      const cat = chip.dataset.cat;
      if (state.cats.has(cat)) state.cats.delete(cat); else state.cats.add(cat);
      chip.classList.toggle("active");
      state.pageBatch = 1;
      state.pageCat = {};
      render();
      return;
    }
    if (e.target.id === "resetFilters") {
      state.query = ""; state.cats.clear(); state.batch = "all";
      state.pageBatch = 1; state.pageCat = {};
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
      state.pageBatch = 1; state.pageCat = {};
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
      state.pageBatch = 1; state.pageCat = {};
      render();
    }, 220);
  });
  document.addEventListener("change", (e) => {
    if (e.target.id === "batchSelect") {
      state.batch = e.target.value;
      state.pageBatch = 1; state.pageCat = {};
      render();
    }
  });

  init().catch((err) => {
    contentEl.innerHTML = `<div class="empty"><div class="big">数据加载失败</div><p>${escapeHtml(err.message)}</p><p>请通过本地 HTTP 服务访问本页面（Markdown 数据文件需经 fetch 读取）。</p></div>`;
  });
})();
