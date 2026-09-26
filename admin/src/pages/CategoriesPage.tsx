import { useEffect, useMemo, useRef, useState } from 'react';
import { useBlocker, useOutletContext } from 'react-router-dom';
import { Button, Input, MessagePlugin } from 'tdesign-react';
import { ChevronDownIcon, ChevronUpIcon, DeleteIcon, EditIcon, ImageIcon } from 'tdesign-icons-react';
import { adminApi } from '../lib/api';
import type { Category, ListResult } from '../types';
import { ErrorState, ImageFilePicker, LoadingState, Panel, Table } from '../components/Ui';
import type { AdminOutletContext } from '../components/Layout';

const idOf = (row: Category) => String(row._id || row.id || '');
const sortCategories = (a: Category, b: Category) => Number(a.sort || 0) - Number(b.sort || 0)
  || String(a.createdAt || idOf(a)).localeCompare(String(b.createdAt || idOf(b)));
const isDraftId = (id: string) => id.startsWith('draft-category-');
const categorySnapshot = (items: Category[]) => JSON.stringify(items.map((item) => [idOf(item), item.name, item.parentId || null, item.sort ?? null, item.image || '']));

function CategoryImagePreview({ image, name }: { image: string; name: string }) {
  const [source, setSource] = useState('');
  useEffect(() => {
    let active = true;
    if (!image) { setSource(''); return () => { active = false; }; }
    if (!image.startsWith('cloud://') && !image.startsWith('local://')) { setSource(image); return () => { active = false; }; }
    void adminApi.getTempFileUrl(image).then((url) => { if (active) setSource(url); }).catch(() => { if (active) setSource(''); });
    return () => { active = false; };
  }, [image]);
  return source ? <img className="category-manager-image-preview" src={source} alt={`${name}图片预览`} /> : null;
}

async function readCategories() {
  const rows: Category[] = [];
  for (let page = 1; ; page += 1) {
    const result = await adminApi.call<ListResult<Category>>('categories.list', { page, pageSize: 100, status: 'active', orderBy: '_id', direction: 'asc' });
    rows.push(...result.items);
    if (result.items.length < 100 || rows.length >= (result.total || Infinity)) return rows.sort(sortCategories);
  }
}

export function CategoriesPage() {
  const [rows, setRows] = useState<Category[]>([]);
  const [savedRows, setSavedRows] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploadingId, setUploadingId] = useState('');
  const [imageEditingId, setImageEditingId] = useState('');
  const [selectedParentId, setSelectedParentId] = useState('');
  const [newParentName, setNewParentName] = useState('');
  const [newChildName, setNewChildName] = useState('');
  const [editingId, setEditingId] = useState('');
  const [editingName, setEditingName] = useState('');
  const [reparentingId, setReparentingId] = useState('');
  const [newParentId, setNewParentId] = useState('');
  const operationRef = useRef(false);
  const draftIdRef = useRef(0);
  const { setUnsavedChanges } = useOutletContext<AdminOutletContext>();
  const dirty = !loading && (Boolean(uploadingId) || categorySnapshot(rows) !== categorySnapshot(savedRows)
    || Boolean(editingId && editingName.trim() !== rows.find((item) => idOf(item) === editingId)?.name));
  const blocker = useBlocker(dirty);

  const parents = useMemo(() => rows.filter((row) => !row.parentId), [rows]);
  const parent = parents.find((row) => idOf(row) === selectedParentId) || parents[0];
  const children = rows.filter((row) => parent && String(row.parentId || '') === idOf(parent));
  const orphans = rows.filter((row) => row.parentId && !parents.some((item) => idOf(item) === String(row.parentId)));

  useEffect(() => {
    setUnsavedChanges(dirty);
    return () => setUnsavedChanges(false);
  }, [dirty, setUnsavedChanges]);
  useEffect(() => {
    if (!dirty) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [dirty]);
  useEffect(() => {
    let active = true;
    void readCategories().then((items) => { if (active) { setRows(items); setSavedRows(items); } })
      .catch((err: unknown) => { if (active) setError(err instanceof Error ? err.message : '分类读取失败'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const create = (level: 'parent' | 'child') => {
    const name = (level === 'parent' ? newParentName : newChildName).trim();
    if (!name) { void MessagePlugin.warning('请输入分类名称'); return; }
    if (level === 'child' && !parent) { void MessagePlugin.warning('请先新增一级分类'); return; }
    const parentId = level === 'parent' ? null : idOf(parent);
    if (rows.some((item) => (item.parentId || null) === parentId && item.name === name)) { void MessagePlugin.warning('同级分类名称不能重复'); return; }
    const id = `draft-category-${Date.now()}-${++draftIdRef.current}`;
    const siblings = rows.filter((item) => (item.parentId || null) === parentId);
    const sort = siblings.length ? Math.max(...siblings.map((item) => Number(item.sort) || 0)) + 1 : 0;
    setRows((old) => [...old, { _id: id, name, parentId, sort, createdAt: new Date().toISOString() }].sort(sortCategories));
    if (level === 'parent') { setSelectedParentId(id); setNewParentName(''); }
    else setNewChildName('');
  };
  const rename = (target: Category) => {
    const name = editingName.trim();
    if (!name) { void MessagePlugin.warning('请输入分类名称'); return; }
    if (rows.some((item) => idOf(item) !== idOf(target) && (item.parentId || null) === (target.parentId || null) && item.name === name)) { void MessagePlugin.warning('同级分类名称不能重复'); return; }
    setRows((old) => old.map((row) => idOf(row) === idOf(target) ? { ...row, name } : row));
    setEditingId('');
    setEditingName('');
  };
  const remove = (target: Category) => {
    const message = target.parentId ? '保存后，关联商品将变为无类别。' : '保存后，其二级分类也会删除，关联商品将变为无类别。';
    if (busy || !window.confirm(`确定删除分类“${target.name}”吗？${message}`)) return;
    setRows((old) => old.filter((row) => idOf(row) !== idOf(target) && String(row.parentId || '') !== idOf(target)));
    if (selectedParentId === idOf(target)) setSelectedParentId('');
    setEditingId('');
    setReparentingId('');
  };
  const reparent = (target: Category) => {
    if (!newParentId) { void MessagePlugin.warning('请选择一级分类'); return; }
    if (rows.some((item) => idOf(item) !== idOf(target) && item.parentId === newParentId && item.name === target.name)) { void MessagePlugin.warning('同级分类名称不能重复'); return; }
    setRows((old) => old.map((row) => idOf(row) === idOf(target) ? { ...row, parentId: newParentId } : row));
    setSelectedParentId(newParentId);
    setReparentingId('');
  };
  const move = (items: Category[], index: number, direction: -1 | 1) => {
    const next = [...items];
    [next[index], next[index + direction]] = [next[index + direction], next[index]];
    const positions = new Map(next.map((item, sort) => [idOf(item), sort]));
    setRows((old) => old.map((row) => positions.has(idOf(row)) ? { ...row, sort: positions.get(idOf(row)) } : row).sort(sortCategories));
  };
  const uploadImage = async (target: Category, file: File) => {
    const id = idOf(target);
    setUploadingId(id);
    try {
      const image = await adminApi.upload(file, 'admin/categories');
      setRows((old) => old.map((item) => idOf(item) === id ? { ...item, image } : item));
      void MessagePlugin.success('图片已上传，点击保存后生效');
    } catch (err) { void MessagePlugin.error(err instanceof Error ? err.message : '图片上传失败'); }
    finally { setUploadingId(''); }
  };
  const save = async () => {
    if (operationRef.current || uploadingId) return false;
    const editedName = editingName.trim();
    if (editingId && !editedName) { void MessagePlugin.warning('请输入分类名称'); return false; }
    const draft = rows.map((row) => idOf(row) === editingId ? { ...row, name: editedName } : row);
    const names = new Set<string>();
    for (const item of draft) {
      const key = `${item.parentId || ''}\0${item.name}`;
      if (names.has(key)) { void MessagePlugin.warning('同级分类名称不能重复'); return false; }
      names.add(key);
    }
    operationRef.current = true;
    setBusy(true);
    try {
      const remaining = new Set(draft.map(idOf));
      const removed = savedRows.filter((item) => !remaining.has(idOf(item)));
      const removedParents = new Set(removed.filter((item) => !item.parentId).map(idOf));
      for (const item of removed.filter((item) => !item.parentId || !removedParents.has(String(item.parentId)))) {
        await adminApi.call('categories.delete', { id: idOf(item) });
      }
      const idMap = new Map<string, string>();
      for (const item of draft.filter((row) => isDraftId(idOf(row)) && !row.parentId)) {
        const created = await adminApi.call<Category>('categories.save', { name: item.name, parentId: null });
        idMap.set(idOf(item), idOf(created));
      }
      const original = new Map(savedRows.map((item) => [idOf(item), item]));
      for (const item of draft.filter((row) => !isDraftId(idOf(row)))) {
        const before = original.get(idOf(item));
        if (before && (before.name !== item.name || (before.parentId || null) !== (item.parentId || null) || (before.image || '') !== (item.image || ''))) {
          await adminApi.call('categories.save', { id: idOf(item), name: item.name, parentId: item.parentId ? idMap.get(String(item.parentId)) || item.parentId : null, image: item.image || '' });
        }
      }
      for (const item of draft.filter((row) => isDraftId(idOf(row)) && row.parentId)) {
        const created = await adminApi.call<Category>('categories.save', { name: item.name, parentId: idMap.get(String(item.parentId)) || item.parentId, image: item.image || '' });
        idMap.set(idOf(item), idOf(created));
      }
      for (const parentId of [null, ...draft.filter((item) => !item.parentId).map(idOf)]) {
        const ids = draft.filter((item) => (item.parentId || null) === parentId)
          .sort(sortCategories).map((item) => idMap.get(idOf(item)) || idOf(item));
        if (ids.length) await adminApi.call('categories.reorder', { parentId: parentId ? idMap.get(parentId) || parentId : null, ids });
      }
      const fresh = await readCategories();
      setRows(fresh);
      setSavedRows(fresh);
      setSelectedParentId((old) => idMap.get(old) || old);
      setEditingId('');
      setEditingName('');
      setImageEditingId('');
      setError('');
      void MessagePlugin.success('分类设置已保存');
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : '保存失败';
      void MessagePlugin.error(`保存未完成，部分修改可能已生效：${message}`);
      try {
        const fresh = await readCategories();
        setRows(fresh);
        setSavedRows(fresh);
        setEditingId('');
      } catch { void MessagePlugin.error('分类列表刷新失败，请重新打开页面查看已保存的内容'); }
      return false;
    } finally { operationRef.current = false; setBusy(false); }
  };
  const editActions = (target: Category) => editingId === idOf(target)
    ? <div className="category-manager-actions"><Button size="small" theme="primary" disabled={busy} onClick={() => rename(target)}>确定</Button><Button size="small" variant="text" disabled={busy} onClick={() => setEditingId('')}>取消</Button></div>
    : <div className="category-manager-actions"><Button size="small" variant="text" icon={<EditIcon />} title="改名" aria-label={`改名 ${target.name}`} disabled={busy} onClick={() => { setEditingId(idOf(target)); setEditingName(target.name); }} /><Button size="small" variant="text" icon={<DeleteIcon />} title="删除" aria-label={`删除 ${target.name}`} disabled={busy} onClick={() => void remove(target)} /></div>;
  const moveActions = (items: Category[], index: number) => <div className="category-manager-move"><Button size="small" variant="text" icon={<ChevronUpIcon />} title="上移" aria-label={`上移 ${items[index].name}`} disabled={busy || index === 0} onClick={() => void move(items, index, -1)} /><Button size="small" variant="text" icon={<ChevronDownIcon />} title="下移" aria-label={`下移 ${items[index].name}`} disabled={busy || index === items.length - 1} onClick={() => void move(items, index, 1)} /></div>;
  const nameCell = (target: Category) => editingId === idOf(target)
    ? <Input value={editingName} onChange={setEditingName} /> : <strong>{target.name}</strong>;

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={() => { setLoading(true); void readCategories().then((items) => { setRows(items); setSavedRows(items); setError(''); }).catch((err: unknown) => setError(err instanceof Error ? err.message : '分类读取失败')).finally(() => setLoading(false)); }} />;
  return <>
    <div className="page-actions"><Button theme="primary" loading={busy} disabled={!dirty || busy || Boolean(uploadingId)} onClick={() => void save()}>保存</Button></div>
    <div className="category-manager-columns">
      <Panel>
        <div className="panel-heading"><h3>一级分类</h3></div>
        <div className="category-manager-add category-manager-add-primary"><div className="category-manager-name-input"><Input value={newParentName} onChange={setNewParentName} placeholder="例如：鞋靴" aria-label="一级分类名称" /></div><Button theme="primary" loading={busy} onClick={() => void create('parent')}>新增一级分类</Button></div>
        <div className="category-manager-parent-list">
          {parents.length === 0 && <p className="category-manager-note">暂无一级分类，请先新增。</p>}
          {parents.map((item, index) => <div key={idOf(item)} className={`category-manager-parent ${idOf(parent) === idOf(item) ? 'category-manager-selected' : ''}`}>
            {editingId === idOf(item) ? nameCell(item) : <button type="button" className="category-manager-parent-select" aria-pressed={idOf(parent) === idOf(item)} onClick={() => { setSelectedParentId(idOf(item)); setEditingId(''); }}><strong>{item.name}</strong></button>}
            {moveActions(parents, index)}
            {editActions(item)}
          </div>)}
        </div>
      </Panel>
      <Panel>
        <div className="panel-heading"><h3>二级分类</h3></div>
        <div className="category-manager-add category-manager-add-primary"><div className="category-manager-name-input"><Input value={newChildName} onChange={setNewChildName} placeholder={parent ? `添加到${parent.name}` : '请先新增一级分类'} disabled={!parent} aria-label="二级分类名称" /></div><Button theme="primary" loading={busy} disabled={!parent} onClick={() => void create('child')}>新增二级分类</Button></div>
        <div className="category-manager-parent-list">
          {children.length === 0 && <p className="category-manager-note">{parent ? '该一级分类下暂无二级分类。' : '请先新增一级分类。'}</p>}
          {children.map((item, index) => <div key={idOf(item)} className="category-manager-parent category-manager-child-item">
            <div className="category-manager-child-name">{nameCell(item)}</div>
            {moveActions(children, index)}
            <Button size="small" variant="text" className={item.image ? 'category-manager-has-image' : ''} icon={<ImageIcon />} title="设置图片" aria-label={`设置 ${item.name} 的图片`} disabled={busy || Boolean(uploadingId)} onClick={() => setImageEditingId((old) => old === idOf(item) ? '' : idOf(item))} />
            {editActions(item)}
            {imageEditingId === idOf(item) && <div className="category-manager-image-editor">
              <ImageFilePicker onSelect={(file) => void uploadImage(item, file)} disabled={busy || Boolean(uploadingId)} />
              {uploadingId === idOf(item) && <small>正在上传...</small>}
              {item.image && <><CategoryImagePreview image={item.image} name={item.name} /><Button size="small" variant="text" disabled={busy || Boolean(uploadingId)} onClick={() => setRows((old) => old.map((row) => idOf(row) === idOf(item) ? { ...row, image: '' } : row))}>移除图片</Button></>}
            </div>}
          </div>)}
        </div>
      </Panel>
    </div>
    {orphans.length > 0 && <Panel><div className="panel-heading"><h3>待整理分类</h3></div><p className="category-manager-note">这些分类的父分类已不存在。请选择新的一级分类，或删除。</p>
      <Table minWidth={640}><thead><tr><th>分类名称</th><th>原父分类 ID</th><th>操作</th></tr></thead><tbody>
        {orphans.map((item) => <tr key={idOf(item)}><td>{item.name}</td><td>{String(item.parentId)}</td><td><div className="category-manager-actions">{reparentingId === idOf(item) ? <><select value={newParentId} onChange={(event) => setNewParentId(event.target.value)}>{parents.map((parentItem) => <option key={idOf(parentItem)} value={idOf(parentItem)}>{parentItem.name}</option>)}</select><Button size="small" theme="primary" disabled={busy} onClick={() => reparent(item)}>确定归属</Button><Button size="small" variant="text" onClick={() => setReparentingId('')}>取消</Button></> : <Button size="small" variant="text" disabled={busy || !parents.length} onClick={() => { setReparentingId(idOf(item)); setNewParentId(idOf(parent || parents[0])); }}>重新归属</Button>}<Button size="small" variant="text" disabled={busy} onClick={() => remove(item)}>删除</Button></div></td></tr>)}
      </tbody></Table>
    </Panel>}
    {blocker.state === 'blocked' && <div className="home-config-dialog-backdrop" role="presentation"><div className="home-config-dialog" role="alertdialog" aria-modal="true" aria-labelledby="category-unsaved-title"><h3 id="category-unsaved-title">分类设置尚未保存</h3><p>保存修改后再切换页面，或放弃本次修改。</p><div className="home-config-dialog-actions"><Button variant="outline" disabled={busy} onClick={() => blocker.reset()}>继续编辑</Button><Button variant="outline" disabled={busy} onClick={() => blocker.proceed()}>放弃修改</Button><Button theme="primary" loading={busy} onClick={() => void save().then((saved) => { if (saved) blocker.proceed(); })}>保存并离开</Button></div></div></div>}
  </>;
}
