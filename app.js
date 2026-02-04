// P3 Reader (offline, bilingual) - vanilla JS
const SUBJECTS = [
  {key:'home', en:'Home', zh:'今日'},
  {key:'math', en:'Math', zh:'数学'},
  {key:'science', en:'Science', zh:'科学'},
  {key:'english', en:'English', zh:'英语'},
  {key:'social_studies', en:'Social Studies', zh:'社会研究'},
  {key:'chinese', en:'Chinese', zh:'华文'},
  {key:'quiz', en:'Quiz', zh:'测验'},
  {key:'wordbank', en:'Word Bank', zh:'生词本'},
  {key:'progress', en:'Progress', zh:'成果'},
  {key:'backup', en:'Backup', zh:'备份'}
];

const SUBPAGES = ['learn','drills','words'];
const SUBPAGE_LABELS = {
  learn: {en:'Learn', zh:'读题'},
  drills:{en:'Drills', zh:'快练'},
  words: {en:'Words', zh:'词库'}
};

// ---------- Storage ----------
const LS_KEY = 'p3_reader_state_v1';
function loadState(){
  try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch(e){ return {}; }
}
function saveState(s){ localStorage.setItem(LS_KEY, JSON.stringify(s)); }

let state = loadState();
state.cnOn = (state.cnOn !== false); // default on
state.wordbank = state.wordbank || {}; // wordId -> {addedAt, mastery}
state.stats = state.stats || {}; // subject -> {tagStats: {tag:{seen,wrong,lastTs}}, history:[...]}

function bumpTag(subject, tags, correct){
  state.stats[subject] = state.stats[subject] || { tagStats:{}, history:[] };
  const ts = Date.now();
  for(const t of (tags||[])){
    const cur = state.stats[subject].tagStats[t] || {seen:0, wrong:0, lastTs:0};
    cur.seen += 1;
    if(!correct) cur.wrong += 1;
    cur.lastTs = ts;
    state.stats[subject].tagStats[t] = cur;
  }
  saveState(state);
}

function toast(msg){
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.style.display='block';
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(()=>{ el.style.display='none'; }, 1800);
}

// ---------- Data loading ----------
const CACHE = { instructions:{}, words:{}, patterns:{} };

async function loadJSON(path){
  const res = await fetch(path);
  if(!res.ok) throw new Error('Failed to load ' + path);
  return await res.json();
}

async function loadSubjectData(subject){
  if(subject==='home' || subject==='quiz' || subject==='wordbank' || subject==='progress' || subject==='backup') return;
  if(CACHE.instructions[subject]) return;
  const base = `data/${subject}/`;
  const [inst, words, patterns] = await Promise.all([
    loadJSON(base + 'instructions.json'),
    loadJSON(base + 'words.json'),
    loadJSON(base + 'patterns.json'),
  ]);
  CACHE.instructions[subject]=inst;
  CACHE.words[subject]=words;
  CACHE.patterns[subject]=patterns;
}

function findWord(subject, lemma){
  const words = CACHE.words[subject] || [];
  const norm = lemma.toLowerCase();
  let w = words.find(x => (x.lemma||'').toLowerCase() === norm || (x.id||'').toLowerCase() === norm);
  if(!w){
    // fallback: search by synonyms
    w = words.find(x => (x.synonyms||[]).map(s=>String(s).toLowerCase()).includes(norm));
  }
  return w || null;
}

// ---------- UI ----------
let currentTab = state.currentTab || 'home';
let currentSub = state.currentSub || 'learn';
let currentLearnIndex = state.currentLearnIndex || {}; // per subject

const tabsEl = document.getElementById('tabs');
const appEl = document.getElementById('app');
const toggleCNBtn = document.getElementById('toggleCN');

toggleCNBtn.onclick = () => {
  state.cnOn = !state.cnOn;
  saveState(state);
  toggleCNBtn.textContent = state.cnOn ? '中文: 开' : '中文: 关';
  render();
};

function setStatus(msg){
  document.getElementById('statusLine').textContent = msg;
}

function renderTabs(){
  tabsEl.innerHTML='';
  for(const t of SUBJECTS){
    const btn = document.createElement('button');
    btn.className = 'tab' + (t.key===currentTab ? ' active':'');
    btn.textContent = state.cnOn ? t.zh : t.en;
    btn.onclick = async () => {
      currentTab = t.key;
      state.currentTab = currentTab;
      // reset subpage for special tabs
      if(['home','quiz','wordbank','progress','backup'].includes(currentTab)) currentSub = 'learn';
      saveState(state);
      if(!['home','quiz','wordbank','progress','backup'].includes(currentTab)){
        await loadSubjectData(currentTab);
      }
      render();
    };
    tabsEl.appendChild(btn);
  }
}

function renderSubtabs(subject){
  const wrap = document.createElement('div');
  wrap.className='subtabs';
  for(const k of SUBPAGES){
    const btn = document.createElement('button');
    btn.className = 'subtab' + (currentSub===k ? ' active':'');
    btn.textContent = state.cnOn ? SUBPAGE_LABELS[k].zh : SUBPAGE_LABELS[k].en;
    btn.onclick = () => {
      currentSub = k;
      state.currentSub = k;
      saveState(state);
      render();
    };
    wrap.appendChild(btn);
  }
  return wrap;
}

function kwWrap(text, subject){
  // wrap known keywords as clickable spans
  const words = CACHE.words[subject] || [];
  const lemmas = new Set(words.map(w=>String(w.lemma||'').toLowerCase()).filter(Boolean));
  // also include some common unit tokens
  const extra = ['km','m','cm','mm','g','kg','ml','l','<','>','=','total','left','remaining','difference'];
  extra.forEach(x=>lemmas.add(x));
  // tokenize by word boundaries while keeping punctuation
  return text.replace(/\b([A-Za-z]+|km|cm|mm|kg|ml|km|m)\b/g, (m)=>{
    const l = m.toLowerCase();
    if(lemmas.has(l)){
      return `<span class="kw" data-lemma="${encodeURIComponent(m)}">${m}</span>`;
    }
    return m;
  });
}

function attachKwHandlers(container, subject){
  container.querySelectorAll('.kw').forEach(el=>{
    el.addEventListener('click', ()=>{
      const lemma = decodeURIComponent(el.getAttribute('data-lemma'));
      openWordDialog(subject, lemma);
    });
  });
}

function openWordDialog(subject, lemma){
  // try subject word first, then fallback to math/science common
  let w = findWord(subject, lemma);
  if(!w){
    for(const s of ['math','science','english','social_studies','chinese']){
      if(CACHE.words[s]){
        w = findWord(s, lemma);
        if(w){ subject = s; break; }
      }
    }
  }
  const dlg = document.getElementById('wordDialog');
  const title = document.getElementById('wdTitle');
  const pos = document.getElementById('wdPos');
  const body = document.getElementById('wdBody');
  const addBtn = document.getElementById('addWordBtn');

  if(!w){
    title.textContent = lemma;
    pos.textContent = state.cnOn ? '未在词库中找到（可后续补充）' : 'Not found in word list (can add later)';
    body.innerHTML = `<div class="muted">${state.cnOn?'建议：把这个词加入预制词库 JSON':'Tip: add this word to the JSON word list'}</div>`;
    addBtn.onclick = () => {
      const id = 'custom_' + lemma.toLowerCase();
      state.wordbank[id] = { lemma, subject, addedAt: Date.now(), mastery: 0 };
      saveState(state);
      toast(state.cnOn?'已加入生词本':'Added to Word Bank');
      dlg.close();
    };
    dlg.showModal();
    return;
  }

  title.textContent = `${w.lemma}`;
  pos.textContent = `${w.pos || ''}  •  ${subject.toUpperCase()}`;
  const ex = (w.examples||[]).slice(0,3).map(e=>`<li>${e.en}${state.cnOn?`<div class="muted">${e.zh||''}</div>`:''}</li>`).join('');
  const coll = (w.collocations||[]).slice(0,6).map(c=>`<span class="pill">${c}</span>`).join(' ');
  const syn = (w.synonyms||[]).slice(0,8).map(s=>`<span class="pill">${s}</span>`).join(' ');
  body.innerHTML = `
    <div><span class="pill">${state.cnOn ? (w.zh||'') : (w.en_simple||'')}</span></div>
    ${state.cnOn ? `<div style="margin-top:8px">${w.en_simple||''}</div>` : (w.zh?`<div style="margin-top:8px" class="muted">${w.zh}</div>`:'')}
    ${coll?`<div class="hr"></div><div class="muted">${state.cnOn?'常见搭配':'Collocations'}</div><div style="margin-top:6px">${coll}</div>`:''}
    ${syn?`<div class="hr"></div><div class="muted">${state.cnOn?'同义词/近义表达':'Synonyms'}</div><div style="margin-top:6px">${syn}</div>`:''}
    ${ex?`<div class="hr"></div><div class="muted">${state.cnOn?'例句':'Examples'}</div><ol style="margin:8px 0 0 18px">${ex}</ol>`:''}
  `;

  const wid = w.id || ('word_' + w.lemma.toLowerCase());
  addBtn.onclick = () => {
    state.wordbank[wid] = { lemma: w.lemma, subject, addedAt: Date.now(), mastery: state.wordbank[wid]?.mastery || 0 };
    saveState(state);
    toast(state.cnOn?'已加入生词本':'Added to Word Bank');
    dlg.close();
    render(); // update counts if needed
  };

  dlg.showModal();
}

function renderHome(){
  const wrap = document.createElement('div');
  wrap.className='grid2';
  const left = document.createElement('div');
  const right = document.createElement('div');

  left.className='panel';
  left.innerHTML = `<h2>${state.cnOn?'今日训练':'Today'}</h2>
    <div class="muted">${state.cnOn?'建议：每天每科 5~10 张读题卡 + 5 个生词复习。':'Tip: 5–10 instruction cards per subject + 5 word reviews daily.'}</div>
    <div class="hr"></div>
    <div class="row">
      <button class="btn primary" id="goQuiz">${state.cnOn?'开始测验':'Start Quiz'}</button>
      <button class="btn" id="goWB">${state.cnOn?'复习生词':'Review Word Bank'}</button>
    </div>
  `;

  right.className='panel';
  const wbCount = Object.keys(state.wordbank||{}).length;
  right.innerHTML = `<h2>${state.cnOn?'快速概览':'Quick stats'}</h2>
    <div class="kpi">
      <div class="panel"><div class="muted">${state.cnOn?'生词本':'Word Bank'}</div><div class="score">${wbCount}</div></div>
      <div class="panel"><div class="muted">${state.cnOn?'最近薄弱标签':'Weak tags (14d)'}</div><div id="weakTags" class="muted">—</div></div>
    </div>
  `;

  wrap.appendChild(left); wrap.appendChild(right);

  setTimeout(()=>{
    document.getElementById('goQuiz').onclick = ()=>{ currentTab='quiz'; state.currentTab='quiz'; saveState(state); render(); };
    document.getElementById('goWB').onclick = ()=>{ currentTab='wordbank'; state.currentTab='wordbank'; saveState(state); render(); };
    // compute weak tags overall
    const tagScores = [];
    for(const s of Object.keys(state.stats||{})){
      const ts = state.stats[s]?.tagStats || {};
      for(const [tag, v] of Object.entries(ts)){
        const seen = v.seen||0, wrong=v.wrong||0;
        if(seen>=3){
          tagScores.push({s, tag, rate: wrong/seen});
        }
      }
    }
    tagScores.sort((a,b)=>b.rate-a.rate);
    const top = tagScores.slice(0,6).map(x=>`${x.tag} (${Math.round(x.rate*100)}%)`).join(' • ');
    const el = document.getElementById('weakTags');
    if(el) el.textContent = top || '—';
  }, 0);

  return wrap;
}

function renderSubject(subject){
  const wrap = document.createElement('div');
  wrap.appendChild(renderSubtabs(subject));

  if(currentSub==='learn') wrap.appendChild(renderLearn(subject));
  if(currentSub==='drills') wrap.appendChild(renderDrills(subject));
  if(currentSub==='words') wrap.appendChild(renderWords(subject));

  return wrap;
}

function getLearnIdx(subject){
  currentLearnIndex[subject] = currentLearnIndex[subject] || 0;
  return currentLearnIndex[subject];
}
function setLearnIdx(subject, idx){
  currentLearnIndex[subject]=idx;
  state.currentLearnIndex = currentLearnIndex;
  saveState(state);
}

function renderLearn(subject){
  const inst = CACHE.instructions[subject] || [];
  const idx = Math.min(getLearnIdx(subject), Math.max(inst.length-1,0));
  const card = inst[idx];

  const el = document.createElement('div');
  el.className='card';
  if(!card){
    el.innerHTML = `<div class="muted">${state.cnOn?'该学科暂无内容（检查 data JSON）':'No content (check data JSON)'}</div>`;
    return el;
  }

  const en = kwWrap(card.text_en, subject);
  const zh = card.text_zh || '';
  const cnBlock = state.cnOn ? `<div style="margin-top:10px" class="muted">${zh}</div>` : '';
  const tags = (card.tags||[]).slice(0,6).map(t=>`<span class="pill">${t}</span>`).join(' ');
  el.innerHTML = `
    <div class="row" style="justify-content:space-between; align-items:center;">
      <div class="pill">${subject.toUpperCase()} • ${card.topic || 'general'}</div>
      <div class="muted">#${idx+1}/${inst.length}</div>
    </div>
    <div style="margin-top:10px; font-size:18px; line-height:1.45">${en}</div>
    ${cnBlock}
    <div style="margin-top:10px">${tags}</div>

    <div class="hr"></div>
    <div class="muted">${state.cnOn?'1) 这题要你做什么？':'1) What to do?'}</div>
    <div class="choices" id="q1"></div>

    <div class="muted" style="margin-top:10px">${state.cnOn?'2) 你需要抓哪些信息？':'2) What to notice?'}</div>
    <div class="choices" id="q2"></div>

    <div class="muted" style="margin-top:10px">${state.cnOn?'3) 最终要输出什么格式？':'3) What to write?'}</div>
    <div class="choices" id="q3"></div>

    <div class="hr"></div>
    <div class="row">
      <button class="btn" id="prevBtn">← ${state.cnOn?'上一张':'Prev'}</button>
      <button class="btn primary" id="checkBtn">${state.cnOn?'提交并评分':'Check'}</button>
      <button class="btn" id="nextBtn">${state.cnOn?'下一张':'Next'} →</button>
    </div>
    <div id="result" style="margin-top:10px"></div>
  `;

  setTimeout(()=>{
    attachKwHandlers(el, subject);

    // render choices
    const q1 = el.querySelector('#q1');
    const q2 = el.querySelector('#q2');
    const q3 = el.querySelector('#q3');

    const correct1 = new Set(card.quiz?.task_types || []);
    const correct2 = new Set(card.quiz?.notice || []);
    const correct3 = card.quiz?.output || '';

    // Provide plausible options (including correct)
    const bank1 = (CACHE.patterns[subject]?.task_types || []).slice();
    const bank2 = (CACHE.patterns[subject]?.notice || []).slice();
    const bank3 = (CACHE.patterns[subject]?.outputs || []).slice();

    function sampleWithCorrect(bank, correctSet, n){
      const opts = new Set([...correctSet]);
      while(opts.size < Math.min(n, bank.length)){
        opts.add(bank[Math.floor(Math.random()*bank.length)]);
      }
      return [...opts];
    }
    function sampleOneWithCorrect(bank, correctVal, n){
      const opts = new Set([correctVal]);
      while(opts.size < Math.min(n, bank.length)){
        opts.add(bank[Math.floor(Math.random()*bank.length)]);
      }
      return [...opts];
    }

    const opts1 = sampleWithCorrect(bank1, correct1, 6);
    const opts2 = sampleWithCorrect(bank2, correct2, 6);
    const opts3 = sampleOneWithCorrect(bank3, correct3, 5);

    let sel1 = new Set();
    let sel2 = new Set();
    let sel3 = '';

    // q1 can be multi-select (some cards have multiple)
    opts1.forEach(o=>{
      const chip = document.createElement('div');
      chip.className='chip';
      chip.textContent = labelFor(subject, 'task', o);
      chip.onclick = ()=>{
        if(sel1.has(o)) sel1.delete(o); else sel1.add(o);
        chip.classList.toggle('sel');
      };
      q1.appendChild(chip);
    });

    // q2 multi-select
    opts2.forEach(o=>{
      const chip = document.createElement('div');
      chip.className='chip';
      chip.textContent = labelFor(subject, 'notice', o);
      chip.onclick = ()=>{
        if(sel2.has(o)) sel2.delete(o); else sel2.add(o);
        chip.classList.toggle('sel');
      };
      q2.appendChild(chip);
    });

    // q3 single select
    opts3.forEach(o=>{
      const chip = document.createElement('div');
      chip.className='chip';
      chip.textContent = labelFor(subject, 'output', o);
      chip.onclick = ()=>{
        sel3 = o;
        [...q3.children].forEach(c=>c.classList.remove('sel'));
        chip.classList.add('sel');
      };
      q3.appendChild(chip);
    });

    el.querySelector('#prevBtn').onclick = ()=>{
      setLearnIdx(subject, Math.max(0, idx-1));
      render();
    };
    el.querySelector('#nextBtn').onclick = ()=>{
      setLearnIdx(subject, Math.min(inst.length-1, idx+1));
      render();
    };

    el.querySelector('#checkBtn').onclick = ()=>{
      let score = 0;
      const ok1 = setEq(sel1, correct1);
      const ok2 = setEq(sel2, correct2);
      const ok3 = (sel3 === correct3 && sel3 !== '');

      if(ok1) score += 1;
      if(ok2) score += 1;
      if(ok3) score += 1;

      const correct = (score === 3);
      bumpTag(subject, card.tags, correct);

      const res = el.querySelector('#result');
      res.innerHTML = `
        <div class="panel">
          <div class="row" style="justify-content:space-between; align-items:center;">
            <div class="score">${score}/3</div>
            <div class="pill">${correct ? (state.cnOn?'正确':'Correct') : (state.cnOn?'需要加强':'Needs work')}</div>
          </div>
          <div class="muted" style="margin-top:6px">${state.cnOn?'正确答案：':'Answer key:'}</div>
          <div style="margin-top:6px">
            <div><span class="muted">1)</span> ${[...correct1].map(x=>labelFor(subject,'task',x)).join(', ')}</div>
            <div><span class="muted">2)</span> ${[...correct2].map(x=>labelFor(subject,'notice',x)).join(', ')}</div>
            <div><span class="muted">3)</span> ${labelFor(subject,'output',correct3)}</div>
          </div>
        </div>
      `;
      toast(correct ? (state.cnOn?'很好！':'Nice!') : (state.cnOn?'记录薄弱点':'Saved as weak point'));
    };
  },0);

  return el;
}

function labelFor(subject, kind, key){
  const map = CACHE.patterns[subject]?.labels || {};
  const k = `${kind}:${key}`;
  if(state.cnOn){
    return (map[k]?.zh) || key;
  }
  return (map[k]?.en) || key;
}

function setEq(a, b){
  if(a.size !== b.size) return false;
  for(const x of a) if(!b.has(x)) return false;
  return true;
}

function renderDrills(subject){
  const inst = CACHE.instructions[subject] || [];
  const el = document.createElement('div');
  el.className='card';

  // Create quick drill: show 8 random instruction lines, pick task type only (fast)
  const n = Math.min(8, inst.length);
  const picks = [];
  const used = new Set();
  while(picks.length<n){
    const i = Math.floor(Math.random()*inst.length);
    if(!used.has(i)){ used.add(i); picks.push(inst[i]); }
  }

  el.innerHTML = `
    <div class="row" style="justify-content:space-between; align-items:center;">
      <div class="pill">${state.cnOn?'快练：只选“任务类型”':'Drills: choose task type'}</div>
      <button class="btn small" id="regen">${state.cnOn?'换一批':'Refresh'}</button>
    </div>
    <div class="hr"></div>
    <div id="drillList"></div>
  `;

  setTimeout(()=>{
    el.querySelector('#regen').onclick = ()=>render();
    const list = el.querySelector('#drillList');
    const bank1 = (CACHE.patterns[subject]?.task_types || []);
    picks.forEach((c, idx)=>{
      const row = document.createElement('div');
      row.className='panel';
      row.style.marginBottom='10px';
      const en = kwWrap(c.text_en, subject);
      row.innerHTML = `
        <div class="muted">#${idx+1}</div>
        <div style="margin-top:6px; font-size:16px; line-height:1.4">${en}</div>
        ${state.cnOn ? `<div class="muted" style="margin-top:6px">${c.text_zh||''}</div>` : ''}
        <div class="choices" style="margin-top:10px"></div>
        <div class="muted" style="margin-top:8px" id="r${idx}"></div>
      `;
      list.appendChild(row);
      attachKwHandlers(row, subject);

      const correct = new Set(c.quiz?.task_types || []);
      const opts = new Set([...correct]);
      while(opts.size < Math.min(5, bank1.length)){
        opts.add(bank1[Math.floor(Math.random()*bank1.length)]);
      }
      const choices = row.querySelector('.choices');
      [...opts].forEach(o=>{
        const chip = document.createElement('div');
        chip.className='chip';
        chip.textContent = labelFor(subject,'task',o);
        chip.onclick = ()=>{
          const ok = (correct.size===1 && correct.has(o));
          chip.classList.add('sel');
          // lock
          [...choices.children].forEach(ch=>ch.style.pointerEvents='none');
          bumpTag(subject, c.tags, ok);
          row.querySelector(`#r${idx}`).textContent = ok ? (state.cnOn?'✅ 正确':'✅ Correct') : (state.cnOn?'❌ 正确是：':'❌ Correct: ') + [...correct].map(x=>labelFor(subject,'task',x)).join(', ');
        };
        choices.appendChild(chip);
      });
    });
  },0);

  return el;
}

function renderWords(subject){
  const words = CACHE.words[subject] || [];
  const el = document.createElement('div');
  el.className='card';

  el.innerHTML = `
    <div class="row" style="justify-content:space-between; align-items:center;">
      <div class="pill">${state.cnOn?'高频词库':'High-frequency words'} • ${words.length}</div>
      <input id="wsearch" placeholder="${state.cnOn?'搜索英文词…':'Search word…'}" style="max-width:280px" />
    </div>
    <div class="hr"></div>
    <div id="wlist"></div>
  `;

  setTimeout(()=>{
    const list = el.querySelector('#wlist');
    const input = el.querySelector('#wsearch');

    function renderList(q=''){
      list.innerHTML='';
      const qq = q.trim().toLowerCase();
      const filtered = qq ? words.filter(w => (w.lemma||'').toLowerCase().includes(qq) || (w.zh||'').includes(q)) : words.slice(0,120);
      filtered.forEach(w=>{
        const wid = w.id || ('word_' + w.lemma.toLowerCase());
        const inWB = !!state.wordbank[wid];
        const row = document.createElement('div');
        row.className='panel';
        row.innerHTML = `
          <div class="row" style="justify-content:space-between; align-items:center;">
            <div>
              <div style="font-weight:700">${w.lemma} <span class="muted" style="font-weight:400">${w.pos||''}</span></div>
              <div class="muted">${state.cnOn ? (w.zh||'') : (w.en_simple||'')}</div>
            </div>
            <button class="btn small ${inWB?'primary':''}">${inWB ? (state.cnOn?'已加入':'Added') : '⭐'}</button>
          </div>
        `;
        row.querySelector('button').onclick = ()=>{
          state.wordbank[wid] = { lemma: w.lemma, subject, addedAt: Date.now(), mastery: state.wordbank[wid]?.mastery || 0 };
          saveState(state);
          toast(state.cnOn?'已加入生词本':'Added to Word Bank');
          render();
        };
        row.onclick = (e)=>{
          if(e.target.tagName.toLowerCase()==='button') return;
          openWordDialog(subject, w.lemma);
        };
        list.appendChild(row);
      });
      if(filtered.length===0){
        list.innerHTML = `<div class="muted">${state.cnOn?'没有匹配结果':'No matches'}</div>`;
      }
    }
    renderList();
    input.oninput = ()=>renderList(input.value);
  },0);

  return el;
}

function renderQuiz(){
  const el = document.createElement('div');
  el.className='card';

  el.innerHTML = `
    <h2>${state.cnOn?'随机测验（按薄弱权重）':'Weighted Random Quiz'}</h2>
    <div class="muted">${state.cnOn?'先选学科，再生成题目。每题只测“读懂题意”，不测计算。':'Choose a subject. Each item tests understanding only (not calculation).'} </div>
    <div class="hr"></div>

    <label>${state.cnOn?'学科':'Subject'}</label>
    <select id="qSub">
      <option value="math">Math / 数学</option>
      <option value="science">Science / 科学</option>
      <option value="english">English / 英语</option>
      <option value="social_studies">Social Studies / 社会研究</option>
      <option value="chinese">Chinese / 华文</option>
    </select>

    <label>${state.cnOn?'题量':'Number of items'}</label>
    <select id="qCount">
      <option value="5">5</option>
      <option value="10" selected>10</option>
      <option value="20">20</option>
    </select>

    <div class="row" style="margin-top:12px">
      <button class="btn primary" id="startQuiz">${state.cnOn?'开始':'Start'}</button>
      <button class="btn" id="resetQuiz">${state.cnOn?'清空本地统计':'Reset stats'}</button>
    </div>

    <div class="hr"></div>
    <div id="quizArea"></div>
  `;

  setTimeout(async ()=>{
    const start = el.querySelector('#startQuiz');
    const reset = el.querySelector('#resetQuiz');
    const area = el.querySelector('#quizArea');
    const sel = el.querySelector('#qSub');
    const cnt = el.querySelector('#qCount');

    reset.onclick = ()=>{
      if(confirm(state.cnOn?'确认清空统计？（不会删除词库）':'Reset stats?')){
        state.stats = {};
        saveState(state);
        toast(state.cnOn?'已清空统计':'Stats reset');
        render();
      }
    };

    start.onclick = async ()=>{
      const subject = sel.value;
      await loadSubjectData(subject);
      const inst = CACHE.instructions[subject] || [];
      const n = parseInt(cnt.value,10);
      if(inst.length===0){
        area.innerHTML = `<div class="muted">No data for ${subject}</div>`;
        return;
      }
      const picked = weightedPick(subject, n);
      runQuiz(area, subject, picked);
    };
  },0);

  return el;
}

function weightedPick(subject, n){
  const inst = CACHE.instructions[subject] || [];
  const tagStats = state.stats[subject]?.tagStats || {};
  // compute per-tag weight
  const tagWeight = {};
  for(const c of inst){
    for(const t of (c.tags||[])){
      if(tagWeight[t] == null) tagWeight[t] = 1;
    }
  }
  for(const [t,v] of Object.entries(tagStats)){
    const seen = v.seen||0, wrong=v.wrong||0;
    const wrongRate = seen ? (wrong/seen) : 0;
    // basic weight formula
    tagWeight[t] = 1 + 2*wrongRate + 0.5*Math.max(0, 3-seen)/3;
  }
  // pick cards by first picking a tag, then a card from that tag
  const tags = Object.keys(tagWeight);
  const tagCum = [];
  let sum = 0;
  for(const t of tags){
    sum += tagWeight[t];
    tagCum.push([t,sum]);
  }
  function pickTag(){
    const r = Math.random()*sum;
    for(const [t,c] of tagCum) if(r<=c) return t;
    return tags[tags.length-1];
  }

  const picked = [];
  const used = new Set();
  let guard = 0;
  while(picked.length < Math.min(n, inst.length) && guard < 5000){
    guard++;
    const t = pickTag();
    const candidates = inst.map((c,i)=>({c,i})).filter(x=> (x.c.tags||[]).includes(t));
    if(candidates.length===0) continue;
    const x = candidates[Math.floor(Math.random()*candidates.length)];
    if(used.has(x.i)) continue;
    used.add(x.i);
    picked.push(x.c);
  }
  // fallback fill random
  while(picked.length < Math.min(n, inst.length)){
    const i = Math.floor(Math.random()*inst.length);
    if(!used.has(i)){ used.add(i); picked.push(inst[i]); }
  }
  return picked;
}

function runQuiz(container, subject, cards){
  let idx = 0;
  let total = cards.length * 3;
  let got = 0;
  const answers = [];

  function renderOne(){
    const c = cards[idx];
    const en = kwWrap(c.text_en, subject);
    container.innerHTML = `
      <div class="panel">
        <div class="row" style="justify-content:space-between; align-items:center;">
          <div class="pill">${subject.toUpperCase()} • ${state.cnOn?'测验':'Quiz'} • ${idx+1}/${cards.length}</div>
          <div class="muted">${state.cnOn?'总分':'Score'}: <span class="score">${got}</span> / ${total}</div>
        </div>
        <div style="margin-top:10px; font-size:18px; line-height:1.45">${en}</div>
        ${state.cnOn ? `<div class="muted" style="margin-top:10px">${c.text_zh||''}</div>` : ''}

        <div class="hr"></div>
        <div class="muted">${state.cnOn?'1) 这题要你做什么？':'1) What to do?'}</div>
        <div class="choices" id="q1"></div>

        <div class="muted" style="margin-top:10px">${state.cnOn?'2) 你需要抓哪些信息？':'2) What to notice?'}</div>
        <div class="choices" id="q2"></div>

        <div class="muted" style="margin-top:10px">${state.cnOn?'3) 最终要输出什么格式？':'3) What to write?'}</div>
        <div class="choices" id="q3"></div>

        <div class="hr"></div>
        <div class="row">
          <button class="btn primary" id="submit">${state.cnOn?'提交':'Submit'}</button>
          <button class="btn" id="skip">${state.cnOn?'跳过':'Skip'}</button>
        </div>
        <div id="fb" style="margin-top:10px"></div>
      </div>
    `;
    attachKwHandlers(container, subject);

    const correct1 = new Set(c.quiz?.task_types || []);
    const correct2 = new Set(c.quiz?.notice || []);
    const correct3 = c.quiz?.output || '';

    const bank1 = (CACHE.patterns[subject]?.task_types || []).slice();
    const bank2 = (CACHE.patterns[subject]?.notice || []).slice();
    const bank3 = (CACHE.patterns[subject]?.outputs || []).slice();

    const q1 = container.querySelector('#q1');
    const q2 = container.querySelector('#q2');
    const q3 = container.querySelector('#q3');

    const opts1 = sampleWithCorrect(bank1, correct1, 6);
    const opts2 = sampleWithCorrect(bank2, correct2, 6);
    const opts3 = sampleOneWithCorrect(bank3, correct3, 5);

    let sel1 = new Set(), sel2 = new Set(), sel3 = '';

    opts1.forEach(o=>{
      const chip = document.createElement('div');
      chip.className='chip';
      chip.textContent = labelFor(subject,'task',o);
      chip.onclick = ()=>{ sel1.has(o) ? (sel1.delete(o), chip.classList.remove('sel')) : (sel1.add(o), chip.classList.add('sel')); };
      q1.appendChild(chip);
    });
    opts2.forEach(o=>{
      const chip = document.createElement('div');
      chip.className='chip';
      chip.textContent = labelFor(subject,'notice',o);
      chip.onclick = ()=>{ sel2.has(o) ? (sel2.delete(o), chip.classList.remove('sel')) : (sel2.add(o), chip.classList.add('sel')); };
      q2.appendChild(chip);
    });
    opts3.forEach(o=>{
      const chip = document.createElement('div');
      chip.className='chip';
      chip.textContent = labelFor(subject,'output',o);
      chip.onclick = ()=>{
        sel3 = o;
        [...q3.children].forEach(c=>c.classList.remove('sel'));
        chip.classList.add('sel');
      };
      q3.appendChild(chip);
    });

    container.querySelector('#skip').onclick = ()=>{
      answers.push({cardId:c.id, score:0, tags:c.tags||[]});
      bumpTag(subject, c.tags, false);
      idx++;
      if(idx>=cards.length) return renderReport();
      renderOne();
    };

    container.querySelector('#submit').onclick = ()=>{
      let s = 0;
      if(setEq(sel1, correct1)) s++;
      if(setEq(sel2, correct2)) s++;
      if(sel3===correct3 && sel3!=='') s++;

      got += s;
      const correct = (s===3);
      bumpTag(subject, c.tags, correct);

      answers.push({cardId:c.id, score:s, tags:c.tags||[]});

      const fb = container.querySelector('#fb');
      fb.innerHTML = `
        <div class="panel">
          <div class="row" style="justify-content:space-between; align-items:center;">
            <div class="score">${s}/3</div>
            <div class="pill">${correct ? (state.cnOn?'正确':'Correct') : (state.cnOn?'需要加强':'Needs work')}</div>
          </div>
          <div class="muted" style="margin-top:6px">${state.cnOn?'正确答案：':'Answer key:'}</div>
          <div style="margin-top:6px">
            <div><span class="muted">1)</span> ${[...correct1].map(x=>labelFor(subject,'task',x)).join(', ')}</div>
            <div><span class="muted">2)</span> ${[...correct2].map(x=>labelFor(subject,'notice',x)).join(', ')}</div>
            <div><span class="muted">3)</span> ${labelFor(subject,'output',correct3)}</div>
          </div>
          <div class="hr"></div>
          <button class="btn primary" id="nextOne">${state.cnOn?'下一题':'Next'}</button>
        </div>
      `;
      container.querySelector('#nextOne').onclick = ()=>{
        idx++;
        if(idx>=cards.length) return renderReport();
        renderOne();
      };
    };
  }

  function renderReport(){
    // aggregate weak tags
    const tagAgg = {};
    for(const a of answers){
      for(const t of (a.tags||[])){
        tagAgg[t] = tagAgg[t] || {seen:0, score:0};
        tagAgg[t].seen += 1;
        tagAgg[t].score += a.score;
      }
    }
    const tagList = Object.entries(tagAgg).map(([t,v])=>{
      const rate = v.seen ? (v.score/(v.seen*3)) : 0;
      return {tag:t, rate};
    }).sort((a,b)=>a.rate-b.rate).slice(0,8);

    container.innerHTML = `
      <div class="card">
        <h2>${state.cnOn?'测验报告':'Quiz Report'}</h2>
        <div class="row" style="justify-content:space-between; align-items:center;">
          <div class="score">${got} / ${total}</div>
          <div class="pill">${state.cnOn?'学科':'Subject'}: ${subject.toUpperCase()}</div>
        </div>
        <div class="hr"></div>
        <div class="muted">${state.cnOn?'薄弱标签（优先复习）':'Weak tags (review first)'}</div>
        <div style="margin-top:8px">${tagList.map(x=>`<span class="pill">${x.tag} • ${Math.round(x.rate*100)}%</span>`).join(' ') || '—'}</div>
        <div class="hr"></div>
        <div class="row">
          <button class="btn primary" id="again">${state.cnOn?'再测一次':'Try again'}</button>
          <button class="btn" id="goLearn">${state.cnOn?'去读题':'Go Learn'}</button>
        </div>
      </div>
    `;
    container.querySelector('#again').onclick = ()=>runQuiz(container, subject, weightedPick(subject, cards.length));
    container.querySelector('#goLearn').onclick = ()=>{
      currentTab = subject; state.currentTab = subject; currentSub='learn'; state.currentSub='learn'; saveState(state); render();
    };
  }

  function sampleWithCorrect(bank, correctSet, n){
    const opts = new Set([...correctSet]);
    while(opts.size < Math.min(n, bank.length)){
      opts.add(bank[Math.floor(Math.random()*bank.length)]);
    }
    return [...opts];
  }
  function sampleOneWithCorrect(bank, correctVal, n){
    const opts = new Set([correctVal]);
    while(opts.size < Math.min(n, bank.length)){
      opts.add(bank[Math.floor(Math.random()*bank.length)]);
    }
    return [...opts];
  }

  renderOne();
}

function renderWordBank(){
  const el = document.createElement('div');
  el.className='card';
  const ids = Object.keys(state.wordbank||{});
  el.innerHTML = `
    <div class="row" style="justify-content:space-between; align-items:center;">
      <h2 style="margin:0">${state.cnOn?'生词本':'Word Bank'}</h2>
      <div class="pill">${ids.length}</div>
    </div>
    <div class="muted">${state.cnOn?'点击词条可查看解释。':'Tap an item to view details.'}</div>
    <div class="hr"></div>
    <div id="wbList"></div>
    <div class="hr"></div>
    <div class="row">
      <button class="btn danger" id="clearWB">${state.cnOn?'清空生词本':'Clear Word Bank'}</button>
    </div>
  `;
  setTimeout(async ()=>{
    const list = el.querySelector('#wbList');
    list.innerHTML='';
    if(ids.length===0){
      list.innerHTML = `<div class="muted">${state.cnOn?'还没有生词。点题干里的词即可加入。':'No words yet. Tap a keyword to add.'}</div>`;
    } else {
      // group by subject
      const bySub = {};
      for(const id of ids){
        const w = state.wordbank[id];
        bySub[w.subject] = bySub[w.subject] || [];
        bySub[w.subject].push({id, ...w});
      }
      for(const [sub, arr] of Object.entries(bySub)){
        const box = document.createElement('div');
        box.className='panel';
        box.innerHTML = `<div class="pill">${sub.toUpperCase()} • ${arr.length}</div><div class="hr"></div>`;
        arr.sort((a,b)=>(b.addedAt||0)-(a.addedAt||0)).slice(0,120).forEach(item=>{
          const row = document.createElement('div');
          row.className='row';
          row.style.justifyContent='space-between';
          row.style.alignItems='center';
          row.style.padding='8px 0';
          row.innerHTML = `<div><b>${item.lemma}</b> <span class="muted">(${Math.round((item.mastery||0)*100)}%)</span></div>
            <button class="btn small">✕</button>`;
          row.onclick = (e)=>{
            if(e.target.tagName.toLowerCase()==='button') return;
            // ensure subject data loaded
            loadSubjectData(sub).then(()=>openWordDialog(sub, item.lemma));
          };
          row.querySelector('button').onclick = ()=>{
            delete state.wordbank[item.id];
            saveState(state);
            toast(state.cnOn?'已移除':'Removed');
            render();
          };
          box.appendChild(row);
        });
        list.appendChild(box);
      }
    }
    el.querySelector('#clearWB').onclick = ()=>{
      if(confirm(state.cnOn?'确认清空生词本？':'Clear Word Bank?')){
        state.wordbank = {};
        saveState(state);
        render();
      }
    };
  },0);
  return el;
}

function renderProgress(){
  const el = document.createElement('div');
  el.className='card';

  const blocks = [];
  for(const s of ['math','science','english','social_studies','chinese']){
    const ts = state.stats[s]?.tagStats || {};
    let seen=0, wrong=0;
    for(const v of Object.values(ts)){
      seen += v.seen||0;
      wrong += v.wrong||0;
    }
    const rate = seen ? (1 - wrong/seen) : 0;
    const weak = Object.entries(ts).filter(([t,v])=>(v.seen||0)>=3).map(([t,v])=>({t, r:(v.wrong||0)/(v.seen||1)})).sort((a,b)=>b.r-a.r).slice(0,5);
    blocks.push({s, seen, rate, weak});
  }

  el.innerHTML = `
    <h2 style="margin:0">${state.cnOn?'成果与薄弱点':'Progress & Weak Points'}</h2>
    <div class="muted">${state.cnOn?'这里的统计来自 Learn/Drills/Quiz 的“理解评分”，不是做题计算。':'Stats reflect understanding checks, not calculation.'}</div>
    <div class="hr"></div>
    <div id="pBlocks"></div>
  `;

  setTimeout(()=>{
    const p = el.querySelector('#pBlocks');
    blocks.forEach(b=>{
      const box = document.createElement('div');
      box.className='panel';
      box.style.marginBottom='10px';
      box.innerHTML = `
        <div class="row" style="justify-content:space-between; align-items:center;">
          <div class="pill">${b.s.toUpperCase()}</div>
          <div class="muted">${state.cnOn?'样本':'Seen'}: ${b.seen} • ${state.cnOn?'理解正确率':'Accuracy'}: ${Math.round(b.rate*100)}%</div>
        </div>
        <div style="margin-top:8px" class="muted">${state.cnOn?'薄弱标签':'Weak tags'}:</div>
        <div style="margin-top:6px">${b.weak.map(x=>`<span class="pill">${x.t} • ${Math.round(x.r*100)}%</span>`).join(' ') || '—'}</div>
      `;
      p.appendChild(box);
    });
  },0);

  return el;
}

function renderBackup(){
  const el = document.createElement('div');
  el.className='card';
  el.innerHTML = `
    <h2 style="margin:0">${state.cnOn?'备份 / 恢复':'Backup / Restore'}</h2>
    <div class="muted">${state.cnOn?'建议每周导出一次备份（iPad 有时会清理缓存）。':'Export a backup weekly. iPad may clear storage sometimes.'}</div>
    <div class="hr"></div>
    <div class="row">
      <button class="btn primary" id="exportBtn">${state.cnOn?'导出备份文件':'Export backup'}</button>
      <button class="btn" id="importBtn">${state.cnOn?'导入备份文件':'Import backup'}</button>
      <input type="file" id="fileInput" accept="application/json" style="display:none" />
    </div>
    <div class="hr"></div>
    <div class="muted">${state.cnOn?'导出内容：生词本 + 统计 + 你的设置。':'Export includes Word Bank + stats + settings.'}</div>
  `;
  setTimeout(()=>{
    el.querySelector('#exportBtn').onclick = ()=>{
      const payload = JSON.stringify(state, null, 2);
      const blob = new Blob([payload], {type:'application/json'});
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `p3-reader-backup-${new Date().toISOString().slice(0,10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast(state.cnOn?'已导出':'Exported');
    };
    const fileInput = el.querySelector('#fileInput');
    el.querySelector('#importBtn').onclick = ()=> fileInput.click();
    fileInput.onchange = async ()=>{
      const f = fileInput.files[0];
      if(!f) return;
      const text = await f.text();
      try{
        const obj = JSON.parse(text);
        state = obj;
        saveState(state);
        toast(state.cnOn?'已导入':'Imported');
        location.reload();
      }catch(e){
        alert(state.cnOn?'导入失败：文件格式不对':'Import failed: invalid file');
      }
    };
  },0);
  return el;
}

async function render(){
  toggleCNBtn.textContent = state.cnOn ? '中文: 开' : '中文: 关';
  renderTabs();
  appEl.innerHTML = '';
  setStatus(state.cnOn ? '离线可用（首次打开需缓存）' : 'Offline-ready (first load caches assets)');

  if(currentTab==='home'){ appEl.appendChild(renderHome()); return; }
  if(currentTab==='quiz'){ appEl.appendChild(renderQuiz()); return; }
  if(currentTab==='wordbank'){ appEl.appendChild(renderWordBank()); return; }
  if(currentTab==='progress'){ appEl.appendChild(renderProgress()); return; }
  if(currentTab==='backup'){ appEl.appendChild(renderBackup()); return; }

  await loadSubjectData(currentTab);
  appEl.appendChild(renderSubject(currentTab));
}

// Register Service Worker
if('serviceWorker' in navigator){
  window.addEventListener('load', async ()=>{
    try{
      await navigator.serviceWorker.register('./sw.js');
    }catch(e){
      // ignore
    }
  });
}

render();
