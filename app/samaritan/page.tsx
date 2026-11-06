import type { Metadata } from "next";

import { ScenePlayer } from "../../src/player/ScenePlayer";
import type { QueryRecord } from "../../src/player/time";

export const metadata: Metadata = { title: "Samaritan — reference player" };

export default async function SamaritanPage({ searchParams }: { searchParams: Promise<QueryRecord> }) {
  return <ScenePlayer world="samaritan" query={await searchParams} />;
}
