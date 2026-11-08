"use client";
import {useEffect,useRef,useState} from 'react';
import {createPlayer,type PlayerStatus} from './runtime';
import {parsePlayerParams} from './time';
import type {OpeningPhase} from './openingClock';

/** Isolated candidate: old startup and the approved route remain available separately. */
export function OpeningWorldPlayer({straight=false}:{straight?:boolean}){
 const host=useRef<HTMLDivElement>(null),frame=useRef<HTMLDivElement>(null),marker=useRef<HTMLDivElement>(null);
 const [status,setStatus]=useState<PlayerStatus>({state:'loading'});
 const [opening,setOpening]=useState<{phase:OpeningPhase;command:string}>({phase:'connection',command:''});
 useEffect(()=>{
  const handle=createPlayer({world:'samaritan',params:parsePlayerParams({}),host:host.current!,frame:frame.current!,marker:marker.current!,onStatus:setStatus,openingSequence:straight?'straight':true,onOpening:setOpening});
  return()=>handle.dispose();
 },[straight]);
 const loading=status.state==='loading',connection=status.state==='ready'&&opening.phase==='connection';
 return <main className="ref-player" ref={host} aria-label="Samaritan opening lifecycle candidate" style={{background:'#f7f7f6'}}>
  <div hidden ref={marker} data-reference-marker=""/><div ref={frame} className="ref-frame"/>
  {loading&&<div className="sam-startup" role="status" aria-label="Loading scene assets"><div className="sam-loading-label">LOADING</div><div className="sam-loading-track"><span/></div></div>}
  {connection&&<div className="sam-startup" role="status" aria-label="Scene connection ready">
    <div className="sam-connection">CONNECTION ESTABLISHED</div>
  </div>}
  {status.state!=='ready'&&status.state!=='loading'&&<div className="ref-status sam-error" role="alert"><div className="ref-error-card"><p className="ref-status-title">{status.message}</p><p className="ref-status-detail">{status.detail}</p><button type="button" onClick={()=>window.location.reload()}>Retry</button></div></div>}
 </main>;
}
