'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { usePermissions } from '../PermissionsProvider';
type Policies = { businessName:string; contactEmail:string; cancellationPolicy:string; refundPolicy:string; privacyRetention:string; approvedPolicyVersion:string };
type Setup = {config:Partial<Policies>&{accountId?:string};paypalConnected:boolean;policyVersion:string;stripeSetupAvailable:boolean;paypalSetupAvailable:boolean};
export function PaymentSetupTab(){
 const {me}=usePermissions();
 const [connectUrl,setConnectUrl]=useState('');
 const [setup,setSetup]=useState<Setup>();const [busy,setBusy]=useState(false);const [message,setMessage]=useState('');
 const [form,setForm]=useState<Policies>({businessName:'',contactEmail:'',cancellationPolicy:'',refundPolicy:'',privacyRetention:'',approvedPolicyVersion:''});
 const [paypal,setPaypal]=useState({clientId:'',clientSecret:'',merchantId:''});const [approved,setApproved]=useState(false);
 const load=async()=>{const s=await api.get<Setup>('/api/admin/payments');setSetup(s);setForm(f=>({...f,...s.config}));};
 useEffect(()=>{void load().catch(e=>setMessage(e.message));},[]);
 async function run(action:()=>Promise<void>){setBusy(true);setMessage('');try{await action();await load();setMessage('Saved.');}catch(e){setMessage(e instanceof Error?e.message:'Unable to save');}finally{setBusy(false);}}
 if(!me.paymentAdmin)return null;
 if(!setup)return <p role="status">{message||'Loading payment setup…'}</p>;
 return <section className="card" style={{padding:24,maxWidth:800}}><h2>Owner payment setup</h2>
 <p>Client payments go to your connected business account. Employees cannot connect accounts or change where payments go. Provider fees and settlement timing apply.</p>
 <h3>Stripe and Apple Pay</h3><p>{setup.config.accountId?`Connected account: ${setup.config.accountId}`:'No Stripe account connected.'} Apple Pay appears at checkout on eligible customer devices. At the dock, customers scan the payment QR code.</p>
 <button className="btn btn-primary" disabled={busy||!setup.stripeSetupAvailable} onClick={()=>run(async()=>{const r=await api.post<{url:string}>('/api/admin/payments/stripe/connect');setConnectUrl(r.url);})}>Connect owner’s Stripe account</button>
 {connectUrl&&<p><a href={connectUrl} target="_blank" rel="noopener noreferrer">Continue to Stripe to authorize the owner’s business account</a></p>}
 {!setup.stripeSetupAvailable&&<p>The hosting administrator must enable Stripe Connect before you can connect your business.</p>}
 <h3>Business terms and privacy</h3><p>Enter the policies your business actually follows. Review the customer terms before enabling payments.</p>
 <form onSubmit={e=>{e.preventDefault();void run(async()=>{await api.post('/api/admin/payments/policies',{...form,approvedPolicyVersion:setup.policyVersion});setApproved(false);});}}>
 {(['businessName','contactEmail','cancellationPolicy','refundPolicy','privacyRetention'] as const).map(key=><label key={key} style={{display:'block',margin:'16px 0'}}>{({businessName:'Legal business name',contactEmail:'Customer support email',cancellationPolicy:'Cancellation policy',refundPolicy:'Refund policy',privacyRetention:'Data retention and deletion policy'})[key]}
 {key==='businessName'||key==='contactEmail'?<input required type={key==='contactEmail'?'email':'text'} value={form[key]} onChange={e=>setForm({...form,[key]:e.target.value})}/>:<textarea required minLength={10} maxLength={10000} rows={4} value={form[key]} onChange={e=>setForm({...form,[key]:e.target.value})}/>}</label>)}
 <p><a href={`/legal?operation=${encodeURIComponent(me.installationId)}`} target="_blank" rel="noreferrer">Review customer terms and privacy notice</a></p>
 <label><input type="checkbox" checked={approved} onChange={e=>setApproved(e.target.checked)}/> I approve these business policies and customer terms (version {setup.policyVersion}).</label>
 <p><button className="btn btn-primary" disabled={busy||!approved}>Save approved policies</button></p></form>
 <h3>Venmo through your PayPal business account</h3><p>{setup.paypalConnected?'Business credentials are saved.':'No business credentials saved.'} US customers pay in USD on eligible devices. Use credentials belonging to the owner’s business.</p>
 <form autoComplete="off" onSubmit={e=>{e.preventDefault();void run(async()=>{await api.post('/api/admin/payments/venmo',paypal);setPaypal({clientId:'',clientSecret:'',merchantId:''});});}}>
 {(['clientId','clientSecret','merchantId'] as const).map(key=><label key={key} style={{display:'block',margin:'16px 0'}}>{({clientId:'PayPal client ID',clientSecret:'PayPal client secret',merchantId:'PayPal business merchant ID'})[key]}<input required autoComplete="off" type={key==='clientSecret'?'password':'text'} value={paypal[key]} onChange={e=>setPaypal({...paypal,[key]:e.target.value})}/></label>)}
 <button className="btn btn-primary" disabled={busy||!setup.paypalSetupAvailable}>Save owner’s Venmo setup</button>
 {!setup.paypalSetupAvailable&&<p>The hosting administrator must enable encrypted credential storage first.</p>}</form>
 {message&&<p role="status">{message}</p>}</section>;
}
