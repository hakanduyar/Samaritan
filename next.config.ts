import type { NextConfig } from "next";
import {createHash} from 'node:crypto';
import {readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';

const world='samaritan';
const assetRoot=resolve(__dirname,'public/assets',world);
const manifestBytes=readFileSync(resolve(assetRoot,'manifest.json'));
const scenePath=new URL(JSON.parse(manifestBytes.toString()).sceneUrl,'https://asset.invalid/').pathname.slice(1);
const sceneRevision=createHash('sha256').update(manifestBytes).update(readFileSync(resolve(assetRoot,scenePath))).digest('hex');
const openingMetadata=resolve(assetRoot,'opening/opening-metadata.json');
const openingRevision=existsSync(openingMetadata)?createHash('sha256').update(readFileSync(openingMetadata)).update(readFileSync(resolve(assetRoot,'opening/samaritan-opening.glb'))).digest('hex'):'';
const straightMetadata=resolve(assetRoot,'opening-straight/opening-metadata.json');
const straightOpeningRevision=existsSync(straightMetadata)?createHash('sha256').update(readFileSync(straightMetadata)).update(readFileSync(resolve(assetRoot,'opening-straight/samaritan-opening.glb'))).digest('hex'):'';

const staticExport=process.env.STATIC_EXPORT==='1';
const basePath=staticExport?(process.env.NEXT_PUBLIC_BASE_PATH??''):'';
if(basePath&&!/^\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/.test(basePath))throw Error('Invalid static base path');
// Resolve build inputs within this application.
const nextConfig: NextConfig = {
  ...(staticExport?{output:'export' as const,trailingSlash:true,basePath}:{}),
  env:{NEXT_PUBLIC_BASE_PATH:basePath,NEXT_PUBLIC_SCENE_REVISION:sceneRevision,NEXT_PUBLIC_OPENING_REVISION:openingRevision,NEXT_PUBLIC_STRAIGHT_OPENING_REVISION:straightOpeningRevision},
  reactStrictMode: true,
  poweredByHeader: false,
  turbopack: { root: __dirname },
  outputFileTracingRoot: __dirname,
};

export default nextConfig;
