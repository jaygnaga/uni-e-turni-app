/* Uni & Turni /private -- secure account and per-user cloud calendar.
   Public publishable key only. Supabase RLS enforces ownership. */
(function(){
'use strict';
const API='https://vmudhnkcnjheynexejgt.supabase.co';
const KEY='sb_publishable_utxwNtSayIHwWKskQFDBFw_daV1jYBY';
const AUTH_KEY='uni-turni-auth-session-v1';
const userCacheKey=(id)=>'uni-turni-private-data-'+id;
const pendingKey=(id)=>'uni-turni-private-pending-'+id;
let session=null, user=null, revision=0, dirty=false, uploading=false, conflict=false, syncTimer=null, signingIn=false;
const originalSave=save;
const ui=document.createElement('div');
ui.id='ut-privacy-gate';
ui.innerHTML='<div class="ut-auth-card"><div class="ut-auth-logo">✦ Uni & Turni</div><h2 id="ut-auth-title">Il tuo calendario privato</h2><p id="ut-auth-instruction">Accedi per sincronizzare turni, presenze ed esami fra i tuoi dispositivi.</p><form id="ut-login"><label>Email<input type="email" name="email" autocomplete="email" required></label><label>Password<input type="password" name="password" autocomplete="current-password" minlength="6" required></label><button type="submit">Accedi</button></form><div class="ut-auth-buttons"><button type="button" id="ut-signup">Crea account</button></div><p id="ut-auth-message" role="status" aria-live="polite"></p><p class="ut-auth-small">I dati sono accessibili solo al tuo account. La versione precedente rimane disponibile all’indirizzo principale.</p></div>';
const css=document.createElement('style');
css.textContent='#ut-privacy-gate{position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;background:#edf2fa;padding:14px;font-family:Inter,system-ui,sans-serif;color:#182945}#ut-privacy-gate[hidden]{display:none!important}.ut-auth-card{width:min(440px,100%);background:#fff;border:1px solid #dce3ee;border-radius:20px;padding:28px;box-shadow:0 20px 65px #213c632a}.ut-auth-logo{font-size:22px;font-weight:850;color:#3e5dd1;margin-bottom:18px}.ut-auth-card h2{font-size:19px;margin:0 0 8px}.ut-auth-card p{font-size:13px;line-height:1.5;color:#576681;margin:0 0 16px}.ut-auth-card label{display:block;font-size:12px;font-weight:700;margin:12px 0}.ut-auth-card input{display:block;width:100%;border:1px solid #bfcce0;border-radius:9px;padding:10px;margin-top:5px}.ut-auth-card button{background:#425ede;color:#fff;border:none;border-radius:10px;padding:11px 15px;font-weight:700;cursor:pointer}.ut-auth-card button:disabled{opacity:.5}.ut-auth-buttons{display:flex;gap:10px;margin-top:12px}.ut-auth-buttons button{background:#e9eefb;color:#334c9b}.ut-auth-card #ut-auth-message{color:#223e72;font-weight:650;margin-top:14px}.ut-auth-card .ut-auth-small{font-size:11px;color:#68788e;margin-top:20px}body.ut-locked .app{visibility:hidden}#ut-sync-bar{position:fixed;right:14px;bottom:14px;background:#21385c;color:white;padding:9px 12px;border-radius:12px;z-index:700;box-shadow:0 10px 30px #21385c35;display:flex;gap:9px;align-items:center;max-width:calc(100vw - 25px);font-size:12px}#ut-sync-bar button{color:#fff;background:#45649c;border:0;border-radius:7px;padding:5px 9px;font-size:12px;cursor:pointer}#ut-sync-status{max-width:220px}';
document.head.appendChild(css);document.body.appendChild(ui);document.body.classList.add('ut-locked');
const bar=document.createElement('div');bar.id='ut-sync-bar';bar.hidden=true;
bar.innerHTML='<span id="ut-sync-status" role="status">Non connesso</span><button type="button" id="ut-sync-now">Sincronizza</button><button type="button" id="ut-logout">Esci</button>';
document.body.appendChild(bar);
const msg=(t)=>{document.getElementById('ut-auth-message').textContent=t};
const status=(t)=>{document.getElementById('ut-sync-status').textContent=t};
function saveSession(){if(session)localStorage.setItem(AUTH_KEY,JSON.stringify(session));else localStorage.removeItem(AUTH_KEY);}
async function req(url,method='GET',body=null,token=null,prefer=null){
 const h={'apikey':KEY,'Content-Type':'application/json'};
 if(token)h.Authorization='Bearer '+token;
 if(prefer)h.Prefer=prefer;
 const response=await fetch(API+url,{method,headers:h,body:body==null?undefined:JSON.stringify(body),cache:'no-store'});
 let payload=null;try{payload=await response.json()}catch(e){}
 if(!response.ok){const er=new Error((payload&& (payload.msg||payload.message||payload.error_description||payload.error))||'Errore '+response.status);er.status=response.status;throw er;}
 return payload;
}
async function token(){
 if(!session||!session.access_token)throw new Error('Sessione scaduta, accedi di nuovo');
 if(Date.now()<Number(session.expires_at||0)-60000)return session.access_token;
 const refreshed=await req('/auth/v1/token?grant_type=refresh_token','POST',{refresh_token:session.refresh_token});
 if(!refreshed.access_token||!refreshed.user?.id)throw new Error('Impossibile rinnovare la sessione');
 session={...refreshed,expires_at:Date.now()+refreshed.expires_in*1000};
 user=refreshed.user;saveSession();return session.access_token;
}
async function db(path,method='GET',body=null,prefer=null){
 let t=await token();
 try{return await req('/rest/v1/private_calendars'+path,method,body,t,prefer)}
 catch(err){if(err.status===401){session.expires_at=0;t=await token();return req('/rest/v1/private_calendars'+path,method,body,t,prefer)}throw err}
}
function normalizeState(incoming){
 const base=DEFAULT_STATE();const d=(incoming && typeof incoming==='object'&&!Array.isArray(incoming))?incoming:{};
 const out=Object.assign(base,d);
 for(const k of ['patches','shifts','attendance','filters']){
  if(!out[k]||typeof out[k]!=='object'||Array.isArray(out[k]))out[k]=base[k];
 }
 if(!Array.isArray(out.customEvents))out.customEvents=[];
 if(!Array.isArray(out.deletedIds))out.deletedIds=[];
 return out;
}
function cacheState(){
 const body=JSON.stringify(data),key=userCacheKey(user.id);
 localStorage.setItem(key,body);if(localStorage.getItem(key)!==body)throw new Error('Il browser non ha conservato la modifica');
}
function setPending(yes,rev){
 const key=pendingKey(user.id);
 if(yes)localStorage.setItem(key,JSON.stringify({base_revision:rev==null?revision:rev}));
 else localStorage.removeItem(key);
}
function hideGate(){document.body.classList.remove('ut-locked');ui.hidden=true;bar.hidden=false;}
function showGate(){document.body.classList.add('ut-locked');ui.hidden=false;bar.hidden=true;status('Non connesso')}
async function readCloud(){
 const rows=await db('?user_id=eq.'+encodeURIComponent(user.id)+'&select=document,revision');
 return Array.isArray(rows)&&rows.length?rows[0]:null;
}
async function writeCloud(){
 if(!user||uploading||!dirty||conflict)return;
 uploading=true;
 status('Sincronizzazione...');
 const snapshot=JSON.stringify(data),baseRevision=revision;
 try {
  const rows=await db('?user_id=eq.'+encodeURIComponent(user.id)+'&revision=eq.'+baseRevision,
   'PATCH',{document:JSON.parse(snapshot),revision:baseRevision+1,updated_at:new Date().toISOString()},'return=representation');
  if(!Array.isArray(rows)||rows.length!==1){
   conflict=true;status('Conflitto: esporta backup prima di scegliere');
   alert('Il calendario è cambiato su un altro dispositivo. Le modifiche locali sono conservate in questo browser. Esporta un backup JSON prima di ricaricare: non verrà sovrascritto nulla automaticamente.');
   return;
  }
  revision=rows[0].revision;
  dirty=JSON.stringify(data)!==snapshot;
  if(!dirty)setPending(false);
  else setPending(true,revision);
  status(dirty?'Nuove modifiche in sincronizzazione':'✓ Sincronizzato sul cloud');
 }catch(e){
  status('Offline o errore cloud: dati conservati qui');
  console.error('Uni & Turni sync:',e);
 }finally{uploading=false;if(dirty&&!conflict&&navigator.onLine){clearTimeout(syncTimer);syncTimer=setTimeout(writeCloud,7000)}}
}
function queueCloud(){
 clearTimeout(syncTimer);
 syncTimer=setTimeout(writeCloud,500);
}
save=function(){
 if(!user){notify('Accedi per salvare sul tuo calendario privato');return false;}
 try{
  cacheState();
  if(!dirty)setPending(true,revision);
  dirty=true;
  status('Salvato sul dispositivo · sincronizzazione in corso');
  queueCloud();
  return true;
 }catch(e){console.error(e);notify('Salvataggio locale non riuscito. Non chiudere la pagina.');return false;}
};
async function cloudRefresh(){
 if(!user||dirty||uploading||conflict)return;
 try{
  const row=await readCloud();
  if(row&&row.revision>revision){
   data=normalizeState(row.document);
   revision=row.revision;
   cacheState();render();status('✓ Dati aggiornati da un altro dispositivo');
  }
 }catch(e){status('Connessione non disponibile')}
}
async function startUser(s){
 session=s;user=s.user;saveSession();status('Caricamento dati...');
 try{
  const remote=await readCloud();
  const pending=localStorage.getItem(pendingKey(user.id));
  let local=null;
  try{local=JSON.parse(localStorage.getItem(userCacheKey(user.id))||'null')}catch(e){}
  if(remote){
   revision=remote.revision;
   if(pending&&local){
    let info={};try{info=JSON.parse(pending)}catch(e){}
    if(info.base_revision!==revision){
     conflict=true;data=normalizeState(local);dirty=true;
     status('Conflitto: backup locale necessario');
    }else{
     data=normalizeState(local);dirty=true;
     status('Ripristino modifiche non sincronizzate');
     queueCloud();
    }
   }else{data=normalizeState(remote.document);cacheState();status('✓ Sincronizzato sul cloud')}
  }else{
   revision=1;
   data=DEFAULT_STATE();
   const inserted=await db('','POST',{user_id:user.id,document:data,revision:1},'return=representation');
   if(!Array.isArray(inserted)||inserted.length!==1)throw new Error('Impossibile inizializzare il calendario');
   cacheState();status('✓ Calendario privato creato');
  }
  hideGate();render();
  if(conflict)alert('Ci sono modifiche locali e online differenti. Esporta un backup prima di sincronizzare. Nessun dato è stato cancellato.');
 }catch(e){
  console.error(e);msg('Non riesco ad aprire il calendario privato: '+e.message);
  session=null;user=null;showGate();
 }
}
const form=document.getElementById('ut-login');
form.addEventListener('submit',async(e)=>{
 e.preventDefault();if(signingIn)return;signingIn=true;
 const button=form.querySelector('button[type=submit]');button.disabled=true;msg('Accesso in corso...');
 const f=new FormData(form),email=String(f.get('email')||'').trim(),password=String(f.get('password')||'');
 try{
  const v=await req('/auth/v1/token?grant_type=password','POST',{email,password});
  if(!v.access_token||!v.user?.id)throw new Error('Sessione non valida');
  v.expires_at=Date.now()+Number(v.expires_in||3600)*1000;
  await startUser(v);
 }catch(err){msg('Accesso non riuscito: '+err.message)}
 finally{button.disabled=false;signingIn=false}
});
document.getElementById('ut-signup').addEventListener('click',async()=>{
 if(signingIn)return;
 const f=new FormData(form),email=String(f.get('email')||'').trim(),password=String(f.get('password')||'');
 if(!email||password.length<6){msg('Inserisci email e password di almeno 6 caratteri.');return;}
 signingIn=true;msg('Creazione account...');
 try{
  const result=await req('/auth/v1/signup','POST',{email,password});
  if(result.access_token&&result.user){
   result.expires_at=Date.now()+Number(result.expires_in||3600)*1000;
   await startUser(result);
  }else{msg('Account richiesto. Controlla l’email di verifica (anche spam), confermala e poi torna qui per accedere.');}
 }catch(e){msg('Registrazione non riuscita: '+e.message)}
 finally{signingIn=false}
});
document.getElementById('ut-logout').addEventListener('click',async()=>{
 if(dirty&&!confirm('Ci sono modifiche non sincronizzate. Esporta un backup JSON prima di uscire. Vuoi comunque uscire?'))return;
 const prevUser=user,prevSession=session;session=null;user=null;revision=0;dirty=false;conflict=false;
 clearTimeout(syncTimer);try{if(prevSession){await req('/auth/v1/logout','POST',{},prevSession.access_token)}}catch(e){}
 if(prevUser){localStorage.removeItem(userCacheKey(prevUser.id));localStorage.removeItem(pendingKey(prevUser.id));}
 saveSession();data=DEFAULT_STATE();showGate();render();msg('Sei uscito dal tuo account.');
});
document.getElementById('ut-sync-now').addEventListener('click',()=>{
 if(conflict){alert('Non sincronizzo automaticamente per evitare di sovrascrivere modifiche. Esporta un backup e poi contatta il supporto per risolvere il conflitto.');return;}
 if(dirty)writeCloud();else cloudRefresh();
});
window.addEventListener('focus',cloudRefresh);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)cloudRefresh()});
window.addEventListener('online',()=>{if(dirty)writeCloud();else cloudRefresh()});
async function boot(){
 try{
  // Confirmation emails may redirect back with a short-lived session in the URL.
  const fragment=new URLSearchParams(location.hash.startsWith('#')?location.hash.slice(1):'');
  if(fragment.get('error_description')||fragment.get('error')){
   msg('Conferma email non riuscita: '+(fragment.get('error_description')||fragment.get('error')));
   history.replaceState(null,'',location.pathname+location.search);
  }
  if(fragment.get('access_token')&&fragment.get('refresh_token')){
   const access_token=fragment.get('access_token'),refresh_token=fragment.get('refresh_token');
   history.replaceState(null,'',location.pathname+location.search);
   const account=await req('/auth/v1/user','GET',null,access_token);
   if(!account?.id)throw new Error('Impossibile verificare la sessione');
   await startUser({access_token,refresh_token,user:account,expires_at:Date.now()+(Number(fragment.get('expires_in'))||3600)*1000});
   return;
  }
  const persisted=JSON.parse(localStorage.getItem(AUTH_KEY)||'null');
  if(persisted?.access_token&&persisted?.refresh_token&&persisted?.user?.id){
   await startUser(persisted);
  }else{showGate();}
 }catch(e){session=null;user=null;localStorage.removeItem(AUTH_KEY);showGate();}
}
boot();
})();
