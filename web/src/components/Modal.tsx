'use client';
import { type ReactNode, useEffect, useId, useRef } from 'react';
import { Icon } from './Icon';
export function Modal({title,onClose,children,actions,headerAccessory,id,contentId,busy=false,dirty=false}:{
 title:ReactNode;onClose:()=>void;children:ReactNode;actions?:ReactNode;headerAccessory?:ReactNode;id?:string;contentId?:string;busy?:boolean;dirty?:boolean;
}) {
 const label=useId(),box=useRef<HTMLDivElement>(null),closeRef=useRef(onClose),busyRef=useRef(busy),dirtyRef=useRef(dirty);
 closeRef.current=onClose;busyRef.current=busy;dirtyRef.current=dirty;
 const close=()=>{if(busyRef.current)return;if(dirtyRef.current&&!window.confirm('Close without saving these changes?'))return;closeRef.current();};
 const closeAction=useRef(close);closeAction.current=close;
 useEffect(()=>{
  const previous=document.activeElement as HTMLElement|null,overflow=document.body.style.overflow;
  document.body.style.overflow='hidden';
  const focusable=()=>Array.from(box.current?.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),a[href],[tabindex="0"]')??[]).filter(e=>e.offsetParent!==null);
  (focusable()[0]??box.current)?.focus();
  const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();closeAction.current();}if(e.key==='Tab'){
   const all=focusable(),first=all[0],last=all[all.length-1];if(!first){e.preventDefault();box.current?.focus();return;}
   if(e.shiftKey&&(document.activeElement===first||document.activeElement===box.current)){e.preventDefault();last.focus();}
   else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
  }};
  const focus=(e:FocusEvent)=>{if(box.current&&!box.current.contains(e.target as Node))(focusable()[0]??box.current).focus();};
  document.addEventListener('keydown',key);document.addEventListener('focusin',focus);
  return()=>{document.removeEventListener('keydown',key);document.removeEventListener('focusin',focus);document.body.style.overflow=overflow;previous?.focus();};
 },[]);
 return <div className="modal" id={id}><button tabIndex={-1} className="modal-overlay" aria-label="Close" onClick={close}/>
 <div className="modal-box" ref={box} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={label} aria-busy={busy}>
 <div className="modal-header"><h2 id={label}>{title}</h2>{headerAccessory}<button className="icon-btn" disabled={busy} aria-label="Close" onClick={close}><Icon name="x"/></button></div>
 <div className="modal-content" id={contentId}>{children}</div>{actions&&<div className="modal-actions">{actions}</div>}</div></div>;
}
