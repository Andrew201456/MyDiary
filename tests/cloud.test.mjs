import test from "node:test";
import assert from "node:assert/strict";
import {webcrypto} from "node:crypto";
import worker from "../src/index.js";
globalThis.crypto ??= webcrypto;

function mockDb(){
  const users=new Map(),sessions=new Map(),attempts=new Map(),vaults=new Map();
  let nextId=1;
  return {users,sessions,attempts,vaults,
    prepare(sql){
      let params=[];
      return {
        bind(...args){params=args;return this;},
        async first(){
          const [key]=params;
          if(sql.includes("FROM sqlite_schema"))return {present:5};
          if(sql.includes("FROM diary_users WHERE username=?"))
            return users.get(key)||null;
          if(sql.includes("FROM diary_login_attempts WHERE username=?"))
            return attempts.get(key)||null;
          if(sql.includes("JOIN diary_users u")){
            const session=sessions.get(key);
            if(!session||session.expires_at<=params[1])return null;
            const u=[...users.values()].find(v=>v.id===session.user_id);
            return u?{id:u.id,username:u.username,vault_salt:u.vault_salt}:null;
          }
          if(sql.includes("FROM diary_vaults WHERE user_id=?"))
            return vaults.get(key)||null;
          throw Error("Unexpected SQL first: "+sql);
        },
        async run(){
          if(sql.startsWith("INSERT INTO diary_users")){
            const [username,auth_salt,auth_hash,vault_salt,created_at]=params;
            if(users.has(username))throw Error("Duplicate account");
            users.set(username,{id:nextId++,username,auth_salt,auth_hash,vault_salt,created_at});
            return {meta:{changes:1}};
          }
          if(sql.startsWith("INSERT INTO diary_sessions")){
            const [token_hash,user_id,expires_at]=params;
            sessions.set(token_hash,{user_id,expires_at});
            return {meta:{changes:1}};
          }
          if(sql.startsWith("DELETE FROM diary_sessions")){
            sessions.delete(params[0]);return {meta:{changes:1}};
          }
          if(sql.startsWith("INSERT INTO diary_login_attempts")){
            const [name,now,deadline]=params,old=attempts.get(name);
            attempts.set(name,{
              window_start:old&&old.window_start>=deadline?old.window_start:now,
              failures:old&&old.window_start>=deadline?old.failures+1:1
            });
            return {meta:{changes:1}};
          }
          if(sql.startsWith("DELETE FROM diary_login_attempts")){
            attempts.delete(params[0]);return {meta:{changes:1}};
          }
          if(sql.startsWith("INSERT INTO diary_vaults")){
            const [user_id,revision,ciphertext,updated_at,expected]=params;
            const old=vaults.get(user_id);
            if(old&&old.revision!==expected)return {meta:{changes:0}};
            vaults.set(user_id,{revision,ciphertext,updated_at});
            return {meta:{changes:1}};
          }
          throw Error("Unexpected SQL run: "+sql);
        }
      };
    }
  };
}
function request(path,method="GET",data,token){
  const headers={};if(token)headers.Authorization="Bearer "+token;
  if(data!==undefined)headers["Content-Type"]="application/json";
  return new Request("https://mydiary.example"+path,{
    method,headers,body:data===undefined?undefined:JSON.stringify(data)
  });
}
async function fetchApi(env,path,method="GET",data,token){
  const response=await worker.fetch(request(path,method,data,token),env);
  return {status:response.status,data:await response.json()};
}

test("registration requires private signup secret, login verifies credentials, vault uses strict revision CAS",async()=>{
  const db=mockDb(),env={
    DB:db,MYDIARY_SIGNUP_CODE:"private-setup-secret-123",
    ASSETS:{fetch:async()=>new Response("ok")}
  };
  const user={username:"DiaryUser",password:"A-strong-password-2026"};
  let r=await fetchApi(env,"/api/register","POST",{...user,signupCode:"wrong"});
  assert.equal(r.status,403);
  r=await fetchApi(env,"/api/register","POST",{...user,signupCode:env.MYDIARY_SIGNUP_CODE});
  assert.equal(r.status,201);
  assert.equal(db.users.size,1);
  const stored=db.users.get("diaryuser");
  assert(!JSON.stringify(stored).includes(user.password),"Server must store only PBKDF2 verifier");
  r=await fetchApi(env,"/api/login","POST",{username:user.username,password:"wrong-password"});
  assert.equal(r.status,401);
  r=await fetchApi(env,"/api/login","POST",user);
  assert.equal(r.status,200);
  const token=r.data.token;
  assert.match(token,/^MD-/);
  assert(r.data.vaultSalt);
  assert.equal((await fetchApi(env,"/api/vault")).status,401);
  r=await fetchApi(env,"/api/vault","GET",undefined,token);
  assert.equal(r.status,200);
  assert.equal(r.data.ciphertext,null);
  assert.equal(r.data.revision,0);
  const encrypted="A".repeat(70);
  r=await fetchApi(env,"/api/vault","PUT",{revision:0,ciphertext:encrypted},token);
  assert.equal(r.status,200);
  assert.equal(r.data.revision,1);
  r=await fetchApi(env,"/api/vault","GET",undefined,token);
  assert.equal(r.data.ciphertext,encrypted);
  r=await fetchApi(env,"/api/vault","PUT",{revision:0,ciphertext:"B".repeat(70)},token);
  assert.equal(r.status,409);
  assert.equal((await fetchApi(env,"/api/vault","GET",undefined,token)).data.ciphertext,encrypted,
    "A stale device must never overwrite existing cloud history");

  r=await fetchApi(env,"/api/register","POST",{
    username:"AnotherUser",password:"Another-strong-password",signupCode:env.MYDIARY_SIGNUP_CODE
  });
  assert.equal(r.status,201);
  const second=await fetchApi(env,"/api/login","POST",{username:"AnotherUser",password:"Another-strong-password"});
  assert.equal(second.status,200);
  assert.equal((await fetchApi(env,"/api/vault","GET",undefined,second.data.token)).data.ciphertext,null,
    "Second account must not read first person's health diary");
  r=await fetchApi(env,"/api/logout","POST",{},token);
  assert.equal(r.status,200);
  assert.equal((await fetchApi(env,"/api/vault","GET",undefined,token)).status,401);
});

test("health route never exposes account or vault data",async()=>{
  const result=await worker.fetch(request("/api/health"),{DB:mockDb(),ASSETS:{fetch:async()=>new Response("ok")}});
  assert.equal(result.status,200);
  assert.deepEqual(await result.json(),{ok:true,storage:"d1-encrypted-vault",registrationEnabled:false});
  assert.equal(result.headers.get("Cache-Control"),"no-store");
  const enabled=await fetchApi({DB:mockDb(),MYDIARY_SIGNUP_CODE:"synthetic-test-invitation"},"/api/health");
  assert.deepEqual(enabled.data,{ok:true,storage:"d1-encrypted-vault",registrationEnabled:true});
});

test("health checks D1 again after an earlier successful request",async()=>{
  const db=mockDb();
  const env={DB:db};
  assert.equal((await fetchApi(env,"/api/health")).status,200);
  db.prepare=()=>{throw Error("D1 temporarily unavailable")};
  const unavailable=await fetchApi(env,"/api/health");
  assert.equal(unavailable.status,503);
  assert.equal(unavailable.data.ok,undefined);
});
