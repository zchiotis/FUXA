'use strict';
// Standalone screen navigation for design review. No data source or HMI runtime.
window.MelissaPreview={
    start(model,palomatArtwork={},fullPalletGraphic=''){
        this.model=model;
        this.palomatArtwork=palomatArtwork;
        MelissaPlant.palomatGraphics=palomatArtwork;
        this.fullPalletGraphic=fullPalletGraphic;
        this.semolina={occupied:true,request:false};
        const content=document.getElementById('content');
        content.innerHTML='<div id="preview-overview">'+MelissaPlant.markup()+'</div><section id="preview-screen" hidden></section>';
        this.host=document.getElementById('plant-design');
        this.host.dataset.previewCommands='true';
        document.getElementById('preview-rotate').addEventListener('change',()=>this.rotateLayout());
        this.rotateLayout();
        const originalPaint=MelissaPlant.paintSelection.bind(MelissaPlant);
        MelissaPlant.paintSelection=host=>{originalPaint(host);this.paintDemo();};
        document.getElementById('preview-light').addEventListener('change',()=>this.paintLight());
        document.getElementById('preview-occupied').addEventListener('change',()=>this.paintDemo());
        document.getElementById('preview-stale').addEventListener('change',()=>{this.paintDemo();this.renderRoute();});
        document.getElementById('preview-semolina').addEventListener('change',()=>{this.semolina.occupied=document.getElementById('preview-semolina').checked;this.paintDemo();this.renderRoute();});
        document.getElementById('preview-reset').addEventListener('click',()=>{
            this.semolina={occupied:true,request:false};
            document.getElementById('preview-occupied').value='sample';document.getElementById('preview-stale').checked=false;document.getElementById('preview-semolina').checked=true;
            document.getElementById('preview-rotate').checked=false;this.rotateLayout();
            this.paintDemo();this.renderRoute();
        });
        window.addEventListener('melissa:preview-pickup',()=>this.pickup());
        window.addEventListener('melissa:navigate',event=>{event.preventDefault();this.navigate(event.detail.page,event.detail.selection);});
        document.addEventListener('click',event=>{
            const button=event.target.closest('[data-preview-page]');
            if(button){event.preventDefault();this.navigate(button.dataset.previewPage,button.dataset.previewSelection);return;}
            if(event.target.closest('[data-selected-link]')){event.preventDefault();const point=this.model.endpoints.find(e=>e.id===MelissaPlant.selected);if(point)this.navigate(point.cell);}
            if(event.target.closest('[data-preview-eidos]'))MelissaPlant.openMenu('eidos');
            if(event.target.closest('[data-preview-pickup]'))this.pickup();
        });
        window.addEventListener('hashchange',()=>this.renderRoute());
        this.renderRoute();
        MelissaPlant.mount(this.host).then(()=>{MelissaPlant.select(this.host,'r1-1-out');this.paintDemo();this.rotateLayout();});
    },
    prepareRotation(){
        const svg=this.host.querySelector('[data-layout-drawing]>svg');
        if(!svg||svg===this.rotationRoot||document.getElementById('preview-overview').hidden)return;
        this.rotationElements=[];
        // Counter-rotate complete UI cards and illustrations once. Keep conveyor
        // geometry and directional arrows in the rotated factory coordinate system.
        for(const element of svg.querySelectorAll('[data-keep-upright],text')){
            if(element.parentElement.closest('[data-keep-upright]'))continue;
            const explicit=element.hasAttribute('data-upright-cx');
            const bounds=explicit?null:element.getBBox();
            if(!explicit&&(!bounds.width||!bounds.height))continue;
            const cx=explicit?Number(element.dataset.uprightCx):bounds.x+bounds.width/2;
            const cy=explicit?Number(element.dataset.uprightCy):bounds.y+bounds.height/2;
            this.rotationElements.push({element,cx,cy,base:element.getAttribute('transform')});
        }
        this.rotationRoot=svg;
    },
    rotateLayout(){
        this.prepareRotation();
        const rotated=document.getElementById('preview-rotate').checked;
        for(const {element,cx,cy,base} of this.rotationElements||[]){
            if(rotated)element.setAttribute('transform',(base?base+' ':'')+`rotate(180 ${cx} ${cy})`);
            else if(base===null)element.removeAttribute('transform');
            else element.setAttribute('transform',base);
        }
        this.host.classList.toggle('layout-rotated',rotated);
    },
    pickup(){
        if(!this.semolina.occupied||this.semolina.request||document.getElementById('preview-stale').checked)return;
        this.semolina.request=true;this.paintDemo();
        if(new URLSearchParams(location.hash.slice(1)).get('page')==='semolina')this.renderRoute();
    },
    paintDemo(){
        if(!this.host?.querySelector('[data-pallet-for]'))return;
        const mode=document.getElementById('preview-occupied').value,quality=document.getElementById('preview-stale').checked?'stale':'good';
        const sample=['r6-3-out','r1-1-out','r4-1-out','r2-2-out','r3-2-out','r5-1-out'];
        const values={};
        for(const outfeed of this.model.outfeeds)values[outfeed.id]={value:mode==='all'||mode==='sample'&&sample.includes(outfeed.id)||mode==='selected'&&outfeed.id===MelissaPlant.selected,quality};
        values['semolina-out']={value:this.semolina.occupied,quality};
        MelissaPlant.paintOccupancy(this.host,values);
        MelissaPlant.paintSemolina(this.host,{...this.semolina,quality});
        this.paintKpis(values,quality);
        this.paintLight();
    },
    paintKpis(values,quality){
        const waiting=document.querySelector('[data-kpi="waiting"]');
        waiting.dataset.quality=quality;
        waiting.querySelector('[data-kpi-value]').textContent=Object.values(values).filter(v=>v.value===true).length;
        waiting.querySelector('[data-kpi-state]').textContent=quality==='good'?'preview':'Παλιά ένδειξη';
        for(const id of ['transit','printing']){
            const card=document.querySelector(`[data-kpi="${id}"]`);
            card.dataset.quality='unknown';card.querySelector('[data-kpi-value]').textContent='—';card.querySelector('[data-kpi-state]').textContent='Χωρίς δεδομένα';
        }
    },
    paintLight(){
        for(const endpoint of this.host.querySelectorAll('[data-endpoint]'))endpoint.classList.toggle('is-lit',endpoint.dataset.endpoint!=='semolina-out'&&document.getElementById('preview-light').checked&&endpoint.dataset.endpoint===MelissaPlant.selected);
    },
    navigate(page,selection){
        if(page==='palomats'){MelissaPlant.openPalomatMenu(Number(selection)||MelissaPlant.lastPalomat||1);return;}
        const query=new URLSearchParams({page});
        if(page==='palomats'&&/^[1-5]$/.test(selection||''))query.set('unit',selection);
        const hash='#'+query.toString();
        if(location.hash===hash)this.renderRoute();else location.hash=hash;
    },
    status(){return '<span class="preview-status"><i>−</i> Χωρίς δεδομένα</span>';},
    card(title,body){return '<article class="preview-card"><h2>'+title+'</h2>'+body+'</article>';},
    fields(names){return '<dl class="preview-fields">'+names.map(name=>'<div><dt>'+name+'</dt><dd>—</dd></div>').join('')+'</dl>';},
    table(headers,body){return '<div class="table-wrap"><table><thead><tr>'+headers.map(h=>'<th>'+h+'</th>').join('')+'</tr></thead><tbody>'+body+'</tbody></table></div>';},
    stationTable(cell){
        const points=[...new Set(this.model.endpoints.filter(e=>e.cell===cell&&e.kind==='arrow').map(e=>e.point))];
        return this.card('Stations / Handshake AGV',this.table(['Station','Κατευθύνσεις','Παρουσία παλέτας','AGV Request','Pallet type','SSCC'],points.map(point=>{
            const directions=this.model.endpoints.filter(e=>e.cell===cell&&e.point===point).map(e=>e.direction).join(' / ');
            return '<tr><td>'+point+'</td><td>'+directions+'</td><td>—</td><td>—</td><td>—</td><td class="preview-sscc">—</td></tr>';
        }).join('')));
    },
    renderRoute(){
        const query=new URLSearchParams(location.hash.slice(1));
        const page=query.get('page')||'overview',unit=/^[1-5]$/.test(query.get('unit')||'')?Number(query.get('unit')):null;
        const button=[...document.querySelectorAll('.preview-sidebar button[data-preview-page]')].find(b=>b.dataset.previewPage===page);
        const title=unit&&page==='palomats'?'Palomat '+unit:button?.textContent.trim()||'Εγκατάσταση';
        for(const b of document.querySelectorAll('.preview-sidebar button[data-preview-page]')){b.classList.toggle('is-active',b===button);if(b===button)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');}
        document.getElementById('preview-title').textContent=title;
        document.getElementById('preview-kpis').hidden=page!=='overview';
        document.querySelector('.preview-area header').classList.toggle('has-overview-kpis',page==='overview');
        document.getElementById('preview-overview').hidden=page!=='overview';
        const screen=document.getElementById('preview-screen');screen.hidden=page==='overview';
        for(const id of ['preview-rotation-control','preview-light-control','preview-occupied-control','preview-stale-control'])document.getElementById(id).hidden=page!=='overview';
        document.getElementById('preview-semolina-control').hidden=!['overview','semolina'].includes(page);
        document.getElementById('transport').textContent=page==='overview'?'Διαδραστικό σχέδιο · επίλεξε βέλος ή άνοιξε οθόνη από το όνομα / την περιοχή':'Προεπισκόπηση οθόνης · τα πεδία παραμένουν χωρίς δεδομένα';
        if(page==='overview'){this.rotateLayout();return;}
        const back='<div class="preview-breadcrumb"><button data-preview-page="overview">← Εγκατάσταση</button><span>MELISSA / '+title+'</span>'+this.status()+'</div>';
        let body='';
        if(page==='semolina'){
            body=MelissaPlant.semolinaMarkup({preview:true,...this.semolina,quality:document.getElementById('preview-stale').checked?'stale':'good',palletGraphic:this.fullPalletGraphic});
        }else if(/^r[1-6]$/.test(page)){
            body='<div class="preview-summary">'+this.card('Κατάσταση κυψέλης',this.fields(['Λειτουργία','Ετοιμότητα','Ενεργό συμβάν']))+this.card('Επικοινωνία',this.fields(['CPLC','Controller','Τελευταία ενημέρωση']))+this.card('Παραγωγή',this.fields(['Πρόγραμμα','Κύκλος','Μετρητής παλετών']))+'</div>'+this.stationTable(page);
            body+='<div class="preview-detail-grid">'+this.card(page==='r6'?'Στοιχεία κυψέλης':'Kawasaki',this.fields(['Κατάσταση controller','Motor power','Πρόγραμμα / βήμα']))+this.card('Error log / συμβάντα','<div class="preview-empty">Δεν έχουν συνδεθεί δεδομένα συμβάντων</div>')+'</div>';
        }else if(page==='wrapper'){
            body='<div class="preview-detail-grid">'+this.card('Τυλιχτικό',this.fields(['Επικοινωνία','Κατάσταση μηχανής','Κύκλος τυλίγματος']))+this.card('Barcode',this.fields(['Κατάσταση εκτυπωτή','Τρέχον SSCC'])+'<button class="preview-action" data-preview-eidos>Άνοιγμα μενού Barcode ↗</button>')+'</div>'+this.stationTable('wrapper');
        }else if(page==='buffer'||page==='deliveries'){
            const assignments=page==='buffer';
            body='<div class="preview-tabs"><button data-preview-page="buffer" class="'+(assignments?'selected':'')+'">Αναθέσεις στα AGV</button><button data-preview-page="deliveries" class="'+(!assignments?'selected':'')+'">Ιστορικό παραδόσεων AGV</button><span>'+this.status()+'</span></div>';
            body+='<p class="preview-logistics-note">'+(assignments?'Παλέτες που έχουν παραδοθεί στα AGV και αναμένεται να επιστρέψουν στο Τυλιχτικό.':'Κάθε παλέτα που παραδόθηκε από AGV στο Τυλιχτικό.')+'</p>';
            body+=this.card(assignments?'Αναθέσεις στα AGV':'Ιστορικό παραδόσεων AGV',this.table(assignments?['Χρόνος ανάθεσης','Προέλευση','SSCC','Υλικό','Τύπος παλέτας','Κατάσταση']:['Παράδοση στο Τυλιχτικό','Προέλευση','SSCC','Υλικό','Τύπος παλέτας','AGV'],'<tr><td colspan="6"><div class="preview-empty">Δεν έχουν συνδεθεί δεδομένα '+(assignments?'αναθέσεων':'παραδόσεων')+'<br><small>'+(assignments?'Οι παλέτες παραμένουν εδώ μέχρι την παράδοση στο Τυλιχτικό.':'Η καταχώρηση ολοκληρώνεται με την παράδοση στο Τυλιχτικό.')+'</small></div></td></tr>'));
        }else if(page==='palomats'){
            body='<div class="preview-tabs"><button data-preview-page="palomats" class="'+(!unit?'selected':'')+'">Όλα τα Palomats</button>'+[1,2,3,4,5].map(n=>'<button data-preview-page="palomats" data-preview-selection="'+n+'" class="'+(n===unit?'selected':'')+'">Palomat '+n+'</button>').join('')+'</div><div class="preview-palomats '+(unit?'one':'')+'">';
            body+=(unit?[unit]:this.model.palomats.map(p=>p.number)).map(n=>{
                const p=this.model.palomats.find(p=>p.number===n);
                const visual='<div class="preview-palomat-art">'+this.palomatArtwork[p.palletFamily]+'<span>'+p.palletName+'</span></div>';
                return this.card('Palomat '+n,visual+this.status()+this.fields(['Επικοινωνία','Ετοιμότητα','Παλέτα διαθέσιμη','Αίτημα','Σφάλμα'])+(!unit?'<button class="preview-action" data-preview-page="palomats" data-preview-selection="'+n+'">Στοιχεία Palomat '+n+' ↗</button>':''));
            }).join('')+'</div>';
        }else if(page==='eidos'){
            body='<div class="preview-detail-grid">'+this.card('Εκτυπωτής Barcode',this.fields(['Επικοινωνία','Κατάσταση','Τρέχον μήνυμα'])+'<button class="preview-action" data-preview-eidos>Άνοιγμα μενού Barcode ↗</button>')+this.card('Στοιχεία ετικέτας',this.fields(['SSCC','Κωδικός είδους','Περιγραφή']))+'</div>';
        }else{
            body=this.card(title,this.status()+'<div class="preview-empty">Προεπισκόπηση οθόνης · χωρίς σύνδεση δεδομένων</div>');
        }
        screen.innerHTML=back+body;
    }
};
