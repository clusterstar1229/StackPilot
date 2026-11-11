import {authPlugins,type ConnectionOptions} from 'mysql2';

export function mysqlSSHAuth(socket:string|undefined,password:string):Pick<ConnectionOptions,'authPlugins'>{
  if(!socket)return {};
  // MySQL sees a secure Unix socket, while mysql2 sees our local TCP listener.
  // The intervening transport is the authenticated, encrypted SSH connection.
  return {authPlugins:{
    caching_sha2_password:authPlugins.caching_sha2_password({overrideIsSecure:true}),
    sha256_password:()=>()=>Buffer.from(password+'\0','utf8'),
  }};
}
