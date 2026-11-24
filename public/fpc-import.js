/**
 * Period Calendar .fpc backup reader.
 * All decoding happens in the user's browser. No old account credential,
 * name, address, PIN or recovery answer is read or retained.
 */
const textDecoder=new TextDecoder("utf-8",{fatal:true});
const utf8=new TextEncoder();
const MAGIC=[0xac,0xed,0x00,0x05];
const asBytes=v=>v instanceof Uint8Array?v:new Uint8Array(v);
function extractJavaBlocks(value){
  const b=asBytes(value);
  if(b.length<12||!MAGIC.every((v,i)=>b[i]===v))
    throw Error("Το αρχείο δεν είναι υποστηριζόμενο backup .fpc.");
  if(b.length>12_000_000)throw Error("Το αρχείο .fpc υπερβαίνει το όριο των 12 MB.");
  let p=4,total=0;
  const parts=[];
  while(p<b.length){
    const token=b[p++];
    let len;
    if(token===0x7a){
      if(p+4>b.length)throw Error("Μη έγκυρο μπλοκ στο FPC.");
      len=(b[p]*16777216)+(b[p+1]<<16)+(b[p+2]<<8)+b[p+3];p+=4;
    }else if(token===0x77){
      if(p>=b.length)throw Error("Μη έγκυρο μπλοκ στο FPC.");
      len=b[p++];
    }else throw Error("Άγνωστη κωδικοποίηση του FPC.");
    if(len<0||len>65536||p+len>b.length)throw Error("Κατεστραμμένο αρχείο FPC.");
    total+=len;
    if(total>12_000_000)throw Error("Το FPC περιέχει υπερβολικά πολλά δεδομένα.");
    parts.push(b.subarray(p,p+len));p+=len;
  }
  const out=new Uint8Array(total);
  let at=0;for(const part of parts){out.set(part,at);at+=part.length}
  return out;
}
const u16=(v,o)=>v[o]|(v[o+1]<<8);
const u32=(v,o)=>(v[o]+v[o+1]*256+v[o+2]*65536+v[o+3]*16777216)>>>0;
const sign=(v,o,s)=>u32(v,o)===s;
async function unzipSelected(zip,selected){
  let eocd=-1;
  for(let pos=zip.length-22;pos>=Math.max(0,zip.length-65557);pos--){
    if(sign(zip,pos,0x06054b50)){eocd=pos;break}
  }
  if(eocd<0)throw Error("Το FPC δεν περιέχει έγκυρο αρχείο ZIP.");
  const count=u16(zip,eocd+10),offset=u32(zip,eocd+16),directorySize=u32(zip,eocd+12);
  const start=eocd-directorySize,base=start-offset;
  if(count>100||count<=0||start<0||base<0)throw Error("Ασυνήθιστο ή κατεστραμμένο FPC.");
  const found=new Map();
  let pos=start;
  for(let i=0;i<count;i++){
    if(pos+46>eocd||!sign(zip,pos,0x02014b50))throw Error("Κατεστραμμένος κατάλογος ZIP.");
    const method=u16(zip,pos+10),comp=u32(zip,pos+20),uncomp=u32(zip,pos+24);
    const flen=u16(zip,pos+28),exlen=u16(zip,pos+30),clen=u16(zip,pos+32),local=u32(zip,pos+42);
    const name=textDecoder.decode(zip.subarray(pos+46,pos+46+flen));
    pos+=46+flen+exlen+clen;
    if(!selected.has(name))continue;
    if(uncomp>3_000_000||comp>3_000_000||local+base+30>zip.length)
      throw Error("Πολύ μεγάλη ενότητα στο αρχείο FPC.");
    const at=local+base;
    if(!sign(zip,at,0x04034b50))throw Error("Μη έγκυρη ενότητα ZIP.");
    const dataStart=at+30+u16(zip,at+26)+u16(zip,at+28);
    if(dataStart+comp>zip.length)throw Error("Κατεστραμμένο ZIP.");
    const bytes=zip.subarray(dataStart,dataStart+comp);
    let uncompressed;
    if(method===0)uncompressed=bytes;
    else if(method===8){
      if(typeof DecompressionStream!=="function")
        throw Error("Ο browser δεν υποστηρίζει ανάγνωση FPC. Χρησιμοποίησε το μετατρεμμένο αρχείο JSON.");
      const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      uncompressed=new Uint8Array(await new Response(stream).arrayBuffer());
    }else throw Error("Μη υποστηριζόμενη συμπίεση FPC.");
    if(uncompressed.length!==uncomp)throw Error("Αλλοιωμένα δεδομένα FPC.");
    found.set(name,textDecoder.decode(uncompressed));
  }
  for(const name of selected)if(!found.has(name))throw Error("Λείπει η ενότητα "+name+".");
  return found;
}
function decodeFpc(text){
  const chars=Array.from(text);
  const key="Period";
  for(let i=0;i<chars.length;i+=2)
    chars[i]=String.fromCodePoint(chars[i].codePointAt(0)^key.charCodeAt((i/2)%key.length));
  if(text.endsWith("]"))chars[chars.length-1]="]";
  const value=JSON.parse(chars.join(""));
  if(!Array.isArray(value))throw Error("Η ενότητα FPC δεν έχει σωστή δομή.");
  return value;
}
function fpcDate(date){
  const s=String(date??"");
  if(!/^[12]\d{7}$/.test(s))throw Error("Μη έγκυρη ημερομηνία στο FPC.");
  const out=s.slice(0,4)+"-"+s.slice(4,6)+"-"+s.slice(6);
  const d=new Date(out+"T12:00:00");
  if(Number.isNaN(d.getTime())||d.getFullYear()!==+s.slice(0,4)||
     d.getMonth()+1!==+s.slice(4,6)||d.getDate()!==+s.slice(6))
     throw Error("Μη έγκυρη ημερομηνία στο FPC.");
  return out;
}
function addFpcDays(iso,num){
  const d=new Date(iso+"T12:00:00");d.setDate(d.getDate()+num);
  return [d.getFullYear(),String(d.getMonth()+1).padStart(2,"0"),
    String(d.getDate()).padStart(2,"0")].join("-");
}
function emptyFpcDay(){
  return {period:false,flow:"μέτρια",symptoms:[],mood:"",
    weight:"",temperature:"",intimacy:false,ovulation:false,
    sleep:"",water:0,breast:false,notes:""};
}
function waterCups(value){
  if(typeof value==="string"&&value.trimStart().startsWith("[")){
    let cups;
    try{cups=JSON.parse(value)}catch{return 0}
    if(!Array.isArray(cups)||!cups.every(cup=>cup&&Number.isFinite(cup.cupSize)&&cup.cupSize>0))return 0;
    return Math.min(30,cups.length);
  }
  const count=Number(value);
  return Number.isInteger(count)&&count>=0&&count<=30?count:0;
}
/**
 * Returns private MyDiary data and counts. 84 negative-duration records in
 * the supplied sample are interpreted as *estimated* durations; raw signs
 * are retained as provenance, never silently treated as confirmed.
 */
export async function convertFpc(buffer){
  const entries=await unzipSelected(extractJavaBlocks(buffer),
    new Set(["1.period","1.note"])); // Do NOT read "1.user" (old password).
  const periods=decodeFpc(entries.get("1.period"));
  const notes=decodeFpc(entries.get("1.note"));
  if(periods.length>30000||notes.length>50000)
    throw Error("Υπερβολικά πολλές καταχωρήσεις FPC.");
  const days=Object.create(null),periodRecords=[],dailyRecords=[];
  let estimated=0;
  for(const row of periods){
    if(!row||typeof row!=="object")continue;
    const start=fpcDate(row.db_start);
    const raw=Number(row.period);
    const length=Number.isInteger(raw)&&Math.abs(raw)>=1&&Math.abs(raw)<=12?Math.abs(raw):1;
    if(raw<0)estimated++;
    for(let i=0;i<length;i++){
      const day=addFpcDays(start,i);
      (days[day]??=emptyFpcDay()).period=true;
    }
    periodRecords.push({start,periodRaw:raw,cycle:Number(row.cycle)||0,pregnancy:row.pregnancy===true});
  }
  for(const row of notes){
    if(!row||typeof row!=="object")continue;
    const day=fpcDate(row.db_date),e=days[day]??=emptyFpcDay();
    const weight=Number(row.weight);
    if(Number.isFinite(weight)&&weight>0&&weight<500)e.weight=String(row.weight);
    const temp=Number(row.temperature);
    if(Number.isFinite(temp)&&temp>30&&temp<44)e.temperature=String(row.temperature);
    if(row.intimate===true)e.intimacy=true;
    if(row.ovulation_test===1||row.ovulation_test===2)e.ovulation=true;
    if(row.breast===true||row.breast==="1"||row.breast==="true")e.breast=true;
    if(typeof row.note==="string")e.notes=row.note.slice(0,2000);
    if(row.water!==undefined)e.water=waterCups(row.water);
    const sleep=Number(row.sleep);
    if(Number.isFinite(sleep)&&sleep>0&&sleep<=24)e.sleep=String(sleep);
    const {uid,date,db_date,editTime,...archive}=row;
    dailyRecords.push({date:day,...archive});
  }
  return {
    app:"MyDiary",version:2,
    importInfo:{
      source:"Period Calendar FPC",periodRecords:periodRecords.length,
      dailyRecords:dailyRecords.length,periodsWithInferredLength:estimated,
      warning:"Αρνητικές τιμές διάρκειας: εκτίμηση με βάση την απόλυτη τιμή, όχι επιβεβαιωμένο πλήθος ημερών."
    },
    data:{
      version:2,
      settings:{cycleLength:29,periodLength:4,remindPeriod:true,
        remindWater:false,remindWaterHour:12,theme:"pastel"},
      days,
      sourceFpc:{format:"fpc-v18",periodRecords,dailyRecords}
    }
  };
}
