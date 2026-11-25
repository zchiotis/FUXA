'use strict';
const assert=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const {EventEmitter}=require('events');
const manifest=require('../../../examples/melissa/manifest.json');
const adapter=require('../../runtime/devices/melissa');
const {create}=require('../../runtime/melissa');
const logger={info(){},warn(){},error(){}};

describe('Melissa archive mapping and read-only S7',function(){
    it('uses v0.4 wrapper and Palomat offsets, not the v0.3 PDF',function(){
        assert.equal(manifest.stations.length,35);
        assert.equal(manifest.stations.find(s=>s.name==='WRAP-IN').byte,826);
        assert.equal(manifest.tags.find(t=>t.path==='PALOMAT-1.PAL_XOUT_Ready').byte,816);
        assert.equal(manifest.tags.find(t=>t.path==='Interface.AGV_Status').byte,850);
        assert.equal(manifest.tags.find(t=>t.path==='R1-1OUT.SSCC').byte,4);
        assert.equal(manifest.tags.find(t=>t.path==='R1-1OUT.PalletType').byte,2);
        assert.equal(new Set(manifest.tags.map(t=>t.id)).size,manifest.tags.length);
        assert.ok(manifest.tags.every(t=>[100,13].includes(t.db)&&t.access==='read'));
    });
    it('decodes unsigned pallet type and preserves leading SSCC zeroes',function(){
        const b=Buffer.alloc(24);b[0]=31;b.writeUInt16BE(65535,2);b[4]=18;b[5]=18;b.write('000000000000000123',6,'ascii');
        const find=path=>manifest.tags.find(t=>t.path==='R1-1OUT.'+path);
        assert.equal(adapter.decode(b,find('Operational')),true);
        assert.equal(adapter.decode(b,find('PalletType')),65535);
        assert.equal(adapter.decode(b,find('SSCC')),'000000000000000123');
        b[5]=19;assert.throws(()=>adapter.decode(b,find('SSCC')),/STRING/);
    });
    it('publishes complete samples; rejects writes; invalidates read errors',async function(){
        let fail=false;
        const config={id:'melissa-cplc',name:'test',property:manifest.cplc,tags:{}};
        for(const t of manifest.tags)config.tags[t.id]={id:t.id,type:t.type==='STRING'?'String':t.type,daq:{enabled:true,changed:true,interval:10}};
        class FakeS7 {
            Connected(){return true;} ConnectTo(a,r,s,cb){cb(0);} Disconnect(){}
            ErrorText(){return 'synthetic read error';}
            DBRead(number,start,size,cb){
                if(fail)return cb(1);
                const buffer=Buffer.alloc(size);
                for(const t of manifest.tags.filter(t=>t.db===number&&t.type==='STRING'))buffer[t.byte]=t.length;
                cb(0,buffer);
            }
        }
        const client=adapter.create(config,logger,new EventEmitter(),null,{}, {S7Client:FakeS7});
        let daqCount=0;client.bindAddDaq(values=>{daqCount+=Object.keys(values).length;});
        await client.connect();await client.polling();
        assert.equal(Object.keys(client.getValues()).length,manifest.tags.length);
        assert.equal(client.getValues()['db100.R1-1OUT.SSCC'].quality,'good');
        const first=daqCount;await client.polling();assert.equal(daqCount,first,'unchanged values wait for sample interval');
        await assert.rejects(client.setValue('x',true),/read-only/);
        fail=true;await client.polling();assert.equal(client.getStatus(),'read-error');assert.equal(client.getValues()['db100.R1-1OUT.SSCC'].quality,'bad');
    });
});

describe('Melissa event persistence and freshness',function(){
    let dir,runtime,service;
    beforeEach(function(){dir=fs.mkdtempSync(path.join(os.tmpdir(),'melissa-test-'));runtime={settings:{dbDir:dir,melissa:{staleMs:10}},logger,events:new EventEmitter(),project:{getDevices:()=>({'melissa-cplc':{id:'melissa-cplc',name:'test',enabled:true,tags:{}}})}};service=create(runtime);});
    afterEach(async function(){await service.close();fs.rmSync(dir,{recursive:true,force:true});});
    it('distinguishes unknown, good, stale and bad while retaining last known value',async function(){
        assert.equal(service.snapshot().cplc['R1-1OUT.SSCC'].quality,'unknown');
        const id='db100.R1-1OUT.SSCC',timestamp=Date.now();
        runtime.events.emit('device-status:changed',{id:'melissa-cplc',status:'connect-ok'});
        runtime.events.emit('device-value:changed',{id:'melissa-cplc',values:{[id]:{id,value:'0001',timestamp,quality:'good'}}});
        assert.equal(service.snapshot(timestamp).cplc['R1-1OUT.SSCC'].quality,'good');
        assert.equal(service.snapshot(timestamp+11).cplc['R1-1OUT.SSCC'].quality,'stale');
        runtime.events.emit('device-status:changed',{id:'melissa-cplc',status:'read-error'});
        assert.equal(service.snapshot(timestamp).cplc['R1-1OUT.SSCC'].quality,'bad');
        assert.equal(service.snapshot(timestamp).cplc['R1-1OUT.SSCC'].value,'0001');
        assert.equal(service.snapshot().buffer.verifiedDelivered,false);
        const events=await service.history();assert.ok(events.some(e=>e.kind==='tag-change'));
    });
    it('stores events in a separate SQLite DB and survives service restart',async function(){
        service.record('test','melissa-runtime','test',"O'Hara <script>");
        await service.close();service=create(runtime);await service.ready;
        const rows=await service.history();assert.ok(rows.some(e=>e.kind==='test'&&JSON.parse(e.value)==="O'Hara <script>"));
        assert.ok(fs.existsSync(path.join(dir,'melissa-events.db')));
        assert.ok(!rows.some(e=>e.kind==='pallet-delivered'));
    });
    it('keeps legacy pickup rows separate from the wrapper-delivery ledger',async function(){
        await service.ready;
        const db=new (require('sqlite3').Database)(path.join(dir,'melissa-events.db'));
        await new Promise((resolve,reject)=>db.run('INSERT INTO deliveries(timestamp,station,sscc,source_event_id,evidence) VALUES(?,?,?,?,?)',[1,'R1','0001','legacy-pickup','legacy'],e=>e?reject(e):resolve()));
        await new Promise(resolve=>db.close(resolve));
        assert.deepEqual(await service.deliveryHistory(),[]);
        await service.close();service=create(runtime);await service.ready;
        assert.deepEqual(await service.deliveryHistory(),[]);
    });
});
