export class SharingCancelled extends Error {}
export async function chooseSharing(hasRoom: boolean, lang: string): Promise<{ allowImport: boolean; attachRoom: boolean }> {
  const i=lang.startsWith('de')?2:lang.startsWith('en')?1:0
  const text={title:['分享造型','Share model','Modell teilen'],hint:['会保存独立分享快照并占用一份分享容量。关闭链接后仍占用容量。','This creates an independent sharing snapshot and uses one unit of sharing capacity. Closing the link keeps that capacity in use.','Ein unabhängiger Schnappschuss belegt eine Einheit Freigabekapazität. Auch nach Schließen des Links bleibt diese Kapazität belegt.'],allow:['允许接收者导入','Allow recipients to import','Import für Empfänger erlauben'],room:['附带房间快照','Attach room snapshot','Raumschnappschuss beifügen'],cancel:['取消','Cancel','Abbrechen'],ok:['创建或替换分享快照','Create or replace sharing snapshot','Freigabeschnappschuss erstellen oder ersetzen']}
  const dialog=document.createElement('dialog');dialog.className='qb-dialog qb-share-options'
  const heading=document.createElement('h2');heading.textContent=text.title[i]
  const hint=document.createElement('p');hint.textContent=text.hint[i]
  const form=document.createElement('form');form.append(heading,hint)
  function choice(name:string,label:string,disabled=false){const line=document.createElement('label');const input=document.createElement('input');input.type='checkbox';input.name=name;input.disabled=disabled;line.append(input,document.createTextNode(label));form.append(line);return input}
  const allow=choice('allow',text.allow[i]),room=choice('room',text.room[i],!hasRoom)
  const footer=document.createElement('footer'),cancel=document.createElement('button'),ok=document.createElement('button');cancel.type='button';cancel.className='qb-btn';cancel.textContent=text.cancel[i];ok.type='submit';ok.className='qb-btn qb-btn-primary';ok.textContent=text.ok[i];footer.append(cancel,ok);form.append(footer);dialog.append(form);document.body.append(dialog)
  return new Promise((resolve,reject)=>{const previous=document.activeElement;function close(){dialog.close();dialog.remove();if(previous instanceof HTMLElement)previous.focus()};cancel.onclick=()=>{close();reject(new SharingCancelled())};dialog.oncancel=event=>{event.preventDefault();close();reject(new SharingCancelled())};form.onsubmit=event=>{event.preventDefault();const result={allowImport:allow.checked,attachRoom:room.checked&&!room.disabled};close();resolve(result)};dialog.showModal();cancel.focus()})
}
