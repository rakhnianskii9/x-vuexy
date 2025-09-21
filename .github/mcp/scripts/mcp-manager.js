#!/usr/bin/env node

const { spawn } = require('child_process');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');

class MCPManager {
    constructor() {
        // Base/configurable paths
    this.basePath = process.env.MCP_BASE_PATH || '/home/projects/new-flowise/.github/mcp/';
        this.dataPath = process.env.MCP_DATA_PATH || path.join(this.basePath, 'data');
        this.outputPath = process.env.MCP_OUTPUT_PATH || path.join(this.basePath, 'output');

        this.servers = new Map();
        this.aggregator = null;
    this._loggedStartup = new Set();
    this.logStartupEvents = process.env.MCP_LOG_STARTUP === 'true';

        // Helper to build PG env from DATABASE_URL
        const vuexyDbUrl = process.env.MCP_VUEXY_DATABASE_URL || '';
        const getPgEnvFromUrl = (urlStr) => {
            try {
                const u = new URL(urlStr);
                const db = (u.pathname || '').replace(/^\//, '') || undefined;
                return {
                    PGHOST: u.hostname || undefined,
                    PGPORT: (u.port || '5432'),
                    PGUSER: decodeURIComponent(u.username || ''),
                    PGPASSWORD: decodeURIComponent(u.password || ''),
                    PGDATABASE: db
                };
            } catch {
                return {};
            }
        };
        const pgVuexyEnv = getPgEnvFromUrl(vuexyDbUrl);
        const pgFlowiseEnv = {
            PGHOST: process.env.MCP_FLOWISE_PGHOST || 'localhost',
            PGPORT: process.env.MCP_FLOWISE_PGPORT || '5432',
            PGUSER: process.env.MCP_FLOWISE_PGUSER || 'rakhnianskii',
            PGPASSWORD: process.env.MCP_FLOWISE_PGPASSWORD || 'rakhnianskii',
            PGDATABASE: process.env.MCP_FLOWISE_PGDATABASE || 'flowise'
        };

        // Конфигурация MCP серверов
        this.serverConfigs = [
            {
                name: 'knowledge-graph',
                type: 'stdio',
                command: 'npx',
                args: ['@itseasy21/mcp-knowledge-graph'],
                env: { 
            GRAPH_FILE_PATH: path.join(this.dataPath, 'knowledge-graph.jsonl')
                }
            },
            {
                name: 'memory',
                type: 'stdio',
                command: 'npx',
                args: ['@modelcontextprotocol/server-memory'],
                env: { 
            MEMORY_FILE_PATH: path.join(this.dataPath, 'memory.jsonl')
                }
            },
            {
                name: 'sequential',
                type: 'stdio',
                command: 'npx',
                args: ['@modelcontextprotocol/server-sequential-thinking'],
                env: {
            SEQUENTIAL_FILE_PATH: path.join(this.dataPath, 'sequential.jsonl')
                }
            },
            {
                name: 'context7',
                type: 'stdio',
                command: 'npx',
                args: ['-y', '@upstash/context7-mcp'],
                env: {}
            },
            // Prisma MCP только из Vuexy (schema уже есть там)
            {
                name: 'prisma-vuexy',
                type: 'stdio',
                command: 'npx',
                args: ['-y', 'prisma', 'mcp'],
                cwd: '/home/projects/new-flowise/vuexy-symlink/src/prisma',
                env: vuexyDbUrl ? { DATABASE_URL: vuexyDbUrl } : {}
            },
            // Два Postgres MCP — доступ к БД напрямую (Vuexy и Flowise)
            {
                name: 'postgres-vuexy',
                type: 'stdio',
                command: 'npx',
                args: ['-y', '@modelcontextprotocol/server-postgres'],
                env: pgVuexyEnv
            },
            {
                name: 'postgres-flowise',
                type: 'stdio',
                command: 'npx',
                args: ['-y', '@modelcontextprotocol/server-postgres'],
                env: pgFlowiseEnv
            }
        ];
        
        // Источники для агрегации
        this.sources = {
            knowledgeGraph: 'knowledge-graph.jsonl',
            memory: 'memory.jsonl',
            sequential: 'sequential.jsonl',
            context7: 'context7.jsonl',
            prismaVuexy: 'prisma-vuexy.jsonl',
            postgresVuexy: 'postgres-vuexy.jsonl',
            postgresFlowise: 'postgres-flowise.jsonl'
        };
    }

    buildHttpHeadersFromEnv(prefix) {
        const headers = {};
        const token = process.env[`${prefix}_TOKEN`];
        const apiKey = process.env[`${prefix}_API_KEY`];
        const custom = process.env[`${prefix}_AUTH_HEADER`];
        if (token) headers['Authorization'] = `Bearer ${token}`;
        if (apiKey) headers['X-API-Key'] = apiKey;
        if (custom) {
            try {
                const [name, ...rest] = custom.split(':');
                const value = rest.join(':').trim();
                if (name && value) headers[name.trim()] = value;
            } catch {}
        }
        return headers;
    }

    // Формат: HH:mm:ss - DD-MM-YYYY
    formatDate(d = new Date()) {
        const pad = (n) => String(n).padStart(2, '0');
        const hh = pad(d.getHours());
        const mm = pad(d.getMinutes());
        const ss = pad(d.getSeconds());
        const DD = pad(d.getDate());
        const MM = pad(d.getMonth() + 1);
        const YYYY = d.getFullYear();
        return `${hh}:${mm}:${ss} - ${DD}-${MM}-${YYYY}`;
    }

    // Запуск MCP сервера
    startServer(config) {
        if (config.type === 'http') {
            console.log(`Registering HTTP MCP server: ${config.name} -> ${config.url}`);
            // Store a placeholder record for HTTP server
            this.servers.set(config.name, { type: 'http', url: config.url });
            return null;
        }

        console.log(`Starting MCP server: ${config.name}`);

    const server = spawn(config.command, config.args, {
            env: { ...process.env, ...config.env },
            cwd: config.cwd || process.cwd(),
            stdio: ['pipe', 'pipe', 'pipe']
        });

        server.stdout.on('data', (data) => {
            console.log(`[${config.name}] ${data.toString().trim()}`);
        });

        server.stderr.on('data', (data) => {
            const msg = data.toString().trim();
            // Some MCP servers write normal startup logs to stderr; downgrade those to info
            const isBenign = /MCP Server running on stdio/i.test(msg) || /running on stdio/i.test(msg);
            if (isBenign) {
                console.log(`[${config.name}] ${msg}`);
            } else {
                console.error(`[${config.name}] ERROR: ${msg}`);
            }
        });

        server.on('close', (code) => {
            console.log(`[${config.name}] Process exited with code ${code}`);
            
            // Автоматический перезапуск
            if (code !== 0) {
                console.log(`[${config.name}] Restarting in 5 seconds...`);
                setTimeout(() => {
                    this.servers.delete(config.name);
                    this.startServer(config);
                }, 5000);
            }
        });

        this.servers.set(config.name, server);

        // Для серверов без собственных файлов JSONL — создаём стартовую запись
        if (this.logStartupEvents) {
            const fileName = (config.name.startsWith('prisma-') || config.name.startsWith('postgres-'))
                ? `${config.name}.jsonl` : null;
            if (fileName && !this._loggedStartup.has(config.name)) {
                const line = JSON.stringify({
                    type: 'startup',
                    server: config.name,
                    pid: server.pid,
                    cwd: config.cwd || null,
                    ts: this.formatDate()
                }) + '\n';
                const target = path.join(this.dataPath, fileName);
                fs.appendFile(target, line).catch(() => {});
                this._loggedStartup.add(config.name);
            }
        }
        return server;
    }

    // Запуск всех серверов
    async startAllServers() {
        console.log('=== Starting all MCP servers ===\n');
        
        for (const config of this.serverConfigs) {
            try {
                this.startServer(config);
                await new Promise(resolve => setTimeout(resolve, 1000)); // Delay between starts
            } catch (error) {
                console.error(`Failed to start ${config.name}:`, error.message);
            }
        }
        
        console.log('\n=== All MCP servers started ===\n');
    }

    // Агрегация данных
    async aggregate() {
    console.log(`${this.formatDate()} [Aggregator] Starting aggregation...`);
        // Базовые источники
        const data = {
            knowledgeGraph: await this.readJSONL(this.sources.knowledgeGraph),
            memory: await this.readJSONL(this.sources.memory),
            sequential: await this.readJSONL(this.sources.sequential),
            context7: await this.readJSONL(this.sources.context7),
            prismaVuexy: await this.readJSONL(this.sources.prismaVuexy),
            postgresVuexy: await this.readJSONL(this.sources.postgresVuexy),
            postgresFlowise: await this.readJSONL(this.sources.postgresFlowise),
            timestamp: this.formatDate(),
            stats: {}
        };
        
        const baseStats = {
            knowledgeGraph: data.knowledgeGraph.length,
            memory: data.memory.length,
            sequential: data.sequential.length,
            context7: data.context7.length,
            prismaVuexy: data.prismaVuexy.length,
            postgresVuexy: data.postgresVuexy.length,
            postgresFlowise: data.postgresFlowise.length
        };
        
        data.stats = {
            ...baseStats,
            total: Object.values(baseStats).reduce((a, b) => a + b, 0)
        };
        
        await fs.writeFile(
            path.join(this.outputPath, 'aggregated.json'),
            JSON.stringify(data, null, 2)
        );
        
    console.log(`${this.formatDate()} [Aggregator] Stats: ${JSON.stringify(data.stats)}`);
        return data;
    }

    // Чтение JSONL файла
    async readJSONL(filename) {
        try {
            const content = await fs.readFile(path.join(this.dataPath, filename), 'utf-8');
            return content.split('\n')
                .filter(line => line.trim())
                .map(line => {
                    try {
                        return JSON.parse(line);
                    } catch (e) {
                        return null;
                    }
                })
                .filter(item => item !== null);
        } catch (error) {
            return [];
        }
    }

    // Запуск наблюдателя за файлами
    startWatcher() {
    console.log('[Watcher] Starting file watcher...');
    const watchFiles = Object.values(this.sources).map(f => path.join(this.dataPath, f));
        
        for (const file of watchFiles) {
            try {
                fsSync.watchFile(file, { interval: 3000 }, async (curr, prev) => {
                    if (curr.mtime !== prev.mtime) {
                        console.log(`${this.formatDate()} [Watcher] File changed: ${path.basename(file)}`);
                        await this.aggregate();
                    }
                });
                console.log(`[Watcher] Watching: ${path.basename(file)}`);
            } catch (err) {
                console.error(`[Watcher] Error for ${file}:`, err.message);
            }
        }
    }

    // Проверка здоровья серверов
    async healthCheck() {
    console.log(`${this.formatDate()} [Health] Checking MCP servers...`);
        
        for (const config of this.serverConfigs) {
            if (config.type === 'http') {
                // HTTP health check
                const url = config.url;
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 5000);
                const fetchOpts = { method: 'GET', signal: controller.signal };
                if (config.headers && Object.keys(config.headers).length) {
                    fetchOpts.headers = config.headers;
                }
                fetch(url, fetchOpts)
                    .then(res => {
                        clearTimeout(timeout);
                        const ok = res.ok;
                        const statusInfo = res.status === 401 ? 'AUTH_NEEDED' : `http ${res.status}`;
                        console.log(`${this.formatDate()} [Health] ${config.name}: ${ok ? 'OK' : 'WARN'} (${statusInfo})`);
                    })
                    .catch(err => {
                        console.log(`${this.formatDate()} [Health] ${config.name}: DOWN (${err.name || 'error'})`);
                    });
                continue;
            }

            const server = this.servers.get(config.name);
            if (!server || server.killed) {
                console.log(`${this.formatDate()} [Health] ${config.name}: DEAD - restarting...`);
                this.startServer(config);
            } else {
                console.log(`${this.formatDate()} [Health] ${config.name}: OK (pid: ${server.pid})`);
            }
        }
    }

    // Запуск менеджера
    async start() {
        console.log('=== MCP Manager Starting ===\n');
    console.log(`Base path: ${this.basePath}`);
    console.log(`Data path: ${this.dataPath}`);
    console.log(`Output path: ${this.outputPath}`);
        console.log(`Process PID: ${process.pid}\n`);
        // Ensure required directories exist
        try {
            await fs.mkdir(this.dataPath, { recursive: true });
            await fs.mkdir(this.outputPath, { recursive: true });
            // Touch JSONL files so watcher has them
            const filesToTouch = Object.values(this.sources).map(f => path.join(this.dataPath, f));
            await Promise.all(filesToTouch.map(async (p) => {
                try {
                    await fs.access(p);
                } catch {
                    await fs.writeFile(p, '');
                }
            }));
        } catch (e) {
            console.error('Failed to ensure MCP directories:', e.message);
        }
        // Убедимся, что JSONL для всех источников существуют (включая prisma/postgres)
        const allJsonl = Object.values(this.sources).map(v => path.join(this.dataPath, v));
        await Promise.all(allJsonl.map(async (p) => {
            try { await fs.access(p); } catch { await fs.writeFile(p, ''); }
        }));

        // Запускаем все серверы
        await this.startAllServers();
        
        // Запускаем агрегацию
        await this.aggregate();
        
        // Запускаем наблюдатель
        this.startWatcher();
        
        // Запускаем периодическую проверку здоровья
        setInterval(() => this.healthCheck(), 30000);
        
    // Периодическая агрегация каждую минуту
    setInterval(() => this.aggregate(), 60000);
        
        console.log('\n=== MCP Manager Ready ===\n');
        
        // Обработка сигналов завершения
    process.on('SIGTERM', () => this.shutdown());
    process.on('SIGINT', () => this.shutdown());
        
        // Keep process alive
        process.stdin.resume();
    }

    // Корректное завершение
    shutdown() {
        console.log('\n=== Shutting down MCP Manager ===');
        
        // Останавливаем только stdio-сервера; HTTP — пропускаем
        for (const cfg of this.serverConfigs) {
            if (cfg.type === 'http') continue;
            const server = this.servers.get(cfg.name);
            if (server && typeof server.kill === 'function') {
                console.log(`Stopping ${cfg.name}...`);
                server.kill('SIGTERM');
            }
        }
        
        // Останавливаем наблюдатели
        const watchFiles = Object.values(this.sources).map(f => 
            path.join(this.dataPath, f)
        );
        for (const file of watchFiles) {
            fsSync.unwatchFile(file);
        }
        
        console.log('MCP Manager stopped');
        process.exit(0);
    }
}

// Запуск
if (require.main === module) {
    const manager = new MCPManager();
    manager.start().catch(err => {
        console.error('Fatal error:', err);
        process.exit(1);
    });
}

module.exports = MCPManager;
