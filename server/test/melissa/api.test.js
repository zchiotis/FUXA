'use strict';
const assert=require('assert/strict'),express=require('express');
const {create}=require('../../api/melissa');
describe('Melissa API authorization',function(){
    let server;
    afterEach(()=>new Promise(resolve=>server.close(resolve)));
    it('does not expose diagnostic snapshots to a guest when security is enabled',async function(){
        const app=express(),runtime={settings:{secureEnabled:true},melissa:{snapshot:()=>({secret:'not-for-guest'})}};
        app.use(create(runtime,(req,res,next)=>next(),()=>0));
        server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
        const response=await fetch(`http://127.0.0.1:${server.address().port}/api/melissa/snapshot`);
        assert.equal(response.status,403);assert.ok(!(await response.text()).includes('not-for-guest'));
    });
    it('rejects requests while the integration is disabled',async function(){
        const app=express();app.use(create({settings:{}},(req,res,next)=>next(),()=>-1));
        server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
        assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/api/melissa/snapshot`)).status,503);
    });
});
