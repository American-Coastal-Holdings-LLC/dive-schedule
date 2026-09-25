'use client';
import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { api } from '@/lib/api';
import { usePermissions } from './PermissionsProvider';
import { useResource } from '@/lib/hooks';
import { PERMISSIONS as P } from '@/lib/permissions';
export function PaymentActions({recordId}:{recordId:string}){
 const {can}=usePermissions(),[url,setUrl]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const state=useResource<{status:string;enabled:boolean}>(can(P.FINANCE_VIEW)?`/api/payments/${recordId}`:null);
 if(!can(P.FINANCE_VIEW)&&!can(P.FINANCE_MANAGE))return null;
 return <section style={{margin:'20px 0',padding:16,border:'1px solid var(--border)',borderRadius:12}}><h3>Client payment</h3><p>Status: {state.data?.status??'Unavailable'}</p>
 {can(P.FINANCE_MANAGE)&&can(P.JOBS_VIEW_PRICING)&&<button className="btn btn-primary" disabled={busy} onClick={async()=>{setBusy(true);try{const j=await api.post<{url:string}>(`/api/payments/${recordId}/link`);setUrl(j.url);setError('');}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>Create dockside payment link</button>}
 {url&&<><p>Customer scans this code on their own phone to pay by card, eligible Apple Pay, or connected Venmo.</p><QRCodeSVG value={url} size={220} marginSize={4} title="Scan to pay for this service"/><p><a href={url} target="_blank" rel="noopener noreferrer">Open customer payment</a></p><button className="btn btn-secondary" onClick={async()=>{try{await navigator.clipboard.writeText(url);}catch{setError('Copy the payment link from the open customer page.');}}}>Copy link</button></>}
 {error&&<p role="alert">{error}</p>}</section>;
}
