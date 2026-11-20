'use strict';
// Portable package initialization on the test computer. Never overwrites a project DB.
const fs=require('fs'),path=require('path'),sqlite3=require('sqlite3');
const root=path.resolve(__dirname,'../../..'),data=path.join(root,'data'),app=path.join(data,'_appdata');
fs.mkdirSync(app,{recursive:true});
const settings=path.join(app,'settings.js');
if(!fs.existsSync(settings))fs.copyFileSync(path.join(root,'examples/melissa/settings.js'),settings);
const file=path.join(app,'project.fuxap.db');
async function main(){
    if(fs.existsSync(file)){console.log('Existing Melissa project preserved: '+file);return;}
    const db=new sqlite3.Database(file),project=JSON.parse(fs.readFileSync(path.join(root,'examples/melissa/Melissa_CPLC.fuxap')));
    const run=(sql,args=[])=>new Promise((resolve,reject)=>db.run(sql,args,e=>e?reject(e):resolve()));
    const tables=['general','views','devices','devicesSecurity','texts','alarms','notifications','scripts','reports','locations'];
    try{
        await run('BEGIN');
        for(const table of tables)await run(`CREATE TABLE ${table} (name TEXT PRIMARY KEY,value TEXT${table==='devices'?',connection TEXT,cntid TEXT,cntpwd TEXT':''})`);
        for(const [name,value]of Object.entries(project)){
            if(name==='hmi'){
                await run('INSERT INTO general VALUES(?,?)',['layout',JSON.stringify(value.layout)]);
                for(const view of value.views)await run('INSERT INTO views VALUES(?,?)',[view.id,JSON.stringify(view)]);
            }else if(name==='devices'){
                for(const d of Object.values(value))await run('INSERT INTO devices(name,value) VALUES(?,?)',[d.id,JSON.stringify(d)]);
            }else if(name==='server')await run('INSERT INTO devices(name,value) VALUES(?,?)',['server',JSON.stringify(value)]);
            else if(!tables.includes(name))await run('INSERT INTO general VALUES(?,?)',[name,JSON.stringify(value)]);
        }
        await run('COMMIT');
        console.log('Melissa project prepared, all external devices disabled.');
    }catch(e){await run('ROLLBACK');throw e;}
    finally{await new Promise(resolve=>db.close(resolve));}
    const widgetDir=path.join(data,'_widgets');fs.mkdirSync(widgetDir,{recursive:true});
    for(const name of fs.readdirSync(path.join(root,'examples/melissa/widgets')))fs.copyFileSync(path.join(root,'examples/melissa/widgets',name),path.join(widgetDir,name));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
