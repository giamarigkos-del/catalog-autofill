(function(){
  if(!location.hostname.includes('wolt.com')){alert('Τρέξε αυτό στο wolt.com!');return;}
  if(window.__efoodScraping){alert('Τρέχει ήδη...');return;}
  window.__efoodScraping=true;

  /* ── UI ── */
  const ov=document.createElement('div');
  ov.id='__efood_ov';
  ov.style.cssText='position:fixed;top:16px;right:16px;z-index:999999;background:#0f0f0f;color:#fff;padding:16px 20px;border-radius:12px;font-family:Inter,sans-serif;font-size:14px;min-width:280px;box-shadow:0 4px 24px #0006;';
  ov.innerHTML='<div style="font-weight:700;margin-bottom:8px;">⚡ efood Catalog Scraper</div><div id="__ef_st">Ξεκινάω...</div><div style="margin-top:10px;height:4px;background:#333;border-radius:2px;"><div id="__ef_bar" style="height:4px;background:#f5b800;border-radius:2px;width:0%;transition:width .3s;"></div></div>';
  document.body.appendChild(ov);

  const setSt=(m,p)=>{
    document.getElementById('__ef_st').textContent=m;
    if(p!==undefined)document.getElementById('__ef_bar').style.width=p+'%';
  };
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));

  /* ── Helpers για modal ── */
  function getModalName(){
    const h=document.querySelector('h2.h1m8nnah')||document.querySelector('[role="dialog"] h2');
    return h?h.textContent.trim():null;
  }
  function getModalOptions(){
    const grps=[];
    document.querySelectorAll('[role="dialog"] fieldset').forEach(fs=>{
      const leg=fs.querySelector('legend');if(!leg)return;
      const title=(leg.querySelector('span')||leg).textContent.trim();if(!title)return;
      const type=fs.querySelector('input[type="radio"]')?'required_single':'optional_multi';
      const opts=[];
      fs.querySelectorAll('label').forEach(lbl=>{
        const ne=lbl.querySelector('.n1h7omf3')||lbl.querySelector('span');
        const name=ne?ne.textContent.trim():lbl.textContent.trim();
        if(!name||name.length>100)return;
        let pd=0;const pm=lbl.textContent.match(/\+(\d+[,\.]\d+)\s*€/);
        if(pm)pd=parseFloat(pm[1].replace(',','.'));
        opts.push({name,price_delta:pd});
      });
      if(opts.length)grps.push({title,type,options:opts});
    });
    return grps;
  }
  function closeModal(){
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  }
  function isModalOpen(){
    return !!document.querySelector('[role="dialog"] h2');
  }

  /* ── PASS 1: Scan DOM χωρίς clicks ── */
  /* Δομή Wolt: div[data-test-id="MenuSection"]
       ├── div[data-test-id="MenuSectionTitle"] → h2 (όνομα κατηγορίας)
       └── div.ij4681s → div[data-test-id="horizontal-item-card"] (items) */
  function scanCatalog(){
    const catalog=[];
    const sections=document.querySelectorAll('[data-test-id="MenuSection"]');
    sections.forEach(section=>{
      /* Όνομα κατηγορίας από το h2 μέσα στο MenuSectionTitle */
      const titleDiv=section.querySelector('[data-test-id="MenuSectionTitle"]');
      const h2=titleDiv?titleDiv.querySelector('h2'):null;
      const catName=h2?h2.textContent.trim():'Γενικά';

      /* Items: όλα τα horizontal-item-card μέσα στο section */
      const itemCards=section.querySelectorAll('[data-test-id="horizontal-item-card"]');
      const items=[];
      itemCards.forEach(card=>{
        const btn=card.querySelector('[data-test-id="horizontal-item-card-button"]');
        
        /* Όνομα: από το h3 με data-test-id="horizontal-item-card-header" */
        const h3=card.querySelector('[data-test-id="horizontal-item-card-header"]');
        let name=h3?h3.textContent.trim():'';
        if(!name)return;

        /* Τιμή: το Wolt γράφει €X.XX (πρώτα το σύμβολο, τελεία ως διαχωριστικό)
           Ψάχνω πρώτα σε price elements, fallback στο textContent */
        let price=null;
        const priceEl=card.querySelector('[data-test-id="horizontal-item-card-discounted-price"]')||
                      card.querySelector('[data-test-id="horizontal-item-card-price"]');
        if(priceEl){
          const pt=priceEl.textContent.trim();
          const pm2=pt.match(/€\s*(\d+[\.,]?\d*)/);
          if(pm2)price=parseFloat(pm2[1].replace(',','.'));
        }
        if(price===null){
          /* Fallback: ψάχνω €X.XX ή X,XX € ή X € στο card text */
          const allTxt=card.textContent;
          const pm3=allTxt.match(/€\s*(\d+[\.,]\d+)/)||allTxt.match(/€\s*(\d+)/);
          if(pm3)price=parseFloat(pm3[1].replace(',','.'));
        }

        /* Description: το p μετά το h3 */
        let description=null;
        const ps=card.querySelectorAll('p');
        ps.forEach(p=>{
          const t=p.textContent.trim();
          if(t&&t!==name&&!t.includes('€')&&t.length>2&&!description)
            description=t;
        });

        items.push({name,price,description,btn,option_groups:[]});
      });

      if(items.length>0)catalog.push({name:catName,items});
    });
    return catalog;
  }

  /* ── PASS 2: Click για options ── */
  async function collectOptions(catalog){
    let total=0,done=0;
    catalog.forEach(c=>total+=c.items.length);

    for(const cat of catalog){
      for(const item of cat.items){
        done++;
        setSt(`Options ${done}/${total}: ${item.name.slice(0,30)}...`, Math.round(done/total*85)+10);

        if(!item.btn||!document.body.contains(item.btn)){
          /* Button δεν υπάρχει πια — skip */
          item.option_groups=[];
          continue;
        }

        item.btn.click();
        /* Περιμένω να ανοίξει το modal */
        let waited=0;
        while(!isModalOpen()&&waited<2000){await sleep(100);waited+=100;}

        if(isModalOpen()){
          item.option_groups=getModalOptions();
          closeModal();
          /* Περιμένω να κλείσει */
          waited=0;
          while(isModalOpen()&&waited<1000){await sleep(100);waited+=100;}
          await sleep(200);
        } else {
          item.option_groups=[];
        }
      }
    }
  }

  /* ── Main ── */
  async function run(){
    try{
      /* Scroll για lazy loading */
      setSt('Φορτώνω κατηγορίες...',2);
      let lastH=0,att=0;
      while(att<30){
        window.scrollTo(0,document.body.scrollHeight);
        await sleep(600);
        const h=document.body.scrollHeight;
        if(h===lastH)break;
        lastH=h;att++;
      }
      window.scrollTo(0,0);
      await sleep(500);

      /* Pass 1: Scan */
      setSt('Σαρώνω κατάλογο...',8);
      const catalog=scanCatalog();
      const totalItems=catalog.reduce((s,c)=>s+c.items.length,0);
      setSt(`Βρέθηκαν ${catalog.length} κατηγορίες, ${totalItems} προϊόντα. Συλλέγω options...`,10);
      await sleep(300);

      /* Pass 2: Options */
      await collectOptions(catalog);

      /* Καθαρισμός — αφαίρεση btn references */
      const result={
        categories: catalog.map(c=>({
          name:c.name,
          items:c.items.map(({btn,...rest})=>({
            ...rest,
            confidence:'high',
            notes:null
          }))
        })),
        _ts:Date.now(),_source:'wolt',_url:location.href
      };

      setSt(`✓ ${totalItems} προϊόντα από ${catalog.length} κατηγορίες!`,100);

      /* Download */
      ov.innerHTML+='<div style="margin-top:12px;" id="__ef_btns"></div>';
      const bd=document.getElementById('__ef_btns');
      const dl=document.createElement('button');
      dl.textContent='⬇ Κατέβασε JSON';
      dl.style.cssText='background:#f5b800;color:#0f0f0f;border:none;border-radius:8px;padding:8px 14px;font-weight:700;cursor:pointer;font-size:13px;';
      dl.onclick=function(){
        const blob=new Blob([JSON.stringify(result,null,2)],{type:'application/json'});
        const url=URL.createObjectURL(blob);
        const a=document.createElement('a');
        a.href=url;a.download='wolt_catalog.json';
        document.body.appendChild(a);a.click();document.body.removeChild(a);
        setTimeout(()=>URL.revokeObjectURL(url),2000);
      };
      bd.appendChild(dl);
      const cl=document.createElement('button');
      cl.textContent='Κλείσιμο';
      cl.style.cssText='background:#333;color:#fff;border:none;border-radius:8px;padding:8px 14px;font-weight:600;cursor:pointer;font-size:13px;margin-left:6px;';
      cl.onclick=()=>ov.remove();
      bd.appendChild(cl);

      window.__efoodScraping=false;
    }catch(e){
      setSt('❌ Σφάλμα: '+e.message,0);
      console.error(e);
      window.__efoodScraping=false;
    }
  }

  run();
})();