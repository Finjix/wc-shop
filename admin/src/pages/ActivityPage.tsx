import { useEffect, useState } from 'react';
import { Button, Input, Select, MessagePlugin } from '../components/NativeUi';
import { ErrorState, Field, Panel } from '../components/Ui';
import { callAdmin } from '../lib/api';

type Activity = { enabled: boolean; type: 'percentage' | 'amount'; value: number };

export function ActivityPage() {
  const [activity, setActivity] = useState<Activity | null>(null);
  const [value, setValue] = useState('0');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = async () => {
    setBusy(true); setError('');
    try {
      const result = await callAdmin<Activity>('activity.get');
      setActivity(result); setValue(String(result.type === 'amount' ? result.value / 100 : result.value));
    } catch (err) { setError(err instanceof Error ? err.message : '加载失败'); }
    finally { setBusy(false); }
  };
  useEffect(() => { void load(); }, []);
  const save = async () => {
    if (!activity || busy) return;
    const entered = Number(value);
    if (!value.trim() || !Number.isFinite(entered) || entered < 0 || (activity.enabled && entered <= 0)
      || (activity.type === 'percentage' && entered >= 100)
      || Math.abs(entered * 100 - Math.round(entered * 100)) > 0.000001) {
      setError('请输入有效降价数值（最多两位小数）；启用时须大于 0，百分比须小于 100。'); return;
    }
    setBusy(true); setError('');
    try {
      const result = await callAdmin<Activity>('activity.save', { ...activity, value: activity.type === 'amount' ? Math.round(entered * 100) : entered });
      setActivity(result);
      void MessagePlugin.success(result.enabled ? '活动已启用，所有商品按活动价销售。' : '活动已停用，商品恢复原始售价。');
    } catch (err) { setError(err instanceof Error ? err.message : '保存失败'); }
    finally { setBusy(false); }
  };
  return <>
    <div className="floating-save-actions"><Button theme="primary" loading={busy} disabled={busy || !activity} onClick={() => void save()}>保存更改</Button></div>
    <Panel className="form-panel activity-panel">
      <div className="panel-heading"><h3>统一降价</h3></div>
      {error && <ErrorState message={error} />}
      {!activity ? <Button disabled={busy} onClick={() => void load()}>{busy ? '加载中…' : '重新加载'}</Button> : <>
        <div className="activity-fields">
        <Field label="开关"><Select disabled={busy} value={activity.enabled ? 'on' : 'off'} options={[{ value: 'off', label: '停用' }, { value: 'on', label: '启用' }]} onChange={(next) => { setActivity({ ...activity, enabled: next === 'on' }); }} /></Field>
        <Field label="降价方式"><Select disabled={busy} value={activity.type} options={[{ value: 'percentage', label: '按百分比降价' }, { value: 'amount', label: '每件减固定金额' }]} onChange={(next) => { setActivity({ ...activity, type: next as Activity['type'] }); setValue('0'); }} /></Field>
        <Field label={activity.type === 'percentage' ? '降价百分比（%）' : '每件降价金额（元）'}>
          <Input type="number" min="0" step="0.01" disabled={busy} value={value} onChange={(next) => { setValue(next); }} />
        </Field>
        </div>
      </>}
    </Panel>
  </>;
}
