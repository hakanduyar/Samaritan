// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { Startup } from '../src/player/Startup';

it('keeps readable foreground beats, pauses when hidden and completes once', async () => {
  (globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
  let hidden=false; let now=0; let id=0;
  const callbacks=new Map<number,FrameRequestCallback>();
  Object.defineProperty(document,'hidden',{configurable:true,get:()=>hidden});
  vi.stubGlobal('requestAnimationFrame',(fn:FrameRequestCallback)=>{callbacks.set(++id,fn);return id;});
  vi.stubGlobal('cancelAnimationFrame',(key:number)=>callbacks.delete(key));
  const host=document.createElement('div'); document.body.append(host);
  const root=createRoot(host); const complete=vi.fn();
  const advance=async(count:number)=> { for(let i=0;i<count;i++) await act(async()=>{now+=100;const batch=[...callbacks.values()];callbacks.clear();batch.forEach(fn=>fn(now));}); };
  await act(async()=>root.render(<Startup ready={false} onComplete={complete}/>));
  await advance(60); expect(complete).not.toHaveBeenCalled();
  await act(async()=>root.render(<Startup ready={true} onComplete={complete}/>));
  await advance(6); expect(host.textContent).toBe('WHAT');
  hidden=true; document.dispatchEvent(new Event('visibilitychange'));
  await advance(100); expect(host.textContent).toBe('WHAT'); expect(complete).not.toHaveBeenCalled();
  hidden=false; document.dispatchEvent(new Event('visibilitychange'));
  await advance(30); expect(host.textContent).toBe('SAMARITAN');
  await advance(20); expect(complete).toHaveBeenCalledTimes(1); expect(host.textContent).toBe('');
  await act(async()=>root.unmount()); host.remove(); vi.unstubAllGlobals();
});
