(() => {
  const $ = (sel) => document.querySelector(sel);

  const SUBJECTS = [
    { key: "math", zh: "数学", en: "Math" },
    { key: "science", zh: "科学", en: "Science" },
    { key: "english", zh: "英语", en: "English" },
    { key: "social_studies", zh: "社会研究", en: "Social Studies" },
    { key: "chinese", zh: "华文", en: "Chinese" },
    { key: "dictionary", zh: "词典", en: "Dictionary" },
    { key: "wordbook", zh: "生词本", en: "Wordbook" },
    { key: "progress", zh: "成果", en: "Progress" }
  ];

  const state = {
    tab: "science",
    subtab: "read", // read | quiz | bank (subjects)
    showCN: localStorage.getItem("showCN") !== "0",
    theme: localStorage.getItem("theme") || "light", // light/dark
    fs: parseInt(localStorage.getItem("fs") || "18", 10),
    idx: {}, // current card index per subject
    datasets: {}, // key -> {instructions, words, wordIndex, phraseIndex}
    quiz: null, // {subject, q, opts, ans, n, score}
    dict: { q: "", res: null, loading: false, err: "" }
  };

  // ---------- Theme & font ----------
  function applyTheme() {
    document.body.classList.toggle("theme-dark", state.theme === "dark");
    document.documentElement.style.setProperty("--fs", `${state.fs}px`);
    $("#themeBtn").textContent = state.theme === "dark" ? "主题：夜间" : "主题：护眼绿";
    $("#toggleCN").textContent = state.showCN ? "中文：开" : "中文：关";
  }

  $("#toggleCN").onclick = () => {
    state.showCN = !state.showCN;
    localStorage.setItem("showCN", state.showCN ? "1" : "0");
    render();
  };
  $("#themeBtn").onclick = () => {
    state.theme = state.theme === "dark" ? "light" : "dark";
    localStorage.setItem("theme", state.theme);
    applyTheme();
  };
  $("#fontPlus").onclick = () => {
    state.fs = Math.min(26, state.fs + 1);
    localStorage.setItem("fs", String(state.fs));
    applyTheme();
  };
  $("#fontMinus").onclick = () => {
    state.fs = Math.max(15, state.fs - 1);
    localStorage.setItem("fs", String(state.fs));
    applyTheme();
  };

  // ---------- Speech (UK) + audio fallback ----------
  function speakUK(text) {
    const t = (text || "").trim();
    if (!t) return;

    // Try cached audio URL from dictionary cache
    try {
      const cache = JSON.parse(localStorage.getItem("dictCache") || "{}");
      const hit = cache[t.toLowerCase()];
      const audioUrl = hit && hit.audio_gb;
      if (audioUrl) {
        const a = new Audio(audioUrl);
        a.play().catch(() => {});
        return;
      }
    } catch (_) {}

    // Fallback to Web Speech API
    try {
      if (!("speechSynthesis" in window)) return;
      const u = new SpeechSynthesisUtterance(t);
      u.lang = "en-GB";
      const pick = () => {
        const voices = speechSynthesis.getVoices() || [];
        const v =
          voices.find((v) => /en-GB/i.test(v.lang)) ||
          voices.find((v) => /English \(United Kingdom\)/i.test(v.name)) ||
          voices.find((v) => /^en/i.test(v.lang));
        if (v) u.voice = v;
        speechSynthesis.cancel();
        speechSynthesis.speak(u);
      };
      if ((speechSynthesis.getVoices() || []).length === 0) {
        speechSynthesis.onvoiceschanged = pick;
        setTimeout(pick, 200);
      } else pick();
    } catch (_) {}
  }

  // ---------- Data loading ----------
  async function loadSubject(key) {
    if (state.datasets[key]) return state.datasets[key];

    const base = `data/${key}`;
    const [instructions, words] = await Promise.all([
      fetch(`${base}/instructions.json`).then((r) => (r.ok ? r.json() : [])),
      fetch(`${base}/words.json`).then((r) => (r.ok ? r.json() : []))
    ]);

    const wordIndex = {};
    const phraseList = [];
    for (const w of words || []) {
      if (!w || !w.term) continue;
      const t = w.term.trim().toLowerCase();
      wordIndex[t] = w;
      phraseList.push(t);
      if (Array.isArray(w.collocations)) {
        for (const c of w.collocations) {
          if (c && typeof c === "string") phraseList.push(c.trim().toLowerCase());
        }
      }
    }
    // unique phrases, longest-first
    const uniq = Array.from(new Set(phraseList)).filter((p) => p.split(/\s+/).length >= 2);
    uniq.sort((a, b) => b.length - a.length);
    const phraseIndex = uniq;

    state.datasets[key] = { instructions, words, wordIndex, phraseIndex };
    if (state.idx[key] == null) state.idx[key] = 0;
    return state.datasets[key];
  }

  async function preloadCore() {
    // load math+science first (MVP requirement)
    await Promise.all(["math", "science"].map(loadSubject));
    applyTheme();
    render();
  }

  // ---------- Glossary dialog ----------
  const dlg = $("#glossDlg");
  const dlgTerm = $("#dlgTerm");
  const dlgPhon = $("#dlgPhon");
  const dlgZh = $("#dlgZh");
  const dlgDef = $("#dlgDef");

  $("#dlgClose").onclick = () => dlg.close();
  $("#dlgSpeak").onclick = () => speakUK(dlgTerm.textContent);
  $("#dlgAdd").onclick = () => {
    const term = dlgTerm.textContent.trim();
    if (!term) return;
    addToWordbook(term, dlgZh.textContent || "");
    renderWordbookToast(term);
  };

  function openGloss(term, localHit) {
    dlgTerm.textContent = term;
    dlgPhon.textContent = "";
    dlgZh.textContent = localHit?.zh || "";
    dlgDef.textContent = localHit?.hint || "";

    // Try to enrich with online dict (non-blocking)
    lookupDictionary(term).then((res) => {
      if (!res) return;
      // only update if still the same term open
      if (dlgTerm.textContent.trim().toLowerCase() !== term.toLowerCase()) return;
      if (res.phonetic) dlgPhon.textContent = res.phonetic;
      if (!dlgZh.textContent && res.zh) dlgZh.textContent = res.zh;
      if (res.definition) dlgDef.textContent = res.definition;
    });

    dlg.showModal();
  }

  // ---------- Clickable text (all words + known phrases) ----------
  function escapeHTML(s) {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }

  function wrapTextWithClicks(text, ds) {
    const raw = String(text || "");
    if (!raw) return "";

    // greedy phrase replacement (case-insensitive)
    let tmp = raw;
    const markers = [];
    if (ds?.phraseIndex?.length) {
      for (const ph of ds.phraseIndex.slice(0, 500)) { // cap to keep fast
        const re = new RegExp(`\\b${ph.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "ig");
        tmp = tmp.replace(re, (m) => {
          const id = `__PH_${markers.length}__`;
          markers.push({ id, text: m });
          return id;
        });
      }
    }

    // wrap single words
    tmp = tmp.replace(/[A-Za-z][A-Za-z']*/g, (m) => {
      return `<span class="kw" data-term="${escapeHTML(m)}">${escapeHTML(m)}</span>`;
    });

    // restore phrases and wrap as one clickable unit
    for (const mk of markers) {
      const safe = escapeHTML(mk.text);
      tmp = tmp.replaceAll(
        mk.id,
        `<span class="kw" data-term="${safe}" data-phrase="1">${safe}</span>`
      );
    }

    return tmp;
  }

  // ---------- Wordbook (localStorage) ----------
  function getWordbook() {
    try {
      return JSON.parse(localStorage.getItem("wordbook") || "[]");
    } catch (_) {
      return [];
    }
  }
  function saveWordbook(list) {
    localStorage.setItem("wordbook", JSON.stringify(list.slice(0, 2000)));
  }
  function addToWordbook(term, zh) {
    const t = term.trim();
    if (!t) return;
    const list = getWordbook();
    const key = t.toLowerCase();
    const hit = list.find((x) => x.key === key);
    if (hit) {
      hit.zh = hit.zh || zh || "";
      hit.addedAt = hit.addedAt || Date.now();
      hit.seen = (hit.seen || 0) + 1;
    } else {
      list.unshift({ key, term: t, zh: zh || "", addedAt: Date.now(), seen: 1 });
    }
    saveWordbook(list);
  }
  function renderWordbookToast(term){
    // minimal feedback without extra UI dependencies
    try{ navigator.vibrate?.(20); }catch(_){}
    // quick flash in title
    const b = document.title;
    document.title = `✅ 已加入：${term}`;
    setTimeout(()=>{ document.title = b; }, 700);
  }

  // ---------- Online dictionary (client-side API) ----------
  async function lookupDictionary(term) {
    const t = term.trim().toLowerCase();
    if (!t) return null;

    // in-memory / local cache
    let cache = {};
    try { cache = JSON.parse(localStorage.getItem("dictCache") || "{}"); } catch (_) {}
    if (cache[t]?.ts && Date.now() - cache[t].ts < 1000 * 60 * 60 * 24 * 14) {
      return cache[t];
    }

    const out = { ts: Date.now(), term: term, phonetic: "", definition: "", zh: "", audio_gb: "" };

    // 1) English dictionary (free)
    try {
      const r = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(t)}`);
      if (r.ok) {
        const j = await r.json();
        const first = Array.isArray(j) ? j[0] : null;
        if (first) {
          out.phonetic = first.phonetic || "";
          // pick audio; prefer "gb" if possible
          const phs = Array.isArray(first.phonetics) ? first.phonetics : [];
          const audios = phs.map(p => p?.audio).filter(Boolean);
          out.audio_gb = audios.find(a => /uk|gb/i.test(a)) || audios[0] || "";
          const mean = Array.isArray(first.meanings) ? first.meanings[0] : null;
          const def = mean?.definitions?.[0]?.definition || "";
          out.definition = def;
        }
      }
    } catch (_) {}

    // 2) Chinese translation (free-ish) via MyMemory (best-effort)
    // Note: public endpoint has rate limits; we cache results.
    try {
      const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(term)}&langpair=en|zh-CN`;
      const r = await fetch(url);
      if (r.ok) {
        const j = await r.json();
        const tr = j?.responseData?.translatedText;
        if (tr && typeof tr === "string") out.zh = tr;
      }
    } catch (_) {}

    cache[t] = out;
    try { localStorage.setItem("dictCache", JSON.stringify(cache)); } catch (_) {}
    return out;
  }

  // ---------- Quiz (per subject) ----------
  function startQuiz(subjectKey, ds) {
    // question: show EN instruction -> pick correct CN translation among 4
    const pool = (ds.instructions || []).filter(x => x?.en && x?.zh);
    if (pool.length < 4) return null;
    const q = pool[Math.floor(Math.random() * pool.length)];
    const opts = [q.zh];
    while (opts.length < 4) {
      const c = pool[Math.floor(Math.random() * pool.length)].zh;
      if (!opts.includes(c)) opts.push(c);
    }
    // shuffle
    for (let i = opts.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [opts[i], opts[j]] = [opts[j], opts[i]];
    }
    state.quiz = {
      subject: subjectKey,
      q,
      opts,
      ans: q.zh,
      n: (state.quiz?.n || 0) + 1,
      score: state.quiz?.score || 0,
      chosen: null
    };
  }

  function pickQuiz(opt) {
    if (!state.quiz || state.quiz.chosen) return;
    state.quiz.chosen = opt;
    if (opt === state.quiz.ans) state.quiz.score += 1;
    render();
  }

  // ---------- Rendering ----------
  function renderTabs() {
    const tabs = $("#tabs");
    tabs.innerHTML = "";
    SUBJECTS.forEach((t) => {
      const el = document.createElement("div");
      el.className = "tab" + (state.tab === t.key ? " active" : "");
      el.textContent = `${t.zh} / ${t.en}`;
      el.onclick = () => {
        state.tab = t.key;
        state.subtab = (t.key === "dictionary" || t.key === "wordbook" || t.key === "progress") ? "main" : "read";
        if (t.key !== "dictionary") state.dict.err = "";
        render();
      };
      tabs.appendChild(el);
    });
  }

  function renderMain() {
    const main = $("#main");
    main.innerHTML = "";

    // dictionary / wordbook / progress special pages
    if (state.tab === "dictionary") return renderDictionary(main);
    if (state.tab === "wordbook") return renderWordbook(main);
    if (state.tab === "progress") return renderProgress(main);

    // subject tabs
    renderSubject(main, state.tab);
  }

  function panelHeader(titleLeft, rightEl) {
    const h = document.createElement("div");
    h.className = "panel-h";
    const left = document.createElement("div");
    left.className = "left";
    left.appendChild(titleLeft);
    const right = document.createElement("div");
    if (rightEl) right.appendChild(rightEl);
    h.appendChild(left);
    h.appendChild(right);
    return h;
  }

  async function renderSubject(main, key) {
    const ds = await loadSubject(key);

    const title = document.createElement("div");
    title.className = "badge";
    const count = ds.instructions?.length || 0;
    title.textContent = `${key.toUpperCase()} · ${count} instruction cards`;

    const subtabs = document.createElement("div");
    subtabs.className = "subtabs";
    const mkSub = (id, zh, en) => {
      const b = document.createElement("div");
      b.className = "tab" + (state.subtab === id ? " active" : "");
      b.textContent = `${zh} / ${en}`;
      b.onclick = () => { state.subtab = id; render(); };
      return b;
    };
    subtabs.appendChild(mkSub("read", "读题", "Read"));
    subtabs.appendChild(mkSub("quiz", "测验", "Quiz"));
    subtabs.appendChild(mkSub("bank", "词库", "Word Bank"));

    const leftWrap = document.createElement("div");
    leftWrap.appendChild(title);
    leftWrap.appendChild(subtabs);

    main.appendChild(panelHeader(leftWrap, null));

    const content = document.createElement("div");
    content.className = "content";
    main.appendChild(content);

    if (state.subtab === "read") return renderRead(content, key, ds);
    if (state.subtab === "quiz") return renderQuiz(content, key, ds);
    return renderBank(content, key, ds);
  }

  function bindKwClicks(scopeEl, ds) {
    scopeEl.querySelectorAll(".kw").forEach((el) => {
      el.onclick = (e) => {
        const term = el.getAttribute("data-term") || "";
        const t = term.trim();
        const hit =
          ds.wordIndex?.[t.toLowerCase()] ||
          ds.wordIndex?.[t.toLowerCase().replace(/'s$/,"")] ||
          null;
        // Add to wordbook on shift-click
        if (e.shiftKey) addToWordbook(t, hit?.zh || "");
        openGloss(t, hit);
      };
    });
  }

  function renderRead(host, key, ds) {
    const idx = Math.max(0, Math.min(ds.instructions.length - 1, state.idx[key] || 0));
    state.idx[key] = idx;
    const item = ds.instructions[idx] || { en: "", zh: "" };

    const card = document.createElement("div");
    card.className = "card";

    const en = document.createElement("div");
    en.className = "en";
    en.innerHTML = wrapTextWithClicks(item.en, ds);
    card.appendChild(en);

    if (state.showCN && item.zh) {
      const cn = document.createElement("div");
      cn.className = "cn";
      cn.textContent = item.zh;
      card.appendChild(cn);
    }

    const chips = document.createElement("div");
    chips.className = "chips";
    const meta = document.createElement("span");
    meta.className = "chip";
    meta.textContent = `#${idx + 1}/${ds.instructions.length}`;
    chips.appendChild(meta);
    if (item.topic) {
      const c = document.createElement("span");
      c.className = "chip";
      c.textContent = item.topic;
      chips.appendChild(c);
    }
    card.appendChild(chips);

    const row = document.createElement("div");
    row.className = "row";
    const prev = document.createElement("button");
    prev.textContent = "← 上一张";
    prev.onclick = () => { state.idx[key] = Math.max(0, idx - 1); render(); };
    const next = document.createElement("button");
    next.textContent = "下一张 →";
    next.onclick = () => { state.idx[key] = Math.min(ds.instructions.length - 1, idx + 1); render(); };
    const rand = document.createElement("button");
    rand.className = "primary";
    rand.textContent = "随机一张";
    rand.onclick = () => { state.idx[key] = Math.floor(Math.random() * ds.instructions.length); render(); };
    const speak = document.createElement("button");
    speak.textContent = "🔊 读整句";
    speak.onclick = () => speakUK(item.en);

    const hint = document.createElement("div");
    hint.className = "hint";
    hint.textContent = "提示：点任何单词/短语可查词；Shift+点击可快速加入生词本。";

    row.appendChild(prev);
    row.appendChild(next);
    row.appendChild(rand);
    row.appendChild(speak);
    row.appendChild(document.createElement("div")).className="spacer";
    host.appendChild(card);
    host.appendChild(row);
    host.appendChild(hint);

    bindKwClicks(card, ds);
  }

  function renderQuiz(host, key, ds) {
    if (!state.quiz || state.quiz.subject !== key) startQuiz(key, ds);

    const q = state.quiz;
    if (!q) {
      host.innerHTML = `<div class="hint">该科目的题库不足以生成测验。</div>`;
      return;
    }

    const wrap = document.createElement("div");
    wrap.className = "grid2";

    const left = document.createElement("div");
    left.className = "card";
    const title = document.createElement("div");
    title.className = "badge";
    title.textContent = `测验 · 第 ${q.n} 题 · 得分 ${q.score}/${q.n - (q.chosen ? 0 : 1)}`;
    left.appendChild(title);

    const en = document.createElement("div");
    en.className = "en";
    en.style.marginTop = "10px";
    en.innerHTML = wrapTextWithClicks(q.q.en, ds);
    left.appendChild(en);

    const hint = document.createElement("div");
    hint.className = "hint";
    hint.style.marginTop = "8px";
    hint.textContent = "选出最正确的中文意思（理解题目在问什么）。";
    left.appendChild(hint);

    q.opts.forEach((opt) => {
      const b = document.createElement("button");
      b.className = "quiz-opt";
      b.textContent = opt;
      b.onclick = () => pickQuiz(opt);
      if (q.chosen) {
        if (opt === q.ans) b.classList.add("good");
        else if (opt === q.chosen) b.classList.add("bad");
      }
      left.appendChild(b);
    });

    const row = document.createElement("div");
    row.className = "row";
    const next = document.createElement("button");
    next.className = "primary";
    next.textContent = q.chosen ? "下一题 →" : "跳过 →";
    next.onclick = () => { startQuiz(key, ds); render(); };
    const addAll = document.createElement("button");
    addAll.textContent = "把这句里的生词加入单词本";
    addAll.onclick = () => {
      // add words not in local wordIndex will still be added (term only)
      const words = (q.q.en.match(/[A-Za-z][A-Za-z']*/g) || []);
      words.slice(0, 30).forEach(w => addToWordbook(w, ds.wordIndex?.[w.toLowerCase()]?.zh || ""));
      renderWordbookToast("已加入");
    };
    row.appendChild(next);
    row.appendChild(addAll);
    left.appendChild(row);

    bindKwClicks(left, ds);

    const right = document.createElement("div");
    right.className = "card";
    right.innerHTML = `
      <div class="badge">如何用</div>
      <div style="margin-top:10px">
        <div>✅ 目标：Jayden 看到题目能读懂“要做什么”。</div>
        <div class="small" style="margin-top:8px">建议：每天 5–10 题；错的会自然重复出现（因为随机抽）。</div>
      </div>
    `;

    wrap.appendChild(left);
    wrap.appendChild(right);
    host.appendChild(wrap);
  }

  function renderBank(host, key, ds) {
    const card = document.createElement("div");
    card.className = "card";
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "搜索词库 / Search word bank (e.g. classify, measure, kilometre)";
    card.appendChild(input);

    const list = document.createElement("div");
    list.className = "list";
    card.appendChild(list);

    function draw(q) {
      list.innerHTML = "";
      const query = (q || "").trim().toLowerCase();
      const items = (ds.words || []).filter((w) => {
        if (!query) return true;
        return (w.term || "").toLowerCase().includes(query) || (w.zh || "").includes(query);
      }).slice(0, 200);

      items.forEach((w) => {
        const it = document.createElement("div");
        it.className = "item";
        it.innerHTML = `<div class="k">${escapeHTML(w.term || "")}</div>
                        <div class="z">${escapeHTML(w.zh || "")}</div>
                        <div class="small" style="margin-top:6px">${escapeHTML(w.hint || "")}</div>`;
        it.onclick = () => openGloss(w.term || "", w);
        list.appendChild(it);
      });

      if (items.length === 0) list.innerHTML = `<div class="hint">没有匹配结果。</div>`;
    }

    input.oninput = () => draw(input.value);
    draw("");

    host.appendChild(card);
  }

  function renderDictionary(main) {
    const title = document.createElement("div");
    title.className = "badge";
    title.textContent = "在线词典（输入单词/短语） · Offline-first：断网也能看本地词库 + 已缓存结果";

    main.appendChild(panelHeader(title, null));

    const content = document.createElement("div");
    content.className = "content";
    main.appendChild(content);

    const card = document.createElement("div");
    card.className = "card";

    const row = document.createElement("div");
    row.className = "row";
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "输入英文单词或短语 / Enter a word or phrase";
    input.value = state.dict.q || "";
    const go = document.createElement("button");
    go.className = "primary";
    go.textContent = "查询";
    const add = document.createElement("button");
    add.textContent = "加入单词本";
    add.onclick = () => {
      if (!state.dict.res?.term && !input.value.trim()) return;
      const term = (state.dict.res?.term || input.value).trim();
      addToWordbook(term, state.dict.res?.zh || "");
      renderWordbookToast(term);
    };

    row.appendChild(input);
    row.appendChild(go);
    row.appendChild(add);
    card.appendChild(row);

    const out = document.createElement("div");
    out.style.marginTop = "12px";
    card.appendChild(out);

    async function runLookup() {
      const q = input.value.trim();
      if (!q) return;
      state.dict.q = q;
      state.dict.loading = true;
      state.dict.err = "";
      out.innerHTML = `<div class="hint">查询中…（需要联网；会自动缓存）</div>`;
      try {
        const res = await lookupDictionary(q);
        state.dict.res = res;
        state.dict.loading = false;

        out.innerHTML = `
          <div class="pill"><b>${escapeHTML(res.term || q)}</b> <span class="mono">${escapeHTML(res.phonetic || "")}</span></div>
          <div style="margin-top:10px;font-weight:750">${escapeHTML(res.zh || "")}</div>
          <div class="small" style="margin-top:8px">${escapeHTML(res.definition || "")}</div>
          <div class="row" style="margin-top:12px">
            <button class="primary" id="dictSpeak">🔊 英式发音</button>
            <button id="dictOpen">打开释义弹窗</button>
          </div>
        `;
        out.querySelector("#dictSpeak").onclick = () => speakUK(res.term || q);
        out.querySelector("#dictOpen").onclick = () => openGloss(res.term || q, null);
      } catch (e) {
        state.dict.loading = false;
        state.dict.err = "查询失败（可能断网或接口限流）。";
        out.innerHTML = `<div class="hint">${state.dict.err}</div>`;
      }
    }

    go.onclick = runLookup;
    input.onkeydown = (e) => { if (e.key === "Enter") runLookup(); };

    content.appendChild(card);
  }

  function renderWordbook(main) {
    const title = document.createElement("div");
    title.className = "badge";
    title.textContent = "生词本（本机离线保存） · 可用于复习";

    main.appendChild(panelHeader(title, null));

    const content = document.createElement("div");
    content.className = "content";
    main.appendChild(content);

    const card = document.createElement("div");
    card.className = "card";
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "搜索生词本 / Search wordbook";
    card.appendChild(input);

    const list = document.createElement("div");
    list.className = "list";
    card.appendChild(list);

    const row = document.createElement("div");
    row.className = "row";
    const exportBtn = document.createElement("button");
    exportBtn.textContent = "导出 JSON";
    exportBtn.onclick = () => {
      const data = JSON.stringify(getWordbook(), null, 2);
      const blob = new Blob([data], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "wordbook.json";
      a.click();
      URL.revokeObjectURL(url);
    };
    const clearBtn = document.createElement("button");
    clearBtn.textContent = "清空";
    clearBtn.onclick = () => {
      if (confirm("确认清空生词本？")) {
        saveWordbook([]);
        render();
      }
    };
    row.appendChild(exportBtn);
    row.appendChild(clearBtn);
    card.appendChild(row);

    function draw(q) {
      list.innerHTML = "";
      const query = (q || "").trim().toLowerCase();
      const items = getWordbook().filter((x) => !query || x.term.toLowerCase().includes(query) || (x.zh||"").includes(query));
      if (items.length === 0) {
        list.innerHTML = `<div class="hint">还没有生词。你可以在题目里 Shift+点击单词，或在词典页加入。</div>`;
        return;
      }
      items.slice(0, 500).forEach((x) => {
        const it = document.createElement("div");
        it.className = "item";
        it.innerHTML = `<div class="k">${escapeHTML(x.term)}</div>
                        <div class="z">${escapeHTML(x.zh || "")}</div>
                        <div class="small" style="margin-top:6px">复习次数：${x.seen || 1}</div>
                        <div class="row" style="margin-top:10px">
                          <button class="primary">🔊 发音</button>
                          <button>查词</button>
                          <button>删除</button>
                        </div>`;
        const [b1,b2,b3] = it.querySelectorAll("button");
        b1.onclick = (e) => { e.stopPropagation(); speakUK(x.term); };
        b2.onclick = (e) => { e.stopPropagation(); openGloss(x.term, null); };
        b3.onclick = (e) => {
          e.stopPropagation();
          const wb = getWordbook().filter((k) => k.key !== x.key);
          saveWordbook(wb);
          render();
        };
        list.appendChild(it);
      });
    }

    input.oninput = () => draw(input.value);
    draw("");

    content.appendChild(card);
  }

  function renderProgress(main) {
    const title = document.createElement("div");
    title.className = "badge";
    title.textContent = "学习成果（本机）";

    main.appendChild(panelHeader(title, null));
    const content = document.createElement("div");
    content.className = "content";
    main.appendChild(content);

    const wb = getWordbook();
    const cache = (() => { try { return JSON.parse(localStorage.getItem("dictCache")||"{}"); } catch(_) { return {}; } })();
    const cachedCount = Object.keys(cache).length;

    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <div class="en">当前设备进度</div>
      <div class="cn">This device only (offline). 不会上传云端。</div>
      <div class="chips">
        <span class="chip">生词本：${wb.length} 个</span>
        <span class="chip">已缓存词典：${cachedCount} 条</span>
      </div>
      <div class="small" style="margin-top:12px">
        建议：每周导出一次生词本 JSON 作为备份（可存在 iCloud/Google Drive）。
      </div>
    `;
    content.appendChild(card);
  }

  function render() {
    renderTabs();
    renderMain();
    applyTheme();
  }

  // click outside dialog closes
  dlg.addEventListener("click", (e) => {
    const rect = dlg.getBoundingClientRect();
    const inDialog =
      rect.top <= e.clientY &&
      e.clientY <= rect.top + rect.height &&
      rect.left <= e.clientX &&
      e.clientX <= rect.left + rect.width;
    if (!inDialog) dlg.close();
  });

  // Keyboard shortcuts (desktop)
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && dlg.open) dlg.close();
  });

  // Boot
  preloadCore().catch(() => {
    applyTheme();
    render();
  });

})();