'use strict';
const pages=[['overview','Εγκατάσταση'],...[1,2,3,4,5,6].map(n=>['r'+n,'Robot '+n]),['semolina','SEMOLINA'],['buffer','Αναθέσεις στα AGV'],['deliveries','Ιστορικό παραδόσεων AGV'],['sap','SAP'],['eidos','Barcode'],['wrapper','Τυλιχτικό'],['palomats','Palomats'],['diagnostics','Diagnostics'],['events','Events']];
const params=new URLSearchParams(location.search), page=pages.some(p=>p[0]===params.get('page'))?params.get('page'):'overview';
if(params.get('embed')==='1')document.body.classList.add('embed');
if(page==='overview'||page==='semolina')document.body.classList.add('plant-overview');
document.getElementById('title').textContent=pages.find(p=>p[0]===page)[1];
const pageLink=id=>{const query=new URLSearchParams(location.search);query.set('page',id);query.delete('unit');return '?'+query;};
document.getElementById('navigation').innerHTML='<a class="brand" href="'+pageLink('overview')+'"><img src="graphics/condor-robotics.svg" alt="Condor Robotics"></a>'+pages.map(([id,name])=>`<a href="${pageLink(id)}" class="${id===page?'active':''}">${name}</a>`).join('');
if(page==='overview'){
    document.body.classList.add('page-overview');
    document.querySelector('header').classList.add('has-overview-kpis');
    const panel=document.getElementById('overview-kpis');panel.hidden=false;
    panel.innerHTML=[['waiting','Σε αναμονή'],['transit','Σε διακίνηση AGV'],['printing','Εντός Τυλιχτικού']].map(([id,label])=>`<article class="preview-kpi" data-kpi="${id}" data-quality="unknown"><span class="preview-kpi-label">${label}</span><div class="preview-kpi-reading"><strong data-kpi-value>—</strong><span data-kpi-state>Χωρίς δεδομένα</span></div></article>`).join('');
}
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
function renderKpis(data){
    const card=document.querySelector('[data-kpi="waiting"]');if(!card)return;
    const samples=(MelissaPlant.model?.outfeeds||[]).map(o=>data.cplc[o.occupiedBinding.path]);
    const good=samples.filter(s=>s?.quality==='good'&&[true,false,0,1].includes(s.value));
    // SEMOLINA has no verified source yet, so even 17 fresh conveyor readings are a lower bound.
    card.dataset.quality=good.length?'partial':'unknown';
    card.querySelector('[data-kpi-value]').textContent=good.length?'≥ '+good.filter(s=>s.value===true||s.value===1).length:'—';
    card.querySelector('[data-kpi-state]').textContent=good.length?`${good.length}/18 θέσεις`:'Χωρίς δεδομένα';
    card.title='Σε αναμονή: γεμάτες παλέτες OUT και SEMOLINA. Το ≥ δείχνει μερική κάλυψη· δεν αποτελεί συνολικό αριθμό.';
}
let rotation=false,initialModal=false;
function render(data){
    const c=document.getElementById('content');
    if(page==='overview'){
        if(!document.getElementById('plant-design'))c.innerHTML=MelissaPlant.markup();
        const host=document.getElementById('plant-design');
        MelissaPlant.applySnapshot(host,data);MelissaPlant.mount(host).then(()=>{
            let control=host.querySelector('[data-layout-rotate]');
            if(!control){
                const label=document.createElement('label');label.className='layout-rotation';
                label.innerHTML='<input type="checkbox" data-layout-rotate aria-label="Περιστροφή 180°"> Περιστροφή 180°';
                host.querySelector('.plant-tools').appendChild(label);control=label.querySelector('input');control.checked=rotation;
                control.addEventListener('change',()=>{rotation=control.checked;sessionStorage.setItem('melissa-layout-rotation',String(rotation));MelissaLayoutView.rotate(host,rotation);});
            }
            MelissaLayoutView.rotate(host,rotation);renderKpis(data);
        });
    } else if(page==='semolina'){
        c.innerHTML=MelissaPlant.semolinaMarkup();
    } else if(/^r[1-6]$/.test(page)){
        const n=Number(page.slice(1)),robot=data.manifest.controllers.find(x=>x.robot===n);
        c.innerHTML=note(`${robot.identity}. Configured connection: ${robot.connection||'σε εκκρεμότητα'}. DB13 transport field: ${robot.rawField||'σε εκκρεμότητα'}.`)+card('Handshake AGV',stations(data,n))+kawasaki(data,n)+
            card('Raw transport CPLC · DB13',table(['Πεδίο','Τιμή','Quality'],Object.entries(data.cplc).filter(([name])=>name.startsWith(robot.rawField+'.')).map(([name,v])=>row([`<code>${escape(name)}</code>`,show(v),quality(v)]))))+
            note('Χειρισμοί σε εκκρεμότητα συμφωνίας. Δεν γράφονται AGVRequest, Release, reset ή DB666 από το HMI.');
    } else if(page==='buffer'){
        const entries=data.buffer.entries.filter(e=>e.sscc?.value);
        c.innerHTML=note('Παλέτες που ανατέθηκαν στα AGV και αναμένουν την παράδοσή τους στο Τυλιχτικό.')+
            card('Αναθέσεις στα AGV',note(data.buffer.reason)+table(['Θέση','SSCC','Υλικό','Παλέτα','Κατάσταση'],entries.map(e=>row([escape(e.slot),show(e.sscc),show(e.material),show(e.pallet),'Αναμένεται παράδοση στο Τυλιχτικό']))||[]))+
            (entries.length?'':note('Δεν υπάρχουν δεσμευμένα live tags για το optimized DB8. Η λίστα παραμένει κενή χωρίς δοκιμαστικές εγγραφές.'));
    } else if(page==='deliveries'){
        c.innerHTML=note('Κάθε παλέτα που παραδόθηκε από AGV στο Τυλιχτικό. Η πηγή επιβεβαίωσης δεν έχει ακόμη συνδεθεί, επομένως δεν καταχωρούνται αυτόματα παραδόσεις.')+
            card('Ιστορικό παραδόσεων AGV',table(['Χρόνος','Station','SSCC','Pallet type','Πηγή επιβεβαίωσης'],deliveryState.entries.map(e=>row([escape(new Date(e.timestamp).toLocaleString('el-GR')),escape(e.station),`<code>${escape(e.sscc)}</code>`,escape(e.pallet_type),escape(e.source_event_id)])))+
                (deliveryState.entries.length?'':'<p>Καμία επιβεβαιωμένη εγγραφή. Αυτό δεν σημαίνει ότι δεν έχουν γίνει φυσικές παραδόσεις.</p>'));
    } else if(page==='sap')c.innerHTML=pendingPanel(data,'sap','SAP · SOAP/XML HTTP');
    else if(page==='eidos')c.innerHTML=card('Barcode','<button data-open-barcode>Άνοιγμα μενού Barcode</button>')+pendingPanel(data,'eidos','Barcode · εκτυπωτής ετικέτας');
    else if(page==='wrapper')c.innerHTML=card('WRAP-IN · DB100 byte 826',stations(data,null))+pendingPanel(data,'wrapper','ROBOPAC');
    else if(page==='palomats'){
        const unit=/^[1-5]$/.test(params.get('unit')||'')?Number(params.get('unit')):null;
        const link=n=>{const q=new URLSearchParams(location.search);if(n)q.set('unit',String(n));else q.delete('unit');return '?'+q.toString();};
        c.innerHTML=`<div class="chips">${[5,4,3,2,1].map(n=>`<button data-open-palomat="${n}">Palomat ${n}</button>`).join('')}</div>`+note(data.manifest.pending.palomats.reason);
        if(!initialModal&&MelissaPlant.model){initialModal=true;MelissaPlant.openPalomatMenu(unit||1);}
    } else if(page==='diagnostics'){
        c.innerHTML=card('Alarms / diagnostics',data.alarms.length?data.alarms.map(a=>`<div class="alert ${a.severity==='error'?'bad':'stale'}">${escape(a.text)}</div>`).join(''):'<p>Δεν υπάρχουν ενεργές διαγνωστικές ενδείξεις. Οι απενεργοποιημένες συνδέσεις δεν ελέγχονται.</p>')+
            card('Heartbeat / Interface',table(['Πεδίο','Τιμή','Quality'],Object.entries(data.cplc).filter(([p])=>p.startsWith('Interface.')).map(([p,v])=>row([escape(p),show(v),quality(v)]))))+
            card('Καταγραφή',`<dl><dt>Τιμές</dt><dd>${escape(data.logging.telemetry)}</dd><dt>Συμβάντα · χωριστή DB</dt><dd>${escape(data.logging.eventsDatabase)}</dd><dt>Εκκρεμείς εγγραφές</dt><dd>${escape(data.logging.pending)}</dd><dt>Σφάλμα εγγραφής</dt><dd>${escape(data.logging.error||'—')}</dd></dl>`)+
            card('Offline κυκλικές κλήσεις',`<p>${data.manifest.cyclicCalls.Main_OB1.map(escape).join(' → ')}</p>`+note('Δεν βρέθηκε κλήση του Robot Stations [FC15] στο OB1. Η ορθότητα της μεταφοράς δεν επιβεβαιώνει ενεργό handshake.'));
    } else if(page==='events')renderEvents();
    document.getElementById('revision').textContent=data.manifest.archive+' · '+data.manifest.archiveSha256.slice(0,12);
    if(page!=='overview'&&!c.querySelector('.operator-back'))c.insertAdjacentHTML('afterbegin',`<a class="operator-back" href="${pageLink('overview')}">← Εγκατάσταση</a>`);
    if(page==='eidos'&&!initialModal){initialModal=true;MelissaPlant.openMenu('eidos');}
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
        const banner=document.getElementById('transport');banner.className='banner good';banner.textContent=page==='overview'?'FUXA συνδεδεμένο · εποπτεία παρουσίας παλετών OUT':'FUXA συνδεδεμένο · Ελέγξτε την κατάσταση κάθε συσκευής για δεδομένα PLC / Kawasaki.';
        const hasData=page!=='semolina'&&Object.values(latest.cplc).some(v=>v.quality==='good');
        document.getElementById('mode').className='badge '+(hasData?'good':'unknown');document.getElementById('mode').textContent=page==='overview'?(hasData?'ΕΠΟΠΤΕΙΑ ΠΑΛΕΤΩΝ':'ΧΩΡΙΣ LIVE PLC DATA'):hasData?'LIVE READINGS':'ΧΩΡΙΣ LIVE PLC DATA';
        document.getElementById('clock').textContent=new Date(latest.now).toLocaleString('el-GR');
    }catch(error){showError(error);}finally{setTimeout(refresh,2000);}
}
try{rotation=sessionStorage.getItem('melissa-layout-rotation')==='true';}catch(_){}
document.addEventListener('click',event=>{
    if(event.target.closest('[data-open-barcode]'))MelissaPlant.openMenu('eidos');
    const unit=event.target.closest('[data-open-palomat]');if(unit)MelissaPlant.openPalomatMenu(Number(unit.dataset.openPalomat));
});
if(page==='palomats')fetch('layout-data.json').then(r=>r.json()).then(model=>{MelissaPlant.model=model;if(latest)render(latest);}).catch(showError);
if(page==='events')loadEvents(false);
if(page==='deliveries')request('../api/melissa/deliveries').then(value=>{deliveryState=value;if(latest)render(latest);}).catch(showError);
refresh();
