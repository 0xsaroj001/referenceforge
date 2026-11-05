// Optional local preflight for our canonical-only material. No export or upload.
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {auditCase} from './evidence.mjs';
import {checkAnswerEnvelope} from './answer-envelope.mjs';
assert(process.argv.length===2,'No arguments or credentials accepted; reads the existing private development catalog only');
const bytes=await readFile('evaluator-v2/local/tx-evidence-cases.json'),catalog=JSON.parse(bytes);assert(Array.isArray(catalog.pairs)&&catalog.pairs.length>0,'Missing development pairs');
for(const item of catalog.pairs){auditCase(item);assert(checkAnswerEnvelope(item.request,item.evidence,item.chosen).valid,'Chosen answer fails strict envelope: '+item.id);assert(!checkAnswerEnvelope(item.request,item.evidence,item.rejected).valid,'Rejected answer passes strict envelope: '+item.id);}
const hash=b=>createHash('sha256').update(b).digest('hex'),report={checked_at:new Date().toISOString(),policy:'canonical_answer_envelope_v1',development_pairs:catalog.pairs.length,chosen_accepted:catalog.pairs.length,rejected_refused:catalog.pairs.length,catalog_sha256:hash(bytes),policy_source_sha256:hash(await readFile(new URL('./answer-envelope.mjs',import.meta.url))),scope:'Development-material preflight only. Frozen field audit and baseline receipts unchanged; not unseen evaluation, a node schema requirement or a quality score.',uploaded:false};
await mkdir('reports/evaluator-v2/answer-envelope',{recursive:true});await writeFile('reports/evaluator-v2/answer-envelope/development-preflight.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
