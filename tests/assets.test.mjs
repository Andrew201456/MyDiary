import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
const base=resolve("public");
const html=readFileSync(resolve(base,"index.html"),"utf8");
const css=readFileSync(resolve(base,"app.css"),"utf8");
const js=readFileSync(resolve(base,"app.js"),"utf8");
const cloud=readFileSync(resolve(base,"cloud.js"),"utf8");
const worker=readFileSync(resolve("src/index.js"),"utf8");
const schema=readFileSync(resolve("schema.sql"),"utf8");
const manifest=JSON.parse(readFileSync(resolve(base,"manifest.webmanifest"),"utf8"));
const wrangler=JSON.parse(readFileSync(resolve("wrangler.jsonc"),"utf8"));
const sw=readFileSync(resolve(base,"sw.js"),"utf8");

test("Cloudflare serves PWA and authenticated API with encrypted D1 vault",()=>{
  assert.equal(wrangler.name,"mydiary");
  assert.equal(wrangler.main,"src/index.js");
  assert.equal(wrangler.assets.directory,"./public");
  assert.equal(wrangler.assets.binding,"ASSETS");
  assert.equal(wrangler.assets.run_worker_first,true);
  assert.equal(wrangler.d1_databases[0].binding,"DB");
  assert(schema.includes("diary_vaults"));
  assert(schema.includes("diary_sessions"));
  assert(schema.includes("diary_login_attempts"));
  assert(worker.includes('"/api/vault"'));
  assert(worker.includes("MYDIARY_SIGNUP_CODE"));
});
test("UI implements five accessible mobile tabs",()=>{
  for(const id of ["today","calendar","add","reminders","reports"])
    assert(html.includes('data-nav="'+id+'"'));
  assert(html.includes('lang="el"'));
  assert(css.includes(".bottom-nav"));
  assert(css.includes(".calendar-grid"));
  assert(css.includes(".report-grid"));
});
test("Installable PWA has 192 and 512 bitmap icons",()=>{
  assert.equal(manifest.display,"standalone");
  for(const size of [192,512]){
    const item=manifest.icons.find(icon=>icon.sizes===size+"x"+size);
    assert(item,"PWA PNG icon "+size+" missing");
    const png=readFileSync(resolve(base,item.src.slice(1)));
    assert.equal(png.subarray(0,8).toString("hex"),"89504e470d0a1a0a");
    assert.equal(png.readUInt32BE(16),size);
    assert.equal(png.readUInt32BE(20),size);
  }
  assert(sw.includes("mydiary-shell-v5"));
  assert(!sw.includes("caches.put"),"Verify SW does not blindly store API replies");
  assert(sw.includes('pathname.startsWith("/api/")'));
});
test("Sensitive records leave the browser only as ciphertext",()=>{
  assert(!js.includes("localStorage.setItem(STORAGE"));
  assert(cloud.includes('crypto.subtle.encrypt('));
  assert(cloud.includes('crypto.subtle.decrypt('));
  assert(cloud.includes('"/api/"+path'));
  assert(cloud.includes('ciphertext'));
  assert(js.includes("cloud.queueSave(state)"));
  assert(!/google-analytics|gtag\(|facebook\.net|pixel\.js/i.test(html+js+cloud));
  assert(js.includes("mydiary-backup-"));
  assert(js.includes("Η επαναφορά JSON θα ΑΝΤΙΚΑΤΑΣΤΗΣΕΙ"));
  assert(html.includes('id="cloudLogin"'));
  assert(html.includes('id="cloudSignupCode"'));
});
