"use client";
import {useSearchParams} from 'next/navigation';
import type {World} from '../contract/manifest';
import {ScenePlayer} from './ScenePlayer';
import type {QueryRecord} from './time';
export function queryFromSearch(search:Pick<URLSearchParams,'keys'|'getAll'>):QueryRecord{
 const query:QueryRecord={};for(const key of search.keys())query[key]=search.getAll(key);return query;
}
export function SceneFromLocation({world}:{world:World}){
 const search=useSearchParams();return <ScenePlayer world={world} query={queryFromSearch(search)}/>;
}
