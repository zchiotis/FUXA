'use strict';
const pages=[['overview','Εγκατάσταση'],...[1,2,3,4,5,6].map(n=>['r'+n,'Robot '+n]),['buffer','AGV buffer'],['deliveries','Παραδόσεις JH'],['sap','SAP'],['eidos','EIDOS'],['wrapper','Wrapper'],['palomats','Palomats'],['diagnostics','Diagnostics'],['events','Events']];
const params=new URLSearchParams(location.search), page=pages.some(p=>p[0]===params.get('page'))?params.get('page'):'overview';
if(params.get('embed')==='1')document.body.classList.add('embed');
document.getElementById('title').textContent=pages.find(p=>p[0]===page)[1];
document.getElementById('navigation').innerHTML=pages.map(([id,name])=>`<a href="?page=${id}" class="${id===page?'active':''}">${name}</a>`).join('');
const escape=value=>String(value??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const card=(title,body)=>`<section class="card"><h2>${escape(title)}</h2>${body}</section>`;
const note=text=>`<div class="notice">${escape(text)}</div>`;
const table=(headers,rows)=>`<div class="table-wrap"><table><thead><tr>${headers.map(h=>`<th>${escape(h)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
const row=items=>`<tr>${items.map(i=>`<td>${i}</td>`).join('')}</tr>`;
function show(item,boolean=false){
    if(!item||item.quality==='unknown')return '<span class="badge unknown">ΑΓΝΩΣΤΟ</span>';
    const value=boolean?(item.value?'1 · ON':'0 · OFF'):escape(item.value);
    return `<span class="${escape(item.quality)}">${value}</span>${item.quality!=='good'?`<span class="quality-note">${item.quality==='stale'?'ΠΑΛΙΑ ΔΕΔΟΜΕΝΑ':'ΜΗ ΕΓΚΥΡΟ'} · τελευταία γνωστή τιμή</span>`:''}`;
}
const quality=item=>item?`<span class="badge ${escape(item.quality)}">${escape(item.quality.toUpperCase())}</span>`:'<span class="badge unknown">UNKNOWN</span>';
let latest=null,events=[],cursor=null,loadingEvents=false,deliveryState={sourceConfigured:false,entries:[]};
async function request(url){
    let token='';try{token=parent.fuxaAccessToken||JSON.parse(sessionStorage.getItem('currentUser')||'{}').token||'';}catch(_){}
    const response=await fetch(url,{cache:'no-store',headers:token?{'x-access-token':token}:{}});
    if(!response.ok)throw new Error('FUXA HTTP '+response.status);
    return response.json();
}
function stations(data,number){
    const list=data.manifest.stations.filter(s=>number?s.robot===number:s.name==='WRAP-IN');
    return table(['Station / DB100 byte','Operational','Occupied','AGV req','ROB req','Release','Pallet type','SSCC / quality'],list.map(s=>{
        const v=name=>data.cplc[s.name+'.'+name];
        return row([`${escape(s.name)}<span class="quality-note">${s.byte}</span>`,...['Operational','Occupied','AGVRequest','ROBRequest','Release'].map(f=>show(v(f),true)),show(v('PalletType')),`${show(v('SSCC'))}<br>${quality(v('SSCC'))}`]);
    }));
}
function kawasaki(data,number){
    const c=data.manifest.controllers.find(c=>c.robot===number), tags=data.kawasaki[number]||{};
    if(!c.controller)return note(c.identity);
    const rows=[['Mode','sta.mode'],['Motor','sta.motor_power'],['Cycle start','sta.cycle_start'],['Program','sta.now_moving_program'],['Step','sta.now_moving_step'],['Cycles','sta.completed_cycles'],['Control power hours','opeinfo.control_power_on_h']];
    const errors=[];
    for(let i=1;i<=10;i++){
        const prefix='errlog.slot_'+String(i).padStart(2,'0');const code=tags[prefix+'.code'];
        if(code?.value)errors.push(row([escape(i),show(tags[prefix+'.timestamp_ms']),show(code),show(tags[prefix+'.message'])]));
    }
    return `<div class="grid">${card('Kawasaki · '+c.model,`<p><code>${escape(c.controller)}:23</code> · STA / OPEINFO / ERRLOG</p><dl>${rows.map(([label,key])=>`<dt>${escape(label)}</dt><dd>${show(tags[key])}</dd>`).join('')}</dl>`)}${card('Error log',errors.length?table(['Slot','Controller timestamp ms','Code','Message'],errors):'<p>Δεν υπάρχει διαθέσιμο error log. Το κενό δεν επιβεβαιώνει απουσία σφαλμάτων.</p>')}</div>`;
}
function pendingPanel(data,key,title){
    const info=data.manifest.pending[key];
    const rows=info.paths.map(path=>row([`<code>${escape(path)}</code>`,show(data.bound[key+'.'+path])]));
    return card(title,note(info.reason)+table(['Πραγματικό πεδίο / συμβολική διαδρομή','Τιμή'],rows));
}
function render(data){
    const c=document.getElementById('content');
    if(page==='overview'){
        const connected=data.devices.filter(d=>d.enabled&&d.lastGood&&data.now-d.lastGood<15000&&d.status==='connect-ok').length;
        c.innerHTML=`<div class="grid">${card('Συνδέσεις με πρόσφατα δεδομένα',`<div class="kpi">${connected} <span class="muted">/ ${data.devices.length}</span></div><p>Η φρεσκάδα της μεταφοράς ελέγχεται χωριστά από τη λειτουργία των stations.</p>`)}${card('Stations DB100',`<div class="kpi">${data.manifest.stations.length}</div><p>34 robot IN/OUT + WRAP-IN. Χάρτης από το archive v0.4.</p>`)}${card('Συμβάντα',`<div class="kpi">${data.alarms.length}</div><p>Απώλεια επικοινωνίας, παλιά δεδομένα, heartbeat και καταγραφή.</p>`)}</div>`+
        `<div class="grid">${data.manifest.controllers.map(robot=>card('Robot '+robot.robot,`<p>${escape(robot.model)} · ${escape(robot.controller||'IP σε εκκρεμότητα')}</p><div class="chips">${data.manifest.stations.filter(s=>s.robot===robot.robot).map(s=>`<span class="indicator ${escape(data.cplc[s.name+'.Occupied']?.quality||'unknown')}">${escape(s.name)}</span>`).join('')}</div><p><a href="?page=r${robot.robot}">Άνοιγμα κυψέλης →</a></p>`)).join('')}</div>`+
        card('Επικοινωνίες',table(['Συσκευή','Enabled','Κατάσταση','Τελευταία ανάγνωση'],data.devices.map(d=>row([escape(d.name),escape(d.enabled?'Ναι':'Όχι'),escape(d.status),d.lastGood?escape(new Date(d.lastGood).toLocaleString('el-GR')):'—']))))+
        note('Τα station bits του DB100 είναι οι δημοσιευμένες τιμές του CPLC. Δεν έχει επιβεβαιωθεί ότι κάθε station τροφοδοτείται κυκλικά από τη φυσική κυψέλη.');
    } else if(/^r[1-6]$/.test(page)){
        const n=Number(page.slice(1)),robot=data.manifest.controllers.find(x=>x.robot===n);
        c.innerHTML=note(`${robot.identity}. Configured connection: ${robot.connection||'σε εκκρεμότητα'}. DB13 transport field: ${robot.rawField||'σε εκκρεμότητα'}.`)+card('Handshake Jungheinrich',stations(data,n))+kawasaki(data,n)+
            card('Raw transport CPLC · DB13',table(['Πεδίο','Τιμή','Quality'],Object.entries(data.cplc).filter(([name])=>name.startsWith(robot.rawField+'.')).map(([name,v])=>row([`<code>${escape(name)}</code>`,show(v),quality(v)]))))+
            note('Χειρισμοί σε εκκρεμότητα συμφωνίας. Δεν γράφονται AGVRequest, Release, reset ή DB666 από το HMI.');
    } else if(page==='buffer'){
        const entries=data.buffer.entries.filter(e=>e.sscc?.value);
        c.innerHTML=note('Το AGV buffer εμφανίζεται ως buffer του CPLC. Η κατάσταση «παραδόθηκε στην JH» απαιτεί επιβεβαιωμένο κριτήριο και καταχώρηση ολοκλήρωσης· δεν παράγεται από πτώση του AGVRequest.')+
            card('AGVBuffer_DB · 60 θέσεις',note(data.buffer.reason)+table(['Θέση','SSCC','Υλικό','Παλέτα','Κατάσταση'],entries.map(e=>row([escape(e.slot),show(e.sscc),show(e.material),show(e.pallet),'Buffer entry · παράδοση μη επιβεβαιωμένη']))||[]))+
            (entries.length?'':note('Δεν υπάρχουν δεσμευμένα live tags για το optimized DB8. Η λίστα παραμένει κενή χωρίς δοκιμαστικές εγγραφές.'));
    } else if(page==='deliveries'){
        c.innerHTML=note('Ιστορικό επιβεβαιωμένων παραδόσεων, χωριστά από το τρέχον AGV buffer. Η πηγή επιβεβαίωσης ολοκλήρωσης δεν έχει ακόμη οριστεί, επομένως δεν καταχωρούνται αυτόματα παραδόσεις.')+
            card('Παραδόσεις στην Jungheinrich',table(['Χρόνος','Station','SSCC','Pallet type','Πηγή επιβεβαίωσης'],deliveryState.entries.map(e=>row([escape(new Date(e.timestamp).toLocaleString('el-GR')),escape(e.station),`<code>${escape(e.sscc)}</code>`,escape(e.pallet_type),escape(e.source_event_id)])))+
                (deliveryState.entries.length?'':'<p>Καμία επιβεβαιωμένη εγγραφή. Αυτό δεν σημαίνει ότι δεν έχουν γίνει φυσικές παραδόσεις.</p>'));
    } else if(page==='sap')c.innerHTML=pendingPanel(data,'sap','SAP · SOAP/XML HTTP');
    else if(page==='eidos')c.innerHTML=pendingPanel(data,'eidos','EIDOS · label printer')+note('Τα PrepareDone/PrintDone είναι πιθανώς παλμοί ενός PLC scan. Χρειάζεται latch/counter για εγγυημένη καταγραφή. Δεν επιτρέπεται δεύτερος writer στη μνήμη εκτύπωσης.');
    else if(page==='wrapper')c.innerHTML=card('WRAP-IN · DB100 byte 826',stations(data,null))+pendingPanel(data,'wrapper','ROBOPAC');
    else if(page==='palomats'){
        c.innerHTML=note(data.manifest.pending.palomats.reason)+`<div class="grid">${[1,2,3,4,5].map(n=>card('Palomat '+n,table(['Σήμα','Τιμή'],Object.entries(data.cplc).filter(([p])=>p.startsWith('PALOMAT-'+n+'.')).map(([p,v])=>row([escape(p.split('.').pop()),show(v,true)]))))).join('')}</div>`;
    } else if(page==='diagnostics'){
        c.innerHTML=card('Alarms / diagnostics',data.alarms.length?data.alarms.map(a=>`<div class="alert ${a.severity==='error'?'bad':'stale'}">${escape(a.text)}</div>`).join(''):'<p>Δεν υπάρχουν ενεργές διαγνωστικές ενδείξεις. Οι απενεργοποιημένες συνδέσεις δεν ελέγχονται.</p>')+
            card('Heartbeat / Interface',table(['Πεδίο','Τιμή','Quality'],Object.entries(data.cplc).filter(([p])=>p.startsWith('Interface.')).map(([p,v])=>row([escape(p),show(v),quality(v)]))))+
            card('Καταγραφή',`<dl><dt>Τιμές</dt><dd>${escape(data.logging.telemetry)}</dd><dt>Συμβάντα · χωριστή DB</dt><dd>${escape(data.logging.eventsDatabase)}</dd><dt>Εκκρεμείς εγγραφές</dt><dd>${escape(data.logging.pending)}</dd><dt>Σφάλμα εγγραφής</dt><dd>${escape(data.logging.error||'—')}</dd></dl>`)+
            card('Offline κυκλικές κλήσεις',`<p>${data.manifest.cyclicCalls.Main_OB1.map(escape).join(' → ')}</p>`+note('Δεν βρέθηκε κλήση του Robot Stations [FC15] στο OB1. Η ορθότητα της μεταφοράς δεν επιβεβαιώνει ενεργό handshake.'));
    } else if(page==='events')renderEvents();
    document.getElementById('revision').textContent=data.manifest.archive+' · '+data.manifest.archiveSha256.slice(0,12);
}
function renderEvents(){
    document.getElementById('content').innerHTML=card('Event DB · χρονολογική καταγραφή',`<p>Αλλαγές τιμών, εγκυρότητας, επικοινωνίας και alarm state του FUXA. Οι σύντομοι PLC παλμοί μεταξύ αναγνώσεων δεν είναι παρατηρήσιμοι.</p><button id="refresh-events">Ανανέωση</button> <button id="older-events">Παλαιότερα</button>`+table(['ID / χρόνος HMI','Device','Event','Tag','Value'],events.map(e=>row([`${escape(e.id)}<span class="quality-note">${escape(new Date(e.timestamp).toLocaleString('el-GR'))}</span>`,escape(e.device),escape(e.kind),`<code>${escape(e.tag)}</code>`,`<code>${escape(e.value)}</code>`]))));
    document.getElementById('refresh-events').onclick=()=>loadEvents(false);
    document.getElementById('older-events').onclick=()=>loadEvents(true);
}
async function loadEvents(older){
    if(loadingEvents)return;loadingEvents=true;
    try{const rows=await request('../api/melissa/events?limit=100'+(older&&cursor?'&before='+cursor:''));events=older?events.concat(rows):rows;cursor=rows.at(-1)?.id||cursor;renderEvents();}catch(e){showError(e);}finally{loadingEvents=false;}
}
function showError(error){
    const banner=document.getElementById('transport');banner.className='banner bad';banner.textContent='Απώλεια σύνδεσης HMI · '+error.message+' · Οι ορατές τιμές είναι παλιές.';
    document.getElementById('mode').className='badge bad';document.getElementById('mode').textContent='HMI OFFLINE';
    if(latest){latest=structuredClone(latest);for(const v of Object.values(latest.cplc))if(v.quality==='good')v.quality='stale';for(const robot of Object.values(latest.kawasaki))for(const v of Object.values(robot))if(v.quality==='good')v.quality='stale';for(const v of Object.values(latest.bound))if(v.quality==='good')v.quality='stale';render(latest);}
}
async function refresh(){
    try{
        latest=await request('../api/melissa/snapshot');render(latest);
        const banner=document.getElementById('transport');banner.className='banner good';banner.textContent='FUXA συνδεδεμένο · Ελέγξτε την κατάσταση κάθε συσκευής για δεδομένα PLC / Kawasaki.';
        const hasData=Object.values(latest.cplc).some(v=>v.quality==='good');
        document.getElementById('mode').className='badge '+(hasData?'good':'unknown');document.getElementById('mode').textContent=hasData?'LIVE READINGS':'ΧΩΡΙΣ LIVE PLC DATA';
        document.getElementById('clock').textContent=new Date(latest.now).toLocaleString('el-GR');
    }catch(error){showError(error);}finally{setTimeout(refresh,2000);}
}
if(page==='events')loadEvents(false);
if(page==='deliveries')request('../api/melissa/deliveries').then(value=>{deliveryState=value;if(latest)render(latest);}).catch(showError);
refresh();
