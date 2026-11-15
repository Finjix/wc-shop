import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Input, Textarea, MessagePlugin } from '../components/NativeUi';
import { ErrorState, Field, LoadingState, Panel, Table, EmptyTable } from '../components/Ui';
import { useConfirm } from '../components/ConfirmProvider';
import { adminApi } from '../lib/api';
import type { ReturnAddress } from '../types';

const empty = { receiver: '', phone: '', detail: '' };

export function ReturnAddressesPage() {
  const navigate = useNavigate();
  const [addresses, setAddresses] = useState<ReturnAddress[]>([]);
  const [draft, setDraft] = useState({ ...empty, id: '' });
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const confirm = useConfirm();
  const load = async () => {
    setLoading(true); setError('');
    try { setAddresses((await adminApi.call<{ items: ReturnAddress[] }>('returnAddresses.list')).items); }
    catch (err) { setError(err instanceof Error ? err.message : '加载失败'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  const save = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const saved = await adminApi.call<ReturnAddress>('returnAddresses.save', { ...draft, id: draft.id || undefined });
      setAddresses((old) => [...old.filter((item) => item._id !== saved._id), saved]);
      setEditing(false); setDraft({ ...empty, id: '' });
      void MessagePlugin.success('退货地址已保存');
    } catch (err) { setError(err instanceof Error ? err.message : '保存失败，请刷新核实结果'); }
    finally { setBusy(false); }
  };
  const remove = async (address: ReturnAddress) => {
    if (busy || !await confirm(`删除 ${address.receiver} 的退货地址？已批准售后单的地址不受影响。`, { closeBtn: false })) return;
    setBusy(true); setError('');
    try {
      await adminApi.call('returnAddresses.delete', { id: address._id });
      setAddresses((old) => old.filter((item) => item._id !== address._id));
      void MessagePlugin.success('退货地址已删除');
    } catch (err) { setError(err instanceof Error ? err.message : '删除失败，请刷新核实结果'); }
    finally { setBusy(false); }
  };
  return <div className="return-addresses-page">
    <div className="return-addresses-header"><div className="return-addresses-header-actions"><Button theme="primary" disabled={busy || loading || editing} onClick={() => { setDraft({ ...empty, id: '' }); setEditing(true); setError(''); }}>添加退货地址</Button><Button variant="outline" disabled={busy} onClick={() => navigate('/after-sales')}>返回售后</Button></div></div>
    {error && <ErrorState message={error} />}
    {editing && <Panel className="return-addresses-form">
      <div className="return-addresses-fields"><Field label="收件人"><Input value={draft.receiver} disabled={busy} onChange={(receiver) => setDraft({ ...draft, receiver })} /></Field>
      <Field label="联系电话"><Input value={draft.phone} disabled={busy} onChange={(phone) => setDraft({ ...draft, phone })} /></Field>
      <Field label="退货地址"><Textarea value={draft.detail} rows={3} disabled={busy} onChange={(detail) => setDraft({ ...draft, detail })} /></Field>
      </div><div className="return-addresses-form-actions"><Button theme="primary" disabled={busy} loading={busy} onClick={() => void save()}>保存地址</Button><Button variant="outline" disabled={busy} onClick={() => { setEditing(false); setError(''); }}>取消</Button></div>
    </Panel>}
    {loading ? <LoadingState /> : <Panel><Table minWidth={650}><thead><tr><th>收件人</th><th>联系电话</th><th>退货地址</th><th>操作</th></tr></thead><tbody>
      {addresses.length === 0 && <EmptyTable colSpan={4} description="暂无退货地址，请先添加" />}
      {addresses.map((address) => <tr key={address._id}><td>{address.receiver}</td><td>{address.phone}</td><td>{address.detail}</td><td><div className="return-addresses-row-actions"><Button variant="text" disabled={busy || editing} onClick={() => { setDraft({ ...address, id: address._id }); setEditing(true); setError(''); }}>编辑</Button><Button variant="text" disabled={busy || editing} onClick={() => void remove(address)}>删除</Button></div></td></tr>)}
    </tbody></Table></Panel>}

  </div>;
}
