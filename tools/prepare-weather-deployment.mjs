import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,readdir,writeFile} from 'node:fs/promises';
import {weatherDescriptor,UNIFIED_ORIGIN} from './render-weather-miner.mjs';
import {routingDescriptor} from './render-routing-miner.mjs';
const dir='deploy/weather-public/',reportDir='reports/weather/';
// Public artifacts are independently pinned; no ignored historical report is needed.
const allowed=[
  {file:'miner.yaml',sha256:'0x5a676c4d038e763647772510967de4b381b9e149ac1d93423ad68e8669b12752'},
  {file:'referenceforge-comparator.wasm',sha256:'0xc82ad16c8baa95a1da2247eb3db819f8a8fc333fd245bc368289e0dff70fc507'},
  {file:'artifact-manifest.json',sha256:'0xca49fd36eb7abdb6a69f66a90bc315477a39626e1825abcd4c31e575d6ac2a9d'},
  {file:'referenceforge-unified.yaml',sha256:'0x6c1d031c2cc64ad6a57db83c8bb18af5538ef9531df2872b11267ead929d349a'},
  {file:'referenceforge-expanded.yaml',sha256:'0x95f0c102e41a72d569302a9664ce37e55ccfdce56762018e7f9f0e3823d1e197'},
  {file:'referenceforge-expanded-no-fx.yaml',sha256:'0xb1aa128c22c904ba6fef49f9d690f6d2f6b2596b5bda4a312a1b486d66c1fcef'}
];
await mkdir(dir,{recursive:true});await mkdir(reportDir,{recursive:true});assert((await readdir(dir)).every(x=>[...allowed.map(x=>x.file),'referenceforge-weather.yaml','referenceforge-routing.yaml'].includes(x)));
const sha=b=>'0x'+createHash('sha256').update(b).digest('hex');
for(const a of allowed){const r=await fetch(UNIFIED_ORIGIN+'/'+a.file,{redirect:'error',signal:AbortSignal.timeout(10000)});assert(r.ok);const bytes=Buffer.from(await r.arrayBuffer());assert.equal(sha(bytes),a.sha256);await writeFile(dir+a.file,bytes);}
const descriptor=weatherDescriptor(),bytes=JSON.stringify(descriptor,null,2)+'\n',output={file:'referenceforge-weather.yaml',url:UNIFIED_ORIGIN+'/referenceforge-weather.yaml',sha256:sha(bytes),bytes:Buffer.byteLength(bytes),intents:descriptor.semantics.supported_intents};
await writeFile(dir+output.file,bytes);
const candidateBytes=JSON.stringify(routingDescriptor(),null,2)+'\n',candidate={file:'referenceforge-routing.yaml',url:UNIFIED_ORIGIN+'/referenceforge-routing.yaml',sha256:sha(candidateBytes),bytes:Buffer.byteLength(candidateBytes)};
await writeFile(dir+candidate.file,candidateBytes);await writeFile(reportDir+'prepared.json',JSON.stringify({prepared_at:new Date().toISOString(),preserved:allowed,output,candidate_outputs:[candidate]},null,2)+'\n');console.log(JSON.stringify({output,candidate},null,2));
