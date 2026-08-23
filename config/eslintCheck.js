/* eslint-disable no-console */
/**
 * 工程代码 pre-commit 检查工具。
 * 使用 Node 读取暂存区文件，避免 Windows 环境依赖 Unix grep。
 */
const { execFileSync } = require('child_process');
const { CLIEngine } = require('eslint');

function getStagedJavaScriptFiles() {
  try {
    const output = execFileSync(
      'git',
      ['diff', '--cached', '--name-only', '--diff-filter=ACM'],
      { encoding: 'utf8' },
    );
    return output
      .split(/\r?\n/)
      .map((file) => file.trim())
      .filter((file) => /\.(?:js|ts)$/i.test(file));
  } catch (error) {
    console.error(`读取暂存区文件失败：${error.message}`);
    process.exitCode = 1;
    return [];
  }
}

const files = getStagedJavaScriptFiles();
if (files.length === 0) {
  console.log('没有需要检查的暂存区 JavaScript/TypeScript 文件。');
  process.exit(0);
}

const cli = new CLIEngine({});
const { results } = cli.executeOnFiles(files);
let errorCount = 0;
let warningCount = 0;

results.forEach((result) => {
  errorCount += result.errorCount;
  warningCount += result.warningCount;
  if (!result.messages.length) return;

  console.log(`\n${result.filePath}`);
  result.messages.forEach((message) => {
    const level = message.severity === 2 ? 'error' : 'warn';
    console.log(
      ` ${message.line}:${message.column}\t${level}\t${message.message}\t${message.ruleId || ''}`,
    );
  });
});

if (errorCount || warningCount) {
  console.log(`\n${errorCount + warningCount} problems (${errorCount} errors, ${warningCount} warnings)`);
} else {
  console.log('~~ Done: 代码检验通过，提交成功 ~~');
}

process.exit(errorCount > 0 ? 1 : 0);
