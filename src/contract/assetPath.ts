/** Explicit build-time prefix for static project hosting; local default stays root. */
export function assetPath(path:string,base=process.env.NEXT_PUBLIC_BASE_PATH??''){
 if(!path.startsWith('/')||path.startsWith('//'))throw Error('Asset path must be root-relative');
 if(base&&!/^\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/.test(base))throw Error('Invalid asset base path');
 return base+path;
}
