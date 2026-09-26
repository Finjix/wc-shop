import { useEffect, useMemo, useRef, useState } from 'react';
import { useBlocker, useOutletContext } from 'react-router-dom';
import { Button, Input, MessagePlugin } from 'tdesign-react';
import { adminApi } from '../lib/api';
import type { AdminOutletContext } from '../components/Layout';
import type { ListResult, Product } from '../types';
import { ErrorState, Field, ImageFilePicker, LoadingState, Panel } from '../components/Ui';

const SLOT = 'home.page-config';
const CONTENT_PLACEHOLDER = '请输入内容';
const LEGACY_SEARCH_TEXT = '欢迎光临番薯鞋店！';
const LEGACY_BANNER_TEXT = '急速发货 | 品质保证 | 退货无忧';
const OLD_BANNER_TEXT = '急速发货 | 品质保证 | 售后无忧';

type ImageLink = { image: string; productId: string };
type ProductSection = { id: string; title: string; productIds: string[] };
type HomeConfig = {
  searchText: string;
  bannerText: string;
  banners: ImageLink[];
  promos: ImageLink[];
  sections: ProductSection[];
};
type HomeRecord = { _id?: string; slot?: string; type?: string; image?: string; content?: string; link?: string; payload?: unknown; sort?: number; status?: string };
type SaveSource = 'search' | 'banners' | 'bannerText' | 'promos' | 'sections';

const blankLink = (): ImageLink => ({ image: '', productId: '' });
const blankSection = (): ProductSection => ({ id: `section-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, title: '', productIds: ['', ''] });
const defaultConfig = (): HomeConfig => ({
  searchText: '',
  bannerText: '',
  banners: [blankLink()],
  promos: Array.from({ length: 2 }, blankLink),
  sections: [blankSection()],
});

function readConfig(rows: HomeRecord[]): HomeConfig {
  const stored = rows.find((row) => row.slot === SLOT && row.type === 'pageConfig')?.payload as Partial<HomeConfig> | undefined;
  const draft = defaultConfig();
  if (stored) {
    const banners = Array.isArray(stored.banners) ? stored.banners.slice(0, 6).map((entry) => ({ ...blankLink(), ...entry })) : [];
    while (banners.length > 1 && !banners[banners.length - 1].image && !banners[banners.length - 1].productId) banners.pop();
    return {
      searchText: stored.searchText === LEGACY_SEARCH_TEXT ? '' : stored.searchText ?? draft.searchText,
      bannerText: [LEGACY_BANNER_TEXT, OLD_BANNER_TEXT].includes(stored.bannerText || '') ? '' : stored.bannerText ?? draft.bannerText,
      banners: banners.length ? banners : [blankLink()],
      promos: draft.promos.map((fallback, index) => ({ ...fallback, ...stored.promos?.[index] })),
      sections: Array.isArray(stored.sections) && stored.sections.length ? stored.sections.map((section) => ({
        id: section.id,
        title: section.title,
        productIds: [...section.productIds],
      })) : [blankSection()],
    };
  }
  const legacyBanners = rows.filter((row) => row.type === 'banner' && row.status !== 'inactive').sort((a, b) => Number(a.sort || 0) - Number(b.sort || 0));
  draft.banners = legacyBanners.slice(0, 6).map((row) => {
    const payload = row.payload && typeof row.payload === 'object' ? row.payload as Record<string, unknown> : {};
    return {
      image: String(row.image || row.content || ''),
      productId: String(payload.productId || ''),
    };
  });
  if (!draft.banners.length) draft.banners = [blankLink()];
  return draft;
}

function ProductSelect({ value, onChange, known, onKnown }: {
  value: string;
  onChange: (value: string) => void;
  known: Record<string, Product | null>;
  onKnown: (product: Product) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
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
      void adminApi.call<ListResult<Product>>('products.list', { page, pageSize: 20, query: query.trim(), status: 'active' })
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
      <span>{value ? `${selected?.title || value}${selected === null ? '（已下架或删除）' : ''}` : '请选择商品'}</span>
      <span aria-hidden="true">⌄</span>
    </button>
    {open && <div className="home-product-picker-menu">
      <input autoFocus type="search" value={query} placeholder="搜索商品名称" onChange={(event) => { setQuery(event.target.value); setPage(1); }} onKeyDown={(event) => { if (event.key === 'Escape') setOpen(false); }} />
      <div className="home-product-picker-list">
        {loading ? <p>正在加载商品...</p> : error ? <p>{error}</p> : options.length === 0 ? <p>没有找到在售商品</p> : options.map((product) => <button type="button" key={String(product._id)} onClick={() => { onKnown(product); onChange(String(product._id)); setOpen(false); }}>{product.title}</button>)}
      </div>
      <div className="home-product-picker-footer">
        <button type="button" disabled={page <= 1} onClick={() => setPage((old) => old - 1)}>上一页</button>
        <span>{page} / {Math.max(1, Math.ceil(total / 20))}</span>
        <button type="button" disabled={page * 20 >= total} onClick={() => setPage((old) => old + 1)}>下一页</button>
        {value && <button type="button" onClick={() => { onChange(''); setOpen(false); }}>清除选择</button>}
      </div>
    </div>}
    {value && selected === null && <small className="home-config-warning">此商品已下架或删除，请重新选择。</small>}
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

function ImagePicker({ onChange }: { onChange: (value: string) => void }) {
  const [uploading, setUploading] = useState(false);
  const upload = async (file?: File) => {
    if (!file) return;
    setUploading(true);
    try { onChange(await adminApi.upload(file, 'home')); }
    catch (error) { await MessagePlugin.error(error instanceof Error ? error.message : '图片上传失败'); }
    finally { setUploading(false); }
  };
  return <>
    <ImageFilePicker onSelect={(file) => void upload(file)} disabled={uploading} />
    {uploading && <small>正在上传...</small>}
  </>;
}

export function HomeContentPage() {
  const [config, setConfig] = useState<HomeConfig>(defaultConfig);
  const [savedConfig, setSavedConfig] = useState(() => JSON.stringify(defaultConfig()));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveFeedback, setSaveFeedback] = useState<{ source: SaveSource; type: 'error' | 'success'; message: string } | null>(null);
  const [known, setKnown] = useState<Record<string, Product | null>>({});
  const { setUnsavedChanges } = useOutletContext<AdminOutletContext>();
  const dirty = !loading && JSON.stringify(config) !== savedConfig;
  const blocker = useBlocker(dirty);

  useEffect(() => { setSaveFeedback(null); }, [config]);

  useEffect(() => {
    setUnsavedChanges(dirty);
    return () => setUnsavedChanges(false);
  }, [dirty, setUnsavedChanges]);

  useEffect(() => {
    if (!dirty) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [dirty]);

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
    ...config.promos.map((item) => item.productId),
    ...config.sections.flatMap((section) => section.productIds),
  ].filter(Boolean))), [config]);
  const selectedKey = selectedIds.join('|');
  useEffect(() => {
    let active = true;
    const missing = selectedIds.filter((id) => !(id in known));
    if (missing.length) {
      void Promise.all(missing.map(async (id) => {
        try {
          const product = await adminApi.call<Product>('products.get', { id });
          return [id, product.status === 'active' ? product : null] as const;
        } catch { return [id, null] as const; }
      })).then((entries) => { if (active) setKnown((old) => ({ ...old, ...Object.fromEntries(entries) })); });
    }
    return () => { active = false; };
    // selectedKey captures the selected IDs; known is checked only when selection changes.
  }, [selectedKey]);

  const updateLink = (kind: 'banners' | 'promos', index: number, field: keyof ImageLink, value: string) => {
    setConfig((old) => ({ ...old, [kind]: old[kind].map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item) }));
  };
  const updateSection = (index: number, change: Partial<ProductSection>) => setConfig((old) => ({
    ...old, sections: old.sections.map((section, itemIndex) => itemIndex === index ? { ...section, ...change } : section),
  }));
  const resizeSectionProducts = (index: number, count: 2 | -2) => setConfig((old) => ({
    ...old,
    sections: old.sections.map((section, itemIndex) => itemIndex === index && section.productIds.length + count >= 2 && section.productIds.length + count <= 6
      ? { ...section, productIds: count > 0 ? [...section.productIds, '', ''] : section.productIds.slice(0, -2) }
      : section),
  }));

  const save = async (source: SaveSource = 'search'): Promise<boolean> => {
    setSaveFeedback(null);
    const fail = async (message: string) => {
      setSaveFeedback({ source, type: 'error', message });
      await MessagePlugin.error(message);
      return false;
    };
    if (config.banners.length < 1 || config.banners.length > 6) return fail('轮播图：请保留一至六张');
    for (const [kind, entries] of [['轮播图', config.banners], ['图片入口', config.promos]] as const) {
      for (const [index, entry] of entries.entries()) {
        const place = kind === '图片入口' ? `${index === 0 ? '左侧' : '右侧'}图片入口` : `轮播图 ${index + 1}`;
        if (!entry.image.trim() && entry.productId.trim()) return fail(`${place}：请上传封面图片`);
      }
    }
    if (config.sections.length < 1 || config.sections.length > 6) return fail('商品区：请保留一至六个');
    for (const [index, section] of config.sections.entries()) {
      if (!section.title.trim()) return fail(`商品区 ${index + 1}：请填写标题`);
      if (![2, 4, 6].includes(section.productIds.length)) return fail(`商品区 ${index + 1}：商品数量须为二、四或六个`);
      const missingProduct = section.productIds.findIndex((id) => !id.trim());
      if (missingProduct !== -1) return fail(`商品区 ${index + 1}：请选择商品 ${missingProduct + 1}`);
    }
    for (const [index, entry] of config.banners.entries()) if (entry.productId && known[entry.productId] === null) return fail(`轮播图 ${index + 1}：跳转商品已下架或删除，请重新选择`);
    for (const [index, entry] of config.promos.entries()) if (entry.productId && known[entry.productId] === null) return fail(`${index === 0 ? '左侧' : '右侧'}图片入口：跳转商品已下架或删除，请重新选择`);
    for (const [sectionIndex, section] of config.sections.entries()) {
      const missingProduct = section.productIds.findIndex((id) => known[id] === null);
      if (missingProduct !== -1) return fail(`商品区 ${sectionIndex + 1}：商品 ${missingProduct + 1} 已下架或删除，请重新选择`);
    }
    const snapshot = JSON.stringify(config);
    setSaving(true);
    try {
      await adminApi.call('homeContent.save', {
        id: SLOT, slot: SLOT, type: 'pageConfig', status: 'active', sort: -100,
        payload: {
          searchText: config.searchText.trim(), bannerText: config.bannerText.trim(),
          banners: config.banners.map((item) => ({ image: item.image.trim(), productId: item.productId.trim() })),
          promos: config.promos.map((item) => ({ image: item.image.trim(), productId: item.productId.trim() })),
          sections: config.sections.map((section) => ({ id: section.id, title: section.title.trim(), productIds: section.productIds })),
        },
      });
      setSavedConfig(snapshot);
      setSaveFeedback({ source, type: 'success', message: '首页设置已保存' });
      await MessagePlugin.success('首页设置已保存');
      return true;
    } catch (err) { return fail(err instanceof Error ? err.message : '保存失败'); }
    finally { setSaving(false); }
  };

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={() => window.location.reload()} />;
  const panelSaveButton = (source: SaveSource) => <Button theme="primary" loading={saving} disabled={saving} onClick={() => void save(source)}>保存</Button>;
  const feedback = (source: SaveSource) => saveFeedback?.source === source && <p className={`home-config-feedback home-config-feedback-${saveFeedback.type}`} role="alert">{saveFeedback.message}</p>;
  const productSelect = (value: string, onChange: (value: string) => void) => <ProductSelect value={value} onChange={onChange} known={known} onKnown={(product) => setKnown((old) => ({ ...old, [String(product._id)]: product }))} />;
  const imageLinkFields = (kind: 'banners' | 'promos', entry: ImageLink, index: number) => <div className="home-config-link-fields">
    <Field label="封面图片" fileUpload><ImagePicker onChange={(value) => updateLink(kind, index, 'image', value)} /></Field>
    <Field label="跳转商品（可选）">{productSelect(entry.productId, (value) => updateLink(kind, index, 'productId', value))}</Field>
  </div>;

  return <div className="home-config-page">
    <Panel><div className="panel-heading"><h3>顶部搜索栏</h3>{panelSaveButton('search')}</div>{feedback('search')}<Field label="滚动文字"><Input value={config.searchText} onChange={(value) => setConfig((old) => ({ ...old, searchText: value }))} placeholder={CONTENT_PLACEHOLDER} maxcharacter={120} /></Field></Panel>

    <Panel><div className="panel-heading"><h3>轮播图（9:16）</h3><div className="home-config-panel-actions"><Button disabled={config.banners.length >= 6} onClick={() => setConfig((old) => ({ ...old, banners: [...old.banners, blankLink()] }))}>新增轮播图</Button>{panelSaveButton('banners')}</div></div>{feedback('banners')}
      {config.banners.map((entry, index) => <div className="home-config-entry" key={index}>
        <div className="home-config-entry-head"><strong>轮播 {index + 1}</strong><Button size="small" variant="text" disabled={config.banners.length <= 1} onClick={() => setConfig((old) => ({ ...old, banners: old.banners.filter((_, i) => i !== index) }))}>删除</Button></div>
        {imageLinkFields('banners', entry, index)}
      </div>)}
      {config.banners.some((entry) => entry.image) && <div className="home-config-image-previews">
        {config.banners.map((entry, index) => entry.image && <div className="home-config-image-preview" key={index}><ImagePreview image={entry.image} aspect="banner" /></div>)}
      </div>}
    </Panel>

    <Panel><div className="panel-heading"><h3>轮播下方文字</h3>{panelSaveButton('bannerText')}</div>{feedback('bannerText')}<Field label="显示文字"><Input value={config.bannerText} onChange={(value) => setConfig((old) => ({ ...old, bannerText: value }))} placeholder={CONTENT_PLACEHOLDER} maxcharacter={160} /></Field></Panel>

    <Panel><div className="panel-heading"><h3>轮播下方两个图片位（1:1）</h3>{panelSaveButton('promos')}</div>{feedback('promos')}
      {config.promos.map((entry, index) => <div className="home-config-entry" key={index}><div className="home-config-entry-head"><strong>{index === 0 ? '左侧位置' : '右侧位置'}</strong></div>{imageLinkFields('promos', entry, index)}</div>)}
      {config.promos.some((entry) => entry.image) && <div className="home-config-image-previews">
        {config.promos.map((entry, index) => entry.image && <div className="home-config-image-preview" key={index}><ImagePreview image={entry.image} aspect="square" /></div>)}
      </div>}
    </Panel>

    <Panel><div className="panel-heading"><h3>商品区</h3><div className="home-config-panel-actions"><Button disabled={config.sections.length >= 6} onClick={() => setConfig((old) => ({ ...old, sections: [...old.sections, blankSection()] }))}>新增商品区</Button>{panelSaveButton('sections')}</div></div>{feedback('sections')}
      {config.sections.map((section, sectionIndex) => <div className="home-config-entry" key={section.id}>
        <div className="home-config-entry-head"><strong>商品区 {sectionIndex + 1}</strong><div><Button size="small" variant="text" disabled={section.productIds.length >= 6} onClick={() => resizeSectionProducts(sectionIndex, 2)}>增加商品</Button><Button size="small" variant="text" disabled={section.productIds.length <= 2} onClick={() => resizeSectionProducts(sectionIndex, -2)}>减少商品</Button><Button size="small" variant="text" disabled={config.sections.length <= 1} onClick={() => setConfig((old) => ({ ...old, sections: old.sections.filter((item) => item.id !== section.id) }))}>删除</Button></div></div>
        <Field label="标题"><Input value={section.title} onChange={(value) => updateSection(sectionIndex, { title: value })} placeholder="商品区标题" /></Field>
        <div className="home-config-product-grid">{section.productIds.map((id, productIndex) => <Field key={productIndex} label={`商品 ${productIndex + 1}`}>{productSelect(id, (value) => updateSection(sectionIndex, { productIds: section.productIds.map((old, i) => i === productIndex ? value : old) }))}</Field>)}</div>
      </div>)}
    </Panel>

    {blocker.state === 'blocked' && <div className="home-config-dialog-backdrop" role="presentation">
      <div className="home-config-dialog" role="alertdialog" aria-modal="true" aria-labelledby="home-config-unsaved-title">
        <h3 id="home-config-unsaved-title">首页设置尚未保存</h3>
        <p>保存修改后再切换页面，或放弃本次修改。</p>
        <div className="home-config-dialog-actions">
          <Button variant="outline" disabled={saving} onClick={() => blocker.reset()}>继续编辑</Button>
          <Button variant="outline" disabled={saving} onClick={() => blocker.proceed()}>放弃修改</Button>
          <Button theme="primary" loading={saving} onClick={() => void save().then((saved) => { if (saved) blocker.proceed(); })}>保存并离开</Button>
        </div>
      </div>
    </div>}
  </div>;
}
