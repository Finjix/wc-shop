import { useState } from 'react';
import { Button, Textarea } from '../components/NativeUi';
import { Link } from 'react-router-dom';
import { adminApi } from '../lib/api';
import { useConfirm } from '../components/ConfirmProvider';
import { ErrorState, Field, Panel } from '../components/Ui';

type Inspection = { retained: string[]; unreferenced: string[] };
export function MaintenancePage() {
  const confirm = useConfirm();
  const [input, setInput] = useState('');
  const [result, setResult] = useState<Inspection | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const inspect = async () => {
    if (busy) return;
    const paths = [...new Set(input.split(/\r?\n/).map((value) => value.trim()).filter(Boolean))];
    if (!paths.length) return;
    setBusy(true); setError(''); setNotice(''); setResult(null);
    try {
      const next: Inspection = { retained: [], unreferenced: [] };
      for (const cloud of [true, false]) {
        const group = paths.filter((value) => /^(cloud|local):\/\//.test(value) === cloud);
        for (let offset = 0; offset < group.length; offset += 5) {
          const batch = group.slice(offset, offset + 5);
          const checked = await adminApi.call<Inspection>('storage.maintenance.inspect', cloud ? { fileList: batch } : { cloudPaths: batch });
          next.retained.push(...checked.retained); next.unreferenced.push(...checked.unreferenced);
        }
      }
      setResult(next);
    } catch (err) { setError(err instanceof Error ? err.message : '引用检查失败'); }
    finally { setBusy(false); }
  };
  const clean = async () => {
    if (busy || !result?.unreferenced.length) return;
    if (!await confirm(`确定清理这 ${result.unreferenced.length} 个未引用文件吗？清理前会再次核对引用，已删除文件无法恢复。`)) return;
    setBusy(true); setError('');
    try {
      let deleted = 0, retained = 0, pending = 0;
      for (let offset = 0; offset < result.unreferenced.length; offset += 5) {
        const response = await adminApi.call<{ deleted: string[]; retained: string[]; pending?: string[] }>('storage.maintenance.cleanup', { fileList: result.unreferenced.slice(offset, offset + 5) });
        deleted += response.deleted.length; retained += response.retained.length; pending += response.pending?.length || 0;
      }
      setNotice(`已清理 ${deleted} 个，保留 ${retained} 个，待重试 ${pending} 个。`); setResult(null);
    } catch (err) { setError(err instanceof Error ? err.message : '清理失败，候选文件已保留在重试队列'); }
    finally { setBusy(false); }
  };
  return <>
    <div className="panel-heading"><h2>资源维护</h2><Link to="/overview">返回概览</Link></div>
    <Panel className="form-panel">
      <Field label="待检查文件" hint="每行填写一个云存储文件路径或文件 ID。检查包含历史订单、购物车、评价和售后中的引用。">
        <Textarea value={input} disabled={busy} onChange={(value) => { setInput(value); setResult(null); }} autosize={{ minRows: 6, maxRows: 16 }} />
      </Field>
      <Button loading={busy} disabled={!input.trim() || busy} onClick={() => void inspect()}>检查引用</Button>
      {error && <ErrorState message={error} />}
      {notice && <p role="status">{notice}</p>}
      {result && <>
        <p>保留 {result.retained.length} 个，未引用 {result.unreferenced.length} 个。</p>
        <ul>{result.unreferenced.map((id) => <li key={id} style={{ overflowWrap: 'anywhere' }}>{id}</li>)}</ul>
        <Button theme="danger" disabled={busy || !result.unreferenced.length} onClick={() => void clean()}>清理未引用文件</Button>
      </>}
    </Panel>
  </>;
}
