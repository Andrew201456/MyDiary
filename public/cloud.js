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
export function createCloud({readState,applyState,loadLegacy,onStatus,onReady}){
  let token=null,key=null,user="",revision=0,locked=true,uploading=false;
  let pending=null,halted=false,scheduled=null;
  const gate=document.getElementById("cloudLogin");
  const notice=document.getElementById("cloudMessage");
  const setStatus=(message,type="info")=>{
    onStatus?.(message,type);
    if(notice&&!gate.hidden)notice.textContent=message;
  };
  const handleRemote=async()=>{
    const remote=await api("vault","GET",undefined,token);
    revision=remote.revision;
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
    setStatus("Cloud ενεργό • "+user,"ok");
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
        await api("register","POST",{username:name,password:pass});
      }
      await enter(name,pass);
      document.getElementById("cloudPassword").value="";
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
      setStatus("Αποθηκεύτηκε στο Cloudflare ✓","ok");
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
  function sync(){if(!pending){setStatus("Τα δεδομένα είναι ενημερωμένα.","ok");return}halted=false;if(scheduled)clearTimeout(scheduled);scheduled=null;flush()}
  async function logout(){
    if(pending||uploading){
      setStatus("Υπάρχουν μη συγχρονισμένα δεδομένα. Πρώτα κατέβασε αντίγραφο.","error");
      return;
    }
    try{if(token)await api("logout","POST",{},token)}catch{}
    token=null;key=null;user="";locked=true;revision=0;
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
      document.getElementById("cloudSubmit").textContent=
        event.target.value==="register"?"Δημιουργία λογαριασμού":"Σύνδεση";
    });
    window.addEventListener("online",()=>{if(pending&&!halted)sync()});
    window.addEventListener("beforeunload",event=>{
      if(pending||uploading){event.preventDefault();event.returnValue="";}
    });
  }
  return {mount,queueSave,sync,logout,get ready(){return !locked},get username(){return user},get pending(){return !!pending||uploading}};
}
