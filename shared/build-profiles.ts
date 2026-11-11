export interface BuildProfile {id:string;name:string;port:number;build:string;start:string;output:string;description:string}
export const buildProfiles:BuildProfile[]=[
 {id:'compose',name:'Docker Compose 多服务项目',port:8080,build:'',start:'',output:'compose.yaml',description:'本机构建并打包所有服务镜像，连同配置文件一起交付'},
 {id:'static',name:'静态网站 / React / Vue / Angular',port:80,build:'if [ -f package-lock.json ]; then npm ci; else npm install; fi\nnpm run build',start:'',output:'dist',description:'构建输出由 Nginx 托管，支持 SPA 刷新'},
 {id:'node',name:'Node.js / Express / NestJS',port:3000,build:'if [ -f package-lock.json ]; then npm ci; else npm install; fi\nnpm run build --if-present',start:'npm run start',output:'.',description:'使用 package.json 的启动脚本，可自行调整'},
 {id:'next',name:'Next.js 服务端渲染',port:3000,build:'if [ -f package-lock.json ]; then npm ci; else npm install; fi\nnpm run build',start:'npm run start',output:'.',description:'保留服务端运行能力，不按静态网站处理'},
 {id:'nuxt',name:'Nuxt / Nitro 服务端渲染',port:3000,build:'if [ -f package-lock.json ]; then npm ci; else npm install; fi\nnpm run build',start:'node server/index.mjs',output:'.output',description:'交付 Nitro 的独立服务端输出'},
 {id:'maven',name:'Java / Spring Boot · Maven',port:8080,build:'mvn -B -DskipTests package',start:'java -XX:MaxRAMPercentage=70 -jar /app/app.jar',output:'target',description:'自动选取可执行 JAR；Java 默认 21'},
 {id:'gradle',name:'Java / Spring Boot · Gradle',port:8080,build:'if [ -f gradlew ]; then sh ./gradlew bootJar --no-daemon; else gradle bootJar --no-daemon; fi',start:'java -XX:MaxRAMPercentage=70 -jar /app/app.jar',output:'build/libs',description:'使用项目 Gradle Wrapper 构建 bootJar'},
 {id:'python',name:'Python / FastAPI / Flask / Django',port:8000,build:'if [ -f requirements.txt ]; then pip install --no-cache-dir -r requirements.txt; fi\npip install --no-cache-dir gunicorn uvicorn',start:'uvicorn app:app --host 0.0.0.0 --port ${PORT:-8000}',output:'.',description:'按框架调整 ASGI / WSGI 模块和环境变量'},
 {id:'go',name:'Go 应用',port:8080,build:'CGO_ENABLED=0 go build -o /out/app .',start:'/app/app',output:'/out',description:'构建 Linux 可执行文件，默认禁用 CGO'},
 {id:'dotnet',name:'.NET / ASP.NET Core',port:8080,build:'dotnet publish -c Release -o /out',start:'dotnet /app/App.dll',output:'/out',description:'填写实际程序集名称，默认 .NET 8'},
 {id:'php',name:'PHP / Laravel',port:80,build:'if [ -f composer.json ]; then composer install --no-dev --no-interaction --optimize-autoloader; fi',start:'apache2-foreground',output:'.',description:'Apache + PHP 8.3；Laravel 网站根目录设为 public'},
 {id:'dockerfile',name:'项目 Dockerfile',port:8080,build:'',start:'',output:'Dockerfile',description:'按项目自己的 Dockerfile 构建，覆盖其他语言与框架'},
];
export const profileById=(id:string)=>buildProfiles.find(p=>p.id===id)||buildProfiles.find(p=>p.id==='static')!;
export interface PackageAnalysis {runtime:string;profile:string;entry:string;contentDir:string;evidence:string[];needsBuild:boolean;framework:string;startCommand?:string}
export function detectPackage(files:string[],texts:Record<string,string>={}):PackageAnalysis{
 const paths=files.map(s=>s.replaceAll('\\','/').replace(/^\.\//,''));const has=(s:string)=>paths.includes(s);let pkg:any={};try{pkg=JSON.parse(texts['package.json']||'{}');}catch{}
 const deps={...pkg.dependencies,...pkg.devDependencies};const result=(runtime:string,profile:string,entry:string,framework:string,needsBuild=false,contentDir=''):PackageAnalysis=>({runtime,profile,entry,framework,needsBuild,contentDir,evidence:[]});let r:PackageAnalysis;
 if(paths.length===1&&/\.jar$/i.test(paths[0]))r=result('jar','maven',paths[0],'可执行 JAR');
 else if(paths.length===1&&/\.war$/i.test(paths[0]))r=result('war','dockerfile',paths[0],'Java WAR');
 else if(has('compose.yaml')||has('compose.yml')||has('docker-compose.yml')||has('docker-compose.yaml'))r=result('compose','compose',paths.find(s=>/^(docker-)?compose\.ya?ml$/.test(s))!,'Docker Compose',true);
 else if(deps?.next)r=result('node','next',has('.next/standalone/server.js')?'.next/standalone/server.js':'','Next.js',!has('.next/BUILD_ID'));
 else if(deps?.nuxt||has('nuxt.config.ts')||has('.output/server/index.mjs'))r=result('node','nuxt','.output/server/index.mjs','Nuxt / Nitro',!has('.output/server/index.mjs'));
 else if(has('pom.xml'))r=result('jar','maven','app.jar','Maven / Spring Boot',true);
 else if(has('build.gradle')||has('build.gradle.kts'))r=result('jar','gradle','app.jar','Gradle / Spring Boot',true);
 else if(has('go.mod'))r=result('binary','go','app','Go',true);
 else if(paths.some(s=>s.endsWith('.csproj'))){const project=paths.find(s=>s.endsWith('.csproj'))!;r=result('dotnet','dotnet',project.split('/').at(-1)!.replace('.csproj','.dll'),'.NET',true);}
 else if(has('requirements.txt')||has('pyproject.toml')||has('manage.py')){const req=texts['requirements.txt']||'';r=result('python','python',has('app.py')?'app.py':has('main.py')?'main.py':'manage.py',has('manage.py')?'Django':/fastapi/i.test(req)?'FastAPI':/flask/i.test(req)?'Flask':'Python',true);}
 else if(has('composer.json')||has('index.php')||has('public/index.php')){r=result('image','php','',has('artisan')?'Laravel':'PHP',true,has('public/index.php')?'public':'.');}
 else if(pkg.scripts?.build&&(deps?.vite||deps?.['@angular/core']||deps?.['@vue/cli-service'])&&!['dist/index.html','build/index.html','out/index.html'].some(has))r=result('static','static','',deps?.['@angular/core']?'Angular':deps?.vue?'Vue / Vite':deps?.react?'React / Vite':'Vite',true);
 else if(['index.html','dist/index.html','build/index.html','out/index.html'].some(has)){const index=['dist/index.html','build/index.html','out/index.html','index.html'].find(has)!;r=result('static','static','',deps?.vue?'Vue':deps?.react?'React':'静态网站',false,index==='index.html'?'':index.replace('/index.html',''));}
 else if(has('package.json'))r=result('node',pkg.scripts?.build&&!pkg.scripts?.start?'static':'node',pkg.main||(['dist/main.js','server.js','index.js','index.mjs'].find(has)||''),deps?.['@nestjs/core']?'NestJS':deps?.express?'Express':'Node.js',true);
 else if(paths.some(s=>/\.runtimeconfig\.json$/.test(s)))r=result('dotnet','dotnet',paths.find(s=>s.endsWith('.runtimeconfig.json'))!.replace('.runtimeconfig.json','.dll'),'.NET 发布包');
 else if(has('Dockerfile'))r=result('image','dockerfile','','Dockerfile',true);
 else r=result('binary','dockerfile',paths[0]||'app','自定义程序');
 if(r.framework==='Django'){const module=texts['manage.py']?.match(/['"]([a-zA-Z_][a-zA-Z0-9_.]*)\.settings['"]/)?.[1]||'project';r.startCommand=`gunicorn ${module}.wsgi:application --bind 0.0.0.0:${'${PORT:-8000}'}`;}
 if(has('Dockerfile')&&r.needsBuild&&r.profile!=='compose')r.profile='dockerfile';
 r.evidence=paths.filter(s=>/package\.json$|pom\.xml$|gradle|go\.mod$|\.csproj$|requirements\.txt$|manage\.py$|composer\.json$|index\.html$|Dockerfile$|compose\.ya?ml$|runtimeconfig\.json$|\.jar$|\.war$|\.output\/server\/index\.mjs$/.test(s)).slice(0,12);return r;
}
