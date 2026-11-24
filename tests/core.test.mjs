import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";

const source=readFileSync(resolve("public/app.js"),"utf8");
const beforeEvents=source.slice(0,source.indexOf('document.addEventListener("click"'))
  .replace(/^import[^\n]*\n/gm,"");
const doc={getElementById(id){return id==="main"?this.main:{textContent:"",hidden:false};},querySelectorAll(){return [];},main:{innerHTML:"",dataset:{},querySelectorAll(){return [];}}};
const data=new Map();
const storage={getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
function boot(){
  return new Function("document","localStorage","window","Notification","sessionStorage",
    beforeEvents+'\ncloud={ready:true,username:"tester",queueSave:v=>{localStorage.setItem("mock-cloud",JSON.stringify(v));return true}};\n'+
    "return {state,cycleStats,predictions,validDate,renderToday,renderCalendar,renderReports,renderAdd,renderReminders,renderSettings,save,load,periodStarts,addDays,main,normalizeEntry,isPredictedPeriod,selected};"
  )(doc,storage,{scrollTo(){}},{permission:"default"},{});
}
test("local state does not predict without a recorded period",()=>{
  data.clear();
  const app=boot();
  assert.equal(app.predictions().period,null);
  assert.equal(app.cycleStats().cycle,29);
  assert.equal(app.cycleStats().periodLength,5);
});
test("cycle and period averages use real continuous period segments",()=>{
  data.clear();
  const app=boot();
  for(const date of ["2026-09-01","2026-09-02","2026-09-03","2026-09-30","2026-10-01","2026-10-28"]){
    app.state.days[date]=app.normalizeEntry({period:true});
  }
  assert.deepEqual(app.periodStarts(),["2026-09-01","2026-09-30","2026-10-28"]);
  assert.equal(app.cycleStats().cycle,29);
  assert.equal(app.cycleStats().periodLength,2);
  const prediction=app.predictions();
  assert.match(prediction.period,/^\d{4}-\d\d-\d\d$/);
  assert(prediction.fertile.length===7);
  assert.equal(typeof prediction.ovulation,"string");
  assert(app.isPredictedPeriod(prediction.period,prediction));
  assert(app.save());
  assert(storage.getItem("mock-cloud").includes("2026-09-01"));
  assert.equal(storage.getItem("mydiary-local-v1"),null,
    "New cloud saves must not write plaintext health data to localStorage");
});
test("screens render live UI for period, reports, notes, settings and reminders",()=>{
  data.clear();
  const app=boot();
  for(const [fn,expected] of [
    ["renderToday","Μέσος κύκλος"],["renderCalendar","calendar-grid"],
    ["renderReports","report-grid"],["renderAdd","entryPeriod"],
    ["renderReminders","remindPeriod"],["renderSettings","exportData"]
  ]){
    app[fn]();
    assert(doc.main.innerHTML.includes(expected),fn+" missing "+expected);
  }
});
test("input sanitation and calendar ranges",()=>{
  const app=boot();
  assert(app.validDate("2026-11-24"));
  assert(!app.validDate("2026-02-30"));
  assert.equal(app.addDays("2026-02-28",1),"2026-03-01");
  const e=app.normalizeEntry({period:true,symptoms:["Κούραση","BAD"],temperature:"37.1",weight:"63.5",notes:"test",water:99});
  assert.equal(e.symptoms.length,1);
  assert.equal(e.water,30);
  assert.equal(e.temperature,"37.1");
  assert.equal(e.weight,"63.5");
});
test("a historical period still forecasts a date near today",()=>{
  data.clear();
  const app=boot();
  app.state.days["2017-01-01"]=app.normalizeEntry({period:true});
  const predicted=app.predictions();
  const today=new Date();
  const forecast=new Date(predicted.period+"T12:00:00");
  const gap=Math.round((forecast-today)/86400000);
  assert(gap>=-app.cycleStats().periodLength-1);
  assert(gap<=app.cycleStats().cycle);
});
test("batch period markers preserve existing symptoms and notes",()=>{
  data.clear();
  const controls={
    entryDate:{value:"2026-11-01"},entryPeriod:{checked:true},
    entryPeriodRange:{checked:true},entryFlow:{value:"μέτρια"},
    entryWeight:{value:""},entryTemp:{value:""},entrySleep:{value:""},
    entryWater:{value:"1"},entryIntimacy:{checked:false},
    entryOvulation:{checked:false},entryBreast:{checked:false},
    entryNotes:{value:"First day"}
  };
  const docLocal={
    ...doc,
    getElementById(id){return id==="main"?doc.main:controls[id]||(controls[id]={textContent:"",hidden:false})}
  };
  const app=new Function("document","localStorage","window","Notification",
    "sessionStorage","setTimeout","clearTimeout",
    beforeEvents+'\ncloud={ready:true,username:"tester",queueSave:v=>{localStorage.setItem("mock-cloud",JSON.stringify(v));return true}};\n'+
    "return {getState:()=>state,saveEntry,normalizeEntry,normalizeSettings};"
  )(docLocal,storage,{scrollTo(){}},{permission:"default"},{},()=>0,()=>{});
  app.getState().settings.periodLength=5;
  app.getState().days["2026-11-03"]=app.normalizeEntry({
    symptoms:["Κράμπες"],notes:"Existing note"
  });
  app.saveEntry();
  for(let i=1;i<=5;i++)
    assert.equal(app.getState().days["2026-11-0"+i].period,true);
  assert.equal(app.getState().days["2026-11-03"].notes,"Existing note");
  assert.deepEqual(app.getState().days["2026-11-03"].symptoms,["Κράμπες"]);
  assert.equal(app.getState().days["2026-11-01"].notes,"First day");
  const normalized=app.normalizeSettings({remindWaterHour:'onfocus="alert(1)',cycleLength:28.9,periodLength:42});
  assert.equal(normalized.remindWaterHour,12);
  assert.equal(normalized.cycleLength,29);
  assert.equal(normalized.periodLength,12);
});
