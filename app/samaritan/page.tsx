import {Suspense} from 'react';
import {SceneFromLocation} from '../../src/player/SceneFromLocation';
import type { Metadata } from "next";

import { ScenePlayer } from "../../src/player/ScenePlayer";
import type { QueryRecord } from "../../src/player/time";

export const metadata: Metadata = { title: "Samaritan — reference player" };

export default async function SamaritanPage({ searchParams }: { searchParams: Promise<QueryRecord> }) {
  if(process.env.STATIC_EXPORT==='1')return <Suspense fallback={<main className="ref-player" aria-label="Loading scene"/>}><SceneFromLocation world="samaritan"/></Suspense>;
  return <ScenePlayer world="samaritan" query={await searchParams} />;
}
