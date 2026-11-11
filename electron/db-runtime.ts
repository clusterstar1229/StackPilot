import type {DatabaseType} from '../shared/model';
export function databaseArguments(type:DatabaseType,memory:number):string[]{
  if(memory>=512)return [];
  if(type==='mysql')return ['--innodb-buffer-pool-size=16M','--innodb-log-buffer-size=4M','--performance-schema=OFF','--key-buffer-size=1M','--table-open-cache=64','--table-definition-cache=400','--max-connections=12','--thread-cache-size=0','--mysqlx=OFF','--skip-name-resolve'];
  if(type==='mariadb')return ['--innodb-buffer-pool-size=16M','--innodb-log-buffer-size=4M','--performance-schema=OFF','--key-buffer-size=1M','--aria-pagecache-buffer-size=8M','--table-open-cache=64','--max-connections=12','--thread-cache-size=0','--skip-name-resolve'];
  if(type==='postgres')return ['-c','shared_buffers=16MB','-c','max_connections=16','-c','work_mem=1MB','-c','maintenance_work_mem=8MB'];
  if(type==='mongodb')return ['--wiredTigerCacheSizeGB=0.25','--setParameter','diagnosticDataCollectionEnabled=false'];
  return [];
}
export const enginePrefix:Record<string,string[]>={mysql:['mysqld'],mariadb:['mariadbd'],postgres:['postgres'],mongodb:['mongod'],redis:['redis-server']};
