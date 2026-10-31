import { useEffect, useRef, useState } from 'react';
import { useBlocker } from 'react-router-dom';
import { Button, Input, MessagePlugin } from 'tdesign-react';
import { ChevronDownIcon, ChevronUpIcon, DeleteIcon, EditIcon, ImageIcon } from 'tdesign-icons-react';
import { adminApi } from '../lib/api';
import { IMAGE_ACCEPT } from '../lib/image-upload';
import { useDraftImages } from '../lib/useDraftImages';
import { useBrowserLeaveWarning } from '../lib/useBrowserLeaveWarning';
import { useConfirm } from '../components/ConfirmProvider';
import type { Category, ListResult } from '../types';
import { ErrorState, LoadingState, Panel } from '../components/Ui';

const idOf = (row?: Category) => String(row?._id || row?.id || '');
const sortCategories = (a: Category, b: Category) => Number(a.sort || 0) - Number(b.sort || 0)
  || String(a.createdAt || idOf(a)).localeCompare(String(b.createdAt || idOf(b)));
const isDraftId = (id: string) => id.startsWith('draft-category-');
const categorySnapshot = (items: Category[]) => JSON.stringify(items.map((item) => [idOf(item), item.name, item.parentId || null, item.sort ?? null, item.image || '']));
const levelNames = ['一级类别', '二级类别', '三级类别'];
const CATEGORY_NAME_LIMIT = 5;

function levelOf(item: Category, byId: Map<string, Category>) {
  const visited = new Set<string>();
  let current: Category | undefined = item;
  let level = 0;
  while (current) {
    const id = idOf(current);
    if (visited.has(id) || ++level > 3) return 0;
    visited.add(id);
    if (!current.parentId) return level;
    current = byId.get(String(current.parentId));
  }
  return 0;
}

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
  const confirm = useConfirm();
  const draftImages = useDraftImages('admin/categories');
  const [rows, setRows] = useState<Category[]>([]);
  const [savedRows, setSavedRows] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploadingId, setUploadingId] = useState('');
  const [selectedParentId, setSelectedParentId] = useState('');
  const [selectedChildId, setSelectedChildId] = useState('');
  const [newNames, setNewNames] = useState(['', '', '']);
  const [editingId, setEditingId] = useState('');
  const [editingName, setEditingName] = useState('');
  const operationRef = useRef(false);
  const editingToggleRef = useRef('');
  const imageInputRef = useRef<HTMLInputElement>(null);
  const imageTargetRef = useRef<Category | null>(null);
  const draftIdRef = useRef(0);
  const dirty = !loading && (Boolean(uploadingId) || categorySnapshot(rows) !== categorySnapshot(savedRows)
    || Boolean(editingId && editingName.trim() !== rows.find((item) => idOf(item) === editingId)?.name));
  const blocker = useBlocker(dirty);
  useBrowserLeaveWarning(dirty || busy || draftImages.processing || newNames.some((name) => Boolean(name.trim())));
  const locked = busy || Boolean(uploadingId);
  const parents = rows.filter((row) => !row.parentId).sort(sortCategories);
  const parent = parents.find((row) => idOf(row) === selectedParentId) || parents[0];
  const children = rows.filter((row) => parent && String(row.parentId || '') === idOf(parent)).sort(sortCategories);
  const child = children.find((row) => idOf(row) === selectedChildId) || children[0];
  const leaves = rows.filter((row) => child && String(row.parentId || '') === idOf(child)).sort(sortCategories);
  const byId = new Map(rows.map((row) => [idOf(row), row]));
  const orphans = rows.filter((row) => !levelOf(row, byId));
  const groups = [parents, children, leaves];

  useEffect(() => {
    let active = true;
    void readCategories().then((items) => { if (active) { setRows(items); setSavedRows(items); } })
      .catch((err: unknown) => { if (active) setError(err instanceof Error ? err.message : '分类读取失败'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const create = (index: number) => {
    const name = newNames[index].trim();
    if (!name) { void MessagePlugin.warning('请输入分类名称'); return; }
    if (name.length > CATEGORY_NAME_LIMIT) { void MessagePlugin.warning(`${levelNames[index]}名称最多 ${CATEGORY_NAME_LIMIT} 个字`); return; }
    const ancestor = index === 1 ? parent : child;
    if (index > 0 && !ancestor) { void MessagePlugin.warning(`请先新增${levelNames[index - 1]}`); return; }
    const parentId = index === 0 ? null : idOf(ancestor);
    if (rows.some((item) => (item.parentId || null) === parentId && item.name === name)) { void MessagePlugin.warning('同级分类名称不能重复'); return; }
    const id = `draft-category-${Date.now()}-${++draftIdRef.current}`;
    const siblings = groups[index];
    const sort = siblings.length ? Math.max(...siblings.map((item) => Number(item.sort) || 0)) + 1 : 0;
    setRows((old) => [...old, { _id: id, name, parentId, level: index + 1, sort, createdAt: new Date().toISOString() }].sort(sortCategories));
    if (index === 0) { setSelectedParentId(id); setSelectedChildId(''); }
    if (index === 1) setSelectedChildId(id);
    setNewNames((old) => old.map((value, position) => position === index ? '' : value));
  };
  const finishRename = (target: Category) => {
    const name = editingName.trim();
    setEditingId('');
    setEditingName('');
    if (!name) { void MessagePlugin.warning('分类名称不能为空，已保留原名称'); return; }
    const max = CATEGORY_NAME_LIMIT;
    if (name.length > max) { void MessagePlugin.warning(`分类名称最多 ${max} 个字，已保留原名称`); return; }
    if (rows.some((item) => idOf(item) !== idOf(target) && (item.parentId || null) === (target.parentId || null) && item.name === name)) { void MessagePlugin.warning('同级分类名称不能重复，已保留原名称'); return; }
    setRows((old) => old.map((row) => idOf(row) === idOf(target) ? { ...row, name } : row));
  };
  const remove = async (target: Category) => {
    if (locked || !await confirm(`确定删除分类“${target.name}”${levelOf(target, byId) === 3 ? '' : '及其全部下级类别'}吗？`, { closeBtn: false })) return;
    setRows((old) => {
      const removed = new Set([idOf(target)]);
      let count;
      do {
        count = removed.size;
        old.forEach((row) => { if (removed.has(String(row.parentId || ''))) removed.add(idOf(row)); });
      } while (removed.size !== count);
      return old.filter((row) => !removed.has(idOf(row)));
    });
    setEditingId('');
  };
  const move = (items: Category[], index: number, direction: -1 | 1) => {
    const next = [...items];
    [next[index], next[index + direction]] = [next[index + direction], next[index]];
    const positions = new Map(next.map((item, sort) => [idOf(item), sort]));
    setRows((old) => old.map((row) => positions.has(idOf(row)) ? { ...row, sort: positions.get(idOf(row)) } : row).sort(sortCategories));
  };
  const chooseImage = (target: Category) => {
    imageTargetRef.current = target;
    imageInputRef.current?.click();
  };
  const uploadImage = async (target: Category, file: File) => {
    const id = idOf(target);
    setUploadingId(id);
    try {
      const image = await draftImages.select(file);
      setRows((old) => old.map((item) => idOf(item) === id ? { ...item, image } : item));
    } catch (err) { void MessagePlugin.error(err instanceof Error ? err.message : '图片上传失败'); }
    finally { setUploadingId(''); }
  };
  const save = async () => {
    if (operationRef.current || uploadingId || draftImages.processing) return false;
    const editedName = editingName.trim();
    let draft = rows.map((row) => idOf(row) === editingId && editedName ? { ...row, name: editedName } : row);
    setEditingId('');
    setEditingName('');
    if (editingId && !editedName) { void MessagePlugin.warning('分类名称不能为空，已保留原名称'); return false; }
    const draftById = new Map(draft.map((row) => [idOf(row), row]));
    const names = new Set<string>();
    for (const item of draft) {
      const level = levelOf(item, draftById);
      if (!level) { void MessagePlugin.warning('请先删除父类别已失效的分类'); return false; }
      const max = CATEGORY_NAME_LIMIT;
      if (!item.name.trim() || item.name.trim().length > max) { void MessagePlugin.warning(`${levelNames[level - 1]}“${item.name}”的名称需为 1～${max} 个字`); return false; }
      if (level === 3 && !item.image) { void MessagePlugin.warning(`请设置三级类别“${item.name}”的类别图片`); return false; }
      const key = `${item.parentId || ''}\0${item.name}`;
      if (names.has(key)) { void MessagePlugin.warning('同级分类名称不能重复'); return false; }
      names.add(key);
    }
    const ancestorsWithLeaves = new Set<string>();
    for (const item of draft.filter((row) => levelOf(row, draftById) === 3)) {
      const parentId = String(item.parentId);
      ancestorsWithLeaves.add(parentId);
      const parent = draftById.get(parentId);
      if (parent?.parentId) ancestorsWithLeaves.add(String(parent.parentId));
    }
    const emptyCategory = draft.find((item) => levelOf(item, draftById) < 3 && !ancestorsWithLeaves.has(idOf(item)));
    if (emptyCategory) {
      void MessagePlugin.warning(`类别“${emptyCategory.name}”下必须至少包含一个三级类别`);
      return false;
    }
    operationRef.current = true;
    setBusy(true);
    try {
      draft = await draftImages.images.upload(draft);
      const remaining = new Set(draft.map(idOf));
      const removed = savedRows.filter((item) => !remaining.has(idOf(item)));
      const removedIds = new Set(removed.map(idOf));
      for (const item of removed.filter((item) => !removedIds.has(String(item.parentId || '')))) {
        await adminApi.call('categories.delete', { id: idOf(item) });
      }
      const idMap = new Map<string, string>();
      const original = new Map(savedRows.map((item) => [idOf(item), item]));
      // Save ancestors first so new second/third-level rows use real parent IDs.
      for (const level of [1, 2, 3]) {
        for (const item of draft.filter((row) => levelOf(row, draftById) === level)) {
          const payload = { name: item.name.trim(), parentId: item.parentId ? idMap.get(String(item.parentId)) || item.parentId : null, image: item.image || '' };
          if (isDraftId(idOf(item))) {
            const created = await adminApi.call<Category>('categories.save', payload);
            idMap.set(idOf(item), idOf(created));
          } else {
            const before = original.get(idOf(item));
            if (before && (before.name !== item.name || (before.parentId || null) !== (item.parentId || null) || (before.image || '') !== (item.image || ''))) {
              await adminApi.call('categories.save', { id: idOf(item), ...payload });
            }
          }
        }
      }
      for (const parentId of [null, ...draft.map(idOf)]) {
        const ids = draft.filter((item) => (item.parentId || null) === parentId)
          .sort(sortCategories).map((item) => idMap.get(idOf(item)) || idOf(item));
        if (ids.length) await adminApi.call('categories.reorder', { parentId: parentId ? idMap.get(parentId) || parentId : null, ids });
      }
      const fresh = await readCategories();
      setRows(fresh);
      setSavedRows(fresh);
      setSelectedParentId((old) => idMap.get(old) || old);
      setSelectedChildId((old) => idMap.get(old) || old);
      setError('');
      draftImages.images.commit(fresh);
      void MessagePlugin.success('分类设置已保存');
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : '保存失败';
      void MessagePlugin.error(`保存未完成，部分修改可能已生效：${message}`);
      try {
        const fresh = await readCategories();
        setRows(fresh);
        setSavedRows(fresh);
      } catch { void MessagePlugin.error('分类列表刷新失败，请重新打开页面查看已保存的内容'); }
      return false;
    } finally { operationRef.current = false; setBusy(false); }
  };
  const editActions = (target: Category) => <div className="category-manager-actions"><Button size="small" variant="text" icon={<EditIcon />} title="改名" aria-label={`改名 ${target.name}`} disabled={locked} onPointerDown={() => { editingToggleRef.current = editingId === idOf(target) ? idOf(target) : ''; }} onPointerCancel={() => { editingToggleRef.current = ''; }} onClick={() => {
    const wasEditing = editingToggleRef.current === idOf(target);
    editingToggleRef.current = '';
    if (wasEditing || editingId === idOf(target)) {
      if (editingId === idOf(target)) finishRename(target);
      return;
    }
    setEditingId(idOf(target));
    setEditingName(target.name);
  }} /><Button size="small" variant="text" icon={<DeleteIcon />} title="删除" aria-label={`删除 ${target.name}`} disabled={locked} onClick={() => void remove(target)} /></div>;
  const moveActions = (items: Category[], index: number) => <div className="category-manager-move"><Button size="small" variant="text" icon={<ChevronUpIcon />} title="上移" aria-label={`上移 ${items[index].name}`} disabled={locked || index === 0} onClick={() => move(items, index, -1)} /><Button size="small" variant="text" icon={<ChevronDownIcon />} title="下移" aria-label={`下移 ${items[index].name}`} disabled={locked || index === items.length - 1} onClick={() => move(items, index, 1)} /></div>;
  const nameCell = (target: Category) => editingId === idOf(target)
    ? <Input className="category-manager-name-edit" value={editingName} onChange={setEditingName} onBlur={() => finishRename(target)} autofocus maxlength={CATEGORY_NAME_LIMIT} showLimitNumber disabled={locked} aria-label={`分类名称 ${target.name}`} />
    : <strong>{target.name}</strong>;

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={() => { setLoading(true); void readCategories().then((items) => { setRows(items); setSavedRows(items); setError(''); }).catch((err: unknown) => setError(err instanceof Error ? err.message : '分类读取失败')).finally(() => setLoading(false)); }} />;
  return <>
    <div className="floating-save-actions"><Button theme="primary" loading={busy} disabled={!dirty || locked} onClick={() => void save()}>保存</Button></div>
    <div className="category-manager-columns">
      {groups.map((items, index) => {
        const ancestor = index === 1 ? parent : child;
        const enabled = index === 0 || Boolean(ancestor);
        return <Panel key={index}>
          <div className="panel-heading"><h3>{levelNames[index]}</h3></div>
          <div className="category-manager-add category-manager-add-primary"><div className="category-manager-name-input"><Input value={newNames[index]} onChange={(value) => setNewNames((old) => old.map((name, position) => position === index ? value : name))} placeholder={index === 0 ? '例如：鞋靴' : ancestor ? `添加到${ancestor.name}` : `请先新增${levelNames[index - 1]}`} disabled={!enabled || locked} maxlength={CATEGORY_NAME_LIMIT} showLimitNumber aria-label={`${levelNames[index]}名称`} /></div><Button theme="primary" loading={busy} disabled={!enabled || locked} onClick={() => create(index)}>新增{levelNames[index]}</Button></div>
          <div className="category-manager-parent-list">
            {items.map((item, position) => {
              const selected = index === 0 ? idOf(parent) === idOf(item) : index === 1 && idOf(child) === idOf(item);
              return <div key={idOf(item)} className={`category-manager-parent category-manager-child-item ${selected ? 'category-manager-selected' : ''}`}>
                <div className="category-manager-child-name">{index < 2 && editingId !== idOf(item)
                  ? <button type="button" className="category-manager-parent-select" disabled={locked} aria-pressed={selected} onClick={() => { if (index === 0) { setSelectedParentId(idOf(item)); setSelectedChildId(''); } else setSelectedChildId(idOf(item)); setEditingId(''); }}><strong>{item.name}</strong></button>
                  : nameCell(item)}
                </div>
                {moveActions(items, position)}
                {index > 0 && <Button size="small" variant="text" className={item.image ? 'category-manager-has-image' : ''} icon={<ImageIcon />} title={index === 2 ? '上传类别图片（必填）' : '上传分类封面（可选）'} aria-label={`上传 ${item.name} 的类别图片`} disabled={locked} onClick={() => chooseImage(item)} />}
                {editActions(item)}
                {index > 0 && item.image && <div className="category-manager-image-preview-row"><div className="category-manager-image-preview-wrap">
                  <button type="button" className="category-manager-image-preview-button" title="点击更换图片" aria-label={`更换 ${item.name} 的图片`} disabled={locked} onClick={() => chooseImage(item)}><CategoryImagePreview image={item.image} name={item.name} /></button>
                </div></div>}
              </div>;
            })}
          </div>
        </Panel>;
      })}
    </div>
    <input ref={imageInputRef} className="image-file-picker-input" type="file" accept={IMAGE_ACCEPT} disabled={locked} aria-label="选择类别图片" onChange={(event) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (file && imageTargetRef.current) void uploadImage(imageTargetRef.current, file);
      imageTargetRef.current = null;
    }} />
    {orphans.length > 0 && <Panel><div className="panel-heading"><h3>待整理分类</h3></div><p className="category-manager-note">这些分类的父类别已失效，请删除后按三级结构重新创建。</p>{orphans.map((item) => <div className="category-manager-parent" key={idOf(item)}><strong>{item.name}</strong>{editActions(item)}</div>)}</Panel>}
    {blocker.state === 'blocked' && <div className="home-config-dialog-backdrop" role="presentation"><div className="home-config-dialog" role="alertdialog" aria-modal="true" aria-labelledby="category-unsaved-title"><h3 id="category-unsaved-title">分类设置尚未保存</h3><div className="home-config-dialog-actions"><Button variant="outline" disabled={locked} onClick={() => blocker.reset()}>继续编辑</Button><Button variant="outline" disabled={locked} onClick={() => blocker.proceed()}>放弃修改</Button><Button theme="primary" loading={busy} disabled={locked} onClick={() => void save().then((saved) => { if (saved) blocker.proceed(); })}>保存并离开</Button></div></div></div>}
  </>;
}
