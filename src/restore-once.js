// Temporary operator-approved restore. The deployment pins the entire private
// package by digest. A different file cannot create or modify any account.
const approvedDigest = "b83049e1e71d23818599ae8e7e88d57454fce6cf6ed5ffcab93466b4dc70fe4e";
const deadline = Date.parse("2026-11-25T03:41:24.864Z");
const packageSize = 135403;
const path = "/api/restore-once";
const headers = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  "Content-Security-Policy": "default-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"
};
const answer = (body,status=200) => Response.json(body,{status,headers});
const form = '<!doctype html><html lang="el"><meta charset="utf-8"><title>Ιδιωτική εισαγωγή MyDiary</title>'+
  '<main><h1>Ιδιωτική εισαγωγή MyDiary</h1><form method="post" enctype="multipart/form-data" action="'+path+'">'+
  '<label for="file">Κρυπτογραφημένο αρχείο εισαγωγής</label> <input id="file" name="file" type="file" required> '+
  '<button>Εισαγωγή στο MyDiary</button></form></main></html>';

export async function restoreApprovedAccount(request, db) {
  if(Date.now()>=deadline)return answer({error:"Η εισαγωγή έληξε."},410);
  if(request.method==="GET")return new Response(form,{headers:{...headers,"Content-Type":"text/html; charset=utf-8"}});
  const origin=new URL(request.url).origin;
  if(request.method!=="POST"||request.headers.get("Origin")!==origin)return answer({error:"Μη έγκυρο αίτημα."},403);
  const bodyLength=Number(request.headers.get("Content-Length"));
  if(!Number.isSafeInteger(bodyLength)||bodyLength<packageSize||bodyLength>packageSize+4096)
    return answer({error:"Μη έγκυρο μέγεθος αρχείου."},400);
  const file=(await request.formData()).get("file");
  if(!file||file.size!==packageSize)return answer({error:"Μη έγκυρο αρχείο."},400);
  const bytes=await file.arrayBuffer();
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)),b=>b.toString(16).padStart(2,"0")).join("");
  if(digest!==approvedDigest)return answer({error:"Το αρχείο δεν είναι εγκεκριμένο για αυτή την εισαγωγή."},403);
  const account=JSON.parse(new TextDecoder().decode(bytes));
  const {username,authSalt,authHash,vaultSalt,ciphertext}=account;
  const verify=()=>db.prepare(
    "SELECT v.revision FROM diary_users u JOIN diary_vaults v ON v.user_id=u.id "+
    "WHERE u.username=? AND u.auth_salt=? AND u.auth_hash=? AND u.vault_salt=? AND v.ciphertext=?"
  ).bind(username,authSalt,authHash,vaultSalt,ciphertext).first();
  const now=Date.now();
  try{
    // A username collision rolls the entire D1 batch back.
    await db.batch([
      db.prepare("INSERT INTO diary_users(username,auth_salt,auth_hash,vault_salt,created_at) VALUES(?,?,?,?,?)")
        .bind(username,authSalt,authHash,vaultSalt,now),
      db.prepare("INSERT INTO diary_vaults(user_id,revision,ciphertext,updated_at) SELECT id,1,?,? FROM diary_users WHERE username=?")
        .bind(ciphertext,now,username)
    ]);
  }catch{
    if(await verify())return answer({username,verified:true});
    const existing=await db.prepare("SELECT 1 AS present FROM diary_users WHERE username=?").bind(username).first();
    return existing?answer({error:"Το όνομα χρησιμοποιείται από υπάρχοντα λογαριασμό."},409):
      answer({error:"Η εγγραφή στη D1 απέτυχε."},503);
  }
  if(!await verify())return answer({error:"Η εγγραφή δεν επαληθεύτηκε."},503);
  return answer({username,verified:true},201);
}
