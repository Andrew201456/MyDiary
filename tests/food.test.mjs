import test from "node:test";
import assert from "node:assert/strict";
import {normalizeFood,foodSummary} from "../public/food.js";
test("food with missing, zero and known calories stays distinct",()=>{
 const data=[{id:"a",name:" Toast ",meal:"Πρωινό",calories:250},{id:"b",name:"Coffee",calories:null},{id:"c",name:"Tea",calories:0}];
 const food=normalizeFood(data);
 assert.equal(food[0].name,"Toast");assert.equal(food[1].calories,null);assert.equal(food[2].calories,0);
 assert.deepEqual(foodSummary(food),{count:3,known:2,total:250});
 assert.deepEqual(normalizeFood(undefined),[]);
 assert.equal(normalizeFood(JSON.parse(JSON.stringify(food))).length,3);
});
test("reject invalid entries and keep unknown calories unknown",()=>{
 const food=normalizeFood([{id:"1",name:"Soup",calories:""},{id:"1",name:"duplicate"},{id:"2",name:" "},{id:"3",name:"Salad",calories:-1}]);
 assert.equal(food.length,2);assert.deepEqual(foodSummary(food),{count:2,known:0,total:0});
});
