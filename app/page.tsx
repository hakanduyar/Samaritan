import {Suspense} from 'react';
import {redirect} from 'next/navigation';
import {SceneFromLocation} from '../src/player/SceneFromLocation';
export default function Index(){
 if(process.env.STATIC_EXPORT==='1')return <Suspense fallback={<main className="ref-player" aria-label="Loading scene"/>}><SceneFromLocation world="samaritan"/></Suspense>;
 redirect('/samaritan');
}
