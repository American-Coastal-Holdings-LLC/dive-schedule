
'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
import { Modal } from '../Modal';
import { usePlatform } from '../PlatformProvider';
export function AddDiverModal({onClose,onSaved}:{onClose:()=>void;onSaved:()=>void}) {
 const [name,setName]=useState(''),[email,setEmail]=useState(''),[certifications,setCertifications]=useState(''),[busy,setBusy]=useState(false);
 const {toast}=usePlatform();
 const save=async(e:React.FormEvent)=>{e.preventDefault();if(busy)return;setBusy(true);try{await api.post('/api/crew',{name,email,certifications});toast('Diver added to your team');onSaved();onClose();}catch{setBusy(false);}};
 return <Modal title="Add diver" onClose={onClose} busy={busy} dirty={!!(name||email||certifications)}>
 <form onSubmit={save}><label htmlFor="diver-name">Full name</label><input id="diver-name" required maxLength={120} value={name} onChange={e=>setName(e.target.value)}/>
 <label htmlFor="diver-email">Email</label><input id="diver-email" type="email" required value={email} onChange={e=>setEmail(e.target.value)}/>
 <label htmlFor="diver-certs">Qualifications</label><textarea id="diver-certs" maxLength={2000} value={certifications} onChange={e=>setCertifications(e.target.value)}/>
 <p>This adds an assignable diver to your roster. To give them their own login, your workspace administrator must also invite them through workspace account management. No invitation email is sent by this form.</p>
 <button className="btn btn-primary" disabled={busy} type="submit">{busy?'Adding…':'Add diver'}</button></form></Modal>;
}
