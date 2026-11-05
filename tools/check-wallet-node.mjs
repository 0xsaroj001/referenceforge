// Offline only. No fetch, wallet, upload, signature or Engine request.
import assert from 'node:assert/strict';
import{readFile,mkdir,writeFile}from'node:fs/promises';
import{resolve}from'node:path';import{createHash}from'node:crypto';
import{parseUniqueJson}from'../evaluator-v2/strict-json.mjs';
import{assessWalletNodeReceipt}from'./lib/wallet-node-receipt.mjs';
assert(process.argv.length===4,'Use node tools/check-wallet-node.mjs <raw-receipt.json> <source-capture.json>');
const files=process.argv.slice(2).map(x=>resolve(x)),sha=b=>createHash('sha256').update(b).digest('hex');
const bytes=await Promise.all(files.map(async path=>{const b=await readFile(path);assert(b.length<=2097152,'INPUT_TOO_LARGE');assert.equal(sha(b),(await readFile(path+'.sha256','utf8')).trim(),'INPUT_HASH_CHANGED');return b;}));
const report=assessWalletNodeReceipt(bytes[0].toString('utf8'),parseUniqueJson(bytes[1].toString('utf8')));
report.receipt_sha256=sha(bytes[0]);report.capture_sha256=sha(bytes[1]);report.http_calls=0;
report.hash_limit='Sidecars detect byte changes, not source authenticity; supplied captures may be fabricated.';
const folder=resolve(import.meta.dirname,'../reports/wallet-node-shaping-2026-11-04');await mkdir(folder,{recursive:true});
const path=resolve(folder,'receipt-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+process.pid+'.json');
await writeFile(path,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({...report,report_path:path},null,2));
if(!report.pass)process.exitCode=1;
