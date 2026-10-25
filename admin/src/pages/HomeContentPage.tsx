import { useEffect, useMemo, useRef, useState } from 'react';
import { useBlocker } from 'react-router-dom';
import { Button, Input, MessagePlugin } from 'tdesign-react';
import { adminApi } from '../lib/api';
import { useDraftImages } from '../lib/useDraftImages';
import { useBrowserLeaveWarning } from '../lib/useBrowserLeaveWarning';
import type { ListResult, Product } from '../types';
import { ErrorState, Field, ImageFilePicker, LoadingState, Panel } from '../components/Ui';

const SLOT = 'home.page-config';
const CONTENT_PLACEHOLDER = '请输入内容';
const PRODUCT_PICKER_PAGE_SIZE = 6;

type ImageLink = { image: string; productId: string };
type HomeConfig = {
  searchText: string;
  banners: ImageLink[];
  recommendations: ImageLink[];
};
type HomeRecord = { _id?: string; slot?: string; type?: string; image?: string; content?: string; link?: string; payload?: unknown; sort?: number; status?: string };

const blankLink = (): ImageLink => ({ image: '', productId: '' });
const defaultConfig = (): HomeConfig => ({
  searchText: '',
  banners: [blankLink()],
  recommendations: [blankLink()],
});

function readConfig(rows: HomeRecord[]): HomeConfig {
  const stored = rows.find((row) => row.slot === SLOT && row.type === 'pageConfig')?.payload as Partial<HomeConfig> | undefined;
  const draft = defaultConfig();
  if (stored) {
    const banners = Array.isArray(stored.banners) ? stored.banners.slice(0, 4).map((entry) => ({ ...blankLink(), ...entry })) : [];
    while (banners.length > 1 && !banners[banners.length - 1].image && !banners[banners.length - 1].productId) banners.pop();
    const recommendations = Array.isArray(stored.recommendations) ? stored.recommendations.slice(0, 4).map((entry) => ({ ...blankLink(), ...entry })) : [];
    while (recommendations.length > 1 && !recommendations[recommendations.length - 1].image && !recommendations[recommendations.length - 1].productId) recommendations.pop();
    return {
      searchText: Array.from(stored.searchText ?? draft.searchText).slice(0, 16).join(''),
      banners: banners.length ? banners : [blankLink()],
      recommendations: recommendations.length ? recommendations : [blankLink()],
    };
  }
  return draft;
}

function ProductSelect({ value, onChange, known, onKnown, emptyLabel = '无跳转' }: {
  value: string;
  onChange: (value: string) => void;
  known: Record<string, Product | null>;
  onKnown: (product: Product) => void;
  emptyLabel?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  useEffect(() => { if (listRef.current) listRef.current.scrollTop = 0; }, [page, query]);
  const [options, setOptions] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const selected = known[value];
  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    return () => document.removeEventListener('mousedown', closeOnOutsideClick);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setError('');
    const timer = window.setTimeout(() => {
      void adminApi.call<ListResult<Product>>('products.list', { page, pageSize: PRODUCT_PICKER_PAGE_SIZE, query: query.trim(), status: 'active' })
        .then((result) => {
          if (!active) return;
          setOptions(result.items || []);
          setTotal(result.total || 0);
        })
        .catch((err: unknown) => { if (active) setError(err instanceof Error ? err.message : '商品读取失败'); })
        .finally(() => { if (active) setLoading(false); });
    }, query ? 250 : 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [open, query, page]);

  return <div className="home-product-picker" ref={rootRef}>
    <button type="button" className="home-product-picker-trigger" aria-expanded={open} onClick={() => setOpen((old) => !old)}>
      <span>{value ? `${selected?.title || value}${selected === null ? '（已下架或删除）' : ''}` : emptyLabel}</span>
      <span aria-hidden="true">⌄</span>
    </button>
    {open && <div className="home-product-picker-menu">
      <input autoFocus type="search" value={query} placeholder="搜索商品名称" onChange={(event) => { setQuery(event.target.value); setPage(1); }} onKeyDown={(event) => { if (event.key === 'Escape') setOpen(false); }} />
      <div className="home-product-picker-list" ref={listRef}>
        {emptyLabel === '无跳转' && <button type="button" aria-pressed={!value} onClick={() => { onChange(''); setOpen(false); }}>{emptyLabel}</button>}
        {loading ? null : error ? <p>{error}</p> : options.map((product) => <button type="button" key={String(product._id)} onClick={() => { onKnown(product); onChange(String(product._id)); setOpen(false); }}>{product.title}</button>)}
      </div>
      <div className="home-product-picker-footer">
        <button type="button" disabled={page <= 1} onClick={() => setPage((old) => old - 1)}>上一页</button>
        <span>{page} / {Math.max(1, Math.ceil(total / PRODUCT_PICKER_PAGE_SIZE))}</span>
        <button type="button" disabled={page * PRODUCT_PICKER_PAGE_SIZE >= total} onClick={() => setPage((old) => old + 1)}>下一页</button>
        {value && <button type="button" onClick={() => { onChange(''); setOpen(false); }}>清除选择</button>}
      </div>
    </div>}
    {value && selected === null && <small className="home-config-warning">此商品已下架或删除，前台不会显示。</small>}
  </div>;
}

function ImagePreview({ image, aspect }: { image: string; aspect: 'banner' | 'square' }) {
  const [preview, setPreview] = useState('');
  useEffect(() => {
    let active = true;
    if (!image) { setPreview(''); return () => { active = false; }; }
    if (!image.startsWith('cloud://') && !image.startsWith('local://')) { setPreview(image); return () => { active = false; }; }
    void adminApi.getTempFileUrl(image).then((url) => { if (active) setPreview(url); }).catch(() => { if (active) setPreview(''); });
    return () => { active = false; };
  }, [image]);
  return preview ? <img className={`home-config-preview home-config-preview-${aspect}`} src={preview} alt="封面预览" /> : null;
}

function ImagePicker({ onChange, select, disabled }: { onChange: (value: string) => void; select: (file: File) => Promise<string>; disabled: boolean }) {
  const [uploading, setUploading] = useState(false);
  const upload = async (file?: File) => {
    if (!file) return;
    setUploading(true);
    try { onChange(await select(file)); }
    catch (error) { await MessagePlugin.error(error instanceof Error ? error.message : '图片上传失败'); }
    finally { setUploading(false); }
  };
  return <>
    <ImageFilePicker onSelect={(file) => void upload(file)} disabled={uploading || disabled} />
  </>;
}

export function HomeContentPage() {
  const draftImages = useDraftImages('home');
  const savingRef = useRef(false);
  const [config, setConfig] = useState<HomeConfig>(defaultConfig);
  const [savedConfig, setSavedConfig] = useState(() => JSON.stringify(defaultConfig()));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [known, setKnown] = useState<Record<string, Product | null>>({});
  const dirty = !loading && JSON.stringify(config) !== savedConfig;
  const blocker = useBlocker(dirty);
  useBrowserLeaveWarning(dirty || saving || draftImages.processing);


  useEffect(() => {
    let active = true;
    void Promise.all([
      adminApi.call<HomeRecord>('home.get', { id: SLOT }).catch(() => null),
      adminApi.call<ListResult<HomeRecord>>('homeContent.list', { page: 1, pageSize: 100 }),
    ])
      .then(([record, result]) => {
        if (!active) return;
        const loaded = readConfig(record ? [record, ...(result.items || [])] : result.items || []);
        setConfig(loaded);
        setSavedConfig(JSON.stringify(loaded));
      })
      .catch((err: unknown) => { if (active) setError(err instanceof Error ? err.message : '首页配置读取失败'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const selectedIds = useMemo(() => Array.from(new Set([
    ...config.banners.map((item) => item.productId),
    ...config.recommendations.map((item) => item.productId),
  ].filter(Boolean))), [config]);
  const selectedKey = selectedIds.join('|');
  useEffect(() => {
    const unavailable = new Set(Object.keys(known).filter((id) => known[id] === null));
    if (!selectedIds.some((id) => unavailable.has(id))) return;
    let active = true;
    const clearLinks = (old: HomeConfig): HomeConfig => ({
      ...old,
      banners: old.banners.map((item) => unavailable.has(item.productId) ? { ...item, productId: '' } : item),
      recommendations: old.recommendations.map((item) => unavailable.has(item.productId) ? { ...item, productId: '' } : item),
    });
    void adminApi.call<HomeRecord>('home.clearUnavailableLinks', { id: SLOT })
      .then(() => {
        if (!active) return;
        setConfig(clearLinks);
        setSavedConfig((old) => JSON.stringify(clearLinks(JSON.parse(old) as HomeConfig)));
      })
      .catch((error: unknown) => {
        if (active) void MessagePlugin.error(error instanceof Error ? error.message : '失效跳转自动清理失败，请重试');
      });
    return () => { active = false; };
  }, [known, selectedKey]);
  useEffect(() => {
    let active = true;
    const missing = selectedIds.filter((id) => !(id in known));
    if (missing.length) {
      void Promise.all(missing.map(async (id) => {
        try {
          const product = await adminApi.call<Product>('products.get', { id });
          return [id, product.status === 'active' && !product.deletedByAdmin ? product : null] as const;
        } catch (error) {
          if ((error as { code?: string }).code === 'NOT_FOUND') return [id, null] as const;
          return null;
        }
      })).then((entries) => { if (active) setKnown((old) => ({ ...old, ...Object.fromEntries(entries.filter((entry) => entry !== null)) })); });
    }
    return () => { active = false; };
    // selectedKey captures the selected IDs; known is checked only when selection changes.
  }, [selectedKey]);

  const updateLink = (kind: 'banners' | 'recommendations', index: number, field: keyof ImageLink, value: string) => {
    setConfig((old) => ({ ...old, [kind]: old[kind].map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item) }));
  };

  const save = async (): Promise<boolean> => {
    const fail = async (message: string) => {
      await MessagePlugin.error(message);
      return false;
    };
    if (savingRef.current || draftImages.processing) return false;
    savingRef.current = true;
    setSaving(true);
    try {
      const saved = await draftImages.images.upload(config);
      await adminApi.call('homeContent.save', {
        id: SLOT, slot: SLOT, type: 'pageConfig', status: 'active', sort: -100,
        payload: {
          searchText: saved.searchText.trim(),
          banners: saved.banners.map((item) => ({ image: item.image.trim(), productId: item.productId.trim() })),
          recommendations: saved.recommendations.map((item) => ({ image: item.image.trim(), productId: item.productId.trim() })),
        },
      });
      setConfig(saved);
      setSavedConfig(JSON.stringify(saved));
      draftImages.images.commit(saved);
      await MessagePlugin.success('首页设置已保存');
      return true;
    } catch (err) { return fail(err instanceof Error ? err.message : '保存失败'); }
    finally { savingRef.current = false; setSaving(false); }
  };

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={() => window.location.reload()} />;
  const productSelect = (value: string, onChange: (value: string) => void, emptyLabel?: string) => <ProductSelect value={value} onChange={onChange} emptyLabel={emptyLabel} known={known} onKnown={(product) => setKnown((old) => ({ ...old, [String(product._id)]: product }))} />;
  const imageLinkFields = (kind: 'banners', entry: ImageLink, index: number) => <div className="home-config-link-fields">
    <Field label="封面图片" fileUpload><ImagePicker select={draftImages.select} disabled={saving} onChange={(value) => updateLink(kind, index, 'image', value)} /></Field>
    <Field label="跳转商品（可选）">{productSelect(entry.productId, (value) => updateLink(kind, index, 'productId', value))}</Field>
  </div>;

  return <div className="home-config-page" inert={saving}>
    <div className="floating-save-actions"><Button theme="primary" loading={saving} disabled={!dirty || saving || draftImages.processing} onClick={() => void save()}>保存</Button></div>
    <Panel><div className="panel-heading"><h3>顶部搜索栏</h3></div><Field label="提示文字"><Input value={config.searchText} onChange={(value) => setConfig((old) => ({ ...old, searchText: Array.from(value).slice(0, 16).join('') }))} placeholder={CONTENT_PLACEHOLDER} maxlength={16} showLimitNumber /></Field></Panel>

    <Panel><div className="panel-heading"><h3>轮播图（9:16）</h3><div className="home-config-panel-actions"><Button disabled={config.banners.length >= 4} onClick={() => setConfig((old) => ({ ...old, banners: [...old.banners, blankLink()] }))}>新增轮播图</Button></div></div>
      {config.banners.map((entry, index) => <div className="home-config-entry" key={index}>
        <div className="home-config-entry-head"><strong>轮播 {index + 1}</strong><Button size="small" variant="text" disabled={config.banners.length <= 1} onClick={() => setConfig((old) => ({ ...old, banners: old.banners.filter((_, i) => i !== index) }))}>删除</Button></div>
        {imageLinkFields('banners', entry, index)}
      </div>)}
      {config.banners.some((entry) => entry.image) && <div className="home-config-image-previews">
        {config.banners.map((entry, index) => entry.image && <div className="home-config-image-preview" key={index}><ImagePreview image={entry.image} aspect="banner" /><span className="home-config-image-caption">轮播图{index + 1}</span></div>)}
      </div>}
    </Panel>


    <Panel><div className="panel-heading"><h3>动态卡片展区</h3><div className="home-config-panel-actions"><Button disabled={config.recommendations.length >= 4} onClick={() => setConfig((old) => ({ ...old, recommendations: [...old.recommendations, blankLink()] }))}>新增卡片</Button></div></div>
      {config.recommendations.map((entry, index) => <div className="home-config-entry" key={index}>
        <div className="home-config-entry-head"><strong>卡片 {index + 1}</strong><Button size="small" variant="text" disabled={config.recommendations.length <= 1} onClick={() => setConfig((old) => ({ ...old, recommendations: old.recommendations.filter((_, i) => i !== index) }))}>删除</Button></div>
        <div className="home-config-link-fields">
          <Field label="封面图片" fileUpload><ImagePicker select={draftImages.select} disabled={saving} onChange={(value) => updateLink('recommendations', index, 'image', value)} /></Field>
          <Field label="跳转商品">{productSelect(entry.productId, (value) => updateLink('recommendations', index, 'productId', value), '请选择商品')}</Field>
        </div>
      </div>)}
      {config.recommendations.some((entry) => entry.image) && <div className="home-config-image-previews">
        {config.recommendations.map((entry, index) => entry.image && <div className="home-config-image-preview" key={index}><ImagePreview image={entry.image} aspect="banner" /><span className="home-config-image-caption">卡片{index + 1}</span></div>)}
      </div>}
    </Panel>

    {blocker.state === 'blocked' && <div className="home-config-dialog-backdrop" role="presentation">
      <div className="home-config-dialog" role="alertdialog" aria-modal="true" aria-labelledby="home-config-unsaved-title">
        <h3 id="home-config-unsaved-title">首页设置尚未保存</h3>

        <div className="home-config-dialog-actions">
          <Button variant="outline" disabled={saving} onClick={() => blocker.reset()}>继续编辑</Button>
          <Button variant="outline" disabled={saving} onClick={() => blocker.proceed()}>放弃修改</Button>
          <Button theme="primary" loading={saving} disabled={draftImages.processing} onClick={() => void save().then((saved) => { if (saved) blocker.proceed(); })}>保存并离开</Button>
        </div>
      </div>
    </div>}
  </div>;
}
