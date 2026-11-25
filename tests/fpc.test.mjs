import test from "node:test";
import assert from "node:assert/strict";
import {restoreArchivedWater,normalizeFpcWeights} from "../public/fpc-import.js";

test("original FPC conversions recover cup counts while ordinary diary exports retain edits",()=>{
  const date="2001-01-01";
  const water=JSON.stringify([{cupSize:250,cupUnit:0},{cupSize:150,cupUnit:0}]);
  const data={days:{[date]:{water:0}},sourceFpc:{format:"fpc-v18",dailyRecords:[{date,water}]}};
  restoreArchivedWater({app:"MyDiary",data});
  assert.equal(data.days[date].water,0);
  const converted={app:"MyDiary",importInfo:{source:"Period Calendar FPC"},data};
  restoreArchivedWater(converted);
  assert.equal(data.days[date].water,2);
  data.days[date].water=3;
  restoreArchivedWater(converted);
  assert.equal(data.days[date].water,3);
  assert.equal(data.sourceFpc.dailyRecords[0].water,water);
});

function weightDiary(weights){
  const rows=weights.map((weight,i)=>({date:"2000-02-"+String(i+1).padStart(2,"0"),weight}));
  return {sourceFpc:{format:"fpc-v18",dailyRecords:rows},
    days:Object.fromEntries(rows.map(r=>[r.date,{weight:String(r.weight),notes:"kept"}]))};
}

test("FPC pound series becomes kilograms once, keeping manual edits, deletions and raw provenance",()=>{
  const kg=[72.05,72.10,72.15,72.20,72.25,72.30,72.35,72.40,72.45,72.50,72.55,72.60];
  const pounds=kg.map(n=>Number((n/0.45359237).toFixed(2)));
  const data=weightDiary(pounds);
  const rows=data.sourceFpc.dailyRecords;
  data.days[rows[0].date].weight="73.1";
  data.days[rows[1].date].weight="";
  delete data.days[rows[2].date];
  data.days["2001-01-01"]={weight:"140"};
  assert.equal(normalizeFpcWeights(data),true);
  assert.equal(data.days[rows[0].date].weight,"73.1");
  assert.equal(data.days[rows[1].date].weight,"");
  assert.equal(data.days[rows[2].date],undefined);
  assert.deepEqual(data.days["2001-01-01"],{weight:"140"});
  rows.slice(3).forEach((r,i)=>assert.deepEqual(data.days[r.date],{weight:String(kg[i+3]),notes:"kept"}));
  assert.deepEqual(rows.map(r=>r.weight),pounds);
  data.days[rows[3].date].weight=String(pounds[3]);
  assert.equal(normalizeFpcWeights(data),false);
  assert.equal(data.days[rows[3].date].weight,String(pounds[3]));
});

test("metric, mixed and sparse histories require an explicit choice when units are ambiguous",()=>{
  for(const weights of [[120,131,134],[90.85,91.05,91.2,91.25,91.33,92.99,90.22],[144.56]]){
    const data=weightDiary(weights),before=structuredClone(data);
    assert.equal(normalizeFpcWeights(data),false);
    assert.deepEqual(data,before);
    assert.equal(normalizeFpcWeights(data,"kg"),true);
    assert.deepEqual(data.days,before.days);
    assert.equal(normalizeFpcWeights(data,"lb"),false);
  }
  const known=weightDiary([150]);
  assert.equal(normalizeFpcWeights(known,"lb"),true);
  assert.equal(Object.values(known.days)[0].weight,"68.04");
  assert.equal(normalizeFpcWeights({days:{example:{weight:"150"}}},"lb"),false);
});
