import { useEffect, useRef, useState } from 'react';
import { Button, Input } from 'tdesign-react';
import { adminApi } from '../lib/api';
import { prepareImageUpload } from '../lib/image-upload';
import { useAuth } from '../auth/AuthProvider';
import { EmptyTable, ErrorState, Panel, Table } from '../components/Ui';

type Summary = { count: number; bytes: number; unknown: number };
type Job = { _id: string; kind: string; status: string; oldFileID: string; sourceName: string; folder: string; cloudPath: string; oldSize: number; newSize?: number; updatedDocuments: number; documents?: number; error?: string; busy?: boolean };
type Resource = { fileID: string; name: string; format: string; size: number | null; version: string | null; status: string; animated: boolean | null; url: string; error?: string; groups: string[]; uses: Array<{ source: string; id: string; label: string }> };
type ResourceList = { items: Resource[]; total: number; summary: Summary | null; groupSummary: Summary | null; updatedAt: string | null; scan: Job | null; jobs: Job[] };
const GROUPS = [['', '全部'], ['home', '首页'], ['products', '商品'], ['categories', '分类'], ['comments', '评价'], ['afterSales', '售后'], ['other', '其他']];
const STAGES: Record<string, string> = { references: '盘点图片引用', metadata: '读取格式和大小', awaiting_upload: '等待浏览器处理', updating: '更新业务引用', verifying: '复查图片引用', cleanup_pending: '清理旧图', completed: '已完成' };
function bytes(value: number | null | undefined) {
  if (value === null || value === undefined) return '未知';
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(2)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(2)} MB`;
  return `${(value / 1024 ** 3).toFixed(2)} GB`;
}
const pause = () => new Promise((resolve) => setTimeout(resolve, 350));

export function ImageResourcesPage() {
  const { member } = useAuth();
  const roles = member?.roles || [member?.role];
  const canReplace = (Array.isArray(roles) ? roles : [roles]).some((role) => role === 'admin' || role === 'superadmin');
  const [group, setGroup] = useState('');
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ResourceList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState('');
  const [activeFile, setActiveFile] = useState('');
  const [result, setResult] = useState('');
  const mounted = useRef(true);
  const operation = useRef(false);
  const request = useRef(0);
  const filters = useRef({ group, search, page });
  filters.current = { group, search, page };
  const load = async () => {
    const id = ++request.current;
    const value = await adminApi.call<ResourceList>('storage.resources.list', { group: filters.current.group, query: filters.current.search, page: filters.current.page });
    if (mounted.current && id === request.current) { setData(value); setLoading(false); }
    return value;
  };
  const runScan = async (existing?: Job | null) => {
    let job = existing || await adminApi.call<Job>('storage.resources.scan');
    while (mounted.current && job.status !== 'completed') {
      setProgress(`${STAGES[job.status]}… 已检查 ${job.documents || 0} 条业务记录`);
      job = await adminApi.call<Job>('storage.resources.scan', { scanID: job._id });
      if (job.busy) await pause();
    }
    if (mounted.current) await load();
  };
  const refresh = async (existing?: Job | null) => {
    if (operation.current) return;
    operation.current = true; setError('');
    try { await runScan(existing); }
    catch (err) { if (mounted.current) { setError(err instanceof Error ? err.message : '盘点失败'); await load().catch(() => undefined); } }
    finally { operation.current = false; if (mounted.current) { setLoading(false); setProgress(''); } }
  };
  useEffect(() => {
    mounted.current = true;
    void load().then((value) => { if (mounted.current && (!value.summary || value.scan)) void refresh(value.scan); }).catch((err) => { if (mounted.current) { setError(err.message); setLoading(false); } });
    return () => { mounted.current = false; request.current++; };
  }, []);
  useEffect(() => {
    setLoading(true);
    void load().catch((err) => { if (mounted.current) { setError(err.message); setLoading(false); } });
  }, [group, search, page]);

  const replace = async (resource?: Resource, existing?: Job) => {
    if (operation.current || !canReplace) return;
    operation.current = true; setError(''); setResult(''); setActiveFile(resource?.fileID || existing?.oldFileID || '');
    try {
      let job = existing || await adminApi.call<Job>('storage.resources.beginReplacement', { fileID: resource!.fileID, version: resource!.version });
      if (job.status === 'awaiting_upload' && mounted.current) {
        setProgress('下载原图…');
        const source = await adminApi.call<{ url: string; name: string; format: string }>('storage.resources.source', { jobID: job._id });
        const response = await fetch(source.url, { signal: AbortSignal.timeout(120_000) });
        if (!response.ok) throw new Error('原图下载失败，请重试');
        const blob = await response.blob();
        if (!mounted.current) return;
        setProgress('处理图片中…');
        const name = `${source.name.replace(/\.[^.]+$/, '')}.${source.format === 'jpg' ? 'jpeg' : source.format}`;
        const output = await prepareImageUpload(new File([blob], name, { type: `image/${source.format}` }), { existingResource: true });
        if (!mounted.current) return;
        setProgress('上传中…');
        const newFileID = await adminApi.uploadReplacement(output, job);
        // Record the uploaded file even if navigation occurred during the network request.
        job = await adminApi.call<Job>('storage.resources.advanceReplacement', { jobID: job._id, newFileID });
      }
      while (mounted.current && job.status !== 'completed') {
        setProgress(`${STAGES[job.status]}… 已更新 ${job.updatedDocuments || 0} 条记录`);
        job = await adminApi.call<Job>('storage.resources.advanceReplacement', { jobID: job._id });
        if (job.busy) await pause();
      }
      if (mounted.current && job.status === 'completed') {
        const difference = (job.oldSize || 0) - (job.newSize || 0);
        setResult(`替换完成：${bytes(job.oldSize)} → ${bytes(job.newSize)}，${difference >= 0 ? '节省' : '增加'} ${bytes(Math.abs(difference))}`);
        await runScan();
      }
    } catch (err) { if (mounted.current) { setError(err instanceof Error ? err.message : '图片替换失败'); await load().catch(() => undefined); } }
    finally { operation.current = false; if (mounted.current) { setProgress(''); setActiveFile(''); } }
  };
  const cancel = async (job: Job) => {
    if (operation.current) return;
    operation.current = true; setProgress('取消未替换的任务…'); setError('');
    try { await adminApi.call('storage.resources.cancelReplacement', { jobID: job._id }); await load(); }
    catch (err) { if (mounted.current) setError(err instanceof Error ? err.message : '取消失败'); }
    finally { operation.current = false; if (mounted.current) setProgress(''); }
  };
  const totals = data?.summary;
  return <div className="image-resources-page">
    <div className="page-heading"><h1>图片资源</h1><Button variant="outline" disabled={Boolean(progress)} onClick={() => void refresh(data?.scan)}>刷新盘点</Button></div>
    <Panel>
      <div className="resource-summary"><div><span>在用图片总数</span><strong>{totals ? `${totals.count} 张` : '尚未完成盘点'}</strong></div><div><span>占用空间</span><strong>{totals ? bytes(totals.bytes) : '待统计'}</strong></div></div>
      {Boolean(totals?.unknown) && <p className="resource-note">另有 {totals!.unknown} 张图片大小未知，未计入空间总数。</p>}
      {data?.updatedAt && <p className="resource-note">统计时间：{new Date(data.updatedAt).toLocaleString('zh-CN')}</p>}
      <p className="resource-note">仅统计业务正在使用的图片，共享图片计一次，包含已下架商品和历史订单引用。</p>
      <div className="resource-filters">{GROUPS.map(([value, label]) => <button key={value} type="button" className={group === value ? 'selected' : ''} onClick={() => { setGroup(value); setPage(1); }}>{label}</button>)}</div>
      {group && data?.groupSummary && <p>当前分类：{data.groupSummary.count} 张，{bytes(data.groupSummary.bytes)}{data.groupSummary.unknown ? `，另有 ${data.groupSummary.unknown} 张大小未知` : ''}</p>}
      <form className="resource-search" onSubmit={(event) => { event.preventDefault(); setSearch(query.trim()); setPage(1); }}><Input value={query} onChange={setQuery} placeholder="搜索文件名称" /><Button type="submit" variant="outline">搜索</Button></form>
    </Panel>
    {progress && <p className="resource-progress" role="status">{progress}，离开页面后可继续任务。</p>}
    {result && <p className="notice success" role="status">{result}</p>}
    {error && <ErrorState message={error} onRetry={() => void load().catch((err) => setError(err.message))} />}
    {Boolean(data?.jobs.length) && <Panel><h3>未完成的替换任务</h3>{data!.jobs.map((job) => <div className="resource-job" key={job._id}><span>{job.sourceName} · {STAGES[job.status]}{job.status === 'cleanup_pending' && job.error ? '（替换完成，旧图清理待重试）' : ''}{job.error && <small>{job.error}</small>}</span>{canReplace && <div><Button variant="outline" disabled={Boolean(progress)} onClick={() => void replace(undefined, job)}>继续任务</Button>{job.status === 'awaiting_upload' && <Button variant="text" disabled={Boolean(progress)} onClick={() => void cancel(job)}>取消任务</Button>}</div>}</div>)}</Panel>}
    <Panel><Table minWidth={800}><thead><tr><th>图片</th><th>名称 / 使用位置</th><th>格式</th><th>大小</th><th>操作</th></tr></thead><tbody>
      {data?.items.map((item) => {
        const supported = ['png', 'jpeg', 'jpg', 'webp'].includes(item.format) && item.animated !== true && item.status === 'ok' && Boolean(item.version);
        return <tr key={item.fileID}><td>{item.url ? <img className="resource-thumbnail" src={item.url} alt={item.name} loading="lazy" /> : <span>无法预览</span>}</td><td className="resource-name"><strong>{item.name}</strong><small>{item.groups.map((value) => GROUPS.find(([key]) => key === value)?.[1]).join('、')}</small><small title={item.uses.map((use) => use.label).join('\n')}>{item.uses.slice(0, 3).map((use) => use.label).join('；')}{item.uses.length > 3 ? ' 等位置' : ''}</small>{item.status === 'error' && <small className="resource-error">{item.error || '读取异常'}</small>}</td><td>{item.format.toUpperCase() || '未知'}{item.animated === true && <small>动态图片</small>}</td><td>{bytes(item.size)}</td><td>{canReplace ? <Button variant="outline" disabled={!supported || Boolean(progress)} loading={activeFile === item.fileID} onClick={() => void replace(item)}>压缩并替换</Button> : '只读'}{!supported && <small>{item.animated === true ? '动态图片不支持压缩' : item.status !== 'ok' ? '请先修复资源异常' : '暂不支持处理'}</small>}</td></tr>;
      })}
      {!data?.items.length && <EmptyTable colSpan={5} />}
    </tbody></Table><div className="resource-pagination"><Button variant="outline" disabled={page <= 1 || loading} onClick={() => setPage(page - 1)}>上一页</Button><span>{page} / {Math.max(1, Math.ceil((data?.total || 0) / 20))} 页 · {data?.total || 0} 张</span><Button variant="outline" disabled={page * 20 >= (data?.total || 0) || loading} onClick={() => setPage(page + 1)}>下一页</Button></div></Panel>
  </div>;
}
