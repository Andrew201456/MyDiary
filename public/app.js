import {convertFpc} from "./fpc-import.js";
import {createCloud} from "./cloud.js";
"use strict";
const STORAGE="mydiary-local-v1";
const DEFAULTS={cycleLength:29,periodLength:5,remindPeriod:true,remindWater:false,remindWaterHour:12,theme:"pastel"};
const SYMPTOMS=["Πόνος κοιλιάς","Πονοκέφαλος","Κούραση","Πρήξιμο","Πόνος στήθους","Ακμή","Ναυτία","Κράμπες","Πόνος μέσης","Ευαισθησία"];
const MOODS=["Χαρούμενη","Ήρεμη","Ενεργητική","Κουρασμένη","Αγχώδης","Ευαίσθητη","Θλιμμένη","Ευερέθιστη"];
const REPORTS=[
 ["period","🌈","Περίοδος"],["temperature","🌡️","Θερμοκρασία"],
 ["weight","⚖️","Βάρος"],["intimacy","💗","Σεξουαλική ζωή"],
 ["ovulation","🧪","Τεστ ωορρηξίας"],["symptoms","🌩️","Συμπτώματα"],
 ["sleep","🌙","Ύπνος"],["breast","🎀","Αυτοεξέταση μαστού"],
 ["water","💧","Πιείτε νερό"]
];
const $=id=>document.getElementById(id);
const escapeHtml=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const int=(value,fallback)=>{const n=Number(value);return Number.isFinite(n)?n:fallback};
const isoDate=(d=new Date())=>[d.getFullYear(),String(d.getMonth()+1).padStart(2,"0"),String(d.getDate()).padStart(2,"0")].join("-");
const parseDay=iso=>new Date(String(iso)+"T12:00:00");
const addDays=(day,n)=>{const d=parseDay(day);d.setDate(d.getDate()+n);return isoDate(d)};
const diffDays=(a,b)=>Math.round((Date.UTC(+a.slice(0,4),+a.slice(5,7)-1,+a.slice(8,10))-Date.UTC(+b.slice(0,4),+b.slice(5,7)-1,+b.slice(8,10)))/86400000);
const validDate=iso=>/^\d{4}-\d{2}-\d{2}$/.test(iso)&&isoDate(parseDay(iso))===iso;
const dateLabel=iso=>new Intl.DateTimeFormat("el-GR",{day:"numeric",month:"short",year:"numeric"}).format(parseDay(iso));
const monthLabel=(year,month)=>new Intl.DateTimeFormat("el-GR",{month:"long",year:"numeric"}).format(new Date(year,month,1));
const monthOf=iso=>{const d=parseDay(iso);return {year:d.getFullYear(),month:d.getMonth()}};
function normalizeSettings(value){
  const s=value&&typeof value==="object"&&!Array.isArray(value)?value:{};
  return {
    cycleLength:Math.max(15,Math.min(75,Math.round(int(s.cycleLength,29)))),
    periodLength:Math.max(1,Math.min(12,Math.round(int(s.periodLength,5)))),
    remindPeriod:s.remindPeriod!==false,
    remindWater:s.remindWater===true,
    remindWaterHour:Math.max(0,Math.min(23,Math.floor(int(s.remindWaterHour,12)))),
    theme:"pastel"
  };
}
const defaultData=()=>({version:2,settings:normalizeSettings(DEFAULTS),days:{},sourceFpc:null});
let state=defaultData();
let cloud=null;
function load(){
  try{
    const raw=JSON.parse(localStorage.getItem(STORAGE)||"null");
    if(raw&&typeof raw==="object"&&raw.days&&typeof raw.days==="object"&&!Array.isArray(raw.days)){
      state={version:2,settings:normalizeSettings(raw.settings),days:{},
        sourceFpc:raw.sourceFpc?.format==="fpc-v18"?raw.sourceFpc:null};
      for(const [day,entry] of Object.entries(raw.days))
        if(validDate(day)&&entry&&typeof entry==="object"&&!Array.isArray(entry))
          state.days[day]=normalizeEntry(entry);
    }
  }catch(error){console.warn("MyDiary storage unavailable",error)}
}
function normalizeEntry(input){
  const entry=input||{};
  return {
    period:entry.period===true,flow:["ελαφριά","μέτρια","έντονη"].includes(entry.flow)?entry.flow:"μέτρια",
    symptoms:Array.isArray(entry.symptoms)?entry.symptoms.filter(s=>SYMPTOMS.includes(s)).slice(0,15):[],
    mood:MOODS.includes(entry.mood)?entry.mood:"",
    weight:entry.weight===""?"":Number.isFinite(Number(entry.weight))&&Number(entry.weight)>0&&Number(entry.weight)<500?String(entry.weight):"",
    temperature:entry.temperature===""?"":Number.isFinite(Number(entry.temperature))&&Number(entry.temperature)>30&&Number(entry.temperature)<44?String(entry.temperature):"",
    intimacy:entry.intimacy===true,ovulation:entry.ovulation===true,
    sleep:entry.sleep===""?"":Number.isFinite(Number(entry.sleep))&&Number(entry.sleep)>=0&&Number(entry.sleep)<=24?String(entry.sleep):"",
    water:Number.isFinite(Number(entry.water))?Math.max(0,Math.min(30,Math.round(Number(entry.water)))):0,
    breast:entry.breast===true,notes:String(entry.notes||"").slice(0,2000)
  };
}
function save(){
  // Never store new diary records as plaintext in localStorage.
  // Every edit queues a client-encrypted upload to the user's private vault.
  if(!cloud?.ready){toast("Συνδέσου για να αποθηκεύσεις στο Cloudflare.");return false}
  return cloud.queueSave(state);
}
const entries=()=>Object.entries(state.days).sort(([a],[b])=>a.localeCompare(b));
function periodStarts(){
  let last="";
  const dates=entries().filter(([,e])=>e.period).map(([d])=>d);
  return dates.filter(day=>{const first=!last||diffDays(day,last)>1;last=day;return first});
}
function cycleStats(){
  const starts=periodStarts(),lengths=[];
  for(let i=1;i<starts.length;i++){
    const gap=diffDays(starts[i],starts[i-1]);
    if(gap>=15&&gap<=75)lengths.push(gap);
  }
  const cycle=lengths.length?Math.round(lengths.slice(-6).reduce((a,b)=>a+b,0)/Math.min(6,lengths.length)):Math.max(15,Math.min(75,int(state.settings.cycleLength,29)));
  const runs=[];
  for(const start of starts){
    let day=start,size=0;
    while(state.days[day]?.period&&size<15){size++;day=addDays(day,1)}
    if(size)runs.push(size);
  }
  const period=runs.length?Math.round(runs.slice(-6).reduce((a,b)=>a+b,0)/Math.min(6,runs.length)):Math.max(1,Math.min(12,int(state.settings.periodLength,5)));
  return {starts,cycle,periodLength:period,lengths};
}
function predictions(){
  const stats=cycleStats(),today=isoDate();
  const ref=stats.starts.at(-1)||null;
  if(!ref)return {period:null,ovulation:null,fertile:[],...stats};
  let predicted=addDays(ref,stats.cycle);
  for(let i=0;i<500&&diffDays(predicted,today)<-stats.periodLength;i++)predicted=addDays(predicted,stats.cycle);
  const ovulation=addDays(predicted,-14),fertile=[];
  for(let i=-5;i<=1;i++)fertile.push(addDays(ovulation,i));
  return {period:predicted,ovulation,fertile,...stats};
}
function isPredictedPeriod(day,p){
  if(!p.period)return false;
  for(let n=-2;n<=2;n++){
    const start=addDays(p.period,n*p.cycle);
    if(diffDays(day,start)>=0&&diffDays(day,start)<p.periodLength)return true;
  }
  return false;
}
let page="today",selected=isoDate(),calendarMonth=monthOf(isoDate()),reportDetail="";
const main=$("main");
function toast(message){
  const box=$("toast");box.textContent=message;box.hidden=false;
  clearTimeout(toast.timer);toast.timer=setTimeout(()=>box.hidden=true,3200);
}
function setPage(next){
  if(next==="add")selected=validDate(selected)?selected:isoDate();
  page=next;reportDetail="";render();window.scrollTo({top:0,behavior:"instant"});
}
function closeDrawer(){
  $("drawer").classList.remove("open");$("drawerBackdrop").hidden=true;$("drawer").setAttribute("aria-hidden","true");$("menuButton").setAttribute("aria-expanded","false");
}
function render(){
  const titles={today:"Σήμερα",calendar:monthLabel(calendarMonth.year,calendarMonth.month).replace(/\s+\d{4}$/,""),add:"Καταχώρηση",reminders:"Υπενθυμίσεις",reports:reportDetail?"Αναφορά":"Αναφορά",settings:"Ρυθμίσεις"};
  $("pageTitle").textContent=titles[page]||"MyDiary";
  $("topAction").hidden=page==="settings"||page==="add";
  document.querySelectorAll("[data-nav]").forEach(b=>b.classList.toggle("active",b.dataset.nav===page));
  if(page==="today")renderToday();
  else if(page==="calendar")renderCalendar();
  else if(page==="add")renderAdd();
  else if(page==="reminders")renderReminders();
  else if(page==="reports")renderReports();
  else if(page==="settings")renderSettings();
}
function recentRecords(){
  return entries().filter(([,e])=>e.period||e.notes||e.symptoms.length||e.mood||e.weight||e.temperature||e.intimacy||e.ovulation||e.sleep||e.water||e.breast).reverse();
}
function renderToday(){
  const p=predictions(),today=isoDate();
  let headline="Καταχώρησε την περίοδό σου",subtitle="Οι επόμενες εκτιμήσεις θα εμφανιστούν εδώ.";
  if(p.period){
    const days=diffDays(p.period,today);
    headline=days>0?"Σε "+days+" ημέρες":days===0?"Πιθανή έναρξη σήμερα":"Πιθανή έναρξη περιόδου";
    subtitle="Επόμενη εκτιμώμενη περίοδος: "+dateLabel(p.period);
  }
  const logged=state.days[today],todayParts=[];
  if(logged?.period)todayParts.push("Περίοδος");
  if(logged?.mood)todayParts.push(logged.mood);
  if(logged?.symptoms?.length)todayParts.push(logged.symptoms.join(", "));
  if(logged?.water)todayParts.push(logged.water+" ποτήρια νερό");
  main.innerHTML='<div class="soft-card hero"><small>ΤΟ ΗΜΕΡΟΛΟΓΙΟ ΣΟΥ 🌸</small><strong>'+escapeHtml(headline)+'</strong><p>'+escapeHtml(subtitle)+'</p><div class="hero-actions"><button class="btn" data-go="add">+ Καταχώρηση</button><button class="btn sec" data-go="calendar">Ημερολόγιο</button></div></div>'+
    '<div class="stats"><div class="stat"><label>Μέσος κύκλος</label><strong>'+p.cycle+'</strong><small>ημέρες</small></div><div class="stat"><label>Διάρκεια περιόδου</label><strong>'+p.periodLength+'</strong><small>ημέρες</small></div></div>'+
    '<div class="section-title"><h2>Σήμερα</h2><button class="text-action" data-go="add">Επεξεργασία</button></div>'+
    '<div class="card">'+(todayParts.length?'<p>'+escapeHtml(todayParts.join(" · "))+'</p>':'<p class="muted">Δεν έχεις καταχωρήσει κάτι για σήμερα.</p>')+
    '<button class="btn ghost mini" data-go="add">+ Προσθήκη στοιχείων</button></div>'+
    '<div class="section-title"><h2>Πρόσφατες εγγραφές</h2><button class="text-action" data-go="reports">Όλες</button></div>'+
    renderLogList(recentRecords().slice(0,5))+
    '<p class="hint">Οι προβλέψεις είναι ενδεικτικές και δεν αποτελούν μέθοδο αντισύλληψης ή ιατρική διάγνωση.</p>';
}
function renderLogList(records){
  if(!records.length)return '<div class="card empty"><span class="symbol">🌷</span>Οι καταχωρήσεις σου θα εμφανιστούν εδώ.</div>';
  return '<div class="log-list">'+records.map(([day,e])=>{
    const bits=[e.period?"Περίοδος":null,e.mood,e.symptoms.slice(0,2).join(", "),e.notes].filter(Boolean);
    return '<div class="log-item"><div class="date-block"><strong>'+escapeHtml(day.slice(8))+'</strong><small>'+escapeHtml(new Intl.DateTimeFormat("el-GR",{month:"short"}).format(parseDay(day)))+'</small></div><div><strong>'+escapeHtml(bits[0]||"Καταχώρηση")+'</strong><p>'+escapeHtml(bits.slice(1).join(" · ")||"Προβολή λεπτομερειών")+'</p></div><button data-edit="'+day+'">Άνοιγμα</button></div>';
  }).join("")+'</div>';
}
function renderCalendar(){
  const {year,month}=calendarMonth,p=predictions(),first=new Date(year,month,1),offset=(first.getDay()+6)%7;
  const count=new Date(year,month+1,0).getDate(),start=isoDate(new Date(year,month,1-offset));
  const cells=Math.ceil((offset+count)/7)*7,days=[];
  for(let i=0;i<cells;i++){
    const d=addDays(start,i),actual=state.days[d],isCurrent=d.slice(0,7)===isoDate(first).slice(0,7);
    const isPeriod=actual?.period,predicted=!isPeriod&&isPredictedPeriod(d,p),fertile=p.fertile.includes(d),ovulation=d===p.ovulation;
    const names=["day",!isCurrent?"other":"",isPeriod?"period":"",predicted?"predicted":"",fertile?"fertile":"",ovulation?"ovulation":"",d===isoDate()?"today":"",d===selected?"selected":""].filter(Boolean).join(" ");
    const previous=p.starts.filter(s=>s<=d).at(-1),cycleDay=previous?diffDays(d,previous)+1:0;
    days.push('<button type="button" class="'+names+'" data-day="'+d+'" aria-label="'+escapeHtml(dateLabel(d))+'"><span class="number">'+Number(d.slice(8))+(cycleDay>0&&cycleDay<=p.cycle?'<span class="cycle-number">'+cycleDay+'</span>':'')+'</span>'+(actual&&!isPeriod?'<span class="day-mark"></span>':ovulation?'<span class="day-mark"></span>':'')+'</button>');
  }
  const chosen=state.days[selected],selectedBits=[];
  if(chosen?.period)selectedBits.push("Καταγεγραμμένη περίοδος");
  if(chosen?.mood)selectedBits.push(chosen.mood);
  if(chosen?.symptoms?.length)selectedBits.push(chosen.symptoms.join(", "));
  if(chosen?.notes)selectedBits.push(chosen.notes);
  main.innerHTML='<div class="month-head"><button data-month="-1" aria-label="Προηγούμενος μήνας">‹</button><h2>'+escapeHtml(monthLabel(year,month))+'</h2><button data-month="1" aria-label="Επόμενος μήνας">›</button></div>'+
    '<div class="weekday-row">'+["Δευ","Τρ","Τετ","Πεμ","Παρ","Σαβ","Κυρ"].map(d=>"<span>"+d+"</span>").join("")+'</div>'+
    '<div class="calendar-grid">'+days.join("")+'</div>'+
    '<div class="legend"><span style="--swatch:#ff9aa8">Περίοδος</span><span style="--swatch:#ffdce6">Πρόβλεψη</span><span style="--swatch:#cab8ee">Γόνιμο διάστημα</span></div>'+
    '<div class="day-summary"><strong>'+escapeHtml(dateLabel(selected))+'</strong><p>'+escapeHtml(selectedBits.join(" · ")||"Δεν υπάρχουν καταχωρήσεις.")+'</p><button class="btn mini" style="margin-top:12px" data-go="add">+ Καταχώρηση</button></div>'+
    '<p class="hint">Οι πιθανές γόνιμες ημέρες υπολογίζονται προσεγγιστικά και δεν πρέπει να χρησιμοποιούνται για αντισύλληψη.</p>';
}
function renderAdd(){
  const e=normalizeEntry(state.days[selected]||{}),field=(label,id,type,value,attrs="")=>'<label class="entry-label" for="'+id+'">'+label+'</label><input class="form-control" id="'+id+'" type="'+type+'" value="'+escapeHtml(value)+'" '+attrs+'>';
  main.innerHTML='<form id="entryForm"><div class="soft-card"><div class="eyebrow">ΗΜΕΡΗΣΙΑ ΚΑΤΑΧΩΡΗΣΗ</div>'+field("Ημερομηνία","entryDate","date",selected,"required")+'</div>'+
    '<div class="card"><div class="toggle-row"><label for="entryPeriod"><strong>🌸 Περίοδος</strong></label><input type="checkbox" id="entryPeriod" '+(e.period?"checked":"")+'></div>'+
    '<label class="entry-label" for="entryFlow">Ένταση ροής</label><select class="form-control" id="entryFlow">'+["ελαφριά","μέτρια","έντονη"].map(v=>'<option value="'+v+'" '+(e.flow===v?"selected":"")+'>'+v+'</option>').join("")+'</select>'+
    '<div class="toggle-row"><label for="entryPeriodRange">Σήμανση περιόδου για '+int(state.settings.periodLength,5)+' ημέρες συνολικά<br><small class="muted">Προαιρετικό · διατηρεί άλλες καταχωρήσεις</small></label><input type="checkbox" id="entryPeriodRange"></div>'+
    '<label class="entry-label">Διάθεση</label><div class="pill-row" id="moodPills">'+MOODS.map(v=>'<button class="pill '+(e.mood===v?"selected":"")+'" type="button" data-mood="'+escapeHtml(v)+'">'+escapeHtml(v)+'</button>').join("")+'</div>'+
    '<label class="entry-label">Συμπτώματα</label><div class="checklist" id="symptomPills">'+SYMPTOMS.map(v=>'<button class="pill '+(e.symptoms.includes(v)?"selected":"")+'" type="button" data-symptom="'+escapeHtml(v)+'">'+escapeHtml(v)+'</button>').join("")+'</div></div>'+
    '<div class="card"><div class="form-grid"><div>'+field("Βάρος (kg)","entryWeight","number",e.weight,'min="1" max="499" step="0.1" inputmode="decimal"')+'</div><div>'+field("Θερμοκρασία (°C)","entryTemp","number",e.temperature,'min="30" max="44" step="0.01" inputmode="decimal"')+'</div><div>'+field("Ύπνος (ώρες)","entrySleep","number",e.sleep,'min="0" max="24" step="0.5" inputmode="decimal"')+'</div><div>'+field("Νερό (ποτήρια)","entryWater","number",e.water,'min="0" max="30" step="1"')+'</div></div>'+
    '<div class="toggle-row"><label for="entryIntimacy">💗 Σεξουαλική ζωή</label><input type="checkbox" id="entryIntimacy" '+(e.intimacy?"checked":"")+'></div>'+
    '<div class="toggle-row"><label for="entryOvulation">🧪 Θετικό τεστ ωορρηξίας</label><input type="checkbox" id="entryOvulation" '+(e.ovulation?"checked":"")+'></div>'+
    '<div class="toggle-row"><label for="entryBreast">🎀 Αυτοεξέταση μαστού</label><input type="checkbox" id="entryBreast" '+(e.breast?"checked":"")+'></div>'+
    '<label class="entry-label" for="entryNotes">Προσωπικές σημειώσεις</label><textarea class="form-control" id="entryNotes" maxlength="2000" placeholder="Γράψε ό,τι θέλεις…">'+escapeHtml(e.notes)+'</textarea></div>'+
    '<button type="submit" class="btn full">Αποθήκευση καταχώρησης</button>'+
    (state.days[selected]?'<button type="button" id="deleteEntry" class="btn danger full" style="margin-top:10px">Διαγραφή καταχώρησης</button>':'')+
    '<p class="hint">Τα δεδομένα αποθηκεύονται μόνο σε αυτή τη συσκευή.</p></form>';
  if(e.mood)main.dataset.mood=e.mood;else delete main.dataset.mood;
}
function renderReminders(){
  const p=predictions(),next=p.period?dateLabel(p.period):"Δεν έχει καταχωρηθεί περίοδος";
  main.innerHTML='<div class="soft-card"><span class="eyebrow">ΜΙΚΡΕΣ ΥΠΕΝΘΥΜΙΣΕΙΣ</span><h2 style="margin:10px 0">Ό,τι χρειάζεσαι, στην ώρα του 🌷</h2><p class="hint">Οι ειδοποιήσεις του browser λειτουργούν όσο η εφαρμογή παραμένει ανοιχτή.</p></div>'+
   '<div class="card"><div class="toggle-row"><label for="remindPeriod"><strong>Επόμενη περίοδος</strong><br><small class="muted">'+escapeHtml(next)+'</small></label><input id="remindPeriod" type="checkbox" '+(state.settings.remindPeriod?"checked":"")+'></div>'+
   '<div class="toggle-row"><label for="remindWater"><strong>Να πίνεις νερό</strong><br><small class="muted">Καθημερινή υπενθύμιση</small></label><input id="remindWater" type="checkbox" '+(state.settings.remindWater?"checked":"")+'></div>'+
   '<label class="entry-label" for="remindHour">Ώρα για νερό</label><input class="form-control" id="remindHour" type="time" value="'+String(state.settings.remindWaterHour||12).padStart(2,"0")+':00">'+
   '<button type="button" id="allowNotifications" class="btn sec full" style="margin-top:17px">Ενεργοποίηση ειδοποιήσεων</button></div>'+
   '<div class="notice">Για αξιόπιστες ειδοποιήσεις όταν η εφαρμογή είναι κλειστή, απαιτείται ξεχωριστή υπηρεσία push. Οι εκτιμήσεις κύκλου δεν είναι ιατρικές συμβουλές.</div>';
}
function reportFiltered(key){
  return entries().filter(([,e])=>key==="period"?e.period:key==="symptoms"?e.symptoms.length:key==="weight"?e.weight:key==="temperature"?e.temperature:key==="intimacy"?e.intimacy:key==="ovulation"?e.ovulation:key==="sleep"?e.sleep:key==="breast"?e.breast:key==="water"?e.water:false).reverse();
}
function chart(data,key){
  const points=data.slice(0,20).reverse().map(([,e],i)=>[i,Number(e[key])]).filter(p=>Number.isFinite(p[1]));
  if(points.length<2)return '<p class="empty">Χρειάζονται τουλάχιστον δύο μετρήσεις για διάγραμμα.</p>';
  const values=points.map(p=>p[1]),min=Math.min(...values),max=Math.max(...values),range=max-min||1;
  const coords=points.map(([i,n])=>(22+i*290/(points.length-1)).toFixed(1)+","+(115-(n-min)/range*87).toFixed(1)).join(" ");
  return '<svg viewBox="0 0 330 145" role="img" aria-label="Διάγραμμα μετρήσεων" style="width:100%;max-width:440px"><path d="M18 117H314M18 25H314" stroke="#eee7f2" stroke-width="1"/><polyline points="'+coords+'" fill="none" stroke="#de75b0" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>'+points.map(([i,n])=>'<circle cx="'+(22+i*290/(points.length-1)).toFixed(1)+'" cy="'+(115-(n-min)/range*87).toFixed(1)+'" r="3.5" fill="#7d6ab7"/>').join("")+'<text x="20" y="139" font-size="10" fill="#9891a1">Παλαιότερα</text><text x="265" y="139" font-size="10" fill="#9891a1">Νεότερα</text></svg>';
}
function renderReports(){
  if(reportDetail){
    const data=reportFiltered(reportDetail),label=REPORTS.find(r=>r[0]===reportDetail),isChart=["weight","temperature","sleep","water"].includes(reportDetail);
    const value=([,e])=>reportDetail==="symptoms"?e.symptoms.join(", "):reportDetail==="period"?e.flow:reportDetail==="intimacy"?"Καταχώρηση":reportDetail==="ovulation"?"Θετικό":reportDetail==="breast"?"Ολοκληρώθηκε":reportDetail==="weight"?e.weight+" kg":reportDetail==="temperature"?e.temperature+" °C":reportDetail==="sleep"?e.sleep+" ώρες":e.water+" ποτήρια";
    main.innerHTML='<button class="text-action" data-report-back>‹ Πίσω στις αναφορές</button><h2 class="report-section-header">'+label[1]+' '+label[2]+'</h2><div class="card" style="margin-top:15px"><strong>'+data.length+' καταχωρήσεις</strong>'+(isChart?chart(data,reportDetail):'')+'</div><div class="log-list">'+(data.length?data.slice(0,70).map(record=>'<div class="log-item"><div class="date-block"><strong>'+record[0].slice(8)+'</strong><small>'+record[0].slice(5,7)+'</small></div><div><strong>'+escapeHtml(value(record))+'</strong><p>'+escapeHtml(dateLabel(record[0]))+'</p></div><button data-edit="'+record[0]+'">Άνοιγμα</button></div>').join(""):'<div class="empty">Δεν υπάρχουν καταχωρήσεις.</div>')+'</div>';
    return;
  }
  const p=predictions();
  main.innerHTML='<section class="reports-summary"><h2>Μέση τιμή</h2><div class="report-line"><span>Διάρκεια κύκλου</span><div><strong>'+p.cycle+'</strong><em>Ημέρες</em></div></div><div class="report-line"><span>Διάρκεια περιόδου</span><div><strong>'+p.periodLength+'</strong><em>Ημέρες</em></div></div></section>'+
    '<div class="report-grid">'+REPORTS.map(([key,emoji,label])=>'<button class="report-tile" data-report="'+key+'"><span class="report-emoji" aria-hidden="true">'+emoji+'</span><span>'+label+'</span></button>').join("")+'</div>'+
    '<p class="hint">Οι μέσοι όροι υπολογίζονται από τις καταχωρήσεις σου. Οι προβλέψεις είναι μόνο ενδεικτικές.</p>';
}
function renderSettings(){
  main.innerHTML='<div class="soft-card"><span class="eyebrow">ΠΡΟΣΩΠΙΚΕΣ ΡΥΘΜΙΣΕΙΣ</span><h2 style="margin:9px 0 3px">Το ημερολόγιό σου 🌸</h2><p class="hint">Όλες οι καταχωρήσεις παραμένουν μόνο σε αυτή τη συσκευή.</p></div>'+
   '<div class="card"><h2>Προεπιλεγμένες διάρκειες</h2><label class="entry-label" for="cycleSetting">Διάρκεια κύκλου (ημέρες)</label><input class="form-control" type="number" min="15" max="75" id="cycleSetting" value="'+int(state.settings.cycleLength,29)+'">'+
   '<label class="entry-label" for="periodSetting">Διάρκεια περιόδου (ημέρες)</label><input class="form-control" type="number" min="1" max="12" id="periodSetting" value="'+int(state.settings.periodLength,5)+'">'+
   '<button class="btn full" id="saveSettings" style="margin-top:15px">Αποθήκευση ρυθμίσεων</button></div>'+
   '<div class="card"><h2>Online λογαριασμός</h2><p class="hint">Συνδεδεμένος: '+escapeHtml(cloud?.username||"")+'. Το ημερολόγιο συγχρονίζεται κρυπτογραφημένο μέσω Cloudflare D1.</p>'+
   '<button type="button" class="btn sec full" id="cloudSyncNow">Έλεγχος συγχρονισμού</button>'+
   '<button type="button" class="btn ghost full" id="cloudPendingDownload" style="margin-top:9px">Εξαγωγή εκκρεμών αλλαγών</button>'+
   '<button type="button" class="btn ghost full" id="cloudLogout" style="margin-top:9px">Αποσύνδεση</button></div>'+
   '<div class="card"><h2>Τα δεδομένα σου</h2><p class="hint">Κράτησε αντίγραφο αν αλλάξεις κινητό ή καθαρίσεις τα δεδομένα browser.</p>'+
   '<button class="btn sec full" id="exportData">↓ Εξαγωγή αντιγράφου JSON</button>'+
   '<label class="entry-label" for="importFile">Εισαγωγή Period Calendar .fpc ή JSON</label><input class="form-control" type="file" accept=".fpc,.json,application/json" id="importFile">'+
   '<p class="hint">Το αρχείο διαβάζεται στη συσκευή. Δεν ανεβαίνει στο Cloudflare. Οι ήδη καταχωρημένες ημέρες δεν αντικαθίστανται όταν εισάγεις παλιό FPC.</p>'+
   (state.sourceFpc?.periodRecords?'<p class="notice">📚 Παλαιό ιστορικό: '+state.sourceFpc.periodRecords.length+' κύκλοι · '+(state.sourceFpc.dailyRecords?.length||0)+' ημερήσιες καταχωρήσεις. Οι αρνητικές διάρκειες έχουν σημανθεί ως εκτιμήσεις.</p>':'')+
   '<button class="btn danger full" id="eraseData" style="margin-top:24px">Διαγραφή όλων των δεδομένων</button></div>'+
   '<div class="notice">Το ημερολόγιο κύκλου δεν προβλέπει με ακρίβεια την ωορρηξία και δεν μπορεί να χρησιμοποιηθεί για αντισύλληψη.</div>';
}
function saveEntry(){
  const day=$("entryDate").value;
  if(!validDate(day)){toast("Διάλεξε έγκυρη ημερομηνία.");return}
  const symptoms=Array.from(main.querySelectorAll("[data-symptom].selected")).map(b=>b.dataset.symptom);
  const entry=normalizeEntry({
    period:$("entryPeriod").checked,flow:$("entryFlow").value,symptoms,
    mood:main.dataset.mood||"",weight:$("entryWeight").value,temperature:$("entryTemp").value,
    sleep:$("entrySleep").value,water:$("entryWater").value,
    intimacy:$("entryIntimacy").checked,ovulation:$("entryOvulation").checked,
    breast:$("entryBreast").checked,notes:$("entryNotes").value
  });
  const range=$("entryPeriodRange").checked;
  if(range&&!entry.period){toast("Επίλεξε πρώτα «Περίοδος» για πολλές ημέρες.");return}
  // An explicit multi-day action only toggles period/flow on later days.
  // Existing symptoms, notes, temperature etc. are never overwritten.
  const daysCount=range?Math.max(1,Math.min(12,int(state.settings.periodLength,5))):1;
  const previous=JSON.stringify(state.days);
  state.days[day]=entry;
  for(let i=1;i<daysCount;i++){
    const next=addDays(day,i);
    const existing=normalizeEntry(state.days[next]||{});
    state.days[next]={...existing,period:true,flow:entry.flow};
  }
  if(!save()){
    state.days=JSON.parse(previous);
    return;
  }
  selected=day;calendarMonth=monthOf(day);
  toast(range?"Καταχωρήθηκαν "+daysCount+" ημέρες περιόδου 🌷":"Η καταχώρηση αποθηκεύτηκε 🌷");
  setPage("calendar");
}
function exportBackup(){
  const blob=new Blob([JSON.stringify({app:"MyDiary",exportedAt:new Date().toISOString(),data:state},null,2)],{type:"application/json"});
  const url=URL.createObjectURL(blob),a=document.createElement("a");
  a.href=url;a.download="mydiary-backup-"+isoDate()+".json";document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function mergeFpcArchive(previous,incoming){
  if(incoming?.format!=="fpc-v18")return previous;
  if(previous?.format!=="fpc-v18")return incoming;
  const mergeRows=(oldRows,newRows)=>{
    const old=Array.isArray(oldRows)?oldRows:[];
    const incomingRows=Array.isArray(newRows)?newRows:[];
    const seen=new Set(old.map(row=>JSON.stringify(row)));
    return old.concat(incomingRows.filter(row=>!seen.has(JSON.stringify(row))));
  };
  return {...previous,periodRecords:mergeRows(previous.periodRecords,incoming.periodRecords),
    dailyRecords:mergeRows(previous.dailyRecords,incoming.dailyRecords)};
}
async function importBackup(file){
  const isFpc=/\.fpc$/i.test(file?.name||"");
  if(!file||file.size>(isFpc?12_000_000:6_000_000)){
    toast("Το αρχείο είναι πολύ μεγάλο ή άκυρο.");return;
  }
  try{
    toast("Διαβάζω το αντίγραφο…");
    const parsed=isFpc?await convertFpc(await file.arrayBuffer()):JSON.parse(await file.text());
    const backup=parsed?.app==="MyDiary"?parsed.data:parsed;
    if(!backup||!backup.days||typeof backup.days!=="object"||Array.isArray(backup.days))
      throw Error("Μη έγκυρο αντίγραφο.");
    const days=Object.entries(backup.days);
    if(days.length>20000)throw Error("Το αντίγραφο περιέχει υπερβολικά πολλές εγγραφές.");
    const isLegacy=isFpc||backup.sourceFpc?.format==="fpc-v18";
    const oldCount=Object.keys(state.days).length;
    const valid=days.filter(([day,entry])=>validDate(day)&&entry&&typeof entry==="object"&&!Array.isArray(entry));
    const overlap=valid.filter(([day])=>Object.hasOwn(state.days,day)).length;
    const message=isLegacy?
      "Βρέθηκαν "+(parsed.importInfo?.periodRecords??backup.sourceFpc?.periodRecords?.length??0)+
      " κύκλοι και "+(parsed.importInfo?.dailyRecords??backup.sourceFpc?.dailyRecords?.length??0)+
      " ημερήσιες εγγραφές. Θα προστεθούν "+(valid.length-overlap)+
      " νέες ημέρες χωρίς να αντικατασταθούν οι "+overlap+
      " υπάρχουσες. Οι αρνητικές διάρκειες FPC είναι εκτιμήσεις. Συνέχεια;":
      "Η επαναφορά JSON θα ΑΝΤΙΚΑΤΑΣΤΗΣΕΙ όλες τις τωρινές εγγραφές. Συνέχεια;";
    if(!confirm(message))return;
    const prior=state;
    const next=isLegacy?{
      version:2,
      settings:oldCount?{...state.settings}:normalizeSettings(backup.settings),
      days:{...state.days},
      sourceFpc:mergeFpcArchive(state.sourceFpc,backup.sourceFpc)
    }:defaultData();
    if(!isLegacy){
      next.settings=normalizeSettings(backup.settings);
      next.sourceFpc=backup.sourceFpc?.format==="fpc-v18"?backup.sourceFpc:null;
    }
    let added=0;
    for(const [day,entry] of valid){
      if(isLegacy&&Object.hasOwn(next.days,day))continue;
      next.days[day]=normalizeEntry(entry);
      added++;
    }
    state=next;
    if(!save()){state=prior;return}
    toast(isLegacy?"Προστέθηκαν "+added+" ημέρες από παλιό backup.":"Επαναφέρθηκαν "+added+" ημέρες.");
    setPage("today");
  }catch(error){
    toast("Αδυναμία εισαγωγής: "+(error?.message||"Άγνωστο αρχείο."));
  }
}
function checkReminders(){
  if(document.visibilityState==="hidden"||Notification.permission!=="granted")return;
  const p=predictions(),today=isoDate(),dayKey="mydiary-reminded-"+today;
  try{
    const notified=JSON.parse(sessionStorage.getItem(dayKey)||"{}");
    if(state.settings.remindPeriod&&p.period&&diffDays(p.period,today)===1&&!notified.period){
      new Notification("MyDiary 🌸",{body:"Η επόμενη εκτιμώμενη περίοδος είναι αύριο."});
      notified.period=true;
    }
    const hour=new Date().getHours();
    if(state.settings.remindWater&&hour>=int(state.settings.remindWaterHour,12)&&!notified.water){
      new Notification("MyDiary 💧",{body:"Μια μικρή υπενθύμιση να πιεις νερό."});
      notified.water=true;
    }
    sessionStorage.setItem(dayKey,JSON.stringify(notified));
  }catch{}
}
document.addEventListener("click",event=>{
  const target=event.target.closest("button");if(!target)return;
  if(target.dataset.nav){setPage(target.dataset.nav);return}
  if(target.dataset.go){setPage(target.dataset.go);return}
  if(target.dataset.drawer){closeDrawer();setPage(target.dataset.drawer);return}
  if(target.dataset.month){
    const d=new Date(calendarMonth.year,calendarMonth.month+Number(target.dataset.month),1);
    calendarMonth={year:d.getFullYear(),month:d.getMonth()};render();return;
  }
  if(target.dataset.day){selected=target.dataset.day;render();return}
  if(target.dataset.edit){selected=target.dataset.edit;setPage("add");return}
  if(target.dataset.report){reportDetail=target.dataset.report;render();return}
  if(target.hasAttribute("data-report-back")){reportDetail="";render();return}
  if(target.dataset.mood){
    main.dataset.mood=main.dataset.mood===target.dataset.mood?"":target.dataset.mood;
    main.querySelectorAll("[data-mood]").forEach(b=>b.classList.toggle("selected",b.dataset.mood===main.dataset.mood));return;
  }
  if(target.dataset.symptom){target.classList.toggle("selected");return}
  if(target.id==="deleteEntry"){
    if(confirm("Να διαγραφεί η καταχώρηση της "+dateLabel(selected)+";")){
      delete state.days[selected];save();toast("Η καταχώρηση διαγράφηκε.");setPage("calendar");
    }return;
  }
  if(target.id==="saveSettings"){
    state.settings.cycleLength=Math.max(15,Math.min(75,int($("cycleSetting").value,29)));
    state.settings.periodLength=Math.max(1,Math.min(12,int($("periodSetting").value,5)));
    save();toast("Οι ρυθμίσεις αποθηκεύτηκαν.");render();return;
  }
  if(target.id==="cloudSyncNow"){cloud?.sync(true);return}
  if(target.id==="cloudPendingDownload"){cloud?.downloadPending();return}
  if(target.id==="cloudLogout"){cloud?.logout();return}
  if(target.id==="exportData"){exportBackup();return}
  if(target.id==="eraseData"){
    if(confirm("Προσοχή: διαγραφή ΟΛΩΝ των ημερολογιακών εγγραφών από αυτή τη συσκευή;")&&confirm("Τελική επιβεβαίωση: τα δεδομένα δεν θα μπορούν να ανακτηθούν χωρίς αντίγραφο.")){
      state=defaultData();save();toast("Όλα τα δεδομένα διαγράφηκαν.");setPage("today");
    }return;
  }
  if(target.id==="allowNotifications"){
    if(!("Notification" in window)){toast("Ο browser δεν υποστηρίζει ειδοποιήσεις.");return}
    Notification.requestPermission().then(status=>toast(status==="granted"?"Οι ειδοποιήσεις ενεργοποιήθηκαν.":"Οι ειδοποιήσεις δεν επιτράπηκαν."));return;
  }
});
document.addEventListener("submit",event=>{
  if(event.target.id==="entryForm"){event.preventDefault();saveEntry()}
});
document.addEventListener("change",event=>{
  const t=event.target;
  if(t.id==="entryDate"&&validDate(t.value)){selected=t.value;renderAdd()}
  if(t.id==="remindPeriod"){state.settings.remindPeriod=t.checked;save()}
  if(t.id==="remindWater"){state.settings.remindWater=t.checked;save()}
  if(t.id==="remindHour"){state.settings.remindWaterHour=Number(t.value.split(":")[0]);save()}
  if(t.id==="importFile"&&t.files?.[0])importBackup(t.files[0]);
});
$("menuButton").addEventListener("click",()=>{
  const open=!$("drawer").classList.contains("open");
  $("drawer").classList.toggle("open",open);
  $("drawerBackdrop").hidden=!open;$("drawer").setAttribute("aria-hidden",String(!open));
  $("menuButton").setAttribute("aria-expanded",String(open));
});
$("drawerBackdrop").addEventListener("click",closeDrawer);
$("topAction").addEventListener("click",()=>{selected=isoDate();calendarMonth=monthOf(selected);setPage(page==="reports"?"calendar":page)});
// Existing plaintext storage is consulted only for one-time migration from
// the original local-only app, and removed AFTER confirmed cloud upload.
render();
cloud=createCloud({
  canRefresh:()=>page!=="add"&&page!=="settings",
  readState:()=>state,
  applyState:raw=>{
    const fresh=defaultData();
    fresh.settings=normalizeSettings(raw.settings);
    if(raw.sourceFpc?.format==="fpc-v18")fresh.sourceFpc=raw.sourceFpc;
    const days=Object.entries(raw.days||{});
    if(days.length>20000)throw Error("Υπερβολικά πολλές εγγραφές στη βάση.");
    for(const [day,entry] of days)
      if(validDate(day)&&entry&&typeof entry==="object")
        fresh.days[day]=normalizeEntry(entry);
    state=fresh;
    render();
  },
  loadLegacy:()=>{
    load();
    return state;
  },
  onStatus:(msg,type)=>{
    const banner=$("cloudSyncBanner");
    banner.textContent=msg;
    banner.classList.toggle("error",type==="error");
    banner.classList.toggle("ok",type==="ok");
    banner.hidden=false;
  },
  onReady:username=>{
    if(!username){state=defaultData();render()}
    else render();
  }
});
cloud.mount();
if("serviceWorker" in navigator&&location.protocol==="https:")
  navigator.serviceWorker.register("/sw.js").catch(()=>{});
if("Notification" in window){setTimeout(checkReminders,2500);setInterval(checkReminders,60_000)}
