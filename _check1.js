
// HARDEN_CRITICAL_BUTTONS
(function(){
  function $(id){return document.getElementById(id);} 
  function safe(fn){try{fn();}catch(e){console.error(e);alert('Erro: '+(e?.message||e));}}
  function openBack(id){const el=$(id); if(!el) return; el.style.display='flex';}
  function closeBack(id){const el=$(id); if(!el) return; el.style.display='none';}
  // fallback openers
  window.openSettingsFallback=function(){openBack('settingsBack');};
  window.openSellerFallback=function(){openBack('sellerBack');};
  // ensure create seller always works
  window.createSellerFallback=async function(){
    safe(async ()=>{
      const name=($('sellerName')?.value||'').trim();
      if(!name){alert('Digite o nome do vendedor.');return;}
      // use app helpers if present
      const KEY=window.KEY||'nexxt_state_v4';
      const state=window.state;
      if(!state||!Array.isArray(state.sellers)) throw new Error('Estado não carregou. Recarregue a página.');
      let photo='';
      const file=$('sellerPhoto')?.files?.[0];
      if(file && window.fileToDataUrl){photo=await window.fileToDataUrl(file);}
      const uid=(window.uid?window.uid():('id_'+Math.random().toString(16).slice(2)));
      state.sellers.push({id:uid,name,photo,paused:false,active:true});
      state.pool.push(uid);
      if(window.save) window.save(state); else localStorage.setItem(KEY, JSON.stringify(state));
      if(window.renderAll) window.renderAll();
      closeBack('sellerBack');
    });
  };
  // bind after DOM ready
  function bind(){
    const bs=$('btnSettings'); if(bs){ bs.onclick=()=>safe(()=>{ if(window.openModal){
        // sync fields if possible
        try{ $('storeName').value=(window.state?.store?.name||''); $('storeStatus').value=(window.state?.store?.status||'Online'); $('optValue').value=(window.state?.options?.askValue?'yes':'no'); $('optPieces').value=(window.state?.options?.askPieces?'yes':'no'); }catch{}
        window.openModal($('settingsBack'));
      } else openBack('settingsBack');}); }
    const ba=$('btnAddSeller'); if(ba){ ba.onclick=()=>safe(()=>{ try{ $('sellerName').value=''; $('sellerPhoto').value=''; }catch{}; if(window.openModal) window.openModal($('sellerBack')); else openBack('sellerBack');}); }
    const bc=$('btnCreateSeller'); if(bc){ bc.onclick=()=>window.createSellerFallback(); }
    const cs=$('closeSettings'); if(cs){ cs.onclick=()=>{ if(window.closeModal) window.closeModal($('settingsBack')); else closeBack('settingsBack'); }; }
    const cl=$('closeSeller'); if(cl){ cl.onclick=()=>{ if(window.closeModal) window.closeModal($('sellerBack')); else closeBack('sellerBack'); }; }
  }
  if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded', bind);} else bind();
})();


  // --- HARDEN: botões críticos sempre funcionam (PWA/cache/listeners) ---
  (function hardenCriticalButtons(){
    const byId=(id)=>document.getElementById(id);
    function safe(fn){return function(e){try{fn(e)}catch(err){console.error(err); alert("Erro: "+(err?.message||err));}}}
    // Settings
    const bSet=byId("btnSettings");
    if(bSet){ bSet.onclick = safe(()=>{
      try{
        byId("storeName").value = state?.store?.name || "";
        byId("storeStatus").value = state?.store?.status || "Online";
        byId("optValue").value = state?.options?.askValue ? "yes" : "no";
        byId("optPieces").value = state?.options?.askPieces ? "yes" : "no";
      }catch{}
      openModal(byId("settingsBack"));
    }); }
    // Add seller
    const bAdd=byId("btnAddSeller");
    if(bAdd){ bAdd.onclick = safe(()=>{
      byId("sellerName").value = "";
      try{ byId("sellerPhoto").value = ""; }catch{}
      openModal(byId("sellerBack"));
    }); }
    // Create seller
    const bCreate=byId("btnCreateSeller");
    if(bCreate){ bCreate.onclick = safe(async()=>{
      const name = (byId("sellerName").value||"").trim();
      if(!name){ alert("Digite o nome do vendedor."); return; }
      let photo="";
      const file = byId("sellerPhoto")?.files?.[0];
      if(file){ photo = await fileToDataUrl(file); }
      const id = uid();
      state.sellers.push({ id, name, photo, paused:false, active:true });
      state.pool.push(id);
      save(state);
      renderAll();
      closeModal(byId("sellerBack"));
    }); }
  })();

  window.addEventListener("error", (e)=>{
    console.error(e.error||e.message);
  });
  window.addEventListener("unhandledrejection", (e)=>{
    console.error(e.reason);
  });
