import YAML from 'yaml';
import {deploymentSchema,type DeploymentInput} from './model';
export function serializeRecipe(input:any,preserveSavedEnvironment=false){
 const value=deploymentSchema.parse(input);const {serverId,artifactId,imageArtifactId,reuseRelease,environment,...configuration}=value;
 return YAML.stringify({format:'stackpilot/v1',application:{...configuration,environment:preserveSavedEnvironment?environment:Object.fromEntries(Object.keys(environment).map(k=>[k,'请在部署时填写']))}});
}
export function parseRecipe(content:string):Partial<DeploymentInput>{
 const document=YAML.parse(content);if(document?.format!=='stackpilot/v1'||!document.application)throw new Error('需要 format: stackpilot/v1 的部署配置');
 const {serverId,artifactId,imageArtifactId,...application}=document.application;return deploymentSchema.omit({serverId:true,artifactId:true,imageArtifactId:true}).parse(application);
}
