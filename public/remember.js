// Opt-in, browser-local session and non-exportable WebCrypto key.
const database="mydiary-remember-v1", storeName="sessions", recordKey="current";
function openDatabase(){
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open(database,1);
    request.onupgradeneeded=()=>request.result.createObjectStore(storeName);
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
    request.onblocked=()=>reject(Error("Η αποθήκευση συνεδρίας είναι αποκλεισμένη."));
  });
}
async function transact(mode,work){
  const db=await openDatabase();
  try{
    return await new Promise((resolve,reject)=>{
      const tx=db.transaction(storeName,mode);
      let result;
      tx.oncomplete=()=>resolve(result);
      tx.onabort=()=>reject(tx.error||Error("Αποτυχία αποθήκευσης συνεδρίας."));
      tx.onerror=()=>reject(tx.error);
      try{work(tx.objectStore(storeName),value=>{result=value})}catch(error){try{tx.abort()}catch{}reject(error)}
    });
  }finally{db.close()}
}
export function validRemembered(value,now=Date.now()){
  return !!(value&&typeof value.username==="string"&&typeof value.token==="string"&&
    /^MD-[A-Za-z0-9_-]{43}$/.test(value.token)&&Number.isSafeInteger(value.expires)&&
    value.expires>now&&value.key?.type==="secret"&&value.key.extractable===false&&
    value.key.algorithm?.name==="AES-GCM"&&value.key.usages?.includes("decrypt")&&value.key.usages?.includes("encrypt"));
}
export function loadRemembered(){
  return transact("readonly",(store,done)=>{
    const req=store.get(recordKey);req.onsuccess=()=>done(req.result||null);
  });
}
export function storeRemembered(value){
  if(!validRemembered(value))throw Error("Μη έγκυρη συνεδρία.");
  const {username,token,expires,key}=value;
  return transact("readwrite",store=>{store.put({username,token,expires,key},recordKey)});
}
export function forgetRemembered(expectedToken){
  return transact("readwrite",store=>{
    if(!expectedToken){store.delete(recordKey);return}
    const req=store.get(recordKey);
    req.onsuccess=()=>{if(req.result?.token===expectedToken)store.delete(recordKey)};
  });
}
