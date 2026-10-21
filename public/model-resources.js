const words = {
  title:['配件清单','Parts list','Teileliste'], downloads:['造型资料','Model files','Modellunterlagen'],
  all:['全部配件','All parts','Alle Bauteile'], missing:['只看缺件','Missing parts','Nur Fehlteile'],
  need:['需要','Required','Benötigt'], owned:['已有','Owned','Vorhanden'], short:['还缺','Missing','Fehlend'], part:['配件','Part','Bauteil'],
  saved:['按已保存版本导出','Export the saved version','Gespeicherte Version exportieren'], current:['按当前编辑内容导出，包含未保存的修改','Export current content, including unsaved changes','Aktuellen Inhalt einschließlich ungespeicherter Änderungen exportieren'],
  unchecked:['尚未登记库存，暂未对比缺件。','No inventory recorded; shortages have not been compared.','Noch kein Bestand erfasst; Fehlteile wurden nicht verglichen.'],
  login:['登录后可对比我的配件。','Sign in to compare your inventory.','Zum Bestandsvergleich anmelden.'],
  stockFailed:['暂时无法对比缺件，请稍后重新打开。','Shortages could not be compared. Please reopen later.','Fehlteile konnten nicht verglichen werden. Bitte später erneut öffnen.'],
  loading:['正在读取库存…','Loading inventory…','Bestand wird geladen…'],
  enough:['配件齐全，可以搭建。','All required parts are available.','Alle benötigten Bauteile sind vorhanden.'], empty:['没有符合条件的配件','No matching parts','Keine passenden Bauteile'],
  summary:['共 {k} 种，{n} 件','{k} types, {n} parts','{k} Arten, {n} Bauteile'], shortage:['还缺 {k} 种，{n} 件','Missing {k} types, {n} parts','Es fehlen {k} Arten, {n} Bauteile'],
  manual:['分层说明书','Layer-by-layer instructions','Schichtweise Bauanleitung'], manualHint:['按高度分层，包含本层结构和零件用量','Layers by height, with structure views and parts quantities','Ebenen nach Höhe mit Strukturansichten und Teilemengen'],
  exportPdf:['导出 PDF','Export PDF','PDF exportieren'], exportList:['导出清单','Export list','Liste exportieren'],
  viewList:['查看清单','View list','Liste ansehen'], hideList:['收起清单','Hide list','Liste schließen'],
  resources:['正在准备资料…','Preparing resources…','Unterlagen werden vorbereitet…'], prepare:['正在准备页面…','Preparing pages…','Seiten werden vorbereitet…'],
  page:['正在生成 PDF… {k} / {n} 页','Generating PDF… {k} / {n} pages','PDF wird erstellt… {k} / {n} Seiten'], saving:['正在保存 PDF…','Saving PDF…','PDF wird gespeichert…'],
  downloadHint:['生成完成后将自动下载 PDF。','The PDF downloads automatically when ready.','Das fertige PDF wird automatisch heruntergeladen.'],
  cancel:['取消','Cancel','Abbrechen'], cancelling:['正在取消…','Cancelling…','Wird abgebrochen…'], cancelled:['已取消，可重新导出。','Cancelled. You can export again.','Abgebrochen. Du kannst erneut exportieren.'],
  list:['配件清单','Parts list','Teileliste'], csv:['导出表格','Export CSV','CSV exportieren'], png:['导出图片','Export image','Bild exportieren'],
  copy:['复制缺件清单','Copy missing parts','Fehlteile kopieren'], copied:['缺件清单已复制','Missing parts copied','Fehlteile kopiert'],
  unavailable:['当前权限允许查看配件清单，暂不可导出分层说明书。','Your access allows the parts list; layer-by-layer instructions cannot be exported.','Dein Zugriff erlaubt die Teileliste; die schichtweise Bauanleitung kann nicht exportiert werden.'],
  manualLogin:['登录后可导出分层说明书。','Sign in to export layer-by-layer instructions.','Zum Export der schichtweisen Bauanleitung anmelden.'],
  working:['正在准备…','Preparing…','Wird vorbereitet…'], done:['文件已准备并交给浏览器下载。','File prepared and sent to your browser for download.','Datei vorbereitet und an den Browser übergeben.'],
  optional:['参考配件','Reference parts','Referenzbauteile'], note:['库存按规格对比，不区分颜色；螺丝不计入缺件，参考配件单独标明。','Inventory is compared by part specification, without color. Screws are excluded from shortages; reference parts are marked separately.','Bestand wird nach Spezifikation ohne Farbe verglichen. Schrauben zählen nicht zu Fehlteilen; Referenzbauteile sind gekennzeichnet.'],
  close:['关闭','Close','Schließen'], failed:['下载未完成，请重试。','Download did not complete. Please retry.','Download nicht abgeschlossen. Bitte erneut versuchen.'],
};
export function resourceText(lang, key, values={}) {
  const index=String(lang).startsWith('de')?2:String(lang).startsWith('en')?1:0;
  return words[key][index].replace(/\{(\w+)\}/g,(_,key)=>values[key]??'');
}
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function compareRows(rows, inventory) {
  if(inventory!==null&&inventory!==undefined&&(typeof inventory!=='object'||Array.isArray(inventory)))throw new Error('Invalid inventory data');
  return rows.map(row=>{
    if(inventory?.[row.group]!==undefined&&(typeof inventory[row.group]!=='object'||inventory[row.group]===null||Array.isArray(inventory[row.group])))throw new Error('Invalid inventory data');
    const owned=inventory?Number(inventory[row.group]?.[row.id]??0):null;
    if(!Number.isFinite(row.need)||row.need<0||owned!==null&&(!Number.isFinite(owned)||owned<0||!Number.isInteger(owned)))throw new Error('Invalid part quantity');
    return {...row,owned,short:owned===null?null:Math.max(0,row.need-owned)};
  });
}
export function missingRows(rows){return rows.filter(row=>row.group!=='screws'&&!row.id.startsWith('screw_')&&row.short>0)}
export function exportRows(rows,missing=false){
  if(missing)return missingRows(rows);
  return rows.flatMap(row=>{
    if(!row.variants?.length||row.variants.reduce((sum,variant)=>sum+variant.need,0)!==row.need)return [row];
    return row.variants.map((variant,index)=>({...row,label:row.label+(variant.label?' · '+variant.label:''),need:variant.need,owned:index===0?row.owned:null,short:index===0?row.short:null}));
  });
}
export function resourceCsv(rows, name, lang, missing=false) {
  const t=key=>resourceText(lang,key),selected=exportRows(rows,missing);
  const records=[[name],[t(missing?'missing':'all')],[t('part'),'ID',t('need'),t('owned'),t('short'),t('optional')],...selected.map(row=>[row.label,row.id,row.need,row.owned??'',row.short??'',row.soft?t('optional'):''])];
  const cell=value=>'"'+String(typeof value==='string'&&/^\s*[=+@-]/.test(value)?"'"+value:value).replace(/"/g,'""')+'"';
  return '\uFEFF'+records.map(record=>record.map(cell).join(',')).join('\r\n')+'\r\n';
}
export function downloadBlob(blob,name){
  const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name.replace(/[\\/:*?"<>|]/g,'_');link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
}
async function listImage(rows,name,lang,missing){
  const selected=exportRows(rows,missing),t=key=>resourceText(lang,key);
  const chunks=[];
  // 分页限制画布高度，长清单仍保持文字和图片清晰。
  for(let start=0;start<selected.length;start+=120){
    const page=selected.slice(start,start+120),canvas=document.createElement('canvas');canvas.width=1200;canvas.height=300+page.length*86;
    await document.fonts.load('600 24px "Noto Sans SC"',name+page.map(row=>row.label).join(''));
    const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Canvas unavailable');
    ctx.fillStyle='#fffaf5';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#ea580c';ctx.fillRect(0,0,1200,8);
    ctx.font='700 34px "Noto Sans SC",sans-serif';ctx.fillStyle='#1f2430';ctx.fillText(t(missing?'missing':'list'),40,65);
    ctx.font='24px "Noto Sans SC",sans-serif';ctx.fillText(name,40,108,1100);
    ctx.font='20px "Noto Sans SC",sans-serif';ctx.fillStyle='#5a6270';ctx.fillText(resourceText(lang,'summary',{k:new Set(selected.map(row=>row.group+':'+row.id)).size,n:selected.reduce((sum,row)=>sum+(missing?row.short:row.need),0)}),40,148);
    [t('need'),t('owned'),t('short')].forEach((label,index)=>ctx.fillText(label,850+index*110,195));
    for(let index=0;index<page.length;index++){
      const row=page[index],y=220+index*86;
      ctx.fillStyle=index%2?'#fff1e6':'#ffffff';ctx.fillRect(30,y,1140,80);
      if(row.image){const img=new Image();img.src=row.image;await img.decode();ctx.drawImage(img,42,y+10,60,60)}
      ctx.font='500 22px "Noto Sans SC",sans-serif';ctx.fillStyle='#1f2430';ctx.fillText(row.label,120,y+33,690);
      ctx.font='18px sans-serif';ctx.fillStyle='#5a6270';ctx.fillText(row.id+(row.soft?' · '+t('optional'):''),120,y+61,690);
      ctx.font='600 24px sans-serif';[row.need,row.owned??'—',row.short??'—'].forEach((n,column)=>ctx.fillText(String(n),860+column*110,y+47));
    }
    ctx.font='18px "Noto Sans SC",sans-serif';ctx.fillStyle='#5a6270';ctx.fillText(t('note'),40,canvas.height-25,1120);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw new Error('PNG encoding failed');chunks.push(blob);
  }
  return chunks;
}
const css=`
.mr{color:#1f2430;font:400 14px/1.55 "Noto Sans SC",sans-serif;min-width:0}.mr *{box-sizing:border-box}.mr [hidden]{display:none!important}.mr h2,.mr h3,.mr p{margin:0}.mr button,.mr select{font:inherit}.mr button{cursor:pointer;min-height:44px;border:1px solid #e7d9cc;border-radius:10px;background:#fff8f1;color:#5a6270;padding:8px 13px;transition:background .18s,color .18s}.mr button:hover{background:#ffebd9;color:#b95009}.mr button:focus-visible,.mr select:focus-visible{outline:1px solid #8a8078;outline-offset:2px}.mr button:disabled{opacity:.5;cursor:default}.mr .mr-primary{background:linear-gradient(110deg,#ea580c,#ff8a2b);color:white;border:0;font-weight:700}.mr-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px}.mr h2{font-size:17px;font-weight:700}.mr-caption{color:#5a6270;font-size:12px}.mr-filters{display:flex;flex-wrap:wrap;gap:7px;margin:12px 0}.mr-filters button[aria-pressed=true]{color:#b95009;background:#fff1e6;border-color:#e0b892}.mr-table{max-height:360px;overflow:auto;border:1px solid #eaded2;border-radius:12px}.mr-row{display:grid;grid-template-columns:minmax(0,1fr) repeat(3,68px);align-items:center;gap:8px;padding:9px 14px;border-bottom:1px solid #f0e6dd}.mr-row:last-child{border:0}.mr-row>span:not(:first-child){text-align:right;font-family:"Space Grotesk",sans-serif}.mr-label{display:flex;gap:10px;align-items:center;min-width:0;overflow-wrap:anywhere}.mr-label img{width:40px;height:40px;object-fit:contain;flex:none}.mr-label small{display:block;color:#5a6270;font-size:11px}.mr-columns{position:sticky;top:0;background:#fff6ed;color:#5a6270;font-size:12px;z-index:1}.mr-short{color:#b45309;font-weight:700}.mr-note{color:#5a6270;font-size:12px;padding:10px 0}.mr-status{min-height:24px;overflow-wrap:anywhere}.mr-status[data-error=true]{color:#b91c1c}.mr-stock{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin:8px 0}.mr-stock a{color:#b95009}.mr-actions{display:flex;flex-wrap:wrap;gap:8px}.mr-downloads{border-top:1px solid #eaded2;margin-top:18px;padding-top:18px}.mr-download-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:14px}.mr-card{border:1px solid #eaded2;border-radius:14px;padding:16px;background:#fffdf9}.mr-card h3{font-size:15px;margin-bottom:4px}.mr-card .mr-actions{margin-top:12px}.mr-card button{flex:1}.mr-card select{width:100%;margin-top:10px;min-height:44px;border:1px solid #e0b892;border-radius:10px;background:white;padding:7px;color:#1f2430}.mr-file-types{margin-top:14px}.mr-file-types summary{cursor:pointer;min-height:44px;display:flex;align-items:center;color:#5a6270}.mr-root-dialog{border:0;border-radius:18px;padding:0;width:min(1040px,calc(100vw - 32px));max-height:calc(100dvh - 32px);background:#fffaf5;color:#1f2430}.mr-root-dialog::backdrop{background:rgb(31 36 48 / 28%);backdrop-filter:blur(3px)}.mr-dialog-header{display:flex;align-items:center;justify-content:space-between;padding:12px 20px;border-bottom:1px solid #eaded2}.mr-dialog-header h2{font-size:17px}.mr-dialog-header button{min-width:44px;min-height:44px;border:0;background:transparent;font-size:24px;cursor:pointer}.mr-root-dialog iframe{width:100%;height:min(740px,calc(100dvh - 125px));border:0;display:block}.mr-dialog-body{padding:20px;overflow:auto;max-height:calc(100dvh - 120px)}@media(max-width:600px){.mr-download-grid{grid-template-columns:1fr}.mr-row{grid-template-columns:minmax(0,1fr) repeat(3,44px);gap:5px;padding:9px}.mr-label{gap:6px}.mr-label img{width:32px;height:32px}.mr-head{align-items:flex-start}.mr-dialog-body{padding:14px}.mr-root-dialog{width:calc(100vw - 24px)}.mr-card{padding:14px}}`;
export function installResourceStyle(){if(document.getElementById('model-resources-style'))return;const style=document.createElement('style');style.id='model-resources-style';style.textContent=css+`
.mr.mr h2{font-size:17px;margin:0}.mr-overview{display:flex;align-items:baseline;gap:8px 20px;flex-wrap:wrap;margin:6px 0 16px}.mr-stock-count{font-size:13px;color:#a34c0b}.mr-toolbar{display:flex;gap:12px;align-items:center;justify-content:space-between;margin:12px 0}.mr-filters{margin:0;gap:0;border-bottom:1px solid #eaded2}.mr-filters button{border:0;border-radius:0;background:transparent;padding:8px 12px;border-bottom:2px solid transparent;min-height:44px}.mr-filters button[aria-pressed=true]{background:transparent;border-color:#ea580c;color:#b95009}.mr-menu{position:relative}.mr-menu>summary{cursor:pointer;min-height:44px;display:flex;align-items:center;gap:8px;color:#5a6270;list-style:none;border-radius:8px;padding:6px 10px}.mr-menu>summary::after{content:'⌄';font-size:13px}.mr-menu[open]>summary{background:#fff1e6;color:#b95009}.mr-menu-content{position:absolute;right:0;top:100%;z-index:3;background:#fffdf9;border:1px solid #eaded2;box-shadow:0 8px 24px #1f243014;border-radius:12px;padding:8px;min-width:180px;display:flex;flex-direction:column;gap:4px}.mr-menu-content button,.mr-menu-content a{display:block;text-align:left;min-height:44px;text-decoration:none;color:#5a6270;padding:10px;border:0;background:transparent;white-space:nowrap}.mr-menu-content p{padding:5px 10px}.mr-head .mr-menu{margin-left:auto}.mr-downloads{margin-top:22px;padding-top:20px}.mr-resource-row{display:flex;align-items:center;gap:16px;justify-content:space-between;padding:16px 0;border-bottom:1px solid #f0e6dd}.mr-resource-row h3{font-size:14px;margin-bottom:3px}.mr-resource-row>div{min-width:0}.mr-resource-row>button{flex:none;min-width:110px}.mr-file-types{margin:0}.mr-file-types summary{font-size:14px}.mr-file-types .mr-actions{padding:0 0 12px}.mr-list-only{padding:14px 0}.mr-list-only select{min-height:44px;padding:8px;border:1px solid #e0b892;border-radius:10px;background:white;max-width:100%}.mr-root-dialog progress{accent-color:#ea580c;width:100%}.mr-progress-dialog{width:min(420px,calc(100vw - 32px));padding:28px;border:0;border-radius:18px;background:#fffaf5;color:#1f2430}.mr-progress-dialog::backdrop{background:#1f243048;backdrop-filter:blur(3px)}.mr-progress-dialog h2{font-size:17px;margin:0 0 12px}.mr-progress-dialog p{font-size:13px;color:#5a6270;margin:8px 0}.mr-progress-dialog progress{width:100%;accent-color:#ea580c;height:8px}.mr-export-progress-host{width:min(480px,calc(100vw - 24px))}.mr-export-progress-host iframe{height:280px}
.mr-table{max-height:none;overflow:visible}.mr-columns{border-radius:12px 12px 0 0}
.mr-root-dialog,.mr-progress-dialog{margin:auto}.mr-progress-dialog progress::-webkit-progress-bar{background:#f0e6dd;border-radius:6px}.mr-progress-dialog progress::-webkit-progress-value{background:linear-gradient(110deg,#ea580c,#ff8a2b);border-radius:6px}
.mr-menu-content .mr-menu-item{border-radius:8px;box-shadow:none}.mr-menu-content .mr-menu-item:hover{background:#fff1e6;color:#b95009;box-shadow:none}
@media(max-width:600px){.mr-toolbar{gap:6px}.mr-filters button{padding:8px}.mr-menu>summary{padding:6px}.mr-resource-row{gap:12px}.mr-resource-row>button{min-width:92px}.mr-overview{gap:6px 12px}.mr-resource-row .mr-caption{max-width:30ch}.mr-row{grid-template-columns:minmax(0,1fr) repeat(3,34px);padding:9px 8px;gap:4px}.mr-label img{width:28px;height:28px}}
  .mr{display:flex;flex-direction:column;gap:14px}.mr-resource-card{min-width:0;border:1px solid #eaded2;border-radius:14px;background:#fffdf9;padding:20px}.mr-card-head{display:flex;align-items:center;gap:14px}.mr-card-icon{width:44px;height:44px;display:grid;place-items:center;flex:none;background:#fff1e6;border-radius:12px;color:#b95009}.mr-card-copy{flex:1;min-width:0}.mr-card-copy h2{margin:0 0 4px!important}.mr-card-summary{display:flex;gap:4px 14px;flex-wrap:wrap}.mr-stock-count{font-size:12px;color:#a34c0b}.mr-card-head>.mr-primary{flex:none;min-width:110px}.mr .mr-expand{display:flex;align-items:center;gap:8px;flex:none;border:0;border-radius:8px;background:transparent;color:#b95009;padding:8px}.mr .mr-expand:hover{background:#fff1e6}.mr-toolbar{margin:18px 0 12px}.mr-table{max-height:none;overflow:visible}.mr-columns{position:static}.mr-label img{width:44px;height:44px}.mr-row{min-height:64px}.mr-inline-progress{margin-top:20px;padding-top:18px;border-top:1px solid #f0e6dd}.mr-inline-progress>p{font-size:13px;color:#5a6270;margin-bottom:10px}.mr-inline-progress progress{display:block;width:100%;height:7px;accent-color:#ea580c;border:0;border-radius:8px;overflow:hidden}.mr-inline-progress progress::-webkit-progress-bar{background:#f0e6dd;border-radius:8px}.mr-inline-progress progress::-webkit-progress-value{background:linear-gradient(110deg,#ea580c,#ff8a2b);border-radius:8px}.mr-progress-footer{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-top:12px}.mr-progress-footer button{flex:none;color:#5a6270}.mr-manual-status{font-size:13px;color:#13763e;padding-top:12px}.mr-manual-status[data-error=true]{color:#b91c1c}.mr-source{text-align:right}.mr-status{font-size:13px;min-height:0}.mr [data-mr-downloads]:focus{outline:none}.mr [data-mr-downloads]:focus-visible{outline:1px solid #8a8078;outline-offset:2px}
  @media(max-width:600px){.mr-resource-card{padding:14px}.mr-card-head{gap:10px;flex-wrap:wrap}.mr-card-icon{width:36px;height:36px;border-radius:10px}.mr-card-copy{flex-basis:calc(100% - 46px)}.mr-card-head>.mr-primary,.mr-card-head>.mr-expand{margin-left:46px}.mr-card-head>.mr-primary{min-width:110px}.mr-label img{width:32px;height:32px}.mr-label{font-size:12px}.mr-row{min-height:58px}.mr-toolbar{flex-wrap:wrap;gap:4px}.mr-menu{margin-left:auto}.mr-progress-footer{align-items:flex-start}.mr-source{text-align:left}}
  `;document.head.append(style)}
export function mountResources(root,config){
  installResourceStyle();const t=(key,values)=>resourceText(config.lang,key,values),controller=new AbortController();let state=config,filter='all',busy=false,manualBusy=false,expanded=false,cancelRequested=false,lastRows,lastStock,lastFilter;
  const button=(action,label,disabled=false)=>'<button type="button" class="xmf-button xmf-button-secondary" data-mr-action="'+action+'"'+(disabled?' disabled':'')+'>'+esc(t(label))+'</button>';
  root.classList.add('mr');
  const listMenu='<details class="mr-menu mr-list-menu"><summary>'+esc(t('exportList'))+'</summary><div class="mr-menu-content"><p class="mr-caption" data-mr-list-label></p>'+button('csv','csv')+button('png','png')+button('copy','copy')+'</div></details>';
  const icon=kind=>'<span class="mr-card-icon" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">'+(kind==='list'?'<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>':'<path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5"/>')+'</svg></span>';
  root.innerHTML='<section class="mr-resource-card"><div class="mr-card-head">'+icon('list')+'<div class="mr-card-copy"><h2>'+esc(t('title'))+'</h2><div class="mr-card-summary"><p class="mr-caption" data-mr-summary></p><p class="mr-stock-count" data-mr-stock></p></div></div><button type="button" class="mr-expand" data-mr-expand aria-expanded="false">'+esc(t('viewList'))+'<span aria-hidden="true">⌄</span></button></div><div data-mr-list hidden><div class="mr-toolbar"><div class="mr-filters" role="group" aria-label="'+esc(t('list'))+'">'+['all','missing'].map(id=>'<button type="button" data-mr-filter="'+id+'" aria-pressed="'+(id==='all')+'">'+esc(t(id))+'</button>').join('')+'</div>'+listMenu+'</div><div class="mr-table" data-mr-table></div><p class="mr-note">'+esc(t('note'))+'</p></div></section>'+
    '<section class="mr-resource-card" data-mr-downloads tabindex="-1"><div class="mr-card-head">'+icon('manual')+'<div class="mr-card-copy"><h2>'+esc(t('manual'))+'</h2><p class="mr-caption">'+esc(t('manualHint'))+' · PDF</p></div>'+button('manual','exportPdf',!config.canNative)+'</div><div class="mr-inline-progress" data-mr-progress hidden><p role="status" aria-live="polite" data-mr-progress-label></p><progress aria-label="'+esc(t('manual'))+'"></progress><div class="mr-progress-footer"><p class="mr-caption">'+esc(t('downloadHint'))+'</p>'+button('cancel','cancel')+'</div></div><p class="mr-manual-status" role="status" hidden></p>'+(!config.canNative?'<p class="mr-note">'+esc(t(config.stockState==='anonymous'?'manualLogin':'unavailable'))+'</p>':'')+'</section><p class="mr-source mr-caption">'+esc(t(config.source||'saved'))+'</p><p class="mr-status" role="status" aria-live="polite" hidden></p>';
  const manualButton=root.querySelector('[data-mr-action=manual]');manualButton.classList.remove('xmf-button-secondary');manualButton.classList.add('mr-primary');
  root.querySelectorAll('.mr-menu button').forEach(button=>{button.className='mr-menu-item'});
  root.querySelectorAll('.mr-menu,.mr-filters,.mr-expand').forEach(group=>{group.dataset.buttonMotion='off'});
  const status=root.querySelector('.mr-status'),manualStatus=root.querySelector('.mr-manual-status');
  function paint(){
    const rows=state.rows,missing=missingRows(rows),available=state.stockState==='ready';
    if(!available)filter='all';
    root.querySelector('[data-mr-list-label]').textContent=t(filter==='missing'?'missing':'all');
    if(lastRows!==rows||lastStock!==state.stockState||lastFilter!==filter){
      root.querySelector('[data-mr-summary]').textContent=t('summary',{k:rows.length,n:rows.reduce((sum,row)=>sum+row.need,0)});
      const requiredMissing=missing.filter(row=>!row.soft);
      root.querySelector('[data-mr-stock]').textContent=!rows.length?t('empty'):available?(requiredMissing.length?t('shortage',{k:requiredMissing.length,n:requiredMissing.reduce((sum,row)=>sum+row.short,0)}):t('enough')):t(state.stockState==='loading'?'loading':state.stockState==='error'?'stockFailed':state.stockState==='anonymous'?'login':'unchecked');
      const shown=filter==='missing'?missing:rows,table=root.querySelector('[data-mr-table]');
      table.innerHTML='<div class="mr-row mr-columns"><span>'+esc(t('part'))+'</span><span>'+esc(t('need'))+'</span><span>'+esc(t('owned'))+'</span><span>'+esc(t('short'))+'</span></div>'+shown.map(row=>'<div class="mr-row" data-part-id="'+esc(row.id)+'"><span class="mr-label">'+(row.image?'<img src="'+esc(row.image)+'" alt="" loading="lazy">':'')+'<span>'+esc(row.label)+(row.soft?'<small>'+esc(t('optional'))+'</small>':'')+'</span></span><span>'+row.need+'</span><span>'+(available&&row.group!=='screws'?row.owned??'—':'—')+'</span><span class="'+(row.short>0?'mr-short':'')+'">'+(available&&row.group!=='screws'?row.short??'—':'—')+'</span></div>').join('')+(!shown.length?'<p class="mr-note">'+esc(t('empty'))+'</p>':'');
      lastRows=rows;lastStock=state.stockState;lastFilter=filter;
    }
    root.querySelectorAll('[data-mr-filter]').forEach(el=>{el.disabled=busy||el.dataset.mrFilter==='missing'&&!available;el.setAttribute('aria-pressed',String(el.dataset.mrFilter===filter))});
    root.querySelector('[data-mr-action=copy]').disabled=busy||!available||!missing.length;
    for(const action of ['csv','png'])root.querySelector('[data-mr-action='+action+']').disabled=busy||!rows.length||(filter==='missing'&&!missing.length);
    manualButton.disabled=busy||!config.canNative;
    manualButton.setAttribute('aria-busy',String(manualBusy));
    const progress=state.manualProgress,showProgress=manualBusy||!!progress,area=root.querySelector('[data-mr-progress]');area.hidden=!showProgress;
    if(showProgress){
      const phase=progress?.phase||'resources',total=progress?.total||0,page=progress?.page||0;
      root.querySelector('[data-mr-progress-label]').textContent=t(phase==='cancelling'?'cancelling':phase==='save'?'saving':total>0?'page':phase==='prepare'?'prepare':'resources',{k:Math.min(page+1,total),n:total});
      const bar=area.querySelector('progress');bar.max=total||1;if(total>0)bar.value=page;else bar.removeAttribute('value');
      root.querySelector('[data-mr-action=cancel]').disabled=phase==='cancelling'||phase==='save';
    }
  }
  root.addEventListener('click',async event=>{
    const menu=event.target.closest('details.mr-menu');root.querySelectorAll('details.mr-menu[open]').forEach(other=>{if(other!==menu)other.open=false});
    const expand=event.target.closest('[data-mr-expand]');if(expand){expanded=!expanded;root.querySelector('[data-mr-list]').hidden=!expanded;expand.setAttribute('aria-expanded',String(expanded));expand.innerHTML=esc(t(expanded?'hideList':'viewList'))+'<span aria-hidden="true">'+(expanded?'⌃':'⌄')+'</span>';return}
    if(event.target.closest('[data-mr-action=cancel]')){if(root.querySelector('[data-mr-action=cancel]').disabled)return;cancelRequested=true;state={...state,manualProgress:{...state.manualProgress,phase:'cancelling'}};paint();config.onCancel?.();return}
    const pick=event.target.closest('[data-mr-filter]');if(pick){if(busy||pick.disabled)return;filter=pick.dataset.mrFilter;paint();return}
    const target=event.target.closest('[data-mr-action]');if(!target||target.disabled||busy)return;
    const action=target.dataset.mrAction;
    busy=true;cancelRequested=false;manualBusy=action==='manual';const feedback=manualBusy?manualStatus:status;feedback.dataset.error='false';feedback.textContent=manualBusy?'':t('working');feedback.hidden=manualBusy;paint();
    if(manualBusy)root.querySelector('[data-mr-downloads]').scrollIntoView({block:'nearest'});
    try{
      const missing=filter==='missing',rows=state.rows;
      if(config.validate)await config.validate();
      if(controller.signal.aborted)return;
      if(cancelRequested){feedback.textContent=t('cancelled');feedback.hidden=false;return}
      if(action==='csv')downloadBlob(new Blob([resourceCsv(rows,config.name,config.lang,missing)],{type:'text/csv;charset=utf-8'}),config.name+' '+t(missing?'missing':'list')+'.csv');
      else if(action==='png'){const images=await listImage(rows,config.name,config.lang,missing);if(controller.signal.aborted)return;images.forEach((blob,index)=>downloadBlob(blob,config.name+' '+t(missing?'missing':'list')+(images.length>1?' '+(index+1):'')+'.png'))}
      else if(action==='copy'){await navigator.clipboard.writeText([config.name,...missingRows(rows).map(row=>row.label+' ('+row.id+') ×'+row.short+(row.soft?' · '+t('optional'):''))].join('\n'))}
      else {const result=await config.onExport(action);if(result?.cancelled)feedback.textContent=t('cancelled')}
      if(!controller.signal.aborted){if(!feedback.textContent||action!=='manual')feedback.textContent=action==='copy'?t('copied'):t('done');feedback.hidden=false;root.querySelectorAll('details.mr-menu').forEach(menu=>menu.open=false)}
    }catch(error){if(!controller.signal.aborted){feedback.dataset.error=String(!cancelRequested);feedback.textContent=cancelRequested?t('cancelled'):error.message||t('failed');feedback.hidden=false}}
    finally{busy=false;manualBusy=false;state={...state,manualProgress:null};if(!controller.signal.aborted)paint()}
  },{signal:controller.signal});
  root.addEventListener('keydown',event=>{if(event.key==='Escape'){const open=[...root.querySelectorAll('details.mr-menu[open]')];if(open.length){event.preventDefault();event.stopPropagation();open.forEach(menu=>{menu.open=false;menu.querySelector('summary').focus()})}}},{signal:controller.signal});
  document.addEventListener('click',event=>{if(!root.contains(event.target))root.querySelectorAll('details.mr-menu[open]').forEach(menu=>menu.open=false)},{signal:controller.signal});
  paint();
  return {destroy(){controller.abort();root.replaceChildren()},update(next){state={...state,...next};paint()}};
}
