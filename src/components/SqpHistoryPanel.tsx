import {useCallback, useEffect, useState} from 'react';
import {Download, RefreshCw, Search} from 'lucide-react';
import {useAuth} from '../auth';
import {downloadSqpFile, listSqpReports, type SqpReport} from '../sqpReports';
import type {SQPRow} from '../types';

export default function SqpHistoryPanel({onOpen}: {onOpen: (rows: SQPRow[]) => void}) {
  const {accessToken} = useAuth();
  const [reports, setReports] = useState<SqpReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');
  const refresh = useCallback(async () => {
    setLoading(true); setError('');
    try { setReports(await listSqpReports(accessToken)); } catch (e) { setError(e instanceof Error ? e.message : '读取历史记录失败'); }
    finally { setLoading(false); }
  }, [accessToken]);
  useEffect(() => { void refresh(); }, [refresh]);
  const grouped = reports.filter(r => `${r.asin} ${r.marketplace} ${r.period} ${r.file_name}`.toLowerCase().includes(filter.toLowerCase()));
  return <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-lg font-bold text-slate-800">搜索绩效历史分析</h2><p className="mt-1 text-sm text-slate-500">所有登录用户均可查看；上传文件保存在私有云存储中。</p></div>
      <button onClick={() => void refresh()} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm"><RefreshCw size={15}/>刷新</button>
    </div>
    <label className="mb-4 flex items-center gap-2 rounded-lg border px-3 py-2"><Search size={16} className="text-slate-400"/><input value={filter} onChange={e => setFilter(e.target.value)} className="w-full outline-none" placeholder="按 ASIN、站点、周期或文件名搜索"/></label>
    {error && <p className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {loading ? <p className="py-10 text-center text-slate-500">正在加载历史记录…</p> : grouped.length === 0 ? <p className="py-10 text-center text-slate-500">{reports.length ? '没有符合条件的记录' : '还没有历史分析。上传并生成 SQP 报告后会显示在这里。'}</p> : <div className="space-y-3">
      {grouped.map(report => <article key={report.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 p-4">
        <div className="min-w-48 flex-1"><div className="flex flex-wrap items-center gap-2"><strong className="text-slate-800">{report.asin}</strong><span className="rounded bg-blue-50 px-2 py-0.5 text-xs text-blue-700">{report.marketplace}</span>{report.period && <span className="text-sm text-slate-600">{report.period}</span>}</div><p className="mt-1 text-xs text-slate-500">{report.row_count} 条词条 · {new Date(report.created_at).toLocaleString()} · {report.file_name}</p></div>
        <div className="flex gap-2"><button onClick={() => onOpen(report.rows)} className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700">打开分析</button><button title="下载原始文件" onClick={() => void downloadSqpFile(accessToken, report.storage_path, report.file_name).catch(e => setError(e.message))} className="rounded-lg border px-3 py-2 text-sm"><Download size={16}/></button></div>
      </article>)}
    </div>}
  </section>;
}
