/** Build-derived content identity; no local paths or timestamps enter requests. */
export function revisionedAsset(url:string,revision=process.env.NEXT_PUBLIC_SCENE_REVISION??''){
 if(!revision)return url;
 if(!/^[a-f0-9]{64}$/.test(revision))throw Error('Invalid asset revision');
 const resolved=new URL(url,'https://asset.invalid');
 resolved.searchParams.set('revision',revision);
 return url.startsWith('/')?resolved.pathname+resolved.search+resolved.hash:resolved.href;
}
