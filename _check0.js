
  // ======================
  // PWA register
  // ======================
  (function registerSW(){
    try{
      if("serviceWorker" in navigator){
        navigator.serviceWorker.register("./sw.js").catch(()=>{});
      }
    }catch{}
  })();

  // ======================
  // STORAGE + STATE
  // ======================
  const KEY = "nexxt_v3_preference_deactivate_themes";
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; } };
  const save = (s) => localStorage.setItem(KEY, JSON.stringify(s));
  function uid(){ return Math.random().toString(16).slice(2) + Date.now().toString(16); }

  function todayKey(d = new Date()){
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2,"0");
    const day = String(d.getDate()).padStart(2,"0");
    return `${y}-${m}-${day}`;
  }
  function monthKey(d = new Date()){
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2,"0");
    return `${y}-${m}`;
  }
  function nowTs(){ return Date.now(); }

  const NOSOLD_REASONS = [
    "Pesquisando preço",
    "Dando aquela olhadinha",
    "Não tinha a numeração",
    "Não tinha a peça na loja",
    "Não curtiu o modelo / caimento",
    "Volta depois / indeciso",
    "Outro"
  ];

  const ITEM_TYPES = [
    "Camiseta", "Calça", "Camisa MC", "Camisa ML", "Vestido", "Jaqueta",
    "Acessórios", "Bermuda", "Saia", "Polo", "Boné"
  ];

  const defaultState = {
    store: { name:"Sua loja", status:"Online", logoDataUrl:"" },
    options: { askValue:true, askPieces:true, vendorDivisor: 0 },
    ui: { theme: "default" }, // default | neon | ocean | sunset | purple
    sellers: [
      { id: uid(), name:"Erick", photo:"", paused:false, active:true },
      { id: uid(), name:"Camila", photo:"", paused:false, active:true },
      { id: uid(), name:"Mariana", photo:"", paused:false, active:true },
    ],
    queue: [],
    pool: [],
    currents: [], // [{ id, sellerId, startTs }]
    current: null, // legacy (mantido p/ migração)
    records: [],
    badges: { earned: [] },
    goalsByMonth: {},
    vendorGoalsByMonth: {},
    vendorGoalsByMonth: {}
  };

  let state = load() || defaultState;

  // migração defensiva
  state.ui = state.ui || { theme:"default" };
  state.options = state.options || { askValue:true, askPieces:true };
  state.sellers = (state.sellers || []).map(s => ({
    ...s,
    active: (s.active === undefined ? true : !!s.active),
    paused: !!s.paused
  }));
  state.vendorGoalsByMonth = state.vendorGoalsByMonth || {};
  // migração: atendimento múltiplo
  state.currents = state.currents || [];
  if(state.current && state.current.sellerId){
    state.currents.push({ id: uid(), sellerId: state.current.sellerId, startTs: state.current.startTs || nowTs() });
    state.current = null;
  }
  // divisor de meta por vendedor (0 = auto)
  if(!Number(state.options.vendorDivisor||0)){
    const activeCount = (state.sellers||[]).filter(s=>s.active).length || 1;
    state.options.vendorDivisor = activeCount;
  }

  if(state.pool.length === 0 && state.queue.length === 0){
    const actives = state.sellers.filter(s=>s.active).map(s=>s.id);
    state.pool = actives;
    save(state);
  }

  // ======================
  // HELPERS
  // ======================
  const $ = (id) => document.getElementById(id);
  function getSeller(id){ return state.sellers.find(s => s.id === id) || null; }
  function isActiveSeller(id){
    const s = getSeller(id);
    return !!(s && s.active);
  }

  function isSellerInAttendance(sid){
    return (state.currents||[]).some(c=>c && c.sellerId===sid);
  }
  function getCurrentById(cid){
    return (state.currents||[]).find(c=>c && c.id===cid) || null;
  }
  function getCurrentBySeller(sid){
    return (state.currents||[]).find(c=>c && c.sellerId===sid) || null;
  }

  function parseBRNumber(str){
    if(!str) return 0;
    const cleaned = str.toString().trim().replace(/\./g, "").replace(",", ".");
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : 0;
  }
  function formatMoney(v){
    const n = Number(v || 0);
    return n.toLocaleString("pt-BR", { style:"currency", currency:"BRL" });
  }
  function formatNum(n){ return (Number(n||0)).toLocaleString("pt-BR"); }
  function clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }

  function daysInMonth(yyyyMm){
    const [y,m] = yyyyMm.split("-").map(Number);
    return new Date(y, m, 0).getDate();
  }

  function remainingDaysInMonthFromToday(yyyyMm){
    const [y,m] = yyyyMm.split("-").map(Number);
    const now = new Date();
    if(now.getFullYear() !== y || (now.getMonth()+1) !== m) return daysInMonth(yyyyMm);
    const total = daysInMonth(yyyyMm);
    const today = now.getDate();
    return Math.max(1, total - today + 1);
  }

  function weekOfMonth(dateKeyStr){
    const day = Number(dateKeyStr.slice(8,10));
    if(day <= 7) return 1;
    if(day <= 14) return 2;
    if(day <= 21) return 3;
    return 4;
  }

  function agg(records){
    let atend=records.length;
    let sales=0, revenue=0, pieces=0, totalTime=0;
    for(const r of records){
      if(r.outcome === "sold") sales++;
      revenue += Number(r.value||0);
      pieces += Number(r.pieces||0);
      totalTime += Math.max(0, (r.tsEnd||r.tsStart||0) - (r.tsStart||0));
    }
    const conv = atend>0 ? (sales/atend)*100 : 0;
    const paPerSale = sales>0 ? (pieces/sales) : 0;
    const paPerAttend = atend>0 ? (pieces/atend) : 0;
    const avgTimeSec = atend>0 ? Math.round((totalTime/atend)/1000) : 0;
    return { atend, sales, revenue, pieces, conv, paPerSale, paPerAttend, avgTimeSec };
  }

  function aggBySeller(records){
    const map = new Map();
    for(const r of records){
      const sid = r.sellerId;
      if(!map.has(sid)) map.set(sid, []);
      map.get(sid).push(r);
    }
    const rows = [];
    for(const [sid, recs] of map.entries()){
      rows.push({ sellerId:sid, ...agg(recs) });
    }
    return rows;
  }

  function groupByDate(records){
    const map = new Map();
    for(const r of records){
      const k = r.dateKey;
      if(!map.has(k)) map.set(k, []);
      map.get(k).push(r);
    }
    const rows = [];
    for(const [k, recs] of map.entries()){
      rows.push({ dateKey:k, ...agg(recs) });
    }
    rows.sort((a,b)=> a.dateKey.localeCompare(b.dateKey));
    return rows;
  }

  function filterRecordsForDataView(){
    const dateISO = $("dataDate")?.value;
    const monthISO = $("dataMonth")?.value;
    const chosenDate = dateISO ? dateISO : todayKey();
    const chosenMonth = monthISO ? monthISO : monthKey();
    return { chosenDate, chosenMonth };
  }

  // ======================
  // THEME
  // ======================
  function applyTheme(){
    const t = state.ui?.theme || "default";
    const allowed = ["default","neon","ocean","sunset","purple","textured"];
    document.documentElement.dataset.theme = allowed.includes(t) ? t : "default";
  }

  // ======================
  // FX
  // ======================
  function pick(arr){ return arr[Math.floor(Math.random()*arr.length)]; }

  function burstFx(x, y){
    const fx = $("fxLayer");
    const count = 22;
    for(let i=0;i<count;i++){
      const p = document.createElement("div");
      p.className = "particle";
      const ang = Math.random()*Math.PI*2;
      const dist = 70 + Math.random()*120;
      const dx = Math.cos(ang)*dist;
      const dy = Math.sin(ang)*dist;
      const c = pick([
        "rgba(0,255,154,.95)","rgba(255,59,122,.95)","rgba(106,124,255,.95)",
        "rgba(255,209,102,.95)","rgba(255,255,255,.85)"
      ]);
      p.style.background = c;
      p.style.left = x + "px";
      p.style.top = y + "px";
      p.style.setProperty("--x0", "0px");
      p.style.setProperty("--y0", "0px");
      p.style.setProperty("--x1", dx+"px");
      p.style.setProperty("--y1", dy+"px");
      fx.appendChild(p);
      setTimeout(()=>p.remove(), 1000);
    }
  }

  function rocketFx(x, y){
    const fx = $("fxLayer");
    const r = document.createElement("div");
    r.className = "rocketFly";
    r.textContent = "🚀";
    r.style.left = x + "px";
    r.style.top = y + "px";
    r.style.setProperty("--rx0", "0px");
    r.style.setProperty("--ry0", "0px");
    r.style.setProperty("--rx1", (Math.random()*140+80)+"px");
    r.style.setProperty("--ry1", (- (Math.random()*240+140))+"px");
    fx.appendChild(r);
    setTimeout(()=>r.remove(), 950);
  }

  // ======================
  // HEADER
  // ======================
  function renderHeader(){
    $("storeNameTop").textContent = state.store.name || "Sua loja";
    $("statusChip").textContent = state.store.status || "Online";
    const logoBox = $("logoBox");
    logoBox.innerHTML = "";
    if(state.store.logoDataUrl){
      const img = document.createElement("img");
      img.src = state.store.logoDataUrl;
      logoBox.appendChild(img);
    } else {
      const img = document.createElement("img");
      img.src = "./icon-192.png";
      img.style.objectFit = "cover";
      logoBox.appendChild(img);
    }
  }

  // ======================
  // OPERACAO
  // ======================
  function sellerStatsDay(sid, dateKey){
    const recs = state.records.filter(r => r.dateKey === dateKey && r.sellerId === sid);
    return agg(recs);
  }

  function renderKpis(){
    const tk = todayKey();
    const recsToday = state.records.filter(r => r.dateKey === tk);
    const a = agg(recsToday);

    const kpis = [
      { t:"Atendimentos", v: formatNum(a.atend) },
      { t:"Vendas", v: formatNum(a.sales) },
      { t:"Conversão", v: a.conv.toFixed(1) + "%", cls:"good" },
      { t:"Faturamento", v: formatMoney(a.revenue) },
    ];
    const el = $("kpis");
    el.innerHTML = "";
    for(const k of kpis){
      const div = document.createElement("div");
      div.className = "kpi";
      div.innerHTML = `<div class="t">${k.t}</div><div class="v ${k.cls||""}">${k.v}</div>`;
      el.appendChild(div);
    }
  }

  function renderQueue(){
    const q = $("queueList");
    q.innerHTML = "";

    // limpa ids inativos que ficaram perdidos
    state.queue = state.queue.filter(id => isActiveSeller(id));

    if(state.queue.length === 0){
      const empty = document.createElement("div");
      empty.className = "hint";
      empty.textContent = "Fila vazia. Adicione vendedores do rodapé para começar.";
      q.appendChild(empty);
      return;
    }

    const tk = todayKey();

    state.queue.forEach((sid, idx) => {
      const s = getSeller(sid);
      if(!s || !s.active) return;

      const st = sellerStatsDay(sid, tk);

      const item = document.createElement("div");
      item.className = "item";
      item.innerHTML = `
        <div class="leftItem">
          <div class="pos">${idx+1}</div>
          <div class="avatar">${s.photo ? `<img src="${s.photo}">` : `<span style="color:var(--muted);font-weight:900">${(s.name||"?")[0].toUpperCase()}</span>`}</div>
          <div class="nameBlock">
            <div class="name">${s.name}</div>
            <div class="meta">${st.atend} atend · ${st.sales} vendas · ${st.conv.toFixed(1)}% conv · PA(venda) ${st.paPerSale.toFixed(2)}</div>
          </div>
        </div>
        <div class="actions">
          <button class="btn" data-act="up" data-id="${sid}">↑</button>
          <button class="btn" data-act="down" data-id="${sid}">↓</button>
          <button class="btn warn" data-act="pause" data-id="${sid}">${s.paused ? "Retomar" : "Pausar"}</button>
          <button class="btn bad" data-act="remove" data-id="${sid}">Tirar</button>
        </div>
      `;
      q.appendChild(item);
    });

    q.querySelectorAll("button[data-act]").forEach(btn=>{
      btn.addEventListener("click", (e)=>{
        const act = e.currentTarget.dataset.act;
        const sid = e.currentTarget.dataset.id;
        handleQueueAction(act, sid);
      });
    });
  }

  function renderPool(){
    const p = $("poolList");
    p.innerHTML = "";

    // pool só com ativos
    state.pool = state.pool.filter(id => isActiveSeller(id) && !state.queue.includes(id));
    // evita duplicados
    state.pool = Array.from(new Set(state.pool));

    if(state.pool.length === 0){
      const empty = document.createElement("div");
      empty.className = "hint";
      empty.textContent = "Nenhum vendedor fora da fila.";
      p.appendChild(empty);
      return;
    }

    state.pool.forEach((sid) => {
      const s = getSeller(sid);
      if(!s || !s.active) return;

      const item = document.createElement("div");
      item.className = "item";
      item.style.cursor = "pointer";
      item.innerHTML = `
        <div class="leftItem">
          <div class="avatar">${s.photo ? `<img src="${s.photo}">` : `<span style="color:var(--muted);font-weight:900">${(s.name||"?")[0].toUpperCase()}</span>`}</div>
          <div class="nameBlock">
            <div class="name">${s.name}</div>
            <div class="meta">${s.paused ? "Clique para retomar e voltar para a fila" : "Clique para entrar na fila"}</div>
          </div>
        </div>
        <span class="tag ${s.paused ? "warn":""}">${s.paused ? "Pausado" : "Fora"}</span>
      `;

      item.addEventListener("click", ()=>{
        // ✅ Correção pedida: pausado não trava mais.
        // Ao clicar: retoma e entra na fila.
        if(s.paused) s.paused = false;

        state.pool = state.pool.filter(x => x !== sid);
        if(!state.queue.includes(sid)) state.queue.push(sid);

        save(state);
        renderAll();
      });

      p.appendChild(item);
    });
  }

  function renderCurrent(){
    const panel = $("attendPanel");
    const tag = $("attendTag");

    const currents = (state.currents || []).filter(c => c && isActiveSeller(c.sellerId));
    state.currents = currents;

    if(currents.length === 0){
      tag.textContent = "Nenhum";
      tag.className = "tag";
      panel.innerHTML = `<div class="hint">Chame o próximo para iniciar um atendimento.</div>`;
      return;
    }

    tag.textContent = `${currents.length} atendendo`;
    tag.className = "tag good";

    const tk = todayKey();
    panel.innerHTML = "";

    for(const c of currents){
      const s = getSeller(c.sellerId);
      if(!s) continue;
      const st = sellerStatsDay(s.id, tk);
      const elapsedSec = Math.floor((nowTs() - (c.startTs||nowTs()))/1000);
      const cid = c.id;

      const wrap = document.createElement('div');
      wrap.className = 'attCard';
            wrap.innerHTML = `
        <div class="leftItem">
          <div class="avatar attAvatar">
            ${s.photo ? `<img src="${s.photo}">` : `<span style="color:var(--muted);font-weight:900;font-size:18px">${(s.name||"?")[0].toUpperCase()}</span>`}
          </div>
          <div class="nameBlock">
            <div class="name" style="font-size:16px">${s.name}</div>
            <div class="meta">Atendendo agora · <b id="timer_${cid}">${elapsedSec}s</b></div>
            <div class="meta">${st.atend} atend · ${st.sales} vendas · ${st.conv.toFixed(1)}% conv · PA(venda) ${st.paPerSale.toFixed(2)}</div>
          </div>
        </div>
        <div class="actions" style="gap:8px; align-items:center">
          <span class="tag good">Em atendimento</span>
        </div>

        <div class="divider"></div>

        <div class="big">
          <button class="btn good" data-act="sold" data-cid="${cid}">✅ Vendeu</button>
          <button class="btn bad" data-act="nosold" data-cid="${cid}">❌ Não vendeu</button>
        </div>

        <div class="divider"></div>

        <div id="finalizeForm_${cid}" style="display:none">
          <div id="soldFields_${cid}" style="display:none">
            <div class="row">
              <div class="field" style="min-width:220px; display:${state.options.askValue ? "flex":"none"}">
                <label>Valor (R$)</label>
                <input id="saleValue_${cid}" inputmode="decimal" placeholder="Ex: 399,90" />
              </div>
              <div class="field" style="min-width:220px; display:${state.options.askPieces ? "flex":"none"}">
                <label>Peças (P.A.)</label>
                <input id="salePieces_${cid}" inputmode="numeric" placeholder="Ex: 3" />
              </div>
            </div>
          </div>

          <div id="nosoldFields_${cid}" style="display:none">
            <div class="row">
              <div class="field" style="min-width:240px">
                <label>Motivo</label>
                <select id="nsReason_${cid}">
                  ${NOSOLD_REASONS.map(r=>`<option value="${r}">${r}</option>`).join("")}
                </select>
              </div>

              <div class="field" style="min-width:220px">
                <label>Gênero</label>
                <select id="nsGender_${cid}">
                  <option value="Masculino">Masculino</option>
                  <option value="Feminino">Feminino</option>
                </select>
              </div>

              <div class="field" style="min-width:260px">
                <label>Tipo de peça</label>
                <select id="nsItemType_${cid}">
                  ${ITEM_TYPES.map(i=>`<option value="${i}">${i}</option>`).join("")}
                </select>
              </div>

              <div class="field" style="min-width:220px">
                <label>Numeração (se aplicável)</label>
                <input id="nsSize_${cid}" placeholder="Ex: 42, G, 38, 44" />
              </div>
            </div>
          </div>

          <div class="field" style="min-width:100%">
            <label>Observação (opcional)</label>
            <input id="saleObs_${cid}" placeholder="Ex: cliente só pesquisando / voltou depois / etc" />
          </div>

          <div class="divider"></div>

          <div class="actions">
            <button class="btn good" data-act="finalize" data-cid="${cid}">Finalizar</button>
            <button class="btn" data-act="cancel" data-cid="${cid}">Cancelar</button>
          </div>
        </div>
      `;

      panel.appendChild(wrap);
    }

    // delegation within panel
    panel.querySelectorAll('button[data-act]').forEach(btn=>{
      btn.addEventListener('click', (e)=>{
        const act = e.currentTarget.dataset.act;
        const cid = e.currentTarget.dataset.cid;
        if(act === 'sold') showFinalize(cid, 'sold');
        if(act === 'nosold') showFinalize(cid, 'nosold');
        if(act === 'cancel') hideFinalize(cid);
        if(act === 'finalize'){
          const out = e.currentTarget.dataset.outcome || null;
          // store outcome on form
          finalizeCurrent(cid);
        }
      });
    });

    function showFinalize(cid, outcome){
      const form = $("finalizeForm_"+cid);
      if(!form) return;
      const parent = form.closest('.attCard') || form.closest('.item') || null;

      form.dataset.outcome = outcome;
      form.style.display = 'block';

      const soldF = $("soldFields_"+cid);
      const noF = $("nosoldFields_"+cid);
      if(soldF) soldF.style.display = (outcome==='sold') ? 'block':'none';
      if(noF) noF.style.display = (outcome==='nosold') ? 'block':'none';

      if(parent){
        const soldBtn = parent.querySelector('button[data-act="sold"]');
        const noBtn = parent.querySelector('button[data-act="nosold"]');
        if(soldBtn) soldBtn.classList.toggle('activeSelected', outcome==='sold');
        if(noBtn) noBtn.classList.toggle('activeSelected', outcome==='nosold');

        // trava escolha após selecionar
        parent.querySelectorAll('button[data-act="sold"],button[data-act="nosold"]').forEach(b=> b.disabled = true);
      }
    }
    function hideFinalize(cid){
      const form = $("finalizeForm_"+cid);
      if(!form) return;
      const parent = form.closest('.attCard') || form.closest('.item') || null;

      form.style.display = 'none';
      form.dataset.outcome = '';

      if(parent){
        parent.querySelectorAll('button[data-act="sold"],button[data-act="nosold"]').forEach(b=>{
          b.disabled = false;
          b.classList.remove('activeSelected');
        });
      }
    }
  }

  // ======================
  // PREFERÊNCIA
  // ======================
  function openModal(backEl){ backEl.style.display = "flex"; }
  function closeModal(backEl){ backEl.style.display = "none"; }

  function renderPreferenceModal(){
    const list = $("prefList");
    list.innerHTML = "";


    const actives = state.sellers.filter(s=>s.active);
    if(actives.length === 0){
      list.innerHTML = `<div class="hint">Sem vendedores ativos.</div>`;
      return;
    }

    actives.forEach((s)=>{
      const item = document.createElement("div");
      item.className = "item";
      item.style.cursor = "pointer";
      item.innerHTML = `
        <div class="leftItem">
          <div class="avatar">${s.photo ? `<img src="${s.photo}">` : `<span style="color:var(--muted);font-weight:900">${(s.name||"?")[0].toUpperCase()}</span>`}</div>
          <div class="nameBlock">
            <div class="name">${s.name}</div>
            <div class="meta">${s.paused ? "Pausado — ao selecionar ele será retomado" : "Selecionar para atender agora"}</div>
          </div>
        </div>
        <span class="tag">Preferência</span>
      `;

      item.addEventListener("click", ()=>{
        startPreferenceAttendance(s.id);
        closeModal($("prefBack"));
      });

      list.appendChild(item);
    });
  }

  function startPreferenceAttendance(sid){
    const s = getSeller(sid);
    if(!s || !s.active){
      alert("Vendedor inválido/inativo.");
      return;
    }

    // retoma se estava pausado
    if(s.paused) s.paused = false;

    // remove de onde estiver
    state.queue = state.queue.filter(x=>x!==sid);
    state.pool  = state.pool.filter(x=>x!==sid);

    // inicia atendimento (multi)
    if(isSellerInAttendance(sid)){ alert("Esse vendedor já está em atendimento."); return; }
    state.currents.push({ id: uid(), sellerId: sid, startTs: nowTs() });
    state.current = null;
    save(state);
    renderAll();
  }

  // ======================
  // DESATIVAR VENDEDOR
  // ======================
  function renderDeactivateModal(){
    const list = $("deactList");
    list.innerHTML = "";

    const actives = state.sellers.filter(s=>s.active);
    if(actives.length === 0){
      list.innerHTML = `<div class="hint">Sem vendedores ativos para desativar.</div>`;
      return;
    }

    actives.forEach((s)=>{
      const item = document.createElement("div");
      item.className = "item";
      item.innerHTML = `
        <div class="leftItem">
          <div class="avatar">${s.photo ? `<img src="${s.photo}">` : `<span style="color:var(--muted);font-weight:900">${(s.name||"?")[0].toUpperCase()}</span>`}</div>
          <div class="nameBlock">
            <div class="name">${s.name}</div>
            <div class="meta">Remover da operação (fila/pool/preferência)</div>
          </div>
        </div>
        <button class="btn bad" data-deact="${s.id}">Desativar</button>
      `;
      list.appendChild(item);
    });

    list.querySelectorAll("button[data-deact]").forEach(btn=>{
      btn.addEventListener("click", (e)=>{
        const sid = e.currentTarget.dataset.deact;
        deactivateSeller(sid);
      });
    });
  }

  function deactivateSeller(sid){
    const s = getSeller(sid);
    if(!s || !s.active) return;

    if(!confirm(`Desativar "${s.name}"? Ele vai sumir da operação.`)) return;

    s.active = false;
    s.paused = true;

    // remove de filas
    state.queue = state.queue.filter(x=>x!==sid);
    state.pool  = state.pool.filter(x=>x!==sid);

    // se estiver em atendimento, encerra atendimentos (sem registro)
    state.currents = (state.currents||[]).filter(c=>c && c.sellerId!==sid);
    if(state.current && state.current.sellerId === sid){ state.current = null; }

    save(state);
    renderAll();
    closeModal($("deactBack"));
    alert("Vendedor desativado ✅");
  }

  // ======================
  // RANKING MODAL (dia)
  // ======================
  function renderRankingModal(){
    const list = $("rankingList");
    list.innerHTML = "";

    const tk = todayKey();
    const recsToday = state.records.filter(r => r.dateKey === tk);
    const rows = aggBySeller(recsToday);

    if(rows.length === 0){
      list.innerHTML = `<div class="hint">Sem dados ainda. Finalize atendimentos para aparecer no ranking.</div>`;
      return;
    }

    rows.sort((a,b)=>{
      if(b.conv !== a.conv) return b.conv - a.conv;
      if(b.sales !== a.sales) return b.sales - a.sales;
      return b.revenue - a.revenue;
    });

    rows.forEach((r, i)=>{
      const s = getSeller(r.sellerId);
      const item = document.createElement("div");
      item.className = "item";
      item.innerHTML = `
        <div class="leftItem">
          <div class="pos">${i+1}</div>
          <div class="avatar">${s?.photo ? `<img src="${s.photo}">` : `<span style="color:var(--muted);font-weight:900">${(s?.name||"?")[0].toUpperCase()}</span>`}</div>
          <div class="nameBlock">
            <div class="name">${s?.name || "Vendedor"}</div>
            <div class="meta">${r.atend} atend · ${r.sales} vendas · PA(venda) ${r.paPerSale.toFixed(2)} · ${formatMoney(r.revenue)}</div>
          </div>
        </div>
        <span class="tag good">${r.conv.toFixed(1)}%</span>
      `;
      list.appendChild(item);
    });
  }

  // ======================
  // DADOS
  // ======================
  function makeTable(headers, rows){
    const table = document.createElement("table");
    const thead = document.createElement("thead");
    const trh = document.createElement("tr");
    headers.forEach(h=>{
      const th = document.createElement("th");
      th.textContent = h;
      trh.appendChild(th);
    });
    thead.appendChild(trh);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    rows.forEach(r=>{
      const tr = document.createElement("tr");
      r.forEach(cell=>{
        const td = document.createElement("td");
        td.textContent = cell;
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    return table;
  }

  function renderData(){
    const view = $("dataView").value;
    const { chosenDate, chosenMonth } = filterRecordsForDataView();

    const recsDay = state.records.filter(r => r.dateKey === chosenDate);
    const recsMonth = state.records.filter(r => r.monthKey === chosenMonth);

    const a = agg(recsMonth);

    const kpis = [
      { t:"Atendimentos (mês)", v: formatNum(a.atend) },
      { t:"Vendas (mês)", v: formatNum(a.sales) },
      { t:"Conversão (mês)", v: a.conv.toFixed(1) + "%", cls:"good" },
      { t:"P.A. (por venda)", v: a.paPerSale.toFixed(2) },
    ];
    const el = $("kpisData");
    el.innerHTML = "";
    for(const k of kpis){
      const div = document.createElement("div");
      div.className = "kpi";
      div.innerHTML = `<div class="t">${k.t}</div><div class="v ${k.cls||""}">${k.v}</div>`;
      el.appendChild(div);
    }

    const wrap = $("dataTableWrap");
    wrap.innerHTML = "";

    if(view === "dayRank"){
      const rows = aggBySeller(recsDay);
      if(rows.length === 0){
        wrap.innerHTML = `<div class="hint">Sem registros em ${chosenDate}.</div>`;
        return;
      }
      rows.sort((a,b)=>{
        if(b.conv !== a.conv) return b.conv - a.conv;
        if(b.sales !== a.sales) return b.sales - a.sales;
        return b.revenue - a.revenue;
      });
      const body = rows.map((r, idx)=>{
        const s = getSeller(r.sellerId);
        return [String(idx+1), s?.name || "Vendedor", formatNum(r.atend), formatNum(r.sales), r.conv.toFixed(1)+"%", r.paPerSale.toFixed(2), formatMoney(r.revenue)];
      });
      wrap.appendChild(makeTable(["#","Vendedor","Atend.","Vendas","Conv.","P.A.(venda)","Fat."], body));
      return;
    }

    if(view === "daily"){
      const rows = groupByDate(recsMonth);
      if(rows.length === 0){
        wrap.innerHTML = `<div class="hint">Sem registros no mês ${chosenMonth}.</div>`;
        return;
      }
      wrap.appendChild(makeTable(
        ["Dia","Atend.","Vendas","Conv.","P.A.(venda)","P.A.(atend.)","Fat."],
        rows.map(r=>[r.dateKey, formatNum(r.atend), formatNum(r.sales), r.conv.toFixed(1)+"%", r.paPerSale.toFixed(2), r.paPerAttend.toFixed(2), formatMoney(r.revenue)])
      ));
      return;
    }

    if(view === "sellerDaily"){
      const byDate = new Map();
      for(const r of recsMonth){
        const k = r.dateKey;
        if(!byDate.has(k)) byDate.set(k, []);
        byDate.get(k).push(r);
      }
      const dates = Array.from(byDate.keys()).sort((a,b)=>a.localeCompare(b));
      if(dates.length === 0){
        wrap.innerHTML = `<div class="hint">Sem registros no mês ${chosenMonth}.</div>`;
        return;
      }
      const sellers = state.sellers.map(s=>s.id);
      const header = ["Vendedor", ...dates];
      const body = sellers.map(sid=>{
        const s = getSeller(sid);
        const row = [s?.name || "Vendedor"];
        for(const d of dates){
          const rr = (byDate.get(d)||[]).filter(x=>x.sellerId===sid);
          const aa = agg(rr);
          row.push(aa.atend ? `${aa.conv.toFixed(0)}% (${aa.sales}/${aa.atend})` : "-");
        }
        return row;
      }).filter(r=> r.slice(1).some(x=>x!=="-"));
      wrap.appendChild(makeTable(header, body));
      return;
    }

    if(view === "monthRank"){
      const rows = aggBySeller(recsMonth);
      if(rows.length === 0){
        wrap.innerHTML = `<div class="hint">Sem registros no mês ${chosenMonth}.</div>`;
        return;
      }
      rows.sort((a,b)=>{
        if(b.conv !== a.conv) return b.conv - a.conv;
        if(b.sales !== a.sales) return b.sales - a.sales;
        return b.revenue - a.revenue;
      });
      const body = rows.map((r, idx)=>{
        const s = getSeller(r.sellerId);
        return [String(idx+1), s?.name || "Vendedor", formatNum(r.atend), formatNum(r.sales), r.conv.toFixed(1)+"%", r.paPerSale.toFixed(2), formatMoney(r.revenue)];
      });
      wrap.appendChild(makeTable(["#","Vendedor","Atend.","Vendas","Conv.","P.A.(venda)","Fat."], body));
      return;
    }

    if(view === "raw"){
      if(recsMonth.length === 0){
        wrap.innerHTML = `<div class="hint">Sem registros no mês ${chosenMonth}.</div>`;
        return;
      }
      const body = recsMonth
        .slice()
        .sort((a,b)=> (b.tsEnd||b.tsStart) - (a.tsEnd||a.tsStart))
        .map(r=>{
          const s = getSeller(r.sellerId);
          const dt = new Date(r.tsStart);
          const hh = String(dt.getHours()).padStart(2,"0");
          const mm = String(dt.getMinutes()).padStart(2,"0");
          const res = r.outcome === "sold" ? "Vendeu" : "Não vendeu";
          return [r.dateKey, `${hh}:${mm}`, s?.name || "Vendedor", res, formatMoney(r.value||0), formatNum(r.pieces||0), (r.obs || "").slice(0,40)];
        });
      wrap.appendChild(makeTable(["Dia","Hora","Vendedor","Resultado","Valor","Peças","Obs"], body));
      return;
    }
  }

  // ======================
  // GOALS (mantido igual ao seu)
  // ======================
  function getGoalsForMonth(mk){
    if(!state.goalsByMonth) state.goalsByMonth = {};
    if(!state.goalsByMonth[mk]){
      state.goalsByMonth[mk] = {
        monthly: 0,
        basePercents: [25,25,25,25],
        weekTargets: [0,0,0,0],
        closedWeeks: {}
      };
    }
    const g = state.goalsByMonth[mk];
    if(!g.basePercents) g.basePercents = [25,25,25,25];
    if(!g.weekTargets) g.weekTargets = [0,0,0,0];
    if(!g.closedWeeks) g.closedWeeks = {};
    return g;
  }
  function sum(arr){ return arr.reduce((a,b)=>a+Number(b||0),0); }
  function getMonthRevenueSold(mk){
    const soldMonth = state.records.filter(r => r.monthKey === mk && r.outcome==="sold");
    return soldMonth.reduce((s,r)=> s + Number(r.value||0), 0);
  }
  function autoRedistributeGoals(mk){
    const g = getGoalsForMonth(mk);
    const monthly = Number(g.monthly||0);
    const done = getMonthRevenueSold(mk);
    const remaining = Math.max(0, monthly - done);

    const openWeeks = [1,2,3,4].filter(w => !g.closedWeeks[String(w)]);
    const base = g.basePercents.map(p=> Number(p||0));
    const sumOpenBase = sum(openWeeks.map(w=> base[w-1]));

    const normalized = [0,0,0,0];
    if(openWeeks.length === 0){
      // tudo fechado
    } else if(sumOpenBase <= 0){
      openWeeks.forEach(w => normalized[w-1] = 100/openWeeks.length);
    } else {
      openWeeks.forEach(w => normalized[w-1] = (base[w-1]/sumOpenBase)*100);
    }

    const targets = [...g.weekTargets];
    openWeeks.forEach(w=>{
      targets[w-1] = remaining * (normalized[w-1]/100);
    });
    g.weekTargets = targets;

    const daysRemain = remainingDaysInMonthFromToday(mk);
    const daily = (remaining / Math.max(1, daysRemain));

    return { g, normalizedPercents: normalized, remaining, daily };
  }

  function renderGoals(){
    const mk = $("goalMonth").value || monthKey();
    const g = getGoalsForMonth(mk);

    $("goalMonth").value = mk;
    $("goalMonthly").value = g.monthly ? String(g.monthly).replace(".", ",") : "";

    $("pW1").value = String(g.basePercents?.[0] ?? 25).replace(".", ",");
    $("pW2").value = String(g.basePercents?.[1] ?? 25).replace(".", ",");
    $("pW3").value = String(g.basePercents?.[2] ?? 25).replace(".", ",");
    $("pW4").value = String(g.basePercents?.[3] ?? 25).replace(".", ",");

    const { normalizedPercents, daily } = autoRedistributeGoals(mk);

    $("goalDaily").value = String((daily||0).toFixed(2)).replace(".", ",");

    $("goalW1").value = formatMoney(g.weekTargets[0]||0);
    $("goalW2").value = formatMoney(g.weekTargets[1]||0);
    $("goalW3").value = formatMoney(g.weekTargets[2]||0);
    $("goalW4").value = formatMoney(g.weekTargets[3]||0);

    [1,2,3,4].forEach(w=>{
      const closed = !!g.closedWeeks[String(w)];
      const v = closed ? "Fechada" : (normalizedPercents[w-1]||0).toFixed(1) + "%";
      $("rpW"+w).value = v;
    });

    const today = todayKey();
    const cw = weekOfMonth(today);
    $("goalCurrentWeek").value = "Semana " + cw;
    $("goalWeekClosed").value = g.closedWeeks[String(cw)] ? "Sim" : "Não";

    save(state);
    renderGoalsProgress();
    try{ renderVendorGoals(); }catch{}
  }

  function renderGoalsProgress(){
    const mk = $("goalMonth").value || monthKey();
    const g = getGoalsForMonth(mk);

    const today = todayKey();
    const currentWeek = weekOfMonth(today);

    const monthSold = state.records.filter(r => r.monthKey === mk && r.outcome==="sold");
    const monthRevenue = monthSold.reduce((s,r)=> s + Number(r.value||0), 0);

    const daySold = state.records.filter(r => r.dateKey === today && r.outcome==="sold");
    const dayRevenue = daySold.reduce((s,r)=> s + Number(r.value||0), 0);

    const weekSold = state.records.filter(r => r.monthKey === mk && r.outcome==="sold" && weekOfMonth(r.dateKey) === currentWeek);
    const weekRevenue = weekSold.reduce((s,r)=> s + Number(r.value||0), 0);

    const monthlyTarget = Number(g.monthly||0);
    const weeklyTarget = Number(g.weekTargets?.[currentWeek-1] || 0);

    const { remaining, daily } = autoRedistributeGoals(mk);
    const dailyTarget = Number(daily||0);

    const monthlyPct = monthlyTarget>0 ? clamp((monthRevenue/monthlyTarget)*100, 0, 100) : 0;
    const dailyPct = dailyTarget>0 ? clamp((dayRevenue/dailyTarget)*100, 0, 100) : 0;
    const weeklyPct = weeklyTarget>0 ? clamp((weekRevenue/weeklyTarget)*100, 0, 100) : 0;

    $("goalDailyText").textContent = `${formatMoney(dayRevenue)} / ${formatMoney(dailyTarget)}`;
    $("goalWeeklyText").textContent = `${formatMoney(weekRevenue)} / ${formatMoney(weeklyTarget)} (S${currentWeek})`;
    $("goalMonthlyText").textContent = `${formatMoney(monthRevenue)} / ${formatMoney(monthlyTarget)}`;

    $("goalDailyLeft").textContent = formatMoney(Math.max(0, dailyTarget - dayRevenue));
    $("goalWeeklyLeft").textContent = formatMoney(Math.max(0, weeklyTarget - weekRevenue));
    $("goalMonthlyLeft").textContent = formatMoney(Math.max(0, monthlyTarget - monthRevenue));

    $("barDaily").style.width = (dailyPct || 0) + "%";
    $("barWeekly").style.width = (weeklyPct || 0) + "%";
    $("barMonthly").style.width = (monthlyPct || 0) + "%";

    const el = $("kpisGoals");
    el.innerHTML = "";
    const cards = [
      { t: "Hoje (R$)", v: formatMoney(dayRevenue), cls: dailyPct>=100 ? "good":"" },
      { t: "Semana atual (R$)", v: formatMoney(weekRevenue), cls: weeklyPct>=100 ? "good":"" },
      { t: "Mês (R$)", v: formatMoney(monthRevenue), cls: monthlyPct>=100 ? "good":"" },
      { t: "Restante do mês (R$)", v: formatMoney(remaining) },
    ];
    for(const k of cards){
      const div = document.createElement("div");
      div.className = "kpi";
      div.innerHTML = `<div class="t">${k.t}</div><div class="v ${k.cls||""}">${k.v}</div>`;
      el.appendChild(div);
    }

    const cw = weekOfMonth(todayKey());
    $("goalCurrentWeek").value = "Semana " + cw;
    $("goalWeekClosed").value = g.closedWeeks[String(cw)] ? "Sim" : "Não";
  }


  // ======================
  // META VENDEDOR (ref + override)
  // ======================
  function getVendorDivisor(){
    let d = Number(state.options.vendorDivisor||0);
    if(!d || d<=0){
      d = (state.sellers||[]).filter(s=>s.active).length || 1;
    }
    return d;
  }

  function getVendorOverride(mk, sid){
    const byMonth = state.vendorGoalsByMonth||{};
    const m = byMonth[mk]||{};
    const v = Number(m[sid]||0);
    return v>0 ? v : 0;
  }

  function setVendorOverride(mk, sid, v){
    state.vendorGoalsByMonth = state.vendorGoalsByMonth || {};
    state.vendorGoalsByMonth[mk] = state.vendorGoalsByMonth[mk] || {};
    if(v>0) state.vendorGoalsByMonth[mk][sid] = v;
    else delete state.vendorGoalsByMonth[mk][sid];
  }

  function getVendorMonthlyTarget(mk, sid){
    const store = getGoalsForMonth(mk);
    const storeMonthly = Number(store.monthly||0);
    if(storeMonthly<=0) return 0;
    const ov = getVendorOverride(mk, sid);
    if(ov>0) return ov;
    const d = getVendorDivisor();
    return storeMonthly / d;
  }

  function ratioVendorToStore(mk, sid){
    const store = getGoalsForMonth(mk);
    const storeMonthly = Number(store.monthly||0);
    if(storeMonthly<=0) return 0;
    const vm = getVendorMonthlyTarget(mk, sid);
    return vm>0 ? (vm/storeMonthly) : 0;
  }

  function renderVendorGoals(){
    const mk = $("goalMonth").value || monthKey();
    const d = getVendorDivisor();
    $("goalVendorDivisor").value = String(d).replace(".",",");

    const sel = $("goalVendorSelect");
    sel.innerHTML = "";
    const act = (state.sellers||[]).filter(s=>s.active);
    for(const s of act){
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = s.name;
      sel.appendChild(opt);
    }
    if(!sel.value && act[0]) sel.value = act[0].id;

    const sid = sel.value;
    const ov = getVendorOverride(mk, sid);
    $("goalVendorMonthlyOverride").value = ov>0 ? String(ov).replace(".",",") : "";

    const kpis = $("kpisVendorGoals");
    kpis.innerHTML = "";

    const g = getGoalsForMonth(mk);
    const today = todayKey();
    const cw = weekOfMonth(today);

    const soldMonth = state.records.filter(r=>r.monthKey===mk && r.sellerId===sid && r.outcome==='sold');
    const revMonth = soldMonth.reduce((s,r)=>s+Number(r.value||0),0);

    const soldDay = state.records.filter(r=>r.dateKey===today && r.sellerId===sid && r.outcome==='sold');
    const revDay = soldDay.reduce((s,r)=>s+Number(r.value||0),0);

    const soldWeek = state.records.filter(r=>r.monthKey===mk && weekOfMonth(r.dateKey)===cw && r.sellerId===sid && r.outcome==='sold');
    const revWeek = soldWeek.reduce((s,r)=>s+Number(r.value||0),0);

    const vm = getVendorMonthlyTarget(mk, sid);
    const ratio = ratioVendorToStore(mk, sid);
    const storeWeekly = Number(g.weekTargets?.[cw-1]||0);
    const storeDaily = parseBRNumber($("goalDaily").value||"0");

    const vw = storeWeekly * ratio;
    const vd = storeDaily * ratio;

    const cards=[
      {t:'Hoje (vend.)', v:`${formatMoney(revDay)} / ${formatMoney(vd)}`},
      {t:`Semana ${cw} (vend.)`, v:`${formatMoney(revWeek)} / ${formatMoney(vw)}`},
      {t:'Mês (vend.)', v:`${formatMoney(revMonth)} / ${formatMoney(vm)}`},
    ];
    for(const c of cards){
      const div = document.createElement('div');
      div.className='kpi';
      div.innerHTML = `<div class="t">${c.t}</div><div class="v">${c.v}</div>`;
      kpis.appendChild(div);
    }
  }

  function saveVendorGoal(){
    const mk = $("goalMonth").value || monthKey();
    const d = parseBRNumber($("goalVendorDivisor").value||"");
    if(d>0) state.options.vendorDivisor = d;

    const sid = $("goalVendorSelect").value;
    const ov = parseBRNumber($("goalVendorMonthlyOverride").value||"");
    setVendorOverride(mk, sid, ov);

    save(state);
    renderGoals();
    alert('Meta do vendedor salva ✅');
  }

  function saveGoals(){
    const mk = $("goalMonth").value || monthKey();
    const g = getGoalsForMonth(mk);

    g.monthly = parseBRNumber($("goalMonthly").value);
    g.basePercents = [
      parseBRNumber($("pW1").value),
      parseBRNumber($("pW2").value),
      parseBRNumber($("pW3").value),
      parseBRNumber($("pW4").value),
    ];

    autoRedistributeGoals(mk);
    state.goalsByMonth[mk] = g;
    save(state);

    renderGoals();
    renderMetaRank();
    renderNoConv();

    alert("Metas salvas e redistribuídas ✅");
  }

  function closeCurrentWeek(){
    const mk = $("goalMonth").value || monthKey();
    const g = getGoalsForMonth(mk);
    const cw = weekOfMonth(todayKey());

    if(g.closedWeeks[String(cw)]){ alert("Essa semana já está fechada."); return; }
    if(!confirm(`Fechar Semana ${cw}? O OMNIA vai redistribuir a meta restante.`)) return;

    g.closedWeeks[String(cw)] = true;
    autoRedistributeGoals(mk);
    state.goalsByMonth[mk] = g;
    save(state);

    renderGoals();
    alert(`Semana ${cw} fechada ✅ Meta redistribuída.`);
  }

  function reopenWeeks(){
    const mk = $("goalMonth").value || monthKey();
    const g = getGoalsForMonth(mk);
    if(!confirm("Reabrir todas as semanas?")) return;
    g.closedWeeks = {};
    autoRedistributeGoals(mk);
    save(state);
    renderGoals();
  }

  // ======================
  // META RANK (mantido igual ao seu)
  // ======================
  function renderMetaRank(){
    const mk = $("metaRankMonth").value || monthKey();
    $("metaRankMonth").value = mk;

    const saved = getGoalsForMonth(mk);
    const inputMeta = parseBRNumber($("metaRankMonthly").value);
    const monthlyTarget = inputMeta || Number(saved.monthly||0);
    if(!inputMeta && monthlyTarget){
      $("metaRankMonthly").value = String(monthlyTarget).replace(".", ",");
    }

    const mode = $("metaRankMode").value;

    const soldMonth = state.records.filter(r => r.monthKey === mk && r.outcome==="sold");
    const monthRevenue = soldMonth.reduce((s,r)=> s + Number(r.value||0), 0);

    const kpis = $("metaRankKpis");
    kpis.innerHTML = "";
    const pctStore = monthlyTarget>0 ? clamp((monthRevenue/monthlyTarget)*100,0,200) : 0;
    const lack = Math.max(0, monthlyTarget - monthRevenue);

    const k = [
      { t:"Faturamento (mês)", v: formatMoney(monthRevenue), cls: "" },
      { t:"Meta mensal", v: formatMoney(monthlyTarget), cls: "" },
      { t:"Progresso", v: monthlyTarget>0 ? pctStore.toFixed(1)+"%" : "—", cls: (pctStore>=100)?"good":"" },
      { t:"Falta", v: formatMoney(lack), cls: "" },
    ];
    for(const it of k){
      const div = document.createElement("div");
      div.className = "kpi";
      div.innerHTML = `<div class="t">${it.t}</div><div class="v ${it.cls||""}">${it.v}</div>`;
      kpis.appendChild(div);
    }

    const rows = aggBySeller(soldMonth);
    rows.sort((a,b)=> b.revenue - a.revenue);

    const tableWrap = $("metaRankTable");
    tableWrap.innerHTML = "";

    if(rows.length === 0){
      tableWrap.innerHTML = `<div class="hint">Sem vendas registradas nesse mês ainda.</div>`;
    } else {
      const body = rows.map((r, idx)=>{
        const s = getSeller(r.sellerId);
        const pct = monthRevenue>0 ? (r.revenue/monthRevenue)*100 : 0;
        return [String(idx+1), s?.name || "Vendedor", formatMoney(r.revenue), pct.toFixed(1)+"%", formatNum(r.sales), (r.paPerSale||0).toFixed(2)];
      });
      tableWrap.appendChild(makeTable(["#","Vendedor","Fat. mês","% da loja","Vendas","P.A."], body));
    }

    renderMoonRace(mk, monthlyTarget, mode, rows, monthRevenue);
  }

  function renderMoonRace(mk, monthlyTarget, mode, rows, storeRevenue){
    const race = $("race");
    race.querySelectorAll(".rocket").forEach(el=>el.remove());
    $("moonBoom").style.display = "none";

    const left = 12;
    const rightPadding = 120;
    const width = race.clientWidth - rightPadding - left;

    const target = Number(monthlyTarget||0);
    const storePct = target>0 ? clamp(storeRevenue/target, 0, 1.2) : 0;

    if(target>0 && storeRevenue >= target){
      $("moonBoom").style.display = "grid";
      const rect = race.getBoundingClientRect();
      burstFx(rect.right - 80, rect.top + 60);
      setTimeout(()=>burstFx(rect.right - 110, rect.top + 40), 140);
    }

    const maxRockets = (mode==="store") ? 3 : 5;
    const list = rows.slice(0, maxRockets);

    list.forEach((r, i)=>{
      const s = getSeller(r.sellerId);
      const sellerTarget = (mode==='seller') ? sellerGoalMonthly(r.sellerId, mk) : target;
      const pct = sellerTarget>0 ? clamp(r.revenue/sellerTarget, 0, 1.2) : 0;
      const x = left + width * pct;

      const rocket = document.createElement("div");
      rocket.className = "rocket";
      rocket.style.left = x + "px";
      rocket.style.top = (22 + i*24) + "px";

      const pic = document.createElement("div");
      pic.className = "pic";
      if(s?.photo){
        const img = document.createElement("img");
        img.src = s.photo;
        pic.appendChild(img);
      } else {
        pic.textContent = (s?.name||"?")[0].toUpperCase();
      }

      const ship = document.createElement("div");
      ship.className = "ship";
      ship.textContent = "🚀";

      const lbl = document.createElement("div");
      lbl.className = "lbl";
      lbl.innerHTML = `<b>${s?.name || "Vendedor"}</b> · ${formatMoney(r.revenue)}${(mode==='seller' && sellerTarget>0) ? ` / ${formatMoney(sellerTarget)}` : ""} · ${sellerTarget>0 ? (pct*100).toFixed(1)+"%" : "—"}`;

      rocket.appendChild(pic);
      rocket.appendChild(ship);
      rocket.appendChild(lbl);
      race.appendChild(rocket);
    });

    if(mode==="store"){
      const xStore = left + width * storePct;
      const rocket = document.createElement("div");
      rocket.className = "rocket";
      rocket.style.left = xStore + "px";
      rocket.style.top = "110px";
      rocket.style.opacity = "0.95";

      const pic = document.createElement("div");
      pic.className = "pic";
      pic.textContent = "🏬";

      const ship = document.createElement("div");
      ship.className = "ship";
      ship.textContent = "🚀";

      const lbl = document.createElement("div");
      lbl.className = "lbl";
      lbl.innerHTML = `<b>LOJA</b> · ${formatMoney(storeRevenue)} · ${target? (storePct*100).toFixed(1)+"%": "—"}`;

      rocket.appendChild(pic);
      rocket.appendChild(ship);
      rocket.appendChild(lbl);
      race.appendChild(rocket);
    }
  }

  // ======================
  // NÃO CONVERTIDOS (mantido igual ao seu)
  // ======================
  function getNoConvSelection(){
    const d = $("ncDate").value || todayKey();
    const m = $("ncMonth").value || monthKey();
    const v = $("ncView").value || "day";
    return { d, m, v };
  }

  function countBy(records, keyFn){
    const map = new Map();
    for(const r of records){
      const k = keyFn(r) || "(vazio)";
      map.set(k, (map.get(k)||0) + 1);
    }
    const arr = Array.from(map.entries()).map(([k,v])=>({k,v}));
    arr.sort((a,b)=> b.v - a.v);
    return arr;
  }

  function renderNoConv(){
    const { d, m, v } = getNoConvSelection();

    const scope = (v==="day")
      ? state.records.filter(r=> r.dateKey === d)
      : state.records.filter(r=> r.monthKey === m);

    const sold = scope.filter(r=> r.outcome==="sold");
    const nos = scope.filter(r=> r.outcome==="nosold");

    const soldCount = sold.length;
    const nosCount = nos.length;
    const total = soldCount + nosCount;

    $("convCount").textContent = String(soldCount);
    $("noConvCount").textContent = String(nosCount);

    const soldPct = total>0 ? (soldCount/total)*100 : 0;
    const nosPct  = total>0 ? (nosCount/total)*100 : 0;

    $("convBar").style.width = soldPct.toFixed(1) + "%";
    $("noConvBar").style.width = nosPct.toFixed(1) + "%";

    $("convHint").textContent = total>0 ? `Convertidos: ${soldPct.toFixed(1)}%` : "—";
    $("noConvHint").textContent = total>0 ? `Não convertidos: ${nosPct.toFixed(1)}%` : "—";

    const rev = sold.reduce((s,r)=> s+Number(r.value||0), 0);
    const kpis = $("ncKpis");
    kpis.innerHTML = "";
    const cards = [
      { t:"Atendimentos", v: formatNum(total) },
      { t:"Vendas", v: formatNum(soldCount), cls:"good" },
      { t:"Não vendidos", v: formatNum(nosCount) },
      { t:"Faturamento (R$)", v: formatMoney(rev) },
    ];
    for(const k of cards){
      const div = document.createElement("div");
      div.className = "kpi";
      div.innerHTML = `<div class="t">${k.t}</div><div class="v ${k.cls||""}">${k.v}</div>`;
      kpis.appendChild(div);
    }

    const reasons = countBy(nos, r=> r.noSale?.reason || "(sem motivo)");
    const items   = countBy(nos, r=> r.noSale?.itemType || "(sem peça)");
    const gender  = countBy(nos, r=> r.noSale?.gender || "(sem gênero)");
    const sizes   = countBy(nos, r=> r.noSale?.size ? String(r.noSale.size).trim() : "(sem numeração)");

    const rWrap = $("ncReasonsWrap");
    const iWrap = $("ncItemsWrap");
    const gWrap = $("ncGenderWrap");
    const sWrap = $("ncSizesWrap");

    rWrap.innerHTML = "";
    iWrap.innerHTML = "";
    gWrap.innerHTML = "";
    sWrap.innerHTML = "";

    if(nos.length === 0){
      rWrap.innerHTML = `<div class="hint">Sem “não convertidos” nesse período. 👏</div>`;
      return;
    }

    rWrap.appendChild(makeTable(["Motivo","Qtd"], reasons.map(x=>[x.k, String(x.v)])));
    iWrap.appendChild(makeTable(["Peça","Qtd"], items.map(x=>[x.k, String(x.v)])));
    gWrap.appendChild(makeTable(["Gênero","Qtd"], gender.map(x=>[x.k, String(x.v)])));
    sWrap.appendChild(makeTable(["Numeração","Qtd"], sizes.map(x=>[x.k, String(x.v)])));
  }

  // ======================
  // EXPORT (mantido)
  // ======================
  function downloadBlob(content, filename, mime){
    const blob = new Blob([content], {type: mime});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function exportJSON(){
    const { chosenDate, chosenMonth } = filterRecordsForDataView();
    const view = $("dataView").value;

    const recsDay = state.records.filter(r => r.dateKey === chosenDate);
    const recsMonth = state.records.filter(r => r.monthKey === chosenMonth);

    const payload = {
      exportedAt: new Date().toISOString(),
      store: state.store,
      options: state.options,
      ui: state.ui,
      goalsByMonth: state.goalsByMonth,
      selection: { view, chosenDate, chosenMonth },
      sellers: state.sellers,
      records: (view === "dayRank") ? recsDay : recsMonth
    };

    downloadBlob(
      JSON.stringify(payload, null, 2),
      `nexxt_${(state.store.name||"loja").replaceAll(" ","_")}_${view}_${view==="dayRank"?chosenDate:chosenMonth}.json`,
      "application/json"
    );
  }

  function csvEscape(v){
    const s = String(v ?? "");
    if(/[,"\n]/.test(s)) return `"${s.replace(/"/g,'""')}"`;
    return s;
  }

  function exportCSV(){
    const { chosenDate, chosenMonth } = filterRecordsForDataView();
    const view = $("dataView").value;

    const recsDay = state.records.filter(r => r.dateKey === chosenDate);
    const recsMonth = state.records.filter(r => r.monthKey === chosenMonth);
    const recs = (view === "dayRank") ? recsDay : recsMonth;

    const header = ["id","date","time","seller","result","value","pieces","reason","gender","itemType","size","obs","tsStart","tsEnd"];
    const lines = [header.join(",")];

    const sorted = recs.slice().sort((a,b)=> (a.tsStart||0) - (b.tsStart||0));
    for(const r of sorted){
      const s = getSeller(r.sellerId);
      const dt = new Date(r.tsStart);
      const hh = String(dt.getHours()).padStart(2,"0");
      const mm = String(dt.getMinutes()).padStart(2,"0");

      const reason = r.noSale?.reason || "";
      const gender = r.noSale?.gender || "";
      const itemType = r.noSale?.itemType || "";
      const size = r.noSale?.size || "";

      const row = [
        r.id,
        r.dateKey,
        `${hh}:${mm}`,
        s?.name || "",
        r.outcome === "sold" ? "sold" : "nosold",
        Number(r.value||0).toFixed(2),
        Number(r.pieces||0),
        reason, gender, itemType, size,
        r.obs || "",
        r.tsStart || "",
        r.tsEnd || ""
      ].map(csvEscape);
      lines.push(row.join(","));
    }

    const suffix = (view === "dayRank") ? chosenDate : chosenMonth;
    downloadBlob(
      lines.join("\n"),
      `nexxt_${(state.store.name||"loja").replaceAll(" ","_")}_registros_${suffix}.csv`,
      "text/csv;charset=utf-8"
    );
  }

  // ======================
  // FILA + FLUXO
  // ======================
  function handleQueueAction(act, sid){
    if(isSellerInAttendance(sid)){
      alert("Esse vendedor está em atendimento. Finalize antes de mover/remover.");
      return;
    }
    const idx = state.queue.indexOf(sid);
    if(idx === -1) return;

    if(act === "up" && idx > 0) [state.queue[idx-1], state.queue[idx]] = [state.queue[idx], state.queue[idx-1]];
    if(act === "down" && idx < state.queue.length-1) [state.queue[idx+1], state.queue[idx]] = [state.queue[idx], state.queue[idx+1]];

    if(act === "pause"){
      const s = getSeller(sid);
      if(!s) return;
      s.paused = !s.paused;

      // se pausou: tira da fila e joga no pool
      if(s.paused){
        state.queue = state.queue.filter(x=>x!==sid);
        if(!state.pool.includes(sid)) state.pool.push(sid);
      } else {
        // se retomou: manda pro pool (e ele clica pra voltar) ou já volta pra fila?
        // preferi deixar no pool para controle do gestor; mas agora o clique no pool resolve.
        if(!state.pool.includes(sid)) state.pool.push(sid);
        state.queue = state.queue.filter(x=>x!==sid);
      }
    }

    if(act === "remove"){
      state.queue = state.queue.filter(x=>x!==sid);
      if(!state.pool.includes(sid)) state.pool.push(sid);
    }

    save(state);
    renderAll();
  }

  function callNext(){
    // permite múltiplos atendimentos em paralelo

    // pular inativos/pausados
    while(state.queue.length > 0){
      const sid = state.queue[0];
      const s = getSeller(sid);

      if(!s || !s.active){
        state.queue.shift();
        continue;
      }

      if(s.paused){
        state.queue.shift();
        if(!state.pool.includes(sid)) state.pool.push(sid);
        continue;
      }

      if(isSellerInAttendance(sid)){
        // já está em atendimento; remove da fila para não duplicar
        state.queue.shift();
        continue;
      }

      state.currents.push({ id: uid(), sellerId: sid, startTs: nowTs() });
      state.current = null;
      state.queue.shift();
      save(state);
      renderAll();
      return;
    }

    alert("Fila vazia. Adicione vendedores no rodapé.");
  }

  function finalizeCurrent(cid){
    const c = getCurrentById(cid);
    if(!c){ return; }

    const form = $("finalizeForm_"+cid);
    const outcome = form ? (form.dataset.outcome||"") : "";

    if(outcome !== "sold" && outcome !== "nosold"){
      alert("Selecione 'Vendeu' ou 'Não vendeu'.");
      return;
    }

    const sid = c.sellerId;
    const s = getSeller(sid);
    if(!s || !s.active){
      state.currents = (state.currents||[]).filter(x=>x.id!==cid);
      save(state);
      renderAll();
      return;
    }

    const endTs = nowTs();
    const tk = todayKey(new Date(c.startTs));
    const mk = monthKey(new Date(c.startTs));

    let value = 0, pieces = 0, noSale = null;

    if(outcome==="sold"){
      value = state.options.askValue ? parseBRNumber($("saleValue_"+cid)?.value || "") : 0;
      pieces = state.options.askPieces ? (parseInt(($("salePieces_"+cid)?.value||"0"),10) || 0) : 0;
    } else {
      const reason = $("nsReason_"+cid)?.value || "Outro";
      const gender = $("nsGender_"+cid)?.value || "";
      const itemType = $("nsItemType_"+cid)?.value || "";
      const size = ($("nsSize_"+cid)?.value || "").trim();
      noSale = { reason, gender, itemType, size };
    }

    const obs = $("saleObs_"+cid)?.value || "";

    const newRec = {
      id: uid(),
      tsStart: c.startTs,
      tsEnd: endTs,
      dateKey: tk,
      monthKey: mk,
      sellerId: sid,
      outcome,
      value,
      pieces,
      noSale,
      obs
    };
    state.records.push(newRec);

    try{ evaluateSellerBadgesAfterRecord(newRec); }catch(e){}

    if(outcome==="sold"){
      burstFx(window.innerWidth*0.72, window.innerHeight*0.30);
    }

    // remove deste atendimento
    state.currents = (state.currents||[]).filter(x=>x.id!==cid);

    // volta pra fila se estiver ativo e não pausado
    if(s.active && !s.paused){
      state.queue.push(sid);
    } else if(s.active && !state.pool.includes(sid)){
      state.pool.push(sid);
    }

    save(state);
    renderAll();

    if($("viewMetas").style.display !== "none") renderGoals();
    if($("viewMetasRank").style.display !== "none") renderMetaRank();
    if($("viewNoConv").style.display !== "none") renderNoConv();
  }

  

  // ======================
  // BADGES / CONQUISTAS (Vendedor)
  // ======================
  const BADGE_DEFS = {
    DAY_GOAL: { icon:"✅", title:"Meta do Dia Batida", desc:"Bateu a meta diária do dia." },
    WEEK_GOAL: { icon:"🏁", title:"Meta da Semana Batida", desc:"Bateu a meta da semana." },
    MONTH_GOAL: { icon:"🌙", title:"Meta do Mês Batida", desc:"Chegou na meta do mês." },
    TOP_CONV: { icon:"👑", title:"Rei da Conversão", desc:"Fechou o mês com conversão acima de 80%." },
    BIG_SALE: { icon:"💎", title:"Venda Suprema", desc:"Fez uma venda acima de R$ 5.000." },
    SALE_TOP: { icon:"🚀", title:"Venda Top", desc:"Venda entre R$ 1.500 e R$ 2.000." },
    SALE_RESPECT: { icon:"🫡", title:"Venda de Respeito", desc:"Venda entre R$ 2.500 e R$ 3.500." },
    PA_BRONZE: { icon:"🥉", title:"P.A Bronze", desc:"P.A do mês entre 2,30 e 2,39." },
    PA_SILVER: { icon:"🥈", title:"P.A Prata", desc:"P.A do mês entre 2,40 e 2,49." },
    PA_GOLD: { icon:"🥇", title:"P.A Ouro", desc:"P.A do mês acima de 2,50." },
    BIGGEST_SALE: { icon:"🏆", title:"Maior Venda do Mês", desc:"Maior venda do mês." }
  };

  function ensureBadges(){
    if(!state.badges) state.badges = { earned: [] };
    if(!Array.isArray(state.badges.earned)) state.badges.earned = [];
  }

  function awardBadge(entry){
    ensureBadges();
    if(state.badges.earned.some(e=> e.key === entry.key)) return;
    state.badges.earned.push(entry);
  }

  function sellerGoalMonthly(sid, mk){
    const ov = (state.vendorGoalsByMonth?.[mk]||{})[sid];
    if(Number(ov||0) > 0) return Number(ov);
    const g = getGoalsForMonth(mk);
    const divisor = Number(state.options.vendorDivisor||0) || ((state.sellers||[]).filter(s=>s.active).length || 1);
    return (Number(g.monthly||0) / Math.max(1, divisor));
  }

  function sellerGoalWeek(sid, mk, week){
    const g = getGoalsForMonth(mk);
    const divisor = Number(state.options.vendorDivisor||0) || ((state.sellers||[]).filter(s=>s.active).length || 1);
    const ovM = (state.vendorGoalsByMonth?.[mk]||{})[sid];
    if(Number(ovM||0) > 0){
      const base = (g.basePercents||[25,25,25,25]).map(x=>Number(x||0));
      const s = base.reduce((a,b)=>a+b,0) || 100;
      const pct = (base[week-1]||0) / s;
      return Number(ovM) * pct;
    }
    return (Number(g.weekTargets?.[week-1]||0) / Math.max(1, divisor));
  }

  function sellerGoalDay(sid, mk){
    const m = sellerGoalMonthly(sid, mk);
    const days = daysInMonth(mk);
    return m / Math.max(1, days);
  }

  function sellerRecsInMonth(sid, mk){
    return state.records.filter(r=> r.sellerId===sid && r.monthKey===mk);
  }
  function sellerSoldInMonth(sid, mk){
    return state.records.filter(r=> r.sellerId===sid && r.monthKey===mk && r.outcome==='sold');
  }
  function sellerRevenueDay(sid, tk){
    return state.records.filter(r=> r.sellerId===sid && r.dateKey===tk && r.outcome==='sold').reduce((s,r)=>s+Number(r.value||0),0);
  }
  function sellerRevenueWeek(sid, mk, week){
    return state.records.filter(r=> r.sellerId===sid && r.monthKey===mk && r.outcome==='sold' && weekOfMonth(r.dateKey)===week).reduce((s,r)=>s+Number(r.value||0),0);
  }

  function evaluateSellerBadgesAfterRecord(rec){
    if(rec.outcome !== 'sold') return;
    const sid = rec.sellerId;
    const mk = rec.monthKey;
    const tk = rec.dateKey;
    const week = weekOfMonth(tk);

    // Sale-based instant badges
    const v = Number(rec.value||0);
    if(v > 5000) awardBadge({ key:`SELLER_${sid}_${rec.id}_BIG_SALE`, scope:'seller', sellerId:sid, monthKey:mk, title:BADGE_DEFS.BIG_SALE.title, desc:BADGE_DEFS.BIG_SALE.desc, icon:BADGE_DEFS.BIG_SALE.icon, ts: nowTs() });
    if(v >= 1500 && v <= 2000) awardBadge({ key:`SELLER_${sid}_${rec.id}_SALE_TOP`, scope:'seller', sellerId:sid, monthKey:mk, title:BADGE_DEFS.SALE_TOP.title, desc:BADGE_DEFS.SALE_TOP.desc, icon:BADGE_DEFS.SALE_TOP.icon, ts: nowTs() });
    if(v >= 2500 && v <= 3500) awardBadge({ key:`SELLER_${sid}_${rec.id}_SALE_RESPECT`, scope:'seller', sellerId:sid, monthKey:mk, title:BADGE_DEFS.SALE_RESPECT.title, desc:BADGE_DEFS.SALE_RESPECT.desc, icon:BADGE_DEFS.SALE_RESPECT.icon, ts: nowTs() });

    // Day goal
    const dayGoal = sellerGoalDay(sid, mk);
    const dayRev = sellerRevenueDay(sid, tk);
    if(dayGoal>0 && dayRev >= dayGoal){
      awardBadge({ key:`SELLER_${sid}_${tk}_DAY_GOAL`, scope:'seller', sellerId:sid, monthKey:mk, dateKey:tk, title:BADGE_DEFS.DAY_GOAL.title, desc:BADGE_DEFS.DAY_GOAL.desc, icon:BADGE_DEFS.DAY_GOAL.icon, ts: nowTs() });
    }

    // Week goal
    const wGoal = sellerGoalWeek(sid, mk, week);
    const wRev = sellerRevenueWeek(sid, mk, week);
    if(wGoal>0 && wRev >= wGoal){
      awardBadge({ key:`SELLER_${sid}_${mk}_W${week}_WEEK_GOAL`, scope:'seller', sellerId:sid, monthKey:mk, week, title:BADGE_DEFS.WEEK_GOAL.title, desc:BADGE_DEFS.WEEK_GOAL.desc, icon:BADGE_DEFS.WEEK_GOAL.icon, ts: nowTs() });
    }

    // Month goal
    const mGoal = sellerGoalMonthly(sid, mk);
    const mRev = sellerSoldInMonth(sid, mk).reduce((s,r)=>s+Number(r.value||0),0);
    if(mGoal>0 && mRev >= mGoal){
      awardBadge({ key:`SELLER_${sid}_${mk}_MONTH_GOAL`, scope:'seller', sellerId:sid, monthKey:mk, title:BADGE_DEFS.MONTH_GOAL.title, desc:BADGE_DEFS.MONTH_GOAL.desc, icon:BADGE_DEFS.MONTH_GOAL.icon, ts: nowTs() });
    }

    // Biggest sale of month (re-evaluate each sale)
    const sold = sellerSoldInMonth(sid, mk);
    if(sold.length){
      const max = sold.reduce((a,b)=> (Number(b.value||0)>Number(a.value||0) ? b : a), sold[0]);
      awardBadge({ key:`SELLER_${sid}_${mk}_BIGGEST_${max.id}`, scope:'seller', sellerId:sid, monthKey:mk, title:BADGE_DEFS.BIGGEST_SALE.title, desc:BADGE_DEFS.BIGGEST_SALE.desc+` (${formatMoney(max.value)})`, icon:BADGE_DEFS.BIGGEST_SALE.icon, ts: nowTs() });
    }

    // End-of-month style badges: P.A and Conversion (evaluated anytime; only awards if thresholds met)
    const all = sellerRecsInMonth(sid, mk);
    const a = agg(all);
    if(a.paPerSale >= 2.30 && a.paPerSale <= 2.39) awardBadge({ key:`SELLER_${sid}_${mk}_PA_BRONZE`, scope:'seller', sellerId:sid, monthKey:mk, title:BADGE_DEFS.PA_BRONZE.title, desc:BADGE_DEFS.PA_BRONZE.desc, icon:BADGE_DEFS.PA_BRONZE.icon, ts: nowTs() });
    if(a.paPerSale >= 2.40 && a.paPerSale <= 2.49) awardBadge({ key:`SELLER_${sid}_${mk}_PA_SILVER`, scope:'seller', sellerId:sid, monthKey:mk, title:BADGE_DEFS.PA_SILVER.title, desc:BADGE_DEFS.PA_SILVER.desc, icon:BADGE_DEFS.PA_SILVER.icon, ts: nowTs() });
    if(a.paPerSale >= 2.50) awardBadge({ key:`SELLER_${sid}_${mk}_PA_GOLD`, scope:'seller', sellerId:sid, monthKey:mk, title:BADGE_DEFS.PA_GOLD.title, desc:BADGE_DEFS.PA_GOLD.desc, icon:BADGE_DEFS.PA_GOLD.icon, ts: nowTs() });
    if(a.conv >= 80) awardBadge({ key:`SELLER_${sid}_${mk}_TOP_CONV`, scope:'seller', sellerId:sid, monthKey:mk, title:BADGE_DEFS.TOP_CONV.title, desc:BADGE_DEFS.TOP_CONV.desc, icon:BADGE_DEFS.TOP_CONV.icon, ts: nowTs() });
  }

  function renderSellerView(){
    ensureBadges();
    const mk = $("sellerViewMonth").value || monthKey();
    $("sellerViewMonth").value = mk;

    // populate sellers (preserva seleção + estado vazio guiado)
    const sel = $("sellerViewSelect");
    const active = state.sellers.filter(s=>s.active);

    const wanted = state.ui?.sellerViewId || "";
    const opts = [];
    if(active.length>1) opts.push('<option value="" disabled>Selecione…</option>');
    for(const s of active){ opts.push(`<option value="${s.id}">${s.name}</option>`); }
    sel.innerHTML = opts.join('');

    // define seleção
    let sid = "";
    if(wanted && active.some(s=>s.id===wanted)) sid = wanted;
    else sid = (active[0] && active[0].id) || "";
    sel.value = sid;
    state.ui = state.ui || {};
    state.ui.sellerViewId = sid;
    save(state);

    if(!sid){
      $("sellerKpis").innerHTML = '<div class="hint">Cadastre um vendedor para ver o painel.</div>';
      $("sellerGoalsBox").innerHTML = '<div class="hint">—</div>';
      $("sellerBadges").innerHTML = '';
      return;
    }
    const seller = getSeller(sid);
    const tk = todayKey();
    const w = weekOfMonth(tk);

    const recMonth = sellerRecsInMonth(sid, mk);
    const aMonth = agg(recMonth);

    const dayGoal = sellerGoalDay(sid, mk);
    const weekGoal = sellerGoalWeek(sid, mk, w);
    const monthGoal = sellerGoalMonthly(sid, mk);

    const dayRev = sellerRevenueDay(sid, tk);
    const weekRev = sellerRevenueWeek(sid, mk, w);
    const monthRev = sellerSoldInMonth(sid, mk).reduce((s,r)=>s+Number(r.value||0),0);

    const pctD = dayGoal>0 ? clamp((dayRev/dayGoal)*100,0,999) : 0;
    const pctW = weekGoal>0 ? clamp((weekRev/weekGoal)*100,0,999) : 0;
    const pctM = monthGoal>0 ? clamp((monthRev/monthGoal)*100,0,999) : 0;

    $("sellerKpis").innerHTML = `
      <div class="kpi"><div class="label">Atendimentos</div><div class="value">${aMonth.atend}</div></div>
      <div class="kpi"><div class="label">Vendas</div><div class="value">${aMonth.sales}</div></div>
      <div class="kpi"><div class="label">Conversão</div><div class="value">${aMonth.conv.toFixed(1)}%</div></div>
      <div class="kpi"><div class="label">Faturamento</div><div class="value">${formatMoney(aMonth.revenue)}</div></div>
      <div class="kpi"><div class="label">P.A (venda)</div><div class="value">${aMonth.paPerSale.toFixed(2)}</div></div>
    `;

    const goalMsg = `
      <div style="display:flex; gap:10px; flex-wrap:wrap; justify-content:space-between">
        <div><b>${seller?.name||'Vendedor'}</b> — acompanhamento de metas</div>
        <div class="tag">Divisor: <b>${String(state.options.vendorDivisor||'—').replace('.',',')}</b></div>
      </div>
      <div class="divider"></div>
      <div class="row" style="gap:14px">
        <div style="flex:1; min-width:240px">
          <div class="tiny">Meta diária</div>
          <div style="font-weight:900; font-size:16px">${formatMoney(dayRev)} <span class="tiny">/ ${formatMoney(dayGoal)}</span></div>
          <div class="meter good"><i style="width:${clamp(pctD,0,100)}%"></i></div>
        </div>
        <div style="flex:1; min-width:240px">
          <div class="tiny">Meta da semana (Semana ${w})</div>
          <div style="font-weight:900; font-size:16px">${formatMoney(weekRev)} <span class="tiny">/ ${formatMoney(weekGoal)}</span></div>
          <div class="meter good"><i style="width:${clamp(pctW,0,100)}%"></i></div>
        </div>
        <div style="flex:1; min-width:240px">
          <div class="tiny">Meta do mês</div>
          <div style="font-weight:900; font-size:16px">${formatMoney(monthRev)} <span class="tiny">/ ${formatMoney(monthGoal)}</span></div>
          <div class="meter good"><i style="width:${clamp(pctM,0,100)}%"></i></div>
        </div>
      </div>`;

    $("sellerGoalsBox").innerHTML = goalMsg;

    // badges
    const earned = state.badges.earned.filter(e=> e.scope==='seller' && e.sellerId===sid && e.monthKey===mk);
    const grid = $("sellerBadges");
    if(!earned.length){
      grid.innerHTML = '<div class="hint">Nenhum selo ainda. Finalize vendas e metas para destravar. 🚀</div>';
    } else {
      earned.sort((a,b)=> (b.ts||0)-(a.ts||0));
      grid.innerHTML = earned.map(e=>`
        <div class="badgeCard">
          <div class="badgeTop">
            <div class="badgeIcon">${e.icon||'🏅'}</div>
            <div>
              <div class="badgeTitle">${e.title}</div>
              <div class="badgeDesc">${e.desc||''}</div>
            </div>
          </div>
          <div class="badgeDesc" style="margin-top:8px">${e.dateKey ? ('Dia: <b>'+e.dateKey+'</b>') : (e.week ? ('Semana: <b>'+e.week+'</b>') : '')}</div>
        </div>`).join('');
    }
  }

  function downloadSellerBadges(){
    const sid = $("sellerViewSelect").value;
    const mk = $("sellerViewMonth").value || monthKey();
    const seller = getSeller(sid);
    ensureBadges();
    const earned = state.badges.earned.filter(e=> e.scope==='seller' && e.sellerId===sid && e.monthKey===mk);
    const msg = pick([
      'Bora pra cima! Consistência vence. 🔥',
      'Você está construindo resultado. Um atendimento de cada vez. 🚀',
      'Disciplina + foco = meta batida. Vamos! 💪',
      'Quem faz o básico bem feito, domina o jogo. 👑'
    ]);
    const cards = earned.map(e=>`<div style="border:1px solid #e5e7eb;border-radius:14px;padding:12px;margin:10px 0;display:flex;gap:10px;align-items:center">
      <div style="font-size:26px">${e.icon||'🏅'}</div>
      <div><div style="font-weight:900">${e.title}</div><div style="color:#4b5563;font-size:13px">${e.desc||''}</div></div>
    </div>`).join('') || '<div style="color:#6b7280">Nenhum selo no período.</div>';
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Selos - ${seller?.name||'Vendedor'} - ${mk}</title></head>
    <body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;padding:18px;background:#fff;color:#111">
      <h1 style="margin:0 0 6px 0">Selos do Vendedor: ${seller?.name||'Vendedor'}</h1>
      <div style="color:#374151;margin-bottom:10px">Mês: <b>${mk}</b></div>
      <div style="padding:12px;border:1px solid #e5e7eb;border-radius:14px;background:#f8fafc">Mensagem: <b>${msg}</b></div>
      <h2 style="margin:16px 0 8px 0">Conquistas</h2>
      ${cards}
      <div style="margin-top:18px;color:#6b7280;font-size:12px">Gerado pelo OMNIA — Painel de Conquistas</div>
    </body></html>`;
    const blob = new Blob([html], {type:'text/html'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const safeName = (seller?.name||'vendedor').toLowerCase().replace(/\s+/g,'_');
    a.download = `selos_${safeName}_${mk}.html`;
    document.body.appendChild(a);
    a.click();
    setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
// ======================
  // UI / NAV
  // ======================
  function renderAll(){
    applyTheme();
    renderHeader();
    renderKpis();
    renderQueue();
    renderPool();
    renderCurrent();
    if($("viewDados").style.display !== "none") renderData();
    if($("viewMetas").style.display !== "none") renderGoals();
    if($("viewMetasRank").style.display !== "none") renderMetaRank();
    if($("viewNoConv").style.display !== "none") renderNoConv();
  }

  $("btnCallNext").addEventListener("click", callNext);

  // Tabs/views
  function setTab(tab){
    const ops = $("viewOps");
    const dados = $("viewDados");
    const metas = $("viewMetas");
    const mRank = $("viewMetasRank");
    const nc = $("viewNoConv");
    const seller = $("viewSeller");

    const tOps = $("tabOps");
    const tDados = $("tabDados");
    const tMetas = $("tabMetas");
    const tMR = $("tabMetasRank");
    const tNC = $("tabNoConv");
    const tSeller = $("tabSeller");

    ops.style.display = "none";
    dados.style.display = "none";
    metas.style.display = "none";
    mRank.style.display = "none";
    nc.style.display = "none";
    seller.style.display = "none";

    tOps.classList.remove("active");
    tDados.classList.remove("active");
    tMetas.classList.remove("active");
    tMR.classList.remove("active");
    tNC.classList.remove("active");
    tSeller.classList.remove("active");

    if(tab === "ops"){ ops.style.display = ""; tOps.classList.add("active"); }
    else if(tab === "dados"){ dados.style.display = ""; tDados.classList.add("active"); renderData(); }
    else if(tab === "metas"){ metas.style.display = ""; tMetas.classList.add("active"); renderGoals(); }
    else if(tab === "metasRank"){ mRank.style.display = ""; tMR.classList.add("active"); renderMetaRank(); }
    else if(tab === "noConv"){ nc.style.display = ""; tNC.classList.add("active"); renderNoConv(); }
    else if(tab === "seller"){ seller.style.display = ""; tSeller.classList.add("active"); renderSellerView(); }
  }
  $("tabOps").addEventListener("click", ()=> setTab("ops"));
  $("tabDados").addEventListener("click", ()=> setTab("dados"));
  $("tabMetas").addEventListener("click", ()=> setTab("metas"));
  $("tabMetasRank").addEventListener("click", ()=> setTab("metasRank"));
  $("tabNoConv").addEventListener("click", ()=> setTab("noConv"));
  $("tabSeller").addEventListener("click", ()=> setTab("seller"));

  $("btnData").addEventListener("click", ()=> setTab("dados"));
  $("btnGoals").addEventListener("click", ()=> setTab("metas"));
  $("btnGoalRank").addEventListener("click", ()=> setTab("metasRank"));
  $("btnNoConv").addEventListener("click", ()=> setTab("noConv"));
  $("btnSeller").addEventListener("click", ()=> setTab("seller"));

  // Data inputs
  $("dataView").addEventListener("change", renderData);
  $("dataDate").addEventListener("change", renderData);
  $("dataMonth").addEventListener("change", renderData);
  $("btnExportCSV").addEventListener("click", exportCSV);
  $("btnExportJSON").addEventListener("click", exportJSON);

  // Goals inputs
  $("goalMonth").addEventListener("change", renderGoals);
  $("goalMonthly").addEventListener("input", ()=> { saveGoalsDraftAndAuto(); });
  ["pW1","pW2","pW3","pW4"].forEach(id=>{
    $(id).addEventListener("input", ()=> { saveGoalsDraftAndAuto(); });
  });

  // Vendor goals
  $("goalVendorDivisor").addEventListener("input", ()=>{
    const d = parseBRNumber($("goalVendorDivisor").value||"");
    if(d>0) state.options.vendorDivisor = d;
    save(state);
    try{ renderVendorGoals(); }catch{}
  });
  $("goalVendorSelect").addEventListener("change", ()=>{ try{ renderVendorGoals(); }catch{} });
  $("goalVendorMonthlyOverride").addEventListener("input", ()=>{ /* visual only */ });
  $("btnSaveVendorGoal").addEventListener("click", saveVendorGoal);
  function saveGoalsDraftAndAuto(){
    const mk = $("goalMonth").value || monthKey();
    const g = getGoalsForMonth(mk);
    g.monthly = parseBRNumber($("goalMonthly").value);
    g.basePercents = [
      parseBRNumber($("pW1").value),
      parseBRNumber($("pW2").value),
      parseBRNumber($("pW3").value),
      parseBRNumber($("pW4").value),
    ];
    autoRedistributeGoals(mk);
    save(state);
    renderGoals();
  }

  $("btnSaveGoals").addEventListener("click", saveGoals);
  $("btnAutoRedistribute").addEventListener("click", ()=>{
    renderGoals();
    alert("Redistribuição automática aplicada ✅");
  });
  $("btnCloseWeek").addEventListener("click", closeCurrentWeek);
  $("btnReopenWeeks").addEventListener("click", reopenWeeks);

  // Seller View
    $("sellerViewSelect").addEventListener("change", ()=>{ state.ui = state.ui || {}; state.ui.sellerViewId = $("sellerViewSelect").value; save(state); renderSellerView(); });
  $("sellerViewMonth").addEventListener("change", renderSellerView);
  $("btnSellerDownloadBadges").addEventListener("click", downloadSellerBadges);

  // Meta Rank
  $("btnRefreshMetaRank").addEventListener("click", renderMetaRank);
  $("metaRankMonth").addEventListener("change", renderMetaRank);
  $("metaRankMode").addEventListener("change", renderMetaRank);

  // Não convertidos
  $("btnNoConvRefresh").addEventListener("click", renderNoConv);
  $("ncView").addEventListener("change", renderNoConv);
  $("ncDate").addEventListener("change", renderNoConv);
  $("ncMonth").addEventListener("change", renderNoConv);

  // Theme buttons
  $("themeDefault").addEventListener("click", ()=>{ state.ui.theme = "default"; save(state); renderAll(); });
  $("themeNeon").addEventListener("click", ()=>{ state.ui.theme = "neon"; save(state); renderAll(); });
  $("themeOcean").addEventListener("click", ()=>{ state.ui.theme = "ocean"; save(state); renderAll(); });
  $("themeSunset").addEventListener("click", ()=>{ state.ui.theme = "sunset"; save(state); renderAll(); });
  $("themePurple").addEventListener("click", ()=>{ state.ui.theme = "purple"; save(state); renderAll(); });
  $("themeTextured").addEventListener("click", ()=>{ state.ui.theme = "textured"; save(state); renderAll(); });

  // Settings modal
  function fileToDataUrl(file){
    return new Promise((resolve, reject)=>{
      const reader = new FileReader();
      reader.onload = ()=> resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  $("btnSettings").addEventListener("click", ()=>{
    $("storeName").value = state.store.name || "";
    $("storeStatus").value = state.store.status || "Online";
    $("optValue").value = state.options.askValue ? "yes" : "no";
    $("optPieces").value = state.options.askPieces ? "yes" : "no";
    openModal($("settingsBack"));
  });
  $("closeSettings").addEventListener("click", ()=> closeModal($("settingsBack")));
  $("settingsBack").addEventListener("click", (e)=>{ if(e.target === $("settingsBack")) closeModal($("settingsBack")); });

  $("storeName").addEventListener("input", (e)=>{ state.store.name = e.target.value; save(state); renderHeader(); });
  $("storeStatus").addEventListener("change", (e)=>{ state.store.status = e.target.value; save(state); renderHeader(); });
  $("optValue").addEventListener("change", (e)=>{ state.options.askValue = e.target.value==="yes"; save(state); renderAll(); });
  $("optPieces").addEventListener("change", (e)=>{ state.options.askPieces = e.target.value==="yes"; save(state); renderAll(); });

  $("logoInput").addEventListener("change", async (e)=>{
    const file = e.target.files?.[0];
    if(!file) return;
    state.store.logoDataUrl = await fileToDataUrl(file);
    save(state);
    renderHeader();
  });

  $("btnResetDay").addEventListener("click", ()=>{
    if(!confirm("Zerar dia? Isso apaga os registros de HOJE.")) return;
    const tk = todayKey();
    state.records = state.records.filter(r => r.dateKey !== tk);
    save(state);
    renderAll();
    alert("Registros de hoje zerados.");
  });

  $("btnResetAll").addEventListener("click", ()=>{
    if(!confirm("Reset total? Apaga tudo.")) return;
    localStorage.removeItem(KEY);
    state = JSON.parse(JSON.stringify(defaultState));
    state.sellers = [];
    state.queue = [];
    state.pool = [];
    state.current = null;
    state.records = [];
    state.goalsByMonth = {};
    state.ui = { theme: "default" };
    save(state);
    renderAll();
    closeModal($("settingsBack"));
    alert("Reset total concluído.");
  });

  // Desativar vendedor modal
  $("btnDeactivateSeller").addEventListener("click", ()=>{
    renderDeactivateModal();
    openModal($("deactBack"));
  });
  $("closeDeact").addEventListener("click", ()=> closeModal($("deactBack")));
  $("deactBack").addEventListener("click", (e)=>{ if(e.target === $("deactBack")) closeModal($("deactBack")); });

  // Add seller modal
  $("btnAddSeller").addEventListener("click", ()=>{
    $("sellerName").value = "";
    $("sellerPhoto").value = "";
    openModal($("sellerBack"));
  });
  $("closeSeller").addEventListener("click", ()=> closeModal($("sellerBack")));
  $("sellerBack").addEventListener("click", (e)=>{ if(e.target === $("sellerBack")) closeModal($("sellerBack")); });

  window.__createSellerOriginal = async ()=>{
    const name = $("sellerName").value.trim();
    if(!name){ alert("Digite o nome do vendedor."); return; }
    let photo = "";
    const file = $("sellerPhoto").files?.[0];
    if(file) photo = await fileToDataUrl(file);
    const id = uid();
    state.sellers.push({ id, name, photo, paused:false, active:true });
    state.pool.push(id);
    save(state);
    renderAll();
    closeModal($("sellerBack"));
  };
  $("btnCreateSeller").addEventListener("click", ()=> window.__createSellerOriginal());

  // Ranking modal
  $("btnRanking").addEventListener("click", ()=>{
    renderRankingModal();
    openModal($("rankingBack"));
  });
  $("closeRanking").addEventListener("click", ()=> closeModal($("rankingBack")));
  $("rankingBack").addEventListener("click", (e)=>{ if(e.target === $("rankingBack")) closeModal($("rankingBack")); });

  // Preferência modal
  $("btnPreference").addEventListener("click", ()=>{
    renderPreferenceModal();
    openModal($("prefBack"));
  });
  $("closePref").addEventListener("click", ()=> closeModal($("prefBack")));
  $("prefBack").addEventListener("click", (e)=>{ if(e.target === $("prefBack")) closeModal($("prefBack")); });

  // Timer (múltiplos atendimentos)
  setInterval(()=>{
    const currents = (state.currents||[]);
    for(const c of currents){
      const t = document.getElementById("timer_" + c.id);
      if(!t) continue;
      const sec = Math.floor((nowTs() - (c.startTs||nowTs()))/1000);
      t.textContent = sec + "s";
    }
  }, 1000);

  

  // ======================
  // HARDENING: garantias de clique (PWA/cache/listeners)
  // ======================
  function bindSafeClick(el, fn){
    if(!el) return;
    // remove inline (avoid duplicates)
    el.onclick = null;
    el.addEventListener('click', (ev)=>{
      try{ fn(ev); }catch(err){
        console.error(err);
        alert('Erro: '+ (err?.message||err));
      }
    });
  }

  // Força binds críticos mesmo se algo falhar acima
  document.addEventListener('DOMContentLoaded', ()=>{
    // Config
    bindSafeClick(document.getElementById('btnSettings'), ()=>{
      try{
        document.getElementById('storeName').value = state.store.name || '';
        document.getElementById('storeStatus').value = state.store.status || 'Online';
        document.getElementById('optValue').value = state.options.askValue ? 'yes':'no';
        document.getElementById('optPieces').value = state.options.askPieces ? 'yes':'no';
      }catch{}
      openModal(document.getElementById('settingsBack'));
    });

    // Abrir modal vendedor
    bindSafeClick(document.getElementById('btnAddSeller'), ()=>{
      const n=document.getElementById('sellerName');
      const f=document.getElementById('sellerPhoto');
      if(n) n.value='';
      if(f) f.value='';
      openModal(document.getElementById('sellerBack'));
    });

    // Criar vendedor
    bindSafeClick(document.getElementById('btnCreateSeller'), async ()=>{
      const name=(document.getElementById('sellerName')?.value||'').trim();
      if(!name){ alert('Digite o nome do vendedor.'); return; }
      let photo='';
      const file=document.getElementById('sellerPhoto')?.files?.[0];
      if(file){
        try{ photo = await fileToDataUrl(file); }catch{}
      }
      const id = uid();
      state.sellers.push({ id, name, photo, paused:false, active:true });
      state.pool.push(id);
      save(state);
      renderAll();
      closeModal(document.getElementById('sellerBack'));
      alert('Vendedor criado ✅');
    });
  });

  // Captura erros não tratados (para não “morrer” sem aviso)
  window.addEventListener('error', (e)=>{
    console.error('Erro JS', e.error||e.message);
  });
  window.addEventListener('unhandledrejection', (e)=>{
    console.error('Promise rejeitada', e.reason);
  });

  // ======================
  // HARDENING (anti-cache / anti-listener-fail)
  // Mantém Config e Criar vendedor funcionando mesmo se algum trecho quebrar
  window.addEventListener('error', (e)=>{
    try{ console.error('NexxtOne error:', e?.error || e?.message || e); }catch{}
  });

  function safeOpenById(backId){
    const el = document.getElementById(backId);
    if(!el) return;
    try{ openModal(el); }catch{ el.style.display='flex'; }
  }

  // Fallback por delegação de clique
  document.addEventListener('click', (ev)=>{
    const t = ev.target;
    if(!(t instanceof HTMLElement)) return;
    const id = t.id;
    if(id==='btnSettings'){
      ev.preventDefault();
      try{
        // preenche campos se existirem
        if(document.getElementById('storeName')) document.getElementById('storeName').value = state?.store?.name || '';
        if(document.getElementById('storeStatus')) document.getElementById('storeStatus').value = state?.store?.status || 'Online';
      }catch{}
      safeOpenById('settingsBack');
    }
    if(id==='btnAddSeller'){
      ev.preventDefault();
      try{
        const n=document.getElementById('sellerName'); if(n) n.value='';
        const p=document.getElementById('sellerPhoto'); if(p) p.value='';
      }catch{}
      safeOpenById('sellerBack');
    }
    if(id==='btnCreateSeller'){
      // se o listener original não estiver rodando, cria aqui
      // (se listener original rodar também, ele já fecha modal e salva, então aqui só entra em caso de falha)
      ev.preventDefault();
      try{
        const nameEl=document.getElementById('sellerName');
        const name=(nameEl?.value||'').trim();
        if(!name){ alert('Digite o nome do vendedor.'); return; }
        // usa a função original se existir
        if(typeof window.__createSellerOriginal==='function'){
          window.__createSellerOriginal();
          return;
        }
        const id = uid();
        state.sellers.push({ id, name, photo:'', paused:false, active:true });
        state.pool.push(id);
        save(state);
        renderAll();
        try{ closeModal(document.getElementById('sellerBack')); }catch{ document.getElementById('sellerBack').style.display='none'; }
        alert('Vendedor criado ✅');
      }catch(err){
        console.error(err);
        alert('Erro ao criar vendedor. Se persistir, reinstale o PWA para limpar cache.');
      }
    }
  }, true);
// Init inputs
  try{
    $("dataDate").value = todayKey();
    $("dataMonth").value = monthKey();
    $("goalMonth").value = monthKey();
    $("metaRankMonth").value = monthKey();
    $("ncDate").value = todayKey();
    $("ncMonth").value = monthKey();
  }catch{}


  // ======================
  // PWA INSTALL BUTTON
  // ======================
  let deferredInstallPrompt = null;
  const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isStandalone = () =>
    (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) ||
    (navigator.standalone === true);

  function openInstallHelp(){
    const back = document.getElementById("installBack");
    if(back) back.style.display = "flex";
  }
  function closeInstallHelp(){
    const back = document.getElementById("installBack");
    if(back) back.style.display = "none";
  }

  function showInstallButton(){
    const b = document.getElementById("btnInstall");
    if(!b) return;
    if(isStandalone()){ b.style.display = "none"; return; }
    if(isIOS()){ b.style.display = "inline-block"; return; }
    b.style.display = deferredInstallPrompt ? "inline-block" : "none";
  }

  window.addEventListener("beforeinstallprompt", (e)=>{
    e.preventDefault();
    deferredInstallPrompt = e;
    showInstallButton();
  });

  window.addEventListener("appinstalled", ()=>{
    deferredInstallPrompt = null;
    showInstallButton();
  });

  document.getElementById("btnInstall")?.addEventListener("click", async ()=>{
    if(isStandalone()) return;

    // iOS: não existe prompt, mostramos instruções
    if(isIOS()){
      openInstallHelp();
      return;
    }

    if(!deferredInstallPrompt){
      openInstallHelp();
      return;
    }

    deferredInstallPrompt.prompt();
    try{ await deferredInstallPrompt.userChoice; }catch{}
    deferredInstallPrompt = null;
    showInstallButton();
  });

  document.getElementById("closeInstall")?.addEventListener("click", closeInstallHelp);
  document.getElementById("installBack")?.addEventListener("click", (e)=>{
    const back = document.getElementById("installBack");
    if(e.target === back) closeInstallHelp();
  });

  // mostra botão no carregamento (iOS/Android compatível)
  try{ showInstallButton(); }catch{}

  // Init
  renderAll();
