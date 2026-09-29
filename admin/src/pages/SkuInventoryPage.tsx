import { useEffect, useState } from 'react';
import { useBlocker, useNavigate, useOutletContext, useSearchParams } from 'react-router-dom';
import { Button, Input, MessagePlugin } from 'tdesign-react';
import { EmptyState, ErrorState, LoadingState, Panel, Table } from '../components/Ui';
import type { AdminOutletContext } from '../components/Layout';
import { adminApi, ApiError } from '../lib/api';
import { variantName, variantStock } from '../lib/sku';
import type { ListResult, Product, Sku } from '../types';

const PAGE_SIZE = 6;

interface StockDraft {
  value: string;
  expectedStock: number;
}

function visibleSkus(product: Product, skus: Sku[]) {
  const configuredIds = new Set((Array.isArray(product.specList) ? product.specList : []).flatMap((group) => {
    const values = (group as { specValueList?: { specValueId?: string }[] }).specValueList;
    return Array.isArray(values) ? values.map((value) => String(value.specValueId || '')) : [];
  }));
  return Array.isArray(product.specList)
    ? skus.filter((sku) => [sku._id, sku.skuId].filter(Boolean).some((id) => configuredIds.has(String(id))))
    : skus;
}

function SkuStockRow({ sku, product, draft, disabled, onChange }: {
  sku: Sku;
  product: Product;
  draft?: StockDraft;
  disabled: boolean;
  onChange: (sku: Sku, value: string) => void;
}) {
  const currentStock = variantStock(sku);
  const value = draft?.value ?? '';

  return <tr>
    <td>{variantName(sku, product)}</td>
    <td>{currentStock < 0 ? '未设置' : currentStock}</td>
    <td><Input value={value} disabled={disabled} onChange={(nextValue) => onChange(sku, nextValue)} aria-label={`${product.title} ${variantName(sku, product)} 库存数量`} placeholder="输入库存数量" /></td>
  </tr>;
}

export function SkuInventoryPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedProductId = searchParams.get('productId') || '';
  const [queryInput, setQueryInput] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [refreshKey, setRefreshKey] = useState(0);
  const [products, setProducts] = useState<Product[]>([]);
  const [skusByProduct, setSkusByProduct] = useState<Record<string, Sku[]>>({});
  const [skuCache, setSkuCache] = useState<Record<string, Sku>>({});
  const [stockDrafts, setStockDrafts] = useState<Record<string, StockDraft>>({});
  const [saving, setSaving] = useState(false);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const { setUnsavedChanges } = useOutletContext<AdminOutletContext>();
  const dirty = Object.keys(stockDrafts).length > 0;
  const blocker = useBlocker(dirty);

  useEffect(() => { setUnsavedChanges(dirty); return () => setUnsavedChanges(false); }, [dirty, setUnsavedChanges]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    const load = async () => {
      const result = selectedProductId
        ? { items: [await adminApi.call<Product>('products.get', { id: selectedProductId })], total: 1 }
        : await adminApi.call<ListResult<Product>>('products.list', { page, pageSize: PAGE_SIZE, query: query || undefined });
      if (selectedProductId && result.items[0]?.deletedByAdmin) throw new Error('该商品已删除');
      const skuEntries = await Promise.all(result.items.map(async (product) => {
        const productId = String(product._id || product.spuId);
        const refs = Array.from(new Set([product._id, product.spuId].filter(Boolean).map(String)));
        const skuResults = await Promise.all(refs.map((ref) => adminApi.call<ListResult<Sku>>('skus.list', { productId: ref })));
        const skus = Array.from(new Map(skuResults.flatMap((entry) => entry.items).map((sku) => [String(sku._id || sku.skuId), sku])).values());
        return [productId, visibleSkus(product, skus)] as const;
      }));
      if (!active) return;
      setProducts(result.items);
      setSkusByProduct(Object.fromEntries(skuEntries));
      setSkuCache((old) => ({ ...old, ...Object.fromEntries(skuEntries.flatMap(([, skus]) => skus.map((sku) => [String(sku._id || sku.skuId), sku] as const))) }));
      setTotal(result.total ?? result.items.length);
    };
    void load().catch((failure: unknown) => {
      if (active) setError(failure instanceof Error ? failure.message : 'SKU 读取失败');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [selectedProductId, query, page, refreshKey]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  useEffect(() => { if (!selectedProductId && page > pageCount) setPage(pageCount); }, [selectedProductId, page, pageCount]);
  const search = () => {
    if (saving) return;
    if (selectedProductId) setSearchParams({});
    setPage(1);
    setQuery(queryInput.trim());
  };
  const updateSkuRecord = (skuId: string, updated: Sku) => {
    setSkuCache((old) => ({ ...old, [skuId]: { ...old[skuId], ...updated } }));
    setSkusByProduct((old) => Object.fromEntries(Object.entries(old).map(([productId, skus]) => [
      productId,
      skus.map((sku) => String(sku._id || sku.skuId) === skuId ? { ...sku, ...updated } : sku),
    ])));
  };
  const changeStock = (sku: Sku, value: string) => {
    const skuId = String(sku._id || sku.skuId);
    const currentStock = variantStock(sku);
    if (currentStock >= 0 && /^\d+$/.test(value.trim()) && Number(value) === currentStock) {
      setStockDrafts((old) => { const next = { ...old }; delete next[skuId]; return next; });
      return;
    }
    setStockDrafts((old) => ({
      ...old,
      [skuId]: { value, expectedStock: old[skuId]?.expectedStock ?? currentStock },
    }));
  };
  const save = async (): Promise<boolean> => {
    if (saving || !dirty) return !dirty;
    const changes = Object.entries(stockDrafts).map(([skuId, draft]) => ({ skuId, draft, sku: skuCache[skuId] }));
    if (changes.some(({ sku }) => !sku)) {
      await MessagePlugin.error('部分 SKU 信息已失效，请刷新后重试');
      setRefreshKey((key) => key + 1);
      return false;
    }
    if (changes.some(({ draft }) => !/^\d+$/.test(draft.value.trim()) || !Number.isSafeInteger(Number(draft.value)) || Number(draft.value) > 100000000)) {
      await MessagePlugin.warning('库存必须是 0 到 100000000 的整数');
      return false;
    }

    setSaving(true);
    try {
      const results: { kind: 'saved' | 'conflict' | 'failed'; skuId: string; sku?: Sku; error?: unknown }[] = new Array(changes.length);
      let nextIndex = 0;
      const worker = async () => {
        while (nextIndex < changes.length) {
          const index = nextIndex++;
          const { skuId, draft } = changes[index];
          try {
            const sku = await adminApi.call<Sku>('inventory.adjust', {
              skuId,
              stockQuantity: Number(draft.value),
              expectedStockQuantity: draft.expectedStock,
            });
            results[index] = { kind: 'saved', skuId, sku };
          } catch (failure) {
            if (failure instanceof ApiError && failure.code === 'CONFLICT') {
              try {
                const sku = await adminApi.call<Sku>('skus.get', { skuId });
                results[index] = { kind: 'conflict', skuId, sku };
              } catch (refreshFailure) {
                results[index] = { kind: 'failed', skuId, error: refreshFailure };
                setRefreshKey((key) => key + 1);
              }
            } else results[index] = { kind: 'failed', skuId, error: failure };
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(8, changes.length) }, () => worker()));

      let savedCount = 0;
      let conflictCount = 0;
      const failed = results.filter((result) => result.kind === 'failed');
      results.forEach((result) => {
        if (result.kind === 'saved' && result.sku) {
          savedCount += 1;
          updateSkuRecord(result.skuId, result.sku);
          setStockDrafts((old) => { const next = { ...old }; delete next[result.skuId]; return next; });
        } else if (result.kind === 'conflict' && result.sku) {
          conflictCount += 1;
          updateSkuRecord(result.skuId, result.sku);
          setStockDrafts((old) => { const next = { ...old }; delete next[result.skuId]; return next; });
        }
      });
      if (failed.length) {
        const detail = failed[0].error instanceof Error ? `：${failed[0].error.message}` : '';
        await MessagePlugin.error(`库存设置部分失败，${savedCount} 项已保存，${failed.length} 项请重试${detail}`);
      } else if (conflictCount) {
        await MessagePlugin.warning(`${conflictCount} 项库存已变化，已刷新当前数量，请重新输入`);
      } else {
        await MessagePlugin.success('库存设置已保存');
      }
      return failed.length === 0 && conflictCount === 0;
    } finally {
      setSaving(false);
    }
  };

  return <>
    <div className="page-actions product-page-actions">
      <div className="product-page-search">
        <Input value={queryInput} disabled={saving} onChange={setQueryInput} onEnter={(_value, { e }) => { e.preventDefault(); search(); }} placeholder="搜索商品名称" aria-label="搜索商品名称" />
        <Button theme="primary" disabled={saving} onClick={search}>搜索</Button>
      </div>
      <div className="sku-inventory-page-actions">
        {selectedProductId && <Button variant="outline" disabled={saving} onClick={() => { setSearchParams({}); setQuery(''); setQueryInput(''); setPage(1); }}>查看全部 SKU</Button>}
        <Button theme="primary" loading={saving} disabled={!dirty || saving || loading} onClick={() => void save()}>保存</Button>
      </div>
    </div>
    {loading && <LoadingState />}
    {!loading && error && <ErrorState message={error} onRetry={() => setRefreshKey((key) => key + 1)} />}
    {!loading && !error && products.length === 0 && <Panel><EmptyState title={query ? '没有找到相关商品' : '暂无商品'} /></Panel>}
    {!loading && !error && products.map((product) => {
      const productId = String(product._id || product.spuId);
      const skus = skusByProduct[productId] || [];
      return <Panel className="sku-inventory-panel" key={productId}>
        <div className="panel-heading">
          <h3>{product.title || '未命名商品'}</h3>
          <Button variant="text" disabled={saving} onClick={() => navigate(`/products?edit=${encodeURIComponent(productId)}`)}>编辑</Button>
        </div>
        {skus.length === 0 ? <EmptyState title="该商品暂无规格" /> : <Table minWidth={560}>
          <thead><tr><th>规格</th><th>当前库存</th><th>设置库存</th></tr></thead>
          <tbody>{skus.map((sku) => {
            const skuId = String(sku._id || sku.skuId);
            return <SkuStockRow key={skuId} sku={sku} product={product} draft={stockDrafts[skuId]} disabled={saving} onChange={changeStock} />;
          })}</tbody>
        </Table>}
      </Panel>;
    })}
    {!selectedProductId && !loading && !error && total > 0 && <div className="product-list-pagination sku-inventory-pagination">
      <div>
        <Button variant="outline" disabled={page <= 1 || saving} onClick={() => setPage((value) => value - 1)}>上一页</Button>
        <span>{page} / {pageCount} 页</span>
        <Button variant="outline" disabled={page >= pageCount || saving} onClick={() => setPage((value) => value + 1)}>下一页</Button>
      </div>
    </div>}
    {blocker.state === 'blocked' && <div className="home-config-dialog-backdrop" role="presentation"><div className="home-config-dialog" role="alertdialog" aria-modal="true" aria-labelledby="sku-inventory-unsaved-title"><h3 id="sku-inventory-unsaved-title">库存设置尚未保存</h3><p>保存修改后再切换页面，或放弃本次修改。</p><div className="home-config-dialog-actions"><Button variant="outline" disabled={saving} onClick={() => blocker.reset()}>继续编辑</Button><Button variant="outline" disabled={saving} onClick={() => blocker.proceed()}>放弃修改</Button><Button theme="primary" loading={saving} onClick={() => void save().then((saved) => { if (saved) blocker.proceed(); })}>保存并离开</Button></div></div></div>}
  </>;
}
