import test from "node:test";
import assert from "node:assert/strict";
import {restoreArchivedWater} from "../public/fpc-import.js";

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
