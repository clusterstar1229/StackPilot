import { contextBridge, ipcRenderer } from 'electron';
import { channels, type Channel } from '../shared/model';
contextBridge.exposeInMainWorld('stackpilot',Object.freeze({desktop:true,invoke:(channel:Channel,payload?:unknown)=>{if(!channels.includes(channel))return Promise.reject(new Error('不支持的操作'));return ipcRenderer.invoke('stackpilot:call',channel,payload);},onChange:(callback:(data:any)=>void)=>{const listener=(_e:unknown,data:any)=>callback(data);ipcRenderer.on('stackpilot:change',listener);return()=>ipcRenderer.removeListener('stackpilot:change',listener);}}));
