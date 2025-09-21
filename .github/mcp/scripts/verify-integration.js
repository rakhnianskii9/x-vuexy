#!/usr/bin/env node

const fs = require('fs').promises;
const path = require('path');

async function verifyMCPIntegration() {
    const basePath = process.env.MCP_BASE_PATH || '/home/projects/new-flowise/.github/mcp/';
    const dataPath = process.env.MCP_DATA_PATH || path.join(basePath, 'data');
    const outputPath = process.env.MCP_OUTPUT_PATH || path.join(basePath, 'output');

    // Базовые фиксированные источники
    const sources = [
        'knowledge-graph.jsonl',
        'memory.jsonl',
        'sequential.jsonl',
        'context7.jsonl',
        'prisma-vuexy.jsonl',
        'postgres-vuexy.jsonl',
        'postgres-flowise.jsonl'
    ];

    console.log('=== MCP Integration Check ===\n');

    let allOk = true;

    // Check data sources
    for (const f of sources) {
        const p = path.join(dataPath, f);
        try {
            const stat = await fs.stat(p);
            const content = await fs.readFile(p, 'utf-8').catch(() => '');
            const lines = content.split('\n').filter(l => l.trim()).length;
            console.log(`✅ data/${f}: ${lines} line(s)`);
            if (lines === 0) allOk = false;
        } catch {
            console.log(`❌ data/${f}: MISSING`);
            allOk = false;
        }
    }

    // Дополнительного динамического прохода не требуется

    // Check aggregated output
    const aggPath = path.join(outputPath, 'aggregated.json');
    try {
        const raw = await fs.readFile(aggPath, 'utf-8');
        const json = JSON.parse(raw);
        const stats = json.stats || {};
        console.log(`✅ output/aggregated.json: total=${stats.total ?? 'n/a'} ` +
            `(kg=${stats.knowledgeGraph ?? 'n/a'}, mem=${stats.memory ?? 'n/a'}, seq=${stats.sequential ?? 'n/a'}, ctx=${stats.context7 ?? 'n/a'}, prisma-vuexy=${stats.prismaVuexy ?? 'n/a'}, pg-vuexy=${stats.postgresVuexy ?? 'n/a'}, pg-flowise=${stats.postgresFlowise ?? 'n/a'})`);
        if (!stats.total || stats.total < 1) allOk = false;
    } catch (e) {
        console.log('❌ output/aggregated.json: MISSING or INVALID');
        allOk = false;
    }

    // Warn about legacy file if exists
    const legacyAgg = path.join(basePath, 'aggregated.json');
    try {
        await fs.stat(legacyAgg);
        console.log('⚠️  legacy aggregated.json found at basePath (should be in output/)');
        allOk = false;
    } catch {}

    console.log('\n=== Result ===');
    if (allOk) {
        console.log('✅ All checks passed!');
    } else {
        console.log('❌ Some issues found');
    }

    return allOk;
}

if (require.main === module) {
    verifyMCPIntegration()
        .then(ok => process.exit(ok ? 0 : 1))
        .catch(err => {
            console.error('Error:', err);
            process.exit(1);
        });
}

module.exports = { verifyMCPIntegration };
