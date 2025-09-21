/* eslint-disable padding-line-between-statements, lines-around-comment, newline-before-return */
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

export class CodeExportService {
  private readonly loggerPrefix = '[code-export]';
  private log(msg: string) { console.log(`${this.loggerPrefix} ${msg}`); }
  private error(msg: string) { console.error(`${this.loggerPrefix} ERROR: ${msg}`); }

  private readonly PG_USER = process.env.PGUSER ?? 'postgres';
  private readonly PG_PASS = process.env.PGPASSWORD ?? '';
  private readonly PG_DB = process.env.PGDATABASE ?? '';
  private readonly PG_HOST = process.env.PGHOST ?? 'localhost';

  private readonly excludedDirs: string[] = [
  'node_modules','.git','.github','.trae','coverage','.idea','.vscode','.next','n8n-data','n8n','logs','backups','temp_files','cleanup_backup_*','pm2logs','test','tests','__tests__','mock','mocks','examples','public/assets','public/images','public/icons','dist','build','exports','scale','code-checking-results','code-export'
  ];

  // Optional package scoping (env-driven). Examples:
  // CODE_EXPORT_INCLUDE_PACKAGES=server,components
  // CODE_EXPORT_EXCLUDE_PACKAGES=api-documentation
  private readonly includePackages: Set<string> | null = process.env.CODE_EXPORT_INCLUDE_PACKAGES
    ? new Set(process.env.CODE_EXPORT_INCLUDE_PACKAGES.split(',').map(s=>s.trim()).filter(Boolean))
    : null;
  private readonly excludePackages: Set<string> = process.env.CODE_EXPORT_EXCLUDE_PACKAGES
    ? new Set(process.env.CODE_EXPORT_EXCLUDE_PACKAGES.split(',').map(s=>s.trim()).filter(Boolean))
    : new Set();

  private readonly includedFileTypes: string[] = [
    '.ts','.tsx','.js','.json','.md','.yml','.yaml','.gitignore','.eslintrc','.prettierrc','.conf','.env','.pem','.key','.crt','.csr','.der','.sql','.sh'
  ];

  private readonly excludedFilePatterns: (string|RegExp)[] = [
    'package-lock.json',/\.nft\.json$/i,/page\.[mc]?js$/i,/route\.[mc]?js$/i,/manifest\./i,/client-reference-manifest\.js$/i,'*.log','*.bak','*.tmp','*.backup','*.patch'
  ];
  // NOTE: Previously there was a "minimal export" toggle via CODE_EXPORT_MINIMAL.
  // По требованию: убрано. Теперь экспорт ВСЕГДА жёстко фильтруется по retention правилам ниже.
  private runRoot: string = process.cwd();
  private readonly modeFull: boolean = (process.env.CODE_EXPORT_MODE || '').toLowerCase()==='full';
  private readonly maskEnv: boolean = (process.env.CODE_EXPORT_MASK_ENV || '0') === '1';

  // Precompiled regex/predicates for retention (when minimalExport=true)
  private readonly retention = {
    env: /(^|\/)\.env(\..+)?$/i,
    shitResearcher: /(^|\/)packages\/vladislav\/shit-researcher\.ts$/,
    indexFiles: /(^|\/)index\.(t|j)sx?$/i,
    indexModule: /(^|\/)index\.(m|c)js$/i,
    enterpriseDir: /(^|\/)enterprise(\/|$)/i,
    routesDir: /(^|\/)routes(\/|$)/i,
    servicesDir: /(^|\/)services(\/|$)/i,
    utilsDir: /(^|\/)utils(\/|$)/i,
    pkgJson: /(^|\/)package\.json$/,
    tsconfig: /(^|\/)tsconfig\.json$/,
    jsconfig: /(^|\/)jsconfig\.json$/,
    uiConfig: /(^|\/)(craco\.config\.js|vite\.config\.js)$/,
    indexHtml: /(^|\/)index\.html$/i,
  gulp: /(^|\/)gulpfile\.(t|j)s$/i,
  // Added: retain majority of application source in src (selected subareas)
  srcKeyDirs: /(^|\/)src\/(app|components|configs|contexts|hooks|layouts|redux-store|prisma|utils|views|types|hocs|libs|data|fake-db)(\/|$)/,
  // Retain any file under src with name next.config or tailwind config etc
  buildConfigs: /(^|\/)src\/.*(next\.config\.js|tailwind\.config\.(t|j)s|postcss\.config\.(m|c)?js)$/
  };

  private retentionMatch(relPath: string): boolean {
    // Normalize path separators
    const p = relPath.replace(/\\/g,'/');
    return (
      this.retention.env.test(p) ||
      this.retention.shitResearcher.test(p) ||
      this.retention.indexFiles.test(p) ||
      this.retention.indexModule.test(p) ||
      this.retention.enterpriseDir.test(p) ||
      this.retention.routesDir.test(p) ||
      this.retention.servicesDir.test(p) ||
      this.retention.utilsDir.test(p) ||
      this.retention.pkgJson.test(p) ||
      this.retention.tsconfig.test(p) ||
      this.retention.jsconfig.test(p) ||
      this.retention.uiConfig.test(p) ||
      this.retention.indexHtml.test(p) ||
  this.retention.gulp.test(p) ||
  this.retention.srcKeyDirs.test(p) ||
  this.retention.buildConfigs.test(p)
    );
  }

  public async exportCodebase(): Promise<string> {
    try {
  const root = process.cwd();
  this.runRoot = root;
      const outDir = path.join(root,'code-export');
      if(!fs.existsSync(outDir)) fs.mkdirSync(outDir,{recursive:true});
      const { filename, tsForHeader } = this.buildFilename(outDir);
      const outPath = path.join(outDir, filename);
  const modeLabel = this.modeFull ? 'FULL (все поддерживаемые файлы)' : 'STRICT (retention rules)';
  const maskLabel = this.maskEnv ? 'ENV переменные замаскированы' : 'ENV переменные в открытом виде';
  let buf = `# Экспорт кодовой базы\n# Режим: ${modeLabel}\n# ${maskLabel}\n# Дата выгрузки: ${tsForHeader}\n`;
      buf += `# Исключённые директории: ${this.excludedDirs.join(', ')}\n\n`;
      if(this.includePackages){
        buf += `# Включённые пакеты (packages/*): ${Array.from(this.includePackages).join(', ')}\n`;
      }
      if(this.excludePackages.size){
        buf += `# Явно исключённые пакеты (packages/*): ${Array.from(this.excludePackages).join(', ')}\n`;
      }
  buf+='\n';
      buf += '## Структура проекта\n```\n'+this.tree(root)+'\n```\n\n';
      buf += this.exportDbSnapshot();
      buf += this.exportConfigFiles(root);
  buf += this.exportNginxConfigs();
      buf += await this.walk(root, root);
      fs.writeFileSync(outPath, buf, 'utf8');
      this.log(`Создан файл: ${outPath}`);
      this.logStats(buf);
      return outPath;
    } catch(e){
      this.error(`Export failed: ${(e as Error).message}`);
      throw e;
    }
  }

  private async walk(base:string,curr:string):Promise<string>{
    if(this.skipDir(path.basename(curr))) return '';
    let out='';
    const entries=fs.readdirSync(curr,{withFileTypes:true});
    // If we are at packages root and includePackages is set, restrict directories later
    for(const f of entries.filter(e=>e.isFile())){
      const abs=path.join(curr,f.name); const rel=path.relative(base,abs); const ext=path.extname(f.name);
  if(!this.keepFileAbs(abs, f.name)) continue;
      out+=`## ${rel}\n\`\`\`${this.lang(ext)}\n`;
      try { out+=fs.readFileSync(abs,'utf8')+'\n```\n\n'; }
      catch(err){ out+=`[Ошибка чтения: ${(err as Error).message}]\n\`\`\`\n\n`; }
    }
    for(const d of entries.filter(e=>e.isDirectory())){
      if(this.isPackageDirFilterActive(curr,d.name)) continue; // skip by include/exclude logic
      out+=await this.walk(base,path.join(curr,d.name));
    }
    return out;
  }

  private isPackageDirFilterActive(parent:string, dirName:string):boolean{
    const packagesRoot = path.join(process.cwd(),'packages');
    // Only apply filtering when traversing immediate children of /packages
    if(path.resolve(parent) !== path.resolve(packagesRoot)) return false;
    if(this.includePackages && !this.includePackages.has(dirName)) return true; // not in include list
    if(this.excludePackages.has(dirName)) return true; // explicitly excluded
    return false;
  }

  private tree(root:string):string{
    const lines=[path.basename(root)];
    const walk=(p:string,prefix='')=>{
      const entries=fs.readdirSync(p,{withFileTypes:true})
        .filter(e=> e.isDirectory()? !this.skipDir(e.name): this.keepFileAbs(path.join(p,e.name), e.name))
        .sort((a,b)=>a.name.localeCompare(b.name));
      entries.forEach((e,i)=>{
        const last=i===entries.length-1; lines.push(`${prefix}${last?'└── ':'├── '}${e.name}`);
        if(e.isDirectory()) walk(path.join(p,e.name),`${prefix}${last?'    ':'│   '}`);
      });
    };
    walk(root); return lines.join('\n');
  }

  private skipDir(name:string):boolean{ return this.excludedDirs.some(d=> d.endsWith('*')? name.startsWith(d.slice(0,-1)): d===name); }
  private keepFile(name:string):boolean{ if(this.excludedFilePatterns.some(p=> p instanceof RegExp? p.test(name): p===name)) return false; return this.includedFileTypes.includes(path.extname(name)); }
  private keepFileAbs(absPath:string,name:string):boolean {
    // Сначала базовая фильтрация по типу/паттернам
    if(!this.keepFile(name)) return false;
    const rel = path.relative(this.runRoot, absPath);
  // В режиме full пропускаем все отфильтрованные по типу файлы (кроме исключённых директорий)
  if(this.modeFull) return true;
  // В строгом режиме retention
  return this.retentionMatch(rel);
  }
  private lang(ext:string):string { const m:Record<string,string>={'.ts':'typescript','.tsx':'typescript','.js':'javascript','.json':'json','.md':'markdown','.yml':'yaml','.yaml':'yaml','.conf':'nginx','.env':'properties','.sql':'sql','.sh':'bash'}; return m[ext]||''; }
  private logStats(content:string){ this.log(`Exported { sizeKB: ${(content.length/1024).toFixed(2)}, lines: ${content.split('\n').length} }`); }

  private exportDbSnapshot():string {
    if(!this.PG_DB) return '## База данных: пропущено (нет PG* env)\n\n';
    let md='## База данных (public schema snapshot)\n\n';
    try {
      const tablesRaw=this.psql(`SELECT tablename FROM pg_tables WHERE schemaname='public'`);
      if(!tablesRaw){ md+='[Нет доступа или таблиц]\n\n'; return md; }
      for(const table of tablesRaw.split('\n')){ if(!table) continue; const columns=this.psql(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='${table}' ORDER BY ordinal_position`).split('\n').filter(Boolean); const sample=this.psql(`SELECT * FROM "${table}" LIMIT 1`); const values= sample? sample.split('|'):[]; md+=`### ${table}\n\n| ${columns.join(' | ')} |\n|${columns.map(()=> '------------').join('|')}|\n`; md+= values.length? `| ${values.join(' | ')} |\n\n`:`| _нет данных_ |\n\n`; }
    } catch(e){ md+=`[Ошибка БД: ${(e as Error).message}]\n\n`; }
    return md;
  }

  private exportConfigFiles(root:string):string {
    let out='';
    const pkg=path.join(root,'package.json'); if(fs.existsSync(pkg)) out+=`## package.json\n\`\`\`json\n${fs.readFileSync(pkg,'utf8')}\n\`\`\`\n\n`;
    const envFiles=['.env','.env.development','.env.production','.env.example'];
    for(const f of envFiles){
      const p=path.join(root,f);
      if(fs.existsSync(p)){
        let content=fs.readFileSync(p,'utf8');
        if(this.maskEnv) content = this.maskEnvFile(content);
        out+=`## ${f}\n\`\`\`properties\n${content}\n\`\`\`\n\n`;
      }
    }
    return out;
  }

  private exportNginxConfigs():string {
    const targets: {label:string; path:string; type:'file'|'dir'}[] = [
      {label:'/etc/nginx/nginx.conf', path:'/etc/nginx/nginx.conf', type:'file'},
      {label:'/etc/nginx/sites-available', path:'/etc/nginx/sites-available', type:'dir'},
      {label:'/etc/nginx/sites-enabled', path:'/etc/nginx/sites-enabled', type:'dir'}
    ];
    let out='';
    for(const t of targets){
      try {
        if(!fs.existsSync(t.path)) continue;
        const st = fs.statSync(t.path);
        if(t.type==='file' && st.isFile()){
          out += `## ${t.label}\n\`\`\`nginx\n${fs.readFileSync(t.path,'utf8')}\n\`\`\`\n\n`;
        } else if(t.type==='dir' && st.isDirectory()) {
          const entries = fs.readdirSync(t.path).sort();
          for(const e of entries){
            const ep = path.join(t.path,e);
            try {
              const est = fs.statSync(ep);
              if(est.isFile()){
                const MAX=200*1024; // cap size
                let content='';
                try { content = fs.readFileSync(ep,'utf8'); } catch { continue; }
                if(content.length>MAX) content = content.slice(0,MAX)+'\n# --- truncated ---';
                out += `## ${t.label}/${e}\n\`\`\`nginx\n${content}\n\`\`\`\n\n`;
              }
            } catch {}
          }
        }
      } catch {}
    }
    return out;
  }

  private psql(q:string):string { try { return execSync(`PGPASSWORD=${this.PG_PASS} psql -h ${this.PG_HOST} -U ${this.PG_USER} -d ${this.PG_DB} -Atc "${q}"`,{encoding:'utf8'}).trim(); } catch(e){ this.error(`psql: ${(e as Error).message}`); return ''; } }

  private buildFilename(outDir:string){
    const files= fs.existsSync(outDir)? fs.readdirSync(outDir):[];
    const seq = files.map(f=>{ const m=f.match(/^#(\d+)--/); return m? parseInt(m[1],10):0; }).reduce((a,b)=>Math.max(a,b),0)+1;
    const now=new Date(); const tz='Asia/Ho_Chi_Minh'; const parts=new Intl.DateTimeFormat('en-GB',{timeZone:tz,hour:'2-digit',minute:'2-digit',day:'2-digit',month:'2-digit',year:'numeric',hour12:false}).formatToParts(now).reduce((acc,p)=>{ if(p.type!=='literal') acc[p.type]=p.value; return acc;},{} as Record<string,string>);
    const filename=`#${seq}--${parts.hour}:${parts.minute}-${parts.day}.${parts.month}.${parts.year}`; const tsForHeader= now.toLocaleString('ru-RU',{timeZone:tz}); return { filename, tsForHeader };
  }

  private maskEnvFile(content:string):string {
    const passThroughPrefixes = ['NEXT_PUBLIC_'];
    const keepExact = new Set<string>(['NODE_ENV']);
    return content.split(/\r?\n/).map(line=>{
      const m=line.match(/^([A-Za-z0-9_]+)=(.*)$/);
      if(!m) return line; // comments or empty
      const key=m[1]; const val=m[2];
      if(keepExact.has(key) || passThroughPrefixes.some(p=> key.startsWith(p))) return line; // keep as-is
      if(val.trim()==='') return line; // nothing to mask
      const hash = this.simpleHash(val);
      return `${key}=***MASKED***_${hash}`;
    }).join('\n');
  }

  private simpleHash(str:string):string { let h=0; for(let i=0;i<str.length;i++){ h=(Math.imul(31,h)+str.charCodeAt(i))|0; } return Math.abs(h).toString(36); }
}

