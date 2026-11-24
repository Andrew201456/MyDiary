/* MyDiary cloud vault: encryption/decryption happens exclusively in-browser.
 * Server receives a PBKDF2-authenticated request and only AES-GCM ciphertext.
 * The cryptographic key and password never go into localStorage.
 */
const enc=new TextEncoder(),dec=new TextDecoder();
const pack=bytes=>btoa(String.fromCharCode(...bytes)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
const unpack=value=>{
  const raw=atob(value.replace(/-/g,"+").replace(/_/g,"/"));
  return Uint8Array.from(raw,c=>c.charCodeAt(0));
};
async function derive(password,salt){
  const material=await crypto.subtle.importKey("raw",enc.encode(password),"PBKDF2",false,["deriveKey"]);
  return crypto.subtle.deriveKey(
    {name:"PBKDF2",salt:enc.encode(salt),iterations:210000,hash:"SHA-256"},
    material,{name:"AES-GCM",length:256},false,["encrypt","decrypt"]
  );
}
async function encrypt(key,value){
  const nonce=crypto.getRandomValues(new Uint8Array(12));
  const cipher=new Uint8Array(await crypto.subtle.encrypt(
    {name:"AES-GCM",iv:nonce},key,enc.encode(JSON.stringify(value))));
  const bytes=new Uint8Array(nonce.length+cipher.length);
  bytes.set(nonce);bytes.set(cipher,nonce.length);
  return pack(bytes);
}
async function decrypt(key,content){
  const bytes=unpack(content);
  if(bytes.length<29)throw Error("Το κρυπτογραφημένο αρχείο δεν είναι έγκυρο.");
  const plaintext=await crypto.subtle.decrypt(
    {name:"AES-GCM",iv:bytes.subarray(0,12)},
    key,bytes.subarray(12)
  );
  const result=JSON.parse(dec.decode(plaintext));
  if(!result||typeof result!=="object"||Array.isArray(result)||!result.days||
     typeof result.days!=="object"||Array.isArray(result.days))
    throw Error("Το cloud αρχείο δεν είναι έγκυρο.");
  return result;
}
async function api(path,method="GET",payload,token){
  const request={method,cache:"no-store",headers:{"Accept":"application/json"}};
  if(payload!==undefined){
    request.headers["Content-Type"]="application/json";
    request.body=JSON.stringify(payload);
  }
  if(token)request.headers.Authorization="Bearer "+token;
  const response=await fetch("/api/"+path,request);
  const data=await response.json().catch(()=>({}));
  if(!response.ok){
    const error=new Error(data.error||"Cloudflare: "+response.status);
    error.status=response.status;error.conflict=!!data.conflict;
    throw error;
  }
  return data;
}
export function createCloud({readState,applyState,loadLegacy,onStatus,onReady,canRefresh=()=>true}){
  let token=null,key=null,user="",revision=0,locked=true,uploading=false;
  let pending=null,halted=false,scheduled=null,cacheWarning="";
  const gate=document.getElementById("cloudLogin");
  const notice=document.getElementById("cloudMessage");
  const setStatus=(message,type="info")=>{
    onStatus?.(message,type);
    if(notice&&!gate.hidden)notice.textContent=message;
  };
  const handleRemote=async()=>{
    const remote=await api("vault","GET",undefined,token);
    revision=remote.revision;
    const cached=localStorage.getItem(cacheKey());
    if(cached){
      try{
        const item=JSON.parse(cached);
        const backup=await decrypt(key,item.ciphertext);
        if(item.revision===revision){
          // Upload was interrupted before a confirmed server response.
          // Continue from this encrypted, locally retained snapshot.
          applyState(backup);
          pending=backup;
          setStatus("Ανακτήθηκαν εκκρεμείς αλλαγές. Συγχρονισμός…");
          return;
        }
        // Another device advanced the cloud revision; never overwrite it.
        cacheWarning="Υπάρχει διαφορετικό εκκρεμές αντίγραφο στη συσκευή. Εξήγαγέ το από τις Ρυθμίσεις.";
        setStatus(cacheWarning,"error");
      }catch(error){
        setStatus("Δεν διαβάστηκε το εκκρεμές κρυπτογραφημένο αντίγραφο.","error");
      }
    }
    if(remote.ciphertext){
      const result=await decrypt(key,remote.ciphertext);
      applyState(result);
      // An old plaintext local diary is never auto-applied over a cloud
      // snapshot. The user can explicitly import their JSON backup.
      if(localStorage.getItem("mydiary-local-v1"))
        setStatus("Βρέθηκαν και παλαιότερα τοπικά δεδομένα. Κατέβασε αντίγραφο πριν τα διαγράψεις.");
    }else{
      const old=loadLegacy();
      applyState(old);
      pending=old;
    }
  };
  async function enter(name,password){
    const result=await api("login","POST",{username:name,password});
    const derived=await derive(password,result.vaultSalt);
    token=result.token;key=derived;user=result.username;locked=true;
    try{await handleRemote()}
    catch(error){
      token=null;key=null;user="";throw error;
    }
    gate.hidden=true;document.body.classList.remove("cloud-locked");
    locked=false;
    onReady?.(user);
    if(pending)queueSave(pending);
    if(cacheWarning)setStatus(cacheWarning,"error");
    else setStatus("Cloud ενεργό • "+user,"ok");
  }
  async function submit(event){
    event.preventDefault();
    const name=document.getElementById("cloudUsername").value.trim();
    const pass=document.getElementById("cloudPassword").value;
    const button=document.getElementById("cloudSubmit");
    const mode=document.getElementById("cloudMode").value;
    if(!name||!pass){setStatus("Συμπλήρωσε username και password.");return}
    button.disabled=true;setStatus("Σύνδεση με Cloudflare…");
    try{
      if(mode==="register"){
        if(pass.length<12)throw Error("Το password πρέπει να έχει τουλάχιστον 12 χαρακτήρες.");
        const signupCode=document.getElementById("cloudSignupCode").value;
        await api("register","POST",{username:name,password:pass,signupCode});
      }
      await enter(name,pass);
      document.getElementById("cloudPassword").value="";
      document.getElementById("cloudSignupCode").value="";
    }catch(error){setStatus(error.message||"Σφάλμα σύνδεσης.");}
    finally{button.disabled=false}
  }
  const cacheKey=()=>user?"mydiary-vault-cache-"+user:"";
  async function flush(){
    if(locked||!pending||uploading||halted)return;
    uploading=true;
    const snapshot=pending;
    pending=null;
    try{
      setStatus("Συγχρονισμός στο Cloudflare…");
      const ciphertext=await encrypt(key,snapshot);
      // Only the encrypted blob is kept as a temporary local offline copy.
      try{localStorage.setItem(cacheKey(),JSON.stringify({ciphertext,revision}));}catch{}
      const updated=await api("vault","PUT",{revision,ciphertext},token);
      revision=updated.revision;
      if(!pending){
        try{
          localStorage.removeItem(cacheKey());
          // Remove plaintext backup only AFTER verified cloud persistence.
          localStorage.removeItem("mydiary-local-v1");
        }catch{}
      }
      if(!pending)setStatus("Αποθηκεύτηκε στο Cloudflare ✓","ok");
    }catch(error){
      if(!pending)pending=snapshot;
      if(error.conflict){
        halted=true;
        setStatus("ΣΥΓΚΡΟΥΣΗ: άλλη συσκευή άλλαξε το ιστορικό. Δεν αντικατέστησα τα cloud δεδομένα. Κάνε εξαγωγή του τρέχοντος ημερολογίου και σύνδεση ξανά.","error");
      }else if(error.status===401){
        halted=true;setStatus("Η cloud συνεδρία έληξε. Κάνε εξαγωγή και ξανασυνδέσου.","error");
      }else{
        setStatus("Εκκρεμεί συγχρονισμός — "+(error.message||"έλεγχος σύνδεσης"),"error");
      }
    }finally{
      uploading=false;
      if(pending&&!halted&&!scheduled){
        scheduled=setTimeout(()=>{scheduled=null;flush()},7000);
      }else if(pending&&!halted){
        // Existing retry is already scheduled.
      }
    }
  }
  function queueSave(value){
    if(locked||!token||!key){setStatus("Συνδέσου για αποθήκευση.","error");return false}
    pending=JSON.parse(JSON.stringify(value));
    if(scheduled)clearTimeout(scheduled);
    scheduled=setTimeout(()=>{scheduled=null;flush()},450);
    return true;
  }
  async function sync(force=false){
    if(locked||!token||!key||(!force&&!canRefresh()))return;
    if(pending||uploading){
      if(halted){setStatus("Εκκρεμεί σύγκρουση. Εξήγαγε πρώτα το τοπικό αντίγραφο.","error");return}
      if(scheduled)clearTimeout(scheduled);
      scheduled=null;flush();return;
    }
    try{
      const remote=await api("vault","GET",undefined,token);
      if(remote.revision===revision){
        setStatus("Το Cloudflare είναι ενημερωμένο ✓","ok");
      }else if(remote.revision>revision&&remote.ciphertext){
        const snapshot=await decrypt(key,remote.ciphertext);
        applyState(snapshot);
        revision=remote.revision;
        setStatus("Φορτώθηκαν οι νεότερες εγγραφές από το Cloudflare ✓","ok");
      }else{
        setStatus("Ασυμφωνία cloud revision. Δεν άλλαξα κανένα δεδομένο.","error");
      }
    }catch(error){setStatus("Αποτυχία ελέγχου cloud: "+error.message,"error")}
  }
  async function downloadPending(){
    if(!key||!user){setStatus("Συνδέσου πρώτα.","error");return}
    try{
      const record=localStorage.getItem(cacheKey());
      const local=pending||(record?await decrypt(key,JSON.parse(record).ciphertext):null);
      if(!local){setStatus("Δεν υπάρχει εκκρεμές αντίγραφο.","ok");return}
      const blob=new Blob([JSON.stringify({app:"MyDiary",data:local,exportedAt:new Date().toISOString()},null,2)],{type:"application/json"});
      const url=URL.createObjectURL(blob);
      const a=document.createElement("a");
      a.href=url;a.download="mydiary-unsynced-"+user+".json";
      document.body.append(a);a.click();a.remove();
      setTimeout(()=>URL.revokeObjectURL(url),2000);
      setStatus("Κατέβηκε αντίγραφο. Φύλαξέ το σε ασφαλές μέρος.","ok");
    }catch(error){setStatus("Δεν μπόρεσε να εξαχθεί το τοπικό αντίγραφο.","error")}
  }
  async function logout(){
    if(pending||uploading){
      setStatus("Υπάρχουν μη συγχρονισμένα δεδομένα. Πρώτα κατέβασε αντίγραφο.","error");
      return;
    }
    try{if(token)await api("logout","POST",{},token)}catch{}
    token=null;key=null;user="";locked=true;revision=0;cacheWarning="";
    gate.hidden=false;document.body.classList.add("cloud-locked");
    document.getElementById("cloudPassword").value="";
    onReady?.("");
    setStatus("Αποσυνδέθηκες.");
  }
  function mount(){
    gate.hidden=false;
    document.body.classList.add("cloud-locked");
    document.getElementById("cloudForm").addEventListener("submit",submit);
    document.getElementById("cloudMode").addEventListener("change",event=>{
      const isNew=event.target.value==="register";
      document.getElementById("cloudSignupWrap").hidden=!isNew;
      document.getElementById("cloudSubmit").textContent=
        isNew?"Δημιουργία λογαριασμού":"Σύνδεση";
    });
    window.addEventListener("online",()=>{if(!halted)sync()});
    window.addEventListener("focus",()=>{if(!pending&&!uploading&&!locked)sync()});
    setInterval(()=>{if(!pending&&!uploading&&!locked)sync()},90000);
    window.addEventListener("beforeunload",event=>{
      if(pending||uploading){event.preventDefault();event.returnValue="";}
    });
  }
  return {mount,queueSave,sync,logout,downloadPending,get ready(){return !locked},get username(){return user},get pending(){return !!pending||uploading}};
}
