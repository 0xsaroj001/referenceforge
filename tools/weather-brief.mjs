import {writeFile} from 'node:fs/promises';
import {weatherBrief} from '../src/weather-brief.mjs';
const params=new URLSearchParams({lat:'25.7617',lon:'-80.1918'}),answers=[];
for(const kind of ['forecast','current','alerts']){const r=await fetch('https://referenceforge.0xsaroj001.workers.dev/weather/'+kind+'?'+params,{redirect:'error',signal:AbortSignal.timeout(15000)});answers.push(await r.json());}
const report={checked_at:new Date().toISOString(),transport:'direct_public_HTTP_not_Telegraph',...weatherBrief(answers)};
await writeFile('reports/weather/operations-brief.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));if(report.review_priority==='insufficient_data')process.exitCode=1;
