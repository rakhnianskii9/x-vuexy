#!/usr/bin/env node

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');

class MCPAggregator {
    constructor() {
    this.basePath = '/home/projects/new-flowise/.github/mcp/';
        this.dataPath = path.join(this.basePath, 'data');
        this.outputPath = path.join(this.basePath, 'output');
        
        this.sources = {
            knowledgeGraph: 'knowledge-graph.jsonl',
            memory: 'memory.jsonl',
            sequential: 'sequential.jsonl',
            context7: 'context7.jsonl',
            prismaPostgres: 'prisma-postgres.jsonl'
        };
    }

    async readJSONL(filename) {
        try {
            const content = await fs.readFile(path.join(this.dataPath, filename), 'utf-8');
            return content.split('\n')
                .filter(line => line.trim())
                .map(line => {
                    try {
                        return JSON.parse(line);
                    } catch (e) {
                        console.error(`Error parsing line in ${filename}:`, e.message);
                        return null;
                    }
                })
                .filter(item => item !== null);
        } catch (error) {
            if (error.code === 'ENOENT') {
                console.log(`File ${filename} not found, creating empty file`);
                await fs.writeFile(path.join(this.dataPath, filename), '');
            }
            return [];
        }
    }

    async aggregate() {
        console.log('[Aggregator] Starting aggregation...');
        
        const data = {
            knowledgeGraph: await this.readJSONL(this.sources.knowledgeGraph),
            memory: await this.readJSONL(this.sources.memory),
            sequential: await this.readJSONL(this.sources.sequential),
            context7: await this.readJSONL(this.sources.context7),
            prismaPostgres: await this.readJSONL(this.sources.prismaPostgres),
            timestamp: new Date().toISOString(),
            stats: {}
        };
        
        data.stats = {
            knowledgeGraph: data.knowledgeGraph.length,
            memory: data.memory.length,
            sequential: data.sequential.length,
            context7: data.context7.length,
            prismaPostgres: data.prismaPostgres.length,
            total: Object.values(data).reduce((sum, arr) => 
                Array.isArray(arr) ? sum + arr.length : sum, 0
            )
        };
        
        // Сохраняем в output/
        await fs.writeFile(
            path.join(this.outputPath, 'aggregated.json'),
            JSON.stringify(data, null, 2)
        );
        
        console.log('[Aggregator] Stats:', JSON.stringify(data.stats));
        return data;
    }

    async watch() {
        console.log('[Watcher] Starting file watcher...');
        const watchFiles = Object.values(this.sources).map(f => 
            path.join(this.dataPath, f)
        );
        
        for (const file of watchFiles) {
            try {
                // Создаем файл если его нет
                await fs.access(file).catch(() => fs.writeFile(file, ''));
                
                fsSync.watchFile(file, { interval: 2000 }, async (curr, prev) => {
                    if (curr.mtime !== prev.mtime) {
                        console.log(`[Watcher] File changed: ${path.basename(file)}`);
                        await this.aggregate();
                    }
                });
                console.log(`[Watcher] Watching: ${path.basename(file)}`);
            } catch (err) {
                console.error(`[Watcher] Error for ${file}:`, err.message);
            }
        }
        
        // Периодическая агрегация каждую минуту
        setInterval(() => this.aggregate(), 60000);
        
        // Keep process alive
        process.stdin.resume();
    }
}

if (require.main === module) {
    const aggregator = new MCPAggregator();
    const args = process.argv.slice(2);
    
    if (args.includes('--watch')) {
        aggregator.aggregate().then(() => {
            aggregator.watch();
        }).catch(err => {
            console.error('Error:', err);
            process.exit(1);
        });
    } else {
        aggregator.aggregate().then(() => {
            process.exit(0);
        }).catch(err => {
            console.error('Error:', err);
            process.exit(1);
        });
    }
}

module.exports = MCPAggregator;
