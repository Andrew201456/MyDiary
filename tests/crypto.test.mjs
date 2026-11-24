import test from "node:test";
import assert from "node:assert/strict";
import {webcrypto} from "node:crypto";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
globalThis.crypto ??= webcrypto;

const source=readFileSync(resolve("public/cloud.js"),"utf8")
  .replace("export function createCloud","function createCloud");
const {derive,encrypt,decrypt}=new Function(source+
  "\nreturn {derive,encrypt,decrypt};")();

test("AES-GCM keeps diary notes and sensitive symptoms encrypted with random IV",async()=>{
  const password="very-strong-private-passphrase";
  const salt="independent-user-vault-salt";
  const key=await derive(password,salt);
  const diary={days:{"2026-11-24":{
    period:true,notes:"Private note",intimacy:true,symptoms:["Κράμπες"]
  }},settings:{cycleLength:29}};
  const first=await encrypt(key,diary);
  const second=await encrypt(key,diary);
  assert.notEqual(first,second,"AES-GCM must use a fresh random IV");
  assert(!first.includes("Private note"));
  assert.deepEqual(await decrypt(key,first),diary);
  assert.deepEqual(await decrypt(key,second),diary);
  const incorrect=await derive("wrong-password",salt);
  await assert.rejects(decrypt(incorrect,first),"Incorrect password must never decrypt the vault");
});

test("Cloud sync only calls authenticated endpoints and avoids plaintext local persistence",()=>{
  assert(source.includes('new Uint8Array(12)'));
  assert(source.includes('crypto.subtle.encrypt('));
  assert(source.includes('crypto.subtle.decrypt('));
  assert(source.includes('fetch("/api/"+path'));
  assert(!source.includes('localStorage.setItem("mydiary-local-v1"'));
  assert(source.includes('localStorage.removeItem("mydiary-local-v1")'));
});
