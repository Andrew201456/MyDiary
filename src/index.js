// MyDiary Cloudflare Worker: API and static PWA assets.
const encoder=new TextEncoder();
const json=(data,status=200)=>new Response(JSON.stringify(data),{
  status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}
});
const validName=s=>typeof s==="string"&&/^[a-zA-Z][a-zA-Z0-9._-]{2,30}$/.test(s);
const normalize=s=>s.trim().toLowerCase();
const b64u=a=>btoa(String.fromCharCode(...a)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
const random=(size=32)=>b64u(crypto.getRandomValues(new Uint8Array(size)));
async function sha(input){
  return b64u(new Uint8Array(await crypto.subtle.digest("SHA-256",encoder.encode(input))));
}
async function verifier(password,salt){
  const key=await crypto.subtle.importKey("raw",encoder.encode(password),"PBKDF2",false,["deriveBits"]);
  const bits=await crypto.subtle.deriveBits({name:"PBKDF2",hash:"SHA-256",salt:encoder.encode(salt),iterations:100000},key,256);
  return b64u(new Uint8Array(bits));
}
function same(a,b){
  if(typeof a!=="string"||typeof b!=="string")return false;
  let diff=a.length^b.length;
  for(let i=0;i<Math.max(a.length,b.length);i++)
    diff|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0);
  return diff===0;
}
async function parsed(request){
  const size=Number(request.headers.get("Content-Length")||0);
  if(size>1_600_000)throw new Error("Το αίτημα είναι πολύ μεγάλο.");
  const value=await request.text();
  if(value.length>1_600_000)throw new Error("Το αίτημα είναι πολύ μεγάλο.");
  return JSON.parse(value);
}
async function current(request,db){
  const match=(request.headers.get("Authorization")||"").match(/^Bearer (MD-[A-Za-z0-9_-]{43})$/);
  if(!match)return null;
  const tokenHash=await sha(match[1]);
  return db.prepare("SELECT u.id,u.username,u.vault_salt FROM diary_sessions s JOIN diary_users u ON s.user_id=u.id WHERE s.token_hash=? AND s.expires_at>?").bind(tokenHash,Date.now()).first();
}
async function handle(request,env){
  const url=new URL(request.url),method=request.method;
  if(!url.pathname.startsWith("/api/"))
    return env.ASSETS.fetch(request);
  if(!env.DB)return json({error:"Η βάση Cloudflare D1 δεν έχει ρυθμιστεί. Πρόσθεσε το binding DB."},503);
  if(url.pathname==="/api/health"&&method==="GET")return json({ok:true,storage:"d1-encrypted-vault"});
  if(url.pathname==="/api/register"&&method==="POST"){
    const form=await parsed(request);
    const name=form?.username,pass=form?.password;
    // Private invitation-only registration prevents arbitrary strangers from
    // creating diary accounts or exhausting D1 capacity.
    if(typeof env.MYDIARY_SIGNUP_CODE!=="string"||env.MYDIARY_SIGNUP_CODE.length<12)
      return json({error:"Ο διαχειριστής πρέπει να ρυθμίσει το Cloudflare Secret MYDIARY_SIGNUP_CODE (12+ χαρακτήρες)."},503);
    if(!same(form?.signupCode,env.MYDIARY_SIGNUP_CODE))
      return json({error:"Λάθος κωδικός δημιουργίας λογαριασμού."},403);
    if(!validName(name)||typeof pass!=="string"||pass.length<12||pass.length>128)
      return json({error:"Username 3–31 λατινικοί χαρακτήρες και password 12–128 χαρακτήρες."},400);
    const username=normalize(name);
    const existing=await env.DB.prepare("SELECT id FROM diary_users WHERE username=?").bind(username).first();
    if(existing)return json({error:"Αυτό το username χρησιμοποιείται ήδη."},409);
    const authSalt=random(16),vaultSalt=random(16);
    const passwordHash=await verifier(pass,authSalt);
    try{
      await env.DB.prepare("INSERT INTO diary_users (username,auth_salt,auth_hash,vault_salt,created_at) VALUES (?,?,?,?,?)")
        .bind(username,authSalt,passwordHash,vaultSalt,Date.now()).run();
    }catch{
      return json({error:"Δεν μπόρεσε να δημιουργηθεί λογαριασμός με αυτό το username."},409);
    }
    return json({created:true},201);
  }
  if(url.pathname==="/api/login"&&method==="POST"){
    const form=await parsed(request),name=form?.username,pass=form?.password;
    if(!validName(name)||typeof pass!=="string"||pass.length>128)return json({error:"Λάθος στοιχεία σύνδεσης."},401);
    const username=normalize(name),now=Date.now();
    const attempts=await env.DB.prepare("SELECT failures,window_start FROM diary_login_attempts WHERE username=?").bind(username).first();
    if(attempts?.failures>=10&&attempts.window_start>now-900000)
      return json({error:"Πολλές προσπάθειες. Δοκίμασε σε 15 λεπτά."},429);
    const user=await env.DB.prepare("SELECT id,username,auth_salt,auth_hash,vault_salt FROM diary_users WHERE username=?").bind(username).first();
    const computed=await verifier(pass,user?.auth_salt||"missing-account-fake-salt");
    if(!user||!same(computed,user.auth_hash)){
      await env.DB.prepare("INSERT INTO diary_login_attempts(username,window_start,failures) VALUES(?,?,1) ON CONFLICT(username) DO UPDATE SET failures=CASE WHEN window_start<? THEN 1 ELSE failures+1 END,window_start=CASE WHEN window_start<? THEN excluded.window_start ELSE window_start END")
        .bind(username,now,now-900000,now-900000).run();
      return json({error:"Λάθος στοιχεία σύνδεσης."},401);
    }
    await env.DB.prepare("DELETE FROM diary_login_attempts WHERE username=?").bind(username).run();
    const token="MD-"+random(32),expires=now+30*86400000;
    await env.DB.prepare("INSERT INTO diary_sessions(token_hash,user_id,expires_at) VALUES (?,?,?)")
      .bind(await sha(token),user.id,expires).run();
    return json({username:user.username,token,vaultSalt:user.vault_salt,expires});
  }
  const user=await current(request,env.DB);
  if(!user)return json({error:"Η συνεδρία έληξε. Συνδέσου ξανά."},401);
  if(url.pathname==="/api/me"&&method==="GET")
    return json({username:user.username,vaultSalt:user.vault_salt});
  if(url.pathname==="/api/logout"&&method==="POST"){
    const token=request.headers.get("Authorization").slice(7);
    await env.DB.prepare("DELETE FROM diary_sessions WHERE token_hash=?").bind(await sha(token)).run();
    return json({ok:true});
  }
  if(url.pathname==="/api/vault"&&method==="GET"){
    const row=await env.DB.prepare("SELECT revision,ciphertext,updated_at FROM diary_vaults WHERE user_id=?").bind(user.id).first();
    return json({revision:row?.revision||0,ciphertext:row?.ciphertext||null,updatedAt:row?.updated_at||null});
  }
  if(url.pathname==="/api/vault"&&method==="PUT"){
    const payload=await parsed(request),revision=payload?.revision,ciphertext=payload?.ciphertext;
    if(!Number.isSafeInteger(revision)||revision<0||
      typeof ciphertext!=="string"||ciphertext.length<40||ciphertext.length>1_400_000||
      !/^[A-Za-z0-9_-]+$/.test(ciphertext))
      return json({error:"Μη έγκυρο κρυπτογραφημένο αρχείο."},400);
    const nextRevision=revision+1;
    const operation=await env.DB.prepare(
      "INSERT INTO diary_vaults (user_id,revision,ciphertext,updated_at) VALUES (?,?,?,?) "+
      "ON CONFLICT(user_id) DO UPDATE SET revision=excluded.revision,ciphertext=excluded.ciphertext,updated_at=excluded.updated_at "+
      "WHERE diary_vaults.revision=?"
    ).bind(user.id,nextRevision,ciphertext,Date.now(),revision).run();
    if(operation.meta.changes!==1)
      return json({error:"Τα δεδομένα έχουν αλλάξει σε άλλη συσκευή. Φόρτωσε πρώτα τις νέες εγγραφές.",conflict:true},409);
    return json({revision:nextRevision});
  }
  return json({error:"Δεν υπάρχει τέτοια εντολή."},404);
}
export default {
  async fetch(request,env){
    try{return await handle(request,env)}
    catch(error){
      console.error("MyDiary API error",String(error?.message||error));
      return json({error:"Αποτυχία επικοινωνίας με τη βάση. Δοκίμασε ξανά."},500);
    }
  }
};
