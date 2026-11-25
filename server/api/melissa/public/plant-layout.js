'use strict';
// Read-only rendering of supplied snapshots. No device reads or command API calls.
window.MelissaPlant={
    loading:null,
    selected:null,
    model:null,
    snapshot:null,
    palomatGraphics:{},
    barcodeGraphic:'',
    async mount(host){
        if(!host || host.dataset.mounted==='true')return;
        host.dataset.mounted='true';
        const errorBox=host.querySelector('[data-layout-error]');
        try{
            if(!this.loading)this.loading=Promise.all([
                fetch('factory-layout.svg').then(r=>{if(!r.ok)throw new Error('SVG HTTP '+r.status);return r.text();}),
                fetch('layout-data.json').then(r=>{if(!r.ok)throw new Error('Layout HTTP '+r.status);return r.json();})
            ]);
            const [drawing,model]=await this.loading;
            if(!host.isConnected)return;
            this.model=model;
            host.querySelector('[data-layout-drawing]').innerHTML=drawing;
            host.querySelector('[data-layout-count]').textContent=model.endpoints.length+' endpoints';
            const activate=target=>{
                const pickup=target.closest('[data-pickup-station]');
                if(pickup){this.requestPickup(host);return;}
                const pallet=target.closest('[data-pallet-for]');
                if(pallet){this.select(host,pallet.dataset.palletFor);return;}
                const point=target.closest('[data-endpoint]');
                if(point){this.select(host,point.dataset.endpoint);const config=this.model.endpoints.find(e=>e.id===point.dataset.endpoint);if(config?.kind==='menu')this.openMenu(config.target);return;}
                const entity=target.closest('[data-open-page]');
                if(entity)this.navigate(entity.dataset.openPage,entity.dataset.openSelection);
            };
            host.addEventListener('click',event=>activate(event.target));
            host.addEventListener('keydown',event=>{
                if(event.key==='Enter'||event.key===' '){if(event.target.closest('[data-endpoint],[data-open-page],[data-pallet-for],[data-pickup-station]')){event.preventDefault();activate(event.target);}}
                if(event.key==='Escape'){this.selected=null;this.paintSelection(host);}
            });
            host.querySelector('[data-clear-endpoint]').addEventListener('click',()=>{this.selected=null;this.paintSelection(host);});
            this.paintSelection(host);
            if(this.snapshot)this.applySnapshot(host,this.snapshot);
            errorBox.hidden=true;
        }catch(error){
            this.loading=null;host.dataset.mounted='false';errorBox.hidden=false;errorBox.textContent='Δεν φορτώθηκε το σχέδιο: '+error.message;
        }
    },
    applySnapshot(host,data){
        this.snapshot=data;
        if(!host?.querySelector('[data-layout-drawing] svg')||!this.model)return;
        const values={};
        for(const outfeed of this.model.outfeeds||[])values[outfeed.id]=data?.cplc?.[outfeed.occupiedBinding.path];
        this.paintOccupancy(host,values);
        this.paintSemolina(host,{quality:'unknown',occupied:null,request:null});
    },
    paintOccupancy(host,values){
        for(const element of host.querySelectorAll('[data-pallet-for]')){
            const id=element.dataset.palletFor,sample=values[id];
            const value=sample?.value===true||sample?.value===1?true:sample?.value===false||sample?.value===0?false:null;
            const quality=value===null?'unknown':['good','stale','bad'].includes(sample?.quality)?sample.quality:'unknown';
            element.dataset.present=value===null?'unknown':String(value);element.dataset.quality=quality;
            const description=quality==='good'?(value?'Occupied · γεμάτη παλέτα':'Occupied = 0 · κενή θέση'):quality==='stale'?'Παλιές ενδείξεις · παρουσία μη επιβεβαιωμένη':quality==='bad'?'Μη έγκυρα δεδομένα · παρουσία μη επιβεβαιωμένη':'Παρουσία παλέτας · χωρίς δεδομένα';
            element.setAttribute('aria-label',id+' · '+description);element.setAttribute('tabindex',value===true?'0':'-1');
            element.querySelector('title').textContent=description;
        }
        this.paintSelectedOccupancy(host);
    },
    paintSelectedOccupancy(host){
        const label=host.querySelector('[data-selected-occupancy]');if(!label)return;
        const pallet=[...host.querySelectorAll('[data-pallet-for]')].find(p=>p.dataset.palletFor===this.selected);
        label.hidden=!pallet;
        if(pallet)label.textContent=pallet.querySelector('title').textContent;
    },
    paintSemolina(host,state){
        const point=host.querySelector('[data-endpoint="semolina-out"]');
        point?.classList.toggle('is-requested',state.quality==='good'&&state.request===true);
        const button=host.querySelector('[data-pickup-station="semolina"]');if(!button)return;
        const available=host.dataset.previewCommands==='true'&&state.quality==='good'&&state.occupied===true&&!state.request;
        button.setAttribute('aria-disabled',String(!available));
        button.querySelector('[data-pickup-label]').textContent=state.request===true?'Αίτημα ενεργό · preview':'Αίτημα παραλαβής';
        button.querySelector('title').textContent=host.dataset.previewCommands==='true'?'Δοκιμή αιτήματος OUT · χωρίς αποστολή σε PLC/AGV':'Αίτημα παραλαβής · χειρισμός μη διαθέσιμος';
    },
    requestPickup(host){
        const button=host.querySelector('[data-pickup-station="semolina"]');
        if(host.dataset.previewCommands!=='true'||button?.getAttribute('aria-disabled')!=='false')return;
        this.select(host,'semolina-out');
        window.dispatchEvent(new CustomEvent('melissa:preview-pickup',{detail:{station:'semolina',source:'hmi-button'}}));
    },
    semolinaMarkup({preview=false,occupied=null,request=null,palletGraphic='',quality='unknown'}={}){
        const usable=preview&&quality==='good';
        const value=flag=>flag===null?'—':(flag?'1 · ON':'0 · OFF')+(quality==='stale'?' · ΠΑΛΙΑ':'');
        const occupancy=usable?(occupied?'Παλέτα στη θέση':'Κενή θέση'):quality==='stale'?'Παλιές ενδείξεις':'Χωρίς δεδομένα';
        const requested=usable?(request?'Αίτημα OUT ενεργό · preview':'Χωρίς αίτημα · preview'):quality==='stale'?'Παλιές ενδείξεις':'Χωρίς δεδομένα';
        const visual=preview&&occupied?(palletGraphic||'<img src="graphics/full-pallet.svg" alt="Γεμάτη παλέτα">'):'<span class="semolina-empty-mark">?</span>';
        return `<section class="semolina-page"><div class="semolina-summary"><article><span>ΠΑΛΕΤΟΘΕΣΗ</span><strong>${occupancy}</strong></article><article><span>SAP / ΣΤΟΙΧΕΙΑ ΠΑΛΕΤΑΣ</span><strong>Χωρίς δεδομένα</strong></article><article><span>OUT → AGV</span><strong>${requested}</strong></article></div><div class="semolina-work"><article class="semolina-card"><span class="plant-eyebrow">SEMOLINA / ΣΙΜΙΓΔΑΛΙ</span><h2>Στοιχεία παλέτας από SAP</h2><dl>${['SSCC','Κωδικός υλικού','Περιγραφή υλικού','Τύπος παλέτας'].map(label=>`<div><dt>${label}</dt><dd>—</dd></div>`).join('')}</dl><p class="semolina-note">Τα στοιχεία αντιστοιχούν στην παλέτα αυτής της θέσης.</p></article><article class="semolina-card"><h2>Παραλαβή από AGV</h2><div class="semolina-flow"><div class="semolina-floor ${quality==='stale'?'is-stale':''}">${visual}<span>Παλετοθέση SEMOLINA</span></div><div class="semolina-to-agv"><strong>OUT <b>→</b> AGV</strong><span>${requested}</span></div></div><button type="button" class="semolina-request" data-semolina-command ${preview?'data-preview-pickup':''} ${!usable||!occupied||request?'disabled':''}>${request?'Αίτημα ενεργό · preview':'Αίτημα παραλαβής'}</button><p class="semolina-note">Αίτημα παραλαβής από φυσικό κουμπί ή HMI.</p>${!preview?'<p class="semolina-unavailable">Ο χειρισμός δεν είναι ακόμη διαθέσιμος.</p>':''}</article></div><article class="semolina-card semolina-handshake"><h2>Station SEMOLINA · OUT προς AGV</h2><div class="table-wrap"><table><thead><tr>${['Operational','Occupied','AGV Request','ROB Request','Release','Pallet type','SSCC'].map(label=>`<th>${label}</th>`).join('')}</tr></thead><tbody><tr><td>—</td><td>${value(preview?occupied:null)}</td><td>${value(preview?request:null)}</td><td>—</td><td>—</td><td>—</td><td>—</td></tr></tbody></table></div></article></section>`;
    },
    navigate(page,selection){
        if(page==='palomats'){this.openPalomatMenu(Number(selection)||this.lastPalomat||1);return;}
        const event=new CustomEvent('melissa:navigate',{detail:{page,selection},cancelable:true});
        if(!window.dispatchEvent(event))return;
        const query=new URLSearchParams(location.search);query.set('page',page);query.delete('unit');
        if(page==='palomats'&&/^[1-5]$/.test(selection||''))query.set('unit',selection);
        location.search=query.toString();
    },
    barcodeIcon(){return this.barcodeGraphic||'<img src="graphics/barcode-label.svg" alt="Ετικέτα Barcode">';},
    openPalomatMenu(number){
        if(![1,2,3,4,5].includes(number))return;
        const unit=this.model?.palomats?.find(p=>p.number===number);
        if(!unit)return;
        this.lastPalomat=number;
        let dialog=document.getElementById('palomat-design-menu');
        if(!dialog){
            dialog=document.createElement('dialog');dialog.id='palomat-design-menu';dialog.className='plant-menu palomat-menu';dialog.setAttribute('aria-labelledby','palomat-modal-title');
            document.body.appendChild(dialog);
            dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}});
        }
        const open=dialog.open;
        const artwork=this.palomatGraphics[unit.palletFamily]||`<img src="${unit.graphic}" alt="Palomat ${number}">`;
        dialog.innerHTML=`<div class="plant-menu-header"><div><span class="plant-eyebrow">ΠΑΛΕΤΟΔΙΑΝΟΜΕΑΣ</span><h2 id="palomat-modal-title">Palomat ${number}</h2></div><button type="button" data-close-palomat aria-label="Κλείσιμο Palomat ${number}" autofocus>✕</button></div><div class="palomat-unit-selector">${[5,4,3,2,1].map(n=>`<button type="button" data-modal-unit="${n}" class="${n===number?'selected':''}">Palomat ${n}</button>`).join('')}</div><div class="plant-menu-tabs"><button data-palomat-tab="status">Κατάσταση</button><button data-palomat-tab="pallets">Παλέτες</button><button data-palomat-tab="events">Συμβάντα</button></div><div class="palomat-menu-layout"><div class="palomat-modal-art">${artwork}<strong>${unit.palletName}</strong></div><div class="palomat-modal-values"></div></div><div class="plant-menu-foot">Οι μη συνδεδεμένες ενδείξεις εμφανίζονται με —.</div>`;
        const panels={status:[['Επικοινωνία','—'],['Ετοιμότητα','—'],['Σφάλμα','—']],pallets:[['Τύπος παλέτας',unit.palletName],['Παλέτα διαθέσιμη','—'],['Αίτημα παλέτας','—']],events:[['Συμβάντα','Δεν έχουν συνδεθεί δεδομένα']]};
        const setTab=tab=>{
            this.palomatTab=tab;
            for(const button of dialog.querySelectorAll('[data-palomat-tab]'))button.classList.toggle('selected',button.dataset.palomatTab===tab);
            dialog.querySelector('.palomat-modal-values').replaceChildren(...panels[tab].map(([label,value])=>{const row=document.createElement('div');row.className='plant-menu-row';const l=document.createElement('span'),v=document.createElement('strong');l.textContent=label;v.textContent=value;row.append(l,v);return row;}));
        };
        dialog.querySelector('[data-close-palomat]').addEventListener('click',()=>dialog.close());
        for(const button of dialog.querySelectorAll('[data-modal-unit]'))button.addEventListener('click',()=>this.openPalomatMenu(Number(button.dataset.modalUnit)));
        for(const button of dialog.querySelectorAll('[data-palomat-tab]'))button.addEventListener('click',()=>setTab(button.dataset.palomatTab));
        setTab(this.palomatTab||'status');
        if(!open)dialog.showModal();else dialog.querySelector(`[data-modal-unit="${number}"]`).focus({preventScroll:true});
    },
    select(host,id){
        if(!this.model?.endpoints.some(e=>e.id===id))return;
        this.selected=id;this.paintSelection(host);
    },
    paintSelection(host){
        const point=this.model?.endpoints.find(e=>e.id===this.selected);
        for(const element of host.querySelectorAll('[data-endpoint]')){
            const chosen=element.dataset.endpoint===this.selected;
            element.classList.toggle('is-selected',chosen);element.setAttribute('aria-pressed',String(chosen));
        }
        host.querySelector('[data-selected-name]').textContent=point?point.label:'Επίλεξε ένα βέλος';
        host.querySelector('[data-selected-cell]').textContent=point?point.cellName:'Κάθε IN / OUT είναι ανεξάρτητο σημείο';
        host.querySelector('[data-selected-direction]').textContent=point?(point.kind==='menu'?'Μενού εκτυπωτή':point.id==='semolina-out'?'OUT → AGV · παραλαβή παλέτας':point.direction==='IN'?'IN · παράδοση προς την κυψέλη':'OUT · παραλαβή από την κυψέλη'):'—';
        host.querySelector('[data-selected-id]').textContent=point?point.id:'—';
        const link=host.querySelector('[data-selected-link]');
        link.hidden=!point;
        if(point){const query=new URLSearchParams(location.search);query.set('page',point.cell);link.href='?'+query.toString();}
        host.querySelector('[data-clear-endpoint]').disabled=!point;
        this.paintSelectedOccupancy(host);
    },
    openMenu(target){
        if(target!=='eidos')return;
        let dialog=document.getElementById('eidos-design-menu');
        if(!dialog){
            dialog=document.createElement('dialog');dialog.id='eidos-design-menu';dialog.className='plant-menu';
            dialog.innerHTML=`<div class="plant-menu-header"><div><span class="plant-eyebrow">ΤΥΛΙΧΤΙΚΟ / ΕΚΤΥΠΩΤΗΣ</span><div class="plant-menu-title">${this.barcodeIcon()}<h2>Barcode</h2></div></div><button type="button" data-close-menu aria-label="Κλείσιμο μενού Barcode">✕</button></div><div class="plant-menu-tabs"><button class="selected" data-menu-tab="status">Κατάσταση</button><button data-menu-tab="label">Στοιχεία ετικέτας</button><button data-menu-tab="history">Ιστορικό</button></div><div class="plant-menu-content"></div><div class="plant-menu-foot">Οι μη συνδεδεμένες ενδείξεις εμφανίζονται με —.</div>`;
            document.body.appendChild(dialog);
            const panels={status:[['Επικοινωνία','—'],['Κατάσταση εκτυπωτή','—'],['Τρέχον μήνυμα','—']],label:[['SSCC','—'],['Κωδικός είδους','—'],['Περιγραφή','—']],history:[['Τελευταία μηνύματα','Δεν έχουν συνδεθεί δεδομένα']]};
            const setTab=tab=>{
                for(const b of dialog.querySelectorAll('[data-menu-tab]'))b.classList.toggle('selected',b.dataset.menuTab===tab);
                dialog.querySelector('.plant-menu-content').replaceChildren(...panels[tab].map(([label,value])=>{const row=document.createElement('div');row.className='plant-menu-row';const l=document.createElement('span'),v=document.createElement('strong');l.textContent=label;v.textContent=value;row.append(l,v);return row;}));
            };
            dialog.querySelector('[data-close-menu]').addEventListener('click',()=>dialog.close());
            for(const button of dialog.querySelectorAll('[data-menu-tab]'))button.addEventListener('click',()=>setTab(button.dataset.menuTab));
            dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}});
            setTab('status');
        }
        if(!dialog.open)dialog.showModal();
    },
    markup(){return `<section class="plant-design" id="plant-design"><div class="plant-toolbar"><div><span class="plant-eyebrow">MELISSA / ΔΙΑΤΑΞΗ ΕΓΚΑΤΑΣΤΑΣΗΣ</span><h2>Κυψέλες &amp; σημεία AGV</h2></div><div class="plant-tools"><span data-layout-count>37 endpoints</span><span class="design-pill">ΣΧΕΔΙΑΣΜΟΣ</span></div></div><div data-layout-error hidden class="plant-load-error"></div><div class="plant-drawing" data-layout-drawing><div class="drawing-loading">Φόρτωση κάτοψης…</div></div><div class="plant-legend"><span><i class="legend-arrow">↑</i> Ξεχωριστό endpoint για κάθε κατεύθυνση</span><span><i class="legend-selection"></i> Επιλεγμένο σημείο</span><span><i class="legend-status">−</i> Χωρίς δεδομένα</span><span>Γεμάτη παλέτα = Occupied</span><span>Ονόματα / περιοχές: άνοιγμα οθόνης</span></div><div class="endpoint-inspector" aria-live="polite"><div class="endpoint-identity"><span class="plant-eyebrow">ΕΠΙΛΕΓΜΕΝΟ ΣΗΜΕΙΟ</span><strong data-selected-name>Επίλεξε ένα βέλος</strong><span data-selected-cell>Κάθε IN / OUT είναι ανεξάρτητο σημείο</span></div><div class="endpoint-field"><span>Κατεύθυνση</span><strong data-selected-direction>—</strong><small data-selected-occupancy hidden></small></div><div class="endpoint-field"><span>Endpoint ID</span><code data-selected-id>—</code></div><div class="endpoint-actions"><a data-selected-link hidden>Άνοιγμα κυψέλης ↗</a><button type="button" data-clear-endpoint disabled>Καθαρισμός επιλογής</button></div></div></section>`;}
};
