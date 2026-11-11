import { createContext, useContext } from 'react';
import type { AppState, Channel, Metric } from '../shared/model';
export interface Workspace { state:AppState; demo:boolean; histories:Record<string,Metric[]>; selected:string; setSelected:(id:string)=>void; open:(type:string,data?:any)=>void; navigate:(page:string)=>void; run:(channel:Channel,payload?:any)=>Promise<any>; plan:(channel:Channel,payload?:any)=>Promise<void>; toast:(message:string,error?:boolean)=>void; refresh:()=>Promise<void> }
export const WorkspaceContext=createContext<Workspace>(null!);
export const useWorkspace=()=>useContext(WorkspaceContext);
