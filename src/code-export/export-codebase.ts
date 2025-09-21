#!/usr/bin/env node
/* eslint-disable padding-line-between-statements, newline-before-return */
// CommonJS wrapper so we can execute without tsx. Falls back gracefully if ts-node absent.
let ExportService;

try {
  require('ts-node/register');
  ExportService = require('./code-export.service').CodeExportService;
} catch {
  // try transpile via dynamic import of ts-node esm loader if available
  try {
    ExportService = require('./code-export.service').CodeExportService;
  } catch (err) {
    console.error('[code-export] Не удалось загрузить сервис:', err);
    process.exit(1);
  }
}

(async () => {
  const svc = new ExportService();

  try {
    console.log('[code-export] Запуск экспорта...');
    const file = await svc.exportCodebase();
    console.log(`[code-export] ✅ Готово: ${file}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[code-export] ❌ Ошибка:', msg);
    process.exit(1);
  }
})();
