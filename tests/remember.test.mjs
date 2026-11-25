import test from "node:test";
import assert from "node:assert/strict";
import {webcrypto} from "node:crypto";
import {validRemembered} from "../public/remember.js";
test("remembered sessions must be unexpired and use a non-exportable vault key",async()=>{
  const key=await webcrypto.subtle.generateKey({name:"AES-GCM",length:256},false,["encrypt","decrypt"]);
  const record={username:"test",token:"MD-"+"a".repeat(43),expires:2000,key};
  assert.equal(validRemembered(record,1000),true);
  assert.equal(validRemembered(record,2000),false);
  assert.equal(validRemembered({...record,token:"bad"},1000),false);
  const extractable=await webcrypto.subtle.generateKey({name:"AES-GCM",length:256},true,["encrypt","decrypt"]);
  assert.equal(validRemembered({...record,key:extractable},1000),false);
  const copy=structuredClone(record);
  assert.equal(validRemembered(copy,1000),true);
  const iv=webcrypto.getRandomValues(new Uint8Array(12));
  const plaintext=new TextEncoder().encode("sample");
  const encrypted=await webcrypto.subtle.encrypt({name:"AES-GCM",iv},key,plaintext);
  assert.deepEqual(new Uint8Array(await webcrypto.subtle.decrypt({name:"AES-GCM",iv},copy.key,encrypted)),plaintext);
});
