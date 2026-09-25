'use client';
import { use, useEffect, useRef, useState } from 'react';
type Info={amountCents:number;currency:string;status:string;businessName:string;policyUrl:string;policyVersion:string;paypalClientId:string|null;paypalSandbox:boolean;stripeEnabled:boolean};
type Buttons={isEligible:()=>boolean;render:(el:HTMLElement)=>Promise<void>;close:()=>Promise<void>};
declare global{interface Window{paypal?:{FUNDING:{VENMO:string};Buttons:(options:{fundingSource:string;createOrder:()=>Promise<string>;onApprove:()=>Promise<void>;onCancel:()=>void;onError:(e:unknown)=>void})=>Buttons}}}
export default function PaymentPage({params}:{params:Promise<{token:string}>}){
 const {token}=use(params),[info,setInfo]=useState<Info|null>(null),[error,setError]=useState(''),[accepted,setAccepted]=useState(false),[busy,setBusy]=useState(false),[venmoUnavailable,setVenmoUnavailable]=useState(false);
 const acceptRef=useRef(accepted);acceptRef.current=accepted;const venmo=useRef<HTMLDivElement>(null);
 const endpoint=`/api/client-pay/${encodeURIComponent(token)}`;
 const request=async(path:string,body:unknown={})=>{const r=await fetch(endpoint+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const j=await r.json();if(!r.ok)throw Error(j.error?.message||'Payment request failed');return j;};
 useEffect(()=>{let alive=true;const load=async()=>{try{const r=await fetch(endpoint,{cache:'no-store'});const j=await r.json();if(!r.ok)throw Error(j.error?.message||'Payment link unavailable');if(alive)setInfo(j);}catch(e){if(alive)setError((e as Error).message);}};void load();const timer=setInterval(load,5000);return()=>{alive=false;clearInterval(timer);};},[endpoint]);
 const clientId=info?.paypalClientId,version=info?.policyVersion,sandbox=info?.paypalSandbox,paid=info?.status==='paid'||info?.status==='refunded'||info?.status==='partially_refunded';
 useEffect(()=>{
  if(!clientId||!venmo.current||paid)return;let disposed=false,buttons:Buttons|undefined;
  const script=document.createElement('script');script.src=`https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&components=buttons&currency=USD&enable-funding=venmo${sandbox?'&buyer-country=US':''}`;
  script.onload=()=>{if(disposed||!window.paypal||!venmo.current)return;buttons=window.paypal.Buttons({fundingSource:window.paypal.FUNDING.VENMO,
   createOrder:async()=>{if(!acceptRef.current)throw Error('Please accept the service policies first');setError('');const j=await request('/venmo/order',{acceptedPolicyVersion:version});return j.id;},
   onApprove:async()=>{const j=await request('/venmo/capture');if(j.status!=='paid')setError('Payment is processing. Check status shortly.');},
   onCancel:()=>setError('Venmo checkout was cancelled. You can retry.'),onError:e=>setError(e instanceof Error?e.message:'Venmo is unavailable. Please contact the shop.'),
  });if(buttons.isEligible())void buttons.render(venmo.current);else setVenmoUnavailable(true);};
  script.onerror=()=>setVenmoUnavailable(true);document.body.appendChild(script);return()=>{disposed=true;void buttons?.close();script.remove();};
  // request is scoped to the token and is intentionally recreated with this effect.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[clientId,version,sandbox,paid,endpoint]);
 const stripe=async()=>{if(!info||!accepted||busy)return;setBusy(true);setError('');try{const j=await request('/stripe',{acceptedPolicyVersion:info.policyVersion});window.location.assign(j.url);}catch(e){setError((e as Error).message);setBusy(false);}};
 return <main style={{maxWidth:500,margin:'40px auto',padding:24,lineHeight:1.6}}><h1>{info?.businessName||'Service payment'}</h1>{info&&<><p style={{fontSize:36,fontWeight:700}}>{new Intl.NumberFormat('en-US',{style:'currency',currency:info.currency}).format(info.amountCents/100)}</p><p>Status: <strong>{info.status==='pending'?'Awaiting payment':info.status.replace('_',' ')}</strong></p>
 {!paid&&<><label style={{display:'flex',gap:12}}><input type="checkbox" checked={accepted} onChange={e=>setAccepted(e.target.checked)} style={{width:'auto'}}/><span>I agree to the <a href={info.policyUrl} target="_blank" rel="noopener noreferrer">service terms, privacy notice, and cancellation/refund policy</a>.</span></label>
 {info.stripeEnabled&&<button className="btn btn-primary" style={{width:'100%',margin:'20px 0'}} disabled={!accepted||busy} onClick={stripe}>Pay by card or Apple Pay</button>}
 <p>Apple Pay appears in secure checkout when supported by your device and wallet. You can scan this payment link at the dock and pay on your own phone.</p>
 {clientId&&<><h2>Venmo</h2><div ref={venmo}/>{venmoUnavailable&&<p>Venmo is not available for this browser or account. Try Safari on iPhone or Chrome on Android with the Venmo app installed.</p>}<button className="btn btn-secondary" onClick={async()=>{try{const j=await request('/venmo/capture');setError(j.status==='paid'?'Payment verified.':'Payment is still processing.');}catch(e){setError((e as Error).message);}}}>Check Venmo payment</button></>}
 {!info.stripeEnabled&&!clientId&&<p>Payments are not connected. Contact the shop.</p>}</>}
 </>}{error&&<p role="status">{error}</p>}</main>;
}
