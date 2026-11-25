// Food entries live inside the same encrypted diary day as the other fields.
export const MEAL_TYPES=["Πρωινό","Μεσημεριανό","Βραδινό","Σνακ","Άλλο"];
export function normalizeFood(value){
  if(!Array.isArray(value))return [];
  const used=new Set(),out=[];
  for(const item of value){
    if(!item||typeof item!=="object"||typeof item.name!=="string")continue;
    const name=item.name.trim().slice(0,300);
    if(!name||typeof item.id!=="string"||!/^[A-Za-z0-9-]{1,80}$/.test(item.id)||used.has(item.id))continue;
    used.add(item.id);
    const raw=item.calories;
    const n=typeof raw==="number"||typeof raw==="string"&&raw.trim()!==""?Number(raw):NaN;
    out.push({id:item.id,name,meal:MEAL_TYPES.includes(item.meal)?item.meal:"Άλλο",
      calories:Number.isFinite(n)&&n>=0&&n<=100000?Math.round(n):null});
  }
  return out;
}
export function foodSummary(value){
  const food=normalizeFood(value);
  const known=food.filter(item=>item.calories!==null);
  return {count:food.length,known:known.length,total:known.reduce((sum,item)=>sum+item.calories,0)};
}
