// Browser-only EIP-1193 interface. The wallet owns all signing and key handling.
const owner='0xfec66e0f5c64296ff190edced88c781eeedfd9d3',chain='0xaa36a7',journalKey='referenceforge-test-funding-attempt-v1';
const $=id=>document.getElementById(id);let wallet,plan,busy=false;
const say=text=>{$('status').textContent=text;};
async function apiPlan(){const r=await fetch('/api/plan',{cache:'no-store'}),j=await r.json();if(!r.ok)throw Error(j.error??'Preflight failed');plan=j;render();return j;}
function render(){
  if(!plan)return;
  $('machina').textContent=plan.wallet_machina;$('bond').textContent=plan.bond_machina;$('usdc').textContent=plan.wallet_test_usdc;
  $('quote').textContent=plan.quoted_machina;$('minimum').textContent=plan.minimum_machina;
  $('gas').textContent=plan.maximum_total_gas_cost_test_eth??'0';
  $('approve').disabled=busy||!wallet||!plan.required||!plan.approval_required;
  $('swap').disabled=busy||!wallet||!plan.required||plan.approval_required;
  $('ready').hidden=plan.required;
}
async function context(){
  const accounts=await wallet.request({method:'eth_accounts'});if(accounts[0]?.toLowerCase()!==owner)throw Error('Select wallet 0xFEc6…d9d3. No transaction was requested.');
  if((await wallet.request({method:'eth_chainId'})).toLowerCase()!==chain)throw Error('Switch your wallet to Ethereum Sepolia, chain 11155111.');
  const [latest,pending]=await Promise.all(['latest','pending'].map(tag=>wallet.request({method:'eth_getTransactionCount',params:[owner,tag]})));if(BigInt(latest)!==BigInt(pending))throw Error('A transaction is already pending. Wait for its receipt.');return latest;
}
async function receipt(hash){
  for(let count=0;count<180;count++){const r=await wallet.request({method:'eth_getTransactionReceipt',params:[hash]});if(r){if(BigInt(r.status)!==1n)throw Error('Transaction reverted. Inspect '+hash+' before another attempt.');return r;}await new Promise(resolve=>setTimeout(resolve,2000));}
  throw Error('Still pending: '+hash+'. Do not submit another transaction.');
}
async function reconcile(){
  const raw=localStorage.getItem(journalKey);if(!raw)return;
  const item=JSON.parse(raw);if(!item.hash)throw Error('An earlier wallet request has an uncertain outcome. Inspect your wallet activity before retrying; no new request will be made.');
  const r=await wallet.request({method:'eth_getTransactionReceipt',params:[item.hash]});if(!r)throw Error('Earlier transaction is still pending: '+item.hash);
  // Keep a public, local receipt history, including failed receipts.
  const history=JSON.parse(localStorage.getItem(journalKey+'-history')??'[]');history.push({...item,receipt:r});localStorage.setItem(journalKey+'-history',JSON.stringify(history));localStorage.removeItem(journalKey);
  if(BigInt(r.status)!==1n)throw Error('Earlier transaction reverted: '+item.hash+'. Refresh and review the new plan.');
}
async function send(kind){
  if(busy)return;busy=true;render();let attempted=false;
  try{
    if(!wallet)throw Error('Connect your existing wallet first.');await reconcile();await context();await apiPlan();
    if(!plan.required){say('Wallet already covers the current bond. Return to Anjoman Evaluate.');return;}
    const step=plan.steps.find(x=>x.kind===kind);if(!step)throw Error('This step is no longer needed. Refreshed the balances.');
    if(kind.startsWith('swap')&&plan.approval_required)throw Error('Confirm the exact 1-USDC approval first.');
    if(Number(plan.deadline)*1000-Date.now()<120000)throw Error('Quote is expiring. Refresh and try again.');
    const nonce=await context(),tx={...step.transaction,nonce};
    if(BigInt(tx.chainId)!==11155111n||tx.from.toLowerCase()!==owner||BigInt(tx.value)!==0n)throw Error('Unexpected transaction context.');
    // Simulate with actual wallet state immediately before requesting a signature.
    await wallet.request({method:'eth_call',params:[{from:tx.from,to:tx.to,data:tx.data,value:'0x0'},'latest']});await context();
    localStorage.setItem(journalKey,JSON.stringify({kind,nonce,transaction:tx,requested_at:new Date().toISOString()}));attempted=true;
    say('Review the '+(kind.startsWith('approve')?'exact 1 test-USDC approval':'1 test-USDC swap')+' in your wallet.');
    let hash;try{hash=await wallet.request({method:'eth_sendTransaction',params:[tx]});}catch(error){if(Number(error.code)===4001){localStorage.removeItem(journalKey);attempted=false;}throw error;}
    if(!/^0x[0-9a-f]{64}$/i.test(hash))throw Error('Wallet did not return a transaction hash. Inspect wallet activity.');
    const item=JSON.parse(localStorage.getItem(journalKey));localStorage.setItem(journalKey,JSON.stringify({...item,hash}));
    $('tx').textContent=hash;$('tx').href='https://sepolia.etherscan.io/tx/'+hash;say('Transaction submitted. Waiting for its receipt.');
    await receipt(hash);await reconcile();attempted=false;await apiPlan();say(plan.required?'Approval confirmed. Review the refreshed amounts, then click Swap.':'Swap confirmed. Your balance covers the current bond. Return to Anjoman Evaluate and publish the WASM.');
  }catch(error){say((error.shortMessage??error.message??String(error))+(attempted?' An attempt remains recorded; no automatic retry.':''));}
  finally{busy=false;render();}
}
$('connect').onclick=async()=>{
  try{
    const providers=window.ethereum?.providers??(window.ethereum?[window.ethereum]:[]);if(!providers.length)throw Error('No wallet extension is exposed here. If you use only Anjoman’s built-in wallet, tell Codex; do not paste or export a key into this page.');
    wallet=providers.find(p=>p.isMetaMask)??providers[0];await wallet.request({method:'eth_requestAccounts'});
    if((await wallet.request({method:'eth_chainId'})).toLowerCase()!==chain)await wallet.request({method:'wallet_switchEthereumChain',params:[{chainId:chain}]});
    await context();await reconcile();await apiPlan();say('Connected to the intended owner on Ethereum Sepolia. Review the amounts.');
    wallet.on?.('accountsChanged',()=>{wallet=null;render();say('Wallet account changed. Reconnect and recheck.');});wallet.on?.('chainChanged',()=>{wallet=null;render();say('Wallet chain changed. Reconnect and recheck.');});
  }catch(error){wallet=null;say(error.message??String(error));render();}
};
$('refresh').onclick=async()=>{try{await apiPlan();say('Balances and quote refreshed.');}catch(e){say(e.message);}};
$('approve').onclick=()=>send('approve_exact_one_test_usdc');$('swap').onclick=()=>send('swap_one_test_usdc_for_test_machina');
apiPlan().then(()=>say('Read-only preflight passed. Connect the existing owner wallet to continue.')).catch(e=>say(e.message));
