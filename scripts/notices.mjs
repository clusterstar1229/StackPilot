import fs from 'node:fs';import path from 'node:path';
const manifest=JSON.parse(fs.readFileSync('package.json','utf8'));const lock=JSON.parse(fs.readFileSync('package-lock.json','utf8'));
const dependencies=Object.entries(lock.packages).filter(([p,v])=>p&&p.includes('node_modules/')&&!v.dev&&!v.link).map(([p,v])=>{
 let metadata={};try{metadata=JSON.parse(fs.readFileSync(path.join(p,'package.json'),'utf8'));}catch{}
 return{name:metadata.name||p.split('node_modules/').at(-1),version:metadata.version||v.version,license:metadata.license||v.license||'See package LICENSE',repository:typeof metadata.repository==='string'?metadata.repository:metadata.repository?.url};
}).sort((a,b)=>a.name.localeCompare(b.name));
fs.writeFileSync('THIRD_PARTY_NOTICES.json',JSON.stringify({generatedAt:new Date().toISOString(),appVersion:manifest.version,note:'Production dependency metadata; original package LICENSE files remain authoritative.',dependencies},null,2)+'\n');
console.log('Recorded '+dependencies.length+' production dependencies.');
