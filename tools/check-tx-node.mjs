// Offline checks of supplied receipt/source bytes. Inputs stay in ignored reports.
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {assessTxNodeReceipt,parseTxCapture} from './lib/tx-node-receipt.mjs';

assert(process.argv.length===4,'Use node tools/check-tx-node.mjs <raw-receipt.json> <source-capture.json>');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const inputs=await Promise.all(process.argv.slice(2).map(async name=>{
  const path=resolve(name),bytes=await readFile(path);
  assert(bytes.length<=2097152,'INPUT_TOO_LARGE');
  assert.equal(sha(bytes),(await readFile(path+'.sha256','utf8')).trim(),'INPUT_HASH_CHANGED');
  return bytes;
}));
const report=assessTxNodeReceipt(inputs[0].toString('utf8'),parseTxCapture(inputs[1].toString('utf8')));
Object.assign(report,{
  receipt_sha256:sha(inputs[0]),capture_sha256:sha(inputs[1]),http_calls:0,
  evidence_limit:'Supplied bytes and sidecars can be fabricated. A direct capture does not prove the raw answer came from this Engine execution.'
});
const directory=resolve(import.meta.dirname,'../reports/tx-node-receipts');
await mkdir(directory,{recursive:true});
const path=resolve(directory,new Date().toISOString().replaceAll(':','-')+'-'+randomUUID()+'.json');
await writeFile(path,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({...report,report_path:path},null,2));
if(!report.pass)process.exitCode=1;
