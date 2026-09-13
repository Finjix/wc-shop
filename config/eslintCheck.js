/* eslint-disable no-console */
/**
 * 工程代码 pre-commit 检查工具。
 * 只检查暂存的 JavaScript/TypeScript 文件，避免 Windows 环境依赖 Unix grep。
 */
const { execFileSync } = require('child_process');
const { ESLint } = require('eslint');

function getStagedSourceFiles() {
  try {
    const output = execFileSync(
      'git',
      ['diff', '--cached', '--name-only', '--diff-filter=ACM'],
      { encoding: 'utf8' },
    );
    return output
      .split(/\r?\n/)
      .map((file) => file.trim())
      .filter((file) => /\.(?:js|ts|tsx)$/i.test(file));
  } catch (error) {
    console.error(`读取暂存区文件失败：${error.message}`);
    process.exitCode = 1;
    return [];
  }
}

async function main() {
  const files = getStagedSourceFiles();
  if (files.length === 0) {
    console.log('没有需要检查的暂存区 JavaScript/TypeScript 文件。');
    return;
  }

  const eslint = new ESLint({ cache: true });
  const results = await eslint.lintFiles(files);
  const formatter = await eslint.loadFormatter('stylish');
  const output = formatter.format(results);
  if (output) console.log(output);

  const errorCount = results.reduce((sum, result) => sum + result.errorCount, 0);
  const warningCount = results.reduce((sum, result) => sum + result.warningCount, 0);
  if (errorCount || warningCount) {
    console.log(`${errorCount + warningCount} problems (${errorCount} errors, ${warningCount} warnings)`);
  } else {
    console.log('~~ Done: 代码检验通过，提交成功 ~~');
  }
  process.exitCode = errorCount > 0 ? 1 : 0;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
