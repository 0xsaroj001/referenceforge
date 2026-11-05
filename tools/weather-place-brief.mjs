import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {createUSPlaceResolver} from '../src/us-place-resolver.mjs';
import {collectPlaceWeather} from './lib/place-weather.mjs';
const args=process.argv.slice(2),values={};let resolveOnly=false;
for(let i=0;i<args.length;i++){if(args[i]==='--resolve-only'){assert(!resolveOnly);resolveOnly=true;continue;}assert(['--location','--hours'].includes(args[i])&&!Object.hasOwn(values,args[i])&&typeof args[i+1]==='string','Use --location "City, ST" [--hours 1..48] [--resolve-only]');values[args[i]]=args[++i];}
assert(values['--location'],'An explicit city and state are required');
const raw=await readFile('dist/census/us-places-2026.json').catch(error=>{if(error.code==='ENOENT')throw Error('Run python tools/prepare-us-places.py first. No unpinned geocoder is substituted.');throw error;});
assert.equal(createHash('sha256').update(raw).digest('hex'),'7ca6c01a06552fdfb0844973c8a18c48f107ca399d9a4a71412dfbf33a34e826','Prepared Census table drift; rebuild/review');
const resolve=createUSPlaceResolver(JSON.parse(raw));
if(resolveOnly)console.log(JSON.stringify(resolve(values['--location']),null,2));
else{
  assert(!values['--hours']||/^(?:[1-9]|[1-3][0-9]|4[0-8])$/.test(values['--hours']),'Window must be 1..48 hours');
  const report=await collectPlaceWeather({resolve,location:values['--location'],hours:Number(values['--hours']??24)});
  const path='reports/place-weather/'+report.checked_at.replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8)+'.json';await mkdir('reports/place-weather',{recursive:true});await writeFile(path,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({report_file:path,pass:report.pass,place:report.place.official_name,state:report.place.state,summary:report.summary,failure:report.failure,direct_http_calls:report.captures.length},null,2));if(!report.pass)process.exitCode=1;
}
