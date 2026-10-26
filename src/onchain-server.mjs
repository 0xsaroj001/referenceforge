import http from 'node:http';
import { Readable } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { createOnchainHandler } from './onchain/http.mjs';

export function createOnchainServer(options={}) {
  const handler=createOnchainHandler(options);
  const server=http.createServer(async(req,res)=>{
    const controller=new AbortController();
    res.on('close',()=>{if(!res.writableEnded)controller.abort();});
    try {
      const request=new Request('http://localhost'+req.url,{method:req.method,headers:req.headers,signal:controller.signal,...(!['GET','HEAD'].includes(req.method)?{body:Readable.toWeb(req),duplex:'half'}:{})});
      const result=await handler(request);
      res.writeHead(result.status,Object.fromEntries(result.headers));
      res.end(Buffer.from(await result.arrayBuffer()));
    } catch {
      if(!res.headersSent)res.writeHead(500,{'content-type':'application/json','cache-control':'no-store'});
      res.end('{"status":"error","verified_answer":false,"error":{"code":"HTTP_ERROR","message":"Request could not be processed"}}\n');
    }
  });
  server.requestTimeout=8000;server.headersTimeout=5000;server.keepAliveTimeout=1000;
  return server;
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url) {
  const port=Number(process.env.ONCHAIN_PORT??8790),host=process.env.ONCHAIN_HOST??'127.0.0.1';
  if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Invalid ONCHAIN_PORT');
  createOnchainServer().listen(port,host,()=>console.log(`ReferenceForge Onchain local: http://${host}:${port}; admission unverified`));
}
