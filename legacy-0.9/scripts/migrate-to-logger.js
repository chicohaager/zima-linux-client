#!/usr/bin/env node

/**
 * Script to migrate console.log/error/warn to logger
 * Usage: node scripts/migrate-to-logger.js
 */

const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '../src/main');

// Patterns to replace
const replacements = [
  {
    pattern: /console\.log\(/g,
    replacement: 'logger.info(',
    description: 'console.log -> logger.info'
  },
  {
    pattern: /console\.error\(/g,
    replacement: 'logger.error(',
    description: 'console.error -> logger.error'
  },
  {
    pattern: /console\.warn\(/g,
    replacement: 'logger.warn(',
    description: 'console.warn -> logger.warn'
  },
  {
    pattern: /console\.debug\(/g,
    replacement: 'logger.debug(',
    description: 'console.debug -> logger.debug'
  }
];

// Check if logger import exists
function hasLoggerImport(content) {
  return /import.*logger.*from.*['"]\.\.\/utils\/logger['"]/.test(content) ||
         /import.*logger.*from.*['"]@main\/utils\/logger['"]/.test(content);
}

// Add logger import if not present
function addLoggerImport(content, filePath) {
  if (hasLoggerImport(content)) {
    return content;
  }

  // Count ../  needed based on file depth
  const depth = filePath.split(path.sep).length - srcDir.split(path.sep).length - 1;
  const relativePath = '../'.repeat(depth) + 'utils/logger';

  // Find first import statement
  const importMatch = content.match(/^import .*from ['"][^'"]+['"];$/m);
  if (importMatch) {
    const importPos = content.indexOf(importMatch[0]);
    const insertPos = importPos + importMatch[0].length;
    return content.slice(0, insertPos) + `\nimport { logger } from '${relativePath}';` + content.slice(insertPos);
  }

  // No imports found, add at beginning
  return `import { logger } from '${relativePath}';\n\n` + content;
}

// Process a single file
function processFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf-8');
  let modified = false;
  let replacementCount = 0;

  // Check if file uses console methods
  const usesConsole = /console\.(log|error|warn|debug)\(/.test(content);
  if (!usesConsole) {
    return { processed: false, replacements: 0 };
  }

  // Apply replacements
  for (const { pattern, replacement, description } of replacements) {
    const matches = content.match(pattern);
    if (matches) {
      content = content.replace(pattern, replacement);
      modified = true;
      replacementCount += matches.length;
    }
  }

  if (modified) {
    // Add logger import if needed
    content = addLoggerImport(content, filePath);

    // Write back
    fs.writeFileSync(filePath, content, 'utf-8');
    return { processed: true, replacements: replacementCount };
  }

  return { processed: false, replacements: 0 };
}

// Recursively process directory
function processDirectory(dir) {
  const files = fs.readdirSync(dir);
  let totalFiles = 0;
  let processedFiles = 0;
  let totalReplacements = 0;

  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    if (stat.isDirectory()) {
      const result = processDirectory(filePath);
      totalFiles += result.totalFiles;
      processedFiles += result.processedFiles;
      totalReplacements += result.totalReplacements;
    } else if (file.endsWith('.ts') && !file.endsWith('.d.ts')) {
      totalFiles++;
      const result = processFile(filePath);
      if (result.processed) {
        processedFiles++;
        totalReplacements += result.replacements;
        console.log(`✓ ${path.relative(srcDir, filePath)}: ${result.replacements} replacements`);
      }
    }
  }

  return { totalFiles, processedFiles, totalReplacements };
}

// Main
console.log('Starting migration from console.* to logger...\n');

const result = processDirectory(srcDir);

console.log('\n========================================');
console.log('Migration complete!');
console.log(`Files scanned: ${result.totalFiles}`);
console.log(`Files modified: ${result.processedFiles}`);
console.log(`Total replacements: ${result.totalReplacements}`);
console.log('========================================\n');

if (result.processedFiles > 0) {
  console.log('Next steps:');
  console.log('1. Review the changes: git diff');
  console.log('2. Test the application');
  console.log('3. Commit the changes');
}
