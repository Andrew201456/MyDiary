import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
const base=resolve("public");
const html=readFileSync(resolve(base,"index.html"),"utf8");
const css=readFileSync(resolve(base,"app.css"),"utf8");
const js=readFileSync(resolve(base,"app.js"),"utf8");
const manifest=JSON.parse(readFileSync(resolve(base,"manifest.webmanifest"),"utf8"));
const wrangler=JSON.parse(readFileSync(resolve("wrangler.jsonc"),"utf8"));
const sw=readFileSync(resolve(base,"sw.js"),"utf8");

test("Cloudflare deploys static files without a data backend",()=>{
  assert.equal(wrangler.name,"mydiary");
  assert.equal(wrangler.assets.directory,"./public");
  assert(!("binding" in wrangler.assets));
  assert(!("d1_databases" in wrangler));
  assert(!("kv_namespaces" in wrangler));
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
  assert(sw.includes("mydiary-shell-v2"));
});
test("Local-first application avoids transmitting sensitive data",()=>{
  assert(js.includes("localStorage.setItem(STORAGE"));
  assert(!/\bfetch\s*\(/.test(js),"No background uploads of period and diary entries");
  assert(!/google-analytics|gtag\(|facebook\.net|pixel\.js/i.test(html+js));
  assert(js.includes("mydiary-backup-"));
  assert(js.includes("Η επαναφορά θα ΑΝΤΙΚΑΤΑΣΤΗΣΕΙ"));
});
